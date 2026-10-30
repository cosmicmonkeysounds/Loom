# Show night: the runbook

What to do, in order, for *Trapped in the Internet* on **Sat Oct 31 2026**:
the deploy that has to land first, the morning reset, the start of the
evening by time and by machine, the pre-show checklist, the doors, the show,
emergencies, and after. The machines and how they connect are in
[`TECH.md`](./TECH.md); the cue sheet, acts and terminal spots are on the
generated [`SHOW.html`](./SHOW.html); each crew member's card is in
[`cast-packs/`](./cast-packs).

`scripts/ops/checklist.sh` prints the **Pre-show checklist** section below
as tick boxes (`scripts/ops/checklist.sh --probe | lpr`). Keep its heading
line and numbered format exactly as they are.

Never write a code into this file: `<mod>` is the moderator passcode, which
is on the director's card.

## Times and dates

| When | What |
|---|---|
| Sat 10-24 12:00 | Content lock |
| Sun 10-25 | Run-through |
| Tue 10-27 18:00 | Feature freeze; install day |
| Wed 10-28 | Tech rehearsal |
| Thu 10-29 | Dress rehearsal + the tent ⇄ shed drill |
| Fri 10-30 | Code freeze: the release `show-1031`, the warm standby built and stopped, the safety walk |
| Sat 10-31 | The show. Sunset ≈ 18:10 ADT; trick-or-treating ≈ 18:00–20:00 |
| Sun 11-01 02:00 | Clocks fall back to 01:00 AST. The story counts elapsed time and doesn't care; tell the crew and plan rides home |

## 1. Before the night: the pending deploy

The VPS runs **`w27`** (2026-10-27: master through wave 27, the heart's
first meeting; rollback `w26`), and the preview event is synced on it. What
is left of the deploy is on the house machines and the screens: steps 4–5
and 7–10 of the root `CLAUDE.md`'s *Shipping master* (the Desktop's
stagehand, the router, the M4, reloading every terminal and the TV, the
Quest APK). Verify what runs with
`ssh loom-vps 'tail ~/loom-ops/releases.log'`. Land it in this order:

1. **The sign-off is done** (2026-10-27): every line of waves 13–29 ships
   as written (`SIGNOFF-w13.md` … `SIGNOFF-w28.md`, `history/SIGNOFF-w18b.md`,
   `history/SIGNOFF-w20.md`). Still `DRAFT`: wave 22's patch-bay lines (no
   sheet). Wave 29 (`SIGNOFF-w29.md`) was signed off the same day.
2. **Check the preview's roster, in its own step:** `pnpm showctl roster`.
   If anyone is on, ask before shipping: a release restarts the server.
3. **MacBook:** `scripts/ops/predeploy.sh --vr` (the full gate; it stamps
   the commit). Also `pnpm --filter @loom/core show:page --check`.
4. **Server first:** `LOOM_VPS=loom-vps scripts/ops/ship.sh show-1031`
   (ship.sh defaults to `ubuntu@app.mapsandducks.com`; or set `LOOM_VPS` in
   `~/.config/loom/ops.env`). **Stop if it fails**
   (a chained sync would carry on). Then
   `ssh loom-vps 'cd ~/loom && deploy/release.sh --check-env'` and
   `curl https://app.mapsandducks.com/api/health` → 200. Rollback:
   `ssh loom-vps 'cd ~/loom && deploy/rollback.sh'`.
5. **MacBook, before the sync: retire the old house-Mac jobs.** The MacBook
   *is* the old house Mac, so it may still run the `show`, `lights` and
   `audio` jobs, and its own Mosquitto and Zigbee2MQTT. Two `show` jobs fire
   every cue twice, two routers speak every announcement twice, and an old
   door rule would post into the new story. `git pull`, then:

   ```bash
   cd stagehand
   uv run stagehand launchd uninstall --job show
   uv run stagehand launchd uninstall --job lights      # if installed
   uv run stagehand launchd uninstall --job audio       # the router moves to the Desktop
   brew services stop mosquitto
   launchctl bootout gui/$(id -u)/com.mapsandducks.zigbee2mqtt   # zigbee.md §4
   ```

   Then move the CC2652P (and Zigbee2MQTT's `data/`), the MOTU 828x (no
   ADAT expander since wave 31), and the sound files (`stagehand/media/sounds/`,
   and the soundtrack's MP3s in `stagehand/media/music/` if they were
   collected here) to the Desktop. `uv run stagehand launchd status` then lists only `agents`.
6. **Desktop, first time only** (`scripts/house-desktop/README.md`): from an
   elevated PowerShell, `.\scripts\house-desktop\setup-mosquitto.ps1` (it
   asks for the `props` password; add `-SetPrivate` if the network is
   Public). Then `.\scripts\house-desktop\zigbee2mqtt.ps1 -Ports`, copy the
   MacBook's `data\` to `C:\zigbee2mqtt\data\` and set its `serial.port` to
   the stick's `COMn` (on a first install only, with no `data\` to copy:
   `-WriteConfig -Port COMn`), `-Start` once, elevated `-InstallTask`, then
   `-Check`. The 828x: MOTU's Windows driver, the ASIO proof, both optical
   ports on ADAT and Main / Phones not mirrored (`scripts/house-desktop/README.md` §3), the MOTU's ASIO name in
   `stagehand\trapped.desktop.local.yaml`, and the sound files copied into
   `stagehand\media\sounds\`. The cabling (README §3.2, §3.5; the
   channels in the ASIO driver's order since wave 46): the living room on
   **Main L/R** (outs 1–2) and the **sub** on Analog Out 1 (out 3); in
   CueMix, Clippy's mic (input 1) mixed to the living room as before (to
   Main L/R now) and input 3 in no mix. The TV:
   `.\scripts\house-desktop\tv-kiosk.ps1 -Setup`, then `-InstallTask`;
   then **VoiceMeeter Potato** running at sign-in (A1 on an unused MOTU
   WDM pair, the VAIO strip on B1 only), Chrome's output to **VoiceMeeter
   Input** (Windows' Volume mixer; the Desktop has no line out, so the
   router's `audio.tap` sums VoiceMeeter into input 3, no cable), and the
   TV's own volume down, or Trabolta plays twice.
7. **Desktop, before the sync:** put the real event id and the mod passcode
   in `stagehand\trapped.house.local.yaml` (git-ignored; the tracked file
   says `CHANGE-ME`), `git pull`, then
   `.\scripts\house-desktop\start-stagehand.ps1` (checks, installs and
   starts the `show`, `lights` and `audio` tasks; on a rig that already has
   them, `-Restart show`; with the router on the MacBook, `-NoAudio`), so no
   old door rule posts into the new story.
8. **Sync the story, with its reload, before doors.** First merge any
   speaker survey saved to the project into the repo's `audio.json` (the
   replace below overwrites the project's copy). Then
   `LOOM_SSH=loom-vps LOOM_PROJECT="trapped in the internet" pnpm sync-show --replace-audio`.
   Wave 38's `audio.json` (the living room on Main L/R + the sub, the TV
   and Clippy's inputs with their ducking roles, the TV's route) reaches
   the project only this way: the router plays the project's copy. So do
   wave 46's channel numbers (the 828x's ASIO order: the living room 1–2,
   the sub 3, the kitchen 5–6, The Optical Drive 10): until then the
   project keeps the old ones (or fix them on the map's Audio tab), and
   every speaker needs a fresh 🔈 Test after.
   **Add `--replace-lights`** (wave 31): the project's `lights.json` holds
   only the server-room bulb, and the repo's now holds every house bulb,
   the living-room strip and the `lights_*` looks. First Download JSON any
   look or light saved to the project and merge it into the repo's.
   **Add `--replace-maps`:** wave 26 changed both maps (Trabolta's heart,
   the virus disk, the *MAINFRAME* rack label), and without it the
   project's old maps win. First Download JSON any map edits saved to the
   project and commit them into the repo's `house.json` /
   `house.shed.json`. Never `--no-reload` for these waves: the composition
   changed.
9. **Restart every other non-ended event** (Run → Restart or Push draft).
10. **MacBook, Trabolta:** `cd stagehand && uv run stagehand launchd restart --job agents`;
    then Run → Mind → **Reset**. `uv run stagehand check --config laptop.yaml --only agents`
    shows `ctx 20480` and no warning.
11. **Desktop, the sound router** (its home since 2026-10-27; the MacBook
    is the fallback, `TECH.md`): with the 828x proven under ASIO (step 6)
    and the `audio` task running from step 7,
    `start-stagehand.ps1` has rendered the SFX library and the 13 story
    stand-ins (`uv run stagehand sounds library --story --config
    trapped.desktop.yaml` by hand; unchanged files are not rewritten);
    `uv run stagehand sounds placeholders --config trapped.desktop.yaml`
    for any sound with no real file yet (the songs); the user's MP3s in
    `stagehand\media\music\<act>\` (`doors`, `act-1`, `malware`, `act-2`,
    `act-3`, `final`, `ceremony`, `afterparty`; README §3.4);
    `uv run stagehand check --config trapped.desktop.yaml --only audio`
    (32 in / 30 out `duplex`, the layout not moved, no `PLACEHOLDER
    server.…` line, a file count for every playlist; a VBR MP3 without a
    length header is re-encoded with the line it prints);
    then `.\scripts\house-desktop\start-stagehand.ps1 -Restart audio` after
    any `git pull`, so the router is wave 26's and says *Anti Virus*. Walk
    every speaker with 🔈 Test on the map's Audio tab (ASIO's channel order),
    the sub with music (its own trim), then `uv run stagehand announce
    --config trapped.desktop.yaml "Test."`. **The sidechain walk** (README
    §8): `uv run stagehand music scene act_1 --config trapped.desktop.yaml`;
    a TV TEST VOICE plays once on the house speakers (not the TV's) and the
    music dips under it everywhere, the sub too; Clippy talking dips the
    living room only. **At the tech rehearsal** set Clippy's threshold:
    the lav idle with the party on, read input 1 in `stagehand music
    status`, set `audio.sidechain.roles.clippy.threshold_db` in
    `stagehand/trapped.house.yaml` about 6 dB above it, commit, `-Restart
    audio` (README §3.6). Then `music stop`.
    **The fallback** (the 828x won't run on Windows): `-Stop audio` on the
    Desktop, then `scripts/house-macbook/audio.md` on the MacBook (its
    `trapped.macbook.local.yaml` with `server: {}` and the props password,
    `launchd install --job audio --config trapped.macbook.yaml`); both
    preflights then take `--router macbook` / `-NoAudio`. The fallback is
    output-only: no TV route and no ducking under Trabolta or Clippy, so
    Chrome goes back to HDMI and the TV's volume up.
12. **Desktop, the lights:** with Zigbee2MQTT up on the CC2652P and the
    `lights` task running (it must run before pairing), pair every bulb
    under its `lights.json` name (`server_room_rgb`, `living_1`…, the
    table in `scripts/house-desktop/README.md` §5.4), each reset and set
    `power_on_behavior: on`, then the living-room WLED strip (its LED
    preferences and brightness limiter, its MQTT on the Desktop's `:1884`,
    device topic `wled/living`: §6). No Zigbee groups, scenes or WLED
    presets: `lights.json` already places every light and holds every
    look. Run → House → Setup green, Checks walked (every light, every
    look), each look played with ▶ Test on the house in the Cue designer
    (retune, Save to project).
    `uv run stagehand check --config trapped.desktop.yaml --only lights` is
    green.
13. **Steph's laptop:** flash the wave 22 firmware from
    `hardware/server-room-m4` (door + patch bay; `LED_PULSED`, the LED on
    D23); `scripts/accept/N-20.sh` (the door) and `N-21.sh` (the bay:
    learns V1–V8, then `pb save`); open the terminal once without
    `--kiosk`, grant the camera and the port, **calibrate the door in ⚙**
    (always after a reflash), check the patch bay's live table, relaunch in
    kiosk.
14. **Reload every terminal, the TV and the tent laptop.** Mandatory since
    wave 26: an old bundle refuses the new maps and walks or shows its
    bundled one. Check every device's build stamp on Run → Terminals
    (`pnpm showctl doctor` too). Set the TV's ⚙ pace to **0.92×** (a TV set
    up before keeps 1.00×; `tv-kiosk.ps1 -Setup` re-opens its link, which
    sets it). Touch each tablet once (its 🎤 must not read *tap*).
15. **Quest:** after the server ships, re-export and sideload:
    `reinstall/vr/tools/quest.sh build`, then `install` (an old APK has no
    void, heart or disk). Allow the microphone in the lobby, check the
    lobby's build stamp, then HW-TENT-07.
16. **The keypad:** set by hand to `facts.json` `door.code`; test from
    outside with the code and from inside with the handle and no code.
17. **Door test:** a real open → shut → open shows 🚪 on Run → Terminals
    within a second, with no fault and no *override*; then 🔄
    `reset_server_room` (and 🚪 *Trust the door sensor again* if anyone
    pressed a 🚪).
18. **Reprints (the sign-off is done, 2026-10-27):** Clippy, the director and
    second-director packs, the four Antivirus, the hosts, all-crew, the
    patch-bay watch card, the emergency card, Excel's and OpenOffice's
    sheets, every featured card, the Bingo card, and Combo A's two codex
    halves (the bay's layout changed in wave 22, and Combo A with it).
    Wave 23: the badges (Run → Print sheet → Badges) and the cast cards.
    Wave 26: Clippy, Task Manager, Norton, McAfee, Password Manager, CRA,
    the director, the Installation Wizard and Microsoft Excel
    (`SIGNOFF-w26.md`). The sign-off: Adobe Acrobat, the Recycling Bin,
    all-crew and the patch-bay watch card lose their printed DRAFT tags.

## 2. The morning reset (10:00)

**Pause first.** A restart keeps the doors as it finds them: a Push draft or
Go live on an *open* event plays Power On at once (the combinations, the door
code, the King at 15, the show clock set to 7:00 PM), and a pause afterwards
cannot take it back.

1. **Weather call.** Gusts over 30–40 km/h or steady rain → the shed. Switch
   on the Run page's House map card (*Tent | Shed*), or at `/reinstall/map` on a phone, signed in with the mod code.
2. **⏸ Pause** the preview (Run, or a host's More → Night →
   *⏸ Pause the show*).
3. A **plain** sync, with no `--replace-*`:
   `LOOM_SSH=loom-vps LOOM_PROJECT="trapped in the internet" pnpm sync-show`.
   By now the project holds the bulb's placement, the tested looks and any
   speaker survey; `--replace-lights`, `--replace-audio` or `--replace-maps`
   would overwrite them with the repo's copies. Then **Push draft**.
4. Scan the door QR from a phone **on cellular**.
5. **Go live in place**, before anyone registers. The codes stay the printed
   ones.
6. Run → World must **not** show `Kernel.door_code` set yet. If it does,
   Power On already played: pause, then Restart (still before anyone
   registers).
7. The map page's status line reads "the project's map". If it reads "this
   event's map", a rehearsal's director save is still in force: Save to
   project to keep it, or switch variants and back to drop it.

From now on: **never Restart, Push draft, Go live or End after the doors.**
Each one wipes every guest.

## 3. The start of the evening

### By time

| Time | Who | What |
|---|---|---|
| 10:00 | Director + tech op | Weather call and the morning reset (§2) |
| 12:00 | Set crew | Set dressing, the tent pitched or the shed set, glow tape on every step. Print: codex posters, clue props hidden (photos match), the four silver digit notes hidden in their rooms (never the server room, never a bathroom), check-in signs, the fact stacks per `generated/print-stacks.md`, Bingo cards and pens, trophies |
| 15:00 | Tech op | Boot every machine (below); `pnpm showctl doctor` green; the keypad test (outside with the code, inside with the handle and no code); one announcement through the router; a 🔈 Test per speaker at show level |
| 17:00 | Performers + house manager | Booths signed in (after Go live) with the performer code; push subscribed; a test `!` alert reaches every performer phone; walk the stations. Loaner phones (2–3), the charging station, power banks, radios with earpieces |
| 18:00 | Door host + house manager | Porch: candy bowl and sign, the Optical Drive dim (not dark) until doors. Pre-show checklist signed. Safety re-check |
| 19:00 | Everyone | Food and a 15-minute briefing: the blackout rule, the call words (incl. ALL STOP and ARRIVAL), the emergency card, never restart. Tech op on the MacBook: `scripts/ops/showbackup.sh install`, then `status` once an act |
| 19:45 | Everyone | Places. Lights to screensaver. Run → Director: 🕊 Heart autoend off, 🔄 and 🕊 on the sheet, the TV voice not muted |
| 19:00 or 20:00 | Director | **Doors** (§5) |
| by 21:00 | Director | **C1** 📣, the first cue |
| ≈ 02:10 ADT | | Ending and ceremony done (a projection: the plan's budget adds up to 5 h 10 min from C1) |

### By machine

On every machine, first set the moderator code in that shell (never in a
file), then run its preflight until it is green or every amber is
understood. `pnpm showctl` needs a checkout of this repo and Node ≥ 22.6 on
the machine (`scripts/show/README.md`). If Steph's laptop or the old laptop
has neither, run `pnpm showctl preflight serverroom` / `tent` from the
MacBook: its server half (the terminal's heartbeat, the M4's door and bay
readings on the server) still checks; walk the local half (sleep, power,
the camera, WebGL2) by hand from the lists below.

```bash
export LOOM_MOD_CODE='<mod>'                # macOS
pnpm showctl preflight macbook              # or serverroom / tent
```
```powershell
$env:LOOM_MOD_CODE = '<mod>'                # Windows
.\scripts\house-desktop\preflight.ps1       # runs showctl preflight desktop at the end
```

**John's MacBook** (Trabolta, a Run console)

- On the charger, `caffeinate -dims` in a terminal for the night, sleep off.
- Claude Haiku is his voice (wave 52) and Ollama is the standby: `stagehand
  check` says `key set`, and Run → Mind shows no `engine macbook` on his
  thoughts unless Claude refused a line or is down. To go back to Ollama alone:
  `scripts/house-macbook/trabolta.md` §7.
- Ollama with `OLLAMA_KEEP_ALIVE=-1`; `ollama ps` shows `gpt-oss:20b` alone
  (warm it: `ollama run gpt-oss:20b hi`). Keep it warm: it is the fallback.
- `cd stagehand && uv run stagehand launchd status`: `agents` running;
  `show`, `lights` and `audio` not installed (they run on the Desktop; in
  the router fallback `audio` runs here too, and the preflight takes
  `--router macbook`).
- Run → Mind: worker connected, a *mind · story* chip, Reset; the Judging
  card reads `auto` with nothing pending; Trabolta hidden and asleep.
- Run → House map: the King's row reads 15 / 15 (👑 or Set… only on purpose).
- Run → Wallet names CRA Agent Software as the approver and Runescape as
  the minter; `# quarantine` is empty.
- Run → House → Setup: 🧠 Trabolta green.

**John's Desktop** (the sound, the lights, the broker, the TV)

- Power on the 828x first, then the PC, and let it sign in: Mosquitto (a service),
  Zigbee2MQTT (a boot task), `show` + `lights` + `audio` (sign-in tasks) and
  the TV kiosk start by themselves.
- `.\scripts\house-desktop\preflight.ps1` passes (it ends with `showctl
  preflight desktop`).
- The Mosquitto service runs on 1883 (loopback) and 1884 (password);
  Zigbee2MQTT is online with every bulb in its device list.
- The `show`, `lights` and `audio` tasks run
  (`.\scripts\house-desktop\start-stagehand.ps1 -Status`).
- `uv run stagehand check --config trapped.desktop.yaml --only audio` shows
  the MOTU at 32 / 30 with no placeholder left and every music playlist
  with files (`.\scripts\house-desktop\preflight.ps1` warns on an empty
  folder).
- `uv run stagehand music status --config trapped.desktop.yaml` answers
  with no `no files :` line; its `inputs` line has a level for 1 and 3
  (an output-only stream shows `—`).
- The TV's sound: VoiceMeeter running, Chrome on VoiceMeeter Input (the
  router's `audio.tap` into input 3), the TV's own volume down; a TEST
  VOICE plays once, on the house speakers, and ducks the music.
- Run → House → Setup: 🔊 Sound and 💡 Lights green; the WLED strip and
  every placed bulb answer 💡 Identify.
- The TV kiosk on spot `desktop-tv`, **clicked once after its last boot**
  (or it stays silent), showing the screensaver; notifications off.
- The bulb answers 💡 Identify and sits on `heart_idle`.

**Steph's laptop** (the server room)

- `pnpm showctl preflight serverroom` (Windows: `.\scripts\show\showctl.ps1 preflight serverroom`).
- Mains, sleep off, the monitor as the main display, keyboard and mouse in
  reach, the kiosk on `…/terminal/?code=<mod>&spot=server-room&door=serial&camera=user`.
- ⚙ shows the door sensor connected and calibrated; a real open → shut shows
  on Run → Terminals within a second; then 🔄.
- The patch bay all unplugged; ⚙'s table reads every input empty.
- The webcam reads a pass in the room's light; the terminal is green and
  asleep on its screensaver.

**John's old laptop** (the tent)

- `pnpm showctl preflight tent`.
- WebGL2 works (`chrome://gpu`, or *Play here* starts). Without it the tent
  can only send to a headset.
- The kiosk on `…/terminal/?code=<mod>&spot=tent&announce=1`; a webcam scan
  works; an unmarked pass shows NOT MARKED.
- The Quest charged (if go), the heater on its GFCI leg, the EXIT sign on.

**Tablets and other terminals**

- `pnpm showctl terminals`: every tablet green, on the idle show, ⚙ names
  Trabolta, no red ⛶, 🎤 not *tap*.
- The Server Door tablet on chess, charging, THE KING at 15 / 15.
- The Casino tablet on spot `graphics-card`.

## 4. Pre-show checklist

**Pre-show checklist** (the director ticks it; `scripts/ops/checklist.sh` prints it):

1. Deploy: the pinned `show-1031` images run; the previous image is still on the VPS; the warm standby exists (stopped); the uptime alert on `https://app.mapsandducks.com/api/health` reaches the tech op and the second director; this sheet printed with `scripts/ops/checklist.sh --probe` heads with a ✔ health line (a ⚠ line is fixed before doors).
2. The morning reset is done: paused first, then a plain sync (no replace flags), Push draft, the door QR scanned on cellular, Go live in place, before any registration; Run → World shows `Kernel.door_code` not yet set; the codes are the printed ones.
3. The map page's *Map:* bar shows Tent or Shed (the 10:00 call) as `● live`, and its status line reads "the project's map".
4. Every machine's preflight is green: `pnpm showctl preflight macbook`, `desktop` (via `preflight.ps1`), `serverroom` and `tent`; `pnpm showctl doctor` shows no red.
5. Trabolta: the worker connected (a *mind · story* chip), the mind Reset, `ollama ps` shows `gpt-oss:20b` alone, the MacBook on its charger; `uv run stagehand check --config laptop.yaml --only agents` shows `ctx 20480` and no warning; he is hidden and asleep.
6. Terminals: every tablet green on `pnpm showctl terminals`, on the idle show, and every wall terminal's ⚙ names Trabolta; the TV on the screensaver, clicked once after its last boot; the Server Door terminal on THE KING.
7. Audio: the `audio` job running on the Desktop (on the MacBook only in the fallback) with the MOTU at 32 / 30 and no placeholder left, Run → House → Setup's 🔊 Sound row green, a 🔈 Test per speaker at show level (the sub with music), one announcement heard through the router (this needs the Desktop's `show` job and broker too). The soundtrack: the SFX library rendered on the Desktop (`start-stagehand.ps1`, or `stagehand sounds library --story`), every `media/music/<act>/` folder filled, and `stagehand music status` shows the scene (`off` or none before the doors) with no `no files :` line. The sidechain walk: a TV line ducks the music on every speaker, Clippy's mic ducks the living room's, and the TV's own speakers stay silent for Chrome (Trabolta is heard once).
8. Lights: the server-room bulb answers 💡 Identify and sits on `heart_idle`; `stagehand check --only lights` is green, `health/lights` online and Run → House → Setup's 💡 Lights row green; the bulb never drops under 80 / 254. Every placed Hue and ZL1 bulb and the WLED strip answer 💡 Identify; one `lights_blackout` test (the halls and both bathrooms stay at their dim floor, the server room on its heart look).
9. The server-room door: the keypad was set by hand to `facts.json` `door.code` and tested at 15:00, and it opens from inside with no code; the keypad sign hangs beside it; the sensor reads 🚪 shut / open on Run → Terminals within a second, with no fault and no override; then 🔄.
10. The patch bay: all unplugged; ⚙'s live table reads every input empty; Run → Terminals shows no 🔌 fault and the story is not on the buttons (or 🔌 Trust the patch bay again was pressed).
11. The server-room terminal (Steph's laptop) is green and asleep on its screensaver, the M4 on USB, an external keyboard in reach, and the webcam reads a pass in the room's light; Run → Director shows 🔄 reset and 🕊 talked down, and 🕊 Heart autoend is off.
12. The King: Run → House map's King row reads 15 / 15; the Server Door tablet is charging.
13. The tent: the old laptop on spot `tent` with WebGL2, the Quest charged (if go), the Installation Wizard video loaded on the second device, the heater on its GFCI leg, the EXIT sign on.
14. Push: the staff test alert arrived on every performer phone. Every part has done its upload on its own phone (Run's watch *Staff uploaded* gone or at 8), before the doors: the booth is the upload until then, so an Antivirus who signs in at the door is not at the door. Stuck: ⏭ Wave the staff through their upload (Anytime).
15. Facts and wallet: `titi:facts --check` passed at predeploy; Run → Mind's Judging card reads auto; a test phone shows the Wallet room and a 🪙 balance; `# quarantine` is empty; Run → Wallet names CRA Agent Software as the approver and Runescape as the minter.
16. Knobs: on the VPS, `deploy/release.sh --check-env` ends "the night's knobs are set ✔"; `LOOM_SNAPSHOT_MS` and `LOOM_HOMESCREEN` are blank unless the K-32 run failed (then `LOOM_SNAPSHOT_MS=500`) or the iPhone Home Screen call was yes (then `LOOM_HOMESCREEN=on`).
17. Print: codex posters up and clue props hidden (photos match), the four silver digit notes hidden, the invitations sent with their claim QRs, check-in signs up, Bingo cards and pens, the fact stacks per `generated/print-stacks.md`, trophies, cheat-sheets; on a shed night the SITE-SCHEDULE clipboard and the BUGDOM-VR sketch hang in The Optical Drive.
18. Safety: first aid and an ABC extinguisher placed, egress clear, glow tape, GFCIs tested, no strobe over 3 Hz, the server door opens from inside with no code, the patch-bay gear taped off, the emergency card posted at the door, the override key and spare batteries with the house manager.
19. Phones: loaners (2–3) charged, the guest charging station live, power banks for every performer, radios charged with earpieces.
20. Backups: `scripts/ops/showbackup.sh install` armed on the MacBook for 19:00–03:00; the ISP router boxed nearby as the cold spare.

**Signed** at 18:00 by the director.

## 5. The doors

**Open question (U2): 19:00 or 20:00.** The invitations, the crunch plan and
the director's card say 20:00. The story's opening beat (Power On) sets the
show clock to 7:00 PM the moment the doors open, and the sign-off says "the
party starts at 7 PM". Either open the doors at 19:00, or open at 20:00 and
set the clock with a host's 🕐 *Show clock* right after.

1. **🚪 Open the doors** (Run, or a host's More → Night). Power On plays.
2. Run → World shows `Kernel.door_code` set (masked; never read it aloud
   near a terminal).
3. If the doors are at 20:00: set 🕐 *Show clock*.
4. John hands Run to the second director and becomes Task Manager.
5. Featured guests join from their invitations' QRs; a lost one gets the
   director's 🔓 (two minutes).

## 6. During the show

| Who | Watches | From |
|---|---|---|
| Second director | Run → Director (the cue sheet; *Calling*), Run → Mind + its Judging card in a second tab, `# hosts` | A laptop in Chrome (which one is open question U5) |
| Hosts | Their host dock in the Play app: the NEXT bar, Cues · Needs · Judge · People · More | Their phones |
| Tech op | `pnpm showctl status --watch 5`; `pnpm showctl terminals --watch`; `showctl log --follow --type signal,beatEntered` when something seems stuck | The MacBook |
| House manager | The door after 20:30, late arrivals (radio ARRIVAL), safety | The front door |

Calling cues: any host may call (📣 *I'll call*). Every console arms first
and fires on the second press. NEXT is empty while a timer owns the night
(hunt 1, hunt 2's hour + the summons, the Y2K hour): nothing to press, the
story runs. A refused press shows ✕ *Not taken* and its reason in `# hosts`.
Prefer the Run page's buttons; `showctl fire` is the fallback when a device
dies.

Rules that hold all night:

- No Restart, Push draft, Go live or End. No Run personas on the live event.
- A server *process* restart is safe: journals replay, every phone, booth,
  console and tablet reconnects by itself (Caddy holds requests for up to
  60 s); anyone mid-reinstallation is scanned in again.
- Never say a code, a combination or a hunt answer near a terminal's 🎤.
- The crew going through the server-room door press 🔧 first (a two-minute
  window), or The Heart plays.
- Keep the Run tab in the foreground (a background tab throttles its chime).

Radio call words: INTRO · BEANS · LATE · IN · DOOR OPEN / DOOR SHUT ·
A / B / WRONG · ALARM · LIGHTS · HOLD · ARRIVAL · **ALL STOP**. Say the call
word, where, who.

**Clippy's dream** (wave 50). On *"…the Y2K BUG."*, about 30 s after 🕚, every
terminal melts into the dream by itself, until an ending. Nothing to press. If a
terminal stays on its old screen it couldn't reach the video (`pnpm showctl
doctor`, *Clippy's dream*); the show goes on. 🌀 **Clippy's dream: on / off**
(Anytime) puts every screen back: use it if the house wifi struggles, or
before something on the TV must read clean (truth.txt, say). A blackout stays
black, and a guest on a line, a board or a walk is never disturbed.

## 7. Emergencies and fixes

**911** for fire, injury or someone unresponsive. The house manager calls
(the tech op if the house manager is hurt). The address, exits and meeting
point are on the emergency card at the door.

**ALL STOP** (anyone can call it):

1. The director fires 💡 **Restore the house lights** (it also holds a
   pending automatic dance until 🪩).
2. Tech op: ■ **Stop house sounds** (the Run header, 🔇 on a host's More →
   House, or the director phone's ☰), mute the TV voice, wall switches on
   (the safety bulbs come back on from a wall switch).
3. The house manager leads people out or to the living room.
4. Nothing restarts until the house manager says it is safe.

**Always true:** the keypad is on the outside only and the inside handle
always opens with no code; nothing in the house can lock anyone in; flashing
stays at or under 3 Hz; no open flames; VR is played seated with a spotter.

| Problem | Do this |
|---|---|
| Trabolta silent ("Jean Trabolta is not responding…") | On the MacBook: `cd stagehand && uv run stagehand launchd restart --job agents`. Meanwhile a director answers as Trabolta from Run (identity → Trabolta); performers say he is processing a high volume of requests. A hung-but-connected worker is slow to post the hold line: answer by hand at once. **Never `pkill -f "stagehand run"`.** |
| No announcements anywhere | On the Desktop: `.\scripts\house-desktop\preflight.ps1` (`health/stagehand`, `health/audio`); restart `show` and the router (`.\scripts\house-desktop\start-stagehand.ps1 -Restart show`, `-Restart audio`); check the broker (`.\scripts\house-desktop\setup-mosquitto.ps1 -Check`). In the router fallback, on the MacBook: `uv run stagehand launchd status --job audio`. |
| Every house sound must stop now | ■ Stop house sounds; or on the Desktop `uv run stagehand sounds stop --announce --config trapped.desktop.yaml` (the fallback: on the MacBook with `--config trapped.macbook.yaml`). It stops the music too, until the next act's music cue. The TV's voice still plays on the speakers: mute it with `M` on the TV page or Run → Terminals |
| The music stopped (after ■ Stop house sounds, or none at all) | On the Desktop: `uv run stagehand music status --config trapped.desktop.yaml`; bring it back with `uv run stagehand music scene <the current act> --config trapped.desktop.yaml` (`doors`, `act_1`, `malware`, `act_2`, `act_3`, `final`, `ceremony`, `afterparty`). A hand scene holds until the next act's cue. `music next` skips a bad track. From the MacBook the same commands take `--config trapped.macbook.yaml` (they go through the Desktop's broker). |
| Trabolta heard twice (an echo in the living room) | Turn the TV's volume down; Chrome's output must be VoiceMeeter Input, not HDMI; every A button off on VoiceMeeter's VAIO strip (`scripts/house-desktop/README.md` §3.5) |
| A howl or a hum on every speaker | Mute the VAIO strip in VoiceMeeter, or untick the TV row (input 3) on the map's Audio tab and Save: the music plays on, but Trabolta is then heard nowhere: meanwhile set Chrome's output back to HDMI (Volume mixer) and turn the TV's volume up. Then `scripts/house-desktop/README.md` §12 (VoiceMeeter's A buttons, CueMix and Windows' *Listen to this device* for a howl) |
| The server-room bulb ignores the story | On the Desktop: `.\scripts\house-desktop\start-stagehand.ps1 -Restart lights`; `.\scripts\house-desktop\zigbee2mqtt.ps1 -Check` (a moved stick has a new COM port) |
| House internet down | Guests turn Wi-Fi off and use cellular. Keep firing cues from Run on a phone hotspot. Stagehand catches the lights up once it reconnects. |
| Server restarted | Nothing to press. Everything reconnects; the server answers 503 `starting` until the events are back. Reinstallation walks end (rescan in the tent). |
| VPS dead | Start the warm standby, restore the newest 10-minute backup from the MacBook (`~/LoomBackups`), repoint DNS. |
| Rain or wind | Switch to the shed on the Run page's House map card (*Tent \| Shed*), or at `/reinstall/map` on a phone. |
| A terminal silent, or red ⛶ | Its Wi-Fi, power, is the page open? Relaunch Chrome with `--kiosk` (TV, laptops) or touch the tablet once. A terminal that loops or loses its camera: hold ⚙ 2 s → View `mirror` (`docs/trapped/kiosk.md` → *The mirror fallback*). |
| The TV silent after a reboot | Click once into the TV page; `M` unmutes. |
| Server Door terminal dead | The director fires ♟ `chess_won` naming the winner (it gives the door code). |
| Door sensor wrong | 🚪 opened / 🚪 closed by hand; later 🚪 *Trust the door sensor again* once it reads right. A door fault: ⚙ on that terminal (calibrate again after a reflash). |
| Patch bay misreads | The watch presses 🔌 💥 or ❌ (or a director the `patch_*` fallback); the story follows the buttons until 🔌 *Trust the patch bay again*. |
| Crew must enter the server room | 🔧 first (a two-minute window). |
| A forgiven wrong patch, or a rehearsal left the room set | 🔄 `reset_server_room`, then 💡 if the house is still red. |
| Keypad dead or jammed | The house manager's override key; prop the door; press 🚪 if The Heart didn't play. |
| Someone talked Trabolta down | `# hosts` says so; the director presses 🕊 (NEXT jumps to it). |
| A guest lost their phone or session | Inspector → 🔁 Re-pair (a single-use QR); a loaner phone. |
| A performer's phone died | ⏏ Release the part; they sign in again on a loaner with the performer code. |
| A late arrival after C1 | Run → Inspector → *scan as Norton* (routes to Clearance). |
| A guest went home | 👋 *Went home* on Run (they leave the majority count). |
| A program needs marking by hand | Run → Director → Tools → fire `mark_for_reinstallation` / `unmark_for_reinstallation` with the program. |
| A device died and its signal must fire | `pnpm showctl fire <signal> --yes --i-know-this-is-live` (e.g. `door_sensor_closed`, `patch_combo_a`, `"chess won" --subject <guest>`); check the spelling in Run → Log. |

## 8. After the show

1. The recap for the ceremony: `pnpm showctl recap --text` (or
   `/e/<event>/api/mod/recap?format=text`), read before the awards.
   Read it **after G1** for Most / Least Trusted (wave 45: G1 takes 5
   trust from every program that never used Bathroom Mode). **G13 🚻 The
   Bathroom Report** reads its own numbers: press it between two awards.
   So does **G14 🔑 The Language Report** (wave 48, 48b: the Password
   Manager's filter, who cursed the most, the top censored words, her ⭐;
   the TV lets every censored word out, slurs only as black bars).
2. Backups: on the VPS `deploy/backup.sh --label show`; Run → Export
   (`loom-run/1`) for the archive; `scripts/ops/showbackup.sh uninstall` on
   the MacBook once the night's copies are safe.
3. **Sun Nov 1: change the mod passcode** and rotate anything printed.
4. **Trabolta's letters, before End** (wave 41; End stops the event and
   the letters go with it). With the MacBook's `agents` job running: Run →
   **Letters** → ✍ Ask Trabolta to write them (on gpt-oss about 20 s a letter,
   so ~15 min for 40; Claude is faster), read every draft (a model pads a thin
   night with made-up detail: cut it), edit or ↻ Rewrite any that miss, then ✉
   Send. Letters run on Claude only, with no fallback: a failed one is written
   again. The card
   says Send is off when the VPS has no `LOOM_RESEND_API_KEY` /
   `LOOM_WEBMASTER_FROM`. Help: `docs/help/authoring/52-letters.md`.
5. **The credits** (wave 44). G11 🎃 rolls them by itself on the TV,
   every wall terminal and every phone, after any ending; G12 🎬 rolls
   them again. The names are the project's `credits.json` (Writing; a
   change shows on the next roll, no reload). Run → 🎬 Credits shows the
   roll as text and any problem with the file.
6. **The video list, before End** (wave 44). Run → 🎥 Video consent →
   ⬇ Download CSV: every program, `out` first. Give it to whoever edits
   the footage. A program who never answered the card did not opt out.
   Help: `docs/help/authoring/53-credits-and-video.md`.
7. End the event; archive the ceremony script, the recap and photos.
8. Teardown: the tent, cords, GFCIs; tablets back to their owners
   (factory-reset borrowed ones); back up Zigbee2MQTT's `data\` on the
   Desktop.
9. A one-hour retro with the crew; the post-party roadmap is
   [`SCHEDULE.md`](./SCHEDULE.md).
