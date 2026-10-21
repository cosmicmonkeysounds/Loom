//! Wave 18, the moments lane (GUEST-SPEC §5, C1): the big moment's words —
//! glyph, headline, body, the kicker table — and its markup: no ×, the
//! buttons dead for 1.2 s, a card inside it, the house cheer's countdown.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BigMoment } from "../src/moments/big.tsx";
import { BIG_DEAD_MS, bigParts, cheerLabel, kickerOf } from "../src/moments/big-model.ts";
import type { Exit } from "../src/moments/exits.ts";
import type { Moment } from "../src/moments/model.ts";
import type { WidgetHook } from "../src/stream/bubble.tsx";
import { readBundledCss } from "./css.ts";

function moment(over: Partial<Moment> = {}): Moment {
  return { key: "m:9", seq: 9, severity: "big", kind: "readout", caption: "Clippy", text: "🎀 You won a Bingo Ribbon. Take a bow.", channel: "dm:Clippy", at: 1000, phase: null, ...over };
}
const q = (m: Moment) => ({ moment: m, level: "big" as const, queuedAt: 0 });
const noop = () => {};
const PASS: Exit = { label: "🎟 Show my pass", icon: "pass", nav: { to: "pass" } };
const INTERNET: Exit = { label: "📍 Go to The Internet ›", icon: "pin", nav: { to: "room", id: "loc:The Internet" } };

describe("the words", () => {
  it("the leading pictograph, the first sentence, the rest", () => {
    expect(bigParts("🎀 You won a Bingo Ribbon. Take a bow.")).toEqual({ glyph: "🎀", headline: "You won a Bingo Ribbon.", body: "Take a bow." });
    expect(bigParts("No glyph here! And more.", "card")).toEqual({ glyph: "🃏", headline: "No glyph here!", body: "And more." });
    const long = `🛡 ${"word ".repeat(30)}end.`;
    const p = bigParts(long);
    expect(p.headline.length).toBeLessThanOrEqual(90);
    expect(p.headline.endsWith("…")).toBe(true);
    expect(p.body).toContain("end."); // nothing lost
  });

  it("the kicker table, first match", () => {
    expect(kickerOf(moment(), { cardInside: true })).toMatchObject({ kicker: "⚡ YOUR MOVE", ack: null, footer: "Answer to continue." });
    expect(kickerOf(moment({ card: { seq: 1, kind: "invite", glyph: "🚪" } })).kicker).toBe("🚪 AN INVITATION");
    expect(kickerOf(moment({ autoClose: 6000 }))).toMatchObject({ kicker: "📣 HOUSE NEWS", countdown: true });
    expect(kickerOf(moment({ text: "🛡️ CORRUPTION DETECTED. Norton has found you." }))).toMatchObject({ kicker: "⚠ VIRUS DETECTED", bar: { during: "Scanning…", done: "Threat found." }, ack: "OK" });
    expect(kickerOf(moment({ text: "🌐 Sent to the Internet." }))).toMatchObject({ kicker: "⛔ QUARANTINED", bar: { during: "Moving to the Internet…", done: "Done." } });
    for (const g of ["🎀", "🏆", "🎱", "🥇", "🦆", "✅", "🎉", "♟"]) expect(kickerOf(moment({ text: `${g} Yes.` })).kicker, g).toBe("★ ACHIEVEMENT UNLOCKED");
    expect(kickerOf(moment({ text: "🎀 Yes." })).ack).toBe("Collect ✓");
    expect(kickerOf(moment({ text: "⏳ Five minutes." }))).toMatchObject({ kicker: "! IMPORTANT", bar: { during: "Please wait…", done: "Ready." }, ack: "OK" });
    expect([cheerLabel(6000), cheerLabel(5001), cheerLabel(0)]).toEqual(["Cheer! (6)", "Cheer! (6)", "Cheer! (0)"]);
    expect(BIG_DEAD_MS).toBe(1200);
  });
});

describe("the window", () => {
  it("un-ignorable: an alertdialog, no ×, every button dead until the dead time passes", () => {
    const html = renderToStaticMarkup(createElement(BigMoment, { q: q(moment()), index: 1, total: 2, exits: [PASS], onExit: noop, onAck: noop }));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).not.toContain('aria-label="Close"');
    expect(html).not.toContain("w95-x");
    expect(html).toContain("★ ACHIEVEMENT UNLOCKED");
    expect(html).toContain("1 of 2");
    expect(html).toContain("You won a Bingo Ribbon.");
    expect(html).toContain("Installing achievement…");
    expect(html.match(/disabled=""/gu)).toHaveLength(2); // the exit and Collect ✓
    expect(html).toContain("Collect ✓");
  });

  it("found, then sent: the shapes of the confrontation and the capture", () => {
    const found = renderToStaticMarkup(createElement(BigMoment, { q: q(moment({ caption: "Norton Anti-Virus", text: "🛡 CORRUPTION DETECTED. Norton has found you. Stay with Norton." })), index: 1, total: 1, exits: [], onExit: noop, onAck: noop }));
    expect(found).toContain("⚠ VIRUS DETECTED");
    expect(found).toContain(">OK<");
    const sent = renderToStaticMarkup(createElement(BigMoment, { q: q(moment({ text: "🌐 Sent to the Internet. Go to the tent through the tunnel." })), index: 1, total: 1, exits: [INTERNET, PASS], onExit: noop, onAck: noop }));
    expect(sent).toContain("⛔ QUARANTINED");
    expect(sent).toContain("Go to The Internet");
    expect(sent).toContain("Show my pass");
  });

  it("a card inside: rendered there, no acknowledge until answered, the room named", () => {
    const widgets: WidgetHook = { answer: noop, answered: new Map() };
    const card = { card: { kind: "poll", text: "Truth or dare?", params: { options: "🗣 Truth|🎩 Dare" } }, seq: 9, room: "Trabolta" };
    const html = renderToStaticMarkup(createElement(BigMoment, { q: q(moment({ text: "🍾 The bottle landed on you. Truth or dare?", card: { seq: 9, kind: "poll", glyph: "🍾" } })), index: 1, total: 1, exits: [], onExit: noop, onAck: noop, card, widgets }));
    expect(html).toContain("⚡ YOUR MOVE");
    expect(html).toContain("moments-big-card");
    expect(html).toContain("Answer to continue. It&#x27;s also in Trabolta&#x27;s chat.");
    expect(html).not.toContain("moments-big-ack");
    // Answered elsewhere: an OK appears.
    const done = renderToStaticMarkup(createElement(BigMoment, { q: q(moment({ card: { seq: 9, kind: "poll", glyph: "🍾" } })), index: 1, total: 1, exits: [], onExit: noop, onAck: noop, card, widgets: { ...widgets, answered: new Map([[9, { option: "Truth" }]]) } }));
    expect(done).toContain(">OK<");
  });

  it("the house cheer counts down, with no dead time", () => {
    const html = renderToStaticMarkup(createElement(BigMoment, { q: q(moment({ text: "🎀 Encarta won the Bingo Ribbon! Cheer for them at the Desktop.", autoClose: 6000, house: true })), index: 1, total: 1, exits: [], onExit: noop, onAck: noop }));
    expect(html).toContain("📣 HOUSE NEWS");
    expect(html).toContain("Cheer! (6)");
    expect(html).not.toContain('disabled=""');
  });

  it("the stylesheet: full screen above the pass and below the takeover, 56 px buttons, still under Reduce Motion", () => {
    const css = readBundledCss();
    expect(css).toMatch(/\.moments-big \{[^}]*position: fixed;[^}]*z-index: var\(--z-big\)/u);
    expect(css).toMatch(/--z-big: 47;/u);
    expect(css).toMatch(/\.moments-big-buttons \.w95-btn \{[^}]*min-height: 56px/u);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.moments-big-fill \{[^}]*animation-timing-function: steps\(1, end\)/u);
  });
});

describe("plain theme", () => {
  it("the window flat: a 96 px banner and a hairline instead of the bevel", () => {
    const css = readBundledCss();
    expect(css).toMatch(/:root:not\(\[data-theme="aol97"\]\) \.moments-big-banner \{ height: 96px; \}/u);
    expect(css).toMatch(/:root:not\(\[data-theme="aol97"\]\) \.moments-big-window \{ box-shadow: 0 0 0 1px var\(--line\)/u);
  });
});
