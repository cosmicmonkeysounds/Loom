// Wave 13 (booth lane): the booth's NOW card is one line — the character's
// first live objective with its checklist count — and names the character
// when there is none; the tray's clock and act chip.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { NowCard, nowCount, objectiveButtonLabels } from "../src/booth/now-card.tsx";
import { actChip, filterGuests, heldCount, soonest, trayClock } from "../src/booth/model.ts";
import { boothPill, boothStartItems } from "../src/booth/header.tsx";
import type { Interaction, ObjectiveView, PrimeGuest, WalletQueueView } from "../src/types.ts";

const obj = (id: string, extra: Partial<ObjectiveView> = {}): ObjectiveView => ({ id, title: `Hold the door`, brief: "Scan every pass.", checklist: [], buttons: [], act: null, ...extra });
const ints: Interaction[] = [{ id: "send", label: "🛡 Send to the Internet", who: "performer", description: null }];

describe("the NOW card", () => {
  it("is one line: NOW, the title, the checklist count, how many more", () => {
    const o = obj("door", { checklist: [{ label: "a", done: true }, { label: "b", done: false }, { label: "c", done: null }], buttons: ["scan", "send"] });
    const html = renderToStaticMarkup(<NowCard objectives={[o, obj("two")]} interactions={ints} character="Norton" pill={null} closeKey={null} />);
    expect(html).toContain("NOW:");
    expect(html).toContain("Hold the door");
    // The to-do with no condition counts in the total.
    expect(html).toContain("1/3");
    expect(html).not.toContain("1/2 ✓");
    expect(html).toContain("+1");
    expect(html).toContain('aria-expanded="false"');
    // Folded by default: the brief is not over the stream.
    expect(html).not.toContain("Scan every pass.");
  });

  it("never reads done while a to-do with no condition is open", () => {
    expect(nowCount({ checklist: [{ label: "Hold the door", done: true }, { label: "Every program cleared", done: null }] })).toBe("1/2");
    expect(nowCount({ checklist: [{ label: "a", done: true }, { label: "b", done: true }] })).toBe("2/2 ✓");
    expect(nowCount({ checklist: [] })).toBe("");
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

describe("the tray", () => {
  it("the clock reads ⏳ m:ss under ten minutes, ⏳ n m above", () => {
    expect(trayClock(899)).toBe("⏳ 14 m");
    expect(trayClock(599)).toBe("⏳ 9:59");
    expect(trayClock(5)).toBe("⏳ 0:05");
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
