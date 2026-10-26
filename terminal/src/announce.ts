//! The house announcements through the terminals (OCT31 N-09, decision #20:
//! the house speaks through the terminals and the room audio). The story's
//! `do announce "Go to the living room."` already reaches the house
//! speakers (stagehand `show` → MQTT `show/announce` → the announcement
//! player on the house Mac, stagehand's `alexa` module, K-20). The screen
//! poll (`/api/screen/state`, every 2 s) carries the last three too —
//! `announces: [{seq, text, at}]`, so two inside one poll are both said —
//! and a terminal whose config says `announce` rings a short chime and
//! says each in the device's own voice, with the words on a banner.
//!
//! Whether a tablet says them (wave 18b, Q8, `announceSetting`): its own ⚙
//! setting when it has one (Always / Never — `&announce=1|0`), else the
//! **house setting**: the house list in `audio.json` (`announce.terminals`,
//! map spot ids), which the screen poll answers as `spot.announce` — read
//! live, so a director's toggle reaches the tablet within a poll. Off when
//! neither says (most tablets hang within earshot of the house speakers,
//! and the TV's room hears them for sure). The rules (`planAnnounce`, pure):
//!
//! - never an announcement that was already current when the page loaded
//!   (the first answer only sets the cursor), nor replayed history (`at`
//!   0: a rebooted server), nor one older than `ANNOUNCE_STALE_MS` (a
//!   tablet that was offline catches up silently);
//! - a story restart (the state's `announceEpoch` changed, or — from an
//!   older server — a seq below the cursor) resyncs, and says only what was
//!   announced since (history is stamped 0, so a fresh one is new) — the
//!   restarted story numbers from 1 again, so the seqs alone can't tell;
//! - the voice waits its turn on the page's `VoiceFloor`, so a pilot's
//!   character is never cut mid-line — the announcement follows the line
//!   being said, and the character's next line follows the announcement.

import { useEffect, useMemo, useRef, useState } from "react";
import type { TerminalConfig } from "./config.ts";
import type { ScreenState } from "./screen.ts";
import { ANNOUNCE_GAPS, DeviceEngine, SpeechQueue, voiceFloor, type VoiceChoice } from "./speech/engine.ts";
import { playChime } from "./sound/bus.ts";
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
 * What to do with one poll's announcements (`announces`, oldest first).
 * `cursor` is the last seq this page has handled (null = no answer yet);
 * `now` is the server's clock (`ScreenState.now`); `restarted` = the
 * state's `announceEpoch` moved since the last answer. Returns the new
 * cursor and the announcements to say, in order.
 */
export function planAnnounce(cursor: number | null, list: readonly Announcement[], now: number, restarted = false): { cursor: number; say: Announcement[] } {
  // The story has announced nothing (yet, or since a restart).
  if (list.length === 0) return { cursor: 0, say: [] };
  const sorted = [...list].sort((a, b) => a.seq - b.seq);
  const head = sorted[sorted.length - 1]!.seq;
  // The first answer: whatever is current was said before this page loaded.
  if (cursor === null) return { cursor: head, say: [] };
  const fresh = (a: Announcement): boolean => a.at > 0 && now - a.at <= ANNOUNCE_STALE_MS;
  // A restart (or, from an older server, a head below the cursor): its
  // replayed history is at 0, so a fresh entry was announced since — say it.
  if (restarted || head < cursor) return { cursor: head, say: sorted.filter(fresh) };
  return { cursor: head, say: sorted.filter((a) => a.seq > cursor && fresh(a)) };
}

/** Did the announcements' sim change between two answers (`announceEpoch`;
 *  `prev` undefined = no answer yet, null = a server that doesn't say)? */
export function epochMoved(prev: string | null | undefined, next: string | null): boolean {
  return typeof prev === "string" && next !== null && next !== prev;
}

/** Does this screen say the house announcements (wave 18b, Q8)? Its own
 *  setting (true: Always, false: Never), else the house list's word for its
 *  spot (`spot.announce` off the poll), else no. */
export function announceSetting(config: Pick<TerminalConfig, "announce">, state: Pick<ScreenState, "spot"> | null): boolean {
  return config.announce ?? state?.spot?.announce ?? false;
}

/** What the poll reports as `ann` (wave 18b, Q8): its own setting, else the
 *  house list's word off the last answer (no `spot` there = not on it), else
 *  null — not yet known, so `ann` is left out rather than reported as no
 *  (a "House setting" tablet's first poll would turn its 📢 badge off). */
export function announceReport(config: Pick<TerminalConfig, "announce">, last: Pick<ScreenState, "spot"> | null): boolean | null {
  if (config.announce !== null) return config.announce;
  return last === null ? null : (last.spot?.announce ?? false);
}

/** Does this screen say announcements out loud right now? (The TV's
 *  director mute holds for announcements too.) */
export function announceAloud(config: Pick<TerminalConfig, "announce" | "view">, state: Pick<ScreenState, "voice" | "spot"> | null): boolean {
  if (!announceSetting(config, state)) return false;
  return !(config.view === "tv" && state?.voice?.muted === true);
}

/** The native engine an announcement uses: the device's ladder, honouring a
 *  Fully-first choice (a `silent` or `server` terminal still *says* an
 *  announcement it was set to say — in its own voice). */
export function announceChoice(choice: VoiceChoice): Exclude<VoiceChoice, "server"> {
  return choice === "fully" ? "fully" : "browser";
}

/** The house-announcement earcon, synthesised like the house Mac's (`stagehand/alexa`):
 *  two soft bell tones rising a fifth, on the sound bus's master (`sound/`).
 *  Resolves when it has rung (at once when sound isn't unlocked yet). It
 *  rings inside the voice floor its announcement holds, so no effect gate. */
export function ringChime(): Promise<void> {
  return playChime();
}

/**
 * Watch the screen poll for announcements and say the new ones (when the
 * config enables it). Returns the text on the banner (null = none).
 */
export function useAnnouncements(config: TerminalConfig | null, state: ScreenState | null): string | null {
  const [banner, setBanner] = useState<string | null>(null);
  const cursor = useRef<number | null>(null);
  /** The last answer's `announceEpoch` (undefined = no answer yet). */
  const epoch = useRef<string | null | undefined>(undefined);
  const linger = useRef(0);
  // Live: a house-setting tablet follows its spot's entry on every poll.
  const enabled = config !== null && announceSetting(config, state);
  const choice = config?.engine ?? "browser";
  const speed = config?.speed ?? 1;

  /** Each queued announcement's words, by seq: the banner follows the voice. */
  const texts = useRef(new Map<number, string>());

  const queue = useMemo(() => {
    if (!enabled) return null;
    // Never the character's voice (the one picked in ⚙ is Trabolta's): the
    // device's best female-first voice, like the house Mac's announcements.
    const engine = new DeviceEngine({ voice: "", speed, choice: announceChoice(choice), prefer: ANNOUNCE_VOICE });
    return new SpeechQueue(
      { primary: engine, fallback: null },
      {
        level: () => {},
        chunk: (id, index) => {
          const text = texts.current.get(id);
          if (index !== 0 || text === undefined) return;
          window.clearTimeout(linger.current);
          setBanner(text);
        },
        done: (id) => {
          texts.current.delete(id);
          window.clearTimeout(linger.current);
          linger.current = window.setTimeout(() => setBanner(null), ANNOUNCE_LINGER_MS);
        },
        idle: () => {},
      },
      voiceFloor,
      // Wave 26 (V2): a short pause between its sentences, none between two
      // announcements (the chime parts them).
      ANNOUNCE_GAPS,
    );
  }, [enabled, choice, speed]);
  useEffect(() => () => queue?.stop(), [queue]);
  useEffect(() => () => window.clearTimeout(linger.current), []);
  // A new config (another event) starts over: no backlog.
  useEffect(() => {
    cursor.current = null;
    epoch.current = undefined;
  }, [config?.eventId]);

  useEffect(() => {
    if (state === null) return;
    const restarted = epochMoved(epoch.current, state.announceEpoch);
    epoch.current = state.announceEpoch;
    const plan = planAnnounce(cursor.current, state.announces, state.now, restarted);
    cursor.current = plan.cursor;
    if (plan.say.length === 0 || queue === null || config === null) return;
    if (!announceAloud(config, state)) {
      window.clearTimeout(linger.current);
      setBanner(plan.say[plan.say.length - 1]!.text);
      linger.current = window.setTimeout(() => setBanner(null), ANNOUNCE_LINGER_MS + 4000);
      return;
    }
    // Banner the first now if the voice is free; each later one takes the
    // banner when its voice starts (`chunk`).
    if (!queue.busy) {
      window.clearTimeout(linger.current);
      setBanner(plan.say[0]!.text);
    }
    for (const a of plan.say) {
      const chunks = splitSentences(a.text);
      if (chunks.length === 0) continue;
      texts.current.set(a.seq, a.text);
      queue.say({ id: a.seq, chunks, before: ringChime });
    }
  }, [state, queue, config]);

  return banner;
}
