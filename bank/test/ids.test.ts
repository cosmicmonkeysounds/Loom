//! Name hashing — the identity every cross-bank divert and every
//! generated header depends on.

import { describe, expect, it } from "vitest";
import { NameTable, asSignedDecimal, fnv1a64, idHex } from "../src/ids.ts";

describe("fnv1a64", () => {
  it("matches the published FNV-1a 64 vectors", () => {
    expect(fnv1a64("")).toBe(0xcbf29ce484222325n);
    expect(fnv1a64("a")).toBe(0xaf63dc4c8601ec8cn);
    expect(fnv1a64("foobar")).toBe(0x85944171f73967e8n);
  });

  it("renders 16-char lowercase hex — JSON cannot hold a u64", () => {
    expect(idHex("a")).toBe("af63dc4c8601ec8c");
    expect(idHex("")).toHaveLength(16);
  });

  it("is stable under NFC normalisation", () => {
    // é as one codepoint vs e + combining acute must be one identity.
    expect(fnv1a64("café")).toBe(fnv1a64("café"));
  });

  it("emits GDScript-safe signed decimals for the high half", () => {
    // GDScript ints are signed 64-bit; a literal >= 2^63 is a parse error.
    const high = 0xf904a6cfcdb92317n;
    expect(high).toBeGreaterThan(0x7fffffffffffffffn);
    expect(asSignedDecimal(high).startsWith("-")).toBe(true);
    expect(BigInt(asSignedDecimal(high))).toBe(high - 0x10000000000000000n);
    expect(asSignedDecimal(0x1234n)).toBe("4660");
  });
});

describe("NameTable", () => {
  it("interns idempotently into a dense table", () => {
    const t = new NameTable();
    expect(t.intern("opening")).toBe(0);
    expect(t.intern("lamp_room")).toBe(1);
    expect(t.intern("opening")).toBe(0);
    expect(t.names).toEqual(["opening", "lamp_room"]);
    expect(t.lookup("nope")).toBe(-1);
  });

  it("does not flag an ALL-CAPS speaker cue against its character", () => {
    // Loom's own idiom — a WREN cue naming CHARACTER Wren. Warning on it
    // would fire for every project and train authors to ignore warnings.
    const t = new NameTable();
    t.intern("Wren");
    t.intern("WREN");
    expect(t.caseClashes).toEqual([]);
  });

  it("does flag a genuine case alias", () => {
    const t = new NameTable();
    t.intern("Wren");
    t.intern("wren");
    expect(t.caseClashes).toEqual([["Wren", "wren"]]);
  });
});
