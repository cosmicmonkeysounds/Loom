//! Wave 13 (chrome): the tray's balloon tip closes on a tap outside it —
//! and a tap inside it still counts as inside when the app runs embedded
//! in the editor's Run → Players panes (shadow roots, where a document
//! listener sees `e.target` retargeted to the shadow host).

import { describe, expect, it } from "vitest";
import { balloonScope, eventRoot, tappedInside } from "../src/chrome/balloon.tsx";

/** A minimal node: `contains` walks `parent` links (like the DOM, but never across a shadow boundary). */
interface FakeNode {
  name: string;
  parent: FakeNode | null;
  contains(other: unknown): boolean;
  nodeType: number;
}
function node(name: string, parent: FakeNode | null = null): FakeNode {
  const n: FakeNode = {
    name,
    parent,
    nodeType: 1,
    contains(other: unknown) {
      for (let o = other as FakeNode | null; o !== null && o !== undefined; o = o.parent) if (o === n) return true;
      return false;
    },
  };
  return n;
}
/** The path a real event carries from `n` up (crossing into the host with `host`). */
function pathOf(n: FakeNode, host: FakeNode[] = []): FakeNode[] {
  const out: FakeNode[] = [];
  for (let o: FakeNode | null = n; o !== null; o = o.parent) out.push(o);
  return [...out, ...host];
}

describe("the balloon's tap-away", () => {
  // Inside the pane: frame > taskbar > slot > [tray item, balloon > button].
  const frame = node("frame");
  const slot = node("slot", node("taskbar", frame));
  const item = node("item", slot);
  const tip = node("tip", slot);
  const go = node("go", tip);
  const room = node("room", frame);
  const shadowHost = node("host");
  const doc = node("document");

  it("a tap on the tip's button is inside it in the plain page", () => {
    expect(tappedInside({ target: go as unknown as EventTarget, composedPath: () => pathOf(go, [doc]) as unknown as EventTarget[] }, slot as unknown as Node)).toBe(true);
  });

  it("embedded: the target is the shadow host, but the composed path still names the tip", () => {
    const e = { target: shadowHost as unknown as EventTarget, composedPath: () => pathOf(go, [shadowHost, doc]) as unknown as EventTarget[] };
    // The old rule (`scope.contains(e.target)`) called this outside.
    expect((slot as unknown as Node).contains(e.target as Node)).toBe(false);
    expect(tappedInside(e, slot as unknown as Node)).toBe(true);
  });

  it("the tray item it rose from is inside too (its own tap toggles it)", () => {
    expect(tappedInside({ target: shadowHost as unknown as EventTarget, composedPath: () => pathOf(item, [shadowHost, doc]) as unknown as EventTarget[] }, slot as unknown as Node)).toBe(true);
  });

  it("a tap on a room is outside", () => {
    expect(tappedInside({ target: shadowHost as unknown as EventTarget, composedPath: () => pathOf(room, [shadowHost, doc]) as unknown as EventTarget[] }, slot as unknown as Node)).toBe(false);
  });

  it("with no composed path it falls back to the target", () => {
    expect(tappedInside({ target: go as unknown as EventTarget }, slot as unknown as Node)).toBe(true);
    expect(tappedInside({ target: room as unknown as EventTarget }, slot as unknown as Node)).toBe(false);
    expect(tappedInside({ target: null }, slot as unknown as Node)).toBe(false);
  });

  it("the scope is the tray slot when the tip sits in one, else the tip", () => {
    const inSlot = { parentElement: { classList: { contains: (c: string) => c === "tray-slot" } } };
    const floating = { parentElement: { classList: { contains: () => false } } };
    expect(balloonScope(inSlot as unknown as Element)).toBe(inSlot.parentElement);
    expect(balloonScope(floating as unknown as Element)).toBe(floating);
  });

  it("listens on the part's own root: a shadow root when embedded", () => {
    const shadow = { nodeType: 11, addEventListener() {}, removeEventListener() {} };
    expect(eventRoot({ getRootNode: () => shadow } as unknown as Node)).toBe(shadow);
  });
});
