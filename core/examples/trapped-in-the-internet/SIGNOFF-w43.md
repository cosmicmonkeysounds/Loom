# SIGNOFF — wave 43: the King's board on a phone

**Status: DRAFT.** Branch `oct31-w43/chess-phone`. Not shipped.

Your words, verbatim:

> can we make sure the chess terminal works well on an iPhone 12? It should
> have nice UI/UX for the chess - dragging pieces should be natural, not just
> selecting them and then tapping on the tile they should go. there should
> also be a Help button and very quick (and skippable) tutorial

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| C-1 | **Drag and tap both work** | A piece can be dragged to its square, or tapped and then a dot tapped. Nobody has to learn one way. |
| C-2 | **The dragged piece is drawn bigger, above the finger** | On a phone the finger would hide it otherwise. The square under the finger is ringed (gold over a legal square). A drop anywhere else puts it back, still picked up. |
| C-3 | **The King's moves slide** | His reply glides from its square instead of popping in, so a guest sees what he moved. |
| C-4 | **The tutorial opens by itself once per challenger** | At a program's first game on that screen. A second game by the same program goes straight to the board. SKIP is on every card. |
| C-5 | **? HELP sits beside GIVE UP** | It opens the same three cards, with CLOSE. While the cards are up the board is locked and the two-minute leash is held. |
| C-6 | **No hints** | The cards say how to move and how to win; none suggests a move or says how strong he is (test-pinned). |

## 2. The words (`terminal/src/chess/tutorial.ts`, `DRAFT w43`)

| Card | Title | Text |
|---|---|---|
| 1 | DRAG TO MOVE | You are White. Press a piece and slide it. The dots show where it can go. |
| 2 | OR TAP, THEN TAP | Tap a piece, then tap a dot. Tap the piece again to put it down. |
| 3 | CHECKMATE THE KING | Trap his ♚ to win. A pawn that reaches the far side becomes a queen. Two minutes without a touch ends the game. |

Buttons: **SKIP ›** (a first game) or **CLOSE ✕** (from help), **NEXT ›**,
**‹ BACK**, **PLAY ♟** on the last card; the side panel's **? HELP**.
