//! Wave 13 (chrome): the guest's ⊞ Start menu — who you are on its banner,
//! the old ☰ sheet's items, and Leave behind a confirmation.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ARM_LINE } from "../src/arm.ts";
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
    defectTo: ["The Way Out"],
    wake: { supported: true, on: false },
    push: true,
    people: true,
    open: { picture: noop, wake: noop, alerts: noop, people: noop, help: noop, act: noop, defect: noop, leave: noop },
    ...extra,
  };
}

describe("the Start menu", () => {
  it("lists the story's buttons first, then people, help, the phone's settings, switching sides, and Leave last", () => {
    expect(guestStartItems(input()).map((i) => i.id)).toEqual(["act:bathroom_mode", "people", "help", "picture", "wake", "alerts", "defect:The Way Out", "leave"]);
    expect(guestStartItems(input()).find((i) => i.id === "defect:The Way Out")!.label).toBe("Leave the Unlimited Power for The Way Out");
  });

  it("a story button's leading emoji goes in the icon column", () => {
    expect(guestStartItems(input()).find((i) => i.id === "act:bathroom_mode")).toMatchObject({ icon: "🚻", label: "Bathroom Mode" });
    expect(splitIcon("Plain words")).toEqual({ label: "Plain words" });
    expect(splitIcon("❤️ Love")).toEqual({ icon: "❤️", label: "Love" });
  });

  it("drops what this phone can't do", () => {
    const bare = guestStartItems(input({ interactions: [], defectTo: [], wake: null, push: false, people: false, faction: null }));
    expect(bare.map((i) => i.id)).toEqual(["help", "picture", "leave"]);
    expect(guestStartItems(input({ wake: { supported: false, on: false } })).map((i) => i.id)).not.toContain("wake");
    expect(guestStartItems(input({ wake: { supported: true, on: true } })).find((i) => i.id === "wake")!.label).toContain("Screen stays on");
    expect(pushOffered({ state: "unsupported" })).toBe(false);
    expect(pushOffered({ state: "off" })).toBe(false);
    expect(pushOffered({ state: "ask" })).toBe(true);
    expect(pushOffered({ state: "ios-install" })).toBe(true);
  });

  it("Leave confirms first: one tap asks, the second fires", () => {
    const leave = guestStartItems(input()).find((i) => i.id === "leave")!;
    expect(leave).toMatchObject({ danger: true, confirm: leaveQuestion("Winamp") });
    expect(leaveQuestion("Winamp")).toBe("Leave the event? This phone stops being Winamp.");
    expect(startTap(null, leave)).toEqual({ asking: "leave", fire: false });
    expect(startTap("leave", leave)).toEqual({ asking: null, fire: true });
    // Asking about another item doesn't fire this one.
    expect(startTap("defect:The Way Out", leave)).toEqual({ asking: "leave", fire: false });
    // An item with no question fires at once.
    expect(startTap(null, { id: "help" })).toEqual({ asking: null, fire: true });
  });

  it("an `arm: true` story button asks once in place", () => {
    const items = guestStartItems(input({ interactions: [bathroom, armed] }));
    expect(items.find((i) => i.id === "act:self_destruct")!.confirm).toBe(ARM_LINE);
    expect(items.find((i) => i.id === "act:bathroom_mode")!.confirm).toBeUndefined();
  });

  it("the banner shows your picture, your name, your side and where you are", () => {
    const out = renderToStaticMarkup(createElement(GuestStartHeader, { name: "Winamp", faction: "Unlimited Power", where: "📍 The Desktop" }));
    expect(out).toContain('class="pavatar lg');
    expect(out).toContain("Winamp");
    expect(out).toContain("Unlimited Power");
    expect(out).toContain("📍 The Desktop");
    expect(renderToStaticMarkup(createElement(GuestStartHeader, { name: "Winamp", faction: null, where: "" }))).toContain("unaligned");
  });
});
