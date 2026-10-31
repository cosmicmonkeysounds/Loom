// The door cuts him off (wave 59): what counts as an edge, what a late frame is,
// and the cut itself, through the real LinePlayer, SpeechQueue and RoomSpeech
// wired as `app.tsx` wires them. Real Chromium was checked on a scratch server,
// and Chrome's macOS voice, muted. No M4, Steph's laptop or Windows voice has met it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Thread, Typed } from "../src/chat.tsx";
import { DOOR_LATE_MS, DOOR_OPEN_BEATS, DOOR_SHUT_BEATS, DoorCut, stopsAt, wrongDoor } from "../src/heart/door-cut.ts";
import type { Line } from "../src/pilot.ts";
import type { ScreenVoice } from "../src/screen.ts";
import { DOOR_STALE_MS, doorOpenNow, type SensorState, type StoryDoor } from "../src/serial/door-bridge.ts";
import { CANCEL_SETTLE_MS, DEFAULT_GAPS, SpeechQueue, VoiceFloor, type Prepared, type SpeechEngine } from "../src/speech/engine.ts";
import { RoomSpeech } from "../src/speech/said.ts";
import { revealOffsets, splitSentences } from "../src/speech/split.ts";
import { LinePlayer, planVoice, type TvLine } from "../src/tv.ts";

// A server render runs no effects; `useLayoutEffect` only warns there.
vi.spyOn(console, "error").mockImplementation(() => {});

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const sensor = (open: boolean, at: number, o: Partial<SensorState> = {}): SensorState => ({ open, level: open ? 30 : 2400, fault: null, warn: null, at, ...o });
const night = (server_door: StoryDoor["server_door"], door_override: boolean | null = false): StoryDoor => ({ server_door, door_override });

describe("what counts as an edge", () => {
  it("fires once per sensor edge, each way, on the sensor alone, with no poll between", () => {
    const d = new DoorCut();
    expect(d.step(sensor(false, 1000), night("closed"), 1000)).toBe(false);
    expect(d.step(sensor(true, 1100), night("closed"), 1100)).toBe(true);
    expect(d.step(sensor(true, 1200), night("closed"), 1200)).toBe(false);
    expect(d.step(sensor(false, 1300), night("closed"), 1300)).toBe(true);
    expect(d.step(sensor(false, 1400), night("closed"), 1400)).toBe(false);
  });

  it("the story catching up with the sensor is the same edge, not a second one", () => {
    const d = new DoorCut();
    d.step(sensor(true, 1000), night("open"), 1000);
    expect(d.step(sensor(false, 1100), night("open"), 1100)).toBe(true);
    expect(d.step(sensor(false, 1200), night("closed"), 1200)).toBe(false);
  });

  it("the first door after a load is no edge, whichever arrives first and however they disagree", () => {
    const pollFirst = new DoorCut();
    expect(pollFirst.step(null, night("closed"), 1000)).toBe(false);
    expect(pollFirst.step(sensor(true, 1100), night("closed"), 1100)).toBe(false);
    const sensorFirst = new DoorCut();
    expect(sensorFirst.step(sensor(true, 1000), null, 1000)).toBe(false);
    expect(sensorFirst.step(sensor(true, 1100), night("closed"), 1100)).toBe(false);
    const buttons = new DoorCut();
    expect(buttons.step(sensor(true, 1000), null, 1000)).toBe(false);
    expect(buttons.step(sensor(true, 1100), night("closed", true), 1100)).toBe(false);
  });

  it("a flicker never reaches it: the firmware debounces `open`, so only the level moves", () => {
    const d = new DoorCut();
    d.step(sensor(false, 1000), night("closed"), 1000);
    for (const [i, level] of [2410, 1500, 2380, 1300, 2400].entries()) expect(d.step(sensor(false, 1100 + i, { level }), night("closed"), 1100 + i)).toBe(false);
    expect(d.step(sensor(false, 1200, { warn: "ldr_open" }), night("closed"), 1200)).toBe(false);
  });

  it("a fault is no edge going in or coming back, though the firmware forces `open` under it", () => {
    const d = new DoorCut();
    d.step(sensor(false, 1000), night("closed"), 1000);
    expect(d.step(sensor(true, 1100, { fault: "ldr_saturated" }), night("closed"), 1100)).toBe(false);
    expect(d.step(sensor(false, 1200), night("closed"), 1200)).toBe(false);
    expect(d.step(sensor(true, 1300), night("closed"), 1300)).toBe(true);
    // As the bridge reads it (`lastOpen` null after a fault): the first clean line
    // is never an edge, even on the other side. The reconcile tells the story.
    expect(d.step(sensor(true, 1400, { fault: "led_dead" }), night("open"), 1400)).toBe(false);
    expect(d.step(sensor(false, 1500), night("open"), 1500)).toBe(false);
    expect(d.step(sensor(true, 1600), night("closed"), 1600)).toBe(true);
  });

  it("a stale sensor handing over to a story that hasn't caught up is no edge, nor is the story catching up", () => {
    const d = new DoorCut();
    d.step(sensor(true, 1000), night("open"), 1000);
    expect(d.step(sensor(false, 1100), night("open"), 1100)).toBe(true);
    const gone = 1100 + DOOR_STALE_MS + 1;
    expect(doorOpenNow(sensor(false, 1100), night("open"), gone)).toBe(true); // what the panel falls back on
    expect(d.step(sensor(false, 1100), night("open"), gone)).toBe(false);
    expect(d.step(sensor(false, 1100), night("closed"), gone + 100)).toBe(false);
  });

  it("a 🚪 press reaches it through the poll, each way, once", () => {
    const d = new DoorCut();
    d.step(sensor(false, 1000), night("closed"), 1000);
    expect(d.step(sensor(false, 1100), night("open", true), 1100)).toBe(true);
    expect(d.step(sensor(false, 1200), night("open", true), 1200)).toBe(false);
    expect(d.step(sensor(false, 1300), night("closed", true), 1300)).toBe(true);
  });

  it("a 🚪 press overrides the sensor: its reading moves nothing until Trust, and Trust is no edge", () => {
    const d = new DoorCut();
    d.step(sensor(false, 1000), night("closed", true), 1000);
    expect(d.step(sensor(true, 1100), night("closed", true), 1100)).toBe(false);
    expect(d.step(sensor(true, 1200), night("closed", false), 1200)).toBe(false);
    expect(d.step(sensor(false, 1300), night("closed", false), 1300)).toBe(true);
  });

  it("a 🚪 press against a sensor edge the story hadn't heard still counts", () => {
    const d = new DoorCut();
    d.step(sensor(true, 1000), night("open"), 1000);
    expect(d.step(sensor(false, 1100), night("open"), 1100)).toBe(true);
    expect(d.step(sensor(false, 1200), night("open", true), 1200)).toBe(true);
  });

  it("with no sensor the story is the door; a story restart is no edge", () => {
    const d = new DoorCut();
    expect(d.step(null, night("closed"), 1000)).toBe(false);
    expect(d.step(null, night("open"), 1100)).toBe(true);
    expect(d.step(null, night(null), 1200)).toBe(false);
    expect(d.step(null, night("closed"), 1300)).toBe(false);
    expect(d.step(null, night("open"), 1400)).toBe(true);
  });
});

describe("a late frame", () => {
  it("an answer behind the sensor was written before the story heard the door", () => {
    const d = new DoorCut();
    d.step(sensor(true, 1000), night("open"), 1000);
    expect(d.behind(night("open"), 1050)).toBe(false);
    d.step(sensor(false, 1100), night("open"), 1100);
    expect(d.behind(night("open"), 1200)).toBe(true);
    expect(d.behind(night("closed"), 1300)).toBe(false);
  });

  it("is bounded: a story that never hears the door doesn't silence him", () => {
    const d = new DoorCut();
    d.step(sensor(true, 1000), night("open"), 1000);
    d.step(sensor(false, 1100), night("open"), 1100);
    expect(d.behind(night("open"), 1100 + DOOR_LATE_MS - 1)).toBe(true);
    expect(d.behind(night("open"), 1100 + DOOR_LATE_MS)).toBe(false);
  });

  it("never marks a terminal the door hasn't moved on", () => {
    expect(new DoorCut().behind(night("open"), 1000)).toBe(false);
    const d = new DoorCut();
    d.step(sensor(false, 1000), night("open"), 1000);
    expect(d.behind(night("open"), 1100)).toBe(false);
  });

  it("what he says about the door is judged against the door", () => {
    for (const b of DOOR_OPEN_BEATS) {
      expect(wrongDoor(b, false)).toBe(true);
      expect(wrongDoor(b, true)).toBe(false);
    }
    for (const b of DOOR_SHUT_BEATS) {
      expect(wrongDoor(b, true)).toBe(true);
      expect(wrongDoor(b, false)).toBe(false);
    }
    expect(wrongDoor("heart_nag", false)).toBe(true);
  });

  it("anything else plays, and a terminal with no door judges nothing", () => {
    expect(wrongDoor("Heart Talk", false)).toBe(false);
    expect(wrongDoor("Server Room Alarm", true)).toBe(false);
    expect(wrongDoor(null, false)).toBe(false);
    expect(wrongDoor(undefined, true)).toBe(false);
    expect(wrongDoor("Heart Nag", null)).toBe(false);
  });

  it("every beat named here is the story's, and each door's beats are the ones its rules play", () => {
    const beats = read("../../core/examples/trapped-in-the-internet/beats/server-room.loom");
    for (const b of [...DOOR_OPEN_BEATS, ...DOOR_SHUT_BEATS]) expect(beats).toMatch(new RegExp(`^== ${b}$`, "mu"));
    const rules = read("../../core/examples/trapped-in-the-internet/main.loom");
    const opened = rules.slice(rules.indexOf("when heart_door_opened:"), rules.indexOf("when heart_door_closed:"));
    const closed = rules.slice(rules.indexOf("when heart_door_closed:"), rules.indexOf("Heart Nag; a short amber swell"));
    expect(opened).toContain("-> The Heart");
    expect(opened).toContain("-> Heart Door Again");
    expect(closed).toContain("-> Heart Sealed");
    expect(closed).toContain("-> Heart Door Shut");
  });
});

const line = (seq: number, text: string, beat: string | null = "The Heart"): TvLine => ({ seq, from: "Trabolta", text, beat, mode: "speak" });
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
/** Past the settle after a stop. */
const settle = async () => {
  await new Promise((r) => setTimeout(r, CANCEL_SETTLE_MS + 5));
  await flush();
};

/** `Terminal`'s room voice: a real queue, player and speech model over an engine
 *  that speaks until told to stop. */
function rig() {
  const said: string[] = [];
  let ending: (() => void) | null = null;
  let stopped = 0;
  const engine: SpeechEngine = {
    kind: "browser",
    prepare: async (text) => ({ kind: "browser", text }),
    play: (p, _level, onStart) =>
      new Promise<void>((resolve) => {
        said.push((p as Extract<Prepared, { text: string }>).text);
        onStart?.();
        ending = resolve;
      }),
    stop() {
      stopped++;
      ending?.();
      ending = null;
    },
  };
  const waiters = new Map<number, () => void>();
  const idle: number[] = [];
  const queue = new SpeechQueue({ primary: engine, fallback: null }, { level: () => {}, chunk: () => {}, done: (id) => (waiters.get(id)?.(), waiters.delete(id)), idle: () => idle.push(1) }, new VoiceFloor(), { chunk: 0, line: 0 });
  const speech = new RoomSpeech();
  speech.attach();
  const player = new LinePlayer(
    {
      caption: () => {},
      speak: (l) =>
        new Promise<void>((resolve) => {
          waiters.set(l.seq, resolve);
          queue.say({ id: l.seq, chunks: splitSentences(l.text) });
        }),
      cancel: () => {
        queue.stop();
        for (const w of waiters.values()) w();
        waiters.clear();
      },
      sleep: async () => {},
      idle: () => {},
    },
    speech,
    { captionOnStart: true },
  );
  const finish = async () => {
    ending?.();
    ending = null;
    await flush();
  };
  return { said, stops: () => stopped, queue, speech, player, finish, waiters };
}

describe("the cut", () => {
  it("shutting the door stops the line mid-word, and what was queued is never said", async () => {
    const { said, stops, queue, player, speech } = rig();
    player.push([line(5, "So."), line(7, "Close the door."), line(8, "I will not say one true thing.")]);
    await flush();
    expect(said).toEqual(["So."]);
    player.stop();
    await flush();
    expect(stops()).toBeGreaterThan(0);
    expect(said).toEqual(["So."]);
    expect(queue.busy).toBe(false);
    expect(player.busy).toBe(false);
    expect(speech.talk).toBe(false);
  });

  it("opening it does the same, and the new door's lines follow at once", async () => {
    const { said, player, finish } = rig();
    player.push([line(11, "Thank you.", "Heart Sealed"), line(12, "The bay is cold tonight.", "Heart Sealed")]);
    await flush();
    player.stop();
    player.push([line(14, "The door.", "Heart Door Again")]);
    await settle();
    expect(said).toEqual(["Thank you.", "The door."]);
    await finish();
    expect(player.busy).toBe(false);
  });

  it("the next line waits for the cancel to settle: a speak() on its heels is lost, and that writes the voice off", async () => {
    const { said, player } = rig();
    player.push([line(5, "Close the door.")]);
    await flush();
    // A 🚪 press: one answer brings the cut and the new door's lines together.
    player.stop();
    player.push([line(11, "Thank you.", "Heart Sealed")]);
    await flush();
    expect(said).toEqual(["Close the door."]);
    await settle();
    expect(said).toEqual(["Close the door.", "Thank you."]);
  });

  it("a dropped line never comes back: not on a poll, not through the cursor", async () => {
    const { said, player } = rig();
    const voice: ScreenVoice = { room: "loc:The Server Room", muted: false, head: 8, lines: [line(7, "Close the door."), line(8, "I will not say one true thing.")] };
    const first = planVoice(voice, 6, { character: "Trabolta", muted: false, attract: false });
    player.push(first.lines);
    await flush();
    player.stop();
    await flush();
    const again = planVoice(voice, first.cursor, { character: "Trabolta", muted: false, attract: false });
    expect(again.lines).toEqual([]);
    player.push(again.lines);
    await flush();
    expect(said).toEqual(["Close the door."]);
  });

  it("releases everything waiting on him, and reports the room's lines finished", async () => {
    const { player, speech, waiters } = rig();
    let drains = 0;
    speech.onDrain(() => drains++);
    player.push([line(7, "Close the door."), line(8, "Please.")]);
    await flush();
    expect(waiters.size).toBe(1);
    expect(speech.report(8)).toEqual({ talk: true, said: 6 });
    player.stop();
    await flush();
    expect(waiters.size).toBe(0);
    expect(drains).toBe(1);
    expect(speech.report(8)).toEqual({ talk: false, said: 8 });
  });

  it("cuts a sentence paced with no engine at once, so the next line never waits it out", async () => {
    let chunks = 0;
    const silent: SpeechEngine = { kind: "browser", prepare: async () => null, play: async () => {}, stop() {} };
    const q = new SpeechQueue({ primary: silent, fallback: null }, { level: () => {}, chunk: () => chunks++, done: () => {}, idle: () => {} }, new VoiceFloor(), DEFAULT_GAPS);
    q.say({ id: 1, chunks: ["A sentence long enough to take several seconds to read at a walk."] });
    await flush();
    expect(chunks).toBe(1);
    expect(q.busy).toBe(true);
    q.stop();
    await flush();
    expect(q.busy).toBe(false);
  });

  it("nothing a player does stops him: only the door's step leads to a cut", () => {
    const app = read("../src/app.tsx");
    expect(app.match(/doorCut\.current\.step\(/gu)).toHaveLength(1);
    const heart = app.slice(app.indexOf("const doorCut = useRef"), app.indexOf("// Every poll: the room's new lines"));
    expect(heart).toContain("roomPlayer.stop();");
    expect(heart).toContain("doorOpen === null");
    // Where a press can reach the voice, it's the plain terminal's own skip of his DM
    // lines, which never reaches the room's voice, and the CRT passes it nothing.
    expect(app).toContain("if (roomBusy) return;");
    expect(app).toContain('onListen={() => {}} onSay={sayBack} busy={voiceBusy}');
    const skips = app.match(/onSkip=\{[^}]*\}/gu) ?? [];
    expect(skips).toEqual(["onSkip={roomBusy ? undefined : skipVoice}"]);
  });
});

describe("the captions go with the sound", () => {
  it("stopsAt: the line he is on stops at the end of its sentence, the ones he owes at nothing", () => {
    const text = "Do you hear that hum? That is me. All of me.";
    const ends = revealOffsets(text, splitSentences(text));
    expect(stopsAt(new Map([[7, ends], [8, [10, 20]]]), { id: 7, index: 1 })).toEqual(new Map([[7, ends[1]!], [8, 0]]));
    expect(stopsAt(new Map([[8, [10]]]), null)).toEqual(new Map([[8, 0]]));
    expect(stopsAt(new Map(), { id: 3, index: 0 })).toEqual(new Map());
  });

  const his = (seq: number, text: string): Line => ({ seq, from: "Trabolta", text, ts: "0", kind: "line", channel: "dm:Trabolta", theirs: true }) as unknown as Line;
  const thread = (o: { cutOff: ReadonlyMap<number, number>; revealed?: ReadonlyMap<number, number>; typeCps?: number | null }) =>
    renderToStaticMarkup(createElement(Thread, { lines: [his(1, "Do you hear that hum? That is me."), his(2, "All of me.")], revealed: o.revealed ?? new Map(), cutOff: o.cutOff, typing: false, character: "Trabolta", guestName: "Ada", typeCps: o.typeCps ?? null }));

  it("the plain thread: the cut line stops where he stopped, a line he never started isn't drawn, nothing says he's typing", () => {
    const html = thread({ cutOff: new Map([[1, 21], [2, 0]]) });
    expect(html).toContain("Do you hear that hum?");
    expect(html).not.toContain("That is me.");
    expect(html).not.toContain("All of me.");
    expect(html).not.toContain("cursor");
    expect(html).not.toContain("partial");
    expect(html).not.toContain("typing");
    expect(html).not.toContain('data-seq="2"');
  });

  it("a thread no door has touched draws as it always has", () => {
    const whole = thread({ cutOff: new Map() });
    expect(whole).toContain("That is me.");
    expect(whole).toContain("All of me.");
    expect(thread({ cutOff: new Map(), revealed: new Map([[1, 21]]) })).toContain("cursor");
  });

  it("the CRT: a halted line types no further and draws no cursor", () => {
    const html = renderToStaticMarkup(createElement(Typed, { text: "Close the door.", cut: 6, cps: 30, halt: true }));
    expect(html).toContain("Close ");
    expect(html).not.toContain("the door");
    expect(html).not.toContain("cursor");
    const running = renderToStaticMarkup(createElement(Typed, { text: "Close the door.", cut: 6, cps: 30 }));
    expect(running).toContain("cursor");
  });

  it("the CRT's thread halts the line the door cut", () => {
    const html = thread({ cutOff: new Map([[1, 21]]), typeCps: 30 });
    expect(html).toContain("Do you hear that hum?");
    expect(html).not.toContain("cursor");
  });
});
