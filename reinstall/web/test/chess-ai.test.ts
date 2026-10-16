import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { evaluate, hint, MATE, mulberry32, pickMove, pickMoveAsync, PIECE_VALUE, PROFILES, PST } from "../src/chess/ai.ts";
import { PAWNS_ONLY_FEN } from "../src/chess/rules.ts";

const rng = () => mulberry32(7);

describe("evaluate", () => {
  it("is 0 at the start, material + tables otherwise, from White's side", () => {
    expect(evaluate(new Chess())).toBe(0);
    for (const t of Object.keys(PST) as Array<keyof typeof PST>) expect(PST[t]).toHaveLength(64);
    // A lone white queen against a lone black king: about a queen up.
    const q = evaluate(new Chess("7k/8/8/8/8/8/8/3QK3 w - - 0 1"));
    expect(q).toBeGreaterThan(PIECE_VALUE.q - 60);
    expect(q).toBeLessThan(PIECE_VALUE.q + 60);
    // The mirror position scores the opposite.
    expect(evaluate(new Chess("3qk3/8/8/8/8/8/8/7K b - - 0 1"))).toBe(-q);
  });
});

describe("pickMove", () => {
  it("grandmaster finds a mate in one", () => {
    const r = pickMove("r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1", PROFILES.grandmaster, rng());
    expect(r.move).toEqual({ from: "a8", to: "a1" });
    expect(r.score).toBeGreaterThanOrEqual(MATE - 2);
  });

  it("beginner takes a hanging pawn; club sees the recapture (depth 2) and declines", () => {
    // Black queen d8 can take the d2 pawn — the rook on d1 takes it back.
    const fen = "3qk3/8/8/8/8/8/3P4/2KR4 b - - 0 1";
    const b = pickMove(fen, PROFILES.beginner, rng());
    expect(b.move).toEqual({ from: "d8", to: "d2" });
    const c = pickMove(fen, PROFILES.club, rng());
    expect(c.move?.to).not.toBe("d2");
    expect(c.depth).toBe(2);
  });

  it("dizzy plays a legal move, deterministic for a seed", () => {
    const g = new Chess();
    const legal = g.moves({ verbose: true }).map((m) => `${m.from}${m.to}`);
    const a = pickMove(g.fen(), PROFILES.dizzy, mulberry32(3));
    const b = pickMove(g.fen(), PROFILES.dizzy, mulberry32(3));
    expect(a).toEqual(b);
    expect(legal).toContain(`${a.move!.from}${a.move!.to}`);
    expect(a.depth).toBe(0);
    const other = pickMove(g.fen(), PROFILES.dizzy, mulberry32(99));
    expect(legal).toContain(`${other.move!.from}${other.move!.to}`);
  });

  it("pawns picks the move with the worst static eval for the mover", () => {
    const g = new Chess(PAWNS_ONLY_FEN);
    g.move("e4");
    const fen = g.fen();
    const r = pickMove(fen, PROFILES.pawns, rng());
    expect(r.move).not.toBeNull();
    // Depth 1 from the mover's side: −evaluate after the move (White to reply).
    let worst = Number.POSITIVE_INFINITY;
    for (const m of g.moves({ verbose: true })) {
      g.move(m);
      const s = g.inCheck() && g.moves().length === 0 ? MATE - 1 : -evaluate(g);
      g.undo();
      worst = Math.min(worst, s);
    }
    expect(r.score).toBe(worst);
    const best = pickMove(fen, { ...PROFILES.pawns, pick: "best" }, rng());
    expect(best.score).toBeGreaterThan(r.score);
  });

  it("the node budget cuts depth 3 back to the last completed depth", () => {
    const full = pickMove(new Chess().fen(), { depth: 3, thinkMs: 0, maxNodes: 0, pick: "best" }, rng());
    expect(full.depth).toBe(3);
    const r = pickMove(new Chess().fen(), { depth: 3, thinkMs: 0, maxNodes: 40, pick: "best" }, rng());
    expect(r.depth).toBeGreaterThanOrEqual(1);
    expect(r.depth).toBeLessThan(3);
    expect(r.nodes).toBeGreaterThan(40);
    expect(r.nodes).toBeLessThan(full.nodes);
    expect(r.move).not.toBeNull();
    // The time budget cuts the same way (a clock that jumps past the deadline at its first look).
    let t = 0;
    const clock = () => (t += 2000);
    const timed = pickMove(new Chess().fen(), { depth: 3, thinkMs: 1000, maxNodes: 0, pick: "best" }, rng(), clock);
    expect(timed.depth).toBeLessThan(3);
    expect(timed.move).not.toBeNull();
    // Depth 1 always completes, however small the budget.
    const tiny = pickMove(new Chess().fen(), { depth: 3, thinkMs: 0, maxNodes: 1, pick: "best" }, rng());
    expect(tiny.depth).toBe(1);
  });

  it("40 random plies from each profile are all legal and never throw (node budgets trimmed for the suite's sake)", () => {
    for (const [name, profile] of Object.entries(PROFILES)) {
      const g = new Chess(name === "pawns" ? PAWNS_ONLY_FEN : undefined);
      const r = mulberry32(name.length);
      for (let ply = 0; ply < 40 && !g.isGameOver(); ply++) {
        const res = pickMove(g.fen(), { ...profile, thinkMs: 0, maxNodes: Math.min(profile.maxNodes, 250) }, r);
        expect(res.move, `${name} ply ${ply}`).not.toBeNull();
        const legal = g.moves({ verbose: true }).some((m) => m.from === res.move!.from && m.to === res.move!.to);
        expect(legal, `${name} ply ${ply}`).toBe(true);
        g.move(res.move!);
      }
    }
  });

  it("returns no move when the game is over", () => {
    expect(pickMove("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", PROFILES.club, rng())).toEqual({ move: null, score: 0, depth: 0, nodes: 0 });
  });
});

describe("hint / pickMoveAsync", () => {
  it("hint returns the mate when there is one", () => {
    const h = hint("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");
    expect(h.move).toEqual({ from: "a1", to: "a8" });
    expect(h.score).toBeGreaterThanOrEqual(MATE - 2);
  });

  it("pickMoveAsync yields between root moves and never resolves before the feel delay", async () => {
    let t = 0;
    const slept: number[] = [];
    const sleep = async (ms: number) => {
      slept.push(ms);
      t += ms;
    };
    const r = await pickMoveAsync("r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1", PROFILES.club, rng(), { now: () => t, sleep });
    expect(r.move).toEqual({ from: "a8", to: "a1" });
    expect(slept.filter((ms) => ms === 0).length).toBeGreaterThan(1);
    expect(slept[slept.length - 1]).toBeGreaterThan(0);
    expect(t).toBeGreaterThanOrEqual(600);
  });
});
