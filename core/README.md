# @loom/core

The **TypeScript** Loom engine and the event server that hosts live
shows. No WASM, no Prism. It is the maintained implementation of the
language: the Rust crates at the repo root are the original engine and
lag behind it.

Loom is a language for **social-ecosystem simulation**: LARPs,
interactive installations, multiplayer games. A `.loom` file reads like
a screenplay (`Name:` dialogue, beats, choices), but underneath it is a
reactive program: factions, locations, characters with per-person
relationships, rules that fire on real-world events, and an autonomous
clock.

Two halves live here:

- **The engine** (`src/`): the parser, the `Sim` runtime, and the
  language service the [`editor`](../editor) runs in-process (completion,
  hover, definition, references, diagnostics, the story graph). The
  editor's Run mode on a local folder runs this `Sim` in the browser.
- **The server** (`server/`): one Node process that hosts many live
  events over SSE + REST, serves the participant app
  ([`play`](../play)), the wall terminals ([`terminal`](../terminal)) and
  the reinstallation game ([`reinstall/web`](../reinstall/web)), and runs
  the multi-tenant control plane (author accounts, projects, launching
  events) on Postgres.

The show this all exists for, *Trapped in the Internet* (Halloween
2026), is a Loom project in
[`examples/trapped-in-the-internet/`](./examples/trapped-in-the-internet/)
and is the server's default scenario.

## What's here

```
src/
  parser/          lexer, AST, declaration bodies, keyword statements
                   (statements.ts), name folding (names.ts), diagnostics,
                   and the span-preserving edit API (edit.ts)
  runtime/
    expr.ts        the World scope, values, the expression parser
    ledger.ts      the narrative event ledger
    bundle.ts      the compiled project and its `is` merges
    sim/           the Sim: model.ts compiles a project, sim.ts runs it
                   (see sim/DESIGN.md); crews, badges, stats, the board
                   (watch: / countdown:), channel types
  lsp/             the Workspace language service, the story graph,
                   rename, and the workspace lints
  cue-sheet.ts     the director's cue rows, acts and the arm model
  host-board.ts    what the hosts' panel shows (needs, judging, awards)
  delivery.ts      alert levels and effect manners, shared with play
  facts.ts         the facts.json contract; answer-match.ts the judge's fold
  casino.ts        the casino's games and payouts (pure)
  go.ts            `with go:` exits; show-clock.ts the show clock
server/            the event server (see "The event server" below)
scripts/           titi-facts, loomcheck, show-page, sync-example,
                   live-guard
examples/
  load.ts          the multi-file project loader (main.loom first)
  trapped-in-the-internet/   the show (runbook: its README)
  glass-orchard/   the Loom 4 reference project
  escape-the-internet/       the older v3-surface party scenario
test/              vitest suites (about 160 files)
```

The language itself is documented in
[`docs/writing-in-loom.md`](../docs/writing-in-loom.md) (the writer's
guide), [`docs/loom-4.md`](../docs/loom-4.md) (the Loom 4 surface) and
the in-app help in [`docs/help/authoring/`](../docs/help/authoring/).
The runtime's design is [`src/runtime/sim/DESIGN.md`](./src/runtime/sim/DESIGN.md).

## Install

The JavaScript packages share one install. Run it once from the repo
root:

```bash
pnpm install
```

## Commands

Run from `core/`, or with `pnpm --filter @loom/core <script>` from the
repo root:

| Command | What it does |
|---|---|
| `pnpm test` | vitest, the whole suite. `pnpm exec vitest run test/<file>` runs one file |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm serve` | boot the event server on :7000 (no watch mode) |
| `pnpm migrate` | create or upgrade the control plane's Postgres tables |
| `pnpm loomcheck <folder> [--smoke]` | check a project the way the server sees it; `--smoke` plays it briefly |
| `pnpm titi:facts [--check]` | regenerate the show's files from its `facts.json`; `--check` writes nothing and exits 1 when they are stale |
| `pnpm show:page [--check]` | regenerate the show book `examples/trapped-in-the-internet/SHOW.html` |

From the repo root: `pnpm dev` runs the whole dev stack
(`scripts/dev.mjs`), and `pnpm sync-example "<project>" [example]` pushes
an example folder into a server project and reloads its event (see
"Dev gotcha" under the control plane below).

## The event server

`pnpm serve` (`server/server.ts`) boots one process that hosts every
live event. Each event is an `EventRuntime` (`server/event-runtime.ts`):
one `Sim`, its journal, its chat store, its sessions and its streams.
The `EventRegistry` (`server/registry.ts`) routes `/e/:eventId/*` to the
right one and rehydrates every non-ended event at boot. The process
always hosts a `default` event on the show's story, reachable at the bare
paths (`/api/...`) and at `/e/default`; with a database it also hosts
each project's events beside it.

Transport is Server-Sent Events (push) plus `fetch` POSTs (actions). There
is no WebSocket, so it works on any phone browser on the wifi.
Moderation happens in the editor's Run mode, on the `play` app's host
and director pages, and through `pnpm showctl`, all over the
`/api/mod/*` routes.

```
http://<host>:7000/             the participant app (built loom-play)
http://<host>:7000/terminal/    the wall terminals (built loom-terminal)
http://<host>:7000/reinstall/   the reinstallation game + map editor
http://<host>:7000/cards        every printed QR on one screen (moderator code)
```

- **The doors**: `idle → open → paused`. Guest and performer actions
  answer `409` while the doors are not open. While open the server ticks
  the sim once a second, so ambient generators, timers and time-driven
  rules advance.
- Build the apps before serving them (`pnpm dev` at the root does it).
  Each dist path can be overridden (see [Environment](#environment)).

### Passcodes (logging in)

Three independent passcodes gate the three roles:

| Role          | Passcode            | Where it's used                          |
|---------------|---------------------|------------------------------------------|
| 🎟️ Guest      | **event code**      | required to register / join the event    |
| 🎭 Performer  | **performer code**  | sign in as a character (scan guests)     |
| 🛡️ Moderator  | **moderator code**  | mod access — open/close doors, moderate (via the editor's Run mode) |

Each is taken from `LOOM_EVENT_PASS` / `LOOM_PRIME_PASS` / `LOOM_MOD_PASS`
if set; **otherwise a short, speakable code is generated** (six chars, no
`0/O/1/I/L`) and **persisted**, so it stays stable across restarts. All
three are printed in the boot banner — that terminal is the trusted
channel the operator reads them from. The editor's Run page also
shows the event + performer codes (with a join-QR) to hand out to
the room. Guests can also arrive via a `?code=<event-code>` link (what the
QR encodes), which pre-fills the field. Matching is trimmed + case-insensitive.
Every join / codex / check-in / re-pair link the server builds sits on the
**join base** (`pickJoinBase` in `server/routing.ts`): `LOOM_BASE_URL` when
set (a public deployment — a container's LAN IP is unreachable from a phone
on cellular), else the first non-localhost interface URL.

### Capabilities & scanning

A login token carries **composable capabilities** (`server/session.ts`),
not a single fixed role:

- a **performer** holds a `character` — the identity they scan as;
- an **admin** holds the moderator capability (open doors, moderate);
- entering the moderator passcode while already signed in **upgrades the
  same token** — so *a performer can also be an admin*;
- a `{ character: null, admin: true }` token is a **headless admin**: an
  operator with a scanner but no character/booth;
- a **host** holds the host capability: signing in as a part
  whose CHARACTER has `admin: true` grants it, signing in as any other part
  revokes it, and Release / Logout / Go live drop it with the part. A
  host-only token reaches exactly the host allowlist below, never the
  rest of the mod surface.

Scanning is one capability-dispatched endpoint, **`POST /api/scan`**: a
`character` cap runs that character's story scan (`on scan` hooks + the
`respond` that streams back); an `admin` cap gets the guest identified for
moderation. An admin may also pass **`as: <character>`** to scan *as* any
character (firing that character's story beat) — the editor's Run cockpit
exposes a "scan as…" control whose default, **Silent**, is moderation-only.
Admins then act via **`POST /api/mod/act`** (`capture` / `release` /
`restrict` / `unrestrict`) and
**`POST /api/mod/signal`** (a named event, optionally *as* a character via
`actor`), which reuse the sim's own primitives — so the moderation
toolset grows by adding a case, not an endpoint. The editor's Run mode
(headless admin) and the performer `play` app (as an upgrade) both
expose the scanner + moderation actions.

### Chat & channels (the threaded model)

Everything a participant sees is **composed server-side** (`server/chat.ts`)
into channel-routed messages — the single source of truth the
[`loom-play`](../play) client renders as Discord/Telegram-style threads:

- `dialogue` → a **DM** channel (`dm:<Character>`); `broadcast` → the
  **lobby** or a **`faction:<Id>`** channel; ambient + personal state beats
  → the lobby. Each message carries an `audience` (`"all"` or guest ids).
- On SSE connect a guest receives a **`history`** event then live
  **`message`** events — so a **re-login replays the conversation**, never
  a blank feed. A guest's and a booth's history frame is capped
  (`capHistory`, `HISTORY_LIMIT` = 400): the last 400 ordinary lines of
  the shared rooms, plus — whatever their age — every pinned-room row
  (Codex, Quest Log, Wallet), every pin / unpin, every alert, every
  widget card and the viewer's own rows (a guest's `dm:` / `pm:` threads
  and rows addressed to them alone, `guestOwnRow`; a booth's
  `@<Character>` rows and its own `dm:<Character>` threads,
  `boothOwnRow`). Directors' streams and `GET /api/history` stay whole.
  Performer/mod clients get the room's feed for context + moderation.
- **Moderation:** `POST /api/mod/message { seq, hidden }` hides/shows a
  message — guests in its audience see it vanish/return (a
  `messageModerated` event), admins keep it flagged. `GET /api/history?role=
  guest&id=<id>` returns a thread history (an admin token includes hidden
  messages, for moderating any guest's threads).
- A pending **decision** docks under a channel: the guest snapshot's
  `decisionChannel` is the speaker's DM for a narrative `<choice>`, else the
  lobby. The client badges + pins that thread until it's answered.
- **Presence:** the mod snapshot carries live connection state — `online`
  per roster guest, `online` per cast member (a performer streaming as
  that character), and `modsOnline` (connected director sessions) — and
  a fresh snapshot is pushed to every mod client whenever anyone
  connects or drops, so the editor's Run rail shows who's actually in
  the room.
- **Mod feed bandwidth:** mod-console snapshots are coalesced to ≤ 2/s
  (`MOD_SNAPSHOT_MS`; a burst of steps → one trailing `ModView`, built
  once and shared by every director). A console still holding more
  unsent than one view is skipped and sent the newest view once it catches
  up (never every view in between). House tools stream
  `/events?role=mod&lean=1`: every `sim` / `message` / `lifecycle` frame,
  never a `snapshot` or `history` (stagehand uses it). A full director
  console is ≈ 6 Mbit/s at 45 guests (the whole world every snapshot);
  `?delta=1` consoles (the editor's) get a keyframe, then keyed
  `snapshotPatch` frames (`server/mod-patch.ts`), ≈ 0.11 Mbit/s. A frame
  over 64 KiB is paced out in slices, so a slow console still makes
  progress.
- **Stalled streams:** every SSE write goes through `sseWrite`; a client
  over its cap (256 KB, 2 MB for a full mod stream) with no byte sent out
  for 15 s (a phone suspended with its socket up, a laptop asleep on the
  Run page) is dropped, and its EventSource reconnects to a fresh snapshot
  + history. A slow link that is still draining is never dropped.
- **Process load:** `GET /api/mod/metrics` (moderators) returns the
  server process's cumulative CPU µs, memory, `loadavg` / `cpus`, the
  event-loop delay since the previous read, and the stream-client count
  (`server/routes/metrics.ts`) — the load test
  (`scripts/accept/k32-load.ts`) samples it to record CPU on the VPS.
- **The director's read:** each roster row also carries the guest's
  story position (`beat`, from `beatEntered.subject` bookkeeping) and
  their visited-beat trail (`visited`), and the snapshot includes the
  whole world state as display strings (`world` — every scalar, global
  and per-entity). `POST /api/mod/persona {name}` spawns a
  director-puppeted guest through the journaled `createPerson` — the
  **shared-rehearsal** path: co-writers moderating the same preview
  event each add a persona and play it from their own editor. `POST
  /api/mod/var {path, value}` writes any world variable (journaled
  `Sim.setVar`); person-standard paths (`<id>.location` / `.faction` /
  `.captured` / `.score`) route through the real mutators (`arrive` /
  `join` / `capture` / `setScore`), so occupancy + membership stay in
  sync and the matching hooks fire.

### Authored chatrooms — `SPACE` / `CHANNEL`

Beyond the story-driven channels above, authors declare standing chatrooms
in `.loom`, grouped into Discord-style **spaces**:

```loom
SPACE Forums
  label: The Forums

  CHANNEL general                # open: everyone can see + post
    kind: open
    label: # general

  CHANNEL backroom               # private: invite-only
    kind: private
    invite: members

CHANNEL mod_lounge               # faction: only that faction's members
  space: Forums
  kind: faction
  faction: Mods
```

Channel `kind` drives **access**: `open` (everyone) · `private` /
`group` / `dm` (explicit members) · `faction` (a faction's members). Each
authored channel is `room:<name>`; visibility is computed per participant
(`GuestView.channels` lists exactly what they can see, empty rooms included).
Membership moves through journaled commands — `inviteToChannel` /
`leaveChannel` (`POST /api/{guest,prime}/channel/{invite,leave}`, and guests
invite each other from the roster) — so it replays deterministically and a
join posts a member-scoped notice. A guest's invite **roster is scoped**
(`sim.rosterFor`) to people they already share a private-ish space with —
faction-mates + gated-channel co-members — so a name isn't exposed to
strangers across an open room.

**Channel-type registry (behaviour).** Beyond visibility, each channel
resolves a `ChannelRules` bundle from a **pluggable type registry**
(`runtime/sim/channel-types.ts`) — the single place a new room behaviour is
added (`registerChannelType`). Rules cover **who may post**
(`post: everyone | members | faction | none | role X`), **threadability**
(`threads: on|off`), and **broadcast routing** (`routes: *` or a cue list).
Authors pick a preset with `type:` or override any rule inline:

```loom
CHANNEL announcements       # the built-in read-only feed
  kind: open
  type: announcement        # = post: none + threads: off + routes: *
```

The server enforces it: `POST /api/guest/say` returns 403 when `canPost` is
false, non-threadable channels flatten replies, and a `broadcast` mirrors into
every channel whose `routes` match (scoped to the intersection of the
broadcast's and the channel's audience, so a faction broadcast can't leak into
a public feed). **`slow:`** rate-limits a sender (a too-soon post → 429
`slow mode`), and **`ephemeral:`** ages messages out — they're withheld from
re-login history and the server pushes a `messageExpired` event (off the
deterministic story clock) so live clients drop them. Both are declared inline:

```loom
CHANNEL quick-chat
  kind: open
  slow: 3s          # one post per sender per 3s
  ephemeral: 30s    # messages vanish 30s after they're sent
```

### Persistence (surviving restarts & drops)

The sim is fully deterministic, so the server **event-sources** every
mutation: each `createPerson` / `join` / `choose` / `tick` / … is journaled
to `LOOM_STATE_DIR` (default `server/.loom-state/`) alongside the scenario,
phase, the passcodes, and live session tokens. On boot it replays the
journal into a fresh sim and rehydrates sessions — so a crash, laptop
sleep, or Ctrl-C is transparent: **nobody re-authenticates and nobody
loses their faction / score / place.** Chat history is **not** stored
separately: replaying the journal through `server/chat.ts` re-derives the
identical messages (same deterministic events → same `seq`s); only the set
of moderator-hidden `seq`s is persisted (`hidden.json`) and re-applied. A
director's `/api/mod/broadcast` (an `!` alert included) is journaled too
(the `broadcast` mutation: `Sim.broadcast` records the cue, fires no
trigger), so it replays onto its own seq and shows in the mod sim feed,
the Log and an export. A restore also re-asks every agent DM still owed
an answer from the last 10 story-minutes (`AGENT_QUEUE_MAX_AGE_MS`; a
thread already given the `hold:` line is re-asked as held, so the line is
never said twice) and counts each agent power's `limit:` off the journal:
an agent's own fire is journaled `by: agent:<Character>`, a director's
fire of the same interaction never counts. The TV-voice mute is kept in
`screen-voice.json`. Not restored: reinstallation sessions (in memory,
see the spatial plane). Replay takes about a second per 1,500 journal
lines. A wifi blip is handled client-side (the SSE stream
auto-reconnects and the next snapshot rehydrates the UI). `mod load` /
`mod reset` start a fresh timeline (clear the journal + chat +
moderation); a restart with the doors closed (paused or idle: Reset,
Push draft, a reload, Go live in place on a paused preview) still plays
the `entry:` beat on the next open (`entryPlayed`, derived from the
journal on a restore).

Every environment variable is listed under [Environment](#environment)
below.

For the participant app's dev/build flow (HMR), see [`../play`](../play).

### Routes by area

Every event-plane route below lives under `/e/:eventId/…`, and the bare
paths still reach the default event. Most handlers are in
`server/event-runtime.ts`; the larger areas have their own module, named
in the table. A guest or booth authenticates with its token
(`x-loom-token` on a POST, `?token=` on a stream); a moderator with a mod
token or the owning author's session.

| Area | Routes | Notes |
|---|---|---|
| Streams + state | `GET /events?role=guest\|prime\|mod`, `GET /api/state`, `GET /api/history` | `?lean=1` (house tools: no snapshots), `?delta=1` (keyed patches, `mod-patch.ts`), `?host=1` (the hosts' view), `?cues=1` (the director phone's cue sheet), `?as=<id>` (a director's exact lens on one participant) |
| Joining | `POST /api/resolve-code`, `/api/identities{,/search,/pictures}`, `/api/guest/{register,resume,picture}`, `/api/prime/{login,logout}`, `/api/mod/login` | `identity.ts` (who may sign in as whom), `wiki.ts` (the program directory), `avatars.ts`, `routes/claims.ts` (reserved programs), `routes/n02.ts` (re-pair, release a part) |
| Guest play | `/api/guest/{say,act,choose,widget,checkin,join,defect,escape}`, `/api/guest/codex/{redeem,share}`, `/api/guest/channel/{invite,leave}` | `routes/k13.ts` (room check-in), `routes/sides.ts` (which side a guest may join) |
| Getting back in | `/api/guest/{enter,badge,resume}`, `/api/guest/rejoin{,/names,/poll}`, `/api/mod/guest/{rejoin,pair}`, `/api/mod/badges`, `/api/prime/login {part}` | `routes/rejoin.ts` (wave 23), `routes/n02.ts` |
| Crews + factions | `/api/guest/crew/{found,invite,join,leave}`, `/api/guest/recruit{,/answer}`, `/api/guest/side/leave`, `/api/mod/crew/{rename,dissolve}` | `routes/crews.ts`; faction mode is `runtime/sim/crews.ts` |
| Booths (performers) | `/api/scan`, `/api/prime/{act,card,cue,say,widget}`, `/api/prime/codex/share`, `/api/prime/channel/{invite,leave}` | a press or scan answers with `card` / `said` / `staff` / `replies` (`routes/press-lines.ts`) |
| Directors (mod) | `/api/mod/{start,stop,reset,load,resync}`, `signal`, `beat`, `choose`, `say`, `broadcast`, `var`, `set`, `act`, `reveal`, `codex`, `quest`, `persona`, `impersonate{,/end}`, `message`, `clock`, `caller`, `codes`, `cards`, `log`, `recap`, `metrics` | `routes/k12.ts` (print sheet), `routes/cards.ts` (`/cards`), `routes/mod-log.ts`, `routes/recap.ts`, `routes/metrics.ts` |
| Hosts | the host allowlist only | `routes/host.ts`; a host-only token gets 403 `not from a booth` anywhere else |
| Wallet | `/api/guest/wallet/*`, `/api/prime/wallet/{approve,deny}`, `/api/mod/wallet/*` | `wallet.ts` |
| Casino | `POST /api/mod/casino/bet` | rolls in the server; `src/casino.ts` holds the games |
| Facts judge | (no routes of its own) | `facts.ts`; verdicts go through `/api/mod/signal` |
| Agents | `GET /api/agent/stream`, `POST /api/agent/{reply,trace,judge}`, `GET /api/agent/facts`, `/api/agent/mind`, `/api/mod/agent/{trace,control}` | `agents.ts`, `agent-recent.ts`, `agent-dossier.ts` |
| Reinstallation games | `/api/spatial/{house,stream,pose,found,moment,end}`, `/api/spatial/king/hit`, `/api/mod/spatial/*` | `spatial.ts`; the contract is [`docs/loom-reinstall.md`](../docs/loom-reinstall.md) §2; `moment` (wave 26: the void, the heart, a pickup) is [`docs/loom-w26-contract.md`](../docs/loom-w26-contract.md) C6 |
| Voice + cameras | `POST /api/spatial/voice`, `GET /api/spatial/voice/stream`, `POST /api/mod/spatial/cam`, `GET /api/spatial/{cams,cam}` | `spatial-voice.ts`, `spatial-cams.ts`; memory only, never journaled; the upload answers `watched`, and a game session sees only the feeds of its own room (wave 26) |
| Screens | `GET /api/screen/state`, `/api/mod/screen/{terminals,voice,identify}`, `/api/mod/tts` | `routes/screen.ts`, `tts.ts` |
| House sound | `/api/mod/audio{,/project,/test,/stop,/announce,/play,/report}` | `audio.ts` (`audio.json`); wave 25: `play` (one sound / announcement, hosts too) and the router's `report` (acks + health, memory only) |
| House desk | `GET /api/mod/desk[?after=&wait=]`, `POST /api/mod/desk{,/project,/go,/standby,/stop,/check,/check/reset}` | `desk.ts` (`desk.json`, wave 25); hosts reach the GET, `go`, `standby`, `stop`, `check`; the contract is [`docs/loom-house-desk.md`](../docs/loom-house-desk.md) |
| House lights | `/api/mod/lights{,/project,/test,/devices,/pair,/shown}` (wave 39: `presence` + the `presence=<seq>` cursor on the GET) | `lights.ts` (`lights.json`), `lights-shown.ts` (the games' `lights` frame) |
| Web Push | `/api/push/{config,subscribe,unsubscribe,visible}`, `/api/mod/push/status`, `/api/guest/homescreen` | `push.ts`, `routes/k31.ts`, `routes/k31b.ts` |
| Process | `GET /api/health`, `GET /api/landing`, `/api/qr` | `boot.ts`, `server.ts` |

Status codes the clients depend on: **409** while the doors are closed
(`no scenario loaded` / `doors are closed`), **429** past a rate limit,
**403** for a capability the token lacks (`locked` for a guest write
from a locked phone, wave 26), **503** `starting` until the
boot settles (never a 404, so no phone signs itself out).

### The show's systems

These are generic engine and server features; *Trapped in the
Internet* is the story that uses them all. The help articles in
[`docs/help/authoring/`](../docs/help/authoring/) explain each from the
writer's side.

- **The cue sheet** (`src/cue-sheet.ts`, `cueState` in `views.ts`). The
  story's `who: admin` INTERACTIONs, in running order and grouped by
  `act:`, are the directors' cue sheet. NEXT is the first unfired, live
  cue after LAST; `sequence: false` cues (fired by a device) tick but are
  never LAST; `urgent: true` jumps to the head of NEXT while live. A
  press the story refuses (it only produced diagnostics or staff-room
  lines) never becomes LAST, and `/api/mod/signal` answers `refused:
  true`. A cue-sheet press carries `presses`; a press that raced another
  answers 409 `moved`, and one before the `start:` beat answers 409
  `doorsClosed`. Both the Run page and the director phone arm a cue,
  then fire it.
- **Hosts and players.** A CHARACTER with `admin: true` is a host part:
  signing in as it grants the host capability. A host-only token may
  read the host view (`/api/state?role=mod&host=1`) and the recap, and
  post cues (`signal`), broadcasts, the doors (`start` / `stop`), the
  show clock, the caller claim, wallet holds, the King, the screens'
  mute and identify, codes, claim unlocks, re-pairs, part releases, scans,
  crew renames, the house-sound stop, `say` only as an agent to one
  guest, `var` only for the alert level or `Night.judge_mode`, and `act`
  only to restrict or unrestrict (`server/routes/host.ts`). Its presses
  journal `by: "Booth · <Character>"`.
  `player: true` makes a part a player booth: its own buttons, a
  Mission, a score, never a caller. `by:` on an INTERACTION says which
  character may press it, and the server enforces it.
- **The facts judge** (`server/facts.ts`). A project's `facts.json`
  holds the hunt questions, their answer key and aliases. It is
  snapshotted at launch, and the key stays out of the world, the
  journal, phones and agents until a filing is judged accurate; then only
  that question's canonical answer rides the journal as `key_answer`. Each filing is judged at once (exact match =
  accurate); in `auto` mode a non-exact filing goes to the story's
  `judge:` character (an agent) when its worker is online, and falls back to its proposal at the
  round's settle. `Night.judge_mode` switches to `review`, where a
  director confirms every verdict on Run → Mind's Judging card.
- **The wallet** (`server/wallet.ts`). A header `currency:` line turns a
  per-person slot into a currency; `wallet: approver` / `minter`
  characters hold, approve, grant and freeze. Everything in flight
  (pending sends, held transfers, requests, codex offers) is one
  journaled `wallet` op per change, timed on the story clock.
- **The casino** (`src/casino.ts`, `/api/mod/casino/bet`). The server
  rolls with `crypto.randomInt` and journals the roll with the payout, so
  a replay never rolls again.
- **Agent-voiced characters** (`server/agents.ts`). A CHARACTER with
  `mind: external` has no performer: each conversation with it becomes a
  request on `/api/agent/stream`, answered by the stagehand `agents`
  worker ([`stagehand/`](../stagehand)). With no worker online for 20 s
  the character's `hold:` line is posted once. A request carries the
  thread, both parties' state and a `recent` block;
  secret codex entries, `secret:` slots and `private:` slots never ride
  one.
- **Choices with ids.** A pending menu has an id (`GuestView.choices`);
  `/api/guest/choose {index, text, choice}` answers 409 `moved` when the
  menu changed under the tap.
- **Faction mode.** A header `founding:` line lets guests found crews
  that race for a majority (`runtime/sim/crews.ts`, `ModView.race`).

### The spatial plane (the reinstallation games)

Every event also hosts the **reinstallation games** — a corrupted program
walks a virtual copy of the house to the golden duck, on a Quest 3
(`reinstall/vr`) or a tablet (`reinstall/web`, served at `/reinstall/`),
and the wall terminals (`/terminal/`) watch. The contract, with every
route, frame and status code, is
[`docs/loom-reinstall.md`](../docs/loom-reinstall.md) §2; the house map
and its geometry are `@loom/house` (`../house`).

- **`SpatialHub`** (`server/spatial.ts`, transport-free, injected clock —
  the `AgentHub` pattern), one per `EventRuntime`: the map (+ its FNV
  version and source, `event` | `project` | `show`), **sessions** (`begin` mints a
  secret session token the game uses for its own high-rate calls; a
  `station` parks the assignment until the headset's first pose claims it,
  ending anything else on that station), **stations** (headsets polling
  `GET /api/mod/spatial/station`), latest-only **poses** labelled with
  `locate` and flushed to the stream every 100 ms, and the **found** check
  (`nearDuck`: ≤ 2 m plan, and ≤ `DUCK_MAX_RISE` in height or on the same
  floor). Poses never touch the journal, the chat or `fanout`; only the
  outcome does — `signal("the simulation completed")` + `signal("the
  golden duck")`, journaled `by` the game's device, and refused (409
  "doors are closed") while the event is paused.
- **The map** belongs to the project (`server/house-maps.ts`):
  `house.json` + any `house.<variant>.json` are project files (not story —
  `projectSource` concatenates `.loom` only), snapshotted at launch like
  `scenario_source` (`event.house_maps` + `spatial-maps.json` in the state
  dir with the active variant, which also rides `event.map_variant`),
  refreshed by a reload, fresh on End → relaunch (on the last event's
  variant: a launch seeds `map_variant` from the project's last event). The event's map is the director's save for this event
  (`spatial-house.json`, `Store.loadHouse/saveHouse`) > the snapshot's
  active variant > the show's file (`LOOM_HOUSE`, default the example's
  `house.json`, re-read on mtime change, last good map kept; an event with
  no project maps offers its `<stem>.<variant>.json` siblings as
  variants). `POST /api/mod/spatial/house {house, base?}` validates,
  refuses a stale `base` (409), saves, and `setHouse` carries live
  sessions over: a duck keeps its spot id (or is re-dealt), then the
  stream gets `house` + a `duck` frame per moved duck. `GET
  /api/mod/spatial/variants` lists the variants; `POST
  /api/mod/spatial/variant {file, base?}` switches (the tent ↔ shed
  switch, mid-show: the same `setHouse` path, a director's save dropped);
  `POST /api/mod/spatial/house/project {file?, base?}` is "Save to
  project" (through the collab hub; 409 for an event with no project).
  `/api/mod/load` takes `maps` beside `source` (`scripts/sync-example.ts`).
- **The stream** (`GET /api/spatial/stream`, SSE, its own subscriber set —
  never `clients`): `hello` / `join` / `poses` / `found` / `leave` /
  `house` / `duck` / `reset`. A restart ends every session (`reset`), and
  a server process restart loses them all (tokens live in memory: the
  game's next call answers 401 and the program is scanned again; found
  runs stay in `spatial-runs.jsonl`).
- **Who may play**: only a captured or marked program begins a
  reinstallation (`POST /api/mod/spatial/begin` answers 409 *not marked
  for reinstallation* otherwise; `force: true` is a director's
  override), and a walk whose program stops being marked ends as
  `unmarked`.
- **The King**: one shared health bar for the night (`Night.king_hp`).
  `POST /api/spatial/king/hit` judges reach off the session's last pose
  (`kingReach` in `@loom/house`), allows one hit per program per visit,
  and journals the new value; `POST /api/mod/spatial/king {hp}` sets it.
- **Game moments** (wave 26): `POST /api/spatial/moment {kind, prop?}`,
  `kind` one of `escape` (the void), `heart` (Trabolta's heart, once the
  King is down) or `pickup` (the virus disk). The hub judges it on the
  session's last pose with the `@loom/house` rules and commits one story
  signal `by` the game's device. The 200 carries `lines`, what that
  commit said to the program (`momentLines`), game-only beats included;
  an escape also carries the `spawn` the player is put back at. A
  refusal is 409 (`not out`, `cooldown` with `retryMs`, `sealed`, `not
  there`, `far`, `already`, doors closed), 404 for an unknown prop, 400
  for a bad body. The 20 s escape cooldown, who heard the heart and who
  took each pickup are memory only; the story's own guards keep the
  heart and the virus once-only across a restart. The contract is
  [`docs/loom-w26-contract.md`](../docs/loom-w26-contract.md) C6.
- **Presence** (wave 26): each session keeps a presence room beside the
  raw `locate` room, with doorway hysteresis (`presenceRoom`). The voice
  relay, the screen state's `spot.here` and a game session's camera list
  judge by it; the stream's `room` stays the raw one.
- **Voice and cameras** (`spatial-voice.ts`, `spatial-cams.ts`): the
  terminals and the games hear each other over raw μ-law POSTs and one
  SSE stream per device, same room by presence room, and terminals
  upload low-res camera frames the games hang where the terminal is. The
  upload answers `watched` (a player is in that spot's room, so the
  terminal can slow down while nobody is), and `GET
  /api/spatial/{cams,cam}` with a game session shows only its own room's
  feeds, never the tent's; a moderator sees every feed. Both are memory
  only. The contract is
  [`docs/loom-reinstall.md`](../docs/loom-reinstall.md) §2.3–§2.4.
- **Routes**: `GET /api/spatial/{house,stream}`, `POST
  /api/spatial/{pose,found,moment,end}` (session token; bodies capped at 2 KB
  before the generic parse), `GET /api/mod/spatial/{station,stations,candidates}`,
  `POST /api/mod/spatial/{house,begin,end}` — on `/e/:eventId/…` and the
  bare default event. Tests: `test/spatial.test.ts` (hub + runtime) and
  `test/spatial-routing.test.ts` (`routing.ts`).

### The wall terminals' screen state

`server/routes/screen.ts`:
`GET /e/:id/api/screen/state?name=&spot=&view=&character=` (mod token or
the author's session) answers ~0.5 KB — `night` (`Night.screen` /
`Night.terminals`), `cues` (the last `cue screens_*` / `terminals_*` /
`tv_*` / `tablet_*` value per family + a `seq`, folded from the sim log so
a restart replays to the same answer), `character` (hidden = not
`reveal`ed to everyone, `awake`, agent `online`), `attract` (hidden or
asleep), `countdown` / `remaining` (story seconds on the running
`Night.*_end` timer) and `announce` (the latest `do announce "…"`, `{seq,
text, at}` — `at` 0 for replayed history — or null; a terminal set to
`announce` chimes and says a new one, `terminal/src/announce.ts`).
Terminals poll it every 2 s instead of the mod feed. Alongside, the
`AgentHub` `admits` hook refuses a guest's DM with a character still hidden
from that guest (no worker request, so no premature hold line); performers'
`cast:` threads always pass. Tests: `test/screen-state.test.ts`.

It also carries the poller's **screen program**:
`target` (`tv` for `view=mirror|tv`, else `terminals`; `screens_*` reach
both, `tv_*` / `terminals_*` one, `tablet_*` neither) and `program` —
`slide` (the newest slide or base cue: `screensaver` / `attract` /
`trabolta_online` / `mirror` clear it; `persist` for `bingo` / `y2k` /
`trust_chart` / `truth_txt` / `ad_hijack` / `award_*` / `ceremony*`),
`overlay` (`blackout` / `go_to_living_room` / `alarm`, until the next
slide or base cue), `blackout`, `flicker` and `glitch` (one-shots; wave
26's `screens_glitch` / `tv_glitch` / `terminals_glitch` never touch the
slide or the overlay). `countdown_*` cues never
replace the slide. Each is `{value, cue, seq, at}`, `at` = server epoch ms
when the fold first saw it — 0 for history replayed at a boot/restart, so
nothing held re-runs. The terminal applies the holds and precedence
(`terminal/src/slides.ts`).

**The TV room voice**: a poll that adds
`&voice=<LOCATION>&after=<seq>` (the TV, `view=tv`) gets a `voice` block —
`room` (`loc:<Id>`, "" for an unknown location), `muted`, `head` (the
newest chat seq) and `lines`: every *character's* `line` in that room
after `after` (narration, typed guest chat and hidden messages left out),
`{seq, from, text, beat}`, the newest `MAX_VOICE_LINES` (40). `beat` is
the scripted beat, or null for a director's `say` as the character. No
`after` = no lines (a booting TV starts at `head`); the TV decides what to
speak (`terminal/src/tv.ts`). `POST /e/:id/api/mod/screen/voice {muted}`
(mod token or author session) sets the TV-voice mute every TV reads off
its next poll — kept in the event's state dir (`screen-voice.json`), so a
server restart, a redeploy or Go live in place leaves it as it was (the
boot log says 🔇 when the TV starts muted); a body without `muted` reads
it. A poll's `room=` resolves against the story's declared LOCATIONs
before the doors too, so `{id: ""}` means a typo. `GET /e/:id/api/mod/screen/terminals` (mod token
or author session) is the director's heartbeat list: `{now, terminals:
[{name, spot, view, character, room?, at, ago}], voiceMuted, silentMs}` —
`TERMINAL_SILENT_MS` = 20 s — and reading it never records a poll.


Since then the screen state has grown, always additively, so an older
terminal ignores what it does not know:

- `moments`: the last 12 house-wide moments (subject-free beats, admin
  cues the story took, `do pick` draws, device signals, reveals, the
  duck's find, house `!!` lines). A moment never names a guest, except a
  pick's verdict and a find. The games' moment signals (the void, the
  heart, a pickup) are never moments.
- `night`: an allowlist of public `Night.*` values (`SCREEN_NIGHT_VARS`
  in `routes/screen.ts`), including the server-room door and the patch
  bay's override (`door_override`, `patch_override`).
- `results` (the hunt results on the TV), `chart` (the Trust Chart),
  `king` (the shared King's bar), `room` (with `?room=`: whether that
  LOCATION is open to everyone, plus its `cue room_<x>` value) and
  `spot` (with `?spot=`: that terminal's announce setting, and, wave 26,
  `here`: how many players' presence rooms are its room, 0 for the tent,
  absent when the server can't tell).
- `tvSpeech` (wave 26): what the TV is speaking now, `{seq, chunk, at}`
  from the newest `sp=` of a `view=tv` poller (`chunk` null once that
  line is done), or null when no TV reported in the last 6 s. Memory
  only. No client reads it yet; it is there so the walls can follow his
  voice later (V1 phase 2).
- The poll is also the terminal's heartbeat. Its query carries the
  device fields (`audio`, `vis`, `bat`, `fs`, `mic`, `ver`, `ann`, the
  server-room door's `door` / `dlv` / `dft` / `dwn`, and the patch bay's
  `pb` / `pbc` / `pbx` / `pft`), which Run → Terminals reads off
  `/api/mod/screen/terminals`. The TV adds `sp=<seq>:<chunk>` (or
  `<seq>:d`), kept only from a `view=tv` poller. Anything malformed is
  dropped.

The patch bay itself has no route: the server-room terminal reads the
Grand Central M4 over Web Serial and posts `patch_changed {combo}`
through `/api/mod/signal`; the story judges it (see
[`hardware/server-room-m4/`](../hardware/server-room-m4/)).

### Web Push (Android phones and booths)

`server/push.ts` (`PushHub`, transport-free; `web-push` behind a
`PushSender`) + `server/routes/k31.ts`. Keys come from the environment —
generate them **once** with `npx web-push generate-vapid-keys` and pin
them in `.env` (`LOOM_VAPID_PUBLIC_KEY`, `LOOM_VAPID_PRIVATE_KEY`,
`LOOM_VAPID_SUBJECT` = `mailto:you@…` or the `https:` site; default
`LOOM_BASE_URL`). **Never rotate them before the show** — every phone's
subscription is bound to the public key. A missing or invalid key turns
push off cleanly (`enabled: false`, no 🔔 card). Routes, per event:
`GET /api/push/config` → `{enabled, publicKey}`; `POST
/api/push/subscribe {subscription}` (guest token → `guest:<id>`,
performer token → `prime:<character>`; a director's play-as session is
refused; the endpoint must be on a known push service —
`PUSH_SERVICE_HOSTS`: FCM, `*.push.apple.com`, Mozilla, `*.notify.windows.com`,
never an IP literal or a port → else 400; 10 per owner per minute → 429;
a guest while the doors are closed → 409; a new device past
`MAX_DEVICES` (300, the whole event) → 503; a repeat writes nothing); `POST /api/push/unsubscribe {endpoint}` (the
play app sends it on Leave / Sign out); `POST
/api/push/visible {token, endpoint, hidden}` (the client's
`sendBeacon`); `POST /api/mod/push/status` → who is subscribed.
Subscriptions live in `push.json` in the event's state dir (one owner per
device; any 4xx from the push service but 429 prunes). **Send rule**: `!` alerts
to every entitled guest + every booth, always; a character's own line in
`dm:<Character>` to its addressee, and a booth's readout (`reply` — the
door alarm, the late list) to that booth, only while the device's last
flag says hidden. Every push carries a notification (high urgency). A
story restart unbinds every guest device (the phone re-binds on
re-join); go-live and releasing a part unbind booths. Nothing
pushes during journal replay. The play app's `/sw.js` +
`/manifest.webmanifest` are served `Cache-Control: no-cache` under
`PLAY_CSP` (`worker-src 'self'`). Tested in `test/push.test.ts`.

## Running a live event

```bash
# everything at once, from the repo root (see scripts/dev.mjs):
pnpm dev                           # build play + terminal + reinstall, serve (:7000), editor (:5173)
pnpm dev --sync "Untitled Project" # …and push core/examples/trapped-in-the-internet
                                   # into that server project + reload its event
# or piece by piece:
pnpm --filter loom-play build
pnpm --filter @loom/core serve
# → the boot banner prints the passcodes + LAN URLs
# → guests open http://<lan-ip>:7000 on their phones
# → moderate from the Loom editor's Run panel (⌘2), or with the mod code
```

Moderation lives in the editor's Run mode (the standalone
`/console` was removed); guests + performers use the served `play` app.

## Security model

The event plane is capability-gated (`server/event-runtime.ts`,
locked in by `test/server-security.test.ts`):

- **Guests** get an opaque **token** at registration; their public
  `g-xxxxxx` id is broadcast in rosters and is *not* a credential. Every
  guest action + read is authorized by the token, so no guest can act as
  — or read the threads of — another. The token rides `x-loom-token`
  (POST) or `?token=` (SSE).
- **The mod feed** (full god view, every DM, hidden factions) is refused
  without the `admin` capability or the owning author's session; the
  prime feed needs a performer token.
- **Passcodes** are short + speakable, so login/register/`resolve-code`
  endpoints are **per-IP rate-limited** against online guessing.
- Baseline **security headers** + CSP, a request-body cap (413), and
  trusted-origin CORS reflection are applied at the router; the control
  plane **refuses to boot on the default dev auth secret** in prod.

## SaaS control plane (accounts · projects · events)

The server is **multi-tenant**. Beyond the single LAN event above, authors
can sign up, keep many **projects** (server-stored `.loom` files), and launch
each project's own **event** — while party-goers still join by short passcode
with no account.

Two planes:

- **Control plane** — needs Postgres (`DATABASE_URL`, default
  `postgres://127.0.0.1:5432/loom_dev`). `pnpm migrate` creates the tables
  (BetterAuth `user/session/account/verification` + `project/project_file/event`).
  Routes: `/api/auth/*` (BetterAuth email/password), `/api/projects/*` CRUD,
  `POST /api/projects/:id/event` (launch `live`/`preview`) + `…/pause|resume|end`.
  Codes are pinned per project: a launch reuses the previous event's three
  codes (`lastEventCodes`; ended events free them), so End → relaunch keeps
  every printed join / clue QR working. To replace a leaked code, End the
  event and relaunch with `{"rotate": "staff"}` in the launch body (fresh
  performer + moderator codes, the guest code and printed QRs kept) or
  `{"rotate": true}` (all three fresh — reprint the QRs).
  All ownership-scoped to the signed-in author. If the DB is unreachable the
  control plane disables itself and the LAN event plane still runs.
- **Event plane** — one `EventRuntime` per live event under `/e/:eventId`, kept
  in an `EventRegistry` that rehydrates every non-ended event on boot.
  `POST /api/resolve-code {code}` maps a guest/performer/mod code to its
  `{eventId, role}`. Each event has its own on-disk journal under
  `LOOM_STATE_DIR/<eventId>` and its own `/e/:eventId/*` route namespace.
- **Sign-in identities** (`server/identity.ts`, derived from the story):
  `POST /e/:id/api/identities {passcode}` lists what that code may sign in
  as — the event code → the unclaimed *programs* (bare `CHARACTER`s: no
  hooks / beats / `listed` / mind; never a `joinable: false` caste), the
  performer or mod code → the unclaimed *parts* (everything else that is
  `playable`, minus `mind: external`). `POST …/identities/search {passcode,
  q}` searches the program directory (`server/wiki.ts` — Wikipedia,
  steered at software via `hastemplate:` filters; antivirus hits flagged
  `blocked: "antivirus"`). `guest/register {name, wiki?}` and `prime/login`
  refuse a taken name (409), a part / caste for a guest (409), an
  antivirus directory pick (403); `prime/login` checks the part against
  the story's compiled model before the doors too (a story that won't
  compile answers 409). A booth's `/api/prime/say` posts only where its UI
  has a composer — its `guest:` threads, its `cast:` thread, the lobby and
  the rooms (locations + authored rooms); a pinned room, a raw `dm:` /
  `pm:` answers 403, an unknown room 404. `/api/prime/codex/share` answers
  403 when an agent refuses the lore (as the guest route does), `shared:
  false` when the recipient already held it. A restricted guest's
  `/api/guest/join` and `/api/guest/defect` answer 403. A **locked**
  guest (wave 26: the story's `lock:` header holds for them, `views.ts`
  `isLocked`) writes nothing: every `/api/guest/*` POST answers 403
  `locked` from one check at the top of `handlePost`, DMs included,
  except the session's own housekeeping in `LOCKED_OPEN` (register,
  resume, enter / rejoin, badge, homescreen, push, logout) and `act` on a
  `restricted: allow` button (`test/w26-lock.test.ts`). Profile pictures (`server/avatars.ts`):
  a hand-picked `avatar:` (URL or `File:` name → `Special:FilePath`,
  `|`-separated options) or the best of the article's gallery
  (`WikiClient.pictures` / `rankFiles`: logo / icon / box art before the
  lead screenshot, furniture dropped), keyed per event in `avatars.json`
  (`"chosen"` marks a guest's own pick, which a re-seed keeps), served
  same-origin at `GET /e/:id/api/avatar/<key>` from a process-wide byte
  cache that also keeps every picture on disk (`LOOM_STATE_DIR/pictures`)
  — the story's pictures are fetched when it loads. `POST
  /api/identities/pictures {passcode, name | wiki}` → `{name,
  options[{key, file}]}` (hand-picked first, then the gallery);
  `guest/register` takes `picture` (one of those keys, else 400);
  `POST /api/guest/picture {picture?}` lists / switches a signed-in
  guest's. Views carry `avatars` (folded name → key). `LOOM_WIKI=off`
  keeps the server offline (hand-picked pictures still work).
- **Room check-in by QR** (`server/routes/k13.ts`): `POST
  /e/:id/api/guest/checkin {at}` folds a sign's slug (`the-start-bar`) onto
  the exact LOCATION and journals `signal("checked_in", guest, {at})` —
  the story's `when checked_in for program:` rule does the move. Refused
  (nothing journaled) when the guest is captured, stands in a prison /
  sealed room, is on rails (a cutscene room, or `uploaded && !cleared`),
  or the room is a prison / cutscene / hidden from them; 429 inside a
  20 s per-guest cooldown. → `{ok, at, channel: "loc:<at>", moved}`.
- **Lost phones** (`server/routes/n02.ts`): `POST
  /e/:id/api/mod/guest/pair {id, revokeOthers?}` (mod-only) mints a
  **single-use pair code** for an existing Person (ten minutes, in memory,
  cut by every restart; a newer code for the same guest voids the older;
  the old tokens stay valid unless `revokeOthers: true`, which cuts them
  + their streams + push devices; a director's persona → 409) →
  `{ok, id, name, pair, expiresAt, revoked, url}` with `url` =
  `<join base>/?code=<event>&pair=<code>`. The phone trades it at `POST
  /e/:id/api/guest/resume {pair}` (no token; throttled like a sign-in)
  → `{ok, id, name, token}` — a fresh token persisted in `guests.json`
  like a registration's; a spent / expired / unknown code → 410. A
  guest's own token is never a re-pair link. `POST /e/:id/api/mod/prime/release {character}` takes
  the part off every session holding it (a performer+admin session keeps
  admin), closes those booth streams, persists → `{ok, character,
  released}`; 404 for an unknown character. Nothing is journaled.
- **Getting back in without a director** (wave 23, `server/routes/rejoin.ts`;
  its header is the contract). **Badges**: `POST /api/mod/badges {from?,
  count?}` lists printable blank badges (`B001…`, code =
  `secretCode(claimSecret, "badge:<n>", 8)`, link
  `<join base>/?code=<guest code>&badge=<code>`, who holds each);
  `register {…, badge}` or `POST /api/guest/badge {badge}` (token) links
  one (409 `{holder, name}` when it is someone else's); `POST
  /api/guest/enter {passcode, badge | claim}` (no token, throttled) →
  `{resumed: true, id, name, token}` or `{resumed: false}`; `/api/scan`
  and `/api/mod/scan` take a badge as `target`; `GuestView.badge`. Links
  persist in `badges.json` and die with every story restart. **Ask a
  host**: `POST /api/guest/rejoin/names {passcode}`, `POST
  /api/guest/rejoin {passcode, name}` → `{request}`, `POST
  /api/guest/rejoin/poll {request}` → `pending | approved (token, once) |
  denied | expired`; hosts see `rejoins` on the host view and the
  `cues=1` view and answer `POST /api/mod/guest/rejoin {request, approve}`
  (host allowlist). Ten minutes, memory only. **Cast cards**:
  `/api/mod/codes` → `castLinks` (`?code=<prime>&part=<code>`);
  `/api/prime/login {passcode, part}` takes the part from any holder.

The owning author's BetterAuth session is accepted on `/e/:eventId/api/mod/*`
and the gated mod reads, so authors moderate from the editor's Run mode
without a mod code (a co-moderator's mod code still works too).

```bash
DATABASE_URL=postgres://127.0.0.1:5432/loom_dev pnpm migrate   # once
# In prod, BETTER_AUTH_SECRET must be a real secret or the control plane
# refuses to boot (the event plane still runs). Generate one with:
#   export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
DATABASE_URL=postgres://127.0.0.1:5432/loom_dev BETTER_AUTH_SECRET=change-me pnpm serve
```

**Dev gotcha — the Run mode plays a snapshot.** A server project's event
runs `event.scenario_source`, captured at launch, not the example folder
on disk, and the server has no watch mode. After editing an example (or
server code), `pnpm sync-example "<project name or id>" [example]`
(`core/scripts/sync-example.ts`) writes the files into `project_file`,
updates the event's snapshot, and reloads the running event through its
own mod code (guests re-join); `pnpm dev --sync …` does it on boot. On a
**live** event with a real guest it writes the files and stops there
(exit 3: the live guard, `scripts/live-guard.ts`; `--i-know-this-is-live`
or `LOOM_I_KNOW_THIS_IS_LIVE=1` overrides it, and a preview is never
guarded). The
example's house maps (`house.json`, `house.<variant>.json`) go with it,
but the **project's copy wins**: an example map is only added when the
project lacks that file, and a project map that differs (one saved from
the map page, say) is kept, with both versions summarised.
`--replace-maps` overwrites them with the example's (copying the old ones
to a temp directory first); `--keep-maps` touches no map. The example's
`facts.json` is always pushed (it is generated from the team's file, never
edited in a project). A map that
doesn't validate stops the sync before anything is written, and `PUT
/files` / `/api/mod/load {maps}` refuse one with 400 + `problems`.

## Environment

Everything is optional; the defaults run a LAN event with no setup.
`.env.example` at the repo root lists what the Docker deployment sets.

| Variable | Default | What it does |
|---|---|---|
| `LOOM_PORT`, `LOOM_HOST` | `7000`, `0.0.0.0` | where the server listens |
| `LOOM_EVENT_PASS`, `LOOM_PRIME_PASS`, `LOOM_MOD_PASS` | generated, then kept | the default event's guest / performer / moderator codes |
| `LOOM_STATE_DIR` | `server/.loom-state/` | journals, codes, sessions, per-event state |
| `LOOM_APP_DIST`, `LOOM_TERMINAL_DIST`, `LOOM_REINSTALL_DIST` | the sibling packages' `dist/` | the built apps served at `/`, `/terminal/`, `/reinstall/` |
| `LOOM_BASE_URL` | the first LAN address | the base of every join / check-in / re-pair link; set it on a public deployment |
| `LOOM_HOUSE`, `LOOM_FACTS`, `LOOM_AUDIO`, `LOOM_LIGHTS`, `LOOM_DESK` | the example's `house.json` and `facts.json`; no default for audio / lights / desk | fallbacks for an event whose project has no copy |
| `LOOM_WIKI` | on | `off` keeps the program directory offline |
| `LOOM_TTS_URL` (+ `_API_KEY`, `_MODEL`, `_VOICE`, `_FORMAT`) | off | the opt-in server voice; the terminals use the devices' own voices by default |
| `LOOM_VAPID_PUBLIC_KEY`, `LOOM_VAPID_PRIVATE_KEY`, `LOOM_VAPID_SUBJECT` | unset (push off) | Web Push; generate once, never rotate before a show |
| `LOOM_HOMESCREEN` | off | the iPhone Home Screen push path |
| `LOOM_SNAPSHOT_MS` | 0 | coalesce guest and booth snapshots (a load contingency) |
| `LOOM_AGENT_RECENT`, `LOOM_AGENT_DOSSIER` | on | `off` drops the `recent` block / the heart dossier from agent requests |
| `LOOM_RL_RESOLVE`, `_REGISTER`, `_LOGIN_FAILURES`, `_REDEEM_MISSES`, `_WIDGETS`, `_WALLET`, `_QR` | see `server/rate-limit.ts` | rate limits as `<max>` or `<max>/<seconds>`; raise them for a house behind one public IP |
| `DATABASE_URL` | `postgres://127.0.0.1:5432/loom_dev` | the control plane's Postgres |
| `LOOM_DB_WAIT` | wait when `DATABASE_URL` is set | `off` / `0` probes the database once |
| `BETTER_AUTH_SECRET` (or `LOOM_AUTH_SECRET`), `BETTER_AUTH_URL` | a dev secret | author sessions; a deployment refuses the dev secret |
| `LOOM_TRUSTED_ORIGINS` | the Vite dev origins + the base | extra CORS origins, comma-separated |
| `LOOM_TRUST_PROXY` | unset | `1` behind a reverse proxy, so rate limits key on the client's address |
| `LOOM_EDITOR_URL` | `/edit/` on the base, or `:5173` locally | the editor link in invite mail |
| `LOOM_SMTP_URL` or `LOOM_RESEND_API_KEY`, `LOOM_MAIL_FROM` | console fallback | outbound mail |
| `LOOM_WEBMASTER_PASSWORD`, `LOOM_WEBMASTER_FROM`, `LOOM_WEBMASTER_REPLY_TO` | off | the `/webmaster/` outbox (needs the Resend key too) |
| `LOOM_SERVER`, `LOOM_I_KNOW_THIS_IS_LIVE` | `http://localhost:7000` | used by `sync-example` (the server to reload; the live-guard override) |

The production setup and its security model are in
[`docs/loom-deployment.md`](../docs/loom-deployment.md) and
[`docs/loom-docker-deploy.md`](../docs/loom-docker-deploy.md).

## Status

- The parser is a complete port of the Rust parser, and has since grown
  well past it (Loom 4's keyword surface, `when` rules and watchers,
  OBJECTIVE, guarded choices, the show-era header keys). The Rust crates
  do not know most of this.
- The runtime is the first-principles ecosystem `Sim`. Its known gaps
  against the bank compiler's reference interpreter (for example `->
  END` is inert, `<after:>` does not latch) are listed in
  [`bank/README.md`](../bank/README.md).
- `@loom/core/lsp` is the editor's whole language service.
- The server is what the show runs on. The VPS at
  `app.mapsandducks.com` runs release `w18b-1021`; master carries waves
  18b Stage B through 26, merged and tested but not yet shipped (the
  root [`CLAUDE.md`](../CLAUDE.md) has the release status). The
  per-wave notes that used to fill this README are archived in
  [`docs/history/core-readme-2026-10.md`](../docs/history/core-readme-2026-10.md).
