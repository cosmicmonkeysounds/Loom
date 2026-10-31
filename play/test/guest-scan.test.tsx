//! W11 (W-13): the guest's in-app 📷 Scan and the wrong-browser landing.
//! A wall code read inside the app lands in the session already open; a
//! codex / check-in link that opens with no session shows the code to type
//! in the app the guest joined with, never the program picker.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChannelView, Composer } from "../src/chat.tsx";
import { initialRole } from "../src/director.tsx";
import { LinkLanding, landingLink, landingTypeLine, rejoinLine, roomFromSlug } from "../src/guest-scan.tsx";
// Wave 26: the Scan sheet and its classifiers are their own chunk.
import {
  SCAN_DIRECTOR,
  SCAN_INVITE,
  SCAN_JOIN,
  SCAN_STAFF,
  SCAN_OWN_PASS,
  SCAN_PAIR,
  SCAN_UNKNOWN,
  ScanSheet,
  TYPED_UNKNOWN,
  typedRoute,
  guestCameraProblem,
  guestScan,
  typedScan,
} from "../src/guest-scan-sheet.tsx";
import type { Channel } from "../src/types.ts";

const BASE = "https://party.example/";

describe("guestScan", () => {
  it("a codex QR redeems, a room's sign checks in", () => {
    expect(guestScan(`${BASE}?code=EVT1&unlock=COLD-FIRST`)).toEqual({ kind: "unlock", code: "COLD-FIRST" });
    expect(guestScan(`${BASE}?code=EVT1&checkin=the-start-bar`)).toEqual({ kind: "checkin", at: "the-start-bar" });
    // A bare code printed as its own QR text redeems too.
    expect(guestScan("COLD-SECOND")).toEqual({ kind: "unlock", code: "COLD-SECOND" });
  });

  it("anything else says what it is", () => {
    expect(guestScan(`${BASE}?code=EVT1`)).toEqual({ kind: "note", text: SCAN_JOIN });
    expect(guestScan(`${BASE}?code=EVT1&claim=ab12`)).toEqual({ kind: "note", text: SCAN_INVITE });
    expect(guestScan(`${BASE}?code=EVT1&pair=XYZ123`)).toEqual({ kind: "note", text: SCAN_PAIR });
    expect(guestScan(`${BASE}?role=director`)).toEqual({ kind: "note", text: SCAN_DIRECTOR });
    expect(guestScan("g-3f9a1c", "g-3f9a1c")).toEqual({ kind: "note", text: SCAN_OWN_PASS });
    expect(guestScan("G-3F9A1C", "g-3f9a1c")).toEqual({ kind: "note", text: SCAN_OWN_PASS });
    // wave 18 (F3): someone else's pass opens the Recruit sheet
    expect(guestScan("g-aaaaaa", "g-3f9a1c")).toEqual({ kind: "pass", id: "g-aaaaaa" });
    expect(guestScan(`${BASE}?pass=G-AAAAAA`, "g-3f9a1c")).toEqual({ kind: "pass", id: "g-aaaaaa" });
    expect(guestScan("https://example.com/menu")).toEqual({ kind: "note", text: SCAN_UNKNOWN });
    expect(guestScan("hello there, friend")).toEqual({ kind: "note", text: SCAN_UNKNOWN });
    expect(guestScan("   ")).toEqual({ kind: "note", text: SCAN_UNKNOWN });
  });

  it("a camera that can't run says to type the code in the box below", () => {
    for (const s of ["insecure", "denied", "none", "error"] as const) expect(guestCameraProblem(s)).toMatch(/type the code below/);
    expect(guestCameraProblem("live")).toBeNull();
    expect(guestCameraProblem("starting")).toBeNull();
  });
});

describe("the 📷 button", () => {
  it("docks in the Codex composer", () => {
    const codex = { id: "codex", kind: "codex", title: "Codex", spaceId: "pinned", messages: [], unread: 0 } as unknown as Channel;
    const html = renderToStaticMarkup(<ChannelView channel={codex} onBack={() => {}} onSend={() => {}} composerExtra={<button className="composer-scan">📷</button>} />);
    expect(html).toMatch(/<div class="composer"><button class="composer-scan">📷<\/button><textarea/);
    expect(html).toContain("Unlock");
    // Other composers carry nothing extra.
    expect(renderToStaticMarkup(<Composer onSend={() => {}} />)).not.toContain("composer-scan");
  });

  it("the sheet opens on the camera with the in-app hint", () => {
    const html = renderToStaticMarkup(<ScanSheet meId="g-3f9a1c" onScan={async () => null} onClose={() => {}} />);
    expect(html).toContain("📷 Scan a code");
    expect(html).toContain("<video");
  });
});

describe("the wrong-browser landing", () => {
  it("reads the link a session-less page came in on", () => {
    expect(landingLink("?code=EVT1&unlock=COLD-FIRST")).toEqual({ kind: "unlock", code: "COLD-FIRST" });
    expect(landingLink("?code=EVT1&checkin=the-start-bar")).toEqual({ kind: "checkin", at: "the-start-bar", room: "The Start Bar" });
    expect(landingLink("?code=EVT1")).toBeNull();
    expect(roomFromSlug("disk_cleanup")).toBe("Disk Cleanup");
    expect(roomFromSlug("The%20RAM")).toBe("The RAM");
    // The show's computer words keep their capitals off a lower-cased slug.
    expect(roomFromSlug("the-cpu")).toBe("The CPU");
    expect(roomFromSlug("the-ram")).toBe("The RAM");
    expect(roomFromSlug("the-fan-closet")).toBe("The Fan Closet");
    expect(roomFromSlug("the-casino")).toBe("The Casino");
  });

  it("shows the code in big type to type in the app the guest joined with — not the picker", () => {
    const html = renderToStaticMarkup(<LinkLanding link={{ kind: "unlock", code: "COLD-FIRST" }} title="Trapped" onJoin={() => {}} />);
    expect(html).toContain('<div class="landing-code" aria-label="The code">COLD-FIRST</div>');
    expect(html).toContain(landingTypeLine("COLD-FIRST"));
    expect(landingTypeLine("COLD-FIRST")).toBe("Type COLD-FIRST into your Codex in the app you joined with.");
    expect(html).toContain("I haven&#x27;t joined yet → Join");
    expect(html).not.toContain("Which program are you?");
  });

  it("a check-in sign names its room", () => {
    const html = renderToStaticMarkup(<LinkLanding link={{ kind: "checkin", at: "the-start-bar", room: "The Start Bar" }} title={null} onJoin={() => {}} onPerformer={() => {}} />);
    expect(html).toContain("The Start Bar");
    expect(html).toContain("📷 Scan");
    expect(html).toContain("I&#x27;m a performer");
  });

  it("a session just cut in this browser is not the wrong browser: the notice, then Join again", () => {
    const notice = "The director restarted the story — join again.";
    const html = renderToStaticMarkup(<LinkLanding link={{ kind: "unlock", code: "COLD-FIRST" }} title="Trapped" notice={notice} onJoin={() => {}} />);
    expect(html).toContain(notice);
    expect(html).toContain("Join again →");
    expect(html).toContain(rejoinLine({ kind: "unlock", code: "COLD-FIRST" }).replace("'", "&#x27;"));
    expect(html).not.toContain("isn&#x27;t the one you joined in");
    expect(rejoinLine({ kind: "checkin", at: "the-cpu", room: "The CPU" })).toContain("checked into The CPU");
    // No notice: the wrong-browser page as before.
    expect(renderToStaticMarkup(<LinkLanding link={{ kind: "unlock", code: "COLD-FIRST" }} title="Trapped" notice={null} onJoin={() => {}} />)).toContain("isn&#x27;t the one you joined in");
  });

  it("a codex / check-in link opens the guest app from the chooser (where the landing lives)", () => {
    const none = () => null;
    expect(initialRole("?code=EVT1&unlock=COLD-FIRST", none)).toBe("guest");
    expect(initialRole("?code=EVT1&checkin=the-ram", none)).toBe("guest");
    // A booth phone keeps its booth.
    expect(initialRole("?code=EVT1&unlock=COLD-FIRST", (k) => (k === "loom.prime" ? "{}" : null))).toBe("prime");
  });
});

describe("the scan sheet's typed code (wave 13)", () => {
  const rooms = [
    { id: "loc:The Desktop", title: "The Desktop (living room)" },
    { id: "loc:The_Start_Bar", title: "The Start Bar (kitchen)" },
  ];

  it("a code redeems, a room's name or its sign's slug checks in there", () => {
    expect(typedScan("COLD-FIRST", rooms)).toEqual({ kind: "unlock", code: "COLD-FIRST" });
    expect(typedScan("  sandy1987 ", rooms)).toEqual({ kind: "unlock", code: "sandy1987" });
    expect(typedScan("the-desktop", rooms)).toEqual({ kind: "checkin", at: "The Desktop" });
    expect(typedScan("The Desktop (living room)", rooms)).toEqual({ kind: "checkin", at: "The Desktop" });
    expect(typedScan("THE START BAR", rooms)).toEqual({ kind: "checkin", at: "The_Start_Bar" });
  });

  it("a whole link reads like a scan; a pass or junk says what it is", () => {
    expect(typedScan(`${BASE}?code=EVT1&unlock=COLD-FIRST`, rooms)).toEqual({ kind: "unlock", code: "COLD-FIRST" });
    expect(typedScan(`${BASE}?code=EVT1&checkin=the-cpu`, rooms)).toEqual({ kind: "checkin", at: "the-cpu" });
    expect(typedScan("g-3f9a1c", rooms, "g-3f9a1c")).toEqual({ kind: "note", text: SCAN_OWN_PASS });
    expect(typedScan("g-aaaaaa", rooms, "g-3f9a1c")).toEqual({ kind: "pass", id: "g-aaaaaa" });
    expect(typedScan("what is this?", rooms)).toEqual({ kind: "note", text: TYPED_UNKNOWN });
    expect(typedScan("   ", rooms)).toEqual({ kind: "note", text: TYPED_UNKNOWN });
    // With no rooms to match, a slug-shaped word is a code.
    expect(typedScan("the-desktop")).toEqual({ kind: "unlock", code: "the-desktop" });
  });

  it("the sheet holds the camera and the typed box together, over everything", () => {
    const html = renderToStaticMarkup(<ScanSheet meId="g-3f9a1c" onScan={async () => null} onClose={() => {}} rooms={rooms} />);
    expect(html).toContain('class="scan-layer"');
    expect(html).toContain("<video");
    expect(html).toContain("Or type the code");
    expect(html).toContain('class="scan-typed-input"');
    expect(html).toContain('aria-label="Close the scanner"');
  });
});

describe("a typed code (wave 59)", () => {
  const link = (rest: string) => `https://x/?code=EVT&${rest}`;

  it("takes spaces where a keyboard put them, so the server can fold it", () => {
    expect(typedScan("blue duck 9")).toEqual({ kind: "unlock", code: "blue duck 9", spaced: true });
    expect(typedScan("blue-duck")).toEqual({ kind: "unlock", code: "blue-duck" });
    expect(typedScan("?!")).toEqual({ kind: "note", text: TYPED_UNKNOWN });
  });

  it("a printed code reads as its QR: a room checks in, a sign acts, a badge is a badge, and none reaches the Codex", async () => {
    const as = (rest: string) => () => Promise.resolve(link(rest));
    expect(await typedRoute("r-k7qm", [], null, as("checkin=the-cpu"))).toEqual({ kind: "checkin", at: "the-cpu" });
    expect(await typedRoute("s k7qm", [], null, as("act=bathroom"))).toEqual({ kind: "act", name: "bathroom" });
    expect(await typedRoute("abcd efgh", [], null, as("badge=abcdefgh"))).toEqual({ kind: "badge", badge: "abcdefgh" });
    expect(await typedRoute("abcd efgh", [], null, as("claim=tok&badge=abcdefgh"))).toEqual({ kind: "badge", badge: "abcdefgh" });
    expect(await typedRoute("abcd efgh ij", [], null, as("part=abcdefghij"))).toEqual({ kind: "note", text: SCAN_STAFF });
    expect(await typedRoute("evt", [], null, () => Promise.resolve("https://x/?code=EVT"))).toEqual({ kind: "note", text: SCAN_JOIN });
  });

  it("only what is none of those is left to the Codex", async () => {
    expect(await typedRoute("blue-duck", [], null, () => Promise.resolve(null))).toEqual({ kind: "unlock", code: "blue-duck" });
  });

  it("never asks about a room the phone knows, a pass or a link", async () => {
    const printed = vi.fn(() => Promise.resolve(null));
    expect(await typedRoute("the desktop", [{ id: "loc:The Desktop", title: "The Desktop" }], null, printed)).toEqual({ kind: "checkin", at: "The Desktop" });
    expect(await typedRoute("https://x/?code=EVT&unlock=blue", [], null, printed)).toEqual({ kind: "unlock", code: "blue" });
    expect(printed).not.toHaveBeenCalled();
  });

  it("a server that can't be asked costs no miss", async () => {
    await expect(typedRoute("blue-duck", [], null, () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
  });
});
