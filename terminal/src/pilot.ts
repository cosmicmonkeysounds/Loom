//! Piloting: a scanned guest's own session, on the terminal. The terminal
//! holds a moderator token, so it mints a play-as session for the guest
//! through `/api/mod/impersonate` (the seam the editor's Run → Players
//! page uses) — exact (a guest's view, no more), in memory only, cut by
//! the same restarts that cut the phone's session, and every line typed
//! here is journaled `by` this terminal's name (the mod feed shows it as
//! `via`). It then opens the guest's stream (`useChatStream`, the play
//! app's own reducer) and narrows it to the one thread this is a line to:
//! `dm:<Character>` — the very thread on the guest's phone, so what is
//! said at the wall is on their screen when they walk away.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, useChatStream } from "@loom/play/client.ts";
import { useTyping } from "@loom/play/typing.ts";
import type { ChatMessage, GuestView } from "@loom/play/types.ts";
import { baseOf, type TerminalConfig } from "./config.ts";

export interface Pilot {
  /** The impersonation token (the guest's session on this terminal). */
  token: string;
  id: string;
  name: string;
}

/** Mint a play-as session for a scanned guest. */
export async function beginPilot(config: TerminalConfig, guestId: string): Promise<Pilot> {
  const r = await api<{ token: string; id: string; name: string }>(
    `${baseOf(config)}/api/mod/impersonate`,
    { role: "guest", id: guestId, label: `Terminal · ${config.name}` },
    config.token,
  );
  return { token: r.token, id: r.id, name: r.name };
}

/** End it (the leash ran out, or the guest disconnected). */
export async function endPilot(config: TerminalConfig, pilot: Pilot): Promise<void> {
  try {
    await api(`${baseOf(config)}/api/mod/impersonate/end`, { session: pilot.token }, config.token);
  } catch {
    /* the run may have restarted under us — the session is gone either way */
  }
}

/** The roster (id + name) for the typed fallback — a mod-only read. */
export async function fetchRoster(config: TerminalConfig): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${baseOf(config)}/api/state?role=mod`, { headers: { "x-loom-token": config.token } });
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  const view = (await res.json()) as { roster?: Array<{ id: string; name: string }> };
  return (view.roster ?? []).map((r) => ({ id: r.id, name: r.name }));
}

/** Is the terminal's moderator token still honoured? */
export async function tokenAlive(config: TerminalConfig): Promise<boolean> {
  try {
    const res = await fetch(`${baseOf(config)}/api/mod/tts`, { headers: { "x-loom-token": config.token } });
    return res.status !== 401 && res.status !== 403;
  } catch {
    return true; // the server is away, not the token
  }
}

export interface Line extends ChatMessage {
  /** Said by the character (else by the guest / the operator). */
  theirs: boolean;
}

export interface PilotSession {
  view: GuestView | null;
  connected: boolean;
  /** The backlog loaded — `lines` is real. */
  ready: boolean;
  /** The DM thread, oldest first. */
  lines: Line[];
  /** The character is composing a reply. */
  typing: boolean;
  /** Character is answered by an agent that is online now (null = unknown). */
  online: boolean | null;
  /** Say something to the character, as the guest. */
  say: (text: string) => Promise<void>;
  /** Fires for every line of the character's that *arrives* (never the
   *  backlog). Returns the unsubscribe; stable across renders. */
  onNewLine: (fn: (line: Line) => void) => () => void;
  /** The run restarted / ended under us; the session is gone. */
  dead: string | null;
}

export function usePilotSession(config: TerminalConfig, pilot: Pilot | null): PilotSession {
  const base = baseOf(config);
  const channel = `dm:${config.character}`;
  const url = pilot ? `${base}/events?role=guest&token=${encodeURIComponent(pilot.token)}` : null;
  const [view, setView] = useState<GuestView | null>(null);
  const [ready, setReady] = useState(false);
  const [dead, setDead] = useState<string | null>(null);
  const baseline = useRef(-1);
  const listeners = useRef(new Set<(line: Line) => void>());
  const announced = useRef(new Set<number>());
  const { typing, onTyping } = useTyping(pilot !== null ? { role: "guest" } : null);

  useEffect(() => {
    setView(null);
    setReady(false);
    setDead(null);
    baseline.current = -1;
    announced.current = new Set();
  }, [pilot]);

  const { messages, connected } = useChatStream(url, {
    onSnapshot: (v) => setView(v as GuestView),
    onTyping,
    onHistory: (list) => {
      baseline.current = list.reduce((m, x) => Math.max(m, x.seq), -1);
      setReady(true);
    },
    onLifecycle: (n) => {
      if (n.kind === "reset" || n.kind === "reload" || n.kind === "golive" || n.kind === "ended") setDead(n.kind);
    },
    onDead: () => setDead("closed"),
  });

  const lines = useMemo<Line[]>(
    () =>
      [...messages.values()]
        .filter((m) => m.channel === channel && !m.hidden)
        .sort((a, b) => a.seq - b.seq)
        .map((m) => ({ ...m, theirs: m.from === config.character })),
    [messages, channel, config.character],
  );

  // Announce each of the character's lines once, and only ones that land
  // after the backlog (a re-scan must not replay the whole conversation).
  useEffect(() => {
    for (const l of lines) {
      if (!l.theirs || l.kind !== "line" || l.seq <= baseline.current || announced.current.has(l.seq)) continue;
      announced.current.add(l.seq);
      for (const fn of listeners.current) fn(l);
    }
  }, [lines]);

  const say = useCallback(
    async (text: string) => {
      if (pilot === null) return;
      try {
        await api(`${base}/api/guest/say`, { channel, text }, pilot.token);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) setDead("closed");
        throw e;
      }
    },
    [base, channel, pilot],
  );

  const onNewLine = useCallback((fn: (line: Line) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const online = useMemo(() => {
    const me = view?.people?.find((p) => p.kind === "character" && p.id === config.character);
    return me?.agent?.online ?? null;
  }, [view, config.character]);

  return { view, connected, ready, lines, typing: typing.has(channel), online, say, onNewLine, dead };
}
