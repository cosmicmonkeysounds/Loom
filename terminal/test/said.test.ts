//! Speech done (wave 25, `docs/loom-house-desk.md` §5): the room-speech model
//! behind the poll's `talk` / `said`, the player feeding it, the poll URL and
//! the drain re-poll's pacing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { screenStateUrl } from "../src/screen.ts";
import { DRAIN_REPOLL_GAP_MS, PollPacer, RoomSpeech, speechQuery } from "../src/speech/said.ts";
import { LinePlayer, planVoice, type TvLine } from "../src/tv.ts";

describe("RoomSpeech: talk / said", () => {
  it("not talking and finished through the cursor when nothing is queued", () => {
    const s = new RoomSpeech();
    s.attach();
    s.heard(12);
    expect(s.report(12)).toEqual({ talk: false, said: 12 });
    expect(s.report(null)).toEqual({ talk: false, said: 12 });
  });

  it("talks while spoken lines are queued; said stops short of the first unsaid one", () => {
    const s = new RoomSpeech();
    s.attach();
    s.queued([14, 17]);
    expect(s.report(17)).toEqual({ talk: true, said: 13 });
    s.finished(14);
    expect(s.report(17)).toEqual({ talk: true, said: 16 });
    s.finished(17);
    expect(s.report(17)).toEqual({ talk: false, said: 17 });
  });

  it("finishing a later line finishes the ones queued before it; unknown seqs are ignored", () => {
    const s = new RoomSpeech();
    s.attach();
    s.queued([3, 4, 5]);
    s.finished(99);
    expect(s.talk).toBe(true);
    s.finished(4);
    expect(s.report(5)).toEqual({ talk: true, said: 4 });
  });

  it("a cleared queue (mute, attract) is finished at once", () => {
    const s = new RoomSpeech();
    s.attach();
    s.queued([8]);
    s.cleared();
    expect(s.report(9)).toEqual({ talk: false, said: 9 });
  });

  it("with no player mounted (setup) it is quiet and finished through the last head heard", () => {
    const s = new RoomSpeech();
    s.heard(30);
    expect(s.report(20)).toEqual({ talk: false, said: 30 });
    const detach = s.attach();
    s.queued([31]);
    detach();
    detach(); // idempotent
    expect(s.report(31)).toEqual({ talk: false, said: 30 });
    expect(new RoomSpeech().report(null)).toEqual({ talk: false, said: null });
  });

  it("onDrain fires on talk 1 → 0 only (finish, clear, detach), never when already quiet", () => {
    const s = new RoomSpeech();
    const detach = s.attach();
    let drains = 0;
    const off = s.onDrain(() => drains++);
    s.cleared();
    s.finished(1);
    expect(drains).toBe(0);
    s.queued([1, 2]);
    s.finished(1);
    expect(drains).toBe(0);
    s.finished(2);
    expect(drains).toBe(1);
    s.queued([3]);
    s.cleared();
    expect(drains).toBe(2);
    s.queued([4]);
    detach();
    expect(drains).toBe(3);
    off();
    s.attach();
    s.queued([5]);
    s.finished(5);
    expect(drains).toBe(3);
  });

  it("a throwing listener never breaks the model", () => {
    const s = new RoomSpeech();
    s.attach();
    s.onDrain(() => {
      throw new Error("x");
    });
    s.queued([1]);
    expect(() => s.finished(1)).not.toThrow();
    expect(s.talk).toBe(false);
  });
});

describe("LinePlayer → RoomSpeech", () => {
  function rig() {
    const speech = new RoomSpeech();
    speech.attach();
    const speaking: Array<() => void> = [];
    const sleeping: Array<() => void> = [];
    const player = new LinePlayer(
      {
        caption: () => {},
        speak: () => new Promise<void>((r) => speaking.push(r)),
        cancel: () => {
          for (const r of speaking.splice(0)) r();
        },
        sleep: () => new Promise<void>((r) => sleeping.push(r)),
        idle: () => {},
      },
      speech,
    );
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return { speech, speaking, sleeping, player, tick };
  }
  const line = (seq: number, mode: TvLine["mode"]): TvLine => ({ seq, from: "Trabolta", text: "Hi.", beat: null, mode });

  it("only spoken lines hold `said` back; a text line's reading pause does not", async () => {
    const { speech, speaking, sleeping, player, tick } = rig();
    player.push([line(5, "text"), line(6, "speak"), line(7, "muted"), line(8, "song")]);
    expect(speech.report(8)).toEqual({ talk: true, said: 5 });
    await tick();
    sleeping.shift()!();
    await tick();
    expect(speech.report(8)).toEqual({ talk: true, said: 5 });
    speaking.shift()!();
    await tick();
    // 7 and 8 are still on screen (reading pauses) but will never be spoken.
    expect(speech.report(8)).toEqual({ talk: false, said: 8 });
  });

  it("all text-only lines: never talking", () => {
    const { speech, player } = rig();
    player.push([line(1, "text"), line(2, "muted")]);
    expect(speech.report(2)).toEqual({ talk: false, said: 2 });
  });

  it("stop (the mute, attract) finishes everything at once", async () => {
    const { speech, player, tick } = rig();
    player.push([line(1, "speak"), line(2, "speak")]);
    await tick();
    player.stop();
    await tick();
    expect(speech.report(2)).toEqual({ talk: false, said: 2 });
  });

  it("other speakers and attract are dropped by the plan: finished at once", () => {
    const { speech, player } = rig();
    const plan = planVoice(
      { room: "loc:x", muted: false, head: 4, lines: [{ seq: 3, from: "Clippy", text: "Hi.", beat: null }, { seq: 4, from: "Trabolta", text: "Hi.", beat: null }] },
      2,
      { character: "Trabolta", muted: false, attract: false },
    );
    player.push(plan.lines);
    expect(speech.report(plan.cursor)).toEqual({ talk: true, said: 3 });
    const asleep = planVoice({ room: "loc:x", muted: false, head: 9, lines: [{ seq: 9, from: "Trabolta", text: "Hi.", beat: null }] }, 4, { character: "Trabolta", muted: false, attract: true });
    expect(asleep.lines).toEqual([]);
  });
});

describe("the poll's talk / said fields", () => {
  const tv = defaultConfig({ eventId: "evt", token: "tok", name: "TV", spot: "desktop-tv", view: "tv" });

  it("speechQuery: talk always, said only when known; nothing for a terminal that doesn't speak", () => {
    expect(speechQuery({ talk: true, said: 41 })).toEqual({ talk: "1", said: "41" });
    expect(speechQuery({ talk: false, said: null })).toEqual({ talk: "0" });
    expect(speechQuery({ talk: false, said: -1 })).toEqual({ talk: "0", said: "-1" });
    expect(speechQuery(null)).toEqual({});
    expect(speechQuery(undefined)).toEqual({});
  });

  it("ride after the voice room and cursor", () => {
    expect(screenStateUrl(tv, { room: "The Desktop", after: 41, speech: { talk: true, said: 40 } })).toBe(
      "/e/evt/api/screen/state?name=TV&spot=desktop-tv&view=tv&character=Trabolta&voice=The+Desktop&after=41&talk=1&said=40",
    );
    expect(screenStateUrl(tv, { room: "Server Room", after: 41, as: "room", speech: { talk: false, said: 41 } })).toMatch(/&room=Server\+Room&after=41&talk=0&said=41$/u);
    expect(screenStateUrl(tv, { room: "The Desktop", after: null })).not.toMatch(/talk=|said=/u);
  });
});

describe("the poll's sp key (wave 26, V1 phase 2)", () => {
  const tv = defaultConfig({ eventId: "evt", token: "tok", name: "TV", spot: "desktop-tv", view: "tv" });

  it("speechQuery: sp=<seq>:<chunk> while a line speaks, sp=<seq>:d once it is done, nothing otherwise", () => {
    expect(speechQuery({ talk: true, said: 40, sp: { seq: 41, chunk: 2 } })).toEqual({ talk: "1", said: "40", sp: "41:2" });
    expect(speechQuery({ talk: false, said: 41, sp: { seq: 41, chunk: null } })).toEqual({ talk: "0", said: "41", sp: "41:d" });
    expect(speechQuery({ talk: true, said: 40, sp: null })).toEqual({ talk: "1", said: "40" });
    expect(speechQuery({ talk: true, said: 40 })).toEqual({ talk: "1", said: "40" });
    // Malformed parts are left out rather than sent.
    expect(speechQuery({ talk: true, said: 40, sp: { seq: -1, chunk: 0 } })).not.toHaveProperty("sp");
    expect(speechQuery({ talk: true, said: 40, sp: { seq: 3, chunk: Number.NaN } })).not.toHaveProperty("sp");
    expect(speechQuery({ talk: true, said: 40, sp: { seq: 3.7, chunk: 1.2 } })).toMatchObject({ sp: "3:1" });
  });

  it("rides the TV's poll after talk / said", () => {
    expect(screenStateUrl(tv, { room: "The Desktop", after: 41, speech: { talk: true, said: 40, sp: { seq: 41, chunk: 0 } } })).toBe(
      "/e/evt/api/screen/state?name=TV&spot=desktop-tv&view=tv&character=Trabolta&voice=The+Desktop&after=41&talk=1&said=40&sp=41%3A0",
    );
  });
});

describe("PollPacer: the drain re-poll", () => {
  it("polls on the cadence when nothing kicks", () => {
    const p = new PollPacer(2000);
    p.start(0);
    expect(p.done(100)).toBe(2000);
  });

  it("a kick between polls moves the next poll up to now", () => {
    const p = new PollPacer(2000);
    p.start(0);
    p.done(100);
    expect(p.kick(1000)).toBe(0);
  });

  it("never two starts within the gap: a kick right after a poll waits out the gap", () => {
    const p = new PollPacer(2000);
    p.start(0);
    p.done(100);
    expect(p.kick(200)).toBe(DRAIN_REPOLL_GAP_MS - 200);
    // A second kick before that poll changes nothing (already due sooner).
    expect(p.kick(300)).toBeNull();
  });

  it("a kick while a poll is in flight polls again right after it (its URL was built before the drain)", () => {
    const p = new PollPacer(2000);
    p.start(0);
    expect(p.kick(50)).toBeNull();
    expect(p.done(100)).toBe(DRAIN_REPOLL_GAP_MS - 100);
    p.start(500);
    expect(p.done(900)).toBe(2000); // one extra poll, then the cadence
    expect(p.kick(1000)).toBe(0);
  });

  it("a kick never delays a poll that is due sooner, and does nothing once stopped", () => {
    const p = new PollPacer(300);
    p.start(0);
    p.done(10); // due at 310, sooner than the gap allows a kick (500)
    expect(p.kick(20)).toBeNull();
    p.stop();
    expect(p.kick(5000)).toBeNull();
  });

  it("a storm of drains is at most one poll per gap", () => {
    const p = new PollPacer(2000);
    let now = 0;
    let starts = 0;
    let due = 0;
    p.start(now);
    starts++;
    due = now + p.done(now + 20);
    for (now = 21; now < 5000; now += 10) {
      const d = p.kick(now);
      if (d !== null) due = now + d;
      if (now >= due) {
        p.start(now);
        starts++;
        due = now + p.done(now + 20);
      }
    }
    expect(starts).toBeLessThanOrEqual(Math.ceil(5000 / DRAIN_REPOLL_GAP_MS) + 1);
  });
});

describe("browser floor (Chrome 87 / Safari 14)", () => {
  it("said.ts uses no structuredClone, no Array.prototype.at, no regex lookbehind", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/speech/said.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/structuredClone/u);
    expect(src).not.toMatch(/\.at\(/u);
    expect(src).not.toMatch(/\(\?<[=!]/u);
  });
});

describe("RoomSpeech → sp= (wave 26, V1 phase 2)", () => {
  it("reports the line and sentence being said, then d once it is done", () => {
    const s = new RoomSpeech();
    const detach = s.attach();
    s.heard(40);
    s.queued([41]);
    expect(s.report(41)).toEqual({ talk: true, said: 40 });
    s.speaking(41, 0);
    expect(s.report(41)).toEqual({ talk: true, said: 40, sp: { seq: 41, chunk: 0 } });
    expect(speechQuery(s.report(41))).toEqual({ talk: "1", said: "40", sp: "41:0" });
    s.speaking(41, 2);
    expect(speechQuery(s.report(41))["sp"]).toBe("41:2");
    s.spoke(40); // another line's end changes nothing
    expect(speechQuery(s.report(41))["sp"]).toBe("41:2");
    s.spoke(41);
    s.finished(41);
    expect(s.report(41)).toEqual({ talk: false, said: 41, sp: { seq: 41, chunk: null } });
    expect(speechQuery(s.report(41))["sp"]).toBe("41:d");
    // A mute mid-line: done.
    s.queued([42]);
    s.speaking(42, 1);
    s.cleared();
    expect(speechQuery(s.report(42))["sp"]).toBe("42:d");
    detach();
    expect(speechQuery(s.report(42))["sp"]).toBe("42:d");
  });
});
