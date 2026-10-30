# Kiosk setup — every screen in the house

How each screen at *Trapped in the Internet* (Oct 31) is set up so it stays
on, stays in the terminal, and can't be reconfigured by a guest. The app is
`terminal/` (see its [README](../../terminal/README.md)); this page is the
device side. Every link here has `<mod>` where the event's moderator
passcode goes. Copy the code from Run; never write it into a doc.

The site is `https://app.mapsandducks.com`. Every screen loads
`/terminal/`; the house map's spot decides what it shows, so a link needs
only the spot.

## The screens

| Screen | Device | Spot | Link | Browser |
|---|---|---|---|---|
| The TV (living room) | John's Desktop (Windows), HDMI | `desktop-tv` | `/terminal/?code=<mod>&spot=desktop-tv` | Chrome `--kiosk` via `scripts/house-desktop/tv-kiosk.ps1` |
| The server room (his heart) | Steph's laptop + monitor, mouse, keyboard, webcam, the Grand Central M4 on USB | `server-room` | `/terminal/?code=<mod>&spot=server-room&door=serial&camera=user` | desktop Chrome `--kiosk` (Web Serial) |
| The tent (The Internet) | John's old laptop + its webcam | `tent` | `/terminal/?code=<mod>&spot=tent&announce=1` | Chrome `--kiosk`; needs WebGL2 |
| The Server Door (the King's chess) | a tablet on the basement hall wall by the keypad | `server-room-door` | `/terminal/?code=<mod>&spot=server-room-door` | Fully Kiosk (Android) |
| The casino (upstairs bedroom) | a tablet | `graphics-card` | `/terminal/?code=<mod>&spot=graphics-card` | Fully Kiosk (Android) |
| Wall terminals | tablets | `optical-drive`, `hall`, `steam-room`, `cpu`, `start-bar`, `backyard`, `bathroom-1-door`, `ram`, `upstairs-hall` | `/terminal/?code=<mod>&spot=<id>` | Fully Kiosk (Android), or an iPad |

Rules for every link:

- **Spot only.** Never add `&view=`, `&name=` or `&room=`: a link that
  names its own view or room keeps it and stops following the map (the
  tent would be called *Terminal* and ignore the shed variant).
- Get the link from the map editor (Run → House → 🗺 Map: the Terminals tab
  or a terminal's inspector gives a spot-only link without the passcode;
  add `&code=<mod>`), from `pnpm showctl preflight <machine>` (`macbook`,
  `desktop`, `serverroom`, `tent`), or type `?code=<mod>&spot=<id>` by
  hand. Run → Terminals → *Set up a terminal* always adds `&view=` (and
  `&name=` / `&room=` when filled in), so a terminal set up from it does
  not follow the map. The Terminals card lists the map's spots no live
  terminal claims.
- The passcode is traded for a moderator token and scrubbed from the
  address bar. After the first open the device remembers its setup, so a
  bare `/terminal/` reopens it as itself.
- **`https` only.** The camera, the microphone, Web Serial and the Wake
  Lock all need a secure context; a LAN `http://` address refuses them.

## What every terminal does on its own

The app's half is `terminal/src/kiosk.ts` and `fullscreen.ts`:

- **Wake Lock.** The terminal asks for a Screen Wake Lock at boot, on the
  TOUCH TO WAKE tap, and whenever the page comes back into view (Chrome
  84+). The state is on `<html data-wake-lock="held|off|unsupported">`. On
  an older tablet Fully Kiosk's *Keep Screen On* does the job alone.
- **⚙ needs a 2 s hold.** A short tap on the gear does nothing; a bar
  fills while held. This keeps a curious guest out of setup.
- **Full screen by default.** Every gesture while not full screen asks the
  browser again (a text box tap is left alone for the keyboard). Fully
  Kiosk's JavaScript Interface hides its bars. Chrome `--kiosk`, F11 and a
  Home Screen web app count as full screen with no tap. Run → Terminals
  shows ⛶ on a terminal that is not: on a tablet touch it once; on a laptop
  or the TV, its Chrome was started without `--kiosk`, so quit and relaunch
  it. ⚙ → *full screen* turns it off for a director's test laptop.
- **One tap after a reload.** A browser plays sound only after a gesture,
  so after a reload a terminal shows TOUCH TO WAKE until someone taps it.
  Chrome with `--autoplay-policy=no-user-gesture-required` needs no tap.

### Sound: the device's speaker and the house speakers

A terminal's own speaker plays only **accents**: popup dings, clicks,
cutscene stingers, the casino's jingles, synthesised in the page and
dropped while the character speaks. **Every story `sound X` and every
announcement comes out of the house speakers** (the stagehand `audio`
router with the MOTU 828x, on John's Desktop; the MacBook only in the
fallback). Since wave 38 Trabolta's TV voice plays there too (the
Desktop's line out is cabled into the 828x), and the TV page's own
accents are silent. Nothing on a tablet
plays a story sound. The house speakers are set up in the project file
`audio.json` (the map editor's 🔊 Audio tab, Run → House → 🗺 Map); the
contract is [`room-audio.md`](./room-audio.md) §11.

**Saying the announcements on a device** is an option, off unless asked
for. ⚙ → *say the house announcements*:

- **House setting** (the default): on only for a spot on `audio.json`'s
  `announce.terminals` list. Run → Terminals shows 📢 on such a spot and
  turns it on or off there.
- **Always** (`&announce=1`): the tent, which no house speaker reaches.
- **Never** (`&announce=0`).

Leave `announce` off a link unless you mean Always or Never. The heartbeat
reports what the device does now (`ann=1|0`).

### The voice

**Every device speaks with its own voice**; no server voice is needed.
Hold ⚙ 2 s: setup says what this device can do (*this device has N
voices*, *Fully Kiosk's text-to-speech will speak*, or *text only*), and
**TEST VOICE** says a line through exactly the voice it will use. Leave
*voice* on **this device's own voice**; pick **Fully Kiosk's voice** on a
tablet whose WebView lists voices but never speaks. A `speak()` that
hasn't started after 4 s is given up until the next tap, so a silent stub
can't stall a conversation.

**Trabolta must not sound like the announcements.** With no voice picked,
his lines take the device's best **male** voice and announcements its best
**female** one (`terminal/src/speech/pick-voice.ts`): Daniel vs Samantha on
a Mac, Microsoft David vs Microsoft Zira on Windows. A voice picked in ⚙ is
Trabolta's only. **In Fully** (no voice list) `fully.textToSpeech` speaks
the Android default, often female: type a male Android voice's name into
*device voice* if TEST VOICE sounds like the announcements.

**Pace and pauses.** ⚙ has a *pace* slider and a *pauses* slider (0–3×
the 0.3 s between his sentences and the 0.7 s between his lines; TEST
VOICE plays them; `&pause=` on a link sets it). The TV speaks at pace
0.92: opening its link sets that, and so does a first setup as the TV
unless the pace slider was moved. Every voice says *Antivirus* as "Anti
Virus"; the screen keeps the written word.

### Slides, the cast, the voice link

- **A slide over the scanner.** A held slide (the Y2K clock for the whole
  final hour, Bingo, the Trust Chart, truth.txt, awards) covers a face
  terminal's scanner. **A tap on the slide peeks under it** for 30 s. A
  tablet showing no clock for a moment is someone peeking, not a failed
  cue: don't re-fire it. An overlay (blackout, *go to the living room*, the
  alarm) still covers everything. The TV and mirrors never peek.
- **The glitch.** The 📺 cue's glitch is an 8 s takeover on every screen,
  over a pilot or a game without ending it. It plays once: a terminal
  reloaded mid-glitch, or one that missed its first 4 s, skips it. A
  screen that didn't glitch is not a failed cue.
- **A character the story lacks.** ⚙ refuses a name the story doesn't
  have (*The story has no character called …*, with the cast).
- **Linked by room.** A placed terminal is a window into the simulation
  only while a reinstallation player is in its room in the game: its world
  view (`auto` and `world` alike), the picture the players see from its
  camera, and its voice link. The mirror and the shadow show anyone, anywhere; the tent never.
- **The voice link.** A placed terminal sends its room to the
  reinstallation players in the same room and plays them out of its
  speaker; nothing leaves the room unless a player is in it, and the
  terminal sends nothing while it makes a sound itself. It starts with the first
  touch after a reload. ⚙ → *advanced* has *let the games hear this room*
  and *play the players near this screen*. Run → Terminals' 🎤 flags a
  device whose microphone was refused (*denied*) or can't run (*insecure*).
  The tent and the mirror take no part; the TV plays players but its
  microphone is off.

## Android tablets — Fully Kiosk Browser PLUS

The wall terminals, the Server Door chess board and the casino. Setting
names are from Fully Kiosk Browser 1.5x; if one has moved, use the search
box at the top of Fully's Settings.

| Section | Setting | Value | Why |
|---|---|---|---|
| Web Content | **Start URL** | `https://app.mapsandducks.com/terminal/` | The setup lives in the page's localStorage, so the bare URL reopens this terminal as itself. Set it up once: open `/terminal/?code=<mod>&spot=<its id>` (or `/terminal/`, the passcode, tap this terminal in the list), then set this. |
| Web Content | **Autoplay Videos** | ✔ | Media may start without a tap. |
| Web Content | **Autoplay Audio** (if listed separately) | ✔ | **The voice.** Still tap TOUCH TO WAKE once after a reload: Web Audio wants that gesture on some WebViews anyway. |
| Web Content | **Enable Webcam Access** | ✔ | The pass scanner. Allow Android's camera prompt the first time. |
| Web Content | **Enable Microphone Access** | ✔ | **The voice link.** Allow Android's microphone prompt (for Fully) once. |
| Web Browsing | **Enable Pull to Refresh** | ✘ | A pull reloads the page and loses the audio unlock mid-show. |
| Web Browsing | **Swipe to Go Back / Navigate** | ✘ | Same reason. |
| Web Browsing | **Reload on Screen On** | ✘ | Same reason. |
| Web Auto Reload | **Auto Reload after Page Error** | ✔ | A network blip at boot recovers by itself. |
| Web Auto Reload | **Auto Reload on Idle** | ✘ | **Never reload on a timer.** |
| Advanced Web | **Wait for Network Connection** | ✔ | Boot waits for the Wi-Fi. |
| Advanced Web | **Enable JavaScript Interface** (PLUS) | ✔ | **The voice on the old tablets**, whose WebView may lack `speechSynthesis`: the terminal speaks through `fully.textToSpeech` instead. The page also uses it to hide the bars. |
| Other / Device Management | **Text To Speech** engine / language, if listed | the device's best English engine | Otherwise Android's: Settings → System → Languages & input → **Text-to-speech output** → Google Speech Services, English (US), **install the voice data** (offline). |
| Toolbars & Appearance | **Show Address Bar / Status Bar / Navigation Bar** | ✘ | Full screen. |
| Device Management | **Keep Screen On** | ✔ | Belt and braces with the Wake Lock. |
| Device Management | **Screen Off Timer** | 0 (off) | |
| Device Management | **Screen Brightness** | ~70 % (the chess board: higher, guests stand to play) | |
| Screensaver | **Screensaver Timer** | 0 (off) | The terminal has its own idle show. |
| Power | **Launch on Boot** | ✔ | A power cut brings the terminal back. |
| Kiosk Mode (PLUS) | **Enable Kiosk Mode** | ✔ | Locks the tablet to Fully. |
| Kiosk Mode (PLUS) | **Kiosk Exit PIN** | a PIN the tech op knows | Not printed anywhere guests can see. |
| Kiosk Mode (PLUS) | **Disable Status Bar / Home / Recent Apps / Power Button** | ✔ | |
| Other | **Restart on Crash** | ✔ | |
| Remote Admin (PLUS) | **Enable Remote Administration** | ✔ (LAN only) | Battery and screen state from a laptop. **Never** press *Reload* from it mid-show. |

Android itself: Settings → Display → Sleep at its maximum; Developer
options → *Stay awake while charging* ✔; battery optimisation off for
Fully. Set the media volume before the party and lock it with Fully's
*Volume Limits* if the version has it.

## iPads (if any are used)

Settings → Display & Brightness → Auto-Lock: **Never**; Accessibility →
Guided Access ✔ with a passcode; add the terminal to the Home Screen and
start Guided Access on it (the Home Screen copy has no Safari bars). Every
reload needs a TOUCH TO WAKE tap (iOS has no autoplay setting). Allow the
microphone when asked. Unchecked on a device: opening the microphone
switches iOS to its play-and-record session, which can make the speaker
quieter and has been known to stop the camera; if the scanner keeps
dropping on an iPad, turn *let the games hear this room* off there.

## The TV — John's Desktop (Windows)

John's Desktop drives the living-room TV over HDMI and runs the TV view
(`view=tv`, spot `desktop-tv`): Trabolta's face full screen, speaking every
line he says in The Desktop, the reinstallation beside it while a player
is in The Desktop in the game (wave 26: the walls' per-room rule). The Desktop also hosts Mosquitto, Zigbee2MQTT and the stagehand
`show` and `lights` jobs; its full runbook is
[`scripts/house-desktop/README.md`](../../scripts/house-desktop/README.md).

**Set it up** in PowerShell from `scripts\house-desktop`:

```powershell
$env:LOOM_MOD_CODE = '<mod>'     # this window only; never written to disk
.\tv-kiosk.ps1 -Setup            # Chrome without --kiosk, opens /terminal/?code=<mod>&spot=desktop-tv
```

In that window: check it took the TV spot; hold ⚙ 2 s → *device voice* →
**Microsoft David** (or Mark) → TEST VOICE; close it. Then:

```powershell
.\tv-kiosk.ps1                   # kiosk on the last display (the TV as a 2nd screen)
.\tv-kiosk.ps1 -Display 1        # or pick one
.\tv-kiosk.ps1 -InstallTask      # open the kiosk 20 s after every sign-in
.\tv-kiosk.ps1 -Close
```

The script runs Chrome with its own profile (`%LOCALAPPDATA%\loom-tv`) and
`--kiosk --autoplay-policy=no-user-gesture-required --no-first-run
--no-default-browser-check --disable-session-crashed-bubble
--window-position=<the display>`. By hand that is:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:LOCALAPPDATA\loom-tv" `
  --kiosk --autoplay-policy=no-user-gesture-required --no-first-run "https://app.mapsandducks.com/terminal/"
```

- **Wrong screen?** Display scaling can shift Chrome's window position:
  make the TV the main display (Settings → System → Display → *Make this my
  main display*) and use `-Display 1`.
- **Sound** leaves Windows' default output: HDMI to the TV's speakers is
  simplest (or the MOTU's living-room pair if the router runs on this PC
  and its driver allows it). Turn Windows' own sounds off (Sound → Sounds →
  *No Sounds*) and Do Not Disturb on, so no ping or banner reaches the TV.
- **Never sleep:** `.\preflight.ps1 -FixPower` (or `powercfg /change
  standby-timeout-ac 0` and `monitor-timeout-ac 0`). Pause Windows Update
  past Nov 1.
- **The voice** is Windows' own (Microsoft David by default; Edge's
  *Natural* voices are nicer but untested on `view=tv`). Never pick the
  announcement voice. The TV leaves *say the house announcements* off: the
  living room hears the house speakers. Its microphone stays off unless ⚙
  ticks *let the games hear this room*.
- **Mute:** `M` on the Desktop's keyboard, or the 🔊 button bottom right,
  is the same server-side mute the director has. It is kept with the event,
  so a mute left on from a rehearsal stays on: check **🔊 TV voice** on Run
  → Terminals before the doors.
- If Chrome came back without the autoplay flag, the page shows *CLICK
  ONCE TO ENABLE THE VOICE*: one click anywhere.
- Check: `pnpm showctl preflight desktop` (Mosquitto, Zigbee2MQTT, the
  stagehand jobs, the TV's `--kiosk` Chrome, power settings, the
  `desktop-tv` row).

## The server room — Steph's laptop

Trabolta's heart. Steph's laptop, lid closed, drives a **monitor** with a
**mouse**, a **keyboard** and a **webcam** facing the program, and the
**Grand Central M4** on its USB reads the **door sensor** and the
**patch bay** ([`hardware/server-room-m4/`](../../hardware/server-room-m4/README.md)).
The page reads the board over **Web Serial**: desktop Chrome (89+) or Edge
on https only. Nothing from stagehand runs here.

The map's `server-room` spot is in the Server Room (`house.json` and
`house.shed.json`: room `server-room`, pos `[3.9, -1.3, 26]`, yaw 0) with
`view: "face"` and `speaks: true`, so the link needs only the spot plus the
board and camera keys:

```
/terminal/?code=<mod>&spot=server-room&door=serial&camera=user
```

(`&keys=0` only for a mouse-only rig.)

### First launch: grants and calibration

Grants (the camera, the serial port) belong to a Chrome profile, so the
terminal gets its own, and grants made in Steph's everyday profile don't
carry over. Launch it once **without** `--kiosk`:

```bash
# macOS
open -na "Google Chrome" --args --user-data-dir="$HOME/.loom-terminal" \
  "https://app.mapsandducks.com/terminal/?code=<mod>&spot=server-room&door=serial&camera=user"
```

```powershell
# Windows
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:LOCALAPPDATA\loom-terminal" `
  "https://app.mapsandducks.com/terminal/?code=<mod>&spot=server-room&door=serial&camera=user"
```

1. Allow the camera.
2. Hold ⚙ 2 s → *advanced* → *door sensor* → **Connect door sensor** →
   pick the Grand Central in Chrome's list.
3. **Calibrate: door shut** (door shut, 2 s), open the door, **Calibrate:
   door open**. The thresholds are stored on the laptop and in the board's
   flash and re-sent on every connect. **Always calibrate again after a
   reflash** (⚙ says *⚠ calibrate again* when the wiring mode changed).
4. *patch bay* (below the door section): every input reads *empty*. Patch
   one cable and see its row read that source. If the levels were never
   learnt on this board, **Learn** each source (one cable in, from that
   source into any input), then **Save**. `scripts/accept/N-21.sh` does
   the same from a shell with the page closed.
5. Save.

### Then the kiosk

Quit Chrome and relaunch with the same profile (no `code` needed now):

```bash
# macOS
caffeinate -dims open -na "Google Chrome" --args --user-data-dir="$HOME/.loom-terminal" \
  --kiosk --autoplay-policy=no-user-gesture-required "https://app.mapsandducks.com/terminal/"
```

```powershell
# Windows
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:LOCALAPPDATA\loom-terminal" `
  --kiosk --autoplay-policy=no-user-gesture-required --no-first-run "https://app.mapsandducks.com/terminal/"
```

- **Never sleep.** macOS: `caffeinate -dims` (above) and `sudo pmset -a
  sleep 0 displaysleep 0`. Windows: `powercfg /change standby-timeout-ac 0`
  and `powercfg /change monitor-timeout-ac 0`. Notifications off (Focus /
  Do Not Disturb). Keep it on mains power; with the lid closed the
  external monitor should be the main display.
- **Close any serial monitor** (the Arduino IDE's, `arduino-cli monitor`,
  `screen`): the port is exclusive, and ⚙ reads *the door sensor's port
  won't open … close any serial monitor*.
- **After a reflash** the board's USB id changes in bootloader mode; Chrome
  may need the port granted once more (⚙ → Connect door sensor).
- **The built-in keyboard out of reach**: a guest at the external keyboard
  can only type to him.
- Volume up: the heart's room scenes and his lines are spoken here,
  nowhere else.

### What it does

- It is a **room terminal**: it **sleeps** on the idle show (no scanner)
  until the story opens The Server Room to everyone (The Heart's `reveal`,
  or the patch-bay alarm's; a per-program reveal doesn't count). Then it
  speaks every Trabolta line said in that room, captioned, and pauses the
  scanner (**LISTEN**) while he speaks. No story slides, no countdown corner
  (not even the Y2K clock); overlays still cover it. The TV mute never
  silences it.
- **The door.** It posts `door_sensor_opened` / `door_sensor_closed` and
  reports the door on its heartbeat (Run → Terminals: 🚪 *shut* / *open*
  with the level, red *fault*). The first opening once Trabolta is awake
  plays **The Heart**: he asks for the door shut, the program scans their
  pass with the door shut, and the four layers of the conversation (wave 27:
  Layer Three's ⟦SHOW HIM⟧ / ⟦TELL HIM⟧ open short sub-menus) dock as
  a choice panel (click, or `1`–`9`), greyed under *CLOSE THE DOOR* while
  the door is open. ⟦SPEAK FREELY⟧ opens the keyboard for a free talk. A
  convince ends in Heart Shutdown at any hour, and the night ends when a
  director presses 🕊 `talked_down`. Help → *Running the server room*
  (`docs/help/authoring/38-server-room.md`) is the director's side.
- **The patch bay.** In the Y2K hour the page posts `patch_changed
  {combo}` when four cables settle into a new set, and the story judges it.
  Run → Terminals' 🔌 badge shows the cable count, *complete* and faults.
  The patch-bay watch presses 🔌 / 💥 / ❌ only when the bay missed; a press
  puts the bay on the buttons until a director fires 🔌 *Trust the patch bay
  again*.
- **What a fault looks like.** Unplugged, silent for 3 s, or flooded with
  light: nothing shows on the guest's screen (the sensor is *the door* in
  the fiction), ⚙ reads *door sensor: FAULT (…)*, Run → Terminals shows 🚪
  red, and the page tells the story nothing. Use the 🚪 *opened* /
  *closed* cue buttons, which put the door on the buttons (amber
  *override*) until 🚪 *Trust the door sensor again*. The board may go
  quiet for up to 2 s after a setting changes; that is not a fault.
- **The line.** A pass opens a line and posts `terminal opened` (labelled
  *Terminal · Server Room*); every way it ends posts `terminal closed`.
  The leash is 30 s, 120 s with 📎 open, 180 s while a heart menu is
  docked or the door is open mid-heart. **📎 GIVE HIM A FILE** lets the
  program give codex entries, type a code or scan a file's QR; a secret
  file, or one about someone else, shows why he won't take it.
- A corner reading *the story has no room called …* means a typo in the
  room; fix it in ⚙. A row with a room on any other spot is amber on Run →
  Terminals (a device that was the TV once keeps `room=The Desktop`): clear
  its room in ⚙.
- **Testing without the board:** `&door=sim`. **O** opens a pretend door,
  **C** shuts it, **F** toggles a fault; Shift + digits patch pretend
  cables (Shift+1–8 a source, then Shift+1–7 its input; Shift+0 pulls).

**Install-day check:** `pnpm showctl preflight serverroom`, then before
the doors: the terminal on the idle show, Run → Terminals green with
`room The Server Room`, 🚪 *shut* with a level (open the door: *open*
within a second), the 🔌 badge with no fault. On a rehearsal after 🤖
(Trabolta awake), open the door: it wakes and speaks the opener; shut it,
scan a test pass, click through Layer One, open 📎 and give a file, wait
out the leash, and check the Log for `terminal opened` then `terminal
closed` by *Terminal · Server Room*. A real open → shut → open, then 🔄
(and 🚪 Trust if the buttons took it).

## The Server Door — the King's chess tablet

A tablet on the basement hall's east wall beside the server-room door, by
the keypad, looking at it. It is **the King**: the only place in the house
he is played at chess. Provision with
`/terminal/?code=<mod>&spot=server-room-door` (the map says `view:
"chess"`).

- **Awake all night**, whatever Trabolta is doing; no character, no room.
- The attract screen is THE KING, his shared health bar (*n / 15*, *HE
  KNEELS* at 0), the stakes line (*Checkmate him.*, a DRAFT that names no
  prize, or *No prize now.* after truth.txt or an ending) and the scanner
  with the typed fallback. **No hints, no
  strength line.**
- **One game per pass scan.** A marked program is refused. The board is
  dealt at the bar's strength when it is dealt; **GIVE UP** takes two taps.
- **Moving** (wave 43): drag a piece, or tap it and tap a dot. A
  program's first game on the screen opens a three-card tutorial (SKIP on
  every card); **? HELP** opens it again. It holds the leash.
- **On a phone** (checked at iPhone 12 size in Safari's engine): the
  board is measured to fill the screen in portrait or landscape and keeps
  clear of the notch and home bar. iPhone Safari has no full-screen API:
  for a kiosk, open the link, **Share → Add to Home Screen** and launch it
  from there; set Auto-Lock to Never.
  The leash is 120 s with no touch (held while he thinks).
- A game's end posts `chess won` / `chess lost` / `chess drawn`, labelled
  *Terminal · Server Door* (retried, kept across a reload for 60 s). A win
  that never landed says to tell a host, who presses ♟ on the winner's
  card.
- Overlays cover the board and hold the game; nothing else does. It never
  speaks.

**Install-day check:** Run → Terminals shows *Server Door* green. On a
rehearsal, scan a test pass and play to a mate (Run → House map **Set…**
0 first to make it quick, then **👑 Restore**); check `# hosts` for *♟ …
beat the King* and the Log for `chess won`. **Put him back to 15/15
before the doors.**

## The casino tablet

A tablet in the upstairs bedroom (The Graphics Card). Provision with
`/terminal/?code=<mod>&spot=graphics-card` (the map says `view:
"casino"`). Awake all night: a program scans a pass and bets 1–50
Truthcoin on the coin, the dice or the slots. The server rolls every bet;
nothing on the tablet decides an outcome. A marked program is refused.
Media volume up for the jingles. **Check:** Run → Terminals shows *Casino*
green; scan a test pass, bet once, CASH OUT.

## The tent — the Internet laptop (John's old laptop)

The laptop in the tent (the shed on a rain night) is **one device that is
a terminal and the reinstallation wizard** (`view=reinstall`). Between
walks it is a scan kiosk: a centred **💿 Reinstallation Wizard** card with
the live camera, the typed field (*type your program name*), a red **☣ IN
THE INTERNET NOW** row of the captured programs (one big button each) and
the reinstalling count, over a quiet idle show. It takes overlays, beat
scenes and the glitch, but no story slide, countdown corner or Y2K clock.
It never shows the world and never sends its camera into the game.

- **A pass.** A captured or marked program gets the wizard: straight into
  the game (*Play here*) when no headset is online, else *Play here* or
  *Send to <headset>*. Anyone else gets **NOT MARKED** for 8 s and nothing
  else. After an ending anyone may play (the party favour).
- **A capture** puts up a *Setup is preparing to reinstall a program*
  status line in the card for 12 s that names nobody.
- **During a walk** scenes stand aside; an overlay
  **holds** the walk (controls and leash pause) and it carries on when the
  overlay lifts.
- **WebGL2 is required** to play here. Check `chrome://gpu` on this laptop
  (WebGL2: *Hardware accelerated*). Without it the tent can only send
  programs to a headset.
- **No voice link** (the tent spot is `voice: false`); **announcements
  Always** (`&announce=1`), because no house speaker reaches the yard.

Set it up once in its own Chrome profile with the webcam allowed, then
the kiosk:

```bash
# macOS
open -na "Google Chrome" --args --user-data-dir="$HOME/.loom-terminal" \
  --kiosk --autoplay-policy=no-user-gesture-required \
  "https://app.mapsandducks.com/terminal/?code=<mod>&spot=tent&announce=1"
```

```powershell
# Windows
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:LOCALAPPDATA\loom-terminal" `
  --kiosk --autoplay-policy=no-user-gesture-required --no-first-run `
  "https://app.mapsandducks.com/terminal/?code=<mod>&spot=tent&announce=1"
```

The map's tent spot sets the view and the name (*Tent*; the shed variant
renames it *Shed*). Never add `&view=reinstall`. Turn sleep off as for the
server-room laptop. The standalone wizard at `/reinstall/` stays for a
spare tablet, a headset-only controller and the map editor.

**Install-day check:** `pnpm showctl preflight tent`; Run → Terminals
shows *Tent* green with `view reinstall` and the mic off; scan an unmarked
test pass (NOT MARKED); capture a test program (the status line, the name in the
red row); tap it (the game); fire an overlay mid-walk (held, not ended);
find Gerald (the celebration, then *— REINSTALLATION COMPLETE.*).

## The bathroom terminal

**Mounted outside the door, never inside.** The `bathroom-1-door` spot is
on the studio wall beside Bathroom 1's door (room `ram`, facing into the
RAM), so its camera looks at the studio, not the bathroom. Provision it
with `spot=bathroom-1-door`. If it ever has to go inside, run it as
`view=face` with the camera taped and tell the tech op.

## The mirror fallback

`view=mirror` is the safe mode for any screen: a silent full-screen
spectator with **no scanner, no pilot, no voice and no chat**. It shows the
idle show while Trabolta is hidden or asleep, the reinstallation while
someone plays, and the **TV's** screen program (the `screens_*` / `tv_*`
slides and overlays). A device with no WebGL2 draws the raycaster instead
of the 3D world.

**When to use it** (the director or the tech op decides; tell the other):

- a wall terminal shows *ONLINE*, the scanner or a pilot **before**
  `introduce_trabolta`;
- a terminal loops, crashes, or its camera keeps failing, and a Fully
  restart didn't fix it;
- the TV's `view=tv` misbehaves (a voice that loops or talks over a song, a
  frozen face) and the mute isn't enough.

**How** (≈ 1 min, nothing restarts):

1. Hold ⚙ 2 s → *advanced* → *screen* **mirror** → tap this terminal in the
   list (it keeps its spot). Or open
   `/terminal/?code=<mod>&name=<its name>&spot=<its spot>&view=mirror`.
2. Check Run → Terminals (green within 4 s) and by eye.
3. Say it on the radio: guests at that wall use their phones; on the TV
   Trabolta's lines are gone until it is back on `view=tv`.
4. **Going back:** hold ⚙ → *screen* `auto` (a wall terminal) or `tv` (the
   TV), or tap the spot again so it follows the map. A screen whose trouble
   wasn't fixed stays on the mirror all night.

Keep the mirror link (with the code blank) on the IP sheet in the server
room.
