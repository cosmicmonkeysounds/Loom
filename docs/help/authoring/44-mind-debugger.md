---
title: The mind debugger — watching an agent think
section: The Editor
order: 44
keywords: near miss, ruling, judge thought, queue, stalled, busy, mind, agent, trabolta, stagehand, orchestrator, voice, model, ollama, reasoning, thinking, prompt, trace, thought, brief, stage, arc, drives, policy, bargain, questions, nudge, whisper, reset, survey, pause, re-run, effort, debugger, control panel, hold, offline, worker down, not responding, answer by hand, judging, judge, facts.json, verdict, override, judge_mode, auto, review, pending, filing, tally, consensus, secrets, never, door code, combo, suppressed, restart, limit
---

A character marked `mind: external` has no performer: a language model
answers it, run by the **stagehand agents** worker on the show laptop
(see [live shows](30-live-shows.md)). Two models share the job — a
**voice** that answers each line in seconds, and a slower
**orchestrator** that, between turns, rewrites the character's *mind*:
the brief the voice is handed next, what it has decided, its files on
people, what it was fed and whether it believed it. **Run → Mind** is
the window into both, and the hand on the wheel.

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
launchd restart --job agents` on the house Mac): a worker that dropped
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
  asked for the reason, which goes into the history.
- **The brief** — the second-person instructions the voice is handed
  right now, with the mood. **Edit** rewrites it (the next reflection
  may rewrite it again). Pending **whispers** (your nudges, below) show
  here until the orchestrator folds them in.
- **Drives** — the mind's own 0–100 dials (`drives:` in the mind file:
  hunger, suspicion, pride, candour, longing…), each with a sparkline over
  every revision of the night and its change since the first. Drag a
  slider to set one.
- **Bargains** — the policy on favours as the orchestrator keeps it:
  *none* / *earned* / *loose*, who has credit, who it is wary of.
  Change it from the select.
- **Collecting answers to** — the questions the character is asking
  everyone (its obsessions) and the answers gathered so far, with who
  gave them.
- **Decided / noticed**, **fed to him** (every claim with a verdict:
  fact / bluster / unknown), **files on people** (trust bar, turns,
  summary; click a row for claims / asks / promises, *Set trust*,
  *Forget*), thread summaries, and the **revision log** — every change
  numbered, by whom (`reflect`, `survey`, a director's name, `reset`),
  and a **thought** button to open the model call that made it.

## The trace (right)

Every model call the worker made, newest first, colour-badged and
labelled: **voice** (the fast model answering a line), **lookup** (the
second call after it asked the session about a program, room, or
lore), **reflect** (the orchestrator after an exchange), **survey**
(the orchestrator looking at the whole house), **re-run**, **judge** (a
ruling on a near-miss filing, below), and the
markers **reset** / **control** / **error**. Each row says who it was
with, which model, what triggered it, how long it took, and a summary
(the line said and the numbers nudged; or the mind fields it updated).
Filter by kind, by person, or by text across prompts, reasoning and
output.

Open a thought to see, in tabs:

- **Input** — the messages exactly as sent (system / user / assistant;
  long system prompts fold).
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
/ combo)*), so a program feeding him the code reads differently from a
hunt claim.

The trace outlives a story restart (the worker marks the boundary with
a **reset** row), and a worker that reconnects replays its recent
thoughts, so a console opened late still sees the night.

## The control panel (header)

| Control | What it does |
|---|---|
| **Nudge** | whisper to the mind. The voice obeys it on its very next line; the survey it queues folds it into the brief and clears it. "Be shaken: someone just read your LiveJournal." |
| **Survey now** | the orchestrator looks at the house immediately |
| **Pause / Resume mind** | freeze the mind: replies keep coming, but nothing changes it until you resume |
| **Mind reasoning on / off** | show the orchestrator's thinking in the trace (slower) |
| **voice effort** | the voice model's reasoning effort: none / low / medium / high |
| **Reset mind** | the character back at the doors — stage one, drives at their opening values, nothing learned. The story keeps running. A story restart (↺ in the header) does exactly this on its own, through the same channel. |

Everything the panel does is recorded as a **control** row in the
trace with your name, and every direct edit is a revision *by you*, so
a rehearsal's log says what the models did and what a human did.

## Judging (the facts judge)

Above the mind sits the **Judging** card — the server's judge of filed
facts (see *Judging with facts.json* in [cards & widgets](widgets.md)).
It shows even before a worker has reported; on a project with no
`facts.json` it says so and judges nothing.

- **The mode switch** — `auto` / `review`, writing the variable the
  card names (`Night.judge_mode` by default) through the same journaled
  `set` as the World page. In `auto` every filed fact gets its verdict
  at once — except a **near miss** (a typo of the key, a number written
  out, the key said at length), which waits here as in review (or goes
  to the story's `judge:` character first, below); in `review` every verdict is a
  proposal until someone confirms it, and a round closing settles the
  rest by the proposal. Beside it: *nothing pending* or *N pending*,
  and how many of those are near misses.
- **Pending filings** (review mode, and near misses in either mode): one
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
  *Trapped in the Internet*'s `judge: Trabolta`). In `auto` mode a near
  miss is put to that character's worker the moment it is filed, if a
  worker voicing it is online and not stalled. Its row reads **🤖 asking
  Trabolta…** and `# hosts` says *… asked Trabolta to rule*. The worker
  makes one separate model call that sees only the question, the key and
  the filed answer, and answers *same* or *not*. *Same* is judged
  accurate; *not* is a confident lie at confidence 100, uncertain below.
  It goes through the same confirm event as your buttons, journaled `by:
  agent:Trabolta`, and `# hosts` gets *🤖 Trabolta ruled X's H2 filing
  "Mr Pickels": the same as "Mister Pickles" (accurate).* plus his one-line
  reason. The ruling then lists under the pending rows (*🤖 Trabolta: same
  — why*, *now accurate*) with its own ✅ / 😤 / 🤷: press one to
  override it (the later verdict wins, and the row says *overridden by*
  you). Judge a row yourself while it is asking and his ruling is
  dropped. If no worker is online when the filing lands, the near miss
  waits for you as above and is never asked later (only a server
  restart asks the ones still pending). A ruling with no answer in 60
  seconds is dropped the same way. In `review` mode nothing is asked.
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
  abbreviation like "Mr. Pickles" is already accurate) and the place a host's booth sends you when a program has
  more than one filing waiting.

Judging runs on the event server, so a local-folder run shows the card
with an explanation and no verdicts: rehearse the hunt on a server
project ([run mode](run-mode.md)).

## Shaping the arc

The mind file (`trabolta.mind.md` beside the persona) is where the
night's shape lives: `stages:` in order, `drives:` with opening values,
and `phases:` — a cue per story phase (`Night.phase`) handed to the
orchestrator when the house enters it, so *the malware*, *the
overshare* or *the Y2K clock* changes the character on cue rather than by accident. The
prose below the frontmatter is the orchestrator's brief for how to
steer. Tune both offline with `stagehand ask --reflect`, then watch the
real night here.

A persona can also declare **situations** (`situations:` in its
frontmatter): extra instructions for one kind of moment, each with a
`when:` read like the persona's gate. While one holds, the voice's
prompt gains a `=== SITUATION: … ===` block and the reflect on that
exchange sees it too, so a thought's messages show exactly when it
applied. Trabolta's *at your heart* situation is the server-room
terminal (`them.at_the_heart`, whenever he is awake): there, and only
there, he is candid, and the reflect keeps that candour in the program's
dossier, never the shared brief. A separate *standing down* situation
(the same place, from the Y2K hour) carries the `stand_down` rules; the
persona never fires that power without it. Two more decide whether he may say
Sandy's name yet. A situation's `when:` reads the same values as the
gate, so a `secret:` slot never reaches one. See [the server
room](server-room.md) for what a director does when he offers to stand
down.

The mind file's `secrets:` keep the hunt's answers from him, and its
`never` list (written by `titi:facts` from `facts.json` and the story's
combos) holds what no line of his mind may carry and his voice may never
say, whoever typed it: the door code and the ways it is said (the
digits, a short year form, the number in words, *in / since / of* in
front of it) and every patch-bay pair. A pair matches either way round
(*D5 to V2*, *v-2*); a code with spaces, commas or hyphens between its
digits (*1 2 3 4*, *1,234*), but not dots, so a price like *$12.34*
passes; number words in any spacing. Never the bare short form, or
*of* + it: a program may be called NHL 97, and *3 of 97* is a count. A voice line
carrying one is replaced by the persona's `fallback`. The list itself
is generated; read it in the mind file, never in a doc.

Until the orchestrator learns to follow the story's phases on its own,
a director can keep the arc in step by hand: click the stage on the
stepper as the night reaches it. For *Trapped in the Internet*:
introduced → *formal*, the first Moment of Truth → *hungry*, the
malware → *rattled*, Truth Pong → *judge*, the beans → *unravelling*,
the Y2K clock → *desperate*, the final reveal → *last act*.
