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
- **Mod feed bandwidth:** mod-console snapshots are coalesced to ≤ 2/s
  (`MOD_SNAPSHOT_MS`; a burst of steps → one trailing `ModView`, built
  once and shared by every director). House tools stream
  `/events?role=mod&lean=1`: every `sim` / `message` / `lifecycle` frame,
  never a `snapshot` or `history` (stagehand uses it).
- **Process load:** `GET /api/mod/metrics` (moderators) returns the
  server process's cumulative CPU µs, memory, `loadavg` / `cpus`, the
  event-loop delay since the previous read, and the stream-client count
  (`server/routes/metrics.ts`) — the K-32 load test
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
wifi blip is handled client-side (the SSE stream auto-reconnects and the
next snapshot rehydrates the UI). `mod load` / `mod reset` start a fresh
timeline (clear the journal + chat + moderation).

Environment: `LOOM_PORT` (7000), `LOOM_HOST` (0.0.0.0), `LOOM_EVENT_PASS`,
`LOOM_PRIME_PASS`, `LOOM_MOD_PASS` (any unset code is auto-generated),
`LOOM_STATE_DIR`, `LOOM_APP_DIST`, `LOOM_TERMINAL_DIST`,
`LOOM_REINSTALL_DIST`, `LOOM_HOUSE`, `LOOM_TTS_*` (the speech proxy;
`LOOM_TTS_URL` blank / `off` / `none` = no server voice — compose defaults
it to its bundled `kokoro` service), `LOOM_VAPID_PUBLIC_KEY` /
`LOOM_VAPID_PRIVATE_KEY` / `LOOM_VAPID_SUBJECT` (Web Push, below), plus the control-plane / hardening vars
(`DATABASE_URL`, `BETTER_AUTH_SECRET`, `LOOM_BASE_URL`,
`LOOM_TRUSTED_ORIGINS`, `LOOM_TRUST_PROXY`), and the throttles
`LOOM_RL_RESOLVE` (30/60), `LOOM_RL_REGISTER` (20/60),
`LOOM_RL_LOGIN_FAILURES` (10/300) — per IP — and `LOOM_RL_REDEEM_MISSES`
(8/60, per guest: past it `/api/guest/codex/redeem` answers 429 and journals
nothing) and `LOOM_RL_WIDGETS` (20/60, per guest: widget answers on
`/api/guest/widget`), each `<max>` or `<max>/<seconds>` (`server/rate-limit.ts`). **For a full production
deployment + the security model, see
[`docs/loom-deployment.md`](../docs/loom-deployment.md).**

For the participant app's dev/build flow (HMR), see [`../play`](../play).

### Web Push (K-31a — Android + booths)

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
re-join); go-live and releasing a part (N-10) unbind booths. Nothing
pushes during journal replay. The play app's `/sw.js` +
`/manifest.webmanifest` are served `Cache-Control: no-cache` under
`PLAY_CSP` (`worker-src 'self'`). Tested in `test/push.test.ts`.

### Show-night routes + rules (OCT31 wave 1)

- **Print sheet** (K-12, `server/routes/k12.ts`): `/api/mod/codes` also
  returns `joinLink` (`<join base>/?code=<event>`) and `checkin[]` — one
  sign per LOCATION a guest can check into (`{id, label, slug, url,
  hidden}`; never a prison, a cutscene or a `checkin: false` room). The
  editor draws the QRs itself (`/api/qr` is 60/min).
- **Recap** (K-26, `server/recap.ts` + `routes/recap.ts`): `GET
  /api/mod/recap` (directors) → `totals`, ranked `lists` (`trust` /
  `truths` / `lies` / `internetVisits` / `codex` / `quests` /
  `truthcoin`; ties share a rank, personas flagged), `factions`, `ending`
  and a paste-ready `text`;
  `?format=text` returns only the text.
- **Cue sheet** (K-21): `ModView.cues` = `cueState(sim)` (`views.ts`) —
  which `who: admin` INTERACTIONs fired and the last in-sequence one, read
  off the sim log so every director agrees after a reload. An INTERACTION
  with `sequence: false` (machine-fired: the duck game, the door reed) is
  ticked but never "last"; `InteractionSummary.subject` marks a cue whose
  every listener binds a person (the ceremony's awards).
- **Agents.** With no worker online for 20 s, the hub posts the
  character's authored `hold:` line (`CHARACTER … hold: "…"`) into the
  thread once, as a journaled `say`, and keeps the request queued for a
  worker that comes back (N-11). A director answering a thread as the
  character settles its open request (`AgentHub.answeredByHand` — dropped,
  or cancelled on its worker), so nobody answers twice. A power the story
  answers with words only (a refusal) does not count against its `limit`.
- **Place arguments** (`server/place-args.ts`): a `room` / `at` /
  `location` / `place` argument on `/api/mod/signal` or an agent's act is
  folded onto the exact LOCATION name (or `label:`) before it is
  journaled, so `"the cache"` matches `room == "The Cache"` and
  stagehand's rules.
- **Story surface:** `broadcast "…" to channel(hosts)` posts into authored
  rooms (a staff back room) and never the lobby; `show <kind> … with
  thread: <Character>` pins a card to that character's DM; `show fact`
  is the 📝 *File a fact* card (`{question, answer, certain}` →
  `fact answered`, K-24).

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
- **The map** belongs to the project (`server/house-maps.ts`, SW-MAP-01):
  `house.json` + any `house.<variant>.json` are project files (not story —
  `projectSource` concatenates `.loom` only), snapshotted at launch like
  `scenario_source` (`event.house_maps` + `spatial-maps.json` in the state
  dir with the active variant), refreshed by a reload, fresh on End →
  relaunch. The event's map is the director's save for this event
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
  `house` / `duck` / `reset`. A restart ends every session (`reset`).
- **Routes**: `GET /api/spatial/{house,stream}`, `POST
  /api/spatial/{pose,found,end}` (session token; bodies capped at 2 KB
  before the generic parse), `GET /api/mod/spatial/{station,stations,candidates}`,
  `POST /api/mod/spatial/{house,begin,end}` — on `/e/:eventId/…` and the
  bare default event. Tests: `test/spatial.test.ts` (hub + runtime) and
  `test/spatial-routing.test.ts` (`routing.ts`).

**The wall terminals' screen state** (OCT31 K-16, `server/routes/screen.ts`):
`GET /e/:id/api/screen/state?name=&spot=&view=&character=` (mod token or
the author's session) answers ~0.5 KB — `night` (`Night.screen` /
`Night.terminals`), `cues` (the last `cue screens_*` / `terminals_*` /
`tv_*` / `tablet_*` value per family + a `seq`, folded from the sim log so
a restart replays to the same answer), `character` (hidden = not
`reveal`ed to everyone, `awake`, agent `online`), `attract` (hidden or
asleep), `countdown` / `remaining` (story seconds on the running
`Night.*_end` timer) and `terminals` (each terminal's last poll, newest
first). Terminals poll it every 2 s instead of the mod feed. Alongside, the
`AgentHub` `admits` hook refuses a guest's DM with a character still hidden
from that guest (no worker request, so no premature hold line); performers'
`cast:` threads always pass. Tests: `test/screen-state.test.ts`.

It also carries the poller's **screen program** (OCT31 K-17 + N-03):
`target` (`tv` for `view=mirror|tv`, else `terminals`; `screens_*` reach
both, `tv_*` / `terminals_*` one, `tablet_*` neither) and `program` —
`slide` (the newest slide or base cue: `screensaver` / `attract` /
`trabolta_online` / `mirror` clear it; `persist` for `bingo` / `y2k` /
`trust_chart` / `truth_txt` / `award_*` / `ceremony*`), `overlay`
(`blackout` / `go_to_living_room` / `alarm`, until the next slide or base
cue), `blackout` and `flicker` (one-shots). `countdown_*` cues never
replace the slide. Each is `{value, cue, seq, at}`, `at` = server epoch ms
when the fold first saw it — 0 for history replayed at a boot/restart, so
nothing held re-runs. The terminal applies the holds and precedence
(`terminal/src/slides.ts`).

**The TV room voice** (OCT31 K-18 + N-04b): a poll that adds
`&voice=<LOCATION>&after=<seq>` (the TV, `view=tv`) gets a `voice` block —
`room` (`loc:<Id>`, "" for an unknown location), `muted`, `head` (the
newest chat seq) and `lines`: every *character's* `line` in that room
after `after` (narration, typed guest chat and hidden messages left out),
`{seq, from, text, beat}`, the newest `MAX_VOICE_LINES` (40). `beat` is
the scripted beat, or null for a director's `say` as the character. No
`after` = no lines (a booting TV starts at `head`); the TV decides what to
speak (`terminal/src/tv.ts`). `POST /e/:id/api/mod/screen/voice {muted}`
(mod token or author session) sets the TV-voice mute every TV reads off
its next poll — runtime state, a server restart unmutes; a body without
`muted` reads it. `GET /e/:id/api/mod/screen/terminals` (K-29, mod token
or author session) is the director's heartbeat list: `{now, terminals:
[{name, spot, view, character, at, ago}], voiceMuted, silentMs}` —
`TERMINAL_SILENT_MS` = 20 s — and reading it never records a poll.

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
- **Room check-in by QR** (K-13, `server/routes/k13.ts`): `POST
  /e/:id/api/guest/checkin {at}` folds a sign's slug (`the-cache`) onto
  the exact LOCATION and journals `signal("checked_in", guest, {at})` —
  the story's `when checked_in for program:` rule does the move. Refused
  (nothing journaled) when the guest is captured, stands in a prison /
  sealed room, is on rails (a cutscene room, or `uploaded && !cleared`),
  or the room is a prison / cutscene / hidden from them; 429 inside a
  20 s per-guest cooldown. → `{ok, at, channel: "loc:<at>", moved}`.
- **Lost phones** (N-02 / N-10, `server/routes/n02.ts`): `POST
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
own mod code (guests re-join); `pnpm dev --sync …` does it on boot. The
example's house maps (`house.json`, `house.<variant>.json`) go with it,
but the **project's copy wins**: an example map is only added when the
project lacks that file, and a project map that differs (one saved from
the map page, say) is kept, with both versions summarised.
`--replace-maps` overwrites them with the example's (copying the old ones
to a temp directory first); `--keep-maps` touches no map. A map that
doesn't validate stops the sync before anything is written, and `PUT
/files` / `/api/mod/load {maps}` refuse one with 400 + `problems`.

## Status

The parser is a complete, test-verified 1:1 port of the Rust parser. The
runtime is the first-principles **ecosystem sim** (the playhead/coroutine
1:1 port is deferred in favour of it). `@loom/core/lsp` ships the full
language surface — a `Workspace` with completion / hover / definition /
documentSymbols / references / diagnostics plus the project-wide story
graph — consumed in-process by the editor.
