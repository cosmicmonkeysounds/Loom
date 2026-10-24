//! Directors stay out of sight (2026-10-24, `server/unseen-directors.ts`):
//! a guest sees the hosts, never a director; a booth (hosts included) reads
//! parts by name and every director as "Director". Run and the director
//! phone keep the real names.

import { afterAll, describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { ChatMessage } from "../server/chat.ts";
import { DIRECTOR, forBooth, hostSeen, partName, seenCues } from "../server/unseen-directors.ts";
import type { PrimeView } from "../server/views.ts";
import type { HostView } from "../src/host-board.ts";
import { W18, booth, call, cleanup, guest, mod, post, primeStream, rt18 } from "./w18-harness.ts";

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
