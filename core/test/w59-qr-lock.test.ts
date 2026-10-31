// Wave 59: what a story edit can and can't do to a printed QR, over the real
// show's text. The lock (`scripts/titi-qr-lock.ts`) must stay quiet for
// anything but a printed name, and fail naming that. It holds hashes only.

import { describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { buildLock, diffLock, lockBroken, lockReport, printedIdentities } from "../scripts/titi-qr-lock.ts";
import { compileFromSource } from "../src/runtime/sim/index.ts";

const SHOW = scenarioSource("trapped-in-the-internet");
const items = (src: string) => printedIdentities(compileFromSource(src));
const LOCK = buildLock(items(SHOW));
const diff = (src: string) => diffLock(LOCK, items(src));

/** The show with `from` swapped for `to`, which must be there to swap. */
function edit(from: string, to: string, all = false): string {
  expect(SHOW.includes(from)).toBe(true);
  return all ? SHOW.split(from).join(to) : SHOW.replace(from, to);
}

describe("the lock", () => {
  it("covers every kind printed", () => {
    expect(new Set(items(SHOW).map((i) => i.kind))).toEqual(new Set(["room", "sign", "part", "invited", "codex"]));
  });

  it("holds hashes only: no name, no code", () => {
    const text = JSON.stringify(LOCK);
    for (const i of items(SHOW)) {
      expect(text.includes(i.name)).toBe(false);
      expect(text.includes(i.identity)).toBe(false);
    }
    for (const [k, v] of Object.entries(LOCK.items)) {
      expect(/^(room|sign|part|invited|codex):[0-9a-f]{16}$/u.test(k)).toBe(true);
      expect(/^[0-9a-f]{16}$/u.test(v)).toBe(true);
    }
  });

  it("names no code when it reports, for any kind", () => {
    const moved = diff(edit("LOCATION The Tube", "LOCATION The Tubes"));
    const codes = items(SHOW).filter((i) => i.kind === "codex").map((i) => i.identity);
    expect(lockReport(moved).some((line) => codes.some((c) => line.toLowerCase().includes(c)))).toBe(false);
  });

});

describe("what a story edit does to a printed QR", () => {
  it("story text, a whole beat moved, a label's crew note and a new fact leave everything alone", () => {
    const words = diff(`${SHOW}\n== A Late Beat\nA new line nobody printed.\n`);
    expect(lockBroken(words)).toBe(false);
    expect(words.added).toEqual([]);
    const label = diff(edit("label: The Start Bar (kitchen)", "label: The Start Bar (the kitchen, downstairs)"));
    expect(lockBroken(label)).toBe(false);
  });

  it("a renamed room is one gone and one new, and nothing else moves", () => {
    const d = diff(edit("LOCATION The Tube", "LOCATION The Tubes"));
    expect(lockBroken(d)).toBe(true);
    expect(d.gone).toEqual({ room: 1 });
    expect(d.moved).toEqual([]);
    expect(d.added.map((i) => [i.kind, i.name])).toEqual([["room", "The Tubes"]]);
  });

  it("a room that stops taking check-ins breaks its sign", () => {
    const d = diff(edit("LOCATION The Tube\n", "LOCATION The Tube\n  checkin: false\n"));
    expect(d.gone).toEqual({ room: 1 });
  });

  it("a renamed part, a renamed sign's button, a changed code: each named or counted", () => {
    const code = items(SHOW).find((i) => i.kind === "codex")!;
    const raw = /^\s*code:\s*(\S+)\s*$/mu.exec(SHOW)![1]!;
    const changed = diff(edit(`code: ${raw}`, `code: ${raw}-TWO`));
    expect(changed.moved.map((i) => i.kind)).toEqual(["codex"]);
    expect(code.identity).not.toBe("");
    const part = diff(edit("CHARACTER Clippy", "CHARACTER Clippit", true));
    expect(part.gone.part).toBe(1);
    expect(part.added.some((i) => i.kind === "part" && i.name === "Clippit")).toBe(true);
  });

  it("swapping two reserved programs moves their invited badges (a typed code finds a program by place)", () => {
    const invited = items(SHOW).filter((i) => i.kind === "invited").map((i) => i.name);
    expect(invited.length).toBeGreaterThan(1);
    const [a, b] = invited as [string, string];
    const swapped = SHOW.replace(`CHARACTER ${a}\n`, "CHARACTER @@\n").replace(`CHARACTER ${b}\n`, `CHARACTER ${a}\n`).replace("CHARACTER @@\n", `CHARACTER ${b}\n`);
    expect(diff(swapped).moved.map((i) => i.name).sort()).toEqual([a, b].sort());
  });
});
