//! The Desk window's rules (wave 25, docs/loom-house-desk.md §6.2): the long
//! poll's path, the standby card and GO's refusals, the runs, the cue list,
//! and the checks walked one row at a time; wave 30's Setup, Try it and
//! *How the Desk works*.

import { describe, expect, it } from "vitest";
import {
  DESK_SAY_MAX,
  DESK_WAIT_S,
  END_OF_LIST,
  NO_CUES,
  afterMark,
  cueLabel,
  deskChecks,
  deskCueList,
  deskHow,
  deskPollOutcome,
  deskPollPath,
  eventsLine,
  goRefusal,
  liveAsk,
  markLine,
  markWords,
  progressLine,
  recentLines,
  runRows,
  sayCall,
  sayCount,
  serverNow,
  setupClass,
  setupMark,
  setupOpen,
  setupView,
  standbyCard,
  testNeedsConfirm,
  testWords,
  tryDone,
  tryGroups,
  TRY_OPEN_MAX,
  walkAt,
  walkBack,
  walkNext,
  withMark,
} from "../src/host/desk-model.ts";
import { deskFixture } from "./desk-fixture.ts";
import type { DeskView } from "../../core/src/house-desk.ts";

describe("the desk's long poll", () => {
  it("reads plain first, then holds past the rev it has", () => {
    expect(deskPollPath(null)).toBe("/api/mod/desk");
    expect(deskPollPath(7)).toBe(`/api/mod/desk?after=7&wait=${DESK_WAIT_S}`);
    expect(DESK_WAIT_S).toBeLessThanOrEqual(30);
  });
  it("an answer with a desk is a view; one without keeps the screen; refusals in plain words", () => {
    const v = deskFixture();
    expect(deskPollOutcome(200, v)).toEqual({ kind: "view", view: v });
    expect(deskPollOutcome(200, {})).toEqual({ kind: "same" });
    expect(deskPollOutcome(204, null)).toEqual({ kind: "same" });
    expect(deskPollOutcome(403, { error: "forbidden" })).toEqual({ kind: "error", message: "This booth isn't a host any more." });
    expect(deskPollOutcome(403, { error: "not from a booth" }).kind).toBe("error");
    expect(deskPollOutcome(403, { error: "not from a booth" })).not.toEqual({ kind: "error", message: "This booth isn't a host any more." });
    expect(deskPollOutcome(404, { error: "unknown event" })).toEqual({ kind: "error", message: "That event has ended." });
    expect(deskPollOutcome(404, { error: "not found" }).kind).toBe("error");
    expect(deskPollOutcome(500, { error: "boom" })).toEqual({ kind: "error", message: "boom" });
  });
  it("the server's clock ticks on from its answer", () => {
    expect(serverNow({ now: 100_000 }, 5_000, 6_500)).toBe(101_500);
    expect(serverNow({ now: 100_000 }, 5_000, 4_000)).toBe(100_000);
  });
});

describe("the standby card", () => {
  it("names the cue, its steps in words, its notes, its length and the story events beside GO", () => {
    const c = standbyCard(deskFixture());
    expect(c.label).toBe("12 · The Heart wakes");
    expect(c.notes).toBe("Stand by the door");
    expect(c.steps[0]).toBe("💡 look heart_wake");
    expect(c.steps[1]).toBe("with ↑ +0.5 s 🔊 server_hum → The Server Room");
    expect(c.steps[2]).toBe("then ⚡ story: heart_speaks");
    expect(c.events).toEqual(["heart_speaks", "heart_reveal_done"]);
    expect(eventsLine(c.events)).toBe("⚡ Tells the story: heart_speaks, heart_reveal_done");
    // A speech step's length is only known as it plays.
    expect(c.length).toBeNull();
    expect(c.running).toBe(false);
  });
  it("the end of the list, and an empty desk, say what to do", () => {
    expect(standbyCard(deskFixture({ standby: null })).label).toBe(END_OF_LIST);
    const empty = deskFixture({ standby: null, desk: { version: 1, cues: [] } });
    expect(standbyCard(empty).label).toBe(NO_CUES);
    expect(standbyCard(empty).cue).toBeNull();
  });
  it("a cue still running says so (GO starts it again)", () => {
    expect(standbyCard(deskFixture({ standby: "pre_show" })).running).toBe(true);
    expect(standbyCard(deskFixture({ standby: "pre_show" })).length).toBeNull(); // the hum's file length isn't known
  });
  it("cue labels: the number first when there is one", () => {
    expect(cueLabel({ name: "Doors" })).toBe("Doors");
    expect(cueLabel({ number: " 2.5 ", name: "Doors" })).toBe("2.5 · Doors");
  });
  it("GO's refusals in plain words", () => {
    expect(goRefusal(409, "moved")).toBe("Standby moved — press GO again");
    expect(goRefusal(409, "end")).toMatch(/last cue/u);
    expect(goRefusal(404, "no such cue")).toMatch(/isn't on the desk/u);
    expect(goRefusal(500, "boom")).toBe("Not done — boom");
  });
});

describe("the cue list", () => {
  it("groups by section, marks standby and running, and sums each cue", () => {
    const list = deskCueList(deskFixture());
    expect(list.map((s) => s.title)).toEqual(["Pre-show", "The Heart"]);
    expect(list[0]!.rows.map((r) => r.id)).toEqual(["pre_show", "doors"]);
    expect(list[0]!.rows[0]).toMatchObject({ label: "1 · Pre-show hum", summary: "🔊 server_hum → The Server Room · +1 more", running: true, standby: false });
    expect(list[0]!.rows[1]).toMatchObject({ summary: "📢 “The doors are open” → the announcement speakers", running: false });
    expect(list[1]!.rows[0]).toMatchObject({ standby: true, events: ["heart_speaks", "heart_reveal_done"] });
  });
  it("a known length shows (a wait, a planned look)", () => {
    const v = deskFixture({ desk: { version: 1, cues: [{ id: "a", name: "A", steps: [{ kind: "look", look: "heart_wake" }, { kind: "wait", ms: 2000 }] }] } });
    expect(deskCueList(v)[0]!.rows[0]!.length).toBe("5 s");
  });
});

describe("the runs", () => {
  it("running first with its progress and what plays; an ended one says how and what went wrong", () => {
    const rows = runRows(deskFixture(), 100_000);
    expect(rows.map((r) => r.run)).toEqual([3, 2]);
    expect(rows[0]).toMatchObject({ running: true, line: "part 1 of 2 · 🔊 server_hum → The Server Room", by: "Director" });
    expect(rows[0]!.progress).toBeCloseTo(0.5);
    expect(rows[1]).toMatchObject({ running: false, line: "✓ done", progress: 1 });
    expect(rows[1]!.trouble).toEqual(["no-file: 📢 “The doors are open” → the announcement speakers"]);
  });
});

describe("walking the checks", () => {
  const sections = deskChecks(deskFixture());
  it("starts on the first row with no mark, and knows its place", () => {
    const w = walkAt(sections, null);
    expect(w.row?.key).toBe("speaker:server_spk");
    expect(w.section).toBe("Speakers");
    expect([w.at, w.total]).toEqual([2, 6]);
    expect(w.progress).toMatchObject({ ok: 1, open: 5, total: 6 });
    expect(w.done).toBe(false);
    expect(walkAt(sections, "look:heart_wake").row?.label).toBe("heart_wake");
    expect(walkAt([], null)).toMatchObject({ row: null, total: 0 });
  });
  it("a mark moves the walk to the next open row; next skips marked rows; back steps one", () => {
    expect(afterMark(sections, "speaker:server_spk", "ok", "me", 0)).toBe("out:1");
    expect(walkNext(sections, "speaker:server_spk")).toBe("out:1");
    expect(walkNext(sections, "look:heart_wake")).toBe("speaker:server_spk"); // wraps past the marked one
    expect(walkBack(sections, "speaker:server_spk")).toBe("speaker:living_l");
    expect(walkBack(sections, "speaker:living_l")).toBe("look:heart_wake");
  });
  it("with every row marked the walk is done, and next still moves", () => {
    let all = sections;
    for (const r of sections.flatMap((s) => s.rows)) all = withMark(all, r.key, { mark: "ok", by: "me", at: 0 });
    expect(walkAt(all, null).done).toBe(true);
    expect(walkNext(all, "speaker:living_l")).toBe("speaker:server_spk");
    expect(afterMark(all, "look:heart_wake", "bad", "me", 0)).toBe("look:heart_wake");
  });
  it("a light's buttons read 'Saw it'; a speaker's 'Heard it'; the live ask names what guests notice", () => {
    expect(markWords("speaker")).toEqual({ ok: "✓ Heard it", bad: "✗ Nothing" });
    expect(markWords("fixture").ok).toBe("✓ Saw it");
    expect(testWords("out")).toBe("🔊 Test tone");
    expect(testWords("look")).toBe("💡 Play the look");
    expect(liveAsk("sound")).toMatch(/hear/u);
    expect(liveAsk("fixture")).toMatch(/see/u);
    expect(testNeedsConfirm(deskFixture({ live: true }))).toBe(true);
    expect(testNeedsConfirm(deskFixture())).toBe(false);
  });
  it("a colour bulb walks its colours; a missing file is a hint before anyone listens", () => {
    const light = sections.find((s) => s.id === "lights")!.rows[0]!;
    expect(light.extra.map((e) => e.label)).toEqual(["Red", "Green", "Blue", "White", "Dim", "Off"]);
    expect(sections.find((s) => s.id === "sounds")!.rows[0]!.hints).toContain("no file on the router's machine");
  });
  it("marks and progress in words", () => {
    expect(markLine({ mark: "ok", by: "Director", at: 0 }, 30_000)).toBe("✓ Director · just now");
    expect(markLine({ mark: "bad", by: "Task Manager", at: 0, note: "crackles" }, 5 * 60_000)).toBe("✗ Task Manager · 5 min ago · crackles");
    expect(markLine(null, 0)).toBeNull();
    expect(progressLine({ ok: 3, bad: 1, open: 2, total: 6 })).toBe("4 of 6 checked · 1 ✗");
    expect(progressLine({ ok: 0, bad: 0, open: 0, total: 0 })).toMatch(/Nothing to check/u);
  });
});

describe("what the house did lately", () => {
  it("one line each, newest first, with the router's answer", () => {
    expect(recentLines(deskFixture().recent)).toEqual(["GO 1 · Pre-show hum · Director", "📢 The doors are open · Task Manager · no-file"]);
  });
});

/** The fixture's house with some of it swapped. */
const house = (over: Partial<DeskView["house"]>, view: Partial<DeskView> = {}): DeskView => {
  const v = deskFixture(view);
  return { ...v, house: { ...v.house, ...over } };
};
const allWell = () => house({ sounds: [{ name: "server_hum", to: ["server_spk"], file: "ok", ms: 4000 }], minds: [{ character: "Trabolta", name: "Trabolta", online: true, workers: ["macbook"] }] });

describe("wave 30: Setup", () => {
  it("one card per system, in deskSetup's order, the outside minds last", () => {
    const s = setupView(allWell());
    expect(s.rows.map((r) => r.id)).toEqual(["sound", "lights", "mind:Trabolta"]);
  });
  it("all well folds to one line naming every system", () => {
    const s = setupView(allWell());
    expect(s.allOk).toBe(true);
    expect(s.line).toBe("All connected ✓ · 🔊 Sound · 💡 Lights · 🧠 Trabolta");
  });
  it("otherwise the line counts what is down and what to look at", () => {
    const s = setupView(deskFixture());
    expect(s.allOk).toBe(false);
    expect(s.rows.find((r) => r.id === "sound")!.tone).toBe("bad");
    expect(s.line).toBe("1 not working");
    const w = setupView(house({ sounds: [{ name: "server_hum", to: null, file: "placeholder", ms: null }], minds: [{ character: "Trabolta", name: "Trabolta", online: false, workers: [] }] }));
    expect(w.line).toBe("1 not working · 1 to look at");
  });
  it("an older server (no minds) still gets sound and lights", () => {
    expect(setupView(deskFixture()).rows.map((r) => r.id)).toEqual(["sound", "lights"]);
  });
  it("the steps start open only when a system is down; a warning folds", () => {
    expect(setupOpen({ tone: "bad", fix: ["Start it"] })).toBe(true);
    expect(setupOpen({ tone: "warn", fix: ["Look"] })).toBe(false);
    expect(setupOpen({ tone: "ok", fix: [] })).toBe(false);
    expect(setupOpen({ tone: "bad", fix: [] })).toBe(false);
    const mind = setupView(house({ minds: [{ character: "Trabolta", name: "Trabolta", online: false, workers: [] }] })).rows.find((r) => r.id === "mind:Trabolta")!;
    expect(setupOpen(mind)).toBe(true);
    expect(mind.fix.join(" ")).toMatch(/Ollama/u);
  });
  it("the card's tone is its class and its mark", () => {
    expect(setupClass({ tone: "bad" })).toBe("host-desk-setup-card bad");
    expect([setupMark("ok"), setupMark("warn"), setupMark("bad")]).toEqual(["✓", "⚠", "✗"]);
  });
});

describe("wave 30: Try it", () => {
  it("the looks, then the story sounds, each with the check's own test and no mark", () => {
    const g = tryGroups(deskFixture());
    expect(g.map((x) => x.id)).toEqual(["looks", "sounds"]);
    expect(g[0]!.rows[0]).toMatchObject({ kind: "look", name: "heart_wake", test: { route: "/api/mod/lights/test", body: { look: "heart_wake" } } });
    expect(g[1]!.rows[0]).toMatchObject({ kind: "sound", name: "server_hum", test: { route: "/api/mod/audio/play", body: { sound: "server_hum" } } });
    expect(g[1]!.rows[0]!.hints).toEqual(["no file on the router's machine"]);
  });
  it("a short list starts open; a long one folds behind its count", () => {
    expect(tryGroups(deskFixture()).every((x) => x.open)).toBe(true);
    const many = Array.from({ length: TRY_OPEN_MAX + 1 }, (_, i) => ({ name: `s${i}`, to: null, file: "ok" as const, ms: null }));
    expect(tryGroups(house({ sounds: many })).find((x) => x.id === "sounds")!.open).toBe(false);
  });
  it("an offline router or lights module is said once for the list, not on every row", () => {
    const g = tryGroups(house({ router: { online: false, lastSeen: 50_000, name: null }, lightsModule: null }));
    const sounds = g.find((x) => x.id === "sounds")!;
    expect(sounds.away).toBe("the sound router is offline");
    expect(sounds.rows[0]!.hints).toEqual(["no file on the router's machine"]);
    expect(g.find((x) => x.id === "looks")!.away).toBe("the lights module has never connected");
    expect(tryGroups(deskFixture()).every((x) => x.away === null)).toBe(true);
  });
  it("a house with no looks or sounds has nothing to try", () => {
    expect(tryGroups(house({ looks: [], sounds: [] }))).toEqual([]);
  });
  it("the note says what played, and when nothing is there to play it", () => {
    expect(tryDone("look", "heart_wake", { ok: true, module: true })).toBe("💡 Playing the look heart_wake");
    expect(tryDone("look", "heart_wake", { ok: true, module: false })).toMatch(/lights module is offline/u);
    expect(tryDone("sound", "server_hum", { ok: true, router: { online: true } })).toBe("▶ Playing server_hum");
    expect(tryDone("sound", "server_hum", { ok: true, router: { online: false } })).toMatch(/^▶ Playing server_hum — but the sound router is offline$/u);
    expect(tryDone("say", "", { router: { online: true } })).toBe("📢 Said on the speakers");
    expect(tryDone("say", "", null)).toBe("📢 Said on the speakers");
  });
  it("Say on the speakers: trimmed, never empty, never past the server's cap", () => {
    expect(sayCall("  The bar is open  ")).toEqual({ route: "/api/mod/audio/play", body: { say: "The bar is open" } });
    expect(sayCall("   ")).toBeNull();
    expect(sayCall("x".repeat(DESK_SAY_MAX))).not.toBeNull();
    expect(sayCall("x".repeat(DESK_SAY_MAX + 1))).toBeNull();
    expect(DESK_SAY_MAX).toBe(280);
    expect(sayCount("hello")).toBe("5 / 280");
  });
  it("once the doors are open each one asks first, in the checks' words", () => {
    expect(testNeedsConfirm(deskFixture({ live: true }))).toBe(true);
    expect(liveAsk("look")).toMatch(/guests will see this/u);
    expect(liveAsk("sound")).toMatch(/guests will hear this/u);
  });
});

describe("wave 30: How the Desk works", () => {
  it("five lines: Setup (naming the outside minds), Try it, GO, the checks, where cues are built and STOP ALL", () => {
    const how = deskHow(allWell());
    expect(how).toHaveLength(5);
    expect(how[0]).toContain("the sound, the lights and Trabolta");
    expect(deskHow(deskFixture())[0]).toContain("the sound and the lights are connected");
    expect(how.join(" ")).toMatch(/GO plays the cue on STANDBY/u);
    expect(how.join(" ")).toMatch(/walk the house with your phone/u);
    expect(how.join(" ")).toMatch(/Run → House → Cue designer/u);
    expect(how.join(" ")).toMatch(/STOP ALL is the panic/u);
  });
});
