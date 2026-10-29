# chess — agent guide

`@loom/chess`: the King's chess for *Trapped in the Internet*. Pure
TypeScript source consumed as `workspace:*` (no build step); one
dependency, chess.js 1.4.0; React is a peer for the board. MIT. The module
table is in [`README.md`](./README.md).

- **Played in one place:** the Server Door wall terminal (`terminal`,
  `view=chess`, `terminal/src/chess/`). The reinstallation games only hit
  the King (his shared health bar); they never play chess.
- **Exports:** `.` (`src/index.ts`: rules, AI, the drag maths, board), `./stage`
  (`stageFor` alone, imported by `reinstall/web/src/game/fight.ts` for the
  HUD's lines), `./board.css`.
- **The strength ladder** (`stageFor(hp, max)`): grandmaster only at a full
  bar, pawns only at 0, club / beginner / dizzy between. The terminal deals
  a game at the stage read when it is dealt.

## The board

`Board.tsx` owns the pick-up and the drag; the host gives it the game, the
last move, `disabled` and `onMove(from, to)` (always legal; the host plays
it). The decisions are pure in `drag.ts`: `squareAt` (a point to a square,
White at the bottom), `onPress` / `onTap` / `onDrop`, `isDrag`
(`DRAG_SLOP` 6 px: less is a tap). Drag and tap-tap both always work. On
touch the dragged piece (`.ghost`) is drawn 1.6× and lifted half a square
above the finger; the square under the finger gets `.over`. An illegal
drop puts the piece back, still picked up. A tapped move and every King's
move slide (WAAPI, `SLIDE_MS` 200; none under reduced motion); a dropped
one lands where the finger left it. The board takes every touch
(`touch-action: none`, a non-passive `touchmove`, no long-press callout),
so a drag never scrolls or zooms the page on iOS. Pointer events do the
taps; a square's own click (keyboard, screen readers) is a tap too, unless
a pointer just handled it.

## Stages and profiles

`stageFor(hp, max)` maps the bar to a stage; `PROFILES` in `src/ai.ts`
maps the stage to the AI; `startFen(stage)` in `src/rules.ts` picks the
start position. On the show's 15 HP bar:

| HP | Stage | AI (`PROFILES`) | Start |
|---|---|---|---|
| 15 | grandmaster | depth 3, 2.5 s, 6000 nodes, best move | normal |
| 10–14 | club | depth 2, 1.2 s, 2500 nodes, best | normal |
| 5–9 | beginner | depth 1, 0.4 s, 400 nodes, best | normal |
| 1–4 | dizzy | random legal move | normal |
| 0 | pawns | depth 1, 0.4 s, 400 nodes, worst move | `PAWNS_ONLY_FEN`: a lone black king and 8 pawns against a full white army |

## How the terminal uses it

- `terminal/src/chess/session.ts`: the scan-to-game state machine. It reads
  the King's bar off the screen state's `king` and deals at
  `stageFor(king.hp, king.max)` (grandmaster when there is no King). One
  game per scan.
- `terminal/src/chess/ChessTerminal.tsx`: the board (measured to fit the
  pane, `fit.ts`), `pickMoveAsync` with a seeded `mulberry32`, the King's
  bar, ? HELP and the quick tutorial (`Tutorial.tsx`, `tutorial.ts`), the
  two-tap Give up.
- `terminal/src/chess/post.ts`: the result as `POST /api/mod/signal`
  `chess won | lost | drawn` for the guest, labelled `Terminal · <name>`,
  kept in `loom.terminal.pending-chess` and re-sent after a reboot. The
  story, not this package, decides what a win gives.

## Tests

| File | Covers |
|---|---|
| `test/stage.test.ts` | the ladder on a 15 HP bar and other maxima |
| `test/rules.test.ts` | the pawns-only start, targets, moves, outcomes |
| `test/ai.test.ts` | evaluation, each profile, the time-sliced search |
| `test/board.test.ts` | the board markup (selection, targets, last move, no hint, `data-sq`, the touch CSS) |
| `test/drag.test.ts` | `squareAt`, press / tap / drop, the drag slop |

## Commands

```bash
pnpm --filter @loom/chess test        # vitest: 35 tests, 5 files
pnpm --filter @loom/chess typecheck
```

## Rules

- **No hints, no stage names in copy.** The dots are only the picked-up
  piece's legal squares. Nothing here suggests a move or
  names a stage to the player; the door terminal shows only the bar.
- **Old tablets.** The AI is a generator searched in 12 ms slices
  (`pickMoveAsync`, `SLICE_MS`) so taps stay live without workers. Keep
  new code within Chrome 87 / Safari 14 (no regex lookbehind,
  no `structuredClone`).
- **Deterministic randomness.** `ai.ts` exports a seeded `mulberry32`
  (copied from `@loom/house/three`, not imported, so the chess chunk stays
  free of three). Keep tests seeded.
- Changing a stage profile changes how hard the show's King is at a given
  health; check `terminal/test/chess-session.test.ts` as well.
