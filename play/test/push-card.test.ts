//! The 🔔 card's iPhone copy (split out of push.test.ts in wave 13, blocks
//! unchanged): what the card tells an iPhone guest or booth to do.
import { describe, expect, it } from "vitest";

import { iosPushCopy } from "../src/push-card.tsx";

describe("iPhones (K-31b)", () => {
  it("the card says what to do: guests open the icon, booths sign out first", () => {
    const guest = iosPushCopy("ios-install", false, "Trapped", true)!;
    expect(guest.body).toContain("Add to Home Screen");
    expect(guest.body).toContain("open Trapped from the new icon");
    expect(guest.body).not.toContain("Sign out");
    // The booth's ⊞ Start has "Sign out" (there is no "Leave here" there).
    expect(iosPushCopy("ios-install", true, "Trapped", true)!.body).toContain("⊞ Start → Sign out, and sign in from the Home Screen icon");
    const keep = iosPushCopy("ios-keep-open", false, "Trapped", true)!;
    expect(keep.head).toBe("Your iPhone can't get alerts");
    expect(keep.body).toContain("keep Trapped open");
    // Wave 13: guests' and booths' settings both live under ⊞ Start; no ☰ is left.
    expect(keep.body).toContain("⊞ Start → Keep my screen on");
    expect(keep.body).not.toContain("☰");
    const booth = iosPushCopy("ios-keep-open", true, "Trapped", true)!.body;
    expect(booth).toContain("⊞ Start → Keep my screen on");
    expect(booth).not.toContain("☰");
    expect(iosPushCopy("ios-install", true, "Trapped", true)!.body).not.toContain("☰");
    expect(iosPushCopy("ios-keep-open", true, null, true)!.body).toContain("keep the app open");
    expect(iosPushCopy("ask", false, "Trapped", true)).toBeNull();
  });

  it("below iOS 16.4 (no wake lock, so no Keep my screen on row) the card says Auto-Lock instead", () => {
    const keep = iosPushCopy("ios-keep-open", false, "Trapped", false)!;
    expect(keep.body).toContain("Auto-Lock → Never");
    expect(keep.body).not.toContain("Keep my screen on");
  });
});
