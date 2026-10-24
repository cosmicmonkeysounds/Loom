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

The VPS runs **`w18b-1021`** (wave 18b Stage A + the tent laptop, which
already includes wave 19). Master holds wave 18b Stage B and waves 20, 20b,
21 and 22, all merged and **not shipped**. Verify what runs with
`ssh loom-vps 'tail ~/loom-ops/releases.log'`. Land it in this order:

1. **Decide the sign-off.** Shipping carries every `// DRAFT` line of waves
   18b, 20, 21 and 22 (`history/SIGNOFF-w18b.md`, `history/SIGNOFF-w20.md`,
   `SIGNOFF-w21.md`).
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
5. **Desktop, before the sync:** put the event id and the mod passcode in
   `stagehand\trapped.house.local.yaml` (git-ignored; the tracked file says
   `CHANGE-ME`), `git pull`, then restart the `show` task
   (`.\scripts\house-desktop\start-stagehand.ps1 -Restart show`), so no old
   door rule posts into the new story.
6. **Sync the story, with its reload, before doors:**
   `LOOM_SSH=loom-vps LOOM_PROJECT="trapped in the internet" pnpm sync-show --replace-audio`.
   Add `--replace-lights` if the project already holds a `lights.json`, and
   `--replace-maps` only if the summary says the project's maps differ from
   the repo's (the maps have not changed since `w18b-1021`). Never
   `--no-reload` for these waves: the composition changed. Merge any speaker
   survey saved to the project into the repo's `audio.json` first.
7. **Restart every other non-ended event** (Run → Restart or Push draft).
8. **MacBook, Trabolta:** `git pull`;
   `cd stagehand && uv run stagehand launchd restart --job agents`; then
   Run → Mind → **Reset**. `uv run stagehand check --config laptop.yaml --only agents`
   shows `ctx 20480` and no warning.
9. **MacBook, the sound router** (the default home; see `TECH.md` for the
   Desktop option): retire the old `alexa` job if it was ever installed
   (`scripts/house-macbook/install-alexa.sh --uninstall`). Give the MacBook
   its own secrets: `stagehand/trapped.house.local.yaml` with
   `server: { event, mod_passcode }` (the router reads `server:` from it;
   without it the router dials `CHANGE-ME` and never hears a story
   `sound X`), and `stagehand/trapped.macbook.local.yaml` with
   `server: {}` plus `audio: { mqtt: { password: "<the props password>" } }`
   (a `.local.yaml` with no `server:` mapping fails to load). Then
   `uv run stagehand sounds placeholders`;
   `uv run stagehand check --config trapped.macbook.yaml --only audio`
   (32 in / 30 out, the layout not moved);
   `uv run stagehand launchd install --job audio --config trapped.macbook.yaml`.
10. **MacBook, retire the old house-Mac jobs.** The MacBook *is* the old
    house Mac, so it may still run the `show` and `lights` jobs from
    `trapped.house.yaml`, and its own Mosquitto and Zigbee2MQTT. Two `show`
    jobs fire every cue twice. Once the Desktop's tasks are up and the
    CC2652P has moved: `uv run stagehand launchd uninstall --job show` and
    `uv run stagehand launchd uninstall --job lights` (if installed), stop
    the MacBook's local Mosquitto (`brew services stop mosquitto`) and its
    Zigbee2MQTT LaunchAgent (`launchctl unload
    ~/Library/LaunchAgents/com.mapsandducks.zigbee2mqtt.plist`; see
    `scripts/house-macbook/zigbee.md` §4), then `uv run stagehand launchd status` must list only
    `agents` and `audio`.
11. **Desktop, the lights:** Zigbee2MQTT on the CC2652P (keep any existing
    `data\`), `.\scripts\house-desktop\start-stagehand.ps1` (installs and
    starts the `show` and `lights` tasks; the lights job must run before
    pairing), then pair the bulb as `server_room_rgb` with
    `power_on_behavior: on`, place it on the map editor's 💡 Lights tab,
    💡 Identify, ▶ Test each look, Save to project.
12. **Steph's laptop:** flash the wave 22 firmware from
    `hardware/server-room-m4` (door + patch bay; `LED_STEADY` while the LED
    is on 5V); `scripts/accept/N-20.sh` (the door) and `N-21.sh` (the bay:
    learns V1–V8, then `pb save`); open the terminal once without
    `--kiosk`, grant the camera and the port, **calibrate the door in ⚙**
    (always after a reflash), check the patch bay's live table, relaunch in
    kiosk.
13. **Reload every terminal, the TV and the tent laptop.** Touch each tablet
    once (its 🎤 must not read *tap*).
14. **Quest:** `reinstall/vr/tools/quest.sh build`, then `install`; allow
    the microphone in the lobby.
15. **The keypad:** set by hand to `facts.json` `door.code`; test from
    outside with the code and from inside with the handle and no code.
16. **Door test:** a real open → shut → open shows 🚪 on Run → Terminals
    within a second, with no fault and no *override*; then 🔄
    `reset_server_room` (and 🚪 *Trust the door sensor again* if anyone
    pressed a 🚪).
17. **Reprints after the sign-off:** Clippy, the director and
    second-director packs, the four Antivirus, the hosts, all-crew, the
    patch-bay watch card, the emergency card, Excel's and OpenOffice's
    sheets, every featured card, the Bingo card, and Combo A's two codex
    halves (the bay's layout changed in wave 22, and Combo A with it).

## 2. The morning reset (10:00)

**Pause first.** A restart keeps the doors as it finds them: a Push draft or
Go live on an *open* event plays Power On at once (the combinations, the door
code, the King at 15, the show clock set to 7:00 PM), and a pause afterwards
cannot take it back.

1. **Weather call.** Gusts over 30–40 km/h or steady rain → the shed. Switch
   at `/reinstall/map` (*Map: Tent | Shed*, signed in with the mod code).
2. **⏸ Pause** the preview (Run, or a host's More → Night →
   *⏸ Pause the show*).
3. Sync (`pnpm sync-show`, as in §1 step 6), then **Push draft**.
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
| 19:00 | Everyone | Food and a 15-minute briefing: the blackout rule, the call words (incl. ALL STOP and ARRIVAL), the emergency card, never restart. Tech op on the MacBook: `scripts/ops/showbackup.sh install` |
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

**John's MacBook** (Trabolta, the router, a Run console)

- On the charger, `caffeinate -dims` in a terminal for the night, sleep off.
- Ollama with `OLLAMA_KEEP_ALIVE=-1`; `ollama ps` shows `gpt-oss:20b` alone
  (warm it: `ollama run gpt-oss:20b hi`).
- `cd stagehand && uv run stagehand launchd status`: `agents` and `audio`
  running.
- Run → Mind: worker connected, a *mind · story* chip, Reset; the Judging
  card reads `auto` with nothing pending; Trabolta hidden and asleep.
- Run → House map: the King's row reads 15 / 15 (👑 or Set… only on purpose).
- The MOTU powered and seen; `check --only audio` shows no placeholder left.

**John's Desktop** (the TV, the broker, the lights)

- Power on and let it sign in: Mosquitto (a service), Zigbee2MQTT (a boot
  task), `show` + `lights` (sign-in tasks) and the TV kiosk start by
  themselves.
- `.\scripts\house-desktop\preflight.ps1` passes.
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
2. The morning reset is done: paused first, then sync, Push draft, the door QR scanned on cellular, Go live in place, before any registration; Run → World shows `Kernel.door_code` not yet set; the codes are the printed ones.
3. The map page's *Map:* bar shows Tent or Shed (the 10:00 call) as `● live`, and its status line reads "the project's map".
4. Every machine's preflight is green: `pnpm showctl preflight macbook`, `desktop` (via `preflight.ps1`), `serverroom` and `tent`; `pnpm showctl doctor` shows no red.
5. Trabolta: the worker connected (a *mind · story* chip), the mind Reset, `ollama ps` shows `gpt-oss:20b` alone, the MacBook on its charger; `uv run stagehand check --config laptop.yaml --only agents` shows `ctx 20480` and no warning; he is hidden and asleep.
6. Terminals: every tablet green on `pnpm showctl terminals`, on the idle show, and every wall terminal's ⚙ names Trabolta; the TV on the screensaver, clicked once after its last boot; the Server Door terminal on THE KING.
7. Audio: the `audio` job running with no placeholder left, a 🔈 Test per speaker at show level, one announcement heard through the router (this needs the Desktop's `show` job and broker too).
8. Lights: the server-room bulb answers 💡 Identify and sits on `heart_idle`; `stagehand check --only lights` is green and `health/lights` online; the bulb never drops under 80 / 254. If house Zigbee groups or WLED strips are installed: one `lights_blackout` test (the stairs, bathroom, tent, server room and the path to the living room stay lit).
9. The server-room door: the keypad was set by hand to `facts.json` `door.code` and tested at 15:00, and it opens from inside with no code; the keypad sign hangs beside it; the sensor reads 🚪 shut / open on Run → Terminals within a second, with no fault and no override; then 🔄.
10. The patch bay: all unplugged; ⚙'s live table reads every input empty; Run → Terminals shows no 🔌 fault and the story is not on the buttons (or 🔌 Trust the patch bay again was pressed).
11. The server-room terminal (Steph's laptop) is green and asleep on its screensaver, the M4 on USB, an external keyboard in reach, and the webcam reads a pass in the room's light; Run → Director shows 🔄 reset and 🕊 talked down, and 🕊 Heart autoend is off.
12. The King: Run → House map's King row reads 15 / 15; the Server Door tablet is charging.
13. The tent: the old laptop on spot `tent` with WebGL2, the Quest charged (if go), the Installation Wizard video loaded on the second device, the heater on its GFCI leg, the EXIT sign on.
14. Push: the staff test alert arrived on every performer phone.
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
| No announcements anywhere | On the Desktop: `.\scripts\house-desktop\preflight.ps1` (`health/stagehand`, `health/audio`); restart `show` (`.\scripts\house-desktop\start-stagehand.ps1 -Restart show`); check the broker (`.\scripts\house-desktop\setup-mosquitto.ps1 -Check`). On the MacBook: `uv run stagehand launchd status --job audio`. |
| Every house sound must stop now | ■ Stop house sounds; or on the MacBook `uv run stagehand sounds stop --announce --config trapped.macbook.yaml` |
| The server-room bulb ignores the story | On the Desktop: `.\scripts\house-desktop\start-stagehand.ps1 -Restart lights`; `.\scripts\house-desktop\zigbee2mqtt.ps1 -Check` (a moved stick has a new COM port) |
| House internet down | Guests turn Wi-Fi off and use cellular. Keep firing cues from Run on a phone hotspot. Stagehand catches the lights up once it reconnects. |
| Server restarted | Nothing to press. Everything reconnects; the server answers 503 `starting` until the events are back. Reinstallation walks end (rescan in the tent). |
| VPS dead | Start the warm standby, restore the newest 10-minute backup from the MacBook (`~/LoomBackups`), repoint DNS. |
| Rain or wind | Switch to the shed at `/reinstall/map` (*Map: Tent \| Shed*). |
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
2. Backups: on the VPS `deploy/backup.sh --label show`; Run → Export
   (`loom-run/1`) for the archive; `scripts/ops/showbackup.sh uninstall` on
   the MacBook once the night's copies are safe.
3. **Sun Nov 1: change the mod passcode** and rotate anything printed.
4. End the event; archive the ceremony script, the recap and photos.
5. Teardown: the tent, cords, GFCIs; tablets back to their owners
   (factory-reset borrowed ones); back up Zigbee2MQTT's `data\` on the
   Desktop.
6. A one-hour retro with the crew; the post-party roadmap is
   [`SCHEDULE.md`](./SCHEDULE.md).
