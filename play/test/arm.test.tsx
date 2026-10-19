//! W11: a story button marked `arm: true` arms on the first tap and fires
//! on the second, through core's `tapCue` (ARM_MS / ARM_DEAD_MS), with the
//! director phone's look; every other button fires on the first tap.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ARM_DEAD_MS, ARM_LINE, ARM_MS, armTap, interactionAction, type ArmButtons } from "../src/arm.ts";
import { ActionRow } from "../src/chat.tsx";
import { splitInteractions } from "../src/performer.tsx";

describe("armTap", () => {
  it("arms, ignores a double-click, fires on a second tap in time", () => {
    const first = armTap(null, "patch_combo_a", 1000);
    expect(first.kind).toBe("arm");
    if (first.kind !== "arm") return;
    expect(armTap(first.armed, "patch_combo_a", 1000 + ARM_DEAD_MS - 1)).toEqual({ kind: "ignore" });
    expect(armTap(first.armed, "patch_combo_a", 1000 + ARM_DEAD_MS + 50)).toMatchObject({ kind: "fire", id: "patch_combo_a", subject: null });
  });

  it("a late second tap re-arms; another button arms itself instead", () => {
    const first = armTap(null, "patch_combo_a", 0);
    if (first.kind !== "arm") throw new Error("expected an arm");
    expect(armTap(first.armed, "patch_combo_a", ARM_MS).kind).toBe("arm");
    const other = armTap(first.armed, "patch_rejected", 500);
    expect(other.kind).toBe("arm");
    if (other.kind === "arm") expect(other.armed.id).toBe("patch_rejected");
  });
});

/** A fake hook state: what `useArmButtons` hands a screen. */
function fakeArm(armed: string | null): ArmButtons & { taps: Array<{ id: string; arm: boolean | undefined }> } {
  const taps: Array<{ id: string; arm: boolean | undefined }> = [];
  return { armed, taps, tap: (id, arm, fire) => (taps.push({ id, arm }), arm === true ? undefined : fire()) };
}

describe("interactionAction", () => {
  it("routes every tap through the arm model and carries the armed look", () => {
    let fired = 0;
    const arm = fakeArm("patch_combo_a");
    const a = interactionAction({ id: "patch_combo_a", label: "🔌 Combo A", arm: true }, arm, () => fired++);
    expect(a.armed).toBe(true);
    a.onClick();
    expect(arm.taps).toEqual([{ id: "patch_combo_a", arm: true }]);
    expect(fired).toBe(0); // the fake only fires a plain button
    const plain = interactionAction({ id: "vouch", label: "🤝 Vouch" }, arm, () => fired++);
    expect(plain.armed).toBeUndefined();
    plain.onClick();
    expect(fired).toBe(1);
  });

  it("an armed button reads black with 'Tap again to fire'", () => {
    const html = renderToStaticMarkup(<ActionRow actions={[{ label: "🔌 Combo A", onClick: () => {}, armed: true }, { label: "🤝 Vouch", onClick: () => {} }]} />);
    expect(html).toContain('class="choice ghost armed"');
    expect(html).toContain(`<span class="arm-line">${ARM_LINE}</span>`);
    expect(ARM_LINE).toBe("Tap again to fire");
    expect(html.match(/arm-line/g)).toHaveLength(1);
  });

  it("the booth keeps an interaction's `arm` through its split", () => {
    const { mine } = splitInteractions([{ id: "patch_combo_a", label: "🔌", who: "performer", description: null, arm: true }], "Norton", false);
    expect(mine[0]?.arm).toBe(true);
  });
});
