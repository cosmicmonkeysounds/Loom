//! Sticky notices (wave 4, lane E): `activePins` keeps the newest pin per
//! (channel, key) until an unpin with the same key, and the `PinnedRail`
//! renders what is left — a `!` pin as an alert.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PinnedRail } from "../src/chat.tsx";
import { foldsSticky, isOwnPin, shownPin, stickiesOnRail } from "../src/moments/pins-rail.tsx";
import { readBundledCss } from "./css.ts";

import { activePins, activeTakeover } from "../src/pins.ts";
import { Takeover } from "../src/takeover.tsx";
import type { ChatMessage } from "../src/types.ts";

function m(seq: number, channel: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel, channelKind: "lobby", title: "Lobby", from: "", kind: "signal", text: `t${seq}`, ts: seq, audience: "all", parentSeq: null, hidden: false, ...extra };
}

describe("activePins", () => {
  it("keeps the newest pin per key; an unpin with the same key clears it", () => {
    const list = [m(1, "lobby", { pin: "g1", text: "Go." }), m(2, "lobby", { pin: "g1", text: "Go now." }), m(3, "lobby", { pin: "", text: "All." })];
    expect(activePins(list).map((x) => [x.seq, x.text])).toEqual([
      [2, "Go now."],
      [3, "All."],
    ]);
    expect(activePins([...list, m(4, "lobby", { kind: "system", unpin: "g1" })]).map((x) => x.seq)).toEqual([3]);
    // An unpin for a key nobody pinned is harmless.
    expect(activePins([...list, m(5, "lobby", { kind: "system", unpin: "g9" })]).map((x) => x.seq)).toEqual([2, 3]);
  });

  it("a different channel's unpin does not clear; `channel` narrows; hidden pins and thread replies are skipped", () => {
    const list = [
      m(1, "lobby", { pin: "g1" }),
      m(2, "room:quarantine", { pin: "g1", channelKind: "faction" }),
      m(3, "room:quarantine", { kind: "system", unpin: "g1" }),
      m(4, "lobby", { pin: "g2", hidden: true }),
      m(5, "lobby", { pin: "g3", parentSeq: 1 }),
    ];
    expect(activePins(list).map((x) => x.seq)).toEqual([1]);
    expect(activePins(list, "room:quarantine")).toEqual([]);
    expect(activePins(list, "lobby").map((x) => x.seq)).toEqual([1]);
  });

  it("orders by seq whatever order the messages arrive in", () => {
    const list = [m(9, "lobby", { pin: "b" }), m(2, "lobby", { pin: "a" }), m(5, "lobby", { pin: "a", text: "newer" })];
    expect(activePins(list).map((x) => [x.seq, x.pin])).toEqual([
      [5, "a"],
      [9, "b"],
    ]);
    // A later message with the same key (seq 5 over seq 2) wins even when listed first.
    expect(activePins([m(5, "lobby", { pin: "a", text: "newer" }), m(2, "lobby", { pin: "a", text: "older" })])[0]!.text).toBe("newer");
  });
});

describe("PinnedRail", () => {
  it("folds to one line — the count and the newest alert pin, else the newest — an alert pin turning it yellow; nothing when empty", () => {
    expect(renderToStaticMarkup(<PinnedRail pins={[]} />)).toBe("");
    const html = renderToStaticMarkup(<PinnedRail pins={[m(1, "lobby", { pin: "g1", text: "GO TO THE INTERNET.", alert: true }), m(2, "lobby", { pin: "", text: "Doors at nine." })]} />);
    expect(html).toContain('class="moments-pins alert"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/ico-pin[^]*?<\/svg> 2<\/span>/u);
    // The marked guest's instruction stays on the line, never behind a tap, and wraps rather than "…".
    expect(html).toContain('<span class="moments-pins-line wrap">GO TO THE INTERNET.</span>');
    // Folded: the other pin is not on screen (a tap opens the list).
    expect(html).not.toContain("moments-pins-list");
    expect(html).toMatch(/aria-label="2 pinned notices: GO TO THE INTERNET\. Tap to read\."/u);
    // No alert pin up: the newest pin.
    const plain = renderToStaticMarkup(<PinnedRail pins={[m(4, "lobby", { pin: "a", text: "Snacks in the kitchen" }), m(5, "lobby", { pin: "b", text: "Doors at nine." })]} />);
    expect(plain).toContain('<span class="moments-pins-line">Doors at nine.</span>');
    expect(plain).toMatch(/aria-label="2 pinned notices: Doors at nine\. Tap to read\."/u);
  });

  it("one plain pin reads as itself, no count, no alert colour", () => {
    const html = renderToStaticMarkup(<PinnedRail pins={[m(3, "lobby", { pin: "", text: "Doors at nine." })]} />);
    expect(html).toContain('class="moments-pins "');
    expect(html).toMatch(/<span class="moments-pins-count" aria-hidden="true"><svg class="ico ico-pin"[^]*?<\/svg><\/span>/u);
    expect(html).toContain("Doors at nine.");
  });

  it("the guest's own pin is the line (before an alert pin to the room) and is read whole", () => {
    const pins = [m(1, "lobby", { pin: "room", text: "Everyone: snacks in the kitchen.", alert: true }), m(2, "lobby", { pin: "g7", text: "GO TO THE INTERNET. You are marked for reinstallation.", alert: true, audience: ["g7"] }), m(3, "lobby", { pin: "x", text: "Doors at nine." })];
    expect(shownPin(pins, "g7")?.seq).toBe(2);
    expect(shownPin([pins[0]!, pins[2]!], "g8")?.seq).toBe(1); // no own pin: the alert pin
    expect(isOwnPin(pins[1]!, "g7")).toBe(true);
    expect(isOwnPin(pins[0]!, "g7")).toBe(false);
    const html = renderToStaticMarkup(<PinnedRail pins={pins} me="g7" />);
    expect(html).toContain('<span class="moments-pins-line wrap">GO TO THE INTERNET. You are marked for reinstallation.</span>');
    const css = readBundledCss();
    expect(/\.moments-pins-line\.wrap \{[^}]*white-space: normal[^}]*text-overflow: clip/u.test(css)).toBe(true);
  });

  it("one strip: a sticky folds into a '+n' on the guest's own pin, and shows on a tap", () => {
    const own = [m(2, "lobby", { pin: "g7", text: "GO TO THE INTERNET.", alert: true, audience: ["g7"] })];
    const room = [m(1, "lobby", { pin: "", text: "Doors at nine." })];
    const sticky = { key: "m:40", count: 1 };
    expect(foldsSticky(own, "g7", sticky, null)).toBe(true);
    // Opened ("+1" tapped): this sticky shows; a newer one folds again.
    expect(foldsSticky(own, "g7", sticky, "m:40")).toBe(false);
    expect(foldsSticky(own, "g7", { key: "m:41", count: 1 }, "m:40")).toBe(true);
    // No own pin (only a room's), or no sticky: nothing folds.
    expect(foldsSticky(room, "g7", sticky, null)).toBe(false);
    expect(foldsSticky(own, "g7", { key: null, count: 0 }, null)).toBe(false);
    const html = renderToStaticMarkup(<PinnedRail pins={own} me="g7" fold={{ count: 1, onOpen: () => {} }} />);
    expect(html).toMatch(/<button type="button" class="w95-btn moments-pins-more" aria-label="1 more notice — show it">\+1<\/button>/u);
  });

  it("a `!` pin's own sticky is read: the rail shows it whole, never a second yellow bar", () => {
    const own = [m(7, "lobby", { pin: "g7", text: "GO TO THE INTERNET.", alert: true, audience: ["g7"] })];
    expect(stickiesOnRail(own, "g7", ["m:7", "m:9"])).toEqual(["m:7"]);
    // A plain room pin (folded to one line, cut with "…") is not read for the guest.
    expect(stickiesOnRail([m(8, "lobby", { pin: "", text: "Doors at nine." })], "g7", ["m:8"])).toEqual([]);
  });

  it("the rail is one 44 px line from the tokens", () => {
    const css = readBundledCss();
    expect(/\.moments-pins-head \{[^}]*min-height: var\(--tap\)/u.test(css)).toBe(true);
  });
});

describe("the `!!` takeover", () => {
  it("activeTakeover is the newest takeover pin still up — from every room, gone after the unpin", () => {
    const list = [
      m(1, "lobby", { pin: "g1", text: "Go.", alert: true }),
      m(2, "lobby", { pin: "", text: "GO TO THE LIVING ROOM", alert: true, takeover: true }),
    ];
    expect(activeTakeover([])).toBeNull();
    expect(activeTakeover([list[0]!])).toBeNull();
    expect(activeTakeover(list)?.seq).toBe(2);
    // Read off the whole map, the way the guest app passes `s.messages.values()`.
    expect(activeTakeover(new Map(list.map((x) => [x.seq, x])).values())?.text).toBe("GO TO THE LIVING ROOM");
    expect(activeTakeover([...list, m(3, "lobby", { kind: "system", text: "Dance.", unpin: "" })])).toBeNull();
    // The personal pin under another key stays on the rail.
    expect(activePins([...list, m(3, "lobby", { kind: "system", unpin: "" })]).map((x) => x.seq)).toEqual([1]);
  });

  it("renders the pin's text full screen with no dismiss, nothing without a pin", () => {
    expect(renderToStaticMarkup(<Takeover pin={null} />)).toBe("");
    const html = renderToStaticMarkup(<Takeover pin={m(2, "lobby", { pin: "", text: "GO TO THE LIVING ROOM", takeover: true })} />);
    expect(html).toContain('class="takeover"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("GO TO THE LIVING ROOM");
    expect(html).not.toContain("<button");
  });

  it("flashes at most twice a second, never red, still under reduced motion, above the tour", () => {
    const css = readBundledCss();
    const rule = /\.takeover \{[^}]*\}/u.exec(css)![0];
    // One swap at 50% of a 1 s cycle = 2 changes a second.
    expect(rule).toMatch(/animation: takeover-invert 1s steps\(1, end\) infinite/u);
    expect(rule).toMatch(/position: absolute; inset: 0; z-index: 50/u);
    expect(rule).not.toMatch(/--bad|red|#f00/u);
    expect(css).toMatch(/@keyframes takeover-invert \{ 50% \{ background: var\(--highlight\); color: var\(--black\); \} \}/u);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.takeover \{ animation: none; \} \}/u);
  });
});
