//! W11 (W-13): the guest's in-app 📷 Scan and the wrong-browser landing.
//! A wall code read inside the app lands in the session already open; a
//! codex / check-in link that opens with no session shows the code to type
//! in the app the guest joined with, never the program picker.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChannelView, Composer } from "../src/chat.tsx";
import { initialRole } from "../src/director.tsx";
import {
  LinkLanding,
  SCAN_DIRECTOR,
  SCAN_INVITE,
  SCAN_JOIN,
  SCAN_OWN_PASS,
  SCAN_PAIR,
  SCAN_PASS,
  SCAN_UNKNOWN,
  ScanSheet,
  guestCameraProblem,
  guestScan,
  landingLink,
  landingTypeLine,
  rejoinLine,
  roomFromSlug,
} from "../src/guest-scan.tsx";
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
    expect(guestScan("g-aaaaaa", "g-3f9a1c")).toEqual({ kind: "note", text: SCAN_PASS });
    expect(guestScan(`${BASE}?pass=g-aaaaaa`, "g-3f9a1c")).toEqual({ kind: "note", text: SCAN_PASS });
    expect(guestScan("https://example.com/menu")).toEqual({ kind: "note", text: SCAN_UNKNOWN });
    expect(guestScan("hello there, friend")).toEqual({ kind: "note", text: SCAN_UNKNOWN });
    expect(guestScan("   ")).toEqual({ kind: "note", text: SCAN_UNKNOWN });
  });

  it("a camera that can't run says to type the code into the Codex", () => {
    for (const s of ["insecure", "denied", "none", "error"] as const) expect(guestCameraProblem(s)).toMatch(/Codex/);
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
    expect(roomFromSlug("the-graphics-card")).toBe("The Graphics Card");
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
