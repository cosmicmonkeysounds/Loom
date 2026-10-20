//! Wave 13 fix round, the adversary's guards:
//!
//! - A lookalike of a taken guest name (zero-width, full-width, bidi) is
//!   refused (409); the stored name is clean.
//! - A wrong code longer than any code is refused (400) before the journal.
//! - A double-tapped 📡 Scan again is one scan (429 `again` inside the window).

import { afterAll, describe, expect, it } from "vitest";
import { Store } from "../server/store.ts";
import { cleanGuestName } from "../server/identity.ts";
import { booth, cleanup, freshDir, guest, post, register, runtime } from "./w13-fix-harness.ts";

afterAll(cleanup);

describe("lookalike guest names", () => {
  it("cleanGuestName: NFKC, no zero-width / bidi / format characters, no invisible fillers", () => {
    expect(cleanGuestName("Calculator​")).toBe("Calculator");
    expect(cleanGuestName("Ｃalculator")).toBe("Calculator");
    expect(cleanGuestName("Calc‍ulator‮")).toBe("Calculator");
    expect(cleanGuestName("  Win­amp  ㅤ")).toBe("Winamp");
    expect(cleanGuestName("Zoo   Tycoon")).toBe("Zoo Tycoon");
  });

  it("a zero-width or full-width double of a taken name answers 409; the stored name is clean", async () => {
    const rt = runtime();
    rt.openDoors();
    await guest(rt, "Calculator");
    for (const name of ["Calculator​", "Ｃalculator", "⁦Calculator⁩", "calc‌ulator"]) {
      const r = await register(rt, name);
      expect([JSON.stringify(name), r.status]).toEqual([JSON.stringify(name), 409]);
    }
    const ok = await register(rt, "Win​amp");
    expect(ok.status).toBe(200);
    expect(ok.json.name).toBe("Winamp");
  });
});
