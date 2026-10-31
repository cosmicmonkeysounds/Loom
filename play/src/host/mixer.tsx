//! The Desk window's 🎚 Mixer (wave 40, docs/loom-w40-contract.md C5): the
//! house's live balance, laid out for a phone (Now Playing moved to the
//! 🎵 Music section in wave 58, `music.tsx`, which shares this poll and posts). Part of the Desk's lazy chunk (`desk.tsx` imports it), so a guest
//! never downloads it.
//!
//! - Folded by default; open, it polls `GET /api/mod/audio/mixer` every
//!   second while the page is visible (`startPoll` parks it while hidden),
//!   and nothing at all while folded.
//! - The router banner when no router listens (the mix is kept).
//! - The scope chips (Everywhere + each room) and that scope's strips: a
//!   horizontal fader −60 … +10 dB, its dB, a mute, a thin meter, "plays at
//!   X" when the levels around it move it; meter-only strips say why; Reset.
//!
//! A moved fader shows its own value at once and posts through the
//! throttle in `mixer-model.ts` (≤ 10 a second per fader, the last value
//! always sent); the server's mix takes over once its seq reaches the post's.

import { useCallback, useEffect, useRef, useState } from "react";
import { MIX_DB_MAX, MIX_DB_MIN, MIX_DB_STEP, formatMixDb, mixerScopes, scopeStrips, type AudioMix, type MixChange, type MixLevel, type MixerView, type MusicCommand } from "../../../core/src/house-mixer.ts";
import { startPoll } from "../director.tsx";
import type { HostCalls } from "./api.ts";
import { browserPollDeps, eventBase, type HostAuth } from "./client.ts";
import { ActButton, failText } from "./kit.tsx";
import {
  MIXER_PATH,
  MIXER_POLL_MS,
  MIXER_TIMEOUT_MS,
  NO_PENDING,
  answered,
  answeredMix,
  faderChange,
  layeredLevels,
  mergeMixerView,
  mixerPollOutcome,
  movedCount,
  musicDone,
  muteChange,
  offerChange,
  pickedScope,
  releaseSeen,
  resetChanges,
  routerBanner,
  stripRow,
  takeDue,
  withAnsweredMix,
  type MixPending,
  type StripRow,
} from "./mixer-model.ts";

export interface MixerClient {
  view: MixerView | null;
  error: string | null;
  connected: boolean;
  /** A post's answered mix over the view (the newer seq wins). */
  setMix: (mix: AudioMix) => void;
  refresh: () => void;
}

/** The mixer's poll, every `MIXER_POLL_MS` while mounted and visible. */
export function useMixerView(auth: HostAuth | null): MixerClient {
  const [view, setView] = useState<MixerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const poll = useRef<{ stop(): void; now(): void } | null>(null);
  const token = auth?.token ?? null;
  const eventId = auth?.eventId ?? null;
  useEffect(() => {
    if (token === null || eventId === null) return;
    let stopped = false;
    const load = async () => {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = setTimeout(() => ctl?.abort(), MIXER_TIMEOUT_MS);
      try {
        let res: Response;
        try {
          res = await fetch(`${eventBase(eventId)}${MIXER_PATH}`, { headers: { "x-loom-token": token }, cache: "no-store", ...(ctl !== null ? { signal: ctl.signal } : {}) });
        } catch (e) {
          if (!stopped) {
            setConnected(false);
            setError("Can't reach the server");
          }
          throw e;
        }
        const out = mixerPollOutcome(res.status, await res.json().catch(() => null));
        if (stopped) return;
        if (out.kind === "error") {
          setConnected(false);
          setError(out.message);
          throw new Error(out.message);
        }
        setView((prev) => mergeMixerView(prev, out.view));
        setConnected(true);
        setError(null);
      } finally {
        clearTimeout(timer);
      }
    };
    const p = startPoll(browserPollDeps(load), MIXER_POLL_MS);
    poll.current = p;
    return () => {
      stopped = true;
      p.stop();
      poll.current = null;
    };
  }, [token, eventId]);
  const setMix = useCallback((mix: AudioMix) => setView((v) => withAnsweredMix(v, mix)), []);
  const refresh = useCallback(() => poll.current?.now(), []);
  return { view, error, connected, setMix, refresh };
}

/** The folded section in the Desk window. */
export function MixerSection({ auth, calls }: { auth: HostAuth; calls: HostCalls }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="host-desk-part host-mix" aria-label="Mixer" data-testid="host-mixer">
      <button type="button" className="w95-btn host-desk-fold host-mix-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} 🎚 Mixer
      </button>
      {open && <MixerPanel auth={auth} calls={calls} />}
    </section>
  );
}

/** The poll's posts: the optimistic layer, the throttle, a music command. */
export function useMixPosts(client: MixerClient, calls: HostCalls) {
  const pending = useRef<MixPending>(NO_PENDING);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const [note, setNote] = useState<string | null>(null);
  const { setMix } = client;

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const due = takeDue(pending.current, Date.now());
    pending.current = due.pending;
    if (due.changes.length > 0) {
      const keys = due.changes.map((c) => c.key);
      calls
        .mix(due.changes)
        .then(
          (a) => {
            const mix = answeredMix(a);
            pending.current = answered(pending.current, keys, mix?.seq ?? null);
            if (mix !== null) setMix(mix);
          },
          (e: unknown) => {
            pending.current = answered(pending.current, keys, null);
            if (alive.current) setNote(failText(e));
          },
        )
        .finally(() => {
          if (!alive.current) return;
          flush();
          bump();
        });
    }
    if (due.wakeAt !== null && alive.current) timer.current = setTimeout(flush, Math.max(0, due.wakeAt - Date.now()));
  }, [calls, setMix, bump]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      // Folding mid-drag still sends the fader's last value.
      const last = takeDue(pending.current, Number.POSITIVE_INFINITY);
      if (last.changes.length > 0) void calls.mix(last.changes).catch(() => {});
    };
  }, [calls]);

  const view = client.view;
  const seq = view?.mix.seq ?? null;
  useEffect(() => {
    if (seq === null) return;
    const next = releaseSeen(pending.current, seq);
    if (next !== pending.current) {
      pending.current = next;
      bump();
    }
  }, [seq, bump]);

  useEffect(() => {
    if (note === null) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  const change = (c: MixChange) => {
    if (view === null) return;
    pending.current = offerChange(pending.current, view.mix.levels, c);
    bump();
    flush();
  };
  const music = async (cmd: MusicCommand) => {
    try {
      setNote(musicDone(cmd, await calls.music(cmd)));
    } catch (e) {
      setNote(failText(e));
    } finally {
      client.refresh();
    }
  };
  return { levels: view !== null ? layeredLevels(view.mix.levels, pending.current) : {}, change, music, note, setNote };
}

/** The open panel. */
function MixerPanel({ auth, calls }: { auth: HostAuth; calls: HostCalls }) {
  const client = useMixerView(auth);
  const posts = useMixPosts(client, calls);
  const [scopeId, setScopeId] = useState("all");
  const view = client.view;
  if (view === null) return <p className="host-empty">{client.error ?? "Loading the mixer…"}</p>;
  return <MixerBody view={view} levels={posts.levels} scopeId={scopeId} onScope={setScopeId} onChange={posts.change} note={posts.note} error={client.connected ? null : client.error} />;
}

export interface MixerBodyProps {
  view: MixerView;
  /** The levels to draw (the server's with this phone's pending ones). */
  levels: Readonly<Record<string, MixLevel>>;
  scopeId: string;
  onScope: (id: string) => void;
  onChange: (c: MixChange) => void;
  note: string | null;
  error: string | null;
}

/** The panel over one view (the tests render it with a fixture). */
export function MixerBody({ view, levels, scopeId, onScope, onChange, note, error }: MixerBodyProps) {
  const banner = routerBanner(view);
  const scopes = mixerScopes(view);
  const picked = pickedScope(scopes, scopeId);
  const rows = scopeStrips(view, picked.scope, levels).map(stripRow);
  const resets = resetChanges(view, picked.scope, levels);
  const moved = movedCount(view, picked.scope, levels);
  return (
    <div className="host-mix-body" data-testid="host-mix-body">
      {error !== null && <p className="host-note alarm">⚠ {error}</p>}
      {banner !== null && (
        <p className="host-mix-banner" role="status" data-testid="host-mix-banner">
          ⚠ {banner}
        </p>
      )}
      <p className="host-desk-note" role="status" aria-live="polite">
        {note ?? ""}
      </p>
      <div className="host-mix-scopes" role="group" aria-label="Where">
        {scopes.map((s) => (
          <button key={s.id} type="button" className="w95-btn host-mix-scope" aria-pressed={s.id === picked.id} onClick={() => onScope(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <ul className="host-mix-strips" data-testid="host-mix-strips">
        {rows.map((r, k) => (
          <StripLine key={r.key ?? `meter-${k}`} row={r} onChange={onChange} />
        ))}
      </ul>
      <div className="host-mix-foot">
        <ActButton className="host-mix-reset" label={moved > 0 ? `Reset ${picked.label} (${moved})` : `Reset ${picked.label}`} disabled={resets.length === 0} onClick={() => resets.forEach(onChange)} />
      </div>
    </div>
  );
}

/** One strip: the label and its dB / hint, the fader and mute, the meter. */
export function StripLine({ row, onChange }: { row: StripRow; onChange: (c: MixChange) => void }) {
  const key = row.key;
  return (
    <li className={`host-mix-strip ${row.kind}${row.muted ? " muted" : ""}`}>
      <div className="host-mix-head">
        <span className="host-mix-label">{row.label}</span>
        {row.fader && <span className="host-mix-db">{row.dbText}</span>}
      </div>
      {row.fader && key !== null ? (
        <div className="host-mix-row">
          <input
            type="range"
            className="host-mix-fader"
            min={MIX_DB_MIN}
            max={MIX_DB_MAX}
            step={MIX_DB_STEP}
            value={row.db}
            aria-label={`${row.label} level`}
            aria-valuetext={`${formatMixDb(row.db)} dB`}
            onChange={(e) => onChange(faderChange(key, Number(e.target.value)))}
          />
          <button type="button" className="w95-btn host-mix-mute" aria-pressed={row.muted} aria-label={`Mute ${row.label}`} onClick={() => onChange(muteChange(key, { db: row.db, mute: row.muted }))}>
            {row.muted ? "🔇" : "🔈"}
          </button>
        </div>
      ) : (
        row.note !== null && <p className="host-mix-hint">{row.note}</p>
      )}
      <div className={`host-mix-meter${row.dark ? " dark" : ""}`} aria-hidden="true">
        <span className="host-mix-meter-fill" style={{ width: `${Math.round(row.fill * 100)}%` }} />
      </div>
      {row.hint !== null && <p className="host-mix-hint">{row.hint}</p>}
    </li>
  );
}
