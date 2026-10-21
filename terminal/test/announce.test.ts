import { describe, expect, it } from "vitest";
import { ANNOUNCE_STALE_MS, announceAloud, announceChoice, announceOf, announceSetting, epochMoved, planAnnounce, type Announcement } from "../src/announce.ts";
import { deviceQuery } from "../src/health.ts";
import { defaultConfig } from "../src/config.ts";
import { screenStateUrl } from "../src/screen.ts";
import { announcesOf, parseScreenState } from "../src/screen.ts";

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
  it("reads the recent list; an older server's lone announce is the list", () => {
    expect(parseScreenState({ attract: false, announce: { seq: 2, text: "B.", at: 3 }, announces: [{ seq: 2, text: "B.", at: 3 }, { seq: 1, text: "A.", at: 2 }, { seq: "x" }] })?.announces).toEqual([
      { seq: 1, text: "A.", at: 2 },
      { seq: 2, text: "B.", at: 3 },
    ]);
    expect(parseScreenState({ attract: false, announce: { seq: 1, text: "Hi.", at: 3 } })?.announces).toEqual([{ seq: 1, text: "Hi.", at: 3 }]);
    expect(parseScreenState({ attract: false })?.announces).toEqual([]);
    expect(announcesOf([], { seq: 1, text: "Hi." })).toEqual([]);
    expect(parseScreenState({ attract: false, announceEpoch: "x.2" })?.announceEpoch).toBe("x.2");
    expect(parseScreenState({ attract: false })?.announceEpoch).toBeNull();
  });
});

describe("planAnnounce — which announcements a terminal says", () => {
  const seqs = (p: { say: Announcement[] }) => p.say.map((a) => a.seq);
  it("never the ones that were current when the page loaded", () => {
    expect(planAnnounce(null, [ann(2), ann(3)], NOW)).toEqual({ cursor: 3, say: [] });
    expect(planAnnounce(null, [], NOW)).toEqual({ cursor: 0, say: [] });
  });
  it("a new one, once", () => {
    let p = planAnnounce(null, [], NOW);
    p = planAnnounce(p.cursor, [ann(1)], NOW);
    expect(seqs(p)).toEqual([1]);
    p = planAnnounce(p.cursor, [ann(1)], NOW + 2000);
    expect(p).toEqual({ cursor: 1, say: [] });
    p = planAnnounce(p.cursor, [ann(1), ann(2, NOW + 3000, "Time is up.")], NOW + 4000);
    expect(p.say.map((a) => a.text)).toEqual(["Time is up."]);
  });
  it("two inside one poll: both, in order (the wire's order doesn't matter)", () => {
    const p = planAnnounce(1, [ann(3, NOW - 500, "Second."), ann(1), ann(2, NOW - 600, "First.")], NOW);
    expect(p.cursor).toBe(3);
    expect(p.say.map((a) => a.text)).toEqual(["First.", "Second."]);
  });
  it("not replayed history (a rebooted server) nor a stale one (a tablet back from offline)", () => {
    expect(planAnnounce(1, [ann(2, 0)], NOW).say).toEqual([]);
    expect(planAnnounce(1, [ann(2, NOW - ANNOUNCE_STALE_MS - 1)], NOW)).toEqual({ cursor: 2, say: [] });
    expect(seqs(planAnnounce(1, [ann(2, NOW - ANNOUNCE_STALE_MS)], NOW))).toEqual([2]);
    expect(seqs(planAnnounce(1, [ann(2, 0), ann(3)], NOW))).toEqual([3]);
  });
  it("a story restart resyncs, and says only what was announced since", () => {
    // The restart's replayed history is stamped 0: silent.
    expect(planAnnounce(7, [ann(1, 0), ann(2, 0)], NOW)).toEqual({ cursor: 2, say: [] });
    expect(planAnnounce(7, [], NOW)).toEqual({ cursor: 0, say: [] });
    // A fresh one announced right after the restart, seen before any empty poll: said.
    expect(seqs(planAnnounce(7, [ann(1)], NOW))).toEqual([1]);
    expect(seqs(planAnnounce(7, [ann(1, 0), ann(2)], NOW))).toEqual([2]);
    // …and the restarted story's first announcement after an empty poll is said.
    expect(seqs(planAnnounce(0, [ann(1)], NOW))).toEqual([1]);
  });
  it("a restart whose new seqs reach the old cursor is still seen, by the epoch", () => {
    // One announcement before the restart (cursor 1), one fresh one after:
    // the seqs alone look like nothing new.
    expect(planAnnounce(1, [ann(1)], NOW).say).toEqual([]);
    expect(seqs(planAnnounce(1, [ann(1)], NOW, true))).toEqual([1]);
    expect(seqs(planAnnounce(1, [ann(1), ann(2)], NOW, true))).toEqual([1, 2]);
    // Its replayed history is still silent, and so is a stale one.
    expect(planAnnounce(3, [ann(1, 0), ann(2, 0), ann(3, 0), ann(4, 0)], NOW, true)).toEqual({ cursor: 4, say: [] });
    expect(planAnnounce(1, [ann(1, NOW - ANNOUNCE_STALE_MS - 1)], NOW, true).say).toEqual([]);
  });
  it("the epoch moves only between two answers that both carry one", () => {
    expect(epochMoved(undefined, "a.1")).toBe(false); // the first answer
    expect(epochMoved("a.1", "a.1")).toBe(false);
    expect(epochMoved("a.1", "a.2")).toBe(true); // a restart
    expect(epochMoved("a.2", "b.1")).toBe(true); // a server boot
    expect(epochMoved(null, "a.1")).toBe(false); // an older server, upgraded
    expect(epochMoved("a.1", null)).toBe(false);
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

describe("the house setting (wave 18b, Q8)", () => {
  const spot = (announce: boolean) => ({ spot: { announce } });
  it("a tablet's own Always / Never wins; House setting follows its spot; neither says: off", () => {
    expect(announceSetting({ announce: true }, spot(false))).toBe(true);
    expect(announceSetting({ announce: false }, spot(true))).toBe(false);
    expect(announceSetting({ announce: null }, spot(true))).toBe(true);
    expect(announceSetting({ announce: null }, spot(false))).toBe(false);
    expect(announceSetting({ announce: null }, { spot: null })).toBe(false);
    expect(announceSetting({ announce: null }, null)).toBe(false);
  });

  it("aloud follows it; the TV's mute still holds", () => {
    const muted = { room: "", muted: true, head: 0, lines: [] };
    expect(announceAloud({ announce: null, view: "auto" }, { voice: null, ...spot(true) })).toBe(true);
    expect(announceAloud({ announce: null, view: "auto" }, { voice: null, ...spot(false) })).toBe(false);
    expect(announceAloud({ announce: null, view: "tv" }, { voice: muted, ...spot(true) })).toBe(false);
  });

  it("the heartbeat reports what the tablet does as ann=1|0, nothing when not given", () => {
    const h = { audio: null, visible: null, battery: null, charging: null, version: "v1" };
    expect(deviceQuery({ ...h, announce: true })).toEqual({ ver: "v1", ann: "1" });
    expect(deviceQuery({ ...h, announce: false })).toEqual({ ver: "v1", ann: "0" });
    expect(deviceQuery({ ...h, announce: null })).toEqual({ ver: "v1" });
    expect(deviceQuery(h)).toEqual({ ver: "v1" });
    const c = defaultConfig({ eventId: "e", token: "t", name: "Tent", spot: "tent", view: "reinstall" });
    expect(screenStateUrl(c, null, { ...h, announce: true })).toBe("/e/e/api/screen/state?name=Tent&spot=tent&view=reinstall&character=Trabolta&ver=v1&ann=1");
  });
});
