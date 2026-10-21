//! A made-up screen state for drawing a scene with no server (wave 17):
//! the preview harness and the lanes' tests. Every field the cutscenes read
//! has a plausible late-night value; override what a scene needs.

import { EMPTY_NIGHT, type ScreenChart, type ScreenKing, type ScreenMoment, type ScreenNight, type ScreenState, type ScreenTarget } from "../screen.ts";

export interface FakeOpts {
  now?: number;
  /** The character introduced (revealed), or still hidden. */
  introduced?: boolean;
  target?: ScreenTarget;
  night?: Partial<ScreenNight>;
  moments?: ScreenMoment[];
  chart?: ScreenChart | null;
  king?: ScreenKing | null;
  countdown?: string | null;
  /** Seconds left on the countdown. */
  remaining?: number | null;
  reinstalling?: number;
}

/** Programs for a fake chart / a fake pick. */
export const FAKE_PROGRAMS: readonly string[] = ["Winamp", "Excel", "MS Paint", "Minesweeper", "Netscape Navigator", "RealPlayer", "ICQ", "Encarta 95", "SimCity 2000", "Paint Shop Pro", "Solitaire", "Notepad"];

export function fakeChart(slide = "trust_chart", revealAt = 0): ScreenChart {
  return { slide, rows: FAKE_PROGRAMS.map((name, i) => ({ name, value: 96 - i * 7 })), top: FAKE_PROGRAMS[0]!, bottom: FAKE_PROGRAMS[FAKE_PROGRAMS.length - 1]!, revealAt };
}

export function fakeState(o: FakeOpts = {}): ScreenState {
  const now = o.now ?? Date.now();
  return {
    now,
    receivedAt: now,
    night: { ...EMPTY_NIGHT, phase: "desktop", step: 6, bottle_pick: "Winamp", award_winner: "Excel", award_value: 412, help_votes: 7, thwart_votes: 3, alerts: "dialog", ...o.night },
    moments: o.moments ?? [],
    cues: {},
    character: { id: "Trabolta", hidden: o.introduced === false, awake: o.introduced !== false, online: true, hold: false },
    attract: o.introduced === false,
    countdown: o.countdown ?? null,
    remaining: o.remaining ?? null,
    chart: o.chart === undefined ? fakeChart() : o.chart,
    target: o.target ?? "tv",
    program: { slide: null, overlay: null, blackout: null, flicker: null },
    voice: null,
    room: null,
    announce: null,
    announces: [],
    identify: false,
    identifyLeft: null,
    announceEpoch: "preview",
    king: o.king === undefined ? { hp: 9, max: 15, fallen: false, armed: true } : o.king,
    reinstalling: o.reinstalling ?? 0,
  };
}
