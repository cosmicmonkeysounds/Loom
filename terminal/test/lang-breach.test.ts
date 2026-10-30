// The Language Report's breach (wave 48b, C14): the timeline and its
// budget (every word out within ~20 s, whatever the count), the lines (a
// bar per unsaid word, never text), the heap packed round the window, the
// window's strain, the eye, the notes and the cut, and what the canvas
// draws (a recording context: every word through fillText, a bar never).

import { describe, expect, it } from "vitest";
import { fakeLanguage } from "../src/cutscene/fake.ts";
import { drawEye, drawLog, drawPiece, drawSlot, drawTentacles, heatColor, logRows, type LogCopy } from "../src/cutscene/kit/lang-breach-draw.ts";
import {
  BREACH,
  BREACH_BARS_MAX,
  BREACH_NOTES,
  BREACH_WIN,
  LANG_WORD_MAX,
  breachLines,
  breachSchedule,
  breachSize,
  breachSpan,
  breachTimes,
  cutAt,
  eyeLook,
  eyeOpen,
  flightAt,
  langWord,
  lineAt,
  noteAt,
  noteLife,
  packTide,
  printedBy,
  scissorsX,
  strainAt,
  tallyAt,
  winRect,
  windowOff,
  windowShake,
  type BreachLine,
  type Rect,
} from "../src/cutscene/kit/lang-breach.ts";
import { LANG_COPY, langTicks, languagePlan, levelCaption, reportKey, ringOf } from "../src/cutscene/scenes/language.tsx";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`);

describe("the breach's budget: every line out within ~20 s, whatever the count", () => {
  it("first line to last: none for one, 2.5 s for two, 20 s at 400 and never more", () => {
    expect(breachSpan(0)).toBe(0);
    expect(breachSpan(1)).toBe(0);
    expect(breachSpan(2)).toBeGreaterThanOrEqual(BREACH.minSpan);
    expect(breachSpan(400)).toBe(BREACH.span);
    expect(breachSpan(5000)).toBe(BREACH.span);
    for (let n = 2; n < 700; n += 7) expect(breachSpan(n + 1), `${n}`).toBeGreaterThanOrEqual(breachSpan(n));
  });

  for (const n of [1, 2, 12, 100, 400, 463, 601]) {
    it(`${n} lines: the first prints at flow, the last ≤ 20 s later, every one lands before the scissors`, () => {
      const tm = breachTimes(n);
      expect(tm.stage).toBeGreaterThanOrEqual(BREACH.minStage);
      expect(tm.flow).toBe(BREACH.flow);
      expect(lineAt(0, tm)).toBe(tm.flow);
      expect(lineAt(n - 1, tm)).toBe(tm.last);
      expect(tm.last - tm.flow).toBeLessThanOrEqual(20_000);
      expect(tm.flow < tm.leak && tm.leak < tm.eye && tm.eye < tm.ask && tm.ask < tm.press && tm.press < tm.snap && tm.snap < tm.cut && tm.cut < tm.summary).toBe(true);
      for (const flights of [true, false]) {
        const s = breachSchedule(tm, flights);
        for (let i = 0; i < n; i++) {
          if (i > 0) expect(s.line[i]!, `${i}`).toBeGreaterThanOrEqual(s.line[i - 1]!);
          expect(s.leave[i]!, `${i}`).toBeGreaterThanOrEqual(s.line[i]!);
          expect(s.leave[i]!, `${i}`).toBeGreaterThanOrEqual(tm.leak);
          expect(s.land[i]! - s.leave[i]!, `${i}`).toBeLessThanOrEqual(s.flightMax);
          expect(s.land[i]!, `${i}`).toBeLessThan(tm.snap);
        }
        // Out of the window and landed: the last line is in the heap at most ~21 s after the first printed.
        expect(Math.max(...s.land) - tm.flow, `${n} flights=${flights}`).toBeLessThanOrEqual(21_200);
      }
    });
  }

  it("speeds up: 400 lines start readable and end in a rush", () => {
    const tm = breachTimes(400);
    expect(lineAt(1, tm) - lineAt(0, tm)).toBeGreaterThan(500);
    expect(lineAt(399, tm) - lineAt(398, tm)).toBeLessThan(40);
    // A dozen print nearly evenly, about half a second apart.
    const d = breachTimes(12);
    const gaps = Array.from({ length: 11 }, (_, i) => lineAt(i + 1, d) - lineAt(i, d));
    expect(Math.min(...gaps)).toBeGreaterThan(350);
    expect(Math.max(...gaps)).toBeLessThan(650);
  });

  it("counts what has printed, and the status bar's tally follows it", () => {
    const tm = breachTimes(50);
    const s = breachSchedule(tm, true);
    expect(printedBy(tm.flow - 1, s.line)).toBe(0);
    expect(printedBy(tm.flow, s.line)).toBe(1);
    expect(printedBy(tm.last, s.line)).toBe(50);
    expect(tallyAt(200, 0, 50)).toBe(0);
    expect(tallyAt(200, 25, 50)).toBe(100);
    expect(tallyAt(200, 50, 50)).toBe(200);
    expect(tallyAt(200, 0, 0)).toBe(200);
  });

  it("ticks along the log at most every 240 ms, the last line's always", () => {
    const s = breachSchedule(breachTimes(400), true);
    const cues = langTicks(s.line);
    expect(cues[0]).toBe(s.line[0]);
    expect(cues[cues.length - 1]).toBe(s.line[399]);
    for (let i = 1; i < cues.length - 1; i++) expect(cues[i]! - cues[i - 1]!).toBeGreaterThanOrEqual(240);
    expect(langTicks([])).toEqual([]);
  });
});

describe("the breach's lines", () => {
  it("every word once, in order, whole up to 18 characters; the most censored hottest and biggest", () => {
    const lines = breachLines(["password", "hello", "heck"], [9, 3, 1], 0, 0);
    expect(lines.map((l) => (l.kind === "word" ? l.text : l.kind))).toEqual(["password", "hello", "heck"]);
    expect(lines[0]).toMatchObject({ count: 9, heat: 1, size: 3 });
    expect(lines[2]).toMatchObject({ count: 1, heat: 0, size: 1 });
    expect(lines[1]!.heat).toBeGreaterThan(0);
    expect(lines[1]!.heat).toBeLessThan(1);
    // No counts above 1 (a wave 48 server): all alike, but a lone word is the most censored.
    expect(breachLines(["a", "b"], [1, 1], 0, 0).map((l) => l.heat)).toEqual([0, 0]);
    expect(breachLines(["heck"], [], 0, 0)[0]).toMatchObject({ heat: 1, size: 3 });
    expect(breachSize(0)).toBe(1);
    expect(breachSize(1)).toBe(3);
    expect(langWord(" password ")).toBe("password");
    expect(langWord("x".repeat(LANG_WORD_MAX))).toBe("x".repeat(LANG_WORD_MAX));
    expect(langWord("x".repeat(LANG_WORD_MAX + 1))).toBe(`${"x".repeat(LANG_WORD_MAX - 1)}…`);
    expect(Array.from(langWord("🤬".repeat(30)))).toHaveLength(LANG_WORD_MAX);
  });

  it("an unsaid word is a bar with no text at all, mixed in among the words, never first; + n more last", () => {
    for (const [w, unsaid] of [[12, 4], [400, 9], [3, 30], [0, 6], [1, 1]] as const) {
      const lines = breachLines(words(w), [], unsaid, 62);
      const bars = lines.filter((l) => l.kind === "bar");
      expect(bars, `${w}/${unsaid}`).toHaveLength(unsaid);
      for (const b of bars) {
        expect(Object.keys(b).sort(), `${w}/${unsaid}`).toEqual(["chars", "heat", "kind", "size"]);
        expect("text" in b).toBe(false);
        expect(b.chars).toBeGreaterThanOrEqual(4);
        expect(b.chars).toBeLessThanOrEqual(7);
      }
      if (w > 0) expect(lines[0]!.kind).toBe("word");
      expect(lines.filter((l) => l.kind === "word").map((l) => (l as { text: string }).text)).toEqual(words(w));
      expect(lines[lines.length - 1]).toEqual({ kind: "more", text: "+ 62 more", heat: 0, size: 1.2 });
    }
    // Spread through the log, not bunched at one end.
    const spread = breachLines(words(100), [], 4, 0);
    const at = spread.flatMap((l, i) => (l.kind === "bar" ? [i] : []));
    expect(at[0]!).toBeLessThan(40);
    expect(at[3]!).toBeGreaterThan(60);
    expect(breachLines([], [], 10_000, 0)).toHaveLength(BREACH_BARS_MAX);
    expect(breachLines(["a"], [], 0, 0).some((l) => l.kind === "more")).toBe(false);
  });

  it("the plan: the lines, the counts shown only when some word was censored twice, the eye's dozen", () => {
    const plan = languagePlan(fakeLanguage("unsaid"));
    expect(plan.lines.filter((l) => l.kind === "bar")).toHaveLength(4);
    expect(plan.counts).toBe(true);
    expect(plan.top).toEqual({ word: plan.lines[0]!.kind === "word" ? plan.lines[0]!.text : "", count: 9 });
    expect(plan.total).toBe(16);
    expect(ringOf(plan.lines).every((l) => l.kind === "word")).toBe(true);
    expect(ringOf(plan.lines)).toHaveLength(12);
    // Only unsaid words censored: the eye is made of bars.
    const bars = languagePlan(fakeLanguage("bars"));
    expect(ringOf(bars.lines).every((l) => l.kind === "bar")).toBe(true);
    expect(bars.top).toBeNull();
    // The plan is rebuilt only when the report changes.
    expect(reportKey(fakeLanguage("dozen"))).toBe(reportKey(fakeLanguage("dozen")));
    expect(reportKey(fakeLanguage("dozen"))).not.toBe(reportKey({ ...fakeLanguage("dozen"), stars: 42 }));
    expect(reportKey(fakeLanguage("dozen"))).not.toBe(reportKey({ ...fakeLanguage("dozen"), counts: [1, ...fakeLanguage("dozen").counts.slice(1)] }));
  });

  it("each strength says what it catches; between two tiers, the lower", () => {
    expect(levelCaption(100)).toMatch(/^Paranoid/u);
    expect(levelCaption(95)).toMatch(/^Suspicious/u);
    expect(levelCaption(40)).toBe(levelCaption(25));
    expect(levelCaption(5)).toBe("Slurs only");
    expect(levelCaption(0)).toBe("Slurs only");
  });
});

describe("the heap", () => {
  const inside = (r: { cx: number; cy: number; w: number; h: number }, box: Rect) => r.cx + r.w / 2 > box.x && r.cx - r.w / 2 < box.x + box.w && r.cy + r.h / 2 > box.y && r.cy - r.h / 2 < box.y + box.h;
  const cases: ReadonlyArray<readonly [string, BreachLine[]]> = [
    ["one", breachLines(["heck"], [1], 0, 0)],
    ["dozen", languagePlan(fakeLanguage("dozen")).lines],
    ["unsaid", languagePlan(fakeLanguage("unsaid")).lines],
    ["max", languagePlan(fakeLanguage("max")).lines],
    ["long words", breachLines(Array.from({ length: 60 }, (_, i) => `${"x".repeat(17)}${i}`), [], 5, 3)],
  ];
  for (const aspect of [16 / 9, 4 / 3, 0.625])
    for (const [name, lines] of cases)
      it(`${name} at ${aspect.toFixed(2)}: every line has a place on screen, clear of the window and of each other`, () => {
        const hole = winRect(aspect);
        const tide = packTide(lines, aspect, hole, 0.5);
        expect(tide.fits).toBe(true);
        expect(tide.slots).toHaveLength(lines.length);
        tide.slots.forEach((s, i) => {
          expect(s.cx - s.w / 2, `${i} left`).toBeGreaterThanOrEqual(-1e-9);
          expect(s.cx + s.w / 2, `${i} right`).toBeLessThanOrEqual(1 + 1e-9);
          expect(s.cy - s.h / 2, `${i} top`).toBeGreaterThanOrEqual(-0.01);
          expect(s.cy + s.h / 2, `${i} bottom`).toBeLessThanOrEqual(1.01);
          expect(inside({ ...s, w: s.w * 0.98, h: s.h * 0.6 }, hole), `${i} over the window`).toBe(false);
          expect(s.fs).toBeCloseTo(tide.fs * lines[i]!.size, 9);
        });
        // No two overlap (their boxes a little shrunk: the tilt and the row jitter).
        for (let i = 0; i < tide.slots.length; i++)
          for (let j = i + 1; j < Math.min(tide.slots.length, i + 40); j++) {
            const a = tide.slots[i]!;
            const b = tide.slots[j]!;
            const over = Math.abs(a.cx - b.cx) < (a.w + b.w) * 0.45 && Math.abs(a.cy - b.cy) < (a.h + b.h) * 0.3;
            expect(over, `${name} ${i}/${j}`).toBe(false);
          }
      });

  it("a short night's heap sits big under the window; 400 lines climb to the top", () => {
    const hole = BREACH_WIN.land;
    const one = packTide(breachLines(["heck"], [1], 0, 0), 16 / 9, hole, 0.5);
    expect(one.slots[0]!.cy - one.slots[0]!.h / 2).toBeGreaterThan(hole.y + hole.h);
    expect(one.slots[0]!.fs).toBeGreaterThan(0.15);
    const max = packTide(languagePlan(fakeLanguage("max")).lines, 16 / 9, hole, 0.5);
    expect(Math.min(...max.slots.map((s) => s.cy))).toBeLessThan(0.08);
    // The most censored words are the biggest.
    const lines = languagePlan(fakeLanguage("max")).lines;
    const first = max.slots[lines.findIndex((l) => l.kind === "word")]!;
    const last = max.slots[lines.length - 2]!;
    expect(first.fs).toBeGreaterThan(last.fs * 2);
  });

  it("a word flies from the window's edge to its place, growing and coming to rest", () => {
    const hole = BREACH_WIN.land;
    const tide = packTide(languagePlan(fakeLanguage("dozen")).lines, 16 / 9, hole, 0.5);
    const s = tide.slots[0]!;
    const start = flightAt(s, hole, 0, 0);
    const end = flightAt(s, hole, 0, 1);
    expect(end).toMatchObject({ scale: 1 });
    expect(end.x).toBeCloseTo(s.cx, 9);
    expect(end.y).toBeCloseTo(s.cy, 9);
    expect(end.rot).toBeCloseTo(s.rot, 9);
    expect(start.scale).toBeLessThan(0.5);
    expect(start.x).toBeGreaterThanOrEqual(hole.x);
    expect(start.x).toBeLessThanOrEqual(hole.x + hole.w);
    expect(start.y).toBeGreaterThanOrEqual(hole.y);
    expect(start.y).toBeLessThanOrEqual(hole.y + hole.h);
  });
});

describe("the window, the eye, the notes, the cut", () => {
  const tm = breachTimes(120);

  it("the window strains from a fifth into the stage, harder by the eye, calmer while it asks; a wall never scales", () => {
    expect(strainAt(tm.flow + 100, tm)).toBe(0);
    expect(strainAt(tm.leak, tm)).toBeCloseTo(0.6, 5);
    expect(strainAt(tm.eye + 10, tm)).toBe(1.5);
    expect(strainAt(tm.ask + 1000, tm)).toBeLessThan(1);
    expect(strainAt(tm.snap, tm)).toBe(0);
    expect(windowShake(tm.flow - 1, tm, false)).toEqual({ x: 0, y: 0, s: 1, sk: 0 });
    for (let t = tm.flow; t < tm.snap; t += 37) {
      const tv = windowShake(t, tm, false);
      const wall = windowShake(t, tm, true);
      expect(Math.abs(tv.x)).toBeLessThanOrEqual(0.83);
      expect(tv.s).toBeLessThanOrEqual(1.06);
      expect(wall.s).toBe(1);
      expect(wall.sk).toBe(0);
      expect(Math.abs(wall.x)).toBeLessThanOrEqual(0.45);
    }
    // It switches off once the scissors cross its middle: flat, then gone.
    expect(windowOff(tm.snap, tm)).toEqual({ sx: 1, sy: 1, o: 1 });
    expect(windowOff(tm.cut, tm).o).toBe(0);
  });

  it("the eye opens at its beat, blinks at most twice, looks at you first and while it asks", () => {
    expect(eyeOpen(tm.eye - 1, tm)).toBe(0);
    expect(eyeOpen(tm.eye + 900, tm)).toBe(1);
    expect(eyeLook(tm.eye + 300, tm)).toEqual({ x: 0, y: 0 });
    const look = eyeLook(tm.ask + 400, tm);
    expect(Math.abs(look.x)).toBeLessThan(1e-9);
    expect(Math.abs(look.y)).toBeLessThan(1e-9);
    let dips = 0;
    let shut = false;
    for (let t = tm.eye + 1000; t < tm.snap; t += 10) {
      const k = eyeOpen(t, tm);
      if (k < 0.3 && !shut) dips++;
      shut = k < 0.3;
      const l = eyeLook(t, tm);
      expect(Math.abs(l.x)).toBeLessThanOrEqual(0.75);
      expect(Math.abs(l.y)).toBeLessThanOrEqual(0.4);
    }
    expect(dips).toBeGreaterThanOrEqual(1);
    expect(dips).toBeLessThanOrEqual(2);
  });

  it("the notes: in order, a few seconds each, three on a wall, two when calm, none in the bottom quarter", () => {
    const at = BREACH_NOTES.map((n) => noteAt(n, tm));
    for (let i = 1; i < at.length; i++) expect(at[i]!).toBeGreaterThan(at[i - 1]!);
    expect(at[0]).toBe(tm.leak);
    expect(noteLife(breachTimes(1))).toBe(2400);
    expect(noteLife(breachTimes(400))).toBe(3200);
    expect(BREACH_NOTES.filter((n) => n.lite)).toHaveLength(3);
    expect(BREACH_NOTES.filter((n) => n.calm)).toHaveLength(2);
    for (const n of BREACH_NOTES) {
      expect(n.land.y, n.id).toBeLessThan(60);
      expect(n.land.x + n.land.w, n.id).toBeLessThanOrEqual(100);
      expect(n.port.x + n.port.w, n.id).toBeLessThanOrEqual(100);
      expect(LANG_COPY.notes[n.id].text.length, n.id).toBeGreaterThan(0);
    }
    // The last one is OK'd away before the ask on a long night.
    const long = breachTimes(400);
    expect(noteAt(BREACH_NOTES[BREACH_NOTES.length - 1]!, long) + noteLife(long)).toBeLessThanOrEqual(long.ask);
  });

  it("the scissors cross the screen in the cut, and know when they pass each place", () => {
    expect(scissorsX(tm.snap, tm)).toBeLessThan(0);
    expect(scissorsX(tm.cut, tm)).toBeGreaterThan(1);
    for (const x of [0, 0.1, 0.33, 0.5, 0.71, 0.99]) expect(scissorsX(cutAt(x, tm), tm)).toBeCloseTo(x, 6);
  });

  it("nothing blinks faster than once a second: the cursor (530 ms) and the overflow (500 ms) half-periods", () => {
    // The log's cursor: count its toggles over 3 s.
    const lines = breachLines(["heck"], [1], 0, 0);
    const one = breachTimes(lines.length);
    const s = breachSchedule(one, true);
    const lh = 400 / 12;
    let toggles = 0;
    let prev: boolean | null = null;
    for (let t = one.flow + 2000; t < one.flow + 5000; t += 10) {
      const rec = recorder();
      drawLog(rec.ctx, 600, 400, t, one, s, lines, { rows: 12, charW: 0.5, counts: false, jitter: false, copy: LANG_COPY.log });
      const on = rec.calls.some((c) => c.op === "fillRect" && Math.abs(Number(c.args[3]) - lh * 0.7) < 1e-6);
      if (prev !== null && on !== prev) toggles++;
      prev = on;
    }
    // Three seconds: at most six changes (three on, three off), and it does blink.
    expect(toggles).toBeGreaterThan(0);
    expect(toggles).toBeLessThanOrEqual(6);
  });
});

// --- what the canvas draws ---------------------------------------------------------------

interface Call {
  op: string;
  args: unknown[];
}

/** A 2D context that records what is drawn (enough of one for the breach's functions). */
function recorder() {
  const calls: Call[] = [];
  const rec =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  const gradient = { addColorStop: () => {} };
  const ctx = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "",
    lineCap: "",
    textAlign: "",
    textBaseline: "",
    globalAlpha: 1,
    fillText: rec("fillText"),
    strokeText: rec("strokeText"),
    fillRect: rec("fillRect"),
    strokeRect: rec("strokeRect"),
    clearRect: rec("clearRect"),
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    arc: () => {},
    ellipse: () => {},
    rect: () => {},
    clip: () => {},
    fill: rec("fill"),
    stroke: rec("stroke"),
    setLineDash: () => {},
    createRadialGradient: () => gradient,
    measureText: (s: string) => ({ width: s.length * 50 }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, texts: () => calls.filter((c) => c.op === "fillText" || c.op === "strokeText").map((c) => String(c.args[0])) };
}

describe("what the breach draws", () => {
  it("a word through fillText (with its rim), + n more as text, a bar only ever as rects", () => {
    for (const l of breachLines(["password", "hello"], [3, 1], 3, 7)) {
      const r = recorder();
      drawPiece(r.ctx, l, 40, 0.5);
      if (l.kind === "bar") {
        expect(r.texts()).toEqual([]);
        expect(r.calls.filter((c) => c.op === "fillRect")).toHaveLength(2);
      } else expect(r.texts()).toContain(l.text);
    }
    expect(heatColor(0)).toBe("rgb(157,255,176)");
    expect(heatColor(1)).toBe("rgb(255,74,42)");
    expect(heatColor(0.5)).toBe("rgb(255,210,63)");
  });

  it("every censored word reaches the heap's canvas; the unsaid never put a character on it", () => {
    const plan = languagePlan(fakeLanguage("max"));
    const tide = packTide(plan.lines, 16 / 9, BREACH_WIN.land, 0.5);
    const r = recorder();
    plan.lines.forEach((l, i) => drawSlot(r.ctx, l, tide.slots[i]!, 1920, 1080, 0.5));
    const drawn = new Set(r.texts());
    for (const l of plan.lines) if (l.kind !== "bar") expect(drawn.has(l.text), l.text).toBe(true);
    expect(r.texts().length).toBe(2 * 400 + 1); // each word with its rim, + "+ 62 more"
    expect(r.calls.filter((c) => c.op === "fillRect")).toHaveLength(2 * 9);
  });

  it("the log prints each line as it comes, the newest at the bottom; a bar is a rect, never text", () => {
    const lines = breachLines(["password", "hello", "heck"], [5, 2, 1], 2, 0);
    const tm = breachTimes(lines.length);
    const s = breachSchedule(tm, true);
    const copy: LogCopy = LANG_COPY.log;
    const at = (t: number) => {
      const r = recorder();
      drawLog(r.ctx, 800, 480, t, tm, s, lines, { rows: 12, charW: 0.5, counts: true, jitter: true, copy });
      return r;
    };
    expect(at(tm.flow - 1).texts().some((x) => x.includes("password"))).toBe(false);
    const all = at(tm.last + 100);
    expect(all.texts()).toEqual(expect.arrayContaining(["password", "×5", "hello", "×2", "heck", "×1"]));
    // Only the prompt and the words are text: the two bars add none.
    expect(all.texts().filter((x) => !["password", "hello", "heck", "×5", "×2", "×1"].includes(x)).every((x) => x.startsWith(copy.prompt))).toBe(true);
    // A short night types `del` at a fresh prompt at the leak and is refused.
    const short = breachTimes(1);
    const rows = logRows(short.leak + 2000, short, breachSchedule(short, true), copy);
    expect(rows.filter((r) => r.k === "prompt")).toHaveLength(2);
    expect(rows.filter((r) => r.k === "say").map((r) => (r as { text: string }).text)).toEqual([...copy.denied]);
    // A long night never gets there: the flood is the joke.
    const long = breachTimes(400);
    expect(logRows(long.leak + 2000, long, breachSchedule(long, true), copy).some((r) => r.k === "say")).toBe(false);
  });

  it("the eye's iris and the tentacles are the most censored words, or bars when only the unsaid were censored", () => {
    const tm = breachTimes(20);
    for (const kind of ["dozen", "bars"] as const) {
      const ring = ringOf(languagePlan(fakeLanguage(kind)).lines);
      const eye = recorder();
      drawEye(eye.ctx, 900, 450, tm.eye + 2000, tm, ring, { rings: 3, charW: 0.5, spin: true, look: true });
      const tent = recorder();
      drawTentacles(tent.ctx, 1920, 1080, tm.eye + 2000, tm, ring, BREACH_WIN.land, 0.5);
      if (kind === "bars") {
        expect(eye.texts()).toEqual([]);
        expect(tent.texts()).toEqual([]);
      } else {
        const words = new Set(ring.map((l) => (l.kind === "word" ? l.text : "")));
        expect(eye.texts().length).toBeGreaterThan(10);
        expect(eye.texts().every((x) => words.has(x))).toBe(true);
        expect(tent.texts().length).toBeGreaterThan(10);
        expect(tent.texts().every((x) => words.has(x))).toBe(true);
      }
      // Shut before its beat: nothing drawn.
      const shut = recorder();
      drawEye(shut.ctx, 900, 450, tm.eye - 1, tm, ring, { rings: 3, charW: 0.5, spin: true, look: true });
      expect(shut.calls).toEqual([]);
    }
  });
});
