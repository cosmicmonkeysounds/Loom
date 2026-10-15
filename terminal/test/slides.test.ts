import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseScreenState, type ScreenProgram, type ScreenState } from "../src/screen.ts";
import { BLACKOUT_MS, FLICKER_FRESH_MS, SLIDE_COPY, SLIDE_HOLD_MS, chartLines, formatCountdown, screenLayers, slideCopy, slideSources, y2kClock } from "../src/slides.ts";

const T0 = 1_000_000;
const empty: ScreenProgram = { slide: null, overlay: null, blackout: null, flicker: null };
const shot = (value: string, at: number, seq = 1, family = "screens") => ({ value, cue: `${family}_${value}`, seq, at });
const slide = (value: string, at: number, persist = false, kind: "slide" | "base" = "slide") => ({ ...shot(value, at), kind, persist });

function state(over: Partial<Omit<ScreenState, "program">> & { program?: Partial<ScreenProgram> } = {}): ScreenState {
  return {
    now: T0,
    receivedAt: T0,
    night: { screen: null, terminals: null },
    cues: {},
    character: null,
    attract: false,
    countdown: null,
    remaining: null,
    chart: null,
    target: "terminals",
    voice: null,
    announce: null,
    ...over,
    program: { ...empty, ...over.program },
  };
}
const at = (s: ScreenState, ms: number, piloting = false) => screenLayers(s, s.receivedAt + ms, { piloting });

describe("screen layers — precedence (N-03)", () => {
  it("holds a slide 45 s on a terminal and 90 s on the TV", () => {
    const s = state({ program: { slide: slide("trivia_2", T0) } });
    expect(at(s, 0).slide).toEqual({ value: "trivia_2", cue: "screens_trivia_2" });
    expect(at(s, SLIDE_HOLD_MS.terminals - 1).slide).not.toBeNull();
    expect(at(s, SLIDE_HOLD_MS.terminals).slide).toBeNull(); // back to auto
    const tv = { ...s, target: "tv" as const };
    expect(at(tv, 60_000).slide).not.toBeNull();
    expect(at(tv, SLIDE_HOLD_MS.tv).slide).toBeNull();
  });

  it("persistent slides stay; history (at 0) never re-holds; a base cue is no slide", () => {
    expect(at(state({ program: { slide: slide("bingo", T0, true) } }), 10 * 60_000).slide?.value).toBe("bingo");
    expect(at(state({ program: { slide: slide("bingo", 0, true) } }), 0).slide?.value).toBe("bingo");
    expect(at(state({ program: { slide: slide("trivia_1", 0) } }), 0).slide).toBeNull();
    expect(at(state({ program: { slide: slide("attract", T0, false, "base") } }), 0).slide).toBeNull();
  });

  it("ages on the server's clock, not the tablet's", () => {
    // The tablet's clock is an hour off; the answer arrived 10 s after the cue.
    const s = state({ now: T0 + 10_000, receivedAt: T0 + 3_600_000, program: { slide: slide("call_desktop", T0) } });
    expect(at(s, 0).slide).not.toBeNull();
    expect(at(s, SLIDE_HOLD_MS.terminals - 10_000).slide).toBeNull();
  });

  it("a pilot pre-empts the slide and the corner; an overlay beats the slide", () => {
    const s = state({ countdown: "hunt", remaining: 900, program: { slide: slide("trivia_1", T0) } });
    expect(at(s, 0)).toMatchObject({ slide: { value: "trivia_1" }, corner: 900 });
    expect(at(s, 0, true)).toMatchObject({ slide: null, corner: null });
    const o = state({ countdown: "hunt", remaining: 900, program: { slide: slide("trivia_1", T0), overlay: shot("alarm", T0, 2) } });
    expect(at(o, 0)).toMatchObject({ overlay: "alarm", corner: null });
  });

  it("blackout is black for 10 s, then the overlay after it (go to the living room)", () => {
    const s = state({ program: { overlay: shot("go_to_living_room", T0, 2), blackout: shot("blackout", T0, 1) } });
    expect(at(s, 0).overlay).toBe("blackout");
    expect(at(s, BLACKOUT_MS - 1).overlay).toBe("blackout");
    expect(at(s, BLACKOUT_MS).overlay).toBe("go_to_living_room");
    // A blackout on its own stands until the next cue.
    expect(at(state({ program: { overlay: shot("blackout", T0), blackout: shot("blackout", T0) } }), 60_000).overlay).toBe("blackout");
    // After a reboot (history) the blackout is not replayed.
    expect(at(state({ program: { overlay: shot("go_to_living_room", 0, 2), blackout: shot("blackout", 0) } }), 0).overlay).toBe("go_to_living_room");
  });

  it("the corner ticks down between polls, and the y2k slide turns it into the clock", () => {
    const s = state({ countdown: "hunt", remaining: 900 });
    expect(at(s, 1500).corner).toBe(899);
    expect(at(s, 2_000_000).corner).toBe(0);
    const y = state({ countdown: "y2k", remaining: 3600, program: { slide: slide("y2k", T0, true) } });
    expect(at(y, 0)).toMatchObject({ corner: null, y2k: 3600, slide: { value: "y2k" } });
    expect(at(state({ countdown: "y2k", remaining: 30 }), 0)).toMatchObject({ corner: 30, y2k: 30 });
  });

  it("a flicker plays only while fresh, never over a blackout", () => {
    const s = state({ program: { flicker: shot("flicker", T0, 7) } });
    expect(at(s, 0).flicker).toBe(7);
    expect(at(s, FLICKER_FRESH_MS).flicker).toBeNull();
    expect(at(state({ program: { flicker: shot("flicker", 0, 7) } }), 0).flicker).toBeNull();
    expect(at(state({ program: { flicker: shot("flicker", T0, 7), blackout: shot("blackout", T0) } }), 0).flicker).toBeNull();
  });

  it("no answer yet: nothing on top", () => {
    expect(screenLayers(null, T0, { piloting: false })).toEqual({ overlay: null, slide: null, corner: null, y2k: null, flicker: null, chart: null });
  });
});

describe("the live Trust Chart", () => {
  const chart = { slide: "trust_chart", rows: [{ name: "Calculator", value: 30 }, { name: "Winamp", value: 10 }, { name: "VLC", value: 10 }, { name: "MS Paint", value: -5 }] };

  it("rides the trust_chart slide only, and ranks ties together", () => {
    const up = state({ chart, program: { slide: slide("trust_chart", T0, true) } });
    expect(at(up, 60_000).chart).toBe(chart);
    expect(at(state({ chart, program: { slide: slide("bingo", T0, true) } }), 0).chart).toBeNull();
    expect(at(state({ chart, program: { slide: slide("trust_chart", T0, true), overlay: shot("alarm", T0, 2) } }), 0).chart).toBeNull();
    expect(chartLines(chart).map((r) => `${r.rank}:${r.name}:${r.value}`)).toEqual(["1:Calculator:30", "2:Winamp:10", "2:VLC:10", "4:MS Paint:-5"]);
  });

  it("parses off the wire; junk rows drop, a junk chart is null", () => {
    const s = parseScreenState({ attract: false, chart: { slide: "trust_chart", rows: [{ name: "A", value: 3 }, { name: 4 }, null, { name: "B", value: "x" }] } });
    expect(s?.chart).toEqual({ slide: "trust_chart", rows: [{ name: "A", value: 3 }] });
    expect(parseScreenState({ attract: false, chart: "nope" })?.chart).toBeNull();
    expect(parseScreenState({ attract: false })?.chart).toBeNull();
  });
});

describe("screen layers — parsing the wire", () => {
  it("reads the program and target, tolerating junk", () => {
    const s = parseScreenState(
      {
        attract: true,
        now: 5,
        target: "tv",
        program: { slide: { value: "bingo", cue: "tv_bingo", seq: 3, at: 4, kind: "slide", persist: true }, overlay: { value: 1 }, blackout: null, flicker: "x" },
      },
      9,
    );
    expect(s).toMatchObject({ receivedAt: 9, target: "tv", program: { slide: { cue: "tv_bingo", persist: true, kind: "slide" }, overlay: null, flicker: null } });
    expect(parseScreenState({ attract: false })?.program).toEqual(empty);
    expect(parseScreenState({ attract: false })?.target).toBe("terminals");
  });
});

describe("slides", () => {
  it("looks for the PNG under the cue's name, then its value; never a path", () => {
    expect(slideSources({ value: "trivia_1", cue: "screens_trivia_1" }, "/terminal/")).toEqual(["/terminal/slides/screens_trivia_1.png", "/terminal/slides/trivia_1.png"]);
    expect(slideSources({ value: "../x", cue: "screens_../x" }, "/t/")).toEqual([]);
  });

  it("a missing PNG still has a card: known copy, else the value made readable", () => {
    expect(slideCopy("bingo").title).toBe("COMPUTER BINGO");
    expect(slideCopy("award_best_liar")).toEqual({ title: "AWARD BEST LIAR" });
  });

  it("slides that can show before the introduction never name the character", () => {
    for (const v of ["call_desktop", "bingo", "bingo_time", "screensaver"]) expect(JSON.stringify(slideCopy(v))).not.toMatch(/trabolta/iu);
  });

  it("the trivia slides ask exactly the Quest Log's questions", () => {
    const quests = readFileSync(fileURLToPath(new URL("../../core/examples/trapped-in-the-internet/quests.loom", import.meta.url)), "utf8");
    for (const v of ["trivia_1", "trivia_2"]) {
      const lines = SLIDE_COPY[v]!.lines!;
      expect(lines).toHaveLength(3);
      for (const l of lines) expect(quests).toContain(`- ${l}`);
    }
  });

  it("formats the corner and the Y2K clock", () => {
    expect(formatCountdown(900)).toBe("15:00");
    expect(formatCountdown(59)).toBe("00:59");
    expect(formatCountdown(3725)).toBe("1:02:05");
    expect(y2kClock(3600)).toEqual({ time: "11:00:00 PM", date: "12/31/1999" });
    expect(y2kClock(61)).toEqual({ time: "11:58:59 PM", date: "12/31/1999" });
    expect(y2kClock(0)).toEqual({ time: "12:00:00 AM", date: "1/1/1900" });
    expect(y2kClock(null).date).toBe("1/1/1900");
  });
});
