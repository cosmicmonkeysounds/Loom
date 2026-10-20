//! Wave 13 K5: the show clock — the party's time of day in every tray, the
//! director phone's strip and the host's 🕐 Show clock section.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clockText, setToFields, setToTime, showClockOf, showMinutesAt } from "../src/show-clock.ts";
import { ShowClockTray, showClockTray } from "../src/chrome/show-clock-tray.tsx";
import { BoothTray } from "../src/booth/tray.tsx";
import { hostCalls, HOST_ROUTES, type HostRoute } from "../src/host/api.ts";
import { moreSections } from "../src/host/model.ts";
import { sheetLayout, stripItems, type DirectorView } from "../src/director.tsx";
import type { PrimeView } from "../src/types.ts";

describe("clockText", () => {
  it("reads a 12-hour Win95 tray clock, past midnight too", () => {
    expect(clockText(1140)).toBe("7:00 PM");
    expect(clockText(1163.9)).toBe("7:23 PM");
    expect(clockText(1439)).toBe("11:59 PM");
    expect(clockText(1439.99)).toBe("11:59 PM");
    expect(clockText(1440)).toBe("12:00 AM");
    expect(clockText(1445)).toBe("12:05 AM");
    expect(clockText(720)).toBe("12:00 PM");
    expect(clockText(0)).toBe("12:00 AM");
    expect(clockText(1380)).toBe("11:00 PM");
    expect(clockText(-5)).toBe("11:55 PM");
  });
});

describe("the show minutes between snapshots", () => {
  it("runs on from the receive time while running, holds while paused", () => {
    expect(showMinutesAt({ minutes: 1140, running: true }, 10_000, 10_000)).toBe(1140);
    expect(showMinutesAt({ minutes: 1140, running: true }, 10_000, 10_000 + 90_000)).toBe(1141.5);
    expect(showMinutesAt({ minutes: 1140, running: false }, 10_000, 10_000 + 90_000)).toBe(1140);
    // A wall clock that went backwards never runs the show clock back.
    expect(showMinutesAt({ minutes: 1140, running: true }, 10_000, 5_000)).toBe(1140);
  });

  it("reads the view's showClock (or an object clock), never the story-ms clock", () => {
    const c = { minutes: 1200, running: true };
    expect(showClockOf({ showClock: c, clock: 123456 })).toBe(c); // identity kept: the hook re-bases on it
    expect(showClockOf({ clock: c })).toBe(c);
    expect(showClockOf({ clock: 123456 })).toBeNull();
    expect(showClockOf({})).toBeNull();
    expect(showClockOf(null)).toBeNull();
    expect(showClockOf({ showClock: { minutes: Number.NaN, running: true } })).toBeNull();
  });
});

describe("Set to…", () => {
  it("takes a 12-hour H:MM and an AM/PM, nothing else", () => {
    expect(setToTime("7:05", "PM")).toBe("7:05 PM");
    expect(setToTime(" 11:00 ", "PM")).toBe("11:00 PM");
    expect(setToTime("12:00", "AM")).toBe("12:00 AM");
    expect(setToTime("13:00", "PM")).toBeNull();
    expect(setToTime("0:30", "AM")).toBeNull();
    expect(setToTime("7:5", "PM")).toBeNull();
    expect(setToTime("7:60", "PM")).toBeNull();
    expect(setToTime("", "PM")).toBeNull();
    expect(setToFields(1150)).toEqual({ hm: "7:10", half: "PM" });
  });
});

describe("the tray clock", () => {
  it("shows the time, greys with ⏸ while paused", () => {
    expect(showClockTray({ minutes: 1183, running: true })).toEqual({ text: "7:43 PM", paused: false, title: "The party's clock: 7:43 PM" });
    expect(showClockTray({ minutes: 1183, running: false })).toMatchObject({ text: "7:43 PM", paused: true });
    const html = renderToStaticMarkup(<ShowClockTray clock={{ minutes: 1183, running: false }} />);
    expect(html).toContain("7:43 PM");
    expect(html).toContain("tray-item dim");
    expect(html).toContain("tray-clock paused");
  });

  it("renders nothing with no clock", () => {
    expect(renderToStaticMarkup(<ShowClockTray clock={undefined} />)).toBe("");
    expect(renderToStaticMarkup(<ShowClockTray clock={null} />)).toBe("");
  });

  it("is the booth tray's first item, and absent when the view has none", () => {
    const base = { night: { act: { code: "C", title: "Act II" }, phase: null, step: 5 } };
    const html = renderToStaticMarkup(<BoothTray view={{ ...base, showClock: { minutes: 1380, running: true } } as unknown as PrimeView} onWallet={() => {}} />);
    expect(html.indexOf("11:00 PM")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("11:00 PM")).toBeLessThan(html.indexOf("Act C"));
    expect(renderToStaticMarkup(<BoothTray view={base as unknown as PrimeView} onWallet={() => {}} />)).not.toContain("tray-show-clock");
  });
});

describe("the director phone's strip", () => {
  it("leads with the show clock, ⏸ while it holds", () => {
    const view = { world: [] } as unknown as DirectorView;
    const layout = sheetLayout([]);
    expect(stripItems(view, layout, null, { minutes: 1445, running: true })[0]).toEqual({ text: "🕐 12:05 AM", clock: true });
    expect(stripItems(view, layout, null, { minutes: 1445, running: false })[0]).toEqual({ text: "⏸ 12:05 AM", clock: true });
    expect(stripItems(view, layout, null).some((i) => i.clock === true)).toBe(false);
  });
});

describe("the host's 🕐 Show clock", () => {
  it("sits in More right after the show, and its route is on the allowlist", () => {
    expect(moreSections({ wallet: null, king: null, terminals: null, parts: [], agents: [] } as never).slice(0, 2)).toEqual(["show", "clock"]);
    expect(HOST_ROUTES).toContain("/api/mod/clock");
  });

  it("nudges by minutes and sets a time, one body each", async () => {
    const sent: Array<{ route: HostRoute; body: Record<string, unknown> }> = [];
    const calls = hostCalls(async (route, body) => {
      sent.push({ route, body });
      return { ok: true };
    }, () => "Night.alerts");
    await calls.clockNudge(-5);
    await calls.clockNudge(1);
    await calls.clockSet("11:00 PM");
    expect(sent).toEqual([
      { route: "/api/mod/clock", body: { nudge: -5 } },
      { route: "/api/mod/clock", body: { nudge: 1 } },
      { route: "/api/mod/clock", body: { time: "11:00 PM" } },
    ]);
  });
});
