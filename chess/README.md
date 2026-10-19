# @loom/chess

The King's chess for *Trapped in the Internet*: played at the wall terminal
outside the server-room door (`terminal/`, `view=chess`). Pure TypeScript
source consumed like `@loom/house` (`workspace:*`, no build step); the only
dependency is chess.js 1.4.0 (BSD-2-Clause, no eval / wasm / worker), with
React as a peer for the board.

| Module | What |
|---|---|
| `stage.ts` | `Stage` (`grandmaster` · `club` · `beginner` · `dizzy` · `pawns`), `stageFor(hp, max)` = `round(4·hp/max)` off the King's one shared health bar (15 HP for the night, knocked down in the reinstallation games), `STAGE_LINE` |
| `rules.ts` | the chess.js wrapper: `newGame(stage)` (pawns only at 0), `targets`, `play` (auto-queen), `outcome`, `bannerOf`, `board`, glyphs, `describe` |
| `ai.ts` | the King: negamax / alpha-beta, Michniewski tables, iterative deepening, node + time budgets, `PROFILES` per stage. The search is a generator that can stop at any node; `pickMoveAsync` gives the thread back every `SLICE_MS` (12 ms) so taps stay live on the oldest tablets (no workers) |
| `Board.tsx` | the tap-tap 8×8 board; styles in `@loom/chess/board.css` (`--chess-*` overrides) |

**No hints.** Nothing here suggests a move to the player: the old tent
tablet's 💡 Hint helper was deleted when chess moved to the door terminal
(wave 11).

`pnpm --filter @loom/chess test`.
