// Wave 18 (booth lane): the Wanted board and its posters (BOOTH-SPEC §4.2),
// the card's WANTED banner, the confrontation screen (§4.3) and the pop-out
// dock inside the card's scroll, never over its face (§2.2 rule 6). Wave 37
// (C11): a claimed poster stays in its place on Open.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { elements, mountHooks } from "./hooks-harness.ts";

import { Poster, WantedBanner } from "../src/booth/wanted/poster.tsx";
import { WantedBoard, defaultBoardTab } from "../src/booth/wanted/board.tsx";
import { ConfrontScreen, scannedLine } from "../src/booth/confront.tsx";
import { GuestCardBody, unmarkIdOf } from "../src/booth/card.tsx";
import { PopOutScope, resetPopOutStores, usePopOuts, type PopOutSpec } from "../src/booth/popouts/rung.ts";
import { stripText } from "../src/moments/popout-model.ts";
import type { PrimeSession } from "../src/session/prime.ts";
import type { WantedEntry } from "../src/booth/wire.ts";

const W = (id: string, extra: Partial<WantedEntry> = {}): WantedEntry => ({ id, name: id, reason: "named on the Bingo card", location: "Desktop", lastSeen: 0, markedAt: 1, claimedBy: null, captured: false, ...extra });
const noop = () => {};

describe("the Wanted poster (§4.2)", () => {
  it("an open poster: WANTED head, name, reason, 📍, claim + card", () => {
    const html = renderToStaticMarkup(<Poster w={W("Napster")} me="Norton" now={60_000} wall={60_000} place="The Cloud" fresh />);
    expect(html).toContain("W A N T E D");
    expect(html).toContain("Napster");
    expect(html).toContain("NEW");
    expect(html).toContain("named on the Bingo card");
    expect(html).toContain("📍 The Cloud · seen 1 min ago");
    expect(html).toContain("🙋 I&#x27;ll get them");
    expect(html).toContain("🗂 Card ›");
  });
  it("mine: YOURS + Scan their pass (+ Hand back with A2); theirs: grey, take-over only when stale and A3", () => {
    const mine = renderToStaticMarkup(<Poster w={W("Encarta", { claimedBy: "Norton" })} me="Norton" now={0} wall={0} place="The Desktop" canRelease />);
    // Wave 37 (C11): the tag reads YOURS / "🙋 X is on it", as a kept poster on Open does.
    expect(mine).toContain('<span class="wanted-tag you">YOURS</span>');
    expect(mine).toContain("📷 Scan their pass");
    expect(mine).toContain("Hand back");
    const theirs = renderToStaticMarkup(<Poster w={W("ICQ", { claimedBy: "McAfee Anti-Virus" })} me="Norton" now={11 * 60_000} wall={11 * 60_000} claimedAt={0} place="The Tube" canTakeOver />);
    expect(theirs).toContain("wanted-poster theirs");
    expect(theirs).toContain('<span class="wanted-tag">🙋 McAfee Anti-Virus is on it</span>');
    expect(theirs).toContain("claimed 11 min ago");
    expect(theirs).toContain("Still on it?");
    expect(theirs).toContain("🙋 Take over");
    const fresh = renderToStaticMarkup(<Poster w={W("ICQ", { claimedBy: "McAfee Anti-Virus" })} me="Norton" now={60_000} wall={60_000} claimedAt={0} place="The Tube" canTakeOver />);
    expect(fresh).not.toContain("Take over");
  });
  it("caught: the CAPTURED stamp, CAUGHT BY, no buttons; hosts read only", () => {
    const html = renderToStaticMarkup(<Poster w={W("ICQ", { claimedBy: "Norton Anti-Virus", captured: true })} me="x" now={0} wall={0} place={null} />);
    expect(html).toContain("CAPTURED");
    expect(html).toContain("CAUGHT BY NORTON ANTI-VIRUS");
    expect(html).not.toContain("wanted-actions");
    expect(renderToStaticMarkup(<Poster w={W("A")} me="x" now={0} wall={0} place={null} readOnly />)).not.toContain("I&#x27;ll get them");
  });
  it("the card's banner: WANTED · reason, who is on it", () => {
    expect(renderToStaticMarkup(<WantedBanner w={W("A")} me="Norton" onClaim={noop} />)).toContain("🙋 Nobody yet");
    expect(renderToStaticMarkup(<WantedBanner w={W("A", { claimedBy: "Norton" })} me="Norton" />)).toContain("🙋 You");
    expect(renderToStaticMarkup(<WantedBanner w={W("A")} me="Norton" />)).toContain("WANTED · named on the Bingo card");
  });
});

describe("the Wanted board (§4.2)", () => {
  it("opens on Open when any is open, else Everyone; counts in the status bar; empty says so", () => {
    expect(defaultBoardTab([W("a")], "N")).toBe("open");
    expect(defaultBoardTab([W("a", { claimedBy: "N" })], "N")).toBe("everyone");
    const html = renderToStaticMarkup(<WantedBoard wanted={[W("a"), W("b", { claimedBy: "N" }), W("c", { captured: true })]} me="N" now={0} placeTitle={(l) => l} onCard={noop} onClose={noop} />);
    expect(html).toContain("Wanted (2)");
    expect(html).toContain("Open (1)");
    expect(html).toContain("Mine (1)");
    expect(html).toContain("Everyone (3)");
    expect(html).toContain("2 marked · 1 claimed · 1 caught");
    const host = renderToStaticMarkup(<WantedBoard wanted={[W("a")]} me="N" now={0} placeTitle={(l) => l} readOnly onCard={noop} onClose={noop} />);
    expect(host).toContain("· Radio an Antivirus.");
    expect(host).not.toContain("role=\"tablist\"");
    expect(renderToStaticMarkup(<WantedBoard wanted={[]} me="N" now={0} placeTitle={(l) => l} onCard={noop} onClose={noop} />)).toContain("Nobody is marked. The computer is clean… for now.");
  });
});

describe("wave 37 (C11): the Open tab keeps a claimed poster in place", () => {
  const props = (wanted: WantedEntry[]) => ({ wanted, me: "Norton", now: 0, placeTitle: (l: string | null) => l, onCard: noop, onClose: noop, onClaim: noop, onScan: noop });
  const posters = (out: unknown) => elements(out).filter((e) => e.type === Poster) as Array<ReactElement<{ w: WantedEntry }>>;
  const tabs = (out: unknown) => elements(out).filter((e) => e.props && (e.props as { role?: string }).role === "tab").map((e) => (e.props as { children: unknown[] }).children.join(""));
  const marks = [W("Pong", { markedAt: 1 }), W("Encarta", { markedAt: 2 }), W("WinZip", { markedAt: 3 })];

  it("my claim keeps the poster at its index, as mine (📷 Scan their pass, no claim)", () => {
    const h = mountHooks(WantedBoard, props(marks));
    expect(posters(h.output).map((p) => p.props.w.id)).toEqual(["WinZip", "Encarta", "Pong"]);
    h.rerender(props([marks[0]!, W("Encarta", { markedAt: 2, claimedBy: "Norton" }), marks[2]!]));
    const after = posters(h.output);
    expect(after.map((p) => p.props.w.id)).toEqual(["WinZip", "Encarta", "Pong"]);
    expect(tabs(h.output)).toEqual(["Open (3)", "Mine (1)", "Everyone (3)"]);
    const mine = renderToStaticMarkup(<Poster {...after[1]!.props} me="Norton" now={0} place={null} onScan={noop} />);
    expect(mine).toContain("📷 Scan their pass");
    expect(mine).toContain("YOURS");
    expect(mine).not.toContain("I&#x27;ll get them");
  });

  it("someone else's claim keeps it too, named, with no claim button; a capture takes it off", () => {
    const h = mountHooks(WantedBoard, props(marks));
    h.rerender(props([marks[0]!, W("Encarta", { markedAt: 2, claimedBy: "McAfee Anti-Virus" }), marks[2]!]));
    const after = posters(h.output);
    expect(after.map((p) => p.props.w.id)).toEqual(["WinZip", "Encarta", "Pong"]);
    const theirs = renderToStaticMarkup(<Poster {...after[1]!.props} me="Norton" now={0} place={null} />);
    expect(theirs).toContain('<span class="wanted-tag">🙋 McAfee Anti-Virus is on it</span>');
    expect(theirs).not.toContain("I&#x27;ll get them");
    h.rerender(props([marks[0]!, W("Encarta", { markedAt: 2, claimedBy: "McAfee Anti-Virus", captured: true }), marks[2]!]));
    expect(posters(h.output).map((p) => p.props.w.id)).toEqual(["WinZip", "Pong"]);
  });

  it("back from a scan or a card (a remount) finds the tab chosen and the kept posters as they were", () => {
    const memo = { tab: null, kept: new Set<string>() };
    const h = mountHooks(WantedBoard, { ...props(marks), memo });
    const claimed = [marks[0]!, W("Encarta", { markedAt: 2, claimedBy: "Norton" }), marks[2]!];
    h.rerender({ ...props(claimed), memo });
    h.unmount();
    // Back on the board after × (it mounts again): Encarta, mine now, is still in its place on Open.
    const again = mountHooks(WantedBoard, { ...props([...claimed, W("ICQ", { markedAt: 9 })]), memo });
    expect(posters(again.output).map((p) => p.props.w.id)).toEqual(["WinZip", "Encarta", "Pong", "ICQ"]);
    // A tab picked on the board comes back too.
    const mineTab = elements(again.output).find((e) => (e.props as { role?: string; children?: unknown[] })?.role === "tab" && String((e.props as { children: unknown[] }).children[0]) === "Mine")!;
    again.act(() => (mineTab.props as { onClick: () => void }).onClick());
    again.unmount();
    expect(memo.tab).toBe("mine");
    const third = mountHooks(WantedBoard, { ...props(claimed), memo });
    expect(posters(third.output).map((p) => p.props.w.id)).toEqual(["Encarta"]);
    // A fresh opening (no memo) starts on Open with nothing kept.
    expect(posters(mountHooks(WantedBoard, props(claimed)).output).map((p) => p.props.w.id)).toEqual(["WinZip", "Pong"]);
  });

  it("a mark that lands while the board is open joins below, never on top", () => {
    const h = mountHooks(WantedBoard, props(marks));
    h.rerender(props([...marks, W("ICQ", { markedAt: 9 })]));
    expect(posters(h.output).map((p) => p.props.w.id)).toEqual(["WinZip", "Encarta", "Pong", "ICQ"]);
  });
});

describe("the confrontation (§4.3)", () => {
  const c = { guest: "g1", name: "Minesweeper", reason: "named on the Bingo card", shield: "send to the internet", arm: false, deadMs: 600, claimedBy: "Norton" };
  const press = () => Promise.resolve({ ok: true as const, guest: null });
  it("in person: CORRUPTION DETECTED, SAY IT, 🛡 disabled for the dead time, Not now, 🩹", () => {
    const html = renderToStaticMarkup(<ConfrontScreen c={c} me="Norton" said={["Corruption detected: come with me."]} unmarkId="unmark" press={press} onNotNow={noop} onNext={noop} scannedAt={new Date(2026, 9, 31, 19, 12)} />);
    expect(html).toContain("⚠ CORRUPTION DETECTED");
    expect(html).toContain("Marked for reinstallation: named on the Bingo card");
    expect(html).toContain("SAY IT:");
    expect(html).toContain("🛡 SEND TO THE INTERNET");
    expect(html).toMatch(/confront-shield[^"]*dead"[^>]*disabled/);
    expect(html).toContain("Ready in a moment");
    expect(html).toContain("Not now");
    expect(html).toContain("🩹 Not them…");
    expect(html).toContain("claimed by you");
    expect(html).not.toContain("Not scanned in person");
  });
  it("remote (Scan again): no dead time, two taps", () => {
    const html = renderToStaticMarkup(<ConfrontScreen c={{ ...c, arm: true, deadMs: 0 }} me="Norton" press={press} onNotNow={noop} onNext={noop} />);
    expect(html).toContain("📡 Not scanned in person: tap twice.");
    expect(html).not.toContain("Ready in a moment");
  });
  it("says whose claim it was in the status bar; finds the 🩹 button", () => {
    expect(scannedLine(new Date(2026, 9, 31, 19, 12), null, "Norton")).toMatch(/^Scanned .*7:12.* · nobody had claimed them$/u);
    expect(unmarkIdOf(["a", "b"], [{ id: "a", label: "🛡 Send" }, { id: "b", label: "🩹 Not going" }])).toBe("b");
  });
});

describe("the pop-outs on a card (§2.2 rule 6; wave 37 C4: quiet, never docked)", () => {
  const spec: PopOutSpec = { key: "wanted:icq", glyph: "🚨", title: "WANTED", body: "x", guest: { id: "icq", name: "ICQ", location: "The Tube" }, actions: [], tone: "alarm", sticky: true, priority: 90, at: 1 };
  it("the quiet scope is in .booth-card-scroll, before the face; no dock", () => {
    const src = readFileSync(join(__dirname, "../src/booth/card.tsx"), "utf8");
    const scroll = src.indexOf('className="booth-card-scroll"');
    expect(scroll).toBeGreaterThan(-1);
    const after = src.slice(scroll);
    expect(after.indexOf("<PopOutQuiet />")).toBeGreaterThan(-1);
    expect(after.indexOf("<PopOutQuiet />")).toBeLessThan(after.indexOf("booth-card-foot"));
    expect(src).not.toContain("PopOutDock");
  });
  it("a scope's seed lands in that booth's store (the strip's words)", () => {
    resetPopOutStores();
    function Probe() {
      const p = usePopOuts();
      return <i>{p.current !== null ? stripText(p.current) : "none"}</i>;
    }
    const html = renderToStaticMarkup(
      <PopOutScope session="t-dock" seed={[spec]}>
        <Probe />
      </PopOutScope>,
    );
    expect(html).toContain("WANTED: ICQ · 📍 The Tube");
  });
});
