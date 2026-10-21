//! The wave 18 workspace lints: L1214 (go targets), L1215 (booth-only
//! pickers), L1216 (header lines), L1217 (callers), L1218 (big house
//! broadcasts). The show's own story must stay free of the new warnings it
//! does not opt into (it writes none of the new syntax yet).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Workspace } from "../src/lsp/index.ts";
import { W18 } from "./w18-harness.ts";

function codes(source: string, code: string): string[] {
  const ws = new Workspace();
  ws.open("file:///main.loom", source);
  return (ws.diagnosticsFor("file:///main.loom")?.diagnostics ?? []).filter((d) => d.code === code).map((d) => d.message);
}

describe("the wave 18 fixture is clean", () => {
  it("no L1214–L1218 on a story that writes them right", () => {
    for (const c of ["L1214", "L1215", "L1216", "L1217", "L1218"]) expect(codes(W18, c), c).toEqual([]);
  });
});

describe("L1214: go targets", () => {
  it("an unknown word, the lobby, an unquoted reply's tail, an OBJECTIVE's go:", () => {
    const src = `${W18}
== Bad
broadcast "Look." to everyone with go: Nowhere Land, go: pass
reply "Done." with go: lobby
reply Done with go: pass
pin "!Up." for guest with go: codex: No Such Entry
show poll "x" to guest with go: The Desktop

OBJECTIVE Lost
  for: guests
  go: The Moon
  text: Hm.
`;
    const msgs = codes(src, "L1214");
    expect(msgs).toHaveLength(5);
    expect(msgs[0]).toContain("`go: Nowhere Land` names no");
    expect(msgs[1]).toContain("never an exit");
    expect(msgs[2]).toContain("unquoted `reply`");
    expect(msgs[3]).toContain("`go: codex: No Such Entry`");
    expect(msgs[4]).toContain("OBJECTIVE Lost");
  });
});

describe("L1214: a broadcast's tail needs its scope (m5)", () => {
  it("warns on `broadcast \"…\" with go:` with no `to`, never on one with a scope", () => {
    const msgs = codes(`${W18}
== Scopeless
broadcast "!Come." with go: pass
broadcast "!Come." to everyone with go: pass
`, "L1214");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("needs its scope first");
  });
});

describe("L1215: target / pick on a guest objective", () => {
  it("warns on each key for an objective no booth sees", () => {
    const msgs = codes(`${W18}
OBJECTIVE Guest Pick
  for: guests
  pick: program.cleared == true
  target: Night.bottle_pick
  text: Hm.
`, "L1215");
    expect(msgs).toHaveLength(2);
    expect(msgs.some((m) => m.includes("`pick:` on OBJECTIVE Guest Pick"))).toBe(true);
    expect(msgs.some((m) => m.includes("`target:` on OBJECTIVE Guest Pick"))).toBe(true);
  });
});

describe("L1216: header lines", () => {
  it("a wanted: line that does not parse, a for that names nobody, an archive: that names no room, a reinstall: that is no expression", () => {
    const src = W18.replace("wanted: program.marked as program.marked_for by program.escort_by, for Antivirus", "wanted: program.marked, for Nobody At All\nwanted: Night.x\narchive: Nowhere when true\nreinstall: ((");
    const msgs = codes(src, "L1216");
    expect(msgs.some((m) => m.includes("`Nobody At All`"))).toBe(true);
    expect(msgs.some((m) => m.includes("`wanted: Night.x` does not parse"))).toBe(true);
    expect(msgs.some((m) => m.includes("`archive: Nowhere when true`"))).toBe(true);
    expect(msgs.some((m) => m.includes("`reinstall: ((` is no expression"))).toBe(true);
  });
});

describe("L1217: by: on an admin cue names a performer part", () => {
  it("warns for a name no booth can sign in as", () => {
    const msgs = codes(W18.replace("  who: admin\n  by: Clippy\n  description: Clippy deals the cards.", "  who: admin\n  by: The Uploader\n  description: Clippy deals the cards."), "L1217");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("`The Uploader`");
  });
});

describe("L1218: a big moment for the whole house", () => {
  it("warns in a beat, not in an admin cue's hook or a story rule, not to one person", () => {
    const src = `${W18}
CHARACTER Encarta
  when start_bingo:
    broadcast "!!Cards out!" to everyone
  when scanned by program:
    broadcast "!!Scanned!" to everyone

when bingo_time:
  broadcast "!!BINGO TIME" to everyone

== Loud
broadcast "!!Everyone stop." to everyone
broadcast "!!Just you." to participant(guest)
reply !!Only you.
`;
    const msgs = codes(src, "L1218");
    expect(msgs).toHaveLength(2);
    expect(msgs.every((m) => m.includes("big moment for the whole house"))).toBe(true);
  });
});

describe("the show compiles with no wave 18 warnings it did not write", () => {
  it("Trapped in the Internet: no L1214–L1218", () => {
    const root = join(__dirname, "../examples/trapped-in-the-internet");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith(".loom")) files.push(p);
      }
    };
    walk(root);
    const ws = new Workspace();
    // main.loom first (the story header), then by path — the server's order.
    files.sort((a, b) => (a.endsWith("/main.loom") ? -1 : b.endsWith("/main.loom") ? 1 : a.localeCompare(b)));
    for (const f of files) ws.open(`file:///${relative(root, f)}`, readFileSync(f, "utf8"));
    const found: string[] = [];
    for (const f of files) for (const d of ws.diagnosticsFor(`file:///${relative(root, f)}`)?.diagnostics ?? []) if (/^L121[4-8]$/u.test(String(d.code))) found.push(`${relative(root, f)}: ${d.code} ${d.message}`);
    expect(found).toEqual([]);
  }, 60_000);
});
