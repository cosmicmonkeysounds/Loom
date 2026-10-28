# loom-play

The participant app. Guests, performers, hosts and directors open it on
their phones at a live event. It is a Vite + React 18 SPA that talks to the
`@loom/core` event server over SSE (push) and `fetch` POSTs (actions). The
server composes every message and every view; this app renders them and
sends actions back. Nothing story-specific is baked in: titles, themes,
rooms, buttons and objectives all come from the story through the server.

The human-oriented overview is [`README.md`](./README.md). The product
record (users, tone, design rules) is [`PRODUCT.md`](./PRODUCT.md). The
participant help articles live in [`../docs/help/play/`](../docs/help/play).

## Commands

Run from the repo root (`pnpm install` once covers every JS package).

| Command | What it does |
|---|---|
| `pnpm --filter loom-play dev` | Vite on `:5174`, LAN-exposed (`host: true`), proxying `/api`, `/e`, `/events` to `LOOM_SERVER` (default `http://localhost:7000`) |
| `pnpm --filter loom-play build` | `play/dist`, which the event server serves at `/` (`LOOM_APP_DIST` overrides) |
| `pnpm --filter loom-play test` | vitest over `test/` |
| `pnpm --filter loom-play typecheck` | `tsc --noEmit` |
| `pnpm --filter loom-play size` | `scripts/first-load.mjs`: the guest's first load, gzipped, against the 149 kB gate (needs a build) |
| `pnpm dev` (root) | builds play + terminal + reinstall and runs the server + editor (`scripts/dev.mjs`); `--play` adds this Vite |

`scripts/ops/predeploy.sh` runs `pnpm -r typecheck`, every package's tests,
and `pnpm --filter loom-play build && node play/scripts/first-load.mjs
--max-kb 149`. A change that pushes the guest's first load over 149 kB
fails predeploy. The gate was 148 kB until wave 37b, which raised it by
1 kB (about a millisecond on slow 3G) to keep two guest fixes: a late
arrival's quiet bin (C20) and a house line echoing a big going to the
bin (C19). With them it measures 148.08 kB. Keep new JS lazy.

## How a session works

- **Bootstrap.** A typed or scanned code goes to `POST /api/resolve-code
  {code}` → `{eventId, role, title, …}`. Every later call is scoped to
  `/e/:eventId/…`. The bare address (no code) reads `/api/landing` for
  the one open event's branding (`ui.tsx`).
- **Sign-in is a cast pick.** A guest picks an unclaimed program from the
  story's pool or searches the directory (Wikipedia-backed, antivirus
  refused), then a picture (`guest/register.tsx`, `picture-pick.tsx`). A
  performer picks an unclaimed part (`booth/login.tsx`). Reserved programs
  need an invitation's `?claim=` (`claim.ts`).
- **Auth.** Registration returns a capability token: `x-loom-token` on
  POSTs, `?token=` on the SSE stream. The public `g-…` id is not a
  credential.
- **Lifecycle.** `lifecycle` frames (`reset` / `reload` / `golive` /
  `ended`) and a 401 drop the session; the join screen says why
  (`lifecycle.ts`). A director's re-pair link (`?code=&pair=`) is a
  single-use credential, stripped from the URL in `main.tsx` before render
  (`resume.ts`).
- **Getting back in** (wave 23, `rejoin.ts` + the lazy `rejoin-calls.ts`,
  server `core/server/routes/rejoin.ts`). A printed badge
  (`?code=&badge=`) links to a guest at join or from Me (🪪) and then
  signs them in on any phone (`/api/guest/enter`) and is their pass at a
  booth (`scan.ts`); a signed-in guest opening someone else's badge gets
  the Recruit sheet, never a switch. A featured guest's `?claim=`
  re-enters once joined. The join screen's *Already playing? Get back in*
  (`guest/get-back-in.tsx`, lazy) scans / types a badge or asks a host
  (`/api/guest/rejoin` → Needs and the director phone's *Let them in*). A
  cast card (`?code=&part=`) signs in as its part and takes it from a lost
  booth. `main.tsx` strips `badge` / `part` before render; `ui.tsx` runs
  the entry (`cardPlan`). The page's store falls back to memory when
  `localStorage` is blocked (`host.ts`).
- **Streams reopen.** `client.ts` `openChatFeed` probes a dead
  `EventSource` (a Caddy 502 during a restart) and reopens on a 1 s → 15 s
  jittered backoff; the tray's live dot reads *reconnecting…*.
- **Deep links.** `?unlock=` (codex), `?checkin=` (room sign), `?room=` /
  `?go=` (a push tap or an exit), `?claim=`, `?pair=`, `?badge=`,
  `?part=`, `?role=director`.
  A link opened with no session lands on `LinkLanding`
  (`guest-scan.tsx`), never the picker.

## Roles and their apps

`ui.tsx` is the role chooser (`app-role.ts` decides which app a fresh page
opens). Only the guest app is in the first load; the booth (with the host
windows), the Desk, the director phone and Help are lazy chunks.

| Role | Entry | What it is |
|---|---|---|
| Guest | `guest/app.tsx` | The frame: NOW title bar, one window at a time (Mission home, Chats, Notifications), taskbar `⊞ · Mission · Chats · Pass · Scan` |
| Performer (booth) | `booth/app.tsx` | NOW card, big 📷 Scan → the guest card, Readouts, Messages, 🗂 Guests, staff rooms, pop-outs |
| Player booth (wave 21) | `booth/app.tsx` + `booth/player.tsx` | A `player: true` part (`PrimeView.player`): the guest frame, Mission + Chats, `⊞ · Mission · Chats · Scan`, a ⭐ score chip, NEW MISSION (a title-bar blink while Mission is on screen, else a pop-out); no host dock, no cue bar, no staff lines |
| Host | `booth/app.tsx` + `host/` (wave 25) | An `admin: true` part, or a booth holding the mod passcode: taskbar `⊞ · Show · Chats · Desk · Scan`; Show is home (NEXT with ARM → FIRE, jobs, needs, sections), the slim NEXT bar while Show is off screen, the Desk (lazy) for the house desk |
| Director phone | `director.tsx` (`?role=director`) | The mod passcode + a name; the cue sheet by act, tap to arm, tap again to fire |

### Guest

- **Mission** (`guest/mission.tsx` + pure `guest/mission-model.ts`) is
  home: the NOW objective as a quest card (Where row, countdown,
  checklist, up to three big buttons), *Your move*, the Wallet / Quest Log
  / Codex tiles, *Also now*.
- **Chats** (`guest/chats.tsx` over pure `rooms/chats.ts`): fixed sections
  Your move · Where you are · Messages · Rooms · Other rooms (n). The
  lobby is the last row, the 📜 Chat log. A `lobby: hidden` story drops it.
- **Navigation.** Every exit lands through one function, `go(nav)`
  (`guest/nav.ts`; `planGo` is pure and tested in `test/nav.test.ts`). A
  moment's button, a Notifications row, a push tap and Mission's rows all
  use it. The lobby is never an exit.
- **Me** (`guest/me.tsx`) is your picture: badges, settings. The **Recycle
  Bin** is the Notifications window (`moments/notifications.tsx`, the
  delete gags in `moments/delete-gags.ts`).
- **Sides** (`sides/`, one lazy chunk): the doors widget, the Sides or
  Factions sheet, recruit by pass, founding a crew or faction. Faction mode
  (`founding:` in the story) shows your own count only.
- **📷 Scan** (`guest-scan-sheet.tsx`, a lazy chunk via
  `guest-scan-sheet-lazy.tsx`, prefetched after the first paint): the sheet,
  its classifiers (`guestScan`, `typedScan`) and the camera. The
  session-less landing (`LinkLanding`, `landingLink`) stays in
  `guest-scan.tsx`.
- **🎱 BINGO!** (wave 26, B1) is a plain story button with `arm: true`
  (two taps, `arm.ts`) on Play Computer Bingo; play knows nothing about
  Bingo. ↩ Not a Bingo (B2) is a host's story button on the caller's card.
- **The locked phone** (wave 26, R1; `guest/lock.tsx`, a lazy chunk via
  `lock-lazy.tsx`). The story's `lock:` header decides it on the server:
  a locked guest's `GuestView.locked` is true, `interactions` holds only
  the `restricted: allow` buttons, and every other guest write answers
  `403 {"error":"locked"}` (core's `LOCKED_OPEN` lists the routes that
  still work: register, resume, rejoin, badge, push, logout).
  `GuestSession.locked` is `GuestView.locked` or a write that came back
  `403 locked` (`lockedRefusal`, matched on `ApiError.message ===
  "locked"`, until the next snapshot; it never toasts). The guest app then
  renders only the lock screen: the title
  bar, the ⛔ QUARANTINED card with 🎟 Show my pass and the view's
  live (`restricted: allow`) buttons, the NOW objective as a card with no
  buttons, a read-only copy of `dm:Installation Wizard` (`LOCK_THREAD`, else
  the DM that spoke last; lines only), and a taskbar with only Pass. The
  moments layer, the full pass and a `!!` takeover still show over it.
  Only the screen's body (`LockScreen`) is lazy: the frame around it
  (`LockFrame` in `lock-lazy.tsx`: the title bar, `MomentsAndPins`, the
  Pass-only taskbar) is eager, so a chunk still loading or failing never
  costs the pass or the moments. A `?unlock=` / `?checkin=` link opened
  while locked raises no toast either.
- **The room's footer** (wave 26, P1; `stream/channel-view.tsx`
  `footLayout`): one answer surface at a time. A docked story menu opens
  and the composer folds to a 48 px `⌨ Message …` bar (showing a draft,
  which survives: the room holds it per room); typing folds the menu; an
  open card folds the menu. While a menu is docked a new card waits folded
  (`CardTray` `crowded`; a Mission jump still opens it). The thread keeps
  96 px, the footer ≤ 62 % (`.stream-room > .stream-foot`), the card body
  ≤ 34 dvh, the options ≤ 36 dvh, every footer button 48 px (the card's
  `widget-go` too). The footer is a flex column: its 48 px bars never
  shrink, the open menu / card give up the space (360x740). A folded menu
  reads `▴ {title}`. Once a send resolves, its line leaves the room's
  draft.
- **A pick is a server line** (wave 28). The server posts every pick
  (made here, at the heart terminal, or by a director) as the guest's own
  `pick: true` line (`act: true` for a deed) in the room the menu docked
  in. The phone still echoes its own pick at once (`choiceEcho`, in the
  menu's own `choices[].channel`, reading as core's `echoOf`), and
  `withEchoes` drops the echo once the matching server line arrives
  (`echoAnswered`: same room and words, past the echo's spot; the
  server's pick lines are indexed once per call, `pickIndexOf`), and the
  session prunes answered echoes from storage (`unansweredEchoes`).

### Booth

- The pinned NOW card (`booth/now-card.tsx`, ticks saved per sign-in), the
  scanner (`scanner.tsx`: `BarcodeDetector`, else `jsQR` loaded on demand
  for iPhone Safari; `scan.ts` says what a code means), the guest card
  (`booth/card.tsx`: facts, at most three face buttons from the live
  objectives, the press's replies / said / staff lines). Since wave 21
  no booth has *All buttons…*, earlier readouts or the raw id.
- Pop-outs (`booth/popouts/`, one at a time, *Later* → the 🔔 Waiting
  window), the 🚨 Wanted posters and board (`booth/wanted/`), the
  confrontation screen (`booth/confront.tsx`), the shared door queue
  (`booth/door.tsx`), PLAYER SELECT (`booth/pick/`).
- A caller booth (an admin cue's `by:` names its character, never a
  player) gets the 🎤 cue bar (`booth/cue-bar.tsx`, `POST
  /api/prime/cue`).
- **PLAYER SELECT** (wave 26, B1, B3–B5; `booth/pick/`): SAME pre-selects the most recent
  earlier pick (`sameFor`), so ④ 🤐 offers the winner after a skipped ③; on
  a destructive step an earlier pick is labelled but still selectable
  (`taggedFor`, `GuestTiles` `tagged`; the two-tap arm is the guard). An
  ended objective offers only Close (`ended`), and the booth closes an open
  PLAYER SELECT `PICK_CLOSE_MS` after its objective leaves the view
  (`pickEnded`). Clippy's gets `player`. It opens on the first step whose
  to-do is not ticked (`WizardStep.satisfied`, `openingFor`: 🎱 from Check
  The Bingo), seeding SAME from `PrimeSession.lastPressedOn` (the guest
  this booth's last taken press of that button landed on; memory only, so
  a reload leaves SAME empty). `replyLine` labels only `toGuest` / `said`
  as the guest's phone; a booth-only reply reads `→ Sent · …`. A stale
  press (a round already closed, ↩ / 🎱 / 🤐 included) comes back
  `refused: true`, and the booth reads it as refused.
- **× means done** (wave 37, C1–C3). The scanner's ×, Escape or the
  phone's Back over a card, a confrontation or CAPTURED gates that pass
  (`gate.closed`, also on unmount) and leaves the scanner; so does the
  confrontation's *Not now*. Where a close lands is pure in
  `booth/model.ts`: a `Layer` may carry `back` (depth one: the Wanted
  board, the Door queue, a rows picker or 🗂 Guests, set by `backFor`), and
  every layer's close and the system Back go through `closeTo`. Only door
  work gets **📷 Next guest** (`ScannerScreen` `queue`: `claim_door`, or a
  scan opened from the Door queue; `scanHint(queue)`). `scanTitle` keeps
  one camera in the caption. The clearance card shows replies and folds
  the story's `said` lines behind *▸ What the story said* (`outcomeSplit`;
  a refusal never folds). A player's own press of the NOW target
  objective's button counts as its own fire (`ownFireFor`, C14), so
  PLAYER SELECT opens at once. A player's takeover is `light` over the
  scanner or a card (C13).
- **Face to face, nothing floats** (wave 37, C4). The scanner (camera
  included), a guest card, the confrontation and PLAYER SELECT mount
  `PopOutQuiet` (`moments/popout.tsx`, re-exported by
  `booth/popouts/rung.ts`) in place of `PopOutDock`. While one is mounted
  nothing floats or docks, nothing is marked shown, no tone plays and no
  auto timer runs; after × the one waiting floats and chimes once. It
  registers in a layout effect, so effects read the store
  (`PopOutsApi.quietNow()`), not the render's `quieted`. `PopOutDock`
  stays in Guests, the board, the Door queue, rows and 🔔 Waiting.
- **Pop-out timing** (wave 37, C7–C9). NEW MISSION while Mission (or
  that objective's PLAYER SELECT) is on screen raises nothing: the driver
  (`DriverOpts.missionShown` / `onMissionNews`) plays the chime and the
  player's title bar blinks *NEW MISSION · …* for 6 s (`TitleBar`'s
  `flash`). One that pops leaves after 20 s (`MISSION_RETIRE_MS`), and
  reconcile retires it once it is not the headline (`missionHeadline`) or
  a game pop-out of the same cue is held (`MISSION_GAME_MS`). One held
  while Mission was off screen (under a card, held quiet) is retired as
  soon as `missionShown` turns true, with the blink instead. A player's
  own `dm:` big shaped `… · …` (YOUR GAME IS ON) is a `game:` pop-out
  (`AdapterCtx.me` / `player`; priority 55, under the target's 60, 60 s,
  ▣ Go to Mission), and a newer game retires the older. A held game also
  retires a minute after it was raised (on screen or not) or once the
  headline moves on more than 10 s after it, so one held under PLAYER
  SELECT or a card never comes back stale. It is an alarm
  (red caption, chime) with `PopOutSpec.yields`: after the grace it gives
  way to any live pop-out that outranks it (LANDED ON, a big readout) and
  shows again after them. WANTED · YOURS has
  Later and leaves after 15 s. `PopOutSpec.autoLaterMs` defers a pop-out
  untouched that long into 🔔 Waiting (the door: 45 s; it comes back when
  the next guest reaches the front, a new rev). An alarm pop-out takes the
  screen from a lower info one held at least `PREEMPT_GRACE_MS` (2 s;
  `PopState.shownAt`, `currentOf(…, now)`); the pre-empted one stays live.
  A 🚨 readout about a guest on the Wanted view never pops (the board owns
  marks), and a held one retires once the guest is not loose.
- **A performer's phone is about their job** (wave 37, C6;
  `booth/moments-feed.ts` `offDuty`). The booth's moments layer never gets
  a line to everyone (`audience: "all"`: the TV, the speakers and the 📜
  Chat log say it), a player gets no quest moments, and a minor readout
  about a guest who is not this booth's (`BoothFeedOptions.mine`, built by
  `boothMine`: its escort claim, its door claim, and on a booth that can
  claim escorts every loose mark nobody has claimed) only badges Readouts.
  The lines still land in their rooms.
- **The Wanted board keeps a claimed poster in place** (wave 37, C11;
  `openTabIds`): Open shows what it showed since the board opened, a claim
  of mine as YOURS with 📷 Scan their pass, someone else's as *🙋 X is on
  it*, so the list never reflows under a finger. The wanted layer's
  `BoardMemo` (the tab, the kept ids) survives a scan or a card opened from
  the board, so × back finds it as it was. The Open tab counts only the
  posters still open.
- **The windowed bar** (wave 26, P2): a player's or a host's booth frame is
  `booth-frame windowed` (`boothFrameClass`): the guest's taskbar rules
  (`--taskbar-h: 56px`, windows 48–120 px, Scan a normal primary, the tray
  two items under 430 px). `BoothTray windowed` renders in priority order
  (`boothTrayOrder`: 🔔 → 🚨 → held → countdown → ⭐ / act → clock).
  Under 370 px the bar's gaps and the tray's chrome tighten (booth.css,
  and the guest's in chrome.css) so two items fit beside four windows.

### Host windows (wave 25; the contract is `docs/loom-house-desk.md` §6.2)

A host booth (`isHostBooth` in `host/dock.tsx`, never a player) has three
windows in place of the old pull-up drawer, picked from the taskbar
`⊞ · Show · Chats · Desk · Scan` (`host/windows.tsx` `hostTaskbarButtons`;
Guests moved into Show's People). Which window is on screen and when the
bar shows is pure in `host/show-model.ts` (`hostWindowShown`,
`hostBarShown`).

- **One console.** `HostConsole` (`host/dock.tsx`) wraps the booth frame:
  it polls the host view (`GET /e/:id/api/state?role=mod&host=1`), owns the
  cue desk (`useCueDesk`: ARM → FIRE, the caller claim, *Fire anyway?*, a
  refused press and its `# hosts` reason, the award prefill) and gives it
  to Show and the bar through context (`useHostConsole`). It always renders
  the same tree; a booth that isn't a host polls nothing.
- **Show** (`host/show.tsx` + `host/show-model.ts`) is home and stands
  where the room list was (the player's Mission pattern): a ▣ SHOW title
  bar, the night strip (`nightStrip`: caller · act · phase · show clock ·
  ⏸ / 🚪 · watch values · countdown; one line that scrolls sideways since
  wave 37, `.host-show-strip`), Who's calling, a big NEXT
  (`tab-cues.tsx` `NextBox`), the console's last word, LAST + `did:`, then
  folding sections (`showSections`): *Needs you* (`NeedsTab`; first since
  wave 37, open while something waits), *Your jobs* (`booth/now-card.tsx`
  `NowJobs`, the NOW card laid open — the pinned card steps aside while
  Show is up), *Coming up* (`comingUp`), Judge,
  Cue sheet (`CueSheet`), People, More (the old tab components,
  unchanged). A jump (`ctx.go`, a need's row, the caller chip, a refused
  press) opens Show at that section (`showTarget`).
- **🤖 Talk** (wave 32, contract `docs/loom-w32-contract.md` C6;
  `host/talk.tsx` over the pure `host/talk-model.ts`, core's
  `talk-back.ts`). While `view.talk` is set (a talk scene: `HostView.talk`)
  Show draws a card between NEXT and the status line: the scene + hint,
  Trabolta's state (`talkState`, *thinking… Ns*, slow past `TALK_SLOW_S`
  12), the Desktop's last `TALK_LINES` lines (`talkLines`), a text box +
  Send (Enter; `calls.talk` → `POST /api/mod/talk`), Clippy chips (one
  tap, with their `direction`), Trabolta chips (`useArmButtons`: arm then
  fire, keyed by `chipKey(scene, side, k)` so an arm never crosses a
  scene), ⚡ Glitch (`view.talk.glitch` through the cue call) and the
  console's own NEXT (`c.bar.row` + `c.desk.tap`: no new fire path).
  Task Manager's is open (`talkOpen`), every other host's folded. The
  draft lives on the console (`talkDraft`; `setTalkDraft` takes an updater,
  and `draftAfterSend` removes only the words a send carried). The thinking
  count reads the server's clock: `HostClient.skew` from the poll's `Date`
  header (`clockSkew`, `talkClock`). The slim bar shows a 🤖 Talk chip
  (`talkChipShown`) that opens Show at `talk`. `test/w32-talk.test.tsx`
  drives `TalkBody` through the hooks harness. Host-only: nothing the
  guest entry imports reaches `host/talk*`. Help:
  `docs/help/play/21-talk-back.md`.
- **The slim NEXT bar** (`HostDock` → `HostNextBar`) shows only while Show
  is off screen (Chats, the Desk, a room on a phone) and no keyboard is up;
  its tap opens Show (at Needs for a refused press). The award picker and
  *Fire anyway?* render from the bar's slot whether or not the bar shows.
- **Desk** (`host/desk.tsx`, a lazy chunk via `windows.tsx`
  `LazyDeskWindow`; rules in `host/desk-model.ts`) over core's
  `house-desk.ts`: long-polls `GET /api/mod/desk?after=<rev>&wait=25`
  (`startPoll`, parked while hidden), status chips, ■ STOP ALL, a folded
  *How the Desk works* (`deskHow`), **Setup** (wave 30: `setupView` over
  core's `deskSetup`, a tone-coloured card per system — sound, lights,
  each `mind: external` character — with *What to do*, open only when
  `bad` (`setupOpen`); one *All connected ✓* line when every row is ok),
  STANDBY with GO (sends the standby it showed; 409 `moved` → *Standby
  moved — press GO again*) and its story events, the runs with progress
  and Stop, the cue list (tap = standby), **Try it** (wave 30:
  `tryGroups`, the looks and story sounds as tap-to-play over the checks'
  own tests, folded past `TRY_OPEN_MAX`; *Say on the speakers* →
  `audio/play {say}`, `sayCall` caps it at `DESK_SAY_MAX` 280; `tryDone`
  says whether a router / lights module was there to play it), and the
  checks walked one row at a time (Test / colours, ✓ Heard it / ✗
  Nothing, next). Once `live`, every test and Try it asks first
  (`ConfirmButton`, `liveAsk`). It never edits a cue. The hosts' help
  article is `docs/help/play/20-house-desk.md`.

Every write is on the server's host allowlist (`core/server/routes/host.ts`;
any other mod route answers 403 *not from a booth*), typed in `host/api.ts`
(`HOST_ROUTES`, `HOST_READS`; `test/host-actions.test.ts` checks every
call and every route a host source names). The caller claim (the model and
copy in `host/caller.ts`, the `POST /api/mod/caller` in `host/api.ts`) is
shared with the director phone and Run. Never in Play: restart, push
draft, go live, end, the var table, the log, the Mind, a desk edit, Save to
project, Reset marks.

### Director phone

`director.tsx` polls the lean `GET /api/state?role=mod&cues=1` every 3 s
(parked while hidden). Rows, acts and the arm model come from
`core/src/cue-sheet.ts` (`tapCue`, `ARM_MS` 4 s, `ARM_PICK_MS` 10 s for a
cue armed through the who? picker (`armWindow`), `ARM_DEAD_MS` 300 ms,
`armStillValid`). A fire is `POST /api/mod/signal` with the arm's
`presses`; a 409 `moved` means *Cues moved — tap again*.

## Layout

```
src/
  ui.tsx · app-role.ts   role chooser + which app opens; lazy booth / director / help
  main.tsx               entry; strips ?pair= / ?badge= / ?part= before render; a root ChunkBoundary (a throw shows Reload, never a blank page)
  rejoin.ts · rejoin-calls.ts   getting back in: badge / cast-card links (first load), enter / ask-a-host / re-pair calls (lazy)
  types.ts               mirror of core's views + chat (keep in step with core/server/{views,chat}.ts)
  client.ts              api() POST + useChatStream / openChatFeed (SSE)
  host.ts · embed.tsx · embed-css.ts   the host seam and the shadow-root embed
  guest/                 guest app, frame, Mission, Chats, Me, register, nav
  booth/                 booth app, player booth, card, NOW card, pick/, popouts/, wanted/, door, confront, cue bar
  host/                  host windows: console + slim bar (dock), Show, Desk (lazy), the old tabs as sections, allowlist API, caller claim
  chrome/                title bar, taskbar, Start menu, tray, full-screen pass, balloons, icons
  stream/                message bubbles, crawl tiers, card tray, settled cards, ticker, notices, codex room, composer
  moments/               the interrupt ladder: model, provider, surfaces, big moments, pop-outs, notifications, exits
  rooms/                 room order + tiers, Chats sections, spaces, thread state
  session/               guest.ts / prime.ts sessions, channels, stream handlers
  sides/                 sides, crews, factions (lazy)
  ui/                    primitives, Win95 windows, objective card, progress
  css/                   base, themes, w95 + one file per lane; styles.css imports them
  widgets.tsx · widgets-fact.tsx   show-card registry (captcha, image, poll, tutorial, pass, fact, answer)
  wallet.tsx · wallet-sheets*.tsx  the Wallet room and its sheets
  director.tsx           director phone (lazy)
  help.tsx · help-lazy.tsx         guests' Help window over docs/help/play (lazy)
  help-staff.tsx                   the performers' Help (+ role: performer articles)
  chat.tsx · guest.tsx · performer.tsx · session.ts · threads.ts   barrels for pre-wave-13 names
public/                  sw.js (push only), manifest.webmanifest, pictures/ (Trabolta's two SVGs)
scripts/first-load.mjs   the 149 kB first-load gate
test/                    vitest; *.test.ts(x) per module and lane
```

## Shared code with core

Play imports a few dependency-free core modules **by relative path**
(`../../core/src/…`), with no alias and no build step: `cue-sheet.ts`,
`host-board.ts`, `house-desk.ts` (the house desk, Desk chunk only), `delivery.ts` (alert levels, effect manners),
`show-clock.ts`, `runtime/sim/badges.ts`, `runtime/sim/crews.ts`, `pick-echo.ts`
(wave 28: how a pick reads; `session/guest.ts` `choiceEcho`), `talk-back.ts` + `talk-scenes.ts` (wave 32: the Talk card,
host chunk only).
`@loom/core` is not a package dependency. Keep those core files free of
Node imports, or the play build breaks.

Help works the same way: `help.tsx` bundles the guest articles of
`../../docs/help/play/*.md` with `import.meta.glob(…, ?raw)` and parses
them with `docs/help/helpdoc.ts`. The `role: performer` articles (07, 13,
14, 19, 20, 21) are left out of that glob and bundled by `help-staff.tsx`
(`articlesFor`, `StaffHelpSheet`), which only the booth and the director
import, so a guest never downloads them (wave 26). A new performer-only
article goes in both globs; `test/help-chunks.test.ts` fails until it
does. Editing an article updates Help on the next build.
`test/help.test.ts` checks frontmatter, cross-links (no guest article
links to a performer-only one) and search entry points (and reads
`play/07-performers.md`). It also enforces the G2 ban list on guest
articles (the machinery words, with an allowlist of the app's exact crew
labels and Server Room / Server Door) and pins the confrontation's no-OK
copy. Any new guest line must pass it.

## Conventions

- **Pure models, thin components.** Each lane keeps its decisions in a pure
  `*-model.ts` / `model.ts` (tested without a DOM) and draws them in a
  `.tsx`. Examples: `guest/mission-model.ts`, `booth/mission-model.ts`,
  `moments/model.ts`, `rooms/chats.ts`, `guest/nav.ts` `planGo`.
- **The host seam.** Never reach for `window`, `localStorage` or the
  document root directly in app code. Use `usePlayHost()` (`host.ts`):
  per-pane storage, the crawl, the theme root, the key target, `wide`,
  `embedded`, `ownsPage`, `onEnded`. The editor's Run → Players page
  mounts many copies of this app in shadow roots through `embed.tsx`.
- **The crawl is decided at arrival** (`crawl.ts`): a live line types in
  only if it lands while its room is on screen and the page is visible.
  Tiers: `none` (typed chat, agents, readouts, cards, the backlog), `fast`
  (scripted lines), `fx` (effect text). Never crawl a backlog.
- **Moments.** Anything the story wants noticed renders on one rung of the
  ladder (balloon → sticky → dialog → bsod, plus `big`), from the story's
  `alertLevel`. A minor moment sits a rung lower; a booth never goes above
  sticky. The model is `moments/model.ts`. Wave 26: a big with
  `ChatMessage.noAck` has no OK when one of its story exits resolved
  (`big-model.ts` `bigAck`, `Exit.story`); the story's glitch
  (`NightView.glitch`) takes the phone over once, live (`takeoverDue`:
  never embedded, never on a first view, a new `at`, ≤ 15 s on the story
  clock) through the lazy `moments/glitch-takeover.tsx` (the 600 ms
  `Glitch` is its fallback), holding the queue: `MomentsInput.takeover`
  `full` (guests, player booths: ~6 s, swallows taps) or `light` (host
  booths: 2.5 s, look only); the director phone has none. Wave 32: a
  burst (`NightView.glitch.light`, a talk scene's ⚡) plays the light one
  on every phone (`takeoverStart` / `takeoverKind` in `moments/model.ts`). While it is on
  screen `surfacesOf(…, covered)` holds every surface (stickies and
  balloons too), so they land right after it (C3).
- **Moments, wave 37.** One thing at the bottom of a booth:
  `MomentsInput.balloonsWait` (the booth passes it while a pop-out is up
  or the scanner, a card or a picker is open) shows no balloon and runs no
  balloon timer (`waitBalloons`). A booth's queue folds balloons
  (`foldBalloons`): the newest queued one (story time, then seq) stays and
  the rest are gone from the screen (a guest's line still badges Chats),
  except an older readout, which a newer chat line waits behind. A banner
  (a sticky that is no card and no loud objective) leaves after
  `STICKY_MS` (45 s) on screen, read; its clock runs only while it is
  really on screen (not under a hold, not folded into the pin rail's +n:
  the engine's `hold` / `fold` counters). Its chime follows arrival, not
  the screen (`EngineMemory.rung`, once per moment): under a hold it rings
  at once, except face to face (`balloonsWait`), where it rings after ×.
  A moment counts as read once it
  was on screen `GLANCE_MS` (1 s) in total, also when a NOW, phase or
  objective change retires it. While a dialog is up nothing peeks under
  it. A menu pick or a deed (`pick` / `act` lines) is never a guest
  writing to the booth (`stream/badges.ts` `guestLineToBooth`). Dialog
  buttons wrap inside the box (`css/moments.css`).
- **Lazy chunks** go through `lazy-chunk.tsx` (`retryImport` once, then a
  `ChunkBoundary` with Reload), so a page left open across a deploy never
  goes white. `main.tsx` wraps the whole app in one more `ChunkBoundary`
  (wave 26): any throw, in a render or an effect cleanup, shows Reload,
  never a blank page.
- **Barrels.** `chat.tsx`, `guest.tsx`, `performer.tsx`, `session.ts`,
  `threads.ts` re-export every name they had before wave 13
  (`test/barrels.test.ts`). Add new code to the lane modules, not the
  barrels.
- **CSS.** A lane's stylesheet names its own classes or scopes a base class
  under its own (`test/css-collisions.test.ts`). `css/themes.css` is
  frozen: `theme: plain` is the default, `theme: aol97` the 1997 skin,
  selected by the story header via `data-theme`. Colours come from tokens
  (`test/tokens.test.ts`).
- **Copy is plain words.** A player booth never shows staff-room lines;
  refusals read as the story wrote them.

## Gotchas

- **The 149 kB gate.** Do not import the booth, the host dock, the
  director phone, Help, the staff Help, the Scan sheet, the lock screen's
  body, the glitch takeover, `jsqr` or `qrcode` statically from anything
  the guest app loads at start. `test/first-load.test.ts` pins the lazy
  imports; `pnpm --filter loom-play size` measures the real number after a
  build.
- **The browser floor.** Play runs on iOS Safari 15+, Android Chrome 100+
  and old station tablets (Chrome 87, Safari 14).
  `test/browser-floor.test.ts` greps `src/` for what those can't run:
  unguarded `:has()`, CSS nesting, `dvh` without a `vh` first, authored
  `@container` (only `embed-css.ts` writes those), `<dialog>`, `inert`,
  `Array.prototype.at`, `structuredClone`, an unguarded `color-mix()`.
  `test/css-old-devices.test.ts` adds `:focus-visible` (Safari < 15.4
  drops the whole rule list) and `aspect-ratio`.
- **The page never stays zoomed** (wave 36). An iPhone left zoomed in
  pans the whole app sideways. `html` has `touch-action: manipulation`
  (no double-tap zoom on the two-tap arm buttons; a pinch still zooms)
  and `overflow-x: hidden`, and every text field is 16 px
  (`font-size: 16px !important` in `base.css`: iOS zooms into anything
  smaller and never zooms back out). Never add `maximum-scale` or
  `user-scalable` to the viewport. `test/w36-old-phones.test.tsx`.
- **Pictures retry** (wave 36). `PersonAvatar` and `PictureGrid` load a
  picture through `usePictureTries` (`ui/primitives.tsx`) over the pure
  tries in `avatars.ts`: a failed load shows the initials, retries after
  `PICTURE_RETRY_MS` (2 s, 8 s) with `?try=n`, then gives up. React owns
  the `<img>`: never remove or hide it by hand in `onError`. Avatars load
  eagerly (no `loading="lazy"`). The server's avatar 404 is `no-store`.
- **44 px targets.** Every control used on the night is at least 44 × 44
  (`test/floor-css.test.ts`).
- **No QR server calls.** The pass QR is drawn in the browser
  (`pass-qr.tsx`, `qrcode` loaded lazily). Play never calls `/api/qr`.
- **Push.** `public/sw.js` is push-only with no fetch handler: nothing is
  cached. Push never registers when embedded, on plain http, without the
  Push API (an iPhone Safari tab) or without the server's VAPID keys
  (`push.ts`).
- **Composer.** A send clears the box only once the server accepts it; a
  refusal stays in the box with the reason. The cap is 2,000 characters
  (`CHAT_TEXT_MAX`), matching the server's 413.
- **An effect's return value is its cleanup.** An expression-bodied
  effect that returns a string crashed the composer in wave 26 (React
  called the draft text as the cleanup). Give effects block bodies unless
  they return a cleanup; `test/w26-composer-cleanup.test.tsx` runs the
  composer's hooks through `test/hooks-harness.ts` and checks the source
  for the pattern.
- **Types drift.** `types.ts` mirrors the server by hand. When core adds a
  view field, add it here as optional so an older server still parses.
- **Lens parity.** The editor's Run lens mirrors the booth's pinned rooms
  (`session/prime.ts` `buildPrimeChannels`) by hand in
  `editor/src/components/cockpit/rooms.ts`. A change to the booth's room
  list may need the same change there.

## Testing a change for real

Run the event server and this Vite, then open `:5174` on a phone on the
same Wi-Fi (or two browser profiles: one guest, one performer). The
editor's Run → Players page embeds this app side by side on a server
project, which is the quickest way to see a guest and a booth together.
