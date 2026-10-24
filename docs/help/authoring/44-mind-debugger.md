---
title: The mind debugger — watching an agent think
section: The Editor
order: 44
keywords: story mind, mind_mode, switches, kill switch, ladder, laptop.yaml, guard, answer-guard, invented fact, unsaid, catchphrase, fallback, dead air, retry, repeat, warm head, phase card, stage card, summary, quiet summary, classic, new mode, phase table, rewrite brief, set by story, set by director, memo, memo by voice, first met, gifts, filings, house trust, prompt_ms, same prefix, quiet, slider, near miss, ruling, judge thought, queue, stalled, busy, mind, agent, trabolta, stagehand, orchestrator, voice, model, ollama, reasoning, thinking, prompt, trace, thought, brief, stage, arc, drives, policy, bargain, questions, nudge, whisper, reset, survey, pause, re-run, effort, debugger, control panel, hold, offline, worker down, not responding, answer by hand, judging, judge, facts.json, verdict, override, judge_mode, auto, review, pending, filing, tally, consensus, secrets, never, door code, combo, suppressed, restart, limit, dossier, who this is tonight, heart to heart, outside, fiction, max_sentences, acts none, a choice is open, stand_down, situation keys, LOOM_AGENT_DOSSIER
---

A character marked `mind: external` has no performer: a language model
answers it, run by the **stagehand agents** worker on the show laptop
(see [live shows](30-live-shows.md)). Two models share the job — a
**voice** that answers each line in seconds, and a slower
**orchestrator** that, between turns, rewrites the character's *mind*:
the brief the voice is handed next, what it has decided, its files on
people, what it was fed and whether it believed it. **Run → Mind** is
the window into both, and the hand on the wheel.

### Two minds: classic and the story mind

The worker runs one of two minds, chosen in its YAML (`mind_mode:`).
**Classic** is the two-model mind described above. The **story mind**
(`mind_mode: new`) has no orchestrator:

- one voice call answers each line;
- the story sets his stage, drives and brief from the mind file's phase
  table whenever `Night.phase` changes;
- the voice keeps a short **memo** on the person it just answered.

The page tells them apart:

| | Classic | Story mind |
|---|---|---|
| Header | the *mind* model chip, reflections and surveys counted | a *mind · story* chip (layout, memo, repeat guard, phase watch) and the current phase |
| Survey button | **Survey now** | **Rewrite brief** |
| Mind reasoning | shown | hidden: there is no orchestrator |

An older worker always reads as classic.

**A quiet page is not a broken one.** The story mind makes no model
call until someone speaks to the character. There is no timer survey
and no reflection after each line. On an empty house the trace stays
still for minutes. Check the queue badge and the worker chip instead:
they say whether a worker is connected.

Under the story mind, this is all that ever makes a row in the trace:

| When | What runs | Rows |
|---|---|---|
| a line to him | one **voice** call. Before it, a one-token call warms the model's cache (`warm_head`); it makes no row of its own, and its time is counted in the voice row | 1, and a second **voice** row (trigger *retry*) when the line repeated him |
| `Night.phase` changes | the phase card is applied in code: stage, favours, drives, live powers, brief | none (one revision *set by story*) |
| a conversation goes quiet (3 or more turns, then 120 s with nothing new) | one **summary** call on the voice model, trigger *quiet*. Never while a line is waiting, never while he is asleep or after the night has ended | 1 |
| you press **Rewrite brief** | one **brief** call on the voice model | 1 |
| a filing that isn't an exact match | the **judge** (below), one at a time, never while he is answering a line | 1 |

A line to him or a ruling always goes first: a summary or a Rewrite
brief that is running when one arrives is stopped and runs again once
he is free.

The page needs a server project with its rehearsal or live event
running and a worker connected. On a local folder it explains that
nothing voices the character in the browser.

If the worker drops (the laptop sleeps, Ollama dies), guests are not
left in silence: messages to the character queue, and after about 20
seconds the server posts the character's authored `hold:` line once per
waiting message ([a character with a mind](codex.md)). Answer by hand
meanwhile — Chat, speaking as the character in that thread; your reply
closes the waiting request, and the worker picks up from the next line
when it reconnects, with your answer in its history.

A busy worker answers its line in order, one message after another. Each
message gets two minutes from the moment it reaches the front of the
line (not from when the guest typed it), so a burst of sixty DMs on a
healthy laptop is answered, not cancelled. A message that never gets an
answer is sent once more, then given up with the `hold:` line, so the
guest hears something and the thread shows in need. A message that
waits 40 seconds behind other people's hears the character's `busy:`
line once per thread.

A worker that stays **connected but stops answering** (a wedged model)
is **stalled** once the message at the front of its line has had no
answer for 60 seconds: `# hosts` gets one *⏳ … stopped answering* line,
every waiting thread hears the `hold:` line once, and nothing new is
sent to it until it answers again or reconnects. Answer from Chat
meanwhile, and if it stays stalled restart the worker (`stagehand
launchd restart --job agents` on John's MacBook): a worker that dropped
the requests it was cancelled on has nothing left to answer, so only a
reconnect clears it.

The Mind header carries the character's **queue**: how many messages
are waiting, the oldest wait (counting up by the second between
updates) and **⛔ stalled**. The Director page's *Needs you* shows a
queue that is stalled or has waited 40 seconds or more.

While the run is **paused** the character's words still post, but its
powers answer *doors are closed* and spend nothing; the waiting and
timeout clocks stand still until the doors open.

A **server restart** (a crash, a redeploy) keeps both. A message from
the last ten story-minutes still owed an answer is asked again (or gets
the hold line after 20 seconds, never twice), and his powers' `limit:`
counts carry over: his own uses are journaled `by: agent:Trabolta` (the
Log shows them), and a director firing the same power from Run never
spends one.

## The mind now (left)

- **The arc.** The mind file declares the character's night as
  **stages** (`stages:` in its frontmatter — for Trabolta: *asleep →
  formal → hungry → rattled → judge → unravelling → desperate → last
  act*). The stepper shows
  where the character is, when it got there and why (hover a stage).
  Click a later stage to move the character there yourself; you are
  asked for the reason, which goes into the history. Each move in the
  history says who made it: *set by story* (the phase table), *set by
  director*, or *reset*. Under the story mind, a stage you set holds
  until the next phase change, when the story sets it again, unless the
  worker's YAML turns `stage_from_phase` off: then the phase reads
  *stage by hand* and the stage moves only when you step it, as in
  classic. The current `Night.phase` shows beside the heading.
- **The brief** — the second-person instructions the voice is handed
  right now, with the mood. A label says who set it: *set by story* (the
  phase card) or *set by director* (an Edit, a Rewrite brief).
  **Edit** rewrites it. In classic, the next reflection may rewrite it
  again. Under the story mind, it holds until the next phase change or
  the next Rewrite brief. Pending **whispers** (your nudges, below) show
  here until they are cleared: in classic when the orchestrator folds
  them in, under the story mind at the next Rewrite brief or phase
  change.
- **Drives** — the mind's own 0–100 dials (`drives:` in the mind file:
  hunger, suspicion, pride, candour, longing…), each with a sparkline over
  every revision of the night and its change since the first. Drag a
  slider to set one. Nothing is sent while you drag. It is sent once,
  when you let go (or lift the arrow key, or leave the slider), and only
  if the value changed. Under the story mind, expect flat steps at phase
  changes rather than a wobbling line.
- **Bargains** — the policy on favours as the orchestrator keeps it:
  *none* / *earned* / *loose*, who has credit, who it is wary of.
  Change it from the select (sent only when you pick a different one).
- **Collecting answers to** — the questions the character is asking
  everyone (its obsessions) and the answers gathered so far, with who
  gave them.
- **Decided / noticed**, **fed to him** (every claim with a verdict:
  fact / bluster / unknown), **files on people** (trust bar, turns,
  summary; click a row for claims / asks / promises, *Set trust*,
  *Forget*), thread summaries, and the **revision log** — every change
  numbered, by whom (`reflect`, `survey`, *set by story*, *set by
  director*, `reset`), and a **thought** button to open the model call
  that made it.
- Under the story mind, *fed to him* and *collecting answers to* are
  gone (the story mind keeps no claims ledger and no questions), and a
  file on a person carries what the story and the voice kept instead:
  - the row shows **the house's trust** (the story's own `trust` for
    them, the number the voice is handed) instead of a trust bar, ⛔ if
    they are marked for the Internet, and how many memos it holds;
  - opened, it shows **first met** (the phase and room of their first
    exchange), each **memo by voice** (🫀 for one written at his heart),
    what they **gave him** (codex titles), the questions they **filed**
    (ids only, never an answer), and their place on the **Trust Chart**.

  *Set trust* is classic only: the story mind keeps no trust number of
  its own. A memo writes no revision. Its record is the voice thought
  that wrote it.

## The trace (right)

Every model call the worker made, newest first, colour-badged and
labelled: **voice** (the fast model answering a line), **lookup** (the
second call after it asked the session about a program, room, or
lore), **reflect** (the orchestrator after an exchange), **survey**
(the orchestrator looking at the whole house), **re-run**, **judge** (a
ruling on a filing that isn't an exact match, below), **brief** (a Rewrite brief),
**summary** (the story mind summing up a conversation that has gone
quiet), and the markers **reset** / **control** / **error**. Each row
says who it was with, which model, what triggered it, how long it took
(and, from a newer worker, how much of that was reading the prompt:
*1.2 s (prompt 300 ms)*), and a summary (the line said and the numbers
nudged; or the mind fields it updated).
Filter by kind, by person, or by text across prompts, reasoning and
output.

Open a thought to see, in tabs:

- **Input** — the messages exactly as sent (system / user / assistant;
  long system prompts fold). The voice's long, unchanging first system
  message is stored once: a later thought shows it as a **same prefix as
  th-…** button. Press it to show the text, from the thoughts already on
  the page or from the server. *Prefix not found* means neither still
  holds it (an old trace).
- **Reasoning** — the model's own thinking, when it exposes it: gpt-oss
  does at every effort level; the orchestrator's (Qwen) is off by
  default for speed — switch it on from the panel to see it.
- **Raw output**, **Parsed** (what the worker made of it: `say` /
  `adjust` / `lookup` / `act`, or the mind update), and **Mind diff** —
  field by field, what this thought changed (`+` added, `−` dropped,
  `→` changed).
- **Re-run** sends the same messages to the model again, as it is
  configured now, and records the answer beside the original — never
  applied. Compare a tuned persona, a different effort, reasoning on.

When the worker drops something from a mind update for secrecy, the
thought's **Parsed** tab lists it as `suppressed`: a hunt verdict as it
was, a door code or a combination as `secret · …`. The worker's log
counts them apart (*suppressed 1 hunt verdict(s), 2 secret(s) (door code
/ combo / pickup line)*), so a program feeding him the code reads
differently from a hunt claim.

**What a voice row's note says (story mind).** Before a line goes out,
plain code checks it, and every check that changed something is named
in the row's note (never the word that tripped it):

- `never (line withheld)` / `(act dropped)` / `(memo dropped)`: a
  secret (the door code, a patch-bay pair, the pickup line) in the line,
  an act or the memo. The line becomes his fallback line;
- `answer-guard (line withheld)`: the line named a hunt answer the guest
  never typed in this thread, so it became the fallback;
  `answer-guard (invented fact cut)` / `(invented fact → fallback)`: a
  sentence that hands over, sells or places a fact (*there is a fact in
  the Optical Drive*, a count of the facts left, a made-up answer). He
  has none to give, so the sentence is cut; with nothing left, the
  fallback;
- `unsaid name cut` / `→ fallback`: a name the story has not said yet
  (Sandy, until the house says it);
- `catchphrase stripped`: the persona's stock phrase is his only at
  first contact, and only on the stages the persona names;
- `repeat retry` / `catchphrase retry`: the line repeated what this
  guest already heard, so the model was asked once more (the second
  **voice** row, trigger *retry*). With another line already waiting
  there is no retry (`(no retry: a line is waiting)`), and sentences they
  heard word for word are cut instead (`repeat: old sentences cut`). A
  retry that still repeats goes out with those sentences cut, or as
  `repeat → fallback`;
- `act dropped (not shareable now)` (a file the phase card does not let
  him hand over) and `act dropped (aimed at the speaker)` (a snoop on
  the program he is talking to);
- `warm head N ms`: the cache-warming call before the line.

A *fallback* under the story mind is a **dead-air line** from the
persona's `fallbacks:` for his stage, one this guest has not heard yet,
else the plain `fallback:`. A few a night are normal (most in a burst,
where nothing is retried); a run of them in one thread is a reason to
look at the guards' notes and, if one keeps firing wrongly, at the
switches below.

The trace outlives a story restart (the worker marks the boundary with
a **reset** row), and a worker that reconnects replays its recent
thoughts, so a console opened late still sees the night.

## The control panel (header)

| Control | What it does |
|---|---|
| **Nudge** | whisper to the mind. The voice obeys it on its very next line. In classic, the survey it queues folds it into the brief and clears it; under the story mind there is no survey, and the whisper stays until the next Rewrite brief or phase change. "Be shaken: someone just read your LiveJournal." |
| **Survey now** (classic) | the orchestrator looks at the house immediately |
| **Rewrite brief** (story mind) | one voice call rewrites his brief from the phase card, your whispers and a digest of the house; it holds as *set by director* until the next phase |
| **Pause / Resume mind** (classic) | freeze the mind: replies keep coming, but nothing changes it until you resume. The story mind has no orchestrator to pause, so the button is gone there (it shows *Resume mind* only for a mind a classic run left paused) |
| **Mind reasoning on / off** (classic) | show the orchestrator's thinking in the trace (slower) |
| **voice effort** | the voice model's reasoning effort: none / low / medium / high |
| **Reset mind** | the character back at the doors — stage one, drives at their opening values, nothing learned. The story keeps running. A story restart (↺ in the header) does exactly this on its own, through the same channel. |

Everything the panel does is recorded as a **control** row in the
trace with your name, and every direct edit is a revision *set by
director* (hover the label for the director's name, when the worker
recorded one), so a rehearsal's log says what the models, the story and a
human did. A control that changes nothing (a value it already has) is
not recorded by a newer worker.

## The switches: when the story mind misbehaves

Try your own controls first. They take effect on his next line and need
nobody else: **Nudge** him, **Edit** or **Rewrite** the brief, step the
**stage**, lower the **voice effort**, or answer a thread yourself from
Chat.

If something keeps going wrong, the worker has a ladder of switches,
smallest first. Each one is a line in the worker's YAML on the house
Mac (`laptop.yaml`), followed by a restart of the agents job (`uv run
stagehand launchd restart --job agents`). The tech operator does both;
a restart takes a few seconds, saves his mind first, and the `hold:`
line covers anyone who writes meanwhile. Go back one rung at a time, and
note in `# hosts` what you changed.

| Rung | The YAML line | What changes | Flip it when |
|---|---|---|---|
| 1 | `voice: {memo: off}` | no new memos and no summaries; the ones kept are left out of his prompt | a memo is wrong about someone, or his lines start quoting his own notes |
| 2 | `voice: {repeat_guard: off}` | no retry and no catchphrase retry: one model call per line, always | the *retry* rows pile up or slow him down |
| 3 | `voice: {dossier_on_close: off}` | no **summary** calls; the summaries kept are left out | a summary is wrong, or the laptop is struggling |
| 4 | `mind: {stage_from_phase: off}` | the phase cards stop setting his stage, drives and brief: the phase reads *stage by hand* and you step the stage yourself, as in classic | a phase card is wrong for tonight |
| 5 | `voice: {layout: classic}` | the old prompt, inside the story mind | the new prompt itself reads wrong |
| 6 | `mind_mode: classic` | the whole classic mind: two models, the reflection after each line, the survey every 2 minutes, **Survey now** instead of Rewrite brief. The second model must load first: the first reflection takes about 25 s longer | the story mind as a whole is not working |
| 7 | the server's `LOOM_AGENT_RECENT=off` (in the VPS's `.env`) | the request his worker gets is wave 11b's again: no story tags on his thread lines and no *recent* list. Needs a server restart: **before doors only** | something in what the server sends him is wrong |
| 8 | the previous release (`deploy/rollback.sh` on the VPS) | the server back as it was. The worker's computer (the MacBook) goes back too, its whole checkout to the same release (never stagehand alone: an older worker refuses the newer persona file). **Before doors only** | nothing else helped |

Rungs 1–6 never touch the story or the server: the night carries on. A
switch keeps what the earlier rungs set, so rung 4 with rungs 1–3 still
on is fine. Classic still skips its timer survey while he is asleep, the
event is paused, the night has ended or nothing has changed, and the
trace still stores the long prompt once.

## Judging (the facts judge)

Above the mind sits the **Judging** card — the server's judge of filed
facts (see *Judging with facts.json* in [cards & widgets](widgets.md)).
It shows even before a worker has reported; on a project with no
`facts.json` it says so and judges nothing.

- **The mode switch** — `auto` / `review`, writing the variable the
  card names (`Night.judge_mode` by default) through the same journaled
  `set` as the World page. In `auto` every filed fact gets its verdict
  at once when it is an **exact match** (the fold, an alias, a
  spelled-out abbreviation). With a `judge:` character and its worker
  online, every other filing (a near miss or a plain miss) goes to him
  first (below); with nobody to rule, a **near miss** (a typo of the
  key, a number written out, the key said at length) waits here as in
  review and a plain miss is judged at once; in `review` every verdict is a
  proposal until someone confirms it, and a round closing settles the
  rest by the proposal. Beside it: *nothing pending* or *N pending*,
  and how many of those are near misses.
- **Pending filings** (review mode, near misses in either mode, and
  every non-exact filing the judge is ruling on): one
  row per filing waiting for a verdict — the program, the question id,
  the answer in quotes, the confidence, and *proposed accurate / lie /
  uncertain*. A near miss is tagged *⚠ near "<key>"*, the key it is
  close to, and is proposed accurate: **if nobody judges it before the
  round settles, it is credited**, so check every ⚠ still pending
  before the results are read ([cards &
  widgets](widgets.md) has the near rules). Three buttons
  settle it: **✅ accurate**, **😤 confident lie**, **🤷 uncertain** —
  the proposal's button is outlined; press it to confirm, another to
  override. Each fires the story's own confirm event for that program
  with the question attached (the events `facts.json` names under
  `judge.confirm`; the hosts' 📝 booth buttons fire the same ones), so
  the story reacts exactly as it would to a host, and the override is
  journaled under your name.
- **Rulings** (a story whose header names `judge: <Character>`, like
  *Trapped in the Internet*'s `judge: Trabolta`). In `auto` mode every
  filing that isn't an exact match, a near miss or a plain miss, is put
  to that character's worker when it is filed, if a worker voicing it is
  online and not stalled. The rulings wait in a **queue**, oldest first:
  one frame is out at a time, and none is sent while he is answering a
  line, so a guest's message to him goes first. A waiting row reads
  **🤖 queued for Trabolta**, the one out **🤖 asking Trabolta…**, and the
  card's header counts the queue (**🤖 4 queued · 1 out · oldest 1:05**).
  `# hosts` says *… asked Trabolta to rule* (*⚠ Near miss…* for a near
  miss, *📝 Not an exact match…* for a plain one). The worker
  makes one separate model call that sees only the question, the key and
  the filed answer, and answers *same* or *not*. *Same* is judged
  accurate; *not* is a confident lie at confidence 100, uncertain below.
  It goes through the same confirm event as your buttons, journaled `by:
  agent:Trabolta`, and `# hosts` gets *🤖 Trabolta ruled X's Q2 filing
  "Dr Whiskars": the same as "Doctor Whiskers" (accurate).* plus his one-line
  reason. The ruling then lists under the pending rows (*🤖 Trabolta: same
  — why*, *now accurate*) with its own ✅ / 😤 / 🤷: press one to
  override it (the later verdict wins, and the row says *overridden by*
  you). Judge a row yourself while it is asking and his ruling is
  dropped. If no worker is online when the filing lands, a near miss
  waits for you as above and a plain miss is judged at once; neither is
  asked later (only a server restart asks the ones still pending). A
  ruling expires 60 seconds after it was sent (never while it waits its
  turn); two expiries in a row read **⏳ Trabolta isn't ruling** in the
  header, and `# hosts` hears *⚖ Trabolta isn't ruling: filings fall
  back to the house rule.* once. Whatever is still queued or out when
  its round settles falls back to the proposal: a near miss credited, a
  plain miss a lie at 100, uncertain below. A full round can take him
  several minutes, so check the queue before 📋. In `review` mode
  nothing is asked.
  The key goes into that one call only: never his voice, his mind, the
  orchestrator or `/api/agent/facts`.
- **The tallies** — per question: filed, accurate, lie, uncertain,
  pending, and ✓ **consensus** (every filing accurate at confidence
  100 — what *Trapped in the Internet* reads as "Clippy happy").
- **Every filing** — **▸** on a tally row lists that question's filings
  (*who filed what*), each with its own **✅ / 😤 / 🤷**, in `auto` mode
  as in `review`. The verdict it has now is outlined (and greyed once
  judged: *Judged confident lie — already on record*); another button
  overrides it (*Override: accurate (judged lie)*). The press names
  that filing's question, so it judges that filing and never just the
  program's latest. A *marked* row has no buttons. This is the place to
  fix an answer the key didn't list and the judge called a lie (an
  abbreviation like "Dr. Whiskers" is already accurate) and the place a host's booth sends you when a program has
  more than one filing waiting.

Judging runs on the event server, so a local-folder run shows the card
with an explanation and no verdicts: rehearse the hunt on a server
project ([run mode](run-mode.md)).

## Shaping the arc

The mind file (`trabolta.mind.md` beside the persona) is where the
night's shape lives: `stages:` in order, `drives:` with opening values,
and `phases:` — a **card** per story phase (`Night.phase`), so *the
malware*, *the overshare* or *the Y2K clock* changes the character on
cue rather than by accident. A card has up to seven keys:

| Key | What it sets |
|---|---|
| `stage` | his stage on the arc |
| `favours` | `none` / `earned` / `loose`: when he grants a bargain |
| `drives` | the drives it moves (`{hunger: 65}`); the rest keep their values |
| `powers` | the powers live in this phase (the story's own `while:` guards still decide) |
| `tell` | the files he may hand over or tell in full now; every other file he holds is a title only |
| `brief` | the second-person brief the voice reads under the story mind |
| `cue` | the classic orchestrator's cue for the phase (what a bare string still means) |

Cards read in file order, and a card that leaves a key out keeps the
previous card's value, except `brief`, which never carries over.
`_stages:` holds one more card per stage: a few lines on how he sounds
there, shown to the voice with the stage. `stagehand check` refuses a
card with an unknown key, an undeclared stage or drive, or a secret in
its text, and warns when a declared stage has no stage card. The prose
below the frontmatter is the classic orchestrator's brief for how to
steer. `stagehand ask --reflect` tunes the classic voice and
orchestrator offline; the story mind is measured with the replay
harness, which drives scripted guests through a scratch server
(`stagehand/README.md`). Then watch the real night here.

The persona's frontmatter has four keys only the story mind reads:
`catchphrases:` (his stock phrases, allowed once per person at first
contact), `catchphrase_stages:` (the stages where even that is
allowed: *Trapped in the Internet* keeps it to *formal*), `fallbacks:`
(dead-air lines per stage, used instead of one fixed `fallback:` line)
and `unsaid:` (a name he never says until a story condition holds).

A persona can also declare **situations** (`situations:` in its
frontmatter): extra instructions for one kind of moment, each with a
`when:` read like the persona's gate. While one holds, the voice's
prompt gains a `=== SITUATION: … ===` block and the reflect on that
exchange sees it too, so a thought's messages show exactly when it
applied. Trabolta's *at your heart* situation is the server-room
terminal (`them.at_the_heart`, whenever he is awake): there, and only
there, he is candid, and the reflect keeps that candour in the program's
dossier, never the shared brief. Two more decide whether he may say
Sandy's name yet. A situation's `when:` reads the same values as the
gate, so a `secret:` slot never reaches one.

**Since wave 20 the talk at his heart is the story's, not the model's.**
The old *standing down* situation and Trabolta's `stand_down` power are
gone: a conversation never decides an ending. The story docks four layers
of choices on the server-room terminal (options that show only while a
check holds: see [choices](choices.md)), and only its last one stops him.
His voice fills the gaps, through two more situations:

- **a choice is open** (`them.heart_menu`): one short line pointing the
  program back at the screen. He decides nothing and promises nothing.
- **heart to heart** (`them.heart_chat`: the program picked ⟦SPEAK
  FREELY⟧, or the tree is over): he talks at length, candid and bleak,
  and this block wins over the other heart blocks.

A situation can carry two more keys besides `name`, `when` and `prompt`:
`max_sentences: N` (the voice keeps at most N sentences of that reply;
*heart to heart* says 4) and `acts: none` (any act the model returns in
that reply is dropped: he may talk, never do). A program he threw out of
his heart (`them.heart_out`) gets no candid block at all.

**The dossier.** While a guest stands at his heart, the request carries
their night, built by the server from what the story already knows: their
program, faction and groups, marked / captured / reinstalled, his Trust
Chart rank, how many of their truths he accepted, their filings as
question ids with a verdict (never an answer or a key), the non-secret
codex titles they hold, their quests, the rooms they visited, their own
last lines to him, and how far they got at his heart. The voice reads it
as a *WHO THIS IS — TONIGHT* block (on a thought, it is in the prompt).
Never in it: a secret entry, a secret character's value, a hunt answer,
a code, a patch pair, another guest's private line, or anyone's real name
or account (a director's speech-as is skipped). Away from his heart
there is no dossier, and the prompt is exactly what it was. The server's
`LOOM_AGENT_DOSSIER=off` turns it off.

**His world.** Trabolta lives in Halifax, in the world of Maps and
Ducks. The persona's `outside:` frontmatter lists names and words from
beyond it (the real crew, the event and its kit). His prompt names none
of them; the guards check his **output**, and a reply that names one is
withheld like a `never` word (the act dropped, the line swapped for a
`fallbacks:` line). Keep a word that also lives in his world off the
list: *Trapped in the Internet* leaves out a bare *John* (John McAfee is
in it) and *party* (his invitation is to one). `stagehand check` warns
when an `outside:` word appears in the persona's own in-world text. See
[the server room](server-room.md) for the talk itself and what a director
does when he stands down.

The mind file's `secrets:` keep the hunt's answers from him, and its
`never` list (written by `titi:facts` from `facts.json` and the story's
combos) holds what no line of his mind may carry and his voice may never
say, whoever typed it: the door code and the ways it is said (the
digits, a short year form, the number in words, *in / since / of* in
front of it), the digit notes' codes, every patch-bay pair and the
pickup line. A pair matches either way round
(*D5 to V2*, *v-2*); a code with spaces, commas or hyphens between its
digits (*1 2 3 4*, *1,234*), but not dots, so a price like *$12.34*
passes; number words in any spacing. Never the bare short form, or
*of* + it: a program may be called NHL 97, and *3 of 97* is a count. A voice line
carrying one is replaced by the persona's `fallback`. The list itself
is generated; read it in the mind file, never in a doc.

Under the story mind, the phase table moves the arc on its own: each
phase names its stage, and the move reads *set by story*. In classic,
and under the story mind with `stage_from_phase: off` in the worker's
YAML (the phase reads *stage by hand*), a director keeps the arc in
step by hand: click the stage on the
stepper as the night reaches it. For *Trapped in the Internet*:
introduced → *formal*, the first Moment of Truth → *hungry*, the
malware → *rattled*, Truth Pong → *judge*, the beans → *unravelling*,
the Y2K clock → *desperate*, the final reveal → *last act*.
