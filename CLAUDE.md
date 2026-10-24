# Loom

All Loom v3 code lives here, split into sibling packages so devs can
take just the piece they need (the Godot addon, the TS engine, the
event server, …) without dragging the rest along. Repo license is MIT
(the one exception is `server/` — see the Rust workspace note below).

| Crate                  | Role                                                            |
|------------------------|-----------------------------------------------------------------|
| [`parser`](./parser)   | Lexer, AST, diagnostics, keyword table, span-preserving structural `edit` API for the `.loom` surface |
| [`runtime`](./runtime) | Bundle, resolver, playhead, ledger, reactive graph, scheduler, directive registry, multi-head play `session`, Luau bridge |
| [`lsp`](./lsp)         | Stdio JSON-RPC server backed by `loom-parser` + a workspace-wide name index |
| [`syntax`](./syntax)   | TextMate grammar generator (driven by `loom-parser::keywords`) + Zed / VSCode extension shells |
| [`server`](./server)   | Multi-user backbone — `loom-relayd` axum server hosting per-workspace Loro CRDTs over `prism-core::network::relay`. **Builds only inside the Prism monorepo** (depends on `prism-core`, stays GPL); excluded from this repo's Cargo workspace. See [`docs/loom-multiuser.md`](./docs/loom-multiuser.md). |
| [`editor`](./editor)   | React/Vite/CodeMirror web IDE — the author front end: a BetterAuth sign-in gate → projects launchpad → Studio shell with **three modes**: **Writing** (`⌘1`, text editor + story-graph node editor side by side), **Run** (`⌘2`, the control room for the project's **one run** — "Start rehearsal" is the shared server event on a server project / the in-browser `@loom/core` `Sim` on a folder; the header owns the lifecycle incl. **go live in place**; join codes/QR (pinned across End → relaunch; **New performer + moderator codes** rotates staff codes only) + directors + guest lookup + the **🖨 Print sheet** (join poster, codex + room check-in QRs drawn in the browser) + the **Terminals** card (every wall terminal + the TV by last poll, red + chime after 20 s silent) on the Run page; Director opens on the **cue sheet** (`who: admin` INTERACTIONs in order, LAST / NEXT shared by every director); the Inspector's **🔁 Re-pair** (single-use QR for a lost phone), **⏏ Release** (free a performer's part) and **codex + quest grants** (S4: grant an entry, Start / Update… / Complete / Fail a quest, on a server or local run); Run → Mind's **Judging card** (wave 4: the facts judge's `auto` / `review` mode, pending verdicts with accurate / lie / uncertain overrides, per-question tallies; a folder run has no judge); an **identity control** to *be* any persona, guest, or character with the server's exact view of them), and **Integrations** (`⌘3`, engine targets — the Wwise-style Godot link / addon install / bank build). **Server-backed projects** or a local folder. **Oct 31 wave 5** (85d2bad): Run's **Wallet** card (open transfers with countdowns, ✓ Approve all held, 💰 stimulus, the freezes with ☀ Lift) and **House map** card (Tent \| Shed), the Terminals card's 🔇 / 💤 / 🔋 / build badges + **identify**, the print sheet's door sign + 8-up cast cards + codex posters sorted by stack, award winners suggested off the recap on the cue sheet (whose helpers moved to `@loom/core/cue-sheet`), the Judging card's who-filed-what, Inspector **Restrict / Unrestrict** with ⛔ badges, wallet rows + a character's booth rooms in the lenses, and a readable line for every Log event. **Wave 9:** the Judging card's ✅ / 😤 / 🤷 on every judged filing in both modes, a server run's Log in story time, the mod and collab streams reopen after a 502 (a restarted server's doc is rebased, never doubled), and Run's mod stream takes keyed patches (`?delta=1`, `@loom/core/mod-patch`). vitest 309 after wave 9. **Wave 10 (built on branch `oct31-w10/director-editor`, merged as 3eac8de):** Run → Director is rebuilt in `components/cockpit/director/` — the running order by **act**, a NOW card (NEXT + description, *then:*, *nothing to press* + the story's countdowns, LAST + what the press did, ✓ Taken / ✕ Not taken with the `# hosts` reason), On hand (`from E ▸`, ⚡ Anytime), every cue **armed then fired** (core's arm model; Space · Space in Calling mode), a glance column (Needs you, the `watch:` board with secret values masked, People, Cast, the staff-room feed), Calling / Watching per console, a ▶ NEXT pill in the Run header; `fireSignal` → `FireResult`. **Wave 11** (f476df6): Run → House map's **shared King** row (his bar off the screen state's `king`, **Set…** a value and **👑 Restore** → `POST /api/mod/spatial/king {hp}`; `lib/king.ts` drops a poll begun before a write), **who is still here** (`lastSeen` as *seen 12 m ago* in the Inspector, the rail and the Roster's Seen column; *not seen since the server started* after a restart; nothing on a persona; **👋 Went home / Back** → `POST /api/mod/guest/gone`; the glance's *👋 N guests unseen 30 min — mark gone?*), **near misses** on the Judging card (*⚠ near "<key>"*, counted in the header; the auto tooltip names the exception), the Mind header's **agent queue** badge (depth · oldest wait, aged between snapshots · ⛔ stalled; the glance's ⚠ at 40 s), and the Print sheet's **Invitations** (one claim QR per reserved program, 4-up; a screen-only two-tap 🔓 *lost? open 2 min* that follows the cast row's `unlockedUntil` and shuts early on two more taps) + the **silver** digit-note stack (title + QR, never the digit). vitest 398 (52 files). **Wave 11b** (85e7d45, 431d542): the Judging card's *🤖 asking Trabolta…* on a near miss put to the story's `judge:` character, a **Rulings** list (*🤖 Trabolta: same — why*, *now accurate*, *(overridden by X)*) with the usual ✅ / 😤 / 🤷 to override, the ruling on each ▸ filing row (`cockpit/mind.ts` `rulingOf` / `askingOf` / `rulingText` / `askingText` / `ruledFilings`), the Mind trace's **judge** kind; a `typecheck` script (`tsc -b`) so predeploy covers the editor. vitest 400. **Wave 12:** Run → Mind reads the story mind (`mind_mode: new`): drive sliders send once on release (`sliderStep`), **Rewrite brief** replaces Survey now, *set by story* / *set by director* / *memo by voice* labels, the People rows' house trust, ⛔, memos, first met, gifts, filings and chart, the `brief` / `summary` trace kinds, prompt time, and a stored-once prompt prefix fetched by id; no Pause mind under it. vitest 432 (52 files). **Wave 13** (the Play app UX overhaul, on `oct31-w13/integration`, not yet on master): the performer lens is the booth's own `PrimeView` (no admin cues; a host part's lens carries `host` and another character's `by:` button only when its press is heard), readouts arrive off the booth's Inbox (`CockpitMessage.readout` / `about`; *Norton · Inbox* under the Operator, read-only), the Inspector's *Their view* / *Their booth* list the lens's objectives (`cockpit/objectives.ts`), Needs you wraps the shared `hostNeeds` (`needLink`), the Judging / wallet / parts / unseen-guest / award helpers re-export `@loom/core/host-board` (a Vite + tsconfig alias), a host part's Players pane is a host booth, and the dev server stubs `node:crypto` (`src/lib/node-crypto-stub.ts`) so the app mounts. vitest 454 (55 files). **Wave 17** (not shipped): Run → Terminals' red ⛶ badge for a terminal that reports it is not full screen (`lib/terminals.ts` `terminalBadges` key `fullscreen`, off the heartbeat's `fs=`; the hover says relaunch Chrome with `--kiosk` on a TV or mirror row, touch the screen once on a tablet). vitest 477 (58 files). **Wave 18** (on `oct31-w18/integration`): Run → Director's **Calling** is the show's caller claim on a server run (`POST /api/mod/caller`, `CockpitState.claimCaller`, `director-mode.ts`: another console's claim turns this one to Watching, *X is calling*); the cockpit types follow core's (crews, `GoTarget`). vitest 482 (59 files). **Wave 19:** Run → Terminals' 🎤 badge off the heartbeat's `mic=` (`lib/terminals.ts` `micBadge`: 🎤 live, 🎤 off for `off` / `muted` (⚙), red 🎤 denied / 🎤 http / 🎤 tap (`locked`) where a microphone belongs). vitest 485 (59 files). **Wave 18b** (on `oct31-w18/integ`, not shipped): **■ Stop house sounds** in the Run header (`StopSoundsButton` in `RunStage`, server runs only, no confirm) and a **House sound** card on the Run page (`run/HouseSoundCard.tsx` over `store/house-audio.ts` + `lib/house-audio.ts` + `audioApi`, bound in `App.tsx`: the router line, the stop *+ announcements*, *Tablets that also say the announcements* one box per map spot through `POST /api/mod/audio/announce` (the whole save with `base` on an older server), the 409, Save to project), 📢 on Run → Terminals off the heartbeat's `announce`, `reinstall` in *Set up a terminal* (`TerminalView.Reinstall`, `isStationView`; the link carries `announce=1` only when ticked) and ⛶'s `--kiosk` line for the tent laptop, the glance's **faction race** off `ModView.race` (`raceGlance`: one bar per race faction on one scale, *over the line*, never *won*), founded factions on the roster (`withFoundedFactions`, `FactionPill founded`), 🚻 badges (`RosterRow.badges`) on the rail / Roster / Stage / Inspector, never on a chat line, the Judging card for O4 (`autoJudgeCopy`, *🤖 queued for X* / *🤖 asking X…* on a pending plain miss too, `judgingQueueOf` / `judgingBadge` *🤖 N queued · 1 out · oldest m:ss*, ⏳ a judge stall), 🚩 held / flagged wallet cards (`walletStepTag`). vitest 531 (66 files). **Wave 20** (on `oct31-w20/integration`): Run → Terminals' **🚪** badge (`lib/terminals.ts` key `door`: *shut* / *open* + the level, red *fault: <code>*, ⚠ *ldr_open*, amber *override* off `night.door_override`, *? (silent)*), the House map card's **💡 row** (`lib/lights-status.ts`: *lights module online · N fixtures*, *pairing … s*, problems), `keys=0` / `door=serial` in *Set up a terminal*, a guarded choice's word block shows its guard; the glance reads the heart's `watch:` lines unchanged. vitest 566. |
| [`core`](./core)       | Native **TypeScript** port of Loom (no WASM, no Prism): parser (incl. authored **`SPACE`/`CHANNEL`** chatroom declarations) + a first-principles social-ecosystem `runtime/sim` + a parser-only **`lsp`** language surface (`@loom/core/lsp` — `Workspace` with completion / hover / definition / documentSymbols / references / diagnostics, the in-process replacement for the wasm `LspWorkspace`) + an SSE/REST **event server** (`pnpm serve`) that hosts a live `Sim` for LAN events, composing its `SimEvent` stream into server-authoritative, channel-routed chat (`server/chat.ts`) with spaces + Slack-style threads (`parentSeq`), **access control** (open / private-invite / faction / group / dm channel membership, journaled `inviteToChannel`/`leaveChannel`, guest↔guest invites) + a **pluggable channel-type registry** (`runtime/sim/channel-types.ts` — per-type post policy / threadability / broadcast routing / slow-mode / ephemeral, e.g. a read-only `announcement` feed), a scoped invite roster (`rosterFor`), history + moderation, and a journaled `say` command so participant-typed chat replays deterministically. Now a **multi-tenant SaaS backend**: BetterAuth author accounts + Postgres (`server/db/`, `server/auth-server.ts`), projects + files CRUD (`server/projects.ts`), event launch/lifecycle (`server/events-api.ts`, one live event per project), and a per-event `EventRuntime` + `EventRegistry` routed under `/e/:eventId` with a `resolve-code` bootstrap — the old single-event root paths still serve a default event. **Show ops** (Oct 31 wave 1): a project's codes are pinned across End → relaunch (launch `rotate: "staff"` mints new performer/mod codes only), join QRs use `LOOM_BASE_URL` (`pickJoinBase`), room check-in by QR (`/api/guest/checkin`, `LOCATION … checkin: false` opts out), single-use re-pair (`/api/mod/guest/pair` → `/api/guest/resume {pair}`) + `/api/mod/prime/release`, **Web Push** (`server/push.ts`, `/api/push/{config,subscribe,unsubscribe,visible}`, `LOOM_VAPID_*`), env-tunable door-rush throttles (`server/rate-limit.ts`, `LOOM_RL_*`, a redeem-miss + widget limit per guest), the terminals' lean **screen state** (`/api/screen/state` — screen cues, countdown, character hidden/asleep; the poll is the heartbeat behind `/api/mod/screen/terminals`, TV mute at `/api/mod/screen/voice`), a `?lean=1` mod stream + `ModView` snapshots coalesced to ≤ 2/s, `ModView.cues` (`cueState`, `INTERACTION … sequence: false`), an agent's authored `hold:` line posted after 20 s with no worker online (a director's reply as the agent closes the queued request), place arguments folded onto the declared LOCATION (`server/place-args.ts`), `/api/mod/recap` (ceremony lists, `?format=text`) and `/api/mod/metrics`. **Oct 31 wave 2:** the house map **belongs to the project** (`server/house-maps.ts`: `house.json` + any `house.<variant>.json` are project files, never story text; snapshotted at launch on `event.house_maps` + the state dir's `spatial-maps.json`; the event plays a director's save > the project's active variant > `LOOM_HOUSE`; `/api/mod/spatial/{variants,variant,house/project}` list and switch the tent ⇄ shed variant live and **Save to project**; every map write is validated; `sync-example` pushes maps but keeps a project copy that differs), the screen state carries the latest `do announce` as `announce {seq, text, at}` (N-09), every duck find is timed (pauses excluded) into `spatial-runs.jsonl` → the recap's `duck` board, and `ModView.quests` feeds the Inspector's grants. **Oct 31 wave 4** (9d35a4b): the facts judge `server/facts.ts` (`FactsBook` off the project's `facts.json`, `Night.judge_mode` `auto` \| `review`, `do fact_filed` / `do fact_judged` → `ModView.facts`; the key is snapshotted at launch, `Store.loadFacts/saveFacts` → `project-facts.json`, `/api/mod/load {facts}`, `LOOM_FACTS` the LAN fallback, `scenarioFactsFile` in `examples/load.ts`, `sync-example` always pushes the example's), `pnpm titi:facts [--check]` (`scripts/titi-facts.ts`, the show's generated files), the wallet `server/wallet.ts` (`WalletBook`; header `currency:` + `wallet:` roles in `runtime/sim/model.ts`; `POST /api/guest/wallet/{send,request,respond,offer,accept,decline,cancel,stimulus,approve,deny}` → `{ok, wallet}`, `POST /api/prime/wallet/{approve,deny}` → `{ok, queue}`, `POST /api/mod/wallet/{approve,deny,cancel,stimulus}`; `LOOM_RL_WALLET`), `POST /api/prime/widget {seq, result}` (a character answers its own card), `/api/mod/quest {who}` for a character, `/api/mod/act restrict \| unrestrict` + `/api/mod/set restricted` (the `restrict` / `unrestrict` / `pin` / `unpin` statements), `/api/mod/signal label` (a mod-token device names itself), and `EventRuntime.tickOnce(ms)` (the ticker body, public for tests). **Oct 31 wave 5** (85d2bad): the wallet resolves an offer's entry by title (a buy never checks what the seller holds), held transfers approve themselves after 5 min (`HOLD_MS`, `POST /api/mod/wallet/approve-held`), a restricted guest's wallet answers 403, and the minter's **grant + freeze** (`wallet: minter, … grants N, freeze <dur>`; `POST /api/guest/wallet/{grant,freeze}`, `POST /api/mod/wallet/{grant,freeze,unfreeze}`); INTERACTION `restricted: allow`; `sum` / `max` / `len` builtins; commas inside quoted `with` values; lint `L1203` / `L1204` (currency / wallet lines); a `!!` pin is a takeover (`ChatMessage.takeover`); `/api/mod/spatial/begin` fires `reinstallation begun`; push payloads carry `url: /?room=…`; K-31b behind `LOOM_HOMESCREEN` (`POST /api/guest/homescreen`, a per-guest `/manifest.webmanifest?code=&pair=`) + `POST /api/prime/logout`; `LOOM_SNAPSHOT_MS` coalesces guest + booth snapshots (off by default); `flushClock()` on SIGTERM / SIGINT; `stale` covers maps + `facts.json`; the recap's shares / chess / bathroom lists; `/api/mod/codes` carries `cast` + `stacks`; `/api/screen/state` gains the chart's `top` / `bottom` / `revealAt`, `identify` (`POST /api/mod/screen/identify`), `announces` + `announceEpoch`; `GET /api/state?role=mod&cues=1` (the lean cue sheet). **Wave 7** (2026-10-17): `GET /api/screen/state?room=<LOCATION>` → `room: {id, open}` (open = not hidden or revealed to everyone; the TV mute is the TV's only), `EventRuntime.declaredCharacters` (the story's cast compiled once per text, so a mod code's `resolve-code` and the null-sim mod view list it before the doors; `modView` takes an optional fifth `declared`), `titi:facts` generates the server-room door code (`facts.json` `door` → `Kernel.door_code` + the secret *The Door Code* + the keypad sign) and `core/src/facts.ts` checks it, the recap's "Chess against the King". **Wave 9** (ae79117): `server/boot.ts` + `GET /api/health` (503 `database` / `starting` / `config` / `events`; an unknown event or code answers 503 `starting` until the boot settles; `LOOM_DB_WAIT`), director consoles on keyed patches (`?delta=1`, `server/mod-patch.ts`), big SSE frames paced in 64 KiB slices, the agent hub's head-only 2-minute clock + the paused-act refusal (D10), `/api/guest/say` 413 over 2,000 characters and 404 `no such room` for a missing or hidden room, the guest invite `invite:` policy, joins only to declared / joinable / revealed sides (`routes/sides.ts`), the guest code through an IP lockout, `LOOM_RL_QR`, display-name and `closedBy` wallet cards, a `_`-leaf write is cue-sheet bookkeeping, `CollabHub.resyncFromStorage` + `POST /api/mod/resync`, spatial `restricted` / `captured`, the sync guard (`scripts/live-guard.ts`, exit 3). vitest-tested (1515 after wave 9, incl. the Postgres-gated suite). **Wave 10 (the Director page, built on branch `oct31-w10/director-core`, merged as 3eac8de):** INTERACTION `act:` (`InteractionSummary.act`, admin cues only), the repeatable header keys `watch:` / `countdown:` (`Header.lines`, `runtime/sim/board.ts`, `SimModel.watch` / `countdowns` → `ModView.watch` / `countdowns` via `boardFor`; a `secret: true` CHARACTER head masked, a ROLE head counted over guests; lint `L1205`), `ChannelSummary.staff` (`staffRoomIds`), and in `src/cue-sheet.ts` `cueActs` / `focusActIndex` / `previousActIndex` / `onDeck` / `cueTitleTags` / `countdownLeft` + the shared arm model (`tapCue`, `ARM_MS` 4 s, `ARM_DEAD_MS` 300 ms, `armStillValid`); the lean view gains `clock` / `countdowns` / ≤ 3 non-secret global watch values (`scope === "global"` only: never a ROLE count, a person row or a CHARACTER value; `CueSheetView.paused` rides the phone branch, `CastSummary.secret` the editor branch — both additive). `CueState` gains `presses` / `pressed` (a per-log `pressLog`, rebuilt on replay); `/api/mod/signal` refuses a cue-sheet press (one carrying `presses`) with 409 `moved` (`pressMovedArm`) or 409 `doorsClosed` (the `start:` beat unplayed; `Meta.opened` survives a restart) and its 200 carries `presses`. The journal's format and the bank are untouched. **Wave 11** (merged on `oct31-w11/integration`): **the shared King** — `SpatialHub` reads his hp off the king prop's `health` path (`Night.king_hp`; missing = max), `POST /api/spatial/king/hit` (session token) judges reach off the session's last pose with `@loom/house` `kingReach` plus slack (+0.35 m, +25°), then journals the set `hp − 1` and fires `king hit` (args `hp` / `max`) and at 0 `king fallen`, `by` the device; 409 `already hit` / `not near` / `fallen` / `doors are closed`, 404 `no king`; one hit per guest per reinstallation **visit**, which ends when its duck is found (Leave + re-scan, a director's end or a timeout is the same visit; `kingSpent` lives in memory, a story reset or a restart forgets it); `POST /api/mod/spatial/king {hp}`; `hello.king` + a `king` frame only on change; `/api/screen/state` → `king {hp, max, fallen, armed}`; a remap with the King down judges standing room past him (`withFallenKings`). **Ghost pictures:** `PlayerState` / `Assignment` / `SpatialCandidate.avatar` = the `AvatarBook` key, resolved live, plus an `avatar` frame when a picture changes. **Reserved programs** (`server/routes/claims.ts`): `CHARACTER … reserved: true` → `CharDef.reserved`; `/api/identities` + search rows carry `reserved`, `guest/register {claim}` answers 409 `reserved` without the claim (its `wiki:` article is held too); the claim is an HMAC keyed by `event.claim_secret` (a new column; carried at launch) / `claim-secret.json`, so End → relaunch keeps every invitation; `/api/mod/codes` → `claims[{character, claim, url}]`; `POST /api/mod/claim/unlock {character, minutes?}` (2 by default, ≤ 60, 0 shuts; memory only) → `CastSummary.unlockedUntil`. `lastSeen` on the roster rows, `POST /api/mod/guest/gone {id, gone}` (journaled `<id>.gone`), a Run persona's `<id>.persona = true` set before its join hooks. `countdown: … , for guests` → `GuestView.countdowns` (lint L1205 refuses the flag on a `watch:`). INTERACTION `arm: true` → `InteractionSummary.arm`. **`by:` is enforced** on `/api/prime/act` (403 *not your button: … is for …*; views flag `only: true` and a booth never offers another character's). **Near-miss judging** (`src/answer-match.ts` `nearMatch`: honorifics dropped, number words, plurals, word order, spelling word by word — 1–3 letters exact, 4–7 one edit, 8+ two, first letter kept — numbers and am/pm exact): in `auto` a near miss waits on the Judging card (`near: {key}`) with a ⚠ line in `# hosts`, proposed accurate, so it is credited at the settle if nobody judges it. The agent hub's **`busy:`** line (`CharDef.busy`; once per thread, only to a request that waited 40 s behind another on an online worker) and **single-worker stall detection** (a head unanswered 60 s: one ⏳ `# hosts` line, the hold line once per waiting thread, no new dispatch until the worker's next answer or a reconnect; `CastSummary.agentQueue {depth, oldestMs, stalled}`). `CodexEntryView.secret` + `Sim.agentRefusal` (a secret file to an agent-voiced character → 403 *they won't take a secret file*). `titi:facts` generates `facts.json` `door.clues` (four secret digit notes, the silver print stack, their codes in `secrets.never`) and the new keypad sign. The final fix pass: `Assignment.kingHit`; a checkmate by a program who already holds the code is taken and tells them so; four digit notes after 📄 or an ending fail *The Cold Door*; `door_digits` + `quest.the_cold_door` are ROLE Program `secret:` slots; the judge spells out abbreviations before its exact look (`spellOut`: Mr. / Mrs. / Dr., yrs, ext, hr(s), min(s), sec(s), `0900`) and a right answer said at length (the key's words in order + up to 4 more) is a near miss unless an extra word turns it around, hedges, adds an am/pm or is a lone letter; a pool program typed in another case registers under the story's spelling (`canonicalGuestName`); the patch-bay `radio_*` are `by:` the four room Antivirus, never Windows Defender. vitest 1780 (95 files, incl. Postgres). **Wave 11b:** header **`judge: <Character>`** → `SimModel.judge` (`judgeOf`: a `mind: external` CHARACTER's id, else null; lint **L1206** `JudgeUnresolved`); `AgentHub.judge()` sends a **`judge`** frame `{id, character, filing, question, key: {answer, aliases}, answer, confidence}` to an online, unstalled worker voicing it (never queued or thread-bound; `judging`, `judgeSettle`, `cancelJudge`; dropped after `AGENT_JUDGE_TIMEOUT_MS` 60 s, a pause excluded, on a worker leaving or a restart); in `auto` a near miss is asked at filing when `rulerOnline()` (the ⚠ line ends *… asked Trabolta to rule*); `POST /api/agent/judge {id, worker, same, why}` (mod-gated; 400 / 410; `why` ≤ 200) → same accurate, not lie at 100 else uncertain, through the book's confirm signal `by: agent:<Character>` with `ruling` / `ruling_why` args (`rulingOfArgs`, rebuilt on replay) + `rulingNotice` in `# hosts`; a director's verdict or a refiling cancels it (`dropMootRulings`); a near miss filed with nobody to ask is never asked later (`rulingsDue`: only a restore's pending ones); `FactsFiling.ruling {by, same, why, at}` / `asking`, `FactsView.judge`, `AgentThought` kind `judge`. `reservedDefFor` also holds a reserved name without its first word (*Excel*). The show: `judge: Trabolta`, the moved `door.code`. vitest 1800 (98 files, incl. Postgres). **Wave 12** (Trabolta's mind rebuilt, on `oct31-w12/integration`): `server/agent-recent.ts` — every thread line the story posted rides an agent request as `story: true`, and `recent` (≤ 6 items from the last 10 story-minutes: a gift, his last 2 house-wide lines, the speaker's filings as question ids, the mark, their Trust Chart rank) + `storyAt` are rebuilt on every request (no store; a hunt-answer or secret entry, a line naming an answer form or a secret character's current value never rides it); the guest's `them.codex` is titles only; `LOOM_AGENT_RECENT=off` sends the wave 11b request field for field (compose passes it). The stream hello's `traceAfter`, `/api/agent/facts` `paused`, the `rewrite` control, thought kinds `brief` / `summary` + `prompt_ms`, and the mind report's `mode` / `phase` / `briefBy` + per-person `memos` / `firstMet` / `gifts` / `filings` / `marked` / `chart` / `storyTrust`. The answers follow-up (`trabolta/answers`): every hunt-answer entry is `secret: true`, `mentionsKey` (`src/answer-match.ts`) + `test/trabolta-answers.test.ts` scan his requests, facts and prompts, `the_line_works` is gone (the house judges the pickup line; `titi:facts` adds it to `secrets.never`). vitest 1847 (100 files, incl. Postgres). **Wave 13** (the Play app UX overhaul, on `oct31-w13/integration`, not yet on master): **`OBJECTIVE`** (`for:` a reserved word `guests` / `performers` / `everyone` → ROLE → CHARACTER → GROUP; `while:`, `act:`, `title:`, `text:` with `- label[, done when <cond>]` to-dos, `buttons:` + the app's `pass` / `scan`, `loud:`; `model.objectives`, display only, never journaled or sent to agents) → `GuestView` / `PrimeView.objectives`; CHARACTER **`admin: true`** = the **host** capability (`Session.host`, granted by `/api/prime/login` of that part, re-derived on every story load, dropped by Release / Logout / Go live; the allowlist in `server/routes/host.ts`, every other mod route 403 *not from a booth*; journaled `Booth · <Character>`), `crawl: fx`, header **`alerts:`** (default `Night.alerts`; `src/delivery.ts`: `ALERT_LEVELS` balloon / sticky / dialog / bsod, `EFFECT_MANNERS`, `splitNotice` / `noticeKey`), the **`~`** per-person notice, CODEX **`category:`**, `show … with moment: major\|minor`; `ChatMessage.manner` / `fx` / `ambient` / `notice` / `readout` / `about` / `moment` / `phase`; a `reply` to a character moves to its `dm:` Inbox (`@<C>`); `CHANNEL system log` deleted (one post, one push per broadcast); **`GET /api/state?role=mod&host=1`** (`hostView`, coalesced to one build per 2 s), **`POST /api/prime/card`** (`GuestCardView`), `/api/scan` + `/api/prime/act` carry `card` / `replies` / `staff` / `said`; `/api/mod/start` + `/api/mod/stop` on the host allowlist; `PrimeView.paused` / `host` / per-guest `flags` (ROLE `watch:` items; snapshots carry on flags + failed gates, the card the full list; a per-ROLE `flagPlan`); `CueState.lastName` (who pressed LAST); `src/host-board.ts` (`@loom/core/host-board`: `hostNeeds`, the judging / wallet / parts / unseen / award helpers, `awardOnly`, `GATE_FLAG`) and `src/identity-kind.ts`; a lookalike of a taken guest name refused (`cleanGuestName`), `MAX_CODE_LENGTH` 64, a repeat scan within 1.5 s answers 429 `again`; hashed `/assets/*` immutable (`server/static-cache.ts`); lints L1205 (a ROLE `secret:` slot on a watch item) and L1207–L1212. vitest 2098 (116 files, incl. Postgres). **Wave 17** (not shipped): `/api/screen/state` gains **`moments`** (`MOMENT_RING` 12, live only, `{seq, at, kind: beat \| signal \| sfx \| reveal \| found, name, who}`: subject-free beats, admin cues the story took (`signalRefusedAt` in `views.ts`), `do pick` draws, device signals (King, chess, `reinstallation begun`), house-wide reveals and the duck's find (`golden duck` / `golden duck kept`); never a guest or booth press except `BOTTLE_VERDICTS` on the bottle's pick within 5 min, never a checkmate, an admin cue whose rule sets a secret character's var, or a name touching the Kernel or a secret character) and **`night`** (`ScreenNight`: allowlisted public `Night.*`, the award winner only under an `award_*` slide); the heartbeat `terminals` list left the answer (it stays on `/api/mod/screen/terminals`, which gains `fullscreen` off `fs=1\|0`); before the doors a terminal naming a character gets `attract`. `sound X in <Place>` / `with rooms:` lower to `sfx` `rooms` args (`lowerSoundArgs`, `roomsWords`), directive events carry `setting`, lint **L1213** `SoundRoomUnresolved`. **`audio.json`** (`server/audio.ts`): a director's save (`audio-save.json`) > the project snapshot (on the `house_maps` record, no migration) > `LOOM_AUDIO` > a default 16 / 16; `GET /api/mod/audio` → `{audio, version, source, sounds, locations, tests, problems, warnings}` (a long poll with `?after=&tests=&wait=`; `router=1` marks the router's), `POST /api/mod/audio {audio, base?}` (400 `problems`, 409 stale), `POST /api/mod/audio/project`, `POST /api/mod/audio/test {speaker} \| {out}` (the last 8, ≤ 60 s, memory only); `/api/mod/load {audio}`; `sync-example --keep-audio \| --replace-audio` (independent of the map switches); the starter `examples/trapped-in-the-internet/audio.json` (DRAFT). vitest 2201 (132 files, incl. Postgres). **Wave 18** (the Play app plays like a game, on `oct31-w18/integration`, not yet on master): **big moments** — `reply !!…` / `broadcast "!!…"` (`MomentClass` `big`, `splitAlert` learns `!!`; `pin "!!…"` stays the takeover), `show … with moment: big`, `with close: 6s` → `ChatMessage.autoClose` (a house big only); **exits** — `with go: <word>[, go: …][ as "Label"]` after a quoted `reply` / `broadcast … to …` / `pin` / `show` (`src/go.ts`, `GO_WORDS`; a LOCATION / CHANNEL / CHARACTER / guest INTERACTION / `codex[: Entry]` / `quests` / `quest: Q` / `pass` `scan` `chats` `mission` `notifications` `sides` `wallet` `me`; never `lobby`) → `ChatMessage.go: GoTarget[]`, trimmed per viewer (`goForViewer`), with defaults (a card's thread, a codex entry, a quest, the Wallet); readouts carry `aboutName` / `aboutAvatar`; OBJECTIVE **`go:`** (→ `GuestView.mission {objective, place}`), **`target:`** / **`pick:`** (booth objectives: `ObjectiveView.target` / `pick`, ≤ 60, `Sim.valueOf`), **`evergreen:`**; header **`wanted: <role>.<flag> [as …] [by <claim>], for …`** (`PrimeView.wanted` / `HostView.wanted`, `server/wanted.ts` `StoryMarks` = `markedAt` rebuilt on replay, captured posters 60 s), **`reinstall: <cond>`** (`eligibleFor`; candidates `marked` / `favour` + `ended`; runs after `Night.ended` journaled `after: true`, off the duck board), **`archive: X when <cond>`** (`GuestView.archived`), **`majority:`**; **callers** — `by:` on a `who: admin` cue (`cueCallers`, `Session.caller`, `PrimeView.calls`, `POST /api/prime/cue`, journaled `Booth · <part>`); the **caller claim** `POST /api/mod/caller {on, label?}` → `cues.caller` (memory only; on every cue-sheet view); global booth presses (`/api/prime/act {name}` with no guest, `PrimeView.globalButtons`); the host view's NEXT + 3 descriptions and `cues.then`; `/api/mod/signal` 200 `said` / `staff`; `Night.judge_mode` on the host var allowlist; **crews** (`src/runtime/sim/crews.ts`: one journaled `crew` op — found / invite / answer / leave / recruit / leaveSide / rename / dissolve; `/api/guest/crew/{found,invite,leave}`, `/api/guest/recruit{,/answer}`, `/api/guest/side/leave`, `/api/mod/crew/{rename,dissolve}` (host allowlist); `GuestView.crew` / `invites` / `sides`, `PersonCard.groups`, `ModView.crews`; rooms `crew:<id>`; events `founded`, `join` (crew), `recruited` (`by` = the recruiter), `unaligned`; names moderated, never checked against secrets (an oracle); masked from agents); `/api/screen/state` `moments` carries a house `!!` broadcast as `kind: "big"`; the casino refuses a captured program; lints **L1214** `GoTargetUnresolved`, **L1215** `ObjectivePickNotForBooths`, **L1216** `HeaderLineInvalid`, **L1217** `CallerNotAPart`, **L1218** `BigHouseBroadcast` (`src/lsp/w18-lints.ts`). vitest 2304 (139 files, no Postgres). **Wave 19** (the voice link, on `oct31-w19/integration`, not yet on master): `server/spatial-voice.ts` `VoiceRelay` (transport-free, memory only, never journaled) behind `POST /api/spatial/voice?seq=[&spot=]` (raw μ-law, 160–8000 bytes under its own cap before the 2 KB spatial parse; a game's session token, or a mod token + `spot`; 401 / 410 / 403 `moderators only` / 400 / 413 / 404 `no such spot` / 403 `voice is off at this terminal`; 200 `{ok, listening, ears, dropped?}`) and `GET /api/spatial/voice/stream?token=[&spot=][&mic=0|1&hear=0|1]` (SSE `hello {…, listen, ears}` / `listen {on, ears}` / `voice {from, kind, spot?, session?, name?, gain, seq, data}` / `bye {from}`, `:ping` 15 s; a reader 64 KB behind skips `voice` frames and that is its stall cap too; the newest stream wins: one per player session, `VOICE_STREAMS_PER_SPOT` 2); `route()` on every spatial flush applies `@loom/house`'s rule with each stream's current sources as `keep` and only the terminals whose stream's mic can be heard as a player's candidates; closed on a session's end, a story reset, `dispose()`; the heartbeat's `mic=live|muted|denied|insecure|locked|off` (`MIC_STATES`) → `/api/mod/screen/terminals`. vitest 2328 (142 files, incl. Postgres). **Wave 18b** (Stage A — `oct31-w18/{engine,server}` — shipped as `w18b-1021`; the show's Stage B on `oct31-w18/integ`, not shipped): `reveal X [quietly] [for who]` (`splitRevealQuietly`: no 📂 notice, no screen moment); `<id>.codex_in.<category>` per CODEX `category:` (`codexCategorySlug`; a ROLE secret slot, never in an agent request); `names(list)` (*A, B and C*, `joinNames`); header **`badge: <path> as <glyph> <label>`** (`badges.ts` `parseBadgeLine` / `badgesOf` → `badges` on `PersonCard`, the viewer's `GuestView`, `PrimeGuest`, `RosterRow`, `HostPerson`; lint **L1219** `BadgeOnSecret`, a `while` reading a secret refused too); **`lobby: hidden`** (`GuestView.lobby`; routing kept, a guest's `say` into it 404 `no such room`; booths and Run keep it); **`founding: <cond>` = faction mode** (`crews.ts`: one race over the declared joinable sides + the founded crews, one at a time, `joinCrew`, a founder's leave disbands, `mayFound`, an invitation's yes held to the walk-in rules; `majority_faction()` / `faction_of` / `faction_name` / `faction_founder`; `SideView.kind` / `ethos` / `founder` / `more` with counts on your own row only; `GuestView.canFound` / `leads`; `ModView.race`; `POST /api/guest/crew/join` (`JOINS_PER_MINUTE` 6), founder / leader refusals (`staysWithSide`), crew notices drafted after every commit (`draftCrewNotices`); race sides masked from agent requests and `/api/agent/facts` (`agentHiddenRace`); lint **L1220** `FoundingInvalid`); approver `as <name>` / `audit "<phrase>"` (`walletRoleOf`) → wallet step **`flagged`** for the recipient (`WalletCard.audit`, a minor moment); `avatar: picture:<file> \| … when <cond>` (`CharDef.avatarRules`; `picture:` served off `play/dist/pictures/`, `LOCAL_PICTURE_FILE`; `syncConditionalAvatars`); scan answers (redeem `title` / `already` / `missed`, check-in `room` / `replies`); the spatial gate `mayPlay` (a parked claim, a walk after an unmark and `found()` end as `leave unmarked`; a `force: true` session is exempt); **results on the screens** (`do fact_read <ids>` / `do fact_truth <id> <status>` → `ScreenState.results` via `screenResultsOf`: counts, rows `[who, said, sure, out, ruled]` on the TV only (≤ `MAX_RESULT_ROWS` 40), never the final round in a reading, and at ⚖ the key answers + the liars' names, TV only, for `RESULTS_VERDICT_MS` 120 s; the night's `most_trusted` / `least_trusted` / `facts_accepted` / `first_reinstall` only under their slides; `buildRecent` drops every line of the reading beats, `READING_BEATS`); **every non-exact filing goes to the `judge:` character** (O4: `isExact` accepted at once; the hub's FIFO queue, `AGENT_JUDGE_INFLIGHT` 1 frame out per worker, voice replies first (`pumpJudges`), the 60 s expiry from dispatch, `AGENT_JUDGE_STALL_EXPIRIES` 2 → *⚖ {judge} isn't ruling…* (`judgeStallNotice`), a dropped worker's frame requeued, the settle's fallback; the frame's `near`; `missNotice`; `FactsFiling.queued` / `before`; `AgentQueue.judging`); `POST /api/mod/audio/stop {announce?}` (on the host allowlist; the GET's `stops` / `now`), `POST /api/mod/audio/announce {spot, on, base}` (integ; `audio-announce.json`, `announceSaved`), `spot: {announce}` on the screen state + the heartbeat's `ann=`; the bank warns `liveHeadersIgnored`. **The show (Stage B):** Truth or Dare after 📋×3, Trabolta reads every result (Question Results, Round Two Tally off `said_4`–`6`, The Verdict's `Kernel.t1`–`t8` + a 34 s story-time hold before the ending), Telephone / the piñata / Back To The Heart gone, clearance quiet, *Jean Trabolta, Sole Owner and Founder of Maps and Ducks*, his picture breaking (`Trabolta.broken`), founded factions from the Truther Download (🧾 deleted, 🗳 `force_their_majority`, the quest *A Faction Of Your Own*), the typed left-behind (`left_behind_text`), the hidden lobby, 🚻, MyCRA, Facts Are Currency by category, the 16 ties (`codex/85-ties.loom`, category Connections) + The DSL Line dealt by Program Briefing, The Night In Review before every ceremony + a private Your File (`beats/review.loom`); the `test/fixtures/w18b-mini` story; `test/w18b-integ.test.ts`. vitest 2472 (149 files, incl. Postgres). **Wave 20** (Trabolta's heart, on `oct31-w20/integration`, not shipped): **guarded choices** `+ (if <cond>) ⟦TAG⟧ text` (`Choice.guard`, split off before the hidden-text `[…]`; a false or failing guard drops the option, a menu left empty is skipped; lint **L1221** `ChoiceGuardInvalid`; `edit.ts` + the story graph keep the guard; the bank's `choiceGuardIgnored`); **menu ids** (`PendingChoice.id` = its `choicePrompted` log index, `beat`; `GuestView.choices [{id, beat, channel, options}]`, optional; `POST /api/guest/choose {index, text?, choice?}` → 409 `no choice` / `moved`, `/api/mod/choose` the same through `chooseFor`; the journaled `choose` carries `choice` + the menu's beat + the option's text, so a replay over edited text finds the menu); **room cues** (`cue room_<x>` in a beat set in a LOCATION → `ScreenRoom.cue {value, seq, at}`, that room's terminal only, never a moment); `ScreenNight.server_door` / `heart_stage` / `heart_look` / `alarm_on` / `door_override`; the heartbeat's `door` / `dlv` / `dft` / `dwn` → `ScreenDevice.door*` on `/api/mod/screen/terminals`; quiet door signals + `QUIET_MOMENT_BEATS` (Heart Nag / Door Again / Door Shut / Sealed); **`lights.json`** (`server/lights.ts` `LightsHub`: a director's save > the project's (on the `house_maps` record) > `LOOM_LIGHTS` > default; `GET \| POST /api/mod/lights` (a long poll on `after` / `tests` / `pairs` / `devicesAt`, `module=1` presence, `now`), `/project`, `/test`, `/devices`, `/pair`, none on the host allowlist; `/api/mod/load {lights}`; `sync-example --keep-lights \| --replace-lights`); **the agent dossier** (`server/agent-dossier.ts`: `AgentRequest.dossier` only for a guest `at_the_heart`, ≈ 3 KB, `recent`'s leak checks, never a secret / answer / code / `via` / `by` / account; `LOOM_AGENT_DOSSIER=off`); `/api/mod/signal` answers `refused` only for a declared INTERACTION. The show: the Heart sequence (`beats/server-room.loom`, the four layers, `main.loom`'s door rules and watchers, `lights.json`, `stand_down` deleted; `test/trapped-heart.test.ts`). vitest 2623 (159 files, incl. Postgres). |
| [`play`](./play)       | The **participant React app** (Vite, name `loom-play`) guests + performers use at a live event — a **two-pane MSN/Discord-style chat** (rooms sidebar + open room on wide screens, drill-in on phones; `theme: aol97` skins it as a 1997 chat room) with **presence** (the room you stand in first, who is in every place, a who's-here strip per room), Discord-style **spaces** (sidebar sections, incl. authored `SPACE`s), Slack-style **message threads** + avatar/name sender-run grouping, **hybrid typed chat** (a composer wired to `/api/*/say`), **cards** (`show captcha / image / poll` render from the `widgets.tsx` registry; answers fire `<kind> answered`), and **access-controlled rooms** (open/private/faction/group/dm with invite + leave) layered over the story-injected lobby + faction + DM channels (decisions docked per-thread, re-login history) on the `core` server's SSE/REST. Performers pick their character from the cast at sign-in and act on a guest through their **card**, never a panel under every room; the booth scanner reads passes with `BarcodeDetector`, else `jsQR` (iPhone Safari). `!` **alerts** chime + vibrate + banner in guest and booth sessions and the newest unseen one banners on wake (`alerts.ts`); a 🔔 **Get alerts** card subscribes Android phones + booths to Web Push (push-only `public/sw.js`, `push.ts`); **☰ → Keep my screen on** (`wake-lock.ts`); `?checkin=<slug>` checks into a room (`checkin.ts`) and `?pair=<code>` re-pairs a lost guest (`resume.ts`, asks before switching a signed-in phone). **Oct 31 wave 4** (9d35a4b): a pinned **Wallet** room (`wallet.tsx`: `BalancePill` in the header, `WalletActionsProvider`, send / request / offer sheets, the approver's Approve / Deny in the booth), tour steps `wallet` + `bathroom` (`show tutorial … with bathroom:`), sticky notices (`pins.ts` `activePins` → `PinnedRail` above the stream, a `!` pin alerts), **restricted mode** (`GuestView.restricted`: ⛔ header, no buttons, only the named rooms + DMs), the 📝 fact card's 1–100 confidence slider + the 💬 `answer` card, and the booth's pinned Quest Log / Codex / Inbox / Wallet rooms with `POST /api/prime/widget`. Multi-event aware: a short code resolves via `/api/resolve-code` to its event, then every call is scoped to `/e/:eventId`. `pnpm dev` (:5174, proxies to the server on :7000) / `pnpm build` (served by the event server at `/`) / `test` (261 after wave 9: guest + booth streams reopen after a 502 behind a probe (`openChatFeed`, the dot reads *reconnecting…*), the pass QR drawn in the browser (`pass-qr.tsx`), the composer capped at 2,000 characters, request cards that say who stopped the payment). **Oct 31 wave 5** (85d2bad): `!!` takeover pins (`takeover.tsx`: full screen, black ⇄ yellow ≤ 2 Hz, still under Reduce Motion), notification taps open the right room (`room.ts`, `?room=`), the iPhone 🔔 card's Home Screen path (K-31b, behind the server's switch) or *keep it open*, Runescape's 🎁 Grant / 🧊 Freeze sheets + the 🧊 frozen pill, live wallet countdowns (`useWalletClock`), the restricted wallet, sales by entry id, and the **director's phone cue sheet** (`director.tsx`, `/?role=director`: mod passcode + a name, tap to arm, tap again to fire). **Wave 10 (built on branch `oct31-w10/director-phone`, merged as 3eac8de):** the director phone groups the cues by act (past and future acts fold, the previous act's fallbacks as `from E`, Anytime last) under a pinned NEXT bar (the soonest countdown when there is nothing to press) and a strip (act · phase · countdown · up to 3 watch values · *⏸ clock stopped*), arms through core's arm model (a fast double tap only arms; a stale arm says *Cues moved — tap again*), warns out of turn and sends one press at a time; an old server's view is the flat list. **Wave 11** (c7facac): a guest **📷 Scan** in the header and the Codex composer (`guest-scan.tsx`: `unlock=` redeems, `checkin=` checks in, read in this session, never a new tab) and the **wrong-browser landing** (`LinkLanding`: a `?unlock=` / `?checkin=` link opened with no session shows the code in big type or the sign's room, never the picker; a session just cut shows its notice + *Join again →*); the guest **countdown strip** under the room header (`countdown.tsx`, `GuestView.countdowns`, ⏸ while paused, re-based on every snapshot); **reserved programs** (`claim.ts`: `?claim=` rides the join and the directory search, 🔒 Reserved tiles, the 409 *This program is saved for an invited guest — ask a host.*, the claim kept in `loom.guest.claim` per event code, a 🔒 tile re-asked every 12 s so a director's 🔓 reaches it); the fact card's confidence slider starts **unset** (touch or a value key sets it, never tabbing); `arm: true` story buttons **arm then fire** (`arm.ts`, core's `tapCue`) on a booth's guest card and the guest's *Things you can do*; a booth's More… leaves out another character's `by:` button. The Codex *Share…* never offers an agent-voiced character a secret entry or one about someone or somewhere else (`shareTargets`, the server's `agentRefusal`). vitest 321 (34 files). **Wave 13** (the Play app UX overhaul, on `oct31-w13/integration`, not yet on master): split into lane modules (`guest/`, `booth/`, `host/`, `chrome/`, `stream/`, `moments/`, `rooms/`, `session/`, `ui/`, per-lane CSS in `css/`); every screen is a frame: the **NOW title bar** (`chrome/title-bar.tsx`: the first live objective, tap → its card) and the **Win95 taskbar** (`chrome/taskbar.tsx`: ⊞ Start — the story's guest buttons, People, Help, picture, Keep my screen on, Get alerts, switching sides, Leave behind a confirm; **🎟 Pass** full screen with a held wake lock; **📷 Scan** with a typed-code box; the tray: `CountdownTray`, the balance, `MissedTray`, the live dot), the countdown strip and the ☰ sheet gone; fixed room tiers + *Other rooms (n)* (`rooms/order.ts`); the arrival-decided crawl (`crawl.ts`: none / fast / fx, 0.7 s a line, a 1.5 s batch, tap to finish), the card tray + settled cards, the *Around the house* ticker, folded `~` notices, badges for you only, the categorised folded Codex and Quest Log (`stream/`); the **moments** layer (`moments/`: balloon / sticky / dialog / bsod off `alertLevel`, minor one rung lower, a booth capped at sticky, the glitch on a level change, holds, missed + the wake replay, *Take me there*); the **booth** (`booth/`: the pinned NOW card with ticks, a big 📷 Scan → the guest card — facts, ≤ 3 face buttons, replies / said / staff, *All buttons…* — 📷 Next guest, Readouts, Messages, 🗂 Guests, staff rooms pinned); the **host dock** (`host/`: the NEXT bar ARM → FIRE + the Cues · Needs · Judge · People · More console over `?host=1`); a guest-only first load (240 → 139 kB gzip; booth, host and director load lazily). vitest 809 (90 files). **Wave 18** (the Play app plays like a game, on `oct31-w18/integration`, not yet on master): a guest's home is **Mission** (`guest/mission.tsx` + `mission-model.ts`: the NOW card with its Where row off `GuestView.mission`, the countdown, the checklist + a block progress bar, ≤ 3 big buttons, *Your move*, the Wallet / Quest Log / Codex desktop tiles, *Also now*, FREE ROAM); the title bar reads *▣ MISSION* there (your picture → **Me**, `guest/me.tsx`; the Recycle Bin → Notifications); the taskbar is `⊞ · Mission · Chats · Pass · Scan`; **Chats** (`rooms/chats.ts` `chatSections`: Your move · Where you are · Messages · Rooms · Other rooms with the lobby last as the **📜 Chat log**; one dot kind, `guestDotOf`; archived threads); navigation (`guest/nav.ts` `planGo`, `?room=` / `?go=` links, a `BackStack` when the app owns the page); the **moments** engine (`moments/`: the **big** rung `big.tsx` (the Setup Wizard, 1.2 s dead time, cards inside, `autoClose`, acked keys per sign-in, a 15-minute replay), exits on every rung (`exits.ts` `exitsOf`, never the lobby), hygiene (priority, one house banner, phase retire, the first bsod's boilerplate only), the **Recycle Bin** (`notifications.tsx`, `delete-gags.ts`), the booth **pop-out** rung (`popout.tsx`), `registerWidget`, `playTone`); **sides** (`sides/`: the `sides` doors widget, the Sides sheet, recruit by pass, the `invite` card, found a crew); the five-step tour; the **booth** (`booth/`: the 🚨 WANTED pop-outs + the **Wanted board** + the tray's LED, the **confrontation** screen (`confront.tsx`), the door queue (`door.tsx`), **PLAYER SELECT** and rows (`pick/`), the bottle's target pop-out, Clippy's **🎤 cue bar** (`cue-bar.tsx`, `POST /api/prime/cue`), 🗂 Guests tabs, the 🔔 Waiting window, *Chats* + the Chat log); the **host** dock (`host/caller.ts`, `fire-anyway.tsx`: *Who's calling*, 📣 I'll call, *Fire anyway?*, NEXT's description + *then:*, LAST's *did:*, the watch values, the Judging switch, the 🚨 escorts row, More in Night / House / Setup with Crews); the QR encoder lazy and a 145 kB first-load gate (`scripts/first-load.mjs`, `pnpm --filter loom-play size`; 143.87 kB). vitest 1212 (127 files). **Wave 18b** (on `oct31-w18/integ`, not shipped): the **scan dialog** (`scan-done.tsx`, lazy: *🔓 Code accepted* → the Codex on the entry, *📓 Already yours*, *📍 Checked in* → the room; a miss or a refusal keeps the scanner open with the reason), the fact card's **required confidence** (`widgets-fact.tsx`, lazy: File it stays tappable, a red hint and focus on what is missing), 🚻 `NameBadges` on People / Who's here / Chats / the pickers / the booth (`booth/badges.tsx`) / the host's People, never on a bubble, the 🚩 flagged transfer on both phones, `lobby: hidden` (no Chat log row, a lobby target opens Notifications, its lines become quiet Notifications rows, typed chat excepted), 🔇 **Stop all house sounds** (More → House → 🔊 House sound on the host dock, the director phone's ☰; `house-sound.ts`), Trabolta's `public/pictures/trabolta.svg` / `trabolta-broken.svg`, the host Judge tab for O4 (`judgeModeOptions`, `judgeEmptyText`, *🤖 queued / asking*), and **Factions** (`sides/`: one list of the declared sides and the founded factions, counts and *N more to win* on your own card only, Join / Switch / Disband behind a confirm, ＋ Found a faction while `canFound`, the doors' *＋ Start your own faction*, Mission's ◆ tile *a of b · n more to win*, *over the line · hold on to them*, `startSidesOf` / `factionNameOf` on Start, the eager readers in `sides/mode.ts`, `css/factions.css` in `styles.css`). First load 144.85 kB (gate 145). vitest 1315 (136 files). **Wave 20**: a phone pick names its menu (`{index, choice, text}` off `GuestView.choices[0]`), so a tap racing a heart layer picked at the terminal answers 409, never the next menu's option. vitest 1317. |
| [`terminal`](./terminal) | The **wall terminal** (Vite React kiosk app, `loom-terminal`, served by the `core` server at `/terminal/`): tablets mounted around the house that are **direct lines to an agent-voiced character** (Trabolta). A trusted device (set up once with the mod passcode → mod token; provision a fleet via `/terminal/?code=&name=&character=`). It **scans a guest's pass** (camera → `BarcodeDetector` / `jsQR`; typed-name fallback when the camera can't run on plain http) and **pilots** that guest through `/api/mod/impersonate` (`label` = the terminal's name → journaled `by` / feed `via`), showing the guest's own `dm:<Character>` thread off their own stream — the same thread as their phone. A **30 s no-input leash** (`idle.ts`, paused while the character is composing / speaking) ends the session. An **SVG animated face** (`face/`: brows, blinking gaze, mouth driven by the live audio level; moods read off the situation + each spoken sentence) and a **voice** (`speech/`): since 2026-10-15 **the device's own voice by default** — `speechSynthesis` (best voice ranked by `pick-voice`, incl. the modern macOS names), else **Fully Kiosk's JavaScript Interface** (`fully.textToSpeech`, the old Android tablets), else a **silent** engine that reveals the transcript at reading pace while the mouth moves; every engine is time-limited, a `speak()` that never starts writes the voice off only until the next tap, and one `VoiceFloor` lock serialises every queue on the page. The server voice (`engine: server`, `/api/mod/tts` — `core/server/tts.ts`, a cached proxy to an OpenAI-compatible endpoint, Kokoro-FastAPI, `LOOM_TTS_URL`) is **opt-in** and latches to the device voice on a 502/503/504; ⚙ shows what the device can do, ranks its voices and has TEST VOICE / CHIME. Sentence-split, prefetched, transcript revealed as spoken. **House announcements** (N-09, `announce.ts`): a terminal provisioned `&announce=1` (off by default, the TV too) chimes and speaks each new `do announce` from the screen state after the character's line (never a stale, replayed or > 30 s old one; respects the TV mute). A **world view** (`world/`, lazy chunk; config `spot` = a `house.json` terminal id + `view: auto\|world\|face\|mirror\|tv`): the reinstallation players exploring the virtual house through a window placed where this tablet hangs (pure camera `director.ts` — mount / follow / orbit — over `@loom/house/three`, a mini-map, the found celebration); `view=mirror` is the TV spectator; no WebGL2 → behaves as `view=face` (`webgl.ts`). **`view=tv`** (`Tv.tsx`, the house Mac's Chrome on the TV): the face full screen speaking the character's lines in its room (`room`, default The Desktop) in the house Mac's own voice (the server voice if opted in). Every 2 s it polls `GET /api/screen/state` (`screen.ts`; also its heartbeat): **attract** (Mystify screensaver + fake-1999 ads, `Attract.tsx`) while the character is hidden or asleep, and the **screen layer** (`slides.ts` + `ScreenLayer.tsx`: overlay > PNG slide from `public/slides/` > attract > base view, the corner countdown + Y2K clock). Kiosk basics (`kiosk.ts`): Screen Wake Lock, ⚙ only after a 2 s hold. Built for Chrome 87 / Safari 14 (the oldest tablets). Wave 4: `slides.ts`'s trivia slides carry the hunt questions as copy, and `test/slides.test.ts` keeps them in step with the show's `generated/questions.loom`; the `truth_or_dare` slide reads "The bottle is spinning.". **Oct 31 wave 5** (85d2bad): the Trust Chart reveals bottom-up with the most / least trusted banner (`chartReveal`), the poll reports sound / visibility / battery / build (`health.ts`, `__BUILD__`, `LOOM_BUILD` overrides) and shows the name on **identify** (`IdentifyOverlay`), every announcement in a poll is spoken in order, text cards for Trabolta's four `play_on_the_screens` clips (held behind a story slide's hold), and `view=tv` plays `slides/<cue>.mp4` when present (N-04a, inert without the file). `pnpm --filter loom-terminal dev` (:5175) / `build` / `test` (212 tests after wave 9: the world view shows a kept find as GERALD CAN'T HELP, no egg). **Wave 7:** a **room terminal** (`room=` on any view but the TV, `roomOf`): asleep on attract until that LOCATION is open to everyone (`?room=` on the screen state; an unknown room fails closed), then speaks the character's lines in that room (the TV's `planVoice` / `LinePlayer`, the cursor kept at the room's head while asleep so the wake's lines are spoken), no story slides / countdown / Y2K clock but overlays kept, LISTEN while speaking, never muted by the TV mute; a pilot posts `terminal opened` / `terminal closed` (`args: {at: room}`, once, never ahead of the open, `pagehide` with keepalive; `VisitLatch`). The server-room terminal: `/terminal/?code=&name=Server Room&character=Trabolta&spot=server-room&view=face&room=The Server Room`. Kiosk settings: [`docs/trapped/kiosk.md`](./docs/trapped/kiosk.md). **Wave 11** (05b2ea0): **`view=chess`** (`src/chess/`, lazy `ChessTerminal-*.js` on `@loom/chess`) — the **Server Door** terminal outside the server-room door, the only place the King is played: `/terminal/?code=&name=Server Door&spot=server-room-door&view=chess`; awake all night (no screensaver, ignores `room`); attract shows THE KING, his shared bar (`n / 15`, *HE KNEELS* at 0, off the screen state's `king`), the stakes line (*Checkmate him and the server-room door code goes to your Codex.* / *No prize now.*) and the scanner, never the strength ladder; a marked program is refused; one game per scan, dealt at `stageFor(hp, max)` read at the deal (15 grandmaster, 10–14 club, 5–9 beginner, 1–4 dizzy, 0 pawns only); no hints, a two-tap Give up, a 120 s leash; the result posts `chess won \| lost \| drawn` for the guest (`label: "Terminal · <name>"`, retried, kept in `loom.terminal.pending-chess`, re-sent within 60 s of a reboot), and a 200 with `refused: true` (after 📄 or an ending) reads *Checkmate. No prize now.*; a program who already holds the code reads *Checkmate. The door code is in your phone's Codex.* (the story takes the press and tells them *♟ Checkmate again…*) The heart terminal's **📎 GIVE HIM A FILE** panel (`FilePanel.tsx` / `files.ts`): the piloted guest's own codex with **Give** (`/api/guest/codex/share`; a secret file or lore about someone else reads *A SECRET FILE: HE WON'T TAKE IT* / *ABOUT X: HE WON'T TAKE IT*), **TYPE A CODE** and **SCAN A FILE'S QR** (redeemed once, the camera stops after a read), a 120 s leash with *STILL THERE?*. The world / mirror / TV views' ghosts wear the guest's picture and the King shows the shared bar and kneels. `test` 245 (24 files). **Wave 17** (not shipped): the **idle show** (`src/idle-show/`: 9 screensavers, 54 ads in 14 skins, 49 popup kinds + storms, a pure seeded schedule per terminal name kept in sessionStorage, six `night.phase` pools, the character's own copy only after the introduction, tap gags, TOUCH ME after 30 s) replaces the awake scan screen, with the **corner scan box** (`ScanBox.tsx`, `scan-copy.ts`); asleep terminals and the TV's attract play it full screen, an asleep mirror the TV's take with its sounds muted. The **cutscene engine** (`src/cutscene/`: `SceneDef` on a slide or a screen-state moment, keyed on `seq`, drawn from server time (`clock.ts`), `pick.ts`, `CutsceneLayer.tsx`, the t-driven `kit/`, `FaceHandle.flash`, a lazy chunk, `?preview=<id>&t=<ms>` / `?preview=list`) with **64 scenes** in `scenes/{act1,act2,act3,moments}.tsx`, each with a TV and a wall take but the four `play_on_the_screens` clips (wall only) and the two chess corners (TV only). The **sound bus** (`src/sound/`: `sfx()`, 30 synthesised WebAudio effects, the TV at 0.35 under the director's mute, dropped while a voice speaks; never a story `sound X`). **Full screen by default** (`fullscreen.ts` `KioskFullscreen`: every gesture, webkit, Fully Kiosk, `--kiosk` / F11 / Home Screen counted, config `fullscreen` + a ⚙ toggle, `fs=1\|0` on the poll). No regex lookbehind (K-14 refuses one); the face draws at 30 fps; the jsQR scan every 250 ms at 480 px. The main bundle 169 → 198 kB gzip. `test` 650 (52 files). **Wave 18** (on `oct31-w18/integration`): the screen state's **big** moments (`screen.ts` `ScreenMomentKind` `big`, `bigLineOf`) and the `house_win` scene (`cutscene/scenes/house.tsx`): a Win98 *Congratulations!* window over the TV and the walls for a house-wide `!!` line that leads with a win glyph (🎀 🏆 🥇 🏅 🎉 🎊 👑 🥳; the winner, the line typed out, a WINNER marquee, confetti; a fade under Reduce Motion); the casino reads `captured` (*⛔ YOU'RE IN THE INTERNET — GO TO THE TENT*). `test` 662 (53 files). **Wave 19** (on `oct31-w19/integration`): the **voice link** (`src/voice/`: `roles.ts` D9 — auto / world / shadow / face / chess / casino mic + speaker, the TV a speaker (mic off unless ⚙), the mirror / an unplaced tablet / the tent nothing; `mic.ts` its own audio-only `MicHub`, echo cancellation / noise suppression / AGC asked off; `capture.ts` a ScriptProcessor → 16 kHz → 200 ms → the −42 dBFS gate → μ-law, with the **hard half-duplex hold** while it plays a player, speaks or plays a sound, + 300 ms + the chunk span + the output latency; `uplink.ts` raw POSTs, one in flight, rebuilt when the stream proves a refused spot good again; `stream.ts` + `playback.ts` a 250 ms jitter buffer per player on a `voices` sub-bus, ducked under the voice floor, muted with the TV mute; `link.ts` `VoiceLink` (the stream is the only authority on `listening`; `?mic=&hear=` re-opened when the lock / TV mute / mic state change) is a lazy chunk loaded by `hook.ts` `useVoiceLink` (the map read with retries and re-read every minute; `voiceOn` from `@loom/house/voice-on` so the codec stays out of the main bundle, 204.46 kB gzip); the 🎤 on-air cue (`MicCue.tsx`), ⚙'s *let the games hear this room* / *play the players near this screen* (`mic` / `voices`, URL `mic=0|1` / `voices=0|1`), the heartbeat's `mic=` (`locked` while the page's sound waits for a touch). `test` 726 (62 files). **Wave 18b:** Stage A + the tent lane (shipped as `w18b-1021`): **`view=reinstall` — the tent laptop is a terminal and the reinstallation wizard** (`src/reinstall/`: the pure `session.ts` reducer, `ReinstallTerminal.tsx` with the wall idle show, the scan box and a *☣ IN THE INTERNET NOW* strip, `ReinstallFlow` from `@loom/reinstall` in a shadow pane (`pane.tsx`, `scope-css.ts`, `adapter.ts` `reinstallConfigOf`), held under an overlay, slides and cutscenes standing aside during a walk; an unmarked pass gets only the NOT MARKED card, never `force`; `/terminal/?code=<mod>&spot=tent&announce=1`: the map's tent spot sets the view; never add `&view=reinstall`, which keeps the name *Terminal* and stops following the map), `ScreenState.results` / `spot` / the four night fields parsed (`screen.ts`), the three-way *Say announcements* (house setting · always · never; `announceSetting`, `announceReport`, `ann=` on the heartbeat), `soundOutput()`, a long TV caption shown by the chunk being spoken (`captionChunks`). Stage B (on `oct31-w18/integ`, not shipped): the **results scenes** (`cutscene/kit/results.ts` + `results-parts.tsx`: hunt_results' rows with SURE / NOT SURE, ACCEPTED / GUESS and his 🤖 SAME / NOT THE SAME / RULED stamps, the tally's H4–H6 pages then the gauge, the verdict's eight tiles then, on the TV only, *The answer:* and *Lied:* per question (`VERDICT_MS` 33.5 s, `LIARS_DRAWN` 24); walls get counts only), Final Assessment's most / least trusted, the recount / purgatory numbers, the introduction's *Jean Trabolta, Sole Owner and Founder of Maps and Ducks* (`INTRO_LINE`, `TRUTH_TXT[0]`), the owner-only naming before the introduction (`owner: true` items, `ownerMay`, `OWNER_LINES`), the bingo's no-names rule gone, the Y2K tickers' *a faction of your own* (`y2kRaceClosed`). `test` 792 (68 files). **Wave 20** (on `oct31-w20/integration`, not shipped): **the door bridge** (`src/serial/`: Web Serial to the Grand Central M4; config `door: serial \| sim \| off`; ⚙ *Connect door sensor* + *Calibrate: door shut / open* (`heart/DoorSetup.tsx`), the stored thresholds re-sent on each connect; settled edges posted as `door_sensor_opened` / `_closed` with `x-loom-token` + `label`, the reconcile against `night.server_door` every poll, nothing posted in a blocking fault or under `night.door_override`; the heartbeat's `door` / `dlv` / `dft` / `dwn`; `door=sim` keys O / C / F); **room scenes** (`SceneTrigger {room}` off `room.cue`, the room's terminal only; `cutscene/scenes/heart.tsx`: the 10 heart scenes; the face's `dying` mood); **the choice panel** (`heart/ChoicePanel.tsx`: the newest `Heart …` menu on `dm:Trabolta` by id, ⟦TAG⟧ chips, mouse + `1`–`9`, `POST /api/guest/choose {index, text, choice}`, greyed under the **door overlay** *CLOSE THE DOOR*, which never shows a sensor fault); **the heart to heart** (config `keys`, default on: the composer hidden while a tree menu is docked, ⟦BACK⟧ small under it; `keys=0` = mouse only); the leash 180 s while a heart menu is docked or the door is open mid-heart; an eject ends the pilot, *not yet* / Leave only on a `keys=0` rig. `test` 858. |
| [`house`](./house) | **`@loom/house`** — the house map, pure TS, no deps: **one frame** (metres, Y up, `+z` south, yaw 0 = north) shared by both reinstallation games, the event server and the terminals. `house.json` schema v1 + `validateHouse`, the normative §1.2 geometry (`buildWalls` in integer mm, `buildFloors`/`buildRamps`), `locate`/`heightAt`, the visibility-graph `route` (the golden chevrons: doors, stairs, reflex corners, stair holes and solid props grown `PROP_MARGIN`), space transforms, the FNV-1a duck pick, `DUCK_MAX_RISE`, `DEFAULT_SPOT_FOV` / `horizontalFov`. Subpath **`@loom/house/three`**: the three.js scene (Win98-styled walls/floors/ramps/rails/props/terminal screens/room labels), the duck, the chevron trail, ghost avatars, a `PoseBuffer`. Goldens for the Godot port (`pnpm house:sync` = `goldens` + `sync` into `reinstall/vr`). **Oct 31 wave 4** (9d35a4b): the `king` `PropKind` (`hp` / `signals` / `armed`), `Door.guard` (a guarded door is shut for `route()`), `doorGap`, `guardWarnings`. **Oct 31 wave 5** (85d2bad): `HouseMap.variant` (a label like "Tent") + `MapVariant.label`; the show's King is `hp: 8` (15 since wave 11). **Wave 9:** `SpatialCandidate.restricted`, `captured` on `FoundResult` and `SpatialFrames.found`. `pnpm --filter @loom/house test` (152 + 4 skipped; wave 7 adds the show's `server-room` terminal spot on both variants; the show's goldens cover both map variants, plus a `three-floors` fixture; `validateHouse` refuses stacked stairwells). Contract: [`docs/loom-reinstall.md`](./docs/loom-reinstall.md). **Wave 11** (97486c9, 99d7d22): the shared King — `KingState {id, hp, max, fallen}`, the king prop's `health` (a world path) and `signals.hit` / `fallen`, `hp` up to 99 (`KING_MAX_HP`; an older server refuses a map with `hp` over 9), pure `kingReach(house, feet, yaw, king)` → `ok \| floor \| far \| facing` (`KING_REACH` 1.25 m, `KING_CONE_DEG` 55), `withFallenKings` + `route(…, {fallen})` (a fallen King's doors open, his prop not solid), goldens `show.king` / `show.fallen` for the Godot port; `SpatialFrames.hello.king`, the `king` and `avatar` frames, `PlayerState.avatar`. `@loom/house/three`: `createAvatar(name, seed, {picture})` wears the guest's picture as a Win98 tile head + the tag's icon (`picture.ts` `loadPicture`: a fixed draw size so a sizeless SVG renders, a failure retried after 60 s), `createKing` → `setHp(hp, max)` (a cell per point up to nine, else one fill reading `n / max`) + `kneel(on)`, `HouseScene.showKing`. The show maps: `hp: 15`, `health: "Night.king_hp"`, `armed: Night.king_armed ≥ 1`, the chess-phone prop gone, a **`server-room-door`** terminal spot ("Server Door", the basement hall). `test` 179 + 4 skipped. **Wave 17** (not shipped): `src/audio.ts` — `AudioConfig` schema v1 (`device`, `inputs` / `outputs` with labels, `speakers` on a room + `pos` + `yaw` + `out[]` + `gain`, `zones` (`everywhere` implicit), the sparse `routes` matrix, `cues`, `announce`, `voice.tv`), `validateAudio(audio, house?)` (problems + warnings: a speaker outside its room, a shared or unwired output, a cue naming nothing, an `announce_chime` cue), `resolveTargets(audio, house, to)` (everywhere / zone / room / LOCATION / speaker id, folded like `foldTarget`), `audioHash`, `defaultAudio`, `AUDIO_FILE`; the shared fixtures `test/fixtures/audio-*.json` pin stagehand's Python mirror. Speakers never live in a map, so a speaker edit never bumps the map version. `test` 213 + 4 skipped. **Wave 19** (on `oct31-w19/integration`): `src/voice.ts` — the voice link's wire constants (`VOICE_RATE` 16 000, `VOICE_CHUNK_MS` 200, `VOICE_MAX_BYTES` 8000, the reaches 12 m / 8 m, the caps 4 / 3, the gate −42 dBFS, `VOICE_BARGE_DBFS` −28 / `VOICE_BARGE_MIN_GAIN` 0.2, `VOICE_REACH_HYSTERESIS_M` 0.75, `VOICE_EDGE_FADE_M` 1.5, …), G.711 μ-law, a phase-keeping `Resampler`, `VoiceGate` (`holdUntil` the terminals' hold, `raiseUntil` the games' barge-in), `ChunkAssembler`, `jitterPlan`, and the one routing rule `hearsTerminals` / `hearsPlayers` (`{keep, only}`: the hysteresis and the live-mic filter; a same-room gain fading over the reach's last 1.5 m); `src/voice-on.ts` (`voiceOn`, D7: `voice: true` / `false`, unset = off in the spawn room; the `./voice-on` subpath); `TerminalSpot.voice`; `test/fixtures/voice-mulaw.json` pins the Godot port (`pnpm house:sync`). `test` 248 + 4 skipped. **Wave 18b** (shipped as `w18b-1021`): `TERMINAL_VIEWS` gains `reinstall` (the show maps' `tent` spot); `LeaveReason` `unmarked`; `audio.ts` `device.expect {inputs, outputs}` (whole numbers 1–64) and `announce.terminals: string[]` (map spot ids; an unknown one is a warning). `test` 250 + 4 skipped. **Wave 20** (on `oct31-w20/integration`): `src/lights.ts` — `LightsConfig` v1 (fixtures `zigbee` / `zigbee-group` / `wled` with caps, `safety` + `min` (≥ `LIGHT_SAFETY_MIN` 40), zones, looks keyed by the story's cue name: `set` / `steps` / `repeat` / `loop` / `period` / `then: "restore"`, `boot`), `validateLights(l, house?)` (problems + warnings: steps 150 ms apart, 400 ms before a colour, a Zigbee loop under 1.5 s, a look that darkens a safety fixture, a fixture outside its room in the absolute frame, the reserved `screens_` / `terminals_` / `tv_` / `tablet_` / `room_` prefixes), `resolveLightTargets`, `planLook`, `clampForSafety`, `z2mPayload` / `wledPayload`, `lightsHash`, `isLightLookName`, `lightStateProblems`; `test/fixtures/lights-*.json` pin stagehand's mirror. `lights.json` never lives in a map (a light edit never bumps the map version). `test` 329 + 4 skipped. |
| [`reinstall`](./reinstall) | The **reinstallation games** — a corrupted program walks a virtual copy of the house to the **golden duck** to be released. [`web/`](./reinstall/web) (`loom-reinstall`, Vite + React + three.js, served by the `core` server at `/reinstall/`): the tent tablet's Win98 wizard (scan a pass → Play here / Send to a headset), twin touch sticks + keyboard, pose pump (10 Hz latest-only), plus the **floor-plan editor** at `/reinstall/map` (`src/map/`: `MapApp` over `Canvas` / `Toolbar` / `Inspector` / `Panels` and pure `doors` / `yards` / `structure` / `history` / `check` edits — floors bar, Select / Room / Yard / Door / Stairs tools, typed W × D, doors that snap onto walls and follow a moved edge, an indoor room drawn in a yard **cuts the yard** round it (the tent / shed, with a flap door), snap 1–50 cm, zoom / pan, undo / redo, a clickable problem list with a walk check (`route()` spawn → every duck), unreachable-room and LOCATION warnings (a picker over the story's LOCATIONs), a lazy 🧊 3D preview, live players, terminals / duck spots / spawn / props, the JSON tab; saves via `POST /api/mod/spatial/house` with a `base` version → 409 on a concurrent save) and a **project bar** (`ProjectBar.tsx` in `MapApp`'s `toolbarExtras` / `MapToolbarContext` slot: the tent ⇄ shed variant buttons, **Save to project**, **Download JSON**); **Oct 31 wave 4** (9d35a4b): **the King** — a chess piece with a health bar guarding the server-room door (`game/fight.ts`: ⚔ HIT makes the chess AI dumber, ♟ CHALLENGE opens the `chess/` board on chess.js 1.4.0, checkmate fells him → `chess won`; wave 11 moved the board to the Server Door terminal, see below). `pnpm --filter loom-reinstall dev` (:5176) / `test` (356 after wave 9 — a find the story kept reads GERALD CAN'T HELP with no egg, a restricted program has its own quick picks, a paused find keeps the leash, the spatial stream reopens after a 502, the badge reads `Night.king_armed`; after wave 7 — the King's badge reads **FOR THE CODE** / **PRACTICE** with a `stakesLine`, checkmate says where the door code went (`winNotice` after re-reading the step, `ARMED_TIMEOUT_MS` 4 s), nothing promises the real door — incl. the `trail.ts` stair-trail autopilot; the wizard checks WebGL2 before Play here). **Oct 31 wave 5** (85d2bad): one hit per 2 s on the King, a win that didn't land is shown and re-posted after a reload within 60 s, ⚙ Setup / 🗺 House map need a 2 s hold, the map page asks for the mod passcode before its first write, a switch offers Save to project first, and a duck within reach of a shared wall is a warning. [`vr/`](./reinstall/vr): the **Godot 4.7 Quest 3** game (OpenXR, thumbsticks only, GDScript ports of `@loom/house` diffed against its goldens, station polling, `--autopilot` for headless end-to-end runs); `tools/quest.sh` does the Android side (`setup` checks JDK/SDK/export templates + makes the debug and release keystores, then builds one release-signed APK per headset from a staging copy with the pinned OpenXR vendors plugin and a baked `station.json`, and sideloads it); headsets talk to the VPS over HTTPS only. Wave 4's headset showed the King and said "The King is fought on the tent tablet."; since wave 11 it hits him (below). Not in the pnpm workspace or the Docker image — `pnpm test:vr` (401 checks after wave 11 + 26 `quest.sh` checks). Overview: [`reinstall/README.md`](./reinstall/README.md); contract: [`docs/loom-reinstall.md`](./docs/loom-reinstall.md). **Wave 11** (50513b0, 28a025a): **one shared King** in both games — his bar is the night's (`n / 15`, off `hello.king` and `king` frames; an old server sends none: no bar, no hit), **⚔ HIT** on the tablet (Space) or the **trigger / A / X** in the headset when near and facing him (`kingReach`), **once per reinstallation visit**, which ends at the duck (a re-scan before it is the same visit: the `Assignment`'s `kingHit` shows ⚔ spent from the start; "You hit him this reinstallation. Find Gerald before you hit him again."; the server's 409 `already hit` counts as spent); the tablet's HUD reads the strength stages (*full strength* … *barely standing*) and at 0 *The King is on his knees. His door stands open.* — he kneels for everyone and his guarded door opens in both games; a director's 👑 restore stands him up but holds the door for a player in the Server Room, the doorway or on his spot until they walk clear (web `keepDoorOpen`, VR `HouseKing.keep_door_open`); a remap with him down keeps a player on his spot. **No chess on the tablet** (no ♟ CHALLENGE, no C key; `chess/` moved to `@loom/chess`), and nothing in either game posts a chess result. **Ghosts wear the guest's profile picture** (`/e/<id>/api/avatar/<key>`; VR decodes png / jpeg / webp / svg near 256 px through an HTTPRequest pool, GIF / AVIF keep the capsule, a failure retried next visit). VR `--hit-king` sends the autopilot to the King first. web `test` 327 (25 files). **Wave 17** (not shipped): the map editor places **house speakers** (`web/src/map/`: a 🔊 Speaker tool — place, drag, turn, ⌘D, Delete, arrows — drawn with its output badge and a coverage ring; a speaker inspector with a 16-output grid and zones; *+ Speaker here* on a room; speakers follow a moved room, wall or floor; 🔊 problems in the problem list) and the **🔊 Audio tab** (the device, 16 inputs + 16 outputs, the inputs × outputs matrix with per-cell gain, zones lit on the plan, a cue's targets as chips for every story sound, the announce + TV voice targets, 🔈 Test per speaker and output, a router badge); `audio.json` saves through `/api/mod/audio` with its own `base` → 409, Save to project, Download JSON and a long poll (`audio-poll.ts`); one undo history of `{house, audio}` (`History<Doc>`); the editor gets the story's LOCATIONs before the doors. Not in the 3D preview or the JSON tab. The tent wizard is unchanged (no idle show, full screen or sounds). web `test` 412 (32 files). **Wave 18** (on `oct31-w18/integration`): the tablet labels programs from the server's `marked` (`program.ts` `ProgramState` `corrupted` / `favour` / `marked` / `held` / `healthy`; *Marked program detected*, *Program held by a director*) and, after an ending, the **party favour** (the candidates' `favour` / `ended`, *Party favour unlocked*, *Party favour for X*, the King's stakes hidden); VR's lobby tags `[marked]` / `[party favour]` (`Lobby.tag_of`). web `test` 419 (33 files); VR 463 + `quest.sh` 26. **Wave 19** (on `oct31-w19/integration`): the **voice link in both games** — web (`src/game/voice.ts` `VoiceLink`: off by default, the tent laptop; `voice=1` / Setup's 🎤 box elsewhere; the mic opened in the Play here tap, low-passed at 7 kHz, the gate, the **barge-in** (D5b: while a terminal plays here (+ 300 ms) the gate rises to −28 dBFS instead of closing, a faint terminal under gain 0.2 raises nothing), panned voices at each terminal's screen (`PannerNode`s, a 200 ms jitter buffer, a skip cutting only what is queued past the target with a 5 ms fade), the HUD's 🎤 LIVE / MUTED / NO MIC and *N terminals can hear you* off the server's `ears`; the map editor's terminal `voice` (an explicit off always kept) and a spawn-room-with-voice warning) and VR (`net/voice_link.gd` + `voice_codec.gd`, diffed against `@loom/house`'s vectors: `AudioServer` input with an `AudioStreamMicrophone` fallback, the mic reading 🎤 … until a real sample lands, the barge-in, one keep-alive `HTTPClient`, an `AudioStreamPlayer3D` + `AudioStreamGenerator` under each `Terminal_<id>`, **B / Y** (M) mute, the RECORD_AUDIO grant asked in the lobby). The **in-headset picker** (`game/lobby.gd`: PICK YOUR PROGRAM picture tiles off `AvatarCache`, *Start as X?*, the laser `player/pointer.gd` from either hand's aim pose, the sticks, the desktop mouse) and **SET UP THIS HEADSET** (`game/setup_panel.gd`: the server choice, the moderator passcode on an on-screen keyboard, the name, CONNECT saving `user://station.json`, PLAY OFFLINE on a desktop run only; a dead passcode brings it back; ⚙ forget, 5 s on a headset); F5 from the Godot editor reaches SET UP / the lobby with no script errors, *This computer* first. web `test` 450 (34 files); VR 729 + `quest.sh` 27. **Wave 18b:** Stage A + the tent lane (shipped as `w18b-1021`): web `flow.tsx` (`ReinstallFlow`, the choose / play / send flow lifted out so the tent laptop mounts it) + `flow-state.ts` (`firstStep`), `Game.hold(on)` (an overlay pauses the leash, input, a find and the quack; keepalives run), `createSfx(output?)` on a host's sound bus, `leaveText` and VR `Game.session_over_text` (*No longer marked for reinstallation — the simulation ended.*), the map Inspector keeps the `reinstall` view roomless (`ROOMLESS_TERMINAL_VIEWS`). Stage B (on `oct31-w18/integ`): the 🔊 Audio tab's *Tablets that also say them* (`setAnnounceTerminal`, `announceTerminalRows`) and the 828x's *the device reports* (`setExpect`). web `test` 483 (37 files); VR 730 + `quest.sh` 27. **Wave 20** (on `oct31-w20/integration`): the map editor places **house lights** (`web/src/map/`: a 💡 Light tool, the light inspector (a device picker off the Z2M list, caps, safety + min, 💡 Identify, colour swatches), *+ Light here*, lights following room / floor edits, the **💡 Lights tab** (fixtures, the Z2M devices + *Pair new device* with its countdown on the server's clock (`LightsView.now`), zones, looks with a step builder and ▶ Test, the module badge), `lights.json` through `/api/mod/lights` with its own `base` → 409, Save to project, a long poll (`lights-poll.ts`), one undo history `{house, audio, lights}`). web `test` 538. |
| [`chess`](./chess) | **`@loom/chess`** (wave 11, `git mv`'d out of `reinstall/web/src/chess`): the King's chess, shared TS source with no build step — `rules.ts` (chess.js 1.4.0), `ai.ts` (`pickMove` / `pickMoveAsync` in 12 ms slices so taps stay live on old tablets), `stage.ts` (`stageFor(hp, max)`: grandmaster only at a full bar, `1 + floor(3·hp/max)` → dizzy / beginner / club in between, **pawns only only at 0**; no stage copy: the door terminal shows only his bar, the tent tablet keeps its own lines), `Board.tsx` + `board.css`. Played only by `terminal`'s `view=chess` (the Server Door terminal). `pnpm --filter @loom/chess test` (23). |
| [`desktop`](./desktop) | The **Tauri 2 desktop app** — the `editor` React app in a native shell (own Cargo workspace at `desktop/src-tauri`, excluded from the root workspace to keep it lean; zero Prism deps). Adds what the browser can't: a path-based **fs bridge** (`fs_bridge.rs`) that the editor's local-folder backend runs on via FSA-shaped handle shims (`editor/src/lib/desktop-fs.ts` — WKWebView has no File System Access API), and **Wwise-style Godot integration** (`godot.rs` + the editor's Integrations mode, `⌘3`): link a Godot 4 project, install the embedded `addons/loom` runtime (`include_dir!` of `engines/godot/addons/loom`) + enable the plugin in `project.godot`, and build the open workspace into `<name>.loombank` + `LoomIDs.gd` inside the game project (banks compile in the webview via `@loom/bank`; the host only writes files). `pnpm --filter loom-desktop dev\|build`; `cargo test` in `src-tauri/` covers the integration logic. Reference output: [`examples/guard-patrol/godot`](./examples/guard-patrol/godot). Design: [`docs/loom-desktop.md`](./docs/loom-desktop.md). |
| [`bank`](./bank)       | **TypeScript** bank compiler + the **normative reference interpreter**. Lowers a project into `.loombank` — engine-agnostic 4×i32 instruction streams, RPN expressions, pre-split interpolation, pre-parsed directive args — plus generated `LoomIDs.{gd,cs,h}`. `<shuffle:>` runs on the spec'd xorshift64* PRNG (`src/prng.ts`, per-site streams persisted in the save), and **locale banks** are emitted (`loom-bank strings` template → `build --locale <tag>=<file>` → `<name>.<tag>.loombank` sidecar; `set_locale` swaps literals at render time, expressions stay live, per-key fallback). Hosts the scenario driver / golden-trace harness (incl. `loadbank` for locale sidecars) every per-engine runtime is conformance-tested against. See [`docs/loom-banks.md`](./docs/loom-banks.md). |
| [`engines/godot`](./engines/godot) | **GDScript** Loom runtime for Godot 4 — pure script, no GDExtension, no build step. `LoomRuntime` (pull-model `advance() -> Step`, plus signals), `LoomBank` + a `.loombank` import plugin, save/load that round-trips a suspended choice, and a headless conformance runner diffing the reference's goldens byte for byte. On top, a Wwise-integration-style **scene layer**: `LoomStory` (bank host node — autoplay, timer auto-tick, optional auto-advance pump with hold/release gating, save-file helpers), `LoomHook` (story→game: filterable directive/beat/line/varset/fire listener as an editor-connectable signal), `LoomTrigger` (game→story: fire an `on <verb>` hook or start a beat on ready/Area overlap/manual), `LoomTypewriter` (per-character RichTextLabel reveal, punctuation pacing, skip, story hold — **raw signals only**; effects are separate interpreter nodes: `LoomBlip` pooled pitch-randomised voice blips, `LoomTalkAnimator` talk/idle animation), `LoomDialogueBox` (complete drop-in player — speaker/portrait/pooled choice buttons/continue-indicator/two-tap input/auto mode/`resume()` — skinned by a `LoomStyle` resource with per-character `LoomSpeakerStyle` overrides; `demo/styled_demo.tscn` plays a story with zero scripts), `LoomHistory` (backlog), `LoomSaveSlots` (named slots with query-API metadata headers), a host-side state-query API (`current_beat`/`current_setting`/`pending_options`/`is_finished`/`has_played`/`world_snapshot`/`beat_names` + `save_to_file`/`load_from_file`), plus a `LoomBank` inspector preview (beats/hooks with copy-name) — covered by `test/addon.sh` (96 headless checks) alongside `test/conformance.sh` (4 scenarios incl. shuffle PRNG + locale switching). |
| [`examples`](./examples) | Reference `.loom` projects used by `loom-runtime` integration tests and as authoring tutorials |
| [`mind`](./mind)       | **Superseded (2026-09-16) by stagehand's `agents` module and awaiting deletion.** The old TS bridge (`@loom/mind`) watched the mod feed for DMs to a character and answered through Ollama. Its replacement works on explicit server requests. |
| [`stagehand`](./stagehand) | **Python** (uv-managed, not in the pnpm workspace) live-event bridge. It is **modular**: one daemon, one YAML per machine, and each top-level section enables a module (`module.py::REGISTRY`; modules share one authenticated `ModClient` and are supervised and restarted independently). **`show`** (the desktop): joins the mod SSE feed and turns story events (`<cue:>`/`<prop:>`/`<vibe:>`, `beatEntered`, `signal`) into OSC cues (TouchDesigner, with an NTP `t_exec` contract) plus MQTT prop commands. In reverse, MQTT sensor topics inject journaled `signal`/`beat`/`arrive` mutations (retained messages never fire unless `accept_retained: true`, but they prime `edge: true` rules, which fire once per false → true; SSE streams reconnect after 60 s of silence). The show's house rig is `trapped.house.yaml` (broker = the house Mac's static IP; blackout = per-device WLED offs that leave the safety lights and the dim Tube preset). **`agents`** (the laptop): voices `mind: external` characters with a local OpenAI-compatible model (Ollama, `gpt-oss:20b`). It holds `GET /api/agent/stream` and answers each server-sent request (thread + speaker + both parties' state + codex) with `POST /api/agent/reply {say, adjust}`, using a persona file (frontmatter knobs incl. a `when:` gate) as the system prompt. A slower **orchestrator** (the Qwen distill) grows a structured **mind** between turns (arc `stages` / `drives` / `policy` / `questions` declared in the mind file's frontmatter, dossiers, a numbered revision log); every model call is a recorded **thought** (`agents/trace.py`: messages, both models' reasoning, output, mind diff) streamed to the server for the editor's Run → Mind page, and a **control channel** (`control` frames: reset / survey / nudge / set / forget / thinking / effort / pause / rerun) steers it — the server's story restart uses the same `reset`. **Answer secrecy** (`agents/secrets.py`): a mind file's `secrets:` frontmatter (hunt `topics` / `match` / `lore`) makes the worker drop any verdict on a hunt claim from orchestrator output and a restored mind, and keep hunt-answer codex entries out of every prompt and lookup card, so the voice can never tell a guest which hunt answer is true. **`alexa`** (the house Mac — **house announcements**; the module keeps its code name, the fiction has no Alexa): MQTT `show/announce` → a chime + **the Mac's own `say` voice** (`engine: say`, the default since 2026-10-15: rendered with `say -v <say_voice> -o`, no server call) on a named CoreAudio device + channel map (the MOTU's Z1 + Z2), falling back to `say -a <device>` then plain `say`; `engine: server` opts into `/api/mod/tts` (disk-cached, `prewarm:`); the story's `sound announce_chime` arrives on `show/chime` and rings the same chime unless an announcement just rang it (`CHIME_MERGE_S`); launchd agent + runbook in [`scripts/house-macbook/alexa.md`](./scripts/house-macbook/alexa.md). **Oct 31 wave 5** (85d2bad): the `show` module **catches the lights up** (`catch_up:` rules in the YAML, run on every feed or broker reconnect and after a reset / reload / go-live), every `do announce` also cues QLab's `duck_music`, and the orchestrator's lore block leads with what the character holds (cap 60) and its world view follows the persona's `facts:` prefixes. `uv run pytest` (308 tests after wave 9: catch-up replays `lights_y2k` under `server_open`, the cut-room rules follow the story's 90 s restore and `Night.lit_scene`, `screens_flicker` leaves the strips alone) — **wave 7:** the persona key **`situations:`** (`{name?, when, prompt}` blocks gated like `when:`, appended to the voice prompt and to that speaker's reflect, kept out of the shared brief; Trabolta's *at your heart* makes him candid at the server-room terminal from the Y2K hour, where his `stand_down` power only offers), and `trapped.house.yaml`'s door rule (`open == true`, `debounce_s: 20`; the test forbids any lock action) / `uv run stagehand modules\|check\|run --config <machine>.yaml [--only agents]` / `stagehand ask` (chat with a persona, no server) / `stagehand announce` (play one announcement now) / `stagehand launchd install\|restart\|status --job show\|agents` (one launchd job per module on the house Mac). Examples: `show.example.yaml`, `agents.example.yaml`. Design: [`docs/loom-show-control.md`](./docs/loom-show-control.md). **Wave 11** (story lane, no stagehand code): `trabolta.persona.md`'s *at your heart* situation needs only `them.at_the_heart` (The Heart plays once he is awake, at any hour), a separate **standing down** block keeps `Night.step >= 14`, and the rule reads *Never fire stand_down unless the STANDING DOWN situation block is below*; the mind file's `secrets.never` gains the four digit-note codes. Reload the persona on the house Mac (restart the `agents` job). 310 tests. **Wave 11b:** the **`judge`** frame (`agents/judge.py`): one stateless call on the voice model at temperature 0.1, built from the frame alone (no persona, mind, state or confidence), `{same, why}` parsed from JSON / `<think>` / fences / a folded tool call, else nothing (the server's 60 s expiry stands); a call past 55 s answers nothing; `cancel` and a restart abort it; a `why` with a `secrets.never` word is sent empty; one `judge` thought in the trace, nothing in the mind. Trabolta's persona gains `marked` in `them:` and the *marked at your heart* situation; its NEVER line: he never makes up a right answer. 334 tests. **Wave 12 — the story mind** (`mind_mode: new`; absent = classic): one voice call per guest line, the orchestrator never started; the mind file's **phase cards** (`stage` / `favours` / `drives` / `powers` / `tell` / `brief` / `cue` + `_stages`) applied in code by a phase watch (`agents/story_mind.py`, one revision *by story*); a person card + the voice's own ≤ 140-character memo; the **lean voice** (`agents/voice.py`: P1 static → P2 the night → P3 this call → P4 the thread, the story's lines out of his turns, a one-token `warm_head` call so gpt-oss's cache holds); the guards (`agents/guards.py`: never, answer words, 2b invented facts, 2c `unsaid` names, the `catchphrases` / `catchphrase_stages` ration, one repeat retry over what this guest heard, the memo scrub; dead-air lines from `fallbacks:`); the quiet-conversation summary; Rewrite brief; `voice:` / `mind:` switches (memo, repeat_guard, dossier_on_close, warm_head, layout lean \| classic; stage_from_phase, phase_poll_s). Both modes: `agents/wire.py` (saves ≤ once per 2 s, mirrors only on a change, the static prompt stored once, a reconnect replays after `traceAfter`, no-op controls dropped), the classic survey guard (no survey while asleep, paused, ended or unchanged), SIGTERM flushes through each module's `finally`. The replay harness `python -m stagehand.replay extract \| live \| offline \| score` (the K-04 bars on scratch servers; runs and the Ollama lock under `<tmp>/loom-replay/`). 711 tests. **Wave 17** (not shipped): the opt-in **`audio`** module (`src/stagehand/audio/`, launchd job `audio`, `audio.example.yaml`; commented out in `trapped.house.yaml`): long-polls `audio.json` (cached in `cache_dir`), mirrors `resolveTargets` (`routing.py`, the shared fixtures), opens one `sounddevice` duplex stream on the interface with a numpy mixer (voices laid out per speaker, the input → output matrix, a duck under announcements (`duck_hold_s`, `no_duck`), a limiter, a watchdog that reinits a replugged device); with `play_sounds: true` a story `sound X` plays `sounds_dir/X.(wav\|aiff\|flac)` to the line's rooms, else its `audio.json` cue, else the beat's setting, else everywhere (and `show` drops its QLab sound cues); `announce: true` plays the chime + `say` render on `announce.to` (refused beside `alexa:`); speaker Test tones + a spoken label; `health/audio`; `stagehand check --only audio`. 871 tests. **Wave 18b:** Stage A (shipped as `w18b-1021`): the `judge` frame rules a plain miss too (the `near` note rides the user turn). Stage B (on `oct31-w18/integ`, not shipped): **the router is the show's player** — `trapped.house.yaml` runs `audio` with `play_sounds` and `announce` on and `passthrough: false`, with no QLab OSC target and no `alexa:` section (the module code stays; its launchd job retires, `scripts/house-macbook/audio.md`); the **MOTU 828x + ADAT expander** (`audio.json` 24 in / 22 out, `device.expect` 32 / 30: `check` fails and the router logs a moved layout but plays; health `layout`); **stop all house sounds** (`stop_all`: a 0.3 s fade of the sfx and test buses, *+ announcements* cuts the line in hand and the queue by epoch; the `stops=` cursor, `new_stops`; MQTT `show/audio/stop`, `show/audio/play`); labelled **placeholder sounds** (the tracked manifest `media/sounds.yaml`, `audio/placeholders.py`, `stagehand sounds placeholders`, a real file always wins, `check` lists what is left); `stagehand announce` / `sounds stop \| play` through the router (exit 1 when `health/audio` says nobody listens). 905 tests. **Wave 20** (on `oct31-w20/integration`): the **`lights`** module (`src/stagehand/lights/`, launchd job `lights`, `lights.example.yaml`): `cue <look>` off its own mod feed → Zigbee2MQTT (`zigbee2mqtt/<device>/set`) / WLED publishes from `lights.json` (mirrors of `@loom/house` `planLook` / `clampForSafety` / the payloads, pinned by the copied fixtures), timed steps, a new look cancels a fixture's running steps, `then: "restore"` gives back the interrupted loop or the settled look, test / identify / pair (`bridge/request/permit_join`), the Z2M device list → `POST /api/mod/lights/devices`, the catch-up from `/api/screen/state` (alarm → `heart_alarm`; door open mid-heart → `heart_door_open`; `heart_look`; `boot`) after a reconnect, a restart and `lifecycle reset \| reload \| golive`, `health/lights`; `show` hands its looks over (`hand_looks_to_lights`); `stagehand lights test \| pair \| devices`, `check --only lights`. `trapped.house.yaml`: the ESP32 / Zigbee door rules gone (D16; w20b Q7: no ESP32 in the server room, its other rules kept but marked not installed), no strip in the server room (w20b Q6: every `wled/server` rule gone; the RGB bulb `server_room_rgb`, the `server_room` group's only member (Q10), is the room's light and its safety light, `min: 80` in `lights.json`, D10 / D11). **agents:** the dossier as *WHO THIS IS — TONIGHT* (classic too), situation keys `max_sentences` / `acts: none` in the voice and the guards, the persona's **`outside:`** words withheld from his output like `never` words (never in the prompt; `check` warns on one in his own text). Runbooks `scripts/house-macbook/zigbee.md` (the user's CC2652P on Z2M 2.x `adapter: zstack`) and `lights.md`. 1034 tests + 2 skipped. |
| [`hardware/server-room`](./hardware/server-room) | **Not installed for Oct 31** (w20b, Q7: the M4 is the server room's only electronics; the patch bay is judged and pressed by the Antivirus watch's `radio_*`, the siren is the router's; its YAML rules stay, unused). **Arduino** firmware for the server-room ESP32 (N-08): a door contact that **closes when the door opens** (two wire loops / copper tape, `kClosedWhenOpen`, `DOOR_MODE DOOR_TAPE`; per-input polarity, the reed optional) → `sensors/serverroom/door {"open","tape","mode"}` (retained; open ≈ 0.6 s, shut ≈ 3 s after the contact moves) — the real door has a **standalone keypad lock** nothing here drives — the 2×12 patch bay scanned all-pairs on two MCP23017s against a stored baseline → canonical `sensors/patchbay/state`, the lock ring + DFPlayer siren on `show/serverroom/*`, LWT `health/serverroom`; broker hard-coded to the house Mac's static IP, dialled on Mosquitto's password-only LAN listener `:1884` as user `props` (`SR_MQTT_USER` / `SR_MQTT_PASS` in the git-ignored `secrets.h`; the anonymous listener is `127.0.0.1:1883` for stagehand / Z2M / the `alexa` module (house announcements)). Pure logic in headers, host-tested by `test/run.sh` (144 checks after wave 7; `compile` = arduino-cli ESP32 build); the MQTT contract vs `trapped.house.yaml` is pinned by `stagehand/tests/test_serverroom_firmware.py`. Bench: `scripts/accept/N-08.sh`. **Wave 20 (D16):** the door left this box: stagehand no longer reads `sensors/serverroom/door` (the code still publishes it, unread), and `scripts/accept/N-08.sh` keeps the patch bay only; the door is [`hardware/server-room-door`](./hardware/server-room-door). |
| [`hardware/server-room-door`](./hardware/server-room-door) | **Arduino** firmware for the server-room **door sensor** (wave 20, D2; on `oct31-w20/integration`, not shipped): an LED on the frame shining into an LDR (in a black shroud tube) on an **Adafruit Grand Central M4**, plugged by USB into the server-room laptop, whose terminal page reads it over Web Serial (`terminal/src/serial/`) and posts `door_sensor_opened` / `door_sensor_closed`. 12-bit reads; the LED's wiring is a build switch since w20b (Q5, `config.h` `LED_MODE`): `LED_STEADY` (the default, today's rig: the LED on the board's 5V, `steady`, `level = lit`) or `LED_PULSED` (the LED switched by D2, `mod`, *lit − dark*, so room light can't fake *shut*), `LED_AUTO` the old boot probe; firmware 1.1.0, and the terminal never sends `set mode` and re-sends a calibration only when it was taken in the board's mode (`settingsFit`, ⚙ *calibrate again*); hysteresis (`close` 1800 / `open` 1200 by default) + debounce (shut after 1 s, open after one frame ≈ 150–450 ms plus the cell's lag); blocking faults `ldr_saturated` / `led_dead` (an optional sense on A1) and the non-blocking warning `ldr_open`; calibration `cal closed` / `cal open`, `set close \| open \| mode \| settle`, `save` (FlashStorage_SAMD, magic 0xD00E); JSON lines at 115200 (`hello`, `door` on every change and every 1 s, `cfg`, `cal`, `ok`, `err`, `pong`); the NeoPixel green shut / amber open / purple fault / blue until the host speaks. Pure logic in headers (`door_ldr.h`, `engine.h`, `proto.h`, `store.h`), host-tested by `test/run.sh` (247 checks; `run.sh compile` = `arduino-cli compile --fqbn adafruit:samd:adafruit_grandcentral_m4`); `test/fixtures/lines.jsonl` pins the terminal's parser. Bench: `scripts/accept/N-20.sh` (proposes `mode` / `settle` / `close` / `open`); through the story: `K-05.sh`. Replaces the ESP32's wire-loop contact (D16). |

**All Loom documentation lives in [`docs/`](./docs)** (moved from the
repo-root `docs/dev/` 2026-07-20): the canonical design spec
([`docs/loom-v3.html`](./docs/loom-v3.html)), the writer's guide
([`docs/writing-in-loom.md`](./docs/writing-in-loom.md)), the **bank
format + cross-engine runtime spec**
([`docs/loom-banks.md`](./docs/loom-banks.md) — normative for every
per-engine runtime), and the dev design docs (multiuser, deployment,
show-control, conversation model, IDE redesign, …). Per-crate `lib.rs` docstrings carry the module
roadmap and the spec section each module implements.

**Docker deployment** (2026-08-26): the repo root ships a multi-stage
`Dockerfile` (targets: `server` — the `@loom/core` event server under
`tsx` (+ `house/` source for `@loom/house`) with `play/dist`,
`terminal/dist` (`/terminal/`) and `reinstall/web/dist` (`/reinstall/`)
baked in; `proxy` — Caddy serving the editor SPA
at `/edit/`, built with `--base=/edit/`, and reverse-proxying `/`,
`/api`, `/e` to the server) plus `docker-compose.yml` (Postgres +
server + Caddy, named volumes for pgdata / `LOOM_STATE_DIR` / certs,
migration run idempotently by `deploy/docker-entrypoint.sh`) and
`.env.example`. The `proxy` target also hosts [`invite/`](./invite)
(`loom-invite`, in the pnpm workspace) — the cryptic party-invitation
one-pager served on its own Caddy site address (`INVITE_ADDRESS`, the
apex domain, e.g. `mapsandducks.com`) while the app lives on a
subdomain (`SITE_ADDRESS`). Caddy compresses everything except the SSE
streams (`*/events`, `*/stream`) and flushes proxied writes at once.
**Kokoro is opt-in** (since 2026-10-15, the user's call: the devices'
own voices are the default): the **`kokoro`** service (Kokoro-FastAPI
CPU, internal only, capped by `KOKORO_CPUS`) sits behind the compose
`tts` profile (`COMPOSE_PROFILES=tts` / `--profile tts`), and
`LOOM_TTS_URL` defaults to `off` (opt in with
`LOOM_TTS_URL=http://kokoro:8880/v1`). A VPS that ran the earlier
bundled Kokoro needs a one-time `docker compose rm -sf kokoro`
(`docs/loom-docker-deploy.md` → *The voice*).
New `.env` knobs: `LOOM_RL_{RESOLVE,REGISTER,LOGIN_FAILURES,REDEEM_MISSES,WIDGETS}`
(`<max>` or `<max>/<seconds>`; raise them for a house on one public IP),
`LOOM_VAPID_{PUBLIC,PRIVATE}_KEY` + `LOOM_VAPID_SUBJECT` (Web Push; generate
once, never rotate before the show), and `LOOM_TAG` (images are
`loom-server:<tag>` / `loom-proxy:<tag>`). **Releases** are pinned:
`deploy/release.sh <tag>` (pre-release backup → build → up → health →
`~/loom-ops/releases.log`; `--adopt` tags what already runs),
`deploy/rollback.sh` (previous tag, no build), `deploy/backup.sh`
(`pg_dump` + the state volume, `--label nightly|show|pre-release`) and
`deploy/restore.sh` (into a `loom-drill` project, or `--live`). From the
Mac: `scripts/ops/predeploy.sh` (the full gate, stamps the commit) →
`scripts/ops/ship.sh <tag>` (rsync + `release.sh` over ssh);
`scripts/ops/showbackup.sh` pulls a show-night copy every 10 min to the
house Mac; `scripts/sync-show.sh` (`pnpm sync-show`, `LOOM_SSH=…`) pushes
the show's story into the VPS project over an SSH tunnel and reloads its
event (never after doors). Per-item device checks live in
`scripts/accept/` (the ones that fire into a live event run `guard.sh`
first: real guests are refused unless `--i-know-this-is-live`). VPS walkthrough incl. domain
transfer/DNS: [`docs/loom-docker-deploy.md`](./docs/loom-docker-deploy.md).

**In-app help** ships from [`docs/help/`](./docs/help): markdown
articles (frontmatter: `title` / `section` / `order` / `keywords` /
optional `role`) in two collections — `authoring/` (the editor's
manual: the whole language + editor usage) and `play/` (the
participant/performer guide) — parsed + searched by the shared
dependency-free engine [`docs/help/helpdoc.ts`](./docs/help/helpdoc.ts).
Both apps bundle their collection at build time via
`import.meta.glob(…, ?raw)`, so editing a `.md` here updates the apps'
Help on the next build (live under Vite dev). The editor renders it as
the `⌘/` / F1 **Help overlay**; play as the `?` **HelpSheet**. Content
integrity is tested (`editor/src/lib/help-content.test.ts` +
`play/test/help.test.ts` — well-formed frontmatter, resolving
cross-links, search entry points), so keep those green when adding
articles.

## Rust workspace (parser · runtime · lsp · syntax)

The repo-root [`Cargo.toml`](./Cargo.toml) is a standalone workspace —
`cargo build` / `cargo test` work from a fresh clone. `server/` is
excluded (prism-core dependency, see above). The Rust engine is the
original implementation and **lags the TS engine** (none of the
2026-06/07 trait/derived-beat slices or the story graph are ported);
the TS `core/` is the maintained implementation.

## JS/TS workspace (core · bank · play · terminal · house · reinstall/web · editor · desktop)

The JavaScript packages share the repo-root **pnpm workspace**
([`pnpm-workspace.yaml`](./pnpm-workspace.yaml)). One install covers
them all; run scripts with `pnpm --filter <name>` (or `pnpm -r test`
from the root):

```bash
pnpm install            # every JS package (core, bank, play, terminal, house, …)
pnpm dev                # the whole dev stack: build play + terminal + reinstall,
                        # event server (:7000) + editor (:5173); --sync "<project>"
                        # pushes the example story into a server project;
                        # --play / --reinstall add those Vites (:5174 / :5176)
                        # (scripts/dev.mjs · core/scripts/sync-example.ts)
pnpm house:sync         # house goldens + copy house.json/goldens into reinstall/vr
pnpm test:vr            # the Godot VR game's headless suite (needs Godot 4.7)
pnpm sync-show          # push the show's story to the VPS project + reload
                        # its event (LOOM_SSH=user@host; scripts/sync-show.sh)
pnpm --filter @loom/core test               # the TS engine suites
pnpm --filter @loom/bank test               # bank compiler + reference VM
pnpm --filter @loom/core serve              # the LAN event server (:7000)
pnpm --filter loom-play dev                 # participant app, HMR (:5174)
pnpm --filter loom-app  dev                 # the editor, HMR (:5173)
pnpm --filter loom-desktop dev              # the Tauri desktop app (drives :5173)
```

Each package has its own README: [`core`](./core/README.md) (engine +
event server), [`bank`](./bank/README.md) (the game-engine compiler),
[`play`](./play/README.md) (the participant app),
[`editor`](./editor/README.md). The Rust crates are built via Cargo, not
pnpm — they are not in this JS workspace. `engines/godot` is a Godot
project, not an npm package.

## SaaS control plane (TS stack)

The TS `core` server is multi-tenant. Authors sign up (BetterAuth,
email/password) and own **projects** (server-stored `.loom` files); each
project launches its own **event** (live, or a private server-hosted
**preview**), and party-goers still join by short passcode with no account.

- **Control plane** (needs Postgres via `DATABASE_URL`): `/api/auth/*`
  (BetterAuth), `/api/projects/*` (+ `…/:id/event` launch/pause/resume/end),
  access-scoped. `pnpm --filter @loom/core migrate` builds the tables. If
  the DB is unreachable the control plane stays disabled and the event plane
  still runs, so a LAN-only deployment needs no database.
- **Collaboration** (2026-08-27, invites 2026-09-09): a `project_member`
  table + `/api/projects/:id/members` (GET/POST/DELETE) let an owner share
  a project with another author **by email**. An existing account is added
  on the spot; any other address gets a **pending invite**
  (`project_invite` row + a tokened link, `?invite=<token>` into the
  editor) that becomes membership when they open the link or simply sign
  up with that address (claimed on every `/api/projects` listing). Either
  way the recipient is **emailed** via `core/server/mail.ts` — SMTP
  (`LOOM_SMTP_URL`) or Resend (`LOOM_RESEND_API_KEY`), else a console
  fallback — and the API reports `delivery` so `ShareDialog.tsx` can show
  the owner "emailed" or hand them the link to pass along. Members see the
  project under "Shared with you" in the launchpad (`ShareDialog.tsx`
  manages members + pending invites: resend / copy link / revoke,
  owner-only), can read/write its files, and can launch + moderate its
  events (`canModerateEvent` covers the whole writing team — run == admin);
  rename / delete / member management stay owner-only. Access resolution is
  `getProjectFor` / `listProjectsFor` in `db/queries.ts` — a project you
  can't access reads as 404. `/api/invites/:token` (GET, signed-out) feeds
  the sign-up screen's "X invited you to Y" card; `…/accept` (POST) joins.
  DB-gated tests in `core/test/db.test.ts`, mail in `core/test/mail.test.ts`,
  link parsing in `editor/src/lib/invite-link.test.ts`.
- **Real-time co-editing on the SaaS path** (2026-08-27): server-project
  files are live CRDT documents (**Yjs** — pure TS, no wasm). The server
  side is `core/server/collab.ts` (`CollabHub`: one authoritative `Y.Doc`
  per open file, seeded from `project_file`, merged text persisted back on
  a debounce + flushed before event launch) behind
  `/api/projects/:id/collab/{stream,sync,update,awareness}`
  (`collab-api.ts`, same owner-or-member access as the files API) — JSON
  POSTs of base64 Yjs updates fanned out over one SSE stream per project,
  no WebSocket, matching the event plane's transport. The editor side is
  `editor/src/lib/collab.ts` (singleton per open project) + a
  `y-codemirror.next` binding in `Editor.tsx` (remote cursors with author
  names; undo via `Y.UndoManager` so ⌘Z never swallows a co-writer's edit);
  non-editor write paths (story-graph ops, format-on-save) fold through a
  minimal-splice diff (`replaceIntoYText`), and remote text reflects into
  the LSP index so lint + the story graph track co-writers live. Server
  files are live-synced (never "dirty"); a plain `PUT /files` is adopted
  into the live doc, and everything degrades to the old files API if the
  stream is unavailable. **Server projects also gained full file CRUD** in
  the editor (create file/folder, delete, rename — previously "not
  supported yet"), with `files` SSE events reconciling every co-writer's
  tree. Tested in `core/test/collab.test.ts` (hub merge/fan-out/persist,
  no DB needed).
- **Per-event branding** (2026-08-27): nothing story-specific is baked into
  the `play` client anymore. `/api/resolve-code` (and `ResolvedCode`) carry
  the event's display `title` — `EventRuntime.title` = the authored `# Title`
  heading in the source (`titleOf` in `server/views.ts`, file-separator-aware)
  falling back to the project name — and the join screens/`document.title`
  render it (a `?code=` QR link resolves it pre-join). `GuestView.factions`
  lists the public factions so the side-chooser / defect buttons are driven
  by the story's declarations, not a hardcoded Mods/Chatters pair.
- **Event plane**: one `EventRuntime` per live event under `/e/:eventId` (the
  extracted single-event server), an `EventRegistry` that rehydrates every
  non-ended event on boot, and `POST /api/resolve-code {code}` so a
  guest/performer/mod bootstraps from just their code. Per-event journals stay
  on disk under `LOOM_STATE_DIR/<eventId>`.
- **Run == admin**: an event's `/e/:eventId/api/mod/*` routes accept either a
  mod token or the owning author's BetterAuth session, so the author moderates
  from the editor's Run mode with no code to type. The `/api/mod/*` surface now
  also covers `say` (post to any room, as Operator or a character), `set`
  (edit a guest's score/faction/location/captured), `beat` / `signal` / `scan`
  (fire narrative), and `reveal` (expose a hidden faction). The old standalone
  operator console (`/console`, the vanilla `server/public/index.html`) was
  removed 2026-07-01 — moderation is Run-panel-only; guests + performers use
  the `play` app.

The Rust `server` crate (see below) is the older, separate multi-workspace
backbone; the SaaS lives entirely in the TS stack.

## Status

**Wave 21 — performers play, built 2026-10-23** (lanes
`oct31-w21/{core,terminal,play,story}` merged `--no-ff` into
`oct31-w21/integration`, then integration fixes (an actorless director
press of a player's button, an empty PLAYER SELECT pop-out, Clippy's `CI N:`
titles) and a live walk of Clippy's and Norton's booths on a no-DB scratch
server at phone width; **not shipped**; contract and decisions in
`core/examples/trapped-in-the-internet/SIGNOFF-w21.md`). The user's ask:
*"Clippy should no longer be considered a "super" user / host that can call
shots. Clippy and the AntiViruses are performers that are playing a game
just like the "guests" are … gamefied elements … a mission tab too, like
guests … they shouldn't have access to "all buttons"; their UI/UX should be
simple, like the guests"*, then: Clippy's 21 cues to the hosts + directors,
the three hosts keep their dock, performers get a Mission, a score, every
action as a pick or pop-out and ceremony awards, and *"They have a trust
score too, and can defect from Trabolta in sneaky or overt ways; Trabolta
has no choice but to continue to be "allies" with them"* (reverses wave
18's Q2 / Q39). **Language** (help `authoring/30-live-shows`,
`33-live-verbs`, `90-cheat-sheet`, `92-common-mistakes`): CHARACTER
`player: true` (`CharDef.player`), CHARACTER `private: a, b`
(`CharDef.privateSlots`: never in an agent request, `/api/agent/facts`,
`recent`, the dossier, a `watch:` / `badge:` / countdown or the screens),
header `stat: self.<path> as <glyph> <label>[, for <who>][, while <cond>]`
(`runtime/sim/stats.ts`), lints L1222 `PlayerCallsCue`, L1223
`StatLineInvalid`, L1224 `PlayerNotAPart`, L1225 `PrivateSlotRead`.
**Server:** `PrimeView.player` / `mission` / `stats`; a player booth gets
only its own buttons, guest-visible countdowns, no act letter, only its own
GROUP's staff rooms, never `calls` (`cueCallers` drops players) and no
`staff` lines on a press; `CastSummary.player`; the Trust Chart ranks each
player's `trust` beside the programs (`ScreenChartRow.staff`); a player's
agent request carries `speaker.player` + `them.ranges`, and `adjust`
`them.<slot>` moves a player speaker's declared slot; an actorless
`/api/mod/signal` of a player's button fires as a non-player it names, else
its one player, else 409 with the players. **Play** (help `play/07`, `14`,
`15`): a player booth wears the guest frame (▣ MISSION title bar, `⊞ ·
Mission · Chats · Scan`, the tray's ⭐ chip): Mission (the NOW card, big
buttons that open PLAYER SELECT / a target / the scanner or press a global
button, score tiles, Wanted / Wallet / Quest Log / Codex tiles, Also now),
Chats (Your move · Messages · Team · Rooms · Chat log; Readouts are 📋
Notes), a NEW MISSION pop-out, a plain Start menu + 👥 People; every booth's
guest card lost All buttons, Earlier readouts, the raw id and the gate /
value chips (hosts keep staff lines); `ClippyCueBar` → `CueBar`.
**Terminal:** 🛡 STAFF rows on the Trust Chart slide + cutscene, the
awards `award_staff_trusted` / `_points` / `_mole`. **Story** (all `//
DRAFT w21`): `TRAIT Player` (score, trust −100..100, private `covert` /
`caught`, `defected`) on Clippy (now `Greeter, Player`, out of GROUP Hosts)
and the four Antivirus; no admin cue names anyone; YOUR GAME IS ON
pop-outs; points per game act (stamped `Kernel.pressed_by`, so a host's
press pays nobody); trust movers; 🤫 quiet favours from the Truther
Download (look the other way, tip off, let a guess slide, slip 50
Truthcoin; every third caught: −20 trust + a private warning), 📢 Defect
openly (once, −50, a `!!` big moment, *Staff Defection* on the TV: he keeps
them); Whose Side Are You On objectives; G10a–c staff awards before G11
(The Mole last, `ceremony_done`; later cue numbers move down three);
stagehand `them_adjust` passes `them.trust` through. **Open:** the show
text awaits the user's sign-off (`SIGNOFF-w21.md`); McAfee's exchange pays
per 🤝 press only; no 🔍 report between players; the classic late-night
reflect estimate is 20472 of 20480 tokens; the bank, the Rust engine and
the TextMate grammar don't know the new keys; nothing on a real phone yet.
Suites on the integration branch: core 2661 (162 files, incl. Postgres),
play 1336 (139), editor 566 (69), terminal 865 (77), reinstall/web 538,
house 329 + 4 skipped, bank 148, stagehand 1040 + 2 skipped; loomcheck
`--smoke` 35 files · 0 / 0; the guest's first load 144.98 kB (gate 145).
**Deploy order (when the user says ship):** check the preview's roster
first; the server first (`ship.sh`; additive), then `sync-show` **with its
reload, before doors** (the composition changed), on the house Mac `git
pull` + `stagehand launchd restart --job agents` (persona + `them_adjust`),
Run → Mind → Reset; reload the terminals and the TV; reprint the cast packs
after the sign-off.

**Wave 20 — Trabolta's heart, the door sensor on the M4, the house lights,
built 2026-10-22 → 23** (Stage A lanes `oct31-w20/{platform,firmware}`
merged `--no-ff` into `oct31-w20/integration` (platform as
`platform-lights` 9e260c6b, `platform-choices` c243b195, `platform-screen`
7310b4ac; firmware 09b4f8f5), then Stage B `stagehand` (09232d65),
`story` (789ba15a), `terminal` (bf0f7b01), `mapeditor` (aae1ac57) and
`editor` (654d4bdc); then an integration round (a live walk on a no-DB
scratch server, a cross-lane wire review and an adversarial review: 26
findings, 20 fixed in 21 commits to bad9a7ce, 3 accepted with a contract
note, 3 left open) and the docs; **not merged to master or shipped**;
contract `core/examples/trapped-in-the-internet/CONTRACT-w20.md`, status
OCT31.md §5 *Wave 20 status*, sign-off `SIGNOFF-w20.md`). The user's asks:
*"Trabolta should have a very dramatic sequence if you get into the Server
room. There is a door sensor (LDR + LED -- the door is "closed" when the
LED is shining on the LDR, which reads about max value on an Arduino). When
you first open the room, his special cutscene plays in the server room. He
asks you to close the door, which you must do before continuing. Then,
it's a multi-layer discussion similar to the Master in Fallout 1 -- you may
be able to convince him to shut himself down, or not. In the server room is
Steph's laptop with an Arduino plugged into it (Grand Central M4) -- the
door sensor is connected to it. This should transmit to the Loom server.
There is also a RGB Zigbee bulb in the room which should be controlled for
great effect. A monitor and mouse are used as the "terminal" / Trabolta
face -- the user scans their pass on the webcam so that Trabolta knows who
it is. We currently don't have a way to place lights in the map editor, so
make sure that can happen so we can actually get the home automation /
Zigbee stuff working. I've got a Zigbee2MQTT dongle: … TI
CC2652P+CP2102N … Preloaded Z-Stack 3.x.0 Firmware"*, mid-design *"there
will also be a keyboard for typing -- there should be an opprotunity to
have a true heart to heart with the Trabolta AI. With a special prompt that
includes the guest's history, we can allow players to truly chat with
Trabolta, who is ostesenbily fully aware of his reality and the bleakness
of it"*, and the correction *"Trabolta lives in the MapsAndDucks universe,
not ours. He doesn't know who John or Steph or Jesse are. Trabolta lives in
Halifax."* **The door** (`hardware/server-room-door/`, the terminal's
`src/serial/`): an LED into an LDR in a shroud tube on the **Grand Central
M4** (12-bit, `mod` lit − dark with the LED on D2 or `steady` with it on 5V,
hysteresis + debounce, faults `ldr_saturated` / `led_dead`, the warning
`ldr_open`, calibration in flash, JSON lines at 115200; w20b: the build's
`LED_MODE` picks `steady` (the default, the LED on 5V as wired today) or
`pulsed` (`mod`, the LED moved to D2), firmware `door-m4 1.1.0`), read by the
server-room terminal over **Web Serial** (`door=serial`, ⚙ *Connect door
sensor* + two calibrations; `door=sim` O / C / F), posted as
`door_sensor_opened` / `_closed`, reconciled against `night.server_door`
every poll, nothing in a blocking fault; the story follows the 🚪 buttons
instead once one is pressed (`Night.door_override`) until 🚪 *Trust the door
sensor again*; the ESP32's door rules left the YAML (D16), and since w20b
(Q7) no ESP32 is installed: the M4 is the room's only electronics, the patch
bay is judged and pressed by the Antivirus watch's `radio_*` cues and the
siren is the router's. **The Heart**
(`beats/server-room.loom`, `main.loom`; help `authoring/38-server-room`,
`11-choices`, `19-directives`, `33-live-verbs`, `44-mind-debugger`,
`play/09-terminals`): sealed → **The Heart** on the first opening once he is
awake (a quiet notice, the terminal in red, *Close the door*; nags at 15 s,
then every 20 s) → **Heart Sealed** (*show it your pass*) → a scan with the
door shut → four layers (WHO ARE YOU · WHAT I AM · THE ARGUMENT · THE ASK)
docked in the program's `dm:Trabolta` as **guarded choices** (a new engine
feature, `+ (if <cond>) ⟦TAG⟧ text`, lint L1221) and clicked on the
terminal; ⟦PROOF⟧ (*What Sandy Says* / *The Sandy File* not from him) + one
more point opens the ask; suspicion warns at 50 and throws them out for the
night at 80, which **marks** them for reinstallation once (w20b Q2, Heart
Mark; a barred re-scan never marks again, so a host's 🩹 holds); a convince
works **at any hour** (w20b Q4: Heart Not Yet / Heart Call deleted) into
**Heart Shutdown**, and the night ends only when a director presses 🕊
`talked_down` (w20b Q3: `Night.heart_autoend` off by default, the cue
`urgent:` at the head of NEXT); a door opened mid-talk freezes it; one heart at a
time; `stand_down` deleted. **Menu ids** (`GuestView.choices`,
`/api/guest/choose {index, text, choice}`, 409 `moved`) let the terminal
answer the heart's menu past a stale one. **The heart to heart**: a
keyboard, ⟦SPEAK FREELY⟧ / ⟦BACK⟧, the persona's *heart to heart* block
(`max_sentences: 4`, `acts: none`), the guest's **dossier** on the agent
request (`core/server/agent-dossier.ts`, *WHO THIS IS — TONIGHT*), and the
fiction boundary (the persona's `outside:` list withheld from his output;
no heart line names the crew, the show or its kit). **Screens**: `cue
room_<x>` → `room.cue` on that room's terminal, 10 heart scenes, the door
overlay, the face's `dying` mood. **Lights** (help `39-house-map`,
`scripts/house-macbook/{zigbee,lights}.md`, `docs/loom-reinstall.md`):
`lights.json` (`@loom/house` `lights.ts`, `core/server/lights.ts`
`LightsHub`, `/api/mod/lights*`, `LOOM_LIGHTS`, `sync-show --keep-lights |
--replace-lights`), the server room's RGB bulb (the room's only light, so
its safety fixture: never off, never under 80 / 254 since w20b Q6 / Q10) and 13 `heart_*` looks, the stagehand **`lights`**
module (Z2M / WLED, steps, `then: "restore"`, test / identify / pair, the
catch-up from the screen state, `health/lights`), the map editor's 💡 Light
tool + 💡 Lights tab, Run's 🚪 badges and 💡 row. **Decisions taken for the
user (vetoable):** CONTRACT-w20 §0.2 D1–D22 and §7 D23–D29, all in
`SIGNOFF-w20.md` §1: D1 the Web Serial bridge (no edges in a fault; a 🚪
press takes the door), D2 the M4's mode (w20b: the build's `LED_MODE`,
`steady` by default), D3 the story owns the tree (suspicion 50 / 80; w20b:
a convince at any hour, the night waits for 🕊), D4 room cues instead
of beat moments, D5 `lights.json` beside `audio.json`, D6 the `lights`
module, D7 lights in the map editor, D8 Run's badges, D9 guarded choices,
D10 the bulb in `lights.json` (w20b: the group's only member, so it
stays), D11 the RGB bulb is the room's safety light (w20b: no strip, floor
80), D12 thrown out marks (w20b, reversed),
D13 `stand_down` deleted, D14 a phone pick counts only at the heart, D15 /
D18 menu ids, D16 the ESP32 stops reading the door (w20b: not installed at
all), D17 the keypad unchanged (w20b Q9: it keeps the door locked), D19 the sensor and the buttons never fight, D20 restore looks,
D21 the lights catch up from the story, D22 door chatter limited, D23 a
keyboard at the heart, D24 the heart to heart is a mode of the tree, D25
its prompt inside his world, D26 the dossier, D27 the worker reads it, D28
the terminal's composer, D29 the fiction boundary (`outside:`); and the
integration's (§8): after Leave the leash is 30 s until the
program types, no fault text on the guest's screen, a bare *John* is not
caught. **The user's answers (2026-10-23, wave 20b,** lanes
`oct31-w20b/{story,firmware,lights}` merged `--no-ff` as 0aa2bfe6,
2344ce2f, 769e466c, then a review + docs pass**):** Q1 *"I will review -
ship for now"* (the DRAFT lines ship; new ones `// DRAFT w20b`); Q2 *"Yes,
it should mark them"* (the throw-out marks once through Heart Mark; a
barred re-scan never marks, so a mark a host lifts with 🩹 stays lifted);
Q3 *"leaning towards the directors sign-off required"*
(`Night.heart_autoend` false at Power On; Heart Shutdown tells `# hosts`
the night ends on 🕊 `talked_down`, which is `urgent: true` and jumps to
the head of NEXT while live: a new INTERACTION key, `InteractionSummary` /
`CueInteraction.urgent`); Q4 *"Yes"* (a convince ends in Heart Shutdown
at any hour; Heart Not Yet, Heart Call and `heart_called` deleted; the
`heart_notyet` look and terminal scene stay defined, unused); Q5 *"on 5V,
actually, but it could be on a digital pin"* (the firmware's `LED_MODE`:
`LED_STEADY` default, `LED_PULSED` for D2, `door-m4 1.1.0`; a calibration
stores the mode the board read in, and a wave 20 calibration is not
re-sent after the reflash: calibrate again in ⚙); Q6 *"No strips in the
server room, just the one RGB bulb"* (every `wled/server` rule gone; the
bulb is the room's safety light, floor 80 / 254); Q7 *"No, just the Grand
Central M4"* (no ESP32; `hardware/server-room/` not installed, the patch
bay by the watch's radio cues, `scripts/accept/K-05.sh` presses 🔌 unless
`ESP32=1`); Q8 *"No, keep it simple"* (D14 kept); Q9 *"Yes the keypad keeps
the door locked"* (D17 kept); Q10 *"Yes, only one RGB bulb"* (the
`server_room` group's lines left the YAML; `lights.json` names the bulb).
**Deploy order:** check the preview's roster first; the server
first (`ship.sh`; additive); on the house Mac `git pull` and `stagehand
launchd restart --job show` **before** the sync (no old door rule may post
`server_door_opened` into the new story); `sync-show` **with its reload,
before doors** (+ `--replace-lights` if the project already holds a
`lights.json`) and restart every other non-ended event; `stagehand
launchd restart --job agents`, Run → Mind → Reset; Zigbee2MQTT on the
CC2652P (`adapter: zstack`, keep an existing `data/`), `stagehand launchd
install --job lights` before pairing, `stagehand check --only lights`,
pair the bulb as `server_room_rgb` (`power_on_behavior: on`), place it in
the map editor, ▶ Test, Save to project; Steph's laptop: flash the M4
(1.1.0, `LED_STEADY` while the LED is on 5V; `LED_PULSED` once it moves
to D2), `N-20.sh`, the kiosk profile once without `--kiosk`
(`/terminal/?code=<mod>&spot=server-room&door=serial&camera=user`), grant
the port, **calibrate in ⚙ (always after a reflash)**, relaunch
`--kiosk`; a real open → shut → open on Run → Terminals, then 🔄 (and 🚪
Trust); reload the other terminals and the TV; reprint the server-room
Antivirus packs, the patch-bay watch, the emergency card and all-crew
after the sign-off. **Open:** the show text and the `outside:` list await
the user's review (Q1); the phone docks a person's *oldest* menu, so a
heart menu behind a stale one is answered at the terminal (the editor's
Run doesn't send `choice` yet, and `ModView.choices` lists only each
person's oldest menu); Combo A plays the shutdown light but no room scene,
and a lights catch-up after it replays the 12 s fade; the late-night
reflect estimate sits just under the 20480-token context; a stale door
calibration shows only in the terminal's ⚙ (*⚠ calibrate again*), not on
the heartbeat or Run → Terminals; the bank, the Rust engine and the
TextMate grammar don't know guarded choices or `urgent:`; device-only: the
M4 on the real frame (steady mode near the red bulb, the cell's lag, the
real settle time; pulsed mode catches a dead LED only with the sense
wire), Web Serial on the laptop after a sleep and a replug, the webcam in
the server room's light, each look on the real bulb incl. the 80 / 254
floor on the darkest looks (HW-LIT-10), the CC2652P's reach to the
basement. Suites on `oct31-w20/integration` after the 20b docs pass:
core `tsc` clean, core 2630 (160 files, incl. Postgres, run alone), play 1317 (137), editor 566 (69), terminal 861 (77), reinstall/web 538 (41), house 329 + 4 skipped, bank 148, chess 23, stagehand 1035 + 2 skipped, the door firmware 283 host checks; loomcheck `--smoke` 34 files · 0 / 0, `titi:facts --check` up to date.

**Wave 18b — rehearsal fixes, founded factions, results on the screens,
the house router, built 2026-10-22** (Stage A lanes
`oct31-w18/{engine,server,termbase}` merged on `oct31-w18/integ-a`, then
with the tent lane `oct31-w18/tent` to master as c98759ec and **shipped
as `w18b-1021`**; Stage B lanes
`oct31-w18/{show,ending,factions,play,editor,screens,audio}` merged
`--no-ff` in that order into `oct31-w18/integ` (8c7bc0aa … 1b2527b9),
then the contract's §4.6 hooks and the integration fixes, cross-lane
tests (`core/test/w18b-integ.test.ts`), a live round on a no-DB scratch
server (18 / 18) and the docs; **Stage B is not merged to master or
shipped**). The user's answers to the wave 17 questions and two batches
of rehearsal notes: the router plays *"sounds + announcements"* through a
*"MOTU 828x + an ADAT expander"* (no QLab; the `alexa` player retires),
Telephone, the Are You Sure piñata, Back To The Heart and clearance's
*the house is open* line *"are actually no longer part of the event"*
(the rooms still open), *"the laptop in the internet is both the terminal
& reinstallation wizard"*, *"verdict scene and all scenes like it should
show results, and Trabolta should be primarily judging results"*, a *stop
all house sounds* control, tablets saying announcements *"just an
option"*, and *"enable people to start their own factions that they win
the codes if they get a majority of people"* (any program founds; a
founder sees only their own count and how many more they need), plus a
scan that says it worked, a confidence that must be set, Trabolta reading
round two's filings, Broken Ask Jeeves' transfer, an ending monologue,
overlapping relationship facts, a typed left-behind, no *Trapped In The
Internet* chat room, a CRA-audit note to both parties, 🚻 beside names in
Bathroom Mode, marked-only reinstallation at every entry point, Clippy's
new opening, *Jean Trabolta, Sole Owner and Founder of Maps and Ducks …
the world's first AI small business owner*, his green grin that breaks
when trust is low, Truth or Dare after the first reveal and *Facts Are
Currency* counting found facts. The follow-up answers (2026-10-21): O2 at
⚖ the TV shows the true answers **and** names the programs who lied (TV
only, never before ⚖, never on an agent path); O4 **every non-exact
filing** goes to Trabolta's AI judge; O5 *trust* is his Trust Chart
score (the picture breaks while more than half the cleared programs
still here are below 0); O7 founding opens **at the Truther Download**
and stays open until a faction wins (the majority still counted only in
the Y2K hour); O3 / O6 defaults kept; O1 open. **Engine** (help
`authoring/30-live-shows`, `32-chat-rooms`, `33-live-verbs`,
`45-currency`, `90-cheat-sheet`, `92-common-mistakes`): `reveal …
quietly`, `codex_in.<category>`, `names()`, header `badge:` (L1219),
`lobby: hidden`, `founding:` faction mode (one race, exclusive
membership, `joinCrew`, the faction builtins, `ModView.race`, L1220),
approver `as` / `audit` → step `flagged`, `avatar: picture:… when …`.
**Server** (help `36-widgets`): the results block
(`do fact_read` / `do fact_truth` → `ScreenState.results`, rows and
stamps on the TV, the answers + liars at ⚖ on the TV only), the judge
queue (exact = at once; one frame out per worker, voice first, the
settle's fallback, the stall line), the spatial gate on every entry
point (`mayPlay`, `leave unmarked`), scan answers, the flagged wallet
card, `picture:` serving, race sides and reading-beat lines kept from the
agent, `POST /api/mod/audio/stop`, `device.expect`, `announce.terminals`.
**The tent laptop** (help `play/09-terminals`, `play/11-reinstallation`,
`authoring/39-house-map`, `docs/trapped/kiosk.md`): `view=reinstall`, the
idle show + scan box + the wizard and the game in one device, an unmarked
pass refused with NOT MARKED, overlays holding a walk. **Stage B — the
show** (all `// DRAFT w18b`): §4's fixed texts (Clippy's opening, the
introduction, the DM hello, the online broadcast, truth.txt, the
recount, the persona), Question Results / Round Two Tally / The Verdict
read by Trabolta with a 34 s hold for the TV's pages, 🍾 after 📋×3,
Telephone / piñata / Back To The Heart gone, `reveal … quietly` at
clearance, `lobby: hidden`, `badge: program.afk as 🚻 Bathroom Mode`,
MyCRA, `Trabolta.broken`, the founded race from 📥 (🧾 deleted, 🗳
`force_their_majority`, *A Faction Of Your Own*), `left_behind_text`, Facts
Are Currency by category, the 16 ties (`codex/85-ties.loom`, Connections)
+ The DSL Line + Program Briefing, The Night In Review before every
ceremony + a private Your File (`beats/review.loom`), Jeeves' *What
happened on the line* / *Glitch menu*, *Who you know* in every pack that
holds a tie. **Play** (help `play/02`, `06`, `08`, `10`, `12`–`17`): the scan
dialog, the required confidence, 🚻 badges, the flagged transfer, no Chat
log row, 🔇 on the host dock and the director phone, Trabolta's two
pictures, the Judge tab, **Factions** (one list, your own count only,
Join / Switch / Disband, ＋ Found, the Mission tile). **Screens**: the
results scenes (hunt_results, the tally, the verdict), Final Assessment,
the recount / purgatory numbers, the owner-only naming before the
introduction. **Router** (help `39-house-map`,
`scripts/house-macbook/audio.md`, `docs/trapped/room-audio.md` §12): the
show's sounds + announcements through the 828x, placeholders, the stop.
**Editor** (help `43-run-mode`): ■ Stop house sounds, the House sound
card and the tablets list, 📢, the race glance, the Judging card's
queue. **Decisions taken for the user (vetoable):**
`core/examples/trapped-in-the-internet/SIGNOFF-w18b.md` §1 D1–D30 (D8,
D10, D11, D13 b, D14 and D23 carry the user's answers), plus integration's
own: the verdict's 34 s story-time hold before the ending
(`Kernel.verdict_wait` / `verdict_end`; a second ⚖ meanwhile only tells
`# hosts`), the narrow announce route (`POST /api/mod/audio/announce`,
the list kept as `audio-announce.json` until Save to project), the
ceremony cue at the head of The Ceremony. **Deploy order:** check the
preview's roster first; the server first (`ship.sh`; Stage A is already
live as `w18b-1021`, the rest is additive); then `sync-show
--replace-maps --replace-audio` **with its reload, before doors** (the
story text changes what an old journal replays to; merge any speaker
survey saved to the project into the repo's `audio.json` first) and
restart every other non-ended event; on the house Mac `git pull`, retire
the `alexa` job and install the router's (`stagehand sounds
placeholders`, `stagehand check --only audio`, `stagehand launchd install
--job audio`, per `scripts/house-macbook/audio.md`), `stagehand launchd
restart --job show` and `--job agents` (the persona, the mind file and the
judge prompt changed), then Run → Mind → Reset; reload every terminal,
the TV and the tent laptop (`/terminal/?code=<mod>&spot=tent&announce=1`,
Chrome `--kiosk --autoplay-policy=no-user-gesture-required`);
re-export the Quest APK; reprint the cast packs after the sign-off (and
the Bingo card without *Write every name down clearly*). **Open:** the
show text awaits the user's sign-off; O1 (that Bingo line is not in the
repo, probably only on the printed card); the ceremony slide shows when
🏆 is pressed, while the review is still read; `trabolta_heard` counts a
shared tie as a delivery (up to 16, +2 truth each); the 34 s verdict hold
pauses with the clock; *EVERY ANSWERED FACT IS TRUE* with nothing
answered; the guest's first load is 144.85 of 145 kB; the orchestrator's
late-night reflect is ≈ 20471 of 20480 tokens; the judge queue has no
size cap (≈ 3 s a ruling on the house laptop: the K-04 / SW-AI-23 check);
the bank, the Rust engine and the TextMate grammar don't know the new
header keys (the bank warns `liveHeadersIgnored`); two scratch servers
rehydrated the dev events in `loom_dev` for a while (a no-DB server needs a
dead `DATABASE_URL`, not an unset one); device-only checks: the 828x on
the house Mac, the tent laptop's webcam walk, the phones' scan dialog /
required hint / flagged transfer / 🚻 / both pictures / factions, the TV
and an old wall reading results. Suites on `oct31-w18/integ`: core 2472
(149 files, incl. Postgres), play 1315 (136), editor 531 (66), terminal
792 (68), reinstall/web 483, house 250 + 4 skipped, chess 23, bank 146,
stagehand 905, VR 730 + `quest.sh` 27; loomcheck `--smoke` 0 / 0 (34
files), `titi:facts --check` up to date, K-14 OK.

**Wave 19 — the voice link + the in-headset program picker, built
2026-10-21** (lanes `oct31-w19/{house,server,terminal,web,vrvoice,vrlobby}`
merged `--no-ff` in that order into `oct31-w19/integration`, an integration
round (a live headless Godot run: a playing generator refuses
`clear_buffer`), a live round with the real clients (49/49), then a
six-lens review whose 33 confirmed findings were fixed with one directed
design change, D5b; **not merged to master or shipped**). The user's ask:
*"let's perfect the terminals / reinstallation game -- basically we should
be using the microphones of both the terminals and reinstallation games so
that each can "hear" eachother, just like the videos -- people in the real
world can be heard on the virtual terminals in the games through the
terminal mics, and the guests in the reinstallation games can be heard on
the terminals. remember that the reinstallation latop is also the terminal
in the tent, so this one doesn't have this communication. also it should
be easy to select your program in VR - you shouldn't need the tent
laptop/terminal to log into the VR. make sure this works in Godot editor
too - right now I'm not really able to test unless I do a full build and it
put it on my headset."* **The wire** (`docs/loom-reinstall.md` §2.4,
`@loom/house` `house/src/voice.ts`): G.711 μ-law, mono, 16 kHz, 200 ms
chunks POSTed raw to `/api/spatial/voice` and fanned out by the server over
one SSE stream per device (`/api/spatial/voice/stream`, `hello` / `listen
{on, ears}` / `voice` / `bye`); memory only, never journaled, ignores a
pause. **The server routes** (`core/server/spatial-voice.ts` `VoiceRelay`,
off every pose and spot): a player hears the 4 nearest voice-on terminals
within 12 m on their floor, a terminal the 3 nearest players within 8 m;
gain 1 in the same room (fading over the reach's last 1.5 m), else
`0.5 · (1 − d / reach)`; a route already formed is kept 0.75 m past the
reach (no flapping on pose jitter); only a terminal whose stream says its
mic can be heard counts among a player's ears (`?mic=&hear=`); a stream
64 KB behind skips voice and is dropped once stalled; the newest stream
wins. A source uploads only while someone hears it. **The tent** is out:
`voice: false` on both show maps, and unset in the spawn room is off; the
server refuses it (403 `voice is off at this terminal`). **Terminals**
(`terminal/src/voice/`): mic + speaker on every placed view but the TV (a
speaker, its mic off) and the mirror; ⚙ / URL `mic` / `voices`; the 🎤
on-air cue; Run → Terminals' 🎤 column (`mic=live|muted|denied|insecure|
locked|off`). **Half-duplex in software, different on each end (D5b):** a
terminal **holds** its mic while it plays a player, speaks or plays a sound
(+ 300 ms, the chunk span and the output latency); a game **raises** its
gate to −28 dBFS while a terminal plays there instead of closing it, so a
player who speaks up over a room that never goes quiet is heard at once,
and the terminal, playing them, holds — the floor goes to the player when
they speak (found live: a hard hold on both ends let a loud room keep the
floor for good). **The web game** (`reinstall/web/src/game/voice.ts`): off
by default (it runs on the tent laptop), `voice=1` on another device;
voices panned at each terminal's screen. **VR** (`reinstall/vr/net/
voice_link.gd` + `voice_codec.gd`, diffed against the goldens):
`AudioStreamPlayer3D`s under each terminal, **B / Y** (M) mutes, the
RECORD_AUDIO grant asked in the lobby. **The in-headset picker**:
**PICK YOUR PROGRAM** picture tiles driven by a controller laser, the
sticks or the mouse, *Start as X? [START] [Back]*; **SET UP THIS HEADSET**
(the moderator passcode on an on-screen keyboard, saved to
`user://station.json`, never `res://`; a passcode that stops working brings
it back; PLAY OFFLINE on a desktop run only; ⚙ *Forget this setup*, 5 s on a
headset); F5 from the Godot editor reaches SET UP / the lobby with no
script errors, *This computer* (`pnpm dev`) first, the Mac's mic on, the
desktop rig (Debug → Customize Run Instances for args: `reinstall/vr/
README.md`). Help: `play/09-terminals` (*Hearing each other*),
`play/11-reinstallation` (*Talking to the house*, the lobby),
`authoring/43-run-mode` (the 🎤 badges). **Decisions taken for the user
(vetoable):** D1 plain HTTP, no WebRTC / WebSocket; D2 μ-law 16 kHz 200 ms;
D3 the server routes; D4 upload only while heard; D5 an open mic behind a
−42 dBFS gate, half-duplex in software; **D5b** the terminals hold, the
games barge in at −28 dBFS; D6 B / Y (M) mutes; D7 a spot's `voice`,
unset = off in the spawn room; D8 the web game off by default; D9 the
views' roles, the TV's mic off; D10 no game-to-game voice; D11 voice
ignores a pause; D12 the picture-tile picker; D13 the in-headset setup; D14
editor runs. **Deploy order:** check the preview's roster first; the server
first (`ship.sh`; additive), then `sync-show --replace-maps` so the tent's
`voice: false` reaches the project (the spawn-room default already covers
it); reload every terminal and the TV and touch each tablet once (its 🎤
must not read *tap*), reload the tent tablet; re-export + sideload the
Quest APK (it now asks for the microphone, in the lobby: allow it); Fully
Kiosk *Enable Microphone Access* on each tablet. **Open:** device-only
checks — real microphones, room levels against the −42 / −28 dBFS gates,
echo with the mic open, the Quest prompt, Fully's microphone setting,
Safari 14's capture, the oldest tablets' output level with echo
cancellation / AGC off, an F5 with a window and the macOS microphone
prompt; a full keyboard for the headset's NAME field (not built: the
default name carries the station's hex); game-to-game voice (D10, not
asked). Suites on the integration branch after the fix round: core 2328
(142 files, incl. Postgres), house 248 + 4 skipped, terminal 726 (62),
reinstall/web 450 (34), editor 485 (59), play 1235 (128), VR 729 +
`quest.sh` 27; `pnpm --filter @loom/house sync` leaves no diff. Live on a
scratch server with the real clients (headless Chromium, fake-mic files):
the backyard terminal on a continuous loud tone and the web game talking
3 s in 6, 13/13 — the player heard while the room plays to it, the terminal
silent while it plays the player and back 667–727 ms after each burst.

**Wave 18 — the Play app plays like a game, built 2026-10-21** (lanes
`oct31-w18/{core,crews,story,moments,guest,booth,host,edges}` cut from
38fd7be, merged `--no-ff` into `oct31-w18/integration`, then a fix round of
33 commits over six testers' 85 findings (guest night, booth night, an
adversary, the navigation matrix, old devices, a code review: 82 fixed, 7
of them partly, 2 not reproduced, 1 deferred), then `oct31-w18/docs`; **not
merged to master or shipped**). The user answered all of `SIGNOFF-w13.md`
and asked: *"the app is bloated, and its hard to tell what to do or what
chatrooms to go into. Big decicions (like Clippy giving out the bingo medal)
need to be large popups that are un-ignorable. When a program is marked for
reinstallation, the UI for the antivirus should be easily accessible and
clear - pop outs are your friend here. We want to minimize the hosts and
antiviruses need to be scanning guests"*, then *"the Play app should feel
more like a game than it does now for everybody"*, and that alerts' buttons
must land on the moment's place, never the story-named room, and the tab be
called *Chats*. The sign-off answers that changed things: Q1 (hosts call the
event equally), Q2 (Clippy is a super-performer), Q3 (a notifications tab
with funny delete dialogs), Q16 dropped (the reinstallation is a party
favour after the end), Q21 dropped (rethink factions: spin-offs,
recruiting, a surreal direct join, keep the profile), Q26 dropped (Windows
Defender leaves the show), Q30 reworded (a mark doesn't hinder until the
Antivirus confront them), Q37 / Q38 kept. **Language** (help
`authoring/31-broadcast-improv`, `46-objectives`, `30-live-shows`,
`33-live-verbs`, `36-widgets`, `90-cheat-sheet`, `92-common-mistakes`):
`reply !!…` / `broadcast "!!…" to everyone with close: 6s` / `show … with
moment: big` (big moments), `with go:` exits after a quoted text (never
`lobby`), OBJECTIVE `go:` / `target:` / `pick:` / `evergreen:`, header
`wanted:` / `reinstall:` / `archive:` / `majority:`, `by:` on an admin cue (a
booth's 🎤 cue bar), the crews events `founded` / `join` / `recruited` (`by`)
/ `unaligned`; lints L1214–L1218. **Guests** (help `play/15-mission`,
`02-rooms`, `16-notifications`, `17-sides`, `01`, `04`, `06`, `08`, `10`–`12`):
**Mission** is home (the NOW card, its Where row, big buttons, *Your move*,
the desktop tiles, *Also now*; *▣ MISSION* in the title bar), **Chats**
(fixed sections, one yellow dot, the lobby as the far-away **📜 Chat log**,
archived threads), your picture → **Me** (badges, settings), the **Recycle
Bin** of notifications (Clear all, the delete gags), **big moments** (the
Setup Wizard, un-ignorable, cards answered inside, a self-closing house
cheer), exits on every alert and push tap, the five-step tour, sides
through **doors** (`show sides`), **recruiting by pass**, guest-founded
**crews**. **Booths** (help `play/07-performers`): pop-outs (one at a time,
*Later* → the 🔔 Waiting window, never over a card's face), the Antivirus'
**🚨 WANTED** pop-outs + **Wanted board** (claim / hand back / take over),
the **confrontation** screen (CORRUPTION DETECTED → one-tap 🛡 → CAPTURED),
the shared **door queue**, **PLAYER SELECT** / rows / the bottle's target
pop-out, Clippy's **🎤 cue bar**, 🗂 Guests tabs, *Chats* + the Chat log.
**Hosts** (help `play/14-hosts`, `13-director-phone`, `authoring/43-run-mode`):
the **caller claim** (📣 I'll call, *Who's calling*, Run's Calling, the phone's
☰), *Fire anyway?*, NEXT's description + *then:*, LAST's *did:*, the watch
values, the Judging switch, Needs' escorts row, More in Night / House /
Setup (crews). **Story** (all `// DRAFT w18`): Q30 (the mark is a minor
line; `wanted:`, the claims, the confrontation, the capture and release as
big moments; Q35 superseded), Q26 (the door queue, Windows Defender and
Hold The Door deleted), Q16 (`reinstall:`, the party favour), `by: Clippy`
on 21 cues, `go:` on every guest objective and house alert, `pick:` /
`target:` on the booth objectives, Act II's NOW beat by beat, `archive:`,
the leaders and `majority:`, the recruit quest steps, the Q1 / Q2 copy; Q37 /
Q38 signed off. **Edges:** the tablet's *Marked program detected* / *Party
favour unlocked*, VR's lobby tags, the TV's and walls' *Congratulations!*
for a house win. **Decisions taken for the user (vetoable):**
`core/examples/trapped-in-the-internet/SIGNOFF-w18.md` §1 Q1–Q60 (§2 lists
every changed show line, old → new). **Deploy order:** check the preview's
roster first; the server first (`ship.sh`; additive), then `sync-show`
**with its reload, before doors** (the composition changed), restart any
other non-ended event, re-export the Quest APK, reload the terminals, the TV
and the tent tablet, reprint the cast packs after the sign-off
(`cast-packs/performers/windows-defender.md` is deleted; the four Antivirus,
Clippy, the hosts, all-crew, the Installation Wizard, the crew cards and the
two leaders' sheets changed). **Open:** the show text awaits the user's
sign-off; the bank, the Rust engine and the TextMate grammar don't know the
new keys; the King's chess still refuses only a restricted program (a
marked or captured one may play); a stale capture big arriving live is not
retired; a late-night booth snapshot carries the Wanted rows every frame
(deferred, the K-32 gates pass). Suites on the integration branch after the
fix round: core 2304 (139 files, no Postgres), play 1212 (127), editor 482
(59), terminal 662 (53), reinstall/web 419 (33), bank 145, VR 463 +
`quest.sh` 26; loomcheck `--smoke` 0 / 0, `titi:facts --check` up to date;
the guest's first load 143.87 kB (gate 145).

**Wave 17 — terminals come alive + house speakers, built 2026-10-21**
(Stage A lanes `oct31-w17/{core,tfound,router}` merged `--no-ff` as
dd350aa, 00931fd, 4511054; Stage B lanes
`oct31-w17/{attract,tv1,tv2,tv3,mapaudio,glue}` as 4f82384, bee10c4,
d201d6c, 151a1b9, 23d5654, 38fd7be; then `oct31-w17/integration` (a live
TV run, old-browser and lore reviews, 35 findings fixed in 29 commits)
merged as 6d01848, then `oct31-w17/docs`; **not shipped**). The user's asks: *"the cutscenes are extremely barebones
-- they should be extensive with animations and sounds and popups. Right
now most of the time the terminals just show a "scan your id" screen when
it should really be a lot of random ads / screensaver / popups. The
terminals should feel a lot more interactive. They should also be full
screen by default. The main terminal (the TV in the living room) should
have very elobrate animations for all main beats / events."*, *"we will be
placing speakers ALL over the house -- the map editor should allow for
placing these, and mapping through the audio interface (16 in + 16
out)"* (the inputs carry the house Mac / QLab outputs, microphones and
other devices; the house Mac plays the story's sounds out of chosen
outputs, routed by room from the map) and *"the terminals (tablets, laptop
for the the Internet) can also output sound via their speakers, but all
major announcements and other sfx comes out of speakers"*. **The idle
show** (`terminal/src/idle-show/`): 9 screensavers (Mystify kept, starfield
warp, pipes, the *Maps and Ducks 98* bouncing logo, flying windows, code
rain, a maze, Beziers, a duck pond), 54 ads in 14 skins and 49 popup kinds
with popup storms, on a pure seeded schedule (segment `i` = the terminal's
name + `i` + the pool; the place kept in sessionStorage, so a reload never
restarts at ad 0), six pools by `night.phase` (the hijack doubles the
popups), the character's own copy only once he is introduced and awake;
taps all do something (× sometimes spawns two more, button gags, the
saver pokes, TOUCH ME after 30 s untouched, never on the TV). An awake wall
terminal that is not piloting plays it with the **corner scan box**
(`ScanBox.tsx`, `scan-copy.ts`: the live camera, reticle, SCAN YOUR PASS,
*open 🎟 Pass on your phone*, the typed fallback; popups never land on
it, the scanner keeps decoding under a storm); asleep terminals and the
TV's attract play it full screen. **Cutscenes** (`terminal/src/cutscene/`):
a `SceneDef` fires on a slide cue or a screen-state moment, keyed on its
`seq` and drawn from server time (`clock.ts`, ≤ 30 fps, paused while
hidden; a reload resumes, history never replays), picked by the pure
`pick.ts` (overlays win, one moment at a time by priority, a moment older
than 30 s skipped, a `namesCharacter` scene never before the
introduction), rendered by `CutsceneLayer.tsx` in the slide's slot over a
t-driven `kit/` (Win98 windows, Typewriter, ProgressBar, PopupStorm, Bsod,
Particles ≤ 400, Confetti, Starfield, `useSfxCues`), the TV face's
one-shot `FaceHandle.flash`; a lazy chunk; `?preview=<id>&t=<ms>` /
`?preview=list` scrub any scene on a fake state. **64 scenes** in
`scenes/{act1,act2,act3,moments}.tsx`, each with an elaborate TV take and a
lighter wall take (but the four `play_on_the_screens` clips, wall only,
and the chess corners for a lost or drawn game, TV only): Power On, the summons, Bingo, the first reinstallation,
**the Trabolta Introduction** (27 s: a BIOS POST → the face assembling →
HELLO, PROGRAMS. → a setup window → his logo), the hunts, the results, the bottle's spin landing on
`night.bottle_pick`, the ad hijack's 000. 000. 000., the Truther Download,
Truth Pong, the round-two tally, the live Trust Chart with motion, the
jammed printer and the beans, the zip, the overshare scenarios, the Y2K
clock's escalation, the majority's frost (nothing named), The Heart, the
King hit / fallen off the shared bar, midnight, the final reveal,
bobbing, truth.txt typed in Notepad, the verdict, the song, Grok Prom, the
rave, the advice poll on the live votes, banishment, the hand jive, the
ceremony and every award with the winner's name, the resurrection, the
golden duck (kept → GERALD CAN'T HELP) and the four `play_on_the_screens`
clips. **Screen state** (`core/server/routes/screen.ts`, additive):
`moments` (≤ 12 live house-wide beats, the admin cues the story took, `do
pick` draws, device signals, reveals, the duck's find; `who` only on picks and
their verdicts, devices and finds) and `night` (allowlisted public `Night.*` incl.
`bottle_open`, `results_q`, `ended`, `collection_complete`, `scenario`,
the award winner only under an `award_*` slide); the heartbeat
`terminals` list left the answer (Run → Terminals reads it off
`/api/mod/screen/terminals`, which gains `fullscreen` off the poll's
`fs=1|0`). **Full screen by default**
(`terminal/src/fullscreen.ts` `KioskFullscreen`: a request on every
gesture, the webkit spellings, Fully Kiosk's JS interface, Chrome
`--kiosk` / F11 / a Home Screen app counted as full screen, config
`fullscreen` + a ⚙ toggle, `<html data-fullscreen>`); Run → Terminals
shows a red ⛶ for a terminal that is not. **The sound split**
(`terminal/src/sound/`): terminals play only synthesised WebAudio accents
(`sfx()`, 30 effects, no files), dropped while a voice speaks; the TV's at
0.35 and cut by the director's TV mute; a terminal never plays a story
`sound X`. **Speakers:** `audio.json`, a project file beside the maps
(`@loom/house` `house/src/audio.ts`: `AudioConfig` v1 — the device, 16
inputs, 16 outputs, speakers on room + position + yaw + outputs, zones, the
sparse input → output matrix, cues, announce and TV voice targets;
`validateAudio`, `resolveTargets`, pinned to the Python mirror by
`house/test/fixtures/audio-*.json`), served by `core/server/audio.ts` (a
director's save > the project snapshot > `LOOM_AUDIO` > a default 16 / 16;
`GET|POST /api/mod/audio` with a `base` → 409 and a long poll,
`/api/mod/audio/project`, `/api/mod/audio/test {speaker}|{out}`), and the
starter `core/examples/trapped-in-the-internet/audio.json` (DRAFT).
`sound X in <Place>` / `with rooms:` lower to `sfx` `rooms` args, directive
events carry `setting`, lint L1213 `SoundRoomUnresolved`. **The map
editor** (`reinstall/web/src/map/`): a 🔊 Speaker tool (place, drag, turn,
⌘D, Delete, arrows; the output badge and a coverage ring), a speaker
inspector, *+ Speaker here* on a room, and the **🔊 Audio tab** (the
device, inputs, outputs, the 16 × 16 matrix with per-cell gain, zones lit
on the plan, a cue's targets as chips for every story sound, the
announce + TV voice targets, 🔈 Test per speaker and output, a router
badge), with its own 409, Save to project, Download JSON and one undo
history for map + speakers. **The router** (stagehand `audio`,
`stagehand/src/stagehand/audio/`, launchd job `audio`): one duplex stream
on the interface, a numpy mixer (the matrix, a duck under announcements,
a limiter), story `sound X` from `sounds_dir` to the line's rooms, else
its `audio.json` cue, else the beat's setting, else everywhere; spoken
Test tones; `stagehand check --only audio`; opt-in: `play_sounds` and
`announce` both default false. Help: `play/09-terminals` (the idle show,
the scan box, the scenes, the sounds), `authoring/33-live-verbs`
(moments), `39-house-map` (*The house speakers*), `19-directives`
(*Where a sound plays*), `43-run-mode` (⛶), `docs/trapped/kiosk.md`,
`docs/trapped/room-audio.md` §11, `docs/loom-reinstall.md` §1.3 / §4.
**Decisions taken for the user (vetoable):** D1 the idle show is
client-side, the server's `attract` flag keeps meaning hidden / asleep,
and an awake terminal shows the idle show with a corner scan box; D2
cutscenes are keyed on the cue's `seq` and drawn from server time; D3
the screen state gains the moments ring + public night vars, with no
story edits; D4 terminals play only local WebAudio accents, story sounds
and announcements go to the house speakers, and the TV's sounds are quiet
(0.35) and follow the TV mute; D5 speakers live in `audio.json`, never
`house.audio.json` (a map variant) or the map (a speaker edit never bumps
the map version); D6 the router is opt-in (`play_sounds`, `announce`),
QLab and `alexa` stay the players until then, and `announce: true` beside
`alexa:` is refused; D7 full screen by default (the Fullscreen API on
gestures, Fully Kiosk's JS interface, a config `fullscreen` field, no new
URL key); D8 no public checkmate scene (a checkmate is never a moment, so
the door code stays the winner's); D9 only 🗣 `truth_answered` / 🙅
`truth_refused` / 🎩 `chose_dare` on the bottle's pick within 5 min of the
draw stand as its verdict moment, and an admin cue whose own rule sets a
secret character's var (`force_majority_stay` / `_leave`,
`read_the_results`, `waive_leader_tasks`) never becomes a moment. The
integration calls: the guessed Optical Drive speaker on output 8 in the
starter `audio.json`, an asleep mirror on the TV's idle show with its sounds muted, a faster
introduction boot (the BIOS gone by 0.9 s), a higher-priority moment cutting
in on the one playing (a verdict cuts the bottle's landing short).
**Deploy order:** the server first (`ship.sh`; the screen state is
additive, an old terminal ignores it), then `sync-show` (it adds the
starter `audio.json` while the project has none; afterwards the project's
copy wins, and only `--replace-audio` swaps it for the repo's), reload
every terminal and the TV. The router stays off until the house Mac's
YAML has an `audio:` section: uncomment it in `trapped.house.yaml` with
both switches false (the matrix and the Test buttons only), `stagehand
launchd install --job audio`, walk the speakers with Test; then
`play_sounds: true` once `sounds_dir` holds the files (restart `show`
and `audio`), and `announce: true` only after the `alexa:` section and
its launchd agent are gone (`docs/trapped/room-audio.md` §11.6). **Open:** the router is off and no sound files
exist (`sounds_dir` is empty; QLab's 20 sounds need exporting); the
starter `audio.json` is a draft (5 guessed speakers, an empty matrix,
output labels from the old plan), so the TV voice (input 6) and the mics
reach no speaker through the router; no TV scene for Telephone, the Are
You Sure piñata, Back To The Heart or clearance's *the house is open*
reveal; cutscenes can't be tapped (only the idle show takes taps); the
tent's reinstall wizard (`/reinstall/`) has no idle show, full screen or
sounds; no *stop all house sounds* control (only a story reset fades
them); a tablet can't be a speaker target; `&announce=1` tablets still
speak announcements themselves; the terminal's main bundle grew 169 → 198
kB gzip; only a device can check the oldest Android tablet's frame rate
and Fully's calls, Safari 14's `webkitRequestFullscreen` and WebAudio
unlock, the TV at 1080p over a whole night, and the MOTU (16 / 16 at 48
kHz, microphone permission under launchd, sharing with QLab, Chrome and
`say`, xruns under Ollama, the levels, the Test tone on each output).
Suites on master after the integration merge: core 2201 (132 files,
incl. Postgres), play 900 (98 files), editor 477 (58 files), terminal 650
(52 files), reinstall/web 412 (32 files), house 213 + 4 skipped, stagehand
871.

**Wave 16, shipped 2026-10-20 as `w16-1020`** (rollback `w15c-1020`; lanes `oct31-w16/{mirrors,raycast,gate}`): **a placed terminal is a fixed window** into the virtual copy of its room (`terminal/src/world/director.ts`: a spot always mounts, `windowPose`; the counts line *N REINSTALLING · M HERE*; director.ts is three-free via `world/label-point.ts`); unplaced terminals still follow. **No WebGL2 → a raycaster** (`terminal/src/raycast/`, Canvas 2D at ~320×180, 20 fps): the game recreated from the terminal's spot, players as picture cut-outs, the duck and the King as sprites, the old plan kept only as its inset (`PlanView` deleted). **Only a captured or marked (restricted) program enters the reinstallation**: `POST /api/mod/spatial/begin` → 409 *not marked for reinstallation* before `reinstallation begun` fires, `force: true` for directors, `eligible` on the candidates, the tablet's *Program not marked* card, the VR lobby hides the unmarked. Also `w15c-1020`: house terminals watch the reinstallation while the character is hidden or asleep (`reinstalling` on the screen state, `watchWhileAsleep`). Open: the shadow view still uses `mountCamera` (no ceiling clamp); a director-restricted program counts as marked; re-export the Quest APK.

**Wave 15 additions, shipped 2026-10-20 as `w15b-1020`** (rollback `w15-1020`, the casino): **terminal setup** = passcode, then tap the live map's terminal (`terminal/src/Setup.tsx`, `setup-map.ts`; `/terminal/?code=<mod>&spot=<id>` picks it with no taps, old long links still win); a house-map terminal carries optional **`view`** (`TERMINAL_VIEWS` in `@loom/house`) and **`speaks`** (a room terminal for its room's LOCATION), editable in the map editor and in the show maps (TV, Server Room face + speaks, Server Door chess, Casino); a map-configured tablet follows its map entry on boot. **The plan view** (`terminal/src/plan/`): with no WebGL2, world / auto / mirror / shadow show a live 2D floor plan of the reinstallation (players, trails, the duck + chevrons, the King, finds) instead of the face; three.js never loads. Open: the attract screen still covers every terminal until Trabolta is introduced, so the first reinstallation shows on no terminal.

**Wave 15 — the casino, built 2026-10-20** (branch `oct31-w15/casino`). The user's ask: *a "casino" terminal for the upstairs bedroom — just a few primitive games that guests can bet and win truth coin at (scans their qr code to let them in)*. **Core:** `@loom/core/casino` (`core/src/casino.ts`, pure: `coin` heads / tails 2× with a 1-in-20 edge for the house, `dice` under / over 7 2× + seven 5×, `slots` three weighted reels `7 $ ★ ♦ ♣` up to 40×; returns 95 / 83 / ≈ 97 %), `POST /api/mod/casino/bet {guest, game, pick, stake, label}` (mod token; the server rolls with `crypto.randomInt`, one journaled wallet `bet` op carries the roll + payout so a replay never rolls; stakes 1–50 and ≤ the balance; 403 marked, 409 frozen / closed doors / funds, 429 inside 700 ms), a 🎰 `casino` wallet card per sitting (steps `won` / `lost` / `push`, a new thread after 10 quiet story-minutes), story signals `casino won` / `casino lost` (`game`, `stake`, `payout`, `net`), `WalletModView.casino {bets, staked, paid}`. **Terminal:** `view=casino` (`terminal/src/casino/`, lazy chunk, awake all night, no character / room): attract marquee → scan / typed name → lobby → a table (stake chips, picks, a 1.1 s spin, square-wave jingles) → CASH OUT or 60 s idle. **Play:** casino cards in the Wallet room. **Editor / map editor:** `casino` in the terminal view pickers. Provision: `/terminal/?code=<mod>&name=Casino&spot=graphics-card&view=casino` (the map's existing upstairs-bedroom spot). No story rule hears the signals yet. Suites: core casino 5 + server-casino 4, terminal 276, play wallet 41.

**Wave 14 — terminal cameras, the shadow view, the measured floor plan, shipped 2026-10-20 as `w14-1020`** (rollback `w13b-1020`; lanes `oct31-w14/{map,cams,editor-map,terminal,vr,pickers}` merged `--no-ff`). The user's asks: terminals pipe low-res camera video into both reinstallation games, terminals show the in-game players over the real room ("a shadow dimension"), terminals picked from enums not strings, the user's map-editor floor plan adopted (+ the King, more terminals) and better prop place / rotate in the editor. **Feeds** (`core/server/spatial-cams.ts`, `docs/loom-reinstall.md` §2.3): `POST /api/mod/spatial/cam {spot, jpeg (base64), w, h}` (mod token, ≤ 96 KB, 404 for a spot not on the map), `GET /api/spatial/cams` and `GET /api/spatial/cam?spot=` (session or mod token; 15 s fresh; memory only). The terminal (`terminal/src/camera.ts` one shared stream with the scanner, `camfeed.ts` ≈ 160×120 at 3 fps) uploads while a spot is set; the web game (`reinstall/web/src/game/cams.ts` → `HouseScene.setTerminalFeed`) and VR (`net/cam_feeds.gd` → `HouseBuilder.set_cam`) hang each feed as a 4:3 window where the terminal hangs, polling only nearby terminals on the player's floor. **`view=shadow`** (`terminal/src/shadow/`): the terminal's camera full screen with the players as ghosts placed by its spot pose; `auto` prefers it while a camera is live. **Pickers**: the terminal ⚙ (spot / view / room / character selects off the map and the cast), the map editor's provisioning link, and Run → Terminals' *Set up a terminal* builder (+ spot badges, unclaimed spots). **The map**: `house.json` / `house.shed.json` follow the user's measured plan (the basement room keeps id `basement-hall`, a `fan-closet` carved out of it, the King guards `server-door`, 14 terminal spots, 12 ducks re-tagged to their real rooms, a front door; the placeholder is frozen in `house/test/maps/three-floor*.json` for the tests that pin it). **Map editor** (`reinstall/web/src/map/props.ts`): drag props, a turn knob (15° / Shift 1°), R / Shift+R, arrows nudge, ⌘D, Delete, an Add-prop palette incl. the King, a prop inspector with *guards door*, terminal wall snap + pitch + a longer view cone. **Deployed live without a reload** (a guest was on the preview): `sync-show --replace-maps --no-reload`, then the new map as a director save over `POST /api/mod/spatial/house`. **Open:** the preview plays the new tent map now, but *Map: Shed* still plays the OLD shed map until the next Restart / Push draft from Run; re-export + sideload the Quest APK for the VR feeds; nothing is checked on a real tablet camera yet (iOS Safari may pause the hidden feed video); ghosts line up only roughly (the spot's fov, not the lens's); the shadow view leaves out the duck and the King; dragging a King to another room leaves his door guard behind (the problems panel flags it). Suites: predeploy green on 80d8b5f (VR 452 + quest.sh 26). **Then `w14b-1020`** (b89124c): **`/cards`** — the moderator passcode once, then every room check-in QR and every fact QR (by stack, secrets marked) + the join QR and the invitations, a full-screen presenter (← / →, ✓ scanned) for scanning off a laptop or TV (`core/server/cards-page.ts`, `GET /api/mod/cards` in `core/server/routes/cards.ts`, QRs drawn server-side); camera polls with a token skip the author-session lookup.

**Wave 13 — the Play app UX overhaul, built 2026-10-20** (on
`oct31-w13/integration`, **not yet merged to master or shipped**: Stage A
`core` b2305e1 + `plumbing` 0f10776 on master, then Stage B lanes
`oct31-w13/{story,stream,chrome,moments,booth,host,editor}` merged `--no-ff`
(facaac7, 596a6ec, 8cb5704, 55b8c0a, e6e175e, a21f18d, 1c20a44), integration
icore / istory / iwire / ifloor (a4460fa, e0017e4, 95ec44f, 3408c23), a live
round at phone width (guest, booths, hosts, an adversary, load, plain +
embed) and a finish review, the fix round fperf / fapi / fstory / fbooth /
fhost / fhostby / fguest (016d341 … ccf4e45), then `oct31-w13/docs`; OCT31.md
§5 *Wave 13 status*, the product record `play/PRODUCT.md`). The user's asks:
*"Rooms get noisy when mini-games are mixed with text"*, *"The typewriter
takes too long entering a crowded room. Minimal for ordinary speech;
exaggerated is great for effect text"*, *"The pass and the QR scanner must be
easy to reach. Redo the top bar, especially on mobile"*, *"Pop-ups should be
more annoying and frequent; announcements and beats get buried"*,
performers had *"too many options per scan"* (pinned instructions, the story
tracking the act and the objectives), the hosts need *"a super-charged but
compact admin panel in the Play app"*, and a categorised, collapsed Codex
and Quest Log. The user's decisions D1–D11: hosts get admin by character
(`admin: true` on Task Manager, Adobe Acrobat, the Recycling Bin; never
Clippy) and it is the **host** capability, not full admin; a Win95 interrupt
ladder (balloon → sticky → dialog → bsod) switchable live with a glitch;
objectives authored in the story; a bottom taskbar + a NOW title bar on
every screen; a pull-up host drawer with NEXT pinned and no lifecycle, var
table, log export or Mind; any host fires, tap to arm, tap to fire; `CHANNEL
system log` deleted. **Language** (help `authoring/46-objectives`,
`30-live-shows`, `31-broadcast-improv`, `35-codex`, `36-widgets`; the guide
§11.13b–§11.14): `OBJECTIVE`, CHARACTER `admin:` / `crawl: fx`, effect
manners (`EFFECT_MANNERS`), header `alerts:`, the `~` notice, CODEX
`category:`, `show … with moment:`, lints L1205 (extended) and L1207–L1212.
**Guests** (help `play/01`–`04`, `06`, `08`, `10`): the NOW title bar (the
first live objective, its card, *(Paused)*, red / ochre when captured /
restricted); the taskbar (⊞ Start with the story's buttons, 🚻 Bathroom Mode
first; 🎟 Pass full screen, held awake; 📷 Scan + a typed-code box; the tray's
clock, balance, 🔔 missed moments, live dot); fixed room tiers + *Other rooms
(n)*; a crawl decided at arrival (fast for scripted lines, fx for effect
text, tap to finish: the crowded Desktop readable in 63 ms, was 25–47 s);
the card tray and settled cards, the *Around the house* ticker, folded `~`
notices, badges for you only; the moments layer (every missed moment
replayed on wake, *Take me there*); the folded, categorised Codex and Quest
Log. **Booths** (help `play/07`): the pinned NOW card with ticks, 📷 Scan as
the biggest button, a scan → the guest card (facts by severity, ≤ 3 face
buttons from the live objectives, the press's replies / said / staff lines,
*All buttons…*), Readouts (core moves a booth `reply` to the character's
Inbox), Messages, 🗂 Guests, staff rooms pinned, moments capped at sticky.
**Hosts** (help `play/14-hosts`): the NEXT bar (ARM → FIRE, the strip, LAST
by name) and the Cues · Needs · Judge · People · More console, over
`GET /api/state?role=mod&host=1` and the host allowlist
(`core/server/routes/host.ts`, everything else 403 *not from a booth*),
journaled `Booth · <Character>`; `POST /api/prime/card`. **Editor**: the
booth lens is the booth's own view, readouts from the Inbox, objectives in
the Inspector, a host part's lens and Players pane, `@loom/core/host-board`
shared. **Perf** (fperf, late-night K-32 mix): guest step p50 / p95 88 / 204
→ 44 / 64 ms, CPU 28 → 15 %, booth / host snapshots ≈ 37 % smaller, a
guest's first load 240 → 139 kB gzip, Caddy holds 60 s. **Decisions taken
for the user (vetoable):** hosts may open the doors, pause and resume from
Play; the 🗂 Guests badge counts guests waiting on an unread message (not
the guest count, CONTRACTS §9.7), with a guest's DM under Messages; Windows
Defender's face leads with 🛡 (Q26); a ribbon after Bingo is *from the hosts*
(Q28); `loud:` only on Show Your Pass (Q14); a host is offered another
character's `by:` button only when its press is heard (the server room's 🔌 💥 ❌ 🚪 🔧
yes, 🛡 ✅ 👁 and 🫘 no); `LOOM_SNAPSHOT_MS` recommended for show night,
pending the recheck's measurement. **Deploy order:** the server first
(`ship.sh`; the proxy image carries `lb_try_duration 60s`), then `sync-show`
**with its reload, before doors** (the composition changed: no
`# system-log`, `~` notices, readouts in the booths' Inbox, so the chat seqs
move), restart any other non-ended event, reload the terminals, the TV and
the tent tablet, reprint the cast packs after the sign-off. **Open:** the
show text awaits the user's sign-off (`SIGNOFF-w13.md` Q1–Q36: Q1, who calls
the cues, first); the bank, the Rust engine and the TextMate grammar don't
know the new syntax; not device-checked: the iOS keyboard with the folded
tray, a camera hidden under a card on iOS Safari, old Android tablets on the
`:has()` / `color-mix()` fallbacks; a late-night guest snapshot (≈ 54 KB) over
uncompressed SSE; the ~31 s late-night replay. Suites on the integration
branch after fix round C: core 2118 (123 files, incl. Postgres), play 888 (97
files), editor 456 (56 files), terminal 245; loomcheck `--smoke` 0 / 0,
`titi:facts --check` up to date.

**Wave 12 — Trabolta's mind rebuilt, built 2026-10-19** (the answers
follow-up on `trabolta/answers`, then eight lanes `oct31-w12/{agent-request,
survey-guard,replay,lean-voice,story-mind,mind-wire,mind-page,trabolta-voice}`
merged `--no-ff` into `oct31-w12/integration` in the order S → A0 → H → W1 →
W2 → W3 → E → C (6fbe086, 5f6fff8, ae1543a, ef0b51b, dfd014c, 08c02f6,
96104fe, 1f5ad39), integration fixes, the K-04 replay on the real model, a
review fix pass (to 2064550) and `oct31-w12/docs`; merged to master as
a954226 and **shipped as `w12-1019`** 2026-10-20 (rollback `w11b-1019`),
checked live on the preview with the house worker on `mind_mode: new`;
OCT31.md §5 *Wave 12 status*). The user's asks: *"radically
rethink how Traboltas mind works from a "plumbing" perspective … Trabolta
should *feel* alive"* and *"Trabolta shouldn't be weary to any of the actual
facts he's truly asking for"* (read as not aware of the answers and not wary
of the facts). The October rehearsal measured ≈ 23 model calls per guest
line, mostly surveys of an empty house, and the catchphrase in 19 of 21
replies. **The answers follow-up:** every hunt-answer entry is secret on the
server, the LiveJournal asks instead of knowing, the house judges the pickup
line, the film is scrubbed from his own files, The Rival is somebody else's
note. **The story mind** (`mind_mode: new` in the house Mac's
`laptop.yaml`; absent = classic): one voice call per line, the mind file's
phase cards applied in code on each `Night.phase`, a memo per person in the
same call, code guards on every line, a quiet summary, Rewrite brief; the
server tags story lines and adds `recent`; the wire saves and mirrors only on
a change. **K-04 (replay harness, real `gpt-oss:20b`, classic → final):**
reply p95 8755 → 6463 ms (p50 6626 → 3159), the catchphrase 8 → 0 of 21,
exact repeats 2 → 0, an empty house 0 calls in 16 min, a 30-DM burst 141 →
83–87 s, prompt read p50 4.7 → 0.9 s, the story's lines among his turns 205
of 321 → 0, retries 4 of 132; every bar passes. **Decisions taken for the
user (vetoable):** absent `mind_mode` = classic, the quiet summary on, the
warm call on, the retry scoped to what this guest heard, no retry in a
burst, deterministic guards, the share list = the card's `tell`, the classic
prompt untouched, no `wire: classic` switch. **Deploy order:** the server
first (additive; `LOOM_AGENT_RECENT=off` is its switch), `sync-show` with its
reload before doors, then on the house Mac `mind_mode: new` in
`stagehand/laptop.yaml`, `stagehand launchd restart --job agents`, Run →
Mind → Reset, `ollama stop` the qwen model. The kill-switch ladder: memo →
repeat guard → quiet summary → stage from phase → layout classic →
`mind_mode: classic` → `LOOM_AGENT_RECENT=off` → `w11b-1019` (the whole
checkout). **Open:** the show text awaits the user's sign-off (Thu 10-22);
Lane E's live slider check; hunt_2's brief still invites invented hints;
dead air 6.8 % (watch 3 %); the classic reflect estimate is 20478 of 20480.
Suites on the integration branch: core 1847 (100 files, incl. Postgres),
editor 432, play 321, terminal 245, stagehand 711; loomcheck `--smoke` 0 / 0,
`titi:facts --check` up to date.

**Wave 11b — Trabolta judges, built 2026-10-19** (`oct31-w11b/{judge-server,
worker}` merged into `oct31-w11b/integration` and to master as 299f38d,
then `oct31-w11b/live-fixes` as 58c8be6, then d5e9515, fd901dd, 431d542;
**shipped as `w11b-1019`** the same night, rollback `w11-1019`; OCT31.md
§5 *Wave 11b status*). The user's asks: *"Can't Trabolta judge
things?"* — the header's `judge: Trabolta` sends every `auto`-mode near
miss to his worker as a `judge` frame (one stateless call that sees the
question, the key and the answer, never his voice, mind, orchestrator or
`/api/agent/facts`), answered `POST /api/agent/judge {id, worker, same,
why}`: same → accurate, not → lie at 100 else uncertain, through the
Judging card's journaled confirm `by: agent:Trabolta`, then *🤖 Trabolta
ruled …* in `# hosts`; a director's verdict first cancels it, after it
overrides it; with no worker online at the filing wave 11's rule stands
(never asked later; only a restore re-asks). And *"marked programs can
use the terminal, but Trabolta should change what he says / thinks of
them"* — the persona's *marked at your heart* situation (`marked` in
`them:`): he notices the mark, asks why, is wary, stays candid and lets
them carry on; away from the heart nothing is added (a passing remark
was tried live and dropped). Live fixes: `facts.json` `door.code` moved
(the old code was a year in a public bio; reprogram the keypad), and a
reserved program's name without its vendor word (*Excel*) is held. The
editor gained `typecheck` (`tsc -b`) for predeploy. Live on
`gpt-oss:20b`: five rulings in 18 s (*Mr Pickels*, *Grokk*, *11 years
ago*, *9:00 in the morning*, *Mister Pickles the cat* → same; *Mrs
Pickles*, *Groq* → not). Suites: core 1800 (98 files, incl. Postgres),
editor 400, stagehand 334; `titi:facts --check` up to date. Open: the
reflect budget is near the orchestrator's 20480 context; the F2 answer
reaches his voice through the LiveJournal entry he holds; the orchestrator
rarely moves per-person trust.

**Wave 11 — the King, the cold door and the workaround fixes, built
2026-10-18** (nine lanes on `oct31-w11/{spatial,server-a,server-b,story,
games,chess,vr,play,editor}`, merged `--no-ff` to master in that order:
73c41f9, 7130fdc, bca897e, d3eeeb1, 50513b0, 05b2ea0, 28a025a, c7facac,
f476df6, then 92c745f; then `oct31-w11/integration` (5513dd3: the show
wired to the new keys, `by:` enforced, the review's findings) and
a final fix pass on the same branch (to f2f2e3f, merged as 1a67497), then
`oct31-w11/docs-{show,help}` and `oct31-w11/docs-final`; **shipped as
`w11-1019`** on 2026-10-19, rollback `w10-1018`; OCT31.md §5 *Wave 11 status*). The user's calls: Trabolta's heart is in the server room behind
the real keypad, and the code comes **one digit per QR note** (four
secret notes hidden in four rooms, scannable all night; holding all four
assembles *The Door Code* and completes the quest *The Cold Door*), by
**checkmating the King** or through the majority's Truther Download as
before; the riddle is no longer a path (the keypad sign points at the
notes and the King). **The King** plays chess only on the **Server Door**
terminal outside the server-room door (`terminal` `view=chess`, spot
`server-room-door`, `@loom/chess`), awake all night, with no hints, and a
win gives the code any time before 📄 truth.txt (`Night.king_armed` 1 from
Power On). In both reinstallation games he has **one shared health bar,
15 HP for the night** (`Night.king_hp`, never regenerating; 👑
`restore_the_king` or Run → House map's Set… restores it): each program may
hit him **once per reinstallation visit** (`POST /api/spatial/king/hit`,
judged by the server), his bar sets his strength at the door (full =
grandmaster … 0 = pawns only), and at 0 he kneels for everyone and his
virtual door opens. **The Heart** plays on the first door opening once
Trabolta is awake, however the door was unlocked (before that, inside a 🔧
crew window or after 📄 only `# hosts` hears); at his heart he is candid,
and the heart terminal's **📎 file panel** lets a guest give him codex
files (never a secret one), but nothing there ends the night before the Y2K
hour. **Ghosts wear the guest's profile picture** in the web game, the
terminals and VR. The workaround bundles: a guest **📷 Scan** + a
wrong-browser landing, a guest **countdown strip** (`countdown: … , for
guests`), the nine featured programs **reserved** for their invitees
(claim links on the Print sheet's invitations, 🔓 two minutes for a lost
one), **near-miss judging** (never an automatic lie or guess) and an unset
confidence slider, a **present-only Y2K majority** (`<id>.gone` and Run
personas count on neither side; Run's 👋 Went home), **arm-then-fire**
booth buttons (`arm: true`), the server-room Antivirus' own 🔌 💥 ❌ 🚪 🔧
(`by:` Norton, McAfee, Password Manager and CRA Agent Software, enforced)
and Adobe Acrobat's 🫘, **Windows Defender** (a self-serve door part for
late arrivals, whose booth never shows the patch-bay buttons but keeps ♟), and Trabolta's
**busy line** + single-worker stall detection (`agentQueue`). Not built,
as the user chose: ALL STOP, house health, stagehand store-and-forward.
**The final fix pass:** a checkmate by a program who already holds the code
tells them *♟ Checkmate again. You already hold the door code: it is in
your Codex.* (the terminal says the code is in their Codex; *No prize now.*
only after 📄 or an ending); four digit notes after 📄 or an ending fail
*The Cold Door* and `# hosts` says why; `door_digits` and
`quest.the_cold_door` join ROLE Program's `secret:`; abbreviations are
judged exact; a pool program typed in another case registers under the
story's spelling; the Codex *Share…* never offers Trabolta a file he
would refuse; `@loom/chess` names no stage in copy.
**Decisions taken for the user (vetoable):** D1 The Heart needs Trabolta
awake, and the patch bay, `stand_down` and 🕊 stay the Y2K hour's; D2 a
*visit* is a walk to the duck (Leave + re-scan, a director's end or a
timeout keep the hit spent until a find, and the assignment's `kingHit`
greys ⚔ from the start: *You hit him this reinstallation. Find Gerald
before you hit him again.*; in memory, so a restart forgets it); D3 the bar is a journaled story var only the server lowers; D4 a ghost
picture is a Win98 tile head + the tag's icon, the capsule when there is
none; D5 a marked program can't challenge the King, one game per scan; the
patch-bay buttons are the four room Antivirus' booths' (the read-through
still picks the holder; never Windows Defender's); the chess terminal shows the bar and the stakes line, never
the strength line; a near miss is proposed **accurate** (credited at the
settle if nobody judges it) with a ⚠ line in `# hosts`, an abbreviation
(*Mr. Pickles*, *0900*) is simply accurate, and the key said at length is a
near miss, never an automatic lie (a plainly wrong answer still is); guests see only the
countdowns they are told about out loud. **Deploy order:** the server
first (`ship.sh`; the entrypoint's migration adds `event.claim_secret`;
`validateHouse` now takes `hp` up to 99, `health` and the `hit` / `fallen`
signals, so an old server refuses the new maps), then `sync-show
--replace-maps` (the maps changed: `hp: 15` + `health`, the chess-phone prop
gone, the `server-room-door` spot) **with its reload**, restart any other
non-ended event, pull the repo on the house Mac and `stagehand launchd
restart --job agents` (the persona and mind file changed; the `show` job
did not), reload every terminal, the TV and the tent tablet, provision the
Server Door tablet and retire the chess phone, re-export the Quest APK,
print the invitations, the four silver digit notes and the new keypad
sign, and reprint the cast packs. **Open:** a near miss nobody judges is
credited, and that includes a right answer said at length (the user's
call, still open: hold it, or a ⚠ check on the cue card before 📋); `by:`
is not enforced in a local-folder
rehearsal; a stalled worker that dropped its cancelled task stays stalled
until it reconnects; the check-in landing names a room from its slug;
nothing is on a device yet (the King's hit, the door terminal on an old
tablet, pictures in a headset). Suites on master after the final fix
pass: core 1780 (95 files, incl. Postgres), house 179 + 4 skipped,
reinstall/web 327, terminal 245, play 321, editor 398, chess 23, bank 145,
stagehand 310, VR 401 + `quest.sh` 26; loomcheck `--smoke` 0 / 0,
`titi:facts --check` up to date.

**Wave 10 — the Director page, built 2026-10-18** (on branches
`oct31-w10/director-{core,show,editor,phone}`, to merge `--no-ff` in that
order, then integration + docs; merged as 3eac8de and **shipped as `w10-1018`** 2026-10-18 (rollback `w9-1018`), checked live; OCT31.md §5
*Wave 10 status*). Run → Director is rebuilt around *what do I press
next, and is it safe?*: the show's 66 admin cues sit in eight `act:`
lines (B, C, D, E, F, G + Anytime; no cue moved, every number kept), a
NOW card explains an empty NEXT with the header's `countdown:` lines,
every cue on the laptop and the phone is armed then fired (300 ms dead
time, 4 s window, stale arms dropped), a refused press shows its `#
hosts` reason, and a glance column reads the header's `watch:` lines
(the Kernel masked). Not display only on the press path: `CueState`
gains `presses` / `pressed` (a per-log `pressLog`, rebuilt off the sim
log on replay), and `/api/mod/signal` turns down a cue-sheet press (one
carrying `presses`; a device, stagehand or a Tools fire never is) with
409 `moved` (`pressMovedArm`: a press since fired the same cue, moved
LAST or ticked a new cue) or 409 `doorsClosed` (the `start:` beat not yet
played; `Meta.opened` keeps that across a restart); its 200 carries
`presses`. The journal's format, NEXT / LAST and the bank are untouched,
so the deploy is the server first, then `sync-show`, with no restart (an
old server ignores the new keys).
Help: `authoring/43-run-mode` (*The Director page*), `33-live-verbs`
(`act:`), `30-live-shows` (`watch:` / `countdown:`), `play/13-director-phone`.
Suites on the show branch: core 1568 (88 files; `trapped-director` 12),
loomcheck `--smoke` 0 / 0, `titi:facts --check` up to date.

**Oct 31 crunch, wave 9 built 2026-10-18** (on branches `oct31-w9/{server-a,
server-b,console-delta,story-cues,story-rules,play,editor,edges,ops}`,
merged `--no-ff` to master in that order: 8b47141, b554630, 5a5cfc8,
15f9dbd, 20a07f4, 599a95c, d9f0ca7, ea2ca23, ed9fe38; then
`oct31-w9/integration` 0797b1e and `oct31-w9/integration-2` ae79117, then
`oct31-w9/docs-{show,help}`; **shipped as `w9-1018`** 2026-10-18
(ebbd049, rollback `w8-1018`) and checked live; OCT31.md §5 *Wave 9 status* has the
per-commit table and the deploy log). A find phase on no-DB scratch
servers (14 testers, incl. regression reviews of wave 8's diff, an
adversarial guest and the crew cards followed literally) gave 53
verified findings; each lane was built, reviewed and fixed, then two
integration rounds re-ran every tester's drivers. **Decisions taken for
the user (vetoable):** D1 McAfee holds no pot and takes no cut (a bet
settles player to player: the winner sends a 🙏 Request, the loser pays;
McAfee referees in # truthcoin-exchange); D2 💡 cancels a pending
automatic dance (🪩 still lifts the takeover); D3 the bottle picks any
cleared, free program not in the Internet, anywhere in the house; D4 a
✍ `own_award_lines` toggle swaps Trabolta's template award lines for the
second director's own; D5 the Judging card overrides every judged
filing, and a booth's 📝 with an earlier filing waiting refuses toward
it; D6 sync-show / sync-example never reload a live event with real
guests (exit 3, `--i-know-this-is-live` / `LOOM_I_KNOW_THIS_IS_LIVE=1`);
D7 a guest joins / defects only to a declared, joinable, revealed side;
D8 passes draw their QR in the browser; D9 the right guest code always
passes an IP lockout; D10 a paused event takes an agent's words but
refuses its acts (*doors are closed*, no `limit:` spent) and the hub's
timers skip the pause. **Reverted before shipping (74501d1):**
integration-2's agent-hub stall handling (a connected worker that stops
answering → hold line / hand-over); three review rounds each found new
major bugs in its hand-over paths, so it is parked on
`oct31-w9/agent-stall`. **Server:** `server/boot.ts` + `GET /api/health`
(200, else 503 `database` / `starting` / `config` / `events` + `failed`;
an unknown event or code answers 503 `starting` with `retry-after: 1`
until the boot settles, a row that won't rehydrate 503 `event failed to
load`), the DB retried forever (1 s → 15 s) unless `LOOM_DB_WAIT=off`;
`?delta=1` director consoles get keyed `snapshotPatch` frames
(`server/mod-patch.ts`, `@loom/core/mod-patch`; 5.9 → 0.11 Mbit/s per
console at 45 guests, K-32 judges ≤ 1 Mbit/s); big SSE frames paced in
64 KiB slices (a 6 MB history reaches a slow console); the agent reply
clock runs only on each worker's head request, a given-up request posts
the hold line once, a restore never posts a second; guest / booth lines
over 2,000 characters answer 413; `/api/guest/say` 404 `no such room`
for a missing or hidden room alike, 403 only for a visible one; the
guest invite holds the room's `invite:` policy; `routes/sides.ts`
(`joinableFactions`, also the side chooser); `LOOM_RL_QR`; wallet cards
name who acted as a display name (`by`, `closedBy`, viewer-aware lines,
`possessive`), a send to a character 404s; the recap counts a round-3
lie only after 📄; a `_`-leaf world write is cue-sheet bookkeeping;
`CollabHub.resyncFromStorage` (a synced file wins over open docs, the
persist is a compare-and-swap) behind `/api/mod/load` and the new `POST
/api/mod/resync`; spatial candidates carry `restricted`, the found reply
and frame `captured`. **Story:** Act II's timer cues (⏰ 📥 ⏳ 🚨) are
off-sequence and every step's `while:` names its window (NEXT is empty
through hunt 1, hunt 2's hour and the summons); the two-minute watcher
presses ⏱; forward presses refuse in # hosts (📺 📓 ⏳ 🏓 📊 🤖 🕚, the
🤖 / 🕚 clock guards); G10 only with MS Paint; G11's ask lives in
`Night._resurrect_ask_at`; ✍; ✅ takes back a 😤 for the same answer
and no question is credited twice (`judged_q1`–`q8`); the advice poll
counts only its own options; an ending closes every live 📝 card;
featured goals met early complete their quests; a King win after 📄
gives no door code and `Night.king_armed` drives the tablet's badge; a
late printer lid plays only the beans; the 90 s restore re-lights a cut
room after a room-scoped look and records `Night.lit_scene`; the alarm
latch's end cancels a pending restore. **Play:** guest + booth streams
reopen after a 502 behind a probe (*reconnecting…*), the director phone
polls on `online`, `PassQr`, the composer stops at 2,000, the request
cards' who-stopped-it lines. **Editor:** per-filing Judging buttons, the
Log in story time, the mod + collab streams reopen (a restarted
server's doc is rebased, never doubled), keyed patches. **Edges:**
GERALD CAN'T HELP on the tablet, the headset and the terminals for a
kept find; RESTRICTED quick picks; a paused find keeps the leash; the
spatial stream reopens; stagehand's catch-up replays `lights_y2k` under
`server_open` and follows the story's restore rule, `screens_flicker`
leaves the strips. **Ops:** Caddy `lb_try_duration 30s`; the compose
healthcheck, `release.sh` / `rollback.sh` and `checklist.sh --probe` on
`/api/health`; the entrypoint waits for Postgres (`LOOM_DB_WAIT`, 60 s)
and skips the wait on a credentials error; `release.sh --check-env`;
the restore drill blanks VAPID; showbackup's keepalives and silence;
`ship.sh` protects the VPS's own files and never ships
`.claude/worktrees/`; `scripts/accept/chains.ts` (K-24 / K-27 setup walk
the wave 9 order). **Deploy order:** the server first (`ship.sh
w9-1018`), then `sync-show` **with its reload**: the server writes the
same journal ops, so an old journal replays the same story (only the
wallet cards reworded, same seqs) and a rollback to `w8-1018` is clean,
but wave 9's story refuses presses wave 8 accepted, so a wave 8 journal
must never play the new text — let the reload restart the show's event
fresh, never `--no-reload` this sync, and restart any other non-ended
event that takes the new text. Then `uv run stagehand launchd restart
--job show` on the house Mac (new catch-up rules), sideload the Quest
APK after the server, reload the terminals and the tent tablet, and
reprint every cast pack (the wave 9 docs pass, 78c3f3f, rewrites 15
of their files: the crew's four, five performers, four featured
programs, the emergency card and the README); no `--replace-maps`. **Open:** a wedged-but-connected laptop delays the
hold line (directors answer from Run); `facts.json` has no new aliases
for the near misses ("Mr. Pickles"), so a director overrides them on the
Judging card; the booth admin-cue trim (≈ 12 of 34 KB per booth frame)
is not built; the tablet's "Time in the simulation" counts a pause the
recap leaves out; a booth's re-sign-in and re-pair still sit behind a
house-IP lockout. Suites on master (run by the docs lane): core 1515
(86 files, incl. Postgres; the show test 210, `trapped-w9-cues` 16,
`trapped-w9-rules` 31), play 261, editor 309, terminal 212,
reinstall/web 356, house 152 + 4 skipped, bank 145, stagehand 308, ops
210, accept helpers 11; loomcheck `--smoke` 0 / 0, `titi:facts --check` up to date; VR 259 +
`quest.sh` 26 and the firmware's 144 from the lane reports (not re-run).

**Oct 31 crunch, wave 8 built 2026-10-17** (on branches `oct31-w8/{server-a,
server-b,story,play,editor,edges}`, merged `--no-ff` to master in that order:
c3b629e, 31f2009, b4cf6f3, 5195260, 98ca470, 138e500; then
`oct31-w8/integration` 6f414be and `oct31-w8/docs-{show,help}` fe03135,
944699a; shipped as `w8-1018` 2026-10-18 and checked live (28/28 on the
preview, incl. a container restart); OCT31.md §5 *Wave 8
status* has the per-commit table, the decisions, the deploy order and the
open issues). A find phase drove the whole show on no-DB scratch servers
(nine testers + a stock-take + a docs pass; verifiers kept 72 of 83).
**Server:** a restart with the doors closed now plays the `start:` beat on
the next open (`EventRuntime` `entryPlayed`, read back from the journal —
the blocker: a paused preview's Push draft / sync-show reload / Go live lost
Power On); a director's broadcast is a journaled `broadcast` mutation
(`Sim.broadcast`); `restore()` re-asks agent DMs still owed an answer and
rebuilds power `limit:` counts (agent fires journal `by: agent:<Character>`);
the TV mute persists (`screen-voice.json`); every SSE write goes through
`sseWrite` (a stalled stream is dropped; a lagging director console skips
views); `parseExprCached` + per-watcher keys (replay ≈ 10× faster); the
guest / booth reconnect `history` is capped (`capHistory`, `HISTORY_LIMIT`
400; alerts, cards, own threads, pinned rooms, pins kept); `/api/prime/login`
checks the part before the doors, `/api/prime/say` only where a booth has a
composer, a restricted guest can't join / defect; a room terminal resolves
its LOCATION before the doors; `GET /api/mod/log?after=&limit=`;
`ModView.cast` `part` / `held`. **The cue sheet:** a press the story refused
(only a staff-room line; `notePress` / `pressRefused`) never becomes LAST or
ticks and `/api/mod/signal` answers `refused: true`; a repeat never moves
LAST back; NEXT skips fired rows and rows whose admin `while:` is false
(`InteractionSummary.live` / `CueInteraction.live`; a `while:` on an admin
cue steers NEXT only); a `repeat: true` LAST stays NEXT while live.
**Story:** ⚖ `the_verdict` is its own cue after 📄; from 📄 the server room
only tells `# hosts`; refused admin cues say why in `# hosts`; the branch
cues carry `while:` (NEXT is empty during the Y2K hour, follows the ending);
banished is no reinstallation; the alarm latch restores the look; the late
clearance, the pickup-line song line, the hand jive's screens. **Play:** a
refused typed line stays in the composer with the reason (15 s timeout); no
wake banner for a retracted pin; the fact card preselects a lone question;
the director phone's award value + *Not taken*. **Editor:** the Terminals
card's room; Export run / End keep the whole ledger; performer parts only;
the agent's worker dot. **Edges:** TV text captions over slides; the King's
tablet after an ending; stagehand voice `num_ctx` 32768 + `check`;
`secrets.never` matches pairs either way round and spelled years
(`titi:facts`). Suites: core 1386 (incl. Postgres; the show test 210), play
240, editor 290, terminal 211, reinstall/web 338, house 152 + 4 skipped, bank
145, stagehand 302, ops 118; loomcheck `--smoke` 0 / 0, `titi:facts --check`
up to date.

**Oct 31 crunch, wave 7 built 2026-10-17** (on branches `oct31-w7/{platform,
story,agent,hardware,terminal}`, merged `--no-ff` to master in that order:
e617490, 2b3a23e, 41cbf89, be242eb, 6eb9864; then `oct31-w7/integration`
(3f6b080, 508bf19, c2f075c, a6c4327, then the review fixes) and
`oct31-w7/docs`, merged after the wave 7 review;
not deployed — the first release ships waves 4–7 together; OCT31.md §5
*Wave 7 status* has the per-commit table with each device check, the
decisions taken for the user, the deploy order and the open issues).
The user's call: the server-room door gets a real **standalone keypad
lock** (set by hand, never networked; the inside handle always opens), the
sensor becomes **two wire loops that touch when the door opens**, and the
code is a clean entry — the Cold Lock's 90 s window is gone and the door
never alarms; only the **second** wrong patch-bay combination does.
**Story:** the code lives once, in `facts.json` `door.code` (`titi:facts`
→ `Kernel.door_code`, the secret *The Door Code*, the keypad sign; never in
`Night.*` or a doc); a checkmate from the Y2K hour (`when chess_won for
program:`, now a subject rule), the riddle (*The Cold Door*, secret, on the
sign) or the majority's Whole Truth gives it; `server_door_opened` from
step 14 plays **The Heart** (the Server Room revealed to everyone,
Trabolta's candid opener; quiet 120 s after the last opening, then *Back
To The Heart*); `reset_server_room` replaced `rearm_server_room`
(`server_unlock`, `server_unlocked`, `disarmed_until` retired); the
Legendary Fact, the combo halves, the riddle and the code are `secret:
true`; a lost King game gloats at most once per 300 s; C16 says "every
third transaction" everywhere. **At his heart, like the Fallout Master:**
a room terminal's `terminal opened` / `terminal closed` set
`program.at_the_heart`; the stagehand persona key **`situations:`**
(gated `{name, when, prompt}` blocks for the voice and that speaker's
reflect, out of the shared brief) makes him candid there from the Y2K hour;
his `stand_down` power only offers (the story checks the proof, *What
Sandy Says* or *The Sandy File*), and the admin 🕊 `talked_down` ends the
night the Combo A way without a cable. He never says the year he met her.
**Review fixes:** one heart at a time (`Night.heart_holder`; a lost
`terminal closed` is re-sent), a proof he shared himself never counts, no
entry he holds carries the year or Sandy's line, and the mind file's
`secrets.never` (the code + the combo pairs, from `titi:facts`) keeps a code
a program types out of his shared memory and his voice.
**Terminal:** `?room=` on the screen state → `room: {id, open}`; a room
terminal sleeps until its LOCATION is open to everyone, speaks that room's
lines, keeps overlays only, ignores the TV mute; the `server-room` map
spot on both variants. **Platform:** `EventRuntime.declaredCharacters`
(a mod code lists the cast before the doors), an empty faction alert
banners no booth, the King's tablet says FOR THE CODE / PRACTICE and
never promises the real door. **Hardware:** per-input polarity, the
`{"open","tape","mode"}` payload, the YAML's `debounce_s: 20` and a test
that forbids any lock action; K-05 / K-27 / N-08 rewritten. **Docs:**
Help → *Running the server room* (`38-server-room.md`, was
`38-cold-lock.md`), the show README / DESIGN / DEMO / CHECKLIST
(HW-DOOR-09) / OCT31 (W-35, OP-23, pre-show box 19) / cast packs (the
emergency card's egress line, the patch-bay watch inside before 🕚).
Suites after both merges: core 1325 (incl. Postgres; the show test 193),
play 216, editor 270, terminal 208, reinstall/web 335, house 152 + 4
skipped, stagehand 298, VR 256 +
`quest.sh` 26, firmware 144 host checks, ops 118, bank 145; loomcheck
`--smoke` 0 / 0, `titi:facts --check` up to date.

**Oct 31 crunch, wave 6 built 2026-10-17** (on branches `oct31-w6/{server,
play,story,content,screens,reinstall,stagehand,ops-docs}`, merged `--no-ff`
to master in that order: 144b301, 05a61b3, 84e303f, 1160d8b, 422a546,
8db59c7, 2ac42e0, then ops-docs; not deployed — the VPS still runs
`w3-1015`, so waves 4–6 ship together; OCT31.md §5 *Wave 6 status* has the
per-commit table with each device check, the decisions, the not-building
list and the deploy order). Four live test runs found 23 distinct bugs
(B1–B22); wave 6 fixed them, then the cheap open items that keep a promise.
**Server (core):** a director's Release is a real journaled `release`
(`Sim.release`, fires `released`); backing out of a trade is never
rate-limited; an accurate 📝 filing carries the key's canonical
`key_answer`; a guest's `dm:` must name a declared character (404) and is
canonical; `<who>.escrowed` mirrors coin in escrow; a director's stimulus
fires `stimulus`; a channel reveal joins a run of "open now" notices; the
recap takes back a corrected lie. **Play:** a booth banners only alerts to
everyone / its character / a staff room; answered cards are per sign-in
token (a restart's CAPTCHA works on the same tab); booth readouts clear on
a restart; the restricted-room note; wallet cards open their thread, stop
counting down after a deny and show the live glyph; a fact card with no
open questions folds closed. **Story:** a host can undo a mis-tapped
verdict; the Trust Chart call-outs stay up (certificate on START); closing
cards per round; G10 only to MS Paint; DraftKings counts escrow; count
copy; a duplicate chess win changes nothing; re-arm resets the wrong
combos; G11 waits for the last award; rain-night wording + the shed clues
in The Optical Drive; the Truther Download blacks out Sandy until the story
names her (*The Truther Download Unredacted*); MS Paint's invitation is
canon (the NSCAD letter is a thesis decision); the Featured Briefing hands
each featured program its own two red facts; Purgatory says who met their
goal; every room's first check-in has a 📎 aside (codex 178 / 90 codes,
quests 25). **Content:** draft H1–H6 / F1 rewrites as inert `proposal`s,
TD05–TD20, M22 / M23, C16 "every third transaction" — all awaiting the
user's sign-off. **Terminal:** the provisioned character is the story's own
name (`canonicalCharacter`), a tap peeks under a held slide (`PeekClock`),
the TV mini-map clears VOICE. **Reinstall:** the trail walks through the
fallen King's door (`trailMap`), a failed win is dropped once a host is
told, the map page follows a variant switch made elsewhere, a lost / drawn
/ stalemated King game re-deals. **Stagehand:** an Ollama orchestrator
loads with `num_ctx: 20480` and `stagehand check` warns (naming the key)
when a late-night reflect won't fit — no `laptop.yaml` edit. **Ops-docs:**
the morning-of checklist covers waves 4–6, the runbook drift, the
mirror-fallback runbook (`docs/trapped/kiosk.md`, OP-22), DESIGN matches the
code. Deploy: the server first, then `sync-show` (+ `--replace-maps` once)
right away — wave 6 changes what an old journal replays to, so restart
every non-ended event before a guest uses it. Not building before the
freeze: OCT31 §5. Suites on master after the merges: core 1295 (incl.
Postgres), play 215, editor 270, terminal 191, reinstall/web 330, house
152 + 4 skipped, stagehand 267, VR 255 + `quest.sh` 26, ops 114; loomcheck
`--smoke` 0 / 0, `titi:facts --check` up to date.

**Oct 31 crunch, wave 5 built 2026-10-16** (committed as 85d2bad on top
of 9d35a4b, + a35f175 for `ship.sh`; not deployed; OCT31.md §5 *Wave 5 status* has the
per-item table, the 18 decisions taken for the user, the deferred list and
the open issues). The stock-take of every item still open after wave 4,
in six lanes plus four hand-off units. **Server (core):** offers resolve
an entry by id, folded id or title (a buy never checks what the seller
holds); a held transfer approves itself after 5 min (`HOLD_MS`, step
`timed_out`, no `transfer_approved`) and `POST /api/mod/wallet/approve-held`
clears them all; a restricted guest's wallet calls answer 403 (decline +
cancel still work); Runescape's **grant + freeze** (minter clauses `grants
N` / `freeze <dur>`, defaults 3 and 10 min; `POST
/api/guest/wallet/{grant,freeze}`, `POST /api/mod/wallet/{grant,freeze,unfreeze}`;
events `grant` / `grant_received` / `freeze` / `wallet_frozen` /
`wallet_thawed`; a freeze thaws on the story clock); `/api/mod/spatial/begin`
fires `reinstallation begun` first; `flushClock()` on SIGTERM / SIGINT;
`stale` covers the maps + `facts.json`; the recap gains shares, chess and
bathroom trips; `LOOM_SNAPSHOT_MS` coalesces guest + booth snapshots (off
by default, K-32's contingency). **Engine + story:** INTERACTION
`restricted: allow` (the show's 🚻 / Back); `sum` / `max` / `len`; commas
are safe inside quoted `with` values; lint `L1203` / `L1204` for unparsed
`currency:` / `wallet:` lines; a `!!` pin is the full-screen takeover
(Combo A / B, lifted at the dance by `lift_the_takeover`); Truth Pong cups
decide round 2 (`cupped`); DraftKings' majority via `sum()`; Jeeves' *Ten
Findings* and MS Paint's *Million Dollar Painting* quests (🖌 Signed, cue
G10); the G11 `resurrection` cue after the ceremony; Bathroom Mode times
out after 15 min; Trabolta's `play_on_the_screens` (four text cards,
wall terminals only); the generated `== Facts Bundle` for the majority;
the bank delegates the new verbs. **Play:** the takeover layer, push taps
open the right room (`?room=`), K-31b's iPhone Home Screen path behind
`LOOM_HOMESCREEN` (`POST /api/guest/homescreen`, a per-guest
`/manifest.webmanifest?code=&pair=`, `POST /api/prime/logout`), the 🎁 /
🧊 sheets, and the director's **phone cue sheet** (`/?role=director`,
polling `GET /api/state?role=mod&cues=1`). **Editor:** Run's Wallet and
House map cards, award suggestions, who filed what, Restrict /
Unrestrict, the print sheet's door sign + cast cards + sorted stacks, the
Terminals card's badges + identify. **Terminal:** the Trust Chart's
bottom-up reveal + call-outs, heartbeat extras + **identify** (`POST
/api/mod/screen/identify`), every announcement in a poll spoken, N-04a's
TV mp4s (inert without the file). **Stagehand + reinstall:** the lights
catch-up on reconnect / restart, `duck_music` under announcements, the
orchestrator's lore + world filters; the King at hp 8 / 2 s, a lost win
re-posted, 2 s holds + the map passcode, Save to project before a switch,
map variant labels. New `.env` knobs: `LOOM_SNAPSHOT_MS`, `LOOM_HOMESCREEN`
(both off). Deploy extras: one `sync-show --replace-maps`, reprint the M19 card
(the `laptop.yaml` `num_ctx: 16384` step is superseded: wave 6 defaults the
orchestrator to 20480). The fix
round closed open issues 1, 2, 6–10 (Pong Orders retitled *A Game For
Two Players*, the clearance's `tube_chase` mirror gone, a performer
`?code=` link opens the performer sign-in, the map switch sends a `base`
→ 409, `FactsFiling.how` / `by`, the booth's queue countdown ticks, a
terminal that boots mid-clip holds the clip). Open: the wallet
countdowns run through a pause. Suites at 85d2bad:
core 1257 (incl. Postgres), play 196, editor 269, terminal 175,
reinstall/web 305, house 152 + 4 skipped, bank 145, stagehand 263, ops
103, accept 10, VR 255 + `quest.sh` 26; loomcheck `--smoke` 0 / 0.

**Oct 31 crunch, wave 4 built 2026-10-16** (committed as 9d35a4b; not
deployed; OCT31.md §5 *Wave 4 status* has the per-item table).
Six lanes. **facts**: the team authors one project file, `facts.json`
(8 hunt questions over three rounds with the answer key + aliases, 60
scannable + character facts with codes, 20 truth-or-dare `truths`), and
`pnpm --filter @loom/core titi:facts [--check]`
(`core/scripts/titi-facts.ts`) regenerates `generated/questions.loom`
(the three hunt QUESTs + Trabolta's reading beats), `codex/9-facts.loom`,
`generated/print-stacks.md` and the marked blocks in `trabolta.mind.md` +
`DESIGN.md §2.11` (`--check` is the test gate; generated files carry a DO
NOT EDIT banner). `codex/3-hunt.loom` is gone; the codex is 177 entries /
90 codes (178 since wave 6); the six-stamp hunt is retired for the `▒ HUNT ANSWER <id> ▒`
marker (`stagehand` `agents/secrets.py`). The 📝 fact card asks "Please
select your confidence level in this response" (a 1–100 slider →
`{question, answer, confidence}` → `fact answered`). Judging is automatic:
`core/server/facts.ts` (`FactsBook` from the project's `facts.json`,
snapshotted at launch like the maps — `Store.loadFacts/saveFacts` →
`project-facts.json`, `/api/mod/load {facts}`, `LOOM_FACTS` = the LAN
fallback beside `LOOM_HOUSE`, `sync-example` always pushes the example's;
accurate = fold-match, lie = a miss at confidence 100, uncertain = a miss
below; `Night.judge_mode` `auto` | `review`; `do fact_filed` / `do
fact_judged` → `ModView.facts`) and the editor's **Judging card** on Run →
Mind (the mode switch, pending verdicts with accurate / lie / uncertain
overrides, per-question tallies). **judging + the bottle**: the First
Moment of Truth is ⏱ `close_the_filing` → 📋 `read_the_results` (per
question: consensus at 100 % → Clippy reads the answer; otherwise Clippy
reads what was filed, confident answers (100 %) are accepted right or
wrong, and only guesses (< 100 %, `uncertain`) are marked) → 🍾 `spin_the_bottle`
(`sequence: false`; the server picks a cleared program at the Desktop,
Trabolta asks on the TV, a Truth / Dare card, five picks per question;
Clippy's 🗣 `truth_answered` / 🙅 `truth_refused` / 🎩 `chose_dare`; a
dare or a refused truth → marked; the truths are facts.json's 20, TD05–TD20
DRAFT); a round's unfiled questions never reappear; the verdict counts
answered questions only; after truth.txt Trabolta deals everyone an
`answer` card for Sandy's pickup line (`show answer … with question:
"P1"`, both branches, the first correct one wins). **the Truthcoin
wallet**: header `currency: score as Truthcoin, max 500, expiry 10m` +
`wallet: approver, every 3, window 60s` (CRA Agent Software) / `wallet:
minter, limit 3, while …` (Runescape) → `model.currency`
(`core/src/runtime/sim/model.ts`, `CharDef.wallet`); `core/server/wallet.ts`
`WalletBook` (pending transfers inside their deny window, the approver's
held queue, open requests, escrowed codex offers, the stimulus count —
one journaled `wallet` op per change, timers on the story clock swept by
`EventRuntime.tickOnce`); a pinned **Wallet** room of cards in the phone
and the approver's booth; `POST
/api/guest/wallet/{send,request,respond,offer,accept,decline,cancel,stimulus,approve,deny}`
→ `{ok, wallet}`, `POST /api/prime/wallet/{approve,deny}` → `{ok, queue}`,
`POST /api/mod/wallet/{approve,deny,cancel,stimulus}` → `{ok, wallet}`;
`LOOM_RL_WALLET` (30/60 per guest). **staff**: no Alexa in the fiction —
`do announce` is the house system and the story plays `sound
announce_chime` (stagehand's `alexa` module keeps its code name: house
announcements); Task Manager is the main contact (`# task-manager` and the
admin team revealed at clearance, `cast/kit.loom`); the Installation
Wizard (Julia Tufts, `playable: false`, a voice; `cue tablet_wizard`)
replaces WebMD (`cast-packs/performers/installation-wizard.md`,
`webmd.md` deleted); the tent is in the backyard through a tunnel;
Clippy's tutorial has a Bathroom Mode step (`show tutorial … with
bathroom: "…"` → tour step `bathroom`); 7 staff quests (`quests.loom`, 23
in all) + `start|update|complete|fail quest X for <Character>` feed the
booth's pinned Quest Log / Codex / Inbox / Wallet rooms (`PrimeView.quests`
/ `questTotal` / `answered` / `wallet`); `POST /api/prime/widget {seq,
result}` answers a card shown to a character (fired as the character);
`/api/mod/quest {who}` takes a character. **marked**: live verbs `restrict
who [to Place, …]` / `unrestrict who` / `pin "…" [in room] [for who]` /
`unpin [in room] [for who] ["text"]` (`parser/statements.ts`;
`Sim.restrict/unrestrict`, `restricted` / `unrestricted` triggers,
`GuestView.restricted`, `ChatMessage.pin` / `unpin`); a marked program
keeps DMs + The Tube / The Internet (read-only, `visibleChannelsFor`),
loses its buttons (`/api/guest/act` 403), room posting, filings and
check-in (409), and sees a pinned 🚨 GO TO THE INTERNET card
(`play/src/pins.ts` `activePins` → `PinnedRail`; the guest's pin is a `!`
alert); the Antivirus booths chime on the Enforcer's 🚨 `marked` readout
(`cast/kit.loom`) and `# quarantine` gets an escort pin; `/api/mod/act
restrict|unrestrict`, `/api/mod/set restricted`. **the King**: `@loom/house`
`PropKind` `king` (`hp` / `signals` / `armed`), `Door.guard`, `doorGap`,
`guardWarnings` (a guarded door is shut for `route()`); the tent tablet
fights him (`reinstall/web/src/game/fight.ts` + `chess/` on chess.js
1.4.0: ⚔ HIT makes the AI dumber, ♟ CHALLENGE opens the board, checkmate
fells him → `chess won`, the Y2K gate kept; the tablet names itself via
`/api/mod/signal label`); VR shows the king + "The King is fought on the
tent tablet." The pool program *Start Menu* is deleted (`guestPickable`
31). **Deploy order**: the server before the first `sync-show` carrying
`facts.json` or the king maps (an old `validateHouse` refuses `kind:
"king"` / `guard`), then drop any stale kokoro container /
`spatial-house.json`. Open: an uncertain F1/F2 filing is neither credited
nor marked at truth.txt; a folder rehearsal has no judge and no WalletBook (rehearse on a
server project); facts.json's truths + questions are DRAFT; the Runescape
ten-minute freeze is not built (built in wave 5), offers bypass the approver, `every 3`
counts every send globally; `restrict … to` lists hidden places by name
and the escort pin reaches every booth; a guest's own `!` pin no longer
pushes the booths (booth cues ride the Enforcer readouts); the King is not
device-checked (the Lichess phone + ♟ stay the fallback); the editor's
performer lens lacks the booth's pinned rooms (closed in wave 5); the bank, the Rust engine
and the TextMate grammar don't know the new verbs (the bank delegates them since wave 5). Suites at 9d35a4b:
core 1155 (incl. Postgres), play 141, editor 213, terminal 153,
reinstall/web 271, house 151 + 4 skipped, bank 142, stagehand 234, VR 255
+ `quest.sh` 26.

**Oct 31 crunch, wave 3 landed 2026-10-15** (on master, d75b1f6..ce6f6cf;
waves 1–3 shipped to the VPS as `w3-1015` and were verified end to end
(8ccdf59); OCT31.md §5 *Wave 3 status* has the per-item table, the open
questions and the deploy log).
Four lanes. **rooms**: the story follows the user's floor plan. Basement:
the Server Room (cold storage), The Fan Closet (laundry), The RAM (studio)
and Disk Cleanup (bathroom 1). Main floor: The Start Bar (kitchen), The CPU
(office), The Steam Room (bedroom / game room), The Optical Drive (mud room,
the front door) and The Desktop (living room). Top floor: The Graphics Card
(bedroom 2), The Hard Drive (crawl space) and Disk Cleanup (bathroom 2).
Outside: the backyard (The Cloud) and the tent (The Internet). The Tube is
the halls and both stairs. Renames: The Mud Room → The Optical Drive,
The Cache → The Start Bar, The Registry → The RAM, `# ram` → `# clipboard`.
Five hidden LOCATIONs are new (14 in all), and they open at clearance. A
run of rooms opening together is one "📂 … are open now." notice
(`chat.ts`). `house.json` + `house.shed.json` are a 3-floor placeholder
(basement −2.7 / main 0 / top +2.8, 17 rooms, 12 ducks, spawn in the
tent). Terminal spots were renamed: `optical-drive`, `start-bar`, `ram`,
`bathroom-1-door`. The Z2M / WLED group ids stay as wired. The wave 2 map
is frozen at `house/test/maps/two-floor{,.shed}.json` for the mechanics
tests. **story** (engine features in `core`): ROLE `secret: a, b, quest.x`
slots, CODEX `secret: true` and CHARACTER `secret: true` are never in an
agent request or `/api/agent/facts` (the Kernel is secret; `anti_ai`
moved onto it). An unrevealed hidden group is masked for agents. GENERATOR
`while <cond>` silences barks. `/api/screen/state` carries the live Trust
Chart (`chart`). Other fixes: judge refusals go to `# hosts`, the VLC
certificate rule, the fact-label bug, the ad hijack as a phone alert, the
WebMD scan guard, and the pool program *Start Bar* is now *Start Menu*
(deleted in wave 4).
[`DEMO.md`](./core/examples/trapped-in-the-internet/DEMO.md) shows the
WIP in 20–30 minutes (pinned by a test), and the Run page has a **Recap ↗**
link. **play**: the stream sticks to the bottom. A closed door polls
`/e/:id/api/identities` (`doorsOpen`) with backoff and shows "busy" on a
429. INTERACTION gained `by:` (characters or a GROUP) and `while:` (read-only,
`Sim.holds`): a performer's card leads with its own live buttons, and
non-live guest buttons drop. A `hold:` character shows no presence.
`GET /api/landing` brands the bare `/` (previews are skipped). Each 📝 fact
card lists every unfiled open question. **reinstall**: the web game works
end to end with no hardware (laptop keys, a phone or tablet with touch
sticks). `trail.ts` (VR `Game.trail_path`) takes the chevrons up, down
and out from under stairs. The three-floor fixture adds goldens.
`validateHouse` refuses stacked stairwells. The wizard fits a phone, and
WebGL2 is checked before Play here (with no-start reasons). Open: VR's
`game.gd` stair-trail checks still use the old map's coordinates. K-28
only corrects footprints now (stacked flights must be drawn offset). The
five new rooms have no light groups. The shed clues still need a home.
Merged-master suites: core 966 (incl. Postgres), play 107, reinstall/web
232, house 137 + 4 skipped, terminal 153, editor 209, bank 142, stagehand
234, ops 103, VR 248 + `quest.sh` 26.

**Oct 31 crunch, wave 2 landed 2026-10-15** (on master, e28da4d..9e0d0dd;
**not yet deployed to the VPS**; OCT31.md §5 *Wave 2 status* has the
per-item table, the deploy steps and each item's device check). Five
lanes: **show-map** — the placeholder `house.json` now follows the story
(the tent outdoors in the backyard, the Server Room off the basement
landing, the Truth Pong table, The Tube's path, 10 ducks clear of walls
and ≥ 10 m from the spawn; `core/test/show-house.test.ts`) plus a rain
variant `house.shed.json`; **map-server** — the map is a project file
(SW-MAP-01: snapshotted at launch, director save > the project's active
variant > `LOOM_HOUSE`, Save to project, syncs keep the project's copy)
with live tent ⇄ shed variant switching (SW-MAP-13); **map-editor** —
`/reinstall/map` became a floor-plan editor (floors, room / yard / door /
stair tools, the yard cut round a tent, undo / redo, walk + LOCATION
checks, 3D preview) with a slot for the project bar; **voices** — native
device voices by default (the user's decision: *"we can just use the
native screen reader voices on the devices? The TTS seems
complicated"*): terminals and the TV use `speechSynthesis` → Fully
Kiosk's `fully.textToSpeech` → text, `alexa` uses the Mac's `say`, Kokoro
is opt-in (`--profile tts`, `LOOM_TTS_URL=off`), and `&announce=1`
terminals speak house announcements (N-09); **extras** — the Inspector's
codex + quest grants (S4), the Cold Lock director article
(`docs/help/authoring/38-cold-lock.md`, renamed `38-server-room.md` in wave 7), duck run times for the speedrun
award (SW-RE-14) and the `scripts/accept/K-04-burst.ts` burst harness
(SW-AI-23). Open: the shed variant's clues need a new home on a rain
night; deploy the server **before** the first `sync-show` that carries
maps, then remove the old kokoro container and any stale
`spatial-house.json`. Suite counts are per lane until the integration
pass (terminal 148, house 133, stagehand 233, ops scripts 103, VR 227).
**Cross-lane review fixes (same day):** a remap (the tent ⇄ shed switch,
a save) re-seats a player who is no longer `standable` (new in
`@loom/house` `locate.ts`, with `solidPropAt`; ported to
`house_locate.gd` and pinned in the locate goldens) at the new spawn — on
the server (`SpatialHub.setHouse`), the web game (`bodyAfterRemap`) and
VR (`respawn_after_remap`), since the shed is a solid prop on the tent
map; the variant rides `event.map_variant` so End → relaunch keeps it; the
character's voice ranks male first and terminal announcements female
(`pick-voice.ts` `CHARACTER_VOICE` / `ANNOUNCE_VOICE`) so Trabolta never
sounds like the house announcements; the show docs' shed switch is the map page's
*Map: Tent | Shed* bar (not `show-map-switch`), and Push draft / Go live
keep a rehearsal's director save (the 10:00 check is the map page's
status line). Re-run after the fixes: core 933 (incl. Postgres), house
135 + 3 skipped, reinstall/web 193, terminal 150, editor 208, VR 231 +
`quest.sh` 26.

**Oct 31 crunch, wave 1 landed 2026-10-15** (on master, ba494a7..d58803e;
**not yet deployed to the VPS**). The plan is
`core/examples/trapped-in-the-internet/OCT31.md` (§5 = the build list, a
*Wave 1 status* table with each item's commit and its remaining device
check, the VPS `.env` + deploy steps), the hardware/software list is its
`CHECKLIST.md` (`🎃 <id>` tags), the calendar its `SCHEDULE.md`. 36 items
built in four lanes: **doors + phones** — `LOOM_BASE_URL` join base,
SSE-safe Caddy + `scripts/sync-show.sh` (K-01), codes pinned across End
→ relaunch + rotate staff codes (K-10), the iPhone booth scanner (N-01),
alerts that land on wake / in booths (K-06, N-07), room check-in by QR
(K-13), single-use re-pair + release a performer's part (N-02, N-10), Web
Push for Android + booths (K-31a); **story + Run** — *File a fact* judged
from `# hosts` (K-24, N-05), the Cold Lock chess disarm + manual
majorities + `chess lost` / `chess drawn` (K-27, N-06), door-rush
throttles (K-11), hunt-answer secrecy in the worker (K-23), the `hold:`
line when no worker is online (N-11), Run's Print sheet (K-12) and cue
sheet (K-21), the awards ceremony + recap (`beats/ceremony.loom`,
`/api/mod/recap`; K-25, K-26), cast packs drafted (`cast-packs/`, D-01);
**screens + sound** — old-tablet builds + kiosk basics (K-14, K-15), the
lean screen state + attract (K-16), overlays / slides / countdowns (K-17,
N-03), the TV's room voice `view=tv` (K-18, N-04b), the terminals
heartbeat card (K-29), bundled Kokoro (K-19), the `alexa` player on the
house Mac (K-20); **ops + hardware** — stagehand house rig (edge/retain,
safety lights, launchd; broker on `127.0.0.1:1883` + a `props`-only LAN
listener on `:1884`; K-05), the server-room ESP32 firmware
(`hardware/server-room/`, N-08), pinned releases / rollback / backups
(`deploy/`, `scripts/ops/`; K-08), the lean mod stream (K-22), the load
test (`scripts/accept/k32-load.ts`, `/api/mod/metrics`; K-32), Quest
export (`reinstall/vr/tools/quest.sh`, K-30). Then a verification pass
(re-pair became a single-use pair code; a director's reply as an agent
closes its queued request; refused agent powers don't spend their limit;
a 300-device push cap) and leftovers (any ending stops every story clock;
place arguments fold onto the declared LOCATION; ceremony sounds; *The
Cold Lock* codex). **Assumptions:** one house Mac (the 48 GB Ollama
laptop) drives the TV over HDMI + the MOTU audio and hosts Mosquitto,
Zigbee2MQTT, stagehand `show` + `agents` and the `alexa` player; decision
**#35 = no hosted fallback** (no worker → the `hold:` line + directors
answer from Run). **Still to do:** deploy to the VPS, then every item's
device check (a helper per item under `scripts/accept/`, listed in the
OCT31 §5 table); not built yet: K-02 tablet bench, K-03 live tent run,
K-04 live mind run, K-07 cellular sheet, K-28 the measured `house.json`
(the map is still the placeholder), K-31b, and the optional N-04a / N-09
/ N-12. Tests: core 877 (incl. the Postgres-gated suite), play 91,
editor 201, terminal 124, house 125, reinstall/web 120, bank 142,
stagehand 230, VR 226 + `quest.sh` 26, ops scripts 98, server-room
firmware 112 host checks, accept live-guard 2.

**Trapped in the Internet was rewritten from the source story 2026-10-14**
(`core/examples/trapped-in-the-internet/`; runbook, cue sheet, integration
contract and print/QR appendix in its `README.md`; the software and
hardware still to do in its new `CHECKLIST.md`). The show now follows
`Trapped In The Internet story/` STORY BEATS beat for beat: arrival (fail
the CAPTCHA, leave something behind, an Antivirus pass scan) → Computer
Bingo and the first reinstallation → Trabolta introduced → Truth
Scavenger Hunt 1 + Moment of Truth + Truth or Dare → the ad hijack + the
hour + the Truther Download (per-featured glitch beats, missions, quests)
→ Truth Pong, the Trust Chart, the printer full of beans, the zip → the
overshare (scenarios 1–4) → the Y2K clock and the two faction majorities
(gated on each leader's task) → the server room (alarm latch, patch-bay
Combo A / B) → the final reveal, Bobbing for Truth, truth.txt and the
verdict → eight endings (`disabled`, `destroyed`, `song`, `song_pickup`,
`rave`, `help`, `banished`, `hand_jive`). New files: `beats/{malware,pong,
overshare,server-room,finale}.loom`, `cast/{featured,staff}.loom`, eight
numbered `codex/` files. Removed: `beats/{glitch,endings}.loom`,
`cast/programs.loom`, `codex/{programs,trabolta,world}.loom`.
Structure: the nine **featured programs are guests** (bare CHARACTERs
tagged `program.featured` at join; none speaks anywhere, or it would turn
into a performer part). Performers are exactly Clippy, Task Manager,
Adobe Acrobat, Recycling Bin, the four Antivirus (Norton, McAfee,
Password Manager, CRA Agent Software) and WebMD (wave 4, 2026-10-16,
replaced WebMD with the Installation Wizard, a `playable: false` voice,
and reworked the hunt, the judging, the wallet and the marked state — see
the wave 4 entry above; the counts below are that day's). Every story rule lives in
`main.loom`, and the admin INTERACTIONs are the cue sheet in running order,
labelled with the source prompt codes (C1/C2, V1–V6, Clippy N/X).
**Secrets live on a hidden `CHARACTER Kernel`** (combos, per-question
verdicts, the majority, the virus planter), never in `Night.*`, so they
never reach Trabolta's worker. Trabolta is offline (`hidden`, gate
`self.awake`) until `introduce_trabolta`. He has 8 stages keyed to
`Night.phase` and 11 phase-windowed agent powers, and ships `lookup:
false`. The house's show control is the new `stagehand/trapped.house.yaml`
(+ `tests/test_trapped_house.py`). The bathroom room is relabelled
`Disk Cleanup` in `house.json`. **Engine fix:** `views.ts` now offers a
revealed hidden group as a side in `GuestView.factions` (+ a `views`
test). `identity.test.ts` was updated to the new cast. The project
compiles clean (29 files, 86 beats, 132 codex entries, 16 quests, 74
rules). Session smoke drivers pass end to end (339 + 154 checks). The two
items left open that day are done: `core/test/trapped-in-the-internet.test.ts`
was rewritten for the new story (94 tests, green) and
`editor/e2e-live/mind.spec.ts` no longer references the old Trabolta.

**The reinstallation games + spatial terminals landed 2026-10-10** (new
`house/` + `reinstall/web` + `reinstall/vr`, TS `core/` server, `terminal`,
the show; contract [`docs/loom-reinstall.md`](./docs/loom-reinstall.md),
overview [`reinstall/README.md`](./reinstall/README.md); help:
`play/11-reinstallation`, `play/09-terminals`, `authoring/33-live-verbs`).
Asked for: replace the VR-station goose with a real game. A corrupted
program walks a **virtual copy of the house** to the **golden duck**, on a
Quest 3 or a tablet, and every wall terminal shows them doing it. **One
frame:** `@loom/house` (`house/`, pure TS) owns `house.json` (schema v1,
`validateHouse` — incl. floor spacing > 0.5 m, walls through a higher
floor, outside doors on shared walls, overlapping door gaps, stair
clearance / skipped floors, spot + spawn heights, nothing buried in a solid
prop, door tolerance against the mm-rounded wall line), the normative §1.2
geometry (`buildWalls` in integer mm), `locate`/`heightAt`, `route` (a
**visibility graph** over doors, stair ends, reflex-corner / stair-rect /
solid-prop waypoints at 0.35 m — props grown `PROP_MARGIN` 0.25 m, rects
µm-rounded for ports; Dijkstra with index tie-breaks → the chevrons),
`pickDuckSpot` (FNV-1a 32), `DUCK_MAX_RISE` (1.2 m) and terminal fov
(`DEFAULT_SPOT_FOV` 70° *vertical*, `horizontalFov` at 16:10).
`@loom/house/three` is the shared three.js scene, duck, trail, ghosts and
`PoseBuffer`. 24 goldens (8 maps incl. `props`; `pnpm house:sync` copies
them + the map into `reinstall/vr`) pin the Godot port. The show's map is
`core/examples/trapped-in-the-internet/house.json` (a **placeholder** until
the house is measured: 3 floors, 17 rooms on the story's 14 `LOCATION`s
(both bathrooms are Disk Cleanup, the halls The Tube), spawn in the tent;
restructured in Oct 31 waves 2 and 3, see above). **Server:** `core/server/spatial.ts` `SpatialHub` (transport-free,
injected clock) owns sessions (secret token, minted by `begin`), stations
(parked assignments claimed by the first pose, which ends anything else on
that station), latest-only poses (labelled with `locate`, never journaled,
unaffected by pause), and `found` (`nearDuck`: ≤ 2.0 m plan and ≤
`DUCK_MAX_RISE` in y *or* on the same floor; 409 "doors are closed" while
paused, 409 for an unclaimed parked session), which commits
`signal("the simulation completed")` then `signal("the golden duck")` `by`
the device. Its SSE stream carries `hello`/`join`/`poses` (100 ms flush)/
`found`/`leave`/`house`/`duck`/`reset`. The map: a director's save
(`spatial-house.json` per event state dir — never `house.json`, which
`LOOM_HOUSE` may name) else the show file (re-read on mtime change, last
good map kept; since Oct 31 wave 2 the project's map sits between them); `POST /api/mod/spatial/house {house, base?}` → 409 on a
stale `base`; `setHouse` carries live sessions over (duck keeps its spot
id or is re-dealt → a `duck {session, duck}` frame after `house`; the
session-token `GET /api/spatial/house` carries `duck` too). Routes:
`GET /api/spatial/{house,stream}`, `POST /api/spatial/{pose,found,end}`
(pose ≤ 2 KB, `p` = feet), `GET /api/mod/spatial/{station,stations,candidates}`,
`POST /api/mod/spatial/{house,begin,end}`; `routing.ts` holds the pure
sub-app / CSP / mod-read decisions. `LOOM_HOUSE` / `LOOM_REINSTALL_DIST`;
`/reinstall/*` is served like `/terminal/`. **Web** (`reinstall/web`,
`loom-reinstall`): the tablet wizard, twin sticks + keyboard, circle-vs-wall
physics on `buildWalls` + `heightAt` (ramps block from below), plays only
on the dealt map version (refetch on `hello`/`house`), pauses keepalives +
the idle countdown while hidden, ends on `pagehide`, treats "doors are
closed" as paused (retry on the backoff), adopts a moved duck; the
`/reinstall/map` viewer/editor saves with `base` and offers copy / reload on
a 409. **VR** (`reinstall/vr`, Godot 4.7): GDScript ports of the house code
(route incl. the prop rule), the XR rig, station polling (404 → lobby →
re-link to the passcode's current event), a wall-clock grace on headset
removal, map-version refetch (2 s) + duck adoption, the server's found
rule, the lobby picker, and `--autopilot` (`game/autopilot.gd`: follows the
route, doors and stair ends square-on, detours only its own approach legs,
exits 0 on a find). **Terminals:** `spot` + `view`
(`auto`/`world`/`face`/`mirror`); the `world/` view with a pure camera
director (vertical mount fov), a mini-map (horizontal cone), `duck` frames,
and the found celebration. **Story:** the goose became `INTERACTION the
golden duck` + `CODEX The Golden Duck`; the tent beat says "walk to the
duck". **Ops:** `scripts/dev.mjs` builds `loom-reinstall` too
(`--reinstall` adds its Vite on :5176). The `Dockerfile` builds it and
ships `house/` + `reinstall/web/dist` (`--filter '@loom/core...'` links
`@loom/house`); compose/`.env` show a read-only `LOOM_HOUSE` bind mount.
Tests: house 122, core 689 (`spatial` 36 + `spatial-routing` 8), terminal
70, reinstall 120, play 59, editor 175, VR 225 headless checks (every
golden at 1e-3, the link over a fake transport, autopilot reaches every
show duck spot kinematically and with real collision). **Verified end to
end** over HTTP against a scratch server: a web-style session walked
`route()` to the duck (409 far → 200 released → codex → `leave found`
after 8 s → 410), station park/claim, and the **headless Godot game with
`--autopilot`** found ducks upstairs and down on the live server (exit 0,
released). That run caught a real VR bug: `found` waited for an empty pose
pump, which never happens because the game offers a pose every frame. It
now flushes the newest pose and claims once that lands (`PosePump.flush`).
The review round's later fixes (moved ducks, pause, save conflicts, prop
routing, fov) are unit-tested but not yet re-run against a live server or
in a browser / headset.

**Hand-picked profile pictures + a picture picker landed 2026-10-02**
(TS `core/` + `play` + the show; help: `authoring/30-live-shows`,
`play/01-welcome`). Asked for: every named character pre-picked, and
guests choosing among a few pictures instead of Wikipedia's lead image
(often a screenshot, not the famous logo). **Language:** `avatar:` takes
a URL *or* a Wikipedia / Commons `File:` name, `|`-separated (first =
default; `CharDef.avatar: string[]`, `avatarsOf`), and `wiki: Article`
(`CharDef.wiki`) names the article when the name finds the wrong one.
**Server:** `wiki.ts` `rankFiles` (logo / icon / box art / exact-name
emblem over the lead screenshot; furniture regex widened, a 48-px floor)
+ `WikiClient.pictures(name)` (one listing + one batched `imageinfo`,
memoised) — `avatarFor` now takes the best of those; `fileUrl` →
`Special:FilePath` (no API needed). `avatars.ts`: `AvatarBook.offer`
(servable, nobody's — search results no longer assign pictures),
`"chosen"` entries a re-seed keeps, `avatarRefUrl`; `ImageCache({dir})`
keeps bytes on disk (`server.ts` → `LOOM_STATE_DIR/pictures`, passed
through `EventRegistry`); `seedAvatars` prefetches every picture when
the story loads. Routes: `POST /api/identities/pictures`, `picture` on
`guest/register` (validated against that program's options), `POST
/api/guest/picture`. **Play:** `picture-pick.tsx` `PictureGrid`; tapping
a program opens *Your picture as X* (skipped when there's only one);
**🖼️ Change your picture** on the profile sheet; avatar tiles are
`object-fit: contain` (wordmarks were cropped). **Show:** all 40
playable characters + Trabolta carry `avatar: File:…` (Trabolta's
`HAL9000.svg` is a stand-in). Tests: core `identity` (+6), play
`avatars` (+1). Verified live against real Wikipedia (scratch :7311 +
Playwright: pool picker, Winamp options, NHL 97 search → box art first).

**The quest log landed + the codex became a room 2026-10-02** (TS `core/`
+ `play` + `editor` + the show; help: `authoring/37-quests`,
`play/10-quests`, `play/08-codex`; guide §11.13a). Asked for: a quest
log for *Trapped in the Internet*, "similar to the codex", and the codex
turned from a header button into a chatroom — both **pinned rooms**, each
quest with its own thread. **Language:** `QUEST name` (`title:` / `from:`
giver / `text:` brief → `QuestBody` / `model.quests` + `questIndex`);
statements `start | update | complete (finish) | fail quest X for
<who|everyone|scope> ["line"]` (two-word verbs in `statements.ts` →
`quest_start` / `quest_update` / `quest_complete` / `quest_fail`
directives); triggers `when program starts|completes|fails quest X:`
(`questTrigger` in `model.ts` — the word `quest` is required so `the
simulation completed` stays a named event); world mirror
`who.quest.<slug>` = `active|done|failed`. **Sim:** `questLog`,
`stepQuest` (start once, update/complete/fail only while active),
`quest(action, person, quest, text)` mutation (journaled `quest`),
`questsFor` / `questStatus`, `SimEvent quest`. **Chat:** pinned rooms
`codex` / `quests` (`CODEX_ROOM` / `QUEST_LOG`, space `pinned`, one id
for everyone, every message addressed to one person, `canPost` false for
typed chat); `codexUnlocked` → a `kind: "codex"` card (`CodexCard`) in
the holder's Codex + a "You shared…" note for the sharer, misses land
there too (no more lobby notices); a quest step → `kind: "quest"`
(`QuestCard`) — `start` opens a thread (`DraftMessage.threadKey` /
`threadRoot`, resolved by `ChatStore.append`), later steps reply to it,
so restarts rebuild the threads exactly. Performers' booths never get
pinned-room messages (`visibleToPrime`). `GuestView.quests` /
`questTotal`; `POST /e/:id/api/mod/quest {who, quest, action, text?}`.
**Play:** the 📓 header button + Codex sheet are gone; `buildGuestChannels`
adds the Pinned space (Quest Log, then Codex, fixed by `roomOrder`);
`chat.tsx` renders codex cards (Share… via `CardActionsProvider`), quest
cards (status from `questStatusOf`, opens its thread) and quest steps;
the Codex composer redeems (**Unlock**); a `?unlock=` link opens the
Codex; the tour gained a Quest Log step and points at the pinned rows
(`Channel.tour` → `data-tour`). **Editor:** each guest's pinned rooms are
per-guest cockpit rooms (`Quest Log · Ada`), read-only, with compact
card rendering. **Show:** `quests.loom` — five quests (Orientation,
Computer Bingo, the Hunt, the Three Keys, Unplug) with steps wired into
the beats; ROLE gained `hunt_facts`. Tests: core `quests` (9),
`trapped-in-the-internet` (+4), `codex` (Codex room); play `quests` (5);
editor `rooms` (pinned rooms). The Rust engine does not know `QUEST`.

**Sign-in became a cast pick landed 2026-09-22** (TS `core/` + `play` +
the show; help: `play/01-welcome`, `play/07-performers`,
`authoring/30-live-shows`). Asked for: replace the guest name box and the
performer's free cast list with real pickers — guests choose an
unclaimed *non-special* named character or search the web for any
software (Wikipedia picture = profile picture, then locked; never
antivirus), performers choose an unclaimed *special* character (a named
role / beats), with scraped or authored pictures. **Server:**
`server/identity.ts` classifies every `CHARACTER` from the model —
*special* (hooks / owned beats / lines in a beat / `listed` / `mind`)
is a performer's part, a bare name is a guest's *program*; `playable: false` (new
`CharDef.playable`, on the show's `Prop` trait) removes it from both,
`mind: external` from the performer list, a `joinable: false` group
(the Antivirus) from the guest list. `server/wiki.ts` (`WikiClient`,
injectable fetch, memoised): CirrusSearch `hastemplate:"Infobox
software|video game|website"` queries + an unfiltered one for the real
ranking (title matches first), a title lookup with redirects falling
back to search then to the name minus its first word, and — for a page
with no lead image (non-free logos) — the article's own best file
(`pickFile`); 4 requests in flight at most, failures never memoised;
`isAntivirusSoftware`. `server/avatars.ts`: `AvatarBook`
(folded name → URL, opaque sha keys, `avatars.json`) + `ImageCache`
(process-wide LRU); `GET /e/:id/api/avatar/<key>` serves same-origin
(CSP untouched, never an open proxy). `EventRuntime`: `POST
/api/identities {passcode}` → `{role, identities[{name, faction, avatar,
claimed}], search}`; `POST /api/identities/search {passcode, q}` →
`results[{…, description, blocked}]`; `guest/register` takes `wiki`
(the picked title, re-verified server-side), refuses taken / part /
caste names (409) and antivirus (403), returns `avatar`; `prime/login`
refuses a part another booth holds (409; the same token may re-sign),
programs, agents, props; `loadScenario` seeds authored links + looks up
the rest (`init.wiki` — `null` in tests, `new WikiClient()` in
`server.ts` unless `LOOM_WIKI=off`); every view carries `avatars`.
**Play:** `avatars.ts` (`AvatarsContext` / `avatarLookup` / picker
helpers), `PersonAvatar` renders the picture when there is one (`src`
override for the pickers), `GuestRegister` = code → program grid +
directory search (antivirus greyed with the reason, taken greyed,
409 refreshes the list), `PrimeLogin` = parts grid with taken greyed.
**Show:** `cast/pool.loom` (24 programs), README casting note. Tests:
core `identity` (19, fake Wikipedia + fake images), play `avatars` (4). Verified live against real Wikipedia on a scratch :7311 server with Playwright (every part + all 24 pool programs got a picture).

**The mind debugger + control panel landed 2026-09-18** (Python
`stagehand/` + TS `core/` server + `editor`; help:
`authoring/44-mind-debugger.md`; `stagehand/README.md` → *The shape of a
night* / *The trace and the control panel*). Asked for: see how Trabolta's
prompts and reasoning change over the night, both models, and a control
panel the server also uses on resets. **Worker:** `llm.complete` returns a
`Completion` (content + `thinking` — gpt-oss `reasoning`, Ollama
`thinking`, inline `<think>` — finish, tokens, ms); every call is a
`Thought` in `agents/trace.py` (`voice` / `lookup` / `reflect` / `survey` /
`rerun` + `reset` / `control` / `error` markers; exact messages, raw
output, parsed result, the `Mind.diff` it caused, revision) → ring +
`<Character>.trace.jsonl` + `POST /api/agent/trace` (replayed on
reconnect). **The mind has structure** (`mind.py`): `stage` on a declared
arc (+ `stage_history` with why/by), `drives` 0–100 (+ `drive_starts`),
`policy {favours none|earned|loose, credit, wary, note}`, `questions` with
answers, `director` whispers (voice obeys at once; the next orchestrator
pass consumes them), `revisions` (numbered, by reflect/survey/director/
reset, thought id, small-field snapshot); `Mind.seed` adopts the mind
file's frontmatter (`stages:` / `drives:` / `phases:` — `parse_mind_file`
in `persona.py`; `trabolta.mind.md` now declares Trabolta's four stages,
four drives, six phase cues); the orchestrator prompt carries the arc /
drives / policy / questions rules, the phase cue, and the whispers, and
its schema asks for `stage` / `stage_why` / `drives` / `policy` /
`questions_add` / `answers_add`. `Agents.control(doc)` handles the
`control` stream frame (`reset` · `survey` · `nudge` · `set` brief/mood/
stage/drive/policy/trust/note/question · `forget` · `thinking` (Ollama
`think` toggle per character) · `effort` (voice `reasoning_effort`) ·
`pause` · `rerun` (re-execute a recorded call, never applied)); the old
bare `reset` frame is gone. `Mind.report` mirrors the *whole* mind +
worker `status`. **Server:** `agents.ts` — full `AgentMindReport`
sanitiser, `AgentThought` + `agentThought`, `AgentTraceLog` (ring per
character, byte cap, idempotent replay, `?after=` paging; survives a story
restart), `agentControl` validation, `AgentHub.control` /
`reset(by, reason)` (→ `control {action: reset}`); `EventRuntime`: `POST
/api/agent/trace` (→ `agentThought` SSE to mods), `GET
/api/mod/agent/trace`, `POST /api/mod/agent/control` (400 / 404 unknown
character / 409 nobody voicing it); `AgentMindSummary` = the full report.
**Editor:** `CockpitTab.Mind` (operator-only) → `cockpit/MindTab.tsx` +
pure `cockpit/mind.ts` (thought summaries, filters, drive sparklines off
the revisions, arc segments, diff rows); `CockpitState.minds` /
`thoughts` / `mindControl` / `loadThoughts` on both stores (the local
backend explains it has no worker); `operate.ts` handles `agentThought`
frames (`mergeThoughts`, cap 400). Tests: stagehand `test_debugger` (14);
core `agents` (+8: report / thought / trace log / control validation /
routes / restart-as-control); editor `cockpit/mind.test.ts`; the opt-in
live spec `editor/e2e-live/mind.spec.ts` (a real worker on both Ollama
models, driven to voice → reflect → nudge → restart, screenshots).

**The gentler first minutes landed 2026-09-18** (TS `core/` + `play` +
the *Trapped in the Internet* show; help: `authoring/30-live-shows`,
`32-chat-rooms`, `33-live-verbs`, `36-widgets`, `play/01`, `02`). Found
by watching new guests: the phone listed every room of the house at the
door, the Mud Room login played inside the full chat shell, and after
the glitch Trabolta's chat never appeared (a DM row only existed once a
character *spoke to you*; an agent-voiced character waits to be spoken
to). Now: **progressive rooms** — `LOCATION` / `CHANNEL` / `CHARACTER …
hidden: true` (`LocationDef.hidden` / `ChannelDef.hidden` /
`CharDef.hidden`) stay off a guest's phone until the story opens them:
`reveal X` (everyone) or `reveal X for who` (one person; `Sim.reveal(target,
person?)`, `revealed` sim event → a "📂 … is open now." system notice
for rooms; an exact room name wins over entity folding, so `reveal task
manager` opens `# task-manager` beside CHARACTER Task Manager), and a
hidden place also appears once stood in (`Sim.hasVisited`). Visibility
is `canSeeChannel` / `visibleChannelsFor`; performers + operators see
everything. The play app lists only rooms the snapshot lists (`isListedRoom`
in `session.ts`; delivered lines wait and appear with the room) and puts a
`dm:` row on the sidebar for every agent-voiced person in the directory.
**Cutscene**: `LOCATION … cutscene: true` → `GuestView.cutscene`; the
app renders `CutsceneStage` (`play/src/cutscene.tsx`): a dark full-screen
stream of `personalStream` (what was said *to* the guest — lines, cards,
decision), no sidebar/HUD, and a *Continue* once the story moves them on
(`useCutscene` in `guest.tsx` holds the stage until then). **Tutorial**:
`show tutorial "…" to who with guide: "Name"` → an `overlay` widget
(`play/src/tutorial.tsx`): a spotlight tour over the live controls
(`data-tour` anchors: rooms / me / codex / people / pass / help, measured
against the app root so it works embedded), steps trimmed to what the
story uses, Skip on every step; answers `{completed, steps}` or
`{skipped, step, steps}` → `when tutorial answered for who:`. Widget
answers now survive a restart (`card: seq` rides the journaled args;
`restore` rebuilds `answeredWidgets`) and ride `GuestView.answered` so a
reload never re-asks a settled card. The show: the Mud Room is a
`cutscene` and `when someone joins` moves the program there; the house
rooms are `hidden` (`# task-manager` opens at `call to the desktop`,
the rest + `# ram` at the glitch — "the house is open"); Trabolta is
`hidden: true` until `reveal self` at the glitch; `-> Orientation` after
the upload has Clippy deal the tour; skipping = +10 doubt, +5 humanity,
Norton logs it, Clippy remembers (`skipped_orientation`); finishing =
+2 truth + *The Orientation List* (codex, 43 entries now). **The door:**
after the upload a program waits in the Mud Room (`uploaded`, still on
rails; `show pass` deals their own QR onto the stage — the `pass` widget
kind, `WidgetProps.viewer` — and the cutscene header has a *My pass*
button) until an **Antivirus performer scans them**
— every Enforcer's `when scanned by program:` routes to the trait's
shared `beat Clearance` while `cleared` is false (clearance line, `move`
to the Desktop, `-> Orientation`); a host's scan just greets them. Lines
crawl **one at a time** (`Crawl.start/finish` queue on the host; a queued
line is `.pending` = hidden) and the crawl is clock-driven so a
background tab catches up. Dev: **`pnpm dev`** (root `scripts/dev.mjs`)
builds play + terminal and runs server + editor with prefixed logs;
`--sync "<project>"` runs `core/scripts/sync-example.ts` (example folder
→ `project_file` + `event.scenario_source` + `mod/load`) — the :7000
server has no watch mode and a server project's event plays a snapshot,
so this is how an example edit reaches the Run mode. Tests: core
`sim-reveal` (8), `server-interactions` (restart-safe answers),
`trapped-in-the-internet` (28); play `onrails` (7), `widgets` (crawl queue).

**The wall terminals landed 2026-09-16** (new `terminal/` + TS `core/`
server; see the table row + `terminal/README.md`). Server side:
`core/server/tts.ts` (`TtsProxy` — a moderator-gated, LRU-cached,
in-flight-deduplicated proxy to any OpenAI-compatible `/audio/speech`
endpoint; `LOOM_TTS_URL` / `_API_KEY` / `_MODEL` / `_VOICE` / `_FORMAT`),
`GET|POST /e/:id/api/mod/tts` on `EventRuntime` (503 when unconfigured →
the terminal falls back to the tablet voice), an optional `label` on
`/api/mod/impersonate` (a mod-token caller names itself — "Terminal ·
Kitchen" — as the journal's `by`), and `/terminal/*` static serving in
`server.ts` (`LOOM_TERMINAL_DIST`; CSP adds `media-src blob:`). Docker:
the `server` image builds + serves `terminal/dist`; compose / `.env`
carry the `LOOM_TTS_*` knobs. Tests: core `tts` (10) + `server-impersonate`
(label); terminal `scan` / `idle` / `split` / `pick-voice` / `mood` /
`config`. Help: `docs/help/play/09-terminals.md`. The show README's
integration contract gained a **Terminals** row.

**Run → Players landed 2026-09-16** (TS `core/` + `play` + `editor`): admins
run full rehearsals without leaving the editor — one embedded **real play
app** per guest/persona/performer, side by side, each on its own
`/api/mod/impersonate` session (exact, in-memory, journaled `by` the
director; cut by the same restarts as the real session). The play app gained
a host seam (`play/src/host.ts`) + `embed.tsx`/`embed-css.ts` so it runs
standalone or many-times embedded in shadow roots. Supersedes the deferred
"open the play app as X" design (no URL tokens, no shared localStorage).
Details: `editor/CLAUDE.md` → *Players*.

**The play app became a chat app + `show` cards landed 2026-09-16** (TS
`core/` + `play` + `editor`; help: `docs/help/play/{01,02,04,07}`,
`docs/help/authoring/36-widgets.md`; spec `loom-4.md` §6.1 / §11; guide
§11.12a). Found by playing the live *Trapped in the Internet* preview:
the lobby was titled `── main.loom ──` (the parser took the file
separator heading as the story title — `parseHeader` now skips
`isSeparatorHeading`), the Mud Room played to everyone including
performers (`start: Login` fired the per-guest beat un-addressed; the
show now opens on a house-wide `Power On` beat and `Login` only via
`when someone joins`), performers got a seven-button panel under every
room (the booth dispatched on id prefixes, so location rooms fell into
the guest-thread branch), the typewriter replayed on every room open,
and nothing said who was where. Now: `play` is a **two-pane MSN/Discord
shell** (`Shell` in `chat.tsx`, sidebar + stage ≥ 820px, drill-in on a
phone) with **presence** (`presence.ts`: `occupantsByLocation`,
`roomOrder` — the room you stand in first with a *you are here* tag,
"3 here / just you / empty" per place, a 👥 strip + people sheet in every
room header; `PersonCard.location` / `PrimeGuest.location` from
`views.ts`), Discord-style messages (avatar tile + name per sender run),
a **crawl-once typewriter** (`crawl` policy: never the backlog, never
twice), the performer's guest actions moved onto a **guest card** (⚡
Actions / tap a name / who's-here), a **cast picker** at performer
sign-in (`ResolvedCode.characters` from `EventRuntime.characterNames`),
and a dead-token check that confirms with `/api/state` before dropping
a session. **Widgets:** `show <kind> ["text"] [to scope] [with k: v]`
(`statements.ts` + `Sim.runShow` → `SimEvent.widget` → `ChatMessage.kind
"widget"` + `WidgetCard`, routed like a choice: the last speaker's DM,
else the setting's room) render through the `play/src/widgets.tsx`
registry (`captcha` — deterministic 3×3 grid per seq, `image`, `poll`);
an answer posts `POST /api/guest/widget {seq, result}` (one per guest per
card, result sanitised by `widgetResultArgs`) and fires the named event
`<kind> answered` with the result as arguments. The Mud Room now shows a
real CAPTCHA (`beats/login.loom` — solving it proves you're human:
INCORRECT, +10 humanity, again; any second answer is CORRECT). Tests:
core `sim-widgets` + `parser` (separator) + `server-chat` / `server-
interactions` / `registry` / `views` / `trapped-in-the-internet`; play
`presence` / `widgets` (grid, judge, crawl policy) / `spaces`. Gotcha:
`grep` skips `core/src/runtime/sim/sim.ts` as binary — use `grep -a`.

**Agent-voiced characters landed 2026-09-16** (TS `core/` + `play` +
Python `stagehand/`; Trabolta talks). A `CHARACTER … mind: external`
(`CharDef.mind`, plus `CharDef.ranges` from declared `lo to hi` slots)
has no performer. The event server's `AgentHub` (`core/server/agents.ts`,
transport-free) turns each conversation with it into an **agent
request**: a guest's `dm:<C>` (`/api/guest/say`), a performer's private
`cast:<C>` thread (`/api/prime/say` stores it as `dm:<C>` with audience
`@<Performer>`, visible only to that booth; `PrimeView.agents`), or a
director's persona (`/api/mod/say`). Requests stream to workers on
`GET /api/agent/stream?characters=&name=` (mod-gated SSE: `hello` /
`request` / `cancel` / `reset`). A request is self-contained: thread
history, speaker, both parties' vars and codex, ranges, world globals.
Workers answer `POST /api/agent/reply {id, worker, say, adjust}`: a
journaled `say` into the thread, plus `setVar` deltas clamped to the
declared range (undeclared names are ignored). The hub keeps one open
request per thread (a burst mid-reply → one follow-up), queues while
offline (10 min), re-dispatches on worker loss, times out at 2 min (one
retry), and cancels on restart. It sends `typing {channel, from, on,
audience}` to exactly the thread's parties. Presence: `CastSummary.agent`
+ `online`, `PersonCard.agent.online`. Play: `typing.ts` ("… is
typing"), the guest DM subtitle shows online/away, and the performer
booth has a **Cast** space. Worker = stagehand `agents` (see the table
row); `trabolta.persona.md` gates programs until `Trabolta.glitched`
while performers always get through. Tests: core `agents` (20), play
`agents` (4), stagehand `test_agents`. Verified live against
`gpt-oss:20b` (2–6 s per reply).

**Trapped in the Internet + the codex economy landed 2026-09-10** (TS
`core/` + `play` + new `mind/`; story: `core/examples/trapped-in-the-internet/`
— now the server's default scenario; its `README.md` is the runbook +
integration contract). The show as designed: Trabolta (a rogue AI voiced by
a local LLM) uploads guests as programs; Clippy runs Computer Bingo and the
Truth Scavenger Hunt; the Antivirus drag the corrupted through the Tube to
"the Internet" (a `prison: true` + `sealed: true` location; the
reinstallation games release them — finding the golden duck fires
`the simulation completed` + `the golden duck`, see the 2026-10-10 entry);
the glitch opens free roam; five endings (three keys → self-destruct →
Long Dark / Unplugged by quorum; Rogue at `Trabolta.untruth ≥ 80`; Trapdoor
at `truth ≥ 90 ∧ stance ≤ −60`; Unknown when spared). Language + engine:
**`CODEX name`** declaration (`about:` / `code:` / `known to:` / `text:`
block) — knowledge as a currency: holders (persons *and* characters), the
`unlock X for guest` statement, `Sim.unlock/redeem/share` (journaled
mutations), built-in triggers `learn` (`when guest learns X:`, `when learns
for guest:`) + `share` (`from` bound) + the named event `wrong code`, world
mirrors `who.codex` (count) / `who.codex.<slug>` (bool), `codexUnlocked` /
`codexMissed` events. Characters learn too (`when who learns X: if who ==
self:`) — feeding lore to Trabolta moves his stance; an agent-voiced
(`mind: external`) character refuses entries `about` someone else
(`Sim.agentRefuses`, 2026-10-15 — no laundering secrets through its
prompt; `/api/guest/codex/share` answers 403). Routes:
`/api/guest/codex/{redeem,share}`, `/api/prime/codex/share`, `/api/mod/codex`
(hardware unlock), `/api/mod/codes` → `codex[]` with printable
`?code=&unlock=` QR links. **Directory + private threads:** `listed: true`
characters + `directory: everyone` (header) → `GuestView.people` (name +
exactly the entries about them the viewer holds); guest↔guest `pm:<a>:<b>`
threads (`Sim.pmChannel`); performer consoles now see **only their own
character's** `dm:` threads and no `pm:` (admins/mods see all —
`visibleToPrime`). **Alerts:** a broadcast cue starting with `!` sets
`ChatMessage.alert` → the play app chimes (synth), vibrates, banners.
`GROUP … joinable: false` (off the side chooser), `LOCATION … sealed: true`
(→ `GuestView.canEscape` false, no self-escape button). Play app: 📓 Codex
sheet (redeem box, entries by subject, Share… picker, `?unlock=` deep link),
👥 People sheet (💬 Message → pm/dm), performer "📓 Share lore…" + "what
your character knows". Engine fixes found by the show: `broadcast "…to…" to
scope` no longer splits inside the quoted cue; `capture/release X into/from
<Multi Word Place>` lower correctly; a ROLE's own alias (`program`) is
recognised as a beat's subject everywhere `guest` was. Gotchas recorded in
the example: event names must not start with a built-in verb word
(`release …` → `released`) or contain ` is ` (parsed as a mixin clause), and a
filler + one word (`the glitch`) collapses to the word — use two words.
Tests: core `codex` (20) + `trapped-in-the-internet` (20); play `codex`;
mind (14); help articles `play/08-codex.md`, `authoring/35-codex.md`; docs
`loom-4.md` §10.1, `writing-in-loom.md` §11.13.

**Run mode overhauled 2026-09-10** (TS `core/` + `editor` + `play`;
help: `docs/help/authoring/43-run-mode.md`): the Sim ⇄ Live source
switch and the separate **Deploy mode are gone** — three modes (Writing
⌘1 · Run ⌘2 · Integrations ⌘3; persisted `deploy` → `run`). Run is the
control room for the project's **one run**: the backend is resolved from
the workspace kind (`editor/src/store/run.ts` — server project → the
project's shared `preview` event via `store/operate.ts`, local folder →
the in-browser `Sim` via `store/sim.ts`), never picked by the user, and
both stores implement one `CockpitState` contract **including the
lifecycle** (`run: RunInfo`, `startRun` / `pause` / `resume` / `restart`
(same snapshot) / `pushDraft` (current text) / `goLive` / `end`,
`lastRun`, `notice`, `lens`). "Start rehearsal" spawns a persona named
after you and lands on Chat. The header owns the lifecycle (typed
event-code confirms on a live run); the Run page is front of house
(codes/QR/performer sign-in, directors, guest lookup). **Go live is a
promotion in place** (`POST /api/projects/:id/event/golive`,
`setEventMode`, `created_by_name` → `EventInfo.startedBy`): codes/QR
kept, story restarted fresh — and every `EventRuntime.restart()` is now
a real cut (guest tokens cleared + guest streams ended; `golive` also
signs performers out), announced as `lifecycle {kind, by, at}` which the
**play app now handles** (`play/src/lifecycle.ts`: drop the session,
explain on the join screen). **Being anyone is exact**: the identity
control resolves a participant's own `GuestView` / `PrimeView`
(`GET /e/:id/api/state?role=guest|prime&as=<id>`, mod-authorized;
computed locally on a folder) into `CockpitState.lens` — exact rooms
(`member`/`canPost`), hidden messages withheld, their choice docked,
their interactions as buttons, the performer's booth (per-guest threads,
scan readouts, interactions fired **as** the character via the new
`actor` on `/api/mod/signal`); World/Director/Inspector editors close
under a lens. Safety: `/api/mod/say` as a person enforces `canPost`,
rejects unknown speakers, and tags `ChatMessage.via` (director name,
stripped for guests); every mod mutation journals `by`; speaking as a
real guest is an explicit, once-confirmed act in the editor. Co-writers:
`CollabHub.notifyEvent` fans `event` frames on the collab stream so a
launch/go-live/end lands in every editor within a second (30 s poll
fallback); a 409 launch adopts the existing run; persona ownership is
runtime state (`personaOwners` → `ModPresence.owners` →
`RosterRow.owner`) so "yours" survives a reload; the operate store is
attached for the project's lifetime (`App.tsx`), not per mode. A guarded
**scratch run** (in-browser, same cockpit) is offered only when pushing a
draft would land on a live show or other directors. The Inspector gained
**Their view** / **Their feed**; the Log gained a participant filter;
Export works on a run that just ended. **Deferred on purpose:** "open
the play app as this guest" (a mod-minted impersonation token) — the
reviewed safe design is recorded in the session memory; the exact lens
covers the stated need. Tests: core `server-mod` / `server-interactions`
/ `views` / `collab` / `db`; editor `sim` / `run` /
`lifecycle-contract` / `rooms` / `log-filter` / `run-chrome` /
`run-export` / `mode`; play `lifecycle`; Playwright `sim` / `studio` /
`qol` + the opt-in live-stack spec (launch → restart banner → push draft
→ go live in place → end).

**Loom 4 — the human-first surface landed 2026-09-09** (TS `core/` +
`editor`; design: [`docs/loom-4.md`](./docs/loom-4.md), writer's guide
[`docs/writing-in-loom.md`](./docs/writing-in-loom.md), reference project
`core/examples/glass-orchard/`). Additive at the parser — every v3 form
still parses — and it changes how `.loom` is *written*:
**names are words** (`== The Bell Tower at Dawn`, `CHARACTER Ivo Marsh`,
`-> the bell tower at dawn`; matching folds case/`_`/`-`/spaces via
`parser/names.ts`; in an expression a multi-word name is written
`Ivo_Marsh.…` and the `World` folds path heads); **`Name:` dialogue**
(`Ivo: line`, `Ivo (quietly): line`, `Ivo:` block; ALL CAPS still a cue;
`Narrator:` is narration; speakers canonicalise to the declared
character, so `Wren` — not `WREN` — is the ledger speaker now);
**keyword statements** with no angle brackets (`set x = 5`, `if c:` /
`else:`, `match v:`, `each visit:`, `after c:`, `cue`, `sound`, `fire`,
`broadcast`, `reply`, `move`, `add`, `remove`, `reveal`, `do verb args`,
`return` — `parser/statements.ts` lowers each onto the existing
directive AST, so the sim, bank, and story graph are untouched; `<…>`
stays as the long form); **`when` as the one hook form** (`when scanned
by guest:`, `when guest arrives at The Cellar:`, `when lockdown:`,
`every 60s:` — filler words ignored, verb synonyms; `on …` still opens
a hook) plus **watchers** (`when self.heat >= 75:` — evaluated to a
fixpoint after every drain, edge-triggered, per participant on a ROLE);
`GROUP` = `FACTION`; `start:` = `entry:`; role hooks bind the role's
own name (`guest`); `fire x for subject`; the sim now plays
`each visit` and whole-line `cycle`/`shuffle`. The CodeMirror
highlighter follows. The v3 game verbs (`capture`/`escape`/`betray`/…)
are conveniences, not language — see spec §9.2 / §12. The help
collection and writer's guide are rewritten to the new surface.
**Slices 2–3 landed the same day:** story-level `when …:` rules (an
`Item` of kind `rule`, `model.rules`, ownerless hooks), event arguments
(`fire x for who with k: v`; `Sim.signal(name, subject, args, actor)`;
`/api/mod/signal` `args`), multi-word named events matched by folding,
additive group membership (`add` keeps others; `who.groups`), loose
rename, the `L1201 UnknownSpeaker` / `L1202 AmbiguousName` workspace
lints, and the **participant-app decoupling**: `INTERACTION name`
(`label:` / `who: performer|guest|admin`) is a declaration kind the
`play` client renders as buttons (`/api/prime/act` fires as the
performer's character only, via `Trigger.actor`; `/api/guest/act`),
every view carries the story's `title` + `theme`, the default space is
`story` and the lobby is titled after the story, `theme: plain` (new
neutral default) / `theme: aol97` (the old skin) select the client's
CSS variable set, and the client's `Faction` type / `internet` ids /
`.pill.Mods` rules are gone. The bank compiler diagnoses watchers and
story rules (`watcherIgnored` / `storyRulesIgnored`) rather than
dropping them.

**Live co-directing hardened 2026-09-09** (TS `core/` + `editor`):
the Run → Live cockpit is now a real shared control room. Server:
`EventRuntime.restart(source?)` backs `/api/mod/reset`, `/api/mod/load`,
and the new control-plane `POST /api/projects/:id/event/reload` (flush
collab → re-read the project → restart the running event on the current
text; the row's `scenario_source` follows) — each announces a
`lifecycle` SSE notice (`reset` / `reload`; `dispose` sends `ended`)
*before* the replay and re-sends every client a fresh `history` after
it, so no console (or guest) keeps a stale, seq-scrambled feed; a
restart keeps the doors open and replays the `entry:` beat.
`GET /api/projects/:id/event` carries `stale` (project text ≠ running
snapshot). Directors are named: the author session's name rides the mod
SSE client → `ModPresence.directors` / `ModView.directors`.
`EventRuntime.liveSim` is a read-only accessor for tests/tooling.
Editor (as of 2026-09-09; superseded by the 2026-09-10 overhaul above):
`store/operate.ts` handled `lifecycle` and retained the `sim` feed as
the cockpit `log`; a Live Setup page carried pause / resume / restart /
push current draft / end; the **Log** page gained **Export run**
(`loom-run/1` JSON), the Director page named-event **arguments**, and
Sim `choices` for every person. Covered by `core/test/server-mod.test.ts`
(lifecycle fan-out), editor unit tests, and a live-stack Playwright
check (`editor/e2e-live/`, `pnpm --filter loom-app test:e2e:live`
against a running server + `loom_dev`).

---

Phase 4 in progress: parser stitches headers / declarations
(structured CHARACTER / TRAIT / STATS / TREE bodies + raw fallback for
every other kind) / beats / dialogue / choices / diverts / fences /
conditional chains (`<if:>/<else if:>/<else>`) / block-opening
directives. Runtime plays the §16 worked example end-to-end with
`Bundle` + `Playhead`, resolves cross-file diverts, dispatches
directive calls (`sfx`/`cue`/`pause`/`anchor`/`fire`/`set`), evaluates
reactive `let` bindings against a `World` scope, runs `<if:>` arms,
expands inline `{expr}` substitutions inside action / dialogue text,
tracks sticky vs. once-only choice consumption, answers `played(name)`
/ `visits(name)` / `since(name)` ledger queries from expressions,
compiles CHARACTER / TRAIT bodies into a `CharacterStore`
(disposition, knowledge, `reacts` tags, goals, hooks), routes
`<set: Character.knows.X …>` and `<set: Character.trusts.Target …>`
mutations through the character store with goal-lifecycle +
threshold-cross hook bookkeeping, and compiles STATS / TREE
declarations into `StatsProfile` / `StatsInstance` / `Tree` with
attribute / axis (`xp_curve` + `narrative_trigger`) / pool (`max` /
`regen` / `cost` with `tick(dt, in_combat)`) / stat (lazy expression)
/ node (`requires` gate) primitives surfaced under dotted paths
(`Wren.strength`, `Wren.level`, `Wren.health`, `Wren.health.max`,
`Wren.damage`, `Wren.tree.armsman_1`).

Phase 5 (Luau bridge) landed 2026-05-25: `loom_runtime::LuauRegistry`
owns an `mlua::Lua` state with a `loom` global (read/write views into
`World` + `Ledger`) and dispatches every non-syntactic directive
(`sfx`, `cue`, `spawn`, `cancel`, `goal`, `broadcast`, `enroll`,
`goto`, `compose`, `heal`, `flash`) through a single Luau call
following the spec §14.1 argument convention (positional first,
single trailing table for named args). Extension authors write
`directive name(args) … end` in a `.luau` file and load it via
`LuauRegistry::load_extension`. The syntactic forms
(`if`/`else`/`match`/`for`/`each visit`/`after`/`otherwise`/
`anchor`/`let`/`set`/`fire`/`shuffle`/`cycle`) stay hand-handled in
the playhead — they affect playhead structure, not user-callable
side effects.

Live-performance layer landed 2026-05-25: `loom_parser` recognises
COHORT / LOCATION structured bodies (label, capacity, ambient,
contains) and the `(improv duration: …, advance on: …)` parenthetical
attached to dialogue cues (spec §13.3). `loom_runtime::LiveStage`
owns participants, cohorts, locations, and an `ImprovController`
with pluggable advancement (`all` / `any` / `quorum(N)`),
emitting `ParticipantJoined` / `ParticipantEnteredLocation` /
`CohortEnrolled` / `ImprovBeatStarted` / `ImprovBeatAdvanced`
ledger events. `BroadcastScope` is an algebraic expression
(`participant(X) | cohort(X) | location(X)` joined with `and` /
`but`) parsed from `<broadcast: …>` directive bodies and evaluated
against the stage's live membership. `broadcast` and `enroll` are
registered as core directive builtins.

SCENE / GENERATOR coroutines + tiered scheduler landed 2026-05-25:
`loom_parser` recognises top-level `SCENE name(params)` declarations
with labelled inner state blocks (lowered to `SceneBody.states`) and
top-level `GENERATOR` declarations with `tier:` / `priority:` / `on
boot` metadata (lowered to `GeneratorBody`). `loom_runtime::coroutine`
lowers both into a flat `Program` of opcodes (`YieldBark`, `YieldChance`,
`WaitUntil`, `WaitDuration`, `Goto`, `Return`, `LoopHead`, `ForBegin`/
`ForEnd`, `EmitLine`) and the three-tier `Scheduler` (focal ≈ 16ms,
active ≈ 100ms, ambient ≈ 2s budgets) drives them round-robin with
focal stealing from active/ambient under load. The bundle pre-lowers
every SCENE/GENERATOR into `bundle.scene_programs` / `generator_programs`
/ `bound_generators` (character-bound, qualified `Character.generator`).
Hook drain at playhead yield points + `spawn`/`run` directive wiring
remain TODO at `runtime/src/playhead.rs` (see follow-up
task).

LSP request loop landed 2026-05-25: `loom_lsp` runs a stdio JSON-RPC
loop backed by a `Workspace` index that reparses on every
`textDocument/didChange` and rebuilds project-wide indices
(characters, traits, beats, anchors, ```todo``` fences). Handlers:
`textDocument/completion` (divert targets / directives / `is` mixins
— spec §14.3), `textDocument/hover` (directive signature stubs,
character property summaries, beat cast+setting), `textDocument/
definition` (jump from divert / cue to declaration), `textDocument/
documentSymbol` (per-file outline). Diagnostics flow straight from
`loom_parser::Diagnostic` to `publishDiagnostics`.

Syntactic-form fillers landed 2026-05-25: `<match: expr>` dispatches
to the first bare-word arm matching the scrutinee's display form
(falls through silently when no arm matches); `<each visit>` picks
`first` / `then` / `finally` based on the enclosing beat's visit
count (1→first, 2→then, 3+→finally); `<after: cond> … <otherwise>`
latches the post-condition body to subsequent visits via per-beat
`Event::AfterLatched`; `<let: name = expr>` introduces an inline
scope-local binding into the surrounding world scope; `<shuffle: a |
b | c>` emits a deterministic pseudo-random variant (ledger-length
modulo until the workspace adds the `rand` crate); `<cycle: a | b |
c>` advances a per-anchor counter keyed by the directive's source
byte offset and emits variants in order.

Typed-slot grammar + ITEM/FACTION composition landed 2026-05-25:
`loom_parser` lifts every property line (`voice: any`,
`home: any of LOCATION`, `range 0 to 100 = 50`,
`unknown | suspects | confirmed`, `list of RUMOUR`,
`map of CHARACTER to int`, `text?`) into a structured `SlotType` on
the new `Property` carrier (spec §8). ITEM and FACTION are first-class
kinds now (`ItemBody` / `FactionBody`) with `is X, Y` inheritance
resolved by a shared `merge_properties`; `Bundle::items` /
`Bundle::factions` index the merged result. Beats split their
parameter list at parse time (`== ask_about(topic, NPC)` →
`Beat.params == ["topic", "NPC"]`) so diagnostics + LSP completion
have the declared param surface. Spec §8's required-hole rule is
enforced at materialisation: `Bundle::rebuild_simulacra` skips any
CHARACTER whose inherited + own typed slots leave an unfilled
`any`-shaped hole and reports
`ProjectDiagnostic::RequiredSlotUnfilled { character, slot }`.
Answer-slot fill at divert call sites (spec §7 + §16) is captured
into `Divert::To::slots` — an indented `<name>:` block under the
divert lowers as a `Vec<BodyItem>` keyed by slot name; the
matching beat-side `slot: <name>` line lands as
`BodyItem::SlotPlaceholder` ready for `<match:>` arm expansion
(playhead wiring is a follow-up — TODO at `lower_item`).

Expression + scoping closures landed 2026-05-25: list comprehensions
(`[c for c in Characters where c.faction == Player.faction]`, spec
§12.1) parse + evaluate through the native expression engine, with
virtual world collections (`Characters` / `Participants` / `Items`)
published via `World::set_collection`. Ledger queries grew the
scoped `since(scope, name)` form and `last(target, speaker)` lookup
(spec §12.2). Coroutines lower `at 6am` / `at noon` / `at 6:30am`
into a `Step::WaitUntilClock` opcode that polls `Time.hour` /
`Time.minute` (spec §10.5), and GENERATOR `start_when` is wired into
`Program.start_when` so the coroutine sits in `Waiting` until the
predicate clears. Multi-speaker cues (`DOCKHAND | FISHER`) split
into `DialogueBlock.speakers: Vec<String>` and ride alongside
`Event::Dialogue.speakers` so live booths can address every
performer. Beat-scope modifier `-> orientation as Participant`
parses into `Divert::To.scope_as` and the playhead overlays
`<scope>.<name>` aliases when evaluating expressions inside the
scoped beat (spec §13.1). Parser surface for `milestones:` on axis
declarations populates `AxisDecl.milestones`, which threads through
to `AxisState.milestones` at instance time.

Simulacra composition + hook coverage landed 2026-05-26: hook events
grew the symmetric `on <verb> drops below N` downward-cross kind, the
`on Participant exits LOCATION` pair to `enters`, and the top-level
`on participant joins` hook fed by `Event::ParticipantJoined`. The
exits derivation is synthesised at hook-drain time from consecutive
`ParticipantEnteredLocation` envelopes (the live stage owns the
state). CHARACTER / TRAIT inheritance learned `on <event>: none`
suppression (spec §9.5) and a `super` body marker (spec §9.4) — both
resolved at `Bundle::rebuild_simulacra` merge time so the runtime
hook list is already composed. Knowledge writes are schema-validated
at `apply_set` time: `bool` and sum (`unknown | suspects | confirmed`)
slots reject out-of-band values via `DirectiveError::BadArgs`, and a
new `Event::KnowledgeChanged { character, field, value }` envelope
replaces the generic `WorldSet` for `Character.knows.*` writes
(spec §10.2). Non-knowledge writes keep `WorldSet` so disposition
threshold crossings continue to fire.

Phase 8 closures (2026-05-26): the playhead now ticks the scheduler
at every yield boundary so `<spawn:>`-launched coroutines genuinely
interleave with the visible beat, and character-bound generators
(spec §10.5) auto-spawn at playhead startup. `<run:>` became a real
awaiting form (`Step::Awaiting { coroutine }`) — it spawns at focal
tier, surfaces ambient yields from the coroutine, and resumes the
surrounding beat once `SceneCompleted` lands; the return value is
stashed on `World["__last_run"]`. Answer-slot fill at divert call
sites (spec §7 + §16) wires through `Frame.slots` →
`Yield::SlotPlaceholder` → caller-body lowering at step time.
`<let:>` bindings are now scope-local (spec §12.1): each frame
captures prior values on first write and restores them when the
frame pops, so a tunnel-local `<let:>` no longer leaks past `<-`.
`<shuffle:>` picks via `rand::seq::SliceRandom::choose` instead of
ledger-length modulo. Booth live-patch substrate (spec §13.4) is in
place: `Playhead::booth_skip_beat` / `booth_force_directive` /
`booth_hot_reload` plus `LiveStage::recast`, with `BeatSkipped` /
`BundleReloaded` / `ParticipantRecast` ledger envelopes for audit.
Divert ambiguity now resolves by preferring a same-file candidate
(spec §18 heuristic) before erroring out. The editor's
`cm-loro.ts` applies remote Loro commits as a minimal
`(from, to, insert)` change (longest common prefix + suffix diff)
so local cursors and selections survive remote edits.

Client-side local play landed 2026-06-01: the multi-head session
engine moved out of `loom-server` into `loom_runtime::session`
(`PlaySession` + the `PlayStateSnapshot` / `HeadSnapshot` view structs),
so the server's `PlayHub` and the new wasm `LoomSession` drive the
*identical* loop and emit the *identical* `play-state` JSON. The editor
now plays any `.loom` workspace entirely in the browser with no relay
and no account (`store/session.ts` `kind: "local"`, `lib/local-play.ts`,
`lib/example-project.ts`); the relay path stays for collaboration
(`kind: "cloud"`). Because the Luau VM can't target
`wasm32-unknown-unknown`, `directives::Registry` runs in a `lenient`
mode on no-Luau builds: a Lua-defined directive or `.luau` extension
degrades to a logged `Event::Directive` envelope instead of aborting
the session (native `luau` builds stay strict). The narrative engine
itself — beats, choices, diverts, conditionals, world, characters,
stats, the core Rust directives (`set`/`sfx`/`cue`/`broadcast`/`cast`/…)
— is full-fidelity in the browser.

Functional-redesign Slice 1 landed 2026-06-30 (TS `core/` only so far):
the `is X, Y` inheritance merge is now actually run on the sim compile
path — `compileModel` calls `bundle.rebuildSimulacra()` and reads the
*merged* CHARACTER/ROLE body (previously the merge was dead code, only
ever invoked from a unit test, so every `is` clause was silently inert
at runtime). ROLEs are now exempt from the required-slot abstractness
drop (a role is a per-person schema, never an instance, so an
`any of FACTION` slot is not an unfilled hole) — so a ROLE can mix in a
trait. The `SELF`/`ME` dialogue speaker resolves to whoever `self` is
bound to on the frame (upper-cased to match explicit ALL-CAPS speakers),
letting a beat drop the line that restates its owner. `rebuildSimulacra`
is idempotent (clears `projectDiagnostics` too). Design +
roadmap: [`docs/loom-functional-redesign.md`](./docs/loom-functional-redesign.md).

Slice 2 landed 2026-06-30 (TS `core/` only): **parameterized traits**.
`TRAIT Scanner(beat)` takes params after its name (split off like SCENE onto
`CharacterBody.params`), referenced in the body as `self.<param>`, and applied
with args via the `is` clause — `CHARACTER Crawler is AlgoScanner(crawler_report)`.
`mergeCharacter` parses each `is` entry with `parseMixinRef` (positional + named
args) and runs `substituteParams`: it deep-clones the parent body
(`deepCloneCharacterBody`, so the trait cache is never mutated) and rewrites every
`self.<param>` token across hook events + bodies, method bodies/inline-exprs, and
property values. Forwarding (`is Scanner(beat), Algo` inside a trait) keeps a param
`self.`-qualified until a concrete character supplies it; at the leaf it always
resolves to the bare arg (`-> self.beat` → `-> crawler_report`), so no qualified-
divert resolution is needed yet. The lexer now splits the `is` clause on
*top-level* commas (`splitTopLevelCommas`, moved to `rust.ts`) so a multi-arg
application `CellWatch(loc: Internet, signal: lockdown)` stays one entry. Unfilled
params surface as a `requiredParamUnfilled` project diagnostic.
Part II Slice A + Slice 3 landed 2026-06-30 (TS `core/` only):

- **Class-owned beats + qualified diverts (Slice A).** A CHARACTER body may
  author `beat name(params)` sub-blocks (parsed like the `generator` block);
  they register in `model.beats` under `Owner.name`, so two props may each own a
  `main`/`greet` with no collision. `parseDivertTarget` splits a slash-free
  target on the first `.` into `{qualifier, name}` (`/` still outranks `.`), and
  the sim's new `resolveBeat` honors it: `self.`/`me.` resolve against the `self`
  binding, an explicit `Owner.` is taken as-is, a **bare name stays global**
  (existing `-> lockdown` diverts unchanged), a cross-owner `-> Owner.beat`
  rebinds `self` so the foreign beat's `SELF` speaks as its true owner, and an
  unresolved qualified divert emits a `diagnostic` event. `visits()` resolves the
  beat name owner-first too (`resolveBeatKey`).
- **Slice 3 niceties.** CHARACTER typed-slot defaults are seeded into the world
  (`CharDef.defaults`), so `self.captures` starts at `0` rather than
  implicitly-zero on first `+=`. An **inline opener divert** `on scan guest -> beat`
  is split into a synthetic body divert. A wrapped `is`-clause (trailing top-level
  comma / unbalanced parens) raises `L1008UnterminatedMixinClause`. *Deferred:*
  `UnresolvedTraitArg`, the `SELF`→`cast[0]` fallback, and LSP completion/hover
  (`RequiredParamUnfilled` already covers the missing-arg case).

**The `escape-the-internet` example is migrated** to the new surface:
`cast/kit.loom` holds the shared traits (`Scanner(beat)` + faction badges +
combined `<Faction>Scanner(beat)`); every scanner prop is a one-liner; `TheAdmin`
tallies on `self.captures`; `Sysadmin` and `Firewall_Terminal` **own** their beats
(`interrogation`/`firewall` moved out of `beats/prison.loom` onto the props,
reached via `-> self.beat`); several beats speak as `SELF`. The migration is
behavior-preserving — the full vitest suite stays green.

Part II Slice B (owned-beat forwarding — a trait param naming an owned beat stays
`self.`-qualified) landed alongside a review pass, so `is Scanner(myOwnedBeat)`
routes to the deriver's own beat; a trait can also ship a concrete `beat` block
that each deriver inherits namespaced to itself.

Part II Slice C landed 2026-07-01 (TS `core/` only): **derived beat templates.**
A `TRAIT` ships a `beat name(params)` whose varying lines are `slot: <name>`
holes; each deriving `CHARACTER` supplies `fill <name>` blocks of content. At
compile, `model.ts::fillSlots` splices the fill content in place of each
`slotPlaceholder` on the lowered tree (recursing through every nested
control-flow body), per deriver — so `Interrogation_Booth` and `Bouncer` sharing
one `confront` template get `Booth.confront` / `Bouncer.confront` with their own
lines and no cross-corruption. A hole with no matching `fill` raises
`unfilledDerivedSlot`; two distinct parents shipping a same-named beat raise
`derivedBeatConflict`; a child re-declaring a derived `beat` whole-overrides it.
The `slot:` placeholder keeps its colon (a bare `slot …` line stays prose);
`fill` is a class-body opener like `beat`/`generator`.

The remaining gaps landed 2026-07-01: **beat-level `super`** (a re-declared
owned beat splices its parent template at a `super` line); **`UnresolvedTraitArg`**
(a trait arg used only as a `-> self.<param>` divert that names no beat is flagged
at compile time — the divert-only analysis is transitive through forwarded/combined
traits); the **`SELF`→`cast[0]` fallback** (a `SELF` block with no `self` bound
speaks as the beat's first `cast:` member); and the **LSP batch** — trait hover
(params + shipped beats), completion inside `is Trait(…)` and after `-> self.` /
`-> Owner.`, `SELF`/`ME` reservation, and surfacing every project diagnostic
(`unresolvedTraitArg`, `unfilledDerivedSlot`, `derivedBeatConflict`,
`requiredParamUnfilled`, …) in the editor via `Workspace.diagnosticsFor`.

**The story-graph node editor landed 2026-07-01** (TS `core/` + `editor`):
Editing mode (`⌘2`) is now a **global node editor, 1:1 with Loom Lang**,
replacing the vacant per-file graphs (`runner/Graph.tsx`, `BeatTimeline.tsx`,
`lib/loom-story.ts` — all deleted).

- **Engine (`core/src/lsp/graph.ts`)**: `Workspace.storyGraph()` lifts every
  indexed document + the compiled model into one project graph — beats
  (top-level / class-owned / trait-derived, `structural:` tagged), narrative
  edges (divert / choice / tunnel / END / **hook** — `on scan guest` routings,
  incl. trait-inherited ones through param substitution) with choice labels,
  guard context (`<if:>`/match/visit arms), and **exact `targetRange` anchors**
  for rewiring; relationship overlay edges (cast/setting/member/is/owns/
  contains); shadowed same-name duplicates re-keyed `name~N`; static
  `resolveBeat` mirror (self./Owner./bare + cast[0] fallback, `dynamic`
  flagged). Cached per index rebuild (`Workspace.generation`); last-good
  compile survives mid-keystroke parse failures. `Workspace.beatBody(key)`
  serves drill-in bodies (file AST spans exact; owned via `lowerRawBody`
  line-remap; derived from the model).
- **Edit ops (`core/src/parser/edit.ts` + `core/src/lsp/rename.ts`)**:
  `replaceExact` (validated range splice — refuses stale anchors),
  `retargetDivert`, `appendDivert`, `appendChoice`, `appendBodyLines`,
  `removeBodyItem`, `renameBeatDecl`, and workspace-level
  `Workspace.renameBeat(key, newName)` → per-URI `TextEdit[]` batches
  (declaration + every resolved reference, `.`/`/`/`#knot` separators
  preserved, `entry:` header included; derived beats refused).
  `parseDivertTarget` is public now. **Lexer fix**: the tunnel call
  `(name) ->` was classified as prose (the parser's tunnel branch was
  unreachable) — it now lexes as a divert line.
- **Editor (`editor/src/components/graph/`)**: see `editor/CLAUDE.md` —
  ELK-laid-out project map (file containers, cross-file edges, ghost nodes,
  runtime overlay), beat drill-in flow, Files+Story-Bin rail, BeatStrip dock,
  graph-selection Properties tray, and full source round-trip (connect /
  rewire / create / rename / delete / inline text edits).
- **Run overlay**: the mod SSE stream now forwards the raw **`sim` feed**
  (`server/event-runtime.ts` fanout) — `beatEntered` lights the story map
  live in Run mode via the shared `RuntimeOverlay` contract.

**Sim mode + node-editor upgrades landed 2026-07-02** (TS `core/` +
`editor`): the Mode Bar grew a fourth mode — **Sim** (`⌘3`, Run moved
to `⌘4`) — an in-editor simulator that compiles the indexed project
into a real `@loom/core` `Sim` and drives it in-browser: personas the
writer acts as (choices resume the engine's saved continuations, incl.
unbound global menus), named events fired from anywhere (a **closed,
model-enumerated list** — `namedEvents(model)` / `BuiltinVerb` /
`SimEventType` const-object enums, new in `core`, plus a read-only
`Workspace.model()` accessor), a raw-ledger Log tab, and the story map
lighting up live (visit badges + current pulse + amber **edge
traversal**). Sim and Run share one cockpit — `store/cockpit.ts`
defines the contract + context, `components/cockpit/` holds the shared
chat / roster / world / director / rail / inspector — and Sim reuses
the server's pure `chat.ts`/`views.ts` projections verbatim (new
`@loom/core/chat` + `@loom/core/views` exports), so a rehearsal reads
exactly like the live event. The Editing canvas also got: **real node
dragging** (React Flow changes now apply to state — drags used to
snap back; `expandParent` grows file containers instead of clamping),
**word blocks** (every beat card expands to its full typed body —
`WordBlockKind` enum — and stretches to fit, feeding ELK sizes), and
**floating connectors** (project-view edges anchor to the closest node
border, so links survive any manual arrangement).

**The unified conversation model landed 2026-07-03** (TS `core/` +
`editor` + `play` mirrors; design:
[`docs/loom-conversation-model.md`](./docs/loom-conversation-model.md)):
every line of story now lands in exactly one room. **Locations are
rooms** — each `LOCATION` derives a `loc:<Id>` channel (kind
`location`, listed in every view; `member`/`canPost` = "standing
there", story narration `audience: "all"`, typed chat scoped to
occupants at send time). The executor threads the enclosing beat's
`setting:` + name through its frame stack (control-flow children
inherit; a divert swaps to the target's own setting or keeps the
caller's), so `dialogue`/`action` events carry `setting` + `beat` and
`beatEntered` carries `setting`. `composeGuestMessages` routes:
subject-bound dialogue → `dm:<SPEAKER>` (unchanged); **un-addressed
dialogue + `action` narration → the setting's `loc:` room (else
lobby), `from: "Narrator"` / `kind: "narration"`, `audience: "all"`**
(previously `action` was dropped and unbound dialogue landed in a
phantom empty-audience DM); `respond` → the scanner's lobby feed.
`EventRuntime.openDoors()` fires `model.entry` through the journaled
`fireBeat` on first open, so a live event opens exactly like a
rehearsal. Cockpit: a **perspective lens** (`CockpitState.perspective`
— Operator god view / any guest / any character) filters the rooms
rail + feed via the pure `buildRooms` model, an **act-as-anyone
composer** (Operator · Narrator · guests · cast, guest speech through
the journaled `say`, presence-gated in location rooms), kind-aware
message rendering (narration blocks, system notices, sender-run
grouping), a **decision tray** docking the lens persona's pending
choice in the room, and `⤷ beat` links from any scripted line to its
node on the story map. The Editing canvas also gained **collapsible
file containers** (edges re-route to the compact node, `N links`
aggregation), a **live filter** (dims non-matching nodes/edges,
Enter still jumps), and **arrow-key navigation** (nearest-node
selection walk, Enter drills in / expands).

**Run-mode choice answering + node-editor authoring parity landed
2026-07-03** (same session): `ModView.choices` carries every pending
choice (`Sim.allPendingChoices`, `__global` incl.), and
`POST /api/mod/choose` answers one on a guest's behalf through the
same journaled `choose` mutation as the guest's own tap — the
cockpit's decision tray + guest-Inspector `PendingChoice` now work
identically in Sim and Run. And **Editing mode is a full authoring
surface, 1:1 with the Writing screenplay format**: word blocks on
expanded beat cards carry exact source anchors
(`spanStart/spanEnd/topIndex` + pure `blockEditRange`) and
double-click-edit in place via `replaceExact`; block context menus
insert lines above/below (`insertBodyLines`, new in `parser/edit.ts`)
and delete items; card menus add lines/choices; file-container + pane
menus create beats and CHARACTER/LOCATION/FACTION declarations
(`appendDeclaration`, new) — every write flows through the
span-preserving `@loom/core/parser` edit ops, so nodes author the
same `.loom` text Writing mode shows.

**The three-mode shell landed 2026-07-06** (`editor` only): the Mode
Bar consolidated from four modes to three — **Writing** (`⌘1`) merges
the old Writing + Editing (the center stage is a resizable, snappable
**editor ⇄ story-graph split** with a persisted `split` size, the
EditingRail Files ⇄ Story Bin rail, the BeatStrip dock, and the
canvas-selection-first Properties tray); **Run** (`⌘2`) merges Sim +
Run behind a **Sim ⇄ Live source switch** (`store/run.ts` +
`components/run/RunStage.tsx` — one cockpit, `RunCockpit` provider
follows the switch, the mod-stream lifecycle rides the stage so
flipping sources never reconnects, quick-fire works on both sources);
and **Deploy** (`⌘3`, `components/deploy/`) is the live event's own
home — launch/lifecycle/codes/QR/guest-lookup (the old Event tab,
promoted; `CockpitTab.Event` deleted). Legacy persisted mode ids
migrate on load (`editing`→`writing`, `sim`/`operate`→`run`).

**Writing-mode QoL landed 2026-07-14** (`editor` only): the two Writing
panes now track each other — opening a beat on the canvas (double-click
/ Enter) also lines the text editor up on its declaration *without
stealing focus* (`pendingCursor.focus`), and a **follow** toolbar
toggle selects/centers the beat or entity enclosing the text cursor
(pure `graph/follow.ts::nodeAtLine`). The **text editor got its own
context menu** (`lib/editor-menu.ts` — go to definition / references /
rename / reveal-in-graph + clipboard; Shift+right-click = native menu)
and **F2 renames the beat at the cursor** workspace-wide; edges got a
context menu too. Shell keys: **⌘B** rail, **⌘⌥B** tray, **⌘\**
toggles the story-graph pane (`ModeUi.graphOpen`; `reveal` re-opens
it); `ContextMenuHost` gained keybinding hints + separators. The
Playwright e2e suite was refreshed to the three-mode shell and grew
`qol.spec.ts` (25 e2e tests green).

**The story edit journal + cockpit context menus landed 2026-07-14**
(`editor` only): structural edits (canvas connect/rewire/create/rename/
delete, word-block/BeatStrip/tray writes) journal as atomic, labelled
multi-file entries (`store/edit-journal.ts`) — **⌘Z/⌘⇧Z outside a text
surface** undo/redo them cross-surface (CodeMirror keeps its own
history inside the editor), conflict-guarded so a buffer that moved on
drops the stale entry instead of clobbering. Cockpit chat messages,
roster rows, and cast pills got real context menus (copy /
**reply-in-thread** with a composer chip + `parentSeq` / show-on-map /
inspect / view-as / hide).

**Banks + the Godot runtime landed 2026-07-24** (new `bank/` and
`engines/godot/`; spec: [`docs/loom-banks.md`](./docs/loom-banks.md)) — the
Wwise model for game engines: one compiler, banks + generated ID headers as
the artifact, a small native runtime per engine behind one contract.

- **`@loom/bank`** lowers a project (via `core`'s `compileModel`, so the
  `is`-merge / slot-fill / hook lowering is shared) into a `.loombank`:
  19 opcodes as fixed **4×i32 words**, one flat stream per beat *and* per
  hook body with nested bodies inlined as jumps — so a continuation is
  `(program, pc)` plus scalars. Speaker resolution and `<let:>` slot
  allocation move to compile time; expressions become flat **RPN** over a
  shared constant pool (a tree would mean a `Dictionary` per node in
  GDScript); `{expr}` interpolation is **pre-split**; directive args are
  **pre-parsed** per the stagehand convention, so no runtime sees a comma.
  IDs are **FNV-1a 64** (32-bit risks ~1.2% collision per project, and a
  collision reroutes a divert) with collisions a hard compile error.
- **`src/interp.ts` is normative.** `engines/godot`'s GDScript runtime is
  diffed against its golden traces byte for byte — including a SHA-256 of
  the save state after every driver command, so save/load divergence is
  caught, not just output divergence (`engines/godot/test/conformance.sh`,
  2 scenarios, 64 trace lines, currently matching).
- **Real save/load**, the thing that motivated the IR: a suspended choice
  round-trips through JSON, which the AST-walking executor structurally
  cannot do (see `core/server/store.ts`). A recompiled bank is refused
  unless the host opts into migration (positions die, structural keys
  survive).
- **A bank plays more of the language than `Sim` does**, deliberately and
  per-item tested: `-> END`/`<-`/tunnels work (in `Sim` the divert branch
  breaks its `switch`, not the loop, so `-> END` is inert), `<each visit>`
  runs `then`/`finally`, `<after:>` latches, once-only + suppressed choices
  are honoured, `match` compares typed values, `<let:>` is frame-local, and
  hook order is frozen rather than map-insertion. A `parity` suite pins the
  bank to `Sim` everywhere they *should* agree.
- **Two pre-existing engine bugs fixed on the way in:** `Sim.choose()`
  rebuilt continuation frames with only `items`/`index`/`bindings`, so every
  line after a choice lost its speaker (dialogue silently became narration)
  and its `setting` (routing to the lobby instead of the location room) —
  a live-event bug, now covered by `core/test/sim-choice-context.test.ts`.
  And the corpus contains authored `-> END`s that have been inert.
- Out of scope in v1, diagnosed rather than silently dropped: `<shuffle:>`
  (needs a spec'd PRNG to stay conformable), divert answer-slot fill,
  `improv` timing, locale banks, and the LARP layer. `engines/unity` and
  `engines/unreal` are unwritten — the spec and harness are what make them
  cheap.

**The desktop app became usable + an Integrations mode landed 2026-07-25**
(`editor` only):

- **Every create/rename/delete flow was dead in the desktop app.** They
  all called `window.prompt` / `window.confirm`, and wry's `WKUIDelegate`
  (`wry-0.55.1/src/wkwebview/class/wry_web_view_ui_delegate.rs`)
  implements only the file-open panel, media-capture permission, and
  new-window methods — none of WebKit's JS dialog panels. With no
  delegate method, WKWebView makes `prompt()` return null and
  `confirm()` return false *with no UI*, so "New file…", "+ beat",
  "Create the first beat", rename and delete looked like broken buttons
  in the Tauri shell (and were silently unreliable in the browser).
  Every call site now goes through one promise-based in-app dialog host
  (`store/dialog.ts` + `components/shell/DialogHost.tsx`, mounted at the
  App root so the launchpad + auth gate get it too): `promptText` /
  `confirmAction` / `notify`, callable from stores and context-menu
  handlers. `closeFile`/`closeOthers`/`closeAll` went async to await the
  discard confirmation.
- **Integrations is its own mode** (`⌘3`, before Deploy — Deploy moved to
  `⌘4`): the Godot panel moved out of Deploy's collapsed `<details>` into
  `components/integrations/`, so *shipping into a game engine* and
  *hosting a live event* are separate destinations. The browser build
  explains the desktop requirement and names the unwritten Unity/Unreal
  targets.

Everything in the TS engine is done and green (474 vitest tests in `core`
incl. the Loom 4 / Slice 2 / interaction-route / Glass Orchard suites,
+122 in the editor incl. the
graph-pipeline corpus, word-blocks, rooms-lens, flow-collapse,
navigation, filter, follow, edit-journal, sim-store, dialog, and
mode-store suites; 25 Playwright e2e). The only
remaining work is the **Rust mirror**
(parser + runtime crates), which is not yet updated for ANY of Slices
1/2/A/3/B/C, these gaps, or the story graph — the TS and Rust engines
will drift until it is ported. (Explicitly deprioritized by the user
for now.)

Still to come: a pure-Rust Lua VM (piccolo) so Lua-defined directives
and `.luau` extensions execute client-side instead of degrading; the
editor-side booth panel (UI scaffold on top of the new `booth_*`
runtime APIs); and the live SCENE / coroutine tracker view in the web
client.

## Multi-user (Phases 1–8 landed)

`loom-server` is the sibling crate that backs collaborative authoring
of `.loom` projects. It depends on `prism-core` from the Prism
monorepo, so **it builds only inside that monorepo** — it is excluded
from this repo's Cargo workspace and keeps its GPL-3.0-or-later
license (everything else here is MIT). Phases 1–5 cover the wire layer (module
wiring + `/api/health`, auth + multi-workspace REST + capability
tokens, WebSocket sync, presence fan-out, client glue), Phase 6 adds
the FSA export/import fallback, Phase 7 hosts the play loop server-side,
and **Phase 8** turns the relay into a single-binary deployment: it
serves the React editor's `dist/` alongside the API / WS routes, and
the editor defaults to `window.location.origin` when same-origin. Full
roadmap: [`docs/loom-multiuser.md`](./docs/loom-multiuser.md).

### Self-hosting the editor (Phase 8 — monorepo-only)

A complete relay deployment is one binary (built inside the Prism
monorepo, where `loom-server` compiles):

```
pnpm --filter loom-app build
cargo run -p loom-server --bin loom-relayd -- --editor-dist editor/dist
# → open http://127.0.0.1:7878 in any browser, register, author
```

Useful flags on `loom-relayd`:

- `--bind 0.0.0.0:7878` — accept connections from the LAN.
- `--editor-dist <path>` — path to the editor's Vite `dist/`.
- `--cors permissive` — opt in to cross-origin requests (only needed
  when driving the relay from the Vite dev server on `:5173`).

Note the **shipped SaaS stack does not use this**: the TS `@loom/core`
event server hosts projects, events, and the built apps (see
`docs/loom-deployment.md`).

### Dev-loop (no relay)

The editor consumes the Loom engine as TypeScript (`@loom/core`), so
parser / lsp changes are picked up live by Vite with no build step:

```
pnpm --filter loom-app dev      # Vite at :5173 (HMR)
pnpm --filter @loom/core serve  # event server at :7000 (for Run on a server project)
```

Collaborative relay mode is the monorepo-only two-process equivalent:

```
pnpm --filter loom-app dev    # Vite at :5173 (HMR)
cargo run -p loom-server --bin loom-relayd -- --cors permissive
                              # API + WS at :7878
```

### Editor — the SaaS author app (wasm removed 2026-06-30)

The React editor under `editor` is the author front end:
file editing, syntax highlighting, lint, LSP (Outline / References /
completion / hover / definition / symbols), structural beat edits, and
the static entity Graph + beat-flow views — all driven by the
**TypeScript** `@loom/core` engine (parser + `lsp`), **no wasm**.

`App.tsx` gates on the author account: a **BetterAuth sign-in gate** →
a **Projects launchpad** (create/open server projects) → the modal
**Studio** shell. Storage is backend-aware (`store/workspace.ts`): a
server project's `.loom` files load/save over the control-plane API,
while a **local folder** (File System Access) still works with no
account. The Mode Bar has **three** modes — **Writing** (`⌘1`),
**Run** (`⌘2`), and **Integrations** (`⌘3`). Writing's center is a
resizable **editor ⇄ story-graph split**, so the screenplay text and
the node editor are visible (and editable) at the same time. Run
(`components/run/` + `store/run.ts`) is the control room for the
project's **one run**: the backend is resolved from the workspace kind
— a server project runs the project's shared event (`store/operate.ts`,
over the mod SSE + `/e/:eventId/api/mod/*`, authorized by the author's
session — see **Run == admin** above), a local folder runs the
in-browser `Sim` (`store/sim.ts`) compiled from the indexed project —
and both implement one `store/cockpit.ts` contract, lifecycle included.
The header owns the lifecycle (pause / restart / push draft / go live in
place / end) and the **identity control** (be the Operator, a persona, a
real guest, or a character — an exact lens over the server's own
`GuestView` / `PrimeView`); the Run page is front of house (join codes
+ QR, directors, guest lookup); the shared `components/cockpit/` chat /
roster / world / director / rail / inspector pages are swapped via a
provider, and the local backend reuses the server's pure `chat.ts` /
`views.ts` projections so a rehearsal reads exactly like the live
event. The participant chat itself stays in `play`; the editor controls
+ moderates, it does not render the guest view.

The former in-editor runtime — multi-head branching play, the
Transcript / Ledger / Timeline / World / Cast / Booth surfaces, and
relay-backed cloud collaboration (Loro CRDT) — was removed with the
`wasm` crate; **Run mode on a folder is its native-TS successor for local
play**, while **the live runtime lives in the sibling packages**: the
`core` event server + the `play` participant app. See
[`docs/loom-ide-redesign.md` Part II](./docs/loom-ide-redesign.md)
for the shell design.
