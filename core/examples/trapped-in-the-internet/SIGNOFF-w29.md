# SIGNOFF — wave 29 immersion (DRAFT)

**Status: DRAFT, awaiting the user's sign-off.** Wave 29 takes every
"Layer n" and every "out of character" out of the show (branch
`oct31-w29/immersion`). Three lines of show text are new. Each is marked
`// DRAFT w29` (`main.loom`) or `{/* DRAFT w29 */}` / `// DRAFT w29`
(terminal). None names a code, a combination or an answer.

Your words, verbatim:

> make sure that "Layer {x}" is not shown in the chat with Trabolta -- not
> sure if it does now, but a few days ago it did show which "layer" you
> were on, which sort of breaks the immersion. also any reference to being
> "out of character" should be removed too.

It was still on: the heart terminal's YOUR ANSWER header read
*LAYER 3 / 4 · THE ARGUMENT*, and each question card was titled
*LAYER n / 4* with four progress pips.

Not merged to master, not shipped.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| I-1 | **The YOUR ANSWER header shows no layer and no title** | Only *YOUR ANSWER*, and *LISTENING…* while he speaks. Nothing counts the questions. |
| I-2 | **The question card keeps its question but loses the count** | Title bar *HEART.EXE* (it read *LAYER n / 4*); the message is still *WHO ARE YOU* / *WHAT I AM* / *THE ARGUMENT* / *THE ASK*; the four progress pips are gone. It does not name him, so it can never show before the introduction. |
| I-3 | **His voice is never told a layer number** | The dossier says how far a program got in words (*they told you who they are and heard what you are*, *they have made their case to you*, *they came to ask you to stop*) and suspicion as *you are wary of them*, never a score. `heart_layer` is out of the persona's `them:`. The persona's `outside:` list withholds any line of his that says *layer one* … *layer four* or *out of character*. |
| I-4 | **Backstage labels say it plainly too** | The G11 button reads *G11 · 🎃 Resurrection: the show is over (after the ceremony)*; the glance's *Heart layer* is now *Heart progress*; SHOW.html, DESIGN, README and the staff help article drop the phrase. |
| I-5 | **Beat ids and cue ids stay** | `Heart Layer One` … `Four` and `room_heart_layer_n` are internal: no guest, performer or terminal draws them (the crew's show book lists them). |
| I-6 | **Printed packs and author help keep "four layers"** | They describe the talk for the crew and never reach a phone or a terminal. Reprint nothing for this wave. |

## 2. Every new line

| line | When | Was | Now |
|---|---|---|---|
| `main.loom` `when resurrection:` | G11, an alert on every phone | *!🎃 The show is over: you are human again. Hang out, out of character.* | *!🎃 The show is over: you are human again. Hang out. The night is yours.* |
| `terminal/src/cutscene/scenes/act3.tsx` Resurrection | G11, the TV and every wall terminal, under *YOU ARE HUMAN AGAIN* | *Hang out, out of character.* | *Hang out. The night is yours.* |
| `terminal/src/cutscene/scenes/heart.tsx` `HEART_CARD_TITLE` | each question card at his heart | *LAYER n / 4* | *HEART.EXE* |

## 3. Open

- The lines above await your sign-off.
- Shipping it: a server release, then `sync-show` (the G11 line and label
  are story text), then reload the heart terminal, the TV and the walls
  (the header, the card and the resurrection scene are terminal code),
  then restart the `agents` job and Run → Mind → Reset (the persona, the
  mind and the dossier wording).
- Not checked on the real heart laptop at 1280×720.
