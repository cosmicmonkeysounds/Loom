> **Historical (moved from `docs/trapped/` on 2026-10-24).** A planning or audit note from October 2026; the code, the show folder and the package docs win where they differ.

> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.
>
> **Wave 1 status** (merged to master 2026-10-15, not yet deployed to the VPS; [OCT31 §5](../../../core/examples/trapped-in-the-internet/OCT31.md)). Against §4: **built** — check-in by QR (K-13, `POST /api/guest/checkin`, `?checkin=`), alerts that land on phones and booths (K-06 + N-07), Web Push for Android + booths (K-31a; iPhone K-31b pending), the Director **cue sheet** (K-21), the Run **Print** page from `/api/mod/codes` (K-12), the deterministic recap (K-26, `GET /api/mod/recap`; no stagehand recap), terminal screen state / slides / overlays / countdown / TV voice / wake lock (K-14–K-18), "📝 File a fact" for the hunt (K-24 + N-05), re-pair a lost guest and release a performer's part (N-02 + N-10), the iPhone booth scanner (N-01). **Still a design / workaround**: featured programs (§0 — trust at the door + D-01 featured sheets), relative timers and phone countdowns, a phone takeover widget, Truthcoin, the BOARD / Trust Chart view, recruit/pledge, Bathroom Mode as a HUD badge.

# Trapped in the Internet: app and admin audit

What the source story (`Trapped In The Internet story/*.md`) needs from the **participant play app** (`play/src`), the **event server** (`core/server`), and the **editor's Run mode** (`editor/src/components/{run,cockpit}`, `store/{operate,sim,cockpit}.ts`), checked against what the code does today.

Status key: **SUPPORTED** = works today, either from the engine or with ordinary authoring. **PARTIAL** = pieces exist, but there's a real gap or the workaround is fragile. **MISSING** = needs new code.

All paths are relative to `packages/loom/`.

---

## 0. The blocking structural gap: "featured programs"

The source story has two kinds of named programs:

- **Actors/hosts.** Clippy, Task Manager, Adobe Acrobat, Recycling Bin, and the four Antivirus. These map cleanly onto the performer booth.
- **"Programs – Confirmed".** Excel (Rob), OpenOffice (Lara), DraftKings (Hannah), Bugdom (Veronica), Ask Jeeves (Kai), Runescape (Laurel), MS Paint (Cat), VLC (Zeus), Pong (Em), WebMD (Julia). These are **invited guests with a pre-written character**. The story treats them as ordinary programs: they play Bingo, get judged at the Moments of Truth, get sent to the Internet, count in the Trust Chart, and get recruited. On top of that, each gets **private missions and two-option choices at the glitch** and is tracked: Excel's virus plant, OpenOffice's 20 facts, DraftKings' 1000 Truthcoin, Ask Jeeves' scrambled codex.

The engine sorts every `CHARACTER` into one of two kinds (`core/server/identity.ts:3-24`, `isSpecial` at `identity.ts:49-56`):

- **"special"**: it has any hook, an owned beat, a dialogue line, a `mind`, or `listed`. Only a performer can claim it.
- **"pool"**: a bare name. A guest can pick it.

The current example authors Excel and OpenOffice as hooked characters (`core/examples/trapped-in-the-internet/cast/programs.loom:27-60`), so they are **performer booths**. A booth:

- has **no pending choice**. Choices are per-person (`Sim.allPendingChoices`, `GuestView.pendingChoice` `views.ts:149`). `PrimeView` has none (`views.ts:476-500`).
- **cannot redeem codex codes**. Only `/api/guest/codex/redeem` exists (`event-runtime.ts:2240`); the booth can only share (`:2283`). So OpenOffice can't collect 20 facts from wall QRs.
- **cannot be captured or sent to the Internet**. `/api/mod/act` and `/api/mod/set` require `sim.persons.has(id)` (`event-runtime.ts:2715-2737`, `:2852-2860`). Spatial `begin` takes a guest.
- **has no Quest Log**. `/api/mod/quest` requires a person (`event-runtime.ts:2688-2714`).
- **isn't counted** by `members()` or the roster, so it drops out of the Trust Chart and the majority math.
- is **seen by every other booth**: performers see every non-DM room (`visibleToPrime`, `event-runtime.ts:120-131`).

The alternative is to make them **pool guests** and target them from ROLE watchers by name (`when Night.phase == "glitch" and self.name == "Microsoft Excel":`). Watchers are per participant on a ROLE. A plain signal never reaches ROLE hooks without a subject (`sim.ts:1400-1413`). That approach is fragile:

- **Anyone can claim "Microsoft Excel"** at the door. The picker lists every unclaimed pool name (`identity.ts`, `/api/identities` `event-runtime.ts:1887`).
- **One stray `Excel:` dialogue line** flips the character to special (`speakersOf`, `identity.ts:59-80`).
- **Codex "about" entries** that should start in Excel's hands have no holder until someone claims the name.

**Proposal (P0): a featured-program identity.**

- **Declaration.** Add `CHARACTER Microsoft Excel … played by: guest` (or `featured: true`). The character is a guest identity, a person with `role: Program`, not a booth.
- **Reserved claim.** Only the invitee can take it: a per-invitee claim code (`?code=<event>&as=<claim>`), minted in the Run page's Join card and emailed from the webmaster outbox (`core/server/webmaster.ts`) alongside the Maps and Ducks invitation. Alternatively, a director assigns the guest from the Inspector.
- **Hooks bind to the person.** The character's hooks/beats/codex bind to the claiming person (`self` = the guest), and its `known to:`/about entries transfer to that person on claim.
- **Booth stays possible.** A featured program can still be scanned by others (`when scanned by program:` → `self.Tabulate` works if the claimant gets a scan surface; see §12).
- **Classifier rule.** `isSpecial` ignores featured characters, and the guest picker shows them only to holders of the claim code.

Until P0 lands, these items are partial at best: §6 (private missions/choices), §7 (fact and virus tracking), §9 (recruitment), §10 (Truthcoin), and part of §5 (judging featured programs).

---

## 1. Summary table

| # | Need (from the story) | Status | Where it lives / what's missing |
|---|---|---|---|
| 1 | Push notification **with sound while the phone is locked** | **MISSING** | Only an in-page alert: an `!`-prefixed broadcast triggers a synthesized chime, vibration, and a banner (`chat.ts:387-402`, `play/src/session.ts:496-510`, `codex.ts:60-92`). No service worker, manifest, Web Push, or VAPID (`play/index.html`). It only fires with the tab in the foreground and the SSE stream alive, the chime needs a prior tap, and iOS has no `vibrate`. **Performers get no alerts at all** (alert logic is only in `useGuestSession`, `session.ts:439-510`). |
| 2 | App Prompts **C1/C2** (director calls everyone to the living room) | **SUPPORTED** (authoring) / PARTIAL (UX) | `INTERACTION call to the desktop who: admin` → story rule broadcasts `!📣 …` (`main.loom:264-266`, `:320-323`). Fired from the Director tab or quick-fire (`tabs.tsx:891-958`, `RunStage.tsx:54-86`). No cue sheet: admin interactions show up as raw event names in a dropdown, not labelled, ordered buttons. |
| 3 | **Bathroom Mode** that everyone/antivirus can see and that exempts a guest from the 5-minute summons | **PARTIAL** | Toggle exists as two guest INTERACTIONs plus `program.afk` (`main.loom:198-207`, `:221-228`), buried in ☰ → "Things you can do" (`guest.tsx:274-301`). The broadcast to `group(Antivirus)` actually lands in a faction room whose members are persons; booths only see it because they see every room. **No visible status**: `PersonCard`/`PrimeGuest` have no AFK field (`views.ts:38-52`, `:466-473`). No timeout or auto-return. Exemption is authorable once deadlines exist (§5). |
| 4 | **Full-screen takeover** ("Go to the living room", flashing) | **MISSING** (infra PARTIAL) | Closest pieces: the `cutscene` stage, but that's location-driven and only for guests standing in a `cutscene: true` place (`cutscene.tsx`, `guest.tsx:444-455`, `:473`), and overlay widgets (`WidgetDef.overlay`, used only by `tutorial`; `widgets.tsx:282-288`, `guest.tsx:476`). No story or admin "take over every screen", and no way to retract a card. |
| 5 | **Timers/countdowns** on phones (15-min hunt, 1-hour dispersal, 5-min warning, midnight Y2K) | **MISSING** | Timer hooks are `every N` / `after N` **measured from run start** (`model.ts:681-687`, `sim.ts:771-783`), so they can't be relative to a cue. Nothing timer-shaped in `GuestView` or the terminal. Today the director fires the phases by hand. |
| 6 | **Physical presence / check-in** ("who is in the living room at the deadline") + late list for antivirus | **MISSING** (the late list itself is authorable) | Location is only what the story sets (`move`, `arrive`, `/api/mod/set location` `event-runtime.ts:2877-2885`). Nothing lets a guest, room QR, or terminal say "I'm here". The terminal pilots a scanned guest but never records its `spot` (`terminal/src/pilot.ts`). Once location is real, a ROLE watcher can flag latecomers and skip AFK guests. |
| 7 | **Judging answers** (accurate / confident-but-false / reject → Internet) from a host or admin phone, plus a tally | **SUPPORTED** (authoring) / PARTIAL | Three `who: performer` INTERACTIONs on the guest card (`/api/prime/act`, `event-runtime.ts:2388-2416`; card actions `performer.tsx:300-330`), or the editor's fire-event-on-subject with args (`tabs.tsx:891-958`). Gaps: no per-question argument from a phone (`prime/act` takes no args); featured programs can't be judged (§0); no running tally view. |
| 8 | **Trust Chart** (10 per truth, −5 per Internet visit, ±10 assessment), ranking, show top/bottom | **PARTIAL** | The arithmetic is authorable as `set`/watchers on person vars. Trabolta's ±10 can't come from his model directly: agent `adjust` only touches **his own** ranges (`event-runtime.ts:845-857`). The workaround is an `assess` power with args (`acts`, `:734-779`). No `max`/`sort`/`top()` in expressions (`sim.ts:2408-2428`). **No board/leaderboard screen** (terminal views: auto/world/face/mirror only). |
| 9 | Whether **all** submitted facts were accurate (decides the finale) | **SUPPORTED** (authoring) | Global `Night.false_truths += 1` on the "confident-but-false" judgment, then `if Night.false_truths == 0` at the finale. |
| 10 | **Counting Internet visits** | **SUPPORTED** | `when captured: set self.reinstalls += 1` (`main.loom:174-178`). Visible to the director in Inspector variables (`Inspector.tsx:135`). |
| 11 | **Faction recruitment**, half+1 majority (Excel "stay" vs OpenOffice "escape"); how a guest joins | **PARTIAL** | Groups plus `count(members(X))` exist (`sim.ts:2408-2421`). Guests can `join`/`defect` public factions from the profile sheet (`guest.tsx:280-301`, `/api/guest/join|defect` `event-runtime.ts:2077-2098`). The join route **doesn't check that the faction is public or joinable** (`sim.ts:293-313`). No total-programs function (keep a counter on `when someone joins`). No recruit flow with consent. No unlock-for-a-group (`unlock … for <one holder>` only, `sim.ts:1964-1972`; no `for` loops), so the faction's reward unlock must go through ROLE watchers. Featured recruiters are booths (§0). |
| 12 | **Per-character secret missions / two-option prompts at the glitch** (Excel, OpenOffice, DraftKings, Bugdom, Ask Jeeves) | **PARTIAL → blocked on §0** | For a person, `-> Excel Mission for program` with a `*` choice works (`pendingChoice` + DecisionTray), and the two branches set a var. For a booth: impossible (no choices, see §0). |
| 13 | **Private message to Clippy's performer** that differs from everyone else's | **MISSING** (workaround exists) | Every booth sees every non-DM room, including `respond` lines, which land in the lobby (`chat.ts:346-349`, `visibleToPrime` `event-runtime.ts:120-131`). Workaround: author "Clippy Instructions N/X" and the malware warning as **CODEX entries unlocked for Clippy**. `PrimeView.codex` is per character (`views.ts:524`, rendered at `performer.tsx:271-280`), but it shows up silently with no notification. |
| 14 | **Truthcoin**: a guest currency, gambled and traded (DraftKings wants 1000) | **MISSING** | Only `score` (⭐ in the identity card, `guest.tsx:406`). Director can set it (`/api/mod/set score`). No guest→guest transfer, wager, escrow, or "sell a fact for coin". |
| 15 | **Scrambled codex** (Ask Jeeves' 20 facts) | **SUPPORTED** (authoring) | Author scrambled CODEX entries and `unlock` them for Ask Jeeves at the glitch (or hand over a pre-scrambled set). An engine-side "scramble for this holder" transform would be nice to have, not required. |
| 16 | **Who read Trabolta's LiveJournal** | **SUPPORTED** (authoring) | The LiveJournal is a CODEX entry with a QR code. `when program learns Trabolta's LiveJournal: set Night.lj_reader = program.name`. `who.codex.<slug>` mirrors exist (README §Codex). |
| 17 | **OpenOffice's 20 facts / Excel's virus plant** | **PARTIAL → §0** | `who.codex` count mirror plus a ROLE watcher `self.codex >= 20` works **for a person**. A booth can't redeem codes. Virus plant = a director cue (`virus planted` on subject) or hardware (stagehand MQTT → signal, `stagehand/show.example.yaml:56-72`). Retrieval = `when released` while `self.wants_virus`. |
| 18 | **Auto-generated end-of-night summary** from chat activity (Clippy reads it; Trabolta recounts identities and accomplishments) | **MISSING** (building blocks exist) | Raw material: `GET /api/agent/facts` (every program's vars, groups, codex, location; `event-runtime.ts:667-721`), Trabolta's mind dossiers + trace (`agents.ts`), `/api/history`, the editor's run export. Nothing composes a recap or delivers it to Clippy or the TV. |
| 19 | **Pickup-line check** (only "You're the one that I want") | **PARTIAL** | Typed chat **never triggers story hooks** (the `say` path never fires; `sim.ts:854-866`). Workarounds: (a) a codex code `YOURE THE ONE THAT I WANT` typed into the Codex room. `foldCode` ignores case, spaces, and dashes but **not the apostrophe** (`model.ts:505-507`), so "You're" ≠ "youre". (b) a `poll` card. (c) Trabolta's agent recognizes it and fires a power. |
| 20 | **Director fires beats/alerts from the admin panel, with arguments** | **SUPPORTED** | Director tab: named event + subject + `k: v` args, fire beat + subject, broadcast cue + scope (`tabs.tsx:891-1018`). Header quick-fire (`RunStage.tsx:54-86`). A `!` prefix makes an alert (`chat.ts:388-392`), though the Director UI never mentions that. |
| 21 | **Per-guest human identity / backstory reveal** at the end | **PARTIAL** | Named characters: backstories as CODEX entries (`codex/programs.loom`), revealable with `unlock`. Pool guests (Calculator, Winzip, …) have **no human backstory** in the data. No free-text widget to collect "what problem did Trabolta promise to solve" at the door (Pretext). |
| 22 | Monitor prompts **V1–V6** (screens showing ads, bingo, questions, VR mirror) | **PARTIAL** | The TV = a terminal in `view=mirror` (README §Integration contract). The world view works. **No video, ad, slide, question, or board playback** on terminals, and terminals ignore broadcasts and `cue`s (no `alert`/`cue` handling in `terminal/src/app.tsx`). No Wake Lock in terminal or reinstall (tablets will sleep). |
| 23 | **Server-room door sensor → app alert** if opened while locked | **SUPPORTED** (path) / PARTIAL (who hears it) | Stagehand MQTT sensor → journaled `signal` (`show.example.yaml:56-72`) → story `when server room opened: if not Night.server_unlocked: broadcast "!…" to group(Antivirus)`. But **antivirus performers get no chime or vibrate** (§1, row 1), so they need performer alerts or Web Push. |
| 24 | **Patch bay self-destruct** combination shown in the app | **PARTIAL** | Combination text = the Legendary CODEX entry. Unlock for the majority faction via watcher (row 11). Success = stagehand ADC → `signal("trabolta disabled")`. Missing: a single source of truth for the combination (world var or `house.json`-like config) shared by the app text and the ESP32 checker. |

---

## 2. What the admin panel already provides (editor Run mode)

All of these are server-backed through `store/operate.ts`, and the local `Sim` gets the same surface through `store/sim.ts` (one contract, `store/cockpit.ts:241-417`):

- **Lifecycle.** Start rehearsal, pause/resume, restart, push draft, **go live in place**, end, typed-code confirms on live (`LifecycleControls.tsx`, `RunStage.tsx`).
- **Front of house** (`RunPage.tsx`). Three join codes, join URL plus QR (`:233-260`), a performer sign-in row per character with presence, "Directing now", and **Look up a guest by pass QR** (camera `BarcodeDetector`, `:60-130`, `:326`).
- **Director tab** (`cockpit/tabs.tsx:885-1018`):
  - **Fire named event** from the model-enumerated list, optional subject, and `k: v` arguments.
  - **Fire beat** on a subject.
  - **Broadcast cue** with a scope (`all`, `faction(X)`, `location(X)`). A `!` prefix = alert chime on guest phones.
- **Header quick-fire** of any named event (`RunStage.tsx:54-86`) and a ⏳ pending-decisions pill.
- **Chat as anyone.** Post into any room as Operator, Narrator, any character, or a guest (with confirm and a `via` badge). DM a guest as a character via `guest:<id>` (`event-runtime.ts:2795-2850`). Reply in thread, hide/unhide messages (`/api/mod/message`).
- **Being anyone (lens).** Exact `GuestView`/`PrimeView` of any participant (`cockpit/Identity.tsx`, `/api/state?role=…&as=`).
- **Players tab.** Embedded real play apps per guest, persona, or performer (`PlayersTab.tsx`, `/api/mod/impersonate` `event-runtime.ts:2974-3001`).
- **Inspector** (`Inspector.tsx`):
  - Their view and their feed.
  - Story trail.
  - **set score / faction / location / captured** (`/api/mod/set`, `event-runtime.ts:2852-2898`).
  - **edit any variable** (`VarTable.tsx` → `/api/mod/var`, `:2957-2972`).
  - Answer a pending choice for them (`/api/mod/choose`).
  - Capture/release (Internet).
- **World tab.** The whole world state, editable inline.
- **Stage tab.** Guests by location, draggable (moves location); the cast strip.
- **Mind tab.** Trabolta's mind and trace, plus controls (nudge, survey, set stage/drive/policy/trust, pause, reset, re-run).
- **Log tab.** Raw ledger, per-participant filter, export run (`loom-run/1`).
- **Reveal** a hidden faction, **scan as** a character.

**Server routes the editor never calls** (`grep` of `editor/src`: only `act, agent/*, beat, broadcast, choose, impersonate*, message, persona, reset, reveal, say, scan, set, signal, var`):

- `/api/mod/codex` (hand a guest an entry; `event-runtime.ts:2667-2687`). No "give lore" UI.
- `/api/mod/quest` (move a quest; `:2688-2714`). No quest UI.
- `/api/mod/codes` (every codex code plus printable QR link; `:2645-2666`). **No printable wall-QR sheet** in the editor; this is how the wall facts and the LiveJournal get printed.
- `/api/mod/spatial/*` lives only in `/reinstall/map` (fine).

**The director on a phone.** A performer booth with admin elevation gets `who: admin` interactions (`views.ts:521`). But `/api/prime/act` **requires a guest target** (`event-runtime.ts:2407-2410`), so global cues (C1, glitch, "5-minute warning") can't be fired from a phone. The editor is desktop-first. **Proposal:** a phone "cue sheet" page (play app `?role=director` or a `/cue/` mini app) that lists `who: admin` INTERACTIONs **in source order with their labels**, plus big buttons, a confirm, and the current `Night.phase`.

---

## 3. Feature-by-feature detail and proposals

### 3.1 Push notifications with sound when the phone is locked (MISSING)

**Today.**

- **Alerts.** `broadcast "!…"` → `ChatMessage.alert` (`chat.ts:387-402`). The guest client picks new alerts (`codex.ts:42-46`) and plays a synthesized square-wave chime plus `navigator.vibrate` (`codex.ts:60-92`, `session.ts:496-510`). Banner auto-dismisses after 12 s.
- **Locked phone.** iOS Safari suspends the page and drops the `EventSource` (`client.ts:84-99`); nothing plays until the guest reopens.
- **Audio and vibration.** `AudioContext` needs a prior gesture. iOS has no `vibrate`.
- **Performers.** No alert path at all (`usePrimeSession`, `session.ts:837+`, never calls it).

**Proposal.**

1. **Installable app.** A PWA manifest plus a service worker for `play` (served at `/`; same origin as the API, so scope is simple). An "Install / Turn on alerts" step in onboarding: right after the CAPTCHA cutscene, or a step in Clippy's tour (`tutorial.tsx`).
2. **Web Push.**
   - **Server.** VAPID keys in env (`LOOM_VAPID_PUBLIC`/`_PRIVATE`), the `web-push` npm package, a `push_subscription` store per event in the state dir, keyed by guest id and by performer character.
   - **Routes.** `POST /e/:id/api/guest/push {subscription}` and `/api/prime/push`.
3. **Delivery rules.**
   - **Every alert.** Fan every `alert: true` message to the subscriptions of its audience (`"all"` = everyone). Alerts are already sparse by design.
   - **Story-addressed lines.** Optionally also DMs/cards addressed to one person, and performer-targeted alerts (door sensor, late programs).
4. **Platform reality.**
   - **iOS.** iOS 16.4+ only delivers Web Push to a **home-screen-installed** PWA, so onboarding must walk guests through "Share → Add to Home Screen". Web push on iOS plays the default notification sound (no custom sound).
   - **Android.** Chrome works without install.
   - **Transport.** Needs HTTPS (the Caddy deployment has it; a LAN-only night needs a cert or a tunnel).
5. **Fallback.** Twilio SMS for alerts (`LOOM_SMS_*`) for guests who decline. Optional, costs money.
6. **Performer alert parity.** Port `pickAlerts`/`playChime`/`vibrate` into `usePrimeSession`, and give performers an "alerts for me" filter (e.g. alerts scoped to their group).

Tests: core push fan-out unit tests (fake `web-push`), play onboarding step.

### 3.2 App Prompts C1/C2 (SUPPORTED by authoring; UX gap)

C1 = `call to the desktop` (exists). C2 = a second call (author `INTERACTION second call to the living room who: admin` + rule). **Proposal:** a cue sheet (above).

- **Labels.** Name each admin INTERACTION after the source prompt ("C1 · Initial call", "V3 · Bingo time", "Clippy 2/X").
- **Ordering and phase.** Render them in order, with the last-fired cue highlighted (track `Night.phase` and a `cue fired` log).
- **Placement.** The Director tab gains an **Interactions** section with labelled buttons (today only raw ids in a select).
- **Alert hint.** A hint that a `!` prefix makes a broadcast an alert.

### 3.3 Bathroom Mode (PARTIAL)

- **Real toggle.** One stateful INTERACTION: the button label flips with `self.afk`. That needs interactions with a visibility/label condition, e.g. `when: not self.afk` (new `InteractionDef.when`), filtered in `guestView`.
- **Placement.** A **dedicated 🚻 button in the identity-card HUD** (`guest.tsx:393-427`), not the ☰ sheet.
- **Visible to all.** Add `status`/`afk` to `PersonCard` and `PrimeGuest` (generic: `ROLE Program … badge: afk → 🚻`). Render it in People, who's-here, the booth's guest list, and the editor roster.
- **Auto-expiry.** e.g. 10 min → reminder; 15 min → antivirus alert. Needs relative timers (§3.5).
- **Summons exemption.** Authoring once deadlines exist: `when Night.summons_closed and self.location != The Desktop and not self.afk: …`.

### 3.4 Full-screen takeover (MISSING)

**Proposal.** A `takeover` widget kind: overlay, not answerable, full-viewport, flashing (CSS animation with a reduced-motion fallback).

- **Story:** `show takeover "GO TO THE LIVING ROOM" to everyone with flash: true`.
- **Clear:** a new `clear takeover for everyone` (or `hide card`).
- **Infra to add:**
  - generalize `pendingWidget(s.messages, "tutorial", …)` (`guest.tsx:476`) to any `overlay: true` kind;
  - render it above cutscene/shell, in performer booths too (optional);
  - add widget retraction (`ChatStore` "retracted" flag fanned out like `messageModerated`, `event-runtime.ts:2774-2793`).
- **Lock-screen reach.** Pair with Web Push so a locked phone is woken.
- **Terminals.** A terminal `takeover` mode on the same message (all screens flash the same thing).

### 3.5 Timers and countdowns (MISSING)

**Proposal.** Server-authoritative timers.

- **Language:**
  - `start timer The Hunt for 15m` / `start timer Midnight at 23:59:59 clock` (show clock);
  - `stop timer X`;
  - trigger `when timer The Hunt ends:`;
  - optional `when timer X has 5m left:`.
- **Sim:** a `timers` map {id, endsAtElapsedMs, label, visibleTo scope}; journaled start/stop; `tick` fires ends. Replay-safe because the clock is the sim's elapsed time.
- **Views:** `GuestView.timers[]`, `PrimeView.timers[]`, and `ModView.timers[]` = {id, label, endsAt (wall-clock epoch from server)}.
- **Play app:** a countdown strip under the identity card and in the cutscene, color shifting in the last minute, plus an alert at the end.
- **Terminal:** a `countdown` overlay (the "5-minute warning" on every screen).
- **Editor:** a timer panel with start/extend/stop, and an adjustable show clock.
- **Show clock.** The Y2K "system clock reset to 11 pm, Dec 31 1999" is a **show clock**: `Night.clock` starts at 23:00 when the director fires the reveal and runs at real time (or accelerated). Display it on phones and TV; `when clock reaches 00:00:` → the Y2K ending. This is a specific case of the timer above.

### 3.6 Physical presence / check-in (MISSING)

**Options**, all journaled `arrive`:

1. **Room QR (cheapest).** A printed QR per room: `?code=<event>&here=<LOCATION>`. The play app posts `POST /api/guest/checkin {location}` (new) → `arrive`. A per-run rotating nonce keeps it from being photographed and spammed from elsewhere. `/api/mod/codes` would list them next to codex QRs.
2. **Antivirus door scan.** An antivirus performer scans each arriving guest at the living-room door. `when scanned by program:` on the enforcer → `move program to The Desktop` while `Night.phase == "summons"`. Works **today** with authoring (`/api/scan` `event-runtime.ts:2342-2386`).
3. **Terminal check-in.** A terminal already scans the pass; also post `arrive` at its configured `spot` (map the house.json terminal id to a LOCATION).
4. **BLE / Wi-Fi presence.** Over-engineering for a house party; skip.

**Late list.** With real locations, a ROLE watcher, `when Night.summons_closed and self.location != The Desktop and not self.afk and not self.captured:`, can:

- `broadcast "!⏰ {self.name} is late" to group(Antivirus)`;
- `set self.late = true`;
- optionally `capture self`.

A **"Late programs" panel** (booth + editor) listing persons with `late` true would make it actionable. That needs the generic person badge from §3.3.

### 3.7 Judging truths at the Moments of Truth / Truth or Dare / Truth Pong (SUPPORTED by authoring)

Author three `who: performer` INTERACTIONs (they show as card actions on every guest in the booth and in the editor's performer lens):

- `accept an accurate truth` → `set program.truths += 1`, `set Night.accepted += 1`;
- `accept a confident truth` → also `set Night.false_truths += 1`, `set program.false_truths += 1`;
- `reject the truth` → `capture program` (to the Internet), `set program.rejections += 1`.

Plus Pong: `missed the cup` → capture; `made the cup` → `set program.may_answer = true`.

Truth or Dare: `chose dare` → capture; `spotted a false statement` → no-op/credit.

**Gaps.**

- **Which question?** `/api/prime/act` carries no args. Add optional `args` to `prime/act`, validated by `widgetResultArgs` (`event-runtime.ts:104-118`), and an `args:` spec on INTERACTION so the booth renders a picker ("Q1 / Q2 / Q3").
- **Tally view.** "Facts collected this round: 2/3, 1 confident-false" for the director and the TV. Authorable as globals today; needs a display (§3.8 board).
- **Featured programs** can't be judged (§0).

### 3.8 Trabolta's Trust Chart (PARTIAL)

- **Score.** Authorable: a ROLE watcher keeps `self.trust = self.truths * 10 - self.reinstalls * 5 + self.assessment`.
- **Assessment (±10).** Trabolta's model can't write `program.assessment` (adjust is limited to his own ranges, `event-runtime.ts:845-857`). Two ways:
  - declare a power `INTERACTION assess who: agent` with args `target, delta` and let the story clamp it (`acts` → `signal` with args, `:734-779`);
  - or have the director type it in the Inspector at the reveal.
- **Ranking.** No `max`/`argmax`/`sort` in the expression functions (`members`/`occupants`/`count`/`visits` only, `sim.ts:2408-2428`). Proposal: `top(n, <path>, <scope>)` / `bottom(...)`, or compute it in the board view.
- **Display — a `BOARD` declaration:**

  ```
  BOARD Trust Chart
    rows: everyone in role(Program)
    columns: Truths = self.truths, Internet = self.reinstalls, Assessment = self.assessment, Trust = self.trust
    sort: Trust desc
  ```

  - `ModView.boards` + `GuestView.boards` when public;
  - a `show board Trust Chart to everyone` card;
  - a terminal `view=board&board=Trust Chart` for the TV.

  The winner certificate ("print a PDF") is a VLC/printer gag (beans), so no software is needed beyond the board.

### 3.9 All-facts-accurate (SUPPORTED)

`Night.false_truths` (above) decides the finale branch in a `when the final reveal:` rule. Optionally fold in Trabolta's own ledger verdicts (the mind's fact ledger) via the director.

### 3.10 Faction recruitment with half+1 (PARTIAL)

- **Majority math.** `when count(members(The Resident)) >= Night.programs / 2 + 1 and not Night.majority:` with `Night.programs` incremented on `when someone joins`. Gotcha: should Antivirus and hosts count? Story choice. The story says "half + 1 of the programs".
- **Joining.** Groups are additive; `who.groups` exists.
- **Recruit flow (missing).** Today a guest can `join`/`defect` only **public** factions from the profile sheet (`guest.tsx:280-301`). The sides should start secret. Proposal:
  - a **pledge** interaction: the recruiter (Excel/OpenOffice) shows a "pledge QR" from their app, and the recruit scans it → confirm card → `add program to The Resident` + `when program pledges:`;
  - or the recruiter sends an invite to their faction's private channel (channel invites exist, `/api/guest/channel/invite`), and accepting = joining;
  - guests can see their own sides; Antivirus may or may not.
- **Unlock for the faction.** No group-scoped `unlock` or `for` loop. Use a ROLE watcher: `when Night.majority == "resident" and self in group(The Resident): unlock Trabolta's Heart for self`. Proposal: `unlock X for group(The Resident)` (scope form, like quests already take `<who|everyone|scope>`).
- **Security.** `/api/guest/join` should reject hidden/`joinable: false` factions (`sim.ts:293-300` has no check).

### 3.11 Per-character private missions at the glitch (PARTIAL → §0)

- **For persons:** an owner beat per featured program with the two-option choice from the Character Sheet:
  - Excel: "stay forever / sabotage" vs "address the virus / paranoid";
  - OpenOffice: "find the real risk" vs "malware is a false flag" (both → "get 20 facts");
  - DraftKings / Bugdom / Ask Jeeves: single prompts.

  Choices dock in their DM (`DecisionTray`), outcomes set vars and start quests. Fires from a ROLE watcher on `Night.phase == "glitch"` filtered by name. Works today if they're pool guests, with the reservation risk noted in §0.
- **"Truther Download" two minutes after dispersal.** Needs a relative timer (§3.5) or a director cue.

### 3.12 Private message to Clippy (MISSING; workaround)

- **Workaround today.** `CODEX Clippy Instructions 2 — Bingo Results` (text = the Google Doc content), then `unlock Clippy Instructions 2 for Clippy`. It shows only in Clippy's booth under "📓 What Clippy knows" (`performer.tsx:271-280`). The glitch warning ("we are all going to die") works the same way, while everyone else gets the reassuring broadcast.
- **Proposal.** A performer-addressed channel:
  - `tell Clippy "…"` / `broadcast "…" to performer(Clippy)` → a message on a `cue:Clippy` channel;
  - visible only to that booth (extend `visibleToPrime` with a `@<Character>` audience rule; the agent `cast:` threads already use `@<C>` audiences, `event-runtime.ts:125-129`, `session.ts:766-771`);
  - alert-capable, plus a booth "📋 Instructions" room;
  - lets the director post to it from Chat.

### 3.13 Truthcoin (MISSING)

- **Declaration.** `CURRENCY Truthcoin (symbol: ⓣ, start: 100)` → per-person balance `self.truthcoin` (or reuse `score`).
- **Display.** Shown in the identity card (generalize the ⭐ slot).
- **Routes.**
  - `POST /api/guest/give {to, amount, note?}` → journaled `give` → `when program gives …`;
  - `POST /api/guest/offer {to, give:{coin|entry}, want:{coin|entry}}` + accept/decline → an atomic **trade** (sell a fact for coin; this is DraftKings' "facts traded for Truthcoin");
  - a **wager**: two parties stake, a host or the story settles (`settle wager N for winner`).
- **Story hooks.** `when self.truthcoin >= 1000:` completes DraftKings' quest.
- **Editor.** Balances + a ledger in the Inspector, director grant/fine.
- **Show integration.** Moments of Truth can pay coin (`set program.truthcoin += 50`).

### 3.14–3.17 Codex-based tracking (SUPPORTED by authoring)

- **Scrambled facts.** Author scrambled variants; optionally a `scrambled: true` render style in the play app.
- **LiveJournal reader.** Codex + `learns` hook. "One of you read my LiveJournal and I know who" → Trabolta's agent can read `Night.lj_reader` from `/api/agent/facts`.
- **OpenOffice's 20 facts.** `self.codex >= 20` watcher (person only).
- **Excel's virus plant.** Director cue or hardware (the "USB glory hole" note → a USB port sensor → stagehand → `signal("virus planted", subject)`). The subject is hard for hardware to know; the director confirms who.

### 3.18 End-of-night summary (MISSING)

**Proposal.** A `recap` control on the stagehand agents worker (sibling of `survey`).

- **Inputs:** `/api/agent/facts`, the mind dossiers, the ledger (`/api/history` + `GET /api/mod/agent/trace`), and the run export.
- **Output:** three artifacts:
  1. **Clippy's purgatory script.** Delivered as a private codex/instructions entry to Clippy (§3.12), or printed.
  2. **Trabolta's recount.** Spoken on the TV terminal via TTS; needs an "announce" mode on terminals (they currently only speak replies in a piloted thread).
  3. **truth.txt.** The Bag of Truth contents, for printing just in time (Trabolta's backstory + why each person was brought in), personalized from real chat.
- **Editor.** A "Recap" panel in the Mind tab: generate → edit → publish/print.
- **Deterministic floor.** A pure-TS `recap.ts` that builds a structured summary (per program: identity, faction, truths, Internet visits, quests done, codex held, notable lines) for when the model is down.

### 3.19 Pickup line (PARTIAL)

- **Fastest fix:** make `foldCode` also strip punctuation (`'’.,!?`), then use a codex code. Or add a **text-answer widget** (`show answer "Give me a pickup line that works on Sandy" to everyone with accept: "you're the one that I want"`), judged server-side with folding, firing `answer answered` with `correct`.
- **Story-wide alternative:** `when program says "…" in dm:Trabolta:` (typed-chat triggers). Riskier: chat volume, and the agent also hears it.

### 3.20 Director events with arguments (SUPPORTED)

The Director tab parses `k: v` args (`tabs.tsx:907-958`) → `/api/mod/signal {name, subject, args, actor}` (`event-runtime.ts:2739-2758`).

### 3.21 Human identity reveal (PARTIAL)

- **Named characters.** Per-character backstories already exist as codex. The finale can `unlock The Real Randy Barkmore for everyone`; no `for everyone` form yet, so use a watcher or the scope proposal in §3.10.
- **Pool guests.** Collect a human backstory at the door with a **text widget** ("Why did you accept Trabolta's invitation?") stored as `self.human_reason`. The same widget fixes the pickup line and gives Trabolta's recount material.

### 3.22 Monitors / terminals (PARTIAL; summary for the hardware checklist)

Terminal already has the world view, mirror, face, pilot, and TTS. Missing for V1–V6:

- **`view=screen`.** A cue-driven media player: video/image/slide/web/countdown/board/takeover, from a `SCREEN`/media list in the story. Story: `screen show "ad-hijack.mp4" on everyone|<terminal ids>`; `cue: screens …` already reaches stagehand OSC, but terminals don't listen.
- **Listen to the mod SSE for `alert` broadcasts** and flash them.
- **Screen Wake Lock** plus fullscreen/kiosk guidance (no `wakeLock` anywhere in `terminal/src` or `reinstall/web/src`).
- **Announce mode.** Speak a story line or recap as Trabolta on the TV with the face, unprompted.
- **Check-in** at the terminal's spot (§3.6).

---

## 4. Prioritized build list (software)

**P0 (the show can't run as written without these)**

1. **Featured programs** (§0): guest identity + character hooks + reserved claim codes.
2. **Relative timers + visible countdowns + show clock** (§3.5).
3. **Check-in / presence**: room QR and/or antivirus door scan authoring; terminal check-in (§3.6).
4. **Performer alerts** (chime/vibrate/banner in booths) and a **performer-private channel** (Clippy instructions, malware warning; §3.12).
5. **Takeover widget** + widget retraction (§3.4).
6. **Web Push via PWA** (§3.1). Strongly recommended: the summons, the 5-minute warning, and the blackout "Go to the living room" all depend on reaching locked phones.

**P1 (needed for the scoring and the endings)**

7. **Truthcoin** (give / trade / wager) (§3.13).
8. **BOARD** declaration + terminal `view=board` + `top()`/`bottom()` (§3.8).
9. **Recruit/pledge flow**, `unlock … for group(…)`, guarded `/api/guest/join` (§3.10).
10. **Text-answer widget** + punctuation-insensitive `foldCode` (§3.19, §3.21).
11. **`args` on `prime/act`** + INTERACTION arg pickers (per-question judging) (§3.7).
12. **Cue sheet**: Director tab labelled, ordered admin interactions; a phone cue page; `!`-alert hint (§3.2).
13. **Editor UI for `/api/mod/codex`, `/api/mod/quest`, and a printable `/api/mod/codes` QR sheet** (§2).

**P2 (polish)**

14. **Recap generator** (stagehand `recap` + deterministic `recap.ts` + Mind-tab panel) (§3.18).
15. **Terminal `view=screen`** media/ads/questions + alert flash + wake lock + announce mode (§3.22).
16. **Bathroom Mode as a HUD toggle** with visible badge + auto-expiry (§3.3); generic person badges/status.
17. **Stateful INTERACTION labels/visibility** (`when:` condition on INTERACTION).
18. **Guest-targeted interactions** on People cards (Bugdom "report a bug", accuse); today guests can only Message.
