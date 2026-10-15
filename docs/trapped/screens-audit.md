> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.
>
> **Wave 1 status** (merged to master 2026-10-15, not yet deployed to the VPS; [OCT31 §5](../../core/examples/trapped-in-the-internet/OCT31.md)). Built (K-14–K-18, K-29): the lean screen state `GET /e/:id/api/screen/state` (`core/server/routes/screen.ts` — the last `screens_*` / `terminals_*` / `tv_*` cue per family, `Night.screen` mirrors, attract while the character is hidden or asleep, the running countdown, the TV's lines) that every terminal polls instead of the mod feed; overlays (`blackout`, `go_to_living_room`, `alarm`, `flicker`), PNG slides at `/terminal/slides/<cue>.png` with a text-card fallback, a corner countdown + Y2K clock; `view=tv` (the room voice); Wake Lock + a 2 s ⚙ hold (kiosk: [`kiosk.md`](./kiosk.md)); a WebGL2 probe; the Run → Terminals heartbeat card (`GET /api/mod/screen/terminals`). Not built: a `show … on screens` statement (the story uses `cue screens_*`), the `/media/` route with Range support and video playback (N-04a), the Run → Screens page, the phone takeover, a scoped device token / ⚙ PIN.

# Screens audit — the terminal app vs. what *Trapped in the Internet* needs from its monitors

Scope: `terminal/` (README, `src/**`, config, `face/`, `speech/`, `world/`) and the
server routes it touches in `core/server` (`tts.ts`, `event-runtime.ts`,
`spatial.ts`, `server.ts`, `routing.ts`), checked against the four source docs in
`Trapped In The Internet story/` (STORY BEATS, Story Overview, Character Sheet,
CLIPPY INSTRUCTIONS). Paths below are relative to `packages/loom/`.

---

## 1. Summary

The terminal today does **two things well, and nothing else**:

1. **A direct line to an agent-voiced character.** Scan a pass, pilot that guest's
   `dm:Trabolta` thread, speak each reply aloud with an animated face, and drop the
   line after 30 s idle.
2. **A spectator of the reinstallation simulation.** It shows the world view in a
   pane (`view=auto|world`) or full screen (`view=mirror`, the TV).

The show treats the monitors as the house's **signage and PA system**. It needs a
screensaver, call-to-room alerts, six authored "Monitor Prompts" (V1–V6), countdowns,
a hijacking video ad, rotating ads, the Trust Chart, the Y2K clock, a full-screen
"GO TO THE LIVING ROOM" after the blackout, two songs (one a duet with a TTS
"Sandy"), truth.txt, and Alexa announcements. **None of these exist.** The pieces
that would carry them are partly there:

| Building block | State |
|---|---|
| Story → raw event feed | ✅ Every `cue`/`sound`/directive is a `{type:"directive"}` SimEvent (`core/src/runtime/sim/sim.ts:2005-2007`), forwarded on the **mod SSE** as `sim` frames (`core/server/event-runtime.ts:567`). Stagehand already consumes it (`stagehand/src/stagehand/modapi.py:63`, `show/cuemap.py:210-222`). |
| Story statement for screens | ❌ None. `show <kind>` targets *phones* (`statements.ts:53,85`, `sim.ts:2168`). `cue screens, effect: flicker` only reaches TouchDesigner via stagehand (`cast/trabolta.loom:106`). |
| Retained "what each screen shows now" state | ❌ None. A screen that reboots mid-show cannot find out what it should be showing. |
| A lean, terminal-appropriate stream | ❌ The terminal only opens the spatial stream and a piloted guest's stream. The mod feed is unsuitable for N tablets (§3.3). |
| Media hosting | ❌ No media route. Static serving loads whole files with `readFileSync`, has **no Range support**, and **no `.mp4`/`.webm`/`.m4a`/`.vtt` types** (`core/server/server.ts:100-138`). iOS Safari will not play `<video>` without 206 range responses. |
| Video/audio playback in the terminal | ❌ The only `<video>` is the camera preview (`terminal/src/scanner.tsx:158`). Audio is TTS only (`speech/engine.ts`). |
| TTS | ✅ Good server proxy + cache (`core/server/tts.ts`, `event-runtime.ts:1850-1880`) and a robust speech queue with fallback (`terminal/src/speech/engine.ts:244-327`). It is wired **only** to the piloted DM (`terminal/src/app.tsx:297-309`). |
| Kiosk basics | ⚠️ Partial. It has a wake tap for audio (`app.tsx:130-135`), iOS standalone meta tags (`terminal/index.html`), and spatial reconnect with backoff (`world/stream.ts:155-216`). It has **no** Screen Wake Lock, Fullscreen API, web manifest, or service worker. The full **moderator token** sits in localStorage, and the ⚙ is open to any guest. |

**Recommendation:** build a **Screens** layer as a sibling of the spatial plane,
with the same shape:

- a transport-free `ScreenHub` on the server holding the current *program* per screen target;
- an SSE `/api/screen/stream` that replays the current state on connect;
- a story statement that lowers to a new structured `screen` SimEvent;
- a Range-capable `/media/` route plus a manifest;
- in the terminal, a `ScreenLayer` that sits above face/world/mirror and renders a
  fixed set of templates: `screensaver`, `slide`, `countdown`, `clock`, `video`,
  `ads`, `chart`, `alert`/`takeover`, `textfile`, `song`, `face`, `world`, `effect`;
- in the editor's Run mode, a **Screens** page for presence, push-a-prompt buttons
  and previews.

Everything goes through the journal, so rehearsals replay.

---

## 2. What the terminal is today (inventory)

| Area | What it does | Where |
|---|---|---|
| Screens | `setup → attract → connecting → piloting`, plus a separate `Mirror` | `terminal/src/app.tsx:38`, `:119`, `:547-565` |
| Config | Per tablet in localStorage: `eventId`, **mod `token`**, `name`, `character`, voice, `camera`, `spot`, and `view ∈ auto\|world\|face\|mirror`. Set by URL provisioning `?code=&name=&character=&spot=&view=`, which is scrubbed from the address bar. | `terminal/src/config.ts:14-46`, `:85`, `:104-132`, `:138-159` |
| Auth | Mod passcode → `/api/resolve-code` → `/api/mod/login` → a full **moderator token** | `config.ts:138-159` |
| Piloting | `/api/mod/impersonate {role:"guest", id, label:"Terminal · <name>"}` → the guest's own `/events?role=guest` stream, **filtered to `dm:<Character>`** | `terminal/src/pilot.ts:26-33`, `:89-127`; server `event-runtime.ts:2974-3001` |
| Speech | `SpeechQueue`: server engine (`/api/mod/tts`, decoded with Web Audio, an AnalyserNode drives the mouth), falling back to `speechSynthesis` per chunk | `terminal/src/speech/engine.ts:71-153`, `:157-228`, `:244-327` |
| What gets spoken | Only new lines from the piloted character in that DM thread | `app.tsx:297-309`, `pilot.ts:131-137` |
| Face | SVG head; mood is set by the situation and by each spoken sentence | `terminal/src/face/Face.tsx`, `face/mood.ts` |
| World view | Spatial SSE (`/api/spatial/stream?token=&name=`), a three.js house, a director (mount/follow/orbit), a mini-map, a banner and a celebration | `terminal/src/world/stream.ts:155-263`, `world/WorldView.tsx:33-34`, `:210`, `:225` |
| Audio unlock | "TOUCH TO WAKE" after every reload resumes the AudioContext and primes `speechSynthesis`. Mirror skips this because it never speaks. | `app.tsx:79-81`, `:130-135`; `engine.ts:47-67` |
| Reconnect | The spatial feed keeps the last players for 10 s; 401 → setup without token, 404 → setup keeping settings, anything else → backoff from 5 s to 60 s | `world/stream.ts:44-59`, `:155-216` |
| Status poll | `GET /api/state?role=mod` every 20 s, a **full ModView**, just to read Trabolta's online flag | `app.tsx:364-384` |
| Static hosting | `/terminal/*` served from `terminal/dist` with `TERMINAL_CSP` (`media-src 'self' blob:`) | `core/server/server.ts:88-92`, `:357-378`; `routing.ts:21` |

Not present anywhere in `terminal/src`: `navigator.wakeLock`, `requestFullscreen`,
`<audio>`, any `<video>` other than the camera, `new Audio`, a service worker, or a
`manifest.webmanifest`. A grep across `play/`, `reinstall/web/` and `editor/` finds
no wake-lock or fullscreen use either.

---

## 3. Server surface relevant to screens

### 3.1 Story → event

- Statement table: `cue`, `sfx`, `sound` (renamed to `sfx`), `flash`, `broadcast`,
  `show` (`core/src/parser/statements.ts:74-85`). `show` grammar:
  `show <kind> ["text"] [to scope] [with k: v]` (`statements.ts:53`).
- `cue X` / `sound X` / long-form `<cue: …>` reach the sim's default directive branch
  and are recorded as `{type:"directive", verb, args}` with `{…}` interpolated
  (`sim.ts:2005-2007`; event type at `core/src/runtime/sim/event.ts:94`).
- `show` becomes a structured `widget` SimEvent (`event.ts:106`, `sim.ts:2168`) that
  `chat.ts` routes into a phone's conversation.
- `broadcast "!…"` becomes an **alert** message (`core/server/chat.ts:98-100`,
  `:254-258`); the play app chimes and vibrates (`play/src/codex.ts:56`, `:87`).

### 3.2 Event → clients

- `EventRuntime.fanout` sends **every** SimEvent to every mod client as an SSE `sim`
  frame (`event-runtime.ts:558-567`), composes guest messages, delivers them, then
  calls `pushSnapshots()`.
- `pushSnapshots()` sends **every client a full snapshot** after every fanout
  (`event-runtime.ts:468-470`). For a mod client that is the entire `ModView`:
  roster, world dump, codex supply, minds (`core/server/views.ts:325-362`).
- `deliverMessage` sends **every** chat message to mod clients
  (`event-runtime.ts:521-531`).

### 3.3 Why terminals should not ride the mod feed for signage

They technically could. `/events?role=mod&token=…` accepts the token in the query
(`http-util.ts:67-69`, `event-runtime.ts:1592-1643`), and the feed carries the
directive events. But:

1. **Weight.** Every story step pushes a full ModView to every tablet. With 8–10
   screens that is 8–10× the god-view JSON per event, all night, on party Wi-Fi.
2. **Leakage.** Every DM, hidden faction and codex holder lands on a wall tablet a
   guest can touch.
3. **No current state.** `sim` frames are fire-and-forget. A tablet that reloads
   mid-countdown cannot learn the countdown exists. `history` replays *chat*, not
   screen programs.
4. **Presence pollution.** Each mod client counts as a director (`client.name =
   opts.moderatorName ?? "Director"`, `event-runtime.ts:1623`; `pushPresence`
   `:473-475`). Ten screens would show up as ten "directors" in the Run header.

The **spatial stream** is the right precedent: a transport-free hub
(`core/server/spatial.ts`, `SpatialHub`), a lean SSE with a `hello` replay, mod-token
or session-token gated (`event-runtime.ts:983-1002`).

### 3.4 TTS

`POST /api/mod/tts {text, voice?, speed?}` takes a mod token, caps text at 1200 chars
(`core/server/tts.ts:21-47`), uses an LRU cache with in-flight dedup, and returns
503 when unconfigured and 502 when the TTS server is down
(`event-runtime.ts:1850-1880`). It is fine to reuse as-is for announcements and the
Sandy voice. A per-call `voice` already exists, so Alexa and Sandy can be Kokoro
voices such as `af_sky` and `af_bella`.

### 3.5 Media

There is **no** media route. `serveAppFile` reads the whole file into memory and
answers `200` without `Accept-Ranges` (`server.ts:125-138`). `CONTENT_TYPES` has mp3,
ogg and wav but **no mp4, webm, m4a or vtt** (`server.ts:100-121`). The only binary
GET is `/api/avatar/<key>`, the cached profile pictures (`event-runtime.ts:1685`).
CSP: `HTML_CSP` blocks nothing same-origin (`routing.ts:7-17`), and `TERMINAL_CSP`
adds `media-src 'self' blob:` (`routing.ts:21`). A same-origin `/media/` works with
**no CSP change**.

---

## 4. Needs matrix

Legend: ✅ SUPPORTED · 🟡 PARTIAL · ❌ MISSING.

| # | Need (source) | Status | Evidence | Gap |
|---|---|---|---|---|
| 1 | **Classic Windows screensaver** on the TV and monitors before the inciting event (Overview, *Entrance*: "a classic Windows screensaver on the TV") | ❌ | The attract screen is the face + scanner (`app.tsx:443-478`). The mirror shows the world view; with nobody playing it orbits a room (README *orbit*). The story only *narrates* the screensaver (`beats/glitch.loom:13`, `beats/endings.loom:93,102`). | No screensaver template; no idle/base layer. |
| 2 | **Screens alert everyone to go to the Desktop** (Monitor V1 + App C1) | 🟡 | Phones: `broadcast "!📣 …" to everyone` → alert chime (`main.loom:323`, `chat.ts:254`). | Terminals never see broadcasts: the pilot reads only `dm:<Character>` (`pilot.ts:120-127`), the attract screen reads only the spatial stream. |
| 3 | **V2 Computer Bingo** rules slide | ❌ | — | No slide template, no story → screen path. |
| 4 | **V3 Bingo time** (15–20 min timer) | ❌ | Timing lives only in broadcast text (`beats/desktop.loom:29,37`). | No countdown template; no server-held deadline; the end of time does not fire anything. |
| 5 | **V4 Trabolta Trivia round 1**: three questions on screen | ❌ | The hunt is a quest + codex (`quests.loom`, `beats/hunt.loom`). | No slide; nothing pulls the questions from the quest/codex so slide and quest log stay in sync. |
| 6 | **V5 hunt countdown (15 min)** | ❌ | `beats/hunt.loom:19,26` (text only). | Same as 4. |
| 7 | **V6 hunt results** | ❌ | — | Needs a results slide fed from story vars or director input. |
| 8 | **Mirror the VR reinstallation on the TV** while Clippy explains | ✅ / 🟡 | ✅ `view=mirror` full-screen world view (`app.tsx:547-565`, `world/WorldView.tsx`); `auto` panes switch to the world while anyone plays (`app.tsx:255-258`). | 🟡 It is a fixed *mode*: the TV cannot go screensaver → slide → world → slide under story control. The world needs to become one program among others, auto-raised while someone plays (CLIPPY 2/X: "If the reinstallation appears on the screen…"). |
| 9 | **Presentation hijacked by a confusing advertisement (video)** during the malware event | ❌ | — | No video playback, no media hosting, no Range, no mp4 type. Every screen must start together (needs scheduled start + server clock offset). |
| 10 | **Advertisements generally** (Web-1.0 ads, McAfee "protection expired", Trabolta ads) | ❌ | McAfee's line is a phone broadcast (`cast/antivirus.loom:65`). | No ad rotation, no popup overlay. |
| 11 | **Trabolta's Trust Chart**: +10 per accepted truth, −5 per Internet visit, ±10 Trabolta assessment; celebrate the top, humiliate the bottom | ❌ | `ROLE Program` has `truth 0–100` (a meter, not a count of accepted truths) and `reinstalls` (`main.loom:112-126`, `:176`); `RosterRow.score` reads `<id>.score` (`views.ts:230`, `sim.ts:1252`) and is unused by this show. | Missing vars (`truths`, `assessment`), the computed metric, the chart template, a staged reveal, and Trabolta's spoken praise/insult. |
| 12 | **Y2K system clock**: 11:00 pm Dec 31 1999 counting to midnight | ❌ | — | Needs a `clock` template (fake epoch, rate, glitch at 23:59) and a server deadline that **fires an event at midnight**, since "within the hour" decides the finale. |
| 13 | **Tent instructional video** (WebMD narrator) on the Internet tablet | 🟡 | Today the captured guest's *phone* gets the narration as text lines from "The Tablet" (`beats/internet.loom:12-20`). The tent tablet runs `/reinstall/` (web game wizard); no video there either. | Video playback on the tent tablet, either in the reinstall wizard (play on scan) or a dedicated terminal in signage mode `spot=tent`. |
| 14 | **After the blackout, "Go to the living room" flashing** (Overview, finale 1/2: "the chat app is now just a flashing screen") | ❌ | Phones get banner + chime alerts only. | A full-screen **takeover** on phones (a new overlay widget) *and* on terminals. Screens should also black out for the 10 s light-out, since they emit light. |
| 15 | **One dance song**; Trabolta's **"You're the one that I want" vocoder song** with Sandy's customer-service replies; the sad variant with no male vocals | ❌ | — | Audio file playback, a designated speaker device, timed lyrics, and Sandy lines (pre-baked into the track, or synced TTS). |
| 16 | **Show truth.txt** (read aloud by the bobbing winner) | ❌ | Codex entries exist as text (`codex/*.loom`). | A `textfile` template (Notepad window, big type, scroll/reveal) fed from a CODEX entry so it also lands in everyone's codex. |
| 17 | **Alexa-style house announcements** (Overview, *Entrance*: "the Alexa will let you know when it's time") | 🟡 | TTS proxy + speech queue exist (§3.4, `engine.ts`); the story fakes it with text (`cast/hosts.loom:56,59` `"!🔊 ALEXA: …"`). | No story → spoken path on screens; no "one speaker per room" election; the mirror has no audio unlock at all. |
| 18 | *(implied)* **Trabolta presents** to the room: Trust Chart commentary, the oversharing / LiveJournal threat, the Y2K reveal, final assessment, the weakened-Trabolta epilogue | ❌ | The face + voice exist but only for a piloted DM. Story `Trabolta:` lines with no subject go to the location room on phones (`loc:<Id>`). | Let a room's screen **voice the lines spoken in its room** by the configured character, with its face. |
| 19 | *(implied)* **Screen effects**: flicker (Trabolta power), "all screens go red", "screens go dark one by one", "every screen shows a billboard of a duck", "fade to blue" | ❌ | `cast/trabolta.loom:106` (`<cue: screens, effect: flicker>` → stagehand OSC only); `beats/endings.loom:48,89,110,135` narrate the rest. | Terminals should honour `cue screens …` / an `effect` program. |
| 20 | *(implied)* **Admin pushes prompts V1–V6 / C1–C2 from the Loom app** | 🟡 | The Director page can fire beats and named events (`/api/mod/beat` `event-runtime.ts:2900`, `/api/mod/signal` `:2739`, `/api/mod/broadcast` `:2760`). `INTERACTION … who: admin` exists (`core/src/runtime/sim/model.ts:203`). | Once screen statements exist, V1–V6 become beats/admin interactions. Still missing: a **Screens** page with fleet presence, what each screen shows, preview, blackout-all, identify, reload. |
| 21 | *(implied)* **Five-minute warning** before the Second Moment of Truth; Bathroom Mode exemption | 🟡 | Phones can get a broadcast. | Countdown on screens (same as 4). |
| 22 | *(implied)* **Self-destruct / patch-bay progress** on screens (alternate finale) | ❌ | Keys narrated by broadcast (`beats/endings.loom:24-36,48,59`). | `slide`/`countdown`/`effect` programs once patch-bay events exist (separate audit). |

---

## 5. Proposed design: the Screens layer

### 5.1 Model

- **Screen**: a connected terminal (any `view`) or a dedicated signage device. It
  identifies itself by `name`, `spot` (a `house.terminals[].id`, which gives its
  room), and optional **tags** (`tv`, `wall`, `tent`, `speaker`).
- **Target**: whom a program is for:
  - `everyone` / `screens`
  - `room <Location>`, e.g. `room Desktop` → every screen whose spot is in that room
  - `spot desktop-tv`
  - `tag tv`
- **Layers**, rendered bottom to top:
  1. `base`: the idle look. The screensaver before the glitch; afterwards whatever
     the story sets (Trabolta face, ads rotation, world when someone plays).
  2. `program`: slides, countdowns, video, chart, clock, textfile, song, world.
  3. `overlay`: alerts, takeovers, popups, effects (flicker / red / dark / blackout).
- **Program** = `{id, template, text?, params, target, layer, startAt, endsAt?, then?, by}`.
  Timestamps are **server epoch ms**. `startAt` may be in the future
  (`serverNow + 1500`) so every screen starts a video together.
- **Precedence vs piloting.** A terminal being piloted keeps the chat on its line
  pane. Programs render in the **face pane** (or full screen for `layer: overlay`
  with `takeover: true` and for `blackout`). An *alert takeover* or a *blackout*
  always wins: it ends the pilot session through the existing `end("left")` path
  (`app.tsx:312-326`).

### 5.2 Story surface (Loom 4 style)

Extend `show` with an **`on <screens>`** clause. `to` keeps meaning people/phones,
`on` means screens. Add a sibling `announce`:

```loom
// V1 — call to the living room (with C1 on phones)
broadcast "!📣 ALL PROGRAMS: report to the Desktop. A game is about to begin." to everyone
show alert "REPORT TO THE DESKTOP" on screens with flash: true, chime: alexa
announce "Everyone to the Desktop. A game is about to begin." on tag speaker with voice: af_sky

// V2 — rules slide on the TV, ads elsewhere
show slide "COMPUTER BINGO" on room Desktop with body: "Find a program for every square. Don't write names — use your memory.", image: bingo-card.png
show ads on screens with playlist: night-1

// V3 — the timer, which also ends the round
show countdown "COMPUTER BINGO" on screens with minutes: 20, then: the bingo results

// V4/V5 — questions from the quest itself, then the clock
show slide "TRABOLTA TRIVIA · ROUND 1" on screens with quest: The Truth Scavenger Hunt
show countdown "TRUTH SCAVENGER HUNT" on screens with minutes: 15, then: the hunt results

// the malware hijack
show video malware-ad on screens with sync: true, then: the ad ends
// the Trust Chart
show chart trust on room Desktop with reveal: slow
// Y2K
show clock "SYSTEM CLOCK" on screens with from: "1999-12-31 23:00", minutes: 60, then: midnight
// the finale
show effect blackout on screens with seconds: 10
show takeover "GO TO THE LIVING ROOM" on screens with flash: true
show song youre-the-one on tag speaker with lyrics: youre-the-one.vtt
show textfile truth.txt on room Desktop with codex: truth.txt
clear screens            // back to base
```

Grammar work:

- Extend `SHOW` (`statements.ts:53`) with `(\s+on\s+\S.*?)?`.
- Add `["announce", {kind:"args"}]`, and `["clear", …]` (or `show nothing on …`).
- Keep `cue screens with effect: flicker`, so the existing Trabolta power reaches
  terminals *and* TouchDesigner.

Lint: unknown template, unknown media file (the server knows the media dir),
unknown target tag/spot (from `house.json`).

Optional declarations, worth adding for authoring tools:

- `MEDIA malware-ad` with `src: malware-ad.mp4`, `kind: video`, `poster: …`,
  `captions: …`
- `PLAYLIST night-1` with `items: ad-geocities | ad-mcafee | ad-maps-and-ducks`,
  `seconds: 20`

Both index into the media manifest, and the editor can autocomplete them.

### 5.3 Engine + server

1. **SimEvent.** Add `{type: "screen", template, text, params, target, layer}` and
   `{type: "announce", text, voice, target}` beside `widget` (`event.ts:106`). Parse
   them in the sim like `runShow` (`sim.ts:2168`): when the `on` clause is present,
   record a `screen` event instead of a `widget` event. A director's `POST
   /api/mod/screen` becomes a **journaled mutation** `screen`, so rehearsals and
   restores replay.
2. **`ScreenHub`** (`core/server/screens.ts`): transport-free with an injected
   clock, like `SpatialHub`.
   - `apply(event, now)` folds into `programs: Map<targetKey, Map<layer, Program>>`
     and schedules `then:` deadlines. On expiry it commits
     `signal(then, null)` through the runtime, journaled `by: "Screens"`, so "time's
     up" moves the story and is reproducible.
   - `presence`: connected screens (name, spot, tags, view, piloting?, what they show
     now, audio unlocked?, last heartbeat).
   - `resolve(screen)`: the effective stack for one screen. Most specific target
     wins: `spot > tag > room > everyone`.
   - On restore/replay, rebuild from the replayed `screen` events but **skip anything
     whose `endsAt` already passed**, and never auto-restart a one-shot video.
3. **Hook into `fanout`** (`event-runtime.ts:558`): `if (e.type === "screen" ||
   e.type === "announce") this.screens.apply(e, Date.now())`. Also map
   `directive cue` with args beginning `screens` to an `effect` overlay.
4. **Routes**:
   - `GET /api/screen/stream?token=&name=&spot=&tags=` (SSE). Frames:
     - `hello {serverNow, stack, mediaVersion}`
     - `program {layer, program}`
     - `clear {layer}`
     - `announce {id, text, voice, chime}`
     - `effect {name, seconds}`
     - `reload`
     - `identify`
     - `ping {serverNow}` every 15–25 s, for clock-offset estimation
   - `POST /api/screen/heartbeat {audio, battery?, visible, version}`. Or have the
     client post state changes on the same token.
   - `GET /api/mod/screens` (fleet). `POST /api/mod/screen {target, template, …}`.
     `POST /api/mod/screen/clear`. `POST /api/mod/screen/{identify,reload}`.
   - `GET /api/screen/data/trust` (see §6.11), or embed the chart rows in the
     program payload and push updates on `worldSet`.
5. **Capability.** Mint a **screen token** (read-only: the screen stream, media,
   TTS, house map, spatial stream) separate from the mod token. A wall tablet then
   cannot impersonate guests or edit vars if someone picks it up. Piloting still
   needs `/api/mod/impersonate`, so either:
   - keep a mod token only on pilot-capable terminals, or
   - add a narrow `pilot` capability that permits impersonating **guests only**,
     reading `dm:<character>` only, and TTS.

### 5.4 Media hosting

- **Where the files live.** A per-event media dir: `LOOM_STATE_DIR/<event>/media/`,
  falling back to the scenario's own `media/` folder next to `house.json`, then to
  `LOOM_MEDIA_DIR`. It is a read-only bind mount in docker-compose like `LOOM_HOUSE`.
  Keep big videos out of git (`.gitignore` + a `media/README` listing the files and
  their sources).
- **Route.** `GET /media/<file>` (public, so `<video src>` needs no header) or
  `/e/:id/media/<file>?token=` when assets should stay private:
  - `createReadStream` with **`Range` → 206 + `Content-Range` + `Accept-Ranges:
    bytes`**;
  - `ETag` / `Last-Modified`, `Cache-Control: public, max-age=86400, immutable` on
    content-hashed names;
  - content types: `.mp4 video/mp4`, `.webm video/webm`, `.m4a audio/mp4`,
    `.mp3`, `.vtt text/vtt`, `.png`/`.jpg`/`.gif`/`.webp`.
  - `appRelPath`-style `..` refusal (`routing.ts:29-32`).
- **Manifest.** `GET /api/screen/media` returns `[{name, url, bytes, sha, kind,
  duration?}]` and a `mediaVersion` (hash). Screens prefetch on `hello` and on a
  version change.
- **Offline resilience.** A small service worker in the terminal, or plain
  `fetch` → Cache Storage, precaches the manifest's images and short clips. Party
  Wi-Fi hiccups must not stall the hijack ad. Note Range requests from Cache Storage
  need the SW to slice the cached blob. The simpler path: for clips under ~30 MB,
  fetch to a `Blob` and play from an object URL (`media-src blob:` is already
  allowed).
- **Encoding.** H.264 baseline/main + AAC in MP4, 720p, ≤ 4 Mbps, `+faststart`.
  This plays on every iPad, Android and Fire TV.
- **Uploading.** v1: drop files into the folder. v2: an editor upload route that
  stores into the event media dir (`project_file` is text-only today).

### 5.5 Terminal client

- **`view: signage`** (a new value in `VIEWS`, `config.ts:45-46`): a full-screen
  screen-layer device with no scanner. The existing `mirror` becomes `signage` with
  the world as a default base. Keep `mirror` as an alias. **All other views also
  subscribe to the screen stream** and render programs in the face pane and overlays
  full screen.
- **`ScreenLayer` component** (`src/screens/`):
  - a `useScreenStream(config)` hook modelled on `useSpatialStream`
    (`world/stream.ts:219-263`): reconnect, `gone` probing, clock offset from
    `hello`/`ping`;
  - a template registry, like `play/src/widgets.tsx:283-287`.
  - Render everything in the Win98 / Web-1.0 style of the show (the terminal is
    currently green-CRT VT323). Templates should take a `theme` param.
- **One persistent media element.** Create a single `<video playsinline>` at boot and
  `play()` it (muted, a 1-frame silent clip) **inside the wake tap** alongside
  `unlock()` (`engine.ts:47-67`). Later programs swap its `src`. This is the reliable
  way to keep autoplay-with-sound permission on iOS Safari, which grants it per
  element. Chrome grants it per document after any activation.
- **Speaker election.** Only screens tagged `speaker` (or the first online one per
  room) play announcements, songs and video sound. Every other screen plays muted.
  Several tablets speaking the same TTS a few hundred ms apart sounds terrible.
- **Sync.** Video/song programs carry `startAt`. A client waits until
  `serverNow ≈ startAt` and starts. A late joiner seeks to `(now − startAt)/1000`
  unless `params.late: skip`. Countdowns render from `endsAt − (Date.now() +
  offset)`, so a reboot resumes the right second.
- **Heartbeat and identify.** Report `audioUnlocked`, `document.visibilityState`,
  battery (`navigator.getBattery` where it exists), the app version, and the current
  program id. `identify` flashes the screen's name and spot full screen for install
  day.
- **Drop the 20 s full-ModView poll** (`app.tsx:364-384`). Put Trabolta's
  online flag in the screen stream's `hello` / a `cast` frame.

### 5.6 Admin: Run → Screens page (editor)

Use the same `CockpitState` pattern as the other Run pages.

- **Fleet grid**, one card per screen: name, spot/room, tags, online dot, 🔊 unlocked
  or "needs a tap", piloting?, battery, and a live mini-render of its current
  program. The editor can import the terminal's `ScreenLayer` like it embeds the play
  app for Players.
- **Prompts panel**: every beat/INTERACTION that contains `show … on` or `announce`
  becomes a button, so the source docs' "MONITOR PROMPT V1…V6" and "APP PROMPT
  C1/C2" are literal buttons. Also: **Blackout all**, **Clear all**, **Screensaver**,
  **Identify all**, **Reload all**.
- **Ad-hoc composer**: pick a template, a target and the fields → `POST
  /api/mod/screen` (journaled, `by` = the director).
- **Local-folder backend.** The in-browser `Sim` (`store/sim.ts`) applies the same
  `ScreenHub` logic client-side, so rehearsals preview screens without a server.

### 5.7 Phones (the play app): the takeover

The finale needs the *chat app itself* to become a flashing "Go to the living room"
screen. Add a `takeover` widget kind: `overlay: true` (as `tutorial` does,
`play/src/widgets.tsx:286`), full-screen, flashing, chime + vibrate, dismissed only
by a later `clear takeover to everyone` or a story move. The same line in the story
can address both:

```loom
show takeover "GO TO THE LIVING ROOM" to everyone with flash: true
show takeover "GO TO THE LIVING ROOM" on screens with flash: true
```

---

## 6. Per-need template designs

| # | Template | Params | Notes |
|---|---|---|---|
| 1 | `screensaver` | `style: pipes \| mystify \| starfield \| flying-windows \| maze \| marquee`, `text` | Canvas or three.js; Pipes can reuse three, which is already a lazy chunk. Default **base** on every screen until the glitch. The glitch transition is `effect: tear` (the story already narrates it, `glitch.loom:13`). |
| 2 | `alert` | `text`, `flash`, `chime: alexa\|ding\|none`, `seconds` | Overlay. Optionally mirror any `!` broadcast to `everyone` automatically (screen setting `alerts: on`) so V1/C1 need one line. |
| 3, 5, 7 | `slide` | `title`, `body` (markdown-lite), `bullets`, `image`, `quest:` (pull a QUEST's title + brief + steps), `codex:` (pull an entry), `vars` interpolation already done by the sim | A Win98 "PowerPoint" frame. V6 results: authored body with `{Night.hunt_answered}`-style interpolation, or `results:` listing which facts were accepted (from vars the director sets in the cockpit). |
| 4, 6, 21 | `countdown` | `title`, `minutes`/`seconds` or `until`, `then` (event fired at zero), `warn: 60` (last-minute styling), `sound` | Server-held deadline; the client renders from `endsAt`. The `then:` firing lives on the server so a sleeping tablet cannot stall the story. |
| 8 | `world` | `follow: auto\|<guest>`, `banner` | The existing `WorldSlot` (`app.tsx:186-227`) as a program. **`auto-raise`**: while anyone is in the simulation and no program is active on the `program` layer, screens tagged `tv` raise `world` on their own. |
| 9 | `video` | `src` (media name), `sync`, `loop`, `muted`, `then`, `late: seek\|skip`, `captions` | The hijack ad: `startAt = now+1.5s` on every screen, sound on speakers only, `then: the ad ends` resumes the beat. |
| 10 | `ads` | `playlist` or `items`, `seconds`, `shuffle` | Images or short videos rotated as a base layer. Plus `popup` (overlay): a fake Win98 dialog ("Your protection has expired") that appears over whatever is on and auto-dismisses. McAfee's line (`cast/antivirus.loom:65`) becomes a popup on screens as well as a phone broadcast. |
| 11 | `chart` | `kind: trust`, `reveal: slow\|instant`, `top/bottom` callouts | Data: `trust = 10·truths − 5·reinstalls + assessment`. The story needs `truths: 0 to 20` (incremented when a director accepts an answer: an admin INTERACTION "accept truth" with `args who`) and `assessment: -10 to 10` (set by the Trabolta agent via `adjust`, already clamped to declared ranges, or by the director). Pick one: the server computes rows in `ScreenHub` from `sim.worldEntries()`, or the story sets `program.score` so the existing `RosterRow.score` (`views.ts:230`) is the metric. Reveal animates bottom-up, then the face speaks the praise/insult lines (`face` template). |
| 12 | `clock` | `from: "1999-12-31 23:00"`, `minutes: 60`, `rate`, `then: midnight`, `glitch: true` | A Windows-98 taskbar clock blown up full screen. At 23:59 the digits jitter. At zero the server fires `midnight`, and the story chooses the final-reveal branch if no faction has a majority. |
| 13 | `video` on the tent tablet | `src: webmd-intro` | **Option A (preferred):** the reinstall web wizard plays the intro video after a pass scan, before *Play here / Send to VR*, skippable once watched for that guest (shared `@loom/screen` player module). **Option B:** a separate terminal in the tent with `view=signage spot=tent`, and the story does `show video webmd-intro on spot tent` from `when captured`. Record WebMD (Julia Tufts) live for the video. |
| 14 | `effect blackout` + `takeover` | `seconds: 10` then `text`, `flash` | Screens go fully black (CSS `background:#000`, and dim to 0 where the OS allows) in sync with the light cue. Then the takeover on screens + phones (§5.7). |
| 15 | `song` | `src`, `lyrics` (VTT), `voice` (Sandy lines as TTS cues), `variant: full\|sandy-only` | Pre-render both mixes, the vocoder Trabolta + Sandy, and Sandy-only. That is far more reliable than synced TTS. Lyrics on every screen; audio from the speaker screen or, better, the house audio system (stagehand OSC → a laptop player) with screens showing lyrics against `startAt`. **Dance song**: `song` with no lyrics, plus a visualizer (AnalyserNode is already in `engine.ts:107-121`). |
| 16 | `textfile` | `codex: truth.txt` or `text`, `reveal: typed\|scroll`, `speed` | Notepad window, big monospace, auto-scroll at reading pace. The director can step it from the Screens page. `unlock truth.txt for everyone` at the same moment puts it in every codex. Per-guest identities come from the cast's CODEX entries (the Character Sheet's real identities). |
| 17 | `announce` | `text`, `voice`, `chime` | Speaker screens only. Prefix with an "Alexa" earcon from `/media/`. Uses the existing `SpeechQueue` with a dedicated id range. If the screen is not audio-unlocked, render the text as an alert and report `audio: false` so the Screens page shows "needs a tap". |
| 18 | `face` / room voice | `character`, `room` | Setting `voiceRoom: true`: the terminal subscribes (through the screen stream, which the server filters) to story lines spoken by `character` in `loc:<its room>` and speaks them with the face. Trabolta's presentations then need no new statements: author `Trabolta: …` lines in a beat set on the Desktop. |
| 19 | `effect` | `flicker \| tear \| red \| dark \| blue \| billboard \| cascade-dark` (one by one, ordered by spot) | Overlay CSS/canvas effects. `cue screens with effect: flicker` maps here, so Trabolta's power reaches terminals too. |

---

## 7. Kiosk concerns

| Concern | Today | Recommendation |
|---|---|---|
| **Screen stays on** | Nothing. Tablets will dim and lock. | Call `navigator.wakeLock.request("screen")` on boot and after each `visibilitychange`. It **needs a secure context (https)**: Chrome 84+, Safari 16.4+; iOS home-screen PWAs only reliably since iOS 18.4. Belt and braces: Android **Fully Kiosk Browser** "Keep screen on" / "screen on while plugged"; iPad *Auto-Lock: Never* + Guided Access. Fallback: a hidden looping muted `<video>` (the NoSleep trick). |
| **Autoplay with sound** | The wake tap unlocks Web Audio + `speechSynthesis` once per page load (`app.tsx:130-135`). The mirror has none (`app.tsx:545-547`). | Prime the single media element in the same tap (§5.5). Every reload (including a remote `reload`) loses the unlock on iOS, so report `audio: false` to the Screens page and avoid remote reloads mid-show. Android: Fully Kiosk "Autoplay videos" / Chrome flag `--autoplay-policy=no-user-gesture-required` removes the gesture entirely. Fire TV (Silk / Fully): a remote **OK** press counts as activation, so the TV needs a wake prompt reachable by D-pad. |
| **Fullscreen** | Meta `apple-mobile-web-app-capable` only (`terminal/index.html`); no manifest. | Add `manifest.webmanifest` (`display: fullscreen`, `orientation: landscape`, icons) so *Add to Home Screen* gives a chrome-less app on Android and iPad. Call `document.documentElement.requestFullscreen()` from the wake tap where supported. iPhone has no element fullscreen, so use the PWA. On Fully Kiosk / Chrome `--kiosk` it is moot. |
| **HTTPS** | The README notes the camera needs it (`terminal/README.md`, *Running*). | Wake lock, service workers and the camera all require it. Either the Docker Caddy `proxy` with an internal CA (install the root on every tablet), or, nicer, a real name on the owned domain (e.g. `lan.mapsandducks.com` → the show laptop's LAN IP) with a Let's Encrypt **DNS-01** cert, so tablets trust it with no setup. |
| **Reconnect / reboot** | Spatial: good (`world/stream.ts`). Pilot: `useChatStream` + `dead` handling (`pilot.ts:107-118`). | The screen stream must replay the full stack on `hello`, and timing must come from server timestamps. A browser crash/restart: Fully Kiosk "restart on crash" and "reload on network reconnect"; set the start URL to `/terminal/` (config persists in localStorage). |
| **Stale bundles** | The world chunk is fetched at boot to dodge renamed chunks (`app.tsx:45-50`); the mirror reloads after failures (`:186-227`). | Add `version` to `hello`. On a mismatch, show a small "update available" dot. Reload only on a director's command, because reloading loses the audio unlock. |
| **Security** | A full **mod token** in localStorage (`config.ts:19`, `:85`). The ⚙ is reachable from the attract screen (`app.tsx:435-439`) and the mirror (`:559`). | Use the scoped screen/pilot capability (§5.3 item 5). Gate the ⚙ behind a long-press + PIN, or a director-side "unlock setup" toggle. Never render the token. |
| **Performance / heat** | World render capped at 30 fps, ≤1.5× DPR, paused when hidden (README, `WorldView.tsx:181-187`). | Keep templates cheap: CSS animations; the screensaver at ≤30 fps; at most one video decode at a time; free the WebGL context when the world is not the program. Tablets mounted in enclosures run hot. |
| **Power** | — | Wall tablets on chargers (cable runs, adhesive mounts/enclosures). Report battery in the heartbeat. |
| **Clock** | — | Never trust the tablet's clock: compute the offset from `serverNow` in `hello`/`ping`. |

---

## 8. Checklist: screens (software)

**Server (core)**
- [ ] `SimEvent` `screen` + `announce`; sim parsing of `show … on <target>`, `announce`, `clear`; `SHOW` regex `on` clause; lints (template, media, target)
- [ ] `ScreenHub` (programs per target/layer, deadlines → journaled `signal`, presence, restore rules) + tests
- [ ] `fanout` hook; `cue screens with effect:` → effect overlay
- [ ] Routes: `/api/screen/stream`, `/api/screen/heartbeat`, `/api/screen/media`, `/api/mod/screens`, `/api/mod/screen{,/clear,/identify,/reload}`
- [ ] Scoped **screen** and **pilot** capabilities instead of a full mod token
- [ ] `/media/` route with Range/206, ETag, mp4/webm/m4a/vtt/gif types; per-event media dir + `LOOM_MEDIA_DIR`; docker-compose bind mount
- [ ] Trust metric: story vars `truths`, `assessment` (or `score`) + chart rows; an admin INTERACTION "accept a truth"
- [ ] Room voice: server-filtered `line` frames for `character` in `loc:<room>` on the screen stream
- [ ] Trabolta online flag in the screen stream (drop the 20 s ModView poll)

**Terminal**
- [ ] `useScreenStream` (reconnect, clock offset, `gone`)
- [ ] `ScreenLayer` + templates: screensaver, alert, slide, countdown, clock, video, ads, popup, chart, textfile, song (lyrics VTT), face/announce, world, effect, takeover, identify
- [ ] `view: signage` (with `mirror` as an alias); tags + `speaker` + `voiceRoom` + `alerts` settings in setup / provisioning URL
- [ ] One primed media element; announcements through `SpeechQueue`; speaker election
- [ ] Wake lock, manifest, fullscreen from the wake tap, heartbeat (audio/battery/version), PIN-gated ⚙
- [ ] Media precache (manifest-driven)

**Play app**
- [ ] `takeover` widget (full-screen flashing overlay, chime + vibrate, cleared by story)

**Reinstall web (tent tablet)**
- [ ] Intro video (WebMD) after a pass scan, via the shared player

**Editor (Run)**
- [ ] Screens page: fleet grid with live previews, prompt buttons (V1–V6 / C1–C2), blackout/clear/screensaver/identify/reload all, ad-hoc composer
- [ ] Local-folder backend applies `ScreenHub` too (rehearsal preview)

**Story (the rewrite)**
- [ ] V1–V6 as beats with `show … on screens` (+ admin INTERACTIONs to fire them)
- [ ] Screensaver base until the glitch; the malware hijack ad; ads playlist; McAfee popup
- [ ] Trust Chart beat (chart + Trabolta's spoken praise/insult); Y2K clock with `then: midnight`
- [ ] Blackout → takeover → dance song; truth.txt as CODEX + `textfile`; the two song variants
- [ ] Alexa `announce` lines replacing the fake `"!🔊 ALEXA:"` broadcasts (`cast/hosts.loom:56,59`)
- [ ] Endings' narrated screen states (red / dark one-by-one / duck billboard / blue) as `effect` programs

## 9. Checklist: screens (hardware / content)

- [ ] One tablet per `house.json` terminal spot (mudroom, hall, desktop-tv, kitchen, bathroom, registry, tent) + the living-room TV. Update `house.json` when the house is measured, since the current map is a placeholder.
- [ ] TV device: Fire TV Stick / Chromecast-with-Google-TV running Fully Kiosk, or a mini-PC/laptop on HDMI with Chrome `--kiosk --autoplay-policy=no-user-gesture-required`. Tagged `tv speaker`.
- [ ] Wall tablets: Android preferred (Fully Kiosk license: autoplay, screen-on, remote admin, restart-on-crash). iPads need Guided Access + a wake tap after every reload. Mounts/enclosures, power runs, chargers.
- [ ] A powered speaker for the living room (TV audio out or the show laptop) for songs, the ad's audio and Alexa. Do not rely on tablet speakers for music.
- [ ] HTTPS on the LAN (DNS-01 cert on an owned subdomain, or Caddy internal CA installed on each device).
- [ ] Wi-Fi: a dedicated 5 GHz SSID/AP for show devices; DHCP reservations for the laptop.
- [ ] Media to produce (720p H.264/AAC MP4, faststart):
  - the malware hijack ad
  - 4–8 Web-1.0 ads (Maps and Ducks billboard, Trabolta, GeoCities, McAfee)
  - the WebMD intro video
  - the dance song
  - "You're the One That I Want" in two mixes (vocoder Trabolta + Sandy "I'm sorry, I didn't understand that…"; Sandy-only) + lyric VTT
  - an Alexa earcon
  - slide images (Bingo card asterisk, rules)
- [ ] Kokoro voices chosen and auditioned: Trabolta (current `am_michael`), Alexa, Sandy.

## 10. Open questions for the user

1. Should the living-room TV *also* be a Trabolta face/voice (room voice), or only signage + world? This decides whether Trabolta's presentations are authored lines or pre-recorded.
2. Music: through the TV/speaker device, or through the house audio from the show laptop (stagehand OSC)? The second is more robust for the dance song.
3. Tent: a second device for the video, or video inside the reinstall wizard (Option A)?
4. Who judges "accepted truths" live: Clippy's performer from the booth, or a director in Run? This decides where the `truths` counter is incremented for the Trust Chart.
5. iPad vs Android for the wall: it decides how much of the wake/autoplay workaround is needed.
