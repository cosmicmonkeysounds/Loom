//! The house desk's pure contract (wave 25, `src/house-desk.ts`): the
//! `desk.json` schema, the parallel / series timeline, the run state machine
//! the server drives, the checks and the status strip both screens draw.

import { describe, expect, it } from "vitest";

import {
  DESK_ACK_MS,
  DESK_STOP_MS,
  beginRun,
  checkProgress,
  cueAfter,
  cueEvents,
  cueTimeline,
  deskChecks,
  deskEvents,
  deskGroups,
  deskHash,
  deskSections,
  deskSetup,
  deskStatus,
  nextOpenCheck,
  runProgress,
  runWakeAt,
  stepEnded,
  stepLength,
  stepStarted,
  stepText,
  stepTiming,
  stopRun,
  tickRun,
  validateDesk,
  type DeskConfig,
  type DeskCue,
  type DeskHouse,
  type DeskRun,
} from "../src/house-desk.ts";

const heart: DeskCue = {
  id: "heart_reveal",
  name: "The Heart wakes",
  section: "The Heart",
  done: "heart_reveal_done",
  steps: [
    { kind: "look", look: "heart_wake" },
    { kind: "sound", sound: "server_hum", to: ["The Server Room"], start: "with", wait: 500 },
    { kind: "event", event: "heart_speaks" },
    { kind: "speech", room: "The Server Room", start: "with" },
    { kind: "look", look: "heart_listen" },
  ],
};

const desk: DeskConfig = { version: 1, cues: [{ id: "walk_in", number: "1", name: "Walk-in", section: "Pre-show", steps: [{ kind: "sound", sound: "modem_handshake" }] }, heart, { id: "all_stop", name: "Stop everything", steps: [{ kind: "stop", announce: true }] }] };

describe("validateDesk", () => {
  it("takes the show-shaped desk", () => {
    const v = validateDesk(desk, { looks: ["heart_wake", "heart_listen"], rooms: ["The Server Room"], events: ["heart_speaks", "heart_reveal_done"], sounds: ["modem_handshake", "server_hum"] });
    expect(v).toEqual({ ok: true, problems: [], warnings: [] });
  });

  it("refuses the shapes that can't run", () => {
    const bad = {
      version: 1,
      cues: [
        { id: "Bad Id", name: "x", steps: [] },
        { id: "dup", name: "a", steps: [{ kind: "wait", ms: -1 }] },
        { id: "dup", name: "b", steps: [{ kind: "flash" }] },
        { id: "room_x", name: "reserved", steps: [{ kind: "say", text: "" }] },
        { id: "heart_wake", name: "same as a look", steps: [{ kind: "light", to: [], set: {} }] },
        { id: "gain", name: "loud", steps: [{ kind: "sound", sound: "zip", gain: 40, extra: 1 }] },
        { id: "where", name: "speech", steps: [{ kind: "speech", room: "Narnia" }, { kind: "look", look: "nope", start: "sideways" }] },
      ],
    };
    const v = validateDesk(bad, { looks: ["heart_wake"], rooms: ["The Server Room"] });
    expect(v.ok).toBe(false);
    const all = v.problems.join("\n");
    for (const bit of ["cues[0]: id must match", "cue dup: the id is used twice", "cue dup step 1: ms must be whole ms", "kind must be one of", "screens' cues", "text must be what to say", "a lights look has this name too", "to must name some lights", "gain must be -60 to 12 dB", "a sound step has no extra", "no LOCATION Narnia", "lights.json has no look nope", 'start must be "with" or "after"']) expect(all).toContain(bit);
  });

  it("warns about what may still work", () => {
    const v = validateDesk({ version: 1, cues: [{ id: "a", name: "A", steps: [], done: "nobody_hears" }, { id: "b", name: "B", steps: [{ kind: "sound", sound: "announce_chime" }, { kind: "sound", sound: "kazoo", to: ["Attic"] }, { kind: "event", event: "ghost" }] }] }, { sounds: ["zip"], events: [], audioTargets: ["everywhere", "living"] });
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual([
      "cue a: no `when nobody_hears:` in the story hears its done event",
      "cue a: no steps (GO does nothing)",
      "cue b step 1: announce_chime rings with the announcements; a say step rings it",
      "cue b step 2: kazoo is not one of the story's sounds (fine if the router's machine has the file)",
      "cue b step 2: no speaker, zone or room is called Attic",
      "cue b step 3: no `when ghost:` in the story hears it",
    ]);
  });

  it("passes light states to the injected check", () => {
    const v = validateDesk({ version: 1, cues: [{ id: "a", name: "A", steps: [{ kind: "light", to: ["heart"], set: { brightness: 999 } }] }] }, { lightTargets: ["heart"], lightStateProblems: (at) => [`${at}: brightness out of range`] });
    expect(v.problems).toEqual(["cue a step 1 set: brightness out of range"]);
  });

  it("matches target names folded", () => {
    const v = validateDesk({ version: 1, cues: [{ id: "a", name: "A", steps: [{ kind: "light", to: ["server_room RGB"], set: { state: "ON" } }, { kind: "speech", room: "the server room" }] }] }, { lightTargets: ["server-room-rgb"], rooms: ["The Server Room"] });
    expect(v.problems).toEqual([]);
  });

  it("hashes stably", () => {
    expect(deskHash(desk)).toMatch(/^[0-9a-f]{8}$/u);
    expect(deskHash(desk)).toBe(deskHash(JSON.parse(JSON.stringify(desk)) as DeskConfig));
  });
});

describe("events, sections, playhead", () => {
  it("lists the story events a desk fires", () => {
    expect(deskEvents(desk)).toEqual(["heart_reveal_done", "heart_speaks"]);
    expect(cueEvents(heart)).toEqual(["heart_speaks", "heart_reveal_done"]);
  });

  it("groups the list under sections", () => {
    expect(deskSections(desk).map((s) => [s.title, s.cues.map((c) => c.id)])).toEqual([
      ["Pre-show", ["walk_in"]],
      ["The Heart", ["heart_reveal", "all_stop"]],
    ]);
  });

  it("moves the playhead down the list", () => {
    expect(cueAfter(desk, null)).toBe("walk_in");
    expect(cueAfter(desk, "walk_in")).toBe("heart_reveal");
    expect(cueAfter(desk, "all_stop")).toBe(null);
    expect(cueAfter({ version: 1, cues: [] }, null)).toBe(null);
  });
});

describe("the timeline", () => {
  it("groups with-steps under the step before", () => {
    expect(deskGroups(heart)).toEqual([[0, 1], [2, 3], [4]]);
    expect(deskGroups({ steps: [{ kind: "wait", ms: 1, start: "with" }] })).toEqual([[0]]);
  });

  it("plans starts and ends as far as known", () => {
    const t = cueTimeline(heart, { lookMs: (l) => (l === "heart_wake" ? 2000 : 0), soundMs: () => 4000 });
    expect(t.steps.map((s) => [s.i, s.group, s.start, s.end])).toEqual([
      [0, 0, 0, 2000],
      [1, 0, 500, 4500],
      [2, 1, 4500, 4500],
      [3, 1, 4500, null],
      [4, 2, null, null],
    ]);
    expect(t.end).toBe(null);
    const fixed = cueTimeline({ steps: [{ kind: "wait", ms: 1000 }, { kind: "stop" }, { kind: "light", to: ["x"], set: { state: "ON", transition: 2 }, start: "with", wait: 100 }] });
    expect(fixed.end).toBe(1000 + 2100);
    expect(fixed.steps[1]!.end).toBe(1000 + DESK_STOP_MS);
  });
});

describe("a run", () => {
  /** Drive a run like the hub: tick until nothing starts, playing each step. */
  function drive(run: DeskRun, cue: DeskCue, now: number, play: (i: number) => number): { run: DeskRun; started: number[]; finished: boolean } {
    const started: number[] = [];
    let finished = false;
    for (;;) {
      const t = tickRun(run, cue, now);
      run = t.run;
      finished ||= t.finished;
      if (t.start.length === 0) break;
      for (const i of t.start) {
        started.push(i);
        run = stepStarted(run, i, play(i));
      }
    }
    return { run, started, finished };
  }

  it("plays groups in series and steps in parallel, then finishes once", () => {
    let run = beginRun(heart, 1, "Task Manager", "desk", 1000);
    expect(run.steps.map((s) => s.state)).toEqual(["waiting", "waiting", "pending", "pending", "pending"]);
    // t=1000: the look starts; the hum waits 500 ms.
    let r = drive(run, heart, 1000, (i) => (i === 0 ? 3000 : 0));
    expect(r.started).toEqual([0]);
    expect(runWakeAt(r.run)).toBe(1500);
    // t=1500: the hum starts with no known length (a deadline only).
    r = drive(r.run, heart, 1500, () => 1500 + DESK_ACK_MS);
    expect(r.started).toEqual([1]);
    // The router answers: 4 s long.
    run = stepLength(r.run, 1, 4000, "played");
    expect(run.steps[1]!.endAt).toBe(5500);
    // t=3000: the look ended; the hum hasn't: the group holds.
    r = drive(run, heart, 3000, () => 0);
    expect(r.started).toEqual([]);
    expect(r.run.steps[0]!.state).toBe("ended");
    // t=5500: the hum ends → the event and the speech wait start together.
    r = drive(r.run, heart, 5500, (i) => (i === 2 ? 5500 : 5500 + 30_000));
    expect(r.started).toEqual([2, 3]);
    expect(r.run.group).toBe(1);
    // A terminal fell quiet at 9000: the last look starts.
    r = drive(stepEnded(r.run, 3, 9000, "said"), heart, 9000, () => 9000);
    // An instant last step: the run finishes in the same tick loop.
    expect(r.started).toEqual([4]);
    expect(r.finished).toBe(true);
    expect(r.run.state).toBe("done");
    expect(r.run.steps.map((s) => s.result)).toEqual([undefined, "played", undefined, "said", undefined]);
    // Never twice.
    expect(tickRun(r.run, heart, 10_000).finished).toBe(false);
  });

  it("times out a step only the router or a terminal could end", () => {
    const cue: DeskCue = { id: "s", name: "S", steps: [{ kind: "speech", room: "X", max: 2000 }, { kind: "wait", ms: 10 }] };
    let r = tickRun(beginRun(cue, 2, "x", "story", 0), cue, 0);
    let run = stepStarted(r.run, 0, 2000);
    r = tickRun(run, cue, 2000);
    expect(r.run.steps[0]!.result).toBe("timeout");
    expect(r.start).toEqual([1]);
    run = stepStarted(r.run, 1, 2010);
    expect(tickRun(run, cue, 2010).run.steps[1]!.result).toBe(undefined);
  });

  it("stops: nothing more starts, done never fires", () => {
    let r = tickRun(beginRun(heart, 3, "x", "desk", 0), heart, 0);
    const run = stopRun(stepStarted(r.run, 0, 5000), 100);
    expect(run.state).toBe("stopped");
    expect(run.steps.map((s) => s.state)).toEqual(["ended", "skipped", "skipped", "skipped", "skipped"]);
    r = tickRun(run, heart, 10_000);
    expect(r).toEqual({ run, start: [], finished: false });
    expect(runWakeAt(run)).toBe(null);
    expect(runProgress(run, 200)).toBe(1);
  });

  it("an empty cue is done at once", () => {
    const run = beginRun({ id: "e", name: "E", steps: [] }, 4, "x", "desk", 7);
    expect(run.state).toBe("done");
    expect(run.endedAt).toBe(7);
  });

  it("reports progress off the known ends", () => {
    const cue: DeskCue = { id: "w", name: "W", steps: [{ kind: "wait", ms: 1000 }] };
    const run = stepStarted(tickRun(beginRun(cue, 5, "x", "desk", 0), cue, 0).run, 0, 1000);
    expect(runProgress(run, 250)).toBe(0.25);
  });
});

describe("words", () => {
  it("says each step in a line", () => {
    expect(heart.steps.map(stepText)).toEqual(["💡 look heart_wake", "🔊 server_hum → The Server Room", "⚡ story: heart_speaks", "🗣 until The Server Room has said its lines", "💡 look heart_listen"]);
    expect(stepText({ kind: "sound", sound: "zip", gain: -6 })).toBe("🔊 zip → as the story routes it (−6 dB)");
    expect(stepText({ kind: "say", text: "Doors in five", chime: false })).toBe("📢 “Doors in five” → the announcement speakers (no chime)");
    expect(stepText({ kind: "light", to: ["heart"], set: { state: "ON", color: "#ff0000", brightness: 127, transition: 2 } })).toBe("💡 heart: on #ff0000 50% over 2 s");
    expect(stepText({ kind: "wait", ms: 125_000 })).toBe("⏱ 2:05");
    expect(heart.steps.map(stepTiming)).toEqual(["", "with ↑ +0.5 s", "then", "with ↑", "then"]);
  });
});

const house: DeskHouse = {
  router: { online: true, lastSeen: 1, name: "macbook" },
  health: { at: 1, ok: true, device: "828x", layout: "ok", voices: 0, xruns: 0, peakDb: null, announce: "on", missing: ["zip"], placeholders: ["rave"], files: 3 },
  speakers: [
    { id: "living-l", name: "Living left", room: "desktop", roomName: "The Desktop", out: [1] },
    { id: "living-r", name: "Living right", room: "desktop", roomName: "The Desktop", out: [2] },
  ],
  outputs: [
    { ch: 1, label: "Analog 1" },
    { ch: 2, label: "Analog 2" },
    { ch: 3, label: "Analog 3" },
  ],
  zones: [{ id: "living", name: "Living", speakers: ["living-l", "living-r"] }],
  sounds: [
    { name: "rave", to: null, file: "placeholder", ms: 1500 },
    { name: "zip", to: ["living-l"], file: "missing", ms: null },
  ],
  audioTargets: ["everywhere", "living"],
  lightsModule: { online: false, lastSeen: 5, name: null },
  fixtures: [{ id: "server-room-rgb", name: "Server room RGB bulb", room: "server-room", roomName: "Server Room", kind: "zigbee", caps: { color: true, ct: true, dim: true }, safety: true, device: "server_room_rgb", inZ2m: false }],
  lightZones: [],
  looks: [{ name: "heart_wake", to: ["heart"], ms: 2400, loop: false }],
  lightTargets: ["everywhere", "heart", "server-room-rgb"],
  pairUntil: null,
  rooms: ["The Server Room"],
  events: [],
};

describe("the checks", () => {
  const sections = deskChecks({ house, marks: { "speaker:living-l": { mark: "ok", by: "Task Manager", at: 3 }, "out:3": { mark: "bad", by: "Director", at: 4 } } });

  it("walks every speaker, output, sound, light and look", () => {
    expect(sections.map((s) => [s.id, s.rows.map((r) => r.key)])).toEqual([
      ["speakers", ["speaker:living-l", "speaker:living-r"]],
      ["outputs", ["out:1", "out:2", "out:3"]],
      ["sounds", ["sound:rave", "sound:zip"]],
      ["lights", ["fixture:server-room-rgb"]],
      ["looks", ["look:heart_wake"]],
    ]);
    const rows = sections.flatMap((s) => s.rows);
    const row = (k: string) => rows.find((r) => r.key === k)!;
    expect(row("speaker:living-l").test).toEqual({ route: "/api/mod/audio/test", body: { speaker: "living-l" } });
    expect(row("out:3").detail).toBe("Analog 3 · no speaker");
    expect(row("sound:zip")).toMatchObject({ detail: "→ Living left", test: { route: "/api/mod/audio/play", body: { sound: "zip" } }, hints: ["no file on the router's machine"] });
    expect(row("sound:rave").hints).toEqual(["still the placeholder"]);
    expect(row("look:heart_wake")).toMatchObject({ detail: "heart · 2.4 s", test: { route: "/api/mod/lights/test", body: { look: "heart_wake" } }, hints: ["the lights module is offline"] });
    const bulb = row("fixture:server-room-rgb");
    expect(bulb.hints).toEqual(["the lights module is offline", "Zigbee2MQTT has no device server_room_rgb", "safety light: never fully off"]);
    // A safety light is never offered Off.
    expect(bulb.extra.map((e) => e.label)).toEqual(["Red", "Green", "Blue", "White", "Dim"]);
    expect(bulb.extra[0]!.test).toEqual({ route: "/api/mod/lights/test", body: { fixture: "server-room-rgb", set: { state: "ON", color: "#ff0000", brightness: 254 } } });
  });

  it("counts and finds the next open check", () => {
    expect(checkProgress(sections)).toEqual({ ok: 1, bad: 1, open: 7, total: 9 });
    expect(nextOpenCheck(sections, null)!.key).toBe("speaker:living-r");
    expect(nextOpenCheck(sections, "out:2")!.key).toBe("sound:rave");
    expect(nextOpenCheck(sections, "look:heart_wake")!.key).toBe("speaker:living-r");
    expect(nextOpenCheck([], null)).toBe(null);
  });

  it("names the router away on every audio row", () => {
    const away = deskChecks({ house: { ...house, router: { online: false, lastSeen: null, name: null } }, marks: {} });
    expect(away[0]!.rows[0]!.hints).toEqual(["the sound router has never connected"]);
  });
});

describe("the status strip", () => {
  it("says what is up and what is wrong", () => {
    expect(deskStatus({ house, problems: ["x"] }).map((c) => [c.kind, c.tone, c.text])).toEqual([
      ["router", "ok", "🔊 router online (macbook) · 828x"],
      ["files", "bad", "1 sound missing"],
      ["files", "warn", "1 placeholder"],
      ["lights", "bad", "💡 lights offline"],
      ["z2m", "bad", "1 light not in Zigbee2MQTT"],
      ["problems", "bad", "desk.json: 1 problem"],
    ]);
    const quiet = deskStatus({ house: { ...house, health: null, router: { online: false, lastSeen: null, name: null }, fixtures: [], looks: [] }, problems: [] });
    expect(quiet).toEqual([{ kind: "router", tone: "bad", text: "🔊 router never connected" }]);
  });

  it("names each outside mind, connected or not (wave 30)", () => {
    const minds = [
      { character: "Trabolta", name: "Trabolta", online: true, workers: ["macbook"] },
      { character: "Echo", name: "Echo", online: false, workers: [] },
    ];
    const chips = deskStatus({ house: { ...house, minds }, problems: [] }).filter((c) => c.kind === "mind");
    expect(chips).toEqual([
      { kind: "mind", tone: "ok", text: "🧠 Trabolta online (macbook)" },
      { kind: "mind", tone: "bad", text: "🧠 Echo: no mind connected" },
    ]);
  });
});

describe("setup (wave 30)", () => {
  const at = 100_000;
  const row = (rows: ReturnType<typeof deskSetup>, id: string) => rows.find((r) => r.id === id)!;

  it("says what is wrong with the sound and what to do", () => {
    const rows = deskSetup({ house, now: at });
    const sound = row(rows, "sound");
    expect(sound).toMatchObject({ title: "🔊 Sound", tone: "bad", status: "Online on macbook · 828x · 3 sound files" });
    expect(sound.fix[0]).toMatch(/^1 story sound with no file: zip\. Put each file in stagehand\/media\/sounds\//u);
    expect(sound.fix[1]).toBe("1 sound still the generated placeholder: rave.");
  });

  it("starts the router when it never connected, and names the moved layout", () => {
    const never = row(deskSetup({ house: { ...house, router: { online: false, lastSeen: null, name: null }, health: null, sounds: [] }, now: at }), "sound");
    expect(never.tone).toBe("bad");
    expect(never.status).toBe("The sound router has not connected to this event");
    expect(never.fix.join(" ")).toContain("start-stagehand.ps1 -Restart audio");
    const quiet = row(deskSetup({ house: { ...house, router: { online: false, lastSeen: at - 120_000, name: "desktop" }, sounds: [] }, now: at }), "sound");
    expect(quiet.status).toBe("The sound router went quiet 2 min ago");
    const moved = row(deskSetup({ house: { ...house, health: { ...house.health!, layout: "moved" }, sounds: [] }, now: at }), "sound");
    expect(moved.fix).toEqual(["The interface shows other channel counts than audio.json expects: turn on and clock the ADAT expander, then restart the audio job."]);
    const fine = row(deskSetup({ house: { ...house, sounds: [] }, now: at }), "sound");
    expect(fine).toEqual({ id: "sound", title: "🔊 Sound", tone: "ok", status: "Online on macbook · 828x · 3 sound files · 2 speakers", fix: [] });
  });

  it("lights: the module, unknown devices, and a WLED strip", () => {
    const off = row(deskSetup({ house, now: at }), "lights");
    expect(off.tone).toBe("bad");
    expect(off.status).toBe("The lights module went quiet 2 min ago");
    expect(off.fix[1]).toBe("Zigbee2MQTT doesn't know Server room RGB bulb (server_room_rgb): pair it, then rename it in Zigbee2MQTT to exactly that friendly name.");
    const strip = { ...house.fixtures[0]!, id: "tube", name: "Tube strip", kind: "wled", device: "wled/tube", inZ2m: null };
    const on = row(deskSetup({ house: { ...house, lightsModule: { online: true, lastSeen: at, name: "desktop" }, fixtures: [{ ...house.fixtures[0]!, inZ2m: true }, strip], pairUntil: at + 30_000 }, now: at }), "lights");
    expect(on).toEqual({ id: "lights", title: "💡 Lights", tone: "ok", status: "Online on desktop · 1 Zigbee light · 1 WLED strip · 1 look · pairing open 30 s", fix: [] });
    const none = row(deskSetup({ house: { ...house, fixtures: [], looks: [] }, now: at }), "lights");
    expect(none).toMatchObject({ tone: "warn", status: "No lights yet" });
  });

  it("one row per outside mind (none from an older server)", () => {
    expect(deskSetup({ house, now: at }).map((r) => r.id)).toEqual(["sound", "lights"]);
    const minds = [
      { character: "Trabolta", name: "Trabolta", online: true, workers: ["macbook"] },
      { character: "Echo", name: "Echo", online: false, workers: [] },
    ];
    const rows = deskSetup({ house: { ...house, minds }, now: at });
    expect(row(rows, "mind:Trabolta")).toEqual({ id: "mind:Trabolta", title: "🧠 Trabolta", tone: "ok", status: "Online on macbook", fix: [] });
    expect(row(rows, "mind:Echo").tone).toBe("bad");
    expect(row(rows, "mind:Echo").fix[0]).toContain("ollama ps");
  });
});
