//! The booth pop-out rung (wave 18, the moments lane; BOOTH-SPEC §2,
//! CONTRACTS C9, the user's "when a program is marked for reinstallation,
//! the UI for the antivirus should be easily accessible and clear — pop
//! outs are your friend here"). The rules are `popout-model.ts`. The store
//! is here — one per sign-in, persisted per sign-in in the host's storage —
//! so only the booth's chunk carries it; the moments engine hands it the
//! booth's big moments and `!` readouts through `popout-registry.ts`.
//!
//! - `usePopOuts()` — the booth's own sign-in's store (the one on screen,
//!   the queue, the tray, raise / retire / defer / restore); use it inside a
//!   booth's `MomentsProvider`.
//! - `PopOutHost` — mounted once by `booth/app.tsx`: the floating Win95
//!   window above the dock and the taskbar, no scrim, no tap-outside or
//!   Escape close; nothing while a dock is mounted.
//! - `PopOutDock` — the first child of a booth window's scroll body (a
//!   guest card, the scanner, Guests, the Wanted board, a picker, the host
//!   drawer): the pop-out as a 56 px strip there, in flow, that expands in
//!   place — so it can never cover the open card's face.
//! - `PopOutTrayList` — the deferred ones, for the booth's 🔔 window.
//! - `PopOut` — the window itself (both layouts), for a booth that places it.
//!
//! The guest app never imports this file (its bundle stays as it was).

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { playTone } from "../alerts.ts";
import { useArmButtons, ARM_LINE } from "../arm.ts";
import { usePlayHost, type SessionStorage } from "../host.ts";
import { PersonAvatar } from "../ui/primitives.tsx";
import {
  DOCK_ACTIONS_MAX,
  EMPTY_POPOUTS,
  currentOf,
  defaultPopOut,
  deferredText,
  pagerOf,
  paragraphs,
  parseStored,
  popKey,
  popReducer,
  queuedOf,
  storedOf,
  stripText,
  type PopAction,
  type PopEntry,
  type PopGuest,
  type PopOp,
  type PopOutSpec,
  type PopState,
} from "./popout-model.ts";
import { registerPopSink } from "./popout-registry.ts";
import { useMomentsEngineContext } from "./provider.tsx";
import { typingIn } from "../ui/focus.ts";

export type { PopAction, PopGuest, PopOutAdapter, PopOutSpec, PopOutVerdict, PopTone } from "./popout-model.ts";
export { raisePopOut, retirePopOut } from "./popout-registry.ts";

// --- the store: one per sign-in ------------------------------------------------

interface Store {
  session: string;
  state: PopState;
  /** Mounted docks, oldest first (the newest renders). */
  docks: number[];
  /** Storage, once a hook has handed it over (hydrated then). */
  storage: SessionStorage | null;
  /** Each key's tone when it was last announced. */
  announced: Map<string, string>;
  listeners: Set<() => void>;
  /** Bumped on every change (the snapshot). */
  version: number;
}

const stores = new Map<string, Store>();
/** The sign-in the free functions reach: the booth that mounted its host last. */
let lastSession: string | null = null;
let dockSeq = 0;

function storeFor(session: string, storage: SessionStorage | null = null): Store {
  let s = stores.get(session);
  if (s === undefined) {
    s = { session, state: EMPTY_POPOUTS, docks: [], storage: null, announced: new Map(), listeners: new Set(), version: 0 };
    stores.set(session, s);
    while (stores.size > 16) stores.delete(stores.keys().next().value!);
  }
  if (s.storage === null && storage !== null) {
    s.storage = storage;
    try {
      s.state = popReducer(s.state, { type: "hydrate", stored: parseStored(storage.load<unknown>(popKey(session))) });
    } catch {
      /* storage blocked */
    }
  }
  if (lastSession === null) lastSession = session;
  return s;
}

function changed(s: Store): void {
  s.version++;
  for (const l of [...s.listeners]) l();
}

function apply(s: Store, op: PopOp): void {
  const next = popReducer(s.state, op);
  if (next === s.state) return;
  s.state = next;
  if (s.storage !== null && op.type !== "show")
    try {
      s.storage.save(popKey(s.session), storedOf(next));
    } catch {
      /* storage blocked */
    }
  changed(s);
}

function target(session: string | null): Store | null {
  const key = session ?? lastSession;
  return key === null ? null : storeFor(key);
}

registerPopSink({
  offer(session, m, verdict, ctx) {
    apply(storeFor(session), { type: "raise", spec: verdict === "default" ? defaultPopOut(m, ctx) : verdict });
  },
  raise(session, spec) {
    const s = target(session);
    if (s !== null) apply(s, { type: "raise", spec });
  },
  retire(session, key) {
    const s = target(session);
    if (s !== null) apply(s, { type: "retire", key });
  },
});

/** A test seam: forget every store. */
export function resetPopOutStores(): void {
  stores.clear();
  lastSession = null;
}

/** A booth's pop-outs (BOOTH-SPEC §2.1). */
export interface PopOutsApi {
  /** The one on screen. */
  current: PopOutSpec | null;
  /** Its entry (restored from storage without its buttons?). */
  entry: PopEntry | null;
  /** How many wait behind it. */
  queued: number;
  /** Deferred with Later, newest first. */
  tray: PopOutSpec[];
  trayEntries: PopEntry[];
  /** = Later. */
  defer: (key: string) => void;
  /** Tray → the front of the queue, shown now. */
  restore: (key: string) => void;
  raise: (spec: PopOutSpec) => void;
  retire: (key: string) => void;
  /** A dock mounts (the most recently mounted one renders the pop-out): its id, and its unmount. */
  dock: () => { id: number; off: () => void };
  /** The id of the dock that renders (null → the floating window). */
  activeDock: number | null;
}

const NOOP_API: PopOutsApi = {
  current: null,
  entry: null,
  queued: 0,
  tray: [],
  trayEntries: [],
  defer: () => {},
  restore: () => {},
  raise: () => {},
  retire: () => {},
  dock: () => ({ id: 0, off: () => {} }),
  activeDock: null,
};

const noSubscribe = () => () => {};

/** A booth's sign-in for the pop-outs, for components above its
 *  `MomentsProvider` (the booth shell reads its own store before it renders
 *  the provider). Inside a booth's provider the provider's sign-in wins. */
interface PopScope {
  session: string | null;
  cardGuest?: () => string | null;
}
const PopScopeContext = createContext<PopScope | null>(null);

/**
 * Names the booth sign-in the pop-outs below belong to. `seed` raises specs
 * into that store on first render (a test seam; SSR renders them at once).
 */
export function PopOutScope({ session, cardGuest, seed, children }: { session: string | null; cardGuest?: () => string | null; seed?: readonly PopOutSpec[]; children: ReactNode }) {
  const host = usePlayHost();
  const seeded = useRef(false);
  if (!seeded.current && seed !== undefined && session !== null) {
    seeded.current = true;
    const store = storeFor(session, host.storage);
    for (const spec of seed) apply(store, { type: "raise", spec });
  }
  return <PopScopeContext.Provider value={{ session, ...(cardGuest !== undefined ? { cardGuest } : {}) }}>{children}</PopScopeContext.Provider>;
}

/** The booth sign-in (and its open card's guest) this component's pop-outs belong to. */
function usePopScope(): { session: string | null; cardGuest: (() => string | null) | undefined; sound: boolean } {
  const e = useMomentsEngineContext();
  const scope = useContext(PopScopeContext);
  if (e?.input.role === "booth") return { session: e.input.session, cardGuest: e.input.cardGuest ?? scope?.cardGuest, sound: e.input.sound ?? false };
  if (e !== null) return { session: null, cardGuest: undefined, sound: false };
  return { session: scope?.session ?? null, cardGuest: scope?.cardGuest, sound: false };
}

/** The pop-outs of the booth this component sits in (its `MomentsProvider`'s sign-in, else a `PopOutScope`'s). */
export function usePopOuts(): PopOutsApi {
  const scope = usePopScope();
  const host = usePlayHost();
  const session = scope.session;
  const store = session !== null ? storeFor(session, host.storage) : null;
  const subscribe = useCallback(
    (l: () => void) => {
      if (store === null) return () => {};
      store.listeners.add(l);
      return () => store.listeners.delete(l);
    },
    [store],
  );
  const snap = () => store?.version ?? -1;
  useSyncExternalStore(store !== null ? subscribe : noSubscribe, snap, snap);
  if (store === null) return NOOP_API;
  const st = store.state;
  const entry = currentOf(st, scope.cardGuest?.() ?? null);
  return {
    current: entry?.spec ?? null,
    entry,
    queued: queuedOf(st, entry),
    tray: st.tray.map((x) => x.spec),
    trayEntries: st.tray,
    defer: (key) => apply(store, { type: "defer", key, at: Date.now() }),
    restore: (key) => apply(store, { type: "restore", key }),
    raise: (spec) => apply(store, { type: "raise", spec }),
    retire: (key) => apply(store, { type: "retire", key }),
    dock: () => {
      const id = ++dockSeq;
      store.docks = [...store.docks, id];
      changed(store);
      return {
        id,
        off: () => {
          store.docks = store.docks.filter((x) => x !== id);
          changed(store);
        },
      };
    },
    activeDock: store.docks.length > 0 ? store.docks[store.docks.length - 1]! : null,
  };
}

/** The one on screen holds (rule 1) and is announced once per tone (rule 8): the host runs this. */
function useHoldAndAnnounce(api: PopOutsApi): void {
  const { session, sound } = usePopScope();
  const key = api.entry?.spec.key ?? null;
  const tone = api.entry?.spec.tone ?? null;
  useEffect(() => {
    if (session === null) return;
    lastSession = session;
    const store = storeFor(session);
    if (store.state.shown !== key) apply(store, { type: "show", key });
    if (key === null || tone === null) return;
    if (store.announced.get(key) === tone) return;
    store.announced.set(key, tone);
    playTone(tone, sound && api.entry?.spec.sound !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, key, tone]);
}

/** Is focus in a text field (never steal it)? */
function typing(): boolean {
  return typingIn();
}

function GuestBlock({ g, size }: { g: PopGuest; size: "sm" | "md" | "lg" }) {
  return (
    <div className="popout-guest">
      <PersonAvatar name={g.name} size={size} kind="guest" />
      <div className="popout-guest-words">
        <span className="popout-guest-name">{g.name}</span>
        {(g.location || g.seen) && (
          <span className="popout-guest-where">
            {g.location ? `📍 ${g.location}` : ""}
            {g.location && g.seen ? " · " : ""}
            {g.seen ?? ""}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One pop-out window: caption (glyph, title, pager, Later `_`), the guest's
 * picture block, the body, up to four buttons plus Later, a status line.
 * `docked` = the compact layout inside a dock (48 px picture, one row of at
 * most three buttons plus Later).
 */
export function PopOut({ entry, api, docked = false }: { entry: PopEntry; api: PopOutsApi; docked?: boolean }) {
  const spec = entry.spec;
  const [busy, setBusy] = useState(false);
  const [shownAt] = useState(() => Date.now());
  const [, rerender] = useState(0);
  const arm = useArmButtons();
  const primary = useRef<HTMLButtonElement>(null);
  const [flash, setFlash] = useState(spec.tone === "alarm");
  // Dead buttons come alive on time.
  const dead = Math.max(0, ...spec.actions.map((a) => a.deadMs ?? 0));
  useEffect(() => {
    if (dead === 0) return;
    const t = window.setTimeout(() => rerender((n) => n + 1), dead + 10);
    return () => window.clearTimeout(t);
  }, [dead, spec.key]);
  useEffect(() => {
    if (!typing()) primary.current?.focus();
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(false), 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.key]);
  // Retires itself after a while on screen untouched.
  useEffect(() => {
    if (spec.autoRetireMs === undefined) return;
    const t = window.setTimeout(() => api.retire(spec.key), spec.autoRetireMs);
    return () => window.clearTimeout(t);
  }, [spec.key, spec.autoRetireMs, api]);

  const runAction = (a: PopAction) => {
    if (busy) return;
    const go = () => {
      setBusy(true);
      let out: void | Promise<unknown>;
      try {
        out = a.run();
      } catch {
        setBusy(false);
        return;
      }
      Promise.resolve(out).then(
        () => {
          setBusy(false);
          if (a.closes !== false) api.retire(spec.key);
        },
        () => setBusy(false),
      );
    };
    arm.tap(`${spec.key}\u0000${a.id}`, a.arm, go);
  };
  const actions = docked ? spec.actions.slice(0, DOCK_ACTIONS_MAX) : spec.actions;
  const firstPrimary = actions.findIndex((a) => a.kind === "primary");
  const pager = pagerOf(api.queued);
  const ok = entry.restored === true && spec.actions.length === 0;
  return (
    <div className={`popout w95-window tone-${spec.tone}${docked ? " docked" : ""}`} role="dialog" aria-modal="false" aria-label={`${spec.title}${spec.guest ? `: ${spec.guest.name}` : ""}`}>
      <div className={`w95-titlebar popout-caption${flash ? " flash" : ""}`}>
        <span className="popout-glyph" aria-hidden>
          {spec.glyph}
        </span>
        <span className="w95-title">{spec.title}</span>
        {pager !== null && <span className="popout-pager">{pager}</span>}
        {spec.noLater !== true && (
          <button type="button" className="w95-btn popout-min" aria-label="Later" title="Later" onClick={() => api.defer(spec.key)}>
            _
          </button>
        )}
      </div>
      <div className="popout-body">
        {spec.guest !== undefined && <GuestBlock g={spec.guest} size={docked ? "md" : "lg"} />}
        {(spec.rows ?? []).slice(0, 4).map((g) => (
          <div key={g.id} className="popout-row">
            <GuestBlock g={g} size="sm" />
          </div>
        ))}
        {paragraphs(spec.body).map((p, i) => (
          <p key={i} className="popout-text">
            {p}
          </p>
        ))}
      </div>
      <div className="popout-actions">
        {actions.map((a, i) => {
          const live = Date.now() - shownAt >= (a.deadMs ?? 0);
          const armed = arm.armed === `${spec.key}\u0000${a.id}`;
          return (
            <button
              key={a.id}
              ref={i === (firstPrimary >= 0 ? firstPrimary : 0) ? primary : undefined}
              type="button"
              className={`w95-btn popout-btn ${a.kind === "primary" ? "primary" : "secondary"}${armed ? " armed" : ""}`}
              disabled={busy || !live}
              onClick={() => runAction(a)}
            >
              {busy ? "…" : a.label}
              {armed && <span className="popout-arm">{ARM_LINE}</span>}
            </button>
          );
        })}
        {ok && (
          <button ref={primary} type="button" className="w95-btn popout-btn primary" onClick={() => api.retire(spec.key)}>
            OK
          </button>
        )}
        {spec.noLater !== true && (
          <button type="button" className="w95-btn popout-btn secondary popout-later" disabled={busy} onClick={() => api.defer(spec.key)}>
            Later
          </button>
        )}
      </div>
      {spec.status !== undefined && <div className="popout-status w95-inset">{spec.status}</div>}
      <span className="moments-visually-hidden" aria-live="assertive">
        {spec.title}
        {spec.guest ? `: ${spec.guest.name}` : ""}
      </span>
    </div>
  );
}

/** The floating pop-out (no booth window open). Mounted once by `booth/app.tsx`, inside its `MomentsProvider`. */
export function PopOutHost() {
  const api = usePopOuts();
  useHoldAndAnnounce(api);
  if (api.entry === null || api.activeDock !== null) return null;
  return (
    <div className="popout-host">
      <PopOut key={api.entry.spec.key} entry={api.entry} api={api} />
    </div>
  );
}

/**
 * The docked pop-out: render as the first child of a booth window's scroll
 * body. The most recently mounted dock shows the one on screen as a 56 px
 * strip; a tap expands it in place (plain flow, never over the card's foot).
 */
export function PopOutDock() {
  const api = usePopOuts();
  const [id, setId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  // Registered once per mount (the api object is new every render).
  const latest = useRef(api);
  latest.current = api;
  useEffect(() => {
    const d = latest.current.dock();
    setId(d.id);
    return d.off;
  }, []);
  const key = api.entry?.spec.key ?? null;
  useEffect(() => setOpen(false), [key]);
  if (api.entry === null || id === null || api.activeDock !== id) return null;
  const spec = api.entry.spec;
  if (!open)
    return (
      <div className={`popout-strip tone-${spec.tone}`} role="status">
        <button type="button" className="popout-strip-body" onClick={() => setOpen(true)} aria-expanded={false}>
          <span className="popout-strip-text">{stripText(spec)}</span>
          {api.queued > 0 && <span className="popout-pager">{pagerOf(api.queued)}</span>}
          <span className="popout-strip-open" aria-hidden>
            ▭
          </span>
        </button>
      </div>
    );
  return (
    <div className="popout-dock">
      <PopOut key={spec.key} entry={api.entry} api={api} docked />
    </div>
  );
}

/** The deferred pop-outs (the booth's 🔔 window): one row each, a tap brings it back. */
export function PopOutTrayList({ onPick }: { onPick?: (key: string) => void }) {
  const api = usePopOuts();
  const now = Date.now();
  if (api.trayEntries.length === 0) return <p className="popout-tray-empty">Nothing waiting. You&apos;re on top of it.</p>;
  return (
    <ul className="popout-tray">
      {api.trayEntries.map((e) => (
        <li key={e.spec.key}>
          <button
            type="button"
            className="popout-tray-row"
            onClick={() => {
              api.restore(e.spec.key);
              onPick?.(e.spec.key);
            }}
          >
            <span className="popout-glyph" aria-hidden>
              {e.spec.glyph}
            </span>
            <span className="popout-tray-words">
              <span className="popout-tray-title">
                {e.spec.title}
                {e.spec.guest ? `: ${e.spec.guest.name}` : ""}
              </span>
              <span className="popout-tray-when">{deferredText(e.deferredAt, now)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** How many pop-outs wait for the booth's 🔔 (the tray + the queue behind the one on screen). */
export function popOutWaiting(api: Pick<PopOutsApi, "tray" | "queued">): number {
  return api.tray.length + api.queued;
}
