//! The King's chess — a small negamax / alpha-beta search over chess.js
//! with material + piece-square evaluation (Michniewski's "simplified
//! evaluation function"), iterative deepening with node and time budgets,
//! MVV-LVA capture ordering. Runs on the main thread (the oldest tablets
//! have no module workers): `pickMoveAsync` yields to the browser between
//! root moves. One profile per fight stage: the grandmaster searches three
//! plies, the dizzy King plays at random, the pawns-only King picks his own
//! worst move. Deterministic for an injected `rng` + `now`.

import { Chess } from "chess.js";
import type { Move, PieceSymbol, Square } from "chess.js";
import type { Stage } from "../game/fight.ts";

export interface AiProfile {
  depth: 0 | 1 | 2 | 3;
  /** Thinking time budget, ms (0 = none). */
  thinkMs: number;
  /** Node budget (0 = none). */
  maxNodes: number;
  pick: "best" | "random" | "worst";
}

export const PROFILES: Record<Stage, AiProfile> = {
  grandmaster: { depth: 3, thinkMs: 2500, maxNodes: 6000, pick: "best" },
  club: { depth: 2, thinkMs: 1200, maxNodes: 2500, pick: "best" },
  beginner: { depth: 1, thinkMs: 400, maxNodes: 400, pick: "best" },
  dizzy: { depth: 0, thinkMs: 0, maxNodes: 0, pick: "random" },
  pawns: { depth: 1, thinkMs: 400, maxNodes: 400, pick: "worst" },
};

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

/** Michniewski's tables, white's view, a8 first (rank 8 across, then 7, …); black reads them mirrored. */
export const PST: Record<PieceSymbol, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

export const MATE = 100_000;
const INF = MATE * 2;
/** Root moves within this many centipawns of the best are all "best". */
const BEST_SLACK = 5;
/** The least a move takes to feel like thought, ms (`pickMoveAsync`). */
const FEEL_MS = 600;

/** Centipawns from White's side: material + piece-square tables. Draws (no moves) score 0 here; mate is the search's. */
export function evaluate(g: Chess): number {
  let score = 0;
  const rows = g.board();
  for (let r = 0; r < 8; r++) {
    const row = rows[r]!;
    for (let c = 0; c < 8; c++) {
      const p = row[c];
      if (p === null || p === undefined) continue;
      const i = r * 8 + c;
      const v = PIECE_VALUE[p.type] + PST[p.type][p.color === "w" ? i : i ^ 56]!;
      score += p.color === "w" ? v : -v;
    }
  }
  return score;
}

export interface SearchResult {
  move: { from: Square; to: Square; promotion?: "q" } | null;
  /** From the mover's side, centipawns (± `MATE − ply` for a forced mate). */
  score: number;
  /** The deepest fully searched depth. */
  depth: number;
  nodes: number;
}

type Budget = { nodes: number; maxNodes: number; deadline: number; now: () => number; cut: boolean };

/** Captures first, biggest victim first, cheapest attacker first. */
function ordered(moves: Move[]): Move[] {
  const key = (m: Move): number => (m.captured ? 1000 + PIECE_VALUE[m.captured] * 10 - PIECE_VALUE[m.piece] / 100 : m.promotion ? 900 : 0);
  return [...moves].sort((a, b) => key(b) - key(a));
}

/** Negamax with alpha-beta from the mover's side; `ply` for mate distances. */
function negamax(g: Chess, depth: number, alpha: number, beta: number, ply: number, b: Budget): number {
  b.nodes++;
  if (b.maxNodes > 0 && b.nodes > b.maxNodes) b.cut = true;
  else if (b.deadline > 0 && (b.nodes & 63) === 0 && b.now() > b.deadline) b.cut = true;
  // A leaf: static eval — unless the mover is in check, when a mate must be
  // seen (a quiet stalemate at a leaf is let through: chess.js's legal move
  // generation is the costly part, and this halves it).
  if (depth <= 0) {
    if (g.inCheck() && g.moves().length === 0) return -(MATE - ply);
    return (g.turn() === "w" ? 1 : -1) * evaluate(g);
  }
  const moves = g.moves({ verbose: true });
  if (moves.length === 0) return g.inCheck() ? -(MATE - ply) : 0;
  if (g.isInsufficientMaterial() || g.isDrawByFiftyMoves()) return 0;
  let best = -INF;
  for (const m of ordered(moves)) {
    g.move(m);
    const s = -negamax(g, depth - 1, -beta, -alpha, ply + 1, b);
    g.undo();
    if (s > best) best = s;
    if (best > alpha) alpha = best;
    if (alpha >= beta || b.cut) break;
  }
  return best;
}

interface RootScore {
  move: Move;
  score: number;
}

/**
 * The search as steps: each `next()` scores one root move at the current
 * depth; iterative deepening 1..`depth`. The result after the generator
 * ends (or when the caller stops early) is `state.result()` — the last
 * fully searched depth's choice (depth 1 always completes).
 */
function* search(fen: string, profile: AiProfile, rng: () => number, now: () => number): Generator<void, SearchResult, void> {
  const g = new Chess(fen);
  const root = g.moves({ verbose: true });
  if (root.length === 0) return { move: null, score: 0, depth: 0, nodes: 0 };
  const pack = (m: Move): SearchResult["move"] => ({ from: m.from, to: m.to, ...(m.promotion ? { promotion: "q" as const } : {}) });
  if (profile.pick === "random" || profile.depth === 0) {
    const m = root[Math.min(root.length - 1, Math.floor(rng() * root.length))]!;
    return { move: pack(m), score: 0, depth: 0, nodes: 0 };
  }
  const b: Budget = { nodes: 0, maxNodes: profile.maxNodes, deadline: profile.thinkMs > 0 ? now() + profile.thinkMs : 0, now, cut: false };
  let completed: { depth: number; scores: RootScore[] } | null = null;
  for (let d = 1; d <= profile.depth; d++) {
    const scores: RootScore[] = [];
    // Depth 1 is never cut short; the budget only ends deeper rounds.
    if (d === 1) b.cut = false;
    const order = completed === null ? ordered(root) : [...completed.scores].sort((x, y) => y.score - x.score).map((s) => s.move);
    let alpha = -INF;
    for (const m of order) {
      g.move(m);
      const s = -negamax(g, d - 1, -INF, -alpha, 1, d === 1 ? { ...b, maxNodes: 0, deadline: 0 } : b);
      g.undo();
      scores.push({ move: m, score: s });
      // The worst-move picker needs every root move scored, not a window.
      if (profile.pick === "best" && s > alpha) alpha = s;
      if (b.cut && d > 1) break;
      yield;
    }
    if (b.cut && d > 1) break;
    completed = { depth: d, scores };
  }
  const scores = completed!.scores;
  let pick: RootScore;
  if (profile.pick === "worst") {
    pick = scores.reduce((a, s) => (s.score < a.score ? s : a));
  } else {
    const best = Math.max(...scores.map((s) => s.score));
    const near = scores.filter((s) => s.score >= best - BEST_SLACK);
    pick = near[Math.min(near.length - 1, Math.floor(rng() * near.length))]!;
  }
  return { move: pack(pick.move), score: pick.score, depth: completed!.depth, nodes: b.nodes };
}

/** The King's move for `fen` under `profile` — synchronous (tests, hints). */
export function pickMove(fen: string, profile: AiProfile, rng: () => number, now: () => number = () => 0): SearchResult {
  const it = search(fen, profile, rng, now);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** The same search, yielding to the browser between root moves, and never back before `FEEL_MS`. */
export async function pickMoveAsync(fen: string, profile: AiProfile, rng: () => number, opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<SearchResult> {
  const now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = now();
  const it = search(fen, profile, rng, now);
  let result: SearchResult;
  for (;;) {
    const r = it.next();
    if (r.done) {
      result = r.value;
      break;
    }
    await sleep(0);
  }
  const left = FEEL_MS - (now() - started);
  if (left > 0) await sleep(left);
  return result;
}

/** A good move for the side to move (depth 2, finds mates in one): the 💡 Hint. */
export function hint(fen: string, rng: () => number = () => 0): SearchResult {
  return pickMove(fen, { depth: 2, thinkMs: 0, maxNodes: 2500, pick: "best" }, rng);
}

/** A small deterministic PRNG (the same mulberry32 as `@loom/house/three`'s textures — copied, not imported, so this chunk stays free of three). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
