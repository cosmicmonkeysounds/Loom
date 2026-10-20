//! Wave 13 recheck, lane ccore — item 3: a restart re-asks a guest's DM to
//! an agent-voiced character even when a line the story posted in his name
//! ("The last facts, Calculator.") landed in the thread after it; only a line
//! he voiced (a worker's reply, a director typing as him) answers it.

import { afterAll, describe, expect, it } from "vitest";
import { cleanup, freshDir, guest, mod, post, runtime } from "./w13-fix-harness.ts";
import { STORY, waitingOf } from "./w13-recheck-story.ts";

afterAll(cleanup);

describe("3: a restart keeps a guest owed an answer after a story line", () => {
  it("a scripted line in his name is not him answering", async () => {
    const d = freshDir();
    const rt = runtime({ hostViewMs: 0 }, d, STORY);
    rt.openDoors();
    const a = await guest(rt, "Calculator");
    const b = await guest(rt, "GarageBand");
    for (const g of [a, b]) expect((await post(rt, "/api/guest/say", { token: g.token, channel: "dm:Trabolta", text: "are you real?" })).status).toBe(200);
    expect((await waitingOf(rt)).map((w) => w.name).sort()).toEqual(["Calculator", "GarageBand"]);
    // The story posts into each guest's dm:Trabolta.
    for (const g of [a, b]) expect((await mod(rt, "/api/mod/signal", { name: "poke", subject: g.id })).status).toBe(200);
    expect(rt.chatHistoryFor(a.id).some((m) => m.channel === "dm:Trabolta" && m.from === "Trabolta" && m.text === "The last facts, Calculator.")).toBe(true);
    expect((await waitingOf(rt)).length).toBe(2); // live, the request stays open
    rt.dispose();
    const rt2 = runtime({ hostViewMs: 0 }, d, STORY);
    rt2.restore();
    expect((await waitingOf(rt2)).map((w) => w.name).sort()).toEqual(["Calculator", "GarageBand"]);
    rt2.dispose();
  });

  it("a director answering as him still settles it", async () => {
    const d = freshDir();
    const rt = runtime({ hostViewMs: 0 }, d, STORY);
    rt.openDoors();
    const a = await guest(rt, "Calculator");
    expect((await post(rt, "/api/guest/say", { token: a.token, channel: "dm:Trabolta", text: "hello?" })).status).toBe(200);
    expect((await mod(rt, "/api/mod/say", { channel: `guest:${a.id}`, as: "Trabolta", text: "Here." })).status).toBe(200);
    expect(await waitingOf(rt)).toEqual([]);
    rt.dispose();
    const rt2 = runtime({ hostViewMs: 0 }, d, STORY);
    rt2.restore();
    expect(await waitingOf(rt2)).toEqual([]);
    rt2.dispose();
  });
});
