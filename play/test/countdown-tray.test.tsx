//! Wave 13 (chrome): the tray clock — the soonest guest-facing countdown as
//! "⏳ 4:59" (the hourglass first, never a time of day), "⏳ 14 m" from ten
//! minutes out, red under a minute, ⏸ while paused, a balloon with the line.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountdownTray, countdownBalloonLine, spokenLeft, trayClock, trayClockText } from "../src/chrome/countdown-tray.tsx";
import { ShowClockItem } from "../src/chrome/show-clock-tray.tsx";
import type { CountdownSummary } from "../src/types.ts";

const HUNT: CountdownSummary = { label: "Hunt 1 ends", path: "Night.hunt_end", endsAt: 2100 };
const MIDNIGHT: CountdownSummary = { label: "Midnight", path: "Night.y2k_end", endsAt: 9000 };

describe("the tray clock", () => {
  it("reads m:ss under ten minutes, minutes then hours past that", () => {
    expect(trayClockText(299)).toBe("4:59");
    expect(trayClockText(59)).toBe("0:59");
    expect(trayClockText(600)).toBe("10m");
    expect(trayClockText(899)).toBe("15m"); // rounds up: a fifteen-minute hunt reads 15 at once
    expect(trayClockText(900)).toBe("15m");
    expect(trayClockText(897.4)).toBe("15m");
    expect(trayClockText(599.2)).toBe("10m"); // ceil to 600 s
    expect(trayClockText(598.2)).toBe("9:59");
    expect(trayClockText(7199)).toBe("120m");
    expect(trayClockText(7200)).toBe("2h");
    expect(trayClockText(-4)).toBe("0:00");
  });

  it("the tray item: ⏳ first, red under a minute, ⏸ and dim while paused", () => {
    expect(trayClock({ label: "Hunt 1 ends", left: 899 }, false)).toEqual({ icon: "hourglass", text: "15m", title: "Hunt 1 ends in 14 min 59 s" });
    expect(trayClock({ label: "Hunt 1 ends", left: 40, urgent: true }, false)).toMatchObject({ icon: "hourglass", text: "0:40", tone: "alarm" });
    expect(trayClock({ label: "Hunt 1 ends", left: 40 }, true)).toMatchObject({ icon: "pause", tone: "dim", title: "Hunt 1 ends in 40 s (the clock is paused)" });
  });

  it("the balloon spells the time out", () => {
    expect(spokenLeft(899)).toBe("14 min 59 s");
    expect(spokenLeft(3900)).toBe("1 h 5 min");
    expect(spokenLeft(3600)).toBe("1 h");
    expect(spokenLeft(120)).toBe("2 min");
    expect(countdownBalloonLine({ label: "Midnight", left: 7200 }, false)).toBe("Midnight in 2 h");
  });

  it("renders the soonest countdown, and nothing without one", () => {
    // Story clock 1200 s: the hunt has 900 s left, midnight 7800 s.
    const out = renderToStaticMarkup(<CountdownTray countdowns={[MIDNIGHT, HUNT]} clock={1_200_000} paused={false} />);
    expect(out).toContain("15m");
    expect(out).toContain('title="Hunt 1 ends in 15 min"');
    expect(out).toContain('class="tray-slot"');
    expect(renderToStaticMarkup(<CountdownTray countdowns={[]} clock={1} />)).toBe("");
    expect(renderToStaticMarkup(<CountdownTray />)).toBe("");
    expect(CountdownTray({})).toBeNull();
    // A countdown that ran out on the phone shows nothing.
    expect(renderToStaticMarkup(<CountdownTray countdowns={[HUNT]} clock={3_000_000} />)).toBe("");
  });
});

describe("the tray gives the taskbar room (GN-F4 / NM-F14 / OD-F2 / BN-F7)", () => {
  it("the show clock yields to a running countdown (the CSS hides `.tray-clock.yields` on a phone)", () => {
    expect(renderToStaticMarkup(<ShowClockItem now={{ minutes: 19 * 60 + 5, running: true }} yields />)).toContain('class="tray-clock yields"');
    expect(renderToStaticMarkup(<ShowClockItem now={{ minutes: 19 * 60 + 5, running: true }} />)).toContain('class="tray-clock"');
  });
});

