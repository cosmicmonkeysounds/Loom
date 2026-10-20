// Wave 13 (booth lane): the camera stays on while the scanner is open — a
// guest's card over it included, so the next guest never waits for it to
// restart — and the scanner's × or Escape over a card goes back to the
// live camera (× on the camera leaves). Passes read while a card is up are
// dropped; the pass whose card was just closed is ignored for a moment
// (the guest is often still holding it up), while the next guest's pass
// scans at once.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { cameraOn, closedGate, passAccepted, scannerClose } from "../src/booth/model.ts";
import { CLOSED_PASS_MS, ScannerScreen } from "../src/booth/scanner.tsx";
import type { PrimeSession } from "../src/session/prime.ts";

describe("the camera's life", () => {
  it("runs while the scanner is open, a card over it included", () => {
    expect(cameraOn(true, false)).toBe(true);
    expect(cameraOn(true, true)).toBe(true);
    expect(cameraOn(false, false)).toBe(false);
  });

  it("drops the passes it reads while a card is up or a scan is on its way", () => {
    expect(passAccepted(false, false, true)).toBe(true);
    expect(passAccepted(true, false, true)).toBe(false);
    expect(passAccepted(false, true, true)).toBe(false);
    expect(passAccepted(false, false, false)).toBe(false);
  });

  it("closing a card returns to the camera; closing the camera leaves the scanner", () => {
    expect(scannerClose(true)).toBe("camera");
    expect(scannerClose(false)).toBe("leave");
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
    expect(html).not.toContain("behind");
  });

});
