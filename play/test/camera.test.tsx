// Wave 13 (booth lane): the camera stays on while the scanner is open — a
// guest's card over it included, so the next guest never waits for it to
// restart. Wave 37 (C1): the scanner's × or Escape over a card leaves the
// scanner and gates that pass; only 📷 Next guest goes back to the live
// camera (door work only, C3). Passes read while a card is up are
// dropped; the pass whose card was just closed is ignored for a moment
// (the guest is often still holding it up), while the next guest's pass
// scans at once.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { cameraOn, closedGate, passAccepted } from "../src/booth/model.ts";
import { CLOSED_PASS_MS, Scanner, ScannerScreen } from "../src/booth/scanner.tsx";
import { GuestCardBody } from "../src/booth/card.tsx";
import { elements, mountHooks } from "./hooks-harness.ts";
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

  it("× over a card leaves the scanner and closes the pass gate for that guest; Next guest goes back to the camera", async () => {
    const session = {
      auth: { token: "t", character: "Norton", admin: false, eventId: "default" },
      view: null,
      scan: (id: string) => Promise.resolve({ guest: { id, name: "Ada" }, card: { guest: { id, name: "Ada", faction: null, captured: false, location: null }, live: [], guestScoped: [], readouts: [] }, responses: ["✅ Cleared Ada."] }),
    } as unknown as PrimeSession;
    let closed = 0;
    const gate = closedGate(CLOSED_PASS_MS);
    const h = mountHooks(ScannerScreen, { session, admin: false, gate, queue: true, onClose: () => (closed += 1), onOpenThread: () => {} });
    const scan = () => elements(h.output).find((e) => e.type === Scanner)!.props as { onScan: (id: string) => Promise<boolean> };
    const layer = () => h.output as { props: { onClose: () => void } };
    const body = () => elements(h.output).find((e) => e.type === GuestCardBody)?.props as { onNext?: () => void } | undefined;
    await scan().onScan("g-1");
    h.act(() => {});
    expect(body()).toBeDefined();
    // 📷 Next guest: the camera again, the scanner stays open.
    body()!.onNext!();
    h.act(() => {});
    expect(body()).toBeUndefined();
    expect(closed).toBe(0);
    expect(gate.allows("g-1")).toBe(false);
    // A new card, then ×: one tap leaves.
    const other = closedGate(CLOSED_PASS_MS);
    const h2 = mountHooks(ScannerScreen, { session, admin: false, gate: other, queue: true, onClose: () => (closed += 1), onOpenThread: () => {} });
    await (elements(h2.output).find((e) => e.type === Scanner)!.props as { onScan: (id: string) => Promise<boolean> }).onScan("g-2");
    h2.act(() => {});
    (h2.output as { props: { onClose: () => void } }).props.onClose();
    expect(closed).toBe(1);
    expect(other.allows("g-2")).toBe(false);
    // On the camera × leaves too.
    layer().props.onClose();
    expect(closed).toBe(2);
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
    expect(html).toContain("Or type a pass id or a codex code");
    expect(html).toContain("Scan a pass or a codex QR");
    expect(html).toContain("ico-scan");
    expect(html).not.toContain("behind");
  });
});
