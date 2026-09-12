//! Pure helpers behind the Codex + People surfaces and the alert chime:
//! private-thread ids between two participants (mirror of the server's
//! `Sim.pmChannel`), the `?unlock=` deep link a wall QR carries, grouping a
//! codex by subject, and spotting freshly-arrived alert broadcasts. No
//! React, no storage — unit-tested in `test/codex.test.ts`.

import type { ChatMessage, CodexEntry } from "./types.ts";

/** The private thread between two participants — one id whoever opens it. */
export function pmChannelId(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `pm:${x}:${y}`;
}

/** The other party of a `pm:` channel, from my point of view (null if not mine). */
export function pmOtherParty(channel: string, me: string): string | null {
  if (!channel.startsWith("pm:")) return null;
  const parties = channel.slice("pm:".length).split(":");
  if (parties.length !== 2 || !parties.includes(me)) return null;
  return parties[0] === me ? parties[1]! : parties[0]!;
}

/** The unlock code riding a scanned QR's link (`?code=…&unlock=…`). */
export function unlockFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("unlock");
    return v !== null && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

/** `search` without its `unlock` param (so a reload doesn't redeem twice). */
export function withoutUnlock(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("unlock");
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

export interface CodexGroup {
  /** The subject (`about:`), or "" for unattributed lore. */
  about: string;
  entries: CodexEntry[];
}

/** Group entries by their subject, in first-seen order. */
export function groupCodex(entries: readonly CodexEntry[]): CodexGroup[] {
  const out: CodexGroup[] = [];
  for (const e of entries) {
    const about = e.about ?? "";
    let g = out.find((x) => x.about === about);
    if (g === undefined) {
      g = { about, entries: [] };
      out.push(g);
    }
    g.entries.push(e);
  }
  return out;
}

/** Alert broadcasts newer than `sinceSeq`, oldest first. */
export function pickAlerts(messages: Iterable<ChatMessage>, sinceSeq: number): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) if (m.alert === true && m.seq > sinceSeq && !m.hidden) out.push(m);
  return out.sort((a, b) => a.seq - b.seq);
}

/** The highest seq in a message list (−1 when empty). */
export function maxSeqOf(messages: Iterable<ChatMessage>): number {
  let max = -1;
  for (const m of messages) if (m.seq > max) max = m.seq;
  return max;
}

/**
 * A short two-tone chime, synthesised (no asset, no network). Browsers
 * only let audio start after a user gesture, so this may be silent on a
 * phone that has never been tapped — the banner + vibration still land.
 */
export function playChime(): void {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tone = (freq: number, at: number, dur: number): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur + 0.05);
    };
    tone(880, 0, 0.18);
    tone(1320, 0.2, 0.28);
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* no audio — fine */
  }
}

/** Buzz the phone, where the browser allows it. */
export function vibrate(): void {
  try {
    navigator.vibrate?.([180, 80, 180]);
  } catch {
    /* unsupported */
  }
}
