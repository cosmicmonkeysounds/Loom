// Wave 59: a chat room opens on its beat, for everyone. Over the real show and
// the real runtime: what a guest, a booth and a director are sent before and
// after the story opens each room. The bots' full evening and a scratch server
// read the same lists over HTTP.

import { afterAll, describe, expect, it } from "vitest";
import { scenarioFactsFile, scenarioSource } from "../examples/load.ts";
import type { Sim } from "../src/runtime/sim/index.ts";
import { CODES, booth, call, cleanup, mod, post, runtime } from "./w13-fix-harness.ts";

afterAll(cleanup);

const show = () => runtime({ scenarioSource: scenarioSource("trapped-in-the-internet"), facts: scenarioFactsFile("trapped-in-the-internet")?.source ?? null });
const simOf = (rt: ReturnType<typeof show>) => rt["sim"] as unknown as Sim;

const SIDES = ["room:the way out", "room:unlimited power"];
const NIGHT = ["room:clipboard", "room:truthcoin exchange"];

async function lists(rt: ReturnType<typeof show>, guest: string, host: string) {
  const ids = (j: Record<string, unknown>) => (j["channels"] as { id: string }[]).map((c) => c.id);
  return {
    guest: ids((await call(rt, "GET", `/api/state?role=guest&token=${guest}`)).json),
    host: ids((await call(rt, "GET", `/api/state?role=prime&token=${host}`)).json),
    run: ids((await call(rt, "GET", "/api/state?role=mod", {}, { moderator: true })).json),
  };
}

describe("rooms open on their beat", () => {
  it("nobody has the sides' rooms before the reveal; a side's own early member gets it at the reveal, a host and Run too", async () => {
    const rt = show();
    await mod(rt, "/api/mod/start");
    const excel = (await post(rt, "/api/guest/register", { name: "Ada", passcode: CODES.event })).json.token as string;
    const host = (await booth(rt, "Task Manager")).json.token as string;
    const sim = simOf(rt);
    const ada = [...(sim as unknown as { persons: Map<string, unknown> }).persons.keys()][0]!;
    sim.join(ada, "The Way Out"); // the Truther Download's `add program to …`

    const before = await lists(rt, excel, host);
    for (const who of [before.guest, before.host, before.run]) for (const room of [...SIDES, ...NIGHT, "room:task manager"]) expect(who).not.toContain(room);
    for (const side of ["faction:The Way Out", "faction:Unlimited Power"]) expect(before.run).not.toContain(side);
    // The crew's own rooms were never closed, and a director keeps every place.
    expect(before.host).toEqual(expect.arrayContaining(["room:hosts", "room:general"]));
    expect(before.run).toEqual(expect.arrayContaining(["room:hosts", "loc:The Script", "loc:The Server Room"]));
    // A guest can't post into it either, though the story already added them.
    const refused = await post(rt, "/api/guest/say", { token: excel, channel: "room:the way out", text: "hello" });
    expect(refused.status).toBe(404);
    const derived = await post(rt, "/api/guest/say", { token: excel, channel: "faction:The Way Out", text: "hello" });
    expect(derived.status).toBe(404);

    sim.reveal("The Way Out");
    sim.reveal("Unlimited Power");
    const after = await lists(rt, excel, host);
    expect(after.guest).toContain("room:the way out");
    expect(after.guest).not.toContain("room:unlimited power"); // members only, as it was
    expect(after.host).toEqual(expect.arrayContaining(SIDES));
    expect(after.run).toEqual(expect.arrayContaining([...SIDES, "faction:The Way Out", "faction:Unlimited Power"]));
  });

  it("a booth gets # clipboard and # truthcoin-exchange on their reveals, # task-manager at the first clearance", async () => {
    const rt = show();
    await mod(rt, "/api/mod/start");
    const guest = (await post(rt, "/api/guest/register", { name: "Ada", passcode: CODES.event })).json.token as string;
    const host = (await booth(rt, "Task Manager")).json.token as string;
    const sim = simOf(rt);
    const ada = [...(sim as unknown as { persons: Map<string, unknown> }).persons.keys()][0]!;
    sim.reveal("clipboard");
    sim.reveal("task manager", ada);
    sim.reveal("The Start Bar", ada);
    const l = await lists(rt, guest, host);
    expect(l.host).toEqual(expect.arrayContaining(["room:clipboard", "room:task manager", "loc:The Start Bar"]));
    expect(l.host).not.toContain("room:truthcoin exchange");
    expect(l.host).not.toContain("loc:The Server Room");
    expect(l.host).not.toContain("loc:The Script");
  });
});
