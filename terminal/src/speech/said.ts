//! Speech done (wave 25, `docs/loom-house-desk.md` §5): what a terminal that
//! speaks a room's lines tells the house desk on every screen poll.
//!
//! - `talk=1|0` — is it saying a room line, or holding room lines it has yet
//!   to say?
//! - `said=<seq>` — the newest room-line seq it has finished: every line of
//!   the room at or before it is spoken, skipped or will never be spoken here
//!   (muted, a song beat, text only, another speaker, attract). Only the lines
//!   it will really speak hold it back.
//!
//! - `sp=<seq>:<chunk>` / `sp=<seq>:d` (wave 26, V1 phase 2; the TV only)
//!   — the room line it is speaking now and the sentence within it (from
//!   0), or `d` once that line is done. The server keeps the newest from a
//!   `view=tv` poller as the screen state's `tvSpeech`, so the walls can
//!   follow his voice.
//!
//! A desk `speech` step waits on these to know Trabolta has finished in a
//! room. `RoomSpeech` is the pure model (the App owns one, like the voice
//! cursor; the TV's and the room terminal's `LinePlayer` feed it), and
//! `PollPacer` is the poll's clock: when the queue drains (talk 1 → 0) the
//! terminal polls at once, at most once per `DRAIN_REPOLL_GAP_MS`, instead of
//! on the next 2 s tick.

/** The shortest gap between two poll starts that a drain may force (ms). */
export const DRAIN_REPOLL_GAP_MS = 500;

/** What a speaking terminal adds to its poll. `said` null: not known yet (left out). */
export interface SpeechReport {
  talk: boolean;
  said: number | null;
  /** (wave 26, V1 phase 2) The line being spoken now (`seq`) and its
   *  sentence (`chunk`, from 0), or `chunk: null` once that line is done.
   *  Absent / null: nothing to report (left out of the poll). */
  sp?: { seq: number; chunk: number | null } | null;
  /** (wave 49) The TV just started the sentence that names the Y2K bug. */
  bug?: boolean;
}

/** (wave 49) The sentence that sets off Clippy's dream. */
export const DREAM_BUG_LINE = /\bY2K BUG\b/u;
/** (wave 49) `bug=1` rides the polls this long (ms): a poll can fail, and a
 *  story restart must not find it still set. The server takes the first. */
export const DREAM_BUG_MS = 4000;

/** The poll's `talk` / `said` keys for a report (none for a terminal that doesn't speak). */
export function speechQuery(r: SpeechReport | null | undefined): Record<string, string> {
  if (r === null || r === undefined) return {};
  const q: Record<string, string> = { talk: r.talk ? "1" : "0" };
  if (r.said !== null && Number.isFinite(r.said)) q["said"] = String(Math.floor(r.said));
  const sp = r.sp;
  if (sp != null && Number.isFinite(sp.seq) && sp.seq >= 0) {
    const chunk = sp.chunk === null ? "d" : Number.isFinite(sp.chunk) && sp.chunk >= 0 ? String(Math.min(999, Math.floor(sp.chunk))) : null;
    if (chunk !== null) q["sp"] = `${Math.floor(sp.seq)}:${chunk}`;
  }
  if (r.bug === true) q["bug"] = "1";
  return q;
}

/**
 * The room-line speech of one terminal. A player `attach`es while it is
 * mounted; it tells the model which lines it will speak (`queued`), each one
 * it has finished (`finished`, in order) and when it drops the rest
 * (`cleared`: a mute, attract, an unmount). Every answer's room head comes
 * in through `heard`.
 */
export class RoomSpeech {
  /** Seqs queued to be spoken (or being spoken), oldest first. */
  private pending: number[] = [];
  private head: number | null = null;
  private speakers = 0;
  /** (wave 26, V1 phase 2) The line being said and its sentence (`chunk` null: done). */
  private sp: { seq: number; chunk: number | null } | null = null;
  private bugUntil = 0;
  private readonly drains = new Set<() => void>();

  /** A player is mounted to speak the room's lines; call the result when it goes. */
  attach(): () => void {
    this.speakers++;
    let gone = false;
    return () => {
      if (gone) return;
      gone = true;
      this.speakers = Math.max(0, this.speakers - 1);
      if (this.speakers === 0) this.cleared();
    };
  }

  /** The room's head seq off an answer's voice block. */
  heard(head: number): void {
    if (Number.isFinite(head)) this.head = head;
  }

  /** Lines the player will speak, oldest first (only the spoken ones). */
  queued(seqs: readonly number[]): void {
    for (const s of seqs) if (Number.isFinite(s)) this.pending.push(s);
  }

  /** The line `seq` is said (or was cut): it and everything queued before it are done. */
  finished(seq: number): void {
    const i = this.pending.indexOf(seq);
    if (i < 0) return;
    this.pending.splice(0, i + 1);
    if (this.pending.length === 0) this.drained();
  }

  /** (wave 26) The TV is saying sentence `chunk` of line `seq` (`sp=<seq>:<chunk>`). */
  speaking(seq: number, chunk: number): void {
    if (Number.isFinite(seq) && Number.isFinite(chunk)) this.sp = { seq, chunk };
  }

  /** (wave 26) Line `seq` is said (or cut): `sp=<seq>:d`. */
  spoke(seq: number): void {
    if (this.sp !== null && this.sp.seq === seq) this.sp = { seq, chunk: null };
  }

  /** The player dropped everything queued (a mute, attract, unmount). */
  cleared(): void {
    if (this.sp !== null) this.sp = { seq: this.sp.seq, chunk: null };
    if (this.pending.length === 0) return;
    this.pending = [];
    this.drained();
  }

  get talk(): boolean {
    return this.pending.length > 0;
  }

  /**
   * The report for the next poll. `cursor` is the voice cursor the poll sends
   * as `after` (every room line at or before it has been planned). With no
   * player mounted (the setup screen) nothing here will say the room's lines:
   * not talking, finished through the last head heard.
   */
  report(cursor: number | null, now: number = Date.now()): SpeechReport {
    const sp = { ...(this.sp === null ? {} : { sp: { ...this.sp } }), ...(now < this.bugUntil ? { bug: true } : {}) };
    if (this.speakers === 0) return { talk: false, said: this.head ?? cursor, ...sp };
    const through = cursor ?? this.head;
    if (this.pending.length === 0) return { talk: false, said: through, ...sp };
    const before = this.pending[0]! - 1;
    return { talk: true, said: through === null ? before : Math.min(through, before), ...sp };
  }

  /** (wave 49) The TV has started the sentence that names the Y2K bug. The
   *  poll goes now, not up to a second late: the walls have seconds to hear it. */
  namedBug(now: number = Date.now()): void {
    this.bugUntil = now + DREAM_BUG_MS;
    this.drained();
  }

  /** Called each time the queue drains (talk 1 → 0). Returns the unsubscribe. */
  onDrain(fn: () => void): () => void {
    this.drains.add(fn);
    return () => {
      this.drains.delete(fn);
    };
  }

  private drained(): void {
    for (const fn of Array.from(this.drains)) {
      try {
        fn();
      } catch {
        /* a listener never breaks the speech */
      }
    }
  }
}

/**
 * When the screen poll runs next. `start` / `done` bracket each poll (`done`
 * returns the delay to the next one); `kick` asks for one now — it returns
 * the delay to reschedule to, or null when nothing changes (a poll is in
 * flight: the next one follows it at once; or the poll is already due
 * sooner; or polling stopped). Two poll starts are never closer than `gap`.
 */
export class PollPacer {
  private inFlight = false;
  private kicked = false;
  private lastStart = Number.NEGATIVE_INFINITY;
  private dueAt: number | null = null;
  constructor(
    private readonly every: number,
    private readonly gap: number = DRAIN_REPOLL_GAP_MS,
  ) {}

  start(now: number): void {
    this.inFlight = true;
    this.kicked = false;
    this.lastStart = now;
    this.dueAt = null;
  }

  done(now: number): number {
    this.inFlight = false;
    const delay = this.kicked ? Math.max(0, this.lastStart + this.gap - now) : this.every;
    this.kicked = false;
    this.dueAt = now + delay;
    return delay;
  }

  /** Polling stopped (revoked, ended, unmounted): kicks do nothing. */
  stop(): void {
    this.inFlight = false;
    this.kicked = false;
    this.dueAt = null;
  }

  kick(now: number): number | null {
    if (this.inFlight) {
      this.kicked = true;
      return null;
    }
    if (this.dueAt === null) return null;
    const at = Math.max(now, this.lastStart + this.gap);
    if (at >= this.dueAt) return null;
    this.dueAt = at;
    return at - now;
  }
}
