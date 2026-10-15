# @loom/core

Native **TypeScript** port of the Loom engine — **no WASM, no Prism**.
It is the foundation the participant app ([`loom-play`](../play)) runs on,
and the [`editor`](../editor) consumes it directly as TypeScript (parser,
LSP, and the in-browser `Sim` behind Run mode — the old wasm bundle is
gone).

Loom is a language for **social-ecosystem simulation** — LARPs,
interactive installations, multiplayer games. A `.loom` file looks like
a screenplay (ALL-CAPS speaker cues, indented dialogue) but underneath it
is a reactive program: factions, locations, characters with per-person
relationships, hooks that fire on real-world events, and an autonomous
clock.

## What's here

```
src/
  parser/        # full TS port of the Rust parser — lexer, AST, decl
                 #   bodies, diagnostics, keyword table (see ./parser)
  runtime/
    expr.ts      # the World scope + Value engine + expression parser
    ledger.ts    # the narrative event ledger
    bundle.ts    # compiled project + ITEM/FACTION/CHARACTER `is` merges
    sim/         # the social-ecosystem runtime (see sim/DESIGN.md)
server/
  server.ts      # the LAN event server (SSE + REST, hosts one live Sim)
  views.ts       # pure per-role projections (guest / mod / performer)
  chat.ts        # server-authoritative chat: SimEvent → channel messages,
                 #   the append-only ChatStore, history + moderation
  store.ts       # durable event-sourced journal + persisted moderation
  spatial.ts     # the reinstallation games' SpatialHub (sessions, stations,
                 #   poses, the found check) — never journaled but the outcome
  routing.ts     # pure routing decisions (CSPs, sub-app paths, mod reads)
examples/
  load.ts                    # multi-file project loader (main.loom first)
  trapped-in-the-internet/   # THE SHOW — the server's default scenario (Loom 4 surface):
                             #   a rogue AI, a house that is a computer, Computer Bingo,
                             #   two Truth Scavenger Hunts + Moments of Truth, Truth Pong,
                             #   the Trust Chart, reinstallation in "the Internet", nine
                             #   featured programs + a pool, a CODEX economy (132
                             #   entries, 41 codes: wall QRs, files, puzzles, performers),
                             #   16 quests, an LLM-voiced Trabolta (offline until Clippy
                             #   introduces him), two factions racing for a majority,
                             #   the server-room patch bay, and seven endings. Runbook +
                             #   integration contract (VR / Z2M + WLED / mind): its README
  glass-orchard/             # the Loom 4 reference project (a garden-party mystery)
  escape-the-internet/       # the v3-era scenario, authored across ~18 files
    main.loom                #   world spine: factions, locations, ROLE Guest
    cast/                    #   actors + scannable props, grouped by faction
                             #     (mods / chatters / algorithm / glitchers /
                             #      neutral) — named performers and installation
                             #      props (the Captcha, the Cookie Banner, the
                             #      Recycle Bin, the Firewall…) all CHARACTERs
    beats/                   #   scripted interactions by zone: arrival, feed,
                             #     social, traps, tools, prison, news, … each a
                             #     scan → divert target
    atmosphere.loom          #   ambient generators (the autonomous clock)
test/            # vitest suites, ported 1:1 from the Rust #[cfg(test)]
```

The minimal runtime (`runtime/sim`) is **World state (dotted paths) + an
event ledger + a reactive hook engine drained to a fixpoint + a directive
effect vocabulary + an external input API + an autonomous clock**. Hooks
and beats share one executor. Full design + the "Escape the Internet"
walkthrough: [`src/runtime/sim/DESIGN.md`](./src/runtime/sim/DESIGN.md).

## Install

These packages share one install — run it once from the repo root:

```bash
pnpm install
```

## Commands

Run from `core/` (or `pnpm --filter @loom/core <script>` from
the repo root):

| Command          | What it does                                            |
|------------------|---------------------------------------------------------|
| `pnpm test`      | vitest — the full suite (parser + runtime/sim + views)  |
| `pnpm typecheck` | `tsc --noEmit`                                           |
| `pnpm serve`     | boot the **event server** (tsx) — see below             |

## The event server

`pnpm serve` hosts a single live `Sim` and serves the participant app to
clients on the local network. Transport is Server-Sent Events (push) +
`fetch` POST (actions) — no WebSocket dependency, so it works on any
phone browser on the wifi. Moderation happens in the editor's Run mode
over the `/api/mod/*` routes.

```
http://<lan-ip>:7000           → the participant app (built loom-play)
```

- **Mods** open/close the doors (`idle → open → paused`); guest and
  performer actions return `409` while not "open". While open the server
  ticks the sim once a second so ambient generators + time-driven hooks
  advance.
- `/` serves the built `../play/dist` (build it first with
  `pnpm --filter loom-play build`). Override the dist path with
  `LOOM_APP_DIST`.

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

### Capabilities & scanning

A login token carries **composable capabilities** (`server/session.ts`),
not a single fixed role:

- a **performer** holds a `character` — the identity they scan as;
- an **admin** holds the moderator capability (open doors, moderate);
- entering the moderator passcode while already signed in **upgrades the
  same token** — so *a performer can also be an admin*;
- a `{ character: null, admin: true }` token is a **headless admin**: an
  operator with a scanner but no character/booth.

Scanning is one capability-dispatched endpoint, **`POST /api/scan`**: a
`character` cap runs that character's story scan (`on scan` hooks + the
`respond` that streams back); an `admin` cap gets the guest identified for
moderation. An admin may also pass **`as: <character>`** to scan *as* any
character (firing that character's story beat) — the editor's Run cockpit
exposes a "scan as…" control whose default, **Silent**, is moderation-only.
Admins then act via **`POST /api/mod/act`** (`capture` / `release`) and
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
- On SSE connect a guest receives a **`history`** event (every thread
  addressed to them, since the event began) then live **`message`** events
  — so a **re-login replays the whole conversation**, never a blank feed.
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
wifi blip is handled client-side (the SSE stream auto-reconnects and the
next snapshot rehydrates the UI). `mod load` / `mod reset` start a fresh
timeline (clear the journal + chat + moderation).

Environment: `LOOM_PORT` (7000), `LOOM_HOST` (0.0.0.0), `LOOM_EVENT_PASS`,
`LOOM_PRIME_PASS`, `LOOM_MOD_PASS` (any unset code is auto-generated),
`LOOM_STATE_DIR`, `LOOM_APP_DIST`, `LOOM_TERMINAL_DIST`,
`LOOM_REINSTALL_DIST`, `LOOM_HOUSE`, plus the control-plane / hardening vars
(`DATABASE_URL`, `BETTER_AUTH_SECRET`, `LOOM_BASE_URL`,
`LOOM_TRUSTED_ORIGINS`, `LOOM_TRUST_PROXY`), and the throttles
`LOOM_RL_RESOLVE` (30/60), `LOOM_RL_REGISTER` (20/60),
`LOOM_RL_LOGIN_FAILURES` (10/300) — per IP — and `LOOM_RL_REDEEM_MISSES`
(8/60, per guest: past it `/api/guest/codex/redeem` answers 429 and journals
nothing), each `<max>` or `<max>/<seconds>` (`server/rate-limit.ts`). **For a full production
deployment + the security model, see
[`docs/loom-deployment.md`](../docs/loom-deployment.md).**

For the participant app's dev/build flow (HMR), see [`../play`](../play).

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
  version and source, `event` | `show`), **sessions** (`begin` mints a
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
- **The map** is the director's save for this event
  (`spatial-house.json` in its state dir, `Store.loadHouse/saveHouse`)
  else the show's file (`LOOM_HOUSE`, default the example's `house.json`,
  re-read on mtime change, last good map kept). `POST
  /api/mod/spatial/house {house, base?}` validates, refuses a stale `base`
  (409), saves, and `setHouse` carries live sessions over: a duck keeps
  its spot id (or is re-dealt), then the stream gets `house` + a `duck`
  frame per moved duck.
- **The stream** (`GET /api/spatial/stream`, SSE, its own subscriber set —
  never `clients`): `hello` / `join` / `poses` / `found` / `leave` /
  `house` / `duck` / `reset`. A restart ends every session (`reset`).
- **Routes**: `GET /api/spatial/{house,stream}`, `POST
  /api/spatial/{pose,found,end}` (session token; bodies capped at 2 KB
  before the generic parse), `GET /api/mod/spatial/{station,stations,candidates}`,
  `POST /api/mod/spatial/{house,begin,end}` — on `/e/:eventId/…` and the
  bare default event. Tests: `test/spatial.test.ts` (hub + runtime) and
  `test/spatial-routing.test.ts` (`routing.ts`).

## Running a live event

```bash
# everything at once, from the repo root (see scripts/dev.mjs):
pnpm dev                           # build play + terminal, serve (:7000), editor (:5173)
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
  antivirus directory pick (403). Profile pictures (`server/avatars.ts`):
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
own mod code (guests re-join); `pnpm dev --sync …` does it on boot.

## Status

The parser is a complete, test-verified 1:1 port of the Rust parser. The
runtime is the first-principles **ecosystem sim** (the playhead/coroutine
1:1 port is deferred in favour of it). `@loom/core/lsp` ships the full
language surface — a `Workspace` with completion / hover / definition /
documentSymbols / references / diagnostics plus the project-wide story
graph — consumed in-process by the editor.
