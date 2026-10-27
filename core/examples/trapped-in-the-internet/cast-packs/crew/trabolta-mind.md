# Trabolta's mind: the rehearsal card (wave 12)

> For whoever sits at **Run → Mind** (the second director all night) and
> the **tech operator** at John's MacBook (Trabolta's worker and Ollama
> run there), who flips the switches. Read it
> before the 10-25 run-through, where we rehearse the switch back to
> classic once and time it. Help → *The mind debugger* has the long
> version.

## Card

**What changed.** Trabolta now runs on the **story mind** (`mind_mode:
new` in the MacBook's `stagehand/laptop.yaml`):

- **One model call per guest line.** Nothing thinks between lines: no
  survey every 2 minutes, no reflection after each reply, and the second
  model (qwen) is not loaded.
- **His stage follows the night on its own.** When `Night.phase` changes,
  the mind file's card for that phase sets his stage, mood (favours,
  drives), the powers he may use and his brief. The arc reads *set by
  story*. **You no longer click the stage at each phase.**
- **He remembers each person in the same call that answers them**: a
  short *memo by voice* on their file, plus what the story knows (what
  they gave him, what they filed, whether they are marked, their Trust
  Chart place).
- **Code checks every line before it goes out**: no code, combination or
  hunt answer; no made-up fact or hiding place; no name the story has
  not said yet; his stock phrase only once, at first contact; and no
  line this guest already heard (one retry, or the old sentences cut).

**A quiet Mind page is a healthy one.** On an empty house the trace does
not move for minutes. Check instead:

| Look at | Healthy |
|---|---|
| the worker chip | connected, with a *mind · story* chip |
| the queue badge | 0 waiting, or a short wait that clears |
| the phase beside *The mind now* | today's phase; the arc moved *set by story* when it changed |
| the brief's label | *set by story* (or *set by director* after your Rewrite / Edit, until the next phase) |
| the trace | one **voice** row per line to him, now and then a second one (trigger *retry*), a **summary** row when a conversation goes quiet |

**During a talk scene (wave 32)** (after 🤖, between the 🍾 spins, from 📺
to 📓, at 🫘) Clippy's lines, relayed by Task Manager, reach him as
**stage** requests in The Desktop: they go before every waiting DM, so a
DM may wait a little longer then. His answer is said to the whole room
(up to four sentences, no powers). He never holds or stalls out loud
there: if he is slow, Task Manager fires one of his canned lines and
`# hosts` says so. Nothing for you to do but watch the voice rows read
right for the scene.

**Worth a look:**

- the queue waits 40 s or more, or shows **⛔ stalled**: answer from Chat
  as Trabolta and tell the tech op (the Director card's *stalled* row);
- several **dead-air lines** in a row in one thread (*"Say that again.
  Slowly. I want all of it."*, *"I lost the thread. Again?"*: his
  stage's lines from the persona's `fallbacks:`): open the voice rows and read their notes
  (`answer-guard …`, `repeat …`, `unsaid name …`);
- a memo that is wrong about someone, or a brief that reads wrong for the
  moment;
- the phase beside the heading not following the night.

**Your own controls first** (no restart, effect on his next line):

- **Nudge**: a whisper he obeys on his next line ("Be shaken: someone
  just read your LiveJournal."). It stays until the next Rewrite brief
  or phase.
- **Rewrite brief**: one call rewrites his brief from the phase card,
  your whispers and the house. **Edit** writes it yourself. Either holds
  until the next phase.
- **The stage stepper**: holds until the next phase.
- **Drive sliders**: sent once, when you let go.
- **voice effort**: lower it if he is slow.
- **Answer by hand** from Chat, as Trabolta in that thread.

Never type a code, a combination, a hunt answer or whether a fact is
right into a nudge or a brief. A brief line that names one is dropped.

**The switches** (the tech op: edit `stagehand/laptop.yaml`, then
`uv run stagehand launchd restart --job agents`; a few seconds, his mind
is saved first, and his `hold:` line covers anyone who writes). One rung
at a time, smallest first, and say in `# hosts` what you changed:

| Rung | In `laptop.yaml`, under `agents:` | Use it when |
|---|---|---|
| 1 | `voice:` → `memo: off` | a memo is wrong, or he quotes his own notes (also stops the quiet summaries) |
| 2 | `voice:` → `repeat_guard: off` | the *retry* rows slow him down |
| 3 | `voice:` → `dossier_on_close: off` | a quiet summary is wrong, or the Mac is struggling |
| 4 | `mind:` → `stage_from_phase: off` | a phase card is wrong tonight; you step the stage by hand (below) |
| 5 | `voice:` → `layout: classic` | the new prompt itself reads wrong |
| 6 | `mind_mode: classic` | the story mind as a whole fails |
| 7 | on the VPS: `LOOM_AGENT_RECENT=off` + a server restart | what the server sends him is wrong. **Before doors only** |
| 8 | the previous release (`deploy/rollback.sh` on the VPS), the MacBook's whole checkout back to that release's commit with it (the last column of its line in the VPS's `~/loom-ops/releases.log`; the repo has no release tags) | nothing else helped. Before doors only |

**When to flip to classic (rung 6):** most of his replies are dead-air
lines; he answers but nothing he says fits the phase even after a
Rewrite brief; the worker will not start in the new mode; or rungs 1–5
did not help. What classic costs:

- the qwen model loads again: his first reflection takes about 25 s
  longer, and the Mac runs both models (`ollama ps` shows two);
- the mind thinks between lines again: a survey every 2 minutes (skipped
  while he is asleep, paused or after the ending), a reflection after
  each reply. His replies are slower (K-04: half of them took over 6.6 s
  in classic, against about 3.2 s on the story mind);
- **Survey now** replaces Rewrite brief, and **you step the stage at
  each phase again**: intro *formal* · C2 *hungry* · 📺 *rattled* · 🏓
  *judge* · 🫘 *unravelling* · 🕚 *desperate* · 🌑 *last act*;
- his stock phrase comes back more often (classic has no ration).

To come back, set `mind_mode: new` and restart the job again.

**Before doors** (with the tech op):

1. `uv run stagehand check --config laptop.yaml --only agents` prints
   `mind: NEW (one voice call per line) …` and `27 phase card(s), 8 stage
   card(s)`.
2. Run → Mind → **Reset mind** (the rehearsals' memos and briefs go).
3. `ollama ps` shows only `gpt-oss:20b` (the tech op unloads qwen with
   `ollama stop tobestyledintro/qwen3.8-9b-distill:q8_0`).
4. One DM to him from a test persona: one voice row, a memo on the
   persona's file, then Reset again.

**Rehearse on 10-25:** flip rung 6 and back once, time each restart, and
note the times here: classic [[EDIT: s]] · back to new [[EDIT: s]].
