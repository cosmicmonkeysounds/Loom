> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.

# Push for every device · the Recap + Awards Ceremony · DM lies count (#33)

Three designs grounded in the code as of `fba382b`, following the user's binding answers
(#13/#14 TV = Trabolta's display with 16-ch room audio, #15 old Android tablets, #16 VPS,
#22 Clippy *and* the director judge, #25 push for all devices, #26 a Mario-Party ceremony with
genuine-but-scripted Trabolta lines over live stats, #33 DM lies count). Paths are relative to
`packages/loom/`; `ex/` = `core/examples/trapped-in-the-internet/`. Builds on
`app-admin.md` §3.1 / §3.18 and `trabolta.md` §1.4–1.6 / §2.10 (whose #33 recommendation,
"no", is reversed by the user).

New checklist ids take the next free number per section (current maxima: PLAY 18, ADM 10,
AI 16, ENG 14, SCR 26, RE 13, STORY 14, OPS 16). SW-PLAY-02 stays as the umbrella and is
ticked when its children land.

---

## 1. Push notifications for all devices (Web Push on the VPS)

### 1.1 What exists, and the constraints

- The only alert is in-page: a `!` broadcast cue → `ChatMessage.alert` (`core/server/chat.ts`
  `splitAlert`, ~l.254/390) → the guest client's `pickAlerts` / `playChime` / `vibrate`
  (`play/src/codex.ts`, `play/src/session.ts:497-503`). Performers never call it
  (`usePrimeSession`, `session.ts:837`). There is no service worker or manifest
  (`play/index.html`).
- Every message reaches clients through one choke point,
  `EventRuntime.deliverMessage` (`core/server/event-runtime.ts:521-531`), fed by `fanout`
  (`:558`). Push hooks in **beside** the SSE send.
- The server serves play at `/` from an allowlist (`core/server/server.ts:338-356`: `/`,
  `/index.html`, `/assets/*`, `/favicon.ico`). `.webmanifest` already has a content type
  (`server.ts:121`). The CSP is `default-src 'self'` (`core/server/routing.ts:7-19`), so
  `worker-src` and `manifest-src` already fall back to `'self'`. No CSP change is needed.
- Every restart is a cut: `restart()` clears `guestTokens`, ends guest streams, and on
  `golive` signs performers out (`event-runtime.ts:1422-1470`). Push bindings must follow the
  same cut.
- **VPS (#16):** push leaves the VPS straight to FCM / APNs (`web.push.apple.com`) / Mozilla.
  There is no house dependency, and it works on cellular data. HTTPS comes free from the Caddy
  proxy (SW-OPS-02).
- **iOS reality.** iOS 16.4+ delivers Web Push **only to a Home Screen web app**. Permission
  must be requested from a tap *inside* the installed app. **The installed app has its own
  storage, separate from Safari.** A guest who registered in Safari opens the Home Screen icon
  and is *not signed in*. This one fact shapes the onboarding (1.4). Android Chrome pushes from
  a normal tab and shares storage with an installed PWA.

### 1.2 Who gets push

| Device | Push? | Why / how |
|---|---|---|
| Guests (iPhone) | **yes**, after Add to Home Screen | install-first door flow (1.4) |
| Guests (Android) | **yes**, in the tab | `Notification.requestPermission()` from a tap |
| Performers' booths (Antivirus, hosts, Clippy) | **yes** | same play app, `usePrimeSession` registers; crew install during training (SW-OPS-12) |
| Directors (editor at `/edit/`) | **yes** (desktop Chrome / macOS Safari, no install needed) | own `/edit/sw.js`, scope `/edit/` |
| Wall terminals (old Android tablets) | **no** | always-on kiosks on SSE + the screen stream. Old WebViews / Fully Kiosk push support is unreliable, and a push to a lit screen adds nothing. Takeovers reach them through ScreenHub (SW-SCR-03/14). |
| The TV computer | **no** | same as terminals |

### 1.3 Server: `PushHub` (new `core/server/push.ts`, transport-free like `SpatialHub`)

- **Lib + keys.**
  - `web-push` (MIT, npm) in `@loom/core`.
  - Env: `LOOM_VAPID_PUBLIC_KEY`, `LOOM_VAPID_PRIVATE_KEY`,
    `LOOM_VAPID_SUBJECT=mailto:webmaster@mapsandducks.com`.
  - Generate once (`npx web-push generate-vapid-keys`) and **pin in `.env`**. Rotating the
    keys silently kills every subscription.
  - No keys → the hub is disabled and every route returns `503 {push: false}`; the in-page
    alerts keep working.
- **Store.** `LOOM_STATE_DIR/<eventId>/push.json`, written like `guests.json`
  (`persistGuests`, `event-runtime.ts:1147`). One row per **device** (keyed by a hash of the
  endpoint):
  ```ts
  interface PushRow {
    key: string;                       // sha256(endpoint)
    sub: { endpoint: string; keys: { p256dh: string; auth: string } };
    role: "guest" | "prime" | "mod";
    bind: string | null;               // guestId | character | author user id; null = unbound (after a cut)
    ua: string; createdAt: number; lastOkAt: number; failures: number;
    visibleAt: number;                 // last "I'm on screen" heartbeat (quiet rules)
  }
  ```
  One device, one row. Re-registering on the same phone (the same endpoint from
  `pushManager.getSubscription()`) **rebinds** it.
- **Routes** (all JSON, same auth as their neighbours):
  - `GET /api/push/key` → `{publicKey}` (unauthenticated, global).
  - `POST /e/:id/api/guest/push {subscription}` (guest token), `POST /e/:id/api/prime/push`
    (booth token), `POST /e/:id/api/mod/push` (mod token or author session).
  - `DELETE` on each to unsubscribe.
  - `POST /e/:id/api/{guest,prime}/visible {visible}`: a 10 s heartbeat while the page is
    visible, also sent on `visibilitychange`.
  - `POST /e/:id/api/mod/push/test {to}` → a test push to one row or a whole role.
  - `GET /e/:id/api/mod/push` → counts per role, unbound rows, last delivery, failures (feeds
    SW-ADM-11).
- **Fan-out.** `deliverMessage(m)` also calls `push.offer(m)`. `offer` resolves recipients
  with the **same** visibility functions SSE uses: `visibleTo(m, guestId)` for guest rows,
  `visibleToPrime(m, …)` for booth rows (`event-runtime.ts:120`), and directors by a mod
  rule. It then queues the sends **off** the fanout path: an async queue, concurrency 8, so
  sending to 60 devices never stalls the event loop.
- **What pushes** (the policy, all server-side):

  | Class | Source | Recipients | Urgency / TTL | Collapse tag |
  |---|---|---|---|---|
  | **Alert** | any `alert: true` message (`!` broadcasts: C1, the summons, the 5-minute warning, GO TO THE LIVING ROOM, the clock warnings) | its audience | `high`, TTL 300 s (a summons 20 min late is worse than none) | `alert:<seq>` |
  | **Takeover** | the new `takeover` widget (SW-PLAY-04) | its audience | `high`, TTL 120 s, `requireInteraction` (Android) | `takeover` (replaces) |
  | **Staff alert** | an alert to `performer(G)` / `staff(G)` (**needs SW-ENG-08**): the door alarm to the Antivirus, the late list, Bathroom over-time | those booths + directors | `high`, TTL 300 s | `staff:<seq>` |
  | **Personal** | a `line` / `widget` / `codex` / `quest` message addressed to exactly one guest (a DM from a character, Trabolta's agent reply, a decision card, a codex unlock, a quest step) | that guest, **only when quiet rules allow** | `normal`, TTL 900 s | `thread:<channel>` / `codex` / `quest` |
  | **Explicit** | new statement `notify <who> "text" [urgent]` (SW-ENG-15), for story-chosen nudges such as "Clippy is looking for you" | `<who>` | as written | `notify` |
  | **Lifecycle** | `restart` / `golive` / `ended` | every bound row before the cut (so unbound after it) | `high` | `lifecycle` |
  | **Director** | the answer review queue (§3), the agent worker going offline, stagehand offline (SW-ADM-06), the door alarm | mod rows | `high` | `dir:<kind>` |

- **Quiet rules** (the point is to wake a locked phone, not to double every message):
  1. **Visible → no push** for Personal / Explicit-normal. A row whose `visibleAt` is under
     15 s old gets the in-page chime instead. Alerts, takeovers, staff alerts and lifecycle
     *always* push. Alerts are sparse by design.
  2. **Rate limit**: at most 1 non-urgent push per device per 60 s. Extra ones collapse into
     the tag ("3 new messages from Trabolta"). Never more than 1 Trabolta push per 2 min per
     guest.
  3. **Bathroom Mode** (`program.afk`): suppress non-urgent pushes. The summons alert still
     pushes; the story already exempts AFK programs from lateness, so the push is
     information only.
  4. **Paused event**: hold non-urgent pushes; alerts still go. **Ended**: one lifecycle push,
     then silence, and the rows are purged when the event's state dir is.
  5. **No secrets in payloads** (≤ 4 KB): `{title, body ≤ 140 chars, tag, url, urgent}`. Never
     `via`, never hidden messages (already withheld by `visibleTo`), never Kernel.
  6. **Failures**: 404/410 → delete the row. 429/5xx → exponential backoff, 3 tries, then
     `failures += 1`. 5 consecutive failures → delete.
- **Restart / cut semantics.**
  - **reset / reload:** send the lifecycle push ("The story restarted. Tap to rejoin.") to
    every bound guest row, then set `bind = null`. The rows stay. When the guest re-registers
    on that phone, the client re-POSTs its existing subscription, which rebinds it. Booth rows
    keep their binding (booths survive a reset).
  - **golive:** the same, and booth rows unbind too, matching the sign-out at `:1446-1453`.
  - **Purge:** unbound rows older than 6 h are purged on boot, so rehearsal phones that never
    rejoin fall away.
  - **ended:** one "The night is over" push, then the file is deleted.
  - **Determinism:** pushes are never journaled. A replay on boot must **not** re-push
    history. `offer` is skipped while `restore` replays the journal, gated by a `replaying`
    flag.

### 1.4 Clients

- **play (guests + booths)**
  - **Push-only service worker**, `play/public/sw.js` (Vite copies `public/` to `dist/`
    root). `server.ts` serves `/sw.js` with `cache-control: no-cache` and
    `service-worker-allowed: /`. The worker handles `push` and `notificationclick` (focus an
    open client or `clients.openWindow(url)` to deep-link `?code=…&room=<channel>`).
    **No `fetch` handler**: a root-scope worker also covers `/terminal/`, `/reinstall/` and
    `/edit/`, and caching would also risk a stale app mid-show.
  - **Dynamic manifest** `GET /manifest.webmanifest?code=<CODE>`: `display: standalone`,
    `start_url: /?code=<CODE>`, the theme colour, and 192/512 icons (`play/public/icons/`).
    `index.html` sets `<link rel=manifest>` from the URL's `code` before React mounts. The
    guest passcode is public (it's on the posters), so templating it into the manifest leaks
    nothing.
  - **Door-step onboarding (iOS, install first):**
    - If `isIosSafari && !isStandalone` (`navigator.standalone` /
      `matchMedia('(display-mode: standalone)')`), the code screen shows an **InstallGate**
      *before* the cast pick: three illustrated steps (Share → Add to Home Screen → open
      "Maps And Ducks"), plus "Continue without alerts".
    - The guest then joins **inside** the Home Screen app, so the session and the
      subscription live in the same storage.
    - Door signage and the Mud Room QR poster say the same thing (print item; SW-QR).
  - **Turn on alerts = a story card.** A new widget kind `alerts`:
    - Authored: `show alerts "Allow the computer to interrupt you." to program with guide: "Clippy"`.
    - It renders one button. The tap calls `Notification.requestPermission()`, then
      `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})`, then
      `POST …/guest/push`.
    - It answers `{granted: true|false|"unsupported"}` through the existing
      `/api/guest/widget` route (`event-runtime.ts:2141-2171`), so `when alerts answered for
      program:` lets the story react (Clippy remembers refusers; `doubt += 5`).
    - It sits in the Mud Room cutscene right after the CAPTCHA (story edit in
      `ex/beats/entrance.loom`). A ☰ "🔔 Alerts" toggle in the profile sheet is the manual
      path.
  - **Safari → Home Screen handoff** (fallback for anyone who joined in Safari first):
    - It reuses N-02's **single-use pair code** (`core/server/routes/n02.ts`, `Pairing`), never
      a token in a URL: `POST …/guest/handoff` (guest-authenticated) mints a pair code for the
      calling guest — ten minutes, one use, a newer code voids the older, in memory and cut by
      every restart like `guestTokens`.
    - The manifest `start_url` becomes `?code=<event>&pair=<code>`.
    - The first launch of the installed app trades it at `POST …/guest/resume {pair}` for a
      **fresh** guest token (410 when spent or expired; throttled like a sign-in) and strips
      `pair=` from the URL. The Safari session keeps its own token.
  - **Booths:** `usePrimeSession` registers the same way and gets the in-page alert parity of
    SW-PLAY-03 (chime / vibrate / banner on booth-visible alerts).
- **editor (directors):**
  - `editor/public/sw.js` (scope `/edit/`, push + click only).
  - A 🔔 toggle in the Run header that registers with `/e/:id/api/mod/push` while the run is
    attached (`store/operate.ts`).
  - Run → Front of house gains a **Push** card: subscribed per role, unbound, last delivery, a
    test button, and "iPhone guests not installed" (rows with `ua` iOS and no push).

### 1.5 Tests and size

- core `push.test.ts` with a fake sender:
  - audience resolution (an `all` alert, a faction alert, a DM, a staff alert to Antivirus
    booths);
  - quiet rules (visible suppression, rate limit / collapse, afk, paused);
  - restart unbinding + lifecycle push + rebind on re-register;
  - no push during `restore`;
  - 410 deletes the row;
  - no `via` / hidden text in payloads.
- play `install.test.ts` (UA / standalone detection, manifest URL), `alerts` widget in
  `widgets` tests.
- A live check on an iPhone (Home Screen) and an Android over **cellular** against the VPS
  (SW-OPS-07 already lists "C1 → every locked phone wakes").

**Size: L overall (~7–9 days).** PushHub M · play SW / manifest / InstallGate / alerts card M ·
handoff S · booth + editor registration S · ops / keys / device test S.

---

## 2. The Recap + Mario-Party Awards Ceremony

### 2.1 Shape (what guests see)

A director-paced (or Clippy-paced) show on the TV, mirrored as cards on every phone. It runs
**after the ending**, like Mario Party's bonus stars before the winner, and lasts 8–12 min:

| # | Segment | TV | Phones | Who speaks |
|---|---|---|---|---|
| 0 | **Cold open** | host face + title card "SYSTEM REPORT: THE NIGHT OF 31/12/1999" | "The ceremony is starting" takeover → living room (push urgent) | host, 1–2 lines |
| 1 | **The night in numbers** (stats reel) | 6–8 animated counters: programs uploaded, facts requested / accepted, Internet visits, codex entries unlocked, Truthcoin in circulation, alarms tripped, ducks found, messages sent, quests completed | a summary card | host, one line per 2–3 stats |
| 2 | **Awards** (5 fixed + 3 bonus drawn live, as in Mario Party) | category slide → the top 3 nominees with values → drumroll → winner reveal (photo = avatar) | award card in the lobby. **The winner** gets a takeover ("⭐ You won Frequent Flyer!") + a **trophy codex entry** in their Codex | host, ≤ 35 words per award |
| 3 | **What really happened** (finale recap, per ending) | the ending's template: identities / motives / who planted / who read the LiveJournal / which faction won / the verdict | — | host; identity facts are fixed text, the host only wraps them |
| 4 | **Superstar** (the overall winner = top of the Trust Chart; tie → most facts accepted) | crown animation + fanfare | winner takeover | host |
| 5 | **Curtain** | credits: cast (performers + featured programs with their humans) and crew | "Thanks for playing" + the Codex stays open | host + `lights_restore` |

**Awards** (each is an `AWARD` declaration, 2.3; min thresholds so nobody wins with zero):

| Award | Metric (higher wins unless noted) | Source |
|---|---|---|
| Most Trusted | `trust` | ROLE slot (TRUST FORMULA) |
| Least Trusted (lowest) | `trust` asc | ROLE slot |
| Frequent Flyer to the Internet | `internet_visits` (min 1) | ROLE slot |
| Lore Hoarder | codex count (`program.codex`) | engine mirror |
| Truthcoin Tycoon | `score` | engine key |
| *Bonus pool, 3 drawn with a seeded shuffle:* | | |
| Best Liar *(revealed only now)* | confident lies accepted (MoT + DM, §3) | **journal**: `confident_lie` signals + `answer_filed {verdict: lie}` per subject |
| Golden Duck Speedrun (lowest) | fastest begin → found in the reinstall game | **spatial run log** (new, 2.4) |
| Faction MVP | winning faction: its leader if their task was done (`Kernel.excel_planted` / `openoffice_dossier`), else its member with the top `trust` | Kernel + groups |
| Trabolta's Pen Pal | lines sent to `dm:Trabolta` | journal `say` |
| Chatterbox | typed lines anywhere | journal `say` |
| Most Generous | codex shares given | journal `share` |
| Quest Completionist | quests done | `Sim.questsFor` |
| Bathroom Champion | total minutes in Bathroom Mode | journal `go to the bathroom` / `back from …` pairs |
| Bingo Royalty | `bingo` + ribbons | ROLE slot / `award_the_ribbon` signals |

If `Kernel.lies_accepted == 0`, Best Liar is swapped for **Spotless Record** (shared by every
program with ≥ 1 accepted answer).

**Host by ending** (spec §5 endings):

| `Night.ending` | Host | Tone |
|---|---|---|
| `disabled` | Trabolta, weakened and decrepit (absorbs today's `Trabolta Recounts` beat, spec §3 E4) | faint, kind, final |
| `destroyed` | **Clippy** reads "the summary auto-generated from the chat app" (spec E8, OV verbatim). The same data; Trabolta's line is dark. The script is written in a dry machine-report voice and appears on **Clippy's booth teleprompter**. | purgatory deadpan |
| `song` / `song_pickup` / `help` / `hand_jive` | Trabolta, triumphant / in love | showman |
| `rave` | Clippy (Trabolta left on his motorcycle). Sandy's single line is the stinger. | stranded party |

### 2.2 Architecture

```
 sim + journal + spatial run log ──► recap.ts (pure)  ──► RecapStats (frozen snapshot)
                                                │
              AWARD decls (story) ──────────────┤
                                                ▼
                                   CeremonyHub (server state: segments, cursor, lines)
                     ┌───────────────┬───────────┴──────────┬───────────────────┐
         agents SSE `compose` ─► stagehand ceremony.py ─► POST /api/agent/compose   │
            (host = mind: external)  (strict JSON, per-slot caps; validated server-side)
                     │                                                         │
          fallback templates (deterministic, always present)            director edits
                     ▼                                                         ▼
     TTS pre-render (/api/mod/tts cache) ─► ScreenHub `ceremony` program ─► TV (face + voice, room audio)
                                       └──► phone cards / winner takeovers / trophy unlocks (journaled)
```

### 2.3 Language (SW-ENG-16): `AWARD` + `start ceremony`

```loom
AWARD Frequent Flyer
  title: Frequent Flyer to the Internet
  by: self.internet_visits          // an expression per program, or `stat <metric>` (journal metrics below)
  order: desc                       // desc (default) | asc
  min: 1                            // the winner's value must reach this
  blurb: Most trips to the Internet.
  trophy: The Frequent Flyer Miles  // optional CODEX unlocked for the winner
  bonus: false                      // true → in the bonus pool

AWARD Best Liar
  title: Best Liar
  by: stat lies
  min: 1
  bonus: true
  trophy: The Golden Tongue
```

- **Statements:** `start ceremony hosted by Trabolta` / `hosted by Clippy`; `next ceremony`
  (for the story or the director). **Events:** `when ceremony starts:`, `when award X is
  won by program:` (subject = winner), `when ceremony ends:`. An award won → `unlock <trophy>
  for winner` + the takeover card. It is journaled, so a restart mid-ceremony rebuilds it.
- **Built-in `stat` metrics** (computed by `recap.ts` from the journal, never world vars, so
  no lie count ever sits on a program var the orchestrator reads, spec §2.7): `lies`,
  `duck_time`, `lines`, `dm_lines:<Character>`, `shares_given`, `quests_done`,
  `afk_minutes`, `wrong_codes`, `captures`.
- **Ranking** is the same pure helper that powers `top()` / `bottom()` (SW-ENG-04) and
  `BOARD` (SW-SCR-11). Build it once. Ties: the earlier achiever by journal seq wins; else a
  shared award.
- Like INTERACTION, AWARD is a declaration kind with a raw body; the bank compiler diagnoses
  it as ignored (as it does for watchers).

### 2.4 Server

- **`core/server/recap.ts` (pure, SW-AI-17):**
  - `computeRecap(sim, journal, spatialRuns, now) → RecapStats`:
    `{totals{…}, programs[{id, name, human?, featured, faction, groups, metrics{trust,
    internet_visits, codex, score, lies, duck_time, …}, awards[]}], kernel{lies_accepted,
    q1..q8, virus_planter, majority, all_accurate}, ending, firsts{first_reinstall,
    first_found, lj_reader, bobber}, factions[{name, members, won}], timeline[{at, what}]}`.
  - It runs in Node and in the browser, so the local Sim (`editor/src/store/sim.ts`) gets a
    deterministic preview for free.
  - `GET /e/:id/api/mod/recap` (mod-gated) returns it. It is also used by the Log export and
    by SW-OPS-16 (publish the recap).
- **Spatial run log (SW-RE-14):** `SpatialHub` keeps `startedAt` / `foundAt` per session
  only while it lingers (`core/server/spatial.ts:93-95, 378-380`). Append
  `{person, startedAt, foundAt, device}` on `found` / `end` to
  `LOOM_STATE_DIR/<id>/spatial-runs.jsonl` (cut by restart like the journal).
- **`CeremonyHub` (new `core/server/ceremony.ts`, SW-AI-18):**
  - State: `{status: idle|preparing|ready|presenting|done, host, stats (frozen), segments[{id,
    type, facts, slots[{name, maxWords}], lines{slot: {text, source: llm|fallback|edited}},
    audio?}], cursor, bonusSeed}`.
  - **Prepare** (director button, or automatically on `when … ending` once `Night.ended`):
    freeze the stats, build the segments, fill **every slot with its fallback template at
    once** (the ceremony is always presentable), then ask the host to compose.
  - **Compose request** on the existing agents stream as a new SSE event, so it is not a
    thread `request`:
    `compose {id, character, kind: "ceremony", ending, segment: {id, type, facts, slots,
    tone}, names: [every allowed proper name]}`.
    - The answer comes back as `POST /api/agent/compose {id, worker, lines: {slot: text}}`.
    - `AgentHub` gets a tiny compose queue (same online / timeout logic, 20 s timeout, one
      retry).
  - **Validation** (server side; on failure the fallback stays):
    - each slot ≤ `maxWords` (hard cut at a sentence boundary);
    - every **number** in the text must appear in the segment's facts;
    - every **Capitalised multi-word name** must be in `names`; no URLs;
    - no `Kernel`, no hidden-faction names before they were revealed.
  - **Host is not an agent** (Clippy): compose still goes to the Trabolta worker with
    `voice: "system-report"`, matching OV's "auto-generated from the chat app". The lines
    route to Clippy's booth teleprompter instead of the TV voice.
  - **Present:** `next` / `back` / `goto` (director in Run → Ceremony, or Clippy's booth). Each
    step pushes a ScreenHub `ceremony` program (TV + speaker terminals), a phone card into
    the lobby / Desktop room, and for awards a journaled `signal("award won", winner, {award})`
    (story hook: trophy unlock + takeover).
  - **Audio:** the voice is **pre-rendered at prepare time** through the existing
    `/api/mod/tts` LRU (`core/server/tts.ts`). A slow or failed TTS mid-ceremony can't
    stall it, and the VPS↔Kokoro link (SW-AI-15) is used before the ceremony, not during it.
    Fanfare / drumroll go out as `sound` cues → stagehand → the TV computer's
    multichannel outs (living room).
- **Before the ending:** `prepare` is refused unless `Night.ended == true` (or the director
  forces it with a typed confirm in rehearsal), so "Best Liar" can never leak a lie early.

### 2.5 Stagehand (`stagehand/src/stagehand/agents/ceremony.py`, SW-AI-19)

- `Agents.on_frame` (`module.py:512`) gains `compose` → `ceremony.compose(persona, mind, doc)`.
- **Prompt:**
  - the system prompt is the persona voice rules + `ending` tone + "You are presenting an
    awards ceremony. Use ONLY the FACTS. Never invent names, numbers or events. Each slot is
    at most N words. Speak as yourself, aloud, to a room.";
  - then the facts as a compact table;
  - then **mind colour** (dossier one-liners for the named programs, the arc stage), so the
    lines are genuinely *his* ("I trusted Ada more than my own firmware").
- **Output:** strict JSON `{"<slot>": "…"}`.
  - Ollama native `format: <JSON schema>` (structured output) on the orchestrator model, or
    `response_format: json_object` on the voice model (`llm.py:183/244` already wire
    `json_mode`). Per-slot `maxLength` sits in the schema.
  - `temperature: 0.8`, `reasoning_effort: low`. Run ≤ 2 segments in parallel (the
    `_slots` semaphore).
- Every call is a recorded `Thought` of new kind `compose` (`agents/trace.py`; the server's
  `THOUGHT_KINDS` set, `agents.ts:341`, gains `compose`), so the Mind page shows what he
  wrote and why.
- The worker validates too (word caps, JSON), then posts. Silence or bad output → the server
  keeps the fallback.
- **Budget:** ~12 segments × 2–6 s ≈ 30–60 s. Prepare during the dance song.

### 2.6 Clients

- **Run → Ceremony tab (SW-ADM-12):**
  - Prepare → a progress bar per segment ("LLM / fallback / edited" chips), with each line
    editable inline and **Regenerate** per segment.
  - Present: big Next / Back, auto-advance with the TTS duration, the current slide preview,
    and "skip award".
  - Bonus draw: re-roll before presenting.
- **Clippy's booth (SW-PLAY-23):** a **Script** sheet (teleprompter of the current segment)
  with Next / Back when she is the host, or when the director hands her control (#22:
  both can drive).
- **Phones (SW-PLAY-23):** `ceremony` message kind (stats card, award card with nominees +
  winner, superstar). The winner's takeover reuses SW-PLAY-04. The trophy lands in the Codex
  room.
- **TV (SW-SCR-27):** a `ceremony` ScreenHub template: Win98 "Award.ppt" frame, counters,
  nominee row with avatars (`AvatarBook`), the reveal animation, Trabolta's face
  (`terminal/src/face/`) driven by the pre-rendered audio level, and captions. Needs
  SW-SCR-03 (ScreenHub) + the TV-voice work of SW-SCR-17 (now justified by #13).

### 2.7 Story content (SW-STORY-15)

- The 5 fixed + ~9 bonus `AWARD`s, each with a fallback line template
  (`blurb` + "{winner}, with {value} {unit}").
- ~10 trophy CODEX entries (`codex/9-trophies.loom`; never `about: Trabolta`).
- `INTERACTION start_the_ceremony who: admin` (Cue sheet "F9 · Ceremony").
- In each ending beat: `start ceremony hosted by …`. Today's `Trabolta Recounts` (E4) and
  `Purgatory` (E8) prose becomes segment 3's fixed identity text plus the fallback.
- The phase `ceremony`, with a mind `phases:` cue ("You are presenting the night's awards…").
- **Tests:**
  - core `recap.test.ts` (metrics from a scripted run incl. MoT + DM lies, duck times,
    ties, min thresholds);
  - `ceremony.test.ts` (prepare → fallbacks present → compose accepted / rejected by
    validation → present → award signal → trophy unlock; refused before `Night.ended`;
    restart mid-ceremony);
  - stagehand `test_ceremony.py` (prompt carries only the facts, schema, caps, fallback on
    junk);
  - an e2e-live spec that runs a ceremony with a real worker.

**Size: L overall (~9–12 days).** recap.ts + spatial log M · AWARD / ceremony language M
(shared with SW-ENG-04) · CeremonyHub + compose route + validation M · stagehand ceremony.py
M · Run tab + booth teleprompter + phone cards M · TV template M (after ScreenHub) · story S.
The **deterministic floor** (recap.ts + fallback templates + Run tab, no LLM, no TV template)
is ~4 days and is worth landing first.

---

## 3. DM lies count toward `Kernel.lies_accepted` (#33)

### 3.1 The problem

- **Today the only judged answers are at the Moments of Truth.** Six per-question buttons →
  `accurate_truth` / `confident_lie` (`ex/main.loom:323-404`, spec §3 B8). These record
  `Kernel.q1..q8` (lies sticky), `Kernel.lies_accepted`, `program.truths_accepted`, the
  TRUST FORMULA, `Trabolta.truth += 4`, and an identical public broadcast / reply.
- **What changes.** The user wants a confident false answer told to Trabolta in a DM to count
  as well.
- **The constraint.** The AI must never learn which answers were lies:
  - **Kernel** vars are excluded from agent requests (`event-runtime.ts:622, 679`).
  - **The hunt answers** sit outside the orchestrator's 24-entry `lore_block` on purpose
    (`ex/codex/3-hunt.loom:8-10`; `stagehand/…/orchestrator.py:297-311`).
  - **`lookup: false`** stays until the secrecy fix lands (SW-AI-02).
  - **The voice sees the orchestrator's `learned` verdicts** ("fact / bluster",
    `mind.py:584`). Any hunt answer that reached the orchestrator's ground truth would
    therefore leak a verdict into the voice.

### 3.2 Options

| | A. AI claim extraction | B. Guest-side "📝 File a fact" card (**recommended**) |
|---|---|---|
| How | the voice (or a side call) emits `claims: [{question, answer, confident}]`, the worker posts `POST /api/agent/claims`, the server judges | in `dm:Trabolta` the guest taps **📝 File a fact**, picks an open question, types the answer, confirms "I'm certain", and `POST /api/guest/answer` → the server judges |
| Deterministic / replay-safe | no: model-dependent, misses and hallucinates claims, and judges *confidence* from phrasing | yes: one journaled `signal` with args (the same pattern as `/api/guest/widget`, `event-runtime.ts:2141-2171`) |
| AI sees the bookkeeping | no, if the server never echoes the verdict | no |
| Probe-proof | weak (a guest can fish with phrasing) | yes: **certain-only** filing + **one filing per program per question** + an **identical reply** for accurate and lie, so nothing learns the verdict |
| Matches the source rule | partly | yes: "an answer delivered with strong confidence is accepted, even if it is nonsensical" |
| Cost | M + model risk | S–M |

**Recommendation: B**, plus a zero-code persona line, and A-lite later (P2):

- **Persona line (zero code):** "When a program tells you an answer to tonight's
  questions, tell them to *file* it with 📝: unfiled facts are rumours." The voice stays in
  character and the card stays the only judged path.
- **A-lite (P2):** the worker proposes `{question, answer}` from chat. The server turns it
  into a **confirmation card** on the guest's phone ("File 'Mister Pickles' for Q2? I'm
  certain / No"). The AI only proposes; the guest's tap is still the deterministic act.

### 3.3 Design of B

- **Language (SW-ENG-17): a `QUESTION` declaration.** It is the single answer key, and it
  also feeds the TV slides (SW-SCR-08), the Quest Log text, and the judges' booth.
  ```loom
  QUESTION H2
    text: What was the name of the first animal buried in the Halifax Explosion Memorial Pet Cemetery?
    answer: Mister Pickles | Mr Pickles | Pickles       // accepted forms (folded)
    reject: Pickles the dog                             // optional near-misses that must count as wrong
    round: 1
    n: 2                                                 // → Kernel.q2 in the story's rule
    open: Night.facts_requested >= 3 and Night.phase != "bobbing"
    told to: Trabolta                                    // filing lives in dm:Trabolta
  ```
  - `model.questions`. **`answer` / `reject` never appear** in `GuestView`, `PrimeView`
    (except for judges, below), `AgentRequest`, `/api/agent/facts`, or the orchestrator.
  - A core test asserts that no answer string appears in any agent payload; this extends
    SW-AI-21.
  - `GuestView.questions[] = {id, text, round, open, filed}` (no answers).
- **Judges' key (for #22):** booths whose character carries `judge: true` (Clippy, the hosts)
  and directors see `answer` next to the per-question ✅ / 😤 buttons ("Expected: Mister
  Pickles"). This makes Moment-of-Truth judging from Clippy's phone reliable. It pairs with
  SW-ADM-07: the question picker *is* `model.questions` of the current round.
- **Route (SW-AI-20):** `POST /e/:id/api/guest/answer {question, text, certain: true}`. The
  server:
  1. Checks the guest token, doors open, `Trabolta` revealed to this guest and awake, the
     question's `open:` true, `certain === true`, and **no earlier filing by this program for
     this question** (409 "You already filed Q2"). Text ≤ 120 chars.
  2. Commits the guest's line into `dm:Trabolta` (`📝 Filed for Q2: "Mister Pickles"`) as a
     journaled `say`. The agent hears it like any line and reacts in character, **without**
     any verdict.
  3. Judges with `core/server/answers.ts` `judgeAnswer(def, text) → "accurate" | "lie" |
     "unclear"`:
     - **fold:** NFKD, curly → straight quotes, lowercase, strip punctuation; drop stopwords
       (`the a an it is was i think maybe`); number words ↔ digits (`eleven` ↔ `11`, `nine`
       ↔ `9`), `a.m.` → `am`;
     - **reject forms first**;
     - **accurate** if every token of any accepted form is in the answer, or for short
       answers (≤ 4 tokens) a Damerau-Levenshtein similarity ≥ 0.85 to a form;
     - **lie** if it has no overlap with any form, or carries a contradicting number;
     - **unclear** otherwise (similarity 0.6–0.85, or a partial token match).
  4. Journals `signal("answer filed", guest, {question: "H2", n: 2, round: 1, verdict,
     channel: "dm"})`. The verdict is decided **before** journaling, so a replay is
     deterministic even if the key is edited later.
  5. **Unclear** → `verdict: "pending"`. Nothing is recorded yet, and an entry goes into the
     **answer review queue**, shown to Clippy's booth and Run (SW-ADM-11 push to directors):
     the text, the question, the expected answer, and ✅ accurate / 😤 lie / void. A tap fires
     `answer judged {question, n, verdict}` for that program. **Whoever taps first wins**;
     the other side sees "judged by Clippy".
- **Story rule (SW-STORY-16, `ex/main.loom`):**
  ```loom
  when answer filed for program:      // and `when answer judged for program:` → the same body
    if verdict == "pending":
      reply Logged. Trabolta will review your submission.
    else:
      set program.truths_accepted += 1         // accurate and lie alike (he can't tell)
      set Night.facts_accepted += 1
      set Trabolta.truth += 4                  // never untruth: a story write would tell him
      set program.score += 50                  // DM filings pay half a Moment of Truth
      TRUST FORMULA
      if n == 1:                               // the 8-arm sticky record, as in B8
        if verdict == "lie":
          set Kernel.q1 = "lie"
        else if Kernel.q1 != "lie":
          set Kernel.q1 = "accurate"
      … n == 8 …
      if verdict == "lie":
        set Kernel.lies_accepted += 1
      reply Logged. Trabolta thanks you. +50 Truthcoin.   // identical for both verdicts
  ```
  `delivered = true` stays with `trabolta_heard`. The per-round counters (`r1/r2/r3`)
  follow `round`, so a DM can complete the round-2 collection (D5) before Truth Pong, which
  is intended.
- **Sticky-lie interaction:**
  - One DM bluff sets `Kernel.qN = "lie"` for good and fails the all-accurate verdict (spec
    §5). That is the user's rule, and it shifts the odds toward the Grok Prom / pickup path.
  - The README should say so, and the Run → Ceremony / Log "answers" view should show
    provenance (`q4: lie, from Pong via DM 21:43`). A director can still hand-fix
    `Kernel.q4` and `lies_accepted` in Run → World. No new code is needed for that.
  - Several programs may file the same question; the question is accurate only if every
    accepted filing was. One filing per program per question keeps `truths_accepted` from
    being farmed.
- **Trust Chart interaction:**
  - A DM filing adds +10 trust like a Moment-of-Truth acceptance. Trabolta counts what he
    accepted, and lies are invisible to him until the end.
  - Ranking stays live. Best Liar (§2) reveals the liars only at the ceremony.
  - `Trabolta.untruth` stays voice-only. If his own read of a filing is "nonsense" he may
    nudge it, and that is his own judgement, not the key's.
- **Play (SW-PLAY-24):**
  - a 📝 chip in the `dm:Trabolta` composer (play `chat.tsx`) opens a sheet: open questions
    from `GuestView.questions` (filed ones ticked), the answer box, and a required "I'm
    certain. Log it permanently." checkbox;
  - copy in-world: "Certain answers are logged permanently. Trabolta does not accept
    doubt."
  - the Quest Log's hunt steps link to the same sheet.

### 3.4 Size and tests

**Size: M overall (~3–4 days).** QUESTION decl S · answers.ts judge + route + review queue M ·
play card S · story rule + tests S.

**Tests:**

- core `answers.test.ts`: a corpus per H1–H8 (`11`, `eleven years`, `Mr. Pickles`, `9am`,
  `nine o'clock`; rejects `4am`, `ten years`).
- core `server-answers.test.ts`:
  - certain-only, one per question, closed questions, hidden Trabolta;
  - an identical reply for both verdicts;
  - a pending item resolved by booth and by director;
  - restart rebuilds the filed set from the journal.
- `trapped-in-the-internet` gains three cases: a DM lie makes the verdict fail (sticky); a DM
  accurate + a later MoT lie stays a lie; `truths_accepted` / trust move equally.
- agents payload test: no answer string and no `verdict` in any `AgentRequest` or
  `/api/agent/facts`.

---

## 4. New checklist items (to paste into CHECKLIST.md)

| Id | St | P | Size | What |
|---|---|---|---|---|
| **SW-PLAY-19** | 🔴 | P0 | M | `PushHub` (`core/server/push.ts`): VAPID + `web-push`, `push.json` per event, guest / prime / mod subscribe + visible heartbeat routes, fan-out from `deliverMessage` (alerts, takeovers, staff, personal, lifecycle), quiet rules, 410 cleanup, restart unbind / rebind, no push during `restore` (child of SW-PLAY-02) |
| **SW-PLAY-20** | 🔴 | P0 | M | Play PWA: push-only `sw.js` (no fetch handler), dynamic `manifest.webmanifest?code=`, icons, `server.ts` routes, the iOS **install-first InstallGate**, the `alerts` widget card in the Mud Room, notification deep links (child of SW-PLAY-02) |
| **SW-PLAY-21** | 🔴 | P1 | S | Safari → Home Screen handoff: single-use N-02 pair code (`?code=…&pair=…` → `POST …/guest/resume {pair}`) in the manifest `start_url` for guests who joined in Safari |
| **SW-PLAY-22** | 🔴 | P0 | S | Booth push registration + booth audiences (needs SW-ENG-08 `performer(G)` scope), with SW-PLAY-03 in-page parity |
| **SW-PLAY-23** | 🔴 | P1 | S | Ceremony on phones: `ceremony` message kind (stats / award / superstar cards), winner takeover + trophy, Clippy's booth **Script** teleprompter with Next / Back |
| **SW-PLAY-24** | 🔴 | P1 | S | "📝 File a fact" sheet in `dm:Trabolta` (open questions, certain-only, filed ticks) |
| **SW-ADM-11** | 🔴 | P1 | S | Director push (`/edit/sw.js`, Run header 🔔) + Front-of-house **Push** health card (per role, unbound, test push, iPhones not installed) |
| **SW-ADM-12** | 🔴 | P1 | M | Run → **Ceremony** tab: prepare, per-line LLM / fallback / edited chips, inline edit, regenerate, present (Next / Back / auto), bonus re-roll, hand control to Clippy |
| **SW-ADM-13** | 🔴 | P1 | S | **Answer review queue** (unclear DM filings) in Run + Clippy's booth, first tap wins; answers provenance view (q1–q8: who, how, when) |
| **SW-ENG-15** | 🔴 | P1 | S | `notify <who> "text" [urgent]` statement → a personal push / in-page nudge |
| **SW-ENG-16** | 🔴 | P1 | M | `AWARD` declaration (`by:` expr or `stat <metric>`, `order`, `min`, `trophy`, `bonus`) + `start ceremony hosted by X` / `next ceremony` + `award X is won by` / `ceremony starts|ends` events (shares ranking with SW-ENG-04 / SW-SCR-11) |
| **SW-ENG-17** | 🔴 | P1 | S | `QUESTION` declaration (text, answer / reject forms, round, n, `open:`, `told to:`); answers never in any view or agent payload except judges' booths; `GuestView.questions` |
| **SW-AI-17** | 🔴 | P1 | M | `core/server/recap.ts` RecapStats (world + journal metrics: lies, duck_time, lines, shares, quests, afk minutes…) + `GET /api/mod/recap`; runs in the local Sim too |
| **SW-AI-18** | 🔴 | P1 | M | `CeremonyHub` (`core/server/ceremony.ts`): segments, fallbacks first, `compose` SSE + `POST /api/agent/compose`, name / number / length validation, TTS pre-render, journaled `award won`, refused before `Night.ended` |
| **SW-AI-19** | 🔴 | P1 | M | Stagehand `agents/ceremony.py`: facts-only prompt + mind colour, JSON-schema structured output, per-slot caps, `compose` thought kind, `system-report` voice for Clippy-hosted endings |
| **SW-AI-20** | 🔴 | P1 | M | `POST /api/guest/answer` + `core/server/answers.ts` fuzzy judge + journaled `answer filed` / `answer judged` signals (DM lies count, #33) |
| **SW-AI-21** | 🔴 | P0 | S | **Answer secrecy guard**: a test that no QUESTION answer / hunt codex text / verdict reaches `AgentRequest`, `/api/agent/facts`, `lore_block` or `learned`; suppress orchestrator `learned` verdicts on hunt claims |
| **SW-AI-22** | 🔴 | P2 | M | A-lite: worker-proposed claims → guest confirmation card |
| **SW-SCR-27** | 🔴 | P1 | M | TV `ceremony` template (counters, nominees, reveal, face driven by pre-rendered audio, captions; fanfare via `sound` cues → TV computer multichannel) — after SW-SCR-03 / SW-SCR-17 |
| **SW-RE-14** | 🔴 | P1 | S | Spatial run log `spatial-runs.jsonl` (`startedAt` / `foundAt` per session) for the Golden Duck Speedrun |
| **SW-STORY-15** | 🔴 | P1 | S | Ceremony content: AWARDs + fallback templates, trophy codex `codex/9-trophies.loom`, `start_the_ceremony`, host per ending, `ceremony` phase cue, tests |
| **SW-STORY-16** | 🔴 | P1 | S | `when answer filed / judged for program:` rule (sticky 8-arm record, `lies_accepted`, identical reply, +50 ⓣ), the 8 `QUESTION`s, the persona "file it" line, README note that one DM bluff fails the verdict |
| **SW-OPS-17** | 🔴 | P0 | S | VAPID keys pinned in `.env` / compose; door signage "Add to Home Screen" (print with SW-QR-14); a live push test on iPhone (Home Screen) + Android over cellular against the VPS |

Existing items touched: SW-PLAY-02 becomes the umbrella (children 19 / 20 / 22). SW-PLAY-03
pairs with 22. SW-PLAY-04's takeover pushes urgent. SW-ENG-08 becomes a hard dependency of
22. SW-AI-09 (recap, P2) is **superseded** by 17 / 18 / 19 + SW-ADM-12 at P1. SW-ADM-07's
picker is `model.questions`. SW-SCR-17 rises to P1 (#13). Decision #33 flips spec §10.2 /
trabolta.md §2.10.

## 5. Ordering hints for the schedule

1. **Push first among these** (P0): SW-OPS-01/02 (VPS + HTTPS) → SW-PLAY-19 → SW-PLAY-20 →
   SW-ENG-08 → SW-PLAY-22 → SW-OPS-17. Do it early because the iOS install-first flow changes
   the door onboarding and the printed signage, which must be final before printing.
2. **DM lies with the Loom-language wave** (P1, cheap, unblocks #22 judging): SW-ENG-17 →
   SW-AI-21 → SW-AI-20 → SW-PLAY-24 + SW-ADM-13 → SW-STORY-16. Land SW-ADM-07 in the same
   wave, since its picker reuses QUESTION.
3. **Ceremony in the P1 tail**: SW-ENG-04 (ranking) → SW-ENG-16 → SW-RE-14 + SW-AI-17 →
   the **deterministic floor** (SW-AI-18 with fallbacks only + SW-ADM-12 + SW-STORY-15) →
   SW-AI-19 (LLM) → SW-PLAY-23 → SW-SCR-27 (after ScreenHub SW-SCR-03 and the TV voice
   SW-SCR-17).
