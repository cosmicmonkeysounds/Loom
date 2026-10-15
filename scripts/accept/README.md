# Acceptance checks (OCT31 wave 1)

One check per item of
[`core/examples/trapped-in-the-internet/OCT31.md`](../../core/examples/trapped-in-the-internet/OCT31.md)
§5. Every item is on `master`. Each script runs the desk half itself (HTTP,
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
K-23, K-26, k10, n02 step 0) can run anytime.

| Item | Script | What you do |
|---|---|---|
| K-01 | `k01.sh` | Laptop: public join base, invite site, uncompressed SSE (two 25 s pings). Then one phone joins over cellular |
| K-05 | `K-05.sh` | House Mac, rig powered: touch the reed, patch the bay, watch the lights. Checks stagehand's log, MQTT, the static IP and the launchd jobs |
| K-06 + N-07 | `k06.sh` | An iPhone, an Android phone and an Antivirus booth. Lock both phones, send a `!` alert, and it banners and chimes on wake. The booth banners the alert and the late list (N-07) |
| K-08 | `K-08.sh [nightly\|show]` | House Mac over ssh: a show-night copy, a restore drill into a scratch `loom-drill` project, rollback timing (asks first, restarts the live site twice), the 10-minute backup job |
| K-10 | `k10.sh before` → End + relaunch → `k10.sh after` | The codes survive End → relaunch. Then scan an old QR on cellular |
| K-11 | `K-11.md` + `K-11.ts redeem\|rush [n]` | Wrong-codex throttle (8 × 200, then 429). A door rush from one IP passes with the night's `LOOM_RL_*` |
| K-12 | `K-12.md` | Run → 🖨 Print sheet: join poster, codex posters, room signs (no typed code on a sign). Print one and scan it |
| K-13 | `k13.sh` | iPhone camera scans room-sign QRs: refused while on rails, then checked in after a booth clears the guest |
| K-14 | `K-14.sh [--no-build]` | Builds terminal + reinstall for `chrome87`/`safari14` and scans the bundles. Then the oldest tablet loads both |
| K-15 | `K-15.md` | Fully Kiosk tablet stays awake 2 h on the charger. A short tap on ⚙ does nothing (hold 2 s) |
| K-16 | `K-16.sh [--watch]` | `/api/screen/state` says attract. Time the flip to the face after `introduce_trabolta` (≤ 2 s) |
| K-17 + N-03 | `K-17.sh [--watch\|--fire <event>…]` | Fire cues and watch the TV and terminals layer overlays, slides and the ⏱ corner in the right precedence |
| K-18 + N-04b | `K-18.sh [--watch\|--say\|--beat\|--fire\|--mute]` | TV (`view=tv`) speaks Trabolta's Desktop lines, captions the song beats, honours the mute |
| K-19 | `K-19.sh` | 50 mod SSE streams + 3 concurrent Kokoro syntheses: each sentence < 2 s (before doors) |
| K-20 | `K-20.sh devices\|local\|offline\|install\|mqtt\|chime\|story` | House Mac, steps 1–7: MOTU device, chime + voice on both zones, the `say` fallback, the launchd agent, `do announce` from the story |
| K-21 | `K-21.md` | Second director's laptop: the Director cue sheet (LAST / NEXT / ✓, who? picker), agreeing across two editors and a reload |
| K-22 | `K-22.ts --event … --passcode …` | Bytes per step, full mod feed vs `&lean=1`. `--steps N` posts probe lines (guarded) |
| K-23 | `K-23.md` + `K-23.ts` | DM Trabolta hunt answers from a phone. The helper checks none reached `learned` and the trace shows suppressions |
| K-24 + N-05 | `K-24.md` + `K-24.ts setup\|check` | iPhone files a 📝 fact (true and confident lie). Check the score, `Kernel.lies_accepted` and the `# hosts` lines |
| K-25 | `K-25.md` + `K-25.ts end\|start\|award\|…` | Run the awards ceremony for each ending's host on 3 phones + the TV |
| K-26 | `K-26.md` + `K-26.ts [--json]` | `/api/mod/recap` text in < 1 s, lists match the run (read-only) |
| K-27 + N-06 | `K-27.md` + `K-27.ts setup\|chess\|rearm\|stay\|leave` | Bench reed: the Cold Lock arms, ♟ opens the 90 s window, re-arm, forced majorities |
| K-29 | `K-29.sh [--watch\|--fake <name>]` | Run page Terminals card: every tablet + the TV green, a silent one red + chime after 20 s |
| K-30 | `K-30.sh` | Export and sideload two Quest APKs, each station polls the VPS, a captured program walks to Gerald → `released: true` |
| K-31a | `k31a.sh` | VAPID keys set: 2 locked Android phones on cellular get a `!` alert and a Trabolta DM as notifications (no duplicate in the foreground); a locked Antivirus booth gets the door alarm |
| K-32 | `k32-load.ts --code …` | VPS load test (45 guests, 9 booths, 6 terminals, 2 directors, bursts): step latency + `/api/mod/metrics` CPU (guarded) |
| N-01 | `n01.sh` | 10 pass QRs on screen. An iPhone booth (jsQR) and an Android booth scan 10/10 hands-free |
| N-02 + N-10 | `n02.sh` | Re-pair a wiped phone from Inspector → 🔁 Re-pair (< 30 s, same Person). Release a booth's part and re-sign on a loaner |
| N-08 | `N-08.sh [port]` | House Mac, box on the bench: flash, reed + tape, the 2×12 patch scan, ring + siren over MQTT (`:1884` as `props`) |
| N-11 | `N-11.md` + `N-11.ts --guest …` | Worker stopped: a DM to Trabolta gets the story's `hold:` line once, ~20 s later |
