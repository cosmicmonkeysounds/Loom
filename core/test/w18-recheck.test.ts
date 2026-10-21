//! Wave 18 recheck fixes (recheck/fixes.md), the show's side.

import { describe, expect, it } from "vitest";
import { scenarioFiles } from "../examples/load.ts";
import { booth, guest, post, primeStream, rt18 } from "./w18-harness.ts";

const FILES = scenarioFiles("trapped-in-the-internet");

describe("N9: a house banner that sends everyone to the living room carries the way there", () => {
  it("every such broadcast has `with go: The Desktop`", () => {
    const lines = FILES.flatMap((f) => f.source.split("\n").filter((l) => /^\s*broadcast "!/u.test(l) && /to the living room/iu.test(l)));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) expect(l, l).toMatch(/with go: The Desktop/u);
  });
});

describe("BN2-FC: a caught poster leaves an open Wanted board after its minute", () => {
  it("the booths get a fresh view when the poster lapses, with no other change", async () => {
    const rt = rt18();
    rt.openDoors();
    const ada = await guest(rt, "Ada");
    const norton = (await booth(rt, "Norton")).json.token as string;
    const mcafee = (await booth(rt, "McAfee")).json.token as string;
    await post(rt, "/api/prime/act", { token: norton, name: "mark_program", guest: ada.id });
    await post(rt, "/api/prime/act", { token: norton, name: "send_to_internet", guest: ada.id });
    const s = primeStream(rt, mcafee);
    await s.open;
    const boards = () => (s.res.frames("snapshot") as Array<{ wanted?: Array<{ id: string }> }>).map((v) => (v.wanted ?? []).map((w) => w.id));
    expect(boards().at(-1)).toEqual([ada.id]);
    for (let i = 0; i < 62; i++) rt.tickOnce(1000);
    expect(boards().at(-1)).toEqual([]);
  });
});
