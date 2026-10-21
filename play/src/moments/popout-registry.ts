//! The booth pop-outs' doorway (wave 18, the moments lane): the few lines
//! the moments engine (eager, in every bundle) needs to hand a booth message
//! to the pop-out store — which lives in `popout.tsx`, the booth's chunk,
//! so the guest app's first load never carries it. The store registers
//! itself here when its module loads; anything offered before that waits.
//!
//! `raisePopOut` / `retirePopOut` are the free functions of BOOTH-SPEC §2.1:
//! they reach the store of the booth that mounted last (`usePopOuts().raise`
//! names its own sign-in — use that inside Run → Players).

import type { MomentMessage } from "./model.ts";
import type { PopOutSpec, PopOutVerdict } from "./popout-model.ts";

/** What the store does with a booth message the adapter answered for. */
export interface PopOfferCtx {
  openCard?: (guestId: string) => void;
  openRoom?: (room: string) => void;
}

/** The store, as the registry sees it (`popout.tsx` implements it). */
export interface PopSink {
  offer(session: string, m: MomentMessage, verdict: Exclude<PopOutVerdict, null>, ctx: PopOfferCtx): void;
  raise(session: string | null, spec: PopOutSpec): void;
  retire(session: string | null, key: string): void;
}

type Pending =
  | { kind: "offer"; session: string; m: MomentMessage; verdict: Exclude<PopOutVerdict, null>; ctx: PopOfferCtx }
  | { kind: "raise"; session: string | null; spec: PopOutSpec }
  | { kind: "retire"; session: string | null; key: string };

let sink: PopSink | null = null;
const pending: Pending[] = [];
const PENDING_MAX = 100;

function flush(s: PopSink, p: Pending): void {
  if (p.kind === "offer") s.offer(p.session, p.m, p.verdict, p.ctx);
  else if (p.kind === "raise") s.raise(p.session, p.spec);
  else s.retire(p.session, p.key);
}

function send(p: Pending): void {
  if (sink !== null) flush(sink, p);
  else if (pending.length < PENDING_MAX) pending.push(p);
}

/** The store registers (null unregisters — a test seam); what waited is handed over. */
export function registerPopSink(s: PopSink | null): void {
  sink = s;
  if (s === null) return;
  while (pending.length > 0) flush(s, pending.shift()!);
}

/** The engine: a booth message the adapter turned into a pop-out (a spec, or "default"). */
export function offerPopOut(session: string, m: MomentMessage, verdict: Exclude<PopOutVerdict, null>, ctx: PopOfferCtx): void {
  send({ kind: "offer", session, m, verdict, ctx });
}

/** Raise a pop-out (idempotent by key: an existing key updates in place). Call from effects. */
export function raisePopOut(spec: PopOutSpec): void {
  send({ kind: "raise", session: null, spec });
}

/** Moot a pop-out: off the screen, the queue and the tray; marked handled. */
export function retirePopOut(key: string): void {
  send({ kind: "retire", session: null, key });
}

/** Does a booth message go to the pop-out adapter: a big moment, or a `!` readout about a guest. */
export function popOutCandidate(m: Pick<MomentMessage, "alert" | "readout" | "about">, severity: string | null): boolean {
  if (severity === "big") return true;
  return m.alert === true && m.readout === true && typeof m.about === "string" && m.about !== "";
}
