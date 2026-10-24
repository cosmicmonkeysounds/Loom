//! Wave 13 (chrome): the guest's ⊞ Start menu — who you are on its banner,
//! the old ☰ sheet's items, Leave behind a confirmation, and `arm: true`
//! story buttons through core's arm model.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ARM_DEAD_MS, ARM_LINE, ARM_MS, armTap } from "../src/arm.ts";
import { StartMenuRow, startPress } from "../src/chrome/start-menu.tsx";
import { startTap } from "../src/chrome/taskbar.tsx";
import { GuestStartHeader, guestStartItems, leaveQuestion, pushOffered, splitIcon, type GuestStartInput } from "../src/guest/frame.tsx";
import type { Interaction } from "../src/types.ts";

const noop = () => {};
const bathroom: Interaction = { id: "bathroom_mode", label: "🚻 Bathroom Mode", who: "guest", description: null };
const armed: Interaction = { id: "self_destruct", label: "💣 Self-destruct", who: "guest", description: null, arm: true };

function input(extra: Partial<GuestStartInput> = {}): GuestStartInput {
  return {
    name: "Winamp",
    faction: "Unlimited Power",
    interactions: [bathroom],
    sides: true,
    people: true,
    open: { act: noop, sides: noop, people: noop, notifications: noop, help: noop, leave: noop },
    ...extra,
  };
}

describe("the Start menu", () => {
  it("wave 18 (§8.2): the story's buttons first, then Sides & crews, People, Notifications, Help, and Leave last", () => {
    expect(guestStartItems(input()).map((i) => i.id)).toEqual(["act:bathroom_mode", "sides", "people", "notifications", "help", "leave"]);
    expect(guestStartItems(input()).find((i) => i.id === "sides")!.label).toBe("Sides & crews");
  });

  it("rule 9: the story's buttons + at most five items; no picture, wake, alerts or Leave-X-for-Y", () => {
    const items = guestStartItems(input());
    expect(items.filter((i) => !i.id.startsWith("act:")).length).toBeLessThanOrEqual(5);
    for (const gone of ["picture", "wake", "alerts"]) expect(items.map((i) => i.id)).not.toContain(gone);
    expect(items.some((i) => i.id.startsWith("defect:"))).toBe(false);
  });

  it("a story button's leading emoji goes in the icon column", () => {
    expect(guestStartItems(input()).find((i) => i.id === "act:bathroom_mode")).toMatchObject({ icon: "🚻", label: "Bathroom Mode" });
    expect(splitIcon("Plain words")).toEqual({ label: "Plain words" });
    expect(splitIcon("❤️ Love")).toEqual({ icon: "❤️", label: "Love" });
  });

  it("drops what the story doesn't have", () => {
    const bare = guestStartItems(input({ interactions: [], sides: false, people: false, faction: null }));
    expect(bare.map((i) => i.id)).toEqual(["notifications", "help", "leave"]);
    expect(pushOffered({ state: "unsupported" })).toBe(false);
    expect(pushOffered({ state: "off" })).toBe(false);
    expect(pushOffered({ state: "ask" })).toBe(true);
    expect(pushOffered({ state: "ios-install" })).toBe(true);
  });

  it("Leave confirms first: one tap asks, the second fires", () => {
    const leave = guestStartItems(input()).find((i) => i.id === "leave")!;
    expect(leave).toMatchObject({ danger: true, confirm: leaveQuestion("Winamp") });
    expect(leaveQuestion("Winamp")).toBe("Leave the event? This phone stops being Winamp. You stay Winamp — to come back, scan your badge or ask a host.");
    expect(startTap(null, leave)).toEqual({ asking: "leave", fire: false });
    expect(startTap("leave", leave)).toEqual({ asking: null, fire: true });
    // Asking about another item doesn't fire this one.
    expect(startTap("defect:The Way Out", leave)).toEqual({ asking: "leave", fire: false });
    // An item with no question fires at once.
    expect(startTap(null, { id: "help" })).toEqual({ asking: null, fire: true });
  });

  it("an `arm: true` story button goes through core's arm model, never the in-place question", () => {
    const items = guestStartItems(input({ interactions: [bathroom, armed] }));
    const destruct = items.find((i) => i.id === "act:self_destruct")!;
    expect(destruct).toMatchObject({ arm: true });
    expect(destruct.confirm).toBeUndefined();
    expect(startPress(destruct)).toBe("arm");
    expect(items.find((i) => i.id === "act:bathroom_mode")!.arm).toBeUndefined();
    expect(startPress(items.find((i) => i.id === "act:bathroom_mode")!)).toBe("fire");
    expect(startPress(items.find((i) => i.id === "leave")!)).toBe("confirm");
    expect(startPress({ arm: true, confirm: "?" })).toBe("arm");
    // The model the menu drives: dead time, the 4 s window, then it re-arms.
    const first = armTap(null, destruct.id, 0);
    expect(first.kind).toBe("arm");
    if (first.kind !== "arm") return;
    expect(armTap(first.armed, destruct.id, ARM_DEAD_MS - 1).kind).toBe("ignore");
    expect(armTap(first.armed, destruct.id, ARM_DEAD_MS + 1).kind).toBe("fire");
    expect(armTap(first.armed, destruct.id, ARM_MS).kind).toBe("arm");
  });

  it("an armed item reads Tap again to fire on the item itself; a question names the item's own words", () => {
    const destruct = guestStartItems(input({ interactions: [armed] })).find((i) => i.id === "act:self_destruct")!;
    const on = renderToStaticMarkup(createElement(StartMenuRow, { item: destruct, armed: true, asking: false, onPick: noop, onCancel: noop }));
    expect(on).toContain('class="start-menu-item armed"');
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain(ARM_LINE);
    const off = renderToStaticMarkup(createElement(StartMenuRow, { item: destruct, armed: false, asking: false, onPick: noop, onCancel: noop }));
    expect(off).not.toContain(ARM_LINE);
    expect(off).toContain('aria-pressed="false"');
    const leave = guestStartItems(input()).find((i) => i.id === "leave")!;
    const ask = renderToStaticMarkup(createElement(StartMenuRow, { item: leave, armed: false, asking: true, onPick: noop, onCancel: noop }));
    expect(ask).toContain(leaveQuestion("Winamp"));
    expect(ask).toContain(">Leave the event</button>");
    expect(ask).toContain(">Cancel</button>");
    expect(ask).not.toContain(ARM_LINE);
  });

  it("the banner shows your picture, your name, your side and where you are", () => {
    const out = renderToStaticMarkup(createElement(GuestStartHeader, { name: "Winamp", faction: "Unlimited Power", where: "📍 The Desktop" }));
    expect(out).toContain('class="pavatar lg');
    expect(out).toContain("Winamp");
    expect(out).toContain("Unlimited Power");
    expect(out).toContain("📍 The Desktop");
    expect(renderToStaticMarkup(createElement(GuestStartHeader, { name: "Winamp", faction: null, where: "" }))).toContain("unaligned");
    // wave 18: the banner is a button to the Me sheet
    const me = renderToStaticMarkup(createElement(GuestStartHeader, { name: "Winamp", faction: null, where: "", onMe: noop }));
    expect(me).toMatch(/^<button type="button" class="start-who start-who-btn" aria-label="Me: Winamp">/u);
  });
});
