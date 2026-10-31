//! Directors stay out of sight (2026-10-24, `server/unseen-directors.ts`):
//! a guest sees the hosts, never a director; a booth (hosts included) reads
//! parts by name and every director as "Director". Run and the director
//! phone keep the real names.

import { afterAll, describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { ChatMessage } from "../server/chat.ts";
import { DIRECTOR, directorIds, directorNames, forBooth, hostSeen, partName, seenCrews, seenCues, seenPeople } from "../server/unseen-directors.ts";
import type { Recap } from "../server/recap.ts";
import { primeView, type GuestView, type PrimeView } from "../server/views.ts";
import { ONLINE_GRACE_MS, type HostView } from "../src/host-board.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { W18, booth, call, cleanup, freshDir, guest, guestStream, mod, post, primeStream, rt18, runtime as baseRuntime } from "./w18-harness.ts";

afterAll(cleanup);

const model = Sim.fromSources(W18).model;
const modGet = (rt: ReturnType<typeof rt18>, path: string) => call(rt, "GET", path, {}, { moderator: true, moderatorName: "Ada" });
const hostView = async (rt: ReturnType<typeof rt18>): Promise<HostView> => (await modGet(rt, "/api/state?role=mod&host=1")).json as unknown as HostView;
const boothView = async (rt: ReturnType<typeof rt18>, character: string): Promise<PrimeView> =>
  (await modGet(rt, `/api/state?role=prime&as=${encodeURIComponent(character)}`)).json as unknown as PrimeView;

describe("the pure rules", () => {
  it("a part keeps its name; an author, a phone, a mod token read 'Director'", () => {
    expect(partName("Booth · Task Manager", model)).toBe("Task Manager");
    expect(partName("task manager", model)).toBe("Task Manager");
    expect(partName("agent:Clippy", model)).toBe("Clippy");
    for (const by of ["John Janigan-Mills", "Phone · Bo", "Director", "", null, undefined]) expect(partName(by, model)).toBeNull();
    expect(seenCues({ caller: { name: "John Janigan-Mills", at: 1 }, lastName: "Task Manager" }, model)).toEqual({ caller: { name: DIRECTOR, at: 1 }, lastName: "Task Manager" });
    expect(seenCues({ caller: null, lastName: "Phone · Bo" }, model)).toEqual({ caller: null, lastName: DIRECTOR });
  });

  it("a booth's chat line drops the director's `via`", () => {
    const m = { seq: 1, channel: "lobby", from: "Ada", text: "hi", via: "John Janigan-Mills" } as unknown as ChatMessage;
    expect("via" in forBooth(m)).toBe(false);
  });

  it("a persona's `from` reads 'Director'; anyone else's line is the same object", () => {
    const m = { seq: 1, channel: "lobby", from: "John", text: "hi" } as unknown as ChatMessage;
    expect(forBooth(m, new Set(["John"])).from).toBe(DIRECTOR);
    expect(forBooth(m, new Set(["Ada"]))).toBe(m);
    expect(forBooth(m)).toBe(m);
    expect(directorNames(null, new Map()).size).toBe(0);
  });

  it("the host panel: a persona's owner and a filing's ruler read 'Director', a judge character keeps its name", () => {
    const view = {
      cues: { caller: null, lastName: "John Janigan-Mills" },
      roster: [{ id: "p-1", name: "Test", location: null, owner: "John Janigan-Mills" }, { id: "g1", name: "Ada", location: null }],
      judging: {
        pending: [{ by: "John Janigan-Mills", ruling: { by: "Clippy", same: true, why: "", at: 0 } }],
        recent: [{ by: "Booth · Task Manager", ruling: null }],
      },
    } as unknown as HostView;
    const seen = hostSeen(view, model);
    expect(seen.cues.lastName).toBe(DIRECTOR);
    expect(seen.roster.map((p) => p.owner)).toEqual([DIRECTOR, undefined]);
    expect(seen.judging!.pending[0]).toMatchObject({ by: DIRECTOR, ruling: { by: "Clippy" } });
    expect(seen.judging!.recent[0]).toMatchObject({ by: "Task Manager" });
    expect(JSON.stringify(seen)).not.toContain("Janigan");
  });
});

describe("on the event server", () => {
  it("a director's claim and press read 'Director' on a booth and the host dock, the name on Run's views", async () => {
    const rt = rt18();
    rt.openDoors();
    await mod(rt, "/api/mod/caller", { on: true });
    await mod(rt, "/api/mod/signal", { name: "call_to_the_desktop", presses: 0 });
    const host = await hostView(rt);
    expect(host.cues.caller).toMatchObject({ name: DIRECTOR });
    expect(host.cues.lastName).toBe(DIRECTOR);
    expect((await boothView(rt, "Clippy")).calls!.caller).toMatchObject({ name: DIRECTOR });
    // Run and the director phone still read who it is.
    const lean = (await modGet(rt, "/api/state?role=mod&cues=1")).json.cues as { caller: { name: string }; lastName?: string };
    expect(lean.caller.name).toBe("Ada");
    expect(lean.lastName).toBe("Ada");
  });

  it("the whole host panel and a booth's view never carry the author's name", async () => {
    const rt = rt18();
    rt.openDoors();
    const john = (path: string, body: Record<string, unknown>) => call(rt, "POST", path, body, { moderator: true, moderatorName: "John Janigan-Mills" });
    await john("/api/mod/caller", { on: true });
    await john("/api/mod/signal", { name: "call_to_the_desktop", presses: 0 });
    expect((await john("/api/mod/persona", { name: "Rehearsal Bot" })).status).toBe(200);
    expect(JSON.stringify(await hostView(rt))).not.toContain("Janigan");
    expect(JSON.stringify(await boothView(rt, "Clippy"))).not.toContain("Janigan");
    expect(JSON.stringify(await boothView(rt, "Task Manager"))).not.toContain("Janigan");
    expect(JSON.stringify((await modGet(rt, "/api/state?role=mod")).json)).toContain("Janigan"); // Run still knows
  });

  it("a host's press still names the host", async () => {
    const rt = rt18();
    rt.openDoors();
    const tm = (await booth(rt, "Task Manager")).json.token as string;
    expect((await post(rt, "/api/mod/signal", { token: tm, name: "call_to_the_desktop", presses: 0 })).status).toBe(200);
    expect((await hostView(rt)).cues.lastName).toBe("Task Manager");
  });

  it("a line a director says as a guest reaches booths without the director's name", async () => {
    const rt = rt18();
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    const tm = (await booth(rt, "Task Manager")).json.token as string;
    const s = primeStream(rt, tm);
    await s.open;
    expect((await call(rt, "POST", "/api/mod/say", { as: ada.id, text: "Hello from Ada", channel: "lobby" }, { moderator: true, moderatorName: "John Janigan-Mills" })).status).toBe(200);
    const live = (s.res.frames("message") as ChatMessage[]).find((m) => m.text === "Hello from Ada");
    expect(live).toBeDefined();
    expect(live!.via).toBeUndefined();
    // Its history (a fresh stream) and a host's `/api/history` read agree.
    const again = primeStream(rt, tm);
    await again.open;
    const history = (again.res.frames("history") as Array<{ messages?: ChatMessage[] } | ChatMessage[]>).flatMap((h) => (Array.isArray(h) ? h : (h.messages ?? [])));
    expect(history.some((m) => m.text === "Hello from Ada")).toBe(true);
    expect(JSON.stringify(history)).not.toContain("Janigan");
    const read = await call(rt, "GET", `/api/history?token=${encodeURIComponent(tm)}&id=${ada.id}`);
    expect(JSON.stringify(read.json)).not.toContain("Janigan");
    // Run still sees who typed it.
    const run = await call(rt, "GET", `/api/history?id=${ada.id}`, {}, { moderator: true });
    expect(JSON.stringify(run.json)).toContain("Janigan");
  });
});

// Wave 59 (the user's note): "I should not see any directors names in ANYONES
// People list ... And only show people who are online!"
const EVERYONE = W18.replace("start: Opening", "start: Opening\ndirectory: everyone");

describe("nobody's People list shows a director", () => {
  const rtAll = (): EventRuntime => baseRuntime({}, freshDir(), EVERYONE);
  const personaOf = async (rt: EventRuntime, name: string) => ((await call(rt, "POST", "/api/mod/persona", { name }, { moderator: true, moderatorName: "John" })).json.guest as { id: string }).id;
  const stateOf = async (rt: EventRuntime, query: string) => (await call(rt, "GET", `/api/state?${query}`)).json as unknown as GuestView & PrimeView;

  it("the pure rules: an owner, a p- id or the journaled var; `hide` leaves the host's lists", () => {
    const rows = [{ id: "p-1", name: "John", location: null }, { id: "g1", name: "Ada", location: null }];
    const view = { cues: { caller: null }, people: rows, roster: rows, wanted: rows, judging: null } as unknown as HostView;
    const seen = hostSeen(view, model, new Set(["p-1"]));
    expect(seen.people.map((p) => p.id)).toEqual(["g1"]);
    expect(seen.roster.map((p) => p.id)).toEqual(["g1"]);
    expect(seen.wanted!.map((p) => p.id)).toEqual(["g1"]);
    expect(hostSeen(view, model).people.map((p) => p.id)).toEqual(["p-1", "g1"]);
  });

  it("no guest, player, host or `pick:` reads a persona's name; Run and a director's own panes do", async () => {
    const rt = rtAll();
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    const persona = await personaOf(rt, "John Director");
    expect(directorIds(rt.liveSim, new Map()).has(persona)).toBe(true);
    // The bare sim offers them (this test bites): the runtime takes them out of `pick:`.
    rt.liveSim!.setVar(`${persona}.location`, "The Desktop");
    expect(primeView(rt.liveSim, "Clippy").objectives!.flatMap((o) => o.pick ?? [])).toContain(persona);
    const norton = (await booth(rt, "Norton")).json.token as string;
    const tm = (await booth(rt, "Task Manager")).json.token as string;
    const clippy = (await booth(rt, "Clippy")).json.token as string;
    const asGuest = await stateOf(rt, `role=guest&token=${encodeURIComponent(ada.token)}`);
    expect(JSON.stringify(asGuest)).not.toContain("John Director");
    expect(asGuest.people.some((p) => p.id === persona)).toBe(false);
    expect(asGuest.roster.some((p) => p.id === persona)).toBe(false);
    for (const token of [norton, tm, clippy]) {
      const view = await stateOf(rt, `role=prime&token=${encodeURIComponent(token)}`);
      expect(view.guests.map((g) => g.id)).toEqual([ada.id]);
      for (const o of view.objectives ?? []) expect(o.pick ?? []).not.toContain(persona);
      expect(JSON.stringify(view)).not.toContain("John Director");
    }
    const asHost = (await call(rt, "GET", `/api/state?role=mod&host=1&token=${encodeURIComponent(tm)}`)).json as unknown as HostView;
    expect(asHost.people.map((p) => p.id)).toEqual([ada.id]);
    expect(asHost.roster.map((p) => p.id)).toEqual([ada.id]);
    expect(JSON.stringify(asHost)).not.toContain("John Director");
    // The live streams, the same.
    const live = guestStream(rt, ada.token);
    await live.open;
    await mod(rt, "/api/mod/signal", { name: "ring_the_bell", presses: 0 });
    const frames = live.res.frames("snapshot") as GuestView[];
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) expect(JSON.stringify(f.people)).not.toContain("John Director");
    // Run keeps them.
    expect(JSON.stringify((await modGet(rt, "/api/state?role=mod")).json)).toContain("John Director");
    // A director's own pane keeps them; a wall terminal piloting a guest doesn't.
    const pane = (await call(rt, "POST", "/api/mod/impersonate", { role: "guest", id: ada.id }, { moderator: true, moderatorName: "John" })).json.token as string;
    expect((await stateOf(rt, `role=guest&token=${encodeURIComponent(pane)}`)).people.some((p) => p.id === persona)).toBe(true);
    const wall = (await call(rt, "POST", "/api/mod/impersonate", { role: "guest", id: ada.id, label: "Terminal · The Desktop" }, { moderator: true })).json.token as string;
    expect((await stateOf(rt, `role=guest&token=${encodeURIComponent(wall)}`)).people.some((p) => p.id === persona)).toBe(false);
    const hostPane = (await call(rt, "POST", "/api/mod/impersonate", { role: "prime", id: "Task Manager" }, { moderator: true, moderatorName: "John" })).json.token as string;
    expect((await stateOf(rt, `role=prime&token=${encodeURIComponent(hostPane)}`)).guests.map((g) => g.id)).toContain(persona);
  });

  it("a persona's line reaches every phone as 'Director', its own pane and Run as the name", async () => {
    const rt = rtAll();
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    const persona = await personaOf(rt, "John Director");
    rt.liveSim!.setVar(`${persona}.cleared`, "true");
    rt.liveSim!.setVar(`${persona}.location`, "The Desktop");
    rt.liveSim!.setVar(`${ada.id}.location`, "The Desktop");
    const pane = (await call(rt, "POST", "/api/mod/impersonate", { role: "guest", id: persona }, { moderator: true, moderatorName: "John" })).json.token as string;
    const clippy = (await booth(rt, "Clippy")).json.token as string;
    const tm = (await booth(rt, "Task Manager")).json.token as string;
    const asAda = guestStream(rt, ada.token);
    const asClippy = primeStream(rt, clippy);
    const asTm = primeStream(rt, tm);
    await Promise.all([asAda.open, asClippy.open, asTm.open]);
    expect((await post(rt, "/api/guest/say", { token: pane, channel: "dm:Clippy", text: "A word, Clippy" })).status).toBe(200);
    expect((await post(rt, "/api/guest/say", { token: pane, channel: "loc:The Desktop", text: "A word, room" })).status).toBe(200);
    const lines = (s: { res: { frames: (e: string) => unknown[] } }, text: string) => (s.res.frames("message") as ChatMessage[]).filter((m) => m.text === text);
    // The addressee reads the DM with no name, and can tell whom it answers.
    const dm = lines(asClippy, "A word, Clippy");
    expect(dm.map((m) => m.from)).toEqual([DIRECTOR]);
    expect(dm[0]!.audience).toEqual([persona]);
    for (const s of [asAda, asClippy, asTm]) expect(lines(s, "A word, room").map((m) => m.from)).toEqual([DIRECTOR]);
    for (const s of [asAda, asClippy, asTm]) expect(JSON.stringify(s.res.frames("message"))).not.toContain("John Director");
    // A reload's history and a host's read agree with the stream.
    const again = primeStream(rt, clippy);
    await again.open;
    expect(JSON.stringify(again.res.frames("history"))).not.toContain("John Director");
    const fresh = guestStream(rt, ada.token);
    await fresh.open;
    expect(JSON.stringify(fresh.res.frames("history"))).not.toContain("John Director");
    expect(JSON.stringify((await call(rt, "GET", `/api/history?token=${encodeURIComponent(ada.token)}`)).json)).not.toContain("John Director");
    expect(JSON.stringify((await call(rt, "GET", `/api/history?token=${encodeURIComponent(tm)}&id=${persona}`)).json)).not.toContain("John Director");
    // The booth can answer: the reply lands in the persona's own thread.
    expect((await post(rt, "/api/prime/say", { token: clippy, channel: `guest:${persona}`, text: "Yes?" })).status).toBe(200);
    // A hidden and restored line keeps it too.
    const seq = dm[0]!.seq;
    await mod(rt, "/api/mod/message", { seq, hidden: true });
    await mod(rt, "/api/mod/message", { seq, hidden: false });
    for (const s of [asClippy, asTm]) expect(JSON.stringify(s.res.frames("messageModerated"))).not.toContain("John Director");
    // The persona's own pane and Run keep the name.
    expect(JSON.stringify((await call(rt, "GET", `/api/history?token=${encodeURIComponent(pane)}`)).json)).toContain("John Director");
    expect(JSON.stringify((await call(rt, "GET", `/api/history?id=${persona}`, {}, { moderator: true })).json)).toContain("John Director");
  });

  it("a real guest who shares a persona's name keeps it", async () => {
    const rt = rtAll();
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    await personaOf(rt, "Ada");
    const s = guestStream(rt, ada.token);
    await s.open;
    expect((await post(rt, "/api/guest/say", { token: ada.token, channel: "lobby", text: "It's me" })).status).toBe(200);
    expect((s.res.frames("message") as ChatMessage[]).find((m) => m.text === "It's me")?.from).toBe("Ada");
  });

  it("a persona's crew: a founder, a leader and a crew mate read 'Director' on a guest's phone", () => {
    const names = new Set(["John Director"]);
    const seen = seenCrews(
      {
        crew: { id: "crew-1", name: "Screensavers", founder: "p-1", founderName: "John Director", members: ["p-1", "g-1"], memberNames: ["John Director", "Ada"], room: "crew:crew-1" },
        invites: [{ id: "i", from: "p-1", fromName: "John Director", kind: "crew", target: "crew-1", targetName: "Screensavers" }],
        sides: [
          { id: "crew-1", name: "Screensavers", leader: "John Director", mine: true, kind: "founded", founder: "John Director" },
          { id: "Truthers", name: "Truthers", leader: "Clippy", mine: false, kind: "side", founder: "Clippy" },
        ],
      } as Pick<GuestView, "crew" | "invites" | "sides">,
      names,
    );
    expect(JSON.stringify(seen)).not.toContain("John Director");
    expect(seen.crew).toMatchObject({ founderName: DIRECTOR, memberNames: [DIRECTOR, "Ada"] });
    expect(seen.invites![0]!.fromName).toBe(DIRECTOR);
    expect(seen.sides!.map((s) => [s.leader, s.founder])).toEqual([[DIRECTOR, DIRECTOR], ["Clippy", "Clippy"]]);
    const none = { sides: [] };
    expect(seenCrews(none, new Set<string>())).toBe(none);
  });

  it("the recap: a host's read leaves every persona out, its lists, ranks, duck board and text; Run's keeps them", async () => {
    const rt = rtAll();
    rt.openDoors();
    await guest(rt, "Ada");
    const persona = await personaOf(rt, "John Director");
    const tm = (await booth(rt, "Task Manager")).json.token as string;
    const asHost = await call(rt, "GET", `/api/mod/recap?token=${encodeURIComponent(tm)}`);
    expect(asHost.status).toBe(200);
    expect(JSON.stringify(asHost.json)).not.toContain("John Director");
    const recap = asHost.json as unknown as Recap;
    expect(recap.programs).toBe(1);
    expect(recap.lists.trust.map((r) => r.name)).toEqual(["Ada"]);
    expect(recap.lists.trust[0]!.rank).toBe(1);
    const text = await call(rt, "GET", `/api/mod/recap?format=text&token=${encodeURIComponent(tm)}`);
    expect(text.status).toBe(200);
    expect(JSON.stringify(text.json)).not.toContain("John Director");
    // Run's own read, and a director's pane of the host part.
    expect(JSON.stringify((await call(rt, "GET", "/api/mod/recap", {}, { moderator: true })).json)).toContain("John Director");
    const pane = (await call(rt, "POST", "/api/mod/impersonate", { role: "prime", id: "Task Manager" }, { moderator: true, moderatorName: "John" })).json.token as string;
    expect(JSON.stringify((await call(rt, "GET", `/api/mod/recap?token=${encodeURIComponent(pane)}`)).json)).toContain("John Director");
    expect(persona).toMatch(/^p-/u);
  });

  it("a host can still scan one: no list offers them, the pass in Run's pane still works", async () => {
    const rt = rtAll();
    rt.openDoors();
    const persona = await personaOf(rt, "John Director");
    const tm = (await booth(rt, "Task Manager")).json.token as string;
    const scan = await post(rt, "/api/scan", { token: tm, target: persona });
    expect(scan.status).toBe(200);
    expect(JSON.stringify(scan.json)).toContain("John Director");
  });
});

describe("the lists say who is online", () => {
  const people = (over: Partial<GuestView["people"][number]>[]) => ({ people: over as GuestView["people"], roster: [] });
  const round = { guests: new Set(["g1"]), booths: new Set(["Clippy"]), directors: new Set<string>() };

  it("a guest by their phone, a part by its booth, an agent by its worker or its hold line", () => {
    const seen = seenPeople(
      people([
        { id: "g1", kind: "guest" },
        { id: "g2", kind: "guest" },
        { id: "Clippy", kind: "character" },
        { id: "Norton", kind: "character" },
        { id: "Trabolta", kind: "character", agent: { online: false, hold: true } },
        { id: "Sandy", kind: "character", agent: { online: false } },
        { id: "Bot", kind: "character", agent: { online: true } },
      ]),
      round,
      new Set(),
    );
    expect(seen.people.map((p) => p.online)).toEqual([true, false, true, false, true, false, true]);
  });

  const rtAt = (now: () => number): EventRuntime => baseRuntime({ now }, freshDir(), EVERYONE);

  it("a phone heard from stays online through the grace, then leaves; an open stream holds it", async () => {
    let now = 1_000_000;
    const rt = rtAt(() => now);
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    const bo = await guest(rt, "Bo");
    const onlineOf = async (who: { token: string }, id: string) => ((await call(rt, "GET", `/api/state?role=guest&token=${encodeURIComponent(who.token)}`)).json as unknown as GuestView).people.find((p) => p.id === id)?.online;
    // Registering is being heard from; past the grace, only a stream holds him.
    expect(await onlineOf(ada, bo.id)).toBe(true);
    now += ONLINE_GRACE_MS + 1;
    expect(await onlineOf(ada, bo.id)).toBe(false);
    const live = guestStream(rt, bo.token);
    await live.open;
    expect(await onlineOf(ada, bo.id)).toBe(true);
    // Booths the same: a booth's guests carry it.
    const norton = (await booth(rt, "Norton")).json.token as string;
    const asBooth = (await call(rt, "GET", `/api/state?role=prime&token=${encodeURIComponent(norton)}`)).json as unknown as PrimeView;
    expect(asBooth.guests.find((g) => g.id === bo.id)?.online).toBe(true);
    expect(asBooth.guests.find((g) => g.id === ada.id)?.online).toBe(true); // her own reads just now count
  });

  it("the night's tick sends a round when someone came or went, and none when nobody did", async () => {
    let now = 1_000_000;
    const rt = rtAt(() => now);
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    const bo = await guest(rt, "Bo");
    const live = guestStream(rt, ada.token);
    await live.open;
    rt.tickOnce(EventRuntime.PRESENCE_CHECK_MS);
    const settled = live.res.frames("snapshot").length;
    rt.tickOnce(EventRuntime.PRESENCE_CHECK_MS);
    expect(live.res.frames("snapshot").length).toBe(settled);
    now += ONLINE_GRACE_MS + 1;
    rt.tickOnce(EventRuntime.PRESENCE_CHECK_MS);
    const frames = live.res.frames("snapshot") as GuestView[];
    expect(frames.length).toBe(settled + 1);
    expect(frames.at(-1)!.people.find((p) => p.id === bo.id)?.online).toBe(false);
  });
});
