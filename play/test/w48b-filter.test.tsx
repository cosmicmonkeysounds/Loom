// Wave 48b (C7, C10, C11, C13, docs/loom-w48-contract.md): the Password
// Manager's filter, tuned and played — the strength dial (bands, the Start
// item only on the censor's booth, posting on release, optimistic with a
// rollback), each highlight in its band's colour (a slur its [slur] chip),
// and the ⭐ mini-game (the multiplier's decay, a line's worth, what ✂
// pays, the muted note, the burst). The server is mocked: the core lane
// builds it in parallel.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import { elements, mountHooks } from "./hooks-harness.ts";
import { readBundledCss } from "./css.ts";
import { ApiError } from "../src/client.ts";
import { memoryStore, type SessionStorage } from "../src/host.ts";
import { ARM_LINE } from "../src/arm.ts";
import { PopOut, type PopOutsApi } from "../src/booth/popouts/rung.ts";
import { bindDraft, type BoothOpeners } from "../src/booth/popouts/use-booth-popouts.ts";
import { EMPTY_POPOUTS, parseStored, popReducer, storedOf } from "../src/moments/popout-model.ts";
import { boothStartItems, playerStartItems } from "../src/booth/header.tsx";
import { BoothTray } from "../src/booth/tray.tsx";
import { boothMissionOf } from "../src/booth/mission-model.ts";
import { closeTo } from "../src/booth/model.ts";
import { boothBackStep } from "../src/booth/app.tsx";
import {
  FILTER_BANDS,
  FILTER_COOL_MS,
  FILTER_COPY,
  FILTER_GAME_COPY,
  FILTER_LEVEL_COPY,
  FILTER_MULTS,
  UNSAID_WORD,
  bandAt,
  bandsAt,
  burstLine,
  burstQuip,
  censorDone,
  censorRefusal,
  clipLine,
  comboOf,
  filterDraft,
  filterStartItem,
  heatAt,
  heatShare,
  levelOf,
  levelRefusal,
  markSegments,
  multAt,
  multText,
  mutedNote,
  nextNotchMs,
  notchAt,
  payOf,
  restedInMs,
  snapLevel,
  stepBand,
  tierRanges,
} from "../src/booth/filter/model.ts";
import { useFilter, type FilterApi, type FilterGame, type FilterSource } from "../src/booth/filter/use-filter.ts";
import { FILTER_BURST_MS, FilterBurst, FilterMeter, FilterPay, filterGameNodes, useGameClock } from "../src/booth/filter/game.tsx";
import { FilterLegend, FilterStrengthWindow } from "../src/booth/filter/strength.tsx";
import { FilterRow, FilterWindow, MarkedLine } from "../src/booth/filter/window.tsx";
import type { CensorResult, FilterCombo, FilterLevelResult, FilterLine, FilterView, PrimeView } from "../src/types.ts";

const noop = () => {};
const COMBO = (heat: number): FilterCombo => ({ heat, coolMs: 20_000, mults: [3, 2, 1.5, 1, 0.5, 0.25] });
/** "my password is hello" at 100%: "ass" buried-mild (90), "hell" paranoid (100). */
const L = (seq: number, extra: Partial<FilterLine> = {}): FilterLine => ({
  seq,
  guest: `g-${seq}`,
  name: `Program ${seq}`,
  where: "# lobby",
  text: "my password is hello",
  hits: [
    { start: 4, end: 7, tier: 90 },
    { start: 15, end: 19, tier: 100 },
  ],
  words: ["password", "hello"],
  points: 2,
  ts: seq * 1000,
  ...extra,
});
const FV = (lines: FilterLine[], extra: Partial<FilterView> = {}): FilterView => ({ flagged: lines.length * 2, censored: 0, level: 100, muted: 0, stars: 0, combo: COMBO(0), lines, ...extra });
const PV = (filter?: FilterView): PrimeView => ({ character: "Password Manager", faction: null, guests: [], channels: [], spaces: [], interactions: [], objectives: [], player: true, ...(filter !== undefined ? { filter } : {}) }) as PrimeView;
const wake = { supported: false, on: false, toggle: noop };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the bands and the dial (C7)", () => {
  it("a strength is 0–100 in steps of 5; a bad one is the night's start, 100", () => {
    expect([snapLevel(0), snapLevel(42), snapLevel(43), snapLevel(-20), snapLevel(250), snapLevel(Number.NaN), snapLevel("50")]).toEqual([0, 40, 45, 0, 100, 100, 100]);
    expect(levelOf({ level: 60 })).toBe(60);
    expect(levelOf({})).toBe(100);
    expect(levelOf(null)).toBe(100);
  });

  it("between two tiers a strength catches what the lower one does (40% = 25%)", () => {
    expect(FILTER_BANDS.map((b) => b.tier)).toEqual([0, 10, 25, 50, 60, 75, 90, 100]);
    expect(bandAt(40).tier).toBe(25);
    expect(bandAt(0).catches).toBe("Slurs only");
    expect(bandAt(5).tier).toBe(0);
    expect(bandAt(100).key).toBe("paranoid");
    expect(bandsAt(55).filter((b) => b.on).map((b) => b.band.tier)).toEqual([0, 10, 25, 50]);
  });

  it("the band copy, DRAFT w48b: 0 never lists a slur, each tier adds its words", () => {
    expect(FILTER_BANDS.map((b) => b.catches)).toEqual([
      "Slurs only",
      "+ fuck, cunt",
      "+ shit, asshole, bitch…",
      "+ crap, balls, butt, ass…",
      "+ hell, heck, damn, fart…",
      "+ swears hiding inside words (Scunthorpe)",
      "+ mild ones inside words (password, button)",
      "+ everything (hello, check, Password Manager)",
    ]);
    expect(FILTER_BANDS.map((b) => b.points)).toEqual([12, 8, 5, 3, 2, 2, 1, 1]);
  });

  it("◀ Less / More ▶ jump a band and stay at the ends", () => {
    expect(stepBand(100, -1)).toBe(90);
    expect(stepBand(40, -1)).toBe(25);
    expect(stepBand(40, 1)).toBe(50);
    expect(stepBand(0, -1)).toBe(0);
    expect(stepBand(100, 1)).toBe(100);
  });

  it("a refused strength reads in plain words", () => {
    expect(levelRefusal(new ApiError("doors are closed", 409))).toBe("Not changed: the doors are closed.");
    expect(levelRefusal(new ApiError("not the censor", 403))).toBe("Not changed: this part isn't the censor tonight.");
    expect(levelRefusal(new ApiError("level is 0–100 in steps of 5", 400))).toBe("Not changed: that strength isn't on the dial.");
    expect(levelRefusal(Object.assign(new Error("slow"), { name: "RequestTimeout" }))).toBe("No answer.");
    expect(levelRefusal(new TypeError("Failed to fetch"))).toBe("No connection.");
    expect(levelRefusal(new ApiError("Not Found", 404))).toBe("Not changed: Not Found.");
    expect(FILTER_LEVEL_COPY.stays("No connection.", 100)).toBe("No connection. Still 100%.");
  });
});

describe("the ⭐ mini-game's numbers (C10, C11)", () => {
  it("the view's combo, defensively; none from an older server", () => {
    expect(comboOf(undefined)).toBeNull();
    expect(comboOf(null)).toBeNull();
    expect(comboOf({ heat: 2, coolMs: 10_000, mults: [4, 1] })).toEqual({ heat: 2, coolMs: 10_000, mults: [4, 1] });
    expect(comboOf({ heat: -3, coolMs: 0, mults: [] })).toEqual({ heat: 0, coolMs: FILTER_COOL_MS, mults: [...FILTER_MULTS] });
    expect(comboOf({ heat: "x", mults: [1, "2"] })).toEqual({ heat: 0, coolMs: FILTER_COOL_MS, mults: [...FILTER_MULTS] });
  });

  it("the multiplier is mults[min(len − 1, ceil(max(0, heat − elapsed / coolMs)))]", () => {
    const c = COMBO(1);
    expect(multAt(COMBO(0), 0)).toBe(3);
    expect(multAt(c, 0)).toBe(2);
    expect(multAt(c, 19_999)).toBe(2);
    expect(multAt(c, 20_000)).toBe(3);
    expect(multAt(COMBO(2.5), 0)).toBe(1);
    expect(multAt(COMBO(2.5), 10_000)).toBe(1.5);
    // Censoring every few seconds slides to ×¼ and stays there (the last notch).
    expect(multAt(COMBO(9), 0)).toBe(0.25);
    expect(notchAt(COMBO(9), 60_000)).toBe(5);
    expect(notchAt(COMBO(9), 80_001)).toBe(5);
    expect(notchAt(COMBO(9), 100_000)).toBe(4);
    expect(heatAt(c, 10_000)).toBe(0.5);
    expect(heatAt(c, -5_000)).toBe(1);
  });

  it("the meter: its fill, when the multiplier next changes, when it is rested", () => {
    expect(heatShare(COMBO(0), 0)).toBe(0);
    expect(heatShare(COMBO(2.5), 0)).toBe(0.5);
    expect(heatShare(COMBO(12), 0)).toBe(1);
    expect(nextNotchMs(COMBO(0), 0)).toBeNull();
    expect(nextNotchMs(COMBO(1.5), 0)).toBe(10_000);
    expect(nextNotchMs(COMBO(1), 0)).toBe(20_000);
    expect(nextNotchMs(COMBO(7.5), 0)).toBe(50_000);
    expect(restedInMs(COMBO(1.5), 5_000)).toBe(25_000);
    expect(restedInMs(COMBO(1), 40_000)).toBe(0);
  });

  it("a ✂ pays floor(points × mult): a 1-point hello at ×¼ pays nothing", () => {
    expect(payOf(5, 3)).toBe(15);
    expect(payOf(5, 1.5)).toBe(7);
    expect(payOf(1, 0.25)).toBe(0);
    expect(payOf(12, 0.25)).toBe(3);
    expect(payOf(3, 0.5)).toBe(1);
    expect(payOf(Number.NaN, 3)).toBe(0);
  });

  it("multipliers read as fractions", () => {
    expect(FILTER_MULTS.map(multText)).toEqual(["×3", "×2", "×1½", "×1", "×½", "×¼"]);
    expect(multText(0.75)).toBe("×¾");
    expect(multText(1.2)).toBe("×1.2");
    expect(multText(Number.NaN)).toBe("×1");
  });

  it("the muted note only when the strength hides waiting lines", () => {
    expect(mutedNote(0)).toBeNull();
    expect(mutedNote(undefined)).toBeNull();
    expect(mutedNote(1)).toBe("1 waiting line hidden at this strength");
    expect(mutedNote(3)).toBe("3 waiting lines hidden at this strength");
  });

  it("the burst: +n ⭐ ×m, and a 0 ⭐ ✂ at ×¼ is a joke, not an error", () => {
    expect(burstLine({ stars: 15, mult: 3 })).toBe("+15 ⭐ ×3");
    expect(burstLine({ stars: 0, mult: 0.25 })).toBe("+0 ⭐ ×¼");
    expect(burstLine({ stars: 4, mult: null })).toBe("+4 ⭐");
    expect(burstQuip({ stars: 0, mult: 0.25 })).toBe(FILTER_GAME_COPY.quip.none);
    expect(burstQuip({ stars: 15, mult: 3 })).toBe("Clean cut!");
    expect(burstQuip({ stars: 3, mult: 0.25 })).toBe("Scissors on fire.");
    expect(burstQuip({ stars: 2, mult: 1 })).toBe("Getting hot.");
  });

  it("✂'s answer: the score when the server sends it; 'no longer catches it' leaves quietly", () => {
    expect(censorDone({ ok: true, seq: 1, text: "x", points: 5, mult: 2, stars: 10 })).toEqual({ kind: "done", points: 5, mult: 2, stars: 10 });
    expect(censorDone({ ok: true, seq: 1, text: "x" })).toEqual({ kind: "done" });
    expect(censorDone(undefined)).toEqual({ kind: "done" });
    expect(censorRefusal(new ApiError("the filter no longer catches it", 409))).toEqual({ kind: "gone" });
    expect(censorRefusal(new ApiError("already censored", 409))).toEqual({ kind: "gone" });
  });
});

describe("tiers on the line (C13)", () => {
  it("each range keeps its band; overlaps merge (the lower tier wins); touching bands stay apart", () => {
    expect(tierRanges("asshell", [{ start: 0, end: 3, tier: 50 }, { start: 3, end: 7, tier: 60 }])).toEqual([
      { start: 0, end: 3, tier: 50 },
      { start: 3, end: 7, tier: 60 },
    ]);
    expect(tierRanges("asshell", [{ start: 0, end: 3, tier: 60 }, { start: 3, end: 7, tier: 60 }])).toEqual([{ start: 0, end: 7, tier: 60 }]);
    expect(tierRanges("abcdef", [{ start: 0, end: 4, tier: 90 }, { start: 2, end: 6, tier: 25 }])).toEqual([{ start: 0, end: 6, tier: 25 }]);
    expect(tierRanges("abcdef", [{ start: 0, end: 4 }, { start: 2, end: 6, tier: 75 }])).toEqual([{ start: 0, end: 6, tier: 75 }]);
    expect(tierRanges("abc", [{ start: 0, end: 2, tier: Number.NaN }])).toEqual([{ start: 0, end: 2, tier: null }]);
  });

  it("marks carry their tier; a slur (tier 0) is the [slur] chip over its stars", () => {
    const parts = markSegments("you **** fool", [{ start: 4, end: 8, tier: 0 }]);
    expect(parts).toEqual([{ text: "you " }, { text: "****", mark: true, tier: 0, chip: UNSAID_WORD }, { text: " fool" }]);
    expect(markSegments("hello", [{ start: 0, end: 4, tier: 100 }])[0]).toEqual({ text: "hell", mark: true, tier: 100 });
    expect(markSegments("hello", [{ start: 0, end: 4 }])[0]).toEqual({ text: "hell", mark: true });
  });

  it("a clipped line keeps each hit's tier", () => {
    const text = `${"x".repeat(300)} hello`;
    const clip = clipLine(text, [{ start: 301, end: 305, tier: 100 }], 100);
    expect(clip.hits).toHaveLength(1);
    expect(clip.hits[0]!.tier).toBe(100);
    expect(clip.text.slice(clip.hits[0]!.start, clip.hits[0]!.end)).toBe("hell");
  });

  it("the window's line: band classes, the slur's chip in place of its stars", () => {
    expect(renderToStaticMarkup(<MarkedLine text="you **** fool" hits={[{ start: 4, end: 8, tier: 0 }]} />)).toBe('<p class="filter-line"><span>you </span><mark class="filter-hit filter-tier-0 filter-chip">[slur]</mark><span> fool</span></p>');
    expect(renderToStaticMarkup(<MarkedLine text="hello" hits={[{ start: 0, end: 4, tier: 60 }]} />)).toContain('<mark class="filter-hit filter-tier-60">hell</mark>');
  });

  it("the pop-out's quote: band classes and the chip; storage keeps them, never the live parts", () => {
    const openers: BoothOpeners = { act: async () => {}, card: noop, scan: noop, board: noop, door: noop, pick: noop, cue: noop };
    const spec = bindDraft(filterDraft(L(3, { text: "my **** password", hits: [{ start: 3, end: 7, tier: 0 }, { start: 9, end: 12, tier: 90 }] }), 1, null, filterGameNodes(L(3))), openers, noop);
    const html = renderToStaticMarkup(<PopOut entry={{ spec }} api={{ queued: 0, defer: noop, retire: noop } as unknown as PopOutsApi} />);
    expect(html).toContain('<mark class="popout-mark filter-tier-0 popout-chip">[slur]</mark>');
    expect(html).toContain('<mark class="popout-mark filter-tier-90">ass</mark>');
    expect(html).not.toContain("****");
    const deferred = popReducer(popReducer(EMPTY_POPOUTS, { type: "raise", spec }), { type: "defer", key: spec.key, at: 0 });
    const stored = storedOf(deferred);
    expect("extra" in stored.kept[0]!.spec).toBe(false);
    const back = parseStored(JSON.parse(JSON.stringify(stored)));
    expect(back.kept[0]!.spec.quote).toEqual(spec.quote);
  });
});

describe("✂ raises suspicion now (no mark), and nothing points at the dial", () => {
  const openers: BoothOpeners = { act: async () => {}, card: noop, scan: noop, board: noop, door: noop, pick: noop, cue: noop };

  it("the hint, the armed ✂ and the window's foot say it raises their suspicion", () => {
    expect(FILTER_COPY.hint).toBe("✂ Censor stars it out for everyone and raises their suspicion.");
    expect(FILTER_COPY.censorArmed).toBe("✂ Censor? It raises their suspicion.");
    expect(FILTER_COPY.foot).toContain("raises their suspicion");
    for (const t of [FILTER_COPY.hint, FILTER_COPY.foot, FILTER_COPY.censorArmed]) expect(t).not.toMatch(/mark|reinstall/iu);
    const d = filterDraft(L(1), 1);
    expect(d.actions[0]).toMatchObject({ id: "censor", arm: true, armedLabel: "✂ Censor? It raises their suspicion." });
  });

  it("the armed ✂ in the list reads the warning and Tap again to fire", () => {
    const html = renderToStaticMarkup(<FilterRow line={L(1)} now={0} armed busy={false} refusal={null} onCensor={noop} onLetGo={noop} />);
    expect(html).toContain("✂ Censor? It raises their suspicion.");
    expect(html).toContain(ARM_LINE);
  });

  it("the pop-out, the tray and the Mission tile never mention the strength", () => {
    const spec = bindDraft(filterDraft(L(1), 3), openers, noop);
    const html = renderToStaticMarkup(<PopOut entry={{ spec }} api={{ queued: 0, defer: noop, retire: noop } as unknown as PopOutsApi} />);
    const tray = renderToStaticMarkup(<BoothTray view={PV(FV([L(1)]))} onWallet={noop} filter={3} windowed />);
    const tiles = JSON.stringify(boothMissionOf(PV(FV([L(1)])), { list: [], claimer: false, loose: null, filter: 3 }).tiles);
    expect(tiles).toContain("3 to judge");
    for (const t of [html, tray, tiles, FILTER_COPY.hint, FILTER_COPY.foot]) expect(t).not.toMatch(/strength|slider|%/iu);
  });
});

describe("⊞ Start → 🔑 Filter strength, only on the censor's booth", () => {
  const base = { character: "Password Manager", wake, embedded: false, onHelp: noop, onSheet: noop, onSignOut: noop };

  it("the player Start menu: before People, only when given", () => {
    const item = filterStartItem(noop);
    expect(item).toMatchObject({ id: "filter-strength", icon: "🔑", label: "Filter strength" });
    const ids = playerStartItems({ ...base, onPeople: noop, filter: item }).map((i) => i.id);
    expect(ids).toEqual(["help", "alerts", "filter-strength", "people", "signout"]);
    expect(playerStartItems({ ...base, onPeople: noop }).map((i) => i.id)).not.toContain("filter-strength");
    expect(playerStartItems({ ...base, onPeople: noop, filter: null }).map((i) => i.id)).not.toContain("filter-strength");
  });

  it("a staff booth's Start menu too (a censor that is not a player)", () => {
    const ids = boothStartItems({ ...base, admin: false, host: false, knows: 0, filter: filterStartItem(noop) }).map((i) => i.id);
    expect(ids).toContain("filter-strength");
    expect(boothStartItems({ ...base, admin: false, host: false, knows: 0 }).map((i) => i.id)).not.toContain("filter-strength");
  });

  it("the booth builds it from PrimeView.filter alone and opens the strength layer", () => {
    const app = readFileSync(new URL("../src/booth/app.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/const filterItem = filter\.view !== null \? filterStartItem\(\(\) => setLayer\(\{ kind: "strength" \}\)\) : null;/u);
    expect(app.match(/filter: filterItem,/gu)?.length).toBe(2);
    expect(app).toContain('layer?.kind === "strength" && <FilterStrengthWindow');
    expect(closeTo({ kind: "strength" })).toBeNull();
    expect(boothBackStep({ layer: { kind: "strength" }, sheet: null, people: null, help: false })).toBe("layer");
  });
});

/** `useFilter` under the hooks harness, with a view and a strength POST to steer. */
function rig(opts: { view?: PrimeView; filterLevel?: (level: number) => Promise<FilterLevelResult>; censor?: (seq: number) => Promise<CensorResult>; storage?: SessionStorage } = {}) {
  const storage = opts.storage ?? memoryStore();
  let view = opts.view ?? PV(FV([L(1)]));
  const src = (): FilterSource => ({ auth: { token: "tok-48b" }, view, ...(opts.filterLevel !== undefined ? { filterLevel: opts.filterLevel } : {}), ...(opts.censor !== undefined ? { censor: opts.censor } : {}) });
  const h = mountHooks((p: { s: FilterSource; storage: SessionStorage }) => useFilter(p.s, p.storage), { s: src(), storage });
  return {
    get api() {
      return h.output as FilterApi;
    },
    setView(v: PrimeView) {
      view = v;
      h.rerender({ s: src(), storage });
    },
    act(f: () => void) {
      h.act(f);
    },
    settle() {
      h.act(noop);
    },
  };
}

/** A promise to answer by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("useFilter: the strength, optimistic", () => {
  it("shows the pick at once, posts it, and lets the view take over once it says so", async () => {
    const posted: number[] = [];
    const answer = deferred<FilterLevelResult>();
    const r = rig({ filterLevel: (level) => (posted.push(level), answer.promise) });
    expect(r.api.level).toBe(100);
    r.act(() => r.api.setLevel(42));
    expect(posted).toEqual([40]);
    expect(r.api.level).toBe(40);
    expect(r.api.saving).toBe(true);
    answer.resolve({ ok: true, level: 40 });
    await flush();
    r.settle();
    expect(r.api.saving).toBe(false);
    expect(r.api.level).toBe(40);
    r.setView(PV(FV([L(1)], { level: 40 })));
    expect(r.api.level).toBe(40);
    // A story restart is back to 100: the view decides again.
    r.setView(PV(FV([L(1)], { level: 100 })));
    expect(r.api.level).toBe(100);
  });

  it("a refusal rolls the dial back and says why", async () => {
    const r = rig({ filterLevel: async () => Promise.reject(new ApiError("doors are closed", 409)) });
    r.act(() => r.api.setLevel(25));
    expect(r.api.level).toBe(25);
    await flush();
    r.settle();
    expect(r.api.level).toBe(100);
    expect(r.api.levelError).toBe("Not changed: the doors are closed.");
    // The next pick clears it.
    r.act(() => r.api.setLevel(100));
    expect(r.api.levelError).toBeNull();
  });

  it("one POST at a time; picks made meanwhile collapse to the newest; nothing posts for the same strength", async () => {
    const posted: number[] = [];
    const answers: Array<ReturnType<typeof deferred<FilterLevelResult>>> = [];
    const r = rig({
      filterLevel: (level) => {
        posted.push(level);
        const d = deferred<FilterLevelResult>();
        answers.push(d);
        return d.promise;
      },
    });
    r.act(() => r.api.setLevel(100));
    expect(posted).toEqual([]);
    r.act(() => r.api.setLevel(75));
    r.act(() => r.api.setLevel(60));
    r.act(() => r.api.setLevel(50));
    expect(posted).toEqual([75]);
    expect(r.api.level).toBe(50);
    // An old pick's refusal never rolls back a newer one on its way.
    answers[0]!.reject(new ApiError("doors are closed", 409));
    await flush();
    r.settle();
    expect(posted).toEqual([75, 50]);
    expect(r.api.level).toBe(50);
    expect(r.api.levelError).toBeNull();
    answers[1]!.resolve({ ok: true, level: 50 });
    await flush();
    r.settle();
    expect(r.api.level).toBe(50);
    expect(r.api.saving).toBe(false);
  });

  it("a session with no strength call (an old build's fake) rolls back with 'No connection.'", async () => {
    const r = rig();
    r.act(() => r.api.setLevel(10));
    await flush();
    r.settle();
    expect(r.api.level).toBe(100);
    expect(r.api.levelError).toBe("No connection.");
  });
});

describe("useFilter: the heat and the burst", () => {
  it("the game re-bases on every view's combo (its arrival time) and is null without one", () => {
    vi.useFakeTimers({ now: 1_000 });
    const r = rig({ view: PV(FV([L(1)], { combo: COMBO(2) })) });
    expect(r.api.game).toEqual({ combo: COMBO(2), at: 1_000 });
    vi.setSystemTime(6_000);
    r.settle();
    expect(r.api.game?.at).toBe(1_000);
    r.setView(PV(FV([L(1)], { combo: COMBO(1.75) })));
    expect(r.api.game).toEqual({ combo: COMBO(1.75), at: 6_000 });
    const { combo: _c, ...old } = FV([L(1)]);
    r.setView(PV(old as FilterView));
    expect(r.api.game).toBeNull();
    r.setView(PV());
    expect(r.api.game).toBeNull();
  });

  it("a ✂ answered with a score bursts; one without (an older server) does not", async () => {
    let answer: CensorResult = { ok: true, seq: 1, text: "my p***word is ****o", points: 2, mult: 0.25, stars: 0 };
    const r = rig({ view: PV(FV([L(1), L(2), L(3)])), censor: async () => answer });
    expect(await r.api.censor(1)).toEqual({ kind: "done", points: 2, mult: 0.25, stars: 0 });
    r.settle();
    expect(r.api.burst).toMatchObject({ stars: 0, mult: 0.25, points: 2 });
    const first = r.api.burst!.id;
    answer = { ok: true, seq: 2, text: "x", points: 5, mult: 3, stars: 15 };
    await r.api.censor(2);
    r.settle();
    expect(r.api.burst).toMatchObject({ stars: 15, mult: 3 });
    expect(r.api.burst!.id).not.toBe(first);
    r.act(() => r.api.clearBurst());
    expect(r.api.burst).toBeNull();
    answer = { ok: true, seq: 3, text: "x" };
    await r.api.censor(3);
    r.settle();
    expect(r.api.burst).toBeNull();
  });

  it("the driver's key changes when a line's marks or worth change (a held pop-out is re-marked)", () => {
    const r = rig();
    const before = r.api.key;
    r.setView(PV(FV([L(1, { hits: [{ start: 4, end: 7, tier: 90 }], points: 1 })])));
    expect(r.api.key).not.toBe(before);
  });
});

describe("the game, drawn", () => {
  const game = (heat: number, at = 0): FilterGame => ({ combo: COMBO(heat), at });

  it("the meter: the worth, the multiplier now, the bar, when it is back to ×3", () => {
    vi.useFakeTimers({ now: 5_000 });
    const html = renderToStaticMarkup(<FilterMeter points={5} game={game(1.5)} />);
    expect(html).toContain('class="filter-meter notch-2"');
    expect(html).toContain('<span class="filter-worth" title="Worth 5 before the multiplier">⭐ 5</span>');
    // 5 s after a view at heat 1.5: heat 1.25, notch 2 (×1½), rested in 25 s.
    expect(html).toContain('<span class="filter-mult">×1½</span>');
    expect(html).toContain("×3 in 25 s");
    expect(html).toContain("scaleX(0.750)");
    const rested = renderToStaticMarkup(<FilterMeter game={game(0)} />);
    expect(rested).toContain(">×3<");
    expect(rested).toContain("rested");
    expect(rested).toContain("scaleX(1.000)");
    expect(renderToStaticMarkup(<FilterMeter game={null} />)).toBe("");
  });

  it("✂'s pay now: floor(points × mult); nothing without a game or a worth", () => {
    vi.useFakeTimers({ now: 0 });
    expect(renderToStaticMarkup(<FilterPay points={5} game={game(0)} />)).toBe('<span class="filter-pay">+15 ⭐</span>');
    expect(renderToStaticMarkup(<FilterPay points={1} game={game(9)} />)).toBe('<span class="filter-pay">+0 ⭐</span>');
    expect(renderToStaticMarkup(<FilterPay points={undefined} game={game(0)} />)).toBe("");
    expect(renderToStaticMarkup(<FilterPay points={5} game={null} />)).toBe("");
  });

  it("the clock ticks only while warm: one timeout at a time, none once rested", () => {
    vi.useFakeTimers({ now: 0 });
    const h = mountHooks((p: { g: FilterGame | null; tick: number | null }) => useGameClock(p.g, p.tick), { g: game(1), tick: 500 });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);
    h.act(noop);
    expect(h.output).toBe(500);
    // A pay label waits for the next notch (the heat reaches 0 at 20 s).
    h.rerender({ g: game(1), tick: null });
    expect(vi.getTimerCount()).toBe(1);
    vi.setSystemTime(25_000);
    h.rerender({ g: game(1), tick: 500 });
    expect(vi.getTimerCount()).toBe(0);
    h.rerender({ g: null, tick: 500 });
    expect(vi.getTimerCount()).toBe(0);
    h.unmount();
  });

  it("the burst: its line and quip, a light buzz, gone after FILTER_BURST_MS", () => {
    vi.useFakeTimers({ now: 0 });
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    let done = 0;
    const burst = { id: 1, stars: 0, mult: 0.25, points: 1 };
    const html = renderToStaticMarkup(<FilterBurst burst={burst} onDone={noop} />);
    expect(html).toContain('<div class="filter-burst zero">');
    expect(html).toContain("+0 ⭐ ×¼");
    expect(html).toContain(FILTER_GAME_COPY.quip.none);
    expect(renderToStaticMarkup(<FilterBurst burst={null} onDone={noop} />)).toBe('<div class="filter-burst-host" aria-live="polite"></div>');
    const h = mountHooks(FilterBurst, { burst, onDone: () => void (done += 1) });
    expect(vibrate).toHaveBeenCalledWith([12, 60, 12]);
    vi.advanceTimersByTime(FILTER_BURST_MS - 1);
    expect(done).toBe(0);
    vi.advanceTimersByTime(1);
    expect(done).toBe(1);
    h.rerender({ burst: { id: 2, stars: 6, mult: 3, points: 2 }, onDone: () => void (done += 1) });
    expect(vibrate).toHaveBeenLastCalledWith(25);
    h.unmount();
    vi.advanceTimersByTime(FILTER_BURST_MS);
    expect(done).toBe(1);
  });
});

describe("the list window, played", () => {
  const lines = [L(1, { name: "Napster", points: 5 }), L(2, { name: "Winamp", points: 1 })];
  const api = (over: Partial<FilterApi> = {}): FilterApi =>
    ({ view: FV(lines, { flagged: 4, censored: 1, stars: 41, muted: 2 }), waiting: lines, censor: async () => ({ kind: "done" }), letGo: noop, refusal: () => null, game: { combo: COMBO(1), at: 0 }, ...over }) as FilterApi;

  it("the header gains ⭐ tonight, the meter and the muted note; each line its worth and its ✂'s pay now", () => {
    vi.useFakeTimers({ now: 0 });
    const html = renderToStaticMarkup(<FilterWindow api={api()} now={0} onClose={noop} />);
    expect(html).toContain("Censored 1 of 4 flagged words");
    expect(html).toContain('<span class="filter-stars">⭐ 41 tonight</span>');
    expect(html).toContain('<span class="filter-mult">×2</span>');
    expect(html).toContain('<p class="filter-muted">2 waiting lines hidden at this strength</p>');
    expect(html).toContain("⭐ 5</span>");
    expect(html).toContain('<span class="filter-pay">+10 ⭐</span>');
    expect(html).toContain('<span class="filter-pay">+2 ⭐</span>');
  });

  it("an older server (no combo, stars, muted or points): the window as wave 48 drew it", () => {
    const old = [L(1, { points: undefined })];
    const html = renderToStaticMarkup(<FilterWindow api={api({ view: { flagged: 2, censored: 0, lines: old }, waiting: old, game: null })} now={0} onClose={noop} />);
    expect(html).not.toContain("filter-stars");
    expect(html).not.toContain("filter-meter");
    expect(html).not.toContain("filter-muted");
    expect(html).not.toContain("filter-pay");
    expect(html).not.toContain("filter-worth");
  });
});

describe("the strength window", () => {
  const strength = (over: Partial<FilterApi> = {}) => ({ level: 100, saving: false, levelError: null, setLevel: noop, ...over }) as FilterApi;

  it("the big %, what it catches, the slider (step 5), ◀ ▶ at the ends, the legend in the bands' colours", () => {
    const html = renderToStaticMarkup(<FilterStrengthWindow api={strength({ level: 40 })} onClose={noop} />);
    expect(html).toContain("Filter strength");
    expect(html).toContain(">40%<");
    expect(html).toContain('<p class="filter-level-now filter-tier-25">+ shit, asshole, bitch…</p>');
    expect(html).toMatch(/<input type="range" class="filter-level-range" min="0" max="100" step="5" [^>]*value="40"/u);
    expect(html).toContain('aria-valuetext="40%: + shit, asshole, bitch…"');
    expect(html).toContain(FILTER_LEVEL_COPY.foot);
    const zero = renderToStaticMarkup(<FilterStrengthWindow api={strength({ level: 0 })} onClose={noop} />);
    expect(zero).toContain("Slurs only");
    expect(zero).toMatch(/<button type="button" class="w95-btn filter-level-step" disabled="">◀ Less/u);
    expect(renderToStaticMarkup(<FilterStrengthWindow api={strength({ level: 100 })} onClose={noop} />)).toMatch(/disabled="">More ▶/u);
  });

  it("the legend: every band, on up to this strength, with its ⭐ a word; the slur row names none", () => {
    const html = renderToStaticMarkup(<FilterLegend level={55} />);
    expect(html.match(/filter-legend-row on/gu)?.length).toBe(4);
    expect(html.match(/· off/gu)?.length).toBe(4);
    expect(html).toContain('<span class="filter-swatch filter-tier-0" aria-hidden="true">[slur]</span>');
    expect(html).toContain("Slurs (never shown)");
    expect(html).toContain("12 ⭐");
    for (const b of FILTER_BANDS) expect(html).toContain(`filter-tier-${b.tier}`);
  });

  it("posts on release, not on every move; ◀ ▶ post a band at once", () => {
    const set: number[] = [];
    const h = mountHooks(FilterStrengthWindow, { api: strength({ setLevel: (n) => void set.push(n) }), onClose: noop });
    const range = () => elements(h.output).find((e) => e.type === "input") as ReactElement<{ value: number; onChange: (e: unknown) => void; onPointerUp: () => void; onTouchEnd: () => void; onBlur: () => void }>;
    const ev = (v: number) => ({ currentTarget: { value: String(v) } });
    h.act(() => range().props.onChange(ev(85)));
    h.act(() => range().props.onChange(ev(62)));
    expect(set).toEqual([]);
    expect(range().props.value).toBe(60);
    h.act(() => {
      range().props.onPointerUp();
      range().props.onTouchEnd();
      range().props.onBlur();
    });
    expect(set).toEqual([60]);
    const steps = () => elements(h.output).filter((e) => e.type === "button") as Array<ReactElement<{ onClick: () => void }>>;
    h.act(() => steps()[0]!.props.onClick());
    expect(set).toEqual([60, 90]);
    h.act(() => steps()[1]!.props.onClick());
    expect(set).toEqual([60, 90, 100]);
  });

  it("the status line: Saving…, or the refusal and where the dial stays", () => {
    expect(renderToStaticMarkup(<FilterStrengthWindow api={strength({ saving: true })} onClose={noop} />)).toContain("Saving…");
    const html = renderToStaticMarkup(<FilterStrengthWindow api={strength({ levelError: "Not changed: the doors are closed." })} onClose={noop} />);
    expect(html).toContain("Not changed: the doors are closed. Still 100%.");
    expect(html).toContain("filter-level-refused");
  });
});

describe("the palette and the copy", () => {
  const css = readBundledCss();

  it("one token and one class per band; the burst calms down under reduced motion", () => {
    for (const b of FILTER_BANDS) {
      expect(css, `--filter-tier-${b.tier}`).toMatch(new RegExp(`--filter-tier-${b.tier}: #[0-9a-f]{6};`, "u"));
      expect(css).toContain(`.filter-tier-${b.tier} { background: var(--filter-tier-${b.tier});`);
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.filter-burst \{ animation: filter-burst-fade/u);
    expect(css).toContain(".filter-level-range { display: block; width: 100%; height: var(--tap);");
    expect(css).toContain(".filter-level-step { min-height: var(--tap);");
  });

  it("the new copy is marked DRAFT w48b where it lives", () => {
    for (const f of ["model.ts", "game.tsx", "strength.tsx", "window.tsx"]) expect(readFileSync(new URL(`../src/booth/filter/${f}`, import.meta.url), "utf8"), f).toContain("DRAFT w48b");
  });

  it("never a slur in the filter's code: the slur band is [slur] everywhere", () => {
    expect(UNSAID_WORD).toBe("[slur]");
    expect(FILTER_BANDS[0]!.catches).toBe("Slurs only");
  });
});
