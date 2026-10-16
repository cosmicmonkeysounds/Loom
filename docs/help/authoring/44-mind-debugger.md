---
title: The mind debugger — watching an agent think
section: The Editor
order: 44
keywords: mind, agent, trabolta, stagehand, orchestrator, voice, model, ollama, reasoning, thinking, prompt, trace, thought, brief, stage, arc, drives, policy, bargain, questions, nudge, whisper, reset, survey, pause, re-run, effort, debugger, control panel, hold, offline, worker down, not responding, answer by hand, judging, judge, facts.json, verdict, override, judge_mode, auto, review, pending, filing, tally, consensus
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
(the orchestrator looking at the whole house), **re-run**, and the
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
  at once; in `review` every verdict is a proposal until someone
  confirms it, and a round closing settles the rest by the proposal.
  Beside it: *nothing pending* or *N pending*.
- **Pending filings** (review mode): one row per filing waiting for a
  verdict — the program, the question id, the answer in quotes, the
  confidence, and *proposed accurate / lie / uncertain*. Three buttons
  settle it: **✅ accurate**, **😤 confident lie**, **🤷 uncertain** —
  the proposal's button is outlined; press it to confirm, another to
  override. Each fires the story's own confirm event for that program
  with the question attached (the events `facts.json` names under
  `judge.confirm`; the hosts' 📝 booth buttons fire the same ones), so
  the story reacts exactly as it would to a host, and the override is
  journaled under your name.
- **The tallies** — per question: filed, accurate, lie, uncertain,
  pending, and ✓ **consensus** (every filing accurate at confidence
  100 — what *Trapped in the Internet* reads as "Clippy happy").

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

Until the orchestrator learns to follow the story's phases on its own,
a director can keep the arc in step by hand: click the stage on the
stepper as the night reaches it. For *Trapped in the Internet*:
introduced → *formal*, the first Moment of Truth → *hungry*, the
malware → *rattled*, Truth Pong → *judge*, the beans → *unravelling*,
the Y2K clock → *desperate*, the final reveal → *last act*.
