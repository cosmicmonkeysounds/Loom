//! The director's board lines (`watch:` / `countdown:` in the story header):
//! `parseBoardLine` is pure — scope and the live `while` are `boardFor`'s.

import { describe, expect, it } from "vitest";
import { boardLineProblems, defaultBoardLabel, parseBoardLine } from "../src/runtime/sim/board.ts";

describe("parseBoardLine", () => {
  it("splits items, labels each with its `as`, else the path's last segment", () => {
    expect(parseBoardLine("Night.clock as Y2K clock, Night.round as Truth round, Night.wrong_combos")).toEqual({
      items: [
        { label: "Y2K clock", path: "Night.clock", name: null },
        { label: "Truth round", path: "Night.round", name: null },
        { label: "Wrong combos", path: "Night.wrong_combos", name: null },
      ],
      while: null,
      raw: "Night.clock as Y2K clock, Night.round as Truth round, Night.wrong_combos",
    });
  });

  it("`as` is the last ` as ` in the item", () => {
    expect(parseBoardLine("Night.heart_holder as At the heart")?.items[0]).toEqual({ label: "At the heart", path: "Night.heart_holder", name: null });
    expect(parseBoardLine("Night.x as y as Z")).toBeNull(); // `Night.x as y` is no path
  });

  it("the default label", () => {
    expect(defaultBoardLabel("Night.wrong_combos")).toBe("Wrong combos");
    expect(defaultBoardLabel("program.cleared")).toBe("Cleared");
    expect(defaultBoardLabel("Kernel.door__code")).toBe("Door code");
  });

  it("the first `, while ` gates the whole line", () => {
    const l = parseBoardLine("Kernel.majority as Majority, Night.wrong_combos as Wrong patches, while Night.step >= 14 and Night.ended != true");
    expect(l?.items.map((i) => i.path)).toEqual(["Kernel.majority", "Night.wrong_combos"]);
    expect(l?.while).toBe("Night.step >= 14 and Night.ended != true");
  });

  it("keeps a quoted value inside the `while`", () => {
    const l = parseBoardLine('Night.results_q as Results read, while Night.phase == "truth_1"');
    expect(l?.items).toEqual([{ label: "Results read", path: "Night.results_q", name: null }]);
    expect(l?.while).toBe('Night.phase == "truth_1"');
  });

  it("an item with no dot is a person", () => {
    expect(parseBoardLine("Microsoft Excel, OpenOffice, MS Paint")?.items).toEqual([
      { label: "Microsoft Excel", path: null, name: "Microsoft Excel" },
      { label: "OpenOffice", path: null, name: "OpenOffice" },
      { label: "MS Paint", path: null, name: "MS Paint" },
    ]);
    expect(parseBoardLine("Norton Anti-Virus")?.items[0]?.name).toBe("Norton Anti-Virus");
  });

  it("`pathsOnly` (a `countdown:` line) rejects names", () => {
    expect(parseBoardLine("Night.y2k_end as Midnight, while Night.final_round == true", { pathsOnly: true })).toEqual({
      items: [{ label: "Midnight", path: "Night.y2k_end", name: null }],
      while: "Night.final_round == true",
      raw: "Night.y2k_end as Midnight, while Night.final_round == true",
    });
    expect(parseBoardLine("MS Paint", { pathsOnly: true })).toBeNull();
    expect(parseBoardLine("MS Paint, Night.dance_at", { pathsOnly: true })?.items.map((i) => i.path)).toEqual(["Night.dance_at"]);
  });

  it("garbage is null, a bad item is skipped and named", () => {
    for (const bad of ["", "   ", ",", "Night.", ".clock", "Night.clock +", "== beat", "Night.clock as", "Night.clock, while", "Night.clock, while   "]) {
      expect(parseBoardLine(bad), bad).toBeNull();
    }
    expect(parseBoardLine("Night.clock, Night.(x), MS Paint")?.items.map((i) => i.label)).toEqual(["Clock", "MS Paint"]);
    expect(boardLineProblems("Night.clock, Night.(x), MS Paint")).toEqual({ items: ["Night.(x)"], emptyWhile: false });
    expect(boardLineProblems("MS Paint, while", { pathsOnly: true })).toEqual({ items: ["MS Paint"], emptyWhile: true });
  });
});

describe("the model's board and acts", () => {
  it("collects every header `watch:` / `countdown:` line and each cue's own `act:`", async () => {
    const { Sim } = await import("../src/runtime/sim/index.ts");
    const sim = Sim.fromSources(`# Board
watch: Night.clock as Clock
watch: Microsoft Excel, while Night.step >= 2
watch: ===
countdown: Night.end as Midnight, MS Paint
countdown: MS Paint

INTERACTION open_doors
  who: admin
  act: A · Doors

INTERACTION close_doors
  who: admin

INTERACTION knock
  who: guest
  act:   Ignored for guests
`);
    expect(sim.model.watch.map((l) => l.raw)).toEqual(["Night.clock as Clock", "Microsoft Excel, while Night.step >= 2"]);
    expect(sim.model.countdowns).toEqual([{ items: [{ label: "Midnight", path: "Night.end", name: null }], while: null, raw: "Night.end as Midnight, MS Paint" }]);
    // The model keeps what each INTERACTION wrote; the carry-forward and the
    // admin-only rule are the cue sheet's and the views'.
    expect(sim.model.interactions.get("open_doors")!.act).toBe("A · Doors");
    expect(sim.model.interactions.get("close_doors")!.act).toBeNull();
    expect(sim.model.interactions.get("knock")!.act).toBe("Ignored for guests");
  });
});

describe("lint L1205 BoardLineUnparsed", () => {
  const lints = async (files: Array<[string, string]>) => {
    const { Workspace } = await import("../src/lsp/index.ts");
    const w = new Workspace();
    w.updateMany(files);
    return files.flatMap(([uri]) =>
      (w.diagnosticsFor(uri)?.diagnostics ?? [])
        .filter((d) => d.code === "L1205")
        .map((d) => ({ uri, severity: d.severity, line: d.range.start.line, message: d.message })),
    );
  };
  const STORY = (header: string) => `# Board
start: Go
${header}

GROUP Hosts
LOCATION The Desk
ROLE Program
  cleared: bool = false
CHARACTER Kernel
  secret: true
  code: text? = none
CHARACTER MS Paint

when ring:
  set Night.step = 2

== Go
Hi.
`;

  it("a clean board reports none", async () => {
    const header = [
      "watch: Night.step as Step, Kernel.code, program.cleared, Hosts.size, The_Desk.lights, Time.elapsed, while Night.step >= 1",
      "watch: MS Paint, ms_paint as Painter",
      "countdown: Night.step as Soon, while Night.step == 2",
    ].join("\n");
    expect(await lints([["file:///main.loom", STORY(header)]])).toEqual([]);
  });

  it("flags a line, an item, a `while`, an unknown head and an unknown person — as warnings on the line", async () => {
    const header = [
      "watch: ===", //                                      2
      "watch: Night.step, Nite.step, Ghost Writer", //       3
      "countdown: MS Paint, Night.step", //                   4
      "watch: Night.step, while Night.step >= (", //          5
    ].join("\n");
    const out = await lints([["file:///main.loom", STORY(header)]]);
    expect(out.map((d) => [d.line, d.severity])).toEqual([
      [2, 2],
      [3, 2],
      [3, 2],
      [4, 2],
      [5, 2],
    ]);
    expect(out[0]!.message).toMatch(/does not parse/);
    expect(out[1]!.message).toMatch(/`Nite` names no CHARACTER, ROLE, GROUP or LOCATION/);
    expect(out[2]!.message).toMatch(/`Ghost Writer` .* names no CHARACTER/);
    expect(out[3]!.message).toMatch(/`MS Paint` .* is skipped \(a countdown takes paths only/);
    expect(out[4]!.message).toMatch(/no expression/);
  });

  it("a board line outside the first file's header is ignored by the server", async () => {
    const out = await lints([
      ["file:///main.loom", STORY("watch: Night.step")],
      ["file:///cast.loom", "watch: Night.step\n\nCHARACTER Clippy\n"],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ uri: "file:///cast.loom", line: 0 });
    expect(out[0]!.message).toMatch(/only the first file's header \(main\.loom\)/);
  });
});
