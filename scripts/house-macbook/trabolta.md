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
5. **(Wave 42) Four answers at once.** Measured on this MacBook on
   2026-10-29 (`pnpm sim:trabolta`, 50 bots at the intro, the real
   gpt-oss:20b): one at a time manages ~15 replies a minute (median wait
   164 s in the burst); `concurrency: 4` manages ~21 a minute (median wait
   ~99 s, worst ~121 s). Each reply then takes ~10 s instead of ~4 s, but
   a quiet house only ever has one thread open, so a lone guest still gets
   ~4 s. The model at 4 slots still fits (13 GB). Since wave 42 the worker
   tells the server how many lines it can work on at once
   (`agents.concurrency`, the stream's `capacity`), and the server queues the
   rest itself. Ollama must serve as many at once, or the extra calls just
   queue inside Ollama. **`scripts/house-macbook/trabolta-reset.sh` does all
   of this** (and steps 3–4, §6, and Run → Mind → Reset); by hand, for the
   macOS app (like `OLLAMA_KEEP_ALIVE` above):

   ```bash
   launchctl setenv OLLAMA_NUM_PARALLEL 4
   # then quit Ollama from the menu bar and open it again, and warm it (step 4)
   ```

   and in `laptop.yaml` set the matching line (§3):

   ```yaml
   agents:
     concurrency: 4               # = OLLAMA_NUM_PARALLEL; the stream's capacity
   ```

   Then restart the job (§6). Each parallel slot keeps its own 32k context,
   so the model takes more memory; check `ollama ps` still shows it loaded
   (100% GPU), and a single line may take a little longer while another is
   being written. `launchctl setenv` does not survive a reboot, like
   `OLLAMA_KEEP_ALIVE`. To go back: `concurrency: 1` and `launchctl unsetenv
   OLLAMA_NUM_PARALLEL`, reopen Ollama, restart the job. Never set
   `concurrency` above `OLLAMA_NUM_PARALLEL`.

6. **(Wave 42b) More compute: an overflow engine.** When one MacBook is not
   enough, add a second model server to the **same** worker (one mind:
   his memory never splits). In `laptop.yaml`, under `agents:`, uncomment
   and edit the `overflow:` block from `agents.example.yaml` (reference:
   `stagehand/docs/agents.md`, "Overflow engines"). The worker then
   announces `concurrency` + each engine's `capacity`; a line takes the
   MacBook first, then each engine in order; an engine that fails is
   skipped for 30 s and the line retried once on another. Summaries and
   the letters stay on the MacBook.

   - **A second Ollama on the LAN** (e.g. the Windows Desktop, only if it
     has a GPU that holds gpt-oss:20b): there, `ollama pull gpt-oss:20b`,
     set `OLLAMA_HOST=0.0.0.0` (and `OLLAMA_NUM_PARALLEL` ≥ its
     `capacity`), allow port 11434 through its firewall on the private
     network, then:

     ```yaml
     overflow:
       - name: desktop
         endpoint: http://192.168.8.10:11434/v1
         capacity: 1
     ```

     The guests' lines stay in the house.
   - **A hosted OpenAI-compatible gpt-oss-20b endpoint.** **Privacy: every
     line it serves leaves the house**, with his whole prompt (the guest's
     words and name, his notes about them, the story's facts). Decide that
     before doors, not during. Set `model:` to the provider's name for it,
     `api: openai`, and `api_key_env:` to the **name** of an environment
     variable; the key itself never goes in the YAML, a doc or a chat. The
     launchd job does not read your shell, so give the key to launchd
     without it landing in the shell history:

     ```bash
     read -rs KEY && launchctl setenv LOOM_OVERFLOW_KEY "$KEY"; unset KEY
     export LOOM_OVERFLOW_KEY="$(launchctl getenv LOOM_OVERFLOW_KEY)"   # for `check` in this shell
     ```

     Like `OLLAMA_NUM_PARALLEL`, it does not survive a reboot.

   Then `stagehand check` (§4): the `engines :` line counts every slot, each
   engine's line says `key LOOM_OVERFLOW_KEY set` (never the key), and a
   hosted one adds a note that the lines leave the house. Restart the job
   (§6). To go back: comment the block out again and restart. Run → Mind
   shows `engine <name>` on each thought an overflow engine served.

   **Brief mode** (wave 42b, off by default): `voice.brief_at: 6` in
   `laptop.yaml` asks for at most two short sentences when 6 or more lines
   wait for him (never a talk scene, never a guest at his heart). Measured
   on this MacBook it bought no throughput (his DMs are already short), so
   leave it off.

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
are, except `concurrency:`, which matches Ollama's `OLLAMA_NUM_PARALLEL`
(§2 step 5, wave 42; 1 if you did not set it). `laptop.yaml` holds the passcode: it stays git-ignored, never pasted
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
(`mind : NEW …`), the `agents :` line with `concurrency N · capacity N`
(wave 42: the N you set; past 1 it adds a note naming
`OLLAMA_NUM_PARALLEL`), the voice line with `ctx 32768` (the orchestrator's
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

## 5b. The reset script (wave 42)

`scripts/house-macbook/trabolta-reset.sh` puts this Mac back in show shape
in one go, and only touches what is off:

```bash
scripts/house-macbook/trabolta-reset.sh --check      # read-only: what is off (exit 1 if anything)
scripts/house-macbook/trabolta-reset.sh              # fix it: env, Ollama, model, check, restart, Mind reset
scripts/house-macbook/trabolta-reset.sh --no-reset   # the same, but keep his mind (mid-rehearsal)
scripts/house-macbook/trabolta-reset.sh --persist    # also set the env at every login (survives a reboot)
```

1. `OLLAMA_NUM_PARALLEL` = `laptop.yaml`'s `concurrency`, and
   `OLLAMA_KEEP_ALIVE=-1`, through `launchctl`; a changed value quits and
   reopens the Ollama app. `--persist` installs
   `~/Library/LaunchAgents/com.mapsandducks.ollama-env.plist`, which sets
   both at login and reopens Ollama (`--unpersist` removes it).
2. `gpt-oss:20b` pulled, and loaded at the worker's own context size.
3. `stagehand check --only agents`.
4. `stagehand launchd restart --job agents`, then it waits until the
   event server sees him online and prints the capacity the server holds
   (`legacy` = an older worker or server).
5. Run → Mind → **Reset** (the panel's own call). A reset forgets every
   guest's file: after the doors open use `--no-reset`.

It reads the moderator code from `laptop.yaml` and never prints it. Run it
after a reboot, a `git pull`, or a persona or mind edit.

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
  OLLAMA_KEEP_ALIVE -1` (and, with `concurrency: 2`, `launchctl setenv
  OLLAMA_NUM_PARALLEL 2`) and reopen Ollama, warm the model (`ollama run
  gpt-oss:20b hi`), `caffeinate -dims`, then `uv run stagehand launchd
  status`.
