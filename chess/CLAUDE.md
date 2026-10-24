# chess — agent guide

`@loom/chess`: the King's chess for *Trapped in the Internet*. Pure
TypeScript source consumed as `workspace:*` (no build step); one
dependency, chess.js 1.4.0; React is a peer for the board. MIT. The module
table is in [`README.md`](./README.md).

- **Played in one place:** the Server Door wall terminal (`terminal`,
  `view=chess`, `terminal/src/chess/`). The reinstallation games only hit
  the King (his shared health bar); they never play chess.
- **Exports:** `.` (`src/index.ts`: rules, AI, board), `./stage`
  (`stageFor` alone, imported by `reinstall/web/src/game/fight.ts` for the
  HUD's lines), `./board.css`.
- **The strength ladder** (`stageFor(hp, max)`): grandmaster only at a full
  bar, pawns only at 0, club / beginner / dizzy between. The terminal deals
  a game at the stage read when it is dealt.

## Commands

```bash
pnpm --filter @loom/chess test        # vitest: 23 tests, 4 files
pnpm --filter @loom/chess typecheck
```

## Rules

- **No hints, no stage names in copy.** Nothing here suggests a move or
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
