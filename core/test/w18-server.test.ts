//! Wave 18 on the event server: global booth buttons (C4), the Wanted board
//! and `markedAt` rebuilt on replay (C6), the reinstallation gate (C7),
//! callers and the caller claim (C8), the host view's described cues, and
//! each booth row's `lastSeen` (A1).

import { afterAll, describe, expect, it } from "vitest";
import { duckBoard } from "../server/recap.ts";
import { parseDuckRun } from "../server/spatial.ts";
import { eligibleFor } from "../server/event-runtime.ts";
import { isHostRoute } from "../server/routes/host.ts";
import { booth, call, cleanup, freshDir, guest, mod, post, rt18 } from "./w18-harness.ts";
import type { PrimeView } from "../server/views.ts";
import type { HostView } from "../src/host-board.ts";

afterAll(cleanup);

const modGet = (rt: ReturnType<typeof rt18>, path: string) => call(rt, "GET", path, {}, { moderator: true, moderatorName: "Ada" });
const boothView = async (rt: ReturnType<typeof rt18>, character: string): Promise<PrimeView> =>
  (await modGet(rt, `/api/state?role=prime&as=${encodeURIComponent(character)}`)).json as unknown as PrimeView;
const hostView = async (rt: ReturnType<typeof rt18>): Promise<HostView> => (await modGet(rt, "/api/state?role=mod&host=1")).json as unknown as HostView;

describe("C4: global buttons from a booth", () => {
  it("a subjectless performer button presses with no guest; one every listener binds a subject still needs one", async () => {
    const rt = rt18();
    rt.openDoors();
    const norton = (await booth(rt, "Norton")).json.token as string;
    const view = await boothView(rt, "Norton");
    expect(view.globalButtons).toEqual(["ring_the_bell"]);
    const r = await post(rt, "/api/prime/act", { token: norton, name: "ring_the_bell" });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.card).toBeUndefined();
    expect(rt.chatHistoryFor((await guest(rt, "Ada")).id).some((m) => m.text === "🔔 Ding.")).toBe(true);
    const bound = await post(rt, "/api/prime/act", { token: norton, name: "mark_program" });
    expect([bound.status, bound.json.error]).toEqual([404, "unknown guest"]);
  });
});

describe("C6: the Wanted board", () => {
  it("a mark lights every Antivirus booth and the hosts; a claim names the hunter; a capture stays 60 s; Clippy sees none", async () => {
    const rt = rt18();
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    rt.tickOnce(5000);
    const norton = (await booth(rt, "Norton")).json.token as string;
    expect((await post(rt, "/api/prime/act", { token: norton, name: "mark_program", guest: ada.id })).status).toBe(200);
    const before = await boothView(rt, "McAfee");
    expect(before.wanted).toHaveLength(1);
    const poster = before.wanted![0]!;
    expect(poster).toMatchObject({ id: ada.id, name: "Ada", reason: "Lied about the cat", claimedBy: null, captured: false });
    expect(poster.markedAt).toBeGreaterThanOrEqual(5000);
    expect(typeof poster.lastSeen).toBe("number");
    expect((await boothView(rt, "Clippy")).wanted).toBeUndefined();
    expect((await hostView(rt)).wanted?.map((w) => w.id)).toEqual([ada.id]);
    await post(rt, "/api/prime/act", { token: norton, name: "claim_escort", guest: ada.id });
    expect((await boothView(rt, "McAfee")).wanted![0]!.claimedBy).toBe("Norton");
    await post(rt, "/api/prime/act", { token: norton, name: "send_to_internet", guest: ada.id });
    expect((await boothView(rt, "Norton")).wanted![0]!.captured).toBe(true);
    rt.tickOnce(61_000);
    expect((await boothView(rt, "Norton")).wanted).toEqual([]);
  });

  it("markedAt is the story time of the mark, rebuilt the same by a restart's replay", async () => {
    const dir = freshDir();
    const rt = rt18(dir);
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    rt.tickOnce(7000);
    await mod(rt, "/api/mod/var", { path: `${ada.id}.marked`, value: "true" });
    const at = (await boothView(rt, "Norton")).wanted![0]!.markedAt;
    rt.tickOnce(30_000);
    expect((await boothView(rt, "Norton")).wanted![0]!.markedAt).toBe(at);
    const again = rt18(dir);
    expect(again.restore()).not.toBeNull();
    expect((await boothView(again, "Norton")).wanted![0]!.markedAt).toBe(at);
  });
});

describe("C7: the reinstallation gate", () => {
  it("the header's reinstall: decides who may enter; candidates say marked", async () => {
    const rt = rt18();
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    const bo = await guest(rt, "Bo");
    await mod(rt, "/api/mod/var", { path: `${ada.id}.marked`, value: "true" });
    const sim = rt.liveSim!;
    expect(eligibleFor(sim, ada.id)).toBe(true);
    expect(eligibleFor(sim, bo.id)).toBe(false);
    const players = (await modGet(rt, "/api/mod/spatial/candidates")).json.players as Array<{ id: string; eligible: boolean; marked: boolean }>;
    expect(players[0]).toMatchObject({ id: ada.id, eligible: true, marked: true });
    expect(players.find((p) => p.id === bo.id)).toMatchObject({ eligible: false, marked: false });
    // After the end, everyone may (a party favour).
    await mod(rt, "/api/mod/signal", { name: "end_the_night" });
    expect(eligibleFor(rt.liveSim!, bo.id)).toBe(true);
  });

  it("the duck board leaves out a run found after the end", () => {
    const rt = rt18();
    rt.openDoors();
    const runs = [
      parseDuckRun({ guest: "g1", name: "Ada", world: "web", device: "tab", ms: 9000, foundAt: 1 })!,
      parseDuckRun({ guest: "g2", name: "Bo", world: "web", device: "tab", ms: 1000, foundAt: 2, after: true })!,
    ];
    expect(runs[1]!.after).toBe(true);
    expect(duckBoard(rt.liveSim!, runs).map((r) => r.id)).toEqual(["g1"]);
  });
});

describe("C8: callers", () => {
  it("Clippy signs in a caller and sees only its cues; presses one through the cue-sheet path", async () => {
    const rt = rt18();
    rt.openDoors();
    const login = (await booth(rt, "Clippy")).json;
    expect(login.caller).toBe(true);
    expect((await booth(rt, "Norton")).json.caller).toBe(false);
    const view = await boothView(rt, "Clippy");
    expect(view.calls!.rows.map((r) => r.id)).toEqual(["start_bingo", "bingo_time"]);
    expect(view.calls!.rows[0]!.description).toBe("Clippy deals the cards.");
    expect(view.calls).toMatchObject({ next: "call_to_the_desktop", last: null, presses: 0, caller: null });
    expect((await boothView(rt, "Norton")).calls).toBeUndefined();
    const token = login.token as string;
    const refused = await post(rt, "/api/prime/cue", { token, name: "the_bottle", presses: 0 });
    expect(refused.status).toBe(404);
    const press = await post(rt, "/api/prime/cue", { token, name: "start_bingo", presses: 0 });
    expect(press.status).toBe(200);
    expect(press.json).toMatchObject({ ok: true, presses: 1, said: ["🎱 Bingo is on."] });
    const after = await boothView(rt, "Clippy");
    expect(after.calls).toMatchObject({ last: "start_bingo", lastName: "Clippy", presses: 1 });
    // Armed against an old count after a press of the same cue: moved.
    const stale = await post(rt, "/api/prime/cue", { token, name: "start_bingo", presses: 0 });
    expect([stale.status, stale.json.moved]).toEqual([409, true]);
    // Released, the booth calls nothing.
    await mod(rt, "/api/mod/prime/release", { character: "Clippy" });
    expect((await post(rt, "/api/prime/cue", { token, name: "bingo_time", presses: 1 })).status).toBe(404);
  });

  it("the caller claim rides every cue-sheet view and goes with its session", async () => {
    const rt = rt18();
    rt.openDoors();
    const host = (await booth(rt, "Task Manager")).json.token as string;
    const claim = await post(rt, "/api/mod/caller", { token: host, on: true });
    expect(claim.status).toBe(200);
    expect(claim.json.caller).toMatchObject({ name: "Task Manager" });
    expect((await hostView(rt)).cues.caller).toMatchObject({ name: "Task Manager" });
    expect(((await modGet(rt, "/api/state?role=mod&cues=1")).json.cues as { caller?: { name: string } }).caller?.name).toBe("Task Manager");
    expect((await boothView(rt, "Clippy")).calls!.caller).toMatchObject({ name: "Task Manager" }); // a caller booth reads it too
    // Another's on: false leaves it; a director's claim takes over.
    await mod(rt, "/api/mod/caller", { on: false });
    expect((await hostView(rt)).cues.caller).toMatchObject({ name: "Task Manager" });
    await mod(rt, "/api/mod/prime/release", { character: "Task Manager" });
    expect((await hostView(rt)).cues.caller ?? null).toBeNull();
    await mod(rt, "/api/mod/caller", { on: true });
    expect((await hostView(rt)).cues.caller).toMatchObject({ name: "Ada" });
    rt.restart();
    expect((await hostView(rt)).cues.caller ?? null).toBeNull();
  });

  it("nobody calling is `caller: null`, the key present; a phone's mod token names itself", async () => {
    const rt = rt18();
    rt.openDoors();
    const v = await hostView(rt);
    expect("caller" in v.cues).toBe(true);
    expect(v.cues.caller).toBeNull();
    const lean = (await modGet(rt, "/api/state?role=mod&cues=1")).json.cues as Record<string, unknown>;
    expect("caller" in lean && lean["caller"] === null).toBe(true);
    // A headless mod token (no author name) is "Director"; the phone's label wins.
    const phone = await call(rt, "POST", "/api/mod/caller", { on: true, label: "Phone · Bo" }, { moderator: true });
    expect(phone.json.caller).toMatchObject({ name: "Phone · Bo" });
    expect((await hostView(rt)).cues.caller).toMatchObject({ name: "Phone · Bo" });
    await call(rt, "POST", "/api/mod/caller", { on: false, label: "Phone · Bo" }, { moderator: true });
    expect((await hostView(rt)).cues.caller).toBeNull();
  });

  it("the host view describes NEXT and the three on deck, names `then`, and a press answers what it said", async () => {
    const rt = rt18();
    rt.openDoors();
    const v = await hostView(rt);
    const described = v.interactions.filter((i) => typeof i.description === "string").map((i) => i.id);
    expect(described).toEqual(["call_to_the_desktop", "start_bingo", "bingo_time", "the_bottle"]);
    expect(v.cues.then).toBe("start_bingo");
    const r = await mod(rt, "/api/mod/signal", { name: "call_to_the_desktop", presses: 0 });
    expect(r.json).toMatchObject({ ok: true, said: ["Come to the Desktop."], staff: ["Called."] });
  });

  it("a host may switch the judge auto ⇄ review, nothing else on that path", () => {
    const ctx = { alertsPath: "Night.alerts", isAgent: () => false };
    expect(isHostRoute("POST", "/api/mod/var", { path: "Night.judge_mode", value: "review" }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/var", { path: "Night.judge_mode", value: "auto" }, ctx)).toBe(true);
    expect(isHostRoute("POST", "/api/mod/var", { path: "Night.judge_mode", value: "lie" }, ctx)).toBe(false);
    expect(isHostRoute("POST", "/api/mod/caller", { on: true }, ctx)).toBe(true);
  });
});

describe("A1: a booth row's lastSeen", () => {
  it("every guest row carries when the server last heard from them", async () => {
    const rt = rt18();
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    const row = (await boothView(rt, "Norton")).guests.find((g) => g.id === ada.id)!;
    expect(typeof row.lastSeen).toBe("number");
  });
});
