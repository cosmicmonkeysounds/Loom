---
title: Cards & widgets — `show`
section: Live Shows
order: 36
keywords: show, widget, card, moment, major, minor, big, sides, doors, invite, invitation, tray, fact, file a fact, near miss, near, typo, judge, ruling, L1206, judging, verdict, key_answer, filed, confidence, slider, facts.json, answer key, accept, fold, judge_mode, auto, review, fact_filed, fact_judged, pick, random, captcha, security check, poll, picture, image, answer, free text, pickup line, answered, verify, game, media, minigame, booth card, inbox, thread, commas
---

The participant app can put more than text in a conversation. A **card**
is a small interactive thing — a CAPTCHA grid, a picture, a poll — that
the story deals into a room or a private thread with one statement:

```loom
show captcha "Select every square that contains a traffic light" to program with target: "traffic light"
show image "https://example.test/poster.png" to everyone with caption: "Tonight"
show poll "Ready?" to group(Antivirus) with options: "Yes | No | Never"
```

`show <kind> ["text"] [to <who>] [with k: v, …]`:

- **kind** is a lowercase word the app knows: `captcha`, `image`,
  `poll`, `tutorial`, `pass` (the guest's own QR, for the moment a
  performer needs to scan them — e.g. inside a `cutscene`, where the
  menu is out of reach), `fact` (file an answer to one of the night's
  questions: a picker from `questions: "H1: … | H2: …"`, a typed answer of
  up to 200 characters, and a **confidence slider** — *Please select
  your confidence level in this response*, 1–100, whole numbers), and
  `answer` (one free-text line — *Give me a pickup line* — with a
  **Send** button). An unknown kind still shows its text — an
  older app never hides a newer story's card.
- **text** (optional, quoted) is the card's caption / question.
  `{…}` interpolation works like a line.
- **to** is who sees it. Leave it out and it goes to whoever the
  surrounding text goes to (the bound `guest`/`program`, else `self`) —
  exactly like `reply`. `to everyone` is the whole room; a
  `broadcast`-style scope (`group(X)`, `location(X)`, `participant(X)`)
  or a bare bound name narrows it. `to <Character>` deals the card to
  that performer's **booth** (see below).
- **with** carries params the card reads: the CAPTCHA's `target`, an
  image's `caption`, a poll's `options` (split on `|`), the tutorial's
  `guide` and `bathroom` (a Bathroom Mode step, in your words), the
  answer card's `question` (the key it is judged against — **quote
  it**: `question: "P1"`), `max` (characters, default 200), `button`
  (the label, default *Send*) and `placeholder`. A comma (or the word
  *with*) inside a quoted value is just text — `caption: "Tonight,
  9pm"` is one param. Close every quote: an unbalanced `"` turns the
  rest of the line, `with` clause included, into text. `loomcheck`
  warns on an unbalanced quote and on an unquoted `question:`.

- **`moment: major`** (or `minor`) makes the card a **moment**: besides
  docking in its room it interrupts the guest at the story's alert level
  ([Live shows](live-shows.md)). **`moment: big`** takes the whole screen
  whatever the level, and the guest answers it right there (a `poll`,
  `captcha`, `answer`, `sides` or `invite` card; a `fact` card offers a
  button to its room instead); the window closes a moment after the
  answer, and an unanswered one comes back on a reload. Keep `big` for the
  card one guest must answer now (*Trapped in the Internet*: the bottle's
  Truth or Dare, Help or Thwart, the pickup line). Quoted or bare, either
  works. A `go:` param adds exits, as on a broadcast
  ([Broadcasts](broadcast-improv.md)).
- **`sides`** is the two doors: `show sides "🕚 SYSTEM CLOCK RESET. Two doors
  have opened in the computer." to program with moment: big` shows every
  joinable, revealed side as a full-screen door (its leader and its count
  toward `majority:`), *Walk in ▸* on each and *Neither*. Walking in is the
  switching join; the card then answers `{side}` (or `neither`) as `sides
  answered`. The text's first line is the kicker.
- **`invite`** is what a guest's recruit by pass sends the other phone
  (*Excel wants you in Unlimited Power* · *Join* / *Not now*); the server
  posts it, so a story never writes one.

On the guest's phone a card that waits for an answer docks in a **tray**
above the message box, one at a time, while the conversation keeps a
one-line receipt; once answered (or replaced, or closed) it settles into
one line where it was asked (*🛡️ Security check · submitted*). A
`pass` card stays whole on a `cutscene` stage.

Where it lands follows the same rule as a choice: a card shown right
after a character's line docks in that character's thread with the
guest; otherwise it plays in the enclosing beat's `setting:` room (else
the lobby).
`with thread: <Character>` pins the card to that character's thread no
matter who spoke last — handy for a card re-dealt from a rule with no
line before it.

**A card for a character.** `show poll "Approve?" to CRA Agent
Software` deals the card to that character's booth — its **Readouts**
room, or, with `thread: <Other>`, its private Cast thread with that
character. The performer answers it there, and the event fires *as the
character*, so only that character's own hooks and story rules hear
it. Inside the character's body the hook must bind a name — `when poll
answered for who:` — because the bare `when poll answered:` reads as a
verb with a parameter and never matches (`loomcheck` warns on it).

## Hearing the answer

A card that asks something answers as an ordinary **named event**,
`<kind> answered`, for the guest who answered, with the result bound as
arguments — so you handle it exactly like `fire … with …`:

```loom
ROLE Program
  captchas: 0 to 10 = 0
  when captcha answered for program:
    set program.captchas += 1
    if passed and program.captchas == 1:
      -> Login Incorrect
    else:
      -> Upload
```

| Card | Result names |
|---|---|
| `captcha` | `passed` (did they pick exactly the right squares), `picked` (how many), `target` |
| `poll` | `choice` (the option's text), `index` |
| `image` | never answers |
| `tutorial` | `completed` (they finished) or `skipped` + `step` (where they bailed), and `steps` |
| `pass` | never answers |
| `fact` | `question` (the picked id, e.g. `H2`), `answer` (the typed text — the one result field that may name a character, so "Clippy" is a fine wrong answer), `confidence` (1–100), `verdict` (added by the server's judge, below), and on an accurate filing `key_answer` (the key's answer as written) |
| `answer` | `text` (the typed line); with a `question:` on the card, `verdict` and `question` too |

Every answer also carries `card` (the card's message number) so a
restart knows it was answered; a result that tries to send its own
`card`, `verdict` or `key_answer` is refused.

## Judging with `facts.json`

A `fact` card — and an `answer` card dealt `with question: "…"` — is
judged by the **event server**, never by the story and never by a
model, against the project's `facts.json`: the one file the team edits
with every hunt question, its `answer` and the `accept` aliases. The
key stays on the server: the judge adds one word, `verdict`, on the
`fact answered` / `answer answered` event, and only on an **accurate**
`fact` filing also `key_answer`, the key's own `answer` as written (so
the story can read "Doctor Whiskers" back when the guest typed the
alias `dr whiskers`). A filing that misses never carries it, so the
answer to a question nobody got right never reaches the story:

| Verdict | When |
|---|---|
| `accurate` | the filed answer matches the key after folding, or after spelling out abbreviations on both sides |
| `lie` | no match, filed at confidence **100** |
| `uncertain` | no match, filed below 100 (an `answer` card always files at 100, so it is `accurate` or `lie`) |

**The fold** (`foldAnswer`, the same on both sides): Unicode-normalised
(NFKD, accents dropped), lowercased, apostrophes **deleted** (so
`you're` ≡ `youre`), every other run of non-alphanumerics becomes a
space, and one leading `the` / `a` / `an` is stripped. *The Y2K Bug*,
`y2k bug` and `Y2K-BUG!` are the same answer; list genuinely different
wordings under `accept`. If that misses, the judge takes a second exact
look with **abbreviations spelled out** on both sides: *Mr.* / *Mrs.* /
*Dr.*, *yr(s)*, *ext*, *hr(s)*, *min(s)*, *sec(s)*, and a leading-zero
clock time (*0730* reads as *7 30*). So *Dr. Whiskers*, *12 yrs* and
*extension 4410* are simply accurate, with no ⚠.

**Near misses.** An answer that doesn't fold to the key but is close to
it is a **near miss**, and it is never judged a lie or a guess by
itself. Close means, after folding: honorifics dropped (*Mr*, *Mrs*,
*Mister*…), number words read as digits and thousands separators
joined (*one thousand two hundred*, *1,200*), plurals folded, the same
words in another order, and small typos checked word by word — a word
of 1–3 letters must match exactly, 4–7 letters may be one edit off, 8
or more two, and a misspelled word keeps its first letter. A right
answer **said at length** is near too: every word of the key, in order,
plus up to four more (*12 years ago* for *12*, *Doctor Whiskers the cat*),
unless an extra word turns it around or hedges (*not*, *never*, *or*,
*but*…), adds an am / pm the key leaves open (*7:30 pm* for *7:30*), or
is a lone letter (*Chapter B* for *chapter*). Numbers and am / pm must
match exactly, and a plainly wrong answer at 100 is still an automatic
lie. *Dr Whiskars* for *Doctor Whiskers* and
*Mosiac* for *Mosaic* are near; *Chapter B* for *Chapter Q*, *7pm* for
*7:30 a.m.* and *did work* for *didn't work* are not. In
`auto` mode a near miss takes the `review` path for that one filing: it
is **proposed accurate**, waits on Run → Mind's Judging card tagged
*⚠ near "<key>"*, and the server adds a line to the staff room (*⚠ Near
miss, not an exact match: X's Q2 filing "Dr Whiskars" is close to
"Doctor Whiskers", so it is proposed accurate and is credited if nobody
judges it.*). If nobody judges it before the round settles, the
proposal stands: the filer is credited. Real but different answers can
be near too (*Mrs Whiskers* for *Doctor Whiskers*: honorifics drop).

**A judge for near misses.** A header line `judge: <Character>` names a
`mind: external` character who rules on them, so a director doesn't
have to (*Trapped in the Internet* has `judge: Trabolta`). In `auto`
mode, when a worker voicing it is online, each near miss goes to that
worker at once: one model call that sees the question, the key and the
filed answer, nothing else, and answers *same* or *not*. *Same* →
accurate; *not* → a confident lie at confidence 100, else uncertain. The
verdict lands through the same confirm event a director's button fires,
so the story reacts as it would to a host. The staff-room line then
says *… asked Trabolta to rule* and his ruling follows (*🤖 Trabolta
ruled X's Q2 filing "Dr Whiskars": the same as "Doctor Whiskers"
(accurate).* and his reason). A director can still override it on the
Judging card. With no worker online the near miss waits as above, and
the settle credits it if nobody judges it. A `judge:` that names no
`mind: external` CHARACTER is lint `L1206` and judges nothing. In
`review` mode nothing goes to the character.

The verdict is journaled with the filing, so a restart replays the same
verdicts whatever changed since — the key, the mode, the code. The
story decides what a verdict *means* (credit, a sticky lie, marking the
program):

```loom
when fact answered for program:
  if verdict == "accurate":
    set program.truth += 50
    broadcast "✅ {program.name} filed {question}: {key_answer}." to channel(hosts)
  else if verdict == "lie":
    set Kernel.lied = true
  else if verdict == "uncertain":
    fire mark_for_reinstallation for program with reason: "was not sure of an answer"
  else:
    broadcast "📝 {program.name}'s filing could not be judged (no facts.json)." to channel(hosts)
  show fact "📝 File a fact" to program with thread: Trabolta, questions: "H1: … | H2: …"
```

**Mode.** `Night.judge_mode` is a world variable: `auto` (the default —
every filing gets its verdict at once) or `review` (the verdict is a
*proposal*: the story posts it to the hosts, who confirm or override
it with a performer button per verdict — the events named in
`facts.json`'s `judge.confirm`, `fact_accurate` / `fact_lie` /
`fact_uncertain` — or the director does from Run → Mind's **Judging**
card, [the mind debugger](mind-debugger.md); when the round closes,
the story settles whatever is still pending by the proposal). Switch it
with `set Night.judge_mode = "review"` in the story or from the Judging
card; `judge.mode_var` in `facts.json` names a different variable.

**Who filed what.** On the Judging card, **▸** on a question's tally row
opens its filings, oldest first: when the server saw it, who, the
answer, the confidence, the judge's proposal and the outcome — *kept*
(the proposal stood), *overridden* (**↺**: settled as something else),
*marked* or *pending*. The time is when the server first saw the filing,
so a restart or a pushed draft re-stamps every one; whether a kept
proposal was settled automatically or confirmed, and by whom, isn't
recorded. Each row has its own ✅ / 😤 / 🤷 to override that filing, in
either mode ([the mind debugger](mind-debugger.md)).

**Talking to the judge's ledger.** Three `do` verbs keep the Judging
card's tallies and let the story draw a name:

- `do fact_filed {program} {question} {confidence} {verdict} {answer}` —
  the story accepted this filing.
- `do fact_judged {program} {question} {verdict}` — the filing is
  settled: `accurate` / `lie` / `uncertain`, or `marked` for a guess
  settled at a reveal.
- `do pick <event> from [id, id, …] else <other event>` — the server
  picks one person at random from the list and fires `<event>` for
  them (journaled, so a replay picks the same one); with nobody in the
  list it fires the `else` event. Loom has no random pick of a person
  on its own. Build the list with a comprehension:
  `do pick bottle_landed from {[p for p in Persons where p.cleared == true]} else bottle_empty`.

**Refusals.** A filing with no question picked, an empty answer, a
confidence outside 1–100, or a question the key doesn't know (while a
key is loaded) is refused — the phone sees a 400 and nothing fires. A
local-folder rehearsal has **no judge**: `fact answered` arrives
without a `verdict`, so give the rule an `else:` that says so
([run mode](run-mode.md)) and rehearse the hunt on a server project.

Each filing deals a fresh card, and the guest's reply should read the
same whichever verdict it got — a program may file every open
question, one filing per question.

## The guided tour: `show tutorial`

```loom
== Orientation
  setting: The Desktop
  cast: Clippy
Clippy: Hi there, {program.name}! It looks like you're new to the computer. Would you like help with that?
start quest Orientation for program
show tutorial "Clippy's orientation" to program with guide: "Clippy"
```

`tutorial` is the app's own walkthrough of itself — a spotlight over the
real controls (the rooms list, the guest's card, the Codex, People, their
pass), one step at a time, with the `guide` named on the callout. It
covers the whole app until finished or skipped, so deal it once the
arrival scene is over (after a `cutscene` location lets go — see [Live
shows](live-shows.md)). Steps the story doesn't use are left out (no
Codex step without a codex; a Wallet step only when the story declares
a [currency](currency.md)). `with bathroom: "…"` adds a **Bathroom
Mode** step over the pass, in your words — *Trapped in the Internet*
tells programs to tap 🚻 before they step out so the Antivirus know
they are not hacking the Internet. Either outcome comes back as
`tutorial answered`, so skipping can mean something:

```loom
when tutorial answered for program:
  if skipped:
    set program.doubt += 10
    Norton Anti-Virus: {program.name} declined orientation. Logged.
  else:
    unlock The Orientation List for program
```

Each guest answers a card once; the app keeps a submitted card visible
with what they answered. A bank (a game-engine build) passes `show`
through as a host verb, so an engine can render its own card.

*Trapped in the Internet* uses this for the Optical Drive (the mud room): solving the
CAPTCHA proves you are human, and humans are not permitted — INCORRECT,
try again. See `core/examples/trapped-in-the-internet/beats/login.loom`.
