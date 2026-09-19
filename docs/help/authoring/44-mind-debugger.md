---
title: The mind debugger — watching an agent think
section: The Editor
order: 44
keywords: mind, agent, trabolta, stagehand, orchestrator, voice, model, ollama, reasoning, thinking, prompt, trace, thought, brief, stage, arc, drives, policy, bargain, questions, nudge, whisper, reset, survey, pause, re-run, effort, debugger, control panel
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

## The mind now (left)

- **The arc.** The mind file declares the character's night as
  **stages** (`stages:` in its frontmatter — for Trabolta: *lonely
  grandeur → appetite → the question → the turn*). The stepper shows
  where the character is, when it got there and why (hover a stage).
  Click a later stage to move the character there yourself; you are
  asked for the reason, which goes into the history.
- **The brief** — the second-person instructions the voice is handed
  right now, with the mood. **Edit** rewrites it (the next reflection
  may rewrite it again). Pending **whispers** (your nudges, below) show
  here until the orchestrator folds them in.
- **Drives** — the mind's own 0–100 dials (`drives:` in the mind file:
  hunger, suspicion, generosity, resolve…), each with a sparkline over
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
| **Nudge** | whisper to the mind. The voice obeys it on its very next line; the survey it queues folds it into the brief and clears it. "Be shaken: you just felt a key turn." |
| **Survey now** | the orchestrator looks at the house immediately |
| **Pause / Resume mind** | freeze the mind: replies keep coming, but nothing changes it until you resume |
| **Mind reasoning on / off** | show the orchestrator's thinking in the trace (slower) |
| **voice effort** | the voice model's reasoning effort: none / low / medium / high |
| **Reset mind** | the character back at the doors — stage one, drives at their opening values, nothing learned. The story keeps running. A story restart (↺ in the header) does exactly this on its own, through the same channel. |

Everything the panel does is recorded as a **control** row in the
trace with your name, and every direct edit is a revision *by you*, so
a rehearsal's log says what the models did and what a human did.

## Shaping the arc

The mind file (`trabolta.mind.md` beside the persona) is where the
night's shape lives: `stages:` in order, `drives:` with opening values,
and `phases:` — a cue per story phase (`Night.phase`) handed to the
orchestrator when the house enters it, so *the glitch* or *the keys
turning* changes the character on cue rather than by accident. The
prose below the frontmatter is the orchestrator's brief for how to
steer. Tune both offline with `stagehand ask --reflect`, then watch the
real night here.
