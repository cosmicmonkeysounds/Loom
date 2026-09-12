# @loom/mind

Gives a Loom `CHARACTER` a mind. A small bridge that signs into a live
event as a moderator, reads every message a participant sends to the
character's DM off the mod feed, answers **in character** through a
local OpenAI-compatible language model (Ollama by default — "a tiny local
LLM on my laptop"), and nudges the story's variables through the mod API.

The story stays authoritative. The model can *move* numbers
(`Trabolta.truth += 5`) but only the story's own `when` rules decide what
they mean (`when Trabolta.untruth >= 80: -> Ending Rogue`). Everything the
bridge sends is an ordinary journaled mutation, so a rehearsal and the
live night replay identically.

```
laptop                                 production server
┌────────────────────────┐  SSE (mod feed)  ┌──────────────────────┐
│ loom-mind              │◀─────────────────│ @loom/core event     │
│  persona.md → prompt   │  POST /mod/say   │ server               │
│  ollama /v1/chat       │─────────────────▶│  dm:Trabolta thread  │
│  reply → say + adjust  │  POST /mod/var   │  Trabolta.* vars     │
└────────────────────────┘─────────────────▶│  when-rules → ending │
                                            └──────────────────────┘
```

## Run

```bash
ollama pull llama3.2 && ollama serve          # any OpenAI-compatible /v1 works
pnpm --filter @loom/mind start -- \
  --server https://party.example.com --event <eventId> --mod-code <MOD CODE> \
  --persona ../core/examples/trapped-in-the-internet/trabolta.persona.md
```

Add `--dry-run` to watch what it *would* say, `--say <guest id>` to
answer one guest once and exit, `--model` / `--endpoint` to override the
persona's frontmatter. Env fallbacks: `LOOM_SERVER`, `LOOM_EVENT`,
`LOOM_MOD_CODE`, `LOOM_MOD_TOKEN`, `LLM_API_KEY`.

The laptop only needs to reach the server (outbound); the server never
calls the laptop. Restart it any time — it reads the feed's history for
context but never answers the past.

## The persona file

Markdown with a little frontmatter:

```
---
character: Trabolta                 # the CHARACTER as declared (required)
model: llama3.2
endpoint: http://localhost:11434/v1
temperature: 0.9
max_tokens: 160
variables: truth, untruth, stance, love   # <character>.<var> it may adjust
max_step: 15                              # clamp per adjustment per reply
---
You are TRABOLTA …                  # the system prompt
Reply ONLY with JSON: {"say": "…", "adjust": {"truth": 0, …}}
```

Before each reply the bridge appends a **live state block**: the
character's variables, what the character *knows* (their codex — which
grows as participants share lore with them), who the guest is, what the
guest knows and a few of their stats, then the recent DM thread as
user/assistant turns. The model answers with one JSON object; a model
that ignores that still works (the text becomes the line, nothing is
adjusted). Adjustments are clamped and limited to the declared variables.

## Wire contract (`core/server/event-runtime.ts`)

| Call | Purpose |
|---|---|
| `POST /api/mod/login {passcode}` → `token` | then `x-loom-token` on everything |
| `GET /e/:id/events?role=mod` | SSE: `snapshot` (world table), `history`, `message` |
| `GET /api/state?role=mod` · `?role=guest&as=<id>` · `?role=prime&as=<Character>` | the world, the guest's view (codex, name), the character's codex |
| `POST /api/mod/say {as, channel: "guest:<id>", text}` | the reply, in the character's DM with that guest |
| `POST /api/mod/var {path, value}` | `Trabolta.truth = 40` — watchers fire |

In the story, mark the character `mind: external` and `listed: true` so
guests can find it in the directory and message it. See
[`core/examples/trapped-in-the-internet`](../core/examples/trapped-in-the-internet).

## Tests

`pnpm --filter @loom/mind test` — persona parsing, reply parsing and
clamping, prompt building, feed filtering, the SSE parser, and the whole
loop against a fake server + fake model (no network).
