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
| `src/lsp/` | `Workspace` (completion, hover, definition, references, symbols, diagnostics), `graph.ts` (the story graph), `rename.ts`, `w18-lints.ts` … `w55-lints.ts` (workspace lints L12xx) |
| `src/*.ts` | browser-safe shared modules: `house-desk.ts` (wave 25, `@loom/core/house-desk`), `talk-back.ts` (wave 32, `@loom/core/talk-back`: `TalkView`, `readTalkPost`, `talkView`) + `talk-scenes.ts` (the show's canned talk lines, `DRAFT w32`), `cue-sheet.ts`, `pick-echo.ts` (wave 28), `voice-fx.ts` (wave 56), `host-board.ts`, `delivery.ts`, `facts.ts` + `answer-match.ts`, `casino.ts`, `go.ts`, `show-clock.ts`, `identity-kind.ts` |
| `server/server.ts` | process boot, static apps (`/`, `/terminal/`, `/reinstall/`, `/cards`, `/costume`, `/webmaster/`), `/api/health`, `/api/resolve-code`, control-plane routing |
| `server/event-runtime.ts` | one live event (`EventRuntime`, ~7,000 lines): every `/e/:id/api/*` handler, the journal commit + `fanout`, restarts, the ticker |
| `server/registry.ts` | `EventRegistry`: one `EventRuntime` per event, rehydrated at boot |
| `server/views.ts`, `chat.ts` | pure projections: `GuestView` / `PrimeView` / `ModView`, and SimEvent → channel messages. The editor imports both (`@loom/core/views`, `@loom/core/chat`) |
| `server/routes/` | route modules split out of the runtime: `host.ts` (the host allowlist), `screen.ts` (the terminals' screen state + heartbeat), `claims.ts`, `crews.ts`, `sides.ts`, `cards.ts`, `recap.ts`, `mod-log.ts`, `metrics.ts`, `press-lines.ts`, and the OCT31 item files `k12.ts` (print sheet, wave 54's `actions` signs), `k13.ts` (check-in), `k31.ts` / `k31b.ts` (push), `n02.ts` (re-pair, release), `rejoin.ts` (wave 23: badges, invitations re-entering, ask a host, per-part staff badges; wave 54: invited badges), `printed.ts` (wave 59: a typed code back to its QR's link) |
| `server/` hubs | transport-free, clock-injected classes: `agents.ts` (`AgentHub`), `spatial.ts` (`SpatialHub`), `spatial-voice.ts`, `spatial-cams.ts`, `wallet.ts` (`WalletBook`), `facts.ts` (`FactsBook`), `push.ts` (`PushHub`), `audio.ts`, `lights.ts`, `lights-shown.ts` (wave 39: the lights estimate + the games' `lights` frame feed), `desk.ts` (`DeskHub`, wave 25: the house desk's runs, playhead, check marks; pure model `src/house-desk.ts`), `collab.ts` (`CollabHub`, Yjs), `live-file.ts` (`LiveFileSource`: a project file read live; `credits.ts`, `descent.ts`) |
| `server/` control plane | `config.ts` (env), `boot.ts`, `db/` (`queries.ts`: access is `getProjectFor` / `listProjectsFor`), `auth-server.ts` (BetterAuth), `projects.ts`, `events-api.ts`, `collab-api.ts`, `mail.ts`, `migrate.ts` |
| `server/store.ts` | the per-event state dir: journal, codes, sessions, meta (scenario source + phase), project snapshots |
| `scripts/` | `titi-facts.ts`, `titi-qr-lock.ts`, `loomcheck.ts`, `show-page.ts`, `sync-example.ts`, `live-guard.ts` |
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
pnpm --filter @loom/core titi:qr-lock [--check]          # hold the story to what was printed (once printed)
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
  codes, rejoin asks, claim unlocks, the King's per-visit hit, typing indicators
  and the agent line's waits (`agentWait`, its mean service time; wave 42b),
  the house desk's runs / playhead / activity, the router's plays and report, the
  terminals' `talk=` / `said=`, the TV's `sp=` (`ScreenState.tvSpeech`),
  the spatial hub's per-session presence room, escape cooldown
  (`escapedAt`), who heard the in-game heart (`heartHeard`) and who took
  each pickup (`picked`), each wall terminal's visit floor per guest
  (`terminal-visits.ts`, `/api/mod/impersonate` `visitSeq`, wave 28), the cam upload's `watched`,
  a public talk request and the last canned Clippy steer (`talkDirection`,
  wave 32: a restart never re-asks it; the host taps again), the house
  lights' presence pulses, the module's `shown` report and the server's
  lights estimate (wave 39), the house mixer's music commands, the
  router's meters packet and a panel's watch lease (wave 40: the mix
  itself is in the state dir), each session's measured speed, the walkers
  and the test walker, what a program told a talker (`told`) and the
  forced descent level (wave 49; a story reset forgets the last two), when
  Clippy's dream takes over and whether the TV has named the bug
  (`ScreenWatch` `dreamAt` / `dreamHeard`, wave 50: a restart replays the cue
  as history and the dream is simply on), the teleprompter's scene, position and
  holds (wave 59: a restart forgets them and the rest of the lines play), and
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
- **A hunt key still owed** (wave 58, the contract's C1, `facts.ts`
  `Question.placeholder`). A
  question may ship before its answer: a stand-in `answer` carrying
  `PLACEHOLDER_MARK`, flagged `placeholder: true` (`showFactsProblems` refuses
  one without the other). `judgeWidget` passes a filing on it with no verdict,
  so the story's own "could not be judged" path answers and nothing is
  recorded, credited or marked; `screenResultsOf` and the generated tables
  never show it; `titi:facts`, `loomcheck` and predeploy WARN by id. Tests that
  need H1–H3 judged run on `test/fixtures/hunt-keys.ts`. A question's optional
  `spoken` is what the reader says instead of `text` (a blank, which the voice
  strips); the card, the Quest Log and the slide keep `text`.
- **Directors stay unseen.** No phone but a director's own (Run, the
  director phone) reads a director's name: guests see the hosts, booths
  (hosts included) read parts by name and every director as "Director".
  Anything that carries a journal `by` (an author's display name) into a
  booth, host or guest view goes through `server/unseen-directors.ts`.
  Wave 59: a Run persona (Run's Start seats one named after you) leaves
  every phone's lists there too: `people`, `roster`, `guests`, a `pick:`,
  the Wanted board, a host's `people` and `roster`. Only Run and a
  director's own Players pane (`Client.pane`, never a wall terminal's
  pilot) keep them. A persona that acts reads "Director" on every other
  phone: its chat lines (`forGuest`, `forBooth`, by name, so a real guest
  who shares it keeps it), a crew or side it founds (`seenCrews`), and a
  host's `/api/mod/recap` leaves it out (`RecapOptions.hide`). The one thing
  left is a story line that prints the name in its own text, such as the
  `# hosts` note when a persona founds a faction.
- **Who is online** (wave 59, `peopleRound`): an open stream as `presence()`
  counts it, or a phone or booth heard from inside `ONLINE_GRACE_MS`
  (`host-board.ts`, 3 minutes). `PersonCard.online` and `PrimeGuest.online`
  say so per row and the phone filters: those rows also name DMs, wallet
  picks and scanned cards. The open night checks every 15 s and sends a
  round if it moved (`checkPresence`).
- **A locked phone writes nothing** (wave 26, C2). While the story's
  `lock:` header holds for a guest (`views.ts` `isLocked`), every
  `/api/guest/*` POST answers `403 {"error": "locked"}` from one check at
  the top of `handlePost`, except the routes in `LOCKED_OPEN`
  (`event-runtime.ts`: register, resume, enter / rejoin, badge,
  homescreen, push, logout) and `act` on a `restricted: allow` button. A
  new guest route is refused for a locked guest by default;
  `test/w26-lock.test.ts` walks every route. If it posts nothing into the
  story, add it to `LOCKED_OPEN` on purpose.
- **A pick is a chat line** (wave 28). `Sim.choose` records a `chose`
  event (`person`, the menu's `id` and `beat`, the option's `text`) before
  the option's body runs. `composeGuestMessages` posts it, through
  `ComposeOptions.menuChannelOf` (the runtime's `menuChannels`, live and
  in the replay), as the picker's own line in the menu's room:
  `pick: true`, `act: true` for a deed, audience the picker, text by
  `src/pick-echo.ts` `echoOf` (shared with the terminal and play). With
  no `menuChannelOf` (the editor's local backend) it posts nothing. A
  pick is never a line owed an agent's free reply (the restore's owed
  scan skips it), but it is in the agent's `recent` as the guest's line.
- **A docked menu follows the world** (wave 28). At the end of every
  `drain` the Sim's `refreshMenus` reads each pending menu's guarded
  options again (`PendingChoice.written`): an option whose condition now
  holds appears in its written place, one that stopped holding goes, a
  still-shown one keeps its words, and a read that would leave nothing
  keeps the menu as it was. Same id, beat and continuation; it records
  `choiceUpdated` (never a chat line; the views read the sim). It reads
  only sim state, so a replay re-reads it identically. A click racing a
  re-read (its text no longer at its index) is refused 409 `moved` with
  the new options, as any stale click is.
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
- **The house lights meet the games** (wave 39,
  [`docs/loom-w39-contract.md`](../docs/loom-w39-contract.md) C2,
  [`docs/loom-reinstall.md`](../docs/loom-reinstall.md) §1.4 + §2.2).
  `SpatialHub` runs `presenceStep` on every flush / leave / reset / map
  swap through injected `lights` / `onPresence` options (it never imports
  `LightsHub`); `LightsHub.setPresence` moves `presenceSeq` (the GET's
  `presence` field and `presence=<seq>` cursor). `POST
  /api/mod/lights/shown` (mod only, never on the host allowlist) feeds the
  `house` source; `lights-shown.ts` holds the `estimate` (fed by live
  `cue X` looks in `fanout` via `lightCues`, `LightsHub.onChange` tests,
  the `boot` look) and `GameLightsFeed`, which sends the spatial stream's
  `lights` frame (after `hello`, on change ≤ 4/s, while an estimate
  animates). Tests: `test/w39-lights-presence.test.ts`.
- **Talk scenes** (wave 32, [`docs/loom-w32-contract.md`](../docs/loom-w32-contract.md)).
  The story's `Night.talk` names one (`intro`, `bottle`, `ad`, `beans`;
  `"none"` otherwise) and `src/talk-scenes.ts` `TALK_SCENES` holds each
  one's title, hint and canned chips (`EventRuntimeInit.talkScenes`
  injects a fixture's). Since wave 58 `intro` opens on 🤖 for after his
  sign-off and has no ⚡ (its `glitch` is absent; `ad_burst` refuses it).
  `POST /api/mod/talk {as: "Clippy" | "Trabolta",
  text, direction?}` (mod auth, on the host allowlist; never named
  `/api/mod/agent…`) commits a `say` in `loc:The Desktop` with audience
  `"all"` `by` the host (400 `as|empty|too_long|direction`, 409
  `no_talk|asleep|closed`). As Clippy it opens the **public thread**
  `{character: "Trabolta", channel: "loc:The Desktop", audience:
  ["@Clippy"], public: true}`: its request carries `speaker.stage`,
  `stage {room, scene, direction?}` and the room's own lines as history
  (any audience, scripted ones `story: true`, filtered like the dossier:
  no facts answer, secret value, codex code or hunt-answer mark), no
  dossier. `AgentHub` sends its queue out by the runtime's `rank` (the
  public request, then a guest at his heart, then every other DM;
  `queuedInOrder`), first dropping any queued one whose scene has closed
  (the runtime's `stale` option, so it never takes a slot ahead of the
  DMs), never sends it a hold / busy / stall line (one `#
  hosts` line, `TALK_HOLD_NOTE`, instead) and `openOn(thread)` reads it
  for the view. Its reply lands only while `Night.talk` still names the
  scene it was asked in (else 410 + `TALK_LATE_NOTE`); acts are ignored,
  `adjust` applies. As Trabolta (a canned chip), or a director's
  `/api/mod/say` as him in The Desktop while a scene is on, it answers an
  owed request by hand. Views: `HostView.talk`, `PrimeView.talk` (host
  booths only) and `ModView.talk` (`talkView`: the scene, its chips,
  `thinking`/`since`, `online`, `awake`; null when none is on, absent from
  an old server). `NightView.glitch.light` is set when `Night.glitch_kind
  == "burst"` (a ⚡ `ad_burst`), and the screen state's glitch shot
  carries `text` from `Night.glitch_text` (`routes/screen.ts`
  `glitchTextOf`, ≤ 120 chars) and `light` for a burst (the walls draw a
  short ad burst, not the takeover). Tests: `test/w32-talk.test.ts` (server),
  `test/trapped-w32-talk.test.ts` (the story and every line).
- **The games' intro** (wave 33). Assignments and candidates carry
  `reinstalled` (finds on the run log since the story started, so it
  survives a restart) and the program's saved `prefs`; `POST
  /api/spatial/ready` restarts a session's run clock once, `POST
  /api/spatial/prefs` saves `{turn}` to `spatial-prefs.json` in the state
  dir (kept across restarts and story resets). Neither commits to the
  story. Since wave 33b no client posts `prefs` (VR's snap turn is gone);
  the route stays (additive). `POST /api/spatial/reset` (wave 59,
  `SpatialHub.runReset`) puts a stuck walk back at its spawn and deals Gerald a
  new spot; it commits nothing and moves no clock, level or hit.
- **The house soundtrack** (wave 38,
  [`docs/loom-w38-contract.md`](../docs/loom-w38-contract.md) C3/C5).
  The story cues `cue music_<scene>` at each act change and mirrors it in
  `set Night.music = "<scene>"` (the `Night.lights` pattern; `off` at
  every ending). The screen state's `ScreenNight.music` reads
  `Night.music` (`SCREEN_NIGHT_VARS.music`; "none" reads null), and the
  router catches its scene up from it after a restart. `music_` is
  reserved: never a desk cue id (`DESK_RESERVED_PREFIXES`) or a lights
  look (`@loom/house` `LIGHT_RESERVED_PREFIXES`, so `server/lights.ts`
  `storyLooks` never offers a `music_*` cue). `AudioHealth` gains
  optional `music {scene, beds: [{playlist, speakers, track, posS}],
  missing}`, `inputs {"<ch>": dBFS}`, `sources {name: 0..1}` and
  `underruns`, each judged alone (`audioHealthW38Of`: a malformed one is
  dropped, lists capped, peaks clamped). `AudioView.health` carries the
  last report minus `sounds` (null before one, absent on `router=1`); the
  desk's `DeskAudioHealth` carries the same. Tests:
  `test/trapped-w38-music.test.ts` (the cue / mirror pairs, the scenes,
  the endings, the out-of-order starts).
- **The house mixer** (wave 40,
  [`docs/loom-w40-contract.md`](../docs/loom-w40-contract.md) C2; the
  shared model `src/house-mixer.ts`, `@loom/core/house-mixer`). `AudioHub`
  keeps the mix (`mix()`, `setMix(changes, {resetAll})`) in the event's
  state dir (`audio-mix.json` via `Store.loadAudioMix` / `saveAudioMix`,
  its seq too): it survives a server, router and story restart and is
  never journaled. The music commands (`music(cmd, by)`), the router's
  meters packet and the panel's watch lease (`watchMixer()`,
  `mixWatched()`) are memory only. `GET /api/mod/audio` gains `mix`,
  `music`, `mixWatch` and the `mix=` / `music=` / `watch=` cursors; `GET
  /api/mod/audio/mixer` (`MixerView`, no `by`), `POST
  /api/mod/audio/mix` and `/music` are on the host allowlist, `POST
  /api/mod/audio/meters` (the router's) is not. Tests:
  `test/w40-mixer-server.test.ts`.
- **Trabolta's letters** (wave 41,
  [`docs/loom-w41-contract.md`](../docs/loom-w41-contract.md)). The
  `email` card's address is taken out at `/api/guest/widget` (and
  `/api/prime/widget`) by `widgetArgsOf`: the story hears `email answered`
  with `given` / `skipped`, the address goes to `LettersBook`
  (`server/letters.ts`, `letters.json` in the state dir, never journaled;
  a story restart drops the guests', Go live the booths'). A performer's
  inbox: `POST /api/prime/letter`, `PrimeView.letter`. Run:
  `GET /api/mod/letters`, `POST /api/mod/letters/{write,draft,send,forget}`
  (`routes/letters.ts`, directors only, never on the host allowlist).
  `letter` frames go to the `judge:` character's idle worker
  (`AgentHub.letterWorkers`, voice first, one each), re-queued after
  180 s, three tries; `POST /api/agent/letter` stores the draft. The night
  file is `letter-facts.ts` (pure, over the recap; the show's featured
  identities and endings live there). Send: Resend as `Jean Trabolta
  <LOOM_WEBMASTER_FROM>` (`letters-mail.ts`), 600 ms apart, once each. The
  frames in flight are memory only. Tests: `test/w41-letters.test.ts`,
  `test/trapped-w41-upload.test.ts`.
- **The agent hub's two modes** (wave 42, "Trabolta under load";
  `server/agents.ts`, its header). A worker's stream may carry
  `capacity=N` (`agentCapacityOf`: 1..16, else null; `hello.capacity`
  echoes it). **Legacy** (no capacity, an older stagehand): every request
  is dispatched at once, only each worker's head runs the reply / stall
  clocks, rulings and letters wait for an empty line ("voice first").
  Keep it exactly: `agents.test.ts` and `agents-queue.test.ts` pin it.
  **Windowed** (`AgentWorker.capacity`): open voice requests + its ruling
  out + its letter out (`letterLoad` ← `LettersBook.outOn`) never pass N;
  the rest wait in the hub (`worker === null`) by `rank`, FIFO within a
  rank, and `AgentHub.pump()` hands them out on every settle, cancel,
  timeout, detach, attach and stall clear (the runtime also pumps after
  `/api/agent/letter` and the letters' tick, and `agentReply` settles with
  `{ defer: true }` and pumps only after the reply's say, adjustments and
  acts are committed, so the next body sees them). A queued body is
  rebuilt at dispatch (a line meanwhile only stamps `lineAt`, which the
  queue's max age reads, and marks it `stale`); what shows a stale body
  first rebuilds it (`refresh`: the hold and busy lines' reply-to, and
  Run's waiting rows via `pendingFresh` — never `pending`, which every
  guest line reads). The runtime's `rank` reads `<speaker>.at_the_heart`
  live, not from the body. Typing turns on at dispatch; each request in a slot times
  out from its own dispatch; a stall is nothing back (`lastBack`: an
  answer, or one of its requests settled by hand) for `stallAfterMs`
  since max(last answer, oldest dispatch); the busy line goes to a
  request still queued at `busyAfterMs` while a worker answers; a ruling
  takes a free slot when no voice waits or once it has waited
  `judgeAgeMs` (15 s, `pump` asks the aged ruling first); a letter needs
  a free slot and no voice waiting. `AgentQueue` gains `inFlight` /
  `capacity` only while a windowed worker voices the character
  (`queueBadge`: "3 answering · 12 waiting"). One fleet is one mode: a
  legacy and a windowed worker voicing the same character at once work,
  but the split between them is arbitrary (the legacy one takes the
  overflow). Memory only, like the rest of the hub. Tests: `test/agents-window.test.ts`.
- **The line, as a worker and a guest see it** (wave 42b, B1/B2;
  `server/agents.ts` "Load and the line"). Every `request` frame (legacy
  too) carries `queued` and `load {queued, inFlight, capacity}` at send
  time, spread onto the frame only (the hub's copy, `pending`, never has
  them; `agent-recent.test.ts` strips them before its frozen fixture).
  `capacity` = the windowed slots plus one per legacy worker. With a
  windowed worker voicing the character, the hub's `wait` option tells
  each DM thread `AgentLineWait {state: queued | answering | idle,
  position?, etaS?}`; the runtime sends it as the SSE event `agentWait
  {channel, audience, character, state, position?, etaS?}` to the typing
  frames' audience (`seesAgentThread`: the guest, the performer whose
  cast thread it is, an admin booth, every director; never a lean house
  tool). `position` is 1-based in the rank order (a public request counts
  but is never told; a `stale` one holds no place), `etaS = ceil(position
  × mean ÷ live slots)` (`liveSlotsFor`: the windowed workers not
  stalled, less their rulings and letters out, at least 1), the mean an
  EMA (0.2) of a windowed request's dispatch → reply, 6 s before the
  first (`serviceMeanS`, kept across a story restart). A state change is
  told at once, a position change at most once per 5 s per thread (the
  1 s sweep sends a held-back one); idle on settle, a hand answer, a
  give-up, a drop, a restart, the last window going, and during a stall:
  with only stalled workers voicing the character its queued threads and
  the stalled worker's in-flight ones are idle (the hold line is all they
  show), told again when it answers. A timeout re-dispatch stays
  `answering` (no idle blip). Never for a public talk thread, never with
  only a legacy worker (or none); a legacy worker beside a windowed one
  takes the overflow at once, so its line reads `answering`. Typing is not
  replayed on a reconnect; `agentWait` is: a (re)opened `/events` stream
  gets its threads' current waits right after `history`
  (`replayAgentWaits`, `AgentHub.waitList`), so `answering` stands in for
  the typing it missed; only non-idle ones are sent, so a client clears
  its waits on `history` (an idle it slept through is never re-told). Memory only. Tests: `test/agents-wait.test.ts`.
- **The credits and the video list** (wave 44,
  [`docs/loom-w44-contract.md`](../docs/loom-w44-contract.md)).
  `credits.json` (schema and the roll's layout: `src/credits.ts`,
  `@loom/core/credits`) is read **live** by `server/credits.ts`
  (`CreditsSource`: the project file via the optional
  `ProjectLink.readFile`, else `LOOM_CREDITS`, else, with no project, the
  scenario's own; cached 5 s; never journaled or snapshotted).
  `GET /api/credits` (`routes/credits.ts`): a moderator always (with
  `source` / `problems`), a booth or guest once `Night.credits_roll` ≥ 1
  (403 `not_yet`), 404 `no_credits`; a `programs: true` section lists the
  roster's guests (no personas, not gone). `NightView.credits {roll, at}`
  mirrors the roll; the `credits` slide persists. `sync-show` always
  replaces the project's `credits.json` (like `facts.json`); `loomcheck`
  lints it. `GET /api/mod/video[?format=csv]` (`routes/video.ts`,
  directors only, never on the host allowlist) reads every guest's `video`
  slot, and since wave 53 every part that declares it (`staff: true`). Tests: `test/w44-credits.test.ts`, `test/w44-server.test.ts`,
  `test/trapped-w44.test.ts`.
- **The censor's filter** (wave 48,
  [`docs/loom-w48-contract.md`](../docs/loom-w48-contract.md)). The
  header `censor: <Character>` (`model.censor`) turns it on. The pure
  filter is `src/language-filter.ts` (wave 48b: `filterHits(text, level)`
  with tiered hits, `FILTER_BANDS`, `atLevel`, `maskText` / `maskUnsaid`,
  `encodeHits` / `decodeHits`, the heat game `multAt` / `heatAfter` /
  `starsFor`). Whole words (tiers 0–60) go through the `obscenity`
  dependency (two matchers, built once); buried stems (75–100) are our
  own matcher. After a guest's own `/api/guest/say` (never a play-as
  session, never `/api/mod/say`) the runtime's `flagGuestLine` indexes it
  in `FilterBook` (`server/language-filter.ts`) at the current strength and
  journals `signal("swear_flagged", guest, {message, words, list, level,
  marks})`; with a censor, `unsaidMasked` stars a slur before the say is
  committed. The censor's booth reads `PrimeView.filter` (the newest 40
  lines the strength still catches, `muted`, `level`, `stars`, `combo`).
  `POST /api/prime/filter {level}` journals `swear_filter`; `POST
  /api/prime/censor {seq}` (that part's booth only) masks the line's live
  hits in the chat store (`ChatMessage.censored`, text `p***word`), re-sends
  it as a silent `messageModerated` upsert and journals
  `signal("swear_censored", guest, {message, words, list, fresh, unsaid,
  points, mult, stars, top, distinct, heat, heat_at}, censor)`. Nothing is
  stored out of band: `restore` rebuilds the strength, the index (from
  `marks`), the masks and the heat from those signals (`replayFilter`).
  The screen state's `night.language` rides the `award_language` slide
  (G14), its words and tallies from `FilterBook` (the poll's
  `extras.language`). Wave 57 (C15): `views.ts` `captureFor` puts the censor's
  own capture on each waiting line (`FilterLine.send {id, label}`), by label
  (the booth's `CAPTURE`), actors and its `while:` with the line's program
  bound, never after the ending; the press is the ordinary `/api/prime/act`,
  and the line stays. Tests:
  `test/w48-language-filter.test.ts`, `test/w48-filter-server.test.ts`,
  `test/trapped-w48-language.test.ts`, `test/w57-filter-send.test.ts`.
- **The descent and the footsteps** (wave 49,
  [`docs/loom-w49-contract.md`](../docs/loom-w49-contract.md) C3;
  [`docs/loom-reinstall.md`](../docs/loom-reinstall.md) §2.5). The rules
  are `@loom/house` `descent.ts` and `footsteps.ts`. **Footsteps:** a
  session measures its speed in `pose()` over at least
  `FOOTSTEP_MEASURE_MS` (two walking windows averaged, or the pace wobbles
  with the network's jitter); a game sends no pose while its player stands
  still, so a flush reads a pose unchanged for `WALK_STILL_MS` as standing,
  and `standStill` zeroes the window at a teleport (an escape, a re-seat).
  `flush` runs `stepWalkers` over joined, unfound, un-held sessions (room =
  the presence room), reading the audio config only while someone moves,
  and calls `onWalkers` at most every `FOOTSTEPS_MIN_MS` (a held-back change
  still differs on a later tick), at once for the last stop; `active` holds
  until the walkers are empty. The hub never imports `AudioHub`: the runtime
  wires `audio` / `onWalkers` to `AudioHub.config` / `setWalkers`. `GET
  /api/mod/audio/walkers` (`openWalkersStream`) sends a frame on connect, on
  every change and every `FOOTSTEPS_KEEP_MS` while anyone walks (`:ping`
  otherwise); every pushed frame takes a new seq. Its path ends in neither
  `/events` nor `/stream`, so it says `no-transform` and the Caddyfile
  exempts it: gzip would sit on the frames, and the router's `httpx` asks
  for gzip. **The script:** `DescentSource` (`descent.ts`, over
  `live-file.ts`, shared with `CreditsSource`), `GET /api/spatial/descent`
  (a session or a moderator token); `sync-show` always replaces the
  project's `descent.json`; `loomcheck` lints it. **The level** is dealt
  once, in `begin`, onto the session: a force, a resume, a station's poll
  or the walk's own find never move it. `told` on the assignment is read
  live, so a resume carries what this walk told. Nothing here is journaled
  and no story changes. `POST /api/spatial/told` is open while the doors
  are closed. The walkers routes and `/api/mod/spatial/descent` are never
  on the host allowlist. Tests: `test/w49-footsteps.test.ts`,
  `test/w49-descent.test.ts`.
- **Clippy's dream** (wave 50,
  [`docs/loom-w50-contract.md`](../docs/loom-w50-contract.md)). `Night.dream`
  (`SCREEN_NIGHT_VARS.dream`) is on from `y2k_clock`; `cue dream_begin` (the
  `DREAM_CUE`, never a screen family) arms `ScreenState.dream {at}`: the cue +
  `DREAM_FALLBACK_MS`, or a TV's `bug=1` + `DREAM_LEAD_MS`, once, only sooner.
  `ScreenWatch.dreamOf` is the one reader. While it runs the games' feeds
  stay the real cameras and `DreamFeed` (`dream-feed.ts`, frames off
  `LOOM_MEDIA_DIR`, `dreamSpurting`, pure) breaks through them in spurts on
  `/api/spatial/cams` and `/cam`, so the games need no code. The media is
  never in git or an image: `scripts/ops/dream-media.sh`; Caddy serves
  `/media/`, and `server.ts` does only with no proxy. Tests:
  `test/w50-dream.test.ts`.
- **A part on rails** (wave 53,
  [`docs/loom-w53-contract.md`](../docs/loom-w53-contract.md)). Performers are
  never Persons, but a character bound as the subject (never `self` alone) while
  it stands in a `cutscene: true` location is addressed like one
  (`Sim.subjectAudience`, `onRails`): a beat's lines, menus and cards reach its
  booth, `@<Character>` (`audienceOf`, in `dialogue` and `chose` too). `Sim.move`
  takes a character: `<id>.location` only, no occupants, visits or hooks. Header
  `arrival: <cond>` (`model.arrival`, `views.ts` `arrivalDue`, read per part with
  `self`) puts `PrimeView.arrive`; `POST /api/prime/arrive` commits
  `signal("booth_arrived", character, {}, character)` and needs a sim, not open
  doors. `PrimeView.cutscene` / `location` / `choices` are the guest's twins.
  `POST /api/prime/choose` and `/api/prime/widget` work on rails with the doors
  closed. A row in `dm:X` addressed `@Y` is Y's (`visibleToPrime`). `restart`
  clears `answeredWidgets`: a part's name outlives a run and seqs start over. A
  guest's card answer reaches every character's hook: open a staff hook on a slot
  only parts have. Tests: `test/trapped-w53-staff-upload.test.ts`,
  `test/w53-server.test.ts`.
- **The phones' announce frame** (wave 53, C5). SSE `announce`, every guest and
  booth stream, never a mod's: `{text, at}` for each live `do announce` (`fanout`)
  and each `/api/mod/broadcast` to everyone (`spokenAnnounce`: no alert mark, no
  emoji), `{stop: true}` on `/api/mod/audio/stop {announce: true}`. Memory only:
  a phone that missed one never hears it. Whether a phone speaks is the phone's.
- **One QR per person** (wave 54, `routes/rejoin.ts` header,
  `routes/claims.ts`, `routes/k12.ts`). A blank badge is `?code=<guest>&badge=`.
  An invited badge is `?code=<guest>&claim=&badge=` (`Claims.links`, numbers
  past `BADGE_MAX`, `invitedBadge`, so a blank never shares one; `ref` `F01`).
  `/api/guest/enter {badge, claim}` resumes an unlinked invited badge whose
  program joined by a bare claim, and links it; `/api/identities` answers
  `invited` for a claim. A staff badge is `?code=<guest>&part=`: never the
  performer code, so `rotate: "staff"` leaves every printed badge good.
  `/api/prime/login` takes the guest code only beside a valid `part`, and still
  takes the performer code. Codes derive from the claim secret and the folded
  name: renaming a part or a reserved program retires its badge. `qr: <line>` on
  a `who: guest` INTERACTION (`InteractionDef.qr`) prints a sign,
  `?code=<guest>&act=<name>` (`actionSigns`, `/api/mod/codes` `actions`, a
  `/cards` section); play posts `/api/guest/act`. Clearance is `TRAIT
  Doorkeeper` (cast/kit.loom): an Antivirus or a host, never Clippy; a hook's
  `->` does not end the hook, so a guard must be one `if` chain, and `super`
  only splices at hook level. Tests: `test/server-rejoin.test.ts`,
  `test/trapped-w54-door.test.ts`.
- **One holder** (wave 59, `routes/rejoin.ts` header; overrules wave 23's
  take-over and wave 54's "old tokens stay good"). A part or a Person is one
  phone's. `/api/guest/enter` and `/api/prime/login` are where the rule lives,
  so anything that reaches them inherits it, a typed code too: a held card
  answers 409 `{held: true, name?, ref?}` (`heldAnswer`: only what is printed
  on that card, so a blank badge names no program). A live token on the same
  call proves the holder: nothing new is minted. Held means a live token or
  session; offline is no release. Releases: `/api/guest/logout`,
  `/api/prime/logout`, `/api/mod/guest/release`, `/api/mod/prime/release`
  (both on the host allowlist), a collected ask (`Rejoin.handOver`), a spent
  N-02 code, a story restart for a guest, Go live for a part (a booth survives
  a plain restart). A release sends the guest's stream `lifecycle {kind:
  "released"}` and keeps the token in `releasedTokens` (memory only) so a phone
  that slept through it reads `SIGNED_OUT`. An Approve moves nothing: the waiting
  phone's poll runs `handOver` (so an ask nobody is waiting on changes nothing)
  and a retried poll gets the same token for `REJOIN_RETRY_MS`. `POST
  /api/guest/rejoin/cancel` is the phone giving up, and any sign-in or release
  closes the open asks on that Person or part (`Rejoin.closeAsks`; every guest
  release goes through `Pairing.cut`, which voids the Home Screen codes too), so
  the poll answers `closed` once. `register` asks `Rejoin.joinCard` before the
  name and again after the picture's await, so it keeps `enter`'s rule and two
  phones can't become one program. An invited badge's number names its program
  (`Claims.programOfBadge`, the print order: reordering the reserved CHARACTERs
  moves every invited badge), so a missing claim behaves as a present one, and it
  never links to another Person (409 `{reserved: true, name}`). `/api/scan` and
  `/api/mod/scan` only read a badge. A director's play-as holds nothing and is refused nothing.
  A Home Screen nonce (K-31b, off by default) is the one sign-in that adds a
  token: the same phone. The house is one IP, so a wrong badge at `enter` or
  `rejoin` counts against nobody, and `Rejoin.passesLockout` lets the guest code
  with a badge or a name, and any poll or cancel, past a lockout; a wrong part or
  claim still counts and stays behind it (`routes/rejoin.ts` header). Tests:
  `test/w59-claims.test.ts`.
- **Text codes and in-world names** (wave 59, `routes/printed.ts`, `routes/k12.ts`).
  Every printed QR has a text code: the guest code, a badge's, a staff badge's
  (the part code, printed: wave 54's "no typed code" is overruled), `R-` + four
  for a room and `S-` + four for a sign (`roomCode`, `signCode`: the claim secret
  and the folded name), a codex entry's own (`CodexDef.printed`, as written;
  `code` stays folded and the QR's link keeps it), the digit notes' too.
  `printedHit` turns what was typed back into **the link the QR carries**, so
  a typed code takes the scan's path. `POST /api/guest/printed` and
  `/api/prime/printed` `{code}` → `{hit: {kind, url} | null}` come first in both
  Scan sheets; a codex code answers null, like a miss, so this is no oracle and
  the redeem routes keep the miss rules. `/api/guest/codex/redeem` asks
  `printedHit` too, for whatever skips that question (a terminal's TYPE A CODE):
  a printed code answers `printed: <kind>`, no miss. `{spaced: true}` is the Scan
  sheet's typed text: spaced text no entry holds answers `words: true` with no
  story event, and counts against `redeemMisses`; a real code typed with spaces
  unlocks. Without the flag spaced text is still a miss (the Codex's box).
  `/api/resolve-code` takes a badge's
  code only (`printed`: the path): a room's short code or name must not hand out
  the guest code. Misses are limited per guest or part (`printedAsks`,
  `LOOM_RL_PRINTED`). `inWorldLabel` (`src/in-world.ts`, no imports, so a phone can
  use it) is a `label:`
  as a player reads it: brackets and a ` — ` tail are the crew's. Every
  guest-facing title goes through it (`Sim.channelHead`, `locationSnapshots`
  unless `operator`, check-in, capture, the reveal shot, `/cards`, the signs, a
  Go button, the booth's upload stage), and so do Trabolta's facts and dossier,
  which reach his prompt. `operatorChannels` and `ModView.locations` keep the
  whole label. `pnpm --filter @loom/core titi:qr-lock` writes `qr-lock.json` (hashes
  only; `printedIdentities` is the list of what a story can move), `--check`
  fails naming what moved, `predeploy.sh` and `sync-show.sh` run it once the file
  exists, `LOOM_QR_MOVED=1` / `--qr-moved` goes past it. A hidden room's identity
  includes whether a `reveal` line opens it (`storyReveals`), so losing the last
  one fails `--check` though the link and code are unchanged; writing the lock
  refuses while a printed room has none (`deadRooms`; the override locks it, and
  it stays a warning). It can't see behind a reveal: one in a beat the night never
  reaches, or a sign's button edited to do nothing. Tests:
  `test/w59-printed.test.ts`, `test/w59-qr-lock.test.ts`.
- **A booth scans codex QRs** (wave 58,
  [`docs/loom-w58-contract.md`](../docs/loom-w58-contract.md) C4). `POST /api/prime/codex/redeem {code}`
  (a booth's token, a host's too: it is off the host allowlist's surface)
  answers `/api/guest/codex/redeem`'s shape (`{ok, unlocked, title?, already?,
  missed?}`, no `codex`). A part is no Person, so `Sim.redeem` would do nothing:
  a hit is the journaled `unlock` (`via: "story"`, so its card reads *Learned
  tonight*), and a miss is no story event (no `codexMissed`, no `wrong code`, no
  doubt), only `redeemMisses`, keyed by the part. 409 with the doors closed; 403
  without a character (a guest, a locked guest, a director); `agentRefusal` for
  an operator playing an agent-voiced part. `secret` never limits a scan: it
  only hides an entry from agents, and `agentVarsOf` and the holdings filters
  keep a part's secret entries out of every request. `isLocked` reads Persons
  only, so no part is ever locked. Holdings are Persons-only where it counts:
  `codex_in`, awards, the recap, the letters; `program learns` hooks run only
  for Persons, so a part assembles no Door Code. `/api/prime/codex/share` stays
  unfiltered: a part can pass on anything it holds. Tests:
  `test/w58-booth-scan.test.ts` (all 8 parts over every coded entry of the show,
  every code read from the compiled model).
- **A room opens on its beat, for the crew too** (wave 59). A `hidden: true` GROUP's
  `kind: faction` channel is closed to everyone until `reveal`, the members a beat
  added early included (`canSeeChannel`, `factionUnrevealed`). `Sim.allChannelsFor`,
  what a booth lists and may post into, now holds only what the story has opened to
  anyone (`channelOpened`, `locationOpened`: revealed, or someone has stood there), plus
  where that booth stands. `operatorChannels` uses `channelOpened` for chat rooms and
  sides, and keeps every LOCATION: a beat can land in a room no phone lists (The
  Script). Tests: `test/w59-rooms-open.test.ts`, `test/sim-reveal.test.ts`.
- **The teleprompter** (wave 55, [`docs/loom-w55-contract.md`](../docs/loom-w55-contract.md)).
  A beat's contract line `aloud:` names who reads it: parts
  (`aloud: Clippy, Task Manager`, `@<Character>`) or a program (`aloud:
  {Night.bobber}`, always a guest id: a featured program is a CHARACTER too, so
  a `{…}` never reads as a part). `aloudReaders` / `aloudOf` (`chat.ts`) stamp
  `ChatMessage.aloud {readers, reader?}` on a stage line and on narration:
  `reader` says it (a part's own lines; a program reads the narration), no
  `reader` is a cue. Addressed lines (DMs) are never marked. No route, no
  journal, no view: the marks ride the replayed chat. `capHistory` keeps a
  reader's rows (`guestOwnRow`, `boothOwnRow`), `forGuest` strips the mark from
  every guest but a reader, and `fanout` pushes `aloudPush` to a hidden phone.
  How far a reader has read is their phone's. `L1227` catches an `aloud:` naming
  no signable part (`src/lsp/w55-lints.ts`). Tests: `test/w55-aloud.test.ts`.
- **The shared teleprompter** (wave 59,
  [`docs/loom-w59-prompter-contract.md`](../docs/loom-w59-prompter-contract.md)).
  `server/prompter.ts` (`Prompters`, `sceneOf`; transport-free, memory only, never
  journaled): `fanout` lands a scene from each commit's marked lines, one at a time.
  `heldFrom(channel)` is the screen poll's `extras.voiceHeldFrom`, and `voiceLinesOf`
  stops just before it, `head` included. The position is in words, owned here (`pos`,
  `rate`, `stop`), moved by `POST /api/aloud` (a booth's or guest's token, not under
  `/api/guest/`, refusals 409 `prompter: …`) and by `tick` (a 200 ms timer while a
  scene is on, and every screen poll). Reaching a run of his lines moves the hold,
  locks and scrolls; `roomVoiceOf` (`said`, `sp=`, the mute) ends it, or the time from
  `spokenMs`. No reader on the prompter means no hold (`HOLD_WAIT_MS`, `HERE_TTL_MS`);
  anyone else's open prompter counts only while they drive it (`DRIVE_TTL_MS`). `fanout`
  calls `outrun` on a batch with no scene: a scripted line of his in the room (`beat`
  present; a live `say` has none) lets the hold go, in order.
  `POST /api/mod/aloud {action: release | done}` is on the host allowlist. Every
  stream's first frames include a `prompter` (null with none). `pushLifecycle` clears
  it. `finished` (the position reached `total`, or a reader's ✓ Done, once a scene) is
  `sceneFinished`: the end of `Clippy On Trabolta` fires `introduce_trabolta` through
  `deskFire` unless he is already in (the contract's C11). Paused doors answer false, so
  nothing is used up, and a ✓ Done behind them goes in `openDoors`. A newer scene over
  hers is `superseded`: one alert in `# hosts`, and 🤖 from there. `reading()`, not `status()`,
  is what must not cut across a read asks: a scene nobody has touched in
  `DRIVE_TTL_MS` stays up but isn't being read.
  Tests: `test/w59-prompter.test.ts`, `test/w59-prompter-server.test.ts`.
- **His voice** (wave 56, [`docs/loom-w56-contract.md`](../docs/loom-w56-contract.md)).
  `src/voice-fx.ts` (`@loom/core/voice-fx`, pure) decides how broken Trabolta
  sounds: `voiceLevel` (a curve over `Night.phase`, the Y2K clock, scaled by
  `Trabolta.composure`; clean at `finale_help` and `finale_truth`), `voiceSpikeOf` (the
  glitch, burst, flicker and dream shots, a director's shot) and the mode
  (`auto | clean | broken`). `ScreenWatch` puts `voiceFx` on every answer. The
  mode lives beside the mute (`Store.loadVoiceFx`, in the state dir); the shot
  is memory only. `POST /api/mod/screen/voice {fx?, shot?}` is on the host
  allowlist. Tests: `test/voice-fx.test.ts`, `test/trapped-w56-voice.test.ts`.
- **The full truth** (wave 58, [`docs/loom-w58-contract.md`](../docs/loom-w58-contract.md)
  C2, `examples/.../beats/truth.loom`, story only but for three small reads). The monologue plays on the director's 📜
  `tell_the_truth`, after an ending's last beat: `The Full Truth` (Trabolta, 18
  merged lines, `MAX_VOICE_LINES` keeps a poll's newest 40; phase `finale_truth`,
  level 0) or `The Full Truth Read` (`Task Manager:` lines under `aloud:` in the
  hidden, no-check-in room `The Script`: narration under a part's `aloud:` reaches
  nobody, and a guest's line of it is delivered but never listed). G1's `while:`
  waits for `Night.truth_until`, and its rule asks first (as G11's does; a host
  hook on G1 must not fire on the ask). `READING_BEATS` keeps his lines out of the
  worker's `recent`, `PERSISTENT_SLIDES` holds `recount` and `purgatory`, and
  `ALOUD_WINDOW_MS` outlasts the 14-minute read. Both versions and Task Manager's
  printed copy are held to the delivered file by `test/trapped-monologue.test.ts`.
- **The Task Manager costume** (wave 59, [`docs/trapped/costume.md`](../docs/trapped/costume.md)).
  An iPad 2 on iOS 9, so `server/costume-page.ts` is a hand-written ES5 page with
  its script and stylesheet as their own files (`test/w59-costume-page.test.ts`
  parses it with acorn: keep it ES5, no grid, no `gap`). `costume.json` (schema,
  refusals and cooldowns in `src/costume.ts`) is read live like the credits,
  `sync-show` always replaces it, `loomcheck` lints it, and code holds the same
  menu as a default. `secretCode(claimSecret, "costume")` opens `POST
  /api/costume/menu` and `/fire {k, id}` and nothing else: it is no session.
  Refusals are `momentRefusal` + `actionRefusal`, judged before anything is
  committed, so the story's own `ad_burst` refusals never reach `# hosts`. The
  night's end is `Night.step` 16 on (the reveal, the bobbing, the prom and the
  advice poll all play with `Night.ended` false; `step` is what a story edit must
  keep). A scene being read on the shared prompter (`Prompters.reading`) refuses a press.
  MUSIC is refused while anyone else's hand is on the soundtrack
  (`AudioHub.musicHand`: the last scene or stop's `by`, memory only, corrected by
  the router's `hand`), and AFTER PARTY's timed return stands down then too. Every
  action uses the house's own path (`lights.test`, `audio.play`, `audio.music`,
  `deskFire(cue, COSTUME_BY)`, the canned `say`). A light item never reaches a
  safety fixture (`costumeFixtures`), and the show's stay on `living`, which every
  story look covers, so re-firing `Night.lights` gives it all back; if he puts a
  room out during the 6 s hold, only what the press moved goes back
  (`costumeRoomOutRestore`), and nothing in the dark room. A fire journals
  `costume_pressed` (no hook hears it) with the label as its subject: that is the
  mod log's line. `GET` / `POST /api/mod/costume` is the link and the kill switch
  (directors only, never on the host allowlist; `costumeOff` beside the TV mute in
  the state dir). The cooldowns, a restore that is due and the rest of an ad storm
  are memory only. Tests: `test/w59-costume.test.ts`.
  He does not return from Combo A or B: a reply written while `awake` read true
  and landing after it went false is dropped (410, `asleepSinceAsked`) and the
  thread is asked again, because the worker's gate answers through the same
  `/api/agent/reply` (the `unavailable` and distress lines). Never gate that route
  on `awake` alone. Tests: `test/w58-agent-late-reply.test.ts`,
  `test/trapped-w58-gone.test.ts`.
- **The special prize** (wave 58, the contract's C5, G9a `award_most_correct`). `questions_right`
  is written per program only when G9a is pressed (a role watcher on
  `Night.prize_gen`; a watcher pass runs the programs' before the story's, so
  the story watcher reads the new numbers) and sits on the role's `secret:`
  list: a live count beside `truths_accepted` would tell the worker who lied.
  `recap.ts` `questionsRight` reads the same rule live, and
  `test/trapped-w58-prize.test.ts` holds the two together. `titi:facts` writes
  `Night.owed_<id>` (`owedVar`) from `Question.placeholder`.
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

The VPS (`app.mapsandducks.com`) runs release `w56` (master through
wave 56; rollback `w53b`; the root `CLAUDE.md` has the release status). Release and sync
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
