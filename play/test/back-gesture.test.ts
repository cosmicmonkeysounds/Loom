// Wave 18 fix NM-F9: the phone's own Back steps back inside the app, with
// one entry of the app's own on the history stack while the guest is away
// from home.
import { describe, expect, it } from "vitest";
import { BACK_MARK, BackStack, type HistoryLike } from "../src/back-gesture.ts";

function fake() {
  const log: string[] = [];
  const h: HistoryLike = { pushState: (d) => log.push(d === BACK_MARK ? "push" : "push?"), back: () => log.push("back") };
  return { h, log };
}

describe("BackStack", () => {
  it("one entry while away; Back steps back; reaching home in the app takes it off", () => {
    const { h, log } = fake();
    const s = new BackStack(h);
    s.sync(false);
    expect(log).toEqual([]);
    s.sync(true); // a room opened
    s.sync(true); // still there: never a second entry
    expect(log).toEqual(["push"]);
    expect(s.pop()).toBe(true); // the system Back: step back
    s.sync(true); // still away (a window over Mission): the entry goes back
    expect(log).toEqual(["push", "push"]);
    s.sync(false); // home by a tap in the app: its entry comes off
    expect(log).toEqual(["push", "push", "back"]);
    expect(s.pop()).toBe(false); // that back's own popstate is ignored
    expect(s.pop()).toBe(false); // nothing of ours left: the page's own Back
  });
});
