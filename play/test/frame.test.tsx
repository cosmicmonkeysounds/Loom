//! Wave 13 (chrome): the guest frame's parts that act — the NOW sheet's
//! buttons (pass → the full-screen pass, scan → the scan sheet, a story
//! button → act, `arm: true` kept) and the tray's balance.

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArmButtons } from "../src/arm.ts";
import { BalanceTray, objectiveButton } from "../src/guest/frame.tsx";
import type { Interaction, WalletView } from "../src/types.ts";

const bathroom: Interaction = { id: "bathroom_mode", label: "🚻 Bathroom Mode", who: "guest", description: null };
const virus: Interaction = { id: "plant_the_virus", label: "💾 Insert a disk into the computer", who: "guest", description: null, arm: true };

function harness(armed: string | null = null) {
  const calls: string[] = [];
  const taps: Array<{ id: string; arm: boolean | undefined }> = [];
  // A fake arm model: records the tap; an `arm: true` tap only arms.
  const arm: ArmButtons = { armed, tap: (id, a, fire) => (taps.push({ id, arm: a }), a === true ? undefined : fire()) };
  const button = objectiveButton({
    interactions: [bathroom, virus],
    arm,
    onPass: () => calls.push("pass"),
    onScan: () => calls.push("scan"),
    onAct: (i) => calls.push(`act:${i.id}`),
  });
  const press = (id: string) => (button(id) as ReactElement<{ onClick: () => void }>).props.onClick();
  return { button, press, calls, taps };
}

describe("Mission's big buttons (wave 18: was the NOW sheet's)", () => {
  it("pass opens the pass, scan the scan sheet", () => {
    const h = harness();
    h.press("pass");
    h.press("scan");
    expect(h.calls).toEqual(["pass", "scan"]);
    expect(renderToStaticMarkup(h.button("pass")!)).toContain("SHOW MY PASS");
    expect(renderToStaticMarkup(h.button("scan")!)).toContain("SCAN A CODE");
    expect(renderToStaticMarkup(h.button("pass")!)).toContain("mission-big");
  });

  it("a story button acts through the arm model", () => {
    const h = harness();
    h.press("bathroom_mode");
    expect(h.taps).toEqual([{ id: "bathroom_mode", arm: undefined }]);
    expect(h.calls).toEqual(["act:bathroom_mode"]);
  });

  it("an `arm: true` button's first tap only arms it", () => {
    const h = harness();
    h.press("plant_the_virus");
    expect(h.taps).toEqual([{ id: "plant_the_virus", arm: true }]);
    expect(h.calls).toEqual([]);
    const armed = renderToStaticMarkup(harness("plant_the_virus").button("plant_the_virus")!);
    expect(armed).toContain('class="choice mission-big armed"');
    expect(armed).toContain("Tap again to fire");
  });

  it("an id this guest can't press is no button", () => {
    expect(harness().button("someone_elses_cue")).toBeNull();
  });
});

describe("the tray's balance", () => {
  const view: WalletView = { name: "Truthcoin", balance: 100, escrowed: 0, maxTransfer: 50, transfers: [], requests: [], offers: [] };
  it("reads 🪙 <balance>, 🧊 while frozen, and is a tap target", () => {
    const out = renderToStaticMarkup(createElement(BalanceTray, { view, frozen: false, onOpen: () => {} }));
    expect(out).toContain('class="tray-slot"');
    expect(out).toContain("ico-coin");
    expect(out).toContain(">100<");
    expect(out).toContain('aria-label="100 Truthcoin"');
    expect(out).toMatch(/^<span class="tray-slot"><button/u);
    const frozen = renderToStaticMarkup(createElement(BalanceTray, { view, frozen: true, onOpen: () => {} }));
    expect(frozen).toContain("ico-frozen");
    expect(frozen).toContain("tray-item dim");
  });
});
