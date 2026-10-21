# loom-terminal — the wall terminal

A kiosk app for tablets mounted around a live Loom event: a **direct line
to an agent-voiced character** (Trabolta, in *Trapped in the Internet*).
A program holds their pass up to the camera, and for as long as they keep
typing the screen is theirs: the conversation on one side, the
character's **animated face** on the other, and every reply **spoken
aloud** in the device's own voice. Thirty seconds without input and the
line drops.

It is the same chat architecture as the rest of Loom — no new server, no
new thread model:

- A terminal is a **trusted device**. It is set up once with the event's
  moderator passcode, which it trades for a moderator token
  (`/api/mod/login`). The passcode is never stored.
- Scanning a pass (the QR on the play app's *Your pass* sheet, which is
  the guest id) mints a **play-as session for that guest** through
  `/api/mod/impersonate` — the seam the editor's Run → Players page uses.
  It is exactly the guest's own session: their `GuestView`, their stream,
  no moderator powers, cut by the same restarts that cut their phone.
- The terminal opens that stream (the play app's own `useChatStream`) and
  narrows it to `dm:<Character>` — **the very thread on the guest's
  phone**. What is said at the wall is in their DM when they walk away,
  and the character's agent answers it exactly as it answers the phone.
- Every line typed at a terminal is journaled `by` the terminal's name
  (`label` on `/api/mod/impersonate`) — the mod feed shows it as
  `via: "Terminal · Kitchen"`.

## Running

```bash
pnpm --filter loom-terminal dev      # :5175, proxies /api + /e to the server on :7000
pnpm --filter loom-terminal build    # → dist/, served by the event server at /terminal/
pnpm --filter loom-terminal test     # the pure pieces (scan parsing, the leash, splitting, voice ranking, moods,
                                     # the world state, the director, the mini-map, the screen poll, slides +
                                     # precedence, the TV voice, attract, kiosk, the WebGL2 probe)
```

Open `http://<server>:7000/terminal/` on the tablet and set it up in two
steps: **CONNECT** (the moderator passcode; skipped when the tablet already
has access), then **WHICH TERMINAL IS THIS?** — the event's live house map's
terminals (the map it plays: a director's save, the shed variant), by floor
and room, each saying its room + LOCATION and its screen in words (*TV*,
*casino*, *chess board*, *room terminal — The Server Room*, *house
terminal*), with *⚠ online now: <name>, seen 5 s ago* when another tablet
polls from that spot. One tap powers on: the name, the screen (`view`) and
the room come from the map entry (`TerminalSpot.view` / `speaks`, set in
the map editor at `/reinstall/map`), the character defaults to Trabolta.
Camera, voice, announcements, the camera feed and a manual screen / room
sit under a folded *advanced*. ⚙ on a running terminal reopens step 2
(*change passcode*, *forget this terminal*), so a tablet is re-pointed in
two taps. A terminal set up from the map follows its entry on its next
boot (a variant switch, a save); a manual screen or room stops that.

A fleet: open one link on each tablet — it connects and picks that
terminal with no taps:

```
http://<server>/terminal/?code=<mod passcode>&spot=start-bar
```

Older links with `name=` / `view=` / `room=` still work; those fields win
over the map's (a `view` or `room` given means the tablet no longer
follows the map).

(`&camera=environment` for the back camera; `&engine=` — see *The voice*
below; `&announce=1` to also say the house announcements; `&spot=` and
`&view=` — see *The world view* below; `&room=` — see *A room terminal*
below.) The passcode and the other hints
are scrubbed from the address bar at once. `character=` folds onto the
story's own spelling (`trabolta` → `Trabolta`); a name the story lacks is
refused with the cast listed, doors open or not (since wave 7 a mod code
resolves the story's declared cast before the doors,
`EventRuntime.declaredCharacters`). Only a tablet set up with no story
loaded, or against one that won't compile, keeps the typed name; it is
sent back to setup with that error once the doors open, so it never pilots
into a thread no agent hears.

**The camera needs a secure context** — `https://` or `localhost`. On a
plain `http://192.168.x.x` address every browser refuses `getUserMedia`;
the terminal says so and offers the typed fallback (a program types the
name they registered with; a unique match pilots). For a LAN party put
the server behind the Docker `proxy` (Caddy does HTTPS), or on Android
kiosks flag the origin as secure in `chrome://flags`.

Add the page to the home screen / run the browser in kiosk mode. After a
reload the terminal shows **TOUCH TO WAKE** until someone taps it once —
that one gesture is what lets a browser play sound unattended afterwards.

**Kiosk basics** (`src/kiosk.ts`): the terminal holds a Screen Wake Lock
from boot, re-takes it on the wake tap and whenever the page comes back
into view, and reports it on `<html data-wake-lock="held|off|unsupported">`.
The ⚙ opens setup only after a **2 s hold** (a bar fills under it); a short
tap does nothing. Fully Kiosk / iPad / TV-Mac settings for the show:
[`docs/trapped/kiosk.md`](../docs/trapped/kiosk.md).

**The screensaver while the character is secret** (OCT31 K-16,
`src/screen.ts` + `src/Attract.tsx` + `src/attract.ts`): every 2 s the
terminal polls `GET /e/:id/api/screen/state` (mod token, ~0.5 KB — the
story's screen cues, the running countdown, its character's
hidden/awake/online; the poll is also its heartbeat, and carries the
device's health — `audio` unlocked, page `vis`ible, `bat`tery (where the
browser has `getBattery`; not iOS) and the `ver` build stamp, `src/health.ts`
(SW-SCR-21) — for the Run → Terminals card's badges; the card's **identify**
puts this screen's name + spot full screen for 10 s with one chime, install
day's "which tablet is this?" — counted down on the device off the
answer's `identifyLeft`, so a tablet that loses the server mid-identify
still uncovers on time). While the character
is **hidden** (not yet `reveal`ed) or **asleep** (`<Character>.awake ==
false`) a face/world terminal shows a full-screen **Mystify** screensaver
(Canvas2D, ≤ 30 fps) with a fake-1999 ad every 40 s for 10 s: no camera,
no scanner, never "ONLINE", never a pilot — so tablets are provisioned
`view=auto` from the start and flip to the face within 2 s of
`introduce_trabolta`. It fails closed (attract until the server first
answers; a missed poll keeps the last answer) and an open line finishes
on its own leash first. Ads are `public/ads/<id>.png` (ids in
`attract.ts`: `ad-maps-and-ducks`, `ad-protection-expired`,
`ad-geocities`, `ad-y2k`); a missing PNG renders the ad's copy as a Win98
window. The mirror (the TV) honours attract too since K-17: it keeps the
screensaver until the character is introduced.

**Overlays, slides, countdowns** (OCT31 K-17 + N-03, `src/slides.ts` +
`src/ScreenLayer.tsx`): the same poll carries the story's screen program
for this terminal's target (`view=mirror` / `tv` = the TV, else a wall terminal;
`core/server/routes/screen.ts`). Precedence, top first: **overlay**
(`blackout` — 10 s true black even when `go_to_living_room` follows at
once, then standing; `go_to_living_room` / `alarm` — text blinking at
1 Hz on a black field, never full-field red; an overlay pauses the
scanner and ends an open line) > **slide** (any other `screens_*` /
`tv_*` / `terminals_*` value, held 45 s on a terminal / 90 s on the TV;
`bingo`, `y2k`, `trust_chart`, `truth_txt`, `award_*`, `ceremony*` stay
until the next cue and beat attract) > **attract** > the base view. A
pilot pre-empts a slide. **On a face terminal** (not the TV, not a
mirror, not on the screensaver) **a tap on a held slide peeks under it**
(B21): the scanner and *type your program name* show, the corner
countdown is hidden too (its box covers CONNECT), an overlay still covers
everything, and the slide comes back once nobody has touched the tablet
for 30 s (`PeekClock`, `slides.ts`) or a line opens. A slide is `public/slides/<cue>.png` (e.g.
`screens_trivia_1.png`, `tv_bingo.png`), else `<value>.png`; a missing
PNG renders a Win98 text card (`SLIDE_COPY` — the trivia cards carry the
Quest Log's own questions, test-checked against `quests.loom`), never a
broken image. **On the TV only** (`view=tv`, N-04a), a slide first tries
`public/slides/<cue>.mp4`, else `<value>.mp4` (e.g.
`screens_ad_hijack.mp4`): it plays once from the start with sound (muted
by the director's TV mute) over the PNG / card, which shows at once and is
covered only once the clip has a frame; at its end or on any error the
still is left. With no mp4 there nothing changes (the still is never held
back while the missing clip is asked for). Keep a clip under the
TV's 90 s hold and small (the server sends it whole, no Range), and use
either it or QLab for the ad, never both. The wall tablets never try
video. `y2k` is drawn live: a blown-up taskbar clock at midnight
minus `remaining`. `trust_chart` is drawn live from the poll's `chart`
rows, revealed bottom-up one row every 1.5 s from the server's `revealAt`
(`chartReveal`; a restart shows every row at once); the MOST / LEAST
TRUSTED call-outs follow the server's `top` / `bottom` names (the story's
`Night.most_trusted` / `least_trusted`, so nobody is marked before
Trabolta names them). Any running story countdown shows as a ⏱ corner
(`countdown_*` cues never replace the slide); `flicker` is one 2 Hz
stutter. Ages run on the server's clock. Device check:
`scripts/accept/K-17.sh`.

**The TV room voice** (OCT31 K-18 + N-04b, `src/Tv.tsx` + `src/tv.ts`):
`view=tv` is the TV over the fireplace, run by the house Mac's Chrome full
screen over the long HDMI (launched with
`--autoplay-policy=no-user-gesture-required`; sound out of the MOTU's
living-room pair):

```
https://<server>/terminal/?code=<mod passcode>&name=TV&character=Trabolta&spot=desktop-tv&view=tv[&room=The Desktop]
```

The character's face full screen (the world takes the right 62 % while
someone is in the simulation), the K-17 layer over it, attract until the
introduction. It polls every **1 s** with `voice=<room>` (default
`The Desktop`) and its chat cursor, and plays the room's new lines strictly
in order with a caption: the character's own lines — scripted, or a
director's `say` as him — are **spoken** (the Mac's own voice in Chrome —
a male one first, Daniel on a stock Mac, or a downloaded Enhanced /
Premium voice ranked above it; pick one in ⚙ — never the `alexa`
player's Samantha); lines from the song
beats `Song Ending` / `Sad Confession` / `The Hand Jive` are **captioned
only** (QLab plays the sung track); **Sandy** is captioned, never voiced
(lore, #28); other characters are ignored; nothing is said on attract.
Those text-only captions (Sandy, the songs: `data-mode` `text` / `song`)
sit **over** a slide and under an overlay, so the song isn't hidden behind
the ♪ card and the Y2K / ceremony / award slides keep Sandy's line; a
spoken caption, and a line the director muted, stay under the slide. A
booting TV starts at the room's head (no backlog), a gap of 15 s between
answers resyncs, a restart resyncs. **Mute**: the 🔊 button or `M` on the
TV's keyboard → `POST /api/mod/screen/voice` (server-side, so it survives a
reload and the director can flip it — K-29 card; the server keeps it in
`screen-voice.json`, so a server restart, a redeploy or Go live in place
leaves it as it was). Without the autoplay flag
a *CLICK ONCE TO ENABLE THE VOICE* banner asks for one click. Device check:
`scripts/accept/K-18.sh`.

**A room terminal** (wave 7 — the server-room terminal; `roomOf` in
`src/config.ts`): `room=<LOCATION>` on any view but the TV makes the
terminal belong to that room.

```
https://<server>/terminal/?code=<mod passcode>&name=Server Room&character=Trabolta&spot=server-room&view=face&room=The Server Room
```

- It polls with `room=<room>` and its chat cursor; the server answers
  `room: {id, open}` (open = the LOCATION isn't `hidden:`, or was
  `reveal`ed to everyone — a per-person reveal or a visit doesn't count;
  an unknown name is `{id: "", open: false}`) and keeps the terminal on
  **attract while the room is closed**, plus the room's `voice` block. A
  server too old to send `room` keeps it asleep too (fail closed); a
  misspelled room says so in the attract corner. The server resolves the
  name against the story's declared LOCATIONs before the doors too, so
  that corner means a typo, never "too early". Run → Terminals shows the
  room on its row (amber off the `server-room` spot).
- While asleep the app keeps the voice cursor on the room's head
  (`cursorWhileAsleep`, `src/tv.ts`), so the lines that land *with* the
  wake — the door cutscene reveals the room and speaks in it in one go —
  are spoken, never resynced away.
- Awake, it plays the room's lines through the TV's `planVoice` /
  `LinePlayer` path into the line's own speech queue (captioned under the
  face; the face's mouth moves), pauses the scanner (**LISTEN**) while he
  speaks, and is **never muted**: the director's mute is scoped to the TV
  target on the server.
- The screen layer drops **story slides and the countdown corner** for
  it (`screenLayers(…, {room: true})` — so the Y2K clock never covers it);
  the overlays (blackout, alarm) and the flicker still reach it.
- A pass that opens a line posts `POST /api/mod/signal {name: "terminal
  opened", subject: <guest id>, args: {at: <room>}, label: "Terminal ·
  <name>"}` (`postVisit`, `src/pilot.ts`); every way the line ends (leash,
  DISCONNECT, an overlay, a restart, `pagehide` with `keepalive`) posts
  `terminal closed` once (`VisitLatch`). Best-effort, never awaited.

- **📎 GIVE HIM A FILE** (wave 11, `src/FilePanel.tsx` + `src/files.ts`):
  while a pass is piloted at a room terminal, the line has a file panel —
  the guest's own codex entries (`GuestView.codex`, off the pilot's
  stream), each with **Give** (the guest's own `POST
  /api/guest/codex/share {entry, to: <character>}` with the pilot token,
  so the story hears it as from the phone; a refusal is shown in the
  server's words). A file he always turns down has no Give: a
  `secret: true` one (the digit notes, *The Door Code*) or lore about
  someone else reads *A SECRET FILE: HE WON'T TAKE IT* / *ABOUT X: HE
  WON'T TAKE IT* (`refusalOf`, the server's own 403 rule),
  a **TYPE A CODE** box and **SCAN A FILE'S QR** (a codex QR's
  `?unlock=`) that redeem for the guest (`/api/guest/codex/redeem`) and
  then offer the new entry to give. A camera read is redeemed once: the
  camera stops after it, and a code the panel already unlocked is offered
  again without a second redeem (every redeem is journaled; a wrong one is
  the story's `wrong code`). While it is open the leash runs **120 s**
  instead of 30 (*STILL THERE?* for the last 20 s) — it is never held, so
  a guest who walks off with the panel open is still disconnected.

Kiosk notes: [`docs/trapped/kiosk.md`](../docs/trapped/kiosk.md) → *The
server-room terminal*.

**The King's chess board** (wave 11, `view=chess`; `src/chess/`): the
terminal outside the server-room door, the only place the King is played.

```
https://<server>/terminal/?code=<mod passcode>&name=Server Door&spot=server-room-door&view=chess
```

- **Awake all night**: it never follows the character's hidden / asleep
  (no screensaver). The attract screen is THE KING, his one shared health
  bar (`n / 15`, off the screen state's `king {hp, max, fallen, armed}`;
  an older server sends none: no bar, full strength), the stakes line
  (`armed` true: *Checkmate him and the server-room door code goes to
  your Codex.*; false: *No prize now.*), and the scanner + typed
  fallback. Never the strength ladder: no hints, no tips, no ladder copy.
- A pass is checked through the moderator lens (`GET
  /api/state?role=guest&as=<id>`: 404 unknown, `restricted`); a marked
  program is refused (*⛔ Marked programs can't challenge the King.*).
  The board deals at `stageFor(hp, max)` read **at the deal**
  (`@loom/chess`: a full bar is grandmaster, 1 … 14 club / beginner /
  dizzy, only a felled King pawns only); hits landing mid-game change
  nothing. **No hints, no tips**; a two-tap **Give up**. The King thinks
  in 12 ms slices (`pickMoveAsync`) so taps stay live on old tablets.
- **One game per scan**. The leash is 120 s with no touch (held while he
  thinks or an overlay is up), *STILL THERE?* for the last 20 s; it runs
  out silently, like Give up: nothing reaches the story.
- A game's end posts `POST /api/mod/signal {name: "chess won" | "chess
  lost" | "chess drawn", subject: <guest id>, label: "Terminal · <name>"}`
  (`src/chess/post.ts`): retried 0.5 → 8 s, 5 s per attempt, a 4xx final,
  kept in `localStorage` (`loom.terminal.pending-chess`) while in flight
  and re-sent on the next boot only within 60 s. The result screen says
  *Checkmate. The door code is in your phone's Codex.* only once the win
  landed while `armed` and the story took it (a 200 with `refused: true`
  — a win after truth.txt or an ending — says *Checkmate. No prize now.*);
  a win that never landed says to tell a host (♟). A program that already
  holds *The Door Code* (an earlier win, the four digit notes, the
  majority) reads the same Codex line: the story takes the press and
  their phone says *♟ Checkmate again. You already hold the door code: it
  is in your Codex.*
  It stays ~10 s after the post settles, then attract.
- Layered like a room terminal: overlays only (they cover the board and
  hold the game), never a story slide, the countdown corner or the Y2K
  clock. The poll is its heartbeat like any terminal's.
- The chess code is its own lazy chunk (`ChessTerminal-*.js`, chess.js +
  `@loom/chess`, ~60 kB), preloaded at boot on a chess terminal only.

**The casino** (wave 15, `view=casino`; `src/casino/`): a terminal in the
upstairs bedroom where a program bets its own Truthcoin.

```
https://<server>/terminal/?code=<mod passcode>&name=Casino&spot=graphics-card&view=casino
```

- **Awake all night**, no character, no room (like the board). Attract:
  the marquee, the three games and their pays, the scanner + typed
  fallback. A pass is read through the moderator lens (`GET
  /api/state?role=guest&as=<id>`: the name, `restricted`, `wallet.balance`);
  a marked program and a story with no currency are refused at the scan.
- Seated: the balance, then the lobby (THE COIN · UNDER / OVER 7 ·
  ONE-ARMED BANDIT) and a game's table: stake chips 1 / 5 / 10 / 25 / 50
  (only the ones the balance covers), the picks with their pays.
- **The server rolls every bet**: `POST /api/mod/casino/bet {guest, game,
  pick, stake, label: "Terminal · <name>"}` (`src/casino/post.ts`) →
  roll + payout + balance; the screen spins at least 1.1 s, then shows
  the roll and plays a square-wave jingle (win / jackpot / lose). Never
  retried — a bet is not idempotent: no answer reads *check your wallet*
  and the balance is re-read. The rules, odds and labels are core's
  (`core/src/casino.ts`, imported by path).
- **CASH OUT**, or 60 s with no touch (held while the house rolls or an
  overlay is up; *STILL THERE?* for the last 15 s), returns to attract
  with how the sitting went (*WINAMP WALKS AWAY 30 TRUTHCOIN UP*).
  Nothing is lost: every bet already settled into the guest's wallet.
- Layered like the board: overlays only. Its own lazy chunk
  (`CasinoTerminal-*.js`, ~20 kB). Pure session in `src/casino/session.ts`
  (`test/casino-session.test.ts`), calls in `test/casino-post.test.ts`.

## The voice

**Every device speaks with its own voice** (decision 2026-10-15: "for the
most part I don't care if the voices on the terminals / TV are consistent").
Nothing on the night depends on a server voice. `src/speech/engine.ts`:

| `engine` (⚙ / `&engine=`) | What speaks |
|---|---|
| **`browser`** (default) — *this device's own voice* | The ladder, re-decided per sentence: `speechSynthesis` when it lists voices (ranked by `pick-voice.ts`: Edge *Natural*, iPad / Mac *Enhanced* / *Premium*, Samantha …) → **Fully Kiosk's** text-to-speech (`fully.textToSpeech`, Android's TTS engine) when the page runs in Fully with its *JavaScript Interface* on — the old tablets' System WebView may not implement `speechSynthesis` at all (OCT31 K-02) → **text only**. A `speak()` that hasn't started after 4 s is written off as a stub and the ladder moves on — until the next tap (Safari ignores a `speak()` before the first gesture, so an announcement that lands before TOUCH TO WAKE doesn't mute the tablet for the night). |
| `fully` — *Fully Kiosk's voice* | Fully's TTS first, even when the WebView lists voices (some list voices and never speak). Outside Fully: the ladder. |
| `silent` — *no voice, text only* | The transcript reveals at reading pace, the mouth flutters. |
| `server` — opt-in | The event server's `/api/mod/tts` (Kokoro, OpenAI, any OpenAI-compatible endpoint — `core/server/tts.ts`), cached per line across every terminal, the mouth on the real waveform. The first **502 / 503 / 504** (no server voice, the box is down) **latches** it to this device's voice for the session — no asking per sentence. Needs `LOOM_TTS_URL` on the server (off by default; the compose stack's `kokoro` is behind `--profile tts`, `docs/loom-docker-deploy.md` §5¾). |

**The character never sounds like the announcements.** With no voice
picked, the character's lines rank a **male** voice first
(`CHARACTER_VOICE` — Daniel on a stock Mac) and the house announcements a
**female** one (`ANNOUNCE_VOICE` — Samantha, which is also the house
Mac's `alexa` `say_voice`); a voice picked in ⚙ is the character's only,
never the announcements'. A name the lists don't know leans neither way.

⚙ lists the device's voices best first for the character (blank = the best one), says what
this device can do ("this device has 23 voices" / "Fully Kiosk's
text-to-speech will speak" / "text only"), and **TEST VOICE** says a line
through exactly the voice the terminal will use and names it. A voiceless
device never stalls the queue: every engine ends a sentence by itself
(reading-time caps), and the transcript keeps revealing. The note under
the face says when the voice isn't the one asked for (`no voice on this
device — text only`, `this device's own (no server voice)`). Replies are
split into sentences and prepared one ahead, so speech starts on the first
sentence and the transcript reveals as it is said.

**The house announcements** (OCT31 N-09, decision #20, `src/announce.ts`):
the story's `do announce "Go to the living room."` already plays out of the
house speakers (stagehand `alexa`, K-20). The screen poll carries the
last three too (`announces: [{seq, text, at}]`, oldest first, beside the
latest in `announce` for older builds), and a terminal with
**`announce`** on (⚙ → *say the house announcements here*, or
`&announce=1`; **off by default**, the TV too — its room hears the house
speakers) rings a two-tone chime and says it in its own voice under a 📢
banner — each of two inside one poll, in order. Never one that was current
when the page loaded, never replayed history after a server reboot or a
story restart (one announced right after a restart is said: the state's
`announceEpoch` changes with the sim, so the terminal resyncs even when the
restarted story's seqs, counted from 1 again, reach its old cursor; one
announced before any screen's first poll of the restarted story, a second
at most, is history), never one
older than 30 s, and never over
the character: every voice on the page waits its turn on one `VoiceFloor`,
so an announcement follows the line being said and the next line follows
the announcement. On the TV the director's mute holds for announcements.

Server env (only for the opt-in server voice):

```
LOOM_TTS_URL       base of the speech API (unset / blank / off = no server voice — the default)
LOOM_TTS_API_KEY   bearer token, if the endpoint wants one
LOOM_TTS_MODEL     default "kokoro"
LOOM_TTS_VOICE     default "am_michael"  (Kokoro: am_adam, bm_george, af_bella+af_sky …)
LOOM_TTS_FORMAT    mp3 (default) | wav | opus
```

## The face

`src/face/` — an SVG head driven by a requestAnimationFrame loop: brows,
lidded eyes that look around and blink, a mouth that opens with the live
loudness of the voice (an `AnalyserNode` on the server voice's decoded
audio; on the device voices, which expose no waveform, a synthesised
syllable flutter gated by a word rhythm — `syntheticLevel`).
The mood is read off the situation (waiting / someone connected /
composing / speaking) and off each sentence as it is said (`mood.ts`:
shouting is anger, a question is curiosity, an ellipsis is slyness). A
dropped line glitches.

## The world view

During the *reinstallation* games (`docs/loom-reinstall.md`) a program
captured into the Internet explores a virtual copy of the house to find the
golden duck, in VR or on a tablet. Every terminal can watch: `src/world/`
holds the spatial stream (`GET /api/spatial/stream?token=&name=` — poses at
10 Hz plus `hello` / `join` / `found` / `leave` / `house` / `duck` / `reset`;
a `duck` frame moves a player's duck when a map save re-deals it) and the
event's house map (`GET /api/spatial/house`, refetched when the stream
announces a new version; the show's own `house.json` is bundled as the
offline fallback). It renders through `@loom/house/three`, the same scene
builder the web game uses, so the house looks the same on every screen.
Players appear as ghosts with name tags (interpolated 120 ms behind), and
each one's duck lays its egg and flies away when they find it — never for
a find the story kept (the banishment: the `found` frame says
`released: false, captured: true`), where Gerald stays put.

One camera, cut by a pure director (`world/director.ts`, no three.js):

- **mount** (a placed terminal — a `spot` on the map — always): a window into
  the virtual house from where the tablet hangs. The camera is the terminal
  itself, fixed at its spot on the wall and looking along its yaw/pitch/fov
  (default −8°, and `DEFAULT_SPOT_FOV` = 70° *vertical*; the mini-map's cone
  is its `horizontalFov` on a 16:10 tablet, ≈ 96.5°) — `windowPose(house,
  spot)`, the same pose the shadow view projects through. It is the mirror of
  the games' virtual terminals, which show the real room through the
  tablet's camera: players cross it as ghosts, and it never follows them,
  never orbits, and a find doesn't move it (the celebration is the overlay's).
  Tagged **LIVE · THIS ROOM**.
- **follow** (an unplaced terminal): the camera rides over the shoulder of the
  most recently active player (**FOLLOWING ADA**). Whoever just found the
  duck takes the camera. It holds a player for a few seconds and won't
  flicker between two. It is pulled in short of any wall (each wall a slab
  of the map's thickness, so never into or past one) and kept under the
  ceiling. With their back to a wall it tries a raised chase, then the left
  shoulder, then looks out of the player's own eyes (their ghost hidden).
- **orbit** (an unplaced terminal with nobody playing): a slow circle of the
  spawn room.

Overlays: the banner *REINSTALLATION IN PROGRESS · <name> · <room>*, the
camera's mode tag, the counts line (**2 REINSTALLING · 1 HERE** — here = in
this terminal's room — so a window on an empty room says where everyone is), a corner **mini-map** of the floor (every player's dot
and heading, every unfound duck on that floor — whichever floor its player
is on — this terminal's view cone), and the celebration
*<NAME> HAS BEEN REINSTALLED* (or *FOUND THE GOLDEN DUCK* for a program
that was never corrupted, or *GERALD CAN'T HELP* in plain phosphor for a
kept find; a server that doesn't send the frame's `captured` never shows
that one). Rendering is capped at 30 fps, at ≤ 1.5×
pixel ratio, stops while the page is hidden, and frees its GL context when
the view closes (a new map gets a fresh canvas — a lost context is never
reused). three.js is a lazy chunk, so a face-only terminal never
downloads it; any other terminal fetches it at boot, and a chunk that fails
to load (or a view that crashes) never takes the scanner down — an error
boundary falls back to the face and retries 30 s later (a mirror reloads
the page instead, when the page is reachable, at most every 5 minutes).

The stream: a dropped connection keeps the last ghosts for 10 s, then
clears them (an `auto` terminal gives its face back). A refused stream is
probed — 401 (access revoked) sends the terminal back to setup without its
token, 404 (the event ended) back to setup with its settings kept; anything
else retries with backoff (5 s doubling to 60 s).

Two settings, on the setup screen or in the provisioning link:

| Setting | Values |
|---|---|
| `spot` | a `house.terminals[].id` of the event's map: where this screen hangs (the setup screen lists them as *name — room*). Blank = unplaced: it never mounts, only follows / orbits the spawn room. Placed: always a fixed window from that spot. |
| `room` | a LOCATION (wave 7): on the TV, the room it speaks for (blank = The Desktop); on any other view, the room it **belongs to** — asleep until that room is open, speaking its lines (*A room terminal*, above). Blank = a house terminal. The `chess` view ignores it. |
| `view` | `auto` (default): the face pane shows the world view while anyone is in the simulation, the face otherwise. `world`: the world view always. `face`: never. `mirror`: see below. `tv`: the TV room voice (above), no scanner. `shadow`: the camera with the players as ghosts in it (below), no scanner. `chess`: the King's chess board outside the server-room door (*The King's chess board*, above; awake all night, ignores `room`). `casino`: the upstairs casino (*The casino*, above; awake all night, ignores `room`). While piloting it is **always the face**, because the face is the voice. A tablet with **no WebGL2** (three r186 needs it; `src/webgl.ts` probes once at boot) never loads three.js: wherever it would draw the world (`auto` while someone plays, `world`, `mirror`, `shadow`) it draws the raycaster instead (a simple recreation of the game from the terminal's spot) — never the *SIMULATION UNAVAILABLE* retry loop. The TV, chess, casino and face views are unchanged. The build targets `chrome87` / `safari14` (`vite.config.ts`). |

**The mirror (a TV).** `view=mirror` turns a screen into a full-screen
spectator: there is no scanner, no chat and no wake tap (it never speaks).
The show's TV over the fireplace runs `view=tv` instead (the same spectator
plus the room voice, above); both get the TV's screen program. It still needs the moderator passcode,
because the stream is mod-gated. Open the link on the TV's browser (a smart
TV, a Fire Stick, or a laptop on HDMI in kiosk mode):

```
http://<server>/terminal/?code=<mod passcode>&name=Desktop TV&view=mirror&spot=desktop-tv
```

A `spot` is optional for a mirror; without one it never mounts. The ⚙ in
the corner reopens setup (hold it 2 s).

**The camera feed and the shadow view (wave 14).** A placed terminal
(`spot` set) **sends its camera to the games**: ~3 frames a second, a
160 × 120 JPEG (quality 0.5, a 4:3 centre crop, never mirrored) to
`POST /e/:id/api/mod/spatial/cam {spot, jpeg, w, h}` with its mod token
(`src/camfeed.ts`), and the reinstallation games hang that picture on the
wall where the tablet hangs. Never while the page is hidden, never two
uploads in flight, backing off 1 s → 30 s on a failure and stopping on a
404 (`no such spot`) or a refused token until ⚙ changes the spot — ⚙ shows
the feed's status and switches it off (`camFeed`, on by default; the URL's
`&cam=0`). The pass scanner, the feed and the shadow view share **one**
`MediaStream` (`src/camera.ts`, ref-counted; opened at the scanner's 720p
with the configured facing mode), so an old tablet never opens its camera
twice. `view=shadow` (`src/shadow/`, its own lazy chunk) is the camera full
screen with every reinstallation player on this floor and in front of the
tablet drawn over it as a dark, glowing, flickering ghost (picture + name
tag), placed through a three.js camera matched to the spot (pos, yaw,
pitch, fov) — the room's shadow dimension; a selfie camera is mirrored,
ghosts and all. No scanner (a spectator, like `mirror`). `auto`'s pane
shows the shadow instead of the world while the camera is live; no camera,
no spot on the map or no WebGL falls back to the world view. ⚙'s spot,
view, room and character are pickers (the event's house map, the views
with a line each, the map's LOCATIONs, the story's cast), and a spot the
map lacks — from ⚙ or a provisioning URL — says so.

**Before the character exists (attract).** A character can arrive partway
through the night: in *Trapped in the Internet* Trabolta is `hidden: true`
and asleep until Clippy introduces him (`introduce_trabolta`). Every
face/world terminal and the mirror hold the screensaver while the
character is hidden or asleep (see *The screensaver while the character is
secret* above): no *ONLINE*, no scanner, no pilot. Provision them all
`view=auto` from the start. On the server, `AgentHub`'s `admits` hook
refuses a guest's DM with a character still hidden from them, so a stale
tab can't draw the hold line early either. The story's `cue screens_*` /
`terminals_*` / `tv_*` directives drive the screen layer (*Overlays,
slides, countdowns* above) through the same poll.

## Layout

```
src/app.tsx            the screens: setup → (screensaver) → attract → connecting → piloting
src/screen.ts          the 2 s screen-state poll (K-16): attract while the character is hidden/asleep
src/tv.ts              the TV room voice: which lines are spoken / captioned, the cursor, the player (pure, K-18)
src/Tv.tsx             view=tv: the face full screen, the voice, captions, the mute
src/attract.ts         the screensaver rotation, the ads' copy, Mystify (pure)
src/Attract.tsx        the screensaver screen (Canvas2D) + ad cards (PNG, else a Win98 window)
src/slides.ts          the screen layer's precedence, holds, slide copy, corner + Y2K clock (pure, K-17)
src/ScreenLayer.tsx    overlays, slides (TV: mp4 first; PNG, else a Win98 card), the corner, the flicker
src/kiosk.ts           the Screen Wake Lock + the 2 s ⚙ hold (K-15)
src/webgl.ts           the one-time WebGL2 probe + the pane routing: no WebGL2 → the raycaster, three.js never loaded (K-14)
src/raycast/           the raycaster (wave 16, lazy chunk, no three.js): the game recreated in Canvas 2D from the
                       terminal's spot — raycast.ts (camera, rays, sprites; pure) + plan.ts (the inset, words) + RaycastView.tsx
src/config.ts          per-tablet config (localStorage) + URL provisioning
src/scanner.tsx        camera + QR (BarcodeDetector, else jsQR)
src/scan.ts            what a scanned code means; the typed-name fallback
src/pilot.ts           impersonate / end / say; the DM thread off the guest stream; a room terminal's terminal opened / closed
src/idle.ts            the 30 s leash (paused while the character is answering); 120 s with the file panel open, and on the chess board
src/controls.tsx       the typed fallback + the 2 s-hold ⚙, shared by the line and the chess board
src/files.ts           the heart terminal's file panel: give / redeem as the piloted guest (pure-ish)
src/FilePanel.tsx      📎 GIVE HIM A FILE: the guest's entries, a code box, a codex-QR camera
src/chess/             session.ts (the board's screens, pure), post.ts (chess won/lost/drawn + pending,
                       the pass lookup), ChessTerminal.tsx (lazy: the board, the King's turn), chess.css
src/chat.tsx           the thread + composer
src/speech/            engine.ts (device ladder: browser → Fully → silent; opt-in server; the queue + VoiceFloor),
                       split.ts, pick-voice.ts
src/announce.ts        the house announcements (N-09): which to say, the chime, the hook
src/face/              Face.tsx (SVG + animation), mood.ts
src/world/             stream.ts (spatial SSE + house map → WorldStore), state.ts (the reducer),
                       director.ts (mount = the fixed window / follow / orbit), overlay.ts (the counts line), label-point.ts, minimap.ts + MiniMap.tsx,
                       WorldView.tsx (the three.js canvas + overlays, lazy-loaded)
```

Server-side pieces live in `core/server`: `tts.ts` (the proxy + cache),
the `/api/mod/tts` route and the `label` on `/api/mod/impersonate` in
`event-runtime.ts`, and static serving of `dist/` at `/terminal/` in
`server.ts`; the screen-state poll is `routes/screen.ts` (`ScreenWatch`).
The spatial plane the world view watches is `spatial.ts`
(`SpatialHub`) plus the `/api/spatial/*` routes; the house map, its
geometry and the three.js scene live in `house/` (`@loom/house`).

## The raycaster (no WebGL2)

The reinstallation for a tablet that can't draw the 3D world (Chrome 87 /
Safari 14 / the old Android tablets with GLES2-only GPUs): a **simple
recreation of the game** (wave 16). It draws wherever such a tablet would
have drawn the world (test it on a laptop with Chromium's `--disable-webgl
--disable-3d-apis`). Same feed as the world view (`world/stream.ts` +
`world/state.ts`), drawn in **Canvas 2D** by a classic raycaster
(`raycast/raycast.ts`, pure): one ray per column at ~320 × 180 (180 rows,
240–400 columns at the box's aspect), scaled up pixelated, ≤ 20 fps,
stopped while hidden — its chunk (`RaycastView-*.js`, ~20 kB) imports only
the main bundle, never three.js.

A placed terminal is a **fixed window** from its own spot (`pos`, `yaw`,
`pitch` default −8°, vertical `fov` default `DEFAULT_SPOT_FOV`): the virtual
copy of its room seen from where the tablet hangs, the way the games'
virtual terminals show the real room, so you watch the players walk past
in the second person. A terminal with no spot follows the most recently
active player (a fresh find first) over the shoulder, pulled in short of a
wall behind them, smoothed. Only the camera's floor is drawn: the
`buildWalls` segments in their rooms' colours (each side its own room),
lit by orientation (north / south faces brighter) and dimmed with
distance, door gaps open with their lintels over them, rails and fences
see-through; a flat floor and ceiling. Each player is a billboard — a body
in their colour under a Win98 tile with their picture (else a disc) and a
name tag — interpolated ~120 ms behind (`PoseBuffer`), clipped column by
column against the nearest wall; their golden duck bobs; the King stands
with his shared bar (grey, *HE KNEELS* at 0). A small inset shows the
busiest floor top-down (`raycast/plan.ts`: rooms, walls, the players, this
terminal's view cone; it follows the players to another floor only after
2.5 s). A find shows *REINSTALLED: NAME* (*GERALD CAN'T HELP* for a kept
one); joins / leaves toast (never a reconnect's whole roster or a story
reset); the corner reads *LIVE · n REINSTALLING* · *WINDOW · ROOM* (or
*FOLLOWING NAME*) with the stream's dot. With nobody playing it says
*NOBODY IS REINSTALLING* (`auto` keeps the face then, as before), and the
attract screen still takes over while the character is asleep.

## Sound, full screen and the cutscenes (wave 17)

**Sound** (`src/sound/`). One master `GainNode` over the shared
`audioContext()`, an effects bus at the view's level (TV 0.35, others 0.6)
through a soft compressor, and 30 synthesised effects — no files:
`sfx(name, {over?, gain?, pitch?, delay?}) → boolean`, names in
`SFX_NAMES` (`ding chord error critical exclamation startup shutdown tada
click popup close modem glitch type whoosh drumroll fanfare siren coin tick
boom sparkle buzz blip spin win lose static heartbeat chime`). An effect is
**dropped, never queued**, while sound is locked, while `setSoundMuted(true)`
(the TV's director mute) or while a voice holds the floor — unless `{over:
true}`, which plays it at 40 %. These are the page's accents only: every
story `sound X` and every announcement is the house speakers' (D4). The
announcement chime and the casino jingles ride the master bus unchanged.

**Full screen** (`src/fullscreen.ts`, D7). On by default (`fullscreen` in
the stored config, a ⚙ checkbox — no URL hint): every gesture while not full
screen asks again (`requestFullscreen` / `webkitRequestFullscreen`; Fully
Kiosk's JS interface hides the bars where it has the calls). State on
`<html data-fullscreen>` and the poll's `fs=1|0` (no `fs` when a director
turned it off or the browser can't; Run → Terminals shows ⛶ on `fs=0`). The TV's Chrome keeps
`--kiosk` — the only no-gesture route. Browser-level full screen counts as
full (`browserFullscreen`: `(display-mode: fullscreen|standalone)` or the
window's inner size equal to the screen's), so `--kiosk`, F11 and a Home
Screen app send `fs=1` with no fullscreen element and a tap there asks the
API for nothing.

**Cutscenes** (`src/cutscene/`). A scene (`types.ts` `SceneDef`) is started
by a slide cue (`{slide: "trivia_1"}`, `award_*` prefixes) or a screen-state
moment (`{moment: "signal", name: "bottle landed"}`), and is a pure picture
of `t` — ms since its start on the server's clock — so a reload resumes and
history never replays. `pick.ts` decides: overlays win, a pilot / peek /
room terminal shows none, a slide's scene (else its card), one moment at a
time over it (a moment that replaces the slide only hides it, so its clip or
scene carries on; a tap on a moment never peeks), nothing that names the
character before the introduction (the first fiction-safe scene on the same
trigger plays instead). A slide from history starts `HISTORY_T` in, at the
moment this page first drew it, then moves on; a scene's `face` flashes the
TV face once. The
layer is a lazy chunk in the slide's slot (z 30), preloaded at boot. Lanes
add scenes to their own `scenes/act1.tsx` / `act2.tsx` / `act3.tsx` /
`moments.tsx` from the `kit/` blocks (Win98 windows, dialogs, typewriter,
progress bar, marquee, glitch, static, particles, confetti, starfield,
popup storm, BSOD, spotlight, hourglass, count-ups, countdowns, `useSfxCues`).
`scenes/demo.tsx` is the pattern.

**Preview**: `pnpm --filter loom-terminal dev` then
`http://localhost:5175/terminal/?preview=list` (every scene, a device frame,
a scrubber), or `?preview=<id>&t=<ms>` for one frame (`&play=1`,
`&target=wall`, `&intro=0`, `&reduced=1`, `&who=`, `&value=`, `&phase=`,
`&countdown=<s>`). Outside dev it opens only on a terminal already set up
with the moderator passcode.
