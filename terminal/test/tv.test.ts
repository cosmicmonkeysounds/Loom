//! The TV's room voice (OCT31 K-18 + N-04b): which lines are spoken, which
//! are only captioned, the cursor (no backlog, resync after a restart), the
//! in-order player and the director's mute.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ScreenVoice, VoiceLine } from "../src/screen.ts";
import { LinePlayer, TV_SILENT_BEATS, mirrorBeforeHim, showsNameplate, TV_STALE_MS, cursorAfterGap, cursorWhileAsleep, isSilentBeat, planVoice, postVoiceMute, readingMs, type TvLine } from "../src/tv.ts";

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
    player.push([tv(1, "speak"), tv(2, "text", "Nobody is home, sorry."), tv(3, "speak")]);
    await tick();
    expect(log).toEqual(["caption 1", "speak 1"]);
    speaking.shift()!();
    await tick();
    expect(log.slice(2)).toEqual(["caption 2", `sleep ${readingMs("Nobody is home, sorry.")}`]);
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

  it("captionOnStart (the TV): a spoken line's caption waits for him to start it", async () => {
    const log: string[] = [];
    const speaking: Array<{ r: () => void; started: () => void }> = [];
    const player = new LinePlayer(
      {
        caption: (l) => log.push(`caption ${l === null ? "-" : l.seq}`),
        speak: (l, started) =>
          new Promise<void>((r) => {
            log.push(`speak ${l.seq}`);
            speaking.push({ r, started });
          }),
        cancel: () => {
          log.push("cancel");
          for (const s of speaking.splice(0)) s.r();
        },
        sleep: (ms) => new Promise<void>((r) => setTimeout(r, 0, log.push(`sleep ${ms}`))),
        idle: () => log.push("idle"),
      },
      null,
      { captionOnStart: true },
    );
    const tick = () => new Promise((r) => setTimeout(r, 0));
    player.push([tv(1, "speak"), tv(2, "speak"), tv(3, "text")]);
    await tick();
    expect(log).toEqual(["speak 1"]); // handed to the voice, not captioned yet
    speaking[0]!.started();
    speaking[0]!.started(); // once
    expect(log).toEqual(["speak 1", "caption 1"]);
    speaking.shift()!.r();
    await tick();
    // Line 2 is in the queue's pause between lines: line 1 stays up.
    expect(log.slice(2)).toEqual(["speak 2"]);
    speaking[0]!.started();
    expect(log.at(-1)).toBe("caption 2");
    speaking.shift()!.r();
    await tick();
    expect(log.slice(4, 6)).toEqual(["caption 3", `sleep ${readingMs("Hi.")}`]); // a text line: at once
    // A line cut before he starts it is never captioned.
    player.push([tv(4, "speak")]);
    await tick();
    const late = speaking[0]!.started;
    player.stop();
    late();
    expect(log).not.toContain("caption 4");
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

describe("showsNameplate (livetv-2)", () => {
  it("names the character only once the server says it is out of hiding", () => {
    expect(showsNameplate(null)).toBe(false);
    expect(showsNameplate({ character: null })).toBe(false); // before the doors
    expect(showsNameplate({ character: { id: "Trabolta", hidden: true, awake: false, online: false } as never })).toBe(false);
    expect(showsNameplate({ character: { id: "Trabolta", hidden: false, awake: true, online: true } as never })).toBe(true);
  });
});

describe("the mirror before he is online (wave 58, the host's 📺)", () => {
  const at = (screen: string | null, hidden: boolean | null) => ({ night: { screen } as never, character: hidden === null ? null : ({ id: "Trabolta", hidden, awake: false, online: false, hold: false } as never) });
  it("shows through attract only on the cue, only while a walker is linked, only before he is revealed", () => {
    expect(mirrorBeforeHim(at("mirror", true), true, true)).toBe(true);
    expect(mirrorBeforeHim(at("bingo_time", true), true, true)).toBe(false);
    expect(mirrorBeforeHim(at("mirror", true), true, false)).toBe(false);
    // Revealed: the face and the world beside it, the old way; an ending's attract keeps the screensaver.
    expect(mirrorBeforeHim(at("mirror", false), true, true)).toBe(false);
    expect(mirrorBeforeHim(at("mirror", true), false, true)).toBe(false);
    expect(mirrorBeforeHim(at("mirror", null), true, true)).toBe(false);
    expect(mirrorBeforeHim(null, true, true)).toBe(false);
  });
});

describe("a long line's caption follows the chunk being said (wave 18b)", () => {
  it("over 180 characters a spoken line shows its current piece; anything else the whole line", async () => {
    const { CAPTION_CHUNK_OVER, captionText } = await import("../src/Tv.tsx");
    const long = { seq: 7, mode: "speak" as const, text: `${"Winamp said the bank. ".repeat(12)}` };
    expect(long.text.length).toBeGreaterThan(CAPTION_CHUNK_OVER);
    expect(captionText(long, { seq: 7, index: 3 })).toBe("Winamp said the bank.");
    // Another line's piece, or none yet: its first piece — never the wall of text.
    expect(captionText(long, { seq: 6, index: 5 })).toBe("Winamp said the bank.");
    expect(captionText(long, null)).toBe("Winamp said the bank.");
    // Past the end (a chunk list that moved): still a piece, not the wall.
    expect(captionText(long, { seq: 7, index: 99 })).toBe("Winamp said the bank.");
    // Short, or not spoken (muted, a song, Sandy's text): always the whole line.
    expect(captionText({ seq: 7, mode: "speak", text: "Question one." }, { seq: 7, index: 0 })).toBe("Question one.");
    expect(captionText({ ...long, mode: "muted" }, { seq: 7, index: 0 })).toBe(long.text);
  });

  it("the pieces are cut from what was filed, not from what the voice says", async () => {
    const { captionChunks, captionText } = await import("../src/Tv.tsx");
    const { splitSentences } = await import("../src/speech/split.ts");
    const filed = [
      "Question four. Winamp filed 🦆 _the duck_ and was sure… Netscape filed https://example.com/x and was not.",
      "Excel filed **the bank** at full confidence. ".repeat(4),
    ].join(" ");
    const pieces = captionChunks(filed);
    // As many pieces as the voice says, in order, together the whole line.
    expect(pieces).toHaveLength(splitSentences(filed).length);
    expect(pieces.join(" ").replace(/\s+/g, " ")).toBe(filed.trim().replace(/\s+/g, " "));
    // The emoji, the marks, the "…" and the link stay on screen.
    const shown = pieces.join(" ");
    expect(shown).toContain("🦆 _the duck_");
    expect(shown).toContain("sure…");
    expect(shown).toContain("https://example.com/x");
    expect(shown).toContain("**the bank**");
    const line = { seq: 2, mode: "speak" as const, text: filed };
    expect(captionText(line, { seq: 2, index: 0 }, pieces)).toBe(pieces[0]);
    expect(captionText(line, { seq: 2, index: 0 }, pieces)).not.toContain("link");
  });
});

describe("TvSpeechFeed (wave 26, V1): the TV's voice → the speech bus and sp=", () => {
  it("queues only spoken lines, starts a line on its first sentence, ends it once", async () => {
    const { TvSpeechFeed } = await import("../src/tv.ts");
    const { RoomSpeech, speechQuery } = await import("../src/speech/said.ts");
    const events: Array<Record<string, unknown>> = [];
    let clock = 1000;
    const room = new RoomSpeech();
    room.attach();
    const feed = new TvSpeechFeed({ emit: (e) => events.push(e), now: () => clock, room });
    feed.queued({ seq: 4, beat: "Bottle Landed", mode: "speak" }, ["Excel.", "Truth or dare?"]);
    feed.queued({ seq: 4, beat: "Bottle Landed", mode: "speak" }, ["Excel.", "Truth or dare?"]); // once
    feed.queued({ seq: 5, beat: "Song Ending", mode: "song" }, ["la"]);
    feed.queued({ seq: 6, beat: null, mode: "muted" }, ["Hi."]);
    feed.queued({ seq: 7, beat: null, mode: "speak" }, []);
    expect(events).toEqual([{ kind: "queued", seq: 4, beat: "Bottle Landed", chunks: 2, at: 1000 }]);
    clock = 2000;
    feed.chunk(4, 0);
    clock = 3000;
    feed.chunk(4, 1);
    feed.chunk(5, 0); // never queued: nothing
    expect(events.slice(1)).toEqual([
      { kind: "line", seq: 4, beat: "Bottle Landed", chunks: 2, texts: ["Excel.", "Truth or dare?"], at: 2000 },
      { kind: "chunk", seq: 4, index: 0, at: 2000 },
      { kind: "chunk", seq: 4, index: 1, at: 3000 },
    ]);
    expect(speechQuery(room.report(4))["sp"]).toBe("4:1");
    clock = 4000;
    feed.done(4);
    feed.done(4);
    expect(events.at(-1)).toEqual({ kind: "done", seq: 4, at: 4000 });
    expect(events.filter((e) => e["kind"] === "done")).toHaveLength(1);
    expect(speechQuery(room.report(4))["sp"]).toBe("4:d");
    feed.chunk(4, 1); // after done: nothing
    expect(events).toHaveLength(5);
  });

  it("a drop (the mute, attract) ends every queued line, said or not", async () => {
    const { TvSpeechFeed } = await import("../src/tv.ts");
    const events: Array<Record<string, unknown>> = [];
    const feed = new TvSpeechFeed({ emit: (e) => events.push(e), now: () => 50 });
    feed.queued({ seq: 1, beat: "Advice Helped", mode: "speak" }, ["A."]);
    feed.queued({ seq: 2, beat: "Advice Helped", mode: "speak" }, ["B."]);
    feed.chunk(1, 0);
    feed.cancelAll();
    expect(events.filter((e) => e["kind"] === "done").map((e) => e["seq"])).toEqual([1, 2]);
    expect(events.filter((e) => e["kind"] === "done").every((e) => e["cut"] === true)).toBe(true);
    // The queue's own done for the cut line comes after: dropped.
    feed.done(1);
    expect(events.filter((e) => e["kind"] === "done")).toHaveLength(2);
  });

  it("a seq it already finished is a new line after a story restart (seqs start over)", async () => {
    const { TvSpeechFeed } = await import("../src/tv.ts");
    const { RoomSpeech, speechQuery } = await import("../src/speech/said.ts");
    const events: Array<Record<string, unknown>> = [];
    let clock = 100;
    const room = new RoomSpeech();
    room.attach();
    const feed = new TvSpeechFeed({ emit: (e) => events.push(e), now: () => clock, room });
    feed.queued({ seq: 12, beat: "Trabolta Introduction", mode: "speak" }, ["Old."]);
    feed.chunk(12, 0);
    feed.done(12);
    // The rehearsal ends; Go live; the new run's seq 12 is another line.
    clock = 9000;
    events.length = 0;
    feed.queued({ seq: 12, beat: "The Verdict", mode: "speak" }, ["New.", "Line."]);
    feed.chunk(12, 0);
    expect(speechQuery(room.report(12))["sp"]).toBe("12:0");
    feed.done(12);
    expect(events.map((e) => e["kind"])).toEqual(["queued", "line", "chunk", "done"]);
    expect(events[0]).toEqual({ kind: "queued", seq: 12, beat: "The Verdict", chunks: 2, at: 9000 });
    // A line still being said is never replaced by a repeat of its seq.
    feed.queued({ seq: 30, beat: null, mode: "speak" }, ["A."]);
    feed.chunk(30, 0);
    feed.queued({ seq: 30, beat: null, mode: "speak" }, ["B."]);
    expect(events.filter((e) => e["seq"] === 30 && e["kind"] === "queued")).toHaveLength(1);
  });
});
