# Kiosk settings — wall tablets and the TV

How every screen in the house is set up so it stays on, stays in the
terminal, and can't be reconfigured by a guest (OCT31 K-15, CHECKLIST
SW-SCR-19 / SW-SCR-23). The app's half is in `terminal/src/kiosk.ts`:

- **Wake Lock.** The terminal asks for a Screen Wake Lock at boot, again on
  the TOUCH TO WAKE tap, and again every time the page comes back into
  view (the browser drops the lock whenever the page is hidden). It needs
  HTTPS (we have it: `https://app.mapsandducks.com`) and Chrome 84+. The
  page reports the state on `<html data-wake-lock="held|off|unsupported">`.
  On a tablet older than Chrome 84 it is `unsupported`, and Fully Kiosk's
  *Keep Screen On* below does the job alone.
- **⚙ needs a 2 s hold.** A short tap or click on the gear does nothing; a
  bar fills under it while held, and setup opens at 2 s. Setup can forget
  the terminal's token, so this is what keeps a curious guest out of it.
  (The PIN on top is W-15 / SW-SCR-20, not this item.)

## Full screen by default (wave 17)

Every terminal runs full screen without anyone asking for it
(`terminal/src/fullscreen.ts`, decision D7). A browser only enters full
screen from a user gesture and drops it on a reload, a navigation, Esc or
an Android back swipe, so the page asks on several routes at once:

- **In the page: the Fullscreen API.** The first gesture (the TOUCH TO
  WAKE tap, any tap, click or key) asks the browser for full screen, and
  so does **every later gesture while the page is not full screen**:
  whatever knocked it out, the next touch brings it back. A tap into a
  text box (*type your program name*) is left alone so the keyboard can
  open. Safari and older WebViews get the `webkit` spellings.
- **Fully Kiosk.** Fully's own *Show Address / Status / Navigation Bar* ✘
  and Kiosk Mode (the table below) already fill the screen. With
  **Enable JavaScript Interface** ✔ (already on for the voice) the page
  also asks Fully to hide the status and navigation bars itself.
- **Chrome `--kiosk`** on the house Mac's TV (below) and on any laptop
  used as a terminal (the Internet laptop, *The Internet laptop* below):
  the only route that needs no gesture at all, and it survives a reload.
  A laptop terminal, its own profile:
  `open -na "Google Chrome" --args --user-data-dir="$HOME/.loom-terminal" --kiosk --autoplay-policy=no-user-gesture-required "https://app.mapsandducks.com/terminal/"`
  (⌘Q quits).
- **iPad: Home Screen + Guided Access** (below). The Home Screen copy
  opens with no Safari bars (the page declares itself a web app), and
  Guided Access keeps it there. In plain Safari the page asks for full
  screen on a tap like anywhere else.

The state is on `<html data-fullscreen="on|fully|off|disabled|unsupported">`
and rides the heartbeat (`fs=1|0`): **Run → Terminals shows ⛶ on a
terminal that is not full screen**. Browser-level full screen counts: Chrome
`--kiosk` (or F11) and a Home Screen web app report full screen with no tap,
so the TV, which nobody ever touches, shows no ⛶. On a tablet a ⛶ means
touch it once; on the TV or a laptop terminal it means its Chrome was
started without `--kiosk`: quit it (⌘Q) and relaunch with the line below. A
browser that can't go full screen, or a terminal with it turned off,
reports nothing and shows no badge. ⚙ → **full screen** (on by default) turns it off: do that on a
laptop a director tests on, so Esc sticks. It is stored with the terminal,
not a URL key.

## Sound: the tablet's speaker and the house speakers (wave 17)

A terminal's own speaker makes only its **accents**: popup dings, clicks,
cutscene stingers, the casino's jingles — synthesised in the page, no
sound files, dropped while the character speaks. **Every story `sound X`
comes out of the house speakers, and so does every announcement** (decision
D4): the house Mac's stagehand `audio` router, on for both since wave 18b
(QLab is not part of the rig, and the separate `alexa` announcement player
is retired). Nothing on a tablet plays a story sound. The one opt-in
exception is an **`announce` tablet** (*say the house announcements here*,
or `&announce=1`, for a room out of earshot of the speakers, below): it
also rings the chime and repeats each announcement in its own voice, with
a banner. The house speakers stay the main path; the tablet only echoes
them.

The house speakers are set up in the project file **`audio.json`**, not on
any device: the speakers placed on the plan, the interface's 16 inputs and
16 outputs, the input → output routing matrix, zones, and where each story
sound plays. Edit it in the map editor's **Audio** panel at
`/reinstall/map` (each speaker and output has a **Test** button); it is
pushed by `scripts/sync-show.sh`, snapshotted at launch like the maps, and
read by the router from `GET /api/mod/audio`. The contract is
[`room-audio.md`](./room-audio.md) §11; a story line names its rooms with
`sound X in <Place>` / `sound X with rooms: …` (Help → *Instructions* →
*Where a sound plays*). The TV's accents are quiet and the director's TV
mute cuts them with the voice.

## Android wall tablets — Fully Kiosk Browser PLUS

Setting names are from Fully Kiosk Browser 1.5x. If one has moved, use the
search box at the top of Fully's Settings.

| Section | Setting | Value | Why |
|---|---|---|---|
| Web Content | **Start URL** | `https://app.mapsandducks.com/terminal/` | The config (name, spot, token) lives in the page's localStorage, so the bare URL reopens this terminal as itself. Set it up once: open `/terminal/`, type the moderator passcode, tap this terminal in the list (the house map's terminals) — or open `/terminal/?code=<mod>&spot=<its id>`; then set this. |
| Web Content | **Autoplay Videos** | ✔ | Media may start without a tap. |
| Web Content | **Autoplay Audio** (if your version lists it separately) | ✔ | **The voice.** Without it the terminal can't speak until someone taps TOUCH TO WAKE after every reload. Still tap it once after a reload: Web Audio wants that gesture on some WebViews anyway. |
| Web Content | **Enable Webcam Access** | ✔ | The pass scanner. Android also asks for the camera permission the first time: allow. |
| Web Content | **Enable Microphone Access** | ✔ | **The voice link** (wave 19): the room is heard in the reinstallation games at this terminal's screen. Android asks for the microphone permission (for Fully) the first time: allow, once. Needs the `https://` address (a LAN `http://` address refuses the microphone, as it refuses the camera). The tent laptop's terminal takes no part (the map's `voice: false`), so it never asks. |
| Web Browsing | **Enable Pull to Refresh** | ✘ | A pull would reload the page and lose the audio unlock mid-show. |
| Web Browsing | **Swipe to Go Back / Navigate** | ✘ | Same reason. |
| Web Browsing | **Reload on Screen On** | ✘ | Same reason. |
| Web Auto Reload | **Auto Reload after Page Error** | ✔ | A network blip at boot recovers by itself. |
| Web Auto Reload | **Auto Reload on Idle** | ✘ | **Never reload on a timer.** A reload loses the audio unlock. |
| Advanced Web | **Wait for Network Connection** | ✔ | Boot waits for the Wi-Fi before loading the page. |
| Advanced Web | **Enable JavaScript Interface** (PLUS) | ✔ | **The voice on the old tablets.** Their Android System WebView may not implement `speechSynthesis` (K-02); with this on, the terminal speaks through Fully's `fully.textToSpeech` (Android's own TTS) instead. Off → the terminal still runs, text only (the transcript reveals at reading pace). The page also uses it to hide the status and navigation bars (wave 17). |
| Other (or *Device Management*) | **Text To Speech** engine / language, if your version lists them | the device's best English engine | What `fully.textToSpeech` speaks with. Otherwise it is Android's: Settings → System → Languages & input → **Text-to-speech output** → *Preferred engine* (Google Speech Services) + *Language: English (US)*, and **install the voice data** there (offline). Speech rate / pitch set there apply too. |
| Toolbars & Appearance | **Show Address Bar / Status Bar / Navigation Bar** | ✘ | Full screen (the page also asks on every tap: *Full screen by default* above). |
| Device Management | **Keep Screen On** | ✔ | The belt to the Wake Lock's braces. |
| Device Management | **Screen Off Timer** | 0 (off) | |
| Device Management | **Screen Brightness** | ~70 % | Readable, not a heater. |
| Screensaver | **Screensaver Timer** | 0 (off) | The terminal has its own attract screen. |
| Power | **Launch on Boot** | ✔ | A power cut brings the terminal back. |
| Kiosk Mode (PLUS) | **Enable Kiosk Mode** | ✔ | Locks the tablet to Fully. |
| Kiosk Mode (PLUS) | **Kiosk Exit PIN** | a PIN the tech op knows | Not printed anywhere guests can see. |
| Kiosk Mode (PLUS) | **Disable Status Bar / Home / Recent Apps / Power Button** | ✔ | |
| Other | **Restart on Crash** | ✔ | |
| Remote Admin (PLUS) | **Enable Remote Administration** | ✔ (LAN only) | Battery and screen state from a laptop. **Never** press *Reload* from it mid-show (see above). |

Android itself: Settings → Display → Sleep at its maximum; Developer
options → *Stay awake while charging* ✔ (both belt-and-braces). Battery
optimisation off for Fully.

**The voice is the tablet's own** (decision 2026-10-15 — no server voice
needed). After provisioning, hold ⚙ for 2 s: the setup screen says what
this tablet can do — *this device has N voices* (the WebView's
`speechSynthesis`), *Fully Kiosk's text-to-speech will speak*, or *text
only* — and **TEST VOICE** says a line through exactly the voice the
terminal will use and names it. Leave *voice* on **this device's own
voice** (the ladder: WebView voices → Fully → text only); pick **Fully
Kiosk's voice** on a tablet whose WebView lists voices but never says
anything. The terminal also gives up on a `speak()` that hasn't started
after 4 s (until the next tap, which tries the voice again), so a silent
stub can't stall a conversation.

**Saying the house announcements on a tablet** (N-09, an option, off
unless asked for). ⚙ → *say the house announcements* has three settings
(wave 18b):
- **House setting** (the default): the tablet follows the house list,
  `audio.json` `announce.terminals` — the map spots out of earshot of the
  house speakers. Run → Terminals shows 📢 on a spot that is on the list
  and turns it on or off there (a director's save; *Save to project* keeps
  it for the next launch). A spot not on the list stays quiet, and no
  room turns on by itself.
- **Always**: a chime and the line, in the tablet's voice, whatever the
  list says (`&announce=1` on the provisioning link).
- **Never** (`&announce=0`).

A link built on Run → Terminals' *Set up a terminal* carries
`&announce=1` only when *Always* is ticked, and no `announce` otherwise
(the house setting). A hand-written `&announce=0` pins the tablet to
**Never**, ignoring the house list: leave `announce` off the link unless
you mean Always or Never.

A tablet set up before wave 18b with announcements off reads as *House
setting*. The heartbeat reports what the tablet does now (`ann=1|0`).

**Trabolta must not sound like Alexa.** With no voice picked, the
character's lines take the device's best **male** voice and the house
announcements its best **female** one (`terminal/src/speech/pick-voice.ts`;
the house Mac's router says them as `say_voice: Samantha`). The
*device voice* list is ranked that way, and a voice picked there is
Trabolta's only — announcements never use it. Check it on every tablet
with TEST VOICE. **In Fully** (no voice list) `fully.textToSpeech` speaks
the Android default, often female: type a male Android voice's name into
*device voice* if TEST VOICE sounds like Alexa.

**A slide over the scanner.** A held slide (the y2k clock is up for the
whole final hour; `bingo`, `trust_chart`, `truth_txt`, awards) covers a
face terminal's scanner. **A tap on the slide peeks under it**: the
scanner and *type your program name* show (the only way in on a tablet
with no camera, e.g. plain http), and the corner countdown hides as well.
The slide comes back after **30 s with nobody touching the tablet**, or
when a line opens. A tablet showing no clock for a moment is someone
peeking, not a failed cue: don't re-fire it. An overlay (blackout, *go
to the living room*, the alarm) still covers everything. The TV and
mirrors never peek.

**A character the story lacks.** Since wave 7 a mod code knows the
story's cast before the doors open, so ⚙ refuses a name the story doesn't
have (`Trabolt`) at setup, with *The story has no character called …* and
the cast: fix the character field and save. Only a tablet set up with no
story loaded keeps the typed name; once the doors open it is sent back to
setup with the same message.

**Speaker tablets.** Media volume up, then lock it with Fully's *Volume
Limits* if the version has it. Set the volume before the party, not after.
The same speaker plays the reinstallation players near this terminal
(wave 19, the voice link), ducked under the character's voice.

**The voice link (wave 19).** A placed terminal sends its room to the
players near it in the games and plays them out of its speaker; nothing
leaves the room unless a player is near enough to hear it (the 🎤 at the
left edge, half way down, says so), and the terminal sends nothing while it is
making a sound itself (no echo back into the game). It starts with the
first touch after a reload, like the voice. ⚙ → advanced has *let the
games hear this room* and *play the players near this screen*; Run →
Terminals' 🎤 flags a tablet whose microphone was refused (*denied*) or
can't run on plain `http` (*insecure*). Check one by walking the virtual
room in the web game (a second laptop with `voice=1`) or a headset while
someone talks beside the tablet.

## iPads (if any are used)

Settings → Display & Brightness → Auto-Lock: **Never**; Accessibility →
Guided Access ✔ with a passcode; add the terminal to the Home Screen and
start Guided Access on it (that is the iPad's full screen: the Home Screen
copy has no Safari bars). Every reload needs a TOUCH TO WAKE tap (iOS has
no autoplay setting). Allow the microphone when asked (the voice link).
Unchecked on a device: opening the microphone switches iOS to its
play-and-record audio session, which can make the speaker quieter and has
been known to stop the camera's stream — if the scanner keeps dropping on
an iPad, turn *let the games hear this room* off there.

## The TV — the house Mac on the long HDMI run

There is no separate TV computer: the house Mac (the Ollama laptop) drives
the TV over HDMI and runs the TV view (`view=tv`, K-18: Trabolta's face and
voice, the world beside it while someone is in the simulation) full screen
on it. Its sound leaves the Mac's default output — the MOTU's living-room
pair — so the voice stays in sync with the face.

**The TV's voice is the Mac's own** (Chrome's `speechSynthesis` over the
macOS voices; no server voice). The terminal ranks them and picks a good
**male** English one — Daniel on a stock Mac — because the house router
speaks the house announcements in Samantha on the same Mac and the
same living-room speakers, and the two must not sound alike. The TV also
plays the reinstallation players near it (the voice link, wave 19), under
the same director mute; its microphone stays off (the Mac's default input
is the MOTU, whose house mics already reach the router) unless ⚙ ticks
*let the games hear this room*. For a better
one, download an *Enhanced* or *Premium* male English voice (Evan, Aaron,
Nathan, Tom; System Settings → Accessibility → Spoken Content → System
Voice → Manage Voices…), restart Chrome, and pick it under ⚙ → *device
voice* (TEST VOICE plays it). Never pick Samantha (or whatever
`say_voice` is in `stagehand/trapped.house.yaml`). The TV leaves *say the
house announcements* **off** — the living room hears the house speakers.

- Focus → **Do Not Disturb** on for the whole night, with *Allow
  notifications when mirroring or sharing the display* **off**, so no
  banner lands on the TV. `scripts/ops/showbackup.sh` is silent by
  default since wave 9 (a failure is logged only; `LOOM_NOTIFY=1` for a
  banner, `LOOM_NOTIFY_SOUND=<name>` for a sound), so leave both unset on
  this Mac.
- System Settings → Lock Screen → *Turn display off on power adapter when
  inactive*: **Never**; Energy → *Prevent automatic sleeping when the
  display is off* ✔. The page's Wake Lock also holds the display while the
  window is visible. For belt and braces run `caffeinate -dis &` in a
  terminal for the night.
- Chrome on the TV display, its own profile:
  `open -na "Google Chrome" --args --user-data-dir="$HOME/.loom-tv" --kiosk --autoplay-policy=no-user-gesture-required "https://app.mapsandducks.com/terminal/"`
  — `--kiosk` is full screen with no chrome; the autoplay flag means no wake
  tap is ever needed on the TV. Provision it once with
  `…/terminal/?code=<mod>&spot=desktop-tv` (or `/terminal/`, the passcode, tap **TV**).
  If Chrome came back without the flag (a reboot), the page shows *CLICK
  ONCE TO ENABLE THE VOICE*: one click anywhere.
- `M` on the Mac's keyboard (or the 🔊 button bottom right) mutes the TV
  voice — the same server-side mute the director has (OP-20 `ALL STOP`).
  The mute is kept with the event (`screen-voice.json`): a server restart,
  a redeploy or Go live in place leaves it as it was, and the server log
  says 🔇 at boot when the TV starts muted. A mute left on from a
  rehearsal stays on, so check **🔊 TV voice** on Run → Terminals before
  the doors.
- The ⚙ on the TV is a 2 s mouse hold as well.

## The mirror fallback (SW-SCR-02)

`view=mirror` is the safe mode for any screen: a silent full-screen
spectator with **no scanner, no pilot, no voice and no chat**. It shows
the screensaver while Trabolta is hidden or asleep, the world view while
someone is in the simulation, and the **TV's** screen program (the
`screens_*` / `tv_*` slides and overlays — not the wall terminals'
`terminals_*` cards). It has never run on the real tablets or the TV, so
the K-02 bench (10-20) opens `view=mirror` once on every tablet and the
TV; a tablet with no WebGL2 shows a still notice instead of the world.

**When to use it** (the director or the tech op decides; tell the other):

- a wall terminal shows *ONLINE*, the scanner or a pilot **before**
  `introduce_trabolta` (K-16 failed on that device — secrecy, #32);
- a terminal loops, crashes, or its camera / scanner keeps failing, and a
  Fully Kiosk restart didn't fix it;
- the TV's `view=tv` misbehaves (a voice that loops or talks over a song,
  a face that freezes) and the mute (🔊 / `M`) isn't enough.

**How** (≈ 1 min per screen, no code, nothing restarts):

1. Hold ⚙ 2 s → setup → *advanced* → *screen* **mirror** → tap this
   terminal in the list (it stays on its spot). Or open the
   provisioning link on the device:
   `https://app.mapsandducks.com/terminal/?code=<mod>&name=<its name>&spot=<its spot>&view=mirror`
   (the same name and spot it had, so Run → Terminals still shows it).
2. Check it on Run → Terminals (green within 4 s) and by eye: the
   screensaver (or the world view while someone plays), no scanner.
3. Say it on the radio: guests at that wall now use their phones; the
   house announcements still play from the speakers (the house router),
   and on the TV Trabolta's lines are text only in The Desktop (the TV
   voice is gone until it is back on `view=tv`).
4. **Going back:** once the cause is gone (after `introduce_trabolta`, a
   reboot that fixed it), hold ⚙ → *View* `auto` (a wall terminal) or
   `tv` (the TV) → Save. A screen whose trouble wasn't fixed stays on the
   mirror all night.

Keep the mirror link (with the mod code blank) on the IP sheet in the
server room (OCT31 §10). OCT31 OP-22 points here.

## The bathroom terminal

**Mounted outside the door, never inside.** The house map's
`bathroom-1-door` spot is on the studio wall beside Bathroom 1's door
(`house.json`: room `ram`, facing into the RAM; wave 14's measured plan
puts Bathroom 1's only door in the studio), so its camera looks at the
studio, not the bathroom. Provision it with
`spot=bathroom-1-door`. If it ever has to go inside,
run it as `view=face` with the camera taped and say so to the tech op —
but the plan is outside.

## The server-room terminal

One tablet hangs **inside** the Server Room (wave 7) — Trabolta's heart,
where programs who got through the keypad door talk to him candidly. The
house map's `server-room` spot is on the room's south wall, facing in
(`house.json` and `house.shed.json`: room `server-room`, pos
`[-5, -1.3, 12]`, yaw 0). Provision it with one link:

```
/terminal/?code=<mod passcode>&spot=server-room
```

(or `/terminal/`, the passcode, tap **Server Room**). The map's entry sets
the rest: `view: "face"` and `speaks: true` (a room terminal for The Server
Room's LOCATION).

- **`view=face`**, never `auto` / `world`: it is never a window into the
  simulation.
- **`room=The Server Room`** makes it a *room terminal*: it **sleeps**
  (the screensaver, no scanner) until the story opens The Server Room to
  everyone — the door cutscene's `reveal The Server Room`, or the
  patch-bay alarm's (a per-program reveal, like the majority's, doesn't
  count). It wakes on the poll that carries the cutscene,
  and speaks every Trabolta line said in that room, captioned, in its own
  voice; the scanner pauses (**LISTEN**) while he speaks.
- It shows **no story slides and no countdown corner** (not even the Y2K
  clock), but the overlays — the blackout, the patch-bay **alarm** — still
  cover it, and an overlay still ends an open line.
- The **TV mute** (🔊 on the TV, `M`, the Run page) is the TV's only: it
  never silences this terminal. To quiet it, turn its volume down.
- When a pass opens a line here the terminal posts the signal
  `terminal opened` (the guest as subject, `at: The Server Room`, labelled
  `Terminal · Server Room` in the log); `terminal closed` when the line
  ends — the 30 s leash, DISCONNECT, an overlay, a restart, or the page
  going away. Best-effort: a lost signal never holds up the line. The
  story uses them for `program.at_the_heart`, which makes Trabolta candid
  with that program whenever he is awake, and is the only place he can
  offer to stand down, from the Y2K hour (🕊 in `# hosts`; Help →
  *Running the server room*). A
  visit a crash or reload left open is closed on the tablet's next boot,
  and a close the Wi-Fi lost is sent again before the next line opens
  (or on the next boot). The next pass scanned at the server-room
  terminal takes over his heart whatever happened to the last close.
- Its corner reads *the story has no room called …* if `room=` is
  misspelled: the terminal then sleeps all night. The room resolves
  against the story before the doors too, so on install day that line
  means a typo, never "too early". Fix it in ⚙ (hold 2 s) → *the room it
  belongs to*.
- Run → Terminals shows its room on its row (`room The Server Room`). A
  row with a room on any **other** spot is amber: a tablet that was the
  TV once keeps `room=The Desktop` when its view changes, then sleeps on
  attract and speaks The Desktop's lines. Clear its room in ⚙.
- **📎 GIVE HIM A FILE** (any room terminal): while a pass is open, the
  line has a file panel — the guest's own codex entries, each with
  **Give** (the same share as their phone's), a **TYPE A CODE** box and
  **SCAN A FILE'S QR** to unlock a new entry there and give it. A file he
  always refuses shows why in place of Give: *A SECRET FILE: HE WON'T
  TAKE IT* (the digit notes, *The Door Code*, *The Cold Door*) or
  *ABOUT X: HE WON'T TAKE IT*. The panel's camera stops after each QR it
  redeems: tap SCAN A FILE'S QR again for the next one; a code it already
  unlocked is offered again, never redeemed twice. With the panel open
  the leash is **120 s** instead of 30, with *STILL THERE?* for the last
  20 s; it is never held, so a guest who walks off is still disconnected.
- Volume: loud enough to be heard over the server rack's fans from the
  doorway; the cutscene is spoken here, nowhere else.

### Wave 20: the heart is Steph's laptop, the door sensor rides on it

Since wave 20 the server-room terminal is **not a tablet**: it is Steph's
laptop, lid closed, driving a **monitor** with a **mouse and keyboard**,
and the door sensor (the Grand Central M4, `hardware/server-room-door/`)
is plugged into its USB. The page reads the sensor over **Web Serial**
and tells the story when the door opens and shuts (`door_sensor_opened` /
`door_sensor_closed`), reports it on its heartbeat (Run → Terminals: 🚪
*shut* / *open* with the level, red *fault*), and plays the heart's room
scenes and the choice panel. Web Serial is **desktop Chrome on https**
only (the event's own address is; never a bare `http://192.168…`).

- **The link:** `/terminal/?code=<mod passcode>&spot=server-room&door=serial`
  (`&keys=0` only for a mouse-only rig; `&camera=user` for the laptop's
  webcam or a USB one facing the program).
- **Its own Chrome profile.** Grants (the camera, the serial port) belong
  to a profile, and grants made in Steph's everyday profile don't carry
  over. Launch it once **without** `--kiosk` to make the grants:

  ```
  open -na "Google Chrome" --args --user-data-dir="$HOME/.loom-terminal" \
    "https://<site>/terminal/?code=<mod>&spot=server-room&door=serial&camera=user"
  ```

  Allow the camera; hold ⚙ 2 s → *advanced* → *door sensor* → **Connect
  door sensor** → pick the Grand Central in Chrome's list → Save. Then
  **Calibrate: door shut** (door shut, 2 s), open the door, **Calibrate:
  door open**: ⚙ shows the thresholds and they are stored on the laptop
  and in the board's flash, and re-sent on every connect.
- **Then the kiosk:** quit Chrome and relaunch with the same profile:

  ```
  caffeinate -dims open -na "Google Chrome" --args --user-data-dir="$HOME/.loom-terminal" \
    --kiosk --autoplay-policy=no-user-gesture-required "https://<site>/terminal/"
  ```

  (the stored config needs no `code` the second time). `caffeinate -dims`
  keeps the display, the disk and the system awake; also turn sleep off
  (`sudo pmset -a sleep 0 displaysleep 0`), notifications off (Focus),
  and keep the laptop on mains power — clamshell mode needs mains and the
  external monitor, which should be the main display.
- **Close any serial monitor** (the Arduino IDE's, `screen`, `arduino-cli
  monitor`): the port is exclusive, and ⚙ then reads *the door sensor's
  port won't open … close any serial monitor*.
- **After a reflash** the board's USB id changes in bootloader mode;
  Chrome may need the port granted once more (⚙ → Connect door sensor).
- **The built-in keyboard out of reach**: the kiosk URL carries the mod
  token in its stored config, and a guest at the external keyboard can
  only type to him.
- **What a fault looks like.** Unplugged, silent for 3 s, or flooded with
  light: nothing shows on the guest's screen (the sensor is *the door* in
  the fiction), ⚙ reads *door sensor: FAULT (…)*, Run → Terminals shows 🚪
  red with the reason, and the page tells the story **nothing** — use the
  🚪 *opened* / *closed* buttons on the cue sheet, which put the door on
  the buttons (amber *override* on Run) until 🚪 *Trust the door sensor*.
  The board may go quiet for up to 2 s after a setting changes; that is
  not a fault.
- **Testing without the board:** `&door=sim` — **O** opens a pretend
  door, **C** shuts it, **F** toggles a fault (keys typed into the chat
  box never move it).

Install-day check: before the doors, the terminal is on the screensaver
with the server running (Run → Terminals shows it green, with
`room The Server Room` on its row, and 🚪 *shut* with a level — open the
door and it reads *open* within a second). On a rehearsal after 🤖 (Trabolta
awake), fire 🚪 `server_door_opened` from the cue sheet: it wakes and
speaks the opener; shut the door (🚪 or the real one), scan a test pass, click
through Layer One, open 📎 and give a file, wait out the leash (three
minutes while a heart menu is docked), and check the Log for `terminal opened` then `terminal
closed` by *Terminal · Server Room*.

## The Server Door terminal — the King's chess

One tablet hangs on the basement hall wall **outside** the server-room
door, by the keypad (wave 11; on the measured plan, wave 14, the hall's
east wall beside the door, looking at it). It is **the King**: the only place in the
house he is played at chess. The map's `server-room-door` spot (name
*Server Door*, room `basement-hall`, on both variants). Provision it with
one link:

```
/terminal/?code=<mod passcode>&spot=server-room-door
```

(or `/terminal/`, the passcode, tap **Server Door**; the map's entry says
`view: "chess"`).

- **`view=chess`** needs no `character` and ignores `room`. It is
  **awake all night**: no screensaver, whatever Trabolta is doing.
- The attract screen is THE KING, his one shared health bar (*n / 15*,
  *HE KNEELS* at 0; off the screen state's `king`), the stakes line
  (*Checkmate him and the server-room door code goes to your Codex.*,
  or *No prize now.* after truth.txt or an ending) and the scanner with
  the typed-name fallback. **No hints, no tips, no strength line**: the
  bar is all a guest sees of how strong he is.
- **One game per pass scan.** A marked program is refused (*⛔ Marked
  programs can't challenge the King.*); an unknown pass says to register
  first. The board is dealt at the bar's strength **when it is dealt**
  (full = grandmaster … 0 = pawns only); a hit landing mid-game changes
  the next board, not this one. **GIVE UP** takes two taps.
- The leash is **120 s** with no touch (held while he thinks), *STILL
  THERE?* for the last 20 s; it abandons the game silently, like Give
  up: nothing reaches the story.
- A game's end posts `chess won` / `chess lost` / `chess drawn` for that
  program, labelled *Terminal · Server Door* in the Log (retried for a
  few seconds; kept across a reload for 60 s). A win that never landed
  says *The win didn't reach the house: tell a host (♟).* — the host
  who saw it presses ♟ on the winner's card. A win that landed reads
  *Checkmate. The door code is in your phone's Codex.*, also for a
  program who already held the code; *Checkmate. No prize now.* only
  after truth.txt or an ending.
- Overlays (the blackout, the alarm) cover the board and hold the game;
  no story slides, no countdown corner, no Y2K clock. The poll is its
  heartbeat on Run → Terminals, like any terminal's.
- The chess is a lazy chunk (~60 kB), preloaded at boot on this tablet
  only. It thinks in short slices, so taps stay live on the oldest
  tablets; a grandmaster move takes a couple of seconds.
- Volume: it never speaks. Brightness up: guests stand to play.

Install-day check: Run → Terminals shows *Server Door* green. On a
rehearsal, scan a test pass, play to a mate (knock him to 0 first on
the tent tablet, or Run → House map **Set…** 0, then **👑 Restore**
after), and check `# hosts` for *♟ … beat the King* and the Log for
`chess won` by *Terminal · Server Door*. Put him back to 15/15 before
the doors.


## The Internet laptop — the reinstallation station (wave 18b)

The laptop in the tent (the shed on a rain night) is **one device that is
a terminal and the reinstallation wizard** (`view=reinstall`,
`terminal/src/reinstall/`). Between walks it is a wall terminal: the idle
show (it never names Trabolta before his introduction), the scan box with
*type your program name*, the story's slides, beat cutscenes, moments and
overlays, and — while someone walks the simulation on a headset — the
world view beside the show. Above the scan box a red strip lists **☣ IN
THE INTERNET NOW**: the programs captured into the Internet, by name, one
tap each (never the marked who are still on their way: that list is the
Antivirus' own).

- **A pass.** A captured or marked program gets the reinstall app's own
  wizard full screen: straight into the game (*Play here*) when no headset
  is online, else the choose card (*Play here* or *Send to <headset>*). A
  program that is not marked gets a **NOT MARKED** card for 8 s and
  nothing else: no story effect, no line from Trabolta. A program already
  walking on a headset is asked *Play here instead?* (that ends the
  headset's walk). After an ending anyone may play (the party favour).
- **A capture.** The story's capture cue puts up a Win98 *Setup is
  preparing to reinstall a program* card for 12 s that names nobody (the
  news is on the program's own phone).
- **During a walk** the laptop counts as busy: story slides and beat
  cutscenes stand aside until the walk ends. An overlay (the blackout, the
  alarm, *go to the living room*) still covers the screen and **holds**
  the walk: the controls and the leash pause, the session stays alive, and
  the walk carries on when the overlay lifts. A house announcement's
  banner shows over the game.
- **Sound.** The game's quack, fanfare and thuds play on the terminal's
  own sound bus, so the tent's speaker is one level for everything.
- **Set it up** once, in kiosk Chrome with the webcam allowed:
  `https://app.mapsandducks.com/terminal/?code=<mod>&spot=tent&announce=1`
  (the map's tent spot says `view: reinstall`, so the spot alone sets the
  view and the name, *Tent*, and the laptop follows the map: on a rain
  night the shed variant renames it *Shed*. Never add `&view=reinstall`:
  a link that names its own view keeps its own name, *Terminal*, and
  stops following the map. `&announce=1` because no house speaker
  reaches the yard). Launch Chrome with the `--kiosk
  --autoplay-policy=no-user-gesture-required` line above, its own
  profile, and tap TOUCH TO WAKE once if it shows. The camera is the
  laptop's own webcam (`user`).
- **The standalone wizard** at `/reinstall/` stays for a spare tablet, a
  headset-only controller and the map editor.

Install-day check: Run → Terminals shows *Tent* green with `view
reinstall`; scan an unmarked test pass (NOT MARKED), capture a test
program (the wizard card, the name in the red strip), tap it (the game),
fire an overlay mid-walk (held, not ended), find Gerald (the celebration,
then *— REINSTALLATION COMPLETE.*).
