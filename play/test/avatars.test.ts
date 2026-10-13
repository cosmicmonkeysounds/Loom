import { describe, expect, it } from "vitest";

import { avatarLookup, avatarUrl, foldName, hitNote, hitPickable, initialPick, orderPicker, type ProgramHit } from "../src/avatars.ts";

describe("profile pictures", () => {
  it("looks a picture up by any spelling of the name, same-origin", () => {
    const lookup = avatarLookup("evt 1", { "ms paint": "abc123", "nhl 97": "def456" });
    expect(lookup.srcFor("MS Paint")).toBe("/e/evt%201/api/avatar/abc123");
    expect(lookup.srcFor("ms_paint")).toBe("/e/evt%201/api/avatar/abc123");
    expect(lookup.srcFor("NHL-97")).toBe("/e/evt%201/api/avatar/def456");
    expect(lookup.srcFor("Clippy")).toBeNull();
    expect(avatarLookup(null, { clippy: "x" }).srcFor("Clippy")).toBeNull();
    expect(avatarLookup("evt", undefined).srcFor("Clippy")).toBeNull();
    expect(avatarUrl("evt", "k")).toBe("/e/evt/api/avatar/k");
  });

  it("folds names the way the story does", () => {
    expect(foldName("  Microsoft_Excel ")).toBe("microsoft excel");
    expect(foldName("Norton-Anti-Virus")).toBe("norton anti virus");
  });
});

describe("the pickers", () => {
  it("lists free names before taken ones, keeping declaration order within each", () => {
    const rows = orderPicker([
      { name: "Calculator", faction: null, avatar: null, claimed: true },
      { name: "MS Paint", faction: null, avatar: "k", claimed: false },
      { name: "VLC", faction: null, avatar: null, claimed: false },
      { name: "WinZip", faction: null, avatar: null, claimed: true },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["MS Paint", "VLC", "Calculator", "WinZip"]);
  });

  it("explains a search hit: antivirus is out, a taken program is taken, else its description", () => {
    const av: ProgramHit = { name: "Norton AntiVirus", description: "Anti-virus software", avatar: null, claimed: false, blocked: "antivirus" };
    const taken: ProgramHit = { name: "NHL 97", description: "1996 video game", avatar: "k", claimed: true, blocked: null };
    const free: ProgramHit = { name: "NHL 98", description: "1997 video game", avatar: "k", claimed: false, blocked: null };
    expect(hitNote(av)).toMatch(/can't be antivirus/u);
    expect(hitPickable(av)).toBe(false);
    expect(hitNote(taken)).toBe("Taken tonight");
    expect(hitPickable(taken)).toBe(false);
    expect(hitNote(free)).toBe("1997 video game");
    expect(hitPickable(free)).toBe(true);
  });
});

describe("picture options", () => {
  const opts = [
    { key: "a", file: "Winamp media player logomark.png" },
    { key: "b", file: "Winamp Logo.svg" },
  ];
  it("starts on the picture they have now, else the first (the story's pick)", () => {
    expect(initialPick(opts)).toBe("a");
    expect(initialPick(opts, "b")).toBe("b");
    expect(initialPick(opts, "gone")).toBe("a");
    expect(initialPick([])).toBeNull();
  });
});
