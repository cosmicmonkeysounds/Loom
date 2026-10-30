# Wave 48 contract: the Password Manager's filter

2026-10-29. The ask: *"For Password Managers power, they should get alerts
whenever ANY GUEST sends a message that contains a swear word, even mild
swears, and even if they are embedded in bigger words, ie: "rump",
"password" is censored for "ass", etc. they get a notification whenever
these messages occur, and they can chose to censor them, which then marks
the recalcitrant program that sent the message for reinstallation. This
should be worked into the awards ceremony; who cursed the most, how many
words were censored (out of how many in total) -- list all the censored
words."*

All new show text is `DRAFT w48` (sheet: `SIGNOFF-w48.md`).

Lanes (branches `oct31-w48/<lane>`, merged `--no-ff`):

| Lane | Owns |
|---|---|
| `core` | this file; `core/src/language-filter.ts` (new); the model's `censor:` header; `core/server/event-runtime.ts`, `views.ts`, `chat.ts`, `routes/screen.ts`, `server/language-filter.ts` (new); the story (`main.loom`, `beats/ceremony.loom`, `cast/antivirus.loom`); their tests; docs, help and the sign-off sheet at integration |
| `play` | the Password Manager's booth (C5): `play/src/booth/filter/` (new, lazy with the booth), `play/src/types.ts`, the booth's tray / layers / pop-out wiring, the performer help article, their tests |
| `terminal` | the TV and the walls' Language Report slide (C6): `award_language` in `terminal/src/cutscene/`, `terminal/src/screen.ts`, `?preview=language`, their tests |

## C1 The filter (`core/src/language-filter.ts`, browser-safe)

- `FILTER_STEMS`: the swear stems, lower case, mild ones too (`ass`,
  `butt`, `rump`, `hell`, `heck`, `damn`, `crap`, …; the full list is in the
  file and on the sign-off sheet).
- A **word** is a run of letters (any script), digits and the look-alikes
  `@ $ *` (and an inner `'`), holding at least one letter. A word is
  **flagged** when a stem occurs anywhere inside it, case folded, after the
  look-alikes `@→a $→s 0→o 1→i/l 3→e 4→a 5→s 7→t` and with `*` matching
  any one letter inside a stem, never its first or last (a self-censored
  `f*ck` is caught, `**text**` is not). Embedded stems count:
  `password` (ass), `hello` (hell), `check` (heck), `button` (butt),
  `trumpet` (rump), `Saturday` (turd). That is the joke.
- `filterHits(text) → FilterHit[]`, one per flagged word in order:
  `{ word, start, end, stems: [{ start, end }] }` (UTF-16 offsets into
  `text`; `word` lower case; `stems` every stem occurrence in the word,
  merged where they overlap).
- `maskText(text, hits)`: every stem occurrence's characters become `*`
  (`password` → `p***word`, `hello` → `****o`); the rest of the line is
  untouched.
- `SWEAR_FLAGGED = "swear_flagged"`, `SWEAR_CENSORED = "swear_censored"`:
  the story signals (C3).

## C2 The server

- Header `censor: <Character>` (model `censor: string | null`, the
  canonical id of a declared CHARACTER, else null; lint-free). No header:
  nothing in this file happens.
- **Flagging.** After a guest's own line is committed (`/api/guest/say`,
  and `/api/mod/say` speaking as a person), the runtime runs `filterHits`
  over its text. With hits, it commits `signal(SWEAR_FLAGGED, <guest>,
  { message: <seq>, words: <n hits>, list: "<words, comma space>" })`
  (journaled; no actor). Only a person's line: never a character, an
  agent, a director's stage voice, a pick or a card answer. A line the
  director has hidden is never shown to the censor.
- **The censor.** `POST /e/:id/api/prime/censor {seq}` (prime auth; the
  booth's character must be the header's `censor:`): 403
  `{error: "not the censor"}`, 404 `{error: "not flagged"}` (no such
  flagged line, or one hidden), 409 `{error: "already censored"}`, 409
  `{error: "doors are closed"}`. It commits `signal(SWEAR_CENSORED,
  <guest>, { message, words, list, fresh }, <censor character>)` where
  `fresh` is the words of `list` not censored before tonight (unique, in
  order; `""` for none), then masks the line in the chat store
  (`ChatMessage.text` = `maskText(...)`, `censored: true`) and re-sends it
  to everyone who has it as a `messageModerated` frame carrying the whole
  message (a guest's through `forGuest`, a booth's through `forBooth`).
  Every client already upserts a whole message from that frame by seq,
  silently (no balloon, no badge), so no guest or terminal code changes.
  200 `{ ok: true, seq, text }` (the masked text).
- **Replay.** `restore` rebuilds both from the journal: a
  `SWEAR_FLAGGED` signal re-indexes its line, a `SWEAR_CENSORED` one masks
  it again. Nothing is stored out of band; a story restart forgets both
  with the journal.
- **The booth's view.** `PrimeView.filter` (only on the censor's booth;
  absent elsewhere and from an old server):

  ```ts
  interface FilterView {
    flagged: number;    // words flagged tonight (every guest line)
    censored: number;   // of them, censored
    lines: FilterLine[];// still to judge: not censored, not hidden; oldest
                        // first, the newest FILTER_VIEW_MAX (40)
  }
  interface FilterLine {
    seq: number;        // the chat line
    guest: string;      // the program's id
    name: string;       // the program's name
    avatar?: string;    // its picture key
    where: string;      // "# lobby", "DM to Trabolta", "to Microsoft Excel", a room's title
    text: string;       // the line as typed
    hits: Array<{ start: number; end: number }>; // every stem in text, to highlight
    words: string[];    // the flagged words, lower case, in order
    ts: number;         // story ms
  }
  ```

  The prime snapshot is pushed with every commit as before, so a new flag
  reaches the booth in its next snapshot.

## C3 The story

- `main.loom`'s header: `censor: Password Manager`.
- `ROLE Program`: `lang_flagged` (words of theirs flagged) and
  `lang_censored` (words of theirs censored).
- `when swear_flagged for program:` counts `program.lang_flagged` and
  `Night.lang_flagged` by `words`. Silent: the booth's pop-out is the alert.
- `when swear_censored for program:` (the Password Manager's press)
  counts `program.lang_censored` and `Night.lang_censored` by `words`,
  appends `fresh` to `Night.lang_words` (`"password, hello"`), replies to
  the booth, and, while the night is on (`Night.ended != true`) and the
  program is neither marked nor in the Internet, fires
  `mark_for_reinstallation for program with reason: "censored: " + list`.
  Its poster lands on every Antivirus' Wanted board like any mark. After
  the ending it only counts (the booth is told).
- **G14 🔑 The Language Report** (`INTERACTION language_report`, appended
  last, an aside between awards like G13): reads `Night.lang_curser` (the
  program at the party with the most flagged words; a tie names everyone
  tied), `Night.lang_curses`, `Night.lang_censored` of
  `Night.lang_flagged`, and every censored word (`Night.lang_words`),
  then `-> Language Report` (`beats/ceremony.loom`: Clippy's or
  Trabolta's lines by `Night.ceremony_host`, skipped under ✍ like an
  award's), `cue screens_award_language`, `Night.screen =
  "award_language"`.

## C4 The screen state

`ScreenNight.language` (only while the `award_language` slide is up on
that target; absent otherwise, so older clients see nothing new):

```ts
interface ScreenLanguage {
  flagged: number;       // words flagged tonight
  censored: number;      // of them, censored
  curser: string | null; // most flagged words; a tie "A and B"; null for nobody
  curses: number;        // that program's flagged words
  words: string[];       // the censored words, unique, lower case, first censored first (≤ 60)
  more: number;          // unique censored words past the 60 shown
}
```

## C5 The Password Manager's booth (play)

The censor's booth (`view.filter` present) gets:

- **The pop-out.** A new line in `filter.lines` (by seq, not seen before
  on this sign-in; `loom.booth.filter.<token>` in host storage) raises one
  pop-out, `🔑 LANGUAGE`, only when no filter pop-out is up or held:
  the program's picture and name, where they said it, the line with each
  stem highlighted, and ✂ **Censor** (arms first: two taps, it marks
  them), **Let it go**, and **🔑 All flagged (n)** when more wait. Later
  puts it in 🔔 Waiting. Lines that arrive while one is up only count.
- **The filter window.** A tray counter `🔑 n` (lines waiting, not let
  go) opens a layer listing every waiting line, oldest first, each with ✂
  Censor (arms) and Let it go, under a header *Censored c of f flagged
  words*. Empty: *Nothing to judge.* Let it go is this phone's own
  (host storage); it never reaches the server.
- ✂ posts `POST /api/prime/censor {seq}`; the line leaves the list on
  the answer (and the next snapshot drops it); 409 `already censored`
  drops it quietly; any other refusal says so in place.
- Copy is `DRAFT w48`. The booth chunk only: nothing the guest entry
  imports reaches it.

## C6 The Language Report slide (terminal)

`award_language`, a held scene ahead of the `award_*` row (like
`award_bathroom`): a filter emblem, then a beat at a time: who cursed the
most (and their count), *n of m words censored*, then the censored words as
a wall of stamped tiles (each shown in full; `+ n more` past the list). Zero
flagged: one line. `?preview=language[&lang=none|tie]`.
