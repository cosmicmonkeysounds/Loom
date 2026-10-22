import { describe, expect, it } from "vitest";
import { HISTORY_T, frameDue, sceneT, serverNow } from "../src/cutscene/clock.ts";
import { FACE_FLASH_MS, MOMENT_HOLD_MAX_MS, MOMENT_STALE_MS, MomentQueue, NO_PICK, QUEUE_MAX, QUEUE_WAIT_MAX_MS, allowed, componentFor, drawsCountdown, faceFlashFor, introduced, nameMatches, pickScene, sceneForMoment, sceneForSlide, type ScenePick } from "../src/cutscene/pick.ts";
import type { SceneDef } from "../src/cutscene/types.ts";
import { EMPTY_NIGHT, type ScreenMoment, type ScreenState } from "../src/screen.ts";

const T0 = 5_000_000;
const C = () => null; // a component (never rendered here)
const def = (over: Partial<SceneDef> & Pick<SceneDef, "id" | "when">): SceneDef => ({ ms: 10_000, tv: C, wall: C, ...over });

const BINGO = def({ id: "bingo", when: [{ slide: "bingo" }], ms: "hold" });
const TRIVIA = def({ id: "trivia", when: [{ slide: "Trivia 1" }], ms: 8_000 });
const AWARD = def({ id: "award", when: [{ slide: "award_*" }], ms: "hold", tv: C, wall: undefined });
const INTRO = def({ id: "intro", when: [{ moment: "beat", name: "trabolta introduction" }], ms: 20_000, namesCharacter: true, priority: 5 });
const BOTTLE = def({ id: "bottle", when: [{ moment: "signal", name: "bottle landed" }], ms: 6_000 });
const ZIP = def({ id: "zip", when: [{ moment: "sfx", name: "zip" }], ms: 3_000, over: true });
const BIG = def({ id: "big", when: [{ slide: "y2k" }], ms: "hold", priority: 9 });
const HOLDM = def({ id: "holdm", when: [{ moment: "signal", name: "forever" }], ms: "hold" });
const SCENES = [BINGO, TRIVIA, AWARD, INTRO, BOTTLE, ZIP, BIG, HOLDM];

const m = (seq: number, at: number, kind: ScreenMoment["kind"], name: string, who: string | null = null): ScreenMoment => ({ seq, at, kind, name, who, kept: false });

function state(over: Partial<ScreenState> = {}): ScreenState {
  return {
    now: T0,
    receivedAt: T0,
    night: EMPTY_NIGHT,
    moments: [],
    cues: {},
    character: { id: "Trabolta", hidden: false, awake: true, online: true, hold: false },
    attract: false,
    countdown: null,
    remaining: null,
    chart: null,
    target: "tv",
    program: { slide: null, overlay: null, blackout: null, flicker: null },
    voice: null,
    room: null,
    announce: null,
    announces: [],
    identify: false,
    identifyLeft: null,
    announceEpoch: "e1",
    king: null,
    reinstalling: 0,
    ...over,
  };
}
const slide = (value: string, at: number, seq = 1) => ({ value, cue: `screens_${value}`, seq, at });

function pick(s: ScreenState, now: number, q: MomentQueue, layers: { overlay?: "alarm" | "blackout" | null; slide?: ReturnType<typeof slide> | null } = {}, bare = false, target: "tv" | "wall" = "tv"): ScenePick {
  return pickScene({ state: s, now, layers: { overlay: layers.overlay ?? null, slide: layers.slide ?? null }, bare, target, scenes: SCENES, queue: q });
}
const idOf = (p: ScenePick["base"] | ScenePick["top"]) => (p === null ? null : p === "card" ? "card" : p.def.id);

describe("the clock", () => {
  it("reads the server's clock off the answer", () => {
    expect(serverNow({ now: 1000, receivedAt: 50 }, 80)).toBe(1030);
    expect(serverNow({ now: 1000, receivedAt: 50 }, 20)).toBe(1000); // never behind the answer
    expect(serverNow(null, 77)).toBe(77);
    expect(serverNow({ now: 0, receivedAt: 5 }, 9)).toBe(9); // an older server with no clock
  });
  it("a scene's t is from its start, never negative; history is its hold state", () => {
    expect(sceneT(1000, 3500)).toBe(2500);
    expect(sceneT(1000, 900)).toBe(0);
    expect(sceneT(0, 5000)).toBe(HISTORY_T);
  });
  it("caps the frame rate (a 60 Hz display draws every other frame at 30)", () => {
    expect(frameDue(0, 16.7, 30)).toBe(false);
    expect(frameDue(0, 33.4, 30)).toBe(true);
    expect(frameDue(0, 31.5, 30)).toBe(true); // the 2 ms slack
    expect(frameDue(0, 38, 24)).toBe(false);
  });
});

describe("matching", () => {
  it("folds names and takes a trailing * as a prefix", () => {
    expect(nameMatches("Trivia 1", "trivia_1")).toBe(true);
    expect(nameMatches("bottle-landed", "Bottle Landed")).toBe(true);
    expect(nameMatches("award_*", "award_best_liar")).toBe(true);
    expect(nameMatches("award_*", "ceremony")).toBe(false);
    expect(nameMatches("bingo", "bingo_time")).toBe(false);
  });
  it("finds a scene by slide or moment, for the target that has something to draw", () => {
    expect(sceneForSlide(SCENES, "trivia_1", "tv")?.id).toBe("trivia");
    expect(sceneForSlide(SCENES, "award_most_trusted", "tv")?.id).toBe("award");
    expect(sceneForSlide(SCENES, "award_most_trusted", "wall")).toBeNull(); // no wall take: the card
    expect(sceneForMoment(SCENES, m(1, T0, "signal", "Bottle Landed"), "wall")?.id).toBe("bottle");
    expect(sceneForMoment(SCENES, m(1, T0, "beat", "bottle landed"), "tv")).toBeNull(); // the kind matters
    const wallOnly = def({ id: "w", when: [], tv: undefined });
    expect(componentFor(wallOnly, "tv")).toBe(C); // the TV falls back to the wall's
    expect(componentFor(def({ id: "t", when: [], wall: undefined }), "wall")).toBeNull();
  });
  it("gates a scene that names the character until the introduction", () => {
    expect(introduced(null)).toBe(false);
    expect(introduced(state({ character: null }))).toBe(false);
    expect(introduced(state({ character: { id: "Trabolta", hidden: true, awake: false, online: false, hold: false } }))).toBe(false);
    expect(introduced(state())).toBe(true);
    expect(allowed(INTRO, null)).toBe(false);
    expect(allowed(BOTTLE, null)).toBe(true);
  });
});

describe("the slide's scene", () => {
  it("plays the scene for a slide, then its card once the scene's ms is up", () => {
    const q = new MomentQueue();
    const s = state();
    const p = pick(s, T0 + 2000, q, { slide: slide("trivia_1", T0, 4) });
    expect(idOf(p.base)).toBe("trivia");
    expect(p.base).toMatchObject({ kind: "slide", seq: 4, at: T0, start: T0, value: "trivia_1", key: "trivia:s4" });
    expect(idOf(pick(s, T0 + 8000, q, { slide: slide("trivia_1", T0, 4) }).base)).toBe("card");
    // A repeat of the cue is a new seq: a new scene from its own at.
    expect(pick(s, T0 + 9000, q, { slide: slide("trivia_1", T0 + 8500, 5) }).base).toMatchObject({ key: "trivia:s5", start: T0 + 8500 });
  });

  it("a slide no scene names keeps its card; no slide, nothing", () => {
    const q = new MomentQueue();
    expect(pick(state(), T0, q, { slide: slide("beans", T0) })).toEqual({ base: "card", top: null, under: null });
    expect(pick(state(), T0, q)).toEqual(NO_PICK);
  });

  it("a held scene stays for the whole hold; from history it is drawn in its hold state", () => {
    const q = new MomentQueue();
    expect(idOf(pick(state(), T0 + 3_600_000, q, { slide: slide("bingo", T0) }).base)).toBe("bingo");
    const hist = pick(state(), T0, q, { slide: slide("bingo", 0) }).base;
    expect(hist).toMatchObject({ def: { id: "bingo" }, start: T0 - HISTORY_T });
    // A timed scene from history is over: the card.
    expect(idOf(pick(state(), T0, q, { slide: slide("trivia_1", 0) }).base)).toBe("card");
  });

  it("a held scene from history moves on from HISTORY_T, once per seq", () => {
    const q = new MomentQueue();
    const seen = new Map<number, number>();
    const at = (now: number, seq = 2) => pickScene({ state: state(), now, layers: { overlay: null, slide: slide("bingo", 0, seq) }, bare: false, target: "tv", scenes: SCENES, queue: q, historyStarts: seen }).base;
    const first = at(T0);
    const later = at(T0 + 4321);
    expect(first).toMatchObject({ start: T0 - HISTORY_T });
    expect(later).toMatchObject({ start: T0 - HISTORY_T }); // the same start: t advances
    const tOf = (b: ScenePick["base"], now: number) => (b !== null && b !== "card" ? now - b.start : NaN);
    expect(tOf(later, T0 + 4321) - tOf(first, T0)).toBe(4321);
    expect(tOf(first, T0)).toBe(HISTORY_T);
    // Another history slide (a new seq) starts from its own first sight.
    expect(at(T0 + 9000, 3)).toMatchObject({ start: T0 + 9000 - HISTORY_T });
  });

  it("a namesCharacter scene before the introduction gives way to a fiction-safe one on the same trigger", () => {
    const hidden = state({ character: { id: "Trabolta", hidden: true, awake: false, online: false, hold: false } });
    const named = def({ id: "named", when: [{ slide: "overshare" }], ms: "hold", namesCharacter: true });
    const safe = def({ id: "safe", when: [{ slide: "overshare" }], ms: "hold" });
    expect(sceneForSlide([named, safe], "overshare", "tv", hidden)?.id).toBe("safe");
    expect(sceneForSlide([named, safe], "overshare", "tv", state())?.id).toBe("named");
    expect(sceneForSlide([named, safe], "overshare", "tv")?.id).toBe("named"); // no state, no gate
    const p = pickScene({ state: hidden, now: T0, layers: { overlay: null, slide: slide("overshare", T0) }, bare: false, target: "tv", scenes: [named, safe], queue: new MomentQueue() });
    expect(p.base).toMatchObject({ def: { id: "safe" } });
    // A moment too: the safe take plays instead of the moment being dropped.
    const mNamed = def({ id: "mnamed", when: [{ moment: "signal", name: "found" }], ms: 5000, namesCharacter: true });
    const mSafe = def({ id: "msafe", when: [{ moment: "signal", name: "found" }], ms: 5000 });
    const s = state({ character: hidden.character, moments: [m(1, T0, "signal", "found")] });
    expect(sceneForMoment([mNamed, mSafe], s.moments[0]!, "tv", s)?.id).toBe("msafe");
    const q = new MomentQueue();
    q.update(s, T0 + 10, [mNamed, mSafe], "tv");
    expect(pickScene({ state: s, now: T0 + 10, layers: { overlay: null, slide: null }, bare: false, target: "tv", scenes: [mNamed, mSafe], queue: q }).top?.def.id).toBe("msafe");
  });

  it("a scene's own gate reads the night: a moment it refuses is never queued", () => {
    const hit = def({ id: "hit", when: [{ moment: "signal", name: "king hit" }], ms: 5000, gate: (n) => n.ended !== true });
    const over = state({ night: { ...EMPTY_NIGHT, ended: true }, moments: [m(1, T0, "signal", "king hit")] });
    expect(allowed(hit, state())).toBe(true);
    expect(allowed(hit, over)).toBe(false);
    expect(allowed(hit, { character: over.character })).toBe(true); // no night, no gate
    const q = new MomentQueue();
    q.update(over, T0 + 10, [hit], "tv");
    expect(q.pending).toBe(0);
    const live = state({ moments: [m(2, T0 + 20, "signal", "king hit")] });
    q.update(live, T0 + 30, [hit], "tv");
    expect(q.current(T0 + 30)?.def.id).toBe("hit");
  });

  it("a scene that ended itself early gives way to the card", () => {
    const q = new MomentQueue();
    const p = pickScene({ state: state(), now: T0 + 1000, layers: { overlay: null, slide: slide("bingo", T0, 3) }, bare: false, target: "tv", scenes: SCENES, queue: q, slideDone: (seq) => seq === 3 });
    expect(p.base).toBe("card");
  });

  it("a slide scene that names the character shows its card before the introduction", () => {
    const named = def({ id: "named", when: [{ slide: "overshare" }], ms: "hold", namesCharacter: true });
    const hidden = state({ character: { id: "Trabolta", hidden: true, awake: false, online: false, hold: false } });
    const p = pickScene({ state: hidden, now: T0, layers: { overlay: null, slide: slide("overshare", T0) }, bare: false, target: "tv", scenes: [named], queue: new MomentQueue() });
    expect(p.base).toBe("card");
  });
});

describe("moments", () => {
  it("plays a fresh moment from its own at, then lets go", () => {
    const q = new MomentQueue();
    const s = state({ moments: [m(7, T0, "signal", "bottle landed", "Winamp")] });
    q.update(s, T0 + 1500, SCENES, "tv");
    const p = pick(s, T0 + 1500, q);
    expect(p.top).toMatchObject({ kind: "moment", seq: 7, start: T0, who: "Winamp", value: "bottle landed", key: "bottle:m7" });
    expect(pick(s, T0 + 5999, q).top).not.toBeNull();
    expect(pick(s, T0 + 6000, q).top).toBeNull();
    q.update(s, T0 + 8000, SCENES, "tv"); // the same answer again: never twice
    expect(pick(s, T0 + 8000, q).top).toBeNull();
  });

  it("skips a moment older than 30 s when first seen", () => {
    const q = new MomentQueue();
    const s = state({ moments: [m(1, T0, "beat", "Trabolta Introduction")] });
    q.update(s, T0 + MOMENT_STALE_MS + 1, SCENES, "tv");
    expect(pick(s, T0 + MOMENT_STALE_MS + 1, q).top).toBeNull();
    expect(q.pending).toBe(0);
  });

  it("a reload 35 s into a 45 s scene resumes it; an answer after the first still skips a moment first seen 35 s late (X4)", () => {
    const DANCE = def({ id: "dance", when: [{ moment: "beat", name: "Trabolta Disabled" }], ms: 45_000 });
    const fresh = new MomentQueue();
    const s = state({ moments: [m(4, T0, "beat", "Trabolta Disabled")] });
    fresh.update(s, T0 + 35_000, [DANCE], "tv");
    expect(pickScene({ state: s, now: T0 + 35_000, layers: { overlay: null, slide: null }, bare: false, target: "tv", scenes: [DANCE], queue: fresh }).top).toMatchObject({ def: { id: "dance" }, start: T0 });
    const late = new MomentQueue();
    late.update(state({ moments: [] }), T0 + 1000, [DANCE], "tv"); // an earlier answer: no longer fresh
    late.update(s, T0 + 35_000, [DANCE], "tv");
    expect(late.pending).toBe(0);
    // A hold moment on a reload: no older than the queue's own hold cap.
    const hold = new MomentQueue();
    hold.update(state({ moments: [m(5, T0, "signal", "forever")] }), T0 + MOMENT_HOLD_MAX_MS + 1, SCENES, "tv");
    expect(hold.pending).toBe(0);
  });

  it("a higher-priority moment that has happened cuts the one playing short (livetv-4)", () => {
    const MAJ = def({ id: "maj", when: [{ moment: "beat", name: "Majority Reached" }], ms: 9_000, over: true });
    const MID = def({ id: "mid", when: [{ moment: "beat", name: "Clock Strikes" }], ms: 20_000, priority: 3 });
    const scenes = [MAJ, MID];
    const q = new MomentQueue();
    let s = state({ moments: [m(1, T0, "beat", "Majority Reached")] });
    q.update(s, T0 + 100, scenes, "tv");
    const at = (now: number) => pickScene({ state: s, now, layers: { overlay: null, slide: null }, bare: false, target: "tv", scenes, queue: q }).top;
    expect(at(T0 + 100)?.def.id).toBe("maj");
    s = state({ moments: [m(1, T0, "beat", "Majority Reached"), m(2, T0 + 8000, "beat", "Clock Strikes")] });
    q.update(s, T0 + 8100, scenes, "tv");
    expect(at(T0 + 8100)).toMatchObject({ def: { id: "mid" }, start: T0 + 8000 });
    // An equal or lower priority still waits its turn.
    const q2 = new MomentQueue();
    const s2 = state({ moments: [m(1, T0, "signal", "bottle landed"), m(2, T0 + 1000, "sfx", "zip")] });
    q2.update(s2, T0 + 1100, SCENES, "tv");
    expect(pick(s2, T0 + 1100, q2).top?.def.id).toBe("bottle");
  });

  it("a reload mid-scene resumes on the right frame (the first answer is not skipped)", () => {
    const q = new MomentQueue();
    const s = state({ moments: [m(3, T0, "beat", "Trabolta Introduction")] });
    q.update(s, T0 + 12_000, SCENES, "tv");
    expect(pick(s, T0 + 12_000, q).top).toMatchObject({ def: { id: "intro" }, start: T0 });
    // One already over by its own clock is not replayed.
    const q2 = new MomentQueue();
    const s2 = state({ moments: [m(3, T0, "signal", "bottle landed")] });
    q2.update(s2, T0 + 7000, SCENES, "tv");
    expect(q2.pending).toBe(0);
  });

  it("one at a time: the next starts when the last ends, the highest priority first", () => {
    const q = new MomentQueue();
    const s = state({ moments: [m(1, T0, "signal", "bottle landed"), m(2, T0 + 100, "sfx", "zip"), m(3, T0 + 200, "beat", "Trabolta Introduction")] });
    q.update(s, T0 + 300, SCENES, "tv");
    // The bottle was already playing when the others came? No: all three arrive together — the introduction (priority 5) goes first.
    expect(pick(s, T0 + 300, q).top).toMatchObject({ def: { id: "intro" }, start: T0 + 200 });
    expect(q.pending).toBe(2);
    // The introduction ends at +20.2 s; the bottle (seq 1, priority 0 = zip's) is next, by seq.
    expect(pick(s, T0 + 20_300, q).top).toMatchObject({ def: { id: "bottle" }, start: T0 + 20_200 });
    expect(pick(s, T0 + 26_300, q).top).toMatchObject({ def: { id: "zip" }, start: T0 + 26_200 });
    expect(pick(s, T0 + 29_300, q).top).toBeNull();
  });

  it("a moment arriving while another plays waits its turn", () => {
    const q = new MomentQueue();
    let s = state({ moments: [m(1, T0, "signal", "bottle landed")] });
    q.update(s, T0 + 100, SCENES, "tv");
    expect(pick(s, T0 + 100, q).top?.def.id).toBe("bottle");
    s = state({ moments: [m(1, T0, "signal", "bottle landed"), m(2, T0 + 2000, "sfx", "zip")] });
    q.update(s, T0 + 2100, SCENES, "tv");
    expect(pick(s, T0 + 2100, q).top?.def.id).toBe("bottle");
    expect(pick(s, T0 + 6100, q).top).toMatchObject({ def: { id: "zip" }, start: T0 + 6000 });
  });

  it("drops a queued moment whose turn comes too late, and caps the queue", () => {
    const q = new MomentQueue();
    const longest = def({ id: "long", when: [{ moment: "signal", name: "long" }], ms: QUEUE_WAIT_MAX_MS + 5000 });
    const scenes = [longest, BOTTLE];
    const s = state({ moments: [m(1, T0, "signal", "long"), m(2, T0 + 10, "signal", "bottle landed")] });
    q.update(s, T0 + 20, scenes, "tv");
    expect(pickScene({ state: s, now: T0 + 20, layers: { overlay: null, slide: null }, bare: false, target: "tv", scenes, queue: q }).top?.def.id).toBe("long");
    const after = T0 + QUEUE_WAIT_MAX_MS + 5001;
    expect(pickScene({ state: s, now: after, layers: { overlay: null, slide: null }, bare: false, target: "tv", scenes, queue: q }).top).toBeNull();
    const many = new MomentQueue();
    const lots = state({ moments: Array.from({ length: 12 }, (_, i) => m(i + 1, T0 + i, "sfx", "zip")) });
    many.update(lots, T0 + 20, SCENES, "tv");
    expect(many.pending).toBe(QUEUE_MAX);
  });

  it("a hold moment lasts until done(), at most the cap", () => {
    const q = new MomentQueue();
    const s = state({ moments: [m(1, T0, "signal", "forever"), m(2, T0 + 1, "sfx", "zip")] });
    q.update(s, T0 + 10, SCENES, "tv");
    expect(pick(s, T0 + 30_000, q).top?.def.id).toBe("holdm");
    q.done(1);
    expect(pick(s, T0 + 30_001, q).top).toMatchObject({ def: { id: "zip" }, start: T0 + 30_001 });
    const q2 = new MomentQueue();
    q2.update(state({ moments: [m(1, T0, "signal", "forever")] }), T0, SCENES, "tv");
    expect(pick(s, T0 + MOMENT_HOLD_MAX_MS - 1, q2).top).not.toBeNull();
    expect(pick(s, T0 + MOMENT_HOLD_MAX_MS, q2).top).toBeNull();
  });

  it("a moment that names the character is skipped before the introduction", () => {
    const q = new MomentQueue();
    const s = state({ character: { id: "Trabolta", hidden: true, awake: false, online: false, hold: false }, moments: [m(1, T0, "beat", "Trabolta Introduction"), m(2, T0, "signal", "bottle landed")] });
    q.update(s, T0 + 10, SCENES, "tv");
    expect(pick(s, T0 + 10, q).top?.def.id).toBe("bottle");
    expect(q.pending).toBe(0);
  });

  it("a wall terminal plays only moments with a wall take", () => {
    const q = new MomentQueue();
    const tvOnly = def({ id: "tvonly", when: [{ moment: "signal", name: "tv thing" }], wall: undefined });
    const s = state({ moments: [m(1, T0, "signal", "tv thing")] });
    q.update(s, T0, [tvOnly], "wall");
    expect(q.pending).toBe(0);
  });

  it("resyncs on a story restart: the old sim's queue goes, the new sim's fresh moments play", () => {
    const q = new MomentQueue();
    let s = state({ moments: [m(40, T0, "signal", "bottle landed")] });
    q.update(s, T0 + 10, SCENES, "tv");
    expect(pick(s, T0 + 10, q).top?.seq).toBe(40);
    // The restarted sim numbers from 1 again, under a new epoch.
    s = state({ announceEpoch: "e2", moments: [m(2, T0 + 1000, "sfx", "zip")] });
    q.update(s, T0 + 1100, SCENES, "tv");
    expect(pick(s, T0 + 1100, q).top).toMatchObject({ seq: 2, def: { id: "zip" }, start: T0 + 1000 });
    // An older server (no epoch) whose seqs fell back below the cursor: the same resync.
    const old = new MomentQueue();
    old.update(state({ announceEpoch: null, moments: [m(50, T0, "sfx", "zip")] }), T0 + 10, SCENES, "tv");
    old.update(state({ announceEpoch: null, moments: [m(3, T0 + 4000, "signal", "bottle landed")] }), T0 + 4100, SCENES, "tv");
    expect(pick(state(), T0 + 4100, old).top).toMatchObject({ seq: 3 });
  });
});

describe("precedence", () => {
  const withBottle = () => {
    const q = new MomentQueue();
    const s = state({ moments: [m(1, T0, "signal", "bottle landed")] });
    q.update(s, T0, SCENES, "tv");
    return { q, s };
  };

  it("an overlay beats every scene (and the queue keeps its clock)", () => {
    const { q, s } = withBottle();
    expect(pick(s, T0 + 1000, q, { overlay: "alarm", slide: slide("bingo", T0) })).toEqual(NO_PICK);
    expect(pick(s, T0 + 7000, q)).toEqual(NO_PICK); // its 6 s ran out under the alarm
  });

  it("a pilot, a peek or a room terminal shows no scene", () => {
    const { q, s } = withBottle();
    expect(pick(s, T0 + 1000, q, { slide: null }, true)).toEqual(NO_PICK);
  });

  it("a moment takes the slide's place; an `over` moment draws over it", () => {
    const { q, s } = withBottle();
    expect(pick(s, T0 + 1000, q, { slide: slide("bingo", T0) })).toMatchObject({ base: null, top: { def: { id: "bottle" } }, under: { def: { id: "bingo" } } });
    // A slide with no scene: its card waits under the moment (kept mounted, hidden).
    const { q: q3, s: s3 } = withBottle();
    expect(pick(s3, T0 + 1000, q3, { slide: slide("beans", T0) })).toMatchObject({ base: null, under: "card" });
    const q2 = new MomentQueue();
    const s2 = state({ moments: [m(1, T0, "sfx", "zip")] });
    q2.update(s2, T0, SCENES, "tv");
    const p = pick(s2, T0 + 500, q2, { slide: slide("bingo", T0) });
    expect(idOf(p.base)).toBe("bingo");
    expect(idOf(p.top)).toBe("zip");
    expect(idOf(pick(s2, T0 + 500, new MomentQueue(), { slide: slide("beans", T0) }).base)).toBe("card");
  });

  it("a slide scene with the higher priority keeps the screen; the moment runs out under it", () => {
    const { q, s } = withBottle();
    expect(pick(s, T0 + 1000, q, { slide: slide("y2k", T0) })).toMatchObject({ base: { def: { id: "big" } }, top: null });
  });

  it("the face flash has a default", () => {
    expect(FACE_FLASH_MS).toBeGreaterThan(1000);
  });
});

describe("the face flash", () => {
  it("flashes once per scene, never again when a held slide scene leads again after a moment", () => {
    const y2k = def({ id: "y2k", when: [{ slide: "y2k" }], ms: "hold", face: "alarmed" });
    const zip = def({ id: "zip", when: [{ moment: "sfx", name: "zip" }], ms: 3000, face: "pleased", faceMs: 900 });
    const lead = (d: SceneDef, key: string) => ({ kind: "slide" as const, def: d, seq: 1, at: T0, start: T0, value: "", who: null, key });
    const seen = new Set<string>();
    expect(faceFlashFor(lead(y2k, "y2k:s1"), "tv", seen)).toEqual({ mood: y2k.face, ms: FACE_FLASH_MS });
    expect(faceFlashFor(lead(zip, "zip:m2"), "tv", seen)).toEqual({ mood: zip.face, ms: 900 });
    expect(faceFlashFor(lead(y2k, "y2k:s1"), "tv", seen)).toBeNull(); // the slide leads again
    expect(faceFlashFor(null, "tv", seen)).toBeNull();
    expect(faceFlashFor(lead(y2k, "y2k:s9"), "wall", seen)).toBeNull(); // only the TV has a face
  });

  it("a scene's faceWhen keeps the flash off on a night it doesn't fit (the results slide's filing window)", () => {
    const results = def({ id: "results", when: [{ slide: "hunt_results" }], ms: "hold", face: "thinking", faceWhen: (n) => n.results_q !== 0 });
    const lead = (key: string) => ({ kind: "slide" as const, def: results, seq: 1, at: T0, start: T0, value: "", who: null, key });
    const seen = new Set<string>();
    expect(faceFlashFor(lead("r:s1"), "tv", seen, { ...EMPTY_NIGHT, results_q: 0 })).toBeNull();
    expect(faceFlashFor(lead("r:s2"), "tv", seen, { ...EMPTY_NIGHT, results_q: 1 })).toEqual({ mood: "thinking", ms: FACE_FLASH_MS });
    expect(faceFlashFor(lead("r:s3"), "tv", seen)).toEqual({ mood: "thinking", ms: FACE_FLASH_MS }); // no night: as before
  });
});

describe("one countdown, never two (livetv-3)", () => {
  it("a scene that draws the story's countdown puts the corner aside, on the targets it draws it on", () => {
    const CLOCKED = def({ id: "clocked", when: [{ slide: "bingo" }], ms: "hold", countdown: "tv" });
    const BOTH = def({ id: "both", when: [{ slide: "five_minutes" }], ms: "hold", countdown: true });
    const scenes = [CLOCKED, BOTH, ZIP];
    const at = (value: string, target: "tv" | "wall") => {
      const q = new MomentQueue();
      return drawsCountdown(pickScene({ state: state(), now: T0 + 1000, layers: { overlay: null, slide: slide(value, T0) }, bare: false, target, scenes, queue: q }), target);
    };
    expect(at("bingo", "tv")).toBe(true);
    expect(at("bingo", "wall")).toBe(false);
    expect(at("five_minutes", "wall")).toBe(true);
    expect(at("call_desktop", "tv")).toBe(false); // a card: the corner stays
    expect(drawsCountdown(NO_PICK, "tv")).toBe(false);
  });

  it("the show's timed slides say so", async () => {
    const { SCENES: A1 } = await import("../src/cutscene/scenes/act1.tsx");
    const { SCENES: A2 } = await import("../src/cutscene/scenes/act2.tsx");
    const flag = (id: string) => [...A1, ...A2].find((d) => d.id === id)?.countdown;
    expect(flag("bingo")).toBe("tv");
    expect(flag("trivia_1")).toBe("tv");
    expect(flag("trivia_2")).toBe("tv");
    expect(flag("hunt_results")).toBe(true);
    expect(flag("five_minutes")).toBe(true);
  });
});
