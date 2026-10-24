# @loom/chess

The King's chess for *Trapped in the Internet*: played at the wall terminal
outside the server-room door (`terminal/`, `view=chess`). Pure TypeScript
source consumed like `@loom/house` (`workspace:*`, no build step); the only
dependency is chess.js 1.4.0 (BSD-2-Clause, no eval / wasm / worker), with
React as a peer for the board.

| Module | What |
|---|---|
| `stage.ts` | `Stage` (`grandmaster` · `club` · `beginner` · `dizzy` · `pawns`), `stageFor(hp, max)` off the King's one shared health bar (15 HP for the night, knocked down in the reinstallation games): grandmaster only at a full bar, pawns only at 0, and every point between split over club / beginner / dizzy (`1 + floor(3·hp/max)`: on 15 HP, 10–14 club, 5–9 beginner, 1–4 dizzy), so the first hit already weakens him. No copy names a stage: the door terminal never shows a strength line (no hints), and the reinstallation web game's HUD has its own lines (`reinstall/web` `fight.ts`), importing the ladder alone as `@loom/chess/stage` |
| `rules.ts` | the chess.js wrapper: `newGame(stage)` (pawns only at 0), `targets`, `play` (auto-queen), `outcome`, `bannerOf`, `board`, glyphs, `describe` |
| `ai.ts` | the King: negamax / alpha-beta, Michniewski tables, iterative deepening, node + time budgets, `PROFILES` per stage. The search is a generator that can stop at any node; `pickMoveAsync` gives the thread back every `SLICE_MS` (12 ms) so taps stay live on the oldest tablets (no workers) |
| `Board.tsx` | the tap-tap 8×8 board; styles in `@loom/chess/board.css` (`--chess-*` overrides) |

**No hints.** Nothing here suggests a move to the player: the old tent
tablet's 💡 Hint helper was deleted when chess moved to the door terminal
(wave 11).

`pnpm --filter @loom/chess test`.
