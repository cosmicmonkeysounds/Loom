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
| `pnpm --filter loom-play size` | `scripts/first-load.mjs`: the guest's first load, gzipped, against the 148 kB gate (needs a build) |
| `pnpm dev` (root) | builds play + terminal + reinstall and runs the server + editor (`scripts/dev.mjs`); `--play` adds this Vite |

`scripts/ops/predeploy.sh` runs `pnpm -r typecheck`, every package's tests,
and `pnpm --filter loom-play build && node play/scripts/first-load.mjs
--max-kb 148`. A change that pushes the guest's first load over 148 kB
fails predeploy.

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
| Player booth (wave 21) | `booth/app.tsx` + `booth/player.tsx` | A `player: true` part (`PrimeView.player`): the guest frame, Mission + Chats, `⊞ · Mission · Chats · Scan`, a ⭐ score chip, NEW MISSION pop-outs; no host dock, no cue bar, no staff lines |
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
- **The locked phone** (wave 26, R1; `guest/lock.tsx`, a lazy chunk via
  `lock-lazy.tsx`). `GuestSession.locked` is `GuestView.locked` or a write
  that came back `403 locked` (`lockedRefusal`, until the next snapshot; it
  never toasts). The guest app then renders only the lock screen: the title
  bar, the DRAFT ⛔ QUARANTINED card with 🎟 Show my pass and the view's
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
  ≤ 34 dvh, the options ≤ 36 dvh, every footer button 48 px.

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
- **PLAYER SELECT** (wave 26, B3–B5): SAME pre-selects the most recent
  earlier pick (`sameFor`), so ④ 🤐 offers the winner after a skipped ③; on
  a destructive step an earlier pick is labelled but still selectable
  (`taggedFor`, `GuestTiles` `tagged`; the two-tap arm is the guard). An
  ended objective offers only Close (`ended`), and the booth closes an open
  PLAYER SELECT `PICK_CLOSE_MS` after its objective leaves the view
  (`pickEnded`). Clippy's gets `player`.
- **The windowed bar** (wave 26, P2): a player's or a host's booth frame is
  `booth-frame windowed` (`boothFrameClass`): the guest's taskbar rules
  (`--taskbar-h: 56px`, windows 48–120 px, Scan a normal primary, the tray
  two items under 430 px). `BoothTray windowed` renders in priority order
  (`boothTrayOrder`: 🔔 → 🚨 → held → countdown → ⭐ / act → clock).

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
  ⏸ / 🚪 · watch values · countdown), Who's calling, a big NEXT
  (`tab-cues.tsx` `NextBox`), the console's last word, LAST + `did:`, then
  folding sections (`showSections`): *Your jobs* (`booth/now-card.tsx`
  `NowJobs`, the NOW card laid open — the pinned card steps aside while
  Show is up), *Needs you* (`NeedsTab`), *Coming up* (`comingUp`), Judge,
  Cue sheet (`CueSheet`), People, More (the old tab components,
  unchanged). A jump (`ctx.go`, a need's row, the caller chip, a refused
  press) opens Show at that section (`showTarget`).
- **The slim NEXT bar** (`HostDock` → `HostNextBar`) shows only while Show
  is off screen (Chats, the Desk, a room on a phone) and no keyboard is up;
  its tap opens Show (at Needs for a refused press). The award picker and
  *Fire anyway?* render from the bar's slot whether or not the bar shows.
- **Desk** (`host/desk.tsx`, a lazy chunk via `windows.tsx`
  `LazyDeskWindow`; rules in `host/desk-model.ts`) over core's
  `house-desk.ts`: long-polls `GET /api/mod/desk?after=<rev>&wait=25`
  (`startPoll`, parked while hidden), status chips, ■ STOP ALL, STANDBY
  with GO (sends the standby it showed; 409 `moved` → *Standby moved —
  press GO again*) and its story events, the runs with progress and Stop,
  the cue list (tap = standby), and the checks walked one row at a time
  (Test / colours, ✓ Heard it / ✗ Nothing, next; `ConfirmButton` asks once
  `live`). It never edits a cue.

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
`core/src/cue-sheet.ts` (`tapCue`, `ARM_MS` 4 s, `ARM_DEAD_MS` 300 ms,
`armStillValid`). A fire is `POST /api/mod/signal` with the arm's
`presses`; a 409 `moved` means *Cues moved — tap again*.

## Layout

```
src/
  ui.tsx · app-role.ts   role chooser + which app opens; lazy booth / director / help
  main.tsx               entry; strips ?pair= / ?badge= / ?part= before render
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
scripts/first-load.mjs   the 148 kB first-load gate
test/                    vitest; *.test.ts(x) per module and lane
```

## Shared code with core

Play imports a few dependency-free core modules **by relative path**
(`../../core/src/…`), with no alias and no build step: `cue-sheet.ts`,
`host-board.ts`, `house-desk.ts` (the house desk, Desk chunk only), `delivery.ts` (alert levels, effect manners),
`show-clock.ts`, `runtime/sim/badges.ts`, `runtime/sim/crews.ts`.
`@loom/core` is not a package dependency. Keep those core files free of
Node imports, or the play build breaks.

Help works the same way: `help.tsx` bundles the guest articles of
`../../docs/help/play/*.md` with `import.meta.glob(…, ?raw)` and parses
them with `docs/help/helpdoc.ts`. The `role: performer` articles (07, 13,
14, 19) are left out of that glob and bundled by `help-staff.tsx`
(`articlesFor`, `StaffHelpSheet`), which only the booth and the director
import, so a guest never downloads them (wave 26). A new performer-only
article goes in both globs; `test/help-chunks.test.ts` fails until it
does. Editing an article updates Help on the next build.
`test/help.test.ts` checks frontmatter, cross-links and search entry
points (and reads `play/07-performers.md`), and enforces the G2 ban list
on guest articles.

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
  booths: 2.5 s, look only); the director phone has none.
- **Lazy chunks** go through `lazy-chunk.tsx` (`retryImport` once, then a
  `ChunkBoundary` with Reload), so a page left open across a deploy never
  goes white.
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

- **The 148 kB gate.** Do not import the booth, the host dock, the
  director phone, Help, `jsqr` or `qrcode` statically from anything the
  guest app loads at start. `test/first-load.test.ts` pins the lazy
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
