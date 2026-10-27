# Trabolta on John's MacBook: Ollama + the `agents` worker

Trabolta's voice and mind run on **John's MacBook** (macOS, M3 Max, 48 GB):
**Ollama** serves the model `gpt-oss:20b`, and stagehand's **`agents`**
worker holds the event server's agent stream, writes each of his lines with
one call to that model (`mind_mode: new`, the story mind), and posts it
back. The laptop only dials out (HTTPS to `app.mapsandducks.com`); nothing
dials in. This is the whole runbook, from a clean Mac to *Trabolta online*.

The MacBook's other jobs are the director's Run console and the ops scripts
(`scripts/ops/`). The house sound and lights run on John's Desktop
([`scripts/house-desktop/README.md`](../house-desktop/README.md)); this Mac
runs the speaker router only as the fallback ([`audio.md`](./audio.md)).

How the worker thinks (the persona, the mind file, the kill-switch ladder,
the judge): [`stagehand/docs/agents.md`](../../stagehand/docs/agents.md).
The persona and mind file are in the show folder:
`core/examples/trapped-in-the-internet/trabolta.persona.md` and
`trabolta.mind.md`.

```
VPS event server ◄── HTTPS (SSE GET /api/agent/stream + POSTs) ── stagehand agents (launchd) ── http://127.0.0.1:11434 ── Ollama gpt-oss:20b
```

## 1. The Mac itself (once)

- **Plugged in all night**, and it must never sleep: System Settings →
  Battery → Options → *Prevent automatic sleeping on power adapter when the
  display is off*, and on the night `caffeinate -dims` in a Terminal tab.
  A sleeping MacBook is an offline Trabolta.
- **Automatic login** (System Settings → Users & Groups): every stagehand
  job is a per-user LaunchAgent, so after a power cut nothing starts until
  the user is logged in.
- **Do Not Disturb** for the night.
- Tools: [Homebrew](https://brew.sh), then `brew install git node pnpm uv`
  (or uv's installer: `curl -LsSf https://astral.sh/uv/install.sh | sh`),
  and the repo checked out (this is the main checkout the ops scripts run
  from). `cd stagehand && uv sync` once.

## 2. Ollama and the model

1. Install Ollama: the macOS app from <https://ollama.com/download> (it
   starts at login and serves on `http://127.0.0.1:11434`), or
   `brew install ollama` and `brew services start ollama`.
2. Pull the voice (≈ 13 GB, once):

   ```bash
   ollama pull gpt-oss:20b
   ```

   Only `mind_mode: classic` also needs the orchestrator model
   (`tobestyledintro/qwen3.8-9b-distill:q8_0`); the show runs `new`, so skip
   it, and never leave it loaded (`ollama ps`; `ollama stop <name>`).
3. **Keep the model loaded.** Ollama unloads an idle model after 5 minutes,
   and the next guest then waits ~25 s for a reload. The worker already asks
   for `keep_alive: 60m` on every call (`api: ollama` in `laptop.yaml`); set
   Ollama's own default to "forever" as well. For the macOS app (Ollama's
   FAQ: app settings come from `launchctl`):

   ```bash
   launchctl setenv OLLAMA_KEEP_ALIVE -1
   # then quit Ollama from the menu bar and open it again
   ```

   (`brew services`: put `OLLAMA_KEEP_ALIVE=-1` in the service's
   environment instead, or run `OLLAMA_KEEP_ALIVE=-1 ollama serve` in a
   Terminal tab.) `launchctl setenv` does not survive a reboot: run it again
   after one, before the doors.
4. Warm it and check:

   ```bash
   ollama run gpt-oss:20b hi     # the first answer loads it (~25 s)
   ollama ps                     # gpt-oss:20b, alone, UNTIL "Forever" (or ~60 min)
   ```

## 3. `stagehand/laptop.yaml` (git-ignored)

```bash
cd stagehand
cp agents.example.yaml laptop.yaml
```

Edit `laptop.yaml`, the `server:` block only (the rest of the example is the
show's tested setup):

```yaml
server:
  url: https://app.mapsandducks.com   # the VPS (the example says a local dev server)
  event: <the live event's id>        # Run → front of house, or the /e/<id> URL
  mod_passcode: "<the mod passcode>"
```

Leave `agents: mind_mode: new`, `llm: model: gpt-oss:20b`, `api: ollama`,
`keep_alive: 60m` and the persona path
(`../core/examples/trapped-in-the-internet/trabolta.persona.md`) as they
are. `laptop.yaml` holds the passcode: it stays git-ignored, never pasted
into a doc or a chat. On the morning of the show, if the live event is a
new one, change `event:` and restart the job (§5).

Talk to him with no server first (the persona and the model, nothing
else):

```bash
uv run stagehand ask --config laptop.yaml "Hello?"
```

## 4. Check, then install the job

```bash
uv run stagehand check --config laptop.yaml --only agents
```

It must reach the server and the model and print the mind mode
(`mind : NEW …`), the voice line with `ctx 32768` (the orchestrator's
`mind` line, if printed, reads `ctx 20480`), and **no warning** and no
`PLACEHOLDER server.…` line. Then:

```bash
uv run stagehand launchd install --job agents --config laptop.yaml
uv run stagehand launchd status                 # agents: running
tail -f ~/Library/Logs/stagehand/agents.log      # Ctrl+C to stop watching
```

The job is the LaunchAgent `com.mapsandducks.stagehand.agents`: started at
login, relaunched if it exits, running `uv run stagehand run --config
laptop.yaml --only agents`.

## 5. Check him in the event

- **Run → Mind** (the editor's Run mode, on the event): the worker chip
  connected, named after `agents.name` (`laptop`), with a **mind · story**
  chip. Then **Reset** (every mind back at the doors) before the doors.
- **Run → House → Setup**: the **🧠 Trabolta** row is green (*Online on
  laptop*); red says what to do (Ollama, then the job).
- `pnpm showctl preflight macbook` (with `export LOOM_MOD_CODE='<mod>'` in
  that shell): Ollama answering, the model pulled and loaded, `laptop.yaml`'s
  `mind_mode`, the `agents` job, power, sleep, ssh to the VPS, backups. It
  also expects **no** `audio` job here (the router is the Desktop's); in the
  fallback pass `--router macbook`.
- Send him one DM from a test phone (a rehearsal event, never the live one
  after doors) and watch the line arrive in a few seconds.

## 6. After a change, and on the night

- **A persona, mind file or worker change** (a `git pull`): `uv run stagehand
  launchd restart --job agents`, then Run → Mind → **Reset**.
- **He stops answering**: Run → Mind shows the worker offline or ⏳
  stalled. Check `ollama ps` (the model loaded?), then `uv run stagehand
  launchd restart --job agents`. Meanwhile a director answers as Trabolta
  from Run, and the story's hold line covers the wait. **Never `pkill -f
  "stagehand run"`**: it kills every stagehand job on the machine.
- **The kill-switch ladder** (one step at a time, each followed by a
  restart of the job): `stagehand/agents.example.yaml`'s comment and
  `stagehand/docs/agents.md`.
- **After a reboot**: log in (or let automatic login), `launchctl setenv
  OLLAMA_KEEP_ALIVE -1` and reopen Ollama, warm the model (`ollama run
  gpt-oss:20b hi`), `caffeinate -dims`, then `uv run stagehand launchd
  status`.
