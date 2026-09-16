# loom-stagehand

The bridge between a live Loom event (the `@loom/core` event server) and
everything that isn't a phone: projection machines, props and sensors,
and characters voiced by a language model. One daemon, one YAML per
machine, **modules** switched on by section:

| Module | Section | Runs on | Does |
|---|---|---|---|
| **show** | `show:` | the desktop | story → OSC/MQTT cues; MQTT sensors → story mutations |
| **agents** | `agents:` | the laptop (Ollama) | answers every conversation with a `mind: external` character through a local model |

```
laptop.yaml                      desktop.yaml
  server: {url, event, code}       server: {url, event, code}
  agents: {llm, characters}        show:   {mqtt, osc, cues, sensors}
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
its codex, and global world facts. The worker builds a prompt from the
character's **persona file**, asks the model, and posts
`{say, adjust}`. The server commits the line as a journaled `say` and
clamps each adjustment to the story's declared range. The story's own
`when` watchers decide what the numbers mean.

While a reply is being composed, the thread shows "Trabolta is typing…".
The server keeps **one open request per thread**. If someone sends
three lines while the model thinks, the agent answers once, then once
more with the whole burst. Requests queue while no worker is online
(People shows the character as "away"), re-dispatch if a worker drops,
time out after 2 minutes (one retry), and are cancelled by a run
restart.

```bash
ollama pull gpt-oss:20b
uv run stagehand ask --config laptop.yaml                  # chat with the persona, no server
uv run stagehand ask --config laptop.yaml --var love=80 "Do you love Sandy?"
```

The persona file (`core/examples/trapped-in-the-internet/trabolta.persona.md`)
is YAML frontmatter + the system prompt:

| Key | Meaning |
|---|---|
| `character` | the CHARACTER as declared (required) |
| `variables` | the numbers it may nudge (`truth, untruth, stance, love`) |
| `max_step` | ±cap per variable per reply (default 15) |
| `facts` | world path prefixes to show it (`Night.`) |
| `them` | the speaker's variables to show it (default: all) |
| `when` | a gate over `self.<var>`, `them.<var>`, `speaker.kind`, world paths |
| `unavailable` | what it says while the gate is closed (else silence) |
| `fallback` | what it says when the model fails (else silence) |
| `model` / `endpoint` / `temperature` / `max_tokens` / `reasoning_effort` | per-character overrides of the section's `llm:` |

**gpt-oss notes:** `reasoning_effort: low` gives about 2–6 s per reply on
a laptop. Reasoning tokens count against `max_tokens`, so keep that
around 800. JSON mode stays off: the reply parser copes with prose, code
fences, and `<think>` blocks.

Wire: `GET /api/agent/stream?characters=A,B&name=laptop` (SSE:
`hello`, `request`, `cancel`, `reset`), then `POST /api/agent/reply {id,
worker, say, adjust}`. Both use the mod capability. Server side:
`core/server/agents.ts`.

## show — story ⇄ house

### Wire contracts (core/server/event-runtime.ts)

- SSE feed: `GET {url}[/e/:event]/events?role=mod&id=stagehand` —
  frames `snapshot` / `history` / `message` / `sim`; stagehand consumes
  `sim` only.
- Mod auth: `x-loom-token` header; bootstrapped via
  `POST /api/mod/login {passcode}` when the config gives `mod_passcode`.
- Mutations: `POST /api/mod/signal {name, subject?}`,
  `POST /api/mod/beat {name, subject?}`,
  `POST /api/mod/set {id, field: "location", value}`.

> Note: the SSE stream itself grants the raw mod feed to any client that
> asks for `role=mod` — acceptable on the show's LAN island, but server-
> side hardening (tokened SSE) is an open item alongside the known
> `/api/history` IDOR.

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
and dry-run against a fake server). The router's socket wiring is
exercised live against Mosquitto + the event server (see the blinking-
LED milestone in the design doc), not in unit tests.
