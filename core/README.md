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
  facts.ts       # the facts judge: a FactsBook off the project's facts.json,
                 #   Night.judge_mode auto | review, the director's ledger
  wallet.ts      # the WalletBook — a `currency:` story's transfers, requests,
                 #   escrowed codex offers, the approver's queue, the stimulus
examples/
  load.ts                    # multi-file project loader (main.loom first)
  trapped-in-the-internet/   # THE SHOW — the server's default scenario (Loom 4 surface):
                             #   a rogue AI, a house that is a computer, Computer Bingo,
                             #   two Truth Scavenger Hunts + Moments of Truth (judged
                             #   from the team's facts.json, then the bottle), Truth Pong,
                             #   the Trust Chart, reinstallation in "the Internet", nine
                             #   featured programs + a pool, a CODEX economy (177
                             #   entries, 90 codes: wall QRs, files, puzzles, performers),
                             #   23 quests, a Truthcoin wallet, an LLM-voiced Trabolta
                             #   (offline until Clippy introduces him), two factions
                             #   racing for a majority, the server-room patch bay (and
                             #   the King guarding it), and eight endings. facts.json +
                             #   `pnpm titi:facts` → generated/ + codex/9-facts.loom.
                             #   Runbook + integration contract (VR / Z2M + WLED / mind):
                             #   its README
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
| `pnpm titi:facts [--check]` | regenerate the show's files from its `facts.json` (`scripts/titi-facts.ts`); `--check` writes nothing, exits 1 when stale |

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
  operator with a scanner but no character/booth;
- a **host** (wave 13) holds the host capability: signing in as a part
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
  console is ≈ 6 Mbit/s at 45 guests (the whole world every snapshot).
- **Stalled streams:** every SSE write goes through `sseWrite`; a client
  over its cap (256 KB, 2 MB for a full mod stream) with no byte sent out
  for 15 s (a phone suspended with its socket up, a laptop asleep on the
  Run page) is dropped, and its EventSource reconnects to a fresh snapshot
  + history. A slow link that is still draining is never dropped.
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

Environment: `LOOM_PORT` (7000), `LOOM_HOST` (0.0.0.0), `LOOM_EVENT_PASS`,
`LOOM_PRIME_PASS`, `LOOM_MOD_PASS` (any unset code is auto-generated),
`LOOM_STATE_DIR`, `LOOM_APP_DIST`, `LOOM_TERMINAL_DIST`,
`LOOM_REINSTALL_DIST`, `LOOM_HOUSE`, `LOOM_FACTS` (the facts judge's key
for an event with no project `facts.json`; default `facts.json` beside the
house map), `LOOM_AUDIO` / `LOOM_LIGHTS` (the house speakers' `audio.json`
and, since wave 20, the house lights' `lights.json` for an event with no
project copy and no director's save; no default file; re-read on mtime),
`LOOM_AGENT_DOSSIER` (wave 20: `off` drops the guest's dossier from an
agent request at the server-room terminal), `LOOM_TTS_*` (the opt-in speech
proxy; `LOOM_TTS_URL` unset / blank / `off` / `none` / `false` / `0` = no
server voice, the default — the terminals use the devices' own voices;
compose's `kokoro` is behind `--profile tts`), `LOOM_VAPID_PUBLIC_KEY` /
`LOOM_VAPID_PRIVATE_KEY` / `LOOM_VAPID_SUBJECT` (Web Push, below), plus the control-plane / hardening vars
(`DATABASE_URL`, `BETTER_AUTH_SECRET`, `LOOM_BASE_URL`,
`LOOM_TRUSTED_ORIGINS`, `LOOM_TRUST_PROXY`, `LOOM_DB_WAIT` — with
`DATABASE_URL` set the boot retries the database forever, 1 s doubling to
15 s; `off` / `0` probes once, which a scratch server pointed at a dead
database needs), and the throttles
`LOOM_RL_RESOLVE` (30/60), `LOOM_RL_REGISTER` (20/60),
`LOOM_RL_LOGIN_FAILURES` (10/300) — per IP — and `LOOM_RL_REDEEM_MISSES`
(8/60, per guest: past it `/api/guest/codex/redeem` answers 429 and journals
nothing), `LOOM_RL_WIDGETS` (20/60, per guest: widget answers on
`/api/guest/widget`) and `LOOM_RL_WALLET` (30/60, per guest: every
`/api/guest/wallet/*` call) and `LOOM_RL_QR` (60/60 per IP on `/api/qr`), each `<max>` or `<max>/<seconds>` (`server/rate-limit.ts`). A locked-out IP still
lets the right guest event code through (`LOOM_RL_LOGIN_FAILURES` guards
the performer and mod codes and wrong guesses). **For a full production
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
`Night.*_end` timer), `terminals` (each terminal's last poll, newest
first) and `announce` (OCT31 N-09: the latest `do announce "…"`, `{seq,
text, at}` — `at` 0 for replayed history — or null; a terminal set to
`announce` chimes and says a new one, `terminal/src/announce.ts`).
Terminals poll it every 2 s instead of the mod feed. Alongside, the
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
its next poll — kept in the event's state dir (`screen-voice.json`), so a
server restart, a redeploy or Go live in place leaves it as it was (the
boot log says 🔇 when the TV starts muted); a body without `muted` reads
it. A poll's `room=` resolves against the story's declared LOCATIONs
before the doors too, so `{id: ""}` means a typo. `GET /e/:id/api/mod/screen/terminals` (K-29, mod token
or author session) is the director's heartbeat list: `{now, terminals:
[{name, spot, view, character, room?, at, ago}], voiceMuted, silentMs}` —
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
  antivirus directory pick (403); `prime/login` checks the part against
  the story's compiled model before the doors too (a story that won't
  compile answers 409). A booth's `/api/prime/say` posts only where its UI
  has a composer — its `guest:` threads, its `cast:` thread, the lobby and
  the rooms (locations + authored rooms); a pinned room, a raw `dm:` /
  `pm:` answers 403, an unknown room 404. `/api/prime/codex/share` answers
  403 when an agent refuses the lore (as the guest route does), `shared:
  false` when the recipient already held it. A restricted guest's
  `/api/guest/join` and `/api/guest/defect` answer 403. Profile pictures (`server/avatars.ts`):
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
  /e/:id/api/guest/checkin {at}` folds a sign's slug (`the-start-bar`) onto
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
own mod code (guests re-join); `pnpm dev --sync …` does it on boot. On a
**live** event with a real guest it writes the files and stops there
(exit 3, wave 9's guard above). The
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

## Status

The parser is a complete, test-verified 1:1 port of the Rust parser. The
runtime is the first-principles **ecosystem sim** (the playhead/coroutine
1:1 port is deferred in favour of it). `@loom/core/lsp` ships the full
language surface — a `Workspace` with completion / hover / definition /
documentSymbols / references / diagnostics plus the project-wide story
graph — consumed in-process by the editor.
