import { describe, expect, it } from "vitest";
import { ANNOUNCE_STALE_MS, announceAloud, announceChoice, announceOf, planAnnounce, type Announcement } from "../src/announce.ts";
import { parseScreenState } from "../src/screen.ts";

const NOW = 5_000_000;
const ann = (seq: number, at = NOW - 1000, text = "Go to the living room."): Announcement => ({ seq, text, at });

describe("announceOf", () => {
  it("reads the poll's announcement; junk is null", () => {
    expect(announceOf({ seq: 2, text: " Go. ", at: 7 })).toEqual({ seq: 2, text: "Go.", at: 7 });
    expect(announceOf({ seq: 2, text: "Go." })).toEqual({ seq: 2, text: "Go.", at: 0 });
    expect(announceOf(null)).toBeNull();
    expect(announceOf({ seq: "2", text: "Go." })).toBeNull();
    expect(announceOf({ seq: 2, text: "  " })).toBeNull();
    expect(parseScreenState({ attract: false, announce: { seq: 1, text: "Hi.", at: 3 } })?.announce).toEqual({ seq: 1, text: "Hi.", at: 3 });
    expect(parseScreenState({ attract: false })?.announce).toBeNull();
  });
});

describe("planAnnounce — which announcements a terminal says", () => {
  it("never the one that was current when the page loaded", () => {
    expect(planAnnounce(null, ann(3), NOW)).toEqual({ cursor: 3, say: null });
    expect(planAnnounce(null, null, NOW)).toEqual({ cursor: 0, say: null });
  });
  it("a new one, once", () => {
    let p = planAnnounce(null, null, NOW);
    p = planAnnounce(p.cursor, ann(1), NOW);
    expect(p.say?.seq).toBe(1);
    p = planAnnounce(p.cursor, ann(1), NOW + 2000);
    expect(p).toEqual({ cursor: 1, say: null });
    p = planAnnounce(p.cursor, ann(2, NOW + 3000, "Time is up."), NOW + 4000);
    expect(p.say?.text).toBe("Time is up.");
  });
  it("not replayed history (a rebooted server) nor a stale one (a tablet back from offline)", () => {
    expect(planAnnounce(1, ann(2, 0), NOW).say).toBeNull();
    expect(planAnnounce(1, ann(2, NOW - ANNOUNCE_STALE_MS - 1), NOW)).toEqual({ cursor: 2, say: null });
    expect(planAnnounce(1, ann(2, NOW - ANNOUNCE_STALE_MS), NOW).say?.seq).toBe(2);
  });
  it("a story restart resyncs silently", () => {
    expect(planAnnounce(7, ann(1), NOW)).toEqual({ cursor: 1, say: null });
    expect(planAnnounce(7, null, NOW)).toEqual({ cursor: 0, say: null });
    // …and the restarted story's first announcement is then said.
    expect(planAnnounce(0, ann(1), NOW).say?.seq).toBe(1);
  });
});

describe("who says announcements", () => {
  it("only a screen set to; the TV's mute holds", () => {
    expect(announceAloud({ announce: false, view: "auto" }, null)).toBe(false);
    expect(announceAloud({ announce: true, view: "auto" }, null)).toBe(true);
    expect(announceAloud({ announce: true, view: "tv" }, { voice: { room: "", muted: true, head: 0, lines: [] } })).toBe(false);
    expect(announceAloud({ announce: true, view: "tv" }, { voice: { room: "", muted: false, head: 0, lines: [] } })).toBe(true);
    expect(announceAloud({ announce: true, view: "auto" }, { voice: { room: "", muted: true, head: 0, lines: [] } })).toBe(true);
  });
  it("in the device's own voice, whatever the terminal's voice choice", () => {
    expect(announceChoice("browser")).toBe("browser");
    expect(announceChoice("server")).toBe("browser");
    expect(announceChoice("silent")).toBe("browser");
    expect(announceChoice("fully")).toBe("fully");
  });
});
