// node --experimental-strip-types --no-warnings --test scripts/show/test/checks.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { agentChecks, agentsBeforeDoorsCheck, audioCheck, beforeDoors, mixerChecks, soundtrackChecks, dreamMediaCheck, healthCheck, joinBaseCheck, judgeCheck, lightsCheck, metricsCheck, peopleChecks, runCheck, screenChecks, stationsCheck, terminalChecks, terminalVerdict } from "../lib/checks.ts";

const level = (name: string, rows: { name: string; level: string }[]) => rows.find((r) => r.name === name)?.level;

test("health: green with the control plane, amber in LAN mode, red with the boot's reason and what to do", () => {
  assert.equal(healthCheck(200, { ok: true, controlPlane: true, events: 2 }).level, "ok");
  assert.equal(healthCheck(200, { ok: true, controlPlane: false, events: 1 }).level, "warn");
  assert.match(healthCheck(200, { ok: true, controlPlane: true, events: 2, failed: ["e1"] }).detail, /1 failed to load/u);
  const db = healthCheck(503, { ok: false, reason: "database" });
  assert.equal(db.level, "fail");
  assert.match(db.detail, /^database — Postgres unreachable/u);
  assert.equal(healthCheck(null, null, "can't reach").detail, "can't reach");
  assert.equal(healthCheck(503, { ok: false, reason: "starting" }).read, "GET /api/health");
});

test("the run: open is green, paused before the doors and idle are amber, no story is red; live = advertised on /", () => {
  assert.equal(runCheck({ phase: "open", scenario: "s" }, "T", "T")[0]!.level, "ok");
  assert.match(runCheck({ phase: "open", scenario: "s" }, "T", "T")[1]!.detail, /^LIVE/u);
  assert.match(runCheck({ phase: "open", scenario: "s" }, "T", null)[1]!.detail, /not advertised/u);
  const paused = runCheck({ phase: "paused", scenario: "s", doorsClosed: true }, "T", null)[0]!;
  assert.equal(paused.level, "warn");
  assert.match(paused.detail, /Power On waits/u);
  assert.equal(runCheck({ phase: "idle", scenario: "s" }, "T", null)[0]!.level, "warn");
  assert.equal(runCheck({ phase: "open", scenario: null }, "T", null)[0]!.level, "fail");
});

test("people: personas and load-test bots are not guests; a dropped booth is amber", () => {
  const rows = peopleChecks({
    roster: [
      { id: "g-1", name: "Winamp", online: true },
      { id: "g-2", name: "Excel", gone: true, captured: true },
      { id: "p-ab", name: "Ivo" },
      { id: "g-3", name: "K32 Bot a 01" },
    ],
    cast: [
      { id: "Clippy", part: true, online: true },
      { id: "Norton", part: true, held: true },
      { id: "Kernel", part: false },
    ],
    modsOnline: 2,
    directors: ["John", "Steph"],
  });
  assert.match(rows[0]!.detail, /^2 real guest\(s\) · 1 online · 1 gone home · 1 captured · 0 restricted · 2 persona/u);
  assert.equal(rows[1]!.level, "warn");
  assert.match(rows[1]!.detail, /1\/2 parts streaming \(Clippy\) · phone dropped: Norton/u);
  assert.match(rows[2]!.detail, /2 console\(s\): John, Steph/u);
});

test("Trabolta's worker: offline / stalled are red, a 40 s wait or a classic mind amber", () => {
  const now = 1_000_000;
  const view = (c: Record<string, unknown>, mind?: Record<string, unknown>) => ({ cast: [{ id: "Trabolta", agent: true, ...c }], minds: mind ? [{ character: "Trabolta", ...mind }] : [] });
  assert.equal(agentChecks(view({ online: false }), now)[0]!.level, "fail");
  assert.equal(agentChecks(view({ online: true, agentQueue: { depth: 1, oldestMs: 2000, stalled: true } }), now)[0]!.level, "fail");
  assert.equal(agentChecks(view({ online: true, agentQueue: { depth: 3, oldestMs: 45_000, stalled: false } }, { mode: "new" }), now)[0]!.level, "warn");
  const ok = agentChecks(view({ online: true, agentQueue: { depth: 0, oldestMs: null, stalled: false } }, { mode: "new", phase: "hunt_1", worker: "laptop", updatedAt: (now - 3000) / 1000 }), now)[0]!;
  assert.equal(ok.level, "ok");
  assert.match(ok.detail, /mind new · hunt_1 · worker "laptop" · mind last changed 3 s ago/u);
  assert.equal(agentChecks(view({ online: true }, { mode: "classic" }), now)[0]!.level, "warn");
  assert.deepEqual(agentChecks({ cast: [{ id: "Clippy" }] }, now), [], "no agent, no row");
});

test("before the doors: the worker and the judge are info, never a false amber", () => {
  const closed = { phase: "idle", cast: [], roster: [] };
  assert.ok(beforeDoors(closed));
  assert.ok(beforeDoors({ phase: "paused", doorsClosed: true, cast: [], roster: [] }));
  assert.ok(!beforeDoors({ phase: "open", cast: [], roster: [] }));
  assert.equal(judgeCheck(closed).level, "info");
  assert.match(judgeCheck(closed).detail, /once the doors open/u);
  assert.equal(judgeCheck({ phase: "open", cast: [{ id: "Clippy" }] }).level, "warn", "open with no facts.json is still amber");
  const none = agentsBeforeDoorsCheck(null, 10_000);
  assert.equal(none.level, "info");
  assert.match(none.detail, /no worker has reported a mind/u);
  const one = agentsBeforeDoorsCheck({ minds: [{ character: "Trabolta", worker: "laptop", mode: "new", updatedAt: 4 }] }, 10_000);
  assert.match(one.detail, /Trabolta by worker "laptop" \(mind new\), last changed 6 s ago/u);
});

test("the judge: no facts.json amber, a judge stall red", () => {
  assert.equal(judgeCheck({}).level, "warn");
  assert.equal(judgeCheck({ facts: { mode: "auto", pending: 2, judge: "Trabolta" }, cast: [{ id: "Trabolta", agentQueue: { judging: { queued: 1, out: 1, oldestMs: 5000, stalled: false } } }] }).level, "ok");
  const stalled = judgeCheck({ facts: { mode: "auto", pending: 2, judge: "Trabolta" }, cast: [{ id: "Trabolta", agentQueue: { judging: { queued: 3, out: 1, oldestMs: 80_000, stalled: true } } }] });
  assert.equal(stalled.level, "fail");
  assert.match(stalled.detail, /rulings 3 queued · 1 out · oldest 80 s · JUDGE STALLED/u);
});

test("a terminal: silent after silentMs is red; not full screen, locked sound, a low battery amber; a door fault red", () => {
  assert.equal(terminalVerdict({ ago: 21_000 }, 20_000).level, "fail");
  assert.equal(terminalVerdict({ ago: 2_000, fullscreen: true, audio: true }, 20_000).level, "ok");
  assert.equal(terminalVerdict({ ago: 2_000, fullscreen: false }, 20_000).level, "warn");
  assert.equal(terminalVerdict({ ago: 2_000, audio: false }, 20_000).level, "warn");
  assert.equal(terminalVerdict({ ago: 2_000, battery: 12, charging: false }, 20_000).level, "warn");
  assert.equal(terminalVerdict({ ago: 2_000, battery: 12, charging: true }, 20_000).level, "ok");
  assert.equal(terminalVerdict({ ago: 2_000, mic: "denied" }, 20_000).level, "warn");
  const fault = terminalVerdict({ ago: 2_000, door: "fault", doorFault: "led_dead" }, 20_000);
  assert.equal(fault.level, "fail");
  assert.ok(fault.notes.some((n) => n.startsWith("🚪 FAULT led_dead")));
  assert.ok(terminalVerdict({ ago: 2_000, door: "closed", doorLevel: 2100 }, 20_000).notes.includes("🚪 shut 2100"));
  assert.equal(terminalVerdict({ ago: 2_000, door: "open", doorWarn: "ldr_open" }, 20_000).level, "warn");
  assert.equal(terminalVerdict({ ago: 2_000, patch: "fault", patchFault: "stale" }, 20_000).level, "fail");
  assert.ok(terminalVerdict({ ago: 2_000, patch: 4, patchComplete: true }, 20_000).notes.includes("🔌 4 ✓"));
});

test("terminals: a key spot nobody polls is red, a wall spot only info; builds that disagree amber; the TV mute amber", () => {
  const spots = [
    { id: "desktop-tv", name: "TV" },
    { id: "tent", name: "Tent" },
    { id: "hall", name: "Hall" },
  ];
  const rows = terminalChecks({ silentMs: 20_000, voiceMuted: true, terminals: [{ name: "TV", spot: "desktop-tv", view: "tv", ago: 1000, version: "a" }, { name: "Spare", spot: "", ago: 1000, version: "b" }] }, spots);
  assert.equal(level("📟 TV", rows), "ok");
  assert.equal(level("📟 Tent", rows), "fail");
  assert.equal(level("📟 Hall", rows), undefined, "wall spots fold into one row");
  assert.match(rows.find((r) => r.name === "Wall spots")!.detail, /no terminal on 1 map spot\(s\): hall/u);
  assert.equal(level("Terminal builds", rows), "warn");
  assert.equal(level("TV voice", rows), "warn");
});

test("the screen state: the door / patch-bay overrides are amber; nothing is a heartbeat", () => {
  const rows = screenChecks({ night: { phase: "y2k", server_door: "closed", door_override: true, patch_override: true }, character: { id: "Trabolta", hidden: false, awake: true, online: true }, king: { hp: 3, max: 15, fallen: false, armed: true } });
  assert.equal(level("Door sensor", rows), "warn");
  assert.equal(level("Patch bay", rows), "warn");
  assert.match(rows.find((r) => r.name === "The King")!.detail, /3\/15 · for the code/u);
  assert.ok(rows.every((r) => r.read.includes("no name")));
});

test("the router and the lights: offline is red; the bulb must be paired", () => {
  assert.equal(audioCheck({ router: { online: true, name: "macbook" }, source: "project", problems: [], warnings: [] })[0]!.level, "ok");
  assert.equal(audioCheck({ router: { online: false, lastSeen: null }, problems: ["x"] })[0]!.level, "fail");
  assert.equal(audioCheck({ router: { online: true }, problems: ["speaker out of room"] })[1]!.level, "warn");
  assert.equal(level("Lights module", lightsCheck({ module: null, devices: [], devicesAt: null })), "fail");
  assert.equal(level("Zigbee devices", lightsCheck({ module: { name: "desk", online: true }, devices: [{ friendly: "other" }], devicesAt: 1 })), "fail");
  assert.equal(level("Zigbee devices", lightsCheck({ module: { name: "desk", online: true }, devices: [{ friendly: "server_room_rgb" }], devicesAt: 1 })), "ok");
});

test("stations, load, join links", () => {
  assert.equal(stationsCheck({ stations: [{ id: "q1", name: "Quest 1", online: true }, { id: "q2", name: "Quest 2", online: false }] }).level, "warn");
  assert.equal(stationsCheck({ stations: [] }).level, "info");
  const m = (at: number, us: number, p99 = 20) => ({ at, cpu: { userUs: us, systemUs: 0 }, eventLoop: { p99Ms: p99 }, memory: { rssMb: 300 }, clients: 40, uptimeS: 60 });
  assert.match(metricsCheck(m(0, 0), m(1000, 500_000)).detail, /CPU 50% of one core/u);
  assert.equal(metricsCheck(m(0, 0), m(1000, 900_000)).level, "warn");
  assert.equal(metricsCheck(m(0, 0), m(1000, 0, 250)).level, "warn");
  assert.equal(joinBaseCheck({ joinUrl: "https://app.example.com" }, "https://app.example.com").level, "ok");
  assert.equal(joinBaseCheck({ joinUrl: "http://192.168.1.2:7000" }, "https://app.example.com").level, "fail");
  assert.equal(joinBaseCheck({ joinUrl: "http://localhost:7000" }, "http://127.0.0.1:7000").level, "ok", "a local server may be local");
  assert.ok(!joinBaseCheck({ joinUrl: "https://app.example.com/?code=SECRET" }, "https://app.example.com").detail.includes("SECRET"), "only the origin prints");
});

test("wave 38: the router's soundtrack and its sidechain meters, only when its health carries them", () => {
  const base = { router: { online: true, name: "desktop" }, source: "project", problems: [], warnings: [] };
  // An older server (no health) or router (no music / inputs): no new row.
  assert.deepEqual(soundtrackChecks(base), []);
  assert.deepEqual(soundtrackChecks({ ...base, health: null }), []);
  assert.deepEqual(soundtrackChecks({ ...base, health: { ok: true, voices: 0 } }), []);
  assert.equal(audioCheck(base).length, 1);

  const audio = { inputs: [{ ch: 1, label: "Mic", kind: "mic", role: "clippy", reach: ["living"] }, { ch: 2, label: "x", kind: "mic" }, { ch: 3, label: "TV", kind: "line", role: "trabolta" }] };
  const health = {
    ok: true,
    music: { scene: "act_1", beds: [{ playlist: "act_1", speakers: ["living-l", "living-r"], track: "song-03.mp3", posS: 61 }, { playlist: "fan_closet", speakers: ["fan"], track: null, posS: 0 }], missing: [] },
    inputs: { "1": -52.4, "2": -80, "3": -14.6 },
    sources: { clippy: 0, trabolta: 0.8 },
    underruns: 0,
  };
  const rows = audioCheck({ ...base, audio, health });
  const music = rows.find((r) => r.name === "Soundtrack")!;
  assert.equal(music.level, "info");
  assert.equal(music.detail, "scene act_1 · act_1 on 2 speaker(s) (song-03.mp3); fan_closet on 1 speaker(s)");
  const side = rows.find((r) => r.name === "Sidechain inputs")!;
  // Only the inputs audio.json gives a role, each with its source's activity.
  assert.equal(side.detail, "clippy 1: -52 dBFS (ducking 0%) · trabolta 3: -15 dBFS (ducking 80%)");

  // A playlist with no file or an underrun is amber; no scene and silence read plainly.
  const missing = soundtrackChecks({ ...base, audio, health: { ...health, music: { scene: "doors", beds: [], missing: ["doors"] }, underruns: 3, inputs: { "1": -120 } } });
  assert.equal(missing[0]!.level, "warn");
  assert.match(missing[0]!.detail, /^scene doors · no bed playing · NO FILES for doors .* · 3 underrun\(s\)/u);
  assert.match(missing[1]!.detail, /^clippy 1: silent \(ducking 0%\) · trabolta 3: not metered/u);
  assert.equal(soundtrackChecks({ ...base, health: { music: { scene: null, beds: [], missing: [] } } })[0]!.detail, "no scene yet");
  assert.equal(soundtrackChecks({ ...base, health: { music: { scene: "off", beds: [], missing: [] } } })[0]!.detail, "scene off");
  // No roles in audio.json: every metered input.
  assert.equal(soundtrackChecks({ ...base, health: { inputs: { "1": -30, "3": -20 } } })[0]!.detail, "in 1: -30 dBFS · in 3: -20 dBFS");
});

test("wave 38: the screen state's Night.music", () => {
  const scr = (music: unknown) => screenChecks({ night: { phase: "desktop", music }, terminals: [] }).find((r) => r.name === "Night.music");
  assert.equal(scr("act_1")!.detail, "act_1");
  assert.match(scr(null)!.detail, /^none/u);
  assert.equal(scr(undefined), undefined); // an older server
});

test("wave 40: the house mixer's levels off unity, only when the audio view carries the mix", () => {
  const base = { router: { online: true, name: "desktop" }, source: "project", problems: [], warnings: [] };
  // An older server (no mix): no row, and audioCheck is unchanged.
  assert.deepEqual(mixerChecks(base), []);
  assert.equal(audioCheck(base).length, 1);
  const at = (levels: Record<string, unknown>) => mixerChecks({ ...base, mix: { seq: 3, levels } })[0]!;
  assert.equal(at({}).detail, "every level at unity");
  assert.equal(at({}).level, "info");
  const some = at({ "spk:sub": { db: 4, mute: false }, "room:hall": { db: 0, mute: true }, "src:music": { db: -6, mute: false }, "room:desktop/src:sfx": { db: -3.5, mute: false }, "bogus:key": { db: 1, mute: false } });
  assert.equal(some.level, "info");
  assert.equal(some.detail, "4 levels moved; music -6 dB everywhere; room hall muted; sfx -3.5 dB in desktop; speaker sub +4 dB");
  assert.equal(audioCheck({ ...base, mix: { seq: 1, levels: { master: { db: -2, mute: false } } } }).find((r) => r.name === "Mixer")!.detail, "1 level moved; master -2 dB");
  // Silent everywhere (the TV muted at its own level, the master at the floor): amber.
  const tv = at({ "src:in:trabolta": { db: 0, mute: true } });
  assert.equal(tv.level, "warn");
  assert.match(tv.detail, /^1 level moved; in:trabolta muted everywhere \(silent everywhere/u);
  assert.equal(at({ master: { db: -60, mute: false } }).level, "warn");
  const many = at(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`spk:s${i}`, { db: -1, mute: false }])));
  assert.match(many.detail, /^6 levels moved; .*; \+2 more$/u);
});

test("the dream's media: green when served, amber otherwise, and it names the fix", () => {
  assert.equal(dreamMediaCheck(200).level, "ok");
  assert.equal(dreamMediaCheck(404).level, "warn");
  assert.match(dreamMediaCheck(404).detail, /dream-media\.sh upload/u);
  assert.equal(dreamMediaCheck(null).level, "warn");
});
