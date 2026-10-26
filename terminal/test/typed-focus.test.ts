//! The tent kiosk's typed name (wave 26, T3): after a tap settles, the field
//! takes the focus back unless the tap left it on a control in the kiosk
//! card. A backdrop window's × or button (which Chrome focuses on a click)
//! would otherwise eat the guest's typing, and Enter would press it.

import { describe, expect, it } from "vitest";
import { takesFocusBack } from "../src/controls.tsx";

const body = { id: "body" };
const field = { id: "field" };
const connect = { id: "connect" };
const pick = { id: "pick" };
const popupClose = { id: "popup-x" };
const card = { contains: (n: unknown) => n === field || n === connect || n === pick };

describe("the kiosk field takes the focus back", () => {
  it("when the focus is nowhere: the body, nothing, or a node that has gone", () => {
    expect(takesFocusBack(body, { body, attached: true, scope: card })).toBe(true);
    expect(takesFocusBack(null, { body, attached: false, scope: card })).toBe(true);
    expect(takesFocusBack(field, { body, attached: false, scope: card })).toBe(true);
  });

  it("when a backdrop button outside the card took it", () => {
    expect(takesFocusBack(popupClose, { body, attached: true, scope: card })).toBe(true);
  });

  it("never off a control in the card: the field, CONNECT, a quick pick", () => {
    for (const a of [field, connect, pick]) expect(takesFocusBack(a, { body, attached: true, scope: card }), a.id).toBe(false);
  });

  it("with no scope element yet, any attached focus outside the body is taken back", () => {
    expect(takesFocusBack(popupClose, { body, attached: true, scope: null })).toBe(true);
  });
});
