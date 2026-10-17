//! The TV's room voice (OCT31 K-18 + N-04b): which lines are spoken, which
//! are only captioned, the cursor (no backlog, resync after a restart), the
//! in-order player and the director's mute.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ScreenVoice, VoiceLine } from "../src/screen.ts";
import { LinePlayer, TV_SILENT_BEATS, TV_STALE_MS, cursorAfterGap, cursorWhileAsleep, isSilentBeat, planVoice, postVoiceMute, readingMs, type TvLine } from "../src/tv.ts";

const line = (seq: number, from = "Trabolta", beat: string | null = "Trabolta Introduction", text = `line ${seq}`): VoiceLine => ({ seq, from, text, beat });
const voice = (head: number, lines: VoiceLine[], muted = false): ScreenVoice => ({ room: "loc:The Desktop", muted, head, lines });
const opts = { character: "Trabolta", muted: false, attract: false };

describe("planVoice", () => {
  it("a screen that just booted starts at the head: no backlog", () => {
    expect(planVoice(voice(41, [line(40)]), null, opts)).toEqual({ cursor: 41, lines: [] });
  });

  it("speaks the character, captions Sandy, drops the rest; the cursor moves to the head", () => {
    const p = planVoice(voice(20, [line(11), line(12, "Clippy"), line(13, "Sandy", "Advice Helped"), line(14, "TRABOLTA", null)]), 10, opts);
    expect(p.cursor).toBe(20);
    expect(p.lines.map((l) => [l.seq, l.mode])).toEqual([
      [11, "speak"],
      [13, "text"],
      [14, "speak"], // a director's say as Trabolta: no beat, still his voice
    ]);
  });

  it("the song beats are captioned, never spoken (N-04b)", () => {
    expect(TV_SILENT_BEATS).toEqual(["Song Ending", "Sad Confession", "The Hand Jive"]);
    expect(isSilentBeat("song_ending")).toBe(true);
    expect(isSilentBeat("The Verdict")).toBe(false);
    expect(isSilentBeat(null)).toBe(false);
    const p = planVoice(voice(9, [line(5, "Trabolta", "Song Ending"), line(6, "Sandy", "Song Ending"), line(7, "Trabolta", "Sad Confession"), line(8, "Trabolta", "The Hand Jive"), line(9, "Trabolta", "Grok Prom")]), 4, opts);
    expect(p.lines.map((l) => l.mode)).toEqual(["song", "text", "song", "song", "speak"]);
  });

  it("muted: everything is text; attract: nothing at all, but the cursor still moves", () => {
    expect(planVoice(voice(3, [line(3)]), 2, { ...opts, muted: true }).lines.map((l) => l.mode)).toEqual(["muted"]);
    expect(planVoice(voice(3, [line(3)]), 2, { ...opts, attract: true })).toEqual({ cursor: 3, lines: [] });
  });

  it("never replays what it handled; a head behind the cursor is a restart → resync", () => {
    expect(planVoice(voice(12, [line(11), line(12)]), 11, opts).lines.map((l) => l.seq)).toEqual([12]);
    expect(planVoice(voice(5, [line(5)]), 300, opts)).toEqual({ cursor: 5, lines: [] });
  });
});

describe("cursorAfterGap", () => {
  it("keeps the cursor between steady answers, forgets it after the TV was away", () => {
    expect(cursorAfterGap(12, null, 5000)).toBe(12);
    expect(cursorAfterGap(12, 4000, 5000)).toBe(12);
    expect(cursorAfterGap(12, 4000, 4000 + TV_STALE_MS + 1)).toBeNull();
    // → planVoice then resyncs to the head: no backlog read out.
    expect(planVoice(voice(30, [line(20), line(30)]), cursorAfterGap(12, 0, 60_000), opts)).toEqual({ cursor: 30, lines: [] });
  });
});

describe("LinePlayer", () => {
  function rig() {
    const log: string[] = [];
    const speaking: Array<() => void> = [];
    const sleeping: Array<() => void> = [];
    const player = new LinePlayer({
      caption: (l) => log.push(`caption ${l === null ? "-" : l.seq}`),
      speak: (l) =>
        new Promise<void>((r) => {
          log.push(`speak ${l.seq}`);
          speaking.push(r);
        }),
      cancel: () => {
        log.push("cancel");
        for (const r of speaking.splice(0)) r();
      },
      sleep: (ms) =>
        new Promise<void>((r) => {
          log.push(`sleep ${ms}`);
          sleeping.push(r);
        }),
      idle: () => log.push("idle"),
    });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return { log, speaking, sleeping, player, tick };
  }
  const tv = (seq: number, mode: TvLine["mode"], text = "Hi."): TvLine => ({ seq, from: "Trabolta", text, beat: null, mode });

  it("plays strictly in order: speech waits, a text line waits its reading time", async () => {
    const { log, speaking, sleeping, player, tick } = rig();
    player.push([tv(1, "speak"), tv(2, "text", "I'm sorry, I didn't understand that."), tv(3, "speak")]);
    await tick();
    expect(log).toEqual(["caption 1", "speak 1"]);
    speaking.shift()!();
    await tick();
    expect(log.slice(2)).toEqual(["caption 2", `sleep ${readingMs("I'm sorry, I didn't understand that.")}`]);
    sleeping.shift()!();
    await tick();
    expect(log.slice(4)).toEqual(["caption 3", "speak 3"]);
    speaking.shift()!();
    await tick();
    expect(log.at(-1)).toBe("idle");
    expect(player.busy).toBe(false);
  });

  it("stop (the mute) cuts the line and drops the queue; new lines play after", async () => {
    const { log, speaking, player, tick } = rig();
    player.push([tv(1, "speak"), tv(2, "speak")]);
    await tick();
    player.stop();
    await tick();
    expect(log).toEqual(["caption 1", "speak 1", "cancel", "idle"]);
    player.push([tv(3, "muted")]);
    await tick();
    expect(log.slice(4)).toEqual(["caption 3", "sleep 1800"]);
    expect(speaking).toHaveLength(0);
  });

  it("readingMs stays between 1.8 s and 6 s", () => {
    expect(readingMs("Hi.")).toBe(1800);
    expect(readingMs("x".repeat(500))).toBe(6000);
  });
});

describe("postVoiceMute", () => {
  it("posts the mute with the terminal's token and returns the server's word", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const ok = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ muted: true }) } as Response;
    }) as unknown as typeof fetch;
    expect(await postVoiceMute({ eventId: "evt 1", token: "tok" }, true, ok)).toBe(true);
    expect(seen[0]!.url).toBe("/e/evt%201/api/mod/screen/voice");
    expect(JSON.parse(String(seen[0]!.init!.body))).toEqual({ muted: true });
    expect((seen[0]!.init!.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
    const refused = (async () => ({ ok: false, status: 403, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    expect(await postVoiceMute({ eventId: "e", token: "t" }, true, refused)).toBeNull();
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await postVoiceMute({ eventId: "e", token: "t" }, false, offline)).toBeNull();
  });
});

describe("a room terminal's cursor while asleep (wave 7)", () => {
  it("follows the head while asleep, so the lines that arrive with the wake are spoken", () => {
    let cursor: number | null = null;
    cursor = cursorWhileAsleep(voice(10, []), cursor); // first answer: the head
    expect(cursor).toBe(10);
    // Lines said in the room while it was closed (a director's say): skipped.
    cursor = cursorWhileAsleep(voice(14, [line(12), line(14)]), cursor);
    expect(cursor).toBe(14);
    // The wake: the reveal and the cutscene land in one answer — all spoken.
    const wake = planVoice(voice(17, [line(15, "Trabolta", "The Heart"), line(16, "Clippy", "The Heart"), line(17, "Trabolta", "The Heart")]), cursor, opts);
    expect(wake.lines.map((l) => [l.seq, l.mode])).toEqual([
      [15, "speak"],
      [17, "speak"],
    ]);
    // Without the asleep cursor (null: never advanced) the wake would drop them.
    expect(planVoice(voice(17, [line(15)]), null, opts).lines).toEqual([]);
    // A restart while asleep (head behind the cursor): resync to it.
    expect(cursorWhileAsleep(voice(3, []), 40)).toBe(3);
  });
});

describe("the TV caption's layer (T6-02)", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  /** The z-index a rule whose selector list is exactly `selector` sets. */
  const zOf = (selector: string): number => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{[^}]*?z-index:\\s*(\\d+)`, "u").exec(css);
    if (m === null) throw new Error(`no z-index for ${selector}`);
    return Number(m[1]);
  };

  it("a text-only line (Sandy, the song beats) shows over a slide and under an overlay", () => {
    const slide = zOf(".screen-slide, .screen-overlay");
    const overlay = zOf(".screen-overlay");
    const textOnly = zOf('.terminal.tv .tv-caption[data-mode="text"], .terminal.tv .tv-caption[data-mode="song"]');
    expect(textOnly).toBeGreaterThan(slide);
    expect(textOnly).toBeLessThan(overlay);
  });

  it("a line the director muted stays under the slide too (W8 review: only Sandy + the songs rise)", () => {
    // Drawn `text-only` like Sandy's, but no rule lifts the muted mode or the class itself.
    expect(css).not.toMatch(/data-mode="muted"\]/u);
    expect(css).not.toMatch(/\.tv-caption\.text-only\s*\{[^}]*z-index/u);
    expect(zOf(".tv-caption")).toBeLessThan(zOf(".screen-slide, .screen-overlay"));
  });

  it("a spoken line stays under the slide: the room hears it", () => {
    expect(zOf(".tv-caption")).toBeLessThan(zOf(".screen-slide, .screen-overlay"));
  });
});
