//! Wave 18 recheck fixes (recheck/fixes.md): one regression test per finding.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShowClockItem } from "../src/chrome/show-clock-tray.tsx";
import { mergeAnswered, NO_ANSWERS } from "../src/session/shared.ts";
import { whereRowOf } from "../src/guest/mission-model.ts";
import { memberCount } from "../src/sides/model.ts";
import { drawnIcon } from "../src/moments/exits.ts";
import { ExitButtons } from "../src/moments/surfaces.tsx";
import { doneCards } from "../src/moments/provider.tsx";
import { registerSidesWidgets } from "../src/sides/widgets.tsx";
import { Doors } from "../src/sides/doors.tsx";
import { SidesContext } from "../src/sides/context.ts";
import type { ChatMessage } from "../src/types.ts";

describe("N1: a new sign-in counts the server's answered cards", () => {
  it("merges the server's answered seqs into this device's answers", () => {
    const local = new Map([[3, { choice: "a" }]]);
    const merged = mergeAnswered(local, [3, 340, 553]);
    expect(merged.get(3)).toEqual({ choice: "a" });
    expect(merged.has(340)).toBe(true);
    expect(merged.get(553)).toEqual({});
    expect(mergeAnswered(local, [3])).toBe(local);
    expect(mergeAnswered(NO_ANSWERS, undefined)).toBe(NO_ANSWERS);
  });
});

describe("N2: the guest tray never clips the balance", () => {
  const css = readFileSync(new URL("../src/css/chrome.css", import.meta.url), "utf8");
  it("the clock's AM / PM is its own span, dropped below 430 px", () => {
    const html = renderToStaticMarkup(createElement(ShowClockItem, { now: { minutes: 23 * 60 + 3, running: true } }));
    expect(html).toContain('11:03<span class="tray-tail"> PM</span>');
    expect(css).toContain("@media (max-width: 429px) {\n  .tray-clock.yields { display: none; }\n  .guest-frame .tray-clock .tray-tail { display: none; }\n}");
  });
  it("the balance never shrinks; only the clock does", () => {
    expect(css).toContain(".guest-frame .taskbar-tray > * { flex: 0 0 auto; }");
    expect(css).toContain(".guest-frame .taskbar-tray > .tray-clock { flex: 0 1 auto; min-width: 0; overflow: hidden; }");
  });
});

describe("N4 / NMR-4: Mission's Where row once the guest is on a side", () => {
  const place = { objective: "y2k", place: { id: "sides", name: "Choose a side" } };
  const side = (mine: boolean) => [{ id: "unlimited_power", name: "Unlimited Power", leader: "Excel", members: 4, needs: 13, mine }];
  it("reads Sides, not Choose a side", () => {
    expect(whereRowOf({ location: null, mission: place, sides: side(true) }, new Set(), new Map())).toMatchObject({ kind: "word", word: "sides", label: "🚪 Sides", nav: { to: "sides" } });
    expect(whereRowOf({ location: null, mission: place, sides: side(false) }, new Set(), new Map())).toMatchObject({ label: "🚪 Choose a side" });
  });
});

describe("N9: the crew's member count is pluralised", () => {
  it("1 member, 2 members", () => {
    expect(memberCount(1)).toBe("1 member");
    expect(memberCount(2)).toBe("2 members");
    expect(memberCount(0)).toBe("0 members");
  });
});

describe("N7: an exit shows one icon", () => {
  it("no drawn icon when the label leads with a pictograph", () => {
    expect(drawnIcon({ label: "🎱 To the Desktop", icon: "pin" as never })).toBeNull();
    expect(drawnIcon({ label: "🎟 Show my pass", icon: "pass" as never })).toBeNull();
    expect(drawnIcon({ label: "Go to The Desktop ›", icon: "pin" as never })).toBe("pin");
    const html = renderToStaticMarkup(createElement(ExitButtons, { exits: [{ label: "🎟 Show my pass", icon: "pass" as never, nav: { to: "pass" } }], onExit: () => {}, className: "moments-balloon-go" }));
    expect(html).not.toContain("<svg");
  });
  it("the balloon's exit is a flex row (the icon never wraps onto its own line)", () => {
    const css = readFileSync(new URL("../src/css/moments.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.moments-balloon-go \{\n  display: inline-flex; align-items: center;/u);
  });
});

describe("N5: after the ending the doors are no longer offered", () => {
  registerSidesWidgets();
  const doors = (seq: number, params: Record<string, string> = {}) =>
    ({ seq, channel: "dm:Truther Download", channelKind: "dm", title: "", from: "Truther Download", kind: "widget", text: "", ts: seq, audience: ["g-1"], parentSeq: null, hidden: false, widget: { kind: "sides", text: "🕚 Two doors.", params } }) as ChatMessage;
  it("the closing card supersedes the open one; both are done", () => {
    const msgs = new Map([[5, doors(5)], [9, doors(9, { closed: "true" })]]);
    expect([...doneCards(msgs)].sort()).toEqual([5, 9]);
    expect([...doneCards(new Map([[5, doors(5)]]))]).toEqual([]);
  });
  it("the doors render closed, with no Walk in", () => {
    const card = { kind: "sides", text: "🕚 Two doors.", params: { closed: "true" } };
    const out = renderToStaticMarkup(createElement(SidesContext.Provider, { value: { view: null, calls: null } }, createElement(Doors, { card, seed: 1, onAnswer: () => {}, answered: null })));
    expect(out).toContain("The doors have closed.");
    expect(out).not.toContain("Walk in");
    const old = renderToStaticMarkup(createElement(SidesContext.Provider, { value: { view: null, calls: null } }, createElement(Doors, { card: { ...card, params: {} }, seed: 1, superseded: true, answered: null })));
    expect(old).toContain("The doors have closed.");
  });
});
