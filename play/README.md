# loom-play

The **participant app** for live Loom events — the React client guests
and performers use. It's skinned like an **old-school AOL chat room**
(teal Win95 desktop, navy title bars, a sunken white transcript of
Times-New-Roman line messages with colored screen names, chunky 3D
buttons, a "People Here" buddy list), but the structure underneath is
still threaded: every conversation is its own **channel (thread)** in an
inbox, and each running instance streams its participant's slice of the
live `Sim`.

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
for free: full **history on re-login** (the server replays every thread
since the event began), **moderation** (admins hide/show messages), and a
single source of truth for narrative copy.

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

**Pinned rooms — the Quest Log + the Codex (2026-10-02).** Two rooms sit
in a **Pinned** space above everything else (`PINNED_SPACE`; fixed order
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
A director's re-pair QR arrives as `?code=<event>&pair=<code>`
(`resume.ts`, N-02): `main.tsx` strips the single-use code from the URL
before rendering, and `App` trades it (resolve the event code, then
`POST /api/guest/resume {pair}` → a fresh token) and adopts it as
`loom.guest` — the same Person, back in. A phone already signed in as a
guest asks first (*Switch this phone* / *Stay <name>*).
Both stay out of a cutscene (`personalStream`). Tested in
`test/quests.test.ts`.

**People (2026-09-10).** The **👥 People** sheet lists every guest
and listed character with exactly the lore about them the viewer holds,
plus **💬 Message**. Performers see what their character knows in the ☰
sheet and share it from a guest's thread (**📓 Share lore…**). A
broadcast whose cue starts with `!` is an **alert**: chime (synthesised,
on one shared `AudioContext` unlocked on the first tap), vibration, and a
banner — in guest *and* booth sessions (`src/alerts.ts` `useAlerts`,
tested in `test/alerts.test.ts`). The last-seen mark survives a
reconnect's history replay (and is persisted per sign-in), so the newest
unseen alert from the last 10 story-minutes (`GuestView.clock` /
`PrimeView.clock`) banners on wake; a hidden page chimes when it becomes
visible. A booth also banners + chimes any readout it didn't ask for
(not within 4 s of its own scan / act — the late list, a private
warning). **☰ → Keep my screen on** is an opt-in Screen Wake Lock
(`src/wake-lock.ts`). A captive in a `sealed: true` prison gets no
"make a break for it" button.

**Cards** (`src/widgets.tsx`) render a story's `show <kind>`: `captcha`,
`image`, `poll`, `tutorial`, `pass`, and the 📝 **File a fact** card
(`show fact … with thread: Trabolta, questions: "H1: … | H2: …"`, K-24):
pick a question, type an answer (≤ `FACT_MAX`, 200), tick *I'm certain* →
`{question, answer, certain: true}` → `fact answered`; `with thread:` docks
it in that character's DM.

**Push to a locked phone (K-31a, 2026-10-15).** A 🔔 **Get alerts** card
(and a row in the ☰ / profile sheet) asks for notification permission
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
the channel's current members (open → everyone).

**Threads (Slack-style).** A line message can be replied to: a reply carries
the root's `seq` as `parentSeq`, the channel shows a *"N replies"*
affordance, and opening it shows the thread panel (root + replies + a reply
composer). Threading is single-level.

**Sender runs (Slack/Discord).** Consecutive `line`s from one sender within
five story-minutes coalesce under a single colored screen-name banner;
continuation lines tuck under it.

**Decisions dock in a thread.** A recruiter's `<choice>` appears as
quick-reply buttons inside *that recruiter's* DM; world choices (pick a
side, escape) sit in the lobby. Any thread with an unanswered decision
badges and sorts to the top, so a choice left unmade always pulls focus.

## Roles

- **🎟️ Guest** — register with a name + the host's **event code** (or
  arrive via a `?code=` link / QR that pre-fills it) → an inbox of
  conversation threads with a status HUD (faction · score · location ·
  captured) and a profile sheet (QR pass · defect · leave). Re-login
  restores every thread.
- **🎭 Performer** — sign in as a character → the *same* threaded surface,
  recomposed for the booth: a pinned **Scanner** thread (camera via
  `BarcodeDetector`, else `jsQR` on a canvas — iPhone Safari — left on
  between passes; or manual id; `src/scanner.tsx` + pure `src/scan.ts`) + scan readouts, a read-only
  **broadcast feed**, and one **conversation per guest** to scan into. An
  admin (performer who also enters the moderator passcode) additionally
  gets **hide/show** on every message and capture/release in each guest
  thread.

The operator/moderator surface is the [`editor`](../editor)'s Run mode
(not this app).

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
  types.ts      # mirror server/chat.ts (ChatMessage incl. parentSeq / Channel incl. spaceId)
  client.ts     # api() POST + useChatStream (SSE → de-duped message map)
  threads.ts    # group→channels + spaces (groupBySpace) + sender runs (groupRuns) + thread selectors
  chat.tsx      # primitives: SpaceList/ChannelView/MessageGroup/MessageThread/Composer/…
  session.ts    # useGuestSession / usePrimeSession (channels + decisions + actions + say())
  guest.tsx     # the guest inbox app
  performer.tsx # the performer / booth app
  help.tsx      # the in-app Help window (searchable, role-aware; content from ../docs/help/play/)
  ui.tsx        # the role chooser
  widgets.tsx   # show-cards registry (captcha / image / poll / tutorial / pass / 📝 fact)
  alerts.ts     # `!` alerts: chime, buzz, banner, the last-seen mark (K-06 / N-07)
  push.ts       # Web Push subscribe / re-bind / release + visibility beacons (K-31a); push-card.tsx = the 🔔 card
  checkin.ts    # ?checkin=<slug> room signs (K-13) · resume.ts = ?pair= re-pair links (N-02)
  scanner.tsx   # booth camera (BarcodeDetector, else jsQR) · scan.ts = what a code means (N-01)
  wake-lock.ts  # ☰ → Keep my screen on
  main.tsx      # entry
  styles.css    # the AOL-chatroom skin (Win95 bevels, navy bars, serif lines)
public/sw.js    # push-only service worker (no fetch handler) + manifest.webmanifest
test/           # vitest: grouping · spaces · threads · help · widgets · alerts · push · checkin · resume · scan · …
index.html      # Vite entry
vite.config.ts  # react plugin + dev proxy to LOOM_SERVER (default :7000)
```

The guest and performer apps are thin: both assemble the same role-agnostic
`chat.tsx` primitives over their own channel-shaping (`session.ts`) and a
footer (decision tray / scanner / moderation), so new surfaces compose
without duplication.

**In-app Help**: the `?` button in either header (and "? What is this" on
the sign-on screen) opens `HelpSheet` — a searchable, Win95-help-viewer-
styled manual. Guests see the guest guide; performers additionally get the
performer-station article (`role: performer` frontmatter). Articles are
markdown in `docs/help/play/`, parsed by the shared
`docs/help/helpdoc.ts` engine and bundled at build time —
edit the markdown, rebuild (or let Vite HMR pick it up), done.

> Note: camera scanning uses `BarcodeDetector` where the browser has it
> (Chrome/Android) and falls back to `jsQR` (iOS Safari). The camera needs
> a secure context (https / localhost); the manual id field is always there.
