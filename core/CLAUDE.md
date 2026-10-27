# core (`@loom/core`)

The TypeScript Loom engine (parser, `Sim` runtime, language service) and
the Node event server that hosts live shows, plus the multi-tenant
control plane (author accounts, projects, launching events). This is the
maintained engine: the Rust crates at the repo root lag it and know none
of the show-era language. The human-facing overview, the route table and
the environment table are in [`README.md`](./README.md); this file is
what an agent needs to work here safely.

The show, *Trapped in the Internet* (Oct 31 2026), is the Loom project in
`examples/trapped-in-the-internet/` and the server's default scenario.

## Layout: where things live

| Path | What |
|---|---|
| `src/parser/` | lexer, AST, `decl-body.ts` (declaration bodies), `statements.ts` (keyword statements lowered onto the directive AST), `names.ts` (name folding), `edit.ts` (span-preserving edits the editor's graph uses) |
| `src/runtime/sim/model.ts` | compiles a project into a `SimModel` (`compileModel`): characters, rules, watchers, interactions, objectives, header keys (`currency:`, `wallet:`, `watch:`, `countdown:`, `badge:`, `stat:`, `founding:`, `judge:`, `reinstall:`, `lock:` …) |
| `src/runtime/sim/sim.ts` | the `Sim`: world, ledger, hook drain, the executor, every journaled mutation |
| `src/runtime/sim/` (rest) | `crews.ts` (crews, faction mode), `board.ts` (watch / countdown), `badges.ts`, `stats.ts`, `channel-types.ts`, `effects.ts`, `DESIGN.md` |
| `src/lsp/` | `Workspace` (completion, hover, definition, references, symbols, diagnostics), `graph.ts` (the story graph), `rename.ts`, `w18-lints.ts` … `w26-lints.ts` (workspace lints L12xx) |
| `src/*.ts` | browser-safe shared modules: `house-desk.ts` (wave 25, `@loom/core/house-desk`), `cue-sheet.ts`, `host-board.ts`, `delivery.ts`, `facts.ts` + `answer-match.ts`, `casino.ts`, `go.ts`, `show-clock.ts`, `identity-kind.ts` |
| `server/server.ts` | process boot, static apps (`/`, `/terminal/`, `/reinstall/`, `/cards`, `/webmaster/`), `/api/health`, `/api/resolve-code`, control-plane routing |
| `server/event-runtime.ts` | one live event (`EventRuntime`, ~7,000 lines): every `/e/:id/api/*` handler, the journal commit + `fanout`, restarts, the ticker |
| `server/registry.ts` | `EventRegistry`: one `EventRuntime` per event, rehydrated at boot |
| `server/views.ts`, `chat.ts` | pure projections: `GuestView` / `PrimeView` / `ModView`, and SimEvent → channel messages. The editor imports both (`@loom/core/views`, `@loom/core/chat`) |
| `server/routes/` | route modules split out of the runtime: `host.ts` (the host allowlist), `screen.ts` (the terminals' screen state + heartbeat), `claims.ts`, `crews.ts`, `sides.ts`, `cards.ts`, `recap.ts`, `mod-log.ts`, `metrics.ts`, `press-lines.ts`, and the OCT31 item files `k12.ts` (print sheet), `k13.ts` (check-in), `k31.ts` / `k31b.ts` (push), `n02.ts` (re-pair, release), `rejoin.ts` (wave 23: badges, invitations re-entering, ask a host, per-part cast cards) |
| `server/` hubs | transport-free, clock-injected classes: `agents.ts` (`AgentHub`), `spatial.ts` (`SpatialHub`), `spatial-voice.ts`, `spatial-cams.ts`, `wallet.ts` (`WalletBook`), `facts.ts` (`FactsBook`), `push.ts` (`PushHub`), `audio.ts`, `lights.ts`, `desk.ts` (`DeskHub`, wave 25: the house desk's runs, playhead, check marks; pure model `src/house-desk.ts`), `collab.ts` (`CollabHub`, Yjs) |
| `server/` control plane | `config.ts` (env), `boot.ts`, `db/` (`queries.ts`: access is `getProjectFor` / `listProjectsFor`), `auth-server.ts` (BetterAuth), `projects.ts`, `events-api.ts`, `collab-api.ts`, `mail.ts`, `migrate.ts` |
| `server/store.ts` | the per-event state dir: journal, codes, sessions, meta (scenario source + phase), project snapshots |
| `scripts/` | `titi-facts.ts`, `loomcheck.ts`, `show-page.ts`, `sync-example.ts`, `live-guard.ts` |
| `examples/load.ts` | the project loader (`scenarioSource`, `main.loom` first, like `db/queries.ts` `projectSource`) |
| `test/` | vitest, ~160 files; show suites are `trapped-*.test.ts`; fixtures in `test/fixtures/` |

## Commands

```bash
pnpm --filter @loom/core test                            # whole suite (slow)
pnpm --filter @loom/core exec vitest run test/views.test.ts   # one file: do this while iterating
pnpm --filter @loom/core typecheck                       # tsc --noEmit
pnpm --filter @loom/core serve                           # event server on :7000, no watch mode
pnpm --filter @loom/core migrate                         # control-plane tables
pnpm --filter @loom/core loomcheck examples/trapped-in-the-internet --smoke
pnpm --filter @loom/core titi:facts --check              # the show's generated files are current
pnpm --filter @loom/core show:page --check               # SHOW.html is current
pnpm sync-example "<project>" [example]                  # from the repo root: push an example + reload
pnpm dev                                                 # from the repo root: the whole dev stack
```

Run the specific test files your change touches, then the suites that
pin the show (`trapped-*.test.ts`, `titi-facts`, `show-page`,
`loomcheck`) when you touch the story, the parser or `views.ts`.

## Conventions

- **The journal is the truth.** The `Sim` has no clock and no
  randomness. The server journals every mutation call (`createPerson`,
  `join`, `choose`, `signal`, `setVar`, `wallet`, `crew`, `tick`, …) and
  a restart replays the journal into a fresh `Sim` built from the
  event's stored source. Anything non-deterministic happens outside and
  is journaled as data (the casino's roll, a wallet timer on the story
  clock). Chat history is not stored: replay re-derives the same
  messages with the same `seq`s. Never make a replayed path depend on
  wall time, `Math.random`, or state that is not in the journal.
- **Memory-only things say so.** Poses, voice, camera frames, pair
  codes, rejoin asks, claim unlocks, the King's per-visit hit, typing indicators,
  the house desk's runs / playhead / activity, the router's plays and report, the
  terminals' `talk=` / `said=`, the TV's `sp=` (`ScreenState.tvSpeech`),
  the spatial hub's per-session presence room, escape cooldown
  (`escapedAt`), who heard the in-game heart (`heartHeard`) and who took
  each pickup (`picked`), the cam upload's `watched`, and
  most hub timers live in memory and are lost on a process restart.
  Document a new one the same way.
- **Server changes are additive.** Old clients (terminals on old
  tablets, a Quest APK, the director phone) keep polling while a new
  server ships first. Add fields; don't rename or remove them. Shipping
  is server first, then `sync-show`.
- **Pure first.** Decisions live in pure functions or transport-free
  hubs with an injected clock, unit-tested without HTTP
  (`routes/host.ts` `isHostRoute`, `routing.ts`, `cue-sheet.ts`, the
  hubs). `EventRuntime` wires them to requests.
- **Secrets stay out.** Facts keys, `secret:` codex entries and slots,
  `private:` slots and secret characters never reach an agent request,
  `/api/agent/facts`, the screen state or a non-director view. In docs,
  tests' prose and commit messages, never write the door code, the
  patch-bay combinations, hunt answers, codex or digit-note unlock
  codes, or a live event's passcodes. `show-page.test.ts` fails if the
  generated `SHOW.html` names any secret it reads from `facts.json` or
  the story.
- **Directors stay unseen.** No phone but a director's own (Run, the
  director phone) reads a director's name: guests see the hosts, booths
  (hosts included) read parts by name and every director as "Director".
  Anything that carries a journal `by` (an author's display name) into a
  booth, host or guest view goes through `server/unseen-directors.ts`.
- **A locked phone writes nothing** (wave 26, C2). While the story's
  `lock:` header holds for a guest (`views.ts` `isLocked`), every
  `/api/guest/*` POST answers `403 {"error": "locked"}` from one check at
  the top of `handlePost`, except the routes in `LOCKED_OPEN`
  (`event-runtime.ts`: register, resume, enter / rejoin, badge,
  homescreen, push, logout) and `act` on a `restricted: allow` button. A
  new guest route is refused for a locked guest by default;
  `test/w26-lock.test.ts` walks every route. If it posts nothing into the
  story, add it to `LOCKED_OPEN` on purpose.
- **Game-only beats** (wave 26, C6). `chat.ts` `GAME_ONLY_BEATS` (Escape
  Attempt, Heart In The Simulation) never become a ChatMessage and never
  set the speaker a later menu docks under (`menuChannelsFor`,
  `decisionChannelFor`); their lines reach only the reinstallation game, through `momentLines(events,
  guest)` in the moment route's answer. Don't rename those beats.
- **Game moments and presence** (wave 26, C6–C8). `POST
  /api/spatial/moment {kind: escape | heart | pickup, prop?}` is judged by
  `SpatialHub.moment` with the `@loom/house` rules on the session's last
  pose and commits one story signal `by` the game's device; a restart
  forgets the hub's memory, so the story's own guards (`program.sim_heart`,
  `carries_virus`) keep the heart and the virus once-only. Each session
  keeps a presence room (`presenceRoom`) beside the raw `locate` room: the
  voice relay (`voicePlayers()`), the screen state's `spot.here`
  (`spotHere`) and a game session's camera list judge by it; the stream's
  `room` stays the raw one.
- **Hub files have one owner at a time.** `event-runtime.ts`,
  `views.ts`, `chat.ts` and `sim.ts` are touched by almost every
  feature; when several agents work in parallel, give each of these to
  one lane and merge serially.

## Gotchas

- **Some files read as binary to `grep`.** The shell's grep (ugrep with
  `-I`) silently skips `src/runtime/sim/sim.ts`, `server/tts.ts` and, in
  bank, `src/compile.ts`, `src/expr-compile.ts`, `src/intern.ts`. A
  search that finds nothing there is not proof of absence: use
  `grep -a`, `sed -n` or `awk`.
- **An unset `DATABASE_URL` is not "no database".** `server/config.ts`
  defaults it to `postgres://127.0.0.1:5432/loom_dev`, the user's own dev
  database. A scratch server started with it unset rehydrates the user's
  dev events. Give a scratch server a dead URL.
- **Scratch server recipe** (LAN mode, event id `default`, plays the
  show; build `play`, `terminal` and `reinstall/web` first):

  ```bash
  cd core && LOOM_PORT=7311 LOOM_STATE_DIR=<scratch>/state \
    LOOM_MOD_PASS=MOD7311 LOOM_EVENT_PASS=GST7311 LOOM_PRIME_PASS=PRM7311 \
    LOOM_WIKI=off LOOM_DB_WAIT=off DATABASE_URL=postgres://nobody@127.0.0.1:1/none \
    LOOM_FACTS=$PWD/examples/trapped-in-the-internet/facts.json \
    pnpm serve
  ```

  `LOOM_DB_WAIT=off` is required with a dead URL (otherwise the boot
  retries forever and answers 503 `starting`). Get a mod token from
  `POST /e/default/api/mod/login {passcode}`. Stop it by its port, never
  with a broad `pkill`: the user may be running their own server and a
  stagehand worker.
- **Postgres-gated suites share one database.** `db.test.ts` and
  `events-{maps,claims,resync}.test.ts` use `loom_dev` through the
  default `DATABASE_URL` (they skip when it is unreachable). Two concurrent runs of
  the core suite make them fail; re-run a failing one alone before
  calling it a regression.
- **A server project plays a snapshot.** An event runs
  `event.scenario_source`, captured at launch, and the server has no
  watch mode. Editing `examples/` changes nothing on a running server
  until `pnpm sync-example` (or `pnpm dev --sync`) writes the files and
  reloads the event.
- **A story change changes what an old journal replays to.** The
  journal holds commands, not outcomes, so the same journal over edited
  text can land somewhere else. That is why `sync-show` reloads (a
  fresh run) and must happen before doors, and why `--no-reload` on a
  live event is dangerous: the next process restart plays the old
  journal over the new text.
- **The live guard.** `sync-example` / `sync-show` refuse to reload a
  live event that has a real guest on its roster (exit 3; personas and
  load-test bots don't count). Override only on the user's word:
  `--i-know-this-is-live` or `LOOM_I_KNOW_THIS_IS_LIVE=1`. The same
  check (`scripts/live-guard.ts`) guards the acceptance scripts.
- **Header-key traps in the story language.** An event name must not
  start with a built-in verb word (`release …`) or contain ` is `
  (further in, a `for`-bound one may: `when simulation escape attempt for
  program:` is that INTERACTION, wave 26); a
  filler word plus one word (`the glitch`) folds to the word. Lint
  L1212 catches a trigger phrase that keeps only its first word.
- **The bank compiler lags.** New language features (guarded choices,
  watchers, story rules, live header keys) compile in `@loom/bank` with
  a warning (`choiceGuardIgnored`, `liveHeadersIgnored`, …) rather than
  playing. Adding a feature here does not add it to banks.

## The show

`examples/trapped-in-the-internet/` holds the story (`main.loom` first,
then the other top-level `.loom` files (`rooms`, `quests`, `objectives`,
`atmosphere`) and `beats/`, `cast/`, `codex/`, `generated/`), the project files the
server snapshots at launch (`house.json` + `house.shed.json`,
`facts.json`, `audio.json`, `lights.json`, `desk.json`), the agent's persona and mind
files (`trabolta.persona.md`, `trabolta.mind.md`, runtime inputs for
stagehand), and the crew's docs: `README.md` (the runbook and
integration contract), `SHOW.html` (the generated show book), `SHOWNIGHT.md`
(the night-of runbook; its Pre-show checklist is parsed by
`scripts/ops/checklist.sh` and pinned by `scripts/ops/test/run.sh`),
`TECH.md` (the machines), `OCT31.md` (build history), `DESIGN.md`, `DEMO.md`, the `SIGNOFF-*.md`
sheets and `cast-packs/`.

Several of those docs are read by tests or scripts (row formats, counts,
marked blocks). Before moving or reformatting one, check
`test/trapped-in-the-internet.test.ts`, `test/trapped-w13-*.test.ts`,
`test/trapped-w21.test.ts`, `scripts/titi-facts.ts` and
`scripts/ops/checklist.sh`.

`facts.json` is the one file the team edits for the hunts; `titi:facts`
regenerates `generated/questions.loom`, `codex/9-facts.loom`,
`generated/print-stacks.md` and the marked blocks in `trabolta.mind.md`
and `DESIGN.md`. Never hand-edit the generated files.

The VPS (`app.mapsandducks.com`) runs release `w27` (master through wave
27, the heart's first meeting; rollback `w26`; wave 26:
[`docs/loom-w26-contract.md`](../docs/loom-w26-contract.md)). Release and sync
procedure: `scripts/ops/` and
[`docs/loom-docker-deploy.md`](../docs/loom-docker-deploy.md).
Show-night diagnostics from any machine: `pnpm showctl`
(`scripts/show/`).

## Pointers

- Language: [`docs/writing-in-loom.md`](../docs/writing-in-loom.md),
  [`docs/loom-4.md`](../docs/loom-4.md), the help articles in
  [`docs/help/authoring/`](../docs/help/authoring/) (bundled into the
  editor and play; tested by `editor/src/lib/help-content.test.ts` and
  `play/test/help.test.ts`).
- Runtime design: [`src/runtime/sim/DESIGN.md`](./src/runtime/sim/DESIGN.md);
  routing of lines to rooms: [`docs/loom-conversation-model.md`](../docs/loom-conversation-model.md).
- Reinstallation games, voice, cameras: [`docs/loom-reinstall.md`](../docs/loom-reinstall.md) §2.
- Show control and the agent worker: [`docs/loom-show-control.md`](../docs/loom-show-control.md), [`stagehand/`](../stagehand).
- Deployment and security: [`docs/loom-deployment.md`](../docs/loom-deployment.md),
  [`docs/loom-docker-deploy.md`](../docs/loom-docker-deploy.md).
- Banks (the game-engine path): [`bank/`](../bank), [`docs/loom-banks.md`](../docs/loom-banks.md).
- History: [`docs/history/core-readme-2026-10.md`](../docs/history/core-readme-2026-10.md)
  (the per-wave server notes); `git log` for the rest.
