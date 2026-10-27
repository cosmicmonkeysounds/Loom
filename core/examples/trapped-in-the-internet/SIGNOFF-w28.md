# SIGNOFF — wave 28 heart follow-ups (DRAFT)

**Status: DRAFT, awaiting the user's sign-off.** Wave 28 fixes three
follow-ups from wave 27 (branch `oct31-w28/heart-followups`). Only one of
them adds show text: the 📥 Truther Download now waits for 📓 Hunt 2. The
new line is marked `// DRAFT w28` in `main.loom`. It goes to `# hosts`
only, and names no code, combination or answer.

Your words, verbatim (from the wave 27 request this follows up):

> The meeting in Trabolta's heart for the first time is a little weak --
> there aren't many branching options, and the UI for his terminal is a
> little weak - we can see previous messages from the user to him, and the
> dialogue selection system doesn't work too well.

Not merged to master, not shipped.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| T-1 | **📥 works only from step 8** (`Night.step >= 8`, the night not ended), not only while `hunt2_on` | A press before 📓 Hunt 2 (even before doors) does nothing: no exchange, no Audit / Exchange quests, no glitch, no founding, no booth readouts. A manual catch-up press later in the night (after the summons closed) still works. |
| T-2 | **The 📥 button is off offer before Hunt 2** (`while:` on the INTERACTION) | The cue sheet dims it until step 8 and after it is sent. A `while:` never blocks a press; the rule's guard does. |
| T-3 | **The CRA, McAfee and host 📥 readouts share the guard** | No booth hears "the exchange is open" before it is. |
| T-4 | **A pick at a menu is a real chat line** (no new text) | The option's own words (or `[shows the Sandy File]` for a deed) post as the program's line in the thread the menu docked in, on every screen, and survive a reload and a restart. |
| T-5 | **A cue armed for a picked person waits 10 s** (no new text) | Awards and ♟ give the director 10 s after the who? picker, not 4 s. Plain cues keep 4 s. |

## 2. Every new line

| line | When | Now |
|---|---|---|
| `main.loom` `when truther_download:` | 📥 pressed before 📓 Hunt 2, or after the night ended, to `# hosts` | *📥 Not yet: 📓 Hunt 2 first (it sends itself two minutes in). Nothing happens.* |

## 3. Open

- The line above awaits your sign-off.
- Not checked on a real phone or terminal: how the pick lines read in
  the phone's `dm:Trabolta` thread beside his replies.
