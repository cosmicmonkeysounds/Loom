// Wave 13 (booth lane): the camera stays on while the scanner is open, is
// off while a guest's card sits over it, and resumes when the card closes —
// ignoring, for a moment, the pass whose card was just closed (the guest is
// often still holding it up), while the next guest's pass scans at once.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { cameraOn, closedGate } from "../src/booth/model.ts";
import { CLOSED_PASS_MS, ScannerScreen } from "../src/booth/scanner.tsx";
import type { PrimeSession } from "../src/session/prime.ts";

describe("the camera's life", () => {
  it("runs while the scanner is open and no card is over it", () => {
    expect(cameraOn(true, false)).toBe(true);
    expect(cameraOn(true, true)).toBe(false);
    expect(cameraOn(false, false)).toBe(false);
  });

  it("after a card closes, ignores that pass for a moment; another pass scans at once", () => {
    let now = 0;
    const gate = closedGate(CLOSED_PASS_MS, () => now);
    expect(gate.allows("g-1")).toBe(true);
    gate.closed("g-1");
    now = 1000;
    expect(gate.allows("g-1")).toBe(false);
    expect(gate.allows("g-2")).toBe(true);
    now = CLOSED_PASS_MS;
    expect(gate.allows("g-1")).toBe(true);
  });

  it("the scanner opens with the camera live and the typed-id box under it", () => {
    const session = { auth: { token: "t", character: "Norton", admin: false, eventId: "default" }, view: null } as unknown as PrimeSession;
    const html = renderToStaticMarkup(<ScannerScreen session={session} admin={false} onClose={() => {}} onOpenThread={() => {}} />);
    expect(html).toContain("<video");
    expect(html).toContain("Or type the id on their pass");
    expect(html).toContain("📷 Scan a pass");
  });
});
