# loom-terminal — the wall terminal

A kiosk app for tablets mounted around a live Loom event: a **direct line
to an agent-voiced character** (Trabolta, in *Trapped in the Internet*).
A program holds their pass up to the camera, and for as long as they keep
typing the screen is theirs: the conversation on one side, the
character's **animated face** on the other, and every reply **spoken
aloud** in a synthesised voice. Thirty seconds without input and the line
drops.

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
                                     # the world state, the director, the mini-map)
```

Open `http://<server>:7000/terminal/` on the tablet. Set it up on the
screen (moderator passcode, a name, the character, camera, voice), or
provision a whole fleet by opening one link on each:

```
http://<server>/terminal/?code=<mod passcode>&name=Kitchen&character=Trabolta&spot=kitchen&view=auto
```

(`&camera=environment` for the back camera, `&engine=browser` to skip the
server voice; `&spot=` and `&view=` — see *The world view* below.) The
passcode and the other hints are scrubbed from the address bar at once.

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
hidden/awake/online; the poll is also its heartbeat). While the character
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
for this terminal's target (`view=mirror` = the TV, else a wall terminal;
`core/server/routes/screen.ts`). Precedence, top first: **overlay**
(`blackout` — 10 s true black even when `go_to_living_room` follows at
once, then standing; `go_to_living_room` / `alarm` — text blinking at
1 Hz on a black field, never full-field red; an overlay pauses the
scanner and ends an open line) > **slide** (any other `screens_*` /
`tv_*` / `terminals_*` value, held 45 s on a terminal / 90 s on the TV;
`bingo`, `y2k`, `trust_chart`, `truth_txt`, `award_*`, `ceremony*` stay
until the next cue and beat attract) > **attract** > the base view. A
pilot pre-empts a slide. A slide is `public/slides/<cue>.png` (e.g.
`screens_trivia_1.png`, `tv_bingo.png`), else `<value>.png`; a missing
PNG renders a Win98 text card (`SLIDE_COPY` — the trivia cards carry the
Quest Log's own questions, test-checked against `quests.loom`), never a
broken image. `y2k` is drawn live: a blown-up taskbar clock at midnight
minus `remaining`. Any running story countdown shows as a ⏱ corner
(`countdown_*` cues never replace the slide); `flicker` is one 2 Hz
stutter. Ages run on the server's clock. Device check:
`scripts/accept/K-17.sh`.

## The voice

Two engines behind one queue (`src/speech/`):

| Engine | Where it runs | Quality |
|---|---|---|
| **server** (default) | The show laptop, behind the event server's `/api/mod/tts` proxy | Neural — the one to use. Run [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) (`docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu`, or the GPU image) and set `LOOM_TTS_URL=http://<laptop>:8880/v1` on the event server. Any OpenAI-compatible `/audio/speech` endpoint works, OpenAI's own included (`LOOM_TTS_URL=https://api.openai.com/v1 LOOM_TTS_API_KEY=… LOOM_TTS_MODEL=tts-1 LOOM_TTS_VOICE=onyx`). |
| **browser** (fallback) | The tablet's `speechSynthesis` | Varies: Edge's online *Natural* voices and an iPad's downloaded *Enhanced/Premium* voices are close to real; stock Android is not. The setup screen ranks the installed voices best-first with a TEST button. |

The server voice is cached per line across every terminal, so the hold
message costs the GPU once a night. If the laptop is down mid-sentence
the queue hands that chunk to the tablet voice rather than going mute
(`voice: tablet fallback` appears under the face). Replies are split into
sentences and synthesised one ahead, so speech starts on the first
sentence and the transcript reveals as it is said. Server env:

```
LOOM_TTS_URL       base of the speech API (unset = no server voice)
LOOM_TTS_API_KEY   bearer token, if the endpoint wants one
LOOM_TTS_MODEL     default "kokoro"
LOOM_TTS_VOICE     default "am_michael"  (Kokoro: am_adam, bm_george, af_bella+af_sky …)
LOOM_TTS_FORMAT    mp3 (default) | wav | opus
```

## The face

`src/face/` — an SVG head driven by a requestAnimationFrame loop: brows,
lidded eyes that look around and blink, a mouth that opens with the live
loudness of the voice (an `AnalyserNode` on the decoded audio; a
syllable-rate flutter on the browser engine, which exposes no waveform).
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
each one's duck lays its egg and flies away when they find it.

One camera, cut by a pure director (`world/director.ts`):

- **mount**: while a player stands in this terminal's room, the camera is the
  terminal itself, at its spot on the wall and looking along its
  yaw/pitch/fov (default −8°, and `DEFAULT_SPOT_FOV` = 70° *vertical*; the
  mini-map's cone is its `horizontalFov` on a 16:10 tablet, ≈ 96.5°). It is a window into the virtual copy of
  the room you are standing in, tagged **LIVE · THIS ROOM**.
- **follow**: otherwise the camera rides over the shoulder of the most
  recently active player (**FOLLOWING ADA**). Whoever just found the duck
  takes the camera. It holds a player for a few seconds and won't flicker
  between two. It is pulled in short of any wall (each wall a slab of the
  map's thickness, so never into or past one) and kept under the ceiling.
  With their back to a wall it tries a raised chase, then the left
  shoulder, then looks out of the player's own eyes (their ghost hidden).
- **orbit**: with nobody playing it circles this terminal's own room slowly.

Overlays: the banner *REINSTALLATION IN PROGRESS · <name> · <room>*, the
camera's mode tag, a corner **mini-map** of the floor (every player's dot
and heading, every unfound duck on that floor — whichever floor its player
is on — this terminal's view cone), and the celebration
*<NAME> HAS BEEN REINSTALLED* (or *FOUND THE GOLDEN DUCK* for a program
that was never corrupted). Rendering is capped at 30 fps, at ≤ 1.5×
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
| `spot` | a `house.terminals[].id` of the event's map: where this screen hangs (the setup screen lists them as *name — room*). Blank = unplaced: it never mounts, only follows / orbits the spawn room. |
| `view` | `auto` (default): the face pane shows the world view while anyone is in the simulation, the face otherwise. `world`: the world view always. `face`: never. `mirror`: see below. While piloting it is **always the face**, because the face is the voice. A tablet with **no WebGL2** (three r186 needs it; `src/webgl.ts` probes once at boot) behaves as `face` whatever this says, never loads three.js, and a no-WebGL2 mirror shows a still notice — never the *SIMULATION UNAVAILABLE* retry loop. The build targets `chrome87` / `safari14` (`vite.config.ts`). |

**The mirror (a TV).** `view=mirror` turns a screen into a full-screen
spectator, like the TV over the fireplace: there is no scanner, no chat and
no wake tap (it never speaks). It still needs the moderator passcode,
because the stream is mod-gated. Open the link on the TV's browser (a smart
TV, a Fire Stick, or a laptop on HDMI in kiosk mode):

```
http://<server>/terminal/?code=<mod passcode>&name=Desktop TV&view=mirror&spot=desktop-tv
```

A `spot` is optional for a mirror; without one it never mounts. The ⚙ in
the corner reopens setup (hold it 2 s).

**Before the character exists (attract).** A character can arrive partway
through the night: in *Trapped in the Internet* Trabolta is `hidden: true`
and his worker's gate is `when: self.awake == true` until Clippy
introduces him (`introduce_trabolta`). The terminal does not know that
yet. It shows *TRABOLTA ONLINE* whenever a worker is connected, and a
pass scan pilots the guest into `dm:Trabolta`, which commits the hold
line ("Jean Trabolta will make an appearance later tonight. Please do
not move the mouse.") into the guest's real thread and grows a Trabolta
row on their phone before the story has revealed him. Until that is
fixed:

- **Runbook (no code):** provision every terminal with `view=mirror` at
  doors open. A mirror has no scanner and no pilot, and the empty virtual
  house reads as a screensaver. Right after `introduce_trabolta`,
  re-provision each with `view=auto` (the ⚙, or the provisioning link
  again).
- **Required before the party:** an attract mode. While the terminal's
  character is hidden, or its `awake` is false, the terminal shows the
  pre-introduction rotation (screensaver, a Winamp-style media player,
  fake 1999 ads), never *ONLINE*, and never pilots a scanned pass. This
  needs `revealed` on `CastSummary`.

The story already records what every screen should be showing:
`cue screens_*` / `terminals_*` / `tv_*` directives, mirrored into
`Night.screen` (the TV) and `Night.terminals`. The terminal ignores
those cues today (a Screens layer is future work); stagehand can route
them meanwhile.

## Layout

```
src/app.tsx            the screens: setup → (screensaver) → attract → connecting → piloting
src/screen.ts          the 2 s screen-state poll (K-16): attract while the character is hidden/asleep
src/attract.ts         the screensaver rotation, the ads' copy, Mystify (pure)
src/Attract.tsx        the screensaver screen (Canvas2D) + ad cards (PNG, else a Win98 window)
src/slides.ts          the screen layer's precedence, holds, slide copy, corner + Y2K clock (pure, K-17)
src/ScreenLayer.tsx    overlays, slides (PNG, else a Win98 card), the corner, the flicker
src/config.ts          per-tablet config (localStorage) + URL provisioning
src/scanner.tsx        camera + QR (BarcodeDetector, else jsQR)
src/scan.ts            what a scanned code means; the typed-name fallback
src/pilot.ts           impersonate / end / say; the DM thread off the guest stream
src/idle.ts            the 30 s leash (paused while the character is answering)
src/chat.tsx           the thread + composer
src/speech/            engine.ts (server + browser + queue), split.ts, pick-voice.ts
src/face/              Face.tsx (SVG + animation), mood.ts
src/world/             stream.ts (spatial SSE + house map → WorldStore), state.ts (the reducer),
                       director.ts (mount / follow / orbit), minimap.ts + MiniMap.tsx,
                       WorldView.tsx (the three.js canvas + overlays, lazy-loaded)
```

Server-side pieces live in `core/server`: `tts.ts` (the proxy + cache),
the `/api/mod/tts` route and the `label` on `/api/mod/impersonate` in
`event-runtime.ts`, and static serving of `dist/` at `/terminal/` in
`server.ts`; the screen-state poll is `routes/screen.ts` (`ScreenWatch`).
The spatial plane the world view watches is `spatial.ts`
(`SpatialHub`) plus the `/api/spatial/*` routes; the house map, its
geometry and the three.js scene live in `house/` (`@loom/house`).
