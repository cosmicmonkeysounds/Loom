// Wave 13 (booth lane): the booth's NOW card is one line — the character's
// first live objective with its checklist count — and names the character
// when there is none; the tray's clock and act chip.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { NowCard, nowCount, objectiveButtonLabels, pinnedChecks } from "../src/booth/now-card.tsx";
import { actChip, filterGuests, heldCount, soonest, trayAct, trayClock, viewPaused } from "../src/booth/model.ts";
import { loadTicks, saveTicks, tickKey, tickable, toggleTick } from "../src/booth/ticks.ts";
import { BoothTray } from "../src/booth/tray.tsx";
import type { PrimeView } from "../src/types.ts";
import { boothPill, boothStartItems } from "../src/booth/header.tsx";
import type { Interaction, ObjectiveView, PrimeGuest, WalletQueueView } from "../src/types.ts";

const obj = (id: string, extra: Partial<ObjectiveView> = {}): ObjectiveView => ({ id, title: `Hold the door`, brief: "Scan every pass.", checklist: [], buttons: [], act: null, ...extra });
const ints: Interaction[] = [{ id: "send", label: "🛡 Send to the Internet", who: "performer", description: null }];

describe("the NOW card", () => {
  it("is pinned: NOW, the whole title, the count, up to three to-dos in view; the rest behind More", () => {
    const o = obj("door", { checklist: [{ label: "a", done: true }, { label: "b", done: false }, { label: "c", done: null }], buttons: ["scan", "send"] });
    const html = renderToStaticMarkup(<NowCard objectives={[o, obj("two")]} interactions={ints} character="Norton" pill={null} closeKey={null} />);
    expect(html).toContain("NOW:");
    expect(html).toContain("Hold the door");
    expect(html).toContain("booth-now-title wrap");
    // The to-do with no condition counts in the total, and is the performer's own check box.
    expect(html).toContain("1/3");
    expect(html).toMatch(/role="checkbox" aria-checked="false"/);
    // Every to-do is in view (three or fewer).
    for (const l of [">a<", ">b<", ">c<"]) expect(html).toContain(l);
    // The drop-down is only for the rest: the brief and the other objective, named on its button, folded.
    expect(html).toContain("Brief · More objectives (1)");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Scan every pass.");
    // The keyboard is up: the title bar only.
    const typing = renderToStaticMarkup(<NowCard objectives={[o]} interactions={ints} character="Norton" pill={null} closeKey={null} compact />);
    expect(typing).toContain("Hold the door");
    expect(typing).not.toContain("booth-now-checks");
  });

  it("pins the first three to-dos the story has not ticked when there are more, the rest behind More", () => {
    const o = obj("ci2", { brief: "", checklist: [{ label: "a", done: true }, { label: "b", done: false }, { label: "c", done: false }, { label: "d", done: null }, { label: "e", done: false }] });
    expect(pinnedChecks(o)).toEqual({ shown: [1, 2, 3], rest: [0, 4] });
    // All done: the first three.
    const done = obj("x", { checklist: ["a", "b", "c", "d"].map((label) => ({ label, done: true })) });
    expect(pinnedChecks(done)).toEqual({ shown: [0, 1, 2], rest: [3] });
    // The performer's own tick on d keeps d in view (the card reads the story's verdicts only).
    const html = renderToStaticMarkup(<NowCard objectives={[o]} interactions={ints} character="Clippy" pill={null} closeKey={null} />);
    expect(html).toContain(">d<");
    expect(html).toContain("2 more to-dos");
  });

  it("never reads done while a to-do with no condition is open; the performer's tick counts", () => {
    expect(nowCount({ checklist: [{ label: "Hold the door", done: true }, { label: "Every program cleared", done: null }] })).toBe("1/2");
    expect(nowCount({ checklist: [{ label: "a", done: true }, { label: "b", done: true }] })).toBe("2/2 ✓");
    expect(nowCount({ checklist: [] })).toBe("");
    // CI 2: the two to-dos the story can't tick, ticked by Clippy.
    const ci2 = obj("ci2", { checklist: [{ label: "🎱 the winner", done: true }, { label: "🎯 named", done: null }, { label: "🎀 the ribbon", done: null }, { label: "📣 announced", done: false }] });
    expect(nowCount(ci2)).toBe("1/4");
    expect(nowCount(ci2, new Set([tickKey("ci2", "🎯 named"), tickKey("ci2", "🎀 the ribbon")]))).toBe("3/4");
    // A tick on a to-do the story tracks never counts (it is never tappable).
    expect(nowCount(ci2, new Set([tickKey("ci2", "📣 announced")]))).toBe("1/4");
  });

  it("names the character (and its pill) when no objective is live", () => {
    const html = renderToStaticMarkup(<NowCard objectives={[]} interactions={ints} character="Task Manager" pill="host" closeKey={null} />);
    expect(html).toContain("Task Manager");
    expect(html).toContain("host");
    expect(html).not.toContain("NOW:");
  });

  it("lists the story buttons an objective puts on a guest's card, never pass / scan", () => {
    expect(objectiveButtonLabels({ buttons: ["pass", "scan", "send", "nope"] }, ints)).toEqual(["🛡 Send to the Internet"]);
  });
});

describe("the performer's own ticks (fix round)", () => {
  const store = () => {
    const m = new Map<string, unknown>();
    return { load: <T,>(k: string) => (m.has(k) ? (JSON.parse(JSON.stringify(m.get(k))) as T) : null), save: (k: string, v: unknown) => void m.set(k, v), drop: (k: string) => void m.delete(k) };
  };
  it("are kept per sign-in, objective and label", () => {
    const s = store();
    const t = toggleTick(new Set(), "ci2", "🎀 the ribbon");
    saveTicks(s, "tok-1", t);
    expect([...loadTicks(s, "tok-1")]).toEqual([tickKey("ci2", "🎀 the ribbon")]);
    expect(loadTicks(s, "tok-2").size).toBe(0); // another sign-in starts clean
    expect(loadTicks(s, null).size).toBe(0);
    expect(toggleTick(t, "ci2", "🎀 the ribbon").size).toBe(0); // a second tap unticks
    expect(tickable({ done: null })).toBe(true);
    expect(tickable({ done: false })).toBe(false);
    expect(tickable({ done: true })).toBe(false);
  });
  it("survive blocked storage (a private window): nothing throws", () => {
    const blocked = { load: () => { throw new Error("SecurityError"); }, save: () => { throw new Error("QuotaExceeded"); }, drop: () => {} };
    expect(loadTicks(blocked, "tok").size).toBe(0);
    expect(() => saveTicks(blocked, "tok", new Set(["x"]))).not.toThrow();
  });
});

describe("the tray's act (fix round)", () => {
  it("reads the NOW objective's act: Doors during the doors, never the act of NEXT ahead of time", () => {
    const sheet = { code: "B", title: "Act I: the Desktop, Bingo and the first truth" };
    expect(trayAct(sheet, [{ act: "Doors" }])).toEqual({ text: "Doors", title: "Doors" });
    expect(trayAct(sheet, [{ act: "B" }])).toEqual({ text: "Act B", title: "Act B · Act I: the Desktop, Bingo and the first truth" });
    expect(trayAct(sheet, [{ act: "C" }])).toEqual({ text: "Act C", title: "Act C" });
    expect(trayAct(sheet, [{ act: null }])).toEqual(actChip(sheet));
    expect(trayAct(sheet, [])).toEqual(actChip(sheet));
    expect(trayAct(null, undefined)).toBeNull();
    // An objective with no act (a host's help desk) during the doors (step 0): "Doors", never the act of NEXT.
    expect(trayAct(sheet, [{ act: null }], 0)).toEqual({ text: "Doors", title: "Doors: the first act has not started" });
    expect(trayAct(sheet, [], 1)).toEqual(actChip(sheet));
    expect(trayAct(sheet, [{ act: "Doors" }], 0)).toEqual({ text: "Doors", title: "Doors" });
    expect(trayAct(null, [], 0)).toBeNull();
  });
});

describe("the tray", () => {
  it("the clock reads ⏳ m:ss under ten minutes, ⏳ n m above", () => {
    expect(trayClock(899)).toBe("⏳ 14 m");
    expect(trayClock(599)).toBe("⏳ 9:59");
    expect(trayClock(5)).toBe("⏳ 0:05");
  });
  it("a paused view's clock reads ⏸ and holds still", () => {
    expect(trayClock(599, true)).toBe("⏸ 9:59");
    expect(viewPaused({ paused: true })).toBe(true);
    expect(viewPaused({})).toBe(false);
    expect(viewPaused(null)).toBe(false);
    const view = { clock: 100_000, countdowns: [{ label: "Summons", path: "b", endsAt: 300 }], paused: true } as unknown as PrimeView;
    const html = renderToStaticMarkup(<BoothTray view={view} onWallet={() => {}} />);
    expect(html).toContain("⏸ 3:20");
    expect(html).not.toContain("⏳");
  });
  it("the soonest live countdown at story time", () => {
    const cds = [{ label: "Hunt 1", path: "a", endsAt: 900 }, { label: "Summons", path: "b", endsAt: 300 }, { label: "Done", path: "c", endsAt: 10 }];
    expect(soonest(cds, 100_000)).toEqual({ label: "Summons", left: 200 });
    expect(soonest(cds, null)).toBeNull();
    expect(soonest(undefined, 0)).toBeNull();
  });
  it("the act chip stays short (the full name in its tooltip) and the approver's held count", () => {
    expect(actChip({ code: "C", title: "Bingo" })).toEqual({ text: "Act C", title: "Act C · Bingo" });
    expect(actChip({ code: null, title: "Bingo" })).toEqual({ text: "Bingo", title: "Act Bingo" });
    expect(actChip(null)).toBeNull();
    const q = { queue: [{ state: "held" }, { state: "pending" }, { state: "held" }] } as unknown as WalletQueueView;
    expect(heldCount(q)).toBe(2);
    expect(heldCount(undefined)).toBe(0);
  });
});

describe("Guests and Start", () => {
  const g = (id: string, name: string): PrimeGuest => ({ id, name, faction: null, captured: false, location: null });
  it("Guests searches by name or id, sorted by name", () => {
    const list = [g("g-2", "Winamp"), g("g-1", "Calculator"), g("g-3", "MS Paint")];
    expect(filterGuests(list, "").map((x) => x.name)).toEqual(["Calculator", "MS Paint", "Winamp"]);
    expect(filterGuests(list, "ms pa").map((x) => x.id)).toEqual(["g-3"]);
    expect(filterGuests(list, "G-2").map((x) => x.id)).toEqual(["g-2"]);
  });
  it("Start offers moderator powers only to a booth with neither admin nor host, and confirms Sign out", () => {
    const base = { character: "Norton", knows: 2, wake: { supported: true, on: false, toggle: () => {} }, embedded: false, onHelp: () => {}, onSheet: () => {}, onSignOut: () => {} };
    const plain = boothStartItems({ ...base, admin: false, host: false });
    expect(plain.map((i) => i.id)).toEqual(["help", "wake", "alerts", "knows", "powers", "signout"]);
    expect(plain.find((i) => i.id === "signout")).toMatchObject({ danger: true });
    expect(plain.find((i) => i.id === "signout")!.confirm).toContain("Sign out of Norton?");
    expect(boothStartItems({ ...base, admin: false, host: true }).some((i) => i.id === "powers")).toBe(false);
    expect(boothStartItems({ ...base, admin: false, host: false, embedded: true }).map((i) => i.id)).toEqual(["help", "knows", "powers", "signout"]);
    expect(boothPill({ admin: false, host: true })).toBe("host");
    expect(boothPill({ admin: true, host: true })).toBe("admin");
    expect(boothPill({ admin: false })).toBeNull();
  });
});
