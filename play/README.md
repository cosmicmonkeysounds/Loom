# loom-play

The **participant app** for live Loom events — the React client guests
and performers use. It's skinned like an **old-school AOL chat room**
(teal Win95 desktop, navy title bars, a sunken white transcript of
Times-New-Roman line messages with colored screen names, chunky 3D
buttons, a "People Here" buddy list), but the structure underneath is
still threaded: every conversation is its own **channel (thread)** in an
inbox, and each running instance streams its participant's slice of the
live `Sim`.

**The frame (wave 13, the Play app UX overhaul).** Every screen is a
Win95 window: a **NOW title bar** on top (the first live `OBJECTIVE` for
this viewer; tap → its card), the rooms, and a **taskbar** at the bottom —
⊞ Start (the story's guest buttons, People, Help, picture, Keep my screen
on, Get alerts, switching sides, Leave), **🎟 Pass** (full screen, held
awake) and **📷 Scan** (camera + a typed-code box), and a tray (the story's
guest countdown as a clock, the balance, missed moments, the live dot).
Story moments interrupt through one ladder (balloon → sticky → dialog →
blue screen, the story's `alertLevel`). Under `theme: plain` the same
structure renders without the Win95 ornament. The product record is
[`PRODUCT.md`](./PRODUCT.md).

It talks to the [`@loom/core`](../core) event server over Server-Sent
Events (push) + `fetch` POST (actions). Built with Vite + React 18, the
same way the [`editor`](../editor) is.

The server is multi-tenant, so joining is a two-step bootstrap: the code a
guest/performer types is first resolved with `POST /api/resolve-code {code}`
to its `{ eventId, role }`, then every SSE/REST call is scoped to
`/e/:eventId/…` (the `eventId` is stored alongside the session in
`localStorage`). Sessions from before this change fall back to a `default`
event. See `src/session.ts` / `src/client.ts`. Nothing about the guest
experience changed — it's still just name + event code.

**Auth.** Registration returns an opaque **capability token** stored
alongside the session; it authorizes every subsequent call
(`x-loom-token` header on POSTs, `?token=` on the SSE stream — the
public `g-xxxxxx` id is broadcast in rosters and is *not* a credential).
A pre-token session (from before this change) is dropped so the guest
re-registers cleanly. Deployment + the full security model live in
[`docs/loom-deployment.md`](../docs/loom-deployment.md).

**Lifecycle.** The server announces run transitions on the SSE stream
(`lifecycle` — `reset` / `reload` / `golive` / `ended`, with who did it).
Every restart clears guest tokens server-side, so a guest's session is
dropped and the join screen explains why ("The story restarted — join
again with your code"); a performer's sign-in survives a restart but not
`golive` (the show starting signs every booth out) or `ended`. A guest
POST answered 401 / "unknown guest" is treated the same way. Policy in
`src/lifecycle.ts` (unit-tested in `test/lifecycle.test.ts`).

Messages are **composed server-side** (see `core/server/chat.ts`) and
routed to channels, so the client just renders. That gives three things
for free: **history on re-login** (the server replays the shared rooms'
last 400 lines and, whatever their age, the viewer's own threads, every
alert, card, pin and pinned-room row — `core/server/chat.ts` `capHistory`),
**moderation** (admins hide/show messages), and a single source of truth
for narrative copy.

## Channels, spaces & threads

Channels are grouped into **spaces** — the Discord-style sidebar sections.
Story-driven channels live in the built-in `internet` space (the performer
also gets `booth` + `guests` sections); **authored `SPACE`/`CHANNEL`
declarations** (see [`core`](../core)) add their own spaces alongside. Each
message lands in one channel kind:

- **🌐 The Internet** (`lobby`) — ambient story barks, global broadcasts,
  your own personal beats, and open-room chat.
- **#faction** (`faction:<Id>`) — a faction-scoped broadcast / room, members
  only.
- **DM** (`dm:<Character>`) — a character speaking directly to you — and,
  for a `listed: true` character, you speaking to them (their performer's
  booth sees it; other booths don't).
- **Private** (`pm:<a>:<b>`) — a guest-to-guest thread, opened from the
  **👥 People** directory. Only its two parties (and the operator) see it.

**Pinned rooms — the Quest Log + the Codex (2026-10-02).** Two rooms (a
third, Wallet, with a `currency:` story — below) sit in a **Pinned** space above everything else (`PINNED_SPACE`; fixed order
via `roomOrder`). **📜 Quest Log** (`quests`, read-only): every quest the
story handed the guest is a card (`kind: "quest"`, giver avatar, brief,
status read off its thread by `questStatusOf`); tapping it opens the
card's own thread — its steps. **📓 Codex** (`codex`): every entry the
guest holds is a card (`kind: "codex"`, **Share…** → a person picker via
`CardActionsProvider`), and the room's composer *redeems* codes
(**Unlock**); a miss or a share lands there as a note. A scanned wall QR
arrives as `?unlock=<code>`, is redeemed on load, and opens the Codex.
A room's sign arrives as `?checkin=<slug>` (`checkin.ts`, K-13): checked in
on load (`/api/guest/checkin`), it opens that room's chat, or banners why
not (captured, on rails, not open yet).
**📷 Scan (wave 11, `guest-scan.tsx`).** The guest header and the Codex
composer carry a 📷 button: the booth's `CameraScanner` in a sheet, read in
*this* session (never a new tab). `guestScan` classifies the code: `unlock=`
(or a bare code) redeems and opens the Codex, `checkin=` checks in
(`GuestSession.checkin`) and opens the room, and the join QR / a pass / an
invitation / a re-pair code / the director's page just say what they are.
A `?unlock=` / `?checkin=` link that opens with **no** session (a QR app's
webview, another browser) lands on `LinkLanding` — the code in big type
("Type X into your Codex in the app you joined with") or the sign's room —
with *I haven't joined yet → Join* as the secondary path; never the picker.
A session just cut in this browser (a restart) shows its notice instead,
with *Join again →* (the link still redeems / checks in once in).
**Wave 18b (on `oct31-w18/integ`, not yet shipped).** A scan or a typed
code says it worked (`scan-done.tsx`, a lazy chunk: *🔓 Code accepted* /
*📓 Already yours* → the Codex on that entry, unfolded; *📍 Checked in*
with the story's reply lines → the room; a miss or a refusal keeps the
scanner open with the reason). The fact card (its own chunk,
`widgets-fact.tsx`) keeps *File it* tappable and points at the missing
piece in red (*⚠ Set how sure you are before filing…*). `badge:` lines
show as `NameBadges` (🚻) beside names in People, Who's here, the thread
rows, the pickers and every booth list (`booth/badges.tsx`), never on a
bubble. A CRA-flagged transfer reads 🚩 with the audit banner on both
phones. `lobby: hidden` drops the Chat log row; a lobby target opens
Notifications, where a guest's lobby-only line is a quiet row. Faction
mode (`sides/`, `sides/mode.ts` for the first-load readers,
`css/factions.css` in `styles.css`): one Factions list, ＋ Found a
faction, walk-in Join, your own count and *N more to win* only, the
Mission tile. Trabolta's pictures ship as `public/pictures/trabolta.svg`
/ `trabolta-broken.svg`. Hosts and the director phone get 🔇 Stop all
house sounds (`house-sound.ts`), and the host Judge tab counts the
filings with Trabolta.
**Reserved programs (wave 11, `claim.ts`).** An invitation's
`?code=…&claim=<token>` opens the guest join and rides `/api/identities`,
the picture lookup and `/api/guest/register`; rows with `reserved: true`
read 🔒 Reserved, and a 409 `reserved` says *This program is saved for an
invited guest — ask a host.* The claim leaves the URL once the guest is in
and is kept in `loom.guest.claim` (keyed by the event code), so a cut
session rejoins with it. The directory search carries it too and its
`reserved` hits are locked; a picker showing a 🔒 tile re-asks every 12 s
(`RESERVED_POLL_MS`), so a director's *Unlock for 2 min* reaches it.
**Countdowns (wave 11, `countdown.tsx`).** `GuestView.countdowns` (the
story's `countdown: … for guests` lines) tick in a strip under the room
header (and the identity card on a phone's room list) off the snapshot's
story clock; `paused` holds them with ⏸; none → no strip.
A director's re-pair QR arrives as `?code=<event>&pair=<code>`
(`resume.ts`, N-02): `main.tsx` strips the single-use code from the URL
before rendering, and `App` trades it (resolve the event code, then
`POST /api/guest/resume {pair}` → a fresh token) and adopts it as
`loom.guest` — the same Person, back in. A phone already signed in as a
guest asks first (*Switch this phone* / *Stay <name>*).
Both stay out of a cutscene (`personalStream`). Tested in
`test/quests.test.ts`.

**🪙 Wallet (Oct 31 wave 4).** A story with a `currency:` header gives
every guest a third pinned room, **Wallet** (`wallet`, `src/wallet.tsx`):
the header's ⭐ score becomes a `BalancePill` that opens it; the footer
offers **send / request / trade** (a `PeopleAmountSheet`, an `OfferSheet`
to buy or sell a codex entry for coin, a `StimulusSheet` for the minter,
plus her reserve: **🎁 Grant** (`PeopleAmountSheet mode="grant"` →
`/api/guest/wallet/grant`) and **🧊 Freeze** (`FreezeSheet` →
`/api/guest/wallet/freeze`); a frozen guest's pill and footer say 🧊 with
the thaw countdown and Send / Pay / Buy are off until `frozenUntil`),
and every transfer, request and offer is a card with its own thread
(`kind: "wallet"`, `WalletCardView`, buttons from `walletButtonsFor`) —
accept / decline / cancel, a countdown while a send waits in the
approver's window. The approver's booth sees its held queue in *its*
Wallet room with **Approve / Deny** (`/api/prime/wallet/{approve,deny}`);
guests call `/api/guest/wallet/*`. `WalletActionsProvider` carries the
calls to the cards. Since wave 9 a request card says who stopped its
payment (`by`, a display name: *⛔ Payment denied by <by>; refunded*;
when the payer took it back, *↩️ You cancelled the payment* on the
payer's phone and *↩️ <payer> cancelled the payment* on the asker's;
when a director did, *↩️ <by> cancelled your payment* on the payer's and
*↩️ <by> cancelled <payer>'s payment* on the asker's) and who closed an open request
(`closedBy`: *↩️ Director cancelled the request*), and the step lines
read naturally from each side (`possessive`). Tested in
`test/wallet.test.tsx`.

**📌 Pins + ⛔ restricted (Oct 31 wave 4).** A story's `pin "…"` is a
sticky notice: `pins.ts` `activePins` keeps the newest pin per (room,
key) until its `unpin` lands, and `PinnedRail` shows them above the
stream (a `!` pin also alerts). A `restrict`ed guest keeps their DMs and
the rooms the story named, read-only — the header says **⛔ restricted**,
every action button is gone, check-in is refused — until the story lifts
it. Tested in `test/pins.test.tsx`.

**People (2026-09-10).** The **👥 People** sheet lists every guest
and listed character with exactly the lore about them the viewer holds,
plus **💬 Message**. Performers see what their character knows under ⊞
Start → *What … knows* and share it from a guest's card (**📓 Share
lore…**). A
broadcast whose cue starts with `!` is an **alert**: chime (synthesised,
on one shared `AudioContext` unlocked on the first tap), vibration, and a
banner — in guest *and* booth sessions (`src/alerts.ts` `useAlerts`,
tested in `test/alerts.test.ts`). The last-seen mark survives a
reconnect's history replay (and is persisted per sign-in), so the newest
unseen alert from the last 10 story-minutes (`GuestView.clock` /
`PrimeView.clock`) banners on wake; a hidden page chimes when it becomes
visible. A booth also banners + chimes any readout it didn't ask for
(not within 4 s of its own scan / act — the late list, a private
warning). Since wave 13 an alert is a **moment** (`src/moments/`): it
renders on the story's rung, a minor one a rung lower, a booth never
above sticky, and every missed moment replays on wake (not only the
newest); `alerts.ts` keeps the mark and the quiet feedback toast. **⊞
Start → Keep my screen on** is an opt-in Screen Wake Lock
(`src/wake-lock.ts`). A captive in a `sealed: true` prison gets no
"make a break for it" button.

**Cards** (`src/widgets.tsx`) render a story's `show <kind>`: `captcha`,
`image`, `poll`, `tutorial` (with a Bathroom Mode step when the story
passes `bathroom:`), `pass`, the 📝 **File a fact** card
(`show fact … with thread: Trabolta, questions: "H1: … | H2: …"`, K-24):
pick a question, type an answer (≤ `FACT_MAX`, 200), set the slider
*Please select your confidence level in this response* (1–100; it starts
**unset** — greyed, "not set" — and *File it* waits until the guest sets
it by touch or a value key, never by tabbing onto it, wave 11) →
`{question, answer, confidence}` → `fact answered` (the server judges it;
the phone never sees the verdict), and the 💬 **answer** card (`show
answer "…" … with question: "P1"`): one free-text line → `{text}` →
`answer answered`. `with thread:` docks a card in that character's DM.

**Push to a locked phone (K-31a, 2026-10-15).** A 🔔 **Get alerts** card
(a one-time balloon by a guest's tray since wave 13, and ⊞ Start → Get
alerts) asks for notification permission
from a tap, then subscribes this phone through the push-only service
worker `public/sw.js` (no fetch handler — nothing is cached) and
`POST /e/:id/api/push/subscribe`; a phone that already said yes re-binds
silently on every sign-in, and **Leave / Sign out** unbinds it
(`Push.release` → `/api/push/unsubscribe` + the browser's own
unsubscribe), so a handed-on phone stops getting that person's alerts. Every `visibilitychange` / `pagehide` is
beaconed to `/api/push/visible`, so the server pushes a character's DM
or a booth readout only while the app is hidden; `!` alerts push always,
and the worker skips the notification while a play window is in the
foreground (no duplicate of the banner — except on iPhone, K-31b).
Nothing registers when embedded (`host.embedded`, Run → Players), on
plain http, without the Push API (an iPhone Safari tab), or when the
server has no VAPID keys (`src/push.ts` `usePush`, `src/push-card.tsx`,
tested in `test/push.test.ts`).
- **authored rooms** (`room:<name>`) — an `open` / `private` / `faction` /
  `group` / `dm` channel declared in `.loom`, grouped under its `SPACE`.

**Access control.** Visibility follows the channel kind: `open` rooms show
for everyone, `faction` rooms for that faction's members, and
`private`/`group`/`dm` rooms only for explicit members. The server snapshot
(`GuestView.channels`) lists exactly the rooms you can see — empty rooms
included. Membership changes through **invites** (`/api/*/channel/invite`,
and guests invite each other from the roster picker) and **leave**
(`/api/*/channel/leave`), both journaled so they replay; a join posts a
member-scoped "📥 … joined the room" notice.

**Channel-type rules.** Each authored channel carries `canPost` + `threadable`
in its snapshot (resolved from the `core` channel-type registry). A read-only
room (`post: none`, e.g. `#announcements`) hides the composer; a
non-threadable room hides the reply affordance. Broadcasts mirror into rooms
that subscribe (`routes: *`). A `slow:` room 429s a too-soon post; an
`ephemeral:` room's messages vanish (a `messageExpired` SSE event drops them
from the view). The guest invite picker is fed a **scoped roster** (only
faction-mates + people you share a gated room with), not the whole event.

**Typed chat (hybrid).** Participants type into a channel via a composer
(`/api/guest/say` · `/api/prime/say`); the message is journaled as a sim
`chat` event so it replays deterministically alongside the story. Audience is
the channel's current members (open → everyone). The composer clears only
once the send resolves (`sendFromComposer`): a refused line stays in the
box and banners the server's reason (`sayRefusalText`: ⏳ slow mode, ⏸
paused, ⛔ the rest; a 413 reads *✂️ Not sent: <error>. Your message is
still in the box — shorten it and send again.*, and the composer stops
at `CHAT_TEXT_MAX` = 2,000 characters, the server's cap); no answer within `SAY_TIMEOUT_MS` (15 s,
`withTimeout`) gives Send back with a check-your-connection banner. Each
room's composer is keyed by the room (a reply box by its thread), so a
draft never follows the guest into another room. A refused **Share…**
banners `shareErrorText` the same way.

**Threads (Slack-style).** A line message can be replied to: a reply carries
the root's `seq` as `parentSeq`, the channel shows a *"N replies"*
affordance, and opening it shows the thread panel (root + replies + a reply
composer). Threading is single-level.

**Streams reopen (wave 9).** `useChatStream` runs on the pure
`openChatFeed` (`src/client.ts`, tested with a fake EventSource and
clock in `test/client-reopen.test.ts`): an `EventSource` closed for good
(a Caddy 502 while loom restarts) asks its `probe` whether the session
is alive — `"reset"` / `"ended"` drop it as before, alive reopens on a
backoff (1 s doubling to 15 s, jittered, reset on a good open), and
coming back online, into view or out of the bfcache reopens at once.
The header dot reads **reconnecting…** while down; the cutscene stage
shows a **RECONNECTING…** strip after 5 s. A caller with no `probe`
(the terminal's pilot) keeps the old rule: `onDead` at once.

**Arm, then fire (wave 11, `arm.ts`).** A story button marked `arm: true`
(`Interaction.arm`) — on a booth's guest card or the guest's *Things you can
do* — arms on the first tap (the director phone's black look, *Tap again to
fire*) and fires on a second tap ≥ `ARM_DEAD_MS` and < `ARM_MS` later
(core's `tapCue`); it disarms after `ARM_MS` or when the page is left.

**Sender runs (Slack/Discord).** Consecutive `line`s from one sender within
five story-minutes coalesce under a single colored screen-name banner;
continuation lines tuck under it.

**Decisions dock in a thread.** A recruiter's `<choice>` appears as
quick-reply buttons inside *that recruiter's* DM; world choices (pick a
side, escape) sit in the lobby. Any thread with an unanswered decision
badges and sorts to the top, so a choice left unmade always pulls focus.

## Roles

- **🎟️ Guest** — register with a name + the host's **event code** (or
  arrive via a `?code=` link / QR that pre-fills it) → the frame above
  (`src/guest/`: `app.tsx`, `frame.tsx` — the NOW bar's objective sheet,
  the Start menu (`guestStartItems`; a restricted guest gets no side
  switch, `defectTargets`), the tray's balance and the alerts balloon;
  `src/chrome/`: the title bar, taskbar, tray, full-screen pass, balloon
  tips). The pass QR is drawn in the browser (`src/pass-qr.tsx`, `PassQr`, `qrcode`
  ^1.5.4, the same margin and error correction as `/api/qr`) at all three
  pass sites — the play app never calls `/api/qr`. Re-login
  restores every thread.
- **🎭 Performer** — sign in as a character → the booth (`src/booth/`,
  wave 13): the pinned **NOW card** (the character's live objectives, a
  checklist the story ticks, hand ticks saved per sign-in), a taskbar with
  ⊞ Start, a big **📷 Scan** and **🗂 Guests**, and a tray (the act, a
  countdown, 🧾 held transfers for the approver, missed moments). The
  scanner (camera via `BarcodeDetector`, else `jsQR` on a canvas — iPhone
  Safari — kept running under the card; or a typed id; `src/scanner.tsx` +
  pure `src/scan.ts`) opens the scanned guest's **card** at once from the
  scan's `card` (`POST /api/prime/card` re-reads it): facts by severity,
  at most three face buttons from the live objectives (`booth/model.ts`
  `cardButtons`), the press's `replies` / `said` / `staff` lines, *All
  buttons… (n)*. Rooms: staff rooms pinned, **Readouts** (the
  character's `dm:` Inbox rows, persisted, a 🪪 link to each guest's card),
  **Messages** (a guest's unread typed DM), the read-only broadcast feed,
  the booth's own Quest Log / Codex / Wallet (cards the story shows the
  character are answered via `POST /api/prime/widget`). An admin
  (performer who also enters the moderator passcode) additionally gets
  **hide/show** on every message and capture/release on each guest card.
- **🧑‍💼 Host** — a booth whose part has `admin: true` (or a moderator's)
  also gets the host dock (`src/host/`, wave 13): a **NEXT bar** above the
  taskbar (ARM → FIRE through core's arm model, PICK for a subject; the
  strip) and a pull-up console — **Cues · Needs · Judge · People · More**
  — polling `GET /e/:id/api/state?role=mod&host=1` (the host view) every
  few seconds and writing only to the host allowlist (`host/api.ts`:
  signal, var for the alert level only, broadcast, say as an agent-voiced
  character to a guest only, wallet holds, the King, terminals, codes
  without the mod passcode, claims, gone, pair, release, scan, restrict /
  unrestrict, start / stop). Never restart, push draft, go live, end, the
  var table, the log or the Mind. A booth whose token dies without a lifecycle frame (a
  director's ⏏ Release) shows `BOOTH_SIGNED_OUT`: *"Your booth was signed
  out (a director released your part, or the show went live) — sign in
  again with your passcode."*

- **🎬 Director cues** (W-26 + wave 10, `src/director.tsx`) — `?role=director` or a
  `?code=` link carrying the mod code (no link on the guests' chooser): the
  editor's Run → Director page on a phone (the rows, acts and arm model are
  core's `src/cue-sheet.ts`, imported by path). Mod passcode + a name →
  `/api/mod/login`; polls the lean `GET /api/state?role=mod&cues=1` (just
  the cue sheet) every 3 s (parked while hidden, backing off on errors,
  polling at once when the network comes back, `onOnline`). The cues are
  grouped by the story's **acts** under a pinned **NEXT bar** (the soonest
  countdown when there is nothing to press) and a **strip** (the act, the
  phase, a countdown, ≤ 3 global watch values; *⏸ clock stopped* while
  paused). Tap to **arm**, tap again ≥ 300 ms (`ARM_DEAD_MS`) and < 4 s
  later to **fire** (a fast double tap only arms); an arm the poll shows
  the cues moved past (`armStillValid`: LAST moved, a first fire, or the
  armed cue pressed again) is dropped — *Cues moved — tap again*, nothing
  sent (`phoneTap` → `stale`). A fire posts `/api/mod/signal {name,
  subject?, label: "Phone · <name>", args?, presses}` (8 s timeout; no
  answer reads "not sure it fired"); a 409 `moved` (a press landed since
  the arm's count) toasts the same *Cues moved — tap again*, and a 409 `no
  scenario loaded` *Not fired — the doors aren't open yet*. One press at a
  time: the lock holds until a poll started after the press has landed
  (`REPOLL_WAIT_MS` 3 s at most), and NEXT then cools 1 s after any press
  (`cueLocked`). A subject cue (an award) picks a person first, and only an
  `award_*` cue (`takesValue`) shows the optional **Value** box (`args:
  {value}`, core's `cueValueArgs`). A press the server answers `refused:
  true` toasts *"Not taken — X doesn't apply right now (# hosts says
  why)"* (`fireToast`).

The full operator surface is the [`editor`](../editor)'s Run mode (not
this app); here are the phone cue sheet and the hosts' booth console.

## Install

Shared install from the repo root (covers core, bank, play, and editor):

```bash
pnpm install
```

## Develop (HMR)

Two processes, like the editor + relay:

```bash
# terminal 1 — the event server (API + SSE)
pnpm --filter @loom/core serve            # → http://localhost:7000

# terminal 2 — this app, with hot reload
pnpm --filter loom-play dev               # → http://localhost:5174
```

Open **:5174**. Vite proxies `/api`, `/events` (SSE), and the per-event
`/e/:eventId/*` routes to the event server. `host: true` exposes the dev server on the LAN so phones can
load it too. Point it at a server on another machine with
`LOOM_SERVER=http://<ip>:7000 pnpm --filter loom-play dev`.

## Build (production)

```bash
pnpm --filter loom-play build             # → play/dist
```

The event server serves `play/dist` at `/` automatically (it resolves
`../play/dist`; override with `LOOM_APP_DIST`). So for a real event you
run a single process — `@loom/core serve` — on one origin, no Vite.

## Commands

| Command          | What it does                          |
|------------------|---------------------------------------|
| `pnpm dev`       | Vite dev server (:5174) with HMR      |
| `pnpm build`     | production build → `dist/`            |
| `pnpm preview`   | preview the built app                 |
| `pnpm typecheck` | `tsc --noEmit`                        |
| `pnpm test`      | vitest (pure threads/grouping helpers)|

## Layout

```
src/
  types.ts      # mirror of core's views + chat (ChatMessage, GuestView, PrimeView, HostView, ObjectiveView, …)
  client.ts     # api() POST + useChatStream (SSE → de-duped message map)
  guest/        # the guest app: app.tsx (frame + cutscene), frame.tsx (NOW sheet, Start items, tray), register.tsx, sheets.tsx
  booth/        # the booth: app.tsx, now-card.tsx, scanner.tsx, card.tsx, guests.tsx, readouts.tsx, tray.tsx, layer.tsx, model.ts (pure rules)
  host/         # the host dock: dock.tsx (NEXT bar + console), tab-{cues,needs,judge,people,more}.tsx, api.ts (allowlist calls), client.ts (?host=1 poll), model.ts
  chrome/       # title-bar.tsx, taskbar.tsx, start-menu.tsx, countdown-tray.tsx, balloon.tsx, pass.tsx (full-screen pass), icons.tsx, keyboard.ts
  stream/       # crawl tiers in bubble.tsx (+ ../crawl.ts), card-tray.tsx, settled.ts, ticker.tsx, notices.ts, badges.ts, codex-room.tsx + codex-groups.ts, channel-view.tsx, composer.tsx
  moments/      # model.ts (rungs, queue, holds, missed, wake replay), provider.tsx, surfaces.tsx (balloon / sticky / dialog / blue screen / glitch), pins-rail.tsx
  rooms/        # order.ts (fixed tiers, Other rooms fold), list.tsx (SpaceList + Shell), spaces.ts, threads-state.ts
  session/      # guest.ts / prime.ts (the role sessions), channels.ts, shared.ts, stream-handlers.ts
  ui/           # primitives.tsx (sheets, avatars), window.tsx (Win95 windows + dialogs), objective.tsx (the objective card)
  css/          # base.css, themes.css, w95.css + one per lane (chrome, stream, moments, booth, host)
  chat.tsx · guest.tsx · performer.tsx · session.ts · threads.ts   # barrels: every pre-wave-13 name still resolves
  help.tsx      # the in-app Help window (searchable, role-aware; content from ../docs/help/play/), loaded lazily
  ui.tsx        # the role chooser; the booth (host dock included) and the director phone load lazily from here
  director.tsx  # the director's phone cue sheet (?role=director, W-26), loaded lazily
  widgets.tsx   # show-cards registry (captcha / image / poll / tutorial / pass / 📝 fact / 💬 answer)
  wallet.tsx    # the Wallet room: cards, send / request / offer / stimulus / grant / freeze sheets, approvals
  pins.ts       # sticky notices: activePins → the pinned rail
  alerts.ts     # the last-seen mark + the quiet feedback toast (alarms are moments)
  push.ts       # Web Push subscribe / re-bind / release + visibility beacons (K-31a); push-card.tsx = the 🔔 card
  checkin.ts    # ?checkin=<slug> room signs (K-13) · resume.ts = ?pair= re-pair links (N-02)
  pass-qr.tsx   # the guest pass QR, drawn in the browser (wave 9)
  scanner.tsx   # booth camera (BarcodeDetector, else jsQR) · scan.ts = what a code means (N-01)
  guest-scan.tsx # the guest's 📷 Scan sheet (typed codes too) + the wrong-browser LinkLanding (wave 11)
  claim.ts      # ?claim= reserved programs (wave 11) · countdown.tsx = the story clock helpers behind the tray clock
  arm.ts        # arm-then-fire for `arm: true` story buttons (core's tapCue; wave 11)
  wake-lock.ts  # ⊞ Start → Keep my screen on; the full-screen pass's held lock
  main.tsx      # entry
  styles.css    # imports the css/ files
public/sw.js    # push-only service worker (no fetch handler) + manifest.webmanifest
test/           # vitest: crawl · moments · taskbar · booth · host · rooms · help · widgets · wallet · pins · push · floor-css · browser-floor · …
index.html      # Vite entry
vite.config.ts  # react plugin + dev proxy to LOOM_SERVER (default :7000)
```

The guest and performer apps are thin: both assemble the same role-agnostic
`chat.tsx` primitives over their own channel-shaping (`session.ts`) and a
footer (decision tray / scanner / moderation), so new surfaces compose
without duplication.

**In-app Help**: ⊞ Start → **Help** (and "? What is this" on the
sign-on screen) opens `HelpSheet` — a searchable, Win95-help-viewer-
styled manual. Guests see the guest guide; performers additionally get the
performer-station and host-console articles (`role: performer`
frontmatter). Articles are
markdown in `docs/help/play/`, parsed by the shared
`docs/help/helpdoc.ts` engine and bundled at build time —
edit the markdown, rebuild (or let Vite HMR pick it up), done.

> Note: camera scanning uses `BarcodeDetector` where the browser has it
> (Chrome/Android) and falls back to `jsQR` (iOS Safari). The camera needs
> a secure context (https / localhost); the manual id field is always there.
