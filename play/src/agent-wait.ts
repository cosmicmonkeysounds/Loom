// "You are 7th in line" — wave 42b (B5). When an agent-voiced character
// (`mind: external`, Trabolta) has more guests than slots, the server tells
// each waiting guest where they stand with `agentWait` frames
// (`{channel, audience, character, state, position?, etaS?}`, the typing
// frames' audience). This keeps the guest's threads → their wait; the
// strip's words are `agent-wait-words.ts` (with the strip, a lazy chunk:
// the guest's first load is at its gate). `answering` reads
// as the typing note (`withAgents`), `idle` clears it. Memory only, like
// typing: a reconnecting phone learns nothing until the next frame (the
// server re-sends on a position change, so a queued guest hears again
// within seconds), and one that never gets its `idle` ages out after
// `AGENT_WAIT_TTL_MS`.

import { useCallback, useEffect, useState } from "react";

export type AgentWaitState = "queued" | "answering" | "idle";

export interface AgentWaitNotice {
  channel: string;
  audience: string[];
  character: string;
  state: AgentWaitState;
  /** 1-based place among his queued requests. */
  position?: number;
  /** Seconds until a slot reaches it (the server's estimate). */
  etaS?: number;
  /** A public talk thread: never sent, ignored if it is. */
  public?: boolean;
}

export interface AgentWait {
  state: "queued" | "answering";
  character: string;
  position: number | null;
  etaS: number | null;
  /** The furthest back this wait has stood: the bar's empty end. */
  from: number | null;
  /** When the frame landed (the TTL's key). */
  at: number;
}

/** Longest a wait may linger without a follow-up frame (the typing TTL). */
export const AGENT_WAIT_TTL_MS = 150_000;

/** Fold one frame into the thread → wait map (a new map when it changes).
 *  A guest's thread is the frame's own `dm:` channel. */
export function applyAgentWait(prev: ReadonlyMap<string, AgentWait>, n: AgentWaitNotice, at: number): ReadonlyMap<string, AgentWait> {
  if (n.state === "idle" && !prev.has(n.channel)) return prev;
  const next = new Map(prev);
  if (n.state === "idle") next.delete(n.channel);
  else {
    const p = typeof n.position === "number" && n.position >= 1 ? Math.floor(n.position) : null;
    const was = prev.get(n.channel);
    const from = n.state === "queued" && p !== null ? Math.max(p, was?.state === "queued" ? (was.from ?? 0) : 0) : null;
    next.set(n.channel, { state: n.state, character: n.character, position: p, etaS: typeof n.etaS === "number" && n.etaS >= 0 ? Math.ceil(n.etaS) : null, from, at });
  }
  return next;
}

/** Live waits for a guest session: `waits.get(threadId)`. */
export function useAgentWait(on: boolean): { waits: ReadonlyMap<string, AgentWait>; onAgentWait: (n: AgentWaitNotice) => void } {
  const [waits, setWaits] = useState<ReadonlyMap<string, AgentWait>>(() => new Map());
  const onAgentWait = useCallback(
    (n: AgentWaitNotice) => {
      if (!on || n.public === true) return;
      const at = Date.now();
      setWaits((prev) => applyAgentWait(prev, n, at));
      if (n.state !== "idle") {
        window.setTimeout(() => setWaits((prev) => (prev.get(n.channel)?.at === at ? applyAgentWait(prev, { ...n, state: "idle" }, at) : prev)), AGENT_WAIT_TTL_MS);
      }
    },
    [on],
  );
  // A new session starts with nobody waiting.
  useEffect(() => setWaits(new Map()), [on]);
  return { waits, onAgentWait };
}
