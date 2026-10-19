//! W11 (SW-PLAY-05): the guest's countdown strip — the story's
//! `countdown: … for guests` lines, ticking under the room header off the
//! server's story clock, held (⏸) while paused, and nothing when none runs.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChannelView } from "../src/chat.tsx";
import { COUNTDOWN_PAUSED, CountdownStrip, CountdownStripView, countdownItemText, countdownItems } from "../src/countdown.tsx";
import type { Channel, CountdownSummary } from "../src/types.ts";

const SUMMONS: CountdownSummary = { label: "Summons", path: "Night.summons_end", endsAt: 1300 };
const MIDNIGHT: CountdownSummary = { label: "Midnight", path: "Night.midnight", endsAt: 4000 };

describe("countdownItems", () => {
  it("lists what is still ahead, soonest first, red under a minute", () => {
    // Story clock 1200 s → the summons has 100 s, midnight 2800 s.
    expect(countdownItems([MIDNIGHT, SUMMONS], 1_200_000)).toEqual([
      { label: "Summons", left: 100 },
      { label: "Midnight", left: 2800 },
    ]);
    expect(countdownItems([SUMMONS], 1_250_500)).toEqual([{ label: "Summons", left: 50, urgent: true }]);
  });

  it("drops a clock that ran out on the phone, and shows nothing without a clock or a list", () => {
    expect(countdownItems([SUMMONS, MIDNIGHT], 1_300_000)).toEqual([{ label: "Midnight", left: 2700 }]);
    expect(countdownItems([SUMMONS], null)).toEqual([]);
    expect(countdownItems(undefined, 1_000)).toEqual([]);
  });

  it("reads as a label and m:ss (h:mm:ss past the hour)", () => {
    expect(countdownItemText({ label: "Summons", left: 100 })).toBe("⏳ Summons 1:40");
    expect(countdownItemText({ label: "Midnight", left: 3725 })).toBe("⏳ Midnight 1:02:05");
  });
});

describe("the strip", () => {
  it("renders nothing when no countdown runs (an old server sends no field)", () => {
    expect(renderToStaticMarkup(<CountdownStripView items={[]} paused={false} />)).toBe("");
    expect(renderToStaticMarkup(<CountdownStrip countdowns={undefined} clock={1000} paused={false} />)).toBe("");
  });

  it("ticks off the snapshot clock, and says ⏸ while paused", () => {
    const live = renderToStaticMarkup(<CountdownStrip countdowns={[SUMMONS]} clock={1_200_000} paused={false} />);
    expect(live).toContain('role="timer"');
    expect(live).toContain("⏳ Summons 1:40");
    expect(live).not.toContain(COUNTDOWN_PAUSED);
    const held = renderToStaticMarkup(<CountdownStrip countdowns={[SUMMONS]} clock={1_200_000} paused />);
    expect(held).toContain(COUNTDOWN_PAUSED);
    expect(held).toContain("⏳ Summons 1:40");
    expect(held).toContain("countdown-strip held");
  });

  it("sits right under the room header", () => {
    const room = { id: "loc:The Desktop", kind: "location", title: "The Desktop", spaceId: "story", messages: [], unread: 0 } as unknown as Channel;
    const html = renderToStaticMarkup(<ChannelView channel={room} onBack={() => {}} strip={<CountdownStripView items={[{ label: "Summons", left: 90 }]} paused={false} />} />);
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("countdown-strip"));
    expect(html).toContain("⏳ Summons 1:30");
  });
});
