# Acceptance checks (OCT31 waves 1–22)

One check per item of
[`core/examples/trapped-in-the-internet/OCT31.md`](../../core/examples/trapped-in-the-internet/OCT31.md)
§5 (the build history; the night's own runbook is
[`SHOWNIGHT.md`](../../core/examples/trapped-in-the-internet/SHOWNIGHT.md)).
Every wave through 22 is on `master`. Each script runs the desk half itself (HTTP,
MQTT, a build scan) and prints or walks you through the device half. A `.md`
is a written device check, and its `.ts` (where there is one) is the helper
it calls.

**Running them.** `.sh` scripts run directly. `.ts` scripts run with
`node --experimental-strip-types scripts/accept/<id>.ts …` (or
`npx tsx …`). The server is `https://app.mapsandducks.com` unless you pass
`--base`/`--url` or set `BASE`/`LOOM_SERVER`, which is how you point one at
`http://localhost:7000`. Codes come from the Run page, in `MOD_CODE` /
`LOOM_MOD_CODE` / `LOOM_EVENT_CODE` or `--code`, depending on the script
(each header says which).

**Use a rehearsal, never the live show.** Any check that writes to an event
(fires cues, registers probe guests, posts lines) runs a guard first:
`live-guard.ts` (with `guard-cli.ts` / `guard.sh` for bash, and `guard.ts`
for the K-2x helpers). It refuses a roster with real guests unless you pass
`--i-know-this-is-live`, and asks y/N unless you pass `--yes` or the server
is localhost. `node --no-warnings --test scripts/accept/live-guard.test.ts`
tests that guard. The read-only checks (K-16 / K-17 / K-18 / K-29 looks,
K-23, K-26, k10, n02 step 0, `wave4-wallet.sh look` / `device`) can run
anytime.

| Item | Script | What you do |
|---|---|---|
| K-01 | `k01.sh` | Laptop: public join base, invite site, uncompressed SSE (two 25 s pings). Then one phone joins over cellular |
| K-04 (SW-AI-23) | `K-04-burst.ts --code … [--dms 30] [--spread 0]` | The worker on John's MacBook voicing Trabolta, Trabolta introduced: 30 persona DMs at once, the time to each first real reply (the server's hold line and the worker's canned `fallback:` / `unavailable:` lines from `trabolta.persona.md` counted apart — never a PASS), p95 + a `record:` line (guarded; `--reset-after` clears the bots, then Reset the mind). Pure half: `node --no-warnings --test scripts/accept/burst.test.ts` |
| K-05 | `K-05.sh [trapped.house.yaml]` (`MOD_CODE`) | Wave 20: the house rig (stagehand `show` on John's Desktop) + the real door, the server-room terminal on Steph's laptop with the M4 door sensor connected (`door=serial`; run N-20 first). Open the door with the keypad code from outside and by the inside handle: each edge reaches the story as `door_sensor_opened` / `door_sensor_closed` (Run → Terminals 🚪, `Night.server_door`), and stagehand fires **no** door signal any more (D16). Then the patch bay (`M4BAY=1`: the M4 reads the bay and the terminal posts `patch_changed`; run N-21 first; `ESP32=1` is the old scanner, not installed) and the lights |
| K-06 + N-07 | `k06.sh` | An iPhone, an Android phone and an Antivirus booth. Lock both phones, send a `!` alert, and it banners and chimes on wake. The booth banners the alert and the late list (N-07) |
| K-08 | `K-08.sh [nightly\|show]` | The MacBook over ssh to the VPS: a show-night copy, a restore drill into a scratch `loom-drill` project, rollback timing (asks first, restarts the live site twice), the 10-minute backup job |
| K-10 | `k10.sh before` → End + relaunch → `k10.sh after` | The codes survive End → relaunch. Then scan an old QR on cellular |
| K-11 | `K-11.md` + `K-11.ts redeem\|rush [n]` | Wrong-codex throttle (8 × 200, then 429). A door rush from one IP passes with the night's `LOOM_RL_*` |
| K-12 | `K-12.md` | Run → 🖨 Print sheet: join poster, codex posters, room signs (no typed code on a sign). Print one and scan it |
| K-13 | `k13.sh` | iPhone camera scans room-sign QRs: refused while on rails, then checked in after a booth clears the guest |
| K-14 | `K-14.sh [--no-build]` | Builds terminal + reinstall for `chrome87`/`safari14` and scans the bundles. Then the oldest tablet loads both |
| K-15 | `K-15.md` | Fully Kiosk tablet stays awake 2 h on the charger. A short tap on ⚙ does nothing (hold 2 s) |
| K-16 | `K-16.sh [--watch]` | `/api/screen/state` says attract. Time the flip to the face after `introduce_trabolta` (≤ 2 s) |
| K-17 + N-03 | `K-17.sh [--watch\|--fire <event>…]` | Fire cues and watch the TV and terminals layer overlays, slides and the ⏱ corner in the right precedence |
| K-18 + N-04b | `K-18.sh [--watch\|--say\|--beat\|--fire\|--mute]` | TV (`view=tv`) speaks Trabolta's Desktop lines, captions the song beats, honours the mute |
| K-19 | `K-19.sh` | **Opt-in only** (the default is the devices' own voices — it SKIPs with the server voice off): 50 mod SSE streams + 3 concurrent Kokoro syntheses, each sentence < 2 s |
| K-20 | `K-20.sh devices\|check\|install\|announce\|chime\|play\|stop\|story` | The router machine **on macOS** (John's MacBook, now only the router fallback; the Desktop's default router is walked by `scripts/house-desktop/README.md` §7–8 and `preflight.ps1` instead), steps 1–8 through the router (wave 18b, the `audio` job): the 828x, `check --only audio`, the launchd job, an announcement + the chime on both rooms, a story sound, ■ stop, `do announce` from the story |
| K-21 | `K-21.md` | Second director's laptop: the Director cue sheet (LAST / NEXT / ✓, a refused press that ticks nothing, who? picker), agreeing across two editors and a reload |
| K-22 | `K-22.ts --event … --passcode …` | Bytes per step, full mod feed vs `&lean=1`. `--steps N` posts probe lines (guarded) |
| K-23 | `K-23.md` + `K-23.ts` | DM Trabolta hunt answers from a phone. The helper checks none reached `learned` and the trace shows suppressions |
| K-24 + N-05 | `K-24.md` + `K-24.ts setup\|check` | iPhone files a 📝 fact (true and confident lie). Check the score, `Kernel.lies_accepted` and the `# hosts` lines |
| K-25 | `K-25.md` + `K-25.ts end\|start\|award\|…` | Run the awards ceremony for each ending's host on 3 phones + the TV |
| K-26 | `K-26.md` + `K-26.ts [--json]` | `/api/mod/recap` text in < 1 s, lists match the run (read-only) |
| K-27 + N-06 | `K-27.md` + `K-27.ts setup\|persona\|chess\|door\|shut\|trust\|wrong\|reset\|stay\|leave\|room\|visit\|watch` | Bench door (keypad lock + the M4's LED / LDR sensor, or `door=sim`): a chess win puts *The Door Code* in the winner's Codex, the keypad opens with it, the first opening plays The Heart and waits for the door to be shut (`door` / `shut` post the sensor's `door_sensor_opened` / `door_sensor_closed`; 🚪 on Run sets `door_override`, `trust` clears it), a scan docks the four layers, the patch bay alarms only on the second wrong combination, 🔄 seals the heart again; N-06 the forced majorities |
| K-29 | `K-29.sh [--watch\|--fake <name>]` | Run page Terminals card: every tablet + the TV green, a silent one red + chime after 20 s |
| K-30 | `K-30.sh` | Export and sideload two Quest APKs, each station polls the VPS, a captured program walks to Gerald → `released: true` |
| K-31a | `k31a.sh` | VAPID keys set: 2 locked Android phones on cellular get a `!` alert and a Trabolta DM as notifications (no duplicate in the foreground); a locked Antivirus booth gets the server-room alarm |
| K-31b | `k31b.sh` | `LOOM_HOMESCREEN=on` + VAPID keys: an iPhone (16.4+) guest adds the app to the Home Screen from the 🔔 card and the icon opens as the same program; locked on cellular it gets a `!` alert and a Trabolta DM; an iPhone booth signs in from its icon and gets the server-room alarm |
| K-32 | `k32-load.ts --code …` | VPS load test (45 guests, 9 booths, 6 terminals, 2 directors, bursts): step latency + `/api/mod/metrics` CPU + each director console ≤ 1 Mbit/s (the LTE failover budget; delta consoles by default, `--full-directors` for the old whole-view stream) (guarded) |
| N-01 | `n01.sh` | 10 pass QRs on screen. An iPhone booth (jsQR) and an Android booth scan 10/10 hands-free |
| N-02 + N-10 | `n02.sh` | Re-pair a wiped phone from Inspector → 🔁 Re-pair (< 30 s, same Person). Release a booth's part and re-sign on a loaner |
| N-08 | `N-08.sh [port]` | **Not installed for Oct 31.** The ESP32 box on the bench: flash, the 2×12 patch scan, ring + siren over MQTT (`:1884` as `props`). Wave 20 retired its door steps: the door is the M4's (N-20, D16) |
| N-20 | `N-20.sh [/dev/cu.usbmodem…]` | Wave 20: the laptop the Grand Central M4 is plugged into, the LED + LDR (in its shroud) across the real door. Records lit / dark / level in `mod` and `steady`, shut and open, room lights on and off; finds the settle a CdS cell needs; proposes `mode`, `settle`, `close`, `open` and offers to `set` + `save` them; then one real opening and closing. Serial only (close the Arduino IDE's monitor and the terminal page first) |
| N-21 | `N-21.sh [port]` (Windows: `N-21.sh COM5` in Git Bash, needs pyserial) | Wave 22: the laptop the M4 is plugged into, the patch panel wired to it and one patch cable. Prompts in the panel's own jack names. Checks the empty bay, learns the four sources one cable at a time (`pb learn`), checks they climb in order and sit apart, walks a source through every input, prints the readings and offers `pb save`. Never names a combination. Serial only |
| N-11 | `N-11.md` + `N-11.ts --guest …` | Worker stopped: a DM to Trabolta gets the story's `hold:` line once, ~20 s later |
| Wave 4 wallet (C·5) | `wave4-wallet.sh run\|look\|device` (`MOD_CODE` + `EVENT_CODE` + `PRIME_CODE`) | Two guest phones + the CRA Agent Software booth: three sends (the held one waits for Approve), a deny inside 60 s, a request, a Runescape stimulus, a codex trade (`run` is guarded; `look` and `device` are read-only) |
| Wave 28 full evening | `../sim/evening.ts --base … --code … [--ending heart\|verdict\|destroyed] [--lie] [--pace ms] [--watch]` (`pnpm sim`; see [`scripts/sim/README.md`](../sim/README.md)) | No devices: 12 guest bots, the 8 booths, the director's whole cue chain (`chains.ts`, through each ending and the ceremony) and a heart bot at the server-room terminal play a night on a scratch server or a rehearsal; a green / red line per beat, a summary table, exit 1 on any red (guarded; `--reset-before` / `--reset-after` on a scratch server only; `--base` required, :7000 still asks). `browser.spec.ts` screenshots the director phone, the heart terminal and the TV per beat |
