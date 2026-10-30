# loom-terminal — the wall terminal

The screens around the house at a live Loom event. In *Trapped in the
Internet* they are Trabolta's face on the walls, the TV in the living room,
the King's chess board outside the server-room door, the upstairs casino,
the server-room terminal (his heart) and the tent laptop that runs the
reinstallation.

A terminal is a small kiosk web app (Vite + React, package `loom-terminal`)
that the event server serves at `/terminal/`. Every screen runs the same
build; the **view** decides what it does.

How it fits the rest of Loom:

- A terminal is a **trusted device**. It is set up once with the event's
  moderator passcode, which it trades for a moderator token
  (`/api/mod/login`). The passcode is never stored, and it is scrubbed from
  the address bar at once.
- Scanning a guest's pass (the QR on the play app's *Pass* screen, which is
  the guest id) opens a **play-as session for that guest** through
  `/api/mod/impersonate`. It is the guest's own session: their view, their
  stream, no moderator powers.
- The terminal shows that guest's `dm:<Character>` thread, the same thread
  their phone shows. What is said at the wall is in their DM afterwards, and
  the character's agent answers it the same way.
- Every line typed at a terminal is journaled `by` the terminal's name; the
  Log shows it as `via: "Terminal · Kitchen"`.

The device-by-device setup for the show (every link, every Chrome flag,
Fully Kiosk's settings) is [`docs/trapped/kiosk.md`](../docs/trapped/kiosk.md).
Guests and directors read Help → *Terminals* (`docs/help/play/09-terminals.md`).
An AI agent working on the code should start with [`CLAUDE.md`](./CLAUDE.md).

## Running

```bash
pnpm --filter loom-terminal dev        # :5175, proxies /api + /e to LOOM_SERVER (default :7000)
pnpm --filter loom-terminal build      # → dist/, served by the event server at /terminal/
pnpm --filter loom-terminal test       # vitest, 892 tests in 78 files
pnpm --filter loom-terminal typecheck
```

`pnpm dev` at the repo root builds the terminal along with the play app and
the reinstallation game, then serves it at `http://localhost:7000/terminal/`.

## Setting up a terminal

Open `https://<site>/terminal/` on the device. Setup has two steps:

1. **CONNECT**: the moderator passcode.
2. **WHICH TERMINAL IS THIS?**: the terminals on the event's live house map,
   by floor and room. Each row says its room, its LOCATION and what its
   screen is (*TV*, *casino*, *chess board*, *reinstallation station*, *room
   terminal — The Server Room*, *house terminal*). A row reads *⚠ online
   now: <name>* when another device already polls from that spot.

One tap powers it on. The name, the view and the room come from the map
entry (`TerminalSpot.view` / `speaks`, set in the map editor at
`/reinstall/map`). The character defaults to Trabolta. A terminal set up
from the map follows its entry on every boot, so a map save or a tent ⇄ shed
switch reaches it without a visit.

For a fleet, one link per device connects and picks the spot with no taps:

```
https://<site>/terminal/?code=<mod passcode>&spot=<spot id>
```

The map editor's Terminals tab (`/reinstall/map`) lists one spot-only link
per spot, without the passcode. Run → Terminals → *Set up a terminal* also
builds links, but it always adds `view=` (and `name=` / `room=` when filled
in), so a terminal set up from it keeps that view and stops following the
map. Optional keys:

| Key | Values | What |
|---|---|---|
| `camera` | `user` (default) · `environment` | which camera scans passes |
| `engine` | `browser` (default) · `fully` · `silent` · `server` | the voice (below) |
| `announce` | `1` · `0` | say the house announcements: always / never. Leave it off for the house setting |
| `cam` | `0` · `1` | send this camera to the reinstallation games (on by default) |
| `mic` · `voices` | `0` · `1` | the voice link's microphone and speaker (below) |
| `door` | `serial` · `sim` · `off` | the server-room door sensor (below) |
| `keys` | `0` | no keyboard here: hide the composer (the heart's mouse-only rig) |
| `bay` | `0` | do not read the patch bay on the door's board |

Old links that also carry `name=`, `view=` or `room=` still work, but those
values win over the map's and the device stops following the map. Avoid
them; the tent laptop in particular must never carry `&view=reinstall`.

On a running terminal, hold ⚙ for **2 s** (a bar fills under it) to reopen
setup: change the passcode, forget the terminal, or tap a different spot.
The *advanced* section holds the character, the camera, the voice, the
announcements, the voice link, the door sensor and a manual view or room.

**The camera and the microphone need a secure context**: `https://` or
`localhost`. On a plain `http://192.168…` address the browser refuses
them; the terminal says so and offers the typed-name fallback (a program
types the name they registered with).

**One tap after a reload.** A browser plays sound only after a gesture, so
after a reload a terminal shows TOUCH TO WAKE until someone taps it once.
The TV's Chrome runs with `--autoplay-policy=no-user-gesture-required` and
needs no tap.

## The views

| View | Where in the show | What it does |
|---|---|---|
| `auto` (default) | the wall tablets | the idle show with a scan box in the corner; Trabolta's face during a line; the reinstallation (or its camera shadow) while someone plays |
| `face` | the server room | the face only, never the simulation |
| `world` | — | the simulation always (the face while piloting) |
| `shadow` | — | this camera full screen with the players drawn in it as ghosts; no scanner |
| `mirror` | the safe mode for any screen | a silent full-screen spectator: no scanner, no voice, no chat |
| `tv` | the living-room TV | the face full screen, speaking every Trabolta line said in The Desktop; no scanner |
| `chess` | outside the server-room door | the King's chess board, awake all night |
| `casino` | the upstairs bedroom | Truthcoin bets on three small games, awake all night |
| `reinstall` | the tent laptop | a wall terminal and the reinstallation wizard + game in one |

A terminal with a `room` belongs to that LOCATION (the server-room
terminal): it sleeps until the story opens the room to everyone, then
speaks the room's lines.

## What a wall terminal does

**Before the character exists.** Trabolta is hidden and asleep until
Clippy introduces him. Until then every face and world terminal plays the
idle show full screen: no scanner, no *ONLINE*, nothing that names him. So
the tablets are set up from the start and wake within 2 s of the
introduction. A terminal fails closed: it stays asleep until the server
first answers.

**The idle show.** Between conversations a terminal plays a seeded, endless
line of fake 1999 screensavers, ads and popups that follow the night's
phase (`src/idle-show/`). Every tap does something; TOUCH ME asks after 30 s
untouched. Awake, a **scan box** sits in its corner: the live camera,
SCAN YOUR PASS, and the typed fallback. Popups never cover it.

**A conversation.** A scanned pass opens the guest's thread with Trabolta:
the chat beside his animated face, each reply spoken aloud. The line drops
after **30 s** with no input (paused while he answers), after 120 s with
the file panel open, and after 180 s while a heart menu is docked.

**The screen program.** Every 2 s (the TV every 1 s) a terminal polls
`GET /e/<event>/api/screen/state`. The answer carries the story's screen
cues for this terminal, the running countdown, the character's state,
the live Trust Chart and the night's public values. The poll is also the
terminal's heartbeat: Run → Terminals shows each one's last poll, sound,
full screen, battery, microphone, build and (on the server-room terminal)
the door and the patch bay.

What wins on screen, top first:

1. **an overlay**: the blackout, *go to the living room*, the alarm. It
   covers everything, ends an open line and holds a reinstallation walk;
2. **a slide**: any other `screens_*` / `tv_*` / `terminals_*` cue.
   `public/slides/<cue>.png` if present, else a Win98 text card. The TV
   first tries `<cue>.mp4`. Some slides are drawn live: the Y2K clock and
   the Trust Chart;
3. **a cutscene**: a scene keyed to a slide cue or a story moment
   (`src/cutscene/`, 75 scenes, most with a TV take and a wall take);
4. the idle show, then the base view.

A tap on a held slide **peeks** under it for 30 s, so a guest can still
scan. The TV and mirrors never peek. A room terminal shows no story
slides or countdown; it takes overlays and its own room's scenes (a `cue
room_<x>` in a beat set there). The chess board and the casino take
overlays only.

**Full screen by default.** Every gesture while not full screen asks the
browser again; Fully Kiosk and Chrome `--kiosk` count as full screen. Run →
Terminals shows ⛶ on a terminal that is not. ⚙ → *full screen* turns it
off for a director's laptop.

## Voice and sound

**Every device speaks with its own voice.** The default `browser` engine
uses `speechSynthesis` when the device lists voices, else Fully Kiosk's
text-to-speech, else text only. `fully` tries Fully first; `silent` is text
only; `server` is the opt-in server voice (`/api/mod/tts`, needs
`LOOM_TTS_URL` on the server, off by default). ⚙ lists the device's voices
best first and has TEST VOICE.

**Trabolta never sounds like the announcements.** With no voice picked, his
lines take the device's best male voice and announcements its best female
one (`src/speech/pick-voice.ts`): Daniel vs Samantha on a Mac, Microsoft
David vs Microsoft Zira on Windows.

**House announcements** come out of the house speakers (the stagehand
`audio` router). A terminal says them too only when asked: ⚙ → *say the
house announcements* is **House setting** (the default: only spots on
`audio.json`'s `announce.terminals` list), **Always** (`&announce=1`) or
**Never** (`&announce=0`). The tent laptop runs Always, because no house
speaker reaches the yard.

**Accents only.** A terminal's own speaker plays only synthesised accents
(popup dings, cutscene stingers, the casino's jingles; `src/sound/`),
dropped while a voice speaks. Every story `sound X` plays on the house
speakers, never on a tablet. The TV's accents are quiet (0.35) and the
director's TV mute cuts them along with its voice.

**The TV** (`view=tv`) speaks Trabolta's lines said in The Desktop and
captions them. Lines in the song beats are captioned only (the house
router plays the song); Sandy is captioned, never voiced. `M` on its
keyboard, or the 🔊 button, mutes it through the server, so the director's
mute and the TV's agree and survive a reload.

## The reinstallation on the walls

During the reinstallation games (`docs/loom-reinstall.md`) a placed
terminal is a **window into the virtual copy of its room**: the camera sits
where the tablet hangs and the players walk past it as ghosts, a glitchy
swarm of each one's profile picture. An unplaced terminal follows the most recent player. A
corner mini-map shows the floor, the ducks and this terminal's view cone.

- **No WebGL2** (old tablets): a Canvas 2D raycaster draws the same thing
  (`src/raycast/`). three.js is never loaded on such a device.
- **Camera feeds.** A placed terminal sends its camera (160 × 120, about
  3 fps) to the games, which hang it on the wall where the tablet hangs.
  `&cam=0` or ⚙ turns it off.
- **The shadow view.** `view=shadow`, or `auto` while the camera is live:
  the camera full screen with the players drawn into it.
- **The voice link.** A placed terminal's microphone is heard in the games
  at its screen, and nearby players are heard from its speaker. The server
  routes it; nothing goes up unless a player is near enough to hear. The
  terminal holds its microphone while it plays a sound or speaks, so it
  never echoes into the game. The 🎤 at the left edge shows while a player
  can hear the room. The TV plays players but its microphone is off; the
  mirror and the tent take no part.

## The server-room terminal (his heart)

The server-room terminal is Steph's laptop with a monitor, a mouse, a
keyboard and a webcam, running Chrome on the `server-room` spot
(`view: face`, a room terminal for The Server Room). The **Grand Central
M4** on its USB reads the door sensor and the patch bay
([`hardware/server-room-m4/`](../hardware/server-room-m4/README.md)); the
page reads the board over **Web Serial** (desktop Chrome or Edge on https).

- **The door.** The page posts `door_sensor_opened` / `door_sensor_closed`
  through `POST /api/mod/signal`, and on every poll repairs a missed edge
  against the story's `night.server_door`. It posts nothing before Power
  On, during a blocking sensor fault, or while a director's 🚪 press has put
  the door on the buttons.
- **The patch bay.** When four cables settle into a new complete set, the
  page posts `patch_changed {combo}` and the story judges it. It posts only
  in the Y2K hour (`night.step >= 14`), never after an ending, and never
  while a 🔌 / 💥 / ❌ press has put the bay on the buttons (until 🔌 *Trust
  the patch bay again*). The page never knows which combinations matter.
- **Setup.** Hold ⚙ 2 s → *advanced* → *door sensor* → **Connect door
  sensor** → pick the board. Then **Calibrate: door shut** and **Calibrate:
  door open**. The *patch bay* section below it shows each input's reading,
  with **Learn** per source and **Save** / **Reset**.
- **The heart.** The story docks the heart's menu in the guest's
  `dm:Trabolta`. The page shows it as a YOUR ANSWER panel (since wave 29
  it never shows the layer or a count: nothing on the heart terminal says
  how far through the talk a program is), clicked or keyed (`1`–`9`, `0` for the
  tenth, then `a`, `b` …). Up to nine options fit at 1280×720; more scroll
  under a ▼ MORE cue. Since wave 27:
  - The panel says LISTENING… and takes no click or key while his reply
    is still being said (up to 20 s) and while one of his heart scenes
    (the proof, a warning, an eject …) plays; the question card (*HEART.EXE*, no count) does not
    hold it. Space or a click on it skips his voice to the end.
  - The thread shows this visit only. Earlier phone DMs are left out
    behind "— earlier messages are on your phone —" (the line opens,
    `terminal opened`, once the pilot's stream has sent its history).
    His queued lines wait behind one typing row; a pick echoes as YOU
    with the time, a deed in brackets (`[shows the Sandy File]`).
  - While the door is open, *CLOSE THE DOOR* sits above the greyed
    options and the top band sits under the bar.
  - ⟦SPEAK FREELY⟧ opens the composer for a free conversation, with a
    ⟦BACK⟧ bar under it (Esc). The composer never shows during an eject,
    the proof or the shutdown, or once the heart is done. An eject ends
    the line only after its scene and his queued lines (20 s cap).
- **📎 GIVE HIM A FILE.** While a pass is open, the guest can give him
  codex entries, type a code, or scan a file's QR. A secret file, or one
  about someone else, shows why he won't take it.
- **Without the board.** `&door=sim`: **O** opens a pretend door, **C**
  shuts it, **F** toggles a fault, and Shift + digits patch pretend cables.

## Other screens

- **The King's chess** (`view=chess`, spot `server-room-door`): THE KING,
  his shared health bar, and the scanner. One game per scan, no hints, a
  board dealt at his strength when it is dealt. A marked program is
  refused. A game's end posts `chess won` / `chess lost` / `chess drawn`;
  a win while the code is still on offer gives the server-room door code.
- **The casino** (`view=casino`, spot `graphics-card`): scan a pass, bet
  1–50 Truthcoin on the coin, the dice or the slots. The server rolls every
  bet; nothing is retried.
- **The tent laptop** (`view=reinstall`, spot `tent`): the idle show, the
  scan box and a list of who is in the Internet now. A marked or captured
  pass plays the reinstallation game right there (or is sent to a
  headset); anyone else gets a NOT MARKED card. An overlay holds a walk.
  It needs WebGL2 to play here.

## Previewing cutscenes

With `pnpm --filter loom-terminal dev` running:

- `http://localhost:5175/terminal/?preview=list` lists every scene with a
  scrubber.
- `?preview=<id>&t=<ms>` shows one frame (`&play=1`, `&target=wall`,
  `&intro=0`, `&reduced=1`, `&who=`, `&value=`, `&phase=`, `&countdown=<s>`,
  `&night=key:value,…`).

Outside dev the preview opens only on a terminal already set up with the
moderator passcode.

## Browser support

The build targets **Chrome 87 / Safari 14** (the oldest wall tablets and
iPads). That pins syntax only: newer runtime APIs need a fallback in code,
and a regex lookbehind breaks Safari 14. `scripts/accept/K-14.sh` scans the
built bundles for both.

## More

- Show setup, device by device: [`docs/trapped/kiosk.md`](../docs/trapped/kiosk.md)
- The spatial contract (poses, camera feeds, the voice link):
  [`docs/loom-reinstall.md`](../docs/loom-reinstall.md) §2 and §4
- The house map and its three.js scene: [`house/`](../house/README.md)
- Slide file names: [`public/slides/README.md`](./public/slides/README.md)
- The wave-by-wave history of this README:
  [`docs/history/terminal-readme-2026-10.md`](../docs/history/terminal-readme-2026-10.md)
