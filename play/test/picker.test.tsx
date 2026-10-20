//! Wave 13 (chrome): the program picker — the reserved featured programs
//! fold away behind "Reserved for invited guests (n)" unless an
//! invitation's claim opened one (then it is an ordinary free tile).

import { describe, expect, it } from "vitest";
import type { IdentityRow } from "../src/avatars.ts";
import { pickerSections, reservedFoldLabel } from "../src/guest/register.tsx";

const row = (name: string, extra: Partial<IdentityRow> = {}): IdentityRow => ({ name, faction: null, avatar: null, claimed: false, ...extra });

describe("the reserved fold", () => {
  it("free programs, then the taken ones; the reserved fold away", () => {
    const rows = [row("Winamp", { claimed: true }), row("Excel", { reserved: true }), row("Paint"), row("Word", { reserved: true }), row("Solitaire")];
    const { open, reserved } = pickerSections(rows);
    expect(open.map((r) => r.name)).toEqual(["Paint", "Solitaire", "Winamp"]);
    expect(reserved.map((r) => r.name)).toEqual(["Excel", "Word"]);
    expect(reservedFoldLabel(reserved.length)).toBe("🔒 Reserved for invited guests (2)");
  });

  it("an invitation's claim opens its program: the server sends it unreserved, a plain tile", () => {
    const rows = [row("Excel"), row("Word", { reserved: true })];
    expect(pickerSections(rows).open.map((r) => r.name)).toEqual(["Excel"]);
    expect(pickerSections(rows).reserved.map((r) => r.name)).toEqual(["Word"]);
  });

  it("a taken reserved program reads taken, never in the fold", () => {
    expect(pickerSections([row("Excel", { reserved: true, claimed: true })])).toEqual({ open: [row("Excel", { reserved: true, claimed: true })], reserved: [] });
  });
});
