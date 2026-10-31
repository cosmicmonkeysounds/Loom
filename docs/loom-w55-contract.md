# Wave 55 contract: the read-aloud pop-up and the teleprompter

2026-10-30. The ask: *"we need a telepromter type view for Trapped in the Internet
-- some lines from the story are meant to be read outloud: when that happens, it
should be a top priority notification / pop-up that cannot go away -- when you
click on it goes to an obvious teleprompter view with variable speed and a scroll
preview / jump features."*

All new show text is `DRAFT w55` (sheet: `SIGNOFF-w55.md`). Branch
`oct31-w55/teleprompter`. Not shipped: it changes the server, the story and the
phones, so it needs a release, `sync-show` with its reload, and every phone
reloaded. An old phone is unaffected: it ignores the mark.

## The shape of it

No new route, journal entry or view. The script is chat that already exists, so
it survives a reload, a restart and a new phone by replay. The server marks lines;
the phone decides everything else.

## C1. The mark

A beat's contract line `aloud:` lists who reads it, comma-separated: a part
(`Clippy`, `@<Character>`) or a `{…}` naming a program, resolved when the line
plays, always to a guest (`Night.bobber`, a guest id). A `{…}` naming nobody marks
nothing. `L1227` is an error for a word that is no signable part.

## C2. The line

`ChatMessage.aloud?: {readers: string[]; reader?: string}`, on stage lines and
narration only (a line addressed to a person is a DM and is never marked).
`readers` hold the line. `reader`, one of them, says it: a part its own lines, a
program the narration. No `reader`: a cue or a stage direction. `beat` is the
section's title.

## C3. Delivery

`capHistory` keeps a reader's rows past the cap. `forGuest` strips the field from
every guest who isn't a reader. `fanout` sends `aloudPush(beat)` to each reader of
the batch's lines, to a hidden page only.

## C4. The phone

The code is described in `play/CLAUDE.md`, *Wave 55*. A reader's lines past their mark
cover the whole app, over every other surface, with no close. Only ✓ Done moves
the mark. The mark is per sign-in in host storage. A section where a reader says
nothing is dropped, so a beat can serve two hosts.

## C5. The story

Marks only, plus Clippy's words that named the Desktop room. No line she reads
changed. See `SIGNOFF-w55.md` §2 for the 25 beats.

## Tests

`core/test/w55-aloud.test.ts`, `play/test/w55-aloud.test.tsx`.
