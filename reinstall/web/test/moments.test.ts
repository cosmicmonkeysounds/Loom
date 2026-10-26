//! The game moments in the web game (wave 26, C6): the void (R4), the heart
//! (R6) and the virus disk (R7). The pure rules (`moments.ts`), then the
//! engine on a bare Game (no canvas) with `postMoment` faked with the
//! contract's exact answers.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESCAPE_M, heartReached, locate, pickupReach, voidDistance } from "@loom/house";
import type { KingState, Prop, Vec3 } from "@loom/house";
import type { MomentReply, MomentRequest } from "../src/api.ts";
import { Game } from "../src/game/engine.ts";
import { escapeDue, escapeStep, heartStep, MOMENT_RETRY_MS, PICKUP_NOTICE, pickupStep, SCARE_MS, SCARE_TITLE, SCARE_WAIT_MS } from "../src/game/moments.ts";
import { foundRetryMs } from "../src/game/hud.ts";
import { SHOW } from "./houses.ts";

const posted = vi.hoisted(() => ({ reqs: [] as unknown[], replies: [] as Array<unknown | Promise<unknown>> }));
vi.mock("../src/api.ts", async (orig) => ({
  ...(await orig<object>()),
  postMoment: async (_base: string, _token: string, req: unknown) => {
    posted.reqs.push(req);
    return posted.replies.shift() ?? { kind: "error", message: "no reply queued" };
  },
}));

const house = SHOW();
const front = house.doors.find((d) => d.b === null)!;
/** `d` plan metres straight out of the front door (north of the mud room). */
const out = (d: number): Vec3 => [front.at[0], 0, front.at[1] - d];
const heart = house.props.find((p) => p.kind === "heart") as Prop;
const disk = house.props.find((p) => p.kind === "pickup") as Prop;
const kingProp = house.props.find((p) => p.kind === "king") as Prop;
const LINES = [{ from: "Trabolta", text: "Back you go." }];
const SPAWN = { room: house.spawn.room, pos: house.spawn.pos, yaw: house.spawn.yaw };

describe("the void — when (R4)", () => {
  it("ESCAPE_M (5 m) out of the walls on that floor, never inside a room", () => {
    expect(ESCAPE_M).toBe(5);
    expect(voidDistance(house, out(5))).toBeCloseTo(5, 6);
    expect(escapeDue(house, out(5))).toBe(true);
    expect(escapeDue(house, out(4.9))).toBe(false);
    expect(escapeDue(house, out(12))).toBe(true);
    expect(escapeDue(house, house.spawn.pos)).toBe(false); // the tent is a room
    expect(escapeDue(house, [front.at[0], 0, front.at[1] + 1])).toBe(false); // the mud room
  });

  it("every answer teleports; only a dead session ends the game; lines only when it counted", () => {
    expect(escapeStep({ kind: "escaped", lines: LINES, spawn: SPAWN, cooldownMs: 20000 })).toEqual({ over: false, spawn: SPAWN, lines: LINES });
    for (const r of [{ kind: "old" }, { kind: "paused" }, { kind: "notOut", distance: 3 }, { kind: "cooldown", retryMs: 9000 }, { kind: "parked" }, { kind: "error", message: "x" }] as MomentReply[])
      expect(escapeStep(r), r.kind).toEqual({ over: false, spawn: null, lines: [] });
    expect(escapeStep(null)).toEqual({ over: false, spawn: null, lines: [] }); // no answer in time
    expect(escapeStep({ kind: "over", status: 410 })).toEqual({ over: true, spawn: null, lines: [] });
  });

  it("the scare panel names nobody", () => {
    expect(SCARE_TITLE).toBe("FATAL EXCEPTION 0E");
    const scare = readFileSync(new URL("../src/game/Scare.tsx", import.meta.url), "utf8");
    // No string literal or JSX text names him.
    expect(scare).not.toMatch(/"[^"]*Trabolta[^"]*"|>[^<{]*Trabolta[^<{]*</u);
    expect(scare).toContain("{SCARE_TITLE}");
  });

  it("the scare: one hard flash (once), a shake under 3 Hz, still under reduced motion", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.scare-flash \{[^}]*animation: scare-flash [\d.]+s [a-z-]+ 1 both/u);
    const shake = /animation: scare-zoom [^,]+, scare-shake ([\d.]+)s/u.exec(css);
    expect(shake).not.toBeNull();
    expect(1 / Number(shake![1])).toBeLessThanOrEqual(3);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.scare-face \{ animation: none; \}/u);
  });
});

describe("the heart and the disk — what each answer means (R6, R7)", () => {
  it("heart: speak once, done, re-enter, retry on the found backoff", () => {
    expect(heartStep({ kind: "heart", lines: LINES }, 0)).toEqual({ kind: "speak", lines: LINES });
    expect(heartStep({ kind: "heart", lines: [] }, 0)).toEqual({ kind: "reenter" }); // he isn't awake
    for (const k of ["already", "old", "noProp", "bad"] as const) expect(heartStep({ kind: k } as MomentReply, 0), k).toEqual({ kind: "done" });
    expect(heartStep({ kind: "sealed" }, 0)).toEqual({ kind: "reenter" });
    expect(heartStep({ kind: "notThere" }, 0)).toEqual({ kind: "reenter" });
    expect(heartStep({ kind: "paused" }, 2)).toEqual({ kind: "retry", ms: foundRetryMs(2) });
    expect(heartStep({ kind: "parked" }, 0)).toEqual({ kind: "retry", ms: MOMENT_RETRY_MS });
    expect(heartStep({ kind: "over", status: 401 }, 0)).toEqual({ kind: "over" });
  });

  it("pickup: take, hide, retry, give up", () => {
    expect(pickupStep({ kind: "picked", lines: LINES, item: "virus", prop: "virus-disk" }, 0)).toEqual({ kind: "take", lines: LINES });
    expect(pickupStep({ kind: "already" }, 0)).toEqual({ kind: "hide" });
    expect(pickupStep({ kind: "far", distance: 1.3 }, 1)).toEqual({ kind: "retry", ms: foundRetryMs(1) });
    expect(pickupStep({ kind: "paused" }, 3)).toEqual({ kind: "retry", ms: foundRetryMs(3) });
    for (const k of ["old", "noProp", "bad"] as const) expect(pickupStep({ kind: k } as MomentReply, 0), k).toEqual({ kind: "giveUp" });
    expect(pickupStep({ kind: "over", status: 410 }, 0)).toEqual({ kind: "over" });
    expect(PICKUP_NOTICE).toMatch(/disk/u);
  });
});

// --- the engine ----------------------------------------------------------------

type Bare = {
  body: { p: Vec3; yaw: number; pitch: number; vy: number };
  escaping: boolean;
  scare: boolean;
  heartDone: boolean;
  phase: string;
  taken: Set<string>;
  presence: string | null;
  tickMoments(now: number): void;
  escape(): Promise<void>;
  bindMoments(): void;
};

function game(opts: { feet: Vec3; king?: KingState | null; picked?: string[]; heartHeard?: boolean }) {
  const g = Object.create(Game.prototype) as Record<string, unknown>;
  const said: string[] = [];
  const played: Array<unknown[]> = [];
  const hidden: string[] = [];
  const sfx = { scare: vi.fn(), pickup: vi.fn() };
  const end = vi.fn();
  const pump = { flush: vi.fn(async () => true), set: vi.fn(), tick: vi.fn(async () => {}) };
  Object.assign(g, {
    phase: "playing",
    map: house,
    kingProp: opts.king === undefined ? null : kingProp,
    kingState: opts.king ?? null,
    body: { p: opts.feet, yaw: 0, pitch: 0, vy: 0 },
    escaping: false,
    scare: false,
    keys: new Set(["KeyW"]),
    hitQueued: true,
    heartDone: opts.heartHeard === true,
    heartAsked: false,
    heartBusy: false,
    heartRetryAt: 0,
    heartRefusals: 0,
    taken: new Set(opts.picked ?? []),
    pickupGivenUp: new Set(),
    pickupBusy: false,
    pickupRetryAt: new Map(),
    pickupRefusals: 0,
    distHistory: [1],
    lastTrailAt: 0,
    presence: "somewhere",
    perchedSaid: true,
    voice: null,
    leash: { touch: () => {} },
    pump,
    house: { setPickupTaken: (id: string, taken: boolean) => (taken && hidden.push(id), true) },
    lines: { play: async (l: unknown[]) => void played.push(l) },
    o: { base: "/e/ev", assignment: { token: "sess", session: "s-1", name: "Excel" }, sfx },
    say: (line: string) => said.push(line),
    emitHud: () => {},
    end,
  });
  (g as unknown as Bare).bindMoments();
  return { g: g as unknown as Bare, said, played, hidden, sfx, end, pump };
}

const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

beforeEach(() => {
  posted.reqs = [];
  posted.replies = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the void in the engine (R4)", () => {
  it("5 m out: the scare, the pose flushed, the escape posted; after SCARE_MS back at the spawn, his lines said", async () => {
    vi.useFakeTimers();
    const { g, sfx, played, pump, end } = game({ feet: out(5.2) });
    posted.replies.push({ kind: "escaped", lines: LINES, spawn: SPAWN, cooldownMs: 20000 });
    g.tickMoments(0);
    expect(g.escaping).toBe(true);
    expect(g.scare).toBe(true);
    expect(sfx.scare).toHaveBeenCalledTimes(1);
    await settle();
    expect(pump.flush).toHaveBeenCalled();
    expect(posted.reqs).toEqual([{ kind: "escape" } satisfies MomentRequest]);
    // Still out there, under the scare, until SCARE_MS.
    expect(locate(house, g.body.p).room).toBeNull();
    g.tickMoments(10); // mid-escape: never a second one
    expect(posted.reqs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SCARE_MS);
    expect(g.scare).toBe(false);
    expect(g.escaping).toBe(false);
    expect(locate(house, g.body.p).room).toBe(house.spawn.room);
    expect(g.presence).toBeNull();
    expect(pump.set).toHaveBeenCalled();
    expect(played).toEqual([LINES]);
    expect(end).not.toHaveBeenCalled();
  });

  it("an old server (404 not found), a cooldown or closed doors: still the teleport — no lines", async () => {
    for (const reply of [{ kind: "old" }, { kind: "cooldown", retryMs: 5000 }, { kind: "paused" }, { kind: "notOut", distance: 4.6 }]) {
      vi.useFakeTimers();
      const { g, played } = game({ feet: out(6) });
      posted.replies.push(reply);
      g.tickMoments(0);
      await vi.advanceTimersByTimeAsync(SCARE_MS);
      expect(locate(house, g.body.p).room, reply.kind).toBe(house.spawn.room);
      expect(played, reply.kind).toEqual([[]]);
      vi.useRealTimers();
    }
  });

  it("no answer in time: the teleport anyway, and the late lines still play", async () => {
    vi.useFakeTimers();
    const { g, played } = game({ feet: out(6) });
    let answer!: (r: unknown) => void;
    posted.replies.push(new Promise((r) => (answer = r)));
    g.tickMoments(0);
    await vi.advanceTimersByTimeAsync(SCARE_WAIT_MS);
    expect(locate(house, g.body.p).room).toBe(house.spawn.room);
    expect(played).toEqual([]);
    answer({ kind: "escaped", lines: LINES, spawn: SPAWN, cooldownMs: 20000 });
    await settle();
    expect(played).toEqual([LINES]);
  });

  it("a dead session ends the game instead of teleporting", async () => {
    vi.useFakeTimers();
    const { g, end } = game({ feet: out(6) });
    posted.replies.push({ kind: "over", status: 410 });
    g.tickMoments(0);
    await vi.advanceTimersByTimeAsync(SCARE_MS);
    expect(end).toHaveBeenCalledWith({ kind: "over", reason: "This session is over." });
    expect(locate(house, g.body.p).room).toBeNull();
  });

  it("inside the house nothing happens", () => {
    const { g } = game({ feet: house.spawn.pos });
    g.tickMoments(0);
    expect(g.escaping).toBe(false);
    expect(posted.reqs).toEqual([]);
  });
});

describe("the heart in the engine (R6)", () => {
  const inside: Vec3 = [3.25, -2.7, 23.5];
  const fallen: KingState = { id: kingProp.id, hp: 0, max: 15, fallen: true };
  const standing: KingState = { ...fallen, hp: 15, fallen: false };

  it("the show's heart is in the Server Room, and this spot reaches it", () => {
    expect(heart.room).toBe("server-room");
    expect(heartReached(house, inside, heart)).toBe(true);
  });

  it("once the King has fallen: in his room, the heart is asked once; his lines are said; never again", async () => {
    const { g, played } = game({ feet: inside, king: fallen });
    posted.replies.push({ kind: "heart", lines: LINES });
    g.tickMoments(0);
    await settle();
    expect(posted.reqs).toEqual([{ kind: "heart", prop: heart.id }]);
    expect(played).toEqual([LINES]);
    expect(g.heartDone).toBe(true);
    g.tickMoments(1);
    g.body.p = [3.25, 0, 10]; // out…
    g.tickMoments(2);
    g.body.p = inside; // …and in again
    g.tickMoments(3);
    await settle();
    expect(posted.reqs).toHaveLength(1);
  });

  it("nothing to say yet (he isn't awake): asked again only on the next entry", async () => {
    const { g, played } = game({ feet: inside, king: fallen });
    posted.replies.push({ kind: "heart", lines: [] }, { kind: "heart", lines: LINES });
    g.tickMoments(0);
    await settle();
    g.tickMoments(1);
    await settle();
    expect(posted.reqs).toHaveLength(1);
    expect(played).toEqual([]);
    g.body.p = [3.25, 0, 10];
    g.tickMoments(2);
    g.body.p = inside;
    g.tickMoments(3);
    await settle();
    expect(posted.reqs).toHaveLength(2);
    expect(played).toEqual([LINES]);
  });

  it("sealed while the King stands (and while the server hasn't said); heard tonight already: never asked", async () => {
    game({ feet: inside, king: standing }).g.tickMoments(0);
    game({ feet: inside, king: null }).g.tickMoments(0); // a King on the map, no word on him
    game({ feet: inside, king: fallen, heartHeard: true }).g.tickMoments(0);
    await settle();
    expect(posted.reqs).toEqual([]);
  });

  it("left and came back while the answer was on its way: this entry is asked again", async () => {
    for (const first of [{ kind: "heart", lines: [] }, { kind: "sealed" }, { kind: "notThere" }, { kind: "paused" }] as MomentReply[]) {
      posted.reqs = [];
      const { g, played } = game({ feet: inside, king: fallen });
      let answer!: (r: MomentReply) => void;
      posted.replies.push(new Promise<MomentReply>((r) => (answer = r)), { kind: "heart", lines: LINES });
      g.tickMoments(0);
      await settle();
      expect(posted.reqs, first.kind).toHaveLength(1);
      g.body.p = [3.25, 0, 10]; // out while it waits…
      g.tickMoments(1);
      g.body.p = inside; // …and back in before it answers
      g.tickMoments(2);
      await settle();
      expect(posted.reqs, first.kind).toHaveLength(1); // one request at a time
      answer(first);
      await settle();
      g.tickMoments(3); // no backoff, no second exit needed
      await settle();
      expect(posted.reqs, first.kind).toHaveLength(2);
      expect(played, first.kind).toEqual([LINES]);
    }
  });

  it("a closed-doors backoff never outlives the entry: out and in again asks at once", async () => {
    const { g } = game({ feet: inside, king: fallen });
    posted.replies.push({ kind: "paused" }, { kind: "heart", lines: LINES });
    g.tickMoments(0);
    await settle();
    g.body.p = [3.25, 0, 10];
    g.tickMoments(1);
    g.body.p = inside;
    g.tickMoments(2);
    await settle();
    expect(posted.reqs).toHaveLength(2);
  });

  it("closed doors: asked again on the found backoff while still inside", async () => {
    vi.useFakeTimers();
    const { g } = game({ feet: inside, king: fallen });
    posted.replies.push({ kind: "paused" }, { kind: "heart", lines: LINES });
    g.tickMoments(0);
    await settle();
    expect(posted.reqs).toHaveLength(1);
    g.tickMoments(performance.now() + foundRetryMs(0) + 1);
    await settle();
    expect(posted.reqs).toHaveLength(2);
  });
});

describe("the virus disk in the engine (R7)", () => {
  const at: Vec3 = [disk.pos[0] + 0.3, disk.pos[1], disk.pos[2]];

  it("the show's disk is reachable here", () => {
    expect(disk.item).toBe("virus");
    expect(pickupReach(house, at, disk)).toBe(true);
  });

  it("in reach: asked; taken — hidden, the blip, the notice, the story's lines", async () => {
    const { g, hidden, sfx, said, played } = game({ feet: at });
    const lines = [{ from: "Truther", text: "A download." }];
    posted.replies.push({ kind: "picked", lines, item: "virus", prop: disk.id });
    g.tickMoments(0);
    await settle();
    expect(posted.reqs).toEqual([{ kind: "pickup", prop: disk.id }]);
    expect(hidden).toEqual([disk.id]);
    expect(sfx.pickup).toHaveBeenCalledTimes(1);
    expect(said).toEqual([PICKUP_NOTICE]);
    expect(played).toEqual([lines]);
    g.tickMoments(1);
    await settle();
    expect(posted.reqs).toHaveLength(1);
  });

  it("taken before tonight (already): hidden quietly", async () => {
    const { g, hidden, sfx, said } = game({ feet: at });
    posted.replies.push({ kind: "already" });
    g.tickMoments(0);
    await settle();
    expect(hidden).toEqual([disk.id]);
    expect(sfx.pickup).not.toHaveBeenCalled();
    expect(said).toEqual([]);
  });

  it("a re-scan's picked: hidden from the start, never asked", async () => {
    const { g, hidden } = game({ feet: at, picked: [disk.id] });
    expect(hidden).toEqual([disk.id]);
    g.tickMoments(0);
    await settle();
    expect(posted.reqs).toEqual([]);
  });

  it("an old server or no such prop: left alone, never asked again", async () => {
    const { g, hidden } = game({ feet: at });
    posted.replies.push({ kind: "noProp" });
    g.tickMoments(0);
    await settle();
    g.tickMoments(10_000);
    await settle();
    expect(posted.reqs).toHaveLength(1);
    expect(hidden).toEqual([]);
  });

  it("far: asked again after the backoff", async () => {
    const { g } = game({ feet: at });
    posted.replies.push({ kind: "far", distance: 1.4 }, { kind: "picked", lines: [], item: "virus", prop: disk.id });
    g.tickMoments(0);
    await settle();
    g.tickMoments(performance.now() + 10);
    await settle();
    expect(posted.reqs).toHaveLength(1);
    g.tickMoments(performance.now() + foundRetryMs(0) + 1);
    await settle();
    expect(posted.reqs).toHaveLength(2);
  });
});

describe("the scare and the caption on screen", () => {
  it("the scare draws his face and the panel, nothing else to read", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Scare, SCARE_GARBAGE } = await import("../src/game/Scare.tsx");
    const html = renderToStaticMarkup(createElement(Scare));
    expect(html).toContain('class="scare"');
    expect(html).toContain("<svg");
    expect(html).toContain(SCARE_TITLE);
    expect(html).toContain(SCARE_GARBAGE);
    expect(html).not.toMatch(/Trabolta/u);
  });

  it("Play shows the scare while hud.scare, and the caption's display text with no speaker's name", () => {
    const play = readFileSync(new URL("../src/game/Play.tsx", import.meta.url), "utf8");
    expect(play).toMatch(/hud\?\.scare === true && found === null && <Scare \/>/u);
    expect(play).toMatch(/hud\.caption !== null &&[\s\S]*?<p>\{hud\.caption\.text\}<\/p>/u);
    expect(play).not.toMatch(/caption\.from/u);
  });
});
