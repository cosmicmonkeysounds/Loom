//! The house announcements through the terminals (OCT31 N-09, decision #20:
//! "Alexa speaks through the terminals and the room audio"). The story's
//! `do announce "Go to the living room."` already reaches the house
//! speakers (stagehand `show` → MQTT `show/announce` → the `alexa` player
//! on the house Mac, K-20). The screen poll (`/api/screen/state`, every
//! 2 s) carries the latest one too — `announce: {seq, text, at}` — and a
//! terminal whose config says `announce` rings a short chime and says it in
//! the device's own voice, with the words on a banner.
//!
//! Off by default (provision with `&announce=1`, or tick it in ⚙): most
//! tablets hang within earshot of the house speakers, and the TV's room
//! hears them for sure. The rules (`planAnnounce`, pure):
//!
//! - never an announcement that was already current when the page loaded
//!   (the first answer only sets the cursor), nor replayed history (`at`
//!   0: a rebooted server), nor one older than `ANNOUNCE_STALE_MS` (a
//!   tablet that was offline catches up silently);
//! - a seq below the cursor means the story restarted: resync, say nothing;
//! - the voice waits its turn on the page's `VoiceFloor`, so a pilot's
//!   character is never cut mid-line — the announcement follows the line
//!   being said, and the character's next line follows the announcement.

import { useEffect, useMemo, useRef, useState } from "react";
import type { TerminalConfig } from "./config.ts";
import type { ScreenState } from "./screen.ts";
import { DeviceEngine, SpeechQueue, audioContext, type VoiceChoice } from "./speech/engine.ts";
import { ANNOUNCE_VOICE } from "./speech/pick-voice.ts";
import { splitSentences } from "./speech/split.ts";

/** The latest announcement, as the screen poll carries it. */
export interface Announcement {
  seq: number;
  text: string;
  /** Server epoch ms it was announced; 0 = replayed history. */
  at: number;
}

/** An announcement older than this (by the server's clock) is not said. */
export const ANNOUNCE_STALE_MS = 30_000;
/** The banner stays up this long after the voice is done (ms). */
export const ANNOUNCE_LINGER_MS = 5000;

/** An announcement off the wire; anything malformed is null. */
export function announceOf(raw: unknown): Announcement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["seq"] !== "number" || !Number.isFinite(r["seq"]) || typeof r["text"] !== "string" || r["text"].trim() === "") return null;
  const at = typeof r["at"] === "number" && Number.isFinite(r["at"]) ? r["at"] : 0;
  return { seq: r["seq"], text: r["text"].trim(), at };
}

/**
 * What to do with one poll's announcement. `cursor` is the last seq this
 * page has handled (null = no answer yet); `now` is the server's clock
 * (`ScreenState.now`). Returns the new cursor and the announcement to say.
 */
export function planAnnounce(cursor: number | null, a: Announcement | null, now: number): { cursor: number; say: Announcement | null } {
  // The story has announced nothing (yet, or since a restart).
  if (a === null) return { cursor: 0, say: null };
  // The first answer: whatever is current was said before this page loaded.
  if (cursor === null || a.seq < cursor) return { cursor: a.seq, say: null };
  if (a.seq === cursor) return { cursor, say: null };
  const fresh = a.at > 0 && now - a.at <= ANNOUNCE_STALE_MS;
  return { cursor: a.seq, say: fresh ? a : null };
}

/** Does this screen say announcements out loud right now? (The TV's
 *  director mute holds for announcements too.) */
export function announceAloud(config: Pick<TerminalConfig, "announce" | "view">, state: Pick<ScreenState, "voice"> | null): boolean {
  if (!config.announce) return false;
  return !(config.view === "tv" && state?.voice?.muted === true);
}

/** The native engine an announcement uses: the device's ladder, honouring a
 *  Fully-first choice (a `silent` or `server` terminal still *says* an
 *  announcement it was set to say — in its own voice). */
export function announceChoice(choice: VoiceChoice): Exclude<VoiceChoice, "server"> {
  return choice === "fully" ? "fully" : "browser";
}

/** The "Alexa" earcon, synthesised like the house Mac's (`stagehand/alexa`):
 *  two soft bell tones rising a fifth. Resolves when it has rung (at once
 *  when sound isn't unlocked yet). */
export function ringChime(): Promise<void> {
  const c = audioContext();
  if (c === null || c.state !== "running") return Promise.resolve();
  const start = c.currentTime + 0.02;
  let t = start;
  for (const [freq, dur] of [
    [660, 0.16],
    [990, 0.38],
  ] as const) {
    for (const [mult, gain] of [
      [1, 0.3],
      [2, 0.075],
    ] as const) {
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.frequency.value = freq * mult;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(env);
      env.connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    t += dur;
  }
  const ms = (t - start + 0.12) * 1000;
  return new Promise((r) => window.setTimeout(r, ms));
}

/**
 * Watch the screen poll for announcements and say the new ones (when the
 * config enables it). Returns the text on the banner (null = none).
 */
export function useAnnouncements(config: TerminalConfig | null, state: ScreenState | null): string | null {
  const [banner, setBanner] = useState<string | null>(null);
  const cursor = useRef<number | null>(null);
  const linger = useRef(0);
  const enabled = config?.announce === true;
  const choice = config?.engine ?? "browser";
  const speed = config?.speed ?? 1;

  const queue = useMemo(() => {
    if (!enabled) return null;
    // Never the character's voice (the one picked in ⚙ is Trabolta's): the
    // device's best female-first voice, like the house Mac's announcements.
    const engine = new DeviceEngine({ voice: "", speed, choice: announceChoice(choice), prefer: ANNOUNCE_VOICE });
    return new SpeechQueue(
      { primary: engine, fallback: null },
      {
        level: () => {},
        chunk: () => {},
        done: () => {
          window.clearTimeout(linger.current);
          linger.current = window.setTimeout(() => setBanner(null), ANNOUNCE_LINGER_MS);
        },
        idle: () => {},
      },
    );
  }, [enabled, choice, speed]);
  useEffect(() => () => queue?.stop(), [queue]);
  useEffect(() => () => window.clearTimeout(linger.current), []);
  // A new config (another event) starts over: no backlog.
  useEffect(() => {
    cursor.current = null;
  }, [config?.eventId]);

  useEffect(() => {
    if (state === null) return;
    const plan = planAnnounce(cursor.current, state.announce, state.now);
    cursor.current = plan.cursor;
    if (plan.say === null || queue === null || config === null) return;
    window.clearTimeout(linger.current);
    setBanner(plan.say.text);
    if (!announceAloud(config, state)) {
      linger.current = window.setTimeout(() => setBanner(null), ANNOUNCE_LINGER_MS + 4000);
      return;
    }
    const chunks = splitSentences(plan.say.text);
    if (chunks.length === 0) return;
    queue.say({ id: plan.say.seq, chunks, before: ringChime });
  }, [state, queue, config]);

  return banner;
}
