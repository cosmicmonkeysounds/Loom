// Wave 18 (booth lane): the Wanted board and its posters (BOOTH-SPEC §4.2),
// the card's WANTED banner, the confrontation screen (§4.3) and the pop-out
// dock inside the card's scroll, never over its face (§2.2 rule 6).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Poster, WantedBanner } from "../src/booth/wanted/poster.tsx";
import { WantedBoard, defaultBoardTab } from "../src/booth/wanted/board.tsx";
import { ConfrontScreen, scannedLine } from "../src/booth/confront.tsx";
import { GuestCardBody, unmarkIdOf } from "../src/booth/card.tsx";
import { PopOutProvider, type PopOutSpec } from "../src/booth/popouts/rung.ts";
import type { PrimeSession } from "../src/session/prime.ts";
import type { WantedEntry } from "../src/booth/wire.ts";

const W = (id: string, extra: Partial<WantedEntry> = {}): WantedEntry => ({ id, name: id, reason: "named on the Bingo card", location: "Desktop", lastSeen: 0, markedAt: 1, claimedBy: null, captured: false, ...extra });
const noop = () => {};

describe("the Wanted poster (§4.2)", () => {
  it("an open poster: WANTED head, name, reason, 📍, claim + card", () => {
    const html = renderToStaticMarkup(<Poster w={W("Napster")} me="Norton" now={60_000} place="The Cloud" fresh />);
    expect(html).toContain("W A N T E D");
    expect(html).toContain("Napster");
    expect(html).toContain("NEW");
    expect(html).toContain("named on the Bingo card");
    expect(html).toContain("📍 The Cloud · seen 1 min ago");
    expect(html).toContain("🙋 I&#x27;ll get them");
    expect(html).toContain("🗂 Card ›");
  });
  it("mine: 🙋 YOU + Scan their pass (+ Hand back with A2); theirs: grey, take-over only when stale and A3", () => {
    const mine = renderToStaticMarkup(<Poster w={W("Encarta", { claimedBy: "Norton" })} me="Norton" now={0} place="The Desktop" canRelease />);
    expect(mine).toContain("🙋 YOU");
    expect(mine).toContain("📷 Scan their pass");
    expect(mine).toContain("Hand back");
    const theirs = renderToStaticMarkup(<Poster w={W("ICQ", { claimedBy: "McAfee Anti-Virus" })} me="Norton" now={11 * 60_000} claimedAt={0} place="The Tube" canTakeOver />);
    expect(theirs).toContain("wanted-poster theirs");
    expect(theirs).toContain("🙋 McAfee Anti-Virus");
    expect(theirs).toContain("claimed 11 min ago");
    expect(theirs).toContain("Still on it?");
    expect(theirs).toContain("🙋 Take over");
    const fresh = renderToStaticMarkup(<Poster w={W("ICQ", { claimedBy: "McAfee Anti-Virus" })} me="Norton" now={60_000} claimedAt={0} place="The Tube" canTakeOver />);
    expect(fresh).not.toContain("Take over");
  });
  it("caught: the CAPTURED stamp, CAUGHT BY, no buttons; hosts read only", () => {
    const html = renderToStaticMarkup(<Poster w={W("ICQ", { claimedBy: "Norton Anti-Virus", captured: true })} me="x" now={0} place={null} />);
    expect(html).toContain("CAPTURED");
    expect(html).toContain("CAUGHT BY NORTON ANTI-VIRUS");
    expect(html).not.toContain("wanted-actions");
    expect(renderToStaticMarkup(<Poster w={W("A")} me="x" now={0} place={null} readOnly />)).not.toContain("I&#x27;ll get them");
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

describe("the pop-out dock on a card (§2.2 rule 6)", () => {
  const spec: PopOutSpec = { key: "wanted:icq", glyph: "🚨", title: "WANTED", body: "x", guest: { id: "icq", name: "ICQ", location: "The Tube" }, actions: [], tone: "alarm", sticky: true, priority: 90, at: 1 };
  const session = { view: { character: "Norton", guests: [{ id: "w", name: "Winamp", faction: null, captured: false, location: null }], channels: [], spaces: [], interactions: [] }, auth: { token: "t", character: "Norton", admin: false, eventId: "e" } } as unknown as PrimeSession;
  it("renders as a strip inside .booth-card-scroll, before the face", () => {
    const html = renderToStaticMarkup(
      <PopOutProvider session="t" seed={[spec]}>
        <GuestCardBody session={session} guestId="w" admin={false} onOpenThread={noop} onNext={noop} />
      </PopOutProvider>,
    );
    const scroll = html.indexOf('class="booth-card-scroll"');
    const strip = html.indexOf("bpop-strip");
    const foot = html.indexOf("booth-card-foot");
    expect(scroll).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(scroll);
    expect(foot).toBeGreaterThan(strip);
    expect(html).toContain("WANTED: ICQ · 📍 The Tube");
  });
});
