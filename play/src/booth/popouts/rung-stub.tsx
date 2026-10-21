//! A local stand-in for the moments lane's pop-out rung (BOOTH-SPEC §2.1,
//! `play/src/moments/popout.tsx`), so the booth lane builds and tests its
//! pop-outs before that file lands. It keeps the §2.2 rules the booth
//! depends on: one on screen (a new key queues, never replaces), queue
//! order (priority, then age), handled / deferred keys per sign-in, Later,
//! the floating window vs the docked 56 px strip, an action's busy state,
//! arm and dead time, and `autoRetireMs`. Sound, the caption flash and the
//! "re-shown from storage" of sticky specs are the moments lane's: here the
//! booth re-raises from its view on every snapshot. `rung.ts` is the one
//! import the booth reads; swap it to `../../moments/popout.tsx` when that lands.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useArmButtons, ARM_LINE } from "../../arm.ts";
import { usePlayHost, type SessionStorage } from "../../host.ts";
import { PersonAvatar } from "../../ui/primitives.tsx";

export type PopTone = "alarm" | "info" | "win";

export interface PopGuest {
  id: string;
  name: string;
  avatar?: string | null;
  location?: string | null;
  seen?: string | null;
}

export interface PopAction {
  id: string;
  label: string;
  kind?: "primary" | "secondary";
  arm?: boolean;
  deadMs?: number;
  run: () => void | Promise<unknown>;
  closes?: boolean;
}

export interface PopOutSpec {
  key: string;
  rev?: string;
  glyph: string;
  title: string;
  body: string | string[];
  guest?: PopGuest;
  rows?: PopGuest[];
  actions: PopAction[];
  noLater?: boolean;
  tone: PopTone;
  sticky: boolean;
  priority: number;
  status?: string;
  autoRetireMs?: number;
  sound?: boolean;
  at: number;
}

/** How many handled keys a sign-in keeps (oldest dropped). */
export const HANDLED_CAP = 300;

const KEY = (token: string | null) => `loom.popouts.${token ?? "anon"}`;

interface Stored {
  handled: Array<[string, string]>;
  deferred: Array<[string, string, number]>;
}

function load(storage: SessionStorage, token: string | null): Stored {
  try {
    const s = storage.load<Stored>(KEY(token));
    if (s !== null && Array.isArray(s.handled) && Array.isArray(s.deferred)) return s;
  } catch {
    /* a private window */
  }
  return { handled: [], deferred: [] };
}

const revOf = (s: Pick<PopOutSpec, "rev">) => s.rev ?? "";

/** The pure queue (exported for tests): the one on screen and what waits. */
export function pickCurrent(specs: readonly PopOutSpec[], shown: string | null, skip: (s: PopOutSpec) => boolean = () => false): PopOutSpec | null {
  const keep = shown !== null ? specs.find((s) => s.key === shown && !skip(s)) : undefined;
  if (keep !== undefined) return keep;
  const order = [...specs].filter((s) => !skip(s)).sort((a, b) => b.priority - a.priority || a.at - b.at);
  return order[0] ?? null;
}

interface Rung {
  current: PopOutSpec | null;
  queued: number;
  tray: PopOutSpec[];
  deferredAt: (key: string) => number | null;
  defer: (key: string) => void;
  restore: (key: string) => void;
  raise: (spec: PopOutSpec) => void;
  retire: (key: string) => void;
  handle: (key: string) => void;
  docks: number;
  mountDock: () => () => void;
}

const RungContext = createContext<Rung | null>(null);

/** The free functions reach the most recently mounted provider (effects only). */
let lastRung: Rung | null = null;

export function PopOutProvider({ session, cardGuest, children, seed }: { session: string | null; cardGuest?: () => string | null; children: ReactNode; seed?: PopOutSpec[] }) {
  const host = usePlayHost();
  const [specs, setSpecs] = useState<Map<string, PopOutSpec>>(() => new Map((seed ?? []).map((s) => [s.key, s])));
  const [stored, setStored] = useState<Stored>(() => load(host.storage, session));
  const [shown, setShown] = useState<string | null>(null);
  const [docks, setDocks] = useState(0);
  useEffect(() => setStored(load(host.storage, session)), [host.storage, session]);
  const persist = useCallback(
    (next: Stored) => {
      setStored(next);
      try {
        host.storage.save(KEY(session), next);
      } catch {
        /* a private window: kept in memory */
      }
    },
    [host.storage, session],
  );
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const handledRev = (key: string): string | null => storedRef.current.handled.find(([k]) => k === key)?.[1] ?? null;
  const deferredRev = (key: string): [string, number] | null => {
    const d = storedRef.current.deferred.find(([k]) => k === key);
    return d !== undefined ? [d[1], d[2]] : null;
  };
  const raise = useCallback((spec: PopOutSpec) => {
    const h = handledRev(spec.key);
    if (h !== null && h === revOf(spec)) return;
    if (h !== null) persist({ ...storedRef.current, handled: storedRef.current.handled.filter(([k]) => k !== spec.key) });
    const d = deferredRev(spec.key);
    if (d !== null && d[0] !== revOf(spec)) persist({ ...storedRef.current, deferred: storedRef.current.deferred.filter(([k]) => k !== spec.key) });
    setSpecs((prev) => {
      const old = prev.get(spec.key);
      if (old === spec) return prev;
      const next = new Map(prev);
      next.set(spec.key, spec);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist]);
  const handle = useCallback(
    (key: string) => {
      setSpecs((prev) => {
        const s = prev.get(key);
        const rev = s !== undefined ? revOf(s) : (handledRev(key) ?? "");
        const handled = [...storedRef.current.handled.filter(([k]) => k !== key), [key, rev] as [string, string]].slice(-HANDLED_CAP);
        persist({ handled, deferred: storedRef.current.deferred.filter(([k]) => k !== key) });
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persist],
  );
  const defer = useCallback(
    (key: string) => {
      const s = specs.get(key);
      persist({ ...storedRef.current, deferred: [...storedRef.current.deferred.filter(([k]) => k !== key), [key, s !== undefined ? revOf(s) : "", Date.now()]] });
      setShown((v) => (v === key ? null : v));
    },
    [specs, persist],
  );
  const restore = useCallback(
    (key: string) => {
      persist({ ...storedRef.current, deferred: storedRef.current.deferred.filter(([k]) => k !== key) });
      setShown(key);
    },
    [persist],
  );
  const isDeferred = (s: PopOutSpec) => {
    const d = stored.deferred.find(([k]) => k === s.key);
    return d !== undefined && d[1] === revOf(s);
  };
  const live = [...specs.values()].filter((s) => {
    const h = stored.handled.find(([k]) => k === s.key);
    return !(h !== undefined && h[1] === revOf(s));
  });
  const onScreen = live.filter((s) => !isDeferred(s));
  const aboutCard = (s: PopOutSpec) => docks > 0 && s.guest !== undefined && cardGuest?.() === s.guest.id;
  const current = pickCurrent(onScreen, shown, aboutCard);
  useEffect(() => {
    if (current !== null && current.key !== shown) setShown(current.key);
  }, [current, shown]);
  // autoRetireMs: retire itself after that long on screen untouched.
  useEffect(() => {
    if (current === null || current.autoRetireMs === undefined) return;
    const t = setTimeout(() => handle(current.key), current.autoRetireMs);
    return () => clearTimeout(t);
  }, [current?.key, current?.rev, current?.autoRetireMs, handle]);
  const tray = live.filter(isDeferred).sort((a, b) => (deferredRev(b.key)?.[1] ?? 0) - (deferredRev(a.key)?.[1] ?? 0));
  const mountDock = useCallback(() => {
    setDocks((n) => n + 1);
    return () => setDocks((n) => n - 1);
  }, []);
  const rung: Rung = {
    current,
    queued: Math.max(0, onScreen.length - (current !== null ? 1 : 0)),
    tray,
    deferredAt: (key) => deferredRev(key)?.[1] ?? null,
    defer,
    restore,
    raise,
    retire: handle,
    handle,
    docks,
    mountDock,
  };
  lastRung = rung;
  return <RungContext.Provider value={rung}>{children}</RungContext.Provider>;
}

const NO_RUNG: Rung = {
  current: null,
  queued: 0,
  tray: [],
  deferredAt: () => null,
  defer: () => {},
  restore: () => {},
  raise: () => {},
  retire: () => {},
  handle: () => {},
  docks: 0,
  mountDock: () => () => {},
};

function useRung(): Rung {
  return useContext(RungContext) ?? NO_RUNG;
}

export function usePopOuts(): { current: PopOutSpec | null; queued: number; tray: PopOutSpec[]; defer(key: string): void; restore(key: string): void; raise(spec: PopOutSpec): void; retire(key: string): void } {
  const r = useRung();
  return { current: r.current, queued: r.queued, tray: r.tray, defer: r.defer, restore: r.restore, raise: r.raise, retire: r.retire };
}

export function raisePopOut(spec: PopOutSpec): void {
  lastRung?.raise(spec);
}

export function retirePopOut(key: string): void {
  lastRung?.retire(key);
}

/** "seen 2 min ago" etc. are the caller's; this is the pop-out's body. */
function Body({ spec, compact }: { spec: PopOutSpec; compact: boolean }) {
  const r = useRung();
  const arm = useArmButtons();
  const [busy, setBusy] = useState(false);
  const [since] = useState(() => Date.now());
  const [, setTick] = useState(0);
  const deadLeft = Math.max(0, ...spec.actions.map((a) => (a.deadMs ?? 0) - (Date.now() - since)));
  useEffect(() => {
    if (deadLeft <= 0) return;
    const t = setTimeout(() => setTick((n) => n + 1), deadLeft + 10);
    return () => clearTimeout(t);
  }, [deadLeft]);
  const body = Array.isArray(spec.body) ? spec.body : [spec.body];
  const run = (a: PopAction) => {
    if (busy) return;
    if ((a.deadMs ?? 0) > Date.now() - since) return;
    arm.tap(`${spec.key}:${a.id}`, a.arm, () => {
      setBusy(true);
      Promise.resolve()
        .then(a.run)
        .then(
          () => {
            setBusy(false);
            if (a.closes !== false) r.handle(spec.key);
          },
          () => setBusy(false),
        );
    });
  };
  const actions = compact ? spec.actions.slice(0, 3) : spec.actions;
  return (
    <div className={`popout-body ${compact ? "compact" : ""}`}>
      {spec.guest !== undefined && (
        <div className="popout-guest">
          <PersonAvatar name={spec.guest.name} size={compact ? "md" : "lg"} />
          <div className="popout-guest-text">
            <strong className="popout-name">{spec.guest.name}</strong>
            {spec.guest.location != null && <span className="popout-place">📍 {spec.guest.location}</span>}
            {spec.guest.seen != null && <span className="popout-seen">{spec.guest.seen}</span>}
          </div>
        </div>
      )}
      {body.filter((p) => p !== "").map((p, n) => (
        <p key={n} className="popout-p">
          {p}
        </p>
      ))}
      {(spec.rows ?? []).slice(0, 4).map((g) => (
        <div key={g.id} className="popout-row">
          <PersonAvatar name={g.name} size="sm" />
          <span className="popout-row-name">{g.name}</span>
          {g.location != null && <span className="popout-place">📍 {g.location}</span>}
        </div>
      ))}
      <div className="popout-actions">
        {actions.map((a) => {
          const armed = arm.armed === `${spec.key}:${a.id}`;
          const dead = (a.deadMs ?? 0) > Date.now() - since;
          return (
            <button key={a.id} type="button" className={`w95-btn popout-btn ${a.kind === "primary" ? "primary booth-default" : ""} ${armed ? "armed" : ""}`} disabled={busy || dead} aria-busy={busy || undefined} onClick={() => run(a)}>
              {busy ? `${a.label} …` : armed ? ARM_LINE : a.label}
            </button>
          );
        })}
        {spec.noLater !== true && (
          <button type="button" className="w95-btn popout-btn popout-later" disabled={busy} onClick={() => r.defer(spec.key)}>
            Later
          </button>
        )}
      </div>
      {spec.status !== undefined && <div className="popout-status">{spec.status}</div>}
    </div>
  );
}

function Caption({ spec, queued, onLater }: { spec: PopOutSpec; queued: number; onLater?: () => void }) {
  return (
    <div className={`popout-cap ${spec.tone}`}>
      <span className="popout-cap-title">
        <span aria-hidden>{spec.glyph}</span> {spec.title}
      </span>
      {queued > 0 && <span className="popout-pager">1 of {queued + 1}</span>}
      {onLater !== undefined && spec.noLater !== true && (
        <button type="button" className="w95-btn w95-x popout-min" aria-label="Later" onClick={onLater}>
          _
        </button>
      )}
    </div>
  );
}

/** The floating window (no dock mounted). */
export function PopOutHost(): JSX.Element | null {
  const r = useRung();
  const c = r.current;
  if (c === null || r.docks > 0) return null;
  return (
    <div className={`popout popout-float ${c.tone}`} role="dialog" aria-modal="false" aria-label={`${c.title}${c.guest ? `: ${c.guest.name}` : ""}`} data-popout={c.key}>
      <span className="booth-sr" aria-live="assertive">
        {c.title}
        {c.guest ? `: ${c.guest.name}` : ""}
      </span>
      <Caption spec={c} queued={r.queued} onLater={() => r.defer(c.key)} />
      <Body key={`${c.key}|${revOf(c)}`} spec={c} compact={false} />
    </div>
  );
}

/** The docked slot: a 56 px strip that expands in place (plain flow layout). */
export function PopOutDock(): JSX.Element | null {
  const r = useRung();
  const mount = r.mountDock;
  useEffect(() => mount(), [mount]);
  const [open, setOpen] = useState(false);
  const c = r.current;
  useEffect(() => setOpen(false), [c?.key]);
  if (c === null) return null;
  if (!open) {
    return (
      <div className={`popout popout-strip ${c.tone}`} data-popout={c.key}>
        <button type="button" className="popout-strip-btn" onClick={() => setOpen(true)} aria-expanded={false}>
          <span aria-hidden>{c.glyph}</span> <span className="popout-strip-text">
            {c.title}
            {c.guest ? `: ${c.guest.name}` : ""}
            {c.guest?.location ? ` · 📍 ${c.guest.location}` : ""}
          </span>
          <span className="popout-strip-open" aria-hidden>
            ▭
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className={`popout popout-docked ${c.tone}`} role="group" aria-label={c.title} data-popout={c.key}>
      <Caption spec={c} queued={r.queued} onLater={() => r.defer(c.key)} />
      <Body key={`${c.key}|${revOf(c)}`} spec={c} compact />
    </div>
  );
}

/** The deferred list, for the booth's 🔔 window. */
export function PopOutTrayList({ onPick }: { onPick?: (key: string) => void }): JSX.Element {
  const r = useRung();
  const now = Date.now();
  if (r.tray.length === 0) return <p className="booth-none">Nothing waiting. You're on top of it.</p>;
  return (
    <ul className="popout-tray">
      {r.tray.map((s) => {
        const at = r.deferredAt(s.key);
        const mins = at !== null ? Math.max(0, Math.round((now - at) / 60_000)) : null;
        return (
          <li key={s.key}>
            <button
              type="button"
              className="booth-guest popout-tray-row"
              onClick={() => {
                r.restore(s.key);
                onPick?.(s.key);
              }}
            >
              <span aria-hidden>{s.glyph}</span>
              <span className="booth-guest-body">
                <span className="booth-guest-name">
                  {s.title}
                  {s.guest ? `: ${s.guest.name}` : ""}
                </span>
                {mins !== null && <span className="booth-guest-sub">deferred {mins} min ago</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Test seam: the rung's counts as a hook (memoised). */
export function usePopOutCounts(): { tray: number; queued: number; current: boolean } {
  const r = useRung();
  return useMemo(() => ({ tray: r.tray.length, queued: r.queued, current: r.current !== null }), [r.tray.length, r.queued, r.current]);
}
