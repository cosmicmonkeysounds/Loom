//! Wave 37, lane C (the moments): the interrupt rules that de-clutter Play —
//! a booth's balloons wait behind pop-outs and fold to one (C5), nothing
//! peeks under a dialog (C18), a house line that echoes the big moment
//! beside it goes to the bin (C19), and a dialog's buttons always fit (C15).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BIG_ECHO_MS, EMPTY_MOMENTS, STICKY_MS, bigEchoes, momentOf, momentsReducer, surfacesOf, waitBalloons, type Moment, type MomentsState } from "../src/moments/model.ts";
import type { ChatMessage } from "../src/types.ts";

const T = 1_000_000;
function mo(seq: number, over: Partial<Moment> = {}): Moment {
  return { key: `m:${seq}`, seq, severity: "minor", kind: "other", caption: "GarageBand", text: `line ${seq}`, channel: "guest:g1", at: T + seq * 1000, phase: null, ...over };
}
function arrive(s: MomentsState, moments: Moment[], role: "guest" | "booth" = "booth", level: "sticky" | "dialog" = "sticky"): MomentsState {
  return momentsReducer(s, { type: "arrive", moments, visible: true, level, role, now: T, phase: null, batch: false });
}
const keys = (s: MomentsState) => s.queue.map((q) => q.moment.key);

describe("C5: a booth's balloons wait behind pop-outs and face-to-face windows", () => {
  it("balloonsWait holds the balloon (peeks too); the sticky still shows", () => {
    const s = arrive(EMPTY_MOMENTS, [mo(1), mo(2, { severity: "major", kind: "alert", caption: "Task Manager", text: "🚨 The door is open", channel: "room:hosts" })]);
    const shown = surfacesOf(s, false);
    expect(shown.balloon?.moment.key).toBe("m:1");
    expect(shown.sticky?.moment.key).toBe("m:2");
    const held = waitBalloons(shown, true);
    expect(held.balloon).toBeNull();
    expect(held.sticky?.moment.key).toBe("m:2");
    expect(waitBalloons(shown, false)).toBe(shown);
    // A peek over a busy surface waits too.
    const p = arrive(EMPTY_MOMENTS, [mo(3, { severity: "major", kind: "readout" }), { ...mo(3, { severity: "major", kind: "readout" }), key: "p:m:3", peekOf: "m:3" }]);
    expect(surfacesOf(p, true).balloon?.moment.key).toBe("p:m:3");
    expect(waitBalloons(surfacesOf(p, true), true).balloon).toBeNull();
  });

  it("five minor moments on a booth: one balloon waits, the rest are missed (the 🔔)", () => {
    const s = arrive(EMPTY_MOMENTS, [1, 2, 3, 4, 5].map((n) => mo(n)));
    expect(keys(s)).toEqual(["m:5"]);
    expect(s.missed.map((m) => m.key)).toEqual(["m:1", "m:2", "m:3", "m:4"]);
    // One at a time too: each newcomer folds the one before.
    let t = EMPTY_MOMENTS;
    for (const n of [1, 2, 3, 4, 5]) t = arrive(t, [mo(n)]);
    expect(keys(t)).toEqual(["m:5"]);
    expect(t.missed).toHaveLength(4);
  });

  it("an older readout outlives a newer chat line, which waits behind it; a newer readout folds it", () => {
    const r = mo(1, { kind: "readout", caption: "Norton", text: "⏰ Winamp is late", channel: "dm:Norton" });
    const s = arrive(arrive(EMPTY_MOMENTS, [r]), [mo(2)]);
    expect(keys(s).sort()).toEqual(["m:1", "m:2"]);
    expect(surfacesOf(s, false).balloon?.moment.key).toBe("m:1");
    // The readout leaves: the line shows.
    const d = momentsReducer(s, { type: "dismiss", key: "m:1", onScreenMs: 8_000 });
    expect(surfacesOf(d, false).balloon?.moment.key).toBe("m:2");
    // Another line: the older line goes, the readout stays first.
    const s3 = arrive(s, [mo(3)]);
    expect(keys(s3).sort()).toEqual(["m:1", "m:3"]);
    expect(s3.missed.map((m) => m.key)).toEqual(["m:2"]);
    expect(surfacesOf(s3, false).balloon?.moment.key).toBe("m:1");
    // A newer readout outranks the older one and the waiting line.
    const s4 = arrive(s3, [mo(4, { kind: "readout", text: "⏰ ICQ is late" })]);
    expect(keys(s4)).toEqual(["m:4"]);
  });

  it("an older arrival (a wake's replay) never folds the newer balloon waiting: it folds itself", () => {
    const s = arrive(arrive(EMPTY_MOMENTS, [mo(5)]), [mo(2)]);
    expect(keys(s)).toEqual(["m:5"]);
    expect(s.missed.map((m) => m.key)).toEqual(["m:2"]);
    // A replayed older readout still outranks the newer chat line, which waits behind it.
    const r = arrive(arrive(EMPTY_MOMENTS, [mo(5)]), [mo(2, { kind: "readout", channel: "dm:Norton" })]);
    expect(keys(r).sort()).toEqual(["m:2", "m:5"]);
    expect(surfacesOf(r, false).balloon?.moment.key).toBe("m:2");
  });

  it("a guest's balloons never fold", () => {
    const s = arrive(EMPTY_MOMENTS, [1, 2, 3].map((n) => mo(n, { kind: "quest", channel: "quests" })), "guest");
    expect(keys(s)).toEqual(["m:3", "m:2", "m:1"]);
    expect(s.missed).toEqual([]);
  });

  it("stickies on a booth are untouched by the balloon fold", () => {
    const s = arrive(EMPTY_MOMENTS, [mo(1), mo(2, { severity: "major", kind: "alert", channel: "room:hosts" }), mo(3)]);
    expect(keys(s).sort()).toEqual(["m:2", "m:3"]);
  });
});

describe("C16: the banner's 45 s", () => {
  it("is 45 seconds", () => {
    expect(STICKY_MS).toBe(45_000);
  });
});

describe("C18: nothing peeks under a dialog", () => {
  it("a dialog shows alone; the sticky and the balloon come back after OK", () => {
    const dialog = mo(1, { severity: "major", kind: "alert", house: true, caption: "Announcement", text: "You are late", channel: "lobby" });
    const sticky = mo(2, { severity: "minor", kind: "alert", house: true, caption: "Announcement", text: "The summons", channel: "lobby" });
    const balloon = mo(3, { kind: "quest", channel: "quests" });
    const s0 = arrive(EMPTY_MOMENTS, [dialog, sticky], "guest", "dialog");
    // A balloon from before the level rose (a quest that started at `sticky`).
    const s: MomentsState = { ...s0, queue: [...s0.queue, { moment: balloon, level: "balloon", queuedAt: T }] };
    const up = surfacesOf(s, false);
    expect(up.modal?.moment.key).toBe("m:1");
    expect([up.sticky, up.balloon, up.stickyKeys]).toEqual([null, null, []]);
    expect(up.stickyCount).toBe(1);
    // Held (the scan sheet): no modal, so the sticky shows meanwhile.
    expect(surfacesOf(s, true).sticky?.moment.key).toBe("m:2");
    const after = surfacesOf(momentsReducer(s, { type: "dismiss", key: "m:1", onScreenMs: 3_000 }), false);
    expect([after.modal, after.sticky?.moment.key, after.balloon?.moment.key]).toEqual([null, "m:2", "m:3"]);
  });
});

describe("C19: a house line that echoes the big you just answered goes to the bin", () => {
  const big = mo(10, { severity: "big", kind: "card", caption: "Y2K", text: "The doors", channel: "lobby", at: T });
  const alert = (dt: number) => mo(11, { severity: "major", kind: "alert", alarm: true, house: true, caption: "Announcement", text: "SYSTEM CLOCK RESET", channel: "lobby", at: T + dt });
  const queued = (m: Moment[]) => arrive(EMPTY_MOMENTS, m, "guest", "dialog").queue;

  it("in one batch with the big: the alert is an echo", () => {
    expect([...bigEchoes([big, alert(0)], [])]).toEqual(["m:11"]);
  });

  it("1 s later, with the big queued (on screen counts): still the echo", () => {
    expect([...bigEchoes([alert(1_000)], queued([big]))]).toEqual(["m:11"]);
    expect([...bigEchoes([alert(BIG_ECHO_MS)], queued([big]))]).toEqual(["m:11"]);
  });

  it("an alert queued first, then its big: the queued alert is the echo", () => {
    expect([...bigEchoes([big], queued([alert(-1_000)]))]).toEqual(["m:11"]);
  });

  it("6 s apart, or no big at all: kept", () => {
    expect(bigEchoes([alert(6_000)], queued([big])).size).toBe(0);
    expect(bigEchoes([alert(0)], []).size).toBe(0);
    // Only a house alert is an echo: a personal line beside the big is not.
    expect(bigEchoes([big, mo(12, { severity: "major", kind: "readout", at: T })], []).size).toBe(0);
  });

  it("the provider reads the echo (marks it seen) and drops it before it queues", () => {
    const src = readFileSync(new URL("../src/moments/provider.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/const echoes = bigEchoes\(sorted\.now, mem\.state\.queue\);/u);
    expect(src).toMatch(/for \(const k of echoes\) markSeen\(k\);/u);
    expect(src).toMatch(/dispatch\(\{ type: "read", keys: \[\.\.\.echoes\] \}\)/u);
  });
});

describe("C15: a dialog's buttons always fit", () => {
  const css = readFileSync(new URL("../src/css/moments.css", import.meta.url), "utf8");
  const rule = (sel: string) => {
    const at = css.indexOf(`\n${sel} {`);
    expect(at, sel).toBeGreaterThanOrEqual(0);
    return { at, body: css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at)) };
  };

  it("the buttons wrap inside the box", () => {
    const { body } = rule(".moments-dialog-buttons");
    for (const d of ["display: flex", "flex-wrap: wrap", "justify-content: flex-end", "min-width: 0", "max-width: 100%", "margin-left: auto"]) expect(body).toContain(d);
  });

  it("an exit's label wraps; OK keeps nowrap (the exit's rule comes after the nowrap one)", () => {
    const nowrap = rule(".moments-dialog-foot .w95-btn");
    const go = rule(".moments-dialog-foot .moments-go");
    expect(nowrap.body).toContain("white-space: nowrap");
    expect(go.body).toContain("white-space: normal");
    expect(go.at).toBeGreaterThan(nowrap.at);
  });
});

describe("C21: a menu pick in a booth's DM is no guest writing to it", () => {
  const clippy = { role: "booth" as const, me: "Clippy" };
  const line = (over: Partial<ChatMessage> = {}): ChatMessage =>
    ({ seq: 40, channel: "dm:Clippy", channelKind: "dm", title: "Clippy", from: "GarageBand", kind: "line", text: "Deposited", ts: 0, audience: ["g-1"], parentSeq: null, hidden: false, ...over }) as ChatMessage;

  it("a pick gives no balloon; the same line typed is a minor balloon", () => {
    expect(momentOf(line({ pick: true }), clippy, null)).toBeNull();
    expect(momentOf(line({ act: true }), clippy, null)).toBeNull();
    const typed = momentOf(line(), clippy, null);
    expect([typed?.severity, typed?.kind, typed?.channel]).toEqual(["minor", "other", "guest:g-1"]);
  });
});
