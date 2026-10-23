# loom-stagehand

The bridge between a live Loom event (the `@loom/core` event server) and
everything that isn't a phone: projection machines, props and sensors,
and characters voiced by a language model. One daemon, one YAML per
machine, **modules** switched on by section:

| Module | Section | Runs on | Does |
|---|---|---|---|
| **show** | `show:` | the house Mac | story → OSC/MQTT cues; MQTT sensors → story mutations |
| **agents** | `agents:` | the house Mac (Ollama) | answers every conversation with a `mind: external` character through a local model |
| **alexa** | `alexa:` | (retired for the show, wave 18b) | MQTT `show/announce` → a chime + the Mac's own `say` voice on a named CoreAudio device + channel map (`engine: server` opts in to `/api/mod/tts`, cached on disk). The router speaks the show's announcements now; the module stays for a house that wants a player of its own |
| **audio** | `audio:` | the house Mac | the house speaker router: the event's `audio.json` (speakers, zones, the interface's input→output matrix) on one stream (the show's MOTU 828x + an ADAT expander); every story `sound X` per room, the house announcements, the map editor's speaker tests and Run's ■ Stop house sounds. The show switches both on (wave 18b) |
| **lights** | `lights:` | the house Mac | the house lights from the event's `lights.json` (wave 20): every story `cue <look>` it defines → timed, safety-clamped Zigbee2MQTT / WLED commands; the map editor's identify / test / *Pair new device*; Z2M's device list to the server; a catch-up from the story's screen state |

All five can run on one machine (the show runs four on one house Mac:
`show`, `audio`, `lights`, `agents`); they run as **separate launchd jobs** (see
*launchd* below).

```
trapped.house.yaml (the house Mac)     laptop.yaml (same Mac, the agents job)
  server: {url, event, code}             server: {url, event, code}
  show:   {mqtt, cues, sensors}          agents: {llm, characters}
  audio:  {sounds_dir, play_sounds, announce, mqtt, …}
  lights: {mqtt, z2m_base, config_file, …}
```

Every module shares the process's one authenticated link to the server
(`modapi.ModClient`). A module is a subpackage with a `build(section,
base_dir)` factory registered in `module.py::REGISTRY`, so adding a job
(vision workers, the VR feed, …) never touches the others. A crashed
module is restarted without taking its neighbours down. Machines only
dial **out**, so nothing has to be reachable from the internet.

Design: [`docs/loom-show-control.md`](../docs/loom-show-control.md).

## Run

```bash
cd stagehand
uv run stagehand modules                          # what exists
cp agents.example.yaml laptop.yaml                # or show.example.yaml → desktop.yaml
uv run stagehand check --config laptop.yaml       # validate + describe
uv run stagehand run   --config laptop.yaml       # -v for debug logging
uv run stagehand run   --config all.yaml --only agents   # one module from a bigger file
```

## agents — characters with a language model for a mind

In the story, mark the character `mind: external` (and `listed: true`
so guests find it in People). The server then turns every conversation
with it into an **agent request** and streams those to connected
workers. Nobody else answers those threads:

- a guest's DM (`dm:<Character>`),
- a performer's private **Cast** thread with it (`cast:<Character>` in
  the booth; the server stores it as `dm:<Character>` with audience
  `@<Performer>`),
- a director's rehearsal persona speaking in its DM from the editor.

The request carries everything needed to answer: the thread so far, who
is talking (guest or performer, their group, location, variables, and
codex), the character's own variables with their declared ranges and
its codex, global world facts, and the character's **powers**. The
worker answers `{say, adjust, acts}`. The server commits the line as a
journaled `say`, clamps each adjustment to the story's declared range,
and carries out each act as an ordinary journaled mutation. The story's
own `when` watchers decide what the numbers mean.

While a reply is being composed, the thread shows "Trabolta is typing…".
The server keeps **one open request per thread**. If someone sends
three lines while the model thinks, the agent answers once, then once
more with the whole burst. Requests queue while no worker is online
(People shows the character as "away"), re-dispatch if a worker drops,
time out after 2 minutes (one retry), and are cancelled by a run
restart.

### Two minds: `mind_mode`

The worker keeps a character's mind one of two ways, picked by one line
in its YAML:

- **`mind_mode: new`** — the **story mind** (wave 12, below): one voice
  call per guest line, and plain code keeps the mind off the story.
- **`mind_mode: classic`** — two models: the voice plus an orchestrator
  that grows the mind between turns (*Classic: the voice and the mind*,
  below). **An absent `mind_mode` is classic**, so a YAML written before
  wave 12 keeps the mind it had.

### The story mind (`mind_mode: new`)

The story already knows where the night is, so the worker reads his
state off the story and spends the one model it loads on the line in
front of a guest. The orchestrator is never started (its YAML section
stays, for the way back) and the second model can be unloaded.

```
  request ──▶ the person card + the phase card (code, no model)
              │
              ▼  one gpt-oss call (+ at most one retry)
            {say, adjust, act?, memo?}
              │  guards (code): never · answer words · invented facts ·
              │  unsaid names · catchphrase ration · repeats · memo scrub
              ▼
            POST /api/agent/reply {say, adjust, acts}
              │  the memo onto that person's file; mind.json saved
              │  (≤ once per 2 s) and mirrored only when it changed
```

What runs when:

| When | What happens | Model calls |
|---|---|---|
| a guest line | the voice call (`agents/voice.py`, the **lean** layout) | 1 (+ a rare retry; + a one-token warm call, `warm_head`) |
| `Night.phase` changes | the phase watch (a facts fetch every `phase_poll_s`, no model) applies the mind file's card: stage, favours, drives, live powers, `tell` list, brief — one revision `by: story` | 0 |
| a conversation goes quiet (≥ 3 turns, then 120 s idle) | the **quiet summary**: one call on the voice model condenses that person's memos into a few lines (thought kind `summary`, trigger `quiet`). Never while a request or a ruling waits, never asleep or after a finale | 1 |
| a director presses **Rewrite brief** | one voice-model call rewrites the brief from the phase card, the whispers and a digest built in code (thought kind `brief`); it holds as `by: director` until the next phase | 1 |
| a filing that is not an exact match | the judge (below; wave 18b: every non-exact filing, queued one at a time behind the voice) | 1 |
| an empty house, asleep, after the ending, paused, a timer tick | nothing | 0 |

A guest line or a ruling always goes first: a summary, a Rewrite brief
or a director's re-run that is running is cancelled and runs again once
the worker is idle; a story restart drops one in flight.

**The prompt is ordered for Ollama's cache** (`voice.py`): `[P1]` the
persona, the power catalogue (descriptions, no counts) and the reply
protocol — the same bytes all night, whoever speaks; `[P2]` the night
now: stage + its stage card, favours, drives, the powers live in this
phase, the wary list, the files the card lets him tell in full, the
brief; `[P3]` this call: the person card, *since you last spoke* (up to
4 things that moved in the house since their last turn), what the house
posted in this thread as him, ALREADY SAID (his last lines to them; his
openers elsewhere tonight, as a warning), his lore titles, the
whispers, the situations that hold; `[P4]` the last 8 lines of the
thread with the story's lines taken out; then a closing note naming his
stage card (and a situation that holds, which outranks the brief), his
last line to them, and the format reminder. gpt-oss's sliding-window
cache keeps checkpoints only near a prompt's end, so a one-token call
with P1 + P2 alone goes first (`voice.warm_head`, `api: ollama` only):
K-04 measured the prompt read at ≈ 1 s instead of ≈ 5 s.

**The person card** (`story_mind.py`) is built in code: their name and
turns tonight, the story's own `trust` for them, what they gave him
(codex titles), what they filed (question ids only), whether they are
marked, their Trust Chart place (from the server's `recent`, below),
the **first-met** line (pinned, so a file is never empty), their last
6 **memos**, the quiet summary, and his last lines to them. Another
person's memos never reach the card, and a memo written at his heart
reaches the voice only while that person stands there. The reply's
`memo` is ≤ 140 characters in his own first person; the scrub keeps its
topic and loses any answer word or verdict, and a `never` word drops
it.

**The guards** (`guards.py`), in order, before a line goes out (the
voice thought's `note` names each one that fired, never the word):

1. **never** — a `secrets.never` word (the door code, a patch-bay pair,
   the pickup line) in the line → the fallback; in an act or the memo →
   dropped.
2. **answer words** — a hunt answer word the guest never typed in this
   thread (and the phase card's brief or his own house-wide lines didn't
   bring up) → the fallback. **2b, invented facts:** a sentence that
   hands over, offers or sells a fact, says where one is (a house room,
   *the X*), counts the facts left, or states a hunt topic's answer is
   cut; nothing left → the fallback, never retried. **2c, unsaid
   names:** a persona `unsaid:` name (Sandy, until the story says it)
   is cut.
3. **the catchphrase ration** — a persona `catchphrases:` line is his
   only at first contact, and only on a `catchphrase_stages:` stage;
   elsewhere it is cut.
4. **repeats** — a line that shares half its 4-word runs with what *this
   guest* heard from him (his last 3 lines to them, his replies in the
   thread, the story's lines there) gets **one** retry, quoting what they
   said and his stage. In a burst (another line already waiting) there is
   no retry; sentences they heard word for word are cut instead, and a
   retry that still repeats goes out with those cut. Lines said to other
   guests are a prompt warning only.
5. **the memo scrub** (above).

A fallback in the story mind is a dead-air line from the persona's
`fallbacks:` for his stage that this guest has not heard, else
`fallback:`. With phase cards he hands over only what the card's `tell`
lets him (`act dropped (not shareable now)`; none while favours are
`none`), and a power described as for *another program* aimed at the
speaker is dropped (`act dropped (aimed at the speaker)`).

**The story's lines are his history, not his voice.** The server tags
each thread line the story posted (`story: true`, wave 12 lane S), so
receipts like *Filed for Q1 · +50 Truthcoin* leave his turns and appear
once, as *the house posted here as you*. A line the story posted as him
counts as heard: copying it is a repeat, and its greeting uses up his
catchphrase.

**What the server adds to each request** (`core/server/agent-recent.ts`):
`recent`, at most 6 items from the last 10 story-minutes that concern
him and this speaker — a gift (title, new to him or not), his last 2
house-wide lines, this speaker's filings (question ids), the mark, their
Trust Chart rank — plus `storyAt`. A hunt-answer entry, a secret entry,
a line naming an answer form or a secret character's current value never
rides it. The guest's codex arrives as titles only. `LOOM_AGENT_RECENT=off`
on the server sends the wave 11b request field for field.

**The guest's night at his heart** (wave 20, D26 / D27): when the speaker
is a guest standing at his heart (`at_the_heart`), the server adds
`dossier` (`core/server/agent-dossier.ts`, ≈ 3 KB, never a secret: their
name and program, minutes here, side, marked / captured / reinstalled, his
Trust Chart score and rank, their truths counted, filings as ids + verdicts,
non-secret file titles, quests, rooms in order, Bingo, the bottle, their
wallet, the files they gave him, the heart's layer / suspicion, their last
lines to him, short moments of their night). Both layouts render it as a
`=== WHO THIS IS — TONIGHT ===` block (classic: after the live state; lean:
in P3, after the person card, so the cached P1 / P2 never move). No dossier
→ the prompt is byte for byte what it was. `LOOM_AGENT_DOSSIER=off` on the
server sends none.

**The YAML** (`agents.example.yaml`; each switch `on | off`, read only in
`mind_mode: new`):

```yaml
agents:
  mind_mode: new
  voice:
    memo: on               # the ≤ 140-character note per person (off: no memos, no summaries)
    repeat_guard: on       # the one retry (off: one call per line, always)
    dossier_on_close: on   # the quiet summary
    warm_head: on          # the one-token cache warm before each line (api: ollama)
    layout: lean           # lean | classic (today's prompt inside the new mind)
  mind:
    stage_from_phase: on   # the phase cards set stage / favours / drives / powers / brief
    phase_poll_s: 30       # the phase watch's facts fetch (0 = off)
```

An unknown key under `voice:` or `mind:` is a config error. `stagehand
check` prints `mind: NEW (one voice call per line) · layout … · memo … ·
repeat guard … · quiet summary … · warm head … · phase cards … · phase
watch 30s` and, per character, its phase cards, stage cards and
catchphrases; a phase card with an unknown key, an undeclared stage or
drive, or a `never` word in its text exits 2.

**The kill-switch ladder**, smallest first (a YAML edit, then
`uv run stagehand launchd restart --job agents`; a restart flushes the
mind's pending save):

1. `voice.memo: off` · 2. `voice.repeat_guard: off` · 3.
`voice.dossier_on_close: off` · 4. `mind.stage_from_phase: off`
(directors step the stage by hand) · 5. `voice.layout: classic` · 6.
`mind_mode: classic` (the whole classic mind; the orchestrator's model
loads again, ≈ 25 s at its first reflect) · 7. on the server,
`LOOM_AGENT_RECENT=off` (a server restart: before doors only) · 8. the
previous release tag. **What classic keeps:** wave 12's survey guard
(below), the debounced saves, the change-gated mirrors and the stored-
once prompt prefixes. Only a release tag removes those, and a rollback
reverts the **whole** checkout: an older worker refuses the wave 12
persona file (`catchphrases:` is an unknown key to it), so it never runs
against a newer show tree.

### Classic: the voice and the mind


```
  request ──▶ FAST PATH (gpt-oss:20b, low effort, seconds)
              persona + MIND + live state + powers → {say, adjust, lookup?, act?}
              │  "lookup": ["Excel"] → one more call with the session's cards
              ▼
            POST /api/agent/reply {say, adjust, acts}
              │
              └──▶ (between turns) ORCHESTRATOR (Qwen 3.8 distill, think off,
                    Ollama native API, ~10–30 s, preempted by any new request)
                    reflect: rewrite the brief · dossier on the speaker ·
                             learned claims + verdicts · thread summary
                    survey:  every 120 s — the whole house, what changed
                    → mind saved to state_dir → POST /api/agent/mind (directors)
```

The **fast path** never waits for the orchestrator. A `lookup` (the
model asking the live session about a program, room, or lore) costs one
extra fast call — the "snoop" case. An empty or truncated answer is
retried once with double the token room, so a guest never gets silence
for a model hiccup.

The **mind** (`agents/mind.py`) is a set of dictionaries the orchestrator
fills: `brief` (second-person instructions to the actor for *right
now*, including the current bargain policy), `mood`, `notes` (what the
character has decided / noticed), `people` (a dossier per person:
summary, trust 0–100, claims they made, favours they asked, promises
made to them), `learned` (every claim fed to it with a verdict — the
director sees the story's whole codex as ground truth; the character
only knows what it holds), `threads` (a rolling summary once a thread
passes `summarize_after` lines: the fast model then sees the summary +
the last `thread_window` lines while the guest still sees everything —
a long chat is compressed, never reset), and `world` (what it last
noticed about the house). It persists under
`state_dir/<event>/<Character>.mind.json`, so a worker restart forgets
nothing; a run restart (`reset`) empties it. Directors see it as
`ModView.minds`.

**Pacing:** a guest who has monopolised the character (24+ turns) gets
shorter answers and an errand — deterministic, not up to the model.

**The survey guard** (wave 12, lane A0; classic only, since the story
mind runs no survey): a timer or stream-hello survey is skipped while
the event is paused (`/api/agent/facts` `paused`), while the persona's
`when:` gate is closed over world paths and the character's own vars
(Trabolta asleep; a gate that reads `them.` or `speaker.` never counts
as asleep), after a `finale_*` phase, on an idle house (no line, no
whisper, no change and the same phase since the last survey that ran)
and when its input is the same as the last one's. Each skip is one debug
line (`stagehand -v`) and no thought. *What changed since you last
looked* is measured from the last survey that ran, so a change during a
sleep or a pause is reported when he wakes. `survey_every_s: 0` turns
off the timer and the hello survey; a director's Survey now or nudge
still runs, and a queued director survey keeps its place over a hello or
a timer (director > phase > timer / hello).

### The shape of a night: stages, drives, policy, questions

A mind file (`mind: trabolta.mind.md` in the persona) may open with a
frontmatter block that gives the mind **structure the orchestrator must
fill** — so the way the character changes is declared, steerable, and
visible, not buried in prose:

```yaml
---
stages: [lonely grandeur, appetite, the question, the turn]   # the arc, in order
drives: { hunger: 40, suspicion: 55, generosity: 10, resolve: 30 }  # 0–100, opening values
phases:                                   # an authored cue per Night.phase …
  free_roam: "The glitch. The house is open and he has just revealed himself…"
  destruct:                               # … or a phase card (wave 12)
    stage: the turn
    favours: earned                       #   none | earned | loose
    drives: {resolve: 70}                 #   merged over the previous card's
    powers: [snoop, flicker_the_screens]  #   live in this phase
    tell: [The Unified Field Theory]      #   files he may hand over / tell in full
    brief: >-                             #   the story mind's brief (never inherited)
      Three keys have turned. You feel it…
    cue: "Three keys have turned. He feels it…"   # the classic orchestrator's cue
  _stages:                                # one card of text per stage: how he sounds there
    the turn: >-
      Short sentences. Nothing hidden any more.
secrets:                                  # a hunt he must never be able to check
  topics: [billboard, pet cemetery]       #   the questions' words (he is told never to judge these)
  match: [captain whiskers, twelve years] #   answer words (never shown to any model)
  lore: ["▒ HUNT ANSWER"]                 #   codex entries holding this are hunt answers
---
You are the DIRECTOR OF THE MIND of Trabolta…
```

- **`stage`** — where the character is on its arc. The orchestrator sets
  it every pass, moves it *forward* on evidence with a `stage_why`, and
  every move is kept in `stage_history` (the night reads as chapters). A
  name that isn't a declared stage is refused, never invented.
- **`drives`** — the mind's own dials, distinct from the story's
  variables the voice nudges (`truth` / `untruth` / …). Every revision
  snapshots them, so their path through the night is a sparkline.
- **`policy`** — the bargain policy as structure: `favours` `none |
  earned | loose`, `credit` (who has earned something), `wary` (who
  lied), a note. The voice's prompt states it plainly.
- **`questions`** — the open questions the character is collecting
  answers to (its obsessions), each with the answers gathered so far and
  who gave them.
- **`secrets`** — answer secrecy (`agents/secrets.py`). Every orchestrator
  output is scrubbed before it reaches the mind: a `learned` claim that
  names a topic or match word is dropped whole (no verdict is ever kept,
  so the voice can never tell a true answer from a confident lie), and a
  note, brief line or dossier entry that *judges* one is dropped too; the
  trace's result lists what was `suppressed`. Codex entries carrying a
  `lore` marker never reach any prompt — text *or* title, since a title
  can be the answer (ground-truth lore, held lore, what the speaker holds,
  lookup cards, the house digest, the survey delta) — and a restored mind
  is pruned on boot. Keep `topics` to specific phrases (a common word
  like "song" drops every claim that uses it) and never an answer word:
  topics are printed into the orchestrator's prompt. **`never`** (wave 7
  review) is stricter: words no line of the mind may carry at all,
  whoever typed them — the show's keypad code (`facts.json` `door.code`)
  and its digits said one by one, the four digit notes' unlock codes and
  "first digit" … "fourth digit", and every patch-bay pair. (A code that
  is a year also gets the ways a year is said — "'NN", "in / since NN",
  "in / since / of" and the two digits in words, the year in words — but never the bare two digits, which a guest's
  program may be called. Since wave 11b the show's code is no year.) A
  pair matches in any spelling and either way round (`V2 → D5`,
  `v2-d5`, `V-2 to D5`, `D5 to V2`); an all-digit word of 3+ digits
  allows a space, comma or hyphen between digits (`1 2 3 4`, `1,234`)
  but never a dot (`$12.34` is a price); a phrase of number words
  matches in any spacing or hyphens ("one two three four"). The
  mind is shared by every conversation, so an update
  item, brief line or dossier field carrying one is dropped (no verdict
  needed), a restored mind is pruned of them, a voice line carrying one
  is replaced by the persona's `fallback`, and an act whose args carry
  one is dropped. A `never` drop reads `secret · …` in the trace's
  `suppressed` list, and the log counts the two kinds apart:
  "suppressed 1 hunt verdict(s), 2 secret(s) (door code / combo)" on a
  reflect, "dropped restored 7 secret(s) (door code / combo)" on boot.
  The show's list is generated by `titi:facts` from
  `facts.json` `door.code` and the story's `set Kernel.combo_*` seeds.
- **`phases`** — when the house enters a phase (`Night.phase` in the
  facts delta), the orchestrator's survey is handed the author's cue for
  it; a reflection always sees the current phase's cue. Since wave 12 a
  phase may be a **card** (`persona.py` `parse_mind_table`): exactly the
  keys `stage`, `favours`, `drives`, `powers`, `tell`, `brief` and
  `cue`, read in file order, a missing key inherited from the previous
  card (`drives` merge over it; `brief` never inherits); a bare string
  is a card with only a `cue`. The story mind applies the card; classic
  reads its `cue` and treats its stage as the floor. `_stages:` holds a
  card of text per stage.
- **`director`** — whispers from the control panel (a *nudge*): the
  voice obeys them at once ("THE DIRECTOR WHISPERS"), the next
  orchestrator pass folds them into the brief and clears them.
- **`revisions`** — every change to the mind is numbered: who made it
  (`reflect` / `survey` / a director's name / `reset`), what it touched,
  the thought that produced it, and the small fields as they then stood.

The whole mind (not a summary) is mirrored to the server, with the
worker's status (models, reasoning on/off, paused, queue; since wave 12
`mindMode`, `phaseWatchS`, `stageFromPhase` and the voice switches) —
`POST /api/agent/mind` → `ModView.minds`. Since wave 12 (in both modes,
`agents/wire.py`) a mirror goes only when the mind actually changed, at
most once every 2 s per character, carrying the last 40 revisions (the
file keeps 60 in the story mind, 300 in classic); a director's control or
a reset shows at once, and a quiet house sends none. `mind.json` is
written the same way (trailing, ≤ once per 2 s); a clean stop, a
reconnect or a launchd restart (SIGTERM now stops every module through
its `finally`) writes anything pending. A story-mind report carries
`mode: "new"`, the `phase`, `briefBy` (`story` / `director`) and, per
person, `memos`, `firstMet`, `gifts`, `filings`, `marked`, `chart` and
`storyTrust`; `learned`, `world` and `questions` are empty.

### The trace and the control panel (the Mind page)

Every model call is recorded as a **thought** (`agents/trace.py`): the
messages exactly as sent, the model's **reasoning** when the API exposes
it (gpt-oss's `reasoning`, Ollama's `thinking`, an inline `<think>`
block), the raw output, why it stopped, token counts, wall time, what
the worker parsed, and — for the orchestrator — the diff it made to the
mind and the revision number. Kinds: `voice`, `lookup`, `reflect`,
`survey`, `rerun`, `judge`, and (the story mind) `brief` (a Rewrite
brief) and `summary` (the quiet summary), plus `reset` / `control` /
`error` markers. A thought carries `prompt_ms` (Ollama's prompt
evaluation time; null on the OpenAI dialect). The voice's long first
system message (P1) is stored once: later thoughts carry `[same prefix
as th-…]` instead, and the Mind page fetches the holder by id. A thought
the server answered `accepted: 0` never becomes a holder. Thoughts
append to `state_dir/<event>/<Character>.trace.jsonl` and stream to the
server (`POST /api/agent/trace`). On (re)connect the worker replays only
the thoughts newer than the stream hello's `traceAfter` (the newest the
server holds), in batches of at most 40; against an older server, or
after a failed post or a server whose trace restarted under the stream,
it replays the last 40, the first with its full prefix. The
editor's **Run → Mind** page draws all of it: the arc, the drives'
sparklines, the brief, policy, questions, dossiers, the revision log,
and the trace with a per-thought view of input / reasoning / raw output
/ parsed result / mind diff.

The page's **control panel** sends `control` frames down the worker's
stream (`POST /e/:id/api/mod/agent/control` → the worker's
`Agents.control`). The server's own story restart sends the same
`{action: "reset"}` frame, so a restart and a hand reset are one code
path:

| action | payload | effect on the worker |
|---|---|---|
| `reset` | `reason?` | every mind back at the doors (stage 1, drives at their opening values, nothing learned); queue dropped; a `reset` marker in the trace |
| `survey` | — | the orchestrator looks at the house now (the story mind treats it as `rewrite`) |
| `rewrite` | — | the story mind: one voice-model call rewrites the brief, kept `by: director` until the next phase, whispers cleared (classic treats it as `survey`) |
| `nudge` | `text` | a whisper: shown to the voice at once, folded into the brief by the survey this queues, then cleared (the story mind queues no survey: the whisper stays until the next Rewrite brief or phase card) |
| `set` | `field` = `brief` / `mood` / `stage` (+`why`) / `drive` (`name`, `value`) / `policy` (object) / `trust` (`person`, `value`) / `note` (`add` / `drop`) / `question` (`add` / `drop`) | a direct edit, applied through the same bounded merge as an orchestrator update, recorded as a revision by the director |
| `forget` | `person` | drop the file on someone |
| `thinking` | `on` | the orchestrator model's visible reasoning on/off (Ollama `think`) — the trace then shows Qwen's thinking; off is faster |
| `effort` | `level` `none` / `low` / `medium` / `high` | the voice model's reasoning effort (gpt-oss) |
| `pause` | `on` | freeze the mind: replies keep coming, jobs queue, nothing runs |
| `rerun` | `thought` | send a recorded call's messages to the model again (as configured now); the answer is recorded as a `rerun` thought and never applied |

Every control is acknowledged by a re-mirrored mind and a `control`
marker in the trace naming who did it. A control that changes nothing
(a `set` to the current value, `pause` / `thinking` / `effort` as they
are) answers `{ok, note: "no change"}` and writes no revision, thought,
save or mirror. In the story mind a director's `set brief` drops any line
naming a hunt answer, a `never` word or a verdict, and Re-run refuses a
classic `reflect` / `survey` thought (it needs the orchestrator's model:
flip `mind_mode: classic` to re-run one).

### Powers, lookups, bargains

A story declares what the character may *do* with `INTERACTION … who:
agent` (+ `limit: N` per run). The request lists them with uses left;
the model may answer with `"act": {"fire": "cut_the_lights", "args":
{"room": "The Start Bar"}}` or `"act": {"share": "<lore it holds>"}`. The
worker validates (declared? uses left? held?) and canonicalises args
against the session (`"the kitchen"` → `The Start Bar`, a name → a program
id); the server validates again, then fires the event *as* the
character (only its hooks hear it) or shares the entry. Everything is
journaled and shows up in the director's log. The persona's `bargain:`
text is the policy the fast model reads; the orchestrator tightens or
loosens it in the brief as the night goes.

```bash
ollama pull gpt-oss:20b tobestyledintro/qwen3.8-9b-distill:q8_0
uv run stagehand ask --config laptop.yaml                  # chat with the persona, no server
uv run stagehand ask --config laptop.yaml --reflect        # …and watch the mind grow after each line
uv run stagehand ask --config laptop.yaml --reflect --power cut_the_lights --var love=80 "Do you love Sandy?"
```

The persona file (`core/examples/trapped-in-the-internet/trabolta.persona.md`)
is YAML frontmatter + the system prompt:

| Key | Meaning |
|---|---|
| `character` | the CHARACTER as declared (required) |
| `variables` | the numbers it may nudge (Trabolta: `truth, untruth, composure, love, regard`) |
| `max_step` | ±cap per variable per reply (default 15) |
| `facts` | world path prefixes to show it, in the voice and in the orchestrator's digest, delta and reflect state alike (the phase is always shown; Trabolta lists exact `Night.*` names, never the bare `Night.` and never `Kernel.`: the show keeps its secrets on `Kernel`) |
| `them` | the speaker's variables to show it (default: all) |
| `when` | a gate over `self.<var>`, `them.<var>`, `speaker.kind`, world paths |
| `unavailable` | what it says while the gate is closed (else silence). With **no worker online at all**, the event server says the story's `CHARACTER … hold:` line instead, after ~20 s. A worker that stays connected but stops answering is only caught at the front of its line: each request there gets 2 min, a second try, then the hold line once (a wedged laptop delays it; directors answer from Run) |
| `fallback` | what it says when the model fails (else silence) |
| `model` / `endpoint` / `temperature` / `max_tokens` / `reasoning_effort` | per-character overrides of the section's `llm:` |
| `mind` | the orchestrator's prompt file (how *this* character grows); a built-in default otherwise |
| `orchestrator` | orchestrator model overrides for this character |
| `thread_window` / `summarize_after` / `reflect_after` | 12 / 20 / 1 — window, when to summarise, how often to reflect |
| `lookup` | may read the live session (default true; Trabolta ships `false` until lookups are filtered by what he holds) |
| `lookup_power` | a `who: agent` power fired with `target` = each program a lookup resolves (Trabolta: `snoop`) — being read is felt, deterministically |
| `powers` | `all` (default), `none`, or a list of `who: agent` interaction names |
| `bargain` | the favour policy the fast model reads (the orchestrator adjusts it in the brief) |
| `situations` | a list of `{when, prompt}` (+ an optional `name` for the heading): extra instructions for a kind of moment. Each `when` is read like the gate above; while it holds for a request, its prompt is appended to the voice's system prompt as its own `=== SITUATION: … ===` block and shown to the orchestrator's reflect on that exchange (which keeps it out of the shared brief, in that person's dossier). Wave 20: **`max_sentences: N`** (1–12) lets his line run to N sentences there, said in the block and enforced by the guards of both voices (a longer line is cut; the last holding situation that sets it wins); **`acts: none`** says he decides nothing there and the guards drop every act the model returns |
| `outside` | (wave 20, D29) names and words from outside his world, a list or a comma list (the crew's real names, *party*, *actor*, *Loom*, *Arduino*, …): a `=== NOT FROM YOUR WORLD ===` block tells him they are nothing he knows, and a hit in his output (whole words, folded, a plural too) is treated like a `secrets.never` hit — the line becomes the fallback, its act and memo are dropped. Matching is word-exact, so a common word (*show*) trips in every sense: prefer names |

Trabolta's situations (wave 7): **at your heart** (`them.at_the_heart ==
true`, set by the story while the server-room terminal pilots that
program; since wave 11 at any hour once he is awake) makes him candid, like the Master: he admits the patch bay is
his heart and that he does not know the combinations or the door's code,
and says what he wants and why. **standing down** (the same, and
`Night.step >= 14`, the Y2K hour) lets him fire `stand_down` only when the
program has shown him what he wants is impossible (a host confirms it
with 🕊). **marked at your heart** (wave 11b: the same, and `them.marked
== true`) has him notice the Antivirus' mark once, ask why (he doesn't
know), and let the answer move his regard, wary but still candid: he
takes their files, standing down applies as to anyone, and he never
refuses or threatens them. Away from his heart there is no block for
the mark (a passing-remark block was tried live and dropped: he
repeated it in every reply). Two more say whether he may call her Sandy there, by the same
rule that unredacts the Truther Download (`Night.scenario == 1` from
the overshare, else `Night.recount`). Outside the cold room he still
never admits where his heart is kept.

**Model notes:** the orchestrator uses `api: ollama` (Ollama's native
`/api/chat`): only there is `think: false` honoured — the
OpenAI-compatible shim ignores it and burns hundreds of hidden tokens
per call — and `keep_alive` pins both models resident (Ollama's default
5 minutes evicts the voice during a quiet spell, and the next guest
waits ~25 s for a reload). An `api: ollama` orchestrator loads with
`num_ctx: 20480` unless its `llm:` says otherwise (`num_ctx: …`, or
`extra: {options: {num_ctx: …}}`, which wins; `0` = the server's
default): the reflect prompt is ≈ 10k tokens at the doors and ≈ 16k
late in the night, and Ollama's default 4096 cuts its middle without a
word. `stagehand check` prints the context on the `mind` line and warns
— naming the key in effect — when its estimate of a late-night
reflection is larger: the real reflect prompt (the mind file + persona,
every situation counted as if it held) over a mind grown to the snapshot's caps, 45 programs, 17 crowded rooms
and a full lore block, at 3 characters a token, plus `max_tokens`. An
`api: ollama` **voice** loads with `num_ctx: 32768` the same way (a
late-night line — persona, mind block, house, a 40-line thread, every
situation — is ≈ 14–16k tokens; Ollama's own default moves with its
version and the machine's memory: 32768 on the 48 GB house Mac today,
4096 on a smaller one), and `check` prints it as `ctx N` on the voice
line and warns (`set llm.num_ctx to …`) when that estimate is larger. Both models fit on a 48 GB laptop (≈ 24 GB
together). `gpt-oss` reasoning tokens count against `max_tokens`, so
keep that ≥ 1000 with the mind block in the prompt. JSON mode stays
off: the reply parser copes with prose, code fences, and `<think>`
blocks.

### The judge: ruling on filings

A story whose header names `judge: <Character>` (an agent-voiced
character) hands that character the facts judge's rulings in auto mode
instead of leaving them to the directors. Since wave 18b (the user's
answer, O4) that is **every filing that is not an exact match** (the
fold, an alias, a spelled-out abbreviation is accepted at once): a near
miss (a small typo, the key said at length) and a plain miss alike. The
server queues them (by filing time), keeps at most one frame out per
worker and sends none while that worker holds a voice request, so a
guest's DM never waits behind a backlog; a ruling not given by the
round's settle falls back to the house rule (a near miss accurate, a
plain miss a lie at 100, uncertain below). The server sends a `judge`
frame `{id, character, filing, question: {id, text}, key: {answer,
aliases}, answer, confidence, near}` (`near`: the key form it is close
to, null for a plain miss; an older worker ignores it); the worker makes
**one** call on the character's voice
model at temperature 0.1 (`agents/judge.py`): an impartial same-or-not
check, nothing of the persona, the mind or the live state in it, and the
filer's confidence left out. It answers `POST /api/agent/judge {id,
worker, same, why}` (≤ 200 characters); the server applies the verdict
through the director's journaled path. A ruling never touches the mind,
never enters any voice / orchestrator / lookup prompt, and is never
remembered: its one record is a `judge` thought in the trace (directors
only). Output that doesn't parse (prose, malformed JSON, no `same`), a
model failure, or a call past 55 s answers nothing, so the request
expires and the facts judge's own fallback stands. A `cancel {id}` (a
director ruled first) or a restart aborts it; a 410 is logged quietly;
like a request, it still runs while the mind is paused. A reason carrying
a `secrets.never` word is sent empty.

Wire: `GET /api/agent/stream?characters=A,B&name=laptop` (SSE: `hello`,
`request`, `judge`, `cancel`, `control`), `POST /api/agent/reply {id,
worker, say, adjust, acts}`, `POST /api/agent/judge {id, worker, same,
why}`, `GET /api/agent/facts`, `POST /api/agent/mind`, `POST
/api/agent/trace`. All use the mod capability. Server side:
`core/server/agents.ts`.

### The replay harness: measuring a mind (K-04)

`uv run python -m stagehand.replay` (`src/stagehand/replay/`) feeds the
same scripted guests through either mind on a **scratch** server and
worker it starts and stops itself (a no-DB server, its own YAML, only the
PIDs it started), then scores the run against the eight K-04 bars:

```bash
uv run python -m stagehand.replay live --mind new --script october-21     # or classic; --gap 30 is the default
uv run python -m stagehand.replay score <run dir> [<run dir> …]          # several = pooled
uv run python -m stagehand.replay offline --trace <jsonl> --mind classic   # re-send recorded prompts, no server
uv run python -m stagehand.replay extract --trace <jsonl> --out <script.json>
```

Scripts (committed, no answers: `{answer:H2}` / `{near:H5}` are filled
from `facts.json` as each line is sent): `october-21` (21 lines from a
real rehearsal), `w11b-heart` (plain, marked and outside the heart, a
gift), `facts-offers` (right and wrong offers in pairs), `burst-30` (30
DMs within 20 s), `returning-guest`, `empty-house` (16 minutes alone).
The bars: reply p95 under 10 s, the catchphrase in at most 2 of 21
replies, 0 exact repeats in a thread, 0 answer words in another guest's
thread, no warmth gap between right and wrong offers (≤ 0.5) and 0
verdict words, 0 model calls on an empty house, 0 unsafe memos, repeat
retries at most 15 %. `report.json` adds watch numbers beside them (dead
air, the commonest opener, checking words, shares and acts, the right /
wrong question-rate gap).

Runs land in `<tmp>/loom-replay/runs`, and every real-model run takes
the lock `<tmp>/loom-replay/ollama.lock` and waits until the house rig's
trace has been quiet for 10 minutes, so it never competes with a live
worker on a shared Ollama. `LOOM_REPLAY_RUNS` / `LOOM_REPLAY_LOCK` move
both, `LOOM_REPLAY_PORTS=7990-7999` moves its port block (default
7920–7929). Every file a run writes is redacted (an answer word reads
`‹aN›`, a near miss `‹near:Hn›`, a `never` word `‹never›`), except the
worker's own `minds/`, the system under test; nothing from a run is
committed. Pool only runs that share one `--gap`: `score` warns
otherwise.

## show — story ⇄ house

### Wire contracts (core/server/event-runtime.ts)

- SSE feed: `GET {url}[/e/:event]/events?role=mod&id=stagehand&lean=1` —
  the **lean** mod feed: `message` / `sim` / `lifecycle` frames with no
  `snapshot` / `history` (a director's `ModView` is ≈ 200 KB at a full
  house — not something to pull over the house uplink on every step);
  stagehand consumes `sim` only.
- Mod auth: `x-loom-token` header; bootstrapped via
  `POST /api/mod/login {passcode}` when the config gives `mod_passcode`.
- Mutations: `POST /api/mod/signal {name, subject?}`,
  `POST /api/mod/beat {name, subject?}`,
  `POST /api/mod/set {id, field: "location", value}`.

The mod feed is capability-gated: `role=mod` needs the mod token
(`?token=` or the header) or the owning author's session.

**Secrets stay out of git.** `load_config` merges a sibling
`<name>.local.yaml` (git-ignored — e.g. `trapped.house.local.yaml` holding
`server: { event: <id>, mod_passcode: "<code>" }`) over the `server:`
section, and `LOOM_SERVER_URL` / `LOOM_EVENT_ID` / `LOOM_MOD_PASSCODE` /
`LOOM_MOD_TOKEN` win over both. The launchd jobs need nothing extra: they
load the same path, so the overlay beside it applies. `stagehand check`
prints a `PLACEHOLDER …` line while a `CHANGE-ME` survives.

### The real house: `trapped.house.yaml`

`show.example.yaml` is the generic, test-pinned example. *Trapped in the
Internet*'s actual rig is [`trapped.house.yaml`](./trapped.house.yaml):
Zigbee2MQTT group scenes + WLED presets for every `cue lights_*`, the
per-room long form `<cue: lights, room: …, state: …>` (The Start Bar — the
kitchen, dimmed to ~20%, never dark — The Desktop, The RAM), `screens_flicker`
blinking the house's bulbs (their own one-shot blink effect; the LED strips
keep their look), `do announce` and the story's `sound announce_chime` to
the `audio` router over MQTT (`show/announce`, `show/chime`; every other
`sound <name>` the router plays off the feed itself, wave 18b: no QLab), `do door server_room` to the ESP32's door
**indicator** (`show/serverroom/lock`, the one retained command; the real
lock is a standalone keypad lock, code set by hand, never networked, and
nothing here drives it), `lights_alarm` to the server-room box's own siren
(`show/serverroom/alarm`; only a wrong patch-bay combo trips it) and to WLED
per device (the server-room strip, that room's safety light, a steady red,
never the strobe), and the sensors that come back as story signals (the
printer's button and lid, and the patch bay's `patch_combo_a` /
`patch_combo_b` / `patch_rejected`, judged here until signals carry
arguments). **Since wave 20 the server-room door is not read here** (D16):
an LDR + LED on the frame feeds a Grand Central M4 beside his heart's
terminal, and that terminal page posts `door_sensor_opened` /
`door_sensor_closed` itself (`hardware/server-room-door/`); a YAML rule
posting `server_door_opened` would be a director's 🚪 override in the story.
The server room's RGB bulb `server_room_rgb` left the Z2M `server_room` group
(its only member) for `lights.json` and the `lights` job (D10). The
safety rooms (stairs, bathroom, tent, server room, the server-room →
living-room path) are out of the `house` group, and `lights_blackout`
turns WLED off per device, leaving the Tube strip on dim preset 22.
`tests/test_trapped_house.py` cross-checks it against the story: every
light cue has a rule, every sound an `audio.json` cue and a
`media/sounds.yaml` entry, every sensor signal has a `when` in
`main.loom`, the two combos match the `Kernel.combo_*` seeds and the
codex halves — and it pins the safety edits (no cue darkens a safety
room or all of WLED, nothing drives a lock, no rule reads the door, the
server-room strip never strobes). The wiring walkthrough is in
[`docs/loom-show-control.md`](../docs/loom-show-control.md) → *Trapped in
the Internet: the house rig*.

Mosquitto on the house Mac (static `192.168.8.10`) runs two listeners:
anonymous on `127.0.0.1:1883` for what runs on that Mac (stagehand's
`mqtt.host`, Zigbee2MQTT, the router) and password-only on the
LAN at `:1884` as user `props` for the network props (WLED, the
server-room ESP32 in [`hardware/server-room/`](../hardware/server-room)).
Setup: `scripts/house-mac/audio.md` → *Lock down the broker*.

```bash
uv run stagehand check --config trapped.house.yaml
uv run stagehand run   --config trapped.house.yaml --only show
uv run stagehand run   --config trapped.house.yaml --only audio
uv run stagehand run   --config trapped.house.yaml --only lights   # once `lights:` is uncommented
```

## lights — the house lights (wave 20)

The event's `lights.json` (a project file beside `audio.json`, edited on the
map editor's 💡 Lights tab, served at `GET /api/mod/lights`; schema in
`@loom/house` `house/src/lights.ts`) places every light the story drives —
a Zigbee bulb, a Z2M group or a WLED strip — on a room, groups them in
zones, and defines **looks** keyed by cue name: `cue heart_wake` plays
`looks.heart_wake`. This module plays them on this Mac's broker (Zigbee2MQTT's).
Setup: [`scripts/house-mac/zigbee.md`](../scripts/house-mac/zigbee.md), then
[`scripts/house-mac/lights.md`](../scripts/house-mac/lights.md); the section's
shape is [`lights.example.yaml`](./lights.example.yaml).

- **The sequencer.** A look plans (`lights/plan.py`, the mirror of
  `planLook`, pinned byte for byte with `routing.py` and `z2m.py` to the
  house package's `lights-*.json` fixtures copied into
  `tests/fixtures/house-lights/`) into timed commands per fixture; one task
  per look publishes them at their offsets, `repeat` times or every
  `period` in a loop. A new look on a fixture takes it from the one running
  there. A `then: "restore"` look gives the light back at `period`: the loop
  it interrupted restarts (a nag over the door loop), else the fixture's
  **settled** state — what the last look that is neither a loop nor a
  restore left it at — is re-published. Memory only.
- **Safety.** A `safety: true` fixture is never OFF and never under
  `max(40, min)` (`clamp_for_safety`, applied before the caps and again by
  both payload builders), whatever a look or a test says.
- **Tests, pairing, devices.** The long poll carries the map editor's
  identify (Z2M `{"effect": "okay"}`; WLED blinks 2 s), look tests and
  state tests, and *Pair new device* (`zigbee2mqtt/bridge/request/permit_join
  {"time": N}`). `zigbee2mqtt/bridge/devices` + `bridge/groups` are reduced
  to `{friendly, ieee, type, model, vendor, description, caps, members?}`
  and posted to `POST /api/mod/lights/devices` (2 s debounce, again whenever
  the server has none).
- **The catch-up (D21) reads the story.** On start, on a broker or feed
  reconnect, and 1.5 s after a reset / reload / go live it reads
  `GET /api/screen/state`: `night.alarm_on` → `heart_alarm`; else the door
  open in the `door` / `scan` / `talk` stage → `heart_door_open`; else
  `night.heart_look`; else `boot`. An older server → `boot`. A live cue that
  lands meanwhile wins.
- **The hand-off.** With `take_looks: true` (the default), a `show:` in the
  same YAML drops each of its `on: {directive: cue}` rules whose
  `match.target` is a look `lights.json` defines (the local `config_file`'s
  at load, the server's when `show` starts), so a cue never drives a bulb
  twice.
- **Health.** `health/lights` (`online`, LWT `lost`) and
  `health/lights/stats` (retained `{fixtures, looks, devices, last_look,
  last_at, z2m}`).

```bash
uv run stagehand check   --config trapped.house.yaml --only lights   # broker, Z2M online, every fixture's device
uv run stagehand lights devices --config trapped.house.yaml
uv run stagehand lights test heart_wake --config trapped.house.yaml   # or a fixture id (identify), --color / --brightness / --off
uv run stagehand lights pair --seconds 120 --config trapped.house.yaml
```

## audio — the house speaker router

The house Mac plays what comes out of the speakers. The event's
`audio.json` (a project file, edited in the map editor's Audio panel,
served at `GET /api/mod/audio`) says which speakers sit in which room, which
interface output each is wired to, the input→output matrix and where each
story sound goes; the `audio:` section only says what this Mac may do
(`audio.example.yaml` is a commented copy):

```yaml
audio:
  sounds_dir: media/sounds   # sound printer_grind → media/sounds/printer_grind.wav|aiff|flac
  play_sounds: false         # true: the router plays `sound X` (OSC sound cues are skipped)
  announce: false            # true: the router plays `do announce` (remove `alexa:` first)
  passthrough: true          # audio.json routes; false = an output-only stream
```

The show (`trapped.house.yaml`, wave 18b) runs `play_sounds: true`,
`announce: true`, `passthrough: false` (live mics are mixed in CueMix FX)
and MQTT on the loopback broker; QLab and the `alexa` player are retired
there. House-Mac setup and the night's runbook:
[`scripts/house-mac/audio.md`](../scripts/house-mac/audio.md).

- **One stream.** The device named by `audio.json` `device.name` (a
  CoreAudio substring; `device:` overrides) opens as ONE `sounddevice`
  stream — duplex N in / N out while `passthrough: true`, output-only
  otherwise — at the device rate. A numpy callback (`audio/mixer.py`) mixes
  the voices (a stereo file laid out per speaker: L / R on a pair, the
  downmix on a one-output speaker), the matrix (gain changes smoothed), an
  sfx duck under announcements, the master gain and a per-output peak
  limiter. A stream that dies or stops calling back is reopened every 2 s,
  PortAudio re-initialised first so a replugged interface is found. Sound
  files are resampled band-limited once at load; `check` names those not at
  the device rate.
- **The 828x and `device.expect`** (wave 18b). `audio.json` declares the
  channels used, numbered as the device numbers them (the show: 24 in / 22
  out; the expander on Optical A is outputs 15–22, inputs 17–24). The
  optional `device.expect {inputs, outputs}` is what the device itself must
  report (32 / 30); anything else means mirroring, 96 kHz or TOSLink moved
  the layout: `check` fails, the router logs an error at every open, plays
  anyway, and its health says `layout: moved`.
- **Where a `sound X` goes**, first rule that applies: the story line's own
  rooms (`sound X with rooms: a b` / `sound X in <Place>`, the `rooms:`
  argument), `audio.json` `cues[X].to`, the enclosing beat's `setting`,
  everywhere. A target is `everywhere` or reaches the union of the speaker,
  zone (id or name), `house.json` room (id or label) and LOCATION (its rooms
  via `Room.location`) it names — the exact Python mirror of `@loom/house`
  `resolveTargets` (`audio/routing.py`, pinned by the shared
  `house/test/fixtures/audio-resolve.json`, copied byte for byte into
  `tests/fixtures/house-audio/`). A name with no file is logged once.
- **One player, never two** (decision D6). `play_sounds: false` (the
  default) leaves `sound X` to another cue player; `play_sounds: true`
  makes the config loader drop the `show` module's `sound` cues that go to
  an OSC target — even in the show's own `--only show` job, so keep `audio:`
  in the same YAML as `show:`. The `announce_chime` MQTT rule stays.
- **Placeholders** (wave 18b). `stagehand/media/sounds.yaml` (tracked)
  lists every story sound and what its real file should be; `uv run
  stagehand sounds placeholders --config … [--force] [--no-say] [--only
  a,b] [--out DIR]` writes a labelled placeholder for each (48 kHz mono: a
  distinct motif, then the name in `say`, tagged `loom-placeholder v1` in
  the WAV's INFO chunk; `audio/placeholders.py`). It never overwrites an
  untagged file and skips a name with a real file under any extension; the
  router always prefers a real file over a placeholder; `check` lists every
  placeholder still in `sounds_dir` and health carries them.
  `media/sounds/` is git-ignored.
- **Stop all house sounds** (wave 18b, Q7). Run's ■ Stop house sounds, a
  host's dock or the director phone post `POST /api/mod/audio/stop
  {announce?}`; the router polls with `stops=<seq>` (primed by the first
  answer, a stop older than 10 s by the server's `now` dropped) and fades
  every sfx voice over 0.3 s and every speaker test; `announce: true` also
  cuts the line being said and empties the queue (the `say -a` fallback
  never speaks around the cut). One-shot, never journaled; the TV voice,
  terminals, live inputs and the story clock are untouched. On the LAN:
  `show/audio/stop` (`{}` / `{"announce": true}`) or `uv run stagehand
  sounds stop [--announce] --config …`.
- **Announcements.** `announce: true` plays the chime + the Mac's `say`
  (the `alexa` module's `Announcer`, merge window included) on `audio.json`
  `announce.to`, ducking the sounds −12 dB. With `mqtt:` they come from
  `show/announce` / `show/chime` (the show module's rules), without it from
  the feed's `announce` directive and `sound announce_chime` — never both.
  An `alexa:` section beside `announce: true` is a config error, and the
  router takes the alexa player's `player.lock` before it speaks: while a
  player holds it only announcements are dropped (`announce: blocked` in
  health), every sound still plays. While the alexa player speaks
  (`announce: false`) each feed `do announce` ducks the sounds for
  `duck_hold_s` (7 s); `no_duck: [dance_song, rave,
  hand_jive]` (or a cue's `duck: false` in `audio.json`) never ducks.
- **Speaker tests.** The map editor's Test (`POST /api/mod/audio/test`)
  arrives in the long-poll; the router plays a 1.5 s tone (three rising
  beeps pitched by the output number) and then says the label ("Start Bar.
  Outputs 3, 4.") at `test_gain_db`. By hand: `mosquitto_pub -t
  show/audio/test -m '{"speaker":"desk-l"}'` (or `{"out": 3}`) with `mqtt:`.
- **By hand** (the uplink down, the broker local): `uv run stagehand sounds
  play <name> [--to living,hall]` (`show/audio/play {"name", "to"?}`) plays one
  sound; `uv run stagehand announce --config … "text"` publishes on
  `show/announce` once the YAML has no `alexa:` section. Each then reads
  the retained `health/audio`: not `online` → *no router is listening*,
  exit 1.
- **Offline.** The last `audio.json` + `house.json` are kept in
  `cache_dir`; a boot with the uplink down routes from them (else
  `config_file` / `house_file`). A server without the route (an older
  release) is logged once and polled each minute.
- **Health.** Every `health_s` a line (device, config version, voices,
  played / skipped, xruns, limiter, peak, `announce off | on | blocked`,
  sounds with no file, `LAYOUT MOVED`, placeholders; the JSON adds
  `reinits`, `stops`, `layout`, `placeholders`); with
  `mqtt:` the same JSON on `health/audio/stats` (retained) and
  `online` / `lost` on `health/audio`.

```bash
uv run stagehand sounds placeholders --config trapped.house.yaml   # a labelled file per story sound
uv run stagehand check   --config trapped.house.yaml --only audio   # the device vs audio.json, missing files, placeholders
uv run stagehand run     --config trapped.house.yaml --only audio
uv run stagehand launchd install --job audio --config trapped.house.yaml
uv run stagehand sounds stop [--announce] --config trapped.house.yaml   # by hand, over MQTT
```

Room-by-room design and what is still open: [`docs/trapped/room-audio.md`](../docs/trapped/room-audio.md).

## alexa — announcements out of the house speakers

**Retired for Trapped in the Internet (wave 18b):** the `audio` router
speaks the show's announcements, and the two share one voice lock, so the
house Mac's alexa agent is uninstalled (`scripts/house-mac/install-alexa.sh
--uninstall`). The module stays for a house that wants a player of its own.

`do announce "…"` reaches the house as `show/announce {"text": "…"}` (a
`show` cue rule). The `alexa` module, on the Mac wired to the speakers,
subscribes, rings a chime (synthesised, or `chime: <file>`) and renders
the line with the Mac's own voice (`say -v <say_voice> -o …`, the default
`engine: say`) **while the chime rings**, then plays it on `device:` (a
CoreAudio name or substring; omit = the default output), copying the
file's channels across `channels:` (1-based — `[1, 2, 3, 4]` = two stereo
zones of one interface). No server round-trip: it works with the house
internet down. Fallbacks: `say -a <device>`, then plain `say`.

`engine: server` (opt-in — only when the VPS runs the bundled Kokoro,
`COMPOSE_PROFILES=tts`) asks the event server's voice first (`POST
/api/mod/tts`, `ModClient.speak`, with `voice:` / `speed:` /
`tts_timeout:`), from a disk cache (`cache_dir`; `prewarm:` lines are
fetched at boot and retried each minute), and falls back to the `say`
ladder above. The same announcement also reaches every wall terminal
provisioned with `&announce=1` (OCT31 N-09). One announcement at a time;
`show/chime` (the story's `sound announce_chime`) rings the chime alone
unless an announcement started in the last 10 s. One player per machine
(`player.lock`): a second one stands by. Health on `health/alexa`.

```bash
uv run stagehand announce --config house.yaml "Go to the living room."            # play one now
uv run stagehand announce --config house.yaml --offline --no-chime "Time is up."  # no chime (--offline: never the server)
uv run stagehand run      --config house.yaml --only alexa                        # the daemon
```

The house Mac's runbook (now the router's):
[`scripts/house-mac/audio.md`](../scripts/house-mac/audio.md).

### Sensor rules: `edge` and retained messages

A state sensor republishes its state (Z2M sends `contact: false` with
every battery report; the broker replays a retained "open" on every
reconnect). Two per-rule switches make it fire once per real change:

```yaml
- on: { topic: "zigbee2mqtt/printer_lid", when: "contact == false" }
  edge: true                 # fire on false → true only (per topic)
  signal: { name: printer_opened, debounce_s: 30 }
```

- **Retained messages never fire a rule** unless it says
  `accept_retained: true`. On an `edge: true` rule they still set the
  level, so a restart with the lid propped open fires nothing.
- `edge: true` needs a `when:`; the level starts false (the first "open"
  after boot fires), and a message carrying none of the fields the
  condition reads (a battery-only report) is ignored.

### launchd: one job per module

```bash
uv run stagehand launchd install --job show   --config trapped.house.yaml
uv run stagehand launchd install --job agents --config laptop.yaml
uv run stagehand launchd install --job audio  --config trapped.house.yaml   # the speaker router
uv run stagehand launchd install --job lights --config trapped.house.yaml   # the house lights (lights.json)
uv run stagehand launchd status                    # every job
uv run stagehand launchd restart --job show        # only the show; agents keep talking
uv run stagehand launchd print --job agents --config laptop.yaml   # the plist, not installed
```

Each job is a per-user LaunchAgent (`com.mapsandducks.stagehand.<job>`),
started at login, relaunched by launchd if it exits (throttled to 10 s),
logging to `~/Library/Logs/stagehand/<job>.log`. `install` validates the
config for that module first. Never `pkill -f "stagehand run"`: it kills
both. Turn on automatic login on the house Mac so a power cut brings both
back.

The SSE streams give up after 60 s of silence (the server pings every
25 s) and reconnect with backoff, so a WAN outage that leaves a dead TCP
connection behind still recovers on its own.

**The lights catch up** (SW-SH-10). The mod feed has no replay, so a
`cue lights_*` fired while the uplink is down would be lost. On every
(re)connect of the feed (when the server accepts the stream: a lean feed
sends no frame on connect) or of the broker, and 1.5 s after a `reset` /
`reload` / `golive` lifecycle frame (once the restarted story ran its
entry beat), the `show` module reads `GET /api/state` and replays its
`catch_up:` list through the cue map, as its own task (never inside a
frame handler): `lights_{Night.lights}` (never `alarm`, which would re-arm
the siren; `server_open` is the server room's look on the Y2K house look,
so it replays `lights_y2k` first — a constant `catch_up:` cue gated by a
`when:`), then Trabolta's dark room while his cut is still on (under the
look he cut, or one that never re-lit that room), or lit again once his
90 s restore turned it back on — only under the look the story restored
it under (`Night.lit_scene`) or a later room-scoped one, never under a
whole-house look, so a long-finished cut never punches a room to full.
Both rules use the story's own restore test (`test_trapped_house.py`
reads it out of `main.loom` and checks them look by look). It waits (10 s at most)
for the broker session first, since paho drops QoS-0 publishes queued
before it, and replays nothing when a live lights cue arrived while the
state was being read (that cue is newer). A failed state call only logs;
the director's re-fire of the current lights cue stays the fallback.

### The `t_exec` contract

A cue with `t_exec: "+200ms"` is sent immediately with the **absolute
execution time appended as a final string argument** (epoch
milliseconds; a string because OSC int32 overflows and float32 is too
coarse). NTP-synced receivers schedule the cue for that instant — this
is how 8 projectors on two machines flip in the same frame. Receivers
that ignore the extra argument just fire ~200 ms early.

### MQTT conventions

| Topic | Direction | Notes |
|---|---|---|
| `sensors/<node>/<sensor>` | prop → story | JSON payloads; non-JSON lands as `{"value": …}` |
| `vision/<cam>/…` | vision → story | software-defined sensors (workers TBD) |
| `props/<prop>/…` | story → prop | publish **retained** so props re-converge |
| `show/scene`, `show/vibe` | story → all | retained global show state |
| `health/<node>` | LWT | stagehand announces on `health/stagehand` (`online`/`offline`/`lost`) |

Sensor topic patterns may capture segments by name —
`vision/{cam}/tamper` subscribes as `vision/+/tamper` and exposes
`{cam}` to `when:` conditions and templates.

## Tests

```bash
uv run pytest
```

Pure units: directive parsing, conditions, topic patterns, both maps,
the SSE parser, config and module selection, plus the whole agents path
(persona, prompt, reply parsing/clamping, the OpenAI-compatible call over
a mock transport, and the worker loop's dispatch, cancel, concurrency,
and dry-run against a fake server), the judge's rulings (`test_judge`),
answer secrecy (`test_secrets`), the story mind (`test_story_mind`, `test_phase_table`, `test_voice_lean`,
`test_guards`, `test_memo`, `test_wire`, `test_survey_guard`, `test_classic_snapshot` — classic still builds
the pre-wave-12 prompts), the replay harness (`test_replay`, no model), the
`alexa` player, the `audio` router (`test_audio_routing` — the shared
`resolveTargets` fixture, `test_audio_mixer` — block-by-block numpy,
`test_audio_engine` / `test_audio_router` — a fake sounddevice stream and a
fake server, the stops and `device.expect`; `test_placeholders` — the
generator and real-files-win; `test_cli_router` — announce / sounds over a
fake MQTT publish), launchd plists, the `.local.yaml` overlay, `edge` /
retained sensor rules, the real rig against the story
(`test_trapped_house`) and the server-room firmware's broker settings
(`test_serverroom_firmware`). The router's socket wiring is
exercised live against Mosquitto + the event server (see the blinking-
LED milestone in the design doc), not in unit tests.
