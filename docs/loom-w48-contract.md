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

---

# Wave 48b: the strength slider, slurs, the ⭐ mini-game, the breach

2026-10-30. The user's answers to the wave 48 sign-off:

> *"1) Yes but maybe she could have a special slider in her start menu to
> tune the profanity filter so that she can filter from the most extreme
> case like you've listed, down to 0%, which is the most extreme swears
> (not buried) [slurs] ... At 10% or higher "fuck", "cunt", 25% is "shit",
> "asshole", etc, at 50% "crap", "balls", "butt". over 50% and it starts to
> get more extreme, with 100% being what you described, ie: "Password
> Manager" being a "bad word". She should start the night with 100% filter
> and must find the slider. And to be clear, we should only be running the
> filter on messages guests have actually sent. 2) Correct - out of how
> many the filter (at the time) caught -- just keep a running tally any
> time Password Manager gets a "censoring needed" notification. 3) Yes, on
> second thought there will probably be \*tons\* of swears --- create a
> comical effect that shows them all (cosmic horror style, but you know,
> from a computer terminal) in a timely manner. 4) Slurs should not be
> displayed or read aloud, and this should be automatic; no need for the
> director. 5) She \*should\* get rewarded, but with higher frequency comes
> a lower multiplier. It should feel like a little mini-game. perhaps there
> is an external lib for language filtering?"*

And, a little later: *"oh, and Password Manager censoring a word shouldn't
trigger reinstallation; suspicion is raised, though, and the guest gets an
automated message."*

All new show text is `DRAFT w48b` (the 48b section of `SIGNOFF-w48.md`).
Lanes: `oct31-w48b/core` (C7–C12, the story, docs), `oct31-w48b/play`
(C13), `oct31-w48b/terminal` (C14), merged `--no-ff` via
`oct31-w48b/integration`.

## C7 The bands (`core/src/language-filter.ts`)

A hit now has a **tier**: the lowest strength (0–100) that catches it.
The strength is a slider, 0–100 in steps of 5; it **starts at 100**.

| tier | band (`FILTER_BANDS[].key`) | catches | ⭐ points a word |
|---|---|---|---|
| 0 | `slur` | slurs, whole words. **Never shown, never read aloud** (C9) | 12 |
| 10 | `worst` | fuck in any form (fucking, motherfucker), cunt, rape | 8 |
| 25 | `strong` | shit, asshole, bitch, bastard, dick, cock, prick, pussy, twat, slut, whore, wank, piss, the explicit words | 5 |
| 50 | `mild` | crap, balls, butt, ass, arse, damn, bloody, bugger, bollocks, tits, boobs, turd, douche, wtf, stfu | 3 |
| 60 | `soft` | hell, heck, darn, dang, frick, frig, fart, poop, bum, rump, dammit, fml, lmao | 2 |
| 75 | `buried` | a worst / strong stem inside a bigger word: *Scunthorpe*, *cocktail*, *Dickens* | 2 |
| 90 | `buried-mild` | a mild stem inside a bigger word: *password*, *class*, *button*, *title*, *Saturday*, *document* | 1 |
| 100 | `paranoid` | a soft stem inside a bigger word: *hello*, *check*, *shell*, *trumpet* | 1 |

Between two tiers a strength catches what the lower one does (40% = 25%).

- **Whole words (tiers 0–60)** go through
  [`obscenity`](https://github.com/jo3-l/obscenity) (MIT, 0.4.6): its
  `RegExpMatcher` with `englishRecommendedTransformers` (Unicode
  look-alikes, leetspeak, repeated letters: `fuuuck`, `sh!t`, `ｆｕｃｋ`)
  and its whitelists (*Scunthorpe* is not a whole-word hit), over its
  `englishDataset` plus our own phrases for the mild and soft words and
  a few more slurs. Each phrase's `originalWord` maps to its tier
  (`FILTER_WORD_TIER`; an unlisted one is 25).
- **Buried stems (tiers 75–100)** are wave 48's matcher (look-alikes,
  `*` inside a stem), over three stem lists by tier.
- `filterHits(text, level = 100)`: the hits that strength catches, in
  order. `FilterHit` gains `tier` (its lowest) and `unsaid` (it holds a
  slur), and each stem `{ start, end, tier }`. A hit's range is the word
  (or words, for a phrase) its stems touch. Overlapping stems merge (the
  lower tier wins). A slur hit's `word` is always `UNSAID_WORD`
  (`"[slur]"`): the slur itself never leaves `filterHits`.
- `atLevel(hits, level)`: re-reads stored hits at another strength.
  `hitPoints(hit)`; `encodeHits` / `decodeHits(text, code)` (the journal
  form, C8).

## C8 The server

- **Only what a guest sent.** The filter runs on a guest's own
  `/api/guest/say`, never a director's play-as typing (`actingBy`), never
  `/api/mod/say`, a pick or a card answer, and never retroactively: moving
  the slider never re-reads old lines.
- **Strength.** `POST /e/:id/api/prime/filter {level}` (the censor's
  booth; 403 as for ✂; 409 doors closed; 400 `{error: "level is 0–100 in
  steps of 5"}`) journals `signal(swear_filter, <censor>, { level, was },
  <censor>)` (none when unchanged) and answers `{ ok, level }`. Restore
  replays it; a story restart is back to 100.
- **Flagging** at the current strength: `signal(swear_flagged, <guest>,
  { message, words, list, level, marks })`. `words` is the tally the
  report counts (words caught *at the time*); `marks` is
  `encodeHits(hits)`, so a restore rebuilds the line's hits from the
  journal, never by re-running a filter that may have changed.
- **The booth view** (`PrimeView.filter`) shows a flagged line only while
  the current strength still catches part of it (`atLevel`), with only
  those stems; the rest count in `muted`. Raising the strength again shows
  them again (they were caught at the time); it never flags new ones.
- **✂ Censor** censors the line's hits at the current strength (409
  `{error: "the filter no longer catches it"}` when none): masks them,
  scores them (C10) and journals `signal(swear_censored, <guest>,
  { message, words, list, fresh, unsaid, points, mult, stars, top,
  distinct, heat, heat_at }, <censor>)`. `list` / `fresh` never hold a slur: `list` says
  `[slur]`, `fresh` leaves it out and `unsaid` counts it. `top` is the
  five words censored most tonight (no slurs), most first. The answer:
  `{ ok, seq, text, points, mult, stars }`.

## C9 Slurs (automatic)

With a `censor:` header, a slur in a guest's line is starred **before the
line is stored**: the room, the booth, Run, Trabolta and the journal only
ever have `****`. It still pops up in the booth (at every strength,
tier 0) as `[slur]`, and ✂ still raises their suspicion and pays the most. The
report counts them (`unsaid`) and never names them; the TV draws a
redaction bar for each. Nobody has to hide anything by hand.

## C10 The ⭐ mini-game

Each ✂ pays `stars = floor(points × mult)`: `points` is the sum of the
censored words' band points (C7), and `mult` comes from the filter's
**heat**. Each ✂ adds 1 heat; heat cools 1 every `FILTER_COOL_MS`
(20 s). At a ✂, the notch is `ceil(heat now)` (capped at the last) of
`FILTER_MULTS = [3, 2, 1.5, 1, 0.5, 0.25]`: rested, she earns ×3;
censoring every few seconds slides to ×¼ (a 1-point *hello* then pays
nothing). Rarer, worse words at a lower strength pay best: that is the
game. No ⭐ after the ending (the story's rule).

## C11 The view (`PrimeView.filter`, the censor's booth)

```ts
type FilterTier = 0 | 10 | 25 | 50 | 60 | 75 | 90 | 100;
interface FilterLine {
  seq: number; guest: string; name: string; avatar?: string; where: string;
  text: string;                 // slurs already starred
  hits: Array<{ start: number; end: number; tier: FilterTier }>; // at the current strength
  words: string[];              // as shown; a slur is "[slur]"
  points: number;               // its base worth now (before the multiplier)
  ts: number;
}
interface FilterCombo {
  heat: number;                 // as of this view
  coolMs: number;               // 1 heat cools per coolMs
  mults: number[];              // by notch: [3, 2, 1.5, 1, 0.5, 0.25]
}
interface FilterView {
  flagged: number;              // words caught tonight, at the time
  censored: number;
  level: number;                // the strength now (starts 100)
  muted: number;                // waiting lines the strength no longer catches
  stars: number;                // ⭐ she has earned from ✂ tonight
  combo: FilterCombo;
  lines: FilterLine[];          // the newest 40 waiting, oldest first
}
```

The multiplier now (client side, from the view's arrival):
`mults[min(mults.length - 1, ceil(max(0, heat - elapsed / coolMs)))]`.

## C12 The story and the screen state

- **✂ no longer marks anyone** (this replaces C3's mark). It raises the
  program's suspicion, the story's `doubt` (the Antivirus' 👁 watchlist
  number): +5 a ✂, capped at 100. The guest gets an automated notice
  (`broadcast … to participant(program)`): their message was censored for
  language, with the words (`[slur]` for a slur), and it is logged. The
  booth's reply says how much suspicion they are at.
- `swear_filter` (the Password Manager's rule) sets `Night.lang_level`.
- `swear_censored` also adds `stars` to her score (`self.score`) and
  `Night.lang_stars` while the night is on, `unsaid` to
  `Night.lang_unsaid`, and sets `Night.lang_top = top` and
  `Night.lang_distinct` (unique words). `Night.lang_words` is gone: the
  TV takes every word from the server's book, and the spoken lines read
  only `Night.lang_top`.
- `ScreenNight.language` (still only while `award_language` is up):

```ts
interface ScreenLanguage {
  flagged: number; censored: number; curser: string | null; curses: number; // as before
  words: string[];   // every censored word once (never a slur), most censored first; ≤ 400
  counts: number[];  // times each was censored, same order
  more: number;      // unique words past the 400
  unsaid: number;    // slur words censored: draw a redaction bar each, never text
  level: number;     // the strength now
  stars: number;     // ⭐ the Password Manager earned from ✂
}
```

## C13 The booth (play)

- **⊞ Start → 🔑 Filter strength**, on the censor's Start menu only: a
  window with the slider (0–100, step 5) and what this strength catches
  (the band's examples; at 0 *Slurs only*, never listing one). It posts
  on release. Nothing else points at it (the pop-out, the tile and the
  tray never mention it): she has to find it.
- **Tiers on the line**: each highlight takes its band's colour; a slur is
  a `[slur]` chip over its stars.
- **The game**: the pop-out and the list show the line's worth and the
  live multiplier (a heat meter that visibly cools back toward ×3); ✂
  bursts *+n ⭐ ×m* from the answer. The list's header gains the ⭐
  tonight, and a note when the strength mutes waiting lines.
- Copy `DRAFT w48b`; still lazy with the booth (guest first load ≤ 149 kB).

## C14 The breach (terminal, `award_language`)

The wall of tiles becomes a containment breach, comic cosmic horror on a
computer terminal: every censored word comes out in a fixed time
(≤ ~20 s, from 1 word to 400 plus the redaction bars), the most censored
biggest, then a held summary (who cursed the most, *c of f censored*, the
strength, her ⭐). Slurs are redaction bars only. The walls (old Android
tablets) get a lighter version that holds its frame rate; reduced motion
gets a calm one; nothing flashes more than 3 times a second.
`?preview=language&lang=…` covers 0, 1, a dozen, hundreds and 400 + more,
with and without unsaid.
