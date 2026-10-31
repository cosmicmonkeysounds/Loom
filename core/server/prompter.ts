//! The shared teleprompter (wave 59, `docs/loom-w59-prompter-contract.md`).
//!
//! A beat marked `aloud:` lands whole, as it always has: every line is in the
//! chat at once, its cues and branches done. What this holds back is only the
//! **voice**: `heldFrom` is the first line the TV must not say yet, and the
//! screen poll stops there (`voiceLinesOf`), so he waits for the script.
//!
//! One scene is what one commit lands of a marked beat, its sections in order.
//! It has one position, in **words from its start** (a phone turns it into
//! pixels at its own size), and the server moves it: `pos` at `at`, then `rate`
//! words a second up to `stop`. A press locks it to whoever pressed. When it
//! reaches one of his lines, the run from there to the next person's line goes
//! to the TV, the prompter locks and scrolls through it for everyone, and it
//! frees when the TV has said it, or after a time from the words if the TV is
//! dead or muted.
//!
//! Memory only, on purpose: nothing here is journaled and a restart forgets
//! it, so the rest of the lines just play. **The night never hangs:** with no
//! reader's phone on the prompter (`here`) there is no hold, a phone that never
//! reports (an old build, a sim bot) gets `HOLD_WAIT_MS` and no more, and one
//! that goes away frees the hold after `HERE_TTL_MS`. Pure but for the injected
//! clock and outlets: the runtime calls `tick` on a timer and on every poll.

import type { PrompterStatus } from "../src/host-board.ts";
import type { ChatMessage } from "./chat.ts";

export type { PrompterStatus };

/** A beat this old has no reader on the way: the voice goes on as it always did. */
export const HOLD_WAIT_MS = 8_000;
/** A phone showing the script reports this often (`here`). */
export const HERE_EVERY_MS = 4_000;
/** A phone silent this long has left the prompter. */
export const HERE_TTL_MS = 12_000;
/** A finger that stopped reporting (a dead phone) lets go after this long. */
export const HOLDER_TTL_MS = 4_000;
/** The prompter's autoscroll at speed 1, words a minute (`BASE_WPM` on the phone). */
export const PROMPTER_WPM = 130;
export const SPEED_MIN = 0.4;
export const SPEED_MAX = 2.5;
/** His pace, for the time a line takes: the TV at 0.92 with a browser voice. */
const HIS_WORDS_A_SECOND = 2.5;
/** The queue's pauses (`CHUNK_GAP_MS`, `LINE_GAP_MS` on the terminal). */
const SENTENCE_GAP_MS = 300;
const LINE_GAP_MS = 700;
/** A live TV that says a line this much faster than the words allow was muted or skipped it. */
const SOONEST_SHARE = 0.5;
/** A live TV still talking past the time the words allow gets this much longer. */
const OVERRUN_MS = 6_000;
const OVERRUN_SHARE = 0.6;
/** While it autoscrolls, a frame this often keeps the phones honest. */
const RESYNC_MS = 2_000;

const wordsIn = (text: string): number => Math.max(1, text.split(/\s+/u).filter(Boolean).length);

/** About how long he takes to say `text`, in ms. */
export function spokenMs(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?…]+(\s|$)/gu) ?? []).length);
  return (wordsIn(text) / HIS_WORDS_A_SECOND) * 1000 + sentences * SENTENCE_GAP_MS + LINE_GAP_MS;
}

export interface PrompterLine {
  seq: number;
  /** Story clock (ms). */
  ts: number;
  /** Who says it, as the chat shows it; "" for a stage direction or a reader's narration. */
  speaker: string;
  text: string;
  manner: string | null;
  /** Who it belongs to: a reader or a line's owner (`@<Character>`, a guest id). "": nobody. */
  who: string;
  /** His: the TV says it. */
  his: boolean;
}

export interface PrompterSection {
  title: string;
  lines: PrompterLine[];
}

/** What a scene is, before it is live (`sceneOf`). */
export interface SceneDraft {
  id: number;
  channel: string;
  sections: PrompterSection[];
  /** The `aloud:` readers. */
  readers: string[];
  /** Everyone else with a line. */
  owners: string[];
  /** His lines outside the script, each with the scene line it follows. */
  after: Array<{ seq: number; text: string }>;
}

export interface SceneContext {
  /** Is this speaker voiced by a screen (`mind: external`)? */
  voiced(from: string): boolean;
  /** Whose is a line of `from`? `@<Character>`, a guest id, or null. */
  ownerOf(from: string): string | null;
}

/**
 * The scene in a batch of new messages, or null. A section is one run of a
 * beat, as the phone builds them (`scriptOf`); one where no reader says
 * anything (a ceremony he hosted) is left out, so his lines there just play.
 */
export function sceneOf(messages: readonly ChatMessage[], ctx: SceneContext): SceneDraft | null {
  const marked = messages.filter((m) => m.aloud !== undefined && m.hidden !== true);
  const runs: ChatMessage[][] = [];
  let beat: string | null | undefined;
  let ts = -1;
  for (const m of marked) {
    if (m.beat !== beat || m.ts !== ts || runs.length === 0) runs.push([]);
    beat = m.beat;
    ts = m.ts;
    runs[runs.length - 1]!.push(m);
  }
  const kept = runs.filter((r) => r.some((m) => m.aloud?.reader !== undefined));
  if (kept.length === 0) return null;
  const readers = new Set<string>();
  const owners = new Set<string>();
  const sections = kept.map((r): PrompterSection => {
    for (const m of r) for (const who of m.aloud?.readers ?? []) readers.add(who);
    return {
      title: r[0]!.beat ?? "",
      lines: r.map((m) => {
        const his = m.kind === "line" && ctx.voiced(m.from);
        const owner = his || m.kind !== "line" ? null : ctx.ownerOf(m.from);
        const who = m.aloud?.reader ?? owner ?? "";
        if (who !== "" && m.aloud?.reader === undefined) owners.add(who);
        return { seq: m.seq, ts: m.ts, speaker: m.kind === "narration" ? "" : m.from, text: m.text, manner: m.manner ?? null, who, his };
      }),
    };
  });
  for (const r of readers) owners.delete(r);
  const lines = sections.flatMap((s) => s.lines);
  const inScript = new Set(lines.map((l) => l.seq));
  const first = lines[0]!;
  const channel = kept[0]![0]!.channel;
  const after = messages
    .filter((m) => m.seq > first.seq && !inScript.has(m.seq) && m.channel === channel && m.kind === "line" && m.hidden !== true && ctx.voiced(m.from))
    .map((m) => ({ seq: m.seq, text: m.text }));
  // Never 0, which a phone reads as no scene: a fresh run's first line is seq 0.
  return { id: first.seq + 1, channel, sections, readers: [...readers], owners: [...owners], after };
}

/** One press of the prompter, as a phone sends it. */
export type PrompterOp =
  | { op: "here"; open: boolean }
  | { op: "press"; pos?: number }
  | { op: "move"; pos: number }
  | { op: "letgo"; pos?: number }
  | { op: "jump"; pos: number }
  | { op: "play"; on: boolean; speed: number }
  | { op: "done" };

/** Reads a phone's body; null: it isn't one. */
export function readPrompterOp(body: Readonly<Record<string, unknown>>): PrompterOp | null {
  const pos = typeof body["pos"] === "number" && Number.isFinite(body["pos"]) ? (body["pos"] as number) : undefined;
  switch (body["op"]) {
    case "here":
      return { op: "here", open: body["open"] === true };
    case "press":
      return pos !== undefined ? { op: "press", pos } : { op: "press" };
    case "letgo":
      return pos !== undefined ? { op: "letgo", pos } : { op: "letgo" };
    case "move":
    case "jump":
      return pos !== undefined ? { op: body["op"], pos } : null;
    case "play": {
      const speed = body["speed"];
      return typeof speed === "number" && Number.isFinite(speed) ? { op: "play", on: body["on"] === true, speed } : null;
    }
    case "done":
      return { op: "done" };
    default:
      return null;
  }
}

/** The scene's script on a frame (once per member, not with every move). */
export interface PrompterScript {
  sections: PrompterSection[];
  readers: string[];
  owners: string[];
}

/** The `prompter` stream frame. `pos` was true when the frame was sent: a phone
 *  adds `rate` a second from its arrival, up to `stop`. */
export interface PrompterFrame {
  id: number;
  rev: number;
  pos: number;
  rate: number;
  stop: number;
  total: number;
  playing: boolean;
  speed: number;
  /** Who is pressing it. */
  holder: { who: string; name: string } | null;
  /** His lines are saying (locked, scrolling). */
  speaking: { name: string; seq: number } | null;
  /** His next line is waiting for the script. */
  held: boolean;
  /** The scene is over: ✓ Done, or a newer one took over (`superseded`). */
  done?: true;
  superseded?: true;
  script?: PrompterScript;
}

export type PrompterRefusal = "no scene" | "not in the scene" | "locked";

/** What the TV in the scene's room is doing. */
export interface RoomVoice {
  /** A terminal speaks the room and reports. */
  live: boolean;
  muted: boolean;
  /** Every room line at or before this is finished (the slowest terminal). */
  said: number;
  /** The line it is saying now. */
  speaking: number | null;
}

export interface PrompterDeps {
  now(): number;
  /** To everyone in the scene: its members, every host, every director. */
  send(frame: PrompterFrame, members: ReadonlySet<string>): void;
  voice(channel: string): RoomVoice;
  /** Does `who` hold an open stream? */
  online(who: string): boolean;
  /** Someone's name for the "has it" line. */
  name(who: string): string;
  /** A hold or the scene changed: the host and director views are stale. */
  changed(): void;
}

interface Run {
  from: number;
  to: number;
  /** The first line that says it, and the last, at the TV. */
  firstSeq: number;
  endSeq: number;
  ms: number;
  /** Where the hold moves to once this run has gone. */
  next: number | null;
}

interface Live {
  draft: SceneDraft;
  lines: PrompterLine[];
  off: number[];
  total: number;
  runs: Array<Run & { seq: number }>;
  next: number;
  members: Set<string>;
  hold: "wait" | "on" | "off";
  waitUntil: number;
  here: Map<string, { at: number; open: boolean }>;
  pos: number;
  at: number;
  rate: number;
  stop: number;
  playing: boolean;
  speed: number;
  holder: { who: string; at: number } | null;
  speaking: { run: Run; at: number; until: number; started: boolean } | null;
  rev: number;
  sentAt: number;
}

const clampSpeed = (n: number): number => Math.min(SPEED_MAX, Math.max(SPEED_MIN, n));
const rateOf = (speed: number): number => (speed * PROMPTER_WPM) / 60;

/** The hold points of a script: each run of his lines, up to the next line with
 *  someone to say it (a stage direction between two of his lines is in the
 *  run: nobody is reading it out, so nothing would ever move past it). */
function runsOf(draft: SceneDraft, lines: readonly PrompterLine[], off: readonly number[], total: number): Array<Run & { seq: number }> {
  const out: Array<Run & { seq: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.his) continue;
    let j = i;
    while (j + 1 < lines.length && (lines[j + 1]!.his || lines[j + 1]!.who === "")) j++;
    const said = lines.slice(i, j + 1).filter((l) => l.his);
    const nextSeq = lines[j + 1]?.seq ?? Infinity;
    const rest = draft.after.filter((m) => m.seq > lines[i]!.seq && m.seq < nextSeq);
    const ms = [...said, ...rest].reduce((n, l) => n + spokenMs(l.text), 0);
    const endSeq = Math.max(...said.map((l) => l.seq), ...rest.map((m) => m.seq));
    out.push({ seq: lines[i]!.seq, from: off[i]!, to: off[j + 1] ?? total, firstSeq: lines[i]!.seq, endSeq, ms, next: null });
    i = j;
  }
  out.forEach((r, k) => {
    r.next = out[k + 1]?.seq ?? null;
  });
  return out;
}

export class Prompters {
  private live: Live | null = null;
  private readonly deps: PrompterDeps;
  constructor(deps: PrompterDeps) {
    this.deps = deps;
  }

  /** A batch of new lines: a scene in it goes live, over any older one. */
  land(draft: SceneDraft | null): void {
    if (draft === null) return;
    const now = this.deps.now();
    if (this.live !== null) this.close(true);
    const lines = draft.sections.flatMap((s) => s.lines);
    const off: number[] = [];
    let total = 0;
    for (const l of lines) {
      off.push(total);
      total += wordsIn(l.text);
    }
    const runs = runsOf(draft, lines, off, total);
    const anyone = draft.readers.some((r) => this.deps.online(r));
    const s: Live = {
      draft,
      lines,
      off,
      total,
      runs,
      next: 0,
      members: new Set([...draft.readers, ...draft.owners]),
      hold: runs.length > 0 && anyone ? "wait" : "off",
      waitUntil: now + HOLD_WAIT_MS,
      here: new Map(),
      pos: 0,
      at: now,
      rate: 0,
      stop: total,
      playing: false,
      speed: 1,
      holder: null,
      speaking: null,
      rev: 0,
      sentAt: 0,
    };
    this.live = s;
    s.stop = this.stopOf(s);
    this.emit(s, true);
    this.deps.changed();
  }

  /** The first room line the voice must leave for now, or null. */
  heldFrom(channel: string): number | null {
    const s = this.live;
    if (s === null || s.draft.channel !== channel || s.hold === "off") return null;
    return s.runs[s.next]?.seq ?? null;
  }

  /** The scene as a new stream needs it, or null with none on. */
  frame(who: string | null): PrompterFrame | null {
    const s = this.live;
    if (s === null || (who !== null && !s.members.has(who))) return null;
    return this.frameOf(s, this.deps.now(), true);
  }

  status(): PrompterStatus | null {
    const s = this.live;
    if (s === null) return null;
    const pos = this.posAt(s, this.deps.now());
    let line = 0;
    for (let i = 0; i < s.off.length && s.off[i]! <= pos; i++) line = i;
    return {
      id: s.draft.id,
      title: s.draft.sections[0]?.title ?? "",
      readers: s.draft.readers.map((r) => this.deps.name(r)),
      line: line + 1,
      lines: s.lines.length,
      held: this.isHeld(s),
      speaking: s.speaking !== null,
      holder: s.holder !== null ? this.deps.name(s.holder.who) : null,
    };
  }

  /** ▶ from a host, a director or Run: every line of his left plays, in
   *  order. The prompter carries on with no holds. Null: nothing was held. */
  release(): boolean {
    const s = this.live;
    if (s === null || s.hold === "off" || this.heldFrom(s.draft.channel) === null) return false;
    this.free(s);
    return true;
  }

  /** ✓ Done from anyone in the scene (or a director). */
  done(): boolean {
    if (this.live === null) return false;
    this.close(false);
    return true;
  }

  /** A restart, a reload, a new run: the scene is gone and nothing waits. */
  clear(): void {
    this.live = null;
  }

  get active(): boolean {
    return this.live !== null;
  }

  /**
   * A phone's press. `host` is anyone who may join without a line: a host or a
   * director. Returns the refusal, or null when it was taken.
   */
  op(id: number, who: string, host: boolean, o: PrompterOp): PrompterRefusal | null {
    const s = this.live;
    if (s === null || s.draft.id !== id) return "no scene";
    if (!s.members.has(who) && !host) return "not in the scene";
    const now = this.deps.now();
    if (host) s.members.add(who);
    switch (o.op) {
      case "here":
        s.here.set(who, { at: now, open: o.open });
        if (s.hold === "wait") {
          s.hold = "on";
          this.deps.changed();
        }
        this.tick();
        return null;
      case "press": {
        if (this.locked(s, who, now)) return "locked";
        this.sync(s, now, o.pos);
        s.holder = { who, at: now };
        s.rate = 0;
        break;
      }
      case "move": {
        if (s.holder?.who !== who) return this.locked(s, who, now) ? "locked" : null;
        s.holder.at = now;
        this.sync(s, now, o.pos);
        break;
      }
      case "letgo": {
        if (s.holder?.who !== who) return null;
        this.sync(s, now, o.pos);
        s.holder = null;
        s.rate = s.playing ? rateOf(s.speed) : 0;
        break;
      }
      case "jump": {
        if (this.locked(s, who, now)) return "locked";
        this.sync(s, now, o.pos);
        break;
      }
      case "play": {
        if (s.speaking !== null) return "locked";
        if (s.holder !== null && s.holder.who !== who) return "locked";
        this.sync(s, now);
        s.playing = o.on;
        s.speed = clampSpeed(o.speed);
        s.rate = o.on && s.holder === null ? rateOf(s.speed) : 0;
        break;
      }
      case "done": {
        // Someone through with their own line leaves the rest to it: only the
        // last reader, or a host, ends the scene for everyone.
        s.here.delete(who);
        const others = s.draft.readers.some((r) => r !== who && now - (s.here.get(r)?.at ?? -Infinity) <= HERE_TTL_MS);
        if (!s.draft.owners.includes(who) && !(s.draft.readers.includes(who) && others)) this.close(false);
        return null;
      }
    }
    s.stop = this.stopOf(s);
    if (!this.step(s, now)) this.emit(s);
    return null;
  }

  /** The timer, and every poll that names a room: holds time out, the
   *  autoscroll reaches his line, his line ends. */
  tick(): void {
    const s = this.live;
    if (s === null) return;
    const now = this.deps.now();
    if (s.holder !== null && now - s.holder.at > HOLDER_TTL_MS) {
      this.sync(s, now);
      s.holder = null;
      s.rate = s.playing ? rateOf(s.speed) : 0;
      s.stop = this.stopOf(s);
      this.emit(s);
    }
    if (s.hold === "wait" && now >= s.waitUntil) this.free(s);
    if (s.hold === "on") {
      const here = [...s.here].some(([who, h]) => now - h.at <= HERE_TTL_MS && (s.draft.readers.includes(who) || h.open));
      if (!here) this.free(s);
    }
    if (this.step(s, now)) return;
    // The autoscroll ran out of script.
    if (s.rate > 0 && s.speaking === null && this.posAt(s, now) >= s.total) {
      this.sync(s, now);
      s.rate = 0;
      s.playing = false;
      this.emit(s);
    } else if (s.rate > 0 && now - s.sentAt >= RESYNC_MS) this.emit(s);
  }

  private isHeld(s: Live): boolean {
    return s.hold !== "off" && s.next < s.runs.length;
  }

  private locked(s: Live, who: string, now: number): boolean {
    return s.speaking !== null || (s.holder !== null && s.holder.who !== who && now - s.holder.at <= HOLDER_TTL_MS);
  }

  private posAt(s: Live, now: number): number {
    const moved = s.pos + (s.rate * Math.max(0, now - s.at)) / 1000;
    return Math.min(s.stop, moved);
  }

  /** The word it may not pass: his next line, unsaid. */
  private stopOf(s: Live): number {
    if (s.speaking !== null) return s.speaking.run.to;
    return this.isHeld(s) ? s.runs[s.next]!.from : s.total;
  }

  private sync(s: Live, now: number, pos?: number): void {
    const want = pos ?? this.posAt(s, now);
    s.pos = Math.min(this.stopOf(s), Math.max(0, want));
    s.at = now;
  }

  /** His lines start, or his lines end. True: a frame went out. */
  private step(s: Live, now: number): boolean {
    const v = s.speaking;
    if (v !== null) {
      const t = this.deps.voice(s.draft.channel);
      // The TV started the run late (the poll, its queue's gap): the time
      // runs from the moment he opens his mouth. Never a step back on screen.
      if (!v.started && t.live && t.speaking !== null && t.speaking >= v.run.firstSeq) {
        v.started = true;
        v.at = now;
        v.until = now + v.run.ms;
        this.sync(s, now);
        s.rate = ((v.run.to - s.pos) / v.run.ms) * 1000;
        this.emit(s);
      }
      if (!this.spoken(v, t, now)) return false;
      s.pos = v.run.to;
      s.at = now;
      s.speaking = null;
      s.rate = s.playing && s.holder === null ? rateOf(s.speed) : 0;
      s.stop = this.stopOf(s);
      this.emit(s);
      this.deps.changed();
      return true;
    }
    if (!this.isHeld(s) || this.posAt(s, now) < s.runs[s.next]!.from) return false;
    const run = s.runs[s.next]!;
    s.next += 1;
    s.holder = null;
    s.pos = run.from;
    s.at = now;
    s.speaking = { run, at: now, until: now + run.ms, started: false };
    s.rate = ((run.to - run.from) / run.ms) * 1000;
    s.stop = run.to;
    this.emit(s);
    this.deps.changed();
    return true;
  }

  private spoken(v: NonNullable<Live["speaking"]>, t: RoomVoice, now: number): boolean {
    if (!t.live || t.muted) return now >= v.until;
    if (t.said >= v.run.endSeq && now - v.at >= v.run.ms * SOONEST_SHARE) return true;
    return now >= v.until + Math.max(OVERRUN_MS, v.run.ms * OVERRUN_SHARE);
  }

  private free(s: Live): void {
    s.hold = "off";
    s.stop = this.stopOf(s);
    this.emit(s);
    this.deps.changed();
  }

  private close(superseded: boolean): void {
    const s = this.live;
    if (s === null) return;
    const frame = this.frameOf(s, this.deps.now(), false);
    this.live = null;
    this.deps.send({ ...frame, done: true, ...(superseded ? { superseded: true } : {}) }, s.members);
    this.deps.changed();
  }

  private emit(s: Live, script = false): void {
    s.rev += 1;
    const now = this.deps.now();
    s.sentAt = now;
    this.deps.send(this.frameOf(s, now, script), s.members);
  }

  private frameOf(s: Live, now: number, script: boolean): PrompterFrame {
    const spokenLine = s.speaking?.run.firstSeq;
    return {
      id: s.draft.id,
      rev: s.rev,
      pos: this.posAt(s, now),
      rate: s.rate,
      stop: s.stop,
      total: s.total,
      playing: s.playing,
      speed: s.speed,
      holder: s.holder !== null ? { who: s.holder.who, name: this.deps.name(s.holder.who) } : null,
      speaking: spokenLine !== undefined ? { name: s.lines.find((l) => l.seq === spokenLine)?.speaker ?? "", seq: spokenLine } : null,
      held: this.isHeld(s),
      ...(script ? { script: { sections: s.draft.sections, readers: s.draft.readers, owners: s.draft.owners } } : {}),
    };
  }
}
