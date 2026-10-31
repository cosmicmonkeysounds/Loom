# SIGNOFF — wave 54: through their eyes

**Status: DRAFT.** Branch `oct31-w54/terminal-eyes`. Not shipped. The contract
is [`docs/loom-w54-contract.md`](../../../docs/loom-w54-contract.md).

Your words, verbatim:

> let's add a feature to the terminals where once somone enters a room in the
> reinstallation game the real world views their FPS perspective from the
> tablet -- once the reinstallation person is close/in view of the tablet thats
> when it switches to the mirror mode. This works for both VR and web
> reinstallation games

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| E-1 | **"Close" is 1.5 m, "in view" is 2.5 m in front of it** | Picked on the show's map. Across a big room is first-person; `CLOSE_M` and `IN_VIEW_M` in `terminal/src/world/eyes.ts` change it. |
| E-2 | **Every placed terminal that shows the game** | The walls, the TV, mirrors and old tablets alike. Not chess, the casino, the tent or the server-room face. |
| E-3 | **Anyone seen brings the mirror** | With two programs in a room, one near the tablet, it shows the mirror. |
| E-4 | **It is a redraw, not their screen** | The tablet draws the house from their position, so no HUD, trail or descent visions. |

## 2. The words

| Where | Text |
|---|---|
| The world view's tag | THROUGH *NAME*'S EYES |
