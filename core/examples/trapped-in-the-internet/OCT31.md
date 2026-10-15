# Trapped in the Internet: the Oct 31 crunch plan

**The party is Saturday, October 31, 2026. Today is Thursday, October 15: 16 calendar days.**
This is the **active plan**. [`SCHEDULE.md`](./SCHEDULE.md) is the full roadmap (245.5 dev-days) for
after the party and the next run. [`CHECKLIST.md`](./CHECKLIST.md) tags every item 🎃 (in for Oct 31),
🩹 (runs on a workaround below), ⭐ (optional) or 💤 (after). The story spec is
[`DESIGN.md`](./DESIGN.md) (§7 has the workarounds the story already uses), and the runbook + cue sheet
is [`README.md`](./README.md).

> **The scope rule.** A feature is in for Oct 31 only if it is **merged and verified on a real device
> (a real phone, tablet or the TV computer, over the VPS) by Tue Oct 27, 18:00**. Anything that isn't
> is **cut to its fallback or workaround, never half-shipped**: revert it or leave it switched off.
> After Oct 27: fixes only. After Oct 30: no code at all.

Built 2026-10-15 from three passes: a triage of all 67 WPs, a hardware and production plan for Halifax,
and a show-runner walk-through of the whole night against this scope. Decisions applied: #25 yes (push to
phones; wall tablets, the TV and the chess phone send a heartbeat that alerts the director instead). #33
yes (a DM lie counts only when filed through a "📝 File a fact" card). Spec sign-offs #1–#12 are all
approved. #28 is answered: Sandy is **lore only** (her codex entries + her one line inside the song tracks), with an **optional cutscene** (a short pre-rendered video on the TV, P2) — no prop, no live voice. Owner: `@__`.

**Revised the same evening after two critic passes** (a capacity review checked against the code, and a
show-safety review of the night). Changes:

- **Estimates corrected.** K-31 is split into K-31a (Android + booths) and K-31b (iPhone, conditional). K-16, N-08 and K-28 went up. K-13 went down.
- **New items.** K-32 (VPS load test), N-10 (release a performer's part), and safety edits inside K-05 and K-08.
- **Story rule fixed.** The old "never Push draft after 10-25" rule would have shipped the 10-25 story. It is replaced by evening syncs and a morning-of Push draft (§3).
- **Show-safety fixes.** The blackout no longer reaches the stairs or the server-room route. The maglock rules are deleted. Strobe presets drop to ≤ 3 Hz. The chess AI is set so it can be beaten.
- **Crew and procedures.** A house manager, an `ALL STOP` call word, and procedures for late arrivals and lost performers.

One new decision is open: **#35**, whether Trabolta may fall back to a hosted model (§12).

---

## 1. On one screen

| | |
|---|---|
| **New software** | **29.6 lane-days scheduled.** That is **27.6 committed** plus **2.0 conditional** (K-31b, iPhone push, built only if K-31a is green on 10-21). Breakdown: MUST 7.0, CHEAP-WIN 20.6 (incl. K-31a, N-10, D-01), K-31b 2.0. **Committed × 1.25 buffer ≈ 34.5**, inside the 30–35 target. If K-31b ships, the total with buffer is ≈ 37.0, and it takes half the buffer. The real buffer is **about 2.5 calendar days** (10-24, 10-26 and the morning of 10-27; 10-25 is the run-through). Your evening merge review limits it, not lane count. |
| **Lanes** (Claude Code worktrees, merged daily in the order **B → A → C → D**) | **A** story + agent 7.35 · **B** platform + play + push 7.75 (5.75 without K-31b) · **C** terminals + TV 7.0 · **D** house rig + tent + deploy 7.5. No lane does more than 1.0 lane-day on any day. **Every committed item lands by Fri Oct 23.** |
| **Your capacity** (the real limit) | About 25 device checks plus 4 merges every evening, on days that also carry 4–8 h of hardware. So: **a fixed evening "device hour"**. Each item ships a scripted acceptance check (Playwright mobile, curl, or `scripts/accept/<id>`), and your hands-on part on a device takes ≤ 10 min. |
| **Optional, only on slack** | N-09 terminals speak Alexa's lines (0.5; build it if push is no-go on 10-24) · N-11 the hub posts Trabolta's hold line when no worker is online (0.25) · N-12 the TV calls Kokoro on the TV Mac (0.25; if K-19 misses its acceptance) · N-04a TV plays slide MP4s (0.25) · S3 guest in-app scanner · S4 codex/quest grant buttons. **Dropped:** S2 chess puzzles (Lichess + K-27 cover chess). A cue-only phone view (+0.25) is not built; the radio is the phone fallback. |
| **IN** (§5) | Public HTTPS on the VPS · pinned codes · `!` alerts that actually land, booths included · **push to phones** (Android + booths, iPhone if K-31b passes) · iPhone performer scanner · re-pair a lost guest · **release a lost performer's part** · room check-in by QR · print page · Trabolta live, hidden until introduced, hunt answers kept secret · **File a fact** (DM lies count) · terminal attract mode, overlays, PNG slides, countdowns, heartbeat · **the TV as Trabolta's face and voice** (Kokoro on the VPS) · Alexa through the house speakers · cue sheet · lean mod stream · **VPS load test before the freeze** · house rig link (door reed, patch bay, lights), **with a safe blackout and no lock rules** · chess disarm story · manual majority cues · ceremony as story beats + live recap numbers · measured `house.json` · Quest APK (time-boxed) · freeze, pinned deploy, show-night backups, warm standby |
| **WORKAROUNDS** (§9, 34 workarounds + 21 night-of procedures) | Featured claims (trust at the door) · room-audio router (QLab routing) · media pipeline (local files) · fancy templates (PNG slides) · Trust Chart board · songs (QLab) · tent ↔ shed (copy a file) · ceremony tab + AI writer (cast-thread trick) · chess app (Lichess) · Truthcoin (host buttons) · phase map (set stage by hand) · tech rail (eyes) · timers (watchers) · INTERACTION 2.0 · scoped device tokens · badges · Bathroom Mode · reload-keep-run (never restart) |
| **AFTER** | AWARD declaration · Run → Devices · map underlay + structural editor · chess engine package · Run → Screens · every P2 |
| **Hardware + production** | About **$2,200–3,000 CAD** for essentials. That includes ≈ $600–800 of safety and resilience items: a spare Zigbee dongle, radios with earpieces, power banks, battery path lights, a GFCI tester, 12 AWG cords, an HDMI adapter and tethering data. Not included: a Mac mini if there's no TV computer, 0–3 gap-filler tablets, and the QLab licence (**buy it now**). **Order tonight** (§7). Hardware freeze Tue Oct 27. |
| **Gates** | **Oct 18** VPS + HTTPS + story live · **Oct 20** tablet gate + crew named · **Oct 21** Android push · **Oct 22** all MUST merged + hardware bench + Quest call · **Oct 23** every committed item merged + VPS load test · **Oct 24 12:00** push call + print-2 content lock · **Oct 25** first full run-through with friends · **Oct 27** feature + hardware freeze · **Oct 28** tech · **Oct 29** dress · **Oct 30** code freeze, pinned deploy, warm standby, set-up · **Oct 31** sync + Push draft + Go live in the morning, show at night · **Nov 1** wrap |

---

## 2. Gates

| Date | Gate | Proven by | If it fails |
|---|---|---|---|
| **Fri 10-16** | G0-lite: invite site live on the apex, **invitations and the 9 featured sheets sent** | An email link opens the invite site on cellular | Send the invitations anyway, with the plain site URL |
| **Sun 10-18** | **VPS + HTTPS + the story live on the public preview** (K-01) | A phone **on cellular** scans the Run join QR, registers, and plays the Mud Room. `curl -N` shows the 25 s ping on time. The uptime check pages your phone **and the tech op's**. Avatars filled. The story reached the VPS through `sync-example` (SSH tunnel) | Nothing else can be verified. Lane B drops everything until it's green |
| Tue 10-20 | **Tablet gate + crew.** Second director, tech operator and **house manager** named (OP-15). The second director has a VPS account and is a **project member**. Old tablets tagged (K-02); K-14 + K-16 checked on the oldest tablet. Content signed off (done: #12) | Names on the cheat-sheets; the HW-SCR-08 table filled; the oldest tablet shows attract with no console error | Buy gap-filler tablets now (L-15) |
| Wed 10-21 | Test sheet scans on cellular (K-07) · **Android push** (K-31a) | Every code type scans on an iPhone **and** an Android with Wi-Fi off. 2 locked Androids on cellular get an `!` alert + a Trabolta DM | Fix before print batch 1. K-31a red → K-31b is not started; lane B fixes K-31a, and N-09 becomes likely |
| **Thu 10-22** | **All MUST merged** (K-01…K-08, N-01; K-32 lands 10-23). **Hardware bench H1**: door reed + 2×12 patch bay → stagehand → story (HW-PATCH-07), **including K-27's 90 s chess window on the bench reed**. **Blackout rehearsal.** Strobe presets timed with a stopwatch. **Quest go/no-go** (final call; the lane-D time-box ended 10-20) | Each MUST's acceptance line ticked in §5. Each combo fires exactly once. Blackout < 0.5 s with **the stairs, bathroom, tent, server room and the server-room → living-room path still lit**. Every flashing preset ≤ 3 Hz | Unfinished MUST → it takes the buffer days of every lane. Bench fails → W-31/W-32 (Tier 0). Quest no-go → W-33 (+ 2 WebGL2 tablets, L-15) |
| Fri 10-23 | **Every committed item merged.** **VPS load test** (K-32). Z2M restore onto the spare dongle | K-32: p95 step latency < 1 s and CPU < 70% with ≈ 62 clients. The spare coordinator comes up with every bulb | K-32 fails → snapshot coalescing in the 10-24 buffer. Restore fails → wall switches are the night fallback |
| **Sat 10-24, 12:00** | **Push call** (K-31b): 2 iPhones (Home Screen) + 2 Androids, locked, on cellular. Same time as the **print-batch-2 content lock** | A notification for an `!` alert and a Trabolta DM on all four; the Safari session still works | iPhone fails → push is Android + booths only. All fail → W-11, and lane C builds N-09 that afternoon. The door sign (printed 10-26) is worded to match |
| **Sun 10-25** | **First full run-through with friends on the live preview** (afternoon read-through, evening run). Chess AI tuned so a casual player wins in ≈ 10 min | Every act from doors to ceremony, with real phones, the tablets that are in hand, the TV computer and Trabolta's worker. A fix list by midnight | Anything that breaks and can't be fixed by 10-27 goes down the cut order (§13) |
| **Tue 10-27** | **Feature freeze + hardware freeze, 18:00**: every CHEAP-WIN merged and verified on a device | §5 acceptance lines | Cut to the fallback. No exceptions |
| **Wed 10-28** | **Tech rehearsal in the house**, one subsystem at a time, all hardware, **including pulling the WAN cable** and **the backup-Mac swap**. Rechecks only (door window, real reed, on-site Wi-Fi load HW-NET-05) | The tech checklist in §4 (10-28 row) | Fix list, fixes only |
| **Thu 10-29** | **Dress rehearsal**: the whole story, performers + 3–5 friends as guests; tent ↔ shed drill; the weather call | Ends in a ceremony; shed move < 15 min | Last fixes |
| **Fri 10-30** | **Code freeze**, pinned image `loom:show-1031`, backup + restore check, **warm standby VPS** built from a provider snapshot and left stopped, set-up, safety walk | K-08 checklist; safety one-pager | Roll back to the previous tag |
| **Sat 10-31** | **Morning: sync + Push draft + check, then Go live in place** (before anyone registers). **Show** at night (call times §11) | The door QR on cellular lands on the live event running the frozen story | Risk register (§12) |
| **Sun 11-01** | **Wrap** (§14) | | |

---

## 3. How the lanes run

- One lane = one Claude Code session in its own git worktree, one package context, **merged to `master` every evening** after you review it. Every item ends with its acceptance check **on a real device against the VPS**, not only `vitest`.
- Lanes keep running the suites (`pnpm -r test`, `uv run pytest`, `loomcheck --smoke`) before each merge. Lane D owns the deploy, so it redeploys the VPS after each evening merge.
- **You** review, run the device checks, and run the hardware and production lane (§8) with friends. If four lanes are too many to review, fold lane D into C after 10-20: the Quest and the rig bench mostly wait on hardware anyway.
- **The device hour.** Every evening, one fixed hour for device checks. Each item ships a scripted acceptance check (Playwright mobile, `curl`, or `scripts/accept/<id>`), so your part on the device is ≤ 10 minutes. Lane D's checks all need your hands (K-02, K-03, the K-30 sideload, the K-05 bench, K-28 data entry), so lane D gets code-only work on your heavy hardware days (10-17, 10-18). The 10-22 bench is the one exception, since it is the gate.
- **Merge conflicts.** `core/server/event-runtime.ts` (≈ 3,000 lines) is touched by K-11, K-13, N-02, N-10, K-31a/b, K-16, K-18, K-22, K-26 and K-29: all four lanes. The editor's Run/Director/Inspector code is touched by K-12, K-21, K-06, N-02, N-10 and K-29. So:
  - each feature's routes live in their own `core/server/routes/<id>.ts`, with a one-line dispatch in `event-runtime.ts`;
  - the evening merge order is fixed at **B → A → C → D**, and each lane rebases before handing in.
- **Getting the story onto the VPS.** `core/scripts/sync-example.ts` runs with `DATABASE_URL` over an SSH tunnel to the VPS's Postgres and `--server https://app.<domain>`. Lane B wraps it as one script (`scripts/sync-show.sh`) on 10-16 as part of K-01, and lane D runs it after each evening merge.
- **The show runs the story you Push, not the one you write.** Go live restarts from the running snapshot (`events-api.ts:216`, `runtime.restart(undefined, …)`), so a fix that was never pushed never reaches guests. The rule:
  - **Evenings, 10-16 → 10-30:** after the merge, sync + **Push draft** on the preview (lane D). It wipes rehearsal guests only. Performers re-sign after Go live anyway.
  - **Never during a run-through, the tech or the dress** while friends are playing (OP-03).
  - **Morning of 10-31:** sync, Push draft, check the door QR on cellular, then **Go live in place**, all before anyone registers (W-01).
  - **After doors:** never Restart, Push draft, Go live or End.

---

## 4. Day by day, Oct 15 → Nov 1

Item ids are in §5 (scope + acceptance). "✔" marks what must be checked on a device that day.

| Day | Lane A: story + agent | Lane B: platform + play + push | Lane C: terminals + TV | Lane D: house rig + tent + deploy | You + friends | Gate |
|---|---|---|---|---|---|---|
| **Thu 10-15** | **D-01** invitation text + 9 featured sheets (for your OK tonight) | **K-01** start: VPS (8 vCPU / 16 GB for the party month, since Kokoro shares it), compose, `joinBase` fix, DNS TTL 300 s | *(starts 10-16)* | **K-30** toolchain: JDK 17, Android SDK, Godot 4.7 export templates, OpenXR plugin, keystore | **60-min inventory** I-1…I-9 (§7) → **Digi-Key + Amazon orders**; **QLab licence bought**; Meta developer org + dev mode; save-the-dates; ask for old tablets, phones, a dead printer, parts, trophies; ask someone to be McAfee; **ask someone to be house manager** | Orders placed |
| **Fri 10-16** | **K-24** File a fact (day 1) | **K-01** finish: HTTPS, invite site on the apex, `sync-show.sh`, ✔ cellular join · **K-10** | **K-14** compat · **K-15** kiosk (device check moves to the 10-20 tablet gate) | **N-08** server-room firmware (door + 2×12 scan **+ boot baseline for a normalled bay**; no hardware needed) | **Invitations + featured sheets out**; Bayers Lake run (§7d); TV computer: macOS update, never-sleep, **static IP**, Mosquitto, Z2M; QLab installed; bench tablets as they arrive (K-02) | Invitations sent |
| **Sat 10-17** | **K-24 + N-05** finish ✔ on an iPhone · **K-27** | **N-01** ✔ iPhone booth scans · **K-06** | **K-19** Kokoro on VPS · **K-16** start | **K-05** YAML: reed, indicator, safety groups, per-device WLED offs, maglock rules deleted, retain/edge (code only) | **House + shed measurement + mobile-signal walk** (afternoon, 3 h, with a friend); Zigbee dongle → pair bulbs; router SSIDs + channels; battery path lights in. *Breadboarding waits for Digi-Key (most likely Mon 10-19)* | Map data captured |
| **Sun 10-18** | **N-06** · **K-11** (+ env-configurable IP limits) | **N-07** ✔ screen-off alert on iPhone + Android (with K-06) · **K-13** ✔ with a hand-made QR | **K-16** | **K-08** scripts: pre-deploy, tag + rollback, nightly backup, **show-night 10-min off-box job** (code only) | `house.json` data entry (+ `house.shed.json`); **WebMD shoot** (Julia + MEDIA); **patch-bay soldering** (SPARKS, 3–4 h, the bay side); McAfee cast, or cut | **Oct 18: VPS + HTTPS + story live** |
| Mon 10-19 | **K-23 · K-12** (QRs rendered in the browser) | **N-02 + N-10** ✔ re-pair a guest, release a booth · **K-31a** start | **K-17** | **K-30** APK + sideload (evening, you) · **K-05** launchd jobs + WAN reconnect | **Digi-Key lands** → breadboard ESP32 + reed + MCP23017; patch-bay scan → MQTT; Z2M groups (safety bulbs out of `house`, `power_on_behavior: on`); copper-tape fallback on the door; MEDIA edits WebMD | |
| Tue 10-20 | **K-21** cue sheet ✔ second director fires from a laptop · **K-07** sheet assembled from K-12 | **K-31a** | **N-03** · **K-18** start ✔ K-17 V1→V3 + hunt slide on the TV (missing PNGs show a Win98 text card) | **K-03** ✔ tent tablet duck · **K-30** ✔ duck found on the VPS over HTTPS (**time-box ends**) | **Tablet gate** (K-02 tags; K-14 + K-16 on the oldest tablet); WLED flashed + presets rebuilt ≤ 3 Hz; gap-filler tablets if < 4 pass; **second director, tech operator, house manager named**; second director added as a project member | Tablets + crew |
| Wed 10-21 | **K-04** ✔ Trabolta live + 30-DM burst · ✔ **K-07** test sheet on cellular | **K-31a** ✔ 2 Androids locked on cellular → **K-31b** go/no-go → K-31b start | **K-18 + N-04b** finish ✔ TV speaks, songs silent | **K-28** ✔ both variants + `test:vr` · **K-08** ✔ restore drill | Speaker runs Z1/Z2, audio walk, QLab routing check (SP-3); Fully Kiosk provisioning (**autoplay audio on, voice tested inside Fully**); WebMD final file | Test sheet + Android push |
| **Thu 10-22** | **K-25** ceremony beats | **K-31b** iPhone Home Screen + resume nonce | **K-29** ✔ heartbeat card | **K-05** ✔ bench with the real reed + bay (HW-PATCH-07) + K-27's 90 s window · **K-22** | **Bench gate H1**; **blackout rehearsal** (stairs + server-room path lit); **strobe stopwatch test**; **Quest go/no-go**; **print batch 1** (codex posters, clue QRs, check-in signs) | **Oct 22: all MUST merged** |
| Fri 10-23 | **K-26** recap · ✔ K-25 (the TV speaks the award lines) | **K-31b** ✔ 2 iPhones (Home Screen) locked on cellular | **K-20** ✔ Alexa on Z1/Z2 | **K-32** ✔ load test on the VPS | WAN failover test (switch-over time); 8 Z2M scenes; **Z2M `data/` backup → restore onto the spare dongle**; chess phone with Lichess at level 2–3; **RSVPs close**; MEDIA: Trabolta vocals | **Oct 23: all committed merged** |
| Sat 10-24 | Buffer: integration on the preview; **D-01** performer packs + cheat-sheets | Buffer · **12:00 push call** | Buffer · N-09 if push no-go · N-12 if K-19 failed | Buffer; coalescing fix if K-32 failed; redeploy + evening sync / Push draft | **12:00 content lock for print batch 2**; tent test pitch, power, Wi-Fi in tent + shed; **breaker map + GFCI tester**; **build day**: the Tube (FR fabric/spray), bean printer, Truth Pong, bobbing; clue-props crafting party; patch-bay feedback + labels | **Push call** |
| **Sun 10-25** | Support the run; triage the fix list | Support; staff phones subscribed to push | Support; tablets on the walls they'll use | Support; watch the VPS; sync + Push draft **after** the run | **Performer read-through + phone set-up** (afternoon, 2 h); chess AI tuning; **full run-through with friends** (evening); MEDIA: songs final, sfx pack, loops, pre-rendered voice files; PEAT check on finished media | **Oct 25: run-through** |
| Mon 10-26 | Fix list | Fix list | Fix list | Fix list; redeploy; evening sync + Push draft | **Print batch 2** at Staples (door sign, Bingo cards, hat slips, cast + cheat-sheets incl. the **emergency card**, check-in reprints); load media onto the TV computer **and the backup Mac** + QLab cue list | |
| **Tue 10-27** | Fixes → **18:00 freeze** | Fixes → freeze | Fixes → freeze | Fixes → freeze; tag `rc-1027`; sync + Push draft | **Install day**: mount tablets, tape every run, lights + WLED final, the real reed on the door, patch bay in the server room (gear out of reach, taped off), chess phone mounted; battery path lights placed; laminate; truth.txt | **Oct 27: feature + hardware freeze** |
| **Wed 10-28** | Fixes only | Fixes only | Fixes only | Fixes only; sync + Push draft after the tech | **Tech rehearsal** in the house: phones on cellular · each tablet · TV voice + slides (reboot → one click) · each audio zone · door + alarm + chess window (recheck) · patch bay A/B · blackout with a stopwatch · `ALL STOP` drill · Quest/tablet tent · WAN-cable pull (time the recovery) · backup-Mac swap · on-site Wi-Fi load (HW-NET-05) | Tech done |
| **Thu 10-29** | Fixes only | Fixes only | Fixes only | Fixes only; sync + Push draft after the dress | **Dress rehearsal** with every performer + 3–5 friends; **tent ↔ shed drill**; **tent/shed call from the forecast** | Dress done |
| **Fri 10-30** | — | — | — | **Code freeze**: `loom:show-1031` pinned + previous image kept; backup + restore check; **warm standby VPS** from a provider snapshot, stopped; last evening sync + Push draft | Set-up: hide clue props (photo each), hang posters, pitch the tent or set up the shed, charge everything; **safety walk** (§11) | Show-ready |
| **Sat 10-31** | — | — | — | Morning: sync + Push draft + check → **Go live**; show-night backups every 10 min | **Show** (call times §11) | |
| Sun 11-01 | — | — | — | Backups, Run export, journal archive | **Wrap** (§14) | |

---

## 5. The build list (what actually gets built)

Each line: lane · lane-days · done by · the minimal scope (anything not named is out) · **the acceptance check on a real device**. The checklist items each closes are tagged `🎃 <id>` in CHECKLIST.md.

### MUST (7.0 lane-days; N-07 counts with the N folds under CHEAP-WIN): without it the night breaks or is unsafe

| Id | What | Lane · days · by | Minimal scope | Acceptance on a real device |
|---|---|---|---|---|
| **K-01** | Go public on the VPS | B · 1.25 · **Fri 10-16** | `docker compose up` with `SITE_ADDRESS=app.<domain>`, `INVITE_ADDRESS=<apex>`, `LOOM_BASE_URL`. VPS **8 vCPU / 16 GB for the party month** (Kokoro shares it; else ≥ 4 dedicated vCPU + a second small VPS for Kokoro). **`joinBase()` returns `BASE_URL` when `LOOM_BASE_URL` is set** (`core/server/server.ts:147`, one line + a unit test; fixes the Run join QR and `/api/mod/codes`). Caddy: move `encode gzip zstd` into the `/edit*` handle so SSE isn't buffered. **`scripts/sync-show.sh`**: `sync-example` with `DATABASE_URL` over an SSH tunnel + `--server https://app.<domain>`. Launch the preview, check `pictures/` filled. A free uptime check that pages **your phone, the tech op's and the second director's**. DNS TTL 300 s | An iPhone on cellular scans the Run join QR → `https://app.<domain>` → registers and plays the Mud Room; `curl -N` sees each 25 s ping on time; stopping the container pages you |
| **K-02** | Old-Android bench | D (you) · 0.25 · rolling → **10-20 tablet gate** | Per tablet: Chrome/WebView version, `get.webgl.org/webgl2`, `/terminal/` (`view=face` and `view=mirror`), `/reinstall/`, camera scan, a 720p MP4, the TTS voice **inside Fully Kiosk** (Android System WebView may not implement `speechSynthesis`; Fully's "autoplay audio" on) | Every tablet tagged "world-capable" or "face/slides only", and "browser voice: yes/no", in the HW-SCR-08 table. "No" → Kokoro or the P-3 files are that tablet's only voice |
| **K-03** | Reinstall on real devices, live | D · 0.5 · Tue 10-20 | The tent tablet over HTTPS; re-run the review-round fixes live: pause, a moved duck, a 409 map save, the TV mirror | Scan a pass → Play here → walk to the duck → released + codex on the guest's phone |
| **K-04** | Trabolta live (+ SW-AI-23 burst) | A · 0.75 · Wed 10-21 | The worker on the Ollama laptop holds `/api/agent/stream` on the VPS; `editor/e2e-live/mind.spec.ts` through the VPS; Reset the mind; `lookup: false`; fire each power once from Run; a **30-DMs-at-once burst** with p95 recorded. Laptop: `OLLAMA_KEEP_ALIVE=-1`; `OLLAMA_MAX_LOADED_MODELS=2` **only if RAM holds both models** (I-8), else the **mind runs paused by default** and resumes only in quiet windows (OP-06); `caffeinate` + `pmset` + charger. **OP-06 is mandatory now** (one Ollama at 2–6 s a reply = 60–180 s for 30 DMs). Write `agents.fallback.yaml` only if #35 says yes | A terminal speaks the hold line; each power reaches the house; burst p95 written in SW-AI-23 |
| **K-05** | House rig: YAML, edge/retain, link to the VPS, **safe lights** | D · **1.75** · code Sat 10-17 + Mon 10-19, **bench Thu 10-22** | Reed + indicator rules; pass `msg.retain` through (`show/mqtt.py:57-58`), ignore retained sensor messages, per-rule `edge: true` + pytest; `show` (with QLab) on the TV computer and `agents` on the laptop as **separate launchd jobs**. **Safety edits (critic pass):** the stairs, bathroom, tent, server room and the server-room → living-room path come **out of the `house` group entirely** (scenes 12/13/15/18 and the alarm recall on `house`); `lights_blackout`'s `wled/all off` becomes per-device offs that leave `wled/tube` on a dim static preset; **delete the maglock rules** (`trapped.house.yaml` ≈ lines 350-357); Trabolta's `cut_the_lights` drops **The Cloud** (`cast/trabolta.loom:171`, + story test) and the kitchen payload goes to ≈ 20%, not OFF; the YAML test pins all of it | **Bench 10-22 is the acceptance:** opening the real reed logs `server_door_opened` in Run once; a stagehand restart with the door open fires nothing; a 60 s WAN pull → reconnects; each combo fires exactly once (HW-PATCH-07); `lights_blackout` leaves the safety bulbs + the tube strip lit. 10-28 is a recheck only |
| **K-06** (+ **N-07**) | Alerts that actually land | B · 0.75 + 0.25 · Sun 10-18 | Keep `alertMark` across re-histories and banner the newest unseen alert from the last 10 min (`play/src/session.ts:479`); one shared AudioContext unlocked on the first tap; booths get the same pick/chime/vibrate/banner; **booth readouts chime too** (the late list, Clippy's warning); an "Alert" checkbox on the Director broadcast form; optional Wake Lock toggle | Screen off 2 min on an iPhone and an Android → `!` sent → banner + chime on wake; an Antivirus booth chimes on `!` and on `⏰ X is late` |
| **K-07** | Test sheet on cellular | **A** + you · 0.25 · Wed 10-21 | Every code type from K-12's sheet | Join, codex and check-in QRs all scan on an iPhone and an Android **with Wi-Fi off** |
| **K-08** | Freeze, pinned deploy, backups, **show-night resilience** | D · 0.75 · Wed 10-21 (+ 10-30 standby) | A pre-deploy script (`loomcheck --smoke` + every suite); tag + keep the previous image + a one-command rollback; a `pg_dump` + `loom-state` tar script (UTC cron) and one restore drill; **on show night (19:00–03:00) the dump + tar copied off the box every 10 min to the house laptop** (last night's backup is worthless mid-show); a **warm standby VPS** built 10-30 from a provider snapshot (images pulled, Caddy volume), left stopped; uptime alerts to the **tech op + second director**, not only John (on stage); the morning-of checklist (§11) | Restore last night's dump + tar on a scratch stack → an old guest token still reads its view; rollback to the previous tag in < 5 min; the 10-min job has run twice on 10-25 |
| **N-01** | Performer scanner on iPhone | B · 0.25 · Sat 10-17 | Lift `terminal/src/scanner.tsx`'s jsQR fallback into `play/src/performer.tsx` (today `BarcodeDetector` only, absent in Safari) | An iPhone (Safari) booth and an Android booth each scan 10 passes in a row over HTTPS |
| **K-32** | **VPS load test before the freeze** (new, capacity critic) | D · 0.5 · Fri 10-23 | `scripts/accept/k32-load`: 45 guest SSE streams, 9 booths, 6 terminals polling K-16, 2 mod clients, with say / redeem / widget bursts, against the VPS. `pushSnapshots()` (`event-runtime.ts:468`) and the agent presence callback compute and send a full snapshot to every client on every step; today's only load test (HW-NET-05) is on 10-28, after the freeze | p95 step latency < 1 s and CPU < 70% on the show VPS, recorded. If not: coalesce guest + booth snapshots to ≤ 2/s (extends K-22) in the 10-24 buffer |

### CHEAP-WIN (20.6 lane-days incl. K-31a, the N folds and D-01; + 2.0 conditional K-31b): big effect, or makes a workaround reliable

| Id | What | Lane · days · by | Minimal scope | Acceptance on a real device |
|---|---|---|---|---|
| K-10 | Codes survive End → relaunch | B · 0.25 · Fri 10-16 | On launch reuse the codes of the project's last event (the unique indexes skip ended events, `db/index.ts:96-99`). **Until it's live: never press End** | End → relaunch on the VPS keeps the event + prime codes; a printed test QR still joins |
| K-11 | Redeem throttle + **door-rush limits** | **A** · 0.35 · Sun 10-18 | 8 misses a minute per guest → 429; later misses aren't journaled. **The per-IP limits become env-configurable** (`LOOM_RL_*`): resolve-code 30/min, registration 20/min and the 10-failures lockout (`event-runtime.ts:282-284`, `server.ts:274`) all hit **one shared IP on house Wi-Fi**; set them high for the night | The 9th miss in a minute gets a 429 (test + a phone); 40 registrations from one IP in a minute pass with the night's env |
| K-12 | Quick print page | A · 0.5 · Mon 10-19 | A Run "Print" button → a print-CSS grid from `/api/mod/codes`: codex posters (title + QR + typed code), the join poster, room check-in signs. **QRs rendered in the browser** with the `qrcode` package (`/api/qr` allows 60/min per IP and the page needs 60–80) | Print-to-PDF from Safari with no 429; one sheet passes K-07 |
| K-13 | Room check-in by QR | B · **0.75** · Sun 10-18 | `POST /e/:id/api/guest/checkin {at}` → journaled `checked_in` (the story's if-chain, `main.loom:548-591`, handles it); refused when captured, sealed/prison, on rails or hidden; 20 s cooldown; play handles `?checkin=<slug>` like `?unlock=`. Route in `core/server/routes/k13.ts` | An iPhone native camera on a sign (hand-made QR until K-12 merges) lands in that room's chat, in the browser the guest joined in; refused while captured |
| K-14 | Terminal build compatibility | C · 0.5 · Fri 10-16, ✔ **10-20 tablet gate** | Polyfill `structuredClone` (`house/src/validate.ts:72`, `reinstall/web/src/api.ts:77`, `map/edit.ts:26`); explicit `build.target` chrome87 (+ `@vitejs/plugin-legacy` only if K-02 finds older); no WebGL2 → force the face pane | The oldest tablet loads `/terminal/` + `/reinstall/` with no console error; a no-WebGL2 tablet shows the face, never the "SIMULATION UNAVAILABLE" loop |
| K-15 | Kiosk basics | C · 0.5 · Fri 10-16 | Wake Lock on the wake tap + `visibilitychange`; ⚙ needs a 2 s long-press; Fully Kiosk settings written down (incl. **autoplay audio**); the bathroom tablet mounted outside the door | A tablet in Fully Kiosk stays awake 2 h on the charger; a short tap on ⚙ does nothing |
| K-16 | Attract until Trabolta is revealed + a lean screen state | C · **1.5** · Sun 10-18, ✔ **10-20 tablet gate** | Four jobs: **(1)** `GET /e/:id/api/screen/state` (~1 KB): `Night.screen`/`terminals`, the last of ≈ 35 `screens_*`/`terminals_*`/`tv_*` cue values folded from the sim feed, Trabolta's hidden/awake, `remaining`, each terminal's last poll; **(2)** the terminal moves off its 20 s `/api/state?role=mod` poll (`terminal/src/app.tsx:379`) to this one every 2 s; **(3)** attract (Canvas2D screensaver ⇄ PNG ads) while Trabolta is hidden or asleep: scanner off, never "ONLINE", never pilots; **(4)** the server refuses agent dispatch for a hidden character (`agents.ts`). K-17, K-18 and K-29 wait on it | A tablet shows attract while Trabolta is hidden; after `introduce_trabolta` it flips to the face within 2 s; terminals can be provisioned **`view=auto` from the start** |
| K-17 (+ **N-03**) | Overlays, PNG slides, countdown, **precedence** | C · 1.0 + 0.5 · Tue 10-20 | Overlays `blackout`, `go_to_living_room` (flashing **≤ 3 Hz**, no full-field red), `alarm`, `flicker`; any other value → `/terminal/slides/<value>.png`, **and a 404 renders a Win98 text card of the value**, never a broken image (P-2's PNGs land 10-21–25); `y2k` → a taskbar clock from `remaining`. **Precedence: overlay > slide (hold 45 s on terminals / 90 s on the TV; `tv_bingo`, `y2k`, `trust_chart`, `truth_txt` and the ceremony award slides persist and beat attract) > attract > base view; `countdown_*` is a corner overlay; a pilot session pre-empts a slide** | With Trabolta hidden, fire V1→V3: the TV shows each slide (or its text card); `start_the_hunt` shows H1–H3 with a countdown corner; terminals return to `auto` 45 s after `trivia_2` |
| K-18 (+ **N-04b**) | TV room voice | C · 1.25 + 0.25 · **Wed 10-21** | `view=tv` on the TV computer: the face full screen + K-17 overlays + the world pane when someone is in the Internet; K-16 returns new `loc:The Desktop` lines from Trabolta after a `seq`; spoken through `/api/mod/tts` (Chrome voice fallback; the TV's Chrome launches with `--autoplay-policy=no-user-gesture-required`), mouth on the audio level (Sandy is lore, #28: her one line shows as text, never voiced); **skips `Song Ending`, `Sad Confession`, `The Hand Jive`; speaks director `say` lines as Trabolta; a mute toggle** | The TV speaks a Desktop Trabolta line and a director `say` within 3 s; the Song Ending plays with no TTS on top; mute works; after a reboot + one click it speaks again |
| K-19 | Kokoro on the VPS | C · 0.5 · Sat 10-17 | A `kokoro-fastapi-cpu` compose service with a **`cpus:` limit** (it must never starve the event server) + `LOOM_TTS_URL` | **50 SSE streams connected and 3 concurrent syntheses: every sentence < 2 s.** Miss → N-12 (Kokoro on the TV Mac for `view=tv`) or the browser voice |
| K-20 | Alexa through the house speakers | **C** · 0.5 · Fri 10-23 | A script on the TV computer: MQTT `show/announce` → the chime + the TTS file (`/api/mod/tts`, macOS `say` fallback) played **straight to a multi-output CoreAudio device covering Z1 + Z2** (a CLI player that targets a named device; `say -a <device>` for the fallback). **QLab is out of this path** (no dependency on its multi-output licence or its cue list) | `do announce` from Run → chime + the spoken line in the living room and the kitchen within 3 s |
| K-21 | Cue sheet | A · 0.75 · Tue 10-20 | Run → Director lists the `who: admin` INTERACTIONs in order with their C1/V1… labels, one-click fire, the last cue marked, `Night.phase`, a filter. The editor is a desktop shell: **no phone layout** (the phone fallback is the radio, W-26) | The second director, **signed in with their own VPS account as a project member**, fires C1 → V6 from a laptop |
| K-22 | Lean mod stream | D · 0.5 · Thu 10-22 | `?lean=1` skips snapshot + history frames, stagehand passes it; mod snapshots coalesced to ≤ 2/s (today ≈ 196 KB per step per mod client) | Stagehand still gets every `sim` frame; bytes per step measured on the VPS |
| K-23 | Hunt-answer secrecy in the worker | A · 0.5 · Mon 10-19 | Suppress the orchestrator's `learned` verdicts on hunt-question claims; extend the secrecy test; `lookup: false` stays | A live DM claiming an H-answer never shows up in the mind's `learned` (Run → Mind) |
| K-24 (+ **N-05**) | DM lies via "📝 File a fact" | A · 1.25 + 0.25 · Sat 10-17 | A `fact` widget (question picker from `with questions:`, ≤ 200 chars, "I'm certain") over `/api/guest/widget` → a `fact answered` signal; **`widgetResultArgs` (`event-runtime.ts:104`) exempts the fact text field** (today an answer that exactly matches a person id or entity name, e.g. "Winamp" or "Clippy", rejects the whole card); dealt in `dm:Trabolta` when the hunt opens, re-dealt after each filing; each filing posts "📝 X filed H2: …" to `# hosts`; **judged with two new performer buttons "📝 accurate" / "📝 confident lie"** keyed to the filed question, ungated by `judging`/`may_answer`, +50 ⓣ, the identical reply, sticky lie; persona line "file it" | On an iPhone: file H2 during hunt 2 (answer: "Clippy") → it appears in `# hosts` → the director presses 📝 confident lie → `Kernel.q5 = "lie"`, +50 ⓣ, the same reply as a truth; a story test: one DM bluff fails the verdict |
| K-25 | Ceremony as story beats | A · 1.0 · Thu 10-22, ✔ Fri 10-23 | `start_the_ceremony` + one admin event per award (5 fixed + 3 bonus) fired **with the winner as the subject**; template lines with fallbacks; the host changes per ending; award slides beat attract (K-17) | In a rehearsal, 3 awards fired on real guests → lines in The Desktop with their names; **per ending**: Trabolta's endings → the TV speaks them; after `destroyed` (Trabolta gone) **Clippy reads the lines aloud live** and the TV shows the award slide |
| K-26 | Recap numbers | A · 0.5 · Fri 10-23 | `GET /e/:id/api/mod/recap`: ranked lists from live state (trust, truths, lies, Internet visits, codex, quests, factions) as JSON + a paste-ready text block | Returns sensible lists during the 10-25 run-through |
| K-27 (+ **N-06**) | Chess disarm + re-arm; manual majority | A · 0.5 + 0.25 · Sat 10-17 / Sun 10-18 | `when chess won` at `Night.step >= 14` → a 90 s `Kernel.disarmed_until` window, then re-lock; `chess won` from a host INTERACTION "♟ They beat the machine" or the director; `rearm_server_room`; **`force_majority_stay` / `force_majority_leave`** admin cues | Story tests green; **on the 10-22 bench reed** the door doesn't alarm inside the window and does after it (10-28 is a recheck) |
| K-28 | Survey in, map pinned | D · **0.75** · Wed 10-21 | Rooms, Server Room, the outdoor tent **and the shed variant** from the 10-17 measurement, plus every terminal mount; `validateHouse` is strict (floor spacing, door tolerance, stair clearance, props), so expect several failing passes; commit as the show `house.json` (+ `house.shed.json`) and **bind-mount the directory** (`./show-map:/config:ro`, `LOOM_HOUSE=/config/house.json`; a single-file mount keeps the old inode after a swap, W-22); `pnpm house:sync` + `pnpm test:vr`; rebuild terminal + reinstall | Both variants validate; the autopilot reaches every duck spot in both; End → relaunch keeps the map; `cp house.shed.json house.json` on the VPS re-deals the duck |
| K-29 | Terminal heartbeat card | C · 0.5 · Thu 10-22 | K-16 records each terminal's last poll; a Run card turns red after 30 s silent and the editor chimes (#25: the kiosks alert the director). **The chess phone is not covered** (it runs the Lichess app, which can't report); OP-12 covers it | Pull a tablet off Wi-Fi → the card goes red + chimes within 30 s |
| K-30 | Quest APK, time-boxed | D · 1.5 · **time-box ends Tue 10-20**, call Thu 10-22 | Developer mode, Godot Android export, sideload, `station.json` per headset | A Quest finds the duck on the VPS over HTTPS → released. No-go → W-33 |
| **K-31a** | **Push: Android + booths** (decision #25; WP-13/14/15 slice) | B · **1.5** · ✔ **Wed 10-21** | `web-push` + VAPID keys pinned in `.env`; subscriptions as JSON in the event state dir by person id (guests + booths); a push-only `sw.js` + a static manifest served by `server.ts` with `Cache-Control: no-cache` and CSP `worker-src 'self'`; **no service worker when play is embedded** (the `host.ts` seam, Run → Players); **send rule:** `!` alerts always; character DMs only when the client's last `visibilitychange` → `sendBeacon` flag says *hidden* ("SSE disconnected" is wrong: a locked iPhone's socket looks open for minutes); every push shows a notification (iOS revokes subscriptions that get silent pushes); prune 404/410; a 🔔 "Get alerts" card (Android asks from a tap). **Out:** an install-first door gate, director push, `notify`, a health card | 2 Androids, locked, on cellular: an `!` alert and a Trabolta DM arrive as notifications; an Android Antivirus booth gets the door alarm; an app in the foreground gets no duplicate notification |
| **K-31b** | **Push: iPhone Home Screen** (conditional) | B · **2.0** · ✔ Fri 10-23, **call Sat 10-24 12:00** | **Built only if K-31a is green on 10-21.** A dynamic manifest whose `start_url` carries a one-time resume nonce, **reusing N-02's `resume` path**; the nonce **adds** a token, so the Safari session and the Home Screen session both stay valid (codex/check-in QRs from the native camera still open Safari); the same flow for **booth (performer) sessions**; Add-to-Home-Screen steps on the 🔔 card; iOS < 16.4 → "your iPhone can't get alerts, keep Trapped open" | 2 iPhones (iOS 16.4+) joined in Safari → Home Screen → locked, on cellular: an `!` alert and a Trabolta DM arrive; the Safari tab still works; an iPhone booth gets the door alarm |
| N-02 | Re-pair a lost guest | B · 0.5 · Mon 10-19 | `POST /e/:id/api/mod/guest/pair {id}` mints a fresh token for an existing guest; the Run Inspector shows a QR `/?code=<event>&resume=<token>`; play adopts it and strips the URL. Also moves a guest onto a loaner phone | Clear a guest's browser data → re-paired from Run in < 30 s → codex, quests and ⭐ intact; no new Person |
| **N-10** | **Release a performer's part** (new, safety critic) | B · 0.25 (folded into N-02) · Mon 10-19 | `POST /e/:id/api/mod/prime/release {character}` drops the session holding the part, plus an Inspector "Release" button. Today `/api/prime/login` refuses a held part with 409 (`event-runtime.ts` ≈ 2315-2331) and only Go live frees parts, so a performer whose phone dies is gone for the night | Kill a booth, release it, re-sign on a loaner in < 60 s with the character's threads and buttons intact |
| N-08 | Server-room ESP32 firmware | D · **1.0** · code Fri 10-16, bench Thu 10-22 | Arduino: reed + copper tape on two GPIOs (debounce 300/50 ms), 2×MCP23017 all-pairs scan **with a boot baseline** (if I-1 finds the bay normalled, top-N ↔ bottom-N reads as plugged in; report the difference from the baseline), combo string **canonical-sorted by V number**, LWT, the ring + DFPlayer on `show/serverroom/*`; **the broker is the TV computer's static IP, hard-coded** (no DHCP dependence) | HW-PATCH-07 on the bench (with K-05) |
| D-01 | Cast paper | A · 0.5 · sheets Thu 10-15, packs Sat 10-24 | The invitation, 9 featured-guest sheets, 9 performer packs and the per-role cheat-sheets (§10, incl. the **emergency card**), drafted from DESIGN for your edit | You approve the featured sheets the night of 10-15; the packs are handed out on 10-25 |

### Optional (only on slack, after every committed item is green)

| Id | What | Days | Build when |
|---|---|---|---|
| N-09 | Terminals speak Alexa's `do announce` text (K-16 returns `{announceSeq, text}`): "Alexa through the terminals" (#20) in every room with a tablet | 0.5 (C) | **If push is no-go at the 10-24 call**, lane C builds it that afternoon |
| N-11 | The hub posts the persona's hold line itself after 20 s with no worker online (today `AgentHub` queues silently for up to 10 min and then drops the request, `agents.ts:776`) | 0.25 (A) | Slack; strongly wanted if #35 is "no" |
| N-12 | `view=tv` calls Kokoro running on the TV Mac directly | 0.25 (C) | If K-19 misses its acceptance |
| N-04a | `view=tv` plays `/terminal/slides/<value>.mp4` when present (the ad hijack, WebMD on the Desktop) | 0.25 (C) | If QLab video over Chrome fails the 10-25 test |
| S3 | Guest in-app QR scanner (reuse `terminal/src/scanner.tsx`) | 0.5 | Only if the 10-25 run shows the native camera opening the wrong browser |
| S4 | Codex/quest grant buttons in the Inspector (`/api/mod/codex`, `/api/mod/quest`) | 0.5 | Slack only |

---

## 6. Lane totals

| Lane | Items, in order (by day) | Lane-days |
|---|---|---|
| **A** story + agent | 10-15 D-01 sheets · 10-16–17 K-24 + N-05, K-27 · 10-18 N-06 + K-11 · 10-19 K-23 + K-12 · 10-20 K-21 + K-07 · 10-21 K-04 · 10-22 K-25 · 10-23 K-26 · 10-24 D-01 packs | **7.35** |
| **B** platform + play + push | 10-15–16 K-01, K-10 · 10-17 N-01 + K-06 · 10-18 N-07 + K-13 · 10-19 N-02 + N-10 + K-31a · 10-20 K-31a · 10-21 K-31a ✔ → K-31b · 10-22–23 K-31b · 10-24 12:00 push call | **7.75** (5.75 without K-31b) |
| **C** terminals + TV | 10-16 K-14 + K-15 · 10-17 K-19 + K-16 · 10-18 K-16 · 10-19 K-17 · 10-20 N-03 + K-18 · 10-21 K-18 + N-04b · 10-22 K-29 · 10-23 K-20 (→ N-09 / N-12 on 10-24 if needed) | **7.0** |
| **D** house + tent + deploy | 10-15 K-30 toolchain · 10-16 N-08 · 10-17 K-05 YAML · 10-18 K-08 scripts · 10-19 K-30 APK + K-05 launchd · 10-20 K-03 + K-30 live · 10-21 K-28 + K-08 drill · 10-22 K-05 bench + K-22 · 10-23 K-32 · K-02 rolling | **7.5** |
| **Total** | | **29.6** = 27.6 committed + 2.0 conditional (K-31b). Committed × 1.25 ≈ **34.5**; with K-31b ≈ 37.0 |

---

## 7. BUY-TODAY (Thu 10-15)

### 7a. Tonight, before ordering: the 60-minute inventory (four orders branch on it)

| # | Check | How | Decides |
|---|---|---|---|
| I-1 | **Patch bay**: rows × columns, jack type (BNC / WECO / mini-WECO), rear connectors, how many matching cords you own | Multimeter on the rear BNCs: centre ↔ shell ≈ 75 Ω = terminated; top-N ↔ bottom-N ≈ 0 Ω = normalled. Repeat with a cord in the partner jack | BNC pigtails vs soldering; whether the BNC façade (A-5) is needed |
| I-2 | **PAUTIX strips**: pad labels (R/G/B = analog, DI/DO = addressable), 12 V or 24 V, lengths | Strip end + brick label | The WLED controller + PSU |
| I-3 | **16-out interface**: 16 analog, or 8 analog + ADAT | Look up the model | 8 + ADAT → use only the 8 analog outs; don't buy a DA converter |
| I-4 | **TV computer**: which Mac? | — | None → **buy a Mac mini tomorrow** (~$800, Apple Halifax Shopping Centre / Best Buy) or press an old MacBook into clamshell. **QLab needs a Mac** |
| I-5 | Quest 3 ×2: owned, charged, same Meta account? | — | Start the developer org tonight |
| I-6 | Tablets/phones in hand (model + Android) and bulbs (Hue vs IKEA) | List | How many gap-fillers; whether to buy Hue |
| I-7 | Canopy with sidewalls? Power in the shed? | — | Canadian Tire purchase |
| I-8 | **The Ollama laptop**: which machine, how much RAM? | `gpt-oss:20b` (≈ 14 GB loaded) + the orchestrator model | Both fit → `OLLAMA_MAX_LOADED_MODELS=2`; else the mind runs paused by default (K-04, OP-06) |
| I-9 | **Which machine is the director's** (Run), and is there a **backup Mac** for the TV computer? | Only the TV computer is inventoried today; the plan assumes three computers | A borrowed laptop for the director; the backup Mac gets the QLab file + media on 10-26 |

Also tonight: **buy the QLab licence** (routing is built 10-21; check whether the ad also needs a Video licence, else N-04a is the plan) · ask someone to play McAfee (no one by 10-18 → cut him, CRA Agent gets his exchange buttons) · **ask someone to be house manager** (§10) · save-the-dates with **RSVP by Fri 10-23** · ask friends for old Android tablets/phones (Android 8+), a dead inkjet, old computer parts, dead LCDs, thrift trophies.

### 7b. One Digi-Key order tonight (≈ $180–260 CAD, free shipping over $100): the server-room box

An order placed Thursday night **most likely lands Mon 10-19**, not on the weekend. N-08 is written without hardware on 10-16. Breadboarding moves to 10-19. The 10-22 bench is safe.

| # | Item | Qty | ≈ CAD |
|---|---|---|---|
| D-1 | Espressif **ESP32-DevKitC-32E** (WROOM-32) | 2 | 15 ea |
| D-2 | **Adafruit MCP23017 STEMMA QT** (#5346) | 3 | 9 ea |
| D-3 | STEMMA QT cables 100–200 mm | 4 | 2 ea |
| D-4 | **Adafruit NeoPixel Ring 16** (#1463) | 1 | 15 |
| D-5 | SN74AHCT125N level shifter + caps (1000 µF, 100 nF) + resistors (330 Ω, 1 kΩ, 10 kΩ) | 1 set | 15 |
| D-6 | DFRobot DFPlayer Mini + 3 W speaker *(nice: local siren)* | 1 + 1 | 14 |
| D-7 | Adafruit STEMMA mini relay (#4409, 3 V) *(nice: the click)* | 2 | 5 ea |
| D-8 | 5 V 4 A PSU (Adafruit #1466 / Mean Well GST25A05) + barrel adapter | 1 | 20 |
| D-9 | Perma-Proto ½ boards ×2, screw terminals, 22 AWG stranded wire, heat-shrink | 1 set | 30 |
| D-10 | Mean Well GST120A24 / GST160A24 24 V brick *(if I-2 says 24 V and the strips' own bricks are undersized)* | 1–2 | 45–60 ea |
| D-11 | 3× logic-level MOSFETs (IRLZ44N / FQP30N06L) + 100 Ω gate resistors per analog run: the DIY WLED fallback | 1–2 sets | 5 |

### 7c. Amazon.ca Prime tonight: only lines whose cart date is **by Mon 10-19** (else buy locally)

| # | Item | Qty | ≈ CAD | Local fallback |
|---|---|---|---|---|
| A-1 | **Sonoff ZBDongle-E** (or SMLIGHT SLZB-06) + 1 m USB 2.0 extension. **Two of the same model**: the second is the coordinator spare (Z2M `data/` restore tested 10-23) | **2** | 35–60 ea | Elmwood / Universal-Solder the same night |
| A-2 | **MC-38 wired reed switches**, 5-pack | 1 | 15 | Home Depot / Canadian Tire "wired door contact"; or a **Hue Secure contact sensor** (Best Buy) |
| A-3 | **Copper foil tape, conductive adhesive**, 25 mm | 1 | 15 | A door-jamb plunger switch (Home Depot) |
| A-4 | BNC male → bare-wire pigtails 75 Ω *(if the bay is BNC-rear)* | 24–30 | 30–40 | Cut BNC cables from Long & McQuade |
| A-5 | BNC–BNC patch cables 1–2 ft + panel bulkhead jacks *(if the bay is WECO and you own < 8 cords)* | 10 + 24 | 65 | The BNC façade |
| A-6 | **GL.iNet GL-MT3000** (LTE failover via a tethered phone) | 1–2 | 130 ea | Best Buy / Canada Computers multi-WAN router |
| A-7 | WLED controllers to match I-2: **Gledopto GL-C-016WL-D** (addressable) or GL-C-211WL / Athom analog | 2–3 | 35–55 ea | D-11 DIY board |
| A-8 | Inline ATC fuse holders + 5 A blades | 4 | 15 | Canadian Tire, same day |
| A-9 | Tablet wall mounts | 5–6 | 15–25 ea | Command strips + industrial Velcro |
| A-10 | 60–100 W multi-port chargers + 3 m cables (**USB-C and micro-USB**) | 2 + 8 | 100 | Best Buy / Staples |
| A-11 | Ground-loop isolators *(nice)* | 2 | 15 ea | Long & McQuade (Hosa) |
| A-12 | Battery LED EXIT sign (tent) | 1 | 30 | Home Depot / Kent |
| A-13 | Quest accessories: 2× 45 W PD chargers + 3 m cables, face covers, lens wipes, 8× AA + charger | — | 120 | Best Buy |
| A-14 | Sonoff SNZB-01P Zigbee button (bean printer START) | 1 | 20 | Hue Smart Button (change the YAML predicate) |
| A-15 | micro-SD 16–32 GB ×2–3 | — | 20 | Staples |
| A-16 | **Power banks ×8–10** (10,000 mAh) + short USB-C and Lightning cables | — | 150–250 | Costco / Best Buy |
| A-17 | **Battery motion-sensor LED stair/path lights** ×8–12 (every stair, the server-room → living-room path, the back steps, the tent path; independent of every system) | — | 80–120 | Canadian Tire / Home Depot |
| A-18 | **Receptacle/GFCI tester** | 1 | 15 | Home Depot / Canadian Tire |
| A-19 | **USB-C → HDMI adapter** + a spare HDMI cable (TV computer fallback onto the backup Mac) | 1 + 1 | 35 | Best Buy / Staples |
| A-20 | LED candles (jack-o'-lanterns, porch) + **FR spray** (or FR fabric) for the Tube, where the COB strip sits | — | 50 | Dollarama / Michaels / Home Depot |

### 7d. Local run, Fri 10-16 – Sat 10-17 (Bayers Lake: Best Buy, Canadian Tire, Home Depot, Staples, Costco, Canada Computers at 201 Chain Lake Dr; Long & McQuade)

| # | Item | ≈ CAD | Where |
|---|---|---|---|
| L-1 | **UPS 850–1000 VA** (TV computer + router + coordinator + interface) | 130–180 | Staples / Best Buy / Costco |
| L-2 | **Hue Smart Plug ×2** (Zigbee routers near the server room and the back door) + **Hue Outdoor Smart Plug** (Truth Pong flood) | 40–55 ea | Best Buy |
| L-3 | IP65 plug-in LED flood ×1–2 | 40–60 | Home Depot / Canadian Tire |
| L-4 | **Outdoor GFCI** (inline adapters or a block) + 2 outdoor cords 15–25 m, **12 AWG** (14 AWG minimum; cheap 16 AWG cords overheat at the radiator's 1500 W), used fully uncoiled, + covers and a dry box for the connections | 150 | Home Depot / Kent |
| L-5 | Power strips ×6, **gaffer tape** ×2, **glow tape**, cable ramps, zip ties | 120 | Long & McQuade / Home Depot |
| L-6 | **Laser measure** + 8 m tape (needed 10-17) | 80–130 | Home Depot |
| L-7 | Powered speakers with balanced TRS inputs for the **kitchen** (+ a 3rd zone only if wanted) | 200–280 / pair | Long & McQuade / Best Buy |
| L-8 | Balanced TRS cables 7.5–15 m | 4–6 × 20–35 | Long & McQuade |
| L-9 | Battery speaker with aux in (tent tablet; moves to the shed in rain) | 40–70 | Best Buy / Walmart |
| L-10 | 10×10 pop-up canopy with sidewalls + 4 sandbags (20 kg/leg) + tarp floor *(if not owned)* | 200–300 | Canadian Tire / Costco |
| L-11 | **Oil-filled electric radiator** with tip-over switch. **Never a combustion heater in the tent** | 60–90 | Canadian Tire |
| L-12 | Cat6 30 m *(nice: tent AP)* | 30–40 | Canada Computers |
| L-13 | First-aid kit, ABC extinguisher, 4–6 headlamps with red mode | 120 | Canadian Tire |
| L-14 | **6+ FRS radios with earpieces** + batteries. **Essential now**: every OP depends on call words, and the guests shouldn't hear them | 150–250 | Canadian Tire / Best Buy |
| L-15 | **Tent tablet** (≥ 10", WebGL2, e.g. Galaxy Tab A9+) + gap-fillers only if < 4 tablets pass by 10-20. **If the Quest is no-go (10-22): 2 more WebGL2 tablets**, because W-33 needs 2 game tablets plus the WebMD video device in the tent | 120–300 ea | Best Buy / Costco |
| L-16 | Fully Kiosk PLUS licence per tablet + the chess phone (free trial until a device passes) | ~€9 ea | Online |
| L-17 | **QLab Audio licence** that unlocks > 2 outputs, rented for the show week if Figure 53 offers it (check figure53.com), else the shortest paid term (HW-AUD-16). **Buy tonight**, not later | check | Online |
| L-18 | **Prepaid data that allows hotspot/tethering**, enough for a night, for the failover phone (check the plan's terms) | 30–50 | Any carrier store |
| L-19 | A chair for the tent (VR is played **seated**) + headset wipes | 30 | Canadian Tire / Walmart |

**Not buying** (too slow, or cut): QuinLED, ADA8200, MCP4728 / ADS1115, mmWave, keypad, maglock, analog panel meter, INMP441, Echo devices, overseas WECO cords. AliExpress / Temu / eBay-overseas are too slow. Memory Express has no Nova Scotia stores.

---

## 8. You + friends: build and production blocks

Owners: **YOU** (director/integrator) · **SPARKS** (solders, careful with mains) · **SET** (props) · **MEDIA** (edits video/audio) · **PAPER** (print + crafts). Each block has a **Tier 0** that works with today's code + a director button.

| Block | What, minimal | Who · dates | Tier 0 fallback |
|---|---|---|---|
| **B-1** Server-room door | Reed on the frame (magnet on the door) on the ESP32 + copper-tape frame-bridge on a 2nd GPIO; ring over the door; DFPlayer siren (nice). 20 test closes | SPARKS + YOU · breadboard **10-19** (Digi-Key), rules 10-20–22, bench **10-22**, mounted on the door **10-27** | W-32: Hue Secure contact, else an Antivirus at the door + the director |
| **B-2** Patch bay | **2×12 only** (V1–V8 + 4 decoys / D1–D8 + 4 decoys) on 2 MCP23017s; every unwired jack masked "SECTOR DAMAGED"; feedback = relay click + ring (meter, MAIN POWER, commit button cut). A normalled bay (I-1) is fine: N-08 calibrates a boot baseline. Real gear (router, UPS, dongle, ESP32 power) out of reach and taped off from the bay, because guests swarm the room in Act III | SPARKS + YOU · I-1 tonight, solder Sun 10-18, scan 10-19/20, bench **10-22**, labels 10-24 | W-31: crew watches, director fires the combos |
| **B-3** Lights | Z2M on the TV computer; Zigbee channel 15/20/25 + Wi-Fi on a non-overlapping channel (20 MHz, 11ax off on 2.4 GHz IoT); `power_on_behavior: previous`; wall switches taped ON; groups per the checklist, with **the stairs, bathroom, tent, server room and the server-room → living-room path out of `house` entirely** (K-05), so neither the blackout nor any `house` scene can darken them; **`power_on_behavior: on`** on those safety bulbs (with `previous`, a wall switch flipped during a blackout brings them back OFF); battery motion lights on every stair and path (A-17); **8 stored scenes** (1 screensaver, 3 call_desktop, 4 game, 9 trust chart, 12 alarm, 13 blackout, 14 dance, 20 restore) + native `breathe`/`blink`; WLED with identical preset IDs; `lights_blackout` turns WLED off **per device**, leaving `wled/tube` on a dim static preset; **rebuild ps 7 (glitch), 12 (alarm), 17 (rave) and 21 (lightning playlist) with Breathe / Fade / Running, or Blink ≤ 3 Hz**, stopwatch-tested 10-22; Z2M `data/` backed up after pairing and restored onto the spare dongle 10-23 | YOU + SPARKS · pair 10-17, groups 10-19/20, WLED 10-19–21, **blackout rehearsal + strobe timing 10-22**, scenes + coordinator restore 10-23 | Zigbee bulbs only; the Tube one static colour. Coordinator dead on the night → wall switches |
| **B-4** TV computer + audio | Never-sleep, wired, on the UPS, **static IP set on the machine itself** (it's the Mosquitto broker); Chrome launched with `--autoplay-policy=no-user-gesture-required` (after a reboot, click once into the page); **a named backup Mac pre-loaded** with the QLab workspace, media and pre-rendered files + a USB-C → HDMI adapter (swap rehearsed 10-28); drinks away from the TV computer, interface and UPS; 48 kHz, named channels; **≤ 3 zones**: Z1 living (ch 1/2), Z2 kitchen (ch 3/4), Z3 backyard (nice); other rooms use tablets/phones; QLab show file with routing (HW-AUD-16); audio walk | YOU + SPARKS · 10-16 set-up, runs 10-18–21, routing check 10-21 | Hand-played cues on Z1; kitchen as a mirrored pair |
| **B-5** Wall tablets | **4–5 tablets**, not 8: hall (Tube) + kitchen (world/face), registry, mudroom (dim), bathroom (outside the door, camera off); + the tent tablet, the chess phone, 1 spare. Fully Kiosk: keep screen on, **autoplay audio**, camera, PIN exit, restart on crash; the TTS voice tested **inside Fully**, not in Chrome (K-02); start URL `view=auto` once K-16 is verified (`view=mirror` on the cheat-sheet as the fallback); DHCP reservations | YOU + a friend · triage 10-16–19, provision 10-21/22, mount **10-27** | `view=mirror` all night, re-provision to `auto` after the intro |
| **B-6** Quest | Developer org 10-15; APK 10-17–20 (K-30); proximity on, timeout up, passthrough auto-switch off, app pinned; AAs kept warm; lenses guarded from condensation. **Played seated** (a chair, L-19), snap turn, a spotter (a **tent assistant**, since WebMD can't spot while running the tablet and performing), headsets wiped between players | YOU · **call 10-22** | W-33: web game on 2 tablets |
| **B-7** Tent + shed | GFCI outdoor power on **12 AWG** cords, uncoiled, drip loops, connections in a dry box (never on the tarp floor); the radiator on **low**, ≥ 1 m from the fabric, **on a different house circuit** from the tent electronics; **breaker map by 10-24** (which circuit carries the kettle and the speakers), GFCIs tested with A-18; **move to the shed on gusts > 30–40 km/h** (pop-up canopies lift before a 40 km/h sustained wind); AP in a dry tote (Cat6) or the router by the window; low light, never dark; EXIT sign; glow-tape path; IP65 flood to the shed; sandbags + sidewalls + tarp; shed ready with power, Wi-Fi, mats, tablet stand; virus props (`LOVE-LETTER-FOR-YOU` floppy under VR 2, `FREE-TRIAL-30-DAYS` on the stand) | SET + SPARKS · test pitch 10-24, **call 10-29**, pitch 10-30, confirm 10:00 10-31 | Shed (W-22) |
| **B-8** House measurement | Every room, doors, stairs, floor heights, the Server Room, the tent spot (yard as a notched polygon), **the shed**, each terminal mount (position, height, yaw, pitch), the pong table, 10 duck spots; photos + a sketch | YOU + 1 friend · **Sat 10-17 afternoon**; entry 10-18/19 → K-28 | The placeholder map (the game still works, it just isn't the house) |
| **B-9** Network + failover | The ISP router kept as a **cold spare with the same SSID/PSK**; the ISP modem/ONT on the UPS too; the prepaid plan on the tethered phone allows hotspot (L-18). GL-MT3000: 2.4 GHz IoT SSID (WPA2, 20 MHz, 11ax off, away from Zigbee); a phone USB-tethered as the 2nd WAN; DHCP reservations → the IP sheet in the server room; mobile-signal walk 10-17; **switch-over time measured 10-23**; **WAN pull at the 10-28 tech** | YOU · 10-17–23 | Guests are on cellular anyway; QLab is local. **But with the WAN down no Act III automation fires** (door, patch bay, blackout and Alexa all go ESP32 → stagehand → VPS → story → back): Tier 0 (W-31/W-32) |
| **B-10** Chess phone | Best Android 8+ phone, reset, wall mount outside the server room, short strain-relieved charger; **Lichess app** (offline "Play with the computer" at **level 2–3**, tuned at the 10-25 run-through so a casual player wins in about 10 minutes; level 7–8 is close to full Stockfish and no party guest wins), checked to install on that phone and to play in airplane mode, pinned; "CHECKMATE TRABOLTA" sign | YOU · 10-23, mount 10-27 | Director fires `chess won` |
| **B-11** Bean printer | A dead inkjet filled with bagged beans (+ a few loose); the Zigbee button over START named `printer_button`; lid sensor cut (director presses 🫘) | SET · 10-24 | Director fires `printer_button_pressed` |
| **P-1** WebMD video | Script = `beats/internet.loom` (full cut + "welcome back" cut); 3 takes each; Win98 frame, captions burned in + `.vtt`; 720p H.264 `+faststart`; played from local disk on a 2nd tent device | MEDIA + Julia · **shoot Sun 10-18**, final **Wed 10-21** | Julia performs live; `dm:WebMD` text on phones |
| **P-2** Ad hijack + attract loop | 30 s ad (a duck, a number with no digits, `000. 000. 000.`, magenta, `ad_jingle`); **3 attract ads** (not 4–8) as one loop; a 5–10 min Win98 screensaver recording; plus the PNG slides for K-17 (Keynote/Canva, named exactly per spec §2.13). **Run the free PEAT photosensitivity tool (Trace Center)** on the ad MP4, the attract loop, the screensaver recording and any lyric video before 10-27 | MEDIA · 10-21–25 | QLab plays the ad by hand at 📺; tablets show a still PNG |
| **P-3** Songs + voices + sfx | "You're the One" backing track with stems muted (one male-muted → `youre_the_one_sandy_only`); Trabolta's vocals through a GarageBand vocoder; **Sandy's line rendered with Kokoro, inside the song only** (#28: she is lore) → `youre_the_one_vocoder` + `sandy_line.wav`; `dance_song` with 10 s of silence; the sfx pack (CC0) named per §2.13 + drumroll/fanfare for the ceremony; **pre-rendered Alexa + Trabolta speeches** (the fallback for K-18/K-20) | MEDIA · 10-22–25 | — |
| **P-4** Print + paper | **Batch 1 Thu 10-22** (pinned codes, after K-07): 41 codex posters, clue QRs, check-in signs. **Batch 2 Mon 10-26** (after the run-through): door sign (push wording from the 10-24 call), Bingo cards (1 per guest + 10 + MS Paint's fake), hat slips, cast cards, cheat-sheets, patch-bay labels, IP sheet, flashing-lights warning. Combo-half posters only after the K-05 bench confirms the strings. Laminate outdoor items 10-27 | PAPER · Staples | Hand-made signs |
| **P-5** Props + set | The Tube (hoops, **flame-retardant** black fabric or FR spray, cables, the COB strip in channel; egress clear); LED candles in the jack-o'-lanterns; a towel + mat under the bobbing tub, away from the stairs; Truth Pong (table, 20 cups, balls, tarp, flood on the outdoor plug); bobbing tub + Bag of Truth + laminated truth.txt (printed last); deposit box; ribbons; **9 trophies** (thrift + gold ducks); set dressing from whatever turns up; guest charging station | SET · **build day Sat 10-24** (+ Sun 10-25), install 10-27 | — |
| **P-6** Casting + briefings | Featured sheets out with the invitations **10-16** (Rob Excel, Lara OpenOffice, Hannah DraftKings, Veronica Bugdom, Kai Ask Jeeves, Laurel Runescape, Cat MS Paint, Zeus VLC, Em Pong; "sign in by picking <program> from the list"; never real names in the story). Performers: Clippy (Brooke), Task Manager (John), Adobe Acrobat (Stephanie), Recycling Bin (Jesse), Norton (Julie), McAfee (cast by 10-18 or cut), Password Manager (Francine), CRA Agent (Emma), WebMD (Julia). Read-through + phone set-up **10-25** | YOU (+ D-01) | — |

**Invitation wording** (D-01): Jean Trabolta's offer · mapsandducks.com · date, time, address · **"arrive after 8 pm"** (Halloween porch) · "come dressed as a piece of 90s/00s software" · "bring a charged phone" · the flashing-lights warning · RSVP by Fri 10-23. Leave out "add to Home Screen": that goes on the door sign once push is called (10-24).

---

## 9. The workaround runbook

Every 🩹 item in the checklist points at one row here. **Who** is the role on the night (§10). The full build is in SCHEDULE.md for after the party.

| W | Replaces (WP · checklist ids) | Procedure on the night | Who | Cue / when |
|---|---|---|---|---|
| **W-01** | Identities survive a restart; reload-keep-run (WP-02 part, WP-65 · SW-QR-17, SW-ADM-14) | **Morning of 10-31, before anyone registers: sync, Push draft, check, then Go live in place** (Go live restarts from the running snapshot, so the Push draft is what puts the frozen story on stage; §3). After doors: never Restart, Push draft, Go live or End (each wipes guests). A server *process* restart is safe (journals replay, tokens kept). Fix a story bug live with director fires + Run → World edits | Director | Morning reset → wrap |
| **W-02** | The map belongs to the project (WP-03 · SW-MAP-01, SW-MAP-06) | The surveyed map is the committed show file, bind-mounted via `LOOM_HOUSE` (K-28). Never save in `/reinstall/map` on show day. Delete a stale `spatial-house.json` at the morning reset | Tech op | Morning reset |
| **W-03** | Featured-program claims (WP-04 · SW-PLAY-01) | The invitation tells each featured guest the exact program name; they're asked to arrive in the first wave. The door host knows the 9 names and watches the picker. If a stranger takes one, the director sets `featured` + vars on the right guest in Run → World, and the invitee picks the closest spelling via search (OP-02) | Door host + director | Arrivals |
| **W-04** | Engine scopes, membership, ranking (WP-05 · SW-ENG-01, 02, 04, 05, 08) | The story keeps its per-member watchers, quest catch-up watchers, check-in if-chain and argmax watchers (tested). The hidden-group crafted-join exploit is accepted. Majority hygiene: no Run personas on the live event; N-06 if ghosts block the bar (OP-11) | Director | Y2K |
| **W-05** | INTERACTION 2.0 (WP-06 · SW-ENG-03, SW-AI-07, SW-PLAY-17) | Every button stays visible; hooks ignore wrong-phase presses. Performers learn "the button does nothing out of phase" at the read-through. Guest-on-guest actions happen in person | Performers | 10-25 read-through |
| **W-06** | Timers + show clock (WP-07, WP-26 part · SW-ENG-06, SW-PLAY-05, SW-ENG-18, SW-AUD-03) | The `Night.*_end` watchers fire the timed `!` warnings. Screens show MM:SS from `remaining` (K-17). No phone timer. Every timer is elapsed time, so **DST at 02:00 can't touch the story** | Automatic; director has the manual cue | Bingo, hunts, the hour, summons, Y2K |
| **W-07** | QUESTION key + fuzzy DM judge + full secrecy fix (WP-08 part · SW-ENG-17, SW-AI-20, SW-AI-02) | **`lookup: false`** (sign-off #10). DM lies are filed on the 📝 card (K-24) and judged by a human with the 📝 buttons (N-05) from `# hosts`. Nothing is auto-judged | Second director (filings), Clippy (room) | Hunts + the hour |
| **W-08** | Takeover widget (WP-09 · SW-PLAY-04) | "GO TO THE LIVING ROOM" = the `!` alert (K-06) + push (K-31a/b) + Alexa (K-20) + the `go_to_living_room` overlay (K-17) + the lights. Polls keep the `Night.poll` workaround | Automatic on Combo A/B; director fallback 🪩 | E4/E6 |
| **W-09** | Performer-private channel (WP-10 part · SW-PLAY-12) | Clippy's instructions stay `Clippy Instructions N` codex entries **plus printed CI 1–9 cards**. Booth readouts now chime (N-07). Crew back-channel = radios + a Signal group with call words (§10) | Clippy, all crew | All night |
| **W-10** | Bathroom Mode (WP-11 · SW-PLAY-07, 16, SW-ADM-08, SW-RE-07) | The ☰ "Things you can do" buttons. At each summons the director clears stale `afk` flags in Run → World | Director, Recycling Bin | C1, C2, ⏳ |
| **W-11** | Director push + `notify` (WP-15 part · SW-ADM-11, SW-ENG-15) | The director stays at the laptop (K-29 chimes on a dead kiosk). Personal wake-ups are `!` broadcasts, which push carries (K-31a/b) | Director | — |
| **W-12** | Judging UIs (WP-16 · SW-ADM-07) | Clippy judges in the room with the six per-question buttons. The director can judge from Run: identity control → *be* Clippy → the guest's thread. **First verdict wins by agreement: Clippy in the room, the director only for DM filings** | Clippy, second director | V6, Truth Pong, final reveal |
| **W-13** | Printable tokens + clue scan (WP-19 · SW-QR-04, SW-QR-07) | Print the plain `?code=<event>&unlock=<CODE>` links (K-12); K-10 keeps the event code stable. A photo texted to a friend works: accepted | PAPER | Print batches |
| **W-14** | Badges + cast cards (WP-21 · SW-QR-08, SW-QR-09) | Guests show their in-app pass (`My pass`); name stickers with program + logo. Performers sign in with the prime code + the cast picker on the morning of 10-31, after go-live | Performers | 17:00 call |
| **W-15** | Scoped device tokens, PIN ⚙, map auth (WP-22a/b · SW-QR-10, SW-SCR-20, SW-MAP-11) | House devices use the mod passcode: never printed, only in the machine YAMLs + terminal config, behind Fully Kiosk + the long-press ⚙ (K-15). **Change the mod code on Nov 1** | Tech op | — |
| **W-16** | Media route, video players, media pipeline, precache (WP-25, WP-35 · SW-SCR-04, SW-PLAY-14, SW-RE-04, SW-AUD-02, 10, 11, 12, SW-SCR-25) | WebMD = a looping local MP4 on a second tent device + Julia live + `dm:WebMD` lines (`cue tablet_webmd` = WebMD presses play). QLab plays every file from the TV computer's local disk. Tablets show PNGs only, so nothing to precache. No phone video card | WebMD, tech op | Every capture |
| **W-17** | Remaining templates, Trust Chart board, synced video (WP-30b, WP-31 · SW-SCR-11, 12, 15, 24) | Each becomes a PNG slide (K-17). Trust Chart: a static PNG while Trabolta reads K-26's ranking (K-18). truth.txt is read aloud. The ad hijack is QLab video on the TV (or N-04a); tablets flip to a still ad PNG | Tech op | 📺, 📊, 📄 |
| **W-18** | Songs (WP-32 · SW-SCR-13) | QLab plays the tracks (+ a lyric video on the TV if made). Sandy's line is rendered into the track (P-3); otherwise she is lore (#28). The TV voice stays silent on song beats (N-04b) | Tech op | Endings |
| **W-19** | Room-audio router, sync, resilience, terminal audio roles (WP-36, WP-37 part, WP-38 · SW-AUD-01, 04, 06, 07, 09, HW-AUD-04) | **QLab on the TV computer is the router**: `trapped.house.yaml` already maps every `sound` to OSC `/cue/<name>/start`; each QLab cue is routed to its zones on the 16-out interface (HW-AUD-16). ≤ 3 zones; other rooms hear tablets and phones. WAN drop: QLab keeps playing; the tech op fires cues by hand or from QLab Remote. N-09 only if push is no-go | Tech op | All night |
| **W-20** | Tech rail (WP-41 · SW-SH-04, SW-SH-12, SW-ADM-06) | Eyes on Run → Mind (worker status), the Z2M frontend, the K-29 card and QLab | Tech op | All night |
| **W-21** | Phase map + disclosure + hold lines (WP-43 · SW-AI-03, 05, 06) | The director presses **set stage** on Run → Mind: intro *formal* · C2 *hungry* · 📺 *rattled* · 🏓 *judge* · 🫘 *unravelling* · 🕚 *desperate* · 🌑 *last act* (printed on the cue sheet) | Director | Each phase |
| **W-22** | Tent ↔ shed switch (WP-47 · SW-MAP-13) | Keep `house.json` + `house.shed.json` in the bind-mounted **directory** (`./show-map:/config:ro`, `LOOM_HOUSE=/config/house.json`; K-28). A single-file mount silently keeps the old inode after an editor save or `mv`. To switch: one script, `show-map-switch shed` = `cp house.shed.json house.json` over SSH. **The SSH key and the script live on the tech op's device**, both on the tech card. The server re-reads on mtime, carries sessions over and re-deals the duck. Last resort: load the shed JSON in `/reinstall/map` and save (the saved copy then wins for the night). Move the tent light + speaker. Rehearsed 10-29 in < 15 min | Tech op + WebMD | Weather call 10-29, confirm 10:00 10-31, or mid-show |
| **W-23** | Tent operations (WP-49 · SW-RE-06, 08, 14) | Zip-out runs on the two ROLE watchers. Informal queue in capture order. After 🗜 the tent operator ends live game sessions. More than 6 waiting → the director fires 🗜 early. The duck-speedrun award is timed by hand or dropped (OP-10) | WebMD + director | Captures, 🗜 |
| **W-24** | CeremonyHub, Ceremony tab, phone cards, AI writer, TV template (WP-51 part, 52, 53, 54 · SW-AI-18, SW-AI-19, SW-ADM-12, SW-PLAY-23, SW-SCR-27) | The director steps the awards from the cue sheet (K-25), winner as subject, picked from K-26's recap. **AI lines:** during the final reveal, take the performer lens in Run, paste the recap into `cast:Trabolta`, correct the reply, post each line **as Trabolta in The Desktop** → the TV speaks it. If Trabolta is gone (Combo B / `destroyed`): Clippy hosts and **reads the award lines aloud live**; the TV shows the award slide, which beats attract (K-17). Lines from `uv run stagehand ask --config laptop.yaml` on the laptop (OP-14), K-25's templates as the fallback. A PNG per award; trophies labelled by hand | Second director | After the ending (~20 min) |
| **W-25** | Chess app + full game (WP-56 · SW-CHESS-05, 08) | The Lichess app pinned on the taped phone, **computer at level 2–3** (tuned 10-25). A host or Antivirus who **saw the mate** presses ♟ They beat the machine (K-27); phone dead → the director fires `chess won` (OP-12) | Antivirus, director | From Y2K |
| **W-26** | Phone cue page (WP-58 · SW-ADM-02) | The editor is a desktop shell, so the phone fallback is **the radio** to whoever holds the director laptop. A second signed-in laptop (the second director's own account) is the backup console | Director | — |
| **W-27** | Truthcoin + pickup line (WP-60 · SW-PLAY-08, 09) | Host buttons `pay_truthcoin` / `charge_truthcoin`, ⭐ as the balance, trades in person. The pickup line via the host 💘 `pickup_line_works`, or Trabolta's `the_line_works` in a DM | Hosts, McAfee/CRA | The hour, endings |
| **W-28** | Codex + quest grant UIs (WP-57 part · SW-ADM-04) | Stuck codex → read the guest the code from the printed code list. Stuck quest → fire the story event that advances it. (S4 if slack) | Director | — |
| **W-29** | Guest in-app scanner (WP-20 part · SW-PLAY-06) | The native camera opens the default browser. A guest who joined in another browser → re-pair them into it (N-02). (S3 only if 10-25 shows a pattern) | Director | — |
| **W-30** | Stagehand cue args, `on:` trap, restart catch-up (WP-39/40 part · SW-SH-03, 08, 09, 10) | One-token cues stay; YAML `on:` keys stay quoted (the test checks). No catch-up: after an uplink blip the director re-fires the current lights cue from K-21 (OP-16) | Director, tech op | After any blip |
| **W-31** | Patch-bay scanner, if the bench fails or it flakes on the night (HW-PATCH-*) | **The server-room Antivirus** (stationed there from Y2K) stands at the bay with the combo cheat-sheet and radios "A", "B" or "WRONG"; the director fires 🔌 / 💥 / ❌ from K-21 (OP-13) | Server-room Antivirus + director | Act III |
| **W-32** | Door sensor, if the reed and tape both fail (HW-DOOR-* · HW-DOOR-02) | A Hue Secure contact sensor on Z2M named `server_room_door` (the YAML rule exists). If that fails too, an Antivirus stands at the door and the director fires `server_door_opened` | Antivirus + director | From Y2K |
| **W-33** | Quest APK no-go (HW-TENT-01, SW-RE-01) | The reinstall web game on 2 WebGL2 tablets in the tent (buy 2 if the Quest is no-go, L-15; the WebMD video needs its own device) (`/reinstall/` → Play here, twin sticks); the Quests stay home; the TV mirror still works | WebMD | Every capture |
| **W-34** | Proactive assessments (SW-AI-04) | For a specific top/bottom, edit `<guest>.assessment` **and** `<guest>.trust` in Run → World before 🏆 (OP-08) | Director | Before 🏆 |

### Night-of procedures (OP-xx)

| OP | Procedure | Owner |
|---|---|---|
| OP-01 | **Halloween porch** (HW-SAFE-06): trick-or-treating ≈ 18:00–20:00 and the Mud Room is the front door. Candy bowl + sign ("Trick-or-treaters: take two! This house is a computer tonight"); the Mud Room dim, not dark, until 20:00; invitations say arrive after 8 pm | Door host |
| OP-02 | Featured picks (see W-03) | Door host + director |
| OP-03 | **No restarts after doors** (see W-01) | Director |
| OP-04 | Scanner phones: until N-01 is verified, every door Antivirus uses an Android phone; the typed-id fallback is taught | Tech op |
| OP-05 | **First reinstall timing**: WebMD holds the first captured program at the wizard until the director radios "INTRO", so "Look! That's X!" lands on a live mirror | WebMD + director |
| OP-06 | **Agent load (mandatory)**: the mind runs **paused by default**, thinking off, unless I-8 shows both models fit in RAM; the director resumes it only in quiet windows (after hunt 1, mid-hour lulls). If the voice queue passes 1 min, Clippy announces "Trabolta is processing a high volume of requests". The laptop: `OLLAMA_KEEP_ALIVE=-1`, `caffeinate`, on its charger | Director + tech op |
| OP-07 | **Judging speed**: the answerer holds up their pass; Clippy scans it (opens the card) or taps them in the who's-here strip | Clippy |
| OP-08 | Assessments (see W-34); OP-08b late list: at `summons_closed` read Run's roster `late` column to the Antivirus by radio, or pre-set `Night.auto_sweep = true` | Director |
| OP-09 | **Beans**: Adobe Acrobat radios "BEANS" when the lid lifts; the director presses 🫘 | Adobe + director |
| OP-10 | Tent queue + zip (see W-23) | WebMD + director |
| OP-11 | **Majority hygiene**: no Run personas on the live event (lenses on real guests only); re-pair (N-02), never re-register; at Y2K note the real head count; if ghosts block a clear majority → N-06 | Director |
| OP-12 | **Chess honour**: ♟ only after seeing "checkmate" on the phone. The chess phone sends no heartbeat (K-29 can't see it), so the server-room Antivirus glances at it each act | Antivirus |
| OP-13 | Patch-bay Tier 0 (see W-31) | Server-room Antivirus |
| OP-14 | **Ceremony lines** (see W-24) | Second director |
| OP-15 | **Staffing**: John can't run Run and play Task Manager. A **second director** (with a VPS account and project membership by 10-20), a **tech operator** and a **house manager** are named by 10-20 and trained on 10-25 (SW-OPS-22) | You |
| OP-16 | **Uplink**: LTE failover; QLab is local so audio + lights hold their last look; after a blip re-fire the current lights cue (K-21) and check the K-29 card | Tech op |
| OP-17 | **Clock budget**: the story runs ≈ 4 h 45 m from C1 (Bingo 30 · intro + hunt 1 35 · truth 20 · ad + hour 65 · summons + pong 25 · trust/printer/zip 25 · overshare 10 · Y2K hour 60 · ending 20 · ceremony 20). **Fire C1 by 21:00** to end ≈ 01:45. Optional set pieces (☎️ Telephone, 🪅 Are you sure?) only if early | Director |
| OP-18 | **Late arrivals after C1**: the Antivirus door duty ends at C1, and Clearance needs an Enforcer scan. When the roster shows *uploaded, not cleared*: Run → Inspector → **scan as Norton** (`POST /api/mod/scan {as: "Norton", target}` routes to the Clearance beat). The door sign after 20:30 says "ring and wait"; the house manager radios **ARRIVAL** | House manager + director |
| OP-19 | **A performer loses their phone**: phone at 30% → the charging station (power banks, A-16); dead or broken → the director **releases the part** (N-10) and the performer re-signs on a loaner with the prime code + cast picker in < 60 s | Director |
| OP-20 | **`ALL STOP`** (radio): admin cue "Restore the house lights" (`restore_the_lights`) + QLab panic (Esc) + TV voice mute, then the wall switches (the safety bulbs come back ON). The house manager leads people; the tech op stays at the TV computer | Anyone calls it; tech op + house manager act |
| OP-21 | **Show-night backups**: the 10-min off-box job (K-08) runs 19:00–03:00 to the house laptop; the tech op checks the newest file each act. VPS dead → start the warm standby, restore the newest copy, repoint DNS | Tech op |

---

## 10. Night-of crew + cheat-sheets

**Minimum crew:** 1 director at Run (the **second director**, since John plays Task Manager) + 1 **tech operator** (not in the story, stays at the TV computer) + 1 **house manager** (not performing) + Clippy + 3–4 Antivirus (one **stationed in the server room from Y2K**) + 3 hosts + WebMD + a **tent assistant / VR spotter** if the Quest is a go + a door/porch person until ~20:30 (Recycling Bin). Names for the three new crew roles by **Tue 10-20**.

The **house manager** is the only free pair of hands: door host from 20:30 and the late arrivals (OP-18), the loaner phones and re-pair runner, **the safety lead during the blackout** and any `ALL STOP` (OP-20), the 911 caller and the neighbour liaison.

Every role gets **one laminated card** (D-01 drafts, PAPER prints in batch 2). What's on each:

| Card | Holder | On the card |
|---|---|---|
| **Director** | Second director (John covers off-stage moments) | Screen: Run → Director (cue sheet), Run → Mind in a 2nd tab, the K-29 card, `# hosts` for 📝 filings. **Cue order:** C1 → V2 → V3 → Clippy 2/X (radio "INTRO" first) → V4/V5 → (auto C2) → V6 → 🎩 → 📺 → 📓 → (auto 📥 ⏳ 🚨) → 🏓 → 🧮 → 📊 → 🏆 → 🫘 → 🗜 → 🤖 → 🕚 → (auto majority / N-06) → door/patch (or Tier 0) → 🏍 or 🪦 (or auto 🌑) → 🍎 → 📄 → endings → ceremony. **Set stage** clicks (W-21). **Judge only DM filings** (📝 buttons). **Never** Restart / Push draft / Go live / End after doors, no personas. Keep the Run tab in the foreground (a background tab throttles the K-29 chime). Fixes: stuck codex → printed list · stuck quest → fire the event · stale `afk` → World · ghost majority → N-06 · dead chess phone → `chess won` · dead bay → OP-13 · lost guest → **N-02 re-pair QR** · **late arrival → Inspector → scan as Norton (OP-18)** · **performer lost → Release (N-10, OP-19)** · mute the TV voice → K-29 card · `ALL STOP` → 💡 Restore the house lights (OP-20) |
| **Tech operator** | New crew | Boot list: TV computer (Chrome `view=tv` kiosk, QLab show file + routing, Mosquitto, Z2M, stagehand `show` launchd, the K-20 script), the Ollama laptop (`agents` launchd), router dual-WAN, UPS. Watch: Z2M frontend, stagehand log, K-29, QLab. Recovery: stagehand restart → re-fire the lights cue · worker crash → `uv run stagehand run --config laptop.yaml --only agents` · Ollama env (`OLLAMA_KEEP_ALIVE=-1`, `MAX_LOADED_MODELS` per I-8, `caffeinate`) · hung terminal → tap / Fully Kiosk reload · **after a TV computer reboot, click once into the TV page** (autoplay) · WAN down → failover, QLab carries on, **no Act III automation** → Tier 0 · Z2M coordinator dead → the restore steps onto the spare dongle (≈ 10 min if the backup restores, else wall switches) · TV computer dies → **the backup-Mac swap** (USB-C → HDMI, QLab file pre-loaded) · router dead → the ISP router (same SSID/PSK) · the shed switch: `show-map-switch shed` over SSH from this device (W-22) · VPS dead → OP-21. Owns: the blackout safety check (with the house manager), the ad-hijack video, the show-night backup check (OP-21). **Never `pkill -f "stagehand run"`** |
| **Clippy** | Brooke | Buttons by phase: 🎱 + 🎀 (V3) · ✅/😤 Q1–3 + 🤷 (V6) · 🎩/🙅/✅/😤 (Truth or Dare) · ✅/😤 Q1–2 (final reveal) · 🍎 · 💘. **Q numbers are within the round** (H1–H3 · H4–H6 · F1–F2). Accurate and confident-lie look identical in public. Judge by scanning the answerer's pass. Cues to perform: C1 welcome, Bingo rules, Corrupted Code, the Trabolta intro, **panic at the ad (CI 4)**, beans = malware, final reveal, Purgatory (CI 9), host the ceremony after `destroyed`. Printed CI 1–9 cards |
| **Antivirus** | Norton (Julie), Password Manager (Francine), CRA Agent (Emma), McAfee (if cast) | One Antivirus is **stationed in the server room from Y2K**: the patch-bay watch (W-31 / OP-13, combo sheet + call words), glances at the chess phone (OP-12), keeps guests off the real gear. **Door duty** until C1: booth → Scanner → 📷 the pass (Android until N-01 is verified; type the id if the camera fails). Buttons: 🛡 Send to the Internet (any time) · ✅ Mark as reinstalled · 📍 Checked in · 🪙 Pay/Charge (McAfee/CRA) · ♟ only after **seeing** the mate. Norton: the selected Antivirus at V3 (interrupt the centre square). Password Manager: logs faction joins at Y2K. Sweeps: C1, C2, ⏳, the late list, Trabolta's sweep requests, 🚨 server breach, 🗜. **Blackout: guide people to the living room; the stairs stay lit** |
| **Hosts** | Task Manager (John), Adobe Acrobat (Stephanie), Recycling Bin (Jesse) | Task Manager: 🃏 for MS Paint if no Bingo (V3); the Truthcoin bank. **Adobe Acrobat: pong judge** (🏓 + ✅/😤/🤷), then by the printer (radio "BEANS"), holds the Bag of Truth + a dry truth.txt, 🍎 with Clippy. Recycling Bin: door/porch until C1 (featured-name watch, OP-01/02), Disk Cleanup attendant. All: 💘 in Grok Prom, 🎀 ribbons |
| **WebMD / tent** | Julia (+ a tent assistant if the Quest is go) | Tablet `/reinstall/` → scan the pass → Play here (or Send to VR-1 if the Quest is go: **seated**, snap turn, the assistant spots, wipe the headset between players). **Hold the first program until "INTRO"** (OP-05). Loop the WebMD video on the 2nd device; perform the script live. ✅ Mark as reinstalled if the game won't finish; after 🗜 end live sessions. Rain/wind → the shed move list |
| **Door / porch** | Recycling Bin until ~20:30, then the house manager | The 9 featured names; candy bowl; the Mud Room stays dim; point arrivals at the door QR; loaner phones + the charging station. **Guest FAQ:** how to rejoin (the director re-pairs you), loaner phones, the iPhone Home Screen steps (if K-31b passed); after 20:30, "ring and wait" + radio ARRIVAL |
| **House manager** | New crew (not performing) | Door from 20:30 + late arrivals (OP-18) · loaners + re-pair runner · **blackout + `ALL STOP` safety lead** (OP-20): guide people, the stairs stay lit, headlamp on · 911 + neighbours · the emergency card |
| **Performer** (every booth) | All performers | Push set up (Android tap / iPhone Home Screen); **phone at 30% → the charging station; phone dead → see the director (N-10 release, OP-19)**; buttons do nothing out of phase (W-05) |
| **Patch-bay watch** (Tier 0 only) | Server-room Antivirus | The two combo strings (canonical V-order), "A / B / WRONG" call words |
| **Emergency card** | At the door + on every crew card | The civic address, 911, the nearest ER (QEII Halifax Infirmary; check the address), where the extinguisher and first-aid kit are, `ALL STOP` |
| **Radio call words** | Everyone (radios with earpieces) | INTRO · BEANS · LATE · A / B / WRONG · ALARM · LIGHTS · HOLD · **ARRIVAL** · **ALL STOP** |
| **IP sheet + one-page runbook** (SW-OPS-09) | Taped in the server room | Every device's IP, the recovery steps above, the mirror-view fallback URL, the rollback command |

---

## 11. Show day: call times + pre-show checklist

**Sat Oct 31.** Sunset ≈ 18:10 ADT, typically 4–11 °C, wind and rain common. Trick-or-treating ≈ 18:00–20:00. **DST ends 02:00 Nov 1**: the story uses elapsed time and doesn't care; the backup cron runs in UTC; tell the crew the wall clock jumps back, and **plan rides home** (transit is thin after 01:00).

| Time | Who | What |
|---|---|---|
| 10:00 | Director + tech op | **Tent/shed confirmation** from the forecast (**gusts > 30–40 km/h** or steady rain → shed, W-22). **Morning reset**: sync, **Push draft**, check the door QR on cellular, then **Go live in place** (W-01), before anyone registers |
| 12:00 | Set crew | Final set dressing, tent pitched or shed set, glow tape checked |
| 15:00 | Tech op | Boot everything (tech card); systems check below |
| 17:00 | **Performer call** + house manager | Costumes; phones charged; booths signed in **after go-live** with the prime code + cast picker; push subscribed (K-31a, iPhones via K-31b); a test `!` alert to staff; walk the stations |
| 18:00 | Door host | Porch set (OP-01); Mud Room dim; pre-show checklist signed off |
| 19:00 | Everyone | Food + 15-min briefing: the blackout rule, call words incl. **ALL STOP** and **ARRIVAL**, the emergency card, "never restart". Tech op starts the 10-min backup job (OP-21) |
| 19:45 | Everyone | Places. Lights to screensaver |
| **20:00** | | **Doors** (rolling arrivals; featured guests first wave) |
| **≤ 21:00** | Director | **C1** (OP-17) |
| ≈ 01:45 | | Ending + ceremony done |

**Pre-show checklist** (the director ticks it, K-08 prints it):

1. Deploy is the pinned `loom:show-1031`; the previous image is still on the VPS; **the warm standby exists (stopped)**; the 10-min off-box backup job is armed for 19:00 (OP-21); uptime alerts reach the tech op + second director.
2. **Sync + Push draft, then Go live in place, done before any registration**; codes are the printed ones (scan the door QR from a phone on cellular).
3. `spatial-house.json` deleted; `house.json` in the bind-mounted directory is the tent or shed variant chosen at 10:00 (`show-map-switch`).
4. Trabolta: worker connected (Run → Mind status), **mind Reset**, `lookup: false`, thinking off, **mind paused** unless both models fit (OP-06); the laptop on its charger with `caffeinate`; he's hidden and asleep.
5. Terminals: every tablet green on K-29, on `view=auto` showing attract; the TV on `view=tv` showing the screensaver, **clicked once after its last boot**.
6. Lights: Z2M + WLED up; `lights_screensaver` look on; one `lights_blackout` test: the stairs, bathroom, tent, server room and the path to the living room stay lit, the tube strip dim; battery path lights armed; the spare dongle + Z2M backup on the shelf.
7. Door + bay: reed reads open/closed in the stagehand log; the ring shows locked; the patch bay is all unplugged (reset).
8. Audio: QLab show file open, one test cue per zone at show level; the Alexa script running.
9. Push: the staff test alert arrived on every performer phone.
10. Tent: tablet charged and on `/reinstall/`, WebMD video loaded on the 2nd device, Quests charged (if go), heater on its GFCI leg, EXIT sign on.
11. Chess phone pinned to Lichess, charging. Bean printer button paired.
12. Print: codex posters up + clue props hidden (photos match), check-in signs up, Bingo cards + pens, hat slips, trophies, cheat-sheets.
13. Safety: first aid + extinguisher placed, egress clear, glow tape, GFCIs tested (A-18), no strobe > 3 Hz, the server door opens freely (no lock rules in the YAML), the patch-bay gear taped off, the emergency card posted at the door.
14. Loaner phones (2–3) charged; the guest charging station live; power banks charged for every performer; radios charged with earpieces.
15. The backup Mac is on, with the QLab file + media, next to the TV computer with the HDMI adapter; the ISP router is boxed nearby as the cold spare.

**Safety one-pager** (walked Fri 10-30, re-checked at 18:00):

- **Light.** Neither the blackout nor Trabolta's `cut_the_lights` darkens the stairs, bathroom, tent, server room or the server-room → living-room path. Trabolta can't cut The Cloud (backyard); the kitchen only dims to ≈ 20%. The tent-path flood is on a plug in no group. The safety bulbs are `power_on_behavior: on`, so a wall switch always brings them back. Battery motion lights on every stair and path. Glow tape on every step. Staff carry headlamps.
- **Flashing.** Every flashing preset is ≤ 3 Hz (stopwatch-timed 10-22). No full-field saturated red. The finished media passed **PEAT**. A warning is on the invitation and the door.
- **Power.** Everything outdoors or near water is on a GFCI (tested), with **12 AWG** outdoor cords fully uncoiled, drip loops, and connections in a dry box off the ground. The radiator runs on low, ≥ 1 m from the fabric, on its own circuit (the breaker map is taped by the panel). LED PSUs are closed and fused per branch, off carpet. **No combustion heaters in or near the tent.**
- **Weather and tent.** Move to the shed on gusts > 30–40 km/h. VR is played seated with a spotter.
- **Doors and gear.** The server-room door is never locked: no lock rules exist. The real gear is out of guests' reach.
- **Fire.** First aid + ABC extinguisher near the PSUs and the TV computer. LED candles only. The Tube fabric is flame-retardant. A towel + mat under the bobbing tub, away from the stairs.
- **Outside the house.** Trick-or-treaters never wander into a dark Mud Room. The backyard (Z3) goes quiet late (Truth Pong ≈ 23:30), and the neighbours have been told. Rides home are planned; the clock falls back at 02:00.

---

## 12. Risk register

| Risk | Early sign | Fallback on the night | Rehearsed |
|---|---|---|---|
| **House uplink (WAN) lost** | K-29 cards red; stagehand log disconnects | LTE failover on the GL-MT3000 (tethered phone, a plan that allows tethering, L-18). Guests are on cellular and keep playing. QLab is local, so audio + lights hold their last look. **But no Act III automation fires while the WAN is down**: door → alarm, patch combos → blackout and Alexa all go ESP32 → stagehand → VPS → story → back. Stagehand + the worker reconnect (K-05); re-fire the current lights cue (OP-16). Any outage that lasts past the failover → Tier 0 (W-31/W-32), QLab by hand, Z2M frontend scenes by hand | WAN pull 10-28 |
| **VPS down** | The uptime check pages **the tech op and the second director** (John is on stage) | `docker compose restart` (journals replay; tokens kept). Bad deploy → the one-command rollback (K-08). Host dead → start the **warm standby** (built 10-30, stopped), restore the **newest 10-min copy** from the house laptop (OP-21; last night's backup predates the show), repoint DNS (TTL 300 s) | Restore drill 10-21 |
| **Trabolta's model / worker down** | Run → Mind shows the worker offline | **Guests do NOT get the hold line automatically**: the hold line comes from the worker's `when:` gate, and with no worker `AgentHub` queues each request silently for up to 10 min, then drops it (`agents.ts:776`), so guests and terminals get silence. The tech op restarts `--only agents`; the laptop never sleeps (`caffeinate`, charger, `OLLAMA_KEEP_ALIVE=-1`). If #35 is yes: start `agents.fallback.yaml` (the same persona on a hosted OpenAI-compatible endpoint, from any laptop). If N-11 is built, the hub posts the hold line after 20 s. Else: scripted story lines still play; the director answers key DMs as Trabolta from Run; Clippy's "high volume" line; the TV plays the pre-rendered speeches (P-3) | 10-25 |
| **Agent overload** (30 guests at once) | Voice queue > 1 min | OP-06 (mandatory): the mind paused by default, thinking off; one Ollama = 60–180 s for 30 DMs, and each voice ⇄ orchestrator swap reloads for ≈ 25 s unless both models fit (I-8); Clippy's "high volume" line | K-04 burst test |
| **Kokoro slow or down** | TV lags > 3 s | The TV falls back to Chrome's voice (its Chrome runs with `--autoplay-policy=no-user-gesture-required`; after any reboot someone clicks once into the page, or it stays silent). N-12 (Kokoro on the TV Mac) if built. **The tablets may have no browser voice at all** (Fully Kiosk's WebView, K-02): for them the pre-rendered P-3 files are the real fallback. Kokoro has a `cpus:` limit so it can't starve the event server | 10-25 |
| **TV computer dies** (one box runs the TV, QLab, Mosquitto, Z2M, stagehand) | Screen black, lights frozen | UPS + never-sleep prevent most of it; drinks kept away. Reboot (launchd brings everything back; one click into the TV page). If dead: **the named backup Mac**, pre-loaded with the QLab workspace, media and pre-rendered files, goes onto the TV's HDMI via the USB-C adapter and opens Chrome `view=tv`; lights hold their last look and the blackout is skipped (the director narrates); door/bay Tier 0 | 10-28 (reboot test + swap) |
| **Quest fails** | 10-22 call, or a headset dies | W-33: web game on 2 tablets in the tent | 10-25 / 10-29 |
| **Patch bay not finished or flaky** | 10-22 bench fails; double fires | W-31: crew watches, director fires `patch_combo_a` / `patch_combo_b` / `patch_rejected` from Run | 10-28 |
| **Door sensor flaky** | False alarms on reconnect | `edge: true` + ignore-retained (K-05). Else W-32: Hue Secure contact, else an Antivirus at the door and the director fires `server_door_opened` | 10-22, 10-28 |
| **Push not working** | 10-21 Android check or the 10-24 call fails | `!` alerts in the app (K-06) + Alexa (K-20) + screen overlays (K-17) + Antivirus patrols + Clippy's "keep Trapped open, screen on" + N-09 (terminals speak) if built | 10-25 phones in pockets |
| **Old tablets fail** (no WebGL2, crash, sleep) | K-02 tags; K-29 red | Face view (K-14); Fully Kiosk restart on crash; the spare tablet; heartbeat alerts the director | 10-28 |
| **iPhone Antivirus can't scan** | N-01 not verified | Android phones at the door (OP-04); type the id | 10-25 |
| **Guest loses their session** | A guest at the director asking | N-02 re-pair QR in < 30 s; a loaner phone | 10-25 |
| **Ghost guests block the majority** | Y2K head count < `count(Persons)` | N-06 `force_majority_stay` / `force_majority_leave` (OP-11) | 10-29 |
| **Restart / End pressed by mistake** | Everyone's phone shows the join screen | Prevention: only the two director consoles are signed in (the director's laptop + the second director's own account as a backup console); the cheat-sheet says never. If it happens: everyone rescans the door QR and re-picks their program; the director replays the current phase cue and restores key vars in Run → World. Expensive, survivable | Briefing |
| **Hunt answers leak through Trabolta** | A DM where he states an H-answer | `lookup: false` + K-23 + the secrecy test; the director mutes or pauses the mind | K-23 test |
| **Weather** | 10-29 forecast | Shed (W-22), decided 10-29, confirmed 10:00 | 10-29 drill |
| **Trick-or-treaters in the dark Mud Room** | 18:00–20:00 | OP-01 porch | 10-30 |
| **Staffing gap** (John double-cast) | No names by 10-20 | Second director + tech op (OP-15); else cut John's Task Manager lines to a host | 10-25 |
| **Wrong URL / code on the prints** | K-07 | Codes pinned (K-10); the test sheet on cellular before batch 1; never press End | 10-21 |
| **Blackout unsafe** (stairs dark, strobe) | 10-22 rehearsal | Today's YAML darkens the stairs: `lights_blackout` hits `house` + `wled/all`, and the `tube` group is the hall + stair landing. K-05 takes the safety rooms out of `house` and turns WLED off per device; `power_on_behavior: on`; battery path lights; presets rebuilt ≤ 3 Hz; `ALL STOP` (OP-20); the house manager leads | 10-22, 10-28 |
| **Video on the TV doesn't layer** (QLab over Chrome) | 10-25 | N-04a (TV plays the MP4); else the PNG still + the jingle | 10-25 |
| **Featured name taken by a stranger** | Door host sees it | OP-02 | — |
| **Software slips past 10-27** | Any lane behind at 10-23 | The cut order (§13) | — |
| **The show runs a stale story** | `stale: true` on the event; a fixed bug reappears | Evening sync + Push draft 10-16 → 10-30; morning sync + Push draft + Go live on 10-31 (§3, W-01) | 10-30 evening, 10-31 morning |
| **The server can't keep up** (≈ 62 clients; a full snapshot per client per step) | K-32 p95 > 1 s, CPU > 70% | Coalesce guest + booth snapshots to ≤ 2/s (10-24 buffer); K-22 for house clients; 8 vCPU VPS | K-32 10-23 |
| **Door rush locks out house Wi-Fi** (one shared IP) | 429s on registration at 20:00 | K-11's env-raised limits; guests on cellular | 10-25 |
| **Merge conflicts across lanes** (`event-runtime.ts`, Run/Inspector) | A lane's rebase fails in the evening | Routes in `core/server/routes/<id>.ts`; merge order B → A → C → D; rebase before hand-in (§3) | Daily |
| **Router dies** | Every house device drops at once | The ISP router as a cold spare with the **same SSID/PSK**; the TV computer's IP is set on the machine and hard-coded in the ESP32 firmware (no DHCP dependence); the ISP modem/ONT on the UPS | 10-28 |
| **Z2M coordinator dies** | Z2M frontend shows the bridge offline | Swap in the spare dongle (same model) + restore the `data/` backup (tested 10-23). If the restore fails, re-pairing takes ≈ 1 h: wall switches for the night (the safety bulbs come back ON) | 10-23 restore |
| **Director laptop dies** | Run gone | The second director's own signed-in laptop (a project member since 10-20); the printed cue order | 10-25 |
| **A performer loses their phone** | Booth dead; "Clippy can't sign in" (409) | N-10 release + re-sign on a loaner in < 60 s (OP-19); power banks at the charging station | 10-25 |
| **Late arrivals stuck in the Mud Room** | Roster: *uploaded, not cleared* after C1 | OP-18: Inspector → scan as Norton; "ring and wait" sign | 10-29 |
| **Tent ↔ shed switch does nothing** | The duck stays in the tent map | Directory bind mount + `show-map-switch` (W-22); last resort: save the shed JSON in `/reinstall/map` | 10-29 drill |
| **Chess disarm unwinnable** | Nobody beats the phone | Lichess at level 2–3, tuned 10-25; else a host who saw the game presses ♟, or the director fires `chess won` | 10-25 |
| **Physical injury** (stairs, tent, kitchen, VR) | — | The safety one-pager (§11); the house manager is the safety lead; the emergency card (911, QEII Halifax Infirmary); first aid kit | 10-28 `ALL STOP` drill |

**Open decision #35 (needed by 10-21, for K-04): may guest DMs to Trabolta go to a hosted model as a fallback?** If yes, `agents.fallback.yaml` points the same persona at a hosted OpenAI-compatible endpoint that any laptop can run, as zero-code insurance if the Ollama laptop dies. It does send guests' DM text to a third party. **Default if unanswered: no.** Build N-11 instead (the hold line from the hub), and the director answers key DMs.

---

## 13. Cut order if we slip

Cut from the top. Each cut is **revert or switch off**, never half-ship. Decide at the end of each day from 10-23 on; anything not verified by **10-27 18:00** is cut automatically.

| # | Cut | Saves | Fallback |
|---|---|---|---|
| 1 | Optional items (N-09, N-11, N-12, N-04a, S3, S4) | 0.25–2.25 | Never started unless slack |
| 2 | K-26 recap endpoint | 0.5 | The director reads numbers off Run → World into the ceremony |
| 3 | K-29 heartbeat card | 0.5 | The tech op walks the tablets each act |
| 4 | K-19 Kokoro on the VPS | 0.5 | Chrome's voice on the TV (N-12 if there's a quarter day) |
| 5 | K-20 Alexa script | 0.5 | Pre-rendered Alexa files played from QLab (P-3) |
| 6 | **K-31b**, iPhone push (conditional anyway: not started unless K-31a is green 10-21) | 2.0 | Android + booth push; iPhones keep the app open, screen on |
| 7 | **K-31a**, push entirely | 1.5 | The "push not working" row in §12; build N-09 instead if there's half a day |
| 8 | K-25 ceremony beats | 1.0 | Clippy hosts the awards by hand from a printed script with the trophies; the TV voice is idle (**weakens #26**) |
| 9 | K-30 Quest | 1.5 | W-33 (decided 10-22 anyway) |
| 10 | K-28 measured map | 0.5 | The placeholder map: the game still works, it just isn't this house |
| 11 | K-13 room check-in | 0.75 | Antivirus scan + the 📍 button at summonses (**drops an explicit ask**) |
| 12 | K-18 TV voice | 1.5 | The TV shows the face + slides; QLab plays pre-rendered speeches at the scripted moments; DMs stay text (**weakens #13**) |
| 13 | K-17 overlays + slides | 1.5 | Tablets on attract/auto; the tech op runs the slides on the TV as a Keynote deck by hand |
| 14 | K-24 File a fact | 1.5 | DM lies don't count (**contradicts #33**); hunt answers only in the room |
| 15 | K-21 cue sheet | 0.75 | The raw Events dropdown + the printed cue order |

**Never cut:** K-01 (public HTTPS), K-04 (Trabolta live), K-05 (house link + the safe-light edits), K-06 (alerts), K-07 (test sheet), K-08 (freeze/backups/show-night copies), K-10 (pinned codes), **K-16 (Trabolta hidden on terminals: secrecy, #32)**, **K-23 (hunt-answer secrecy)**, **K-32 (load test)**, N-01 (iPhone door scan), N-02 (re-pair), **N-10 (release a performer)**. If one of these is at risk on 10-23, take time from the bottom of this table.

---

## 14. Wrap (Sun Nov 1)

1. Backups: `pg_dump` + the `loom-state` tar off the VPS; Run → Export (`loom-run/1`) for the archive (SW-ADM-09, SW-OPS-16).
2. **Change the mod passcode** (W-15) and rotate anything printed.
3. Archive the ceremony script, recap JSON and photos; return the deposit-box items; `lights_restore`; end the event.
4. Tear-down: tent, cords, GFCIs, tablets back to their owners (factory reset borrowed ones).
5. A one-hour retro with the crew → re-plan [`SCHEDULE.md`](./SCHEDULE.md) for the next run: every 🩹 and 💤 item in the checklist is the backlog, and everything built here counts as done.

---

## 15. How this doc stays honest

- **Tick `🎃` items in the checklist** in the PR that lands them (the usual ✅ rules), and tick the acceptance line in §5 with the device it was checked on.
- **Re-date the checklist's "Last reviewed"** at every gate in §2.
- A cut moves its checklist tag from 🎃 to 🩹 with the fallback named.
- The inputs behind this plan were three working passes on 2026-10-15: a triage of every WP (K-xx ids), a Halifax hardware + production plan (I-, D-, A-, L-, B-, P- ids) and a show-runner walk-through (N-xx, OP-xx). Two conflicts between them were settled here: the Quest software time-box ends 10-20 with the final call at the 10-22 bench gate, and the pre-rendered Alexa/Trabolta files are the **fallback**, not the plan, since K-18/K-20 are built.
- **Revised 2026-10-15 evening by two critic passes.**
  - A capacity review, checked against the code: K-31 split into a/b, re-estimates, K-32, merge order + route files, the Push-draft rule, the door-rush limits, client-side print QRs, the `widgetResultArgs` exemption.
  - A show-safety review: N-10, the safe-light YAML, no lock rules, ≤ 3 Hz presets, Lichess level 2–3, the house manager, `ALL STOP` / `ARRIVAL`, OP-18…21, show-night backups + warm standby, and the risk rows for the router, coordinator, director laptop and backup Mac.
  - The committed total went from 26.75 to 27.6 lane-days, plus 2.0 conditional for K-31b.
