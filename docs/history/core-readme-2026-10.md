# core: the October 2026 wave notes (archived)

This file keeps, verbatim, the per-wave notes that used to live in
`core/README.md` (the sections "Show-night routes + rules (OCT31 wave 1)"
through "Wave 18b") and the `core` row of the root `CLAUDE.md` package
table, as they stood on master at 86f26a78 (2026-10-24). They are a
diary: each entry says what landed in that wave, in the words of the
day, and some status lines ("not yet shipped", "on branch …") were
already out of date when they were archived.

For how the package works today, read [`core/README.md`](../../core/README.md)
and [`core/CLAUDE.md`](../../core/CLAUDE.md). The code wins over both.

---

## Part 1: from core/README.md

### Show-night routes + rules (OCT31 wave 1)

- **Print sheet** (K-12, `server/routes/k12.ts`): `/api/mod/codes` also
  returns `joinLink` (`<join base>/?code=<event>`) and `checkin[]` — one
  sign per LOCATION a guest can check into (`{id, label, slug, url,
  hidden}`; never a prison, a cutscene or a `checkin: false` room). The
  editor draws the QRs itself (`/api/qr` is 60/min per IP, `LOOM_RL_QR`).
- **QR cards page** (wave 14, `server/cards-page.ts` + `routes/cards.ts`):
  `/cards` on the event server — type the moderator passcode and every room
  check-in, codex fact (by stack, secrets marked), join and invitation QR is
  on screen to scan with a phone, with a full-screen presenter (← / →,
  ✓ scanned). Data: `GET /e/:id/api/mod/cards` (mod token or author
  session; never a host booth) → `{title, eventPass, sections[{kind, label,
  items[{ref, title, sub?, code?, url, svg, stack?, secret?}]}]}`, the QRs
  drawn server-side from the same links as `/api/mod/codes`.
- **Recap** (K-26, `server/recap.ts` + `routes/recap.ts`): `GET
  /api/mod/recap` (directors) → `totals`, ranked `lists` (`trust` /
  `truths` / `lies` / `internetVisits` / `codex` / `quests` /
  `truthcoin`; ties share a rank, personas flagged), `duck` (the Golden
  Duck Speedrun: each program's fastest find, `m:ss`, off the
  `SpatialHub` run log the runtime keeps in `spatial-runs.jsonl` —
  SW-RE-14), `factions`, `ending` and a paste-ready `text`;
  `?format=text` returns only the text.
- **Cue sheet** (K-21): `ModView.cues` = `cueState(sim)` (`views.ts`) —
  which `who: admin` INTERACTIONs fired and the last in-sequence one, read
  off the sim log so every director agrees after a reload. An INTERACTION
  with `sequence: false` (machine-fired: the duck game, the door contact) is
  ticked but never "last"; `InteractionSummary.subject` marks a cue whose
  every listener binds a person (the ceremony's awards), `repeat` a
  `repeat: true` cue (NEXT stays on it while it is LAST and live), and `live: false`
  an admin cue whose `while:` is false on the director's view (off
  tonight's branch: never NEXT, still pressable — `while:` never gates an
  admin press). The rows themselves (`CueInteraction` → `cueRows`, NEXT =
  the first unfired in-sequence live row after LAST) are `src/cue-sheet.ts`,
  shared with the play app's phone page. A **refused** press — a cue some
  unconditional rule hears whose own events (`notePress` records each
  `Sim.signal` batch, live and on replay) are nothing but diagnostics and
  broadcasts to staff rooms (an authored `kind: faction` CHANNEL whose
  GROUP isn't joinable) — is never LAST and never ticks, and a repeat of an
  earlier cue never moves LAST back. `POST /api/mod/signal` answers
  `{ok: true, refused: true, presses}` for one (`pressRefused`), so the
  phone says *not taken*; a taken press answers `{ok: true, presses}`, the
  count after it. `CueState.presses` counts the presses the story took (a
  repeat of LAST or of an aside moves only it) and `pressed` names the
  newest one's cue: both screens bind an arm to it. Only a **cue-sheet
  press** — a signal posted with `presses` — can be turned down here
  (a device, stagehand or a Tools fire carries no count and never is):
  **409** `{moved: true, cues}` — fires nothing — when a press since that
  count fired the same cue, moved LAST or ticked a cue for the first time
  (`pressMovedArm`); another cue's repeat (a second 📋 while V4 is armed, a
  second duck find, the door contact, an aside pressed again) does not
  veto it. And **409** `{error: "no scenario loaded", doorsClosed: true}`
  while the run's `start:` beat has not played (a restart with the doors
  shut leaves the run paused, not idle), so the press never lands in the
  journal ahead of it. Before the doors the director's view lists the
  admin cues off the never-played story (`declaredSim`), and the lean view
  says `doorsClosed`; whether the doors have opened survives a restart
  (`Meta.opened`).
- **The whole ledger**: `GET /e/:id/api/mod/log?after=<seq>&limit=<n>`
  (directors; `limit` default 1000, at most 5000) pages the run's ledger:
  `{entries, next, total}`, `next` = the `after` for the next page or null
  at the end. The editor's Log export and End page through it.
- **Cast rows** (`ModView.cast`): `part: true` for a part a booth can sign
  in to (`identity.ts` `performerPickable`), and `held` — a session token
  holds it (`held && !online` is a booth whose phone dropped).
- **Grants by hand** (S4): `ModView.quests` lists every declared QUEST
  with each person's status (`QuestSummary.status`, person id → `active`
  / `done` / `failed`), beside `ModView.codex`'s holders, so Run's
  Inspector can offer `/api/mod/codex` and `/api/mod/quest` as buttons.
- **Agents.** With no worker online for 20 s, the hub posts the
  character's authored `hold:` line (`CHARACTER … hold: "…"`) into the
  thread once, as a journaled `say`, and keeps the request queued for a
  worker that comes back (N-11). A request a connected worker never
  answers is cancelled 2 min after it reached the front of that worker's
  line, re-sent once, then given up with the hold line (once). A director
  answering a thread as the
  character settles its open request (`AgentHub.answeredByHand` — dropped,
  or cancelled on its worker), so nobody answers twice. A power the story
  answers with words only (a refusal) does not count against its `limit`.
- **Place arguments** (`server/place-args.ts`): a `room` / `at` /
  `location` / `place` argument on `/api/mod/signal` or an agent's act is
  folded onto the exact LOCATION name (or `label:`) before it is
  journaled, so `"the start bar"` matches `room == "The Start Bar"` and
  stagehand's rules.
- **Story surface:** `broadcast "…" to channel(hosts)` posts into authored
  rooms (a staff back room) and never the lobby; `show <kind> … with
  thread: <Character>` pins a card to that character's DM; `show fact`
  is the 📝 *File a fact* card (a question, an answer and a 1–100
  confidence slider → `{question, answer, confidence}` → `fact answered`,
  K-24); `show answer "…" … with question: "<id>"` is the 💬 free-text
  card (`{text}` → `answer answered`).

### Oct 31 wave 4 (9d35a4b)

- **The facts judge** (`server/facts.ts`, pure types + the answer fold in
  `src/facts.ts`): a project's `facts.json` (the hunt questions per round
  with their answer key + aliases, the scannable + character facts, the
  truth-or-dare `truths`) is snapshotted at launch like the house maps —
  `Store.loadFacts/saveFacts` (`project-facts.json` in the event's state
  dir), `/api/mod/load {facts}`, `scenarioFactsFile` in `examples/load.ts`,
  and `sync-example` always pushes the example's copy (it is generated,
  never edited in a project); an event with none reads `LOOM_FACTS`. Every
  filed fact is judged at once — **accurate** = fold-match, **lie** = a
  miss at confidence 100, **uncertain** = a miss below — under the
  journaled mode `Night.judge_mode` (`auto`, or `review`: a proposal until
  a director confirms / overrides it with the `fact_accurate` /
  `fact_lie` / `fact_uncertain` events from the editor's Judging card or
  the hosts' booth). The story emits `do fact_filed` / `do fact_judged`,
  folded into `ModView.facts`; the key never reaches the world, the
  journal, a phone or the voice worker.
- **The wallet** (`server/wallet.ts`, `WalletBook`): a story opts in with
  the header `currency: <slot> as <Name>[, max N][, expiry <dur>]`; the
  balance stays the per-person slot (`<id>.score`), and characters take
  the two roles with `wallet: approver[, every N][, window <dur>]` /
  `wallet: minter[, limit N][, while <cond>]` (`runtime/sim/model.ts`,
  first declaration wins). The book holds what is in flight — pending
  transfers inside their deny window, the approver's held queue (every
  Nth send), open requests, escrowed codex offers, the stimulus count —
  as one journaled `wallet` op per change, timers on the story clock
  (`EventRuntime.tickOnce` sweeps them), cards addressed to each party's
  pinned **Wallet** room. Routes: `POST
  /api/guest/wallet/{send,request,respond,offer,accept,decline,cancel,stimulus,approve,deny}`
  → `{ok, wallet}` (404 for a story with no currency, 409 doors closed,
  429 past `LOOM_RL_WALLET`), `POST /api/prime/wallet/{approve,deny}` →
  `{ok, queue}` (the approver's booth, or an admin), `POST
  /api/mod/wallet/{approve,deny,cancel,stimulus}` → `{ok, wallet}` (the
  director's hand: the journal line carries the director's name, the
  cards read `Director`). `GuestView.wallet`,
  `PrimeView.wallet` (the queue), `ModView.wallet`.
- **Restricting + pinning** (`parser/statements.ts`): `restrict who [to
  Place, …]` / `unrestrict who` (`Sim.restrict/unrestrict`, triggers
  `restricted` / `unrestricted`, `GuestView.restricted`) keep a person's
  DMs + the named places, read-only, with no interactions
  (`/api/guest/act` → 403, check-in → 409); `pin "…" [in room] [for who]`
  / `unpin [in room] [for who] ["text"]` are sticky notices
  (`ChatMessage.pin` / `unpin`, one per (person, room), a leading `!` is
  an alert). Moderation: `/api/mod/act restrict | unrestrict`,
  `/api/mod/set restricted`.
- **Characters' quests + cards**: `start | update | complete | fail quest X
  for <Character>` and `/api/mod/quest {who: <character>}` feed a
  performer's booth (`PrimeView.quests` / `questTotal` / `answered`);
  `show <kind> … to <Character>` deals a card the booth answers with `POST
  /api/prime/widget {seq, result}` (fired as the character, so only its
  own hooks hear `<kind> answered`).
- `/api/mod/signal` takes a `label` (≤ 60 chars) so a mod-token device —
  the tent tablet felling the King — names itself in the journal / recap.

### Oct 31 wave 9 (merged ae79117, ships as `w9-1018`)

- **Boot + health** (`server/boot.ts`, `ControlPlaneBoot`): `GET
  /api/health` (before the static apps, never throttled, no auth) → 200
  `{ok, controlPlane, events}` (+ `failed: [ids]` on a LAN box), else 503
  `{ok: false, reason}` — `database` (still retrying), `starting`
  (migrating / rehydrating), `config` (the dev `BETTER_AUTH_SECRET`
  refused on a deployment), `events` (+ `failed`: a live row that would
  not rehydrate). Until the boot settles an unknown `/e/<id>/*` or a
  `/api/resolve-code` miss answers 503 `{error: "starting"}`
  (`retry-after: 1`), never 404, so no phone signs itself out; a row
  that failed answers 503 `{error: "event failed to load"}`
  (`retry-after: 5`).
- **Director consoles take patches** (`server/mod-patch.ts`, exported as
  `@loom/core/mod-patch`: `modPatch`, `applyModPatch`, `modViewJson`,
  `MOD_PATCH_KEYS`, `ModPatchFrame`). `events?role=mod&delta=1` gets a
  keyframe `snapshot` carrying a numeric `_frame`, then `event:
  snapshotPatch {base, frame, patch}` (top-level fields as `{value}` /
  `{remove}`; `world` by `path`, `codex` / `roster` by `id` as `{set,
  del, order?}`). A keyframe goes to a newcomer, a console owed or
  skipped a frame, after a `lifecycle` notice (one per restart), at least
  every 60 s (`MOD_KEYFRAME_MS`) and whenever the patch isn't smaller; a
  console behind costs nothing until it reads again. A plain console
  gets today's stream with no `_frame`; `?lean=1` is untouched. At 45
  guests a delta console is ≈ 0.11 Mbit/s against 5.9 (K-32's pass line
  is ≤ 1 Mbit/s per director console).
- **Big frames are paced** (`sseFrame`, `http-util.ts`): a frame over 64
  KiB (a 6 MB director history) goes out one slice at a time, each after
  the last write drained, later frames queued behind it, so a slow
  console reads as making progress and is never dropped mid-history.
- **Agents:** only each worker's head request is on the 2-minute clock,
  from the moment it reached the head; a request given up (attempts
  spent, or queued past 10 min) posts the hold line once; a restore never
  posts a second hold line in a thread that has one. While paused the
  agent's words commit but every act answers `{ok: false, error: "doors
  are closed"}` and counts against no `limit:`; `AgentHub.shift` on
  resume keeps the pause out of every timer. Not shipped: noticing a
  worker that stays connected but stops answering (parked on
  `oct31-w9/agent-stall`), so a wedged laptop delays the hold line.
- **Guest routes:** `/api/guest/say` and `/api/prime/say` refuse a line
  over 2,000 characters (`CHAT_TEXT_MAX`, 413 `message too long (max
  2000 characters)`; `/api/mod/say` is uncapped). `/api/guest/say`
  answers 404 `no such room` for a room the story doesn't have **or** one
  hidden from the guest (a hidden side's `faction:` room before its
  reveal, an unseen `loc:`, a hidden or members-only authored room), and
  403 `you can't post here` only for a room they can see. `POST
  /api/guest/channel/invite` holds the channel's `invite:` policy
  (`members` default / `anyone` / a ROLE name; 404 unseen room, 400 open
  room, 403 self-invite or not allowed). Joins and defects go only to a
  declared, joinable, revealed side (`server/routes/sides.ts`:
  `guestMayJoin`, `joinableFactions` — also `GuestView.factions`; 403
  `that side isn't open`).
- **Wallet cards** name who acted as a display name (`byName`: "Director",
  the guest, the character with spaces), never a `g-` id; a request's
  `declined` / `cancelled` step carries `by` when the payment behind it
  was denied or cancelled, and `closedBy` (`WalletCard.closedBy`) when a
  director closed an open request; `walletLine` takes the viewer, so the
  payer reads "your payment" and possessives are right (`possessive`). A
  send or request to a character answers 404 `unknown recipient`. The
  journaled ops are unchanged, so an old journal replays to the new
  wording.
- **Recap:** a round-3 DM lie (`lie_q7` / `lie_q8`) counts only once
  `Night.r3_closed` (📄 truth.txt) settles it.
- **Cue sheet:** a world write whose last path segment starts with `_`
  (`Night._resurrect_ask_at`) is bookkeeping: a press that writes only
  those plus staff-room lines is refused.
- **Co-editing follows a sync** (`server/collab.ts`):
  `CollabHub.resyncFromStorage(projectId)` folds rows rewritten behind the
  hub into the open docs (a rewritten file replaces the open copy, a
  deleted one drops it with a `files` `delete`, untouched files keep
  their edits); a debounced persist is a compare-and-swap against the
  row, and flushes and resyncs run one at a time per project.
  `ProjectLink.resyncFiles()` runs it plus a `files` `put` per file;
  `/api/mod/load` awaits it before the restart, and `POST
  /e/:id/api/mod/resync` runs only it (`{ok, resynced}`, `resynced:
  false` with no project link, 502 on a failure) — `sync-example
  --no-reload` calls it.
- **Spatial:** candidate rows carry `restricted`; the found reply and the
  `found` stream frame carry `captured` (still captured after the commit:
  a kept find).
- **The sync guard** (`core/scripts/live-guard.ts`, re-exported by
  `scripts/accept/live-guard.ts`): `sync-example` / `sync-show` refuse a
  live event with a real guest, or whose roster they can't read, with or
  without `--no-reload` — the files are written, the snapshot and
  runtime untouched, exit 3. `--i-know-this-is-live` or
  `LOOM_I_KNOW_THIS_IS_LIVE=1` overrides; a preview is never guarded.

### Wave 13 — the Play app UX overhaul (on `oct31-w13/integration`, not yet shipped)

- **Language** (`parser/decl-body.ts`, `runtime/sim/model.ts`):
  `OBJECTIVE` (`for:` — `guests` / `performers` / `everyone`, a ROLE, a
  CHARACTER, a GROUP; `while:`, `act:`, `title:`, `text:` with `- label[,
  done when <cond>]`, `buttons:` + `pass` / `scan`, `loud:`) →
  `model.objectives`, projected per viewer into `GuestView.objectives` /
  `PrimeView.objectives` (display only, never journaled, never sent to an
  agent). CHARACTER `admin: true` (a host part) and `crawl: fx`; header
  `alerts:` (default `Night.alerts`); the `~` per-person notice; CODEX
  `category:`; `show … with moment: major|minor`. `src/delivery.ts`
  (dependency-free, imported by play by path): `ALERT_LEVELS`
  balloon / sticky / dialog / bsod, `alertLevelOf`, `lowerRung`,
  `EFFECT_MANNERS` / `isEffectManner`, `splitNotice`, `noticeKey`.
  Workspace lints L1205 (a ROLE `secret:` slot on a watch item),
  L1207–L1209 (objectives), L1210 (`alerts:`), L1211 (`admin:` on no
  part), L1212 (a trigger phrase that keeps only its first word).
- **Chat** (`server/chat.ts`): `ChatMessage.manner` / `fx` / `ambient` /
  `notice` / `readout` / `about` / `moment` / `phase` (the story phase on
  every message that can be a moment, deterministic on replay); a `reply`
  to a character moves to its `dm:<C>` Inbox addressed `@<C>` (one push);
  `reply !…` is an alert; codex cards carry `category` / `aboutKind`.
  The show's `CHANNEL system log` is gone: a broadcast posts once.
- **Views** (`server/views.ts`): `alertLevel` on every view;
  `PrimeView.paused` / `host` / `night` / staff rooms, per-guest `flags`
  from the header's ROLE `watch:` items (a per-ROLE `flagPlan`; snapshots
  carry on flags and failed gates, the card the full list) and
  `GuestCardView` (`card`: facts, the live buttons, `guestScoped`, the
  guest's readouts); `GuestView.voiced` (which DMs read replies);
  `CueState.lastName` (who pressed LAST); `GuestView.night.act` is null.
- **Host board** (`src/host-board.ts`, `@loom/core/host-board`):
  `hostView` / `HostView`, `hostNeeds`, the judging / agent-queue /
  held-transfer / part-presence / unseen-guest / award helpers moved from
  the editor (`awardOnly`, `GATE_FLAG`). `src/identity-kind.ts`: the
  pure guest / part classification, safe for the browser.
- **Routes:**
  - `GET /api/state?role=mod&host=1` — host-gated, the host view
    (coalesced to one build per 2 s; a cue press or a phase change
    rebuilds at once), `cache-control: no-store`.
  - `POST /api/prime/card {guest}` — a prime token with a character →
    the guest's `GuestCardView` (403 with no character, 409 doors
    closed, 404 unknown guest; not journaled).
  - `POST /api/scan` and `/api/prime/act` 200s gain `card`, and
    `staff` (every line the commit posted to a staff room) / `said`
    (the booth character's lines to the guest); `/api/prime/act` also
    `replies`. The same token, character and guest scanned again within
    1.5 s answers 429 `{error: "scanned a moment ago", again: true,
    card}` and journals nothing.
  - **The host allowlist** (`server/routes/host.ts`, one gate in
    `EventRuntime.handle`): a host-only token may use `?host=1`,
    `/api/mod/recap`, `signal`, `var` (only the `alerts:` path, only a
    level), `broadcast`, `say` (only `guest:<id>` as an agent-voiced
    character), `wallet/{approve,deny,approve-held,unfreeze,stimulus}`,
    `spatial/king`, `screen/{voice,identify}`, `codes` (no `modPass`),
    `claim/unlock`, `guest/{gone,pair}`, `prime/release`, `scan`, `act`
    (`restrict` / `unrestrict` only), `start` / `stop` (doors, pause,
    resume) and `login` (the passcode upgrade). Everything else — the
    full mod stream and state, the log, reset / load / resync, set,
    impersonate, personas, every `/api/agent/*` — answers 403 `{error:
    "not from a booth"}`. Mutations journal `by: "Booth · <Character>"`.
    A host may press another character's `by:` button only when the
    press is heard outside that character's own hooks (`hostHeard`).
- **Guards:** `cleanGuestName` (NFKC, format / control characters and
  invisible fillers stripped) before the taken / part / reserved checks;
  `MAX_CODE_LENGTH` 64 (a longer code is 400 *not a code*, never
  journaled); the editor's `?as=` lens resolves the author session.
- **Serving:** `server/static-cache.ts` `appCacheControl`: hashed
  `assets/*-<hash>.*` immutable for a year, HTML `no-cache`, for the
  play, terminal and reinstall dists. `deploy/Caddyfile` holds requests
  60 s through a restart.

### Wave 18b — founded factions, results on the screens, the house router (on `oct31-w18/integ`, Stage B not yet shipped)

- **Language** (`parser/statements.ts`, `runtime/sim/`): `reveal X [for
  who] quietly` (`splitRevealQuietly`; `revealed` / `factionRevealed`
  carry `quiet`, no "📂 … open now" notice, no screen moment); the
  per-category codex mirror `<id>.codex_in.<slug>` (`codexCategorySlug`,
  a ROLE secret, never in an agent request); `names(list)` ("A, B and
  C", `joinNames`); header `badge: <path> as <glyph> <label>[, while
  <cond>]` (`runtime/sim/badges.ts` `badgesOf`, on person cards, the
  roster, booths and hosts; lint **L1219** `BadgeOnSecret`, also for a
  `while` that reads a secret); header `lobby: hidden` (`model.lobbyHidden`
  → `GuestView.lobby`; a guest's `/api/guest/say` into it answers 404);
  **faction mode**, switched on by header `founding: <cond>`
  (`crews.ts`: exclusive race factions, the founded crews plus the
  declared joinable sides, `raceView` → `ModView.race`, `SideView`
  `kind` / `ethos` / `founder` / `more` only on your own row,
  `GuestView.canFound` / `leads` (`ledSide`), the builtins
  `majority_faction()` / `faction_of` / `faction_name` /
  `faction_founder`; lint **L1220** `FoundingInvalid`); the approver's
  `as <name>` / `audit "<phrase>"` clauses and the wallet step
  `flagged`; `avatar: picture:<file> | … when <cond>` (`avatarRules`).
- **Server:** `POST /api/guest/crew/join {crew}` (faction mode only,
  `JOINS_PER_MINUTE` 6, a founder's leave disbands); crew notices drafted
  after every commit, in the same order live and on replay; redeem
  answers `title` / `already` / `missed`, check-in `room` / `replies`;
  a held transfer is flagged to its recipient too (`walletLine`'s 🚩
  copy, the approver's `as` name); `picture:` refs served from the play
  app's `dist/pictures/` (`LOCAL_PICTURE_FILE`, no network) and
  `syncConditionalAvatars` on every fanout; the spatial `mayPlay` gate
  (a parked claim, a live walk and a find of a program no longer marked
  end as `unmarked`, 410; a `force: true` begin is exempt); the results
  block `ScreenState.results` (`screenResultsOf` off `do fact_read <ids>`
  / `do fact_truth <id> <accurate|lie|none>`: counts, rows `[who, said,
  sure, out, ruled]` on the TV only, ≤ `MAX_RESULT_ROWS` 40, a reading
  never shows the last round, and at the verdict (`RESULTS_VERDICT_MS`
  120 s) the key answers and the liars' names on the TV only); four
  slide-gated night values (`most_trusted`, `least_trusted`,
  `facts_accepted`, `first_reinstall`); **every non-exact filing goes to
  the `judge:` character** (`isExact`; a FIFO queue in `agents.ts`,
  `AGENT_JUDGE_INFLIGHT` 1 per worker and never while it voices a line,
  `AGENT_JUDGE_STALL_EXPIRIES` 2 → `judgeStallNotice`, `missNotice` for a
  plain miss, `AgentQueue.judging`, `FactsFiling.queued`; what is left at
  the round's settle takes its proposal); `buildRecent` drops every line
  of the reading beats (`READING_BEATS`); in faction mode the race sides
  never ride an agent request or `/api/agent/facts` (`agentHiddenRace`);
  `POST /api/mod/audio/stop {announce?}` (on the host allowlist; `stops`
  / `now` on the GET), `POST /api/mod/audio/announce {spot, on, base}`
  (the tablets' list laid over the config in force, kept in
  `audio-announce.json` until Save to project), `audio.json`
  `device.expect` and `announce.terminals`, the heartbeat's `ann=1|0`,
  the screen state's `spot: {announce}`.
- Tests: `w18b-engine`, `w18b-factions`, `w18b-mini` (the fixture
  `test/fixtures/w18b-mini/`), `screen-results`, `w18b-integ` (the whole
  night, O4 / O2 against a fake worker), plus additions across the crews,
  wallet, spatial, audio, facts-judge and agent-recent suites. core 2472
  (149 files, incl. Postgres) on the integration branch.


---

## Part 2: the `core` row of the root CLAUDE.md package table

| Crate | Role |
|---|---|
| [`core`](../../core)       | Native **TypeScript** port of Loom (no WASM, no Prism): parser (incl. authored **`SPACE`/`CHANNEL`** chatroom declarations) + a first-principles social-ecosystem `runtime/sim` + a parser-only **`lsp`** language surface (`@loom/core/lsp` — `Workspace` with completion / hover / definition / documentSymbols / references / diagnostics, the in-process replacement for the wasm `LspWorkspace`) + an SSE/REST **event server** (`pnpm serve`) that hosts a live `Sim` for LAN events, composing its `SimEvent` stream into server-authoritative, channel-routed chat (`server/chat.ts`) with spaces + Slack-style threads (`parentSeq`), **access control** (open / private-invite / faction / group / dm channel membership, journaled `inviteToChannel`/`leaveChannel`, guest↔guest invites) + a **pluggable channel-type registry** (`runtime/sim/channel-types.ts` — per-type post policy / threadability / broadcast routing / slow-mode / ephemeral, e.g. a read-only `announcement` feed), a scoped invite roster (`rosterFor`), history + moderation, and a journaled `say` command so participant-typed chat replays deterministically. Now a **multi-tenant SaaS backend**: BetterAuth author accounts + Postgres (`server/db/`, `server/auth-server.ts`), projects + files CRUD (`server/projects.ts`), event launch/lifecycle (`server/events-api.ts`, one live event per project), and a per-event `EventRuntime` + `EventRegistry` routed under `/e/:eventId` with a `resolve-code` bootstrap — the old single-event root paths still serve a default event. **Show ops** (Oct 31 wave 1): a project's codes are pinned across End → relaunch (launch `rotate: "staff"` mints new performer/mod codes only), join QRs use `LOOM_BASE_URL` (`pickJoinBase`), room check-in by QR (`/api/guest/checkin`, `LOCATION … checkin: false` opts out), single-use re-pair (`/api/mod/guest/pair` → `/api/guest/resume {pair}`) + `/api/mod/prime/release`, **Web Push** (`server/push.ts`, `/api/push/{config,subscribe,unsubscribe,visible}`, `LOOM_VAPID_*`), env-tunable door-rush throttles (`server/rate-limit.ts`, `LOOM_RL_*`, a redeem-miss + widget limit per guest), the terminals' lean **screen state** (`/api/screen/state` — screen cues, countdown, character hidden/asleep; the poll is the heartbeat behind `/api/mod/screen/terminals`, TV mute at `/api/mod/screen/voice`), a `?lean=1` mod stream + `ModView` snapshots coalesced to ≤ 2/s, `ModView.cues` (`cueState`, `INTERACTION … sequence: false`), an agent's authored `hold:` line posted after 20 s with no worker online (a director's reply as the agent closes the queued request), place arguments folded onto the declared LOCATION (`server/place-args.ts`), `/api/mod/recap` (ceremony lists, `?format=text`) and `/api/mod/metrics`. **Oct 31 wave 2:** the house map **belongs to the project** (`server/house-maps.ts`: `house.json` + any `house.<variant>.json` are project files, never story text; snapshotted at launch on `event.house_maps` + the state dir's `spatial-maps.json`; the event plays a director's save > the project's active variant > `LOOM_HOUSE`; `/api/mod/spatial/{variants,variant,house/project}` list and switch the tent ⇄ shed variant live and **Save to project**; every map write is validated; `sync-example` pushes maps but keeps a project copy that differs), the screen state carries the latest `do announce` as `announce {seq, text, at}` (N-09), every duck find is timed (pauses excluded) into `spatial-runs.jsonl` → the recap's `duck` board, and `ModView.quests` feeds the Inspector's grants. **Oct 31 wave 4** (9d35a4b): the facts judge `server/facts.ts` (`FactsBook` off the project's `facts.json`, `Night.judge_mode` `auto` \| `review`, `do fact_filed` / `do fact_judged` → `ModView.facts`; the key is snapshotted at launch, `Store.loadFacts/saveFacts` → `project-facts.json`, `/api/mod/load {facts}`, `LOOM_FACTS` the LAN fallback, `scenarioFactsFile` in `examples/load.ts`, `sync-example` always pushes the example's), `pnpm titi:facts [--check]` (`scripts/titi-facts.ts`, the show's generated files), the wallet `server/wallet.ts` (`WalletBook`; header `currency:` + `wallet:` roles in `runtime/sim/model.ts`; `POST /api/guest/wallet/{send,request,respond,offer,accept,decline,cancel,stimulus,approve,deny}` → `{ok, wallet}`, `POST /api/prime/wallet/{approve,deny}` → `{ok, queue}`, `POST /api/mod/wallet/{approve,deny,cancel,stimulus}`; `LOOM_RL_WALLET`), `POST /api/prime/widget {seq, result}` (a character answers its own card), `/api/mod/quest {who}` for a character, `/api/mod/act restrict \| unrestrict` + `/api/mod/set restricted` (the `restrict` / `unrestrict` / `pin` / `unpin` statements), `/api/mod/signal label` (a mod-token device names itself), and `EventRuntime.tickOnce(ms)` (the ticker body, public for tests). **Oct 31 wave 5** (85d2bad): the wallet resolves an offer's entry by title (a buy never checks what the seller holds), held transfers approve themselves after 5 min (`HOLD_MS`, `POST /api/mod/wallet/approve-held`), a restricted guest's wallet answers 403, and the minter's **grant + freeze** (`wallet: minter, … grants N, freeze <dur>`; `POST /api/guest/wallet/{grant,freeze}`, `POST /api/mod/wallet/{grant,freeze,unfreeze}`); INTERACTION `restricted: allow`; `sum` / `max` / `len` builtins; commas inside quoted `with` values; lint `L1203` / `L1204` (currency / wallet lines); a `!!` pin is a takeover (`ChatMessage.takeover`); `/api/mod/spatial/begin` fires `reinstallation begun`; push payloads carry `url: /?room=…`; K-31b behind `LOOM_HOMESCREEN` (`POST /api/guest/homescreen`, a per-guest `/manifest.webmanifest?code=&pair=`) + `POST /api/prime/logout`; `LOOM_SNAPSHOT_MS` coalesces guest + booth snapshots (off by default); `flushClock()` on SIGTERM / SIGINT; `stale` covers maps + `facts.json`; the recap's shares / chess / bathroom lists; `/api/mod/codes` carries `cast` + `stacks`; `/api/screen/state` gains the chart's `top` / `bottom` / `revealAt`, `identify` (`POST /api/mod/screen/identify`), `announces` + `announceEpoch`; `GET /api/state?role=mod&cues=1` (the lean cue sheet). **Wave 7** (2026-10-17): `GET /api/screen/state?room=<LOCATION>` → `room: {id, open}` (open = not hidden or revealed to everyone; the TV mute is the TV's only), `EventRuntime.declaredCharacters` (the story's cast compiled once per text, so a mod code's `resolve-code` and the null-sim mod view list it before the doors; `modView` takes an optional fifth `declared`), `titi:facts` generates the server-room door code (`facts.json` `door` → `Kernel.door_code` + the secret *The Door Code* + the keypad sign) and `core/src/facts.ts` checks it, the recap's "Chess against the King". **Wave 9** (ae79117): `server/boot.ts` + `GET /api/health` (503 `database` / `starting` / `config` / `events`; an unknown event or code answers 503 `starting` until the boot settles; `LOOM_DB_WAIT`), director consoles on keyed patches (`?delta=1`, `server/mod-patch.ts`), big SSE frames paced in 64 KiB slices, the agent hub's head-only 2-minute clock + the paused-act refusal (D10), `/api/guest/say` 413 over 2,000 characters and 404 `no such room` for a missing or hidden room, the guest invite `invite:` policy, joins only to declared / joinable / revealed sides (`routes/sides.ts`), the guest code through an IP lockout, `LOOM_RL_QR`, display-name and `closedBy` wallet cards, a `_`-leaf write is cue-sheet bookkeeping, `CollabHub.resyncFromStorage` + `POST /api/mod/resync`, spatial `restricted` / `captured`, the sync guard (`scripts/live-guard.ts`, exit 3). vitest-tested (1515 after wave 9, incl. the Postgres-gated suite). **Wave 10 (the Director page, built on branch `oct31-w10/director-core`, merged as 3eac8de):** INTERACTION `act:` (`InteractionSummary.act`, admin cues only), the repeatable header keys `watch:` / `countdown:` (`Header.lines`, `runtime/sim/board.ts`, `SimModel.watch` / `countdowns` → `ModView.watch` / `countdowns` via `boardFor`; a `secret: true` CHARACTER head masked, a ROLE head counted over guests; lint `L1205`), `ChannelSummary.staff` (`staffRoomIds`), and in `src/cue-sheet.ts` `cueActs` / `focusActIndex` / `previousActIndex` / `onDeck` / `cueTitleTags` / `countdownLeft` + the shared arm model (`tapCue`, `ARM_MS` 4 s, `ARM_DEAD_MS` 300 ms, `armStillValid`); the lean view gains `clock` / `countdowns` / ≤ 3 non-secret global watch values (`scope === "global"` only: never a ROLE count, a person row or a CHARACTER value; `CueSheetView.paused` rides the phone branch, `CastSummary.secret` the editor branch — both additive). `CueState` gains `presses` / `pressed` (a per-log `pressLog`, rebuilt on replay); `/api/mod/signal` refuses a cue-sheet press (one carrying `presses`) with 409 `moved` (`pressMovedArm`) or 409 `doorsClosed` (the `start:` beat unplayed; `Meta.opened` survives a restart) and its 200 carries `presses`. The journal's format and the bank are untouched. **Wave 11** (merged on `oct31-w11/integration`): **the shared King** — `SpatialHub` reads his hp off the king prop's `health` path (`Night.king_hp`; missing = max), `POST /api/spatial/king/hit` (session token) judges reach off the session's last pose with `@loom/house` `kingReach` plus slack (+0.35 m, +25°), then journals the set `hp − 1` and fires `king hit` (args `hp` / `max`) and at 0 `king fallen`, `by` the device; 409 `already hit` / `not near` / `fallen` / `doors are closed`, 404 `no king`; one hit per guest per reinstallation **visit**, which ends when its duck is found (Leave + re-scan, a director's end or a timeout is the same visit; `kingSpent` lives in memory, a story reset or a restart forgets it); `POST /api/mod/spatial/king {hp}`; `hello.king` + a `king` frame only on change; `/api/screen/state` → `king {hp, max, fallen, armed}`; a remap with the King down judges standing room past him (`withFallenKings`). **Ghost pictures:** `PlayerState` / `Assignment` / `SpatialCandidate.avatar` = the `AvatarBook` key, resolved live, plus an `avatar` frame when a picture changes. **Reserved programs** (`server/routes/claims.ts`): `CHARACTER … reserved: true` → `CharDef.reserved`; `/api/identities` + search rows carry `reserved`, `guest/register {claim}` answers 409 `reserved` without the claim (its `wiki:` article is held too); the claim is an HMAC keyed by `event.claim_secret` (a new column; carried at launch) / `claim-secret.json`, so End → relaunch keeps every invitation; `/api/mod/codes` → `claims[{character, claim, url}]`; `POST /api/mod/claim/unlock {character, minutes?}` (2 by default, ≤ 60, 0 shuts; memory only) → `CastSummary.unlockedUntil`. `lastSeen` on the roster rows, `POST /api/mod/guest/gone {id, gone}` (journaled `<id>.gone`), a Run persona's `<id>.persona = true` set before its join hooks. `countdown: … , for guests` → `GuestView.countdowns` (lint L1205 refuses the flag on a `watch:`). INTERACTION `arm: true` → `InteractionSummary.arm`. **`by:` is enforced** on `/api/prime/act` (403 *not your button: … is for …*; views flag `only: true` and a booth never offers another character's). **Near-miss judging** (`src/answer-match.ts` `nearMatch`: honorifics dropped, number words, plurals, word order, spelling word by word — 1–3 letters exact, 4–7 one edit, 8+ two, first letter kept — numbers and am/pm exact): in `auto` a near miss waits on the Judging card (`near: {key}`) with a ⚠ line in `# hosts`, proposed accurate, so it is credited at the settle if nobody judges it. The agent hub's **`busy:`** line (`CharDef.busy`; once per thread, only to a request that waited 40 s behind another on an online worker) and **single-worker stall detection** (a head unanswered 60 s: one ⏳ `# hosts` line, the hold line once per waiting thread, no new dispatch until the worker's next answer or a reconnect; `CastSummary.agentQueue {depth, oldestMs, stalled}`). `CodexEntryView.secret` + `Sim.agentRefusal` (a secret file to an agent-voiced character → 403 *they won't take a secret file*). `titi:facts` generates `facts.json` `door.clues` (four secret digit notes, the silver print stack, their codes in `secrets.never`) and the new keypad sign. The final fix pass: `Assignment.kingHit`; a checkmate by a program who already holds the code is taken and tells them so; four digit notes after 📄 or an ending fail *The Cold Door*; `door_digits` + `quest.the_cold_door` are ROLE Program `secret:` slots; the judge spells out abbreviations before its exact look (`spellOut`: Mr. / Mrs. / Dr., yrs, ext, hr(s), min(s), sec(s), `0900`) and a right answer said at length (the key's words in order + up to 4 more) is a near miss unless an extra word turns it around, hedges, adds an am/pm or is a lone letter; a pool program typed in another case registers under the story's spelling (`canonicalGuestName`); the patch-bay `radio_*` are `by:` the four room Antivirus, never Windows Defender. vitest 1780 (95 files, incl. Postgres). **Wave 11b:** header **`judge: <Character>`** → `SimModel.judge` (`judgeOf`: a `mind: external` CHARACTER's id, else null; lint **L1206** `JudgeUnresolved`); `AgentHub.judge()` sends a **`judge`** frame `{id, character, filing, question, key: {answer, aliases}, answer, confidence}` to an online, unstalled worker voicing it (never queued or thread-bound; `judging`, `judgeSettle`, `cancelJudge`; dropped after `AGENT_JUDGE_TIMEOUT_MS` 60 s, a pause excluded, on a worker leaving or a restart); in `auto` a near miss is asked at filing when `rulerOnline()` (the ⚠ line ends *… asked Trabolta to rule*); `POST /api/agent/judge {id, worker, same, why}` (mod-gated; 400 / 410; `why` ≤ 200) → same accurate, not lie at 100 else uncertain, through the book's confirm signal `by: agent:<Character>` with `ruling` / `ruling_why` args (`rulingOfArgs`, rebuilt on replay) + `rulingNotice` in `# hosts`; a director's verdict or a refiling cancels it (`dropMootRulings`); a near miss filed with nobody to ask is never asked later (`rulingsDue`: only a restore's pending ones); `FactsFiling.ruling {by, same, why, at}` / `asking`, `FactsView.judge`, `AgentThought` kind `judge`. `reservedDefFor` also holds a reserved name without its first word (*Excel*). The show: `judge: Trabolta`, the moved `door.code`. vitest 1800 (98 files, incl. Postgres). **Wave 12** (Trabolta's mind rebuilt, on `oct31-w12/integration`): `server/agent-recent.ts` — every thread line the story posted rides an agent request as `story: true`, and `recent` (≤ 6 items from the last 10 story-minutes: a gift, his last 2 house-wide lines, the speaker's filings as question ids, the mark, their Trust Chart rank) + `storyAt` are rebuilt on every request (no store; a hunt-answer or secret entry, a line naming an answer form or a secret character's current value never rides it); the guest's `them.codex` is titles only; `LOOM_AGENT_RECENT=off` sends the wave 11b request field for field (compose passes it). The stream hello's `traceAfter`, `/api/agent/facts` `paused`, the `rewrite` control, thought kinds `brief` / `summary` + `prompt_ms`, and the mind report's `mode` / `phase` / `briefBy` + per-person `memos` / `firstMet` / `gifts` / `filings` / `marked` / `chart` / `storyTrust`. The answers follow-up (`trabolta/answers`): every hunt-answer entry is `secret: true`, `mentionsKey` (`src/answer-match.ts`) + `test/trabolta-answers.test.ts` scan his requests, facts and prompts, `the_line_works` is gone (the house judges the pickup line; `titi:facts` adds it to `secrets.never`). vitest 1847 (100 files, incl. Postgres). **Wave 13** (the Play app UX overhaul, on `oct31-w13/integration`, not yet on master): **`OBJECTIVE`** (`for:` a reserved word `guests` / `performers` / `everyone` → ROLE → CHARACTER → GROUP; `while:`, `act:`, `title:`, `text:` with `- label[, done when <cond>]` to-dos, `buttons:` + the app's `pass` / `scan`, `loud:`; `model.objectives`, display only, never journaled or sent to agents) → `GuestView` / `PrimeView.objectives`; CHARACTER **`admin: true`** = the **host** capability (`Session.host`, granted by `/api/prime/login` of that part, re-derived on every story load, dropped by Release / Logout / Go live; the allowlist in `server/routes/host.ts`, every other mod route 403 *not from a booth*; journaled `Booth · <Character>`), `crawl: fx`, header **`alerts:`** (default `Night.alerts`; `src/delivery.ts`: `ALERT_LEVELS` balloon / sticky / dialog / bsod, `EFFECT_MANNERS`, `splitNotice` / `noticeKey`), the **`~`** per-person notice, CODEX **`category:`**, `show … with moment: major\|minor`; `ChatMessage.manner` / `fx` / `ambient` / `notice` / `readout` / `about` / `moment` / `phase`; a `reply` to a character moves to its `dm:` Inbox (`@<C>`); `CHANNEL system log` deleted (one post, one push per broadcast); **`GET /api/state?role=mod&host=1`** (`hostView`, coalesced to one build per 2 s), **`POST /api/prime/card`** (`GuestCardView`), `/api/scan` + `/api/prime/act` carry `card` / `replies` / `staff` / `said`; `/api/mod/start` + `/api/mod/stop` on the host allowlist; `PrimeView.paused` / `host` / per-guest `flags` (ROLE `watch:` items; snapshots carry on flags + failed gates, the card the full list; a per-ROLE `flagPlan`); `CueState.lastName` (who pressed LAST); `src/host-board.ts` (`@loom/core/host-board`: `hostNeeds`, the judging / wallet / parts / unseen / award helpers, `awardOnly`, `GATE_FLAG`) and `src/identity-kind.ts`; a lookalike of a taken guest name refused (`cleanGuestName`), `MAX_CODE_LENGTH` 64, a repeat scan within 1.5 s answers 429 `again`; hashed `/assets/*` immutable (`server/static-cache.ts`); lints L1205 (a ROLE `secret:` slot on a watch item) and L1207–L1212. vitest 2098 (116 files, incl. Postgres). **Wave 17** (not shipped): `/api/screen/state` gains **`moments`** (`MOMENT_RING` 12, live only, `{seq, at, kind: beat \| signal \| sfx \| reveal \| found, name, who}`: subject-free beats, admin cues the story took (`signalRefusedAt` in `views.ts`), `do pick` draws, device signals (King, chess, `reinstallation begun`), house-wide reveals and the duck's find (`golden duck` / `golden duck kept`); never a guest or booth press except `BOTTLE_VERDICTS` on the bottle's pick within 5 min, never a checkmate, an admin cue whose rule sets a secret character's var, or a name touching the Kernel or a secret character) and **`night`** (`ScreenNight`: allowlisted public `Night.*`, the award winner only under an `award_*` slide); the heartbeat `terminals` list left the answer (it stays on `/api/mod/screen/terminals`, which gains `fullscreen` off `fs=1\|0`); before the doors a terminal naming a character gets `attract`. `sound X in <Place>` / `with rooms:` lower to `sfx` `rooms` args (`lowerSoundArgs`, `roomsWords`), directive events carry `setting`, lint **L1213** `SoundRoomUnresolved`. **`audio.json`** (`server/audio.ts`): a director's save (`audio-save.json`) > the project snapshot (on the `house_maps` record, no migration) > `LOOM_AUDIO` > a default 16 / 16; `GET /api/mod/audio` → `{audio, version, source, sounds, locations, tests, problems, warnings}` (a long poll with `?after=&tests=&wait=`; `router=1` marks the router's), `POST /api/mod/audio {audio, base?}` (400 `problems`, 409 stale), `POST /api/mod/audio/project`, `POST /api/mod/audio/test {speaker} \| {out}` (the last 8, ≤ 60 s, memory only); `/api/mod/load {audio}`; `sync-example --keep-audio \| --replace-audio` (independent of the map switches); the starter `examples/trapped-in-the-internet/audio.json` (DRAFT). vitest 2201 (132 files, incl. Postgres). **Wave 18** (the Play app plays like a game, on `oct31-w18/integration`, not yet on master): **big moments** — `reply !!…` / `broadcast "!!…"` (`MomentClass` `big`, `splitAlert` learns `!!`; `pin "!!…"` stays the takeover), `show … with moment: big`, `with close: 6s` → `ChatMessage.autoClose` (a house big only); **exits** — `with go: <word>[, go: …][ as "Label"]` after a quoted `reply` / `broadcast … to …` / `pin` / `show` (`src/go.ts`, `GO_WORDS`; a LOCATION / CHANNEL / CHARACTER / guest INTERACTION / `codex[: Entry]` / `quests` / `quest: Q` / `pass` `scan` `chats` `mission` `notifications` `sides` `wallet` `me`; never `lobby`) → `ChatMessage.go: GoTarget[]`, trimmed per viewer (`goForViewer`), with defaults (a card's thread, a codex entry, a quest, the Wallet); readouts carry `aboutName` / `aboutAvatar`; OBJECTIVE **`go:`** (→ `GuestView.mission {objective, place}`), **`target:`** / **`pick:`** (booth objectives: `ObjectiveView.target` / `pick`, ≤ 60, `Sim.valueOf`), **`evergreen:`**; header **`wanted: <role>.<flag> [as …] [by <claim>], for …`** (`PrimeView.wanted` / `HostView.wanted`, `server/wanted.ts` `StoryMarks` = `markedAt` rebuilt on replay, captured posters 60 s), **`reinstall: <cond>`** (`eligibleFor`; candidates `marked` / `favour` + `ended`; runs after `Night.ended` journaled `after: true`, off the duck board), **`archive: X when <cond>`** (`GuestView.archived`), **`majority:`**; **callers** — `by:` on a `who: admin` cue (`cueCallers`, `Session.caller`, `PrimeView.calls`, `POST /api/prime/cue`, journaled `Booth · <part>`); the **caller claim** `POST /api/mod/caller {on, label?}` → `cues.caller` (memory only; on every cue-sheet view); global booth presses (`/api/prime/act {name}` with no guest, `PrimeView.globalButtons`); the host view's NEXT + 3 descriptions and `cues.then`; `/api/mod/signal` 200 `said` / `staff`; `Night.judge_mode` on the host var allowlist; **crews** (`src/runtime/sim/crews.ts`: one journaled `crew` op — found / invite / answer / leave / recruit / leaveSide / rename / dissolve; `/api/guest/crew/{found,invite,leave}`, `/api/guest/recruit{,/answer}`, `/api/guest/side/leave`, `/api/mod/crew/{rename,dissolve}` (host allowlist); `GuestView.crew` / `invites` / `sides`, `PersonCard.groups`, `ModView.crews`; rooms `crew:<id>`; events `founded`, `join` (crew), `recruited` (`by` = the recruiter), `unaligned`; names moderated, never checked against secrets (an oracle); masked from agents); `/api/screen/state` `moments` carries a house `!!` broadcast as `kind: "big"`; the casino refuses a captured program; lints **L1214** `GoTargetUnresolved`, **L1215** `ObjectivePickNotForBooths`, **L1216** `HeaderLineInvalid`, **L1217** `CallerNotAPart`, **L1218** `BigHouseBroadcast` (`src/lsp/w18-lints.ts`). vitest 2304 (139 files, no Postgres). **Wave 19** (the voice link, on `oct31-w19/integration`, not yet on master): `server/spatial-voice.ts` `VoiceRelay` (transport-free, memory only, never journaled) behind `POST /api/spatial/voice?seq=[&spot=]` (raw μ-law, 160–8000 bytes under its own cap before the 2 KB spatial parse; a game's session token, or a mod token + `spot`; 401 / 410 / 403 `moderators only` / 400 / 413 / 404 `no such spot` / 403 `voice is off at this terminal`; 200 `{ok, listening, ears, dropped?}`) and `GET /api/spatial/voice/stream?token=[&spot=][&mic=0|1&hear=0|1]` (SSE `hello {…, listen, ears}` / `listen {on, ears}` / `voice {from, kind, spot?, session?, name?, gain, seq, data}` / `bye {from}`, `:ping` 15 s; a reader 64 KB behind skips `voice` frames and that is its stall cap too; the newest stream wins: one per player session, `VOICE_STREAMS_PER_SPOT` 2); `route()` on every spatial flush applies `@loom/house`'s rule with each stream's current sources as `keep` and only the terminals whose stream's mic can be heard as a player's candidates; closed on a session's end, a story reset, `dispose()`; the heartbeat's `mic=live|muted|denied|insecure|locked|off` (`MIC_STATES`) → `/api/mod/screen/terminals`. vitest 2328 (142 files, incl. Postgres). **Wave 18b** (Stage A — `oct31-w18/{engine,server}` — shipped as `w18b-1021`; the show's Stage B on `oct31-w18/integ`, not shipped): `reveal X [quietly] [for who]` (`splitRevealQuietly`: no 📂 notice, no screen moment); `<id>.codex_in.<category>` per CODEX `category:` (`codexCategorySlug`; a ROLE secret slot, never in an agent request); `names(list)` (*A, B and C*, `joinNames`); header **`badge: <path> as <glyph> <label>`** (`badges.ts` `parseBadgeLine` / `badgesOf` → `badges` on `PersonCard`, the viewer's `GuestView`, `PrimeGuest`, `RosterRow`, `HostPerson`; lint **L1219** `BadgeOnSecret`, a `while` reading a secret refused too); **`lobby: hidden`** (`GuestView.lobby`; routing kept, a guest's `say` into it 404 `no such room`; booths and Run keep it); **`founding: <cond>` = faction mode** (`crews.ts`: one race over the declared joinable sides + the founded crews, one at a time, `joinCrew`, a founder's leave disbands, `mayFound`, an invitation's yes held to the walk-in rules; `majority_faction()` / `faction_of` / `faction_name` / `faction_founder`; `SideView.kind` / `ethos` / `founder` / `more` with counts on your own row only; `GuestView.canFound` / `leads`; `ModView.race`; `POST /api/guest/crew/join` (`JOINS_PER_MINUTE` 6), founder / leader refusals (`staysWithSide`), crew notices drafted after every commit (`draftCrewNotices`); race sides masked from agent requests and `/api/agent/facts` (`agentHiddenRace`); lint **L1220** `FoundingInvalid`); approver `as <name>` / `audit "<phrase>"` (`walletRoleOf`) → wallet step **`flagged`** for the recipient (`WalletCard.audit`, a minor moment); `avatar: picture:<file> \| … when <cond>` (`CharDef.avatarRules`; `picture:` served off `play/dist/pictures/`, `LOCAL_PICTURE_FILE`; `syncConditionalAvatars`); scan answers (redeem `title` / `already` / `missed`, check-in `room` / `replies`); the spatial gate `mayPlay` (a parked claim, a walk after an unmark and `found()` end as `leave unmarked`; a `force: true` session is exempt); **results on the screens** (`do fact_read <ids>` / `do fact_truth <id> <status>` → `ScreenState.results` via `screenResultsOf`: counts, rows `[who, said, sure, out, ruled]` on the TV only (≤ `MAX_RESULT_ROWS` 40), never the final round in a reading, and at ⚖ the key answers + the liars' names, TV only, for `RESULTS_VERDICT_MS` 120 s; the night's `most_trusted` / `least_trusted` / `facts_accepted` / `first_reinstall` only under their slides; `buildRecent` drops every line of the reading beats, `READING_BEATS`); **every non-exact filing goes to the `judge:` character** (O4: `isExact` accepted at once; the hub's FIFO queue, `AGENT_JUDGE_INFLIGHT` 1 frame out per worker, voice replies first (`pumpJudges`), the 60 s expiry from dispatch, `AGENT_JUDGE_STALL_EXPIRIES` 2 → *⚖ {judge} isn't ruling…* (`judgeStallNotice`), a dropped worker's frame requeued, the settle's fallback; the frame's `near`; `missNotice`; `FactsFiling.queued` / `before`; `AgentQueue.judging`); `POST /api/mod/audio/stop {announce?}` (on the host allowlist; the GET's `stops` / `now`), `POST /api/mod/audio/announce {spot, on, base}` (integ; `audio-announce.json`, `announceSaved`), `spot: {announce}` on the screen state + the heartbeat's `ann=`; the bank warns `liveHeadersIgnored`. **The show (Stage B):** Truth or Dare after 📋×3, Trabolta reads every result (Question Results, Round Two Tally off `said_4`–`6`, The Verdict's `Kernel.t1`–`t8` + a 34 s story-time hold before the ending), Telephone / the piñata / Back To The Heart gone, clearance quiet, *Jean Trabolta, Sole Owner and Founder of Maps and Ducks*, his picture breaking (`Trabolta.broken`), founded factions from the Truther Download (🧾 deleted, 🗳 `force_their_majority`, the quest *A Faction Of Your Own*), the typed left-behind (`left_behind_text`), the hidden lobby, 🚻, MyCRA, Facts Are Currency by category, the 16 ties (`codex/85-ties.loom`, category Connections) + The DSL Line dealt by Program Briefing, The Night In Review before every ceremony + a private Your File (`beats/review.loom`); the `test/fixtures/w18b-mini` story; `test/w18b-integ.test.ts`. vitest 2472 (149 files, incl. Postgres). **Wave 20** (Trabolta's heart, on `oct31-w20/integration`, not shipped): **guarded choices** `+ (if <cond>) ⟦TAG⟧ text` (`Choice.guard`, split off before the hidden-text `[…]`; a false or failing guard drops the option, a menu left empty is skipped; lint **L1221** `ChoiceGuardInvalid`; `edit.ts` + the story graph keep the guard; the bank's `choiceGuardIgnored`); **menu ids** (`PendingChoice.id` = its `choicePrompted` log index, `beat`; `GuestView.choices [{id, beat, channel, options}]`, optional; `POST /api/guest/choose {index, text?, choice?}` → 409 `no choice` / `moved`, `/api/mod/choose` the same through `chooseFor`; the journaled `choose` carries `choice` + the menu's beat + the option's text, so a replay over edited text finds the menu); **room cues** (`cue room_<x>` in a beat set in a LOCATION → `ScreenRoom.cue {value, seq, at}`, that room's terminal only, never a moment); `ScreenNight.server_door` / `heart_stage` / `heart_look` / `alarm_on` / `door_override`; the heartbeat's `door` / `dlv` / `dft` / `dwn` → `ScreenDevice.door*` on `/api/mod/screen/terminals`; quiet door signals + `QUIET_MOMENT_BEATS` (Heart Nag / Door Again / Door Shut / Sealed); **`lights.json`** (`server/lights.ts` `LightsHub`: a director's save > the project's (on the `house_maps` record) > `LOOM_LIGHTS` > default; `GET \| POST /api/mod/lights` (a long poll on `after` / `tests` / `pairs` / `devicesAt`, `module=1` presence, `now`), `/project`, `/test`, `/devices`, `/pair`, none on the host allowlist; `/api/mod/load {lights}`; `sync-example --keep-lights \| --replace-lights`); **the agent dossier** (`server/agent-dossier.ts`: `AgentRequest.dossier` only for a guest `at_the_heart`, ≈ 3 KB, `recent`'s leak checks, never a secret / answer / code / `via` / `by` / account; `LOOM_AGENT_DOSSIER=off`); `/api/mod/signal` answers `refused` only for a declared INTERACTION. The show: the Heart sequence (`beats/server-room.loom`, the four layers, `main.loom`'s door rules and watchers, `lights.json`, `stand_down` deleted; `test/trapped-heart.test.ts`). vitest 2623 (159 files, incl. Postgres). |
