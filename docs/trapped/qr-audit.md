> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.

# QR codes, check-in, printables, and the floor plan editor: an audit

Scope: every QR flow in `packages/loom` as of 2026-10-14 (commit `6884a96`), checked against the four new requirements:

1. Clues are QR codes that fill the Codex.
2. Each LOCATION has a check-in QR that signs you into its chat room. This is also physical presence, as in "who is in the living room by the 5-minute deadline".
3. QRs can be **pre-baked**: printed ahead of the party and tied to guests, performers, clues, locations and devices.
4. A **floor plan editor** for a replica of the real house, used by the VR game, the web game and the terminals' world view.

All paths below are relative to `packages/loom/`. Every finding comes from reading the code. None of it was exercised against a live server for this audit.

---

## 0. Verdict at a glance

| # | Requirement | Status | One-line reason |
|---|---|---|---|
| 1 | Clue QRs fill the Codex | **PARTIAL** | The scan → redeem path works end to end (`?code=<event>&unlock=<code>` → auto-redeem → Codex opens). Gaps: no UI ever lists or prints the clue URLs (`/api/mod/codes` has no client). The URLs carry the guessable *typed* code plus the event code. Redeem has no rate limit. The base URL is wrong in Docker (§2.1). |
| 2 | Location check-in QRs | **MISSING** | Location is already the gate for posting in a `loc:` room (`sim.ts:1006-1008`), and `arrive` is a journaled mutation. But a guest has **no route to move themselves**. Only the story (`move`), a director (`/api/mod/set field=location`) or stagehand MQTT can. There is no check-in URL, cooldown, guard or roll-call / deadline construct. |
| 3 | Pre-baked printable QRs | **MISSING** | The Run page shows one on-screen join QR (`RunPage.tsx:251`). There is no print view, and nothing that is safe to pre-print. Guest passes are bare ids minted at registration and die on every restart. Performer cards would expose the shared performer code. Device QRs embed the **mod passcode**. Codes die when an event is ended and relaunched. |
| 4 | Floor plan editor | **PARTIAL** | `/reinstall/map` already edits the shared `house.json` with validation and conflict-safe saves. It can move/resize rectangular rooms, place terminals, duck spots and spawn, and edit raw JSON. It **cannot create** rooms, floors, doors, stairs or props, has no underlay/scale calibration for tracing a real plan, and no 3D preview. The saved map lives per *event* (lost on relaunch) and outside the project. |

---

## 1. Inventory: every QR in the system today

| QR | Encodes | Rendered by | Read by | What possessing it grants |
|---|---|---|---|---|
| **Join QR** | `${joinBase}/?code=<EVENT>` (`events-api.ts:54`; same shape for the default event) | Editor Run → Join card via server `/api/qr` (`RunPage.tsx:251`) | Phone native camera → play app. `codeFromUrl()` (`play/src/session.ts:125`) pre-fills the guest/performer code box. | Guest registration for that event. The event code is a 6-char speakable code (`auth.ts:27-41`). |
| **Codex clue QR** | `${joinBase}/?code=<EVENT>&unlock=<CODE>` (`event-runtime.ts:2645-2665`) | **Nothing.** Only `POST /api/mod/codes` returns it. Repo-wide grep: its only caller is `core/test/codex.test.ts:413`. The runbook says to print `url` by hand (`core/examples/trapped-in-the-internet/README.md:128`). | Native camera → play app. `unlockFromSearch` (`play/src/codex.ts:24`) → `pendingUnlock` redeems once signed in, strips `unlock` from the URL, and opens the Codex (`session.ts:582-596`, `646-651`). Terminals recognise it and say "that's a wall code" (`terminal/src/scan.ts:20-23`). | The **event code** (so a clue poster doubles as an invitation) plus the codex code. |
| **Guest pass** | Bare guest id `g-xxxxxx`, 24 random bits (`event-runtime.ts:2034`; personas `p-…`) | Play app via `/api/qr?text=<id>`: profile sheet (`guest.tsx:287`), on-rails pass (`guest.tsx:324`), `show pass` widget (`widgets.tsx:267`) | Performer Scanner, `BarcodeDetector` only, no jsQR fallback (`play/src/performer.tsx:138-191`) → `POST /api/scan`. Editor guest lookup, `BarcodeDetector` only (`RunPage.tsx:60-130`). Terminal + reinstall tablet: `BarcodeDetector` → jsQR fallback (`terminal/src/scanner.tsx:12,30-35,137`, reused by `reinstall/web/src/app.tsx:13-14`); `parseScan` regex `^[gp]-[0-9a-f]{6}$` (`terminal/src/scan.ts:13-30`). | On its own, nothing: `/api/scan` needs a performer or mod token. But any mod-token device (a terminal) will **pilot** whoever's id it reads (`/api/mod/impersonate`). |
| **Terminal provisioning link** | `/terminal/?code=<MOD PASSCODE>&name=&character=&spot=&view=` (`terminal/src/config.ts:1-10`, `hintsFromSearch` `:94-118`). The map editor's `provisionLink` builds the same link *without* the code (`reinstall/web/src/map/edit.ts:240-243`). | Typed or opened by hand. Nothing renders it as a QR. | Terminal: resolve-code → `/api/mod/login` → stores a **full moderator token**. The URL is then scrubbed. | Full moderation of the event. |
| **Reinstall device link** | `/reinstall/?code=<MOD PASSCODE>&name=&role=` (`reinstall/web/src/config.ts:5`, `app.tsx:46-48`) | Same as above | Same as above | Same as above, plus house-map writes. |
| Generic `/api/qr` | Any text ≤ 300 chars → SVG (`server.ts:403-411`) | Server-side `qrcode` npm (`core/package.json:37`) | — | Rate-limited **60 per minute per IP** (`server.ts:274`). |

**Can guests scan inside the play app?** No. The play app has no camera scanner for guests. Clue and join QRs depend on the phone's native camera opening a URL in the default browser. The performer booth has a `BarcodeDetector`-only scanner, which fails on iOS Safari, where `BarcodeDetector` is missing. The terminal's jsQR fallback is not shared with the play app.

**The play root ignores what a scanned code is for.** `App` always shows "Guest or Performer?" (`play/src/ui.tsx:17-40`), even when `?code=` has already resolved to a role.

---

## 2. Cross-cutting findings: bugs and hazards found along the way

### 2.1 Printed URLs would use the container's LAN IP in Docker (a bug; the docs disagree with the code)
`joinBase()` is the first non-localhost **network interface** address: `http://<ipv4>:7000` (`server.ts:142-150`, `lanUrls` `:495-504`). It is used for `joinUrl` (`events-api.ts:54`) and for codex URLs (`event-runtime.ts:2649`). `LOOM_BASE_URL` (`config.ts:19`) is **not** consulted. In the Compose deployment the `loom` service runs on the default bridge network (`docker-compose.yml:29-75`), so links come out as `http://172.x.y.z:7000/?code=…`. That address is unreachable from a phone, is plain http (so no camera inside the app), and bypasses Caddy. `docs/loom-docker-deploy.md:474-476` says the Run page QR "encode[s] the public URL automatically", which the code does not do.
**Fix (needed before anything is printed):** `joinBase = LOOM_PUBLIC_URL ?? LOOM_BASE_URL ?? LAN guess`. For the deployment that is `https://app.mapsandducks.com`. Printed links must never contain an IP or a port.

### 2.2 Codes are per *event*, and a relaunch rotates them
- New launch: `freshCodes()` mints three random codes (`events-api.ts:86-88,148-166`).
- **Go live keeps id, codes and QR** (`events-api.ts:209-226`, "posters printed during the rehearsal keep working"). **Reload and restart keep codes** (`:228-246`, `event-runtime.ts:1422`).
- **End → relaunch = all new codes.** Every printed join or clue QR dies. Nothing expires automatically (no expiry logic in registry, events-api or server).
- The default (DB-less) event takes its codes from env, then `codes.json`, then fresh (`auth.ts:62-72`), so it can be pinned with `LOOM_EVENT_PASS`. The SaaS path has no equivalent.

So printing during a rehearsal is safe *only if nobody ever presses End*. That is fragile for posters printed a week ahead.

### 2.3 Guest identities do not survive a restart, so a pass printed with a guest id is useless
Every `restart()` (reset, reload, go-live) calls `guestTokens.clear()` (`event-runtime.ts:1437`). The persons die with the journal, guests re-register, and they get **new** `g-` ids (`:2034`). A badge printed with today's id stops matching after the next restart.

### 2.4 Codex codes are guessable and redeem has no rate limit
- The show's codes are words: `GERALD`, `EARN-IT`, `MAPSANDDUCKS-COM` (`codex/world.loom:6,17`, `codex/trabolta.loom:39`).
- `/api/guest/codex/redeem` has no throttle (`event-runtime.ts:2240-2258`). `Sim.redeem` journals **every miss** as `codexMissed` and fires `wrong code` (`sim.ts:395-408`). Brute force, or a misbehaving script, bloats the journal and spams story hooks.
- The printed URL contains that same typed code. One photo or text of a poster gives the entry to everyone and bypasses the share economy.

### 2.5 The `/api/qr` rate limit breaks a print sheet
60 renders per minute per IP (`server.ts:274`). A Run → Print sheet with ~80 QRs (40 badges + 15 clues + 9 rooms + 20 cast) loaded from one browser will return 429s. Render printables **client-side** instead. The `qrcode` package runs in the browser; add it to `editor`.

### 2.6 The mod passcode is the only device credential
Terminal and reinstall provisioning trade the **mod passcode** for an unscoped admin session (`event-runtime.ts:2491-2505` grants `{admin: true}`). That token survives restarts, by design, so wall tablets keep working. But a stolen tablet, or a photographed provisioning QR, gives full moderator control: say-as-anyone, set, reveal, end-adjacent actions. `/api/mod/login` even returns all three codes (`:2509-2511`).

### 2.7 Captured guests could escape through a check-in
Any future self-check-in must refuse when the guest `isCaptured`, or stands in a `sealed`/`prison` location (`The Internet`, `main.loom:79-84`), or is on rails (`uploaded && !cleared`, or in a cutscene, `sim.ts:725-728`). Otherwise a room QR is a jailbreak.

### 2.8 The house map is per event and per server, not per project
`spatial-house.json` lives in the **event's** state dir (`store.ts:79-81,198-199`). The fallback is a process-global file, `LOOM_HOUSE` or else the example's `house.json` (`event-runtime.ts:162-164,343`). A director's carefully built replica disappears on End → relaunch. It is not in the project, so co-writers cannot see it in the editor and it is not versioned with the story.

---

## 3. Requirement 1: clue QRs fill the Codex — PARTIAL

### What works today
- Authoring: `CODEX name` with `code:` (`core/examples/trapped-in-the-internet/codex/*.loom`). `model.codexCodes` folds case.
- Scan: native camera → `/?code=<EVENT>&unlock=<CODE>` → the play app redeems once `me` and `status` exist, strips the param, and opens the pinned **Codex** room (`session.ts:582-596,646-651`). A signed-out scanner registers first (the code box is pre-filled from `?code=`), then redeems. That ordering works because `pendingUnlock` is read on mount and fires once `me` is set.
- Story hooks: `when program learns X:` and the named event `wrong code`. Mirrors `who.codex`, `who.codex.<slug>` (CLAUDE.md "codex economy").

### Gaps
1. **There is no producer of printable clue QRs** (§1). `/api/mod/codes` is orphaned.
2. **The URL leaks the event code and the typed answer** (§2.4). Typed puzzle answers and found posters share one secret.
3. **The browser context can differ.** The phone camera opens the URL in the OS default browser. A guest who joined in a different browser, an in-app browser, or a Chrome profile or Samsung Internet different from the one holding `loom.guest` lands on registration again. The redeem also posts to the *stored* session's event (`session.ts:457`) and ignores the URL's `?code=`. After a relaunch, a stale `loom.guest` for the old event fails silently.
4. **There is no in-app scanner**, so guests cannot scan without leaving the app. Clue QRs that are not URLs (a bare code) cannot be scanned at all.
5. No per-guest throttle on misses (§2.4).

### Design
- **Separate the printed token from the typed code.** Each CODEX entry gets an opaque **print token**, minted server-side per project (§5), alongside its optional speakable `code:`. Puzzles keep typed answers. Posters carry `https://app.mapsandducks.com/q/<token>`, which reveals neither the event code nor the answer.
  - Server: `POST /e/:id/api/guest/codex/scan {token}` → journaled `unlock` with `via: "scan"`. Add a new `via` so the story can tell "found it" from "was told the code".
- **Optional place gate.** A new entry field `found at: The Cache` makes a scan count only when the guest is checked in there (§4). A photo texted to a friend in another room then does nothing, which keeps the share economy honest.
- **Throttle redeem**, for example 8 misses per minute per guest. Above that, answer 429 and stop journaling misses.
- **In-app scanner** for guests: a 📷 in the Codex composer and the header. Reuse `terminal/src/scanner.tsx`, which is already a reusable component that `reinstall/web` imports; it has jsQR and works on iOS. It handles `/q/` URLs *without navigating*, so the session never changes browser. This needs HTTPS for the camera, which the Caddy deployment has.
- **Fix the base URL** (§2.1).
- **Poster content:** title or hint (from the entry's `title` and an optional new `hint:` field), a large QR (EC level Q, ≥ 4 cm), and the speakable fallback code. The fallback is the *print token in speakable form*, not the puzzle answer, so a guest whose camera fails can type it into the Codex box. Redeem accepts either.

---

## 4. Requirement 2: location check-in QRs — MISSING

### How location works today
- Each `LOCATION` derives a `loc:<Id>` room. **Posting there requires standing there**: `canPost` returns `occupants.get(loc).has(person)` (`sim.ts:1006-1008`; snapshot `member`/`canPost` `:1057-1072`). Location also drives visibility: hidden rooms appear once revealed or once visited, `hasVisited` (CLAUDE.md "progressive rooms"). It drives `canEscape` from sealed rooms (`views.ts:200`) and the presence UI (`play/src/presence.ts`).
- Location changes only through:
  - `Sim.arrive(person, loc)`: journaled, fires `exits`, `enters` and `arrive` hooks (`sim.ts:325-333`, `setLocation` `:2298-2324`).
  - The story's `move who to Place` (`sim.ts:1905-1915`), plus capture, escape and release.
  - A director: `/api/mod/set {field: "location"}` → `arrive` (`event-runtime.ts:2852-2885`).
  - stagehand MQTT `arrive:` rules (`stagehand/src/stagehand/show/sensormap.py:55`, `modapi.py:124`).
- **There is no guest route.** None of the `/api/guest/*` routes (`event-runtime.ts:1981-2283`) moves the caller. Performer scans fire `scan` hooks but do not move anyone (`:2342-2385`).
- Occupancy is readable by the story as the collection `<Location>.occupants` (`sim.ts:2353-2357`). The `arrived` sim event is **not** rendered in chat (`chat.ts` has no case for it), so the Antivirus get no "X checked in" feed unless the story broadcasts one.
- The show needs exactly this: "five-minute warning … if you fail to arrive on time without using Bathroom Mode, an antivirus sends you to the Internet" (`Trapped In The Internet story/STORY BEATS.md:27`, Story Overview `:165`). Bathroom Mode already exists as `program.afk` (`main.loom:200-207`).

### Design
**Route:** `POST /e/:id/api/guest/checkin {token}`. The token is a location's print token from `/q/<token>`. The server maps it to a LOCATION and commits a journaled **`checkin`** mutation, which is `arrive` plus `who.checkin.at` (sim clock) and `who.checkin.place`. Keeping `arrive` semantics means room access, reveal-on-visit, presence, and `when program arrives at X:` hooks all just work.

**Guards** (each is a clear refusal, not a silent no-op):
- Doors closed → 409.
- Captured, or currently in a `sealed` or `prison` location → "the Internet has no doors" (§2.7).
- On rails (`cutscene` location, or a story flag such as `uploaded && !cleared`) → "not yet".
- Location `hidden` and not revealed to this guest → refused by default. A new `LOCATION … checkin: always|revealed|never` controls this (default `revealed`), so a QR found early cannot spoil a room.
- **Cooldown** of 15–30 s per guest. Re-scanning the room you are already in → "you're already in The Cache" (no journal entry).
- Optional `capacity:` enforcement. The field already exists on `LOCATION` but is not enforced.

**Feeds:**
- A system notice in the room ("📍 Winamp checked in").
- An optional mirror into an Antivirus room, done in story as `when program arrives at The Desktop: broadcast … to group(Antivirus)`. Better: a built-in `arrived` chat render gated by `LOCATION … announce: group(Antivirus)`.
- Run cockpit roster: show the last check-in time per guest.

**Deadlines / roll call** (the 5-minute rule) as a small language addition that lowers to existing parts:
```
call everyone to The Desktop within 5m "Truth Time — get to the living room!"
when program misses the call:         // fires per guest not checked in since the call, unless program.afk
  capture program into The Internet
```
- `call` stamps a call id and time, broadcasts an `!` alert (chime, vibrate, banner, already implemented), and arms a timer.
- At expiry the sim fires `misses the call` per absent guest. Guests in Bathroom Mode (`afk`) are skipped, or get a separate `late from the bathroom` event. An `answered the call` event fires on check-in.
- Mirrors: `who.answered_call` (bool), `call.remaining`. The Run page shows a live countdown and an "absent" list for the Antivirus to sweep.

**Replay and remote check-in.** A photographed room QR lets someone "check in" from the couch. Three options, in increasing strictness:
1. Accept the risk for low-stakes rooms (static signs). Combine with the cooldown and an "X checked in" feed so the Antivirus can catch cheats in fiction.
2. For **deadline** check-ins, use the **terminal as a check-in kiosk**. The guest shows their pass to the wall tablet, and the terminal already knows its `spot`, its room and that room's LOCATION (`house.json` `terminals[].room` → `rooms[].location`). That is proof of presence with zero new hardware. Server: `POST /api/mod/checkin {guest, spot}` with a scoped device token (§5.6).
3. A rotating QR on a terminal screen: a TOTP-style token valid for 60 s. Only if (2) is too slow for a crowd.

**One location vs two.** Today "location" means *both* where the story put you and where your body is. The story's `move everyone to The Desktop` puts people in the room even if they are upstairs. **Recommendation: keep a single location**, because it is the posting gate and the presence model, and have deadline-sensitive beats use `call … within` rather than `move`, so physical check-in is what moves people. `who.checkin.at` gives the extra "when did they physically confirm" signal without forking the model.

**Printables:** one A4/Letter sign per LOCATION, with the room label (in-fiction name plus real room, e.g. "The Cache — kitchen" from `label:`), a big QR, the speakable fallback, and "Scan to enter this room's chat".

---

## 5. Requirement 3: pre-baked, printable QRs — MISSING

### Core idea: printables belong to the project, not the event
Everything printed must outlive Launch, Restart, Go live **and End → relaunch**, and must not leak secrets. So:

**New table `printable`** (Postgres, control plane). For the DB-less default event, use a `printables.json` in the state dir.
```
printable(
  token        text primary key,   -- 10 chars from auth.ts's speakable alphabet (~49 bits)
  project_id   uuid not null,
  kind         text not null,      -- 'badge' | 'clue' | 'place' | 'cast' | 'device' | 'join'
  target       text,               -- codex entry id / LOCATION id / CHARACTER id / device role
  label        text,               -- what's printed (RSVP name, poster title, room label)
  meta         jsonb,              -- badge: {program?, picture?, rsvpEmail?}; device: {name, spot, view, character}
  created_at, revoked_at,
  claimed_at, claim_device text    -- badge/device: first claimer
)
```
**One URL shape for every printed QR:** `https://app.mapsandducks.com/q/<token>`. It is short, which gives a low QR version that scans well at small sizes. It is stable and contains no event code, passcode or IP.

**Resolution:** `POST /api/resolve-print {token}` → `{eventId | null, kind, title, …}`. The project's *currently active* event is looked up at scan time, so a relaunch does not break paper. No active event → a friendly "The party hasn't started yet" page. Throttle it like `/api/resolve-code` (`server.ts:417-424`).

**Play app dispatch** on `/q/<token>`, from the native camera or the in-app scanner:

| kind | Signed in (same event) | Not signed in |
|---|---|---|
| `join` | no-op ("you're in") | registration, with the event resolved by token rather than by code |
| `clue` | `codex/scan` (§3) | register, then scan |
| `place` | `checkin` (§4) | register, then check in |
| `badge` | see §5.1 | see §5.1 |
| `cast` | — | performer sign-in with the character pre-selected (§5.2) |
| `device` | — | opens `/terminal/` or `/reinstall/` enrollment (§5.3) |

Also auto-route by role: when a scanned token or code resolves to a performer, skip the "Guest or Performer?" chooser (`ui.tsx:17-40`).

### 5.1 Guest badges / passes
Two modes, both from one `badge` printable:
- **Blank badge.** No meta. The first person to open the URL registers through the normal picker, and the badge **binds** to them.
- **RSVP badge.** `meta.program` and optionally `meta.picture` and `meta.rsvpName`. Opening it skips the picker: the server registers that program with that picture and reserves the name so nobody else can take it. `guestNameRefusal` gains "reserved for a badge" (`event-runtime.ts:2019-2023`). The webmaster outbox (`core/server/webmaster.ts`) could email each invitee *their* badge link ahead of time.

Binding semantics:
- **Durable identity across restarts.** Store `badge token → guest id` in the runtime, persisted next to `guests.json`. On a restart that kills the person (§2.3), the next open or scan of the badge **re-registers the same name and picture automatically**. Go-live becomes painless for badge holders.
- **Claim-once.** The first device to open the URL gets the guest session. A second device opening it gets "This pass is already claimed. Ask a host." A director can **Release** it in the Inspector (a lost or dead phone) so the badge can be re-claimed on a new phone. This stops a photographed lanyard from being a login.
- **Badge = pass.** The printed badge QR *is* the scannable pass. `parseScan` in terminal, reinstall, the performer Scanner and the editor lookup must accept `/q/<token>` and resolve it to the current guest id. `scan.ts:24-26` already anticipates "a pass link some future app might print". `/api/scan` and `/api/mod/*` resolve server-side: `target` may be a badge token. The phone's "Your pass" sheet shows the same `/q/` URL instead of the bare id.
- **Print:** a lanyard or name badge (e.g. 4×3 in or 86×54 mm CR80) with the program name, avatar, a large QR and "Scan me". Blank badges get an in-fiction "UNINSTALLED PROGRAM" title.

### 5.2 Performer sign-in cards
Today a card would be "character + the shared performer code" (copy text at `RunPage.tsx:268-280`). The prime code lets *anyone* sign in as any unclaimed part, with scan capability. Go-live signs every performer out (`event-runtime.ts:1444-1451`), so performers need to sign in again quickly.

**Design:** one `cast` printable per CHARACTER that is a performer's part (the identity classifier already exists: `server/identity.ts`). Opening it signs in **as that character** directly. It is refused 409 if another booth holds the part, which is the existing rule (`event-runtime.ts:2311`). Re-sign-in after go-live is one scan. Revoke per card. Print: a wallet card with character name, portrait, faction colour and QR.

### 5.3 Device setup (terminals, reinstall tablet, map editor)
**Never print the mod passcode.**
- `device` printables carry a scoped role (`terminal` | `reinstall` | `station` | `map`) and config meta (name, spot, character, view, camera, role). This replaces `?code=<mod>&name=…`.
- Enrollment is **single-use with a TTL**, for example 48 h. The first open mints a **scoped device token**. A terminal gets impersonate, tts, spatial read and an optional `checkin`. A reinstall tablet gets spatial begin/end and house read. Map gets house write. None get say, set, reveal or end. After that the printable is spent.
- Run → **Devices** lists enrolled tablets with last-seen time and **Revoke**. This also closes §2.6: a stolen tablet holds only its scope.
- In practice show enrollment QRs **on screen** in Run → Devices, scanned by the tablet's camera. A print option exists, with a visible "single-use — shred after setup" warning.

### 5.4 Run → Print (the editor page)
A new `CockpitTab.Print` beside Run. It is project-scoped, so it works before any event exists. It lists print sets, generated from the model plus the `printable` table:

| Set | Source | One item per | Default stock |
|---|---|---|---|
| Clue posters | `model.codex` entries | entry (with optional `copies:`) | A5/Half-letter poster, 2-up |
| Room signs | `model.locations` (minus `checkin: never`) | LOCATION | A4/Letter, 1-up |
| Guest badges | RSVP list (paste CSV: name, program?, email?) + N blanks | badge | CR80 / 4×3 in lanyard, Avery 5390/L7418 |
| Performer cards | performer parts | CHARACTER | Business card, Avery 5371/L7414 |
| Join posters | the project | 1–N | A4/Letter |
| Device enrollment | Run → Devices | device | on screen; print optional |

Behaviour:
- **QRs rendered client-side** (`qrcode` in the editor, SVG, EC level Q) to avoid the `/api/qr` 60/min limit (§2.5) and work offline.
- **Print via CSS** `@media print` + `@page { size: … }` and label-grid templates. The browser's "Save as PDF" makes the PDF, so no server PDF library is needed. Also offer a **CSV export** (token, kind, label, URL) for a print shop or mail merge.
- Every item shows the speakable fallback and a tiny item id, so a damaged poster can be re-issued.
- Reprint and revoke per item. **Regenerating keeps tokens stable**: tokens are minted once per (project, kind, target) and reused, so reprinting never invalidates paper already on a wall.
- A lint list: CODEX entries with no poster and no story unlock; LOCATIONs with no sign; badges unclaimed at doors-open.

### 5.5 Is pre-printing safe? (stability checklist)
- **Domain:** use only `LOOM_PUBLIC_URL` (`https://app.mapsandducks.com`, `docs/loom-docker-deploy.md:15`). Fix §2.1 first. Print a test sheet and scan it off-network (cellular) before the real run.
- **Event lifecycle:** `/q/` tokens resolve to the active event, so End → relaunch is safe. As a quick win before `/q/` exists, add **pinned project codes**: a project-level `event_code`/`prime_code` reused by every launch, so existing `?code=` links survive relaunches. The unique index is per non-ended event (`db/index.ts:96-97`), and there is one active event per project, so this is compatible.
- **Internet dependency:** printed `https://app.mapsandducks.com` needs the VPS reachable from the party Wi-Fi or cellular. If the show ever runs LAN-only on the laptop, phones need a local DNS override plus a valid cert, or the paper is useless. Decide this before printing.
- **Revocation:** every printable can be revoked. A revoked token answers "this code has been retired".

### 5.6 Security summary
| Risk | Today | With design |
|---|---|---|
| Mod passcode on paper or in a link | Device links embed it (§2.6) | Single-use scoped enrollment; mod code never printed |
| Event code on every clue poster | Yes (`event-runtime.ts:2656`) | `/q/` tokens carry no event code; the join gate becomes "has any valid printable or the event code" |
| Guessable clue codes, no throttle | Yes (§2.4) | Opaque tokens (~49 bits) + per-guest throttle + optional `found at:` gate |
| Photographed badge = login | n/a (no badges) | Claim-once + director release |
| Shared performer code on cards | Would be | Per-character cast tokens, revocable |
| Remote room check-in | n/a | Cooldown + feed; terminal-kiosk or rotating QR for high-stakes deadlines |
| Brute force of `/q/` | — | Rate-limit `resolve-print` like `resolve-code` |

---

## 6. Requirement 4: floor plan editor — PARTIAL

### What exists
- **One shared map format:** `@loom/house` `house.json` schema v1 (`house/src/types.ts:20-182`). Floors; rooms as **rectilinear** polygons (diagonal edges refused, `house/src/validate.ts:276-292`; walls are axis-aligned, `WallSegment.axis: "x"|"z"`); doors on shared walls; stairs; props; terminals; duck spots; spawn; `room.location` → LOCATION. `validateHouse` is thorough (CLAUDE.md lists it). The VR GDScript port is pinned by 24 goldens (`pnpm house:sync`).
- **The viewer/editor at `/reinstall/map`** (`reinstall/web/src/map/MapApp.tsx`, 1064 lines; `edit.ts`; `plan.ts`): one floor at a time, live players, and in Edit mode:
  - drag/aim terminals, duck spots and spawn;
  - add/remove terminals and duck spots;
  - move/resize **rectangular** rooms only (`MapApp.tsx:1056-1058`);
  - patch a room's label, location and colour (`edit.ts:216`);
  - a JSON tab with live validation (`draftFromText`, `edit.ts:253`);
  - save with `base` → 409 on conflict (`POST /api/mod/spatial/house`).
- **Live propagation:** a save reaches the web game (refetch on `hello`/`house`), the terminals' world view, and the VR game (2 s map-version refetch). This is all already built.

### What is missing for "make a replica of my house"
1. **Creation tools:** no add room, floor, door, stair or prop (`MapApp.tsx:395-437` adds only terminals and duck spots). New geometry means hand-editing JSON.
2. **Non-rectangular rooms:** L-shaped rooms are allowed by the schema but can only be edited in JSON.
3. **No underlay or scale calibration.** You cannot drop a photo or scan of a floor plan, set "this wall is 4.20 m", and trace over it.
4. **No numeric entry or measuring tape.** Measuring a real house means typing W×D numbers from a laser measure.
5. **No 3D preview or walk-through** in the editor. `@loom/house/three` and the web game engine exist but are not wired into the map page.
6. **Storage scope** (§2.8): saved per event, lost on relaunch, invisible to the project and its co-writers, not versioned with the story.
7. **Auth:** the map page needs the mod passcode (shared `Setup` from `reinstall/web/src/app.tsx`).
8. **No link to printables:** nothing records where each clue poster or room sign physically hangs.

### Design
**Move ownership into the project.** `house.json` becomes a project file (`project_file`), so it is versioned, shared with co-writers and visible in Writing. At **launch** it is snapshotted into the event, like `scenario_source`. "Push map to running event" reuses `POST /api/mod/spatial/house` with `base`. The default event keeps `LOOM_HOUSE`.

**Editor surface.** A **House** view in the editor, either as a Writing-mode centre tab when `house.json` is open or under Integrations, authorised by the author session (no mod code). It reuses `reinstall/web/src/map/{plan,edit}.ts` and `@loom/house` `validateHouse`. `/reinstall/map` stays as the on-site quick-fix tool.

**Tools**, in priority order:
1. **Floors:** CRUD for label, elevation and height. Validation already enforces > 0.5 m spacing.
2. **Rooms:**
   - Rectangle drag, or type W×D at a point.
   - **Polygon** click-to-draw with axis lock (no diagonals, matching the validator).
   - Split/merge, and snap to adjacent walls.
   - Grid of 5 / 10 / 25 cm.
   - A LOCATION dropdown fed by `Workspace.model().locations`, with lints for a LOCATION that has no room and a room whose LOCATION is unknown. The server already logs the latter.
3. **Doors:** click a shared wall to place a door; drag along the wall; width. The validator already checks gaps and tolerance.
4. **Stairs:** rect drag, from/to floor, `up` compass.
5. **Props:** a palette of the existing `PropKind`s with size, yaw, `solid` and colour. They already block routes when solid.
6. **Underlay:** import a PNG/JPG/PDF page of the floor plan, set 2-point scale calibration, opacity and rotation. Stored as a project asset, per floor.
7. **Measure tape and dimension labels** on walls, so the map can be compared against the real house.
8. **3D preview pane** using `@loom/house/three`, with orbit plus a "walk it" mode that reuses `reinstall/web/src/game` physics without a server session.
9. **Undo/redo:** the edit journal pattern from `editor/src/store/edit-journal.ts`.
10. **"Export for Godot":** download `house.json` plus goldens, the equivalent of `pnpm house:sync`, for offline VR builds.

**Tie it to printables.** Add an optional `markers: [{id, kind: "clue"|"sign"|"badge-desk", printable, room, pos}]` list to `house.json`. Spot-checked: `validateHouse` does not appear to reject unknown keys (no key whitelist in `house/src/validate.ts`). Confirm that, and that the GDScript port ignores them; otherwise bump the schema and regenerate goldens. Then Run → Print can emit a **setup map**: each floor plan with numbered pins showing where every poster, room sign and terminal hangs. That is the set-dressing crew's checklist. It also enables `found at:` checks against the room.

---

## 7. Suggested build order (for the software checklist)

| # | Item | Size | Unblocks |
|---|---|---|---|
| 1 | `LOOM_PUBLIC_URL` for `joinBase` (§2.1) + a docs fix | XS | Any printing at all |
| 2 | Pinned project codes (codes survive End → relaunch) | S | Safe interim printing of join/clue QRs |
| 3 | Redeem throttle + stop journaling floods (§2.4) | XS | Clue robustness |
| 4 | Guest in-app scanner (reuse `terminal/src/scanner.tsx`), auto-role on `?code=`, jsQR fallback for the performer booth | S | iOS performers, same-browser scans |
| 5 | `printable` table + `/q/<token>` + `resolve-print` + play dispatch | M | Requirements 1–3 |
| 6 | `codex/scan` (`via: scan`, optional `found at:`) | S | Requirement 1 |
| 7 | `checkin` route + guards + cooldown + `LOCATION checkin:` + feed | M | Requirement 2 |
| 8 | `call … within` / `misses the call` roll-call construct + Run countdown | M | 5-minute deadline beats |
| 9 | Badges (blank/RSVP, claim-once, durable across restarts, director release) + `parseScan` accepts `/q/` | M | Requirement 3 (passes) |
| 10 | Cast cards (per-character sign-in tokens) | S | Performer re-sign-in after go-live |
| 11 | Scoped device tokens + Run → Devices (enroll/revoke) | M | Removes the mod code from tablets |
| 12 | Run → Print page (client-side QR, label templates, CSV) | M | Paper |
| 13 | `house.json` as a project file + launch snapshot | S–M | Map survives relaunch |
| 14 | Floor plan editor: create tools, polygons, doors/stairs/props, underlay + calibration, measure, 3D preview, undo | L | Requirement 4 |
| 15 | `markers` + printable setup map | S | Set-dressing checklist |
| 16 | Terminal as check-in kiosk (spot → room → LOCATION) | S | Presence that can't be faked for deadlines |

**Before printing anything:** finish items 1, 2 (or 5), 3 and 12. Print one test sheet and scan it from a phone on cellular data, off the house Wi-Fi.
