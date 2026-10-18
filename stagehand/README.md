# loom-stagehand

The bridge between a live Loom event (the `@loom/core` event server) and
everything that isn't a phone: projection machines, props and sensors,
and characters voiced by a language model. One daemon, one YAML per
machine, **modules** switched on by section:

| Module | Section | Runs on | Does |
|---|---|---|---|
| **show** | `show:` | the house Mac | story → OSC/MQTT cues; MQTT sensors → story mutations |
| **agents** | `agents:` | the house Mac (Ollama) | answers every conversation with a `mind: external` character through a local model |
| **alexa** | `alexa:` | the house Mac | MQTT `show/announce` → a chime + the Mac's own `say` voice on a named CoreAudio device + channel map (`engine: server` opts in to `/api/mod/tts`, cached on disk) |

All three can run on one machine (the show does: one house Mac); they
still run as **separate launchd jobs** (see *launchd* below; the `alexa`
player has its own agent in `scripts/house-mac/`).

```
trapped.house.yaml (the house Mac)     laptop.yaml (same Mac, the agents job)
  server: {url, event, code}             server: {url, event, code}
  show:   {mqtt, osc, cues, sensors}     agents: {llm, characters}
  alexa:  {device, channels, chime, …}
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

### Two models: the voice and the mind

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

### The shape of a night: stages, drives, policy, questions

A mind file (`mind: trabolta.mind.md` in the persona) may open with a
frontmatter block that gives the mind **structure the orchestrator must
fill** — so the way the character changes is declared, steerable, and
visible, not buried in prose:

```yaml
---
stages: [lonely grandeur, appetite, the question, the turn]   # the arc, in order
drives: { hunger: 40, suspicion: 55, generosity: 10, resolve: 30 }  # 0–100, opening values
phases:                                   # an authored cue per Night.phase
  free_roam: "The glitch. The house is open and he has just revealed himself…"
  destruct: "Three keys have turned. He feels it…"
secrets:                                  # a hunt he must never be able to check
  topics: [billboard, pet cemetery]       #   the questions' words (he is told never to judge these)
  match: [pickles, eleven years]          #   answer words (never shown to any model)
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
  whoever typed them — the show's keypad code (+ the ways it is said:
  "'97", "in 97", "since 97", "in / since / of ninety-seven",
  "nineteen ninety-seven", "one nine nine seven" — never a bare "97",
  which a guest's program may be called, nor "of 97", which counts) and
  every patch-bay pair. A pair matches in any spelling and either way
  round (`V2 → D5`, `v2-d5`, `V-2 to D5`, `D5 to V2`); an all-digit word
  of 3+ digits allows a space, comma or hyphen between digits (`1 9 9 7`,
  `1,997`) but never a dot (`$19.97` is a price); a phrase of number
  words matches in any spacing or hyphens ("back in ninety seven"). The
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
  it; a reflection always sees the current phase's cue.
- **`director`** — whispers from the control panel (a *nudge*): the
  voice obeys them at once ("THE DIRECTOR WHISPERS"), the next
  orchestrator pass folds them into the brief and clears them.
- **`revisions`** — every change to the mind is numbered: who made it
  (`reflect` / `survey` / a director's name / `reset`), what it touched,
  the thought that produced it, and the small fields as they then stood.

The whole mind (not a summary) is mirrored to the server after every
change, with the worker's status (models, reasoning on/off, paused,
queue) — `POST /api/agent/mind` → `ModView.minds`.

### The trace and the control panel (the Mind page)

Every model call is recorded as a **thought** (`agents/trace.py`): the
messages exactly as sent, the model's **reasoning** when the API exposes
it (gpt-oss's `reasoning`, Ollama's `thinking`, an inline `<think>`
block), the raw output, why it stopped, token counts, wall time, what
the worker parsed, and — for the orchestrator — the diff it made to the
mind and the revision number. Kinds: `voice`, `lookup`, `reflect`,
`survey`, `rerun`, plus `reset` / `control` / `error` markers. Thoughts
append to `state_dir/<event>/<Character>.trace.jsonl` and stream to the
server (`POST /api/agent/trace`); on (re)connect the worker replays its
recent ring so a fresh console starts with the night so far. The
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
| `survey` | — | the orchestrator looks at the house now |
| `nudge` | `text` | a whisper: shown to the voice at once, folded into the brief by the survey this queues, then cleared |
| `set` | `field` = `brief` / `mood` / `stage` (+`why`) / `drive` (`name`, `value`) / `policy` (object) / `trust` (`person`, `value`) / `note` (`add` / `drop`) / `question` (`add` / `drop`) | a direct edit, applied through the same bounded merge as an orchestrator update, recorded as a revision by the director |
| `forget` | `person` | drop the file on someone |
| `thinking` | `on` | the orchestrator model's visible reasoning on/off (Ollama `think`) — the trace then shows Qwen's thinking; off is faster |
| `effort` | `level` `none` / `low` / `medium` / `high` | the voice model's reasoning effort (gpt-oss) |
| `pause` | `on` | freeze the mind: replies keep coming, jobs queue, nothing runs |
| `rerun` | `thought` | send a recorded call's messages to the model again (as configured now); the answer is recorded as a `rerun` thought and never applied |

Every control is acknowledged by a re-mirrored mind and a `control`
marker in the trace naming who did it.

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
| `unavailable` | what it says while the gate is closed (else silence). With **no worker online at all**, or only one that stopped answering (its oldest request timed out; it shows as away until it answers again), the event server says the story's `CHARACTER … hold:` line instead, after ~20 s |
| `fallback` | what it says when the model fails (else silence) |
| `model` / `endpoint` / `temperature` / `max_tokens` / `reasoning_effort` | per-character overrides of the section's `llm:` |
| `mind` | the orchestrator's prompt file (how *this* character grows); a built-in default otherwise |
| `orchestrator` | orchestrator model overrides for this character |
| `thread_window` / `summarize_after` / `reflect_after` | 12 / 20 / 1 — window, when to summarise, how often to reflect |
| `lookup` | may read the live session (default true; Trabolta ships `false` until lookups are filtered by what he holds) |
| `lookup_power` | a `who: agent` power fired with `target` = each program a lookup resolves (Trabolta: `snoop`) — being read is felt, deterministically |
| `powers` | `all` (default), `none`, or a list of `who: agent` interaction names |
| `bargain` | the favour policy the fast model reads (the orchestrator adjusts it in the brief) |
| `situations` | a list of `{when, prompt}` (+ an optional `name` for the heading): extra instructions for a kind of moment. Each `when` is read like the gate above; while it holds for a request, its prompt is appended to the voice's system prompt as its own `=== SITUATION: … ===` block and shown to the orchestrator's reflect on that exchange (which keeps it out of the shared brief, in that person's dossier) |

Trabolta's situations (wave 7): **at your heart** (`them.at_the_heart ==
true`, set by the story while the server-room terminal pilots that
program, and `Night.step >= 14`, the Y2K hour) makes him candid, like the Master: he admits the patch bay is
his heart and that he does not know the combinations or the door's code,
says what he wants and why, and may fire `stand_down` only when the
program has shown him what he wants is impossible (a host confirms it
with 🕊). Two more say whether he may call her Sandy there, by the same
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

Wire: `GET /api/agent/stream?characters=A,B&name=laptop` (SSE: `hello`,
`request`, `cancel`, `reset`), `POST /api/agent/reply {id, worker, say,
adjust, acts}`, `GET /api/agent/facts`, `POST /api/agent/mind`. All use
the mod capability. Server side: `core/server/agents.ts`.

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
blinking the house, every `sound <name>` as a QLab OSC cue (but `announce_chime` → the `alexa`
player), `do announce` to the `alexa` speaker plus QLab's `duck_music` cue (the music dips under it), `do door server_room` to the ESP32's door
**indicator** (`show/serverroom/lock`, the one retained command; the real
lock is a standalone keypad lock, code set by hand, never networked, and
nothing here drives it), `lights_alarm` to the server-room box's own siren
(`show/serverroom/alarm`; only a wrong patch-bay combo trips it), and the
sensors that come back as story signals (`server_door_opened` from the
wire-loop contact that closes when the door opens, on
`sensors/serverroom/door`, plus an optional Zigbee contact, both
`edge: true`, 20 s apart at most once; the story starts the server-room
cutscene on it, an entry with the code and an exit by the inside handle
alike; the printer's button
and lid, and the patch bay's `patch_combo_a` / `patch_combo_b` /
`patch_rejected`, judged here until signals carry arguments). The
safety rooms (stairs, bathroom, tent, server room, the server-room →
living-room path) are out of the `house` group, and `lights_blackout`
turns WLED off per device, leaving the Tube strip on dim preset 22.
`tests/test_trapped_house.py` cross-checks it against the story: every
light / sound cue has a rule, every sensor signal has a `when` in
`main.loom`, the two combos match the `Kernel.combo_*` seeds and the
codex halves — and it pins the safety edits (no cue darkens a safety
room or all of WLED, nothing drives a lock, edge-only door sensors that
fire once per opening in either direction). The wiring walkthrough is in
[`docs/loom-show-control.md`](../docs/loom-show-control.md) → *Trapped in
the Internet: the house rig*.

Mosquitto on the house Mac (static `192.168.8.10`) runs two listeners:
anonymous on `127.0.0.1:1883` for what runs on that Mac (stagehand's
`mqtt.host`, Zigbee2MQTT, the `alexa` player) and password-only on the
LAN at `:1884` as user `props` for the network props (WLED, the
server-room ESP32 in [`hardware/server-room/`](../hardware/server-room)).
Setup: `scripts/house-mac/alexa.md` → *Lock down the broker*.

```bash
uv run stagehand check --config trapped.house.yaml
uv run stagehand run   --config trapped.house.yaml --only show
```

## alexa — announcements out of the house speakers

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

House-Mac setup, launchd agent and the night's runbook:
[`scripts/house-mac/alexa.md`](../scripts/house-mac/alexa.md).

### Sensor rules: `edge` and retained messages

A state sensor republishes its state (Z2M sends `contact: false` with
every battery report; the broker replays a retained "open" on every
reconnect). Two per-rule switches make it fire once per real change:

```yaml
- on: { topic: "sensors/serverroom/door", when: "open == true" }
  edge: true                 # fire on false → true only (per topic)
  signal: { name: server_door_opened, debounce_s: 20 }
```

- **Retained messages never fire a rule** unless it says
  `accept_retained: true`. On an `edge: true` rule they still set the
  level, so a restart with the door propped open fires nothing.
- `edge: true` needs a `when:`; the level starts false (the first "open"
  after boot fires), and a message carrying none of the fields the
  condition reads (a battery-only report) is ignored.

### launchd: one job per module

```bash
uv run stagehand launchd install --job show   --config trapped.house.yaml
uv run stagehand launchd install --job agents --config laptop.yaml
uv run stagehand launchd status                    # both
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
`when:`), then Trabolta's dark room while his cut is still on, or lit
again once it is over and his look is still up. It waits (10 s at most)
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
and dry-run against a fake server), answer secrecy (`test_secrets`), the
`alexa` player, launchd plists, the `.local.yaml` overlay, `edge` /
retained sensor rules, the real rig against the story
(`test_trapped_house`) and the server-room firmware's broker settings
(`test_serverroom_firmware`). The router's socket wiring is
exercised live against Mosquitto + the event server (see the blinking-
LED milestone in the design doc), not in unit tests.
