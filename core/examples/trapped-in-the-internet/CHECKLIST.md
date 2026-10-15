# Trapped in the Internet: the tech checklist

Everything, software and hardware, that has to be true on the night for the story in
`Trapped In The Internet story/` (STORY BEATS, Story Overview, Character Sheet, Clippy
Instructions) to run in this house. It came from a full audit of the codebase against the
story on 2026-10-14 (commit `6884a96`) and from the rewrite spec, kept next to the story as
[`DESIGN.md`](./DESIGN.md) ("spec §N" below; its §8 print appendix and §9 runbook live in
[`README.md`](./README.md)). The rewrite itself (section 0) is done in the working tree but
not yet committed.

**Last reviewed: 2026-10-14** (after three review passes: claims, coverage, hardware) · reviewer: `@__`

**Counts:** **239 items** (174 software, 65 hardware) · **P0 79 · P1 111 · P2 41** (+8 ✅ baseline items with no priority) · **✅ 15 · 🟡 23 · 🔴 201**. Not counted: the 20 SW-OPS-07 dress-rehearsal checks, the BOM table rows, and the 34 decisions. Recount after every edit (`- [ ] **ID** <status> <priority>` lines).

## How to keep this living

- **Tick boxes in the PR that does the work.** Flip `- [ ]` to `- [x]`, change the status
  emoji, and append the PR or commit (`— #123` / `— 1a2b3c4`). An item is ✅ only when it is
  merged **and** verified (a test that runs it, or a live run on real devices, noted inline).
- **Never renumber.** Ids are stable (`SW-SCR-01`, `HW-DOOR-02`, …). New items take the next
  free number in their section. A dropped item stays, struck through, with a reason.
- **Owners:** replace `@__` with initials when someone picks an item up.
- **Re-date the "Last reviewed" line** whenever you walk the whole list (at least weekly
  until the party, and after every rehearsal).
- **Paths** are relative to `packages/loom/` unless they start with `./` (this folder).
  Line numbers are as of `6884a96` and drift; the file + symbol is the stable part.

### Legend

| Mark | Meaning |
|---|---|
| ✅ | Exists **and** verified (a passing test or a recorded live run, cited) |
| 🟡 | Exists but unverified live for this show, or only partly there / workaround only |
| 🔴 | Missing: needs new code, content, a purchase or a build |
| **P0** | The party cannot run without it |
| **P1** | Big loss of the designed experience if missing |
| **P2** | Polish / stretch |
| **S / M / L** | Size: S ≤ half a day · M ≈ 1–3 days · L ≈ a week or more |

Item line format: `id status priority · size · owner — what, and the story moment it serves → where to change it`.

---

## Critical path: do these first, in this order

1. **SW-QR-01** Fix the printed-QR base URL (`joinBase` ignores `LOOM_BASE_URL`), before anything is printed.
2. **SW-OPS-01 / SW-OPS-02** Decide LAN laptop vs VPS, then get real HTTPS working there. The camera, wake lock, Web Push and the Quest's network access all depend on it, and so does every printed URL.
3. ~~**SW-STORY-01..05, 07..10, 12** Finish the `.loom` rewrite and its tests~~ — done in the working tree 2026-10-14 (all suites green). **Left:** commit it, **SW-STORY-06** push it to the live preview, run the two e2e-live specs (SW-STORY-04 / 08), and wire `loomcheck` into CI.
4. **SW-MAP-01** Make the house map a project file *before* anyone spends hours surveying. Today a save lives in one event's state dir and is lost on End → relaunch.
5. **SW-MAP-02 / SW-MAP-07** Measure the house: real rooms, the **Server Room**, the tent, the Truth Pong table and every terminal mount. Then run `pnpm house:sync` and `pnpm test:vr`.
6. **SW-PLAY-01** Featured-program claims, so only Rob can be Microsoft Excel and the Trojan Horse clowns can share one program.
7. **SW-SCR-01** Terminal attract mode before Trabolta exists: no "TRABOLTA ONLINE" and no piloting into `dm:Trabolta`. Until it lands, follow **SW-SCR-02** (the `view=mirror` runbook).
8. **SW-SH-01 / SW-SH-02** Finish and commit `stagehand/trapped.house.yaml` and its cross-check test (both written, untracked, 12 tests green): add the reed-switch and door-indicator rules, a `blackout` group that spares the stairs, bathroom and tent, then verify on the real rig.
9. **HW-DOOR-01..05 + HW-PATCH-01..07** Build the server-room door sensor and the patch-bay scanner, and bench-test them against stagehand. Use the MQTT topics in this file, which match the YAML (`sensors/patchbay/state`, `sensors/serverroom/door`, `show/serverroom/lock`).
10. **SW-SCR-03 / 05 / 06 / 14** A minimal Screens layer: a cue bridge, the screensaver, the blackout and "GO TO THE LIVING ROOM" takeover, plus countdowns (**SW-SCR-09**).
11. **SW-PLAY-03 / SW-PLAY-04 / SW-PLAY-02** Performer alerts, the phone takeover, and Web Push, so locked phones hear the summons.
12. **SW-QR-02 / 03 / 11 / 14** Pinned codes, a redeem throttle, and the Run → Print page. Then print a test sheet and scan it on cellular data.
13. **SW-RE-01 / 02 / 03** The first real Quest APK, the first real tablet run, and a live re-run of the review-round fixes.
14. **SW-OPS-06 / 07** A full dress rehearsal with friends, following the checklist at the end of Ops.
15. **SW-OPS-11 + HW-SAFE-01..05** Code freeze and a pinned production deploy; the safety walk (darkness, strobes, mains, outdoor power) before guests arrive.

---

# SOFTWARE

## 0. The story rewrite (content in this folder)

- [x] **SW-STORY-01** ✅ P0 · L · @__ — Write the new `.loom` set per spec §1 — **done**: 29 files (86 beats, 132 codex entries / 41 codes, 16 quests, 74 rules), `pnpm --filter @loom/core loomcheck examples/trapped-in-the-internet --smoke` → 0 errors, 0 warnings. (`atmosphere.loom`'s generators bark into the lobby only; the Mud Room cutscene renders just the guest's own `personalStream`, so they never reach it.) → `./*.loom`
- [x] **SW-STORY-02** ✅ P0 · M · @__ — Rewrite `core/test/trapped-in-the-internet.test.ts` per spec §6.1 — **done**, incl. the critics' additions, a secrecy test on a real `EventRuntime`, and 15 regression tests from the verify pass; core suite 731/731.
- [x] **SW-STORY-03** ✅ P0 · S · @__ — Update `core/test/identity.test.ts` (featured programs → guest picks, new performer parts, no MalwareBytes) and keep `core/test/spatial.test.ts` green — **done** (both pass).
- [ ] **SW-STORY-04** 🟡 P0 · S · @__ — Rewrite `./trabolta.persona.md` + `./trabolta.mind.md` (spec §4.6) — **done**; stagehand `test_agents.py` / `test_debugger.py` updated (166 pass); `editor/e2e-live/mind.spec.ts` edited to `Trabolta.awake` / `'asleep'`. **Left:** run that live spec once against a real worker.
- [x] **SW-STORY-05** ✅ P0 · S · @__ — `./house.json` bathroom → `"Disk Cleanup"`, `LOCATION The Server Room` declared without geometry, `pnpm house:sync` — **done** (house 122/122). Geometry is SW-MAP-07.
- [ ] **SW-STORY-06** 🔴 P0 · S · @__ — Push to the live preview: `pnpm dev --only server --no-build --sync "<project>"` (`core/scripts/sync-example.ts` also deletes removed files). Then delete the preview event's stale `LOOM_STATE_DIR/<event>/spatial-house.json`, and press Reset on Run → Mind (or start the worker with a fresh `state_dir`), or the old "lonely grandeur" mind survives.
- [x] **SW-STORY-07** ✅ P1 · M · @__ — Rewrite `./README.md` (runbook, cue sheet with C1/C2/V1–V6 codes, endings, codex tiers, quests, Trabolta's arc + powers, casting, integration contract, print appendix) — **done**.
- [ ] **SW-STORY-08** 🟡 P1 · S · @__ — Refresh the docs that quote the show — **done** for help articles 35/36/37/44 + play 09/11, `docs/loom-show-control.md`, `stagehand/README.md`, `terminal/README.md`, `reinstall/README.md`, `core/README.md`, `CLAUDE.md` (help-content tests green in editor 175/175 + play 59/59). **Left:** run `editor/e2e-live/live-collab.spec.ts` once (switch it to `template: "blank"` if the new default scenario breaks it).
- [x] **SW-STORY-09** ✅ P0 · S · @__ — Keep the hard-coded runtime contracts (`the simulation completed` / `the golden duck`, `The Desktop` first, `The Internet` the only prison, file names, `beats/login.loom`) — **kept and pinned** by `spatial.test.ts` + the trapped test.
- [x] **SW-STORY-10** ✅ P1 · S · @__ — Re-arm the server-room door at boot — **done**: `== Power On` emits `do door server_room, state: locked` (→ the `door` rule in `stagehand/trapped.house.yaml`).
- [ ] **SW-STORY-11** 🔴 P1 · S · @__ — The user reviews the invented content (spec §10.1): Clippy Instructions 3–9, hunt questions H1–H6, the Truther bulletin, Overshares Three and Four, the WebMD backstory, the Hand Jive weakness, the Runescape/MS Paint/VLC/Pong missions, the 21 coded "files", the Bingo squares, the hat slips, and the fate lines. See "Decisions needed".
- [ ] **SW-STORY-12** 🟡 P0 · S · @__ — **`loomcheck` committed** as `core/scripts/loomcheck.ts` + `pnpm --filter @loom/core loomcheck <folder> [--smoke]`. **Left:** run it in CI against this folder.
- [ ] **SW-STORY-13** 🔴 P1 · S · @__ — **New `loomcheck` detectors** (spec §6.1 tail, critique-feasibility §5): a quoted entity in `fire … with k: "<entity>"`; `to group(X)` where X has no person members; `start quest … for everyone` with no catch-up watcher; `{self.name}` inside a CHARACTER body (SW-ENG-09); a guest-pickable CHARACTER used as a speaker (SW-ENG-10). Drop the false WARN on `move … to at`.
- [ ] **SW-STORY-14** 🔴 P2 · S · @__ — **Disarm path for the alternate finale** (the source: "enter the server room without tripping the alarm" before a majority). Needs a decision (Decisions #29): a codex disarm code that opens a short window (`Kernel.disarmed_until`) checked by the `server_door_opened` rule, a physical keypad (HW-D optional row), or none.

## 1. Screens and terminals (the "monitors")

The house's monitors are tablets and phones running the Terminal app (`terminal/`), plus the TV above the fireplace. Before Trabolta is introduced they are screensavers, a media player and an ad rotation. After that they show story beats and videos, show guests reinstalling, and become his line.
Today the terminal does exactly two things: it pilots a scanned guest's `dm:Trabolta` thread with a face and a voice, and it spectates the reinstall game (`view=auto|world|face|mirror`, `terminal/src/config.ts:46`). Nothing on the screens reacts to `cue screens_*` (the new `stagehand/trapped.house.yaml` turns `screens_flicker` into a house light blink, but no screen consumes any `screens_*` cue).

- [x] **SW-SCR-00** ✅ — **What exists, as a base to build on.** The TTS proxy with LRU cache and dedup (`core/server/tts.ts`, `GET|POST /api/mod/tts`; `core/test/tts.test.ts`). The speech queue with a browser-voice fallback (`terminal/src/speech/engine.ts`). The SVG face and moods (`terminal/src/face/`). The world/mirror view with the camera director and the egg celebration (`terminal/src/world/WorldView.tsx`, `director.ts`). All verified live once with a fake speech endpoint (see the memory note "Terminal live verification").
- [ ] **SW-SCR-01** 🔴 P0 · M · @__ — **Attract mode before Trabolta exists** (spec §7 #14, *required*). While the terminal's character is hidden, or `awake` is false, the terminal shows the screensaver / media player / ads rotation. It never shows "TRABOLTA ONLINE" (`terminal/src/app.tsx:417`), and it **never pilots** a scanned guest into `dm:Trabolta`, which would commit the hold line into the guest's real thread and grow a Trabolta row on their phone before Clippy introduces him (B5). Add `revealed` to `CastSummary` (`core/server/views.ts`), and read it in `terminal/src/app.tsx` (the status poll at `:364-384`).
- [ ] **SW-SCR-02** 🟡 P0 · S · @__ — **Interim runbook** (zero code). Provision every terminal `view=mirror` at doors open: mirror has no scanner and no pilot, and the empty house reads as a screensaver. Re-provision `view=auto` right after `introduce_trabolta`. The mirror view exists (`terminal/src/app.tsx:547-565`) but has never run on the real tablets or the TV.
- [ ] **SW-SCR-03** 🔴 P0 · L · @__ — **Screens layer, server side.** A transport-free `ScreenHub` (new `core/server/screens.ts`, modelled on `SpatialHub` in `core/server/spatial.ts`): the current program per target and layer (base / program / overlay), server-held deadlines, and presence. A lean SSE `GET /api/screen/stream` that **replays the current state on connect**, so a rebooted tablet re-converges. Journaled, so rehearsals replay. Terminals must not ride the mod feed: it is heavy (a full ModView per step), it leaks DMs onto wall tablets, and each tablet would count as a "director" (screens audit §3.3).
- [ ] **SW-SCR-04** 🔴 P0 · M · @__ — **Media route** `GET /media/<file>`: streamed with `Range` → 206, `Accept-Ranges`, ETag, and `.mp4/.webm/.m4a/.vtt` types. Today `serveAppFile` reads whole files and has no video types (`core/server/server.ts:100-138`), and iOS Safari will not play `<video>` without 206. Per-event media dir + `LOOM_MEDIA_DIR` + a read-only bind mount in `docker-compose.yml`. Keep big files out of git.
- [ ] **SW-SCR-05** 🔴 P0 · S · @__ — **Cue bridge.** `ScreenHub` folds the rewrite's `cue screens_*` / `terminals_*` / `tv_*` / `tablet_*` directive events (spec §2.13, already emitted by the story) into template programs. Fallback: read the `Night.screen` / `Night.terminals` mirrors. This drives the screens with **zero story change**. A later `show … on screens` statement (`core/src/parser/statements.ts:53`) is a nicety.
- [ ] **SW-SCR-06** 🔴 P0 · M · @__ — **Screensaver template** (3D Pipes / Mystify / Flying Windows), the base layer on the TV and every terminal from `Power On` until C1 (OV: "a classic Windows screensaver on the TV"). Canvas or three.js (three is already a lazy chunk), ≤ 30 fps.
- [ ] **SW-SCR-07** 🔴 P0 · M · @__ — **`terminals_attract` rotation** (an explicit requirement: before Trabolta the monitors are "screensavers, video/audio players"): screensaver → a Winamp/VLC-style **media player** (video + audio loop) → rotating fake-1999 **ads** (the Maps And Ducks fundraiser, "Your protection has expired", GeoCities). It plays from the first Clearance and again during Bingo (A4, A5, B2). Needs SW-SCR-04.
- [ ] **SW-SCR-08** 🔴 P1 · S · @__ — **Slide template** in a Win98 "PowerPoint" frame: `tv_bingo` (V2 rules + the asterisk card), `tv_bingo_time` (V3), `screens_trivia_1` / `_2` (H1–H3 / H4–H6, pulled from the quest so the slide and the Quest Log agree), `screens_hunt_results` (V6), `screens_truth_or_dare`, `screens_truth_pong` (D4), `screens_call_desktop` / `screens_return`, `screens_bobbing`.
- [ ] **SW-SCR-09** 🔴 P1 · S · @__ — **Countdown template** rendered from a server `endsAt` (never the tablet clock): `screens_countdown_hunt` (15:00), `screens_five_minutes` (5:00), the Bingo 20 min. Last-minute styling. The story's deadline watchers stay the authority (spec §0 rule 13).
- [ ] **SW-SCR-10** 🔴 P1 · S · @__ — **Y2K clock** (`screens_y2k`): a Win98 taskbar clock blown up, 11:00 PM 12/31/1999 counting to midnight from `Night.y2k_end`. It honours Trabolta's `turn_back_the_clock` (+5 min) and jitters at 23:59 (D10, F1).
- [ ] **SW-SCR-11** 🔴 P1 · M · @__ — **Trust Chart board** (`screens_trust_chart`): rows from each program's `trust` slot (the TRUST FORMULA: 10 per accepted truth, −5 per Internet visit, ±10 assessment), revealed bottom-up, top and bottom called out (D6). Optional language: a `BOARD` declaration + `top()`/`bottom()` (spec §7 #8). Workaround today: Trabolta reads the names on the Desktop.
- [ ] **SW-SCR-12** 🔴 P1 · S · @__ — **Notepad textfile template**: `screens_truth_txt` (truth.txt from CODEX The Truth File, scrolled at reading pace while the bobber reads it aloud, F3) and `screens_purgatory` (Clippy's summary, E8).
- [ ] **SW-SCR-13** 🔴 P1 · M · @__ — **Songs**: `screens_song` karaoke lyrics (VTT) with Sandy's line in a chat bubble (F4), `screens_grok_prom` in the rain (F5), `screens_rave` visuals (F6), `screens_recount` (weakened Trabolta), `screens_overshare` (his face glitching, D9). Audio comes from the house speaker (HW-AUD); the screens show lyrics against a shared `startAt`.
- [ ] **SW-SCR-14** 🔴 P0 · S · @__ — **Overlay effects**: `screens_blackout` (true black, synced with the lights), then `screens_go_to_living_room` flashing (E4/E6: "the chat app is now just a flashing screen"), `screens_alarm` INTRUSION — SERVER ROOM (E2), and `screens_flicker` (Trabolta's power, plus involuntary at the beans and every overshare). A takeover or blackout ends any pilot session (`app.tsx:312-326`).
- [ ] **SW-SCR-15** 🔴 P1 · S · @__ — **Video template**: the ad hijack `screens_ad_hijack` started together on every screen (`startAt = serverNow + 1.5 s`; sound on speaker screens only, C1), `screens_truther` glitch (C3), `screens_print_certificate` → `screens_beans` Win98 error (D7), `tablet_webmd` on the tent (B4; see SW-RE-04).
- [ ] **SW-SCR-16** 🟡 P1 · M · @__ — **TV presentation ⇄ mirror.** The TV defaults to presentation (slides / screensaver) and raises the world mirror while someone is in the Internet (`tv_mirror` after the introduction; "Look! That's {name}!"). Today `view=mirror` is a fixed mode (`terminal/src/app.tsx:547-565`; the camera cuts are in `terminal/src/world/director.ts`). It needs the world to become one program among others.
- [ ] **SW-SCR-17** 🔴 P2 · M · @__ — **Room voice**: the TV speaks the `Trabolta:` lines said in `loc:The Desktop` with his face, so his presentations (Trust Chart, overshare, Y2K, recount) are heard and not only read. Depends on a decision (TV as Trabolta's face?). Without it his scripted Desktop speeches are text on phones only; the zero-code fallback is pre-rendered voice files (HW-AUD-06).
- [ ] **SW-SCR-18** 🔴 P1 · S · @__ — **Alexa announcements on screens** (if chosen over SW-SH-07): `do announce "…"` → speaker-tagged terminals speak it through `SpeechQueue` + `/api/mod/tts` with an Alexa voice and chime. If audio isn't unlocked, show the text as an alert. Pick **one** speaker per room; several tablets a few hundred ms apart sound awful.
- [ ] **SW-SCR-19** 🔴 P0 · S · @__ — **Kiosk basics**:
  - Screen Wake Lock on boot and on `visibilitychange` (none anywhere in `terminal/src`).
  - `manifest.webmanifest` (fullscreen, landscape) + `requestFullscreen` from the wake tap.
  - **one primed `<video playsinline>`** started inside the existing wake tap (`app.tsx:130-135`) so iOS keeps autoplay-with-sound; the mirror view needs a wake tap too (`app.tsx:545-547`).
  - Never remote-reload mid-show: a reload loses the audio unlock.
- [ ] **SW-SCR-20** 🔴 P1 · M · @__ — **Scoped screen/pilot token** in place of the full moderator token in localStorage (`terminal/src/config.ts`). Gate the ⚙ setup (`app.tsx:435-439`, `:559`) behind a long-press + PIN. Today anyone who picks up a wall tablet holds full moderation of the event (see also SW-QR-10).
- [ ] **SW-SCR-21** 🔴 P1 · S · @__ — **Heartbeat, identify, reload**: report audio unlocked, visibility, battery and version; flash name/spot on `identify` for install day. Drop the 20 s full-ModView poll (`app.tsx:364-384`) by putting Trabolta's online/revealed flag in the screen stream.
- [ ] **SW-SCR-22** 🟡 P1 · S · @__ — Rebuild `terminal` and `reinstall/web` after any `house.json` change: both bundle an offline copy (`terminal/src/world/stream.ts:20`, `reinstall/web/src/show-house.ts`). The live fetch wins, so this is only the fallback.
- [ ] **SW-SCR-23** 🔴 P1 · S · @__ — **Bathroom terminal privacy**: `house.json` has a terminal spot `bathroom`. Mount it outside the door or run it camera-off (`view=face`/signage, `camera` off in config). Never a scanning camera inside a bathroom.
- [ ] **SW-SCR-24** 🔴 P1 · S · @__ — **The remaining templates** from the spec's §2.13 cue registry that no item covers: `screens_advice` (Trabolta pleading, F7), `screens_banish` (F7), `screens_final_reveal` (the dark state, F1), and `terminals_trabolta_online` as a cue the screens react to (B5: attract mode lifts, the face comes up).
- [ ] **SW-SCR-25** 🔴 P1 · M · @__ — **Media precache** on every terminal, driven by a manifest the screen stream sends (screens audit §8): fetch the ad-hijack video, the songs' lyric files and the slide images at boot, so the synced ad hijack and the songs never stream over a busy show Wi-Fi at the worst moment. Report "media ready" in the heartbeat (SW-SCR-21).
- [ ] **SW-SCR-26** 🔴 P2 · M · @__ — **Screens in a local rehearsal**: the local-folder (in-browser Sim) backend doesn't run `ScreenHub`, so screens can't be previewed without a server (screens audit §8). Apply the same pure hub in `editor/src/store/sim.ts` and show a screen preview pane.

## 2. Play app (guests and performers on their phones)

- [x] **SW-PLAY-00** ✅ — **What exists and is verified**:
  - the two-pane chat shell and presence (`play/src/chat.tsx`, `play/src/presence.ts`);
  - the cast-pick sign-in and picture picker (`play/src/picture-pick.tsx`), verified live against real Wikipedia with Playwright (2026-09-22 and 2026-10-02);
  - the Mud Room cutscene (`play/src/cutscene.tsx`);
  - the CAPTCHA, poll, pass and tutorial widgets (`play/src/widgets.tsx`, `play/src/tutorial.tsx`; play `widgets` / `onrails` tests);
  - the pinned Codex + Quest Log rooms (core `codex` / `quests` tests, play `quests` test);
  - lifecycle handling on restarts (`play/src/lifecycle.ts`).
- [ ] **SW-PLAY-01** 🔴 P0 · L · @__ — **Featured-program claim** (spec §7 #1):
  - a per-invitee claim code, minted in Run → Join and emailed with the invitation (`core/server/webmaster.ts`, `core/server/mail.ts`), so only the invitee can take "Microsoft Excel";
  - registered names canonicalised to the declared spelling, so the `program.featured` tag can't be missed;
  - Today: trust at the door, a director fixes `featured` in Run → World.
  - Don't worry about the Trojan Horse / clowns -- this is a silly party after all, not a finished product.
- [ ] **SW-PLAY-02** 🔴 P0 · L · @__ — **Web Push that wakes a locked phone** (spec §7 #2):
  - a PWA manifest + service worker for `play` (none in `play/index.html`);
  - VAPID keys, `web-push`, a per-event `push_subscription` store, and `POST /e/:id/api/{guest,prime}/push`;
  - every `alert: true` message fans out to its audience;
  - iOS only delivers to a **home-screen-installed** PWA, so add an "Install / Turn on alerts" step after the CAPTCHA or in Clippy's tour.
  - It serves C1, the 5-minute warning, the alarm, and "GO TO THE LIVING ROOM". Needs HTTPS (SW-OPS-02).
- [ ] **SW-PLAY-03** 🔴 P0 · S · @__ — **Performer alerts**: chime, vibrate and banner in booths. `pickAlerts` / `playChime` run only in the guest session (`play/src/codex.ts:42-92`, `play/src/session.ts:497`); `usePrimeSession` never calls them, so the Antivirus get **no** alert for the door alarm, the late list, or Bathroom Mode.
- [ ] **SW-PLAY-04** 🔴 P0 · M · @__ — **Takeover widget**: full-screen flashing "GO TO THE LIVING ROOM" (E4/E6) with chime and vibrate, dismissed only by the story, plus **widget retraction**. Generalise the `overlay` path that only `tutorial` uses (`play/src/widgets.tsx:282-288`, `play/src/guest.tsx:476`). Today it's an `!` alert + `do announce`.
- [ ] **SW-PLAY-05** 🔴 P1 · M · @__ — **Visible timers and a show clock** on phones (`GuestView.timers[]`): Bingo 20 min, hunt 15 min, the hour, the 5-minute summons, Y2K. A countdown strip under the identity card. Pairs with SW-ENG-07.
- [ ] **SW-PLAY-06** 🔴 P1 · S · @__ — **In-app QR scanner** for guests: a 📷 in the Codex composer and header. Reuse `terminal/src/scanner.tsx` (jsQR fallback, works on iOS; `reinstall/web` already imports it). It handles clue/check-in codes without leaving the browser that holds the session. Also give the performer scanner the jsQR fallback (`play/src/performer.tsx:138-191` is `BarcodeDetector`-only, so it fails on iPhones).
- [ ] **SW-PLAY-07** 🟡 P1 · S · @__ — **Bathroom Mode you can see**. It exists as two guest INTERACTIONs setting `program.afk` (spec §2.9), buried in ☰ → "Things you can do" (`play/src/guest.tsx:274-301`). Add a 🚻 HUD toggle and a 🚻 badge on `PersonCard` / `PrimeGuest` (`core/server/views.ts:38-52`, `:466-473`), so People, who's-here and the booths show it (A5, D3 exemption).
- [ ] **SW-PLAY-08** 🔴 P1 · M · @__ — **Truthcoin** (spec §7 #7): guest↔guest give, trade (sell a fact for coin) and wager, with a ⓣ balance in the identity card, for DraftKings' hustle and `#truthcoin-exchange` (C3). Workaround: `program.score` (⭐) + host `pay_truthcoin` / `charge_truthcoin` buttons + Trabolta's `mint_truthcoin`; trades are settled in person.
- [ ] **SW-PLAY-09** 🔴 P1 · S · @__ — **Pickup-line input** (spec §7 #12): `foldCode` should strip `' ’ . , ! ?` (`core/src/runtime/sim/model.ts:505`; "You're" ≠ "youre" today), or add a text-answer widget. Workaround: the host button `pickup_line_works`, Trabolta's `the_line_works` power, or a director fire (F5).
- [x] **SW-PLAY-10** ✅ — Codex QR deep links work in code: `?code=<event>&unlock=<CODE>` → redeem once signed in → the Codex opens (`play/src/codex.ts` `unlockFromSearch`, `play/src/session.ts:582-596`; `core/test/codex.test.ts`). Live caveats are tracked in SW-QR-05.
- [ ] **SW-PLAY-11** 🟡 P0 · S · @__ — `!` alerts chime, vibrate and banner **only in the foreground**, after a prior tap, and iOS has no `vibrate` (`core/server/chat.ts`, `play/src/codex.ts:60-92`). Teach the "keep the app open" habit in Clippy's tour until SW-PLAY-02 lands.
- [ ] **SW-PLAY-12** 🔴 P1 · S · @__ — **Performer-private channel** with notification (spec §7 #6): Clippy's instructions and the malware warning. Workaround: `Clippy Instructions N` codex entries unlocked for Clippy (silent) + `reply` booth readouts, which are **live-only and lost on a booth reload** (`play/src/session.ts:873`). At minimum, persist readouts.
- [ ] **SW-PLAY-13** 🔴 P2 · S · @__ — Auto-route by role: a scanned performer code or `?code=` should skip "Guest or Performer?" (`play/src/ui.tsx:17-40`).
- [ ] **SW-PLAY-14** 🔴 P2 · S · @__ — A `video` widget kind, so a captured guest can watch WebMD on their phone while the tent tablet is busy. An unknown kind renders text only today (`play/src/widgets.tsx`).
- [ ] **SW-PLAY-15** 🔴 P2 · M · @__ — Recruit / pledge flow (a recruiter's pledge QR → confirm → join). The story already works with the side chooser after `y2k_clock` reveals the factions (spec §2.3).
- [ ] **SW-PLAY-16** 🔴 P1 · S · @__ — **Bathroom Mode time limit**: auto-expire `program.afk` after a set time (e.g. 10 min, with a "still there?" ping), and show the director how long each guest has been away (app-admin §3.3). Today `afk` exempts a guest from the summons forever, which is an exploit. SW-PLAY-07 covers only visibility; SW-ADM-08 shows the list.
- [ ] **SW-PLAY-17** 🔴 P1 · M · @__ — **Guests act on other guests** from a People card (app-admin §4 #18): a guest-targeted INTERACTION (`who: guest`, `target: guest`) rendered on `PersonCard`, firing with the target as subject. Bugdom's glitch mission ("identify new bugs and send them to the internet"), accusations and the Telephone vote have no app path today. Workaround: tell a host, who acts from their booth.
- [ ] **SW-PLAY-18** 🔴 P2 · S · @__ — **Dynamic poll options**: a `show poll` whose options are the programs present in a room (the Telephone game's "we vote who messed up", B10). Poll options are static today. Fallback: a show of hands. Pairs with SW-ENG-13.

## 3. Admin panel / Run mode

- [x] **SW-ADM-00** ✅ — **What exists and is verified**:
  - fire a named event with subject + `k: v` args, fire a beat, and broadcast with a scope (`editor/src/components/cockpit/tabs.tsx:891-1018`; header quick-fire in `editor/src/components/run/RunStage.tsx`);
  - lifecycle start / pause / restart / push draft / go live / end (`editor/src/components/run/LifecycleControls.tsx`; live-stack Playwright spec);
  - Players (`editor/src/components/cockpit/PlayersTab.tsx`) and Inspector var edits (`VarTable.tsx` → `/api/mod/var`);
  - the Mind page + controls (`MindTab.tsx`; `editor/e2e-live/mind.spec.ts`).
  - This already covers "send alerts and trigger beats from the admin panel".
- [ ] **SW-ADM-01** 🔴 P0 · M · @__ — **Cue sheet** (spec §7 #25): the `who: admin` INTERACTIONs as labelled, ordered buttons with the current `Night.phase` highlighted and the last cue marked. Today they show as raw event ids in a dropdown. The rewrite already labels them with the source codes (`C1/V1`, `V2`…`V6`, `C2`, `Clippy 2/X`) and declares them in running order (spec §2.9).
- [ ] **SW-ADM-02** 🔴 P1 · M · @__ — **Phone cue page** for a director away from the laptop (a play `?role=director` or a `/cue/` mini app). `/api/prime/act` requires a guest target, so global cues can't be fired from a booth today.
- [ ] **SW-ADM-03** 🔴 P1 · S · @__ — **Make `!` alerts discoverable**: an "Alert (chime + vibrate)" toggle on the Director broadcast form, instead of the undocumented `!` prefix (`core/server/chat.ts`).
- [ ] **SW-ADM-04** 🔴 P1 · S · @__ — **Codex grant and quest UIs**: the editor never calls `/api/mod/codex` or `/api/mod/quest` (`core/server/event-runtime.ts:2667-2714`). Add "give lore" and "move quest" to the Inspector, to fix a stuck guest on the night.
- [ ] **SW-ADM-05** 🔴 P1 · M · @__ — **Run → Screens page**:
  - a fleet grid with an online dot, "needs a tap" (audio), battery, and a live mini-render;
  - **Blackout all / Clear all / Screensaver / Identify / Reload**;
  - an ad-hoc composer.
  - Needs SW-SCR-03.
- [ ] **SW-ADM-06** 🔴 P1 · M · @__ — **Tech-status view**: stagehand connected, the agent worker online (the Mind tab already shows worker status), Z2M `availability`, WLED `/status`, ESP32 LWTs (`health/#`), and terminal heartbeats. Cheapest path: stagehand mirrors them into `Tech.*` vars (SW-SH-04), so Run → World is the rail.
- [ ] **SW-ADM-07** 🔴 P1 · S · @__ — **Judging with arguments from a phone**: optional `args` on `/api/prime/act` + an INTERACTION arg picker ("Q1 / Q2 / Q3"), so one ✅ / 😤 pair replaces the six per-question buttons (spec §7 #9). Workaround: six buttons (`accurate_q1..3`, `confident_q1..3`).
- [ ] **SW-ADM-08** 🔴 P1 · S · @__ — **"Late / in the bathroom" panel** for the director and the Antivirus: programs with `late` or `afk`, and the last check-in time (D3).
- [ ] **SW-ADM-09** 🟡 P1 · S · @__ — **Run export** (`loom-run/1`, Log tab) exists. Use it after the party for the recap and archive; check it on a long run.
- [ ] **SW-ADM-10** 🔴 P1 · S · @__ — **Re-lock / re-arm the server room mid-show**: an admin INTERACTION (`rearm_server_room`) that sets `Kernel.server_unlocked = false`, clears the alarm latch and emits `do door server_room, state: locked`, for when a rehearsal or an early unlock leaves the door open. SW-STORY-10 re-arms it only at boot.

## 4. QR codes

The 41 coded clues (spec §8.3) fill the Codex. Room posters check people in. Pre-baked, printable QRs belong to guests, performers, clues, locations and devices.

- [ ] **SW-QR-01** 🔴 P0 · S · @__ — **Printed base-URL bug.**
  - The problem: `joinBase()` (`core/server/server.ts:147`) uses the first LAN interface (`http://<ipv4>:7000`) and ignores `LOOM_BASE_URL` (`core/server/config.ts:19`). It feeds `joinUrl` (`core/server/events-api.ts:54`) and every codex URL (`/api/mod/codes`, `event-runtime.ts:2645`). In Docker that prints `http://172.x.y.z:7000/?code=…`: unreachable, plain http, and it bypasses Caddy. `docs/loom-docker-deploy.md:474-476` claims otherwise.
  - The fix: `LOOM_PUBLIC_URL ?? LOOM_BASE_URL ?? LAN guess`, plus a docs fix. Printed links must never contain an IP or a port.
- [ ] **SW-QR-02** 🔴 P0 · S · @__ — **Pinned project codes**: the event/prime codes survive End → relaunch (today `freshCodes()` mints new ones, `core/server/events-api.ts:87,150`, and every printed join/clue QR dies). Go live, restart and reload already keep codes. Interim, until SW-QR-04.
- [ ] **SW-QR-03** 🔴 P0 · S · @__ — **Redeem throttle**: about 8 misses per minute per guest, then 429 and stop journaling misses (`/api/guest/codex/redeem`, `event-runtime.ts:2240-2258`; `Sim.redeem` journals every miss and fires `wrong code`).
- [ ] **SW-QR-04** 🔴 P1 · M · @__ — **`printable` tokens**:
  - a project-level `printable(token, kind, target, label, meta, revoked_at, claimed_at)` table (`printables.json` for the DB-less event);
  - one URL shape, `https://<domain>/q/<token>`, resolved at scan time to the project's active event (`POST /api/resolve-print`, throttled like `resolve-code`);
  - play dispatch by kind: `clue` / `place` / `badge` / `cast` / `device` / `join`.
  - No event code, passcode or typed answer on paper.
- [ ] **SW-QR-05** 🟡 P0 · S · @__ — **Clue QRs today.** `?code=&unlock=` works end to end in code (SW-PLAY-10), but:
  - no UI lists or prints them (`/api/mod/codes` has no client);
  - the URL carries the guessable typed code **and** the event code;
  - a guest whose native camera opens a different browser lands on registration again.
  - Print from `/api/mod/codes` by hand only after SW-QR-01/02/03, and test on iPhone + Android.
- [ ] **SW-QR-06** 🔴 P0 · M · @__ — **Location check-in: a QR on each room's sign that enters that room's chat** (an explicit requirement: "QR codes for signing into each location's chat room"). No guest API route moves the caller today, so a room QR is the **only** way a guest can enter a location room by themselves. It works all night, not just at the summons, and the sign says "Scan to enter this room's chat". `POST /e/:id/api/guest/checkin {token}` → a journaled `checked_in` with `at` = the **exact** LOCATION name (the story's if-chain, spec §3 D1), which moves the guest into `loc:<room>`.
  - Refuse when captured, in a prison/sealed room, on rails (`uploaded && !cleared`, cutscene), or the room is hidden and not revealed.
  - 15–30 s cooldown.
  - A "📍 X checked in" notice.
  - Today: Antivirus/Host pass scans at the living-room door during the summons, the `check_in_at_desktop` button, and a director fire.
- [ ] **SW-QR-07** 🔴 P1 · S · @__ — **Clue scan route**: `codex/scan {token}` → `unlock` with `via: "scan"`, plus an optional `found at: <LOCATION>` gate, so a texted photo of a poster does nothing from another room.
- [ ] **SW-QR-08** 🔴 P1 · M · @__ — **Guest badges**:
  - blank or RSVP (program + picture pre-chosen, name reserved);
  - **claim-once** with director release;
  - **identity survives restarts** (today `guestTokens.clear()` at `event-runtime.ts:1437` gives guests new `g-` ids after every restart / go-live).
  - `parseScan` accepts `/q/` (`terminal/src/scan.ts:16`), and so do `/api/scan` and the editor lookup.
  - Pairs with the featured claim (SW-PLAY-01).
- [ ] **SW-QR-09** 🔴 P1 · S · @__ — **Performer cast cards**: one per performer part (classifier: `core/server/identity.ts`). One scan signs in as that character, refused 409 if held. Go-live signs every performer out (`event-runtime.ts:1444-1451`), so this makes re-sign-in one scan.
- [ ] **SW-QR-10** 🔴 P1 · M · @__ — **Device enrollment without the mod passcode**: single-use, TTL'd `device` printables mint **scoped device tokens** (terminal: impersonate + tts + spatial read; reinstall: spatial begin/end + house read; map: house write). Run → Devices lists them with last-seen and Revoke. Today `terminal/src/config.ts` and `reinstall/web/src/config.ts` trade the mod passcode for full admin (`event-runtime.ts:2491-2505`). **Never print the mod passcode.**
- [ ] **SW-QR-11** 🔴 P0 · M · @__ — **Run → Print page**:
  - QRs rendered **client-side** (`qrcode` in the editor; `/api/qr` is rate-limited to 60/min/IP, `core/server/server.ts:274`, so an 80-QR sheet 429s);
  - `@media print` label templates (A4/Letter posters, Avery CR80 badges, business-card cast cards), each item carrying a speakable fallback code and a small item id, plus a CSV export.
  - Sets: 41 clue posters, room check-in signs (every LOCATION except The Internet, The Mud Room, The Server Room), guest badges, cast cards, join posters.
  - Tokens stay stable across reprints.
- [ ] **SW-QR-12** 🔴 P2 · S · @__ — **Terminal as a check-in kiosk**: a guest shows their pass to a wall tablet. The tablet knows its `spot` → room → LOCATION (`house.json` `terminals[].room` → `rooms[].location`), so this is presence that a photographed poster can't fake, for the 5-minute deadline. `POST /api/mod/checkin {guest, spot}` with a scoped token.
- [ ] **SW-QR-13** 🔴 P2 · S · @__ — `markers` in `house.json` (an editor-only block) + a printable **setup map** of where every poster, sign and terminal hangs, for the set-dressing crew.
- [ ] **SW-QR-14** 🔴 P0 · S · @__ — **Print a test sheet and scan it on cellular data** (off the house Wi-Fi), on iPhone and Android, before the real print run.
- [ ] **SW-QR-15** 🟡 P0 · S · @__ — The Run page join QR exists (`editor/src/components/run/RunPage.tsx:251`) but inherits the SW-QR-01 bug.
- [ ] **SW-QR-16** 🔴 P1 · S · @__ — **Print lint + RSVP import** (qr §5.4) on the Print page: CODEX entries with neither a poster nor a story `unlock`, LOCATIONs with no sign, badges still unclaimed at doors open. Plus an RSVP CSV import (name, program, email) that pre-makes the guest badges (SW-QR-08).

## 5. Floor plan editor and the house map

One `house.json` (schema v1, `house/src/types.ts`, `validateHouse` in `house/src/validate.ts`) feeds the VR game, the web game and the terminals. The VR game fetches it live (`reinstall/vr/net/server_link.gd`, refetched every 2 s while stale), so a save reaches the headsets with no Godot rebuild. The current map is a **placeholder** (`./house.json` says so).

- [ ] **SW-MAP-00** 🟡 P1 · @__ — **What exists**: `/reinstall/map` (`reinstall/web/src/map/MapApp.tsx`, `edit.ts`, `plan.ts`; 33 tests in `reinstall/web/test/map.test.ts`). It can drag, aim, add and remove terminals and duck spots, drag the spawn, move/rotate props, move/resize **rectangular** rooms, set a room's label/LOCATION/tint, edit the raw JSON with live validation, and save with `base` → 409 on a conflict. The 409 path is unit-tested only, never re-run live.
- [ ] **SW-MAP-01** 🔴 P0 · M · @__ — **The map belongs to the project.**
  - The problem: a save is `spatial-house.json` in **one event's** state dir (`core/server/store.ts:81,198-205`). It is lost on End → relaunch, invisible to co-writers, and outranks the show file forever for that event.
  - The fix: make `house.json` a `project_file`, snapshot it at launch like `scenario_source`, resolve the event map as director save > project file > `LOOM_HOUSE`/show file (`core/server/event-runtime.ts` `spatialHouse()`), add "Save to project" + "Download JSON" on the map page, and have `core/scripts/sync-example.ts` push `house.json`.
  - **Do this before surveying.**
- [ ] **SW-MAP-02** 🔴 P0 · L · @__ — **Survey the real house** (laser measure + tape). Origin = the front door's outside threshold, floor level; +x east, +z south, metres (`docs/loom-reinstall.md` §1, `:41-42`; §1.1 is the schema). Record:
  - per floor: elevation and ceiling;
  - per room: a rectilinear polygon (no angles, no holes);
  - per door: centre ± 2 cm on the wall line, and width;
  - the stairs rect + `up`;
  - solid furniture;
  - **every terminal mount** (pos, yaw, pitch, fov), so the "window" lines up;
  - 6–10 duck spots: none in the spawn room, none buried in a prop, ≤ 1.2 m up, **none in the Server Room**.
- [ ] **SW-MAP-03** 🔴 P1 · L · @__ — **Structural editing** in the map editor:
  - a tool palette; draw rectangle/polygon rooms (axis-locked) with typed W×D; delete with a cascade prompt; snap to neighbouring walls;
  - doors on a wall (auto-resolve `a`/`b`) that **follow a moved edge** (today they're left behind, `edit.ts:186`);
  - stairs; a floors table;
  - a props palette (couch, counter, folding table 1.83 × 0.76 × 0.76, tub, patch bay, VR mat) with size, kind, solid and colour;
  - zoom/pan, a snap setting (1/5/10/25 cm), dimension labels, a measure tool, and **redo**.
  - Split the 1064-line `MapApp.tsx`.
- [ ] **SW-MAP-04** 🔴 P1 · M · @__ — **Image underlay + 2-point scale calibration** per floor (opacity, rotation, lock), stored in an editor-only block the games ignore (`validateHouse` has no unknown-key check). This lets you trace a photographed hand-measured plan.
- [ ] **SW-MAP-05** 🔴 P2 · M · @__ — Measurement-first entry: interior W×D with wall-thickness compensation (`style.wallThickness`), "tape-walk" polygons (4.12 E, 3.05 S, …) with a closure error, and an origin helper.
- [ ] **SW-MAP-06** 🔴 P1 · S · @__ — **LOCATION picker + inline validation**: rooms pick from the story's LOCATIONs, lint "no room for LOCATION X" (e.g. The Server Room) live rather than only after a save (`houseWarnings`, `core/server/spatial.ts`), and make problems structured and clickable (`validate.ts` emits strings today).
- [ ] **SW-MAP-07** 🔴 P0 · S · @__ — **Make the map match the story**:
  - add the **Server Room** (cold storage): room, door, a terminal/indicator spot, a patch-bay prop, no duck spots;
  - put the tent where it really stands (outside per the story, the basement in the placeholder; an outdoor tent is an indoor room in a notched yard polygon);
  - add the Truth Pong folding table in the backyard;
  - map The Tube's real path.
- [ ] **SW-MAP-08** 🔴 P2 · M · @__ — **3D preview** with `buildHouseScene` (`house/src/three/scene.ts:119`; it already runs in the browser) and a sessionless "walk the draft" sandbox (a small seam in `reinstall/web/src/game/engine.ts`).
- [ ] **SW-MAP-09** 🔴 P2 · S · @__ — An in-browser **walkability check**: `route()` from the spawn to every duck spot, flagging unreachable spots (the same algorithm as the VR autopilot).
- [ ] **SW-MAP-10** 🟡 P0 · S · @__ — **VR sync release checklist** once the survey is final:
  1. export into `./house.json`;
  2. `pnpm house:sync`;
  3. `pnpm --filter @loom/house test`;
  4. `pnpm test:vr` (the autopilot must reach every new duck spot with real collision);
  5. re-export the Quest APK (offline fallback);
  6. rebuild web + terminal (SW-SCR-22);
  7. delete any stale `spatial-house.json`.
  The live fetch path exists (`reinstall/vr/net/server_link.gd`).
- [ ] **SW-MAP-11** 🔴 P1 · S · @__ — Map-page auth by the author session instead of the mod passcode (`reinstall/web/src/app.tsx` `Setup`), or a scoped `map` device token (SW-QR-10).
- [ ] **SW-MAP-12** 🔴 P2 · S · @__ — **"Export for Godot"** on the map page (qr §6): download `house.json` plus its goldens as a zip, so the VR copy can be refreshed without the `pnpm house:sync` CLI.

## 6. Reinstallation games (the Internet tent)

- [x] **SW-RE-00** ✅ — **The core loop works and is green**:
  - drag to the tent → scan the pass on the tablet → play on a Quest or the tablet → follow the golden chevrons to a randomly dealt duck → `found` commits `the simulation completed` + `the golden duck` (`core/server/event-runtime.ts:1112-1124`) → released; the TV/terminals watch the egg and the flight;
  - suites: `@loom/house` 122, `loom-reinstall` 120, core `spatial` + `spatial-routing` 44, Godot headless 225 checks (re-run green 2026-10-14);
  - one HTTP + headless-Godot `--autopilot` run against a live server (2026-10-10).
- [ ] **SW-RE-01** 🔴 P0 · M · @__ — **First real Quest 3 export**:
  - JDK 17 + Android SDK + the Godot Android build template (neither `reinstall/vr/build/` nor `android/` exists);
  - export, then sideload on both headsets with their own `station.json` (`vr-1` / `vr-2`; the committed placeholder `reinstall/vr/config/station.json` has `code: CHANGEME`);
  - confirm the server connection: Android blocks cleartext http unless the app allows it, and **nothing in `reinstall/vr` sets that today** (`export_presets.cfg` has only `permissions/*`). Either allow cleartext in the Android export (manifest / network-security config in the build template) or, better, use HTTPS (SW-OPS-02);
  - test the lobby → Send to Headset → find → lobby loop.
- [ ] **SW-RE-02** 🔴 P0 · S · @__ — **First real tablet run**: provisioning, camera scan in a secure context, Play here with touch sticks, WebGL frame rate on the actual tablet, Send to Headset.
- [ ] **SW-RE-03** 🔴 P0 · S · @__ — **Live re-run of the review-round fixes** on a scratch server: pause/resume mid-find ("doors are closed"), a director map save mid-game (the duck moves), a 409 save conflict, prop routing, terminal fov, and the TV mirror on the real TV. All are unit-tested only (CLAUDE.md "not yet re-run").
- [ ] **SW-RE-04** 🔴 P1 · M · @__ — **WebMD instructional video** in the tablet wizard (spec §7 #15): an attract loop + a `video` step between *scan* and *choose* (`reinstall/web/src/app.tsx` screens). A full cut on the first capture, a short "welcome back" on repeats, and an operator Skip. Workaround: WebMD's lines in `dm:WebMD` + Julia live in the tent + `cue tablet_webmd`. Decision: live or pre-recorded.
- [ ] **SW-RE-05** 🔴 P2 · S · @__ — **Optional press-A** to touch the duck. VR: `ax_button` is already bound (`reinstall/vr/openxr_action_map.tres`); require it in `reinstall/vr/game/game.gd` `_tick_play`. Web: a big "Touch Gerald" button / Space in `engine.ts`. Add a 10 s auto-find fallback, plus contract/doc/copy changes (`docs/loom-reinstall.md`, the WebMD line "walk right up to him"). The server's `nearDuck` stays the judge.
- [ ] **SW-RE-06** 🔴 P1 · M · @__ — **Zip everyone out / release-all**:
  - end a guest's spatial session on any non-`found` release (a new `released` leave reason, `SpatialHub.endGuest`); today a zipped program keeps playing and the VR HUD still says "REINSTALLATION COMPLETE";
  - add `POST /api/mod/spatial/end {all: true}` + a "clear the tent" button;
  - the games show "The Antivirus zipped you out".
  - The story's zip already works through ROLE watchers (spec D8).
- [ ] **SW-RE-07** 🔴 P1 · S · @__ — **Bathroom Mode from the tent tablet**: 🚻 / Back buttons → `POST /api/mod/signal {name: "go to the bathroom", subject}`. Add `postSignal` to `reinstall/web/src/api.ts`. The tablet is a mod device with no guest token, so the README's `guest/act` idea can't work.
- [ ] **SW-RE-08** 🔴 P1 · S · @__ — **Tent queue**: sort candidates by capture time with a "Next up" list (`GET /api/mod/spatial/candidates` sorts captured first, then by name, `sortCandidates` at `core/server/spatial.ts:181`; there is no capture-time order). `capacity: 3` is not enforced anywhere, and Truth Pong can send 5–10 programs at once (overflow policy: Decisions #30).
- [ ] **SW-RE-09** 🔴 P2 · L · @__ — **Excel's virus as an in-game pickup** (spec §7 #17): a secret `virus` spot dealt only to seekers, `POST /api/spatial/pickup`, never broadcast to the terminals. Workaround that works today: codex QRs `LOVE-LETTER-FOR-YOU` (under VR station 2) and `FREE-TRIAL-30-DAYS` (tablet stand) + the guest button `plant_the_virus` (spec C4).
- [ ] **SW-RE-10** 🔴 P2 · S · @__ — Let performers enter the sim for the "banish even the Antivirus" ending (`begin` for `p-` ids). Today `begin` 404s for a character.
- [ ] **SW-RE-11** 🔴 P2 · S · @__ — Goose vs duck copy (decision). The code ships "Gerald, the golden duck" everywhere (`house/src/three/duck.ts:1`, `reinstall/vr/game/duck.gd:1`, `terminal/src/world/state.ts:55`; the terminal's celebration text is "FOUND THE GOLDEN DUCK", `WorldView.tsx:225`). **Never rename the event `the golden duck`** without changing `event-runtime.ts:1119` and the contract together.
- [ ] **SW-RE-12** 🔴 P2 · S · @__ — WebMD voice guidance inside VR through `/api/mod/tts`.
- [ ] **SW-RE-13** 🔴 P2 · S · @__ — **Optional 4th player device** (reinstall §2.9): a spare phone on `/reinstall/?role=player` as a third station when Truth Pong floods the tent. Test touch sticks and WebGL on it.

## 7. Trabolta and the agents

### How he changes over the night (inaccessible → guarded → influenced) and what makes it happen

| Phase (`Night.phase`) | Guests experience | Tech | Items |
|---|---|---|---|
| arrivals … bingo_results | **Inaccessible.** He doesn't exist on any phone. Terminals are screensavers. | `hidden: true` (`core/src/runtime/sim/sim.ts` `peopleFor` / `isRevealedTo`); worker gate `when: self.awake == true` → hold line (`stagehand/src/stagehand/agents/module.py`); terminals must not pilot | SW-SCR-01/02, SW-AI-11 |
| introduced, hunt_1 | **Guarded / formal.** Introduced by Clippy; DMs are corporate; personal questions are routed to Clippy | `introduce_trabolta` → `awake = true`, `reveal self`; stage `formal` | SW-AI-03 |
| truth_1 | **Hungry.** Warmer to those who deliver facts; pays T1 lore | shares (`act.share`), `mint_truthcoin` | SW-AI-05 |
| malware, hunt_2, summons | **Rattled.** Leaks and reassures; paranoid | + `cut_the_lights`, `summon_the_antivirus`, `trabolta_announces` | SW-AI-14, SW-SH-01 |
| truth_pong, trust_chart | **Judge.** Every DM is an audition; tells you your rank | + `assess` (±10 → TRUST FORMULA), `pardon_a_program` | SW-SCR-11, SW-AI-04 |
| beans, overshare | **Unravelling.** Overshares (Sandy), cold to the LiveJournal reader; screens flicker on their own | T2 lore; involuntary `screens_flicker` | SW-SCR-14 |
| y2k, majority | **Desperate.** Bargains with everyone; loses the screens | + `turn_back_the_clock`; `flicker` refused | SW-SCR-10 |
| final_reveal … finale_* | **Last act.** Scripted endings; only `assess` / `the_line_works` live | phase-guarded power hooks | SW-AI-07 |

**Influenced:** guests move him through DM facts (orchestrator verdicts → dossier trust), shared codex (`when share:` → `Trabolta.truth += 2`; the Prom Ticket and LiveJournal hooks), confident lies at a Moment of Truth (he can't tell them apart: `Kernel.*` is hidden from him), flattery, and relationship advice (`love` / `regard`, read by the director when choosing help vs thwart). **Guests' influence never changes a branch by itself** (spec §10.2 #9).

- [x] **SW-AI-00** ✅ — **What exists and is verified**:
  - hidden/reveal (`CharDef.hidden`; `core/test/sim-reveal.test.ts`);
  - the agent request/reply hub and agent powers (`core/server/agents.ts`; `INTERACTION … who: agent` committed as `signal` with `actor` in `event-runtime.ts`; `core/test/agents.test.ts`);
  - the worker with persona gate, mind, orchestrator, trace and control channel (`stagehand/src/stagehand/agents/`; 166 pytest, re-run 2026-10-14);
  - the Run → Mind page driven live with a real worker on both Ollama models (`editor/e2e-live/mind.spec.ts`).
- [ ] **SW-AI-01** 🟡 P0 · S · @__ — **Secrets live on the hidden `CHARACTER Kernel`**, never in `Night.*` (the orchestrator sees every global): the combos, lies, the majority, the virus planter, the dossier, per-question verdicts. Character vars are excluded from agent requests (`event-runtime.ts:676-679`). The design is in the spec (§0 rule 21, §2.6.2); verify it in SW-STORY-02.
- [ ] **SW-AI-02** 🔴 P1 · S · @__ — **The secrecy fix** (spec §7 #21), required before `lookup: true`:
  - `Facts.render` / `find` return lore only if Trabolta or the speaker holds it;
  - `digest`, `delta` and the reflect `world` filter by `persona.facts`;
  - reflect speaker vars filter by `persona.them`.
  - Where: `stagehand/src/stagehand/agents/facts.py:96-211`, `orchestrator.py:259-266`; tests in `test_orchestrator.py` / `test_agents.py`.
  - Opening-night fallback: `lookup: false`.
- [ ] **SW-AI-03** 🔴 P1 · M · @__ — **N1 phase map**: mind `phases:` values become `{stage, policy, drives, cue}`, applied deterministically (`by="story"`) the moment `Night.phase` changes, plus an immediate survey (`stagehand/src/stagehand/agents/persona.py` `parse_mind_file`, `mind.py`, `orchestrator.py`). Today a phase reaches him only at the next survey (≤ 120 s) and the stage is model-judged. Workaround: the director presses **set stage** on Run → Mind at each phase (README list).
- [ ] **SW-AI-04** 🔴 P2 · M · @__ — **N2 proactive acts**: `POST /api/agent/act`, so the orchestrator can `assess` every program at the Trust Chart without a DM. Workaround: the director edits `<guest>.assessment` + `trust` in the Inspector.
- [ ] **SW-AI-05** 🔴 P1 · S · @__ — **N3 `disclose:` / `never:`** by stage: filter `self.codex` in the voice prompt and in the share list, drop `fire` acts when `favours: none`, and pass `to` through `parse_acts` (`stagehand/src/stagehand/agents/reply.py:165-199`). Today disclosure is prompt-only and he holds every T1/T2 entry from minute one.
- [ ] **SW-AI-06** 🔴 P1 · S · @__ — **N4 phase-keyed hold lines** (`unavailable:` map, including a "this program has performed an illegal operation" line after `computer_destroyed`) and **skip reflection on gated replies** (`module.py:571-577` spends GPU on hold-line exchanges).
- [ ] **SW-AI-07** 🔴 P1 · S · @__ — **Server `available:` on INTERACTION**: refuse an out-of-phase power instead of burning a use (`applyAgentActs` counts the use before the hook's guard runs). Today every power hook guards its phase and answers "That function is not available yet." / "I do not have the strength."
- [ ] **SW-AI-08** 🟡 P0 · S · @__ — **Model setup on the show laptop**:
  - Ollama with `gpt-oss:20b` (voice) + the orchestrator model pulled and **warm** (an eviction reload is ≈ 25 s; the OpenAI shim ignores `think:false`; see the memory note);
  - Kokoro TTS for the terminals (`LOOM_TTS_URL`);
  - the machine YAML for `stagehand … --only agents` (`stagehand/agents.example.yaml`);
  - a fresh `state_dir` after the sync.
  - Worked live 2026-09-16 (2–6 s per reply). Re-verify on the party laptop under load (worker + Kokoro + server + stagehand).
- [ ] **SW-AI-09** 🔴 P2 · L · @__ — **Auto-generated recap** (spec §7 #22): a deterministic `recap.ts` floor + a stagehand `recap` control + a Mind-tab Recap panel (generate → edit → publish/print). It produces Clippy's purgatory summary (E8), Trabolta's recount (E5) and a personalised truth.txt (F3). Workaround: beats interpolating `Night.*` names/counts + a printed truth.txt.
- [ ] **SW-AI-10** 🟡 P0 · S · @__ — **The codex order is load-bearing**: the orchestrator's "ground truth" is the first 24 codex entries in model order (`orchestrator.py:297-311` `lore_block`). The rewrite numbers `codex/1-world … 8-jeeves`, so world facts come first and the scrambled Jeeves fragments last. A code fix (held entries first, cap ~60) is P2.
- [ ] **SW-AI-11** 🟡 P0 · S · @__ — **Hold line in plain words**: `"Jean Trabolta will make an appearance later tonight. Please do not move the mouse."` The terminal's TTS reads `◌` and brackets aloud (`terminal/src/speech/split.ts`). Now in `./trabolta.persona.md`; left: hear it spoken on a terminal, and update `editor/e2e-live/mind.spec.ts` (SW-STORY-04).
- [ ] **SW-AI-12** 🔴 P1 · S · @__ — **Refuse agent dispatch for a hidden character** on the server (`core/server/agents.ts`; nothing checks `hidden` on that path). A belt to SW-SCR-01's braces.
- [ ] **SW-AI-13** 🟡 P1 · S · @__ — **The power list is in the spec, by phase** (§4.3): snoop, flicker_the_screens, pop_up, mint_truthcoin, cut_the_lights (allow-listed rooms only, never the tent, stairs, bathroom or server room; auto-restore after 90 s), summon_the_antivirus, trabolta_announces, assess, pardon_a_program, turn_back_the_clock, the_line_works. Each guards `target.name == null`. Verify each in the rewritten test.
- [ ] **SW-AI-14** 🟡 P1 · S · @__ — **Powers felt in the house**: `cut_the_lights` → the per-room Z2M + WLED rules (**written** in `trapped.house.yaml` for The Cache, The Desktop, The Cloud, The Registry); `flicker_the_screens` → a light blink (**written**: Z2M `effect: blink` on `house` + WLED preset 21) **and** the screens overlay (missing, SW-SCR-14); `turn_back_the_clock` → the Y2K clock (SW-SCR-10); `pop_up` → a Win98 pop-up on one phone. Verify the light half on the rig.
- [ ] **SW-AI-15** 🔴 P1 · S · @__ — **TTS reachable from wherever the server runs.** `/api/mod/tts` is a call from the server to `LOOM_TTS_URL`. If the server is on the VPS and Kokoro runs on the show laptop behind home NAT, every terminal loses the neural voice. Pick one: a Tailscale / cloudflared tunnel from the VPS to Kokoro, Kokoro on the VPS (CPU is fine for short lines), or accept the tablet-voice fallback. Decide with SW-OPS-01.
- [ ] **SW-AI-16** 🔴 P2 · S · @__ — **Worker leftovers** (trabolta.md §2.8): read-only self vars (a persona `shows:` key, so `awake` and `composure` are visible to the model but never adjusted by it), and an optional per-target limit on agent powers (today `assess` and `snoop` can hit one guest without limit).

## 8. Story engine gaps (`core/`)

Every item has a working story-side workaround already in the spec; these remove the workaround.

- [ ] **SW-ENG-01** 🔴 P1 · S · @__ — **`unlock X for group(G)` / `for everyone`.** Today the group form **leaks as public narration of the literal line**, and `for everyone` silently does nothing. Also make `start quest X for everyone` reach later arrivals. Workaround: per-member ROLE watchers + quest catch-up watchers (spec §0 rule 17).
- [ ] **SW-ENG-02** 🔴 P1 · S · @__ — **`move who to {expr}`** interpolation (today it moves to a literal `{at}` room), and binding **inexact** strings to entities (today a quoted or lowercase place binds as `event#N.at`). Workaround: the check-in if-chain over real LOCATIONs (spec D1, verified).
- [ ] **SW-ENG-03** 🔴 P1 · M · @__ — **INTERACTION visibility / availability** (`when:` on the declaration, filtered in `guestView` / `PrimeView`), so judging, pong, bingo and pickup buttons appear only in their phase, and the Bathroom toggle flips its label. Workaround: every hook guards its phase; every button is always visible.
- [ ] **SW-ENG-04** 🔴 P1 · S · @__ — **`Persons` excluding Run-mode personas** from majorities, plus `max` / `len` / `top()` / `bottom()` builtins (`core/src/runtime/sim/sim.ts:2408-2428`; `len()` is null today). Workaround: accept personas in rehearsal counts; argmax by `count([p … where p.trust > self.trust]) == 0` watchers.
- [ ] **SW-ENG-05** 🔴 P1 · S · @__ — **`/api/guest/join` refuses hidden / `joinable: false` groups** (`sim.ts:293-313` has no check). Today a crafted request could join Unlimited Power before `y2k_clock` reveals it.
- [ ] **SW-ENG-06** 🔴 P1 · M · @__ — **Server-held timers + a show clock** in the language (`start timer The Hunt for 15m`, `when timer The Hunt ends:`, `when timer X has 5m left:`), feeding `GuestView` / `ModView` timers and the screen countdowns. Workaround: `Night.x_end = Time.elapsed + N` deadline watchers with phase guards.
- [ ] **SW-ENG-07** 🔴 P2 · M · @__ — **Typed-chat triggers** `when program says "…" in dm:X` (spec §7 #26). Not needed once SW-PLAY-09 lands.
- [ ] **SW-ENG-08** 🔴 P1 · S · @__ — A **staff scope**: `group(X)` broadcasts reach no performer booth (membership is persons only), so staff cues are `reply` readouts from TRAIT hooks. Add a `performer(X)` / `staff(X)` audience, alert-capable (pairs with SW-PLAY-12).
- [ ] **SW-ENG-09** 🔴 P2 · S · @__ — `{self.name}` prints `null` inside CHARACTER hooks/owned beats (spec §0 rule 18). Give characters a `.name`.
- [ ] **SW-ENG-10** 🔴 P2 · S · @__ — **Lint**: warn when a `Capitalised Words:` line headed by a guest-pickable CHARACTER flips it to a performer part (`core/server/identity.ts` `isSpecial`). One stray `VLC:` line breaks the featured design. `identity.test` is the regression guard until then.
- [ ] **SW-ENG-11** 🔴 P2 · S · @__ — Enforce `LOCATION … capacity:` (parsed in `model.ts`, enforced nowhere) and once-only `*` choices.
- [ ] **SW-ENG-12** 🔴 P2 · S · @__ — Count performers as "programs" in majorities if the user wants OV's "everyone in the room is a program" (spec §10.2 #11, an engine limit today).
- [ ] **SW-ENG-13** 🔴 P2 · S · @__ — Poll ids + widget retraction (two open polls are ambiguous; the spec stores `Night.poll` before each `show poll`).
- [ ] **SW-ENG-14** 🔴 P2 · S · @__ — `show poll … with options: {expr}`: options computed from a list expression (e.g. `[p.name for p in Persons where p.at == "The Desktop"]`), the engine half of SW-PLAY-18.

## 9. Stagehand and show control (`stagehand/`)

- [x] **SW-SH-00** ✅ — **What exists and is verified**: the MQTT sensor → `POST /api/mod/{signal,beat}` / `arrive` path (`stagehand/src/stagehand/show/sensormap.py`), directive cue → MQTT/OSC (`show/cuemap.py`), the modular daemon and shared `ModClient` (`stagehand/src/stagehand/module.py`, `modapi.py`); 166 pytest green (re-run 2026-10-14).
- [ ] **SW-SH-01** 🟡 P0 · M · @__ — **`stagehand/trapped.house.yaml`: written (387 lines, untracked), not yet run on hardware.** It already holds: per-room Z2M + WLED off/on for The Cache, The Desktop, The Cloud and The Registry; every `lights_*` scene (IDs in the HW-C table, which now matches it); `screens_flicker` as a house blink; every `sound` → a QLab OSC cue; `announce` → `show/announce`; `door server_room` → a Zigbee maglock relay (`zigbee2mqtt/server_room_lock/set`); sensors for `server_door_opened` (Zigbee contact only), `printer_button_pressed`, `printer_opened`, `patch_combo_a` / `_b` / `patch_rejected` (on `sensors/patchbay/state`). **Left to do:**
  - a rule for the **reed switch** (`sensors/serverroom/door`, `when: "open == true"` → `server_door_opened`); today the "primary" sensor would fire nothing (HW-DOOR-01);
  - a `door` → **`show/serverroom/lock {"state": "locked"|"unlocked"}`** rule with `retain: true` for the ESP32 indicator (HW-DOOR-04), next to the maglock rule; and `lights_alarm` → `show/serverroom/alarm` for the local siren/strobe;
  - `lights_blackout` (and every whole-house darkening) on a **`blackout` group** that leaves out the stairs, the bathroom and the tent; today it targets `house` = everything (HW-SAFE-01, HW-LIT-06);
  - fix the header comment "same ID in every group": whole-house scenes must be stored on the `house` group itself (HW-LIT-02);
  - commit it; then run each rule on the rig (HW-LIT-02, HW-DOOR-03, HW-PATCH-07).
  - Do **not** edit `show.example.yaml`: `test_config.py` pins it, and its rules are the wrong shape for Z2M.
  - The original contents spec (spec §2.15), all now present in the YAML except where noted above:
    - **room lights**: one rule per allow-listed LOCATION for `<cue: lights, room: {room}, state: off|on>` → `zigbee2mqtt/<room-group>/set {"state": "{state}", "transition": 0}` + the WLED segment, `retain: false`;
    - **scenes**: one rule per `cue lights_*` → Z2M `scene_recall` + WLED `{"ps": N}` (the HW-C scene table);
    - `screens_flicker` → also a light blink;
    - `sfx` (from `sound`) → QLab OSC `/cue/<name>/start` or the mpv module;
    - `announce` → `show/announce`;
    - `door` (target `server_room`) → the indicator/maglock topic;
    - **sensors** → `server_door_opened`, `printer_button_pressed`, `printer_opened`, `patch_combo_a` / `patch_combo_b` / `patch_rejected` (stagehand judges the combos until SW-SH-03).
    - **Quote `"on"`** in every WLED payload.
- [ ] **SW-SH-02** 🟡 P0 · S · @__ — **`stagehand/tests/test_trapped_house.py`: written (untracked), `uv run pytest tests/test_trapped_house.py` → 12 passed.** It covers loading, the YAML `on:` trap and retain, every light/flicker cue having a rule, every sound having a QLab cue, the darken/restore rooms, announce and door, sensor signals being `when` rules in `main.loom`, and the combos agreeing across YAML, `Kernel` and codex. Left: commit it, extend it to the new reed / indicator / blackout-group rules, and re-run it after the story rewrite settles. The checks:
  1. every `cue lights_*` / `screens_flicker` / `sound <name>` in the `.loom` files has a rule;
  2. every sensor signal name is a `when <name>` rule in `main.loom` (stagehand never validates names, so a typo is silent);
  3. the YAML combo strings == the `Kernel.combo_*` seeds == the four combo-half codex texts.
- [ ] **SW-SH-03** 🔴 P1 · S · @__ — **Signal `args`**: `signal: {name, args: {combo: "{combo}"}}` → `/api/mod/signal {name, subject, args}`. The server already accepts `args` (`event-runtime.ts:2739-2758`); stagehand drops them (`sensormap.py:52-56`, `modapi.py:118-119`, `show/module.py:138`). Then the story judges `patch_changed {combo}` itself, and QR/terminal check-ins carry `at`.
- [ ] **SW-SH-04** 🔴 P1 · S · @__ — **`var:` action** → `POST /api/mod/var {path, value}`: door state and the tech rail (`Tech.*`) become visible and editable in Run → World, and the story reacts through edge-triggered watchers.
- [ ] **SW-SH-05** 🔴 P1 · S · @__ — **Edge detection + ignore retained MQTT**:
  - pass `msg.retain` through (dropped at `show/mqtt.py:57-58`) and ignore retained sensor messages by default (`accept_retained: true` to opt in);
  - add a per-rule `edge: true` (fire only on false → true).
  - Today the debouncer only rate-limits (`sensormap.py:104-118`): Z2M republishes `contact:false` on every battery/link report, and a retained "open" replays on every reconnect. The story's latch (spec E2: 120 s `alarm_on`) is the backstop.
- [ ] **SW-SH-06** 🔴 P2 · S · @__ — `delay:` on cue outputs, cancelled on `lifecycle` frames. No longer needed for the dance, because the story cues `lights_dance` at +10 s itself; still useful for sequences.
- [ ] **SW-SH-07** 🔴 P1 · M · @__ — **An `http:` cue output and/or an `audio` module (mpv IPC)**, so music, sfx and a TTS "Alexa" play from the laptop without QLab (`do announce` → Kokoro → speaker). Today the only audio path is OSC to an external player.
- [ ] **SW-SH-08** 🔴 P1 · S · @__ — **Parse Loom 4 `cue X with k: v`** (`show/directives.py:80-94`; today it silently matches nothing). Until then the rewrite uses one-token cues and the bracket long form only (spec §0 rule 10).
- [ ] **SW-SH-09** 🔴 P1 · S · @__ — **The YAML `on:` trap**: map a parsed `True` key back to `"on"` in payloads, or reject it (`cuemap.py:182-207`). An unquoted `on: true` ships `{"true": true}` to WLED (verified).
- [ ] **SW-SH-10** 🔴 P1 · M · @__ — **Restart catch-up**: on (re)connect, `GET /api/state?role=mod`, read the mirrors (`Night.lights`, `Night.screen`, door state) and replay the matching rules; handle `lifecycle` frames (`on: {lifecycle: reset}`). Today stagehand ignores `snapshot` / `history` / `lifecycle` (`show/module.py:99-101`), so lights stay wherever the last run left them until `Power On` re-cues.
- [ ] **SW-SH-11** 🔴 P2 · S · @__ — `stagehand check` warns on signal names the model doesn't define; a `table:` scene lookup (10 scenes in 10 lines); log failed MQTT publishes (`show/mqtt.py:72-73`) and use `qos: 1` for show-critical cues.
- [ ] **SW-SH-12** 🔴 P1 · S · @__ — **Tech rail feed**: subscribe to `health/#`, `zigbee2mqtt/+/availability` and `wled/+/status`, and mirror them as `Tech.<node>` (needs SW-SH-04; shows in SW-ADM-06).
- [ ] **SW-SH-13** 🔴 P1 · S · @__ — **Never `pkill -f "stagehand run"`** on the show laptop (it kills the agents worker too). Run `show` and `agents` as two supervised processes (`--only show` / `--only agents`) with their own logs.

## 10. Ops

- [ ] **SW-OPS-01** 🔴 P0 · S · @__ — **Decide LAN laptop vs VPS** (`docs/loom-docker-deploy.md`).
  - **VPS**: real domain + TLS for free (`deploy/Caddyfile`), solving the camera, push and Quest cleartext problems at once, but every device depends on the home uplink (keep an LTE backup).
  - **LAN laptop**: it survives an internet drop, but needs a trusted cert + local DNS, or printed `https://` links won't resolve.
  - Mosquitto, Z2M, WLED and stagehand are LAN-local either way, but stagehand reads the story from the server.
  - With the server on the VPS, the terminals' neural voice needs a path back to Kokoro on the laptop (SW-AI-15).
  - Decide before printing (SW-QR-14).
- [ ] **SW-OPS-02** 🔴 P0 · S · @__ — **HTTPS everywhere**: the Caddy proxy on the VPS, or a Let's Encrypt **DNS-01** cert for e.g. `lan.mapsandducks.com` → the laptop's LAN IP. Needed by camera scanning (`getUserMedia`), Wake Lock, service workers / Web Push, and the Quest (Android blocks cleartext).
- [ ] **SW-OPS-03** 🔴 P0 · S · @__ — Set `LOOM_PUBLIC_URL` / `LOOM_BASE_URL` in `.env` + `docker-compose.yml` once SW-QR-01 reads it.
- [ ] **SW-OPS-04** 🔴 P1 · S · @__ — **Backups**: `pg_dump` + a snapshot of the `LOOM_STATE_DIR` volume (journals, `guests.json`, `pictures/`, `spatial-house.json`) the morning of the party and at doors open; one restore drill on a scratch box. Journals replay on a server restart.
- [ ] **SW-OPS-05** 🔴 P1 · S · @__ — **Avatar pictures cached before the party**: every character's `avatar: File:…` resolves via Wikimedia Commons. Load the story once with internet so `seedAvatars` fills `LOOM_STATE_DIR/pictures` (`core/server/avatars.ts`, `ImageCache({dir})`), and set `LOOM_WIKI=off` on a LAN-only night.
- [ ] **SW-OPS-06** 🔴 P0 · M · @__ — **Rehearsal plan**:
  1. tests + `loomcheck` green;
  2. a Run-mode rehearsal in the editor with personas (local Sim);
  3. a preview event on the real server with friends' phones;
  4. **tech rehearsals** per subsystem (lights, door, patch bay, screens, tent);
  5. a **full dress rehearsal** in the house (below);
  6. a fresh event (or go-live in place) on the night.
- [x] **SW-OPS-08** ✅ — Invitation and member email delivery exists (`core/server/mail.ts`, SMTP or Resend; `core/test/mail.test.ts`). Use it for featured character sheets + claim codes once SW-PLAY-01 lands.
- [ ] **SW-OPS-09** 🔴 P1 · S · @__ — **One-page runbook** taped in the server room: who fires which cue; the IP sheet; recovery steps (agent worker crash → restart `--only agents`, the hold line covers it; stagehand restart → check the lights' state; server restart → journals replay, guests keep tokens; a terminal reload → tap to wake); the leader waiver (`waive_leader_tasks`).
- [ ] **SW-OPS-10** 🔴 P1 · S · @__ — **The morning-of reset**: pinned codes intact, stale `spatial-house.json` deleted (unless it *is* the surveyed map), mind Reset, terminals provisioned `view=mirror`, Quests charged, the door re-armed (SW-STORY-10), lights at `lights_screensaver`.
- [ ] **SW-OPS-11** 🔴 P0 · S · @__ — **Code freeze and production deploy**: freeze a few days out; rebuild the Docker image with the new `play`, `terminal`, `reinstall/web` and `invite` builds; deploy; pin and record the image tag + commit in the runbook; keep the previous image for a one-command rollback. SW-STORY-06 only syncs the story into the preview event.
- [ ] **SW-OPS-12** 🔴 P1 · S · @__ — **Performer training + director briefing**: each performer practises on their booth (pass scanner, guest-card actions, judging buttons, alerts, what a booth readout looks like); the director walks the cue sheet (SW-ADM-01) in running order once with the crew.
- [ ] **SW-OPS-13** 🔴 P1 · S · @__ — **Crew comms fallback** between the director and the Antivirus / hosts: booth readouts are live-only and silent (spec §9 #9), and Web Push and performer alerts may not land. Use radios or a staff group chat (Signal/WhatsApp) as the backup channel; agree the call words (alarm, late list, zip-out).
- [ ] **SW-OPS-14** 🔴 P1 · S · @__ — **Guests without a working phone**: 2–3 loaner phones signed in on demand, a dead-battery policy (charge at the station, pair with a buddy), and the charging station (HW-G). The play app runs 4–5 h with SSE, the screen on and camera scans.
- [ ] **SW-OPS-15** 🔴 P0 · S · @__ — **The invite site** (`invite/`, `loom-invite`, the Pretext): deploy it on the apex domain (`INVITE_ADDRESS`, Caddy `proxy` target) and check it over HTTPS (it says "this door only opens over https"); check the sealed payload (date, address, link); make sure the `webmaster@mapsandducks.com` mailbox it links to receives mail.
- [ ] **SW-OPS-16** 🔴 P2 · S · @__ — **Post-show wrap**: Run export (SW-ADM-09) + backups (SW-OPS-04), publish the recap, return the Mud Room deposit-box items, `lights_restore`, end the event.

### SW-OPS-07 Full dress rehearsal checklist

- [ ] Every phone type present: at least one iPhone (Safari, home-screen PWA) and one Android (Chrome).
- [ ] Join by QR poster → cast pick → Mud Room cutscene → CAPTCHA fail → upload → pass → Antivirus scan → Clearance → Tube chase lights → Desktop.
- [ ] A featured invitee claims their program with a claim code; a second device joins the Trojan Horse.
- [ ] Terminals show the screensaver/ads and **never** pilot before `introduce_trabolta`; Trabolta has no row on any phone.
- [ ] C1 → every locked phone wakes (push), every screen flashes, the lights sweep, Alexa speaks.
- [ ] Bingo countdown on the screens; `bingo_time`; a capture → tent → WebMD video → Quest find → released → the TV mirror shows it.
- [ ] `introduce_trabolta` → terminals re-provisioned / attract mode lifts; a guest DMs him; the Mind page shows the stage.
- [ ] Hunt 1 slide + countdown; scan 5 clue QRs (iPhone camera and in-app scanner); a wrong-code flood is throttled.
- [ ] Judging from Clippy's phone (✅ / 😤 / 🤷); Truth or Dare; ad hijack video starts in sync on all screens.
- [ ] Truther Download at +2 min; every featured glitch choice docks; Truthcoin trade between two guests.
- [ ] Room check-ins: a room-sign QR moves a guest into that room's chat (any time of night); the 5-minute warning; summons closed → the late list pings the Antivirus phones (sound on); a Bathroom Mode guest auto-expires.
- [ ] Truth Pong (backyard flood on); Trust Chart on the TV; printer START (button) → lid (sensor) → beans; zip everyone out ends the tent sessions.
- [ ] Overshare scenario picked correctly; Y2K clock runs; `turn_back_the_clock` adds 5 min; factions recruit to a majority.
- [ ] Door opened while locked → alarm once (latched), siren, red lights, INTRUSION screens, Antivirus alerted; after the majority, the door opens quietly and the indicator is green.
- [ ] Patch bay: a wrong combo → rejected (and the alarm on the second); Combo A → blackout < 0.5 s on both light systems + screens black (stairs, bathroom and tent stay lit), takeover on phones, the dance song with the lights back at +10 s; repeat for Combo B.
- [ ] A breaker flip / bulb power cycle mid-blackout: bulbs come back in their previous state, not full white (HW-LIT-01).
- [ ] Final reveal → Bobbing → truth.txt on screens → verdict → Song Ending / Grok Prom → pickup line → song; then the advice alt path.
- [ ] Restart the story mid-show: lights, screens and the door indicator re-converge; guests re-join cleanly.
- [ ] Kill and restart stagehand, the agent worker and one terminal mid-show; note the recovery times.
- [ ] Battery check after 2 h: Quests, wall tablets, Antivirus phones.

---

# HARDWARE

Prices are approximate (Oct 2026) and must be re-checked. Columns: Owner, Status (✅ in hand + tested, 🟡 in hand / untested, 🔴 to buy or build).

## A. Network and server

| Item | Qty | ~Price | Link | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| Show router / AP (e.g. GL.iNet GL-MT3000 Beryl AX) | 1 | $80–90 | — | 🔴 | @__ | Separate from the house Wi-Fi; Wi-Fi 6 |
| Mesh node near the tent | 0–1 | $80 | — | 🔴 | @__ | Tent coverage matters most (Quests, tablet) |
| Show laptop (server and/or Mosquitto, stagehand, Ollama, Kokoro) | 1 | owned | — | 🟡 | @__ | gpt-oss:20b + orchestrator + Kokoro at once: check RAM/thermal under load (SW-AI-08) |
| Zigbee coordinator (Sonoff ZBDongle-E/-P or SLZB-06) + USB extension | 1 | $25–40 | [Z2M](https://www.zigbee2mqtt.io/) | 🔴 | @__ | Only one. On a USB **2.0** port or an extension, away from USB 3.0 ports and hubs (they radiate at 2.4 GHz). Z2M 2.x: ZBDongle-E → `adapter: ember`, -P → `adapter: zstack`. An SLZB-06 runs over Ethernet/PoE, so it can sit mid-house instead of at the laptop |
| UPS for laptop + router + coordinator | 1 | ~$70–100 (judgment) | — | 🔴 | @__ | A tripped breaker shouldn't end the night |
| LTE hotspot / phone tether (backup WAN) | 1 | owned | — | 🟡 | @__ | Needed if the server is on the VPS |
| Power strips, taped cable runs, gaffer tape | — | $40 | — | 🔴 | @__ | Tape the wall switches feeding Zigbee bulbs ON |
| Director station: a second laptop or tablet for Run mode | 1 | owned | — | 🟡 | @__ | Separate from the server / Ollama / Kokoro laptop, so a frozen browser can't take the show down |
| Crew radios (4–6) or an agreed staff group chat | 1 set | $40–80 / free | — | 🔴 | @__ | Fallback comms with the Antivirus and hosts (SW-OPS-13) |
| Guest Wi-Fi join poster + QR (`WIFI:S:…;T:WPA;P:…;;`) | 2–3 | print | — | 🔴 | @__ | Guests are on a separate SSID; hang at the door and in the Desktop |

- [ ] **HW-NET-01** 🔴 P0 · @__ — Show router: a **2.4 GHz-only IoT SSID** (WPA2, no band steering, no WPA3-only) for ESP32s, WLED and tablets.
  - Force the 2.4 GHz band to **20 MHz channel width**: a 40 MHz (HT40) channel lands on the Zigbee channel whatever Wi-Fi channel you pick.
  - Set the IoT SSID to **802.11b/g/n with 11ax off on 2.4 GHz** (no TWT/OFDMA; PMF optional, not required). Older ESP32/ESP8266 firmware and Fire OS tablets are known to fail to join Wi-Fi 6 APs, and the GL-MT3000 is one.
  - **Choose the Zigbee channel when the network is created** (every bulb is being reset and re-paired anyway): 15, 20 or 25 sit between Wi-Fi 1/6/11; avoid 26 (power-limited, some bulbs dislike it). Then pick the Wi-Fi channel away from it (Zigbee 15 → Wi-Fi 11; Zigbee 20/25 → Wi-Fi 1). Changing the Zigbee channel after pairing means re-pairing everything.
  - Guests on a separate SSID or cellular.
- [ ] **HW-NET-02** 🔴 P0 · @__ — **DHCP reservations / static IPs** for the laptop, Z2M host, every ESP32/WLED node, every terminal tablet and the TV box; an **IP sheet** taped inside the server room.
- [ ] **HW-NET-03** 🔴 P0 · @__ — **One Mosquitto broker** on the laptop (`brew install mosquitto`; `listener 1883 0.0.0.0`). Mosquitto 2.x refuses every remote client once a `listener` is defined unless you **also** set `allow_anonymous true` (isolated show LAN only) or a `password_file`. Allow mosquitto through the macOS firewall. Z2M, stagehand and every ESP32 point at it.
- [ ] **HW-NET-04** 🔴 P1 · @__ — Zigbee2MQTT running against that broker, with `availability` enabled (feeds the tech rail).
- [ ] **HW-NET-05** 🔴 P1 · @__ — Load test: ~30 phones + 8 screens + 2 Quests + tablet on the show AP (SSE + 10 Hz poses ≈ modest), measured in the tent.
- [ ] **HW-NET-06** 🔴 P0 · @__ — **The show laptop never sleeps**: it hosts the broker, Z2M and the coordinator, so a lid close or battery idle drops every light and sensor. Run `caffeinate -dims` (or "prevent sleep on power adapter"), keep it on mains (UPS), and keep the lid open or run clamshell on external power.

## B. Screens

Terminal spots in `./house.json`: `mudroom`, `hall`, `desktop-tv` (the TV), `kitchen`, `bathroom`, `registry`, `tent` (+ a `server-room` spot after SW-MAP-07). The tent's reinstall tablet is a separate device (section F).

| Item | Qty | ~Price | Link | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| Wall tablets (Android preferred, e.g. Fire HD 8 or better; donated phones/tablets fine) | 6–7 | $55–100 each | — | 🔴 | @__ | mudroom (dim), hall, kitchen, bathroom (camera off / outside the door; charger away from the sink), registry, tent, (server room). Fire 7-class struggles with three.js. **Fire OS has no Google Play Services**, so `BarcodeDetector` is missing and the terminal falls back to jsQR; camera scanning also needs HTTPS. Bench-test one before buying 6–7 (HW-SCR-06) |
| Fully Kiosk Browser PLUS licence | 6–7 | €8.90 each | [fully-kiosk.com](https://www.fully-kiosk.com/) | 🔴 | @__ | Autostart, screen on, autoplay, camera, PIN exit, REST/MQTT remote, restart on crash |
| Mounts (removable adhesive or 3D-printed) | 6–7 | $10–15 each | — | 🔴 | @__ | Mount per the measured pos/yaw/pitch (SW-MAP-02) |
| 20 W charger + 2–3 m cable per tablet | 6–7 | ~$15 each | — | 🔴 | @__ | Charge all night |
| TV box: Raspberry Pi 5 (Chromium kiosk) or an old laptop/mini-PC on HDMI | 1 | $110–140 (Pi 5 with the official 27 W PSU, active cooler, case, microSD; Pi prices rose late 2025) | — | 🔴 | @__ | Needs WebGL; HDMI audio to the TV/soundbar. Streaming sticks are too weak for three.js |
| The TV above the fireplace | 1 | owned | — | 🟡 | @__ | Never tested with `view=mirror` |
| Spare tablet | 1 | — | — | 🔴 | @__ | Hot swap |

- [ ] **HW-SCR-01** 🔴 P0 · @__ — Provision each tablet with `/terminal/?code=…&name=…&spot=<id>&view=mirror` (until SW-SCR-01 lands, then `auto`); later with a scoped device QR (SW-QR-10).
- [ ] **HW-SCR-02** 🔴 P0 · @__ — Fully Kiosk settings: start URL `/terminal/`, keep screen on, screen on while plugged, autoplay videos, camera allowed, PIN-locked exit, restart on crash, reload on network reconnect, brightness per room (Mud Room dim).
- [ ] **HW-SCR-03** 🔴 P0 · @__ — TV box: Chromium `--kiosk --autoplay-policy=no-user-gesture-required` at `/terminal/?…&spot=desktop-tv&view=mirror`; HDMI-CEC/remote reachable for the wake tap.
- [ ] **HW-SCR-04** 🔴 P1 · @__ — If any iPads: Auto-Lock Never + Guided Access, and a wake tap after every reload (budget a person for it).
- [ ] **HW-SCR-05** 🔴 P1 · @__ — Install day: run `identify` (SW-SCR-21) or walk each screen; check the face, world view and audio from the speaker screen only.
- [ ] **HW-SCR-06** 🔴 P0 · @__ — **Bench-test the actual tablet model before buying the fleet**: pass scanning through jsQR in Fully Kiosk over HTTPS, the three.js world view frame rate, autoplay video with sound, and joining the IoT SSID (HW-NET-01).
- [ ] **HW-SCR-07** 🔴 P2 · @__ — Optional: Fully Kiosk's REST/MQTT remote (hw-research D.2) wired to stagehand, to blank or reload tablets at the OS level on blackout and to read battery into the tech rail.

## C. Lights

Hue/IKEA on Zigbee2MQTT + PAUTIX RGB COB strips on ESP32/WLED.

| Item | Qty | ~Price | Link | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| Hue White & Colour bulbs | per room plan below | ~$45–55 each | [Z2M Hue](https://www.zigbee2mqtt.io/devices/9290022166.html) | 🟡 | @__ | Native `effect: candle / fireplace / colorloop` (Hue-only manufacturer cluster); factory-reset off the Hue Bridge. **Buy new bulbs as Hue or as plain Zigbee bulbs listed on zigbee2mqtt.io** |
| IKEA TRÅDFRI colour bulbs (**owned ones only**) | per room plan below | owned | [Z2M IKEA](https://www.zigbee2mqtt.io/devices/LED1924G9.html) | 🟡 | @__ | Reset = 6 power toggles; only one attribute per transition; effects are only `blink / breathe / okay / channel_change` (**no `colorloop`, `candle`, `fireplace`**). TRÅDFRI is discontinued: new IKEA stock is **KAJPLATS**, Matter-over-Thread with a hidden Zigbee mode that Z2M marks unofficial (Touchlink-only pairing, no OTA, known **scene/group failures, INSUFFICIENT_SPACE**). Don't buy KAJPLATS for this scene-heavy design ([Z2M KAJPLATS](https://www.zigbee2mqtt.io/devices/KAJPLATS_CWS.html)) |
| Zigbee router plug near the server room and the tent (Sonoff S26R2ZB; an IKEA TRETAKT only if already owned) | 2 | ~$10–15 each | — | 🔴 | @__ | Keeps the mesh alive for the battery door sensor. IKEA's newest plugs likely share the KAJPLATS caveats |
| Outdoor flood for the backyard (Truth Pong) on Zigbee or WLED, **IP65+** | 1–2 | $30–60 | — | 🔴 | @__ | `lights_pong`; on a GFCI outlet (HW-SAFE-03) |
| PAUTIX RGB COB strips | owned | — | [analog](https://mooremuseum.ca/products/pautix-rgb-led-strip-light-wireless-smart-controller-44-key/213648830/) / [addressable SRGB](https://manuals.plus/su/asin/B0BN5N3R82) | 🟡 | @__ | **Identify by the pad labels, not the count**: R/G/B(/W) = analog; DI/DO(/BI) = addressable. 12/24 V addressable strips (WS2815 style, many 24 V WS2811 COB) have 4 pads (+, DI, BI, GND); RGBW analog has 5. **Read the voltage off the strip or its brick** before connecting anything (see the PSU row) |
| WLED controller, analog (Gledopto GL-C-211WL / Athom / QuinLED An-Penta) | 1 per run | €14–24 / ~$20 / see site | [QuinLED An-Penta](https://quinled.info/quinled-an-penta/) | 🔴 | @__ | Analog = one colour per strip: breathe/strobe/lightning OK, **no chase** |
| WLED controller, addressable (QuinLED Dig-Uno / Gledopto GL-C-015WL-D) | 1 per run | ~$20–30 | — | 🔴 | @__ | Needed for a moving Tube chase / "lines that lead you" |
| 24 V PSU: closed desktop brick with IEC inlet (Mean Well GST120A24 5 A per run; GST160A24 6.67 A) **or** LRS-100-24 per run / **LRS-200-24 (8.8 A) for two runs** | 1 per 1–2 runs | $20–35 | — | 🔴 | @__ | Size ×1.25 for **100% white** (WLED's ABL limiter does not apply to analog PWM outputs). Two 5 m runs at 14 W/m = 140 W × 1.25 = 175 W, so an LRS-150-24 (156 W) is **too small**. LRS units are open-frame with **exposed mains screw terminals**: prefer the closed bricks (barrel jacks are ~5 A max), or have a competent person wire the LRS with an earthed 3-core cord, strain relief and a terminal cover/enclosure; never a 2-core cord. If the strips are **12 V**: a 12 V PSU (a 12 V strip on 24 V dies instantly), 5 m × 14 W/m ≈ 5.8 A, 16 AWG, injection at both ends. The owned kits' own adapters can run one strip if rated ≥ 1.25 × its load. Keep off carpet and out of the tent |
| Inline blade fuse per branch (4–5 A for a ~2.9 A 24 V run), 18 AWG wire (16 AWG for leads > 3 m or 12 V strips), aluminium channel | per run | ~$5 + wire | — | 🔴 | @__ | The fuse sits at the PSU's + output, one per branch, rated **below the wire's ampacity** (18 AWG is fine at 5 A). QuinLED boards fuse internally |
| INMP441 I²S mic for WLED audio-reactive (optional) | 1 per audio-reactive node | ~$3–5 | — | 🔴 | @__ | Needs the WLED audio-reactive build; for `lights_dance` and the rave |

**Room plan (fill in counts after the walk-through).** Use these Z2M group names, which are the ones `stagehand/trapped.house.yaml` uses, plus `house` for everything and `blackout` for everything that may go dark. Avoid `/` in names. WLED device topics: `wled/tube`, `wled/living`, `wled/kitchen`, `wled/backyard`, `wled/registry`, `wled/server`, and the group topic `wled/all`. If a room mixes Hue and IKEA bulbs, add per-brand sub-groups (`living_hue` / `living_ikea`) for effects (HW-LIT-02).

| Z2M group | LOCATION | Bulbs (Hue / IKEA) | WLED runs | Used by cues |
|---|---|---|---|---|
| `living` | The Desktop | __ | Desktop perimeter | screensaver, call_desktop, game, truth_time (fireplace), ad_hijack, trust_chart, y2k, dance, song, rave, restore, `cut_the_lights` |
| `tube` (hall + stair landing) | The Tube | __ | **Tube chase (addressable)**, `wled/tube` | tube_chase, call_desktop |
| `kitchen` | The Cache | __ | — | `cut_the_lights`, glitch |
| `mudroom` | The Mud Room | 0–1 (dim) | — | pitch black on arrival |
| `bathroom` | Disk Cleanup | 1 | — | never darkened by Trabolta |
| `backyard` | The Cloud | flood + path/shed light | `wled/backyard` (opt.) | pong, `cut_the_lights`; **lit all night** for clue hunting in the yard and shed (HW-LIT-08) |
| `registry` | The Registry | __ | — | `cut_the_lights` |
| `tent` | The Internet | 1 (low, never dark: Quest tracking needs light) | — | never darkened by Trabolta |
| `server_room` | The Server Room | 1 colour (indicator alternative) | optional red strip, `wled/server` | server_open, alarm |
| `house` | all | — | `wled/all` | screensaver, call_desktop, ad_hijack, glitch, y2k, alarm, dance, final_reveal, song, rave, purgatory, banish, restore, flicker |
| `blackout` | all **except** the stairs, `bathroom` and `tent` | — | `wled/all` | `lights_blackout` (HW-SAFE-01); today the YAML sends the blackout to `house`, which darkens the tent and the stairs (SW-SH-01) |

**Scenes per show cue.** This table is copied from `stagehand/trapped.house.yaml` (its header comment); the YAML is the source of truth, so change both together. One ID per cue (ID = the row number), WLED presets with the same ID on every node.

**Zigbee scenes are keyed by (group ID, scene ID).** Storing scene 3 on every room group does **not** make `scene_recall: 3` on the `house` group work. So: for a **whole-house** cue, set every room to the look, then `scene_store` that ID **on the `house` group itself**, and the show recalls it with one multicast. For a **room** cue (`living`, `backyard`, `server_room`), store it on that room's group. That keeps every cue at one Zigbee command (HW-LIT-07). Check per-bulb scene capacity: 15+ IDs across a room group plus `house` is a lot; test it in HW-LIT-02.

| ID | Cue (spec §2.13) | Z2M group → payload | WLED | Look |
|---|---|---|---|---|
| 1 | lights_screensaver | `house` scene 1 | `all` ps 1 | dim cool blue (static on Zigbee; the "drift" comes from WLED) |
| 2 | lights_tube_chase | — | `tube` ps 2 | chase toward the living room (addressable) |
| 3 | lights_call_desktop | `house` scene 3 | `all` ps 3 | white, living room bright; floor lines sweep to the Desktop |
| 4 | lights_game | `living` scene 4 | `living` ps 4 | warm, bright |
| 5 | lights_truth_time | `living` scene 5 | `living` ps 5 | spot on the fireplace |
| 6 | lights_ad_hijack | `house` scene 6 | `all` ps 6 | garish magenta |
| 7 | lights_glitch | `house` `effect: breathe` (works on Hue **and** IKEA) | `all` ps 7 | Lightning / flicker on WLED; never software-strobed over Zigbee |
| 8 | lights_pong | `backyard` ON, brightness 254 | `backyard` ps 8 | floods full |
| 9 | lights_trust_chart | `living` scene 9 | `living` ps 9 | blue podium |
| 10 | lights_y2k | `house` scene 10 | `all` ps 10 | amber, dim; slow red pulse on WLED |
| 11 | lights_server_open | `server_room` scene 11 | `server` ps 11 | dim green |
| 12 | lights_alarm | `server_room` red `effect: breathe` + `house` scene 12 | `all` ps 12 | red pulse, **≤ 3 Hz**, not full-field (HW-SAFE-02) |
| 13 | lights_blackout | `house` (→ `blackout`, SW-SH-01) `{"state":"OFF","transition":0}` | `all` `{"on":false}` | everything off except the stairs, bathroom and tent |
| 14 | lights_dance | `house` scene 14 | `all` ps 14 | dance (audio-reactive if fitted) |
| 15 | lights_final_reveal | `house` scene 15 | `all` ps 15 | near dark, embers |
| 16 | lights_song | `house` scene 16 | `all` ps 16 | pink, romantic |
| 17 | lights_rave | `house` scene 17 | `all` ps 17 | colour on Zigbee (a static scene; `colorloop` would only run on Hue), rainbow/strobe ≤ 3 Hz on WLED |
| 18 | lights_purgatory | `house` scene 18 | `all` ps 18 | grey, dim |
| 19 | lights_banish | `house` scene 19 | `all` ps 19 | red everywhere |
| 20 | lights_restore | `house` scene 20 | `all` ps 20 | house normal |
| 21 | screens_flicker | `house` `effect: blink` (one-shot) | `all` ps 21 | a short Lightning playlist whose `end` is preset 20 |
| — | `<cue: lights, room: X, state: off/on>` | `kitchen` / `living` / `backyard` / `registry` OFF (transition 0) / ON (transition 1) | that room's node `{"on": false/true}` | Trabolta's `cut_the_lights`: The Cache, The Desktop, The Cloud, The Registry only; restored at +90 s by the story |

- [ ] **HW-LIT-01** 🔴 P0 · @__ — Pair every bulb to Z2M (Hue: remove from the bridge / touchlink / `philips_hue_factory_reset`; IKEA: 6 toggles), close to the coordinator. Name the groups per the room plan. Set **`power_on_behavior: previous`** (or `off`) on every bulb, or a tripped breaker or a bumped switch brings bulbs back at factory full white in the middle of a blackout.
- [ ] **HW-LIT-02** 🔴 P0 · @__ — Build every look and `scene_store` it on the group the YAML recalls it on (`house` for whole-house cues, the room group for room cues; see the note above the table). Test scene capacity per bulb model, and `effect` + `transition` on each model. **Effects on mixed groups:** `candle`/`fireplace`/`colorloop` are Hue-only, and an `effect` sent to a group mixing Hue and IKEA may fail or reach only some bulbs. The YAML uses only `breathe` and `blink` (both brands) for effects; if you want Hue-only effects, add per-brand sub-groups, or accept that IKEA bulbs stay static.
- [ ] **HW-LIT-03** 🔴 P0 · @__ — Identify the PAUTIX variant(s) by pad labels and voltage, and buy matching controllers; decide whether the Tube needs an addressable run.
- [ ] **HW-LIT-04** 🔴 P0 · @__ — WLED on each node: MQTT on, device topic per node (the room plan's names) + group topic `wled/all`, **identical preset IDs everywhere** (the table), export `presets.json` as a backup. **PWM frequency:** max it only on QuinLED An-Penta (it has gate drivers). On Gledopto / Athom boards the ESP32 drives the MOSFETs directly, so use **2–5 kHz** (high PWM raises heat and, on ESP32 LEDC, lowers dimming bit depth; 2–5 kHz is still flicker-free on camera).
- [ ] **HW-LIT-05** 🔴 P0 · @__ — Power: PSUs sized ×1.25 at 100% white (see the PSU row; LRS-200-24 or one supply per run), an inline fuse per branch at the PSU, injection at both ends for > 5 m, closed bricks or enclosed + earthed LRS wiring, PSUs off carpet and away from the bobbing tub and the tent. **Heat in the Tube:** COB at 12–16 W/m runs warm; use the aluminium channel or cap preset brightness at ~50–60%, and never wrap a strip fully in fabric, paper "chips" or decor.
- [ ] **HW-LIT-06** 🔴 P0 · @__ — **Blackout rehearsal**: both systems dark in < 0.5 s (one Z2M multicast to the `blackout` group + `wled/all`), the stairs, bathroom and tent stay lit (HW-SAFE-01), screens black (SW-SCR-14), dance look back at +10 s from the story watcher.
- [ ] **HW-LIT-07** 🔴 P1 · @__ — Rate discipline: ≤ 1 Zigbee group command per second sustained; every cue is one multicast (scenes stored on the group that is recalled); flicker = one native `effect` per group, never a loop (Trabolta's powers included).
- [ ] **HW-LIT-08** 🔴 P1 · @__ — **The backyard (The Cloud) and the shed are lit all night**: clues sit in the shed, on the backyard fridge and on a clipboard. Bake a "yard on" level into every whole-house scene (`lights_screensaver`, `lights_game`, `lights_restore`, …) and a path light to the shed; only `cut_the_lights` (The Cloud) and the blackout take it down.

## D. Server-room door ("alerts the app if opened when not unlocked")

**Recommendation.** Primary: a **wired magnetic reed switch on the patch-bay ESP32** (one box owns the door, the indicator, the local siren and the patch bay, with one LWT `health/serverroom`). Fallback, run in parallel: a **Zigbee contact sensor** on the same door, preferably a **Sonoff SNZB-04P** (CR2477 cell, tamper detection) next to the mains router plug. An Aqara MCCGQ11LM also works, but Xiaomi/Aqara end devices are known to drop off some non-Xiaomi routers, so soak-test it for 24 h on the real mesh. **Not IKEA PARASOLL E2013**, which Z2M advises against. Both fire the same story signal `server_door_opened`, and the story's latch makes a double fire harmless.

**Your copper-tape idea, done right (the DIY option).** It works and looks diegetic if you change the geometry:
- Put **both** contacts on the frame: two parallel copper strips on the door-stop moulding, about 5 mm apart. On a hinged door the stop meets the door's **face** near the latch edge, so put **one bridging strip on the door face** where it seats against the stop. Closing the door shorts the two frame strips, and no wire runs to the moving door.
- Wire one frame strip to a GPIO, the other to GND. Closed = LOW, open = HIGH, so with no inversion the binary sensor is **ON = open**.
- Debounce: report "open" only once it has been stable for 300 ms, and "closed" after 50 ms. ESPHome: `filters: [delayed_on: 300ms, delayed_off: 50ms]` (on = open; swap them only if the pin is `inverted: true`).
- **The wire is long and guests touch the tape**: add an external 4.7–10 kΩ pull-up (the internal ~45 kΩ picks up noise on a long unshielded run), a 100 nF capacitor to GND at the ESP, and a **1 kΩ series resistor** (mandatory for copper tape, an ESD path from guests' hands; a small TVS diode is better still). The same input conditioning applies to the reed.
- Use tape with **conductive adhesive**, and press hard. The door is held only by its latch, so contact pressure is close to zero: that, more than the tape, is why foil-to-foil is unreliable, and a 1 mm gap reads "open". A phosphor-bronze weatherstrip, a door-jamb plunger switch (~$5) or a roller microswitch on the frame is the same circuit and far more repeatable. Any of them plugs into the reed's GPIO.

**How "unlocked" is decided (the story owns it; the hardware only reports and shows it):**
- `Kernel.server_unlocked` starts false. It flips true at `majority_reached`: a faction has strictly more than half of all programs **and** its leader did their task (Excel planted the virus, or OpenOffice holds 20 facts), unless the director fires `waive_leader_tasks`. The director can also force `server_unlock`.
- The door opening while locked plays `Server Room Alarm` **once per 120 s** (latched `Night.alarm_on`; only the first alarm costs Trabolta composure): red lights, a siren, INTRUSION on the screens, Antivirus booth readouts, and an `!` alert to everyone.
- The door opening while unlocked: no alarm (`lights_server_open`). Non-members are policed by the Antivirus in person, because the sensor can't tell who opened the door.
- Wrong patch combos trip the alarm on the second wrong combo, or on any wrong combo while the room is locked.

| Item | Qty | ~Price | Link | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| MC-38 surface reed + magnet (5-pack) | 1 | $8–10 | — | 🔴 | @__ | GPIO23 + external pull-up + RC (above) on the patch-bay ESP32. Most close when the magnet is present (alarm "NC"), some are sold NO: **check with a meter**. The 15–25 mm gap rating drops sharply on a steel door or frame (cold rooms often have one): mount on a spacer block |
| Sonoff SNZB-04P (preferred) **or** Aqara MCCGQ11LM | 1 | $15–19 / $17–18 | [SNZB-04P](https://www.zigbee2mqtt.io/devices/SNZB-04P.html) · [MCCGQ11LM](https://www.zigbee2mqtt.io/devices/MCCGQ11LM.html) | 🔴 | @__ | Name it `server_room_door` in Z2M (the YAML's topic). Fresh coin cell the week before; payload `contact:false` = OPEN. Aqara: 24 h soak test first |
| Copper foil tape with conductive adhesive (DIY option) | 1 roll | ~$8–12 (judgment) | — | 🔴 | @__ | Or a plunger switch / roller microswitch (~$5) |
| WS2812B 12–16 LED ring (lock indicator over the door) | 1 | $6–8 | — | 🔴 | @__ | Red breathing = armed, green = unlocked, pulse ≤ 3 Hz = alarm. At 5 V it needs VIH ≥ 3.5 V, so the ESP32's 3.3 V data is marginal over a wire: add the level shifter below, keep a 330 Ω series resistor. ~1 A at full white for 16 LEDs: feed it from the 5 V PSU, **not** the DevKit's USB 5 V pin, and cap brightness in firmware |
| 74AHCT125 / SN74AHCT1G125 level shifter + 470–1000 µF capacitor across the ring's 5 V | 1 | ~$2 | — | 🔴 | @__ | For the ring's data line |
| DFPlayer Mini + microSD + 3 W speaker (local siren) | 1 | ~$8 | — | 🔴 | @__ | Shared with the patch bay's sounds. GPIO16/17 UART is fine on a **WROOM-32 only** (they're PSRAM on WROVER). 1 kΩ series resistor on ESP TX → DFPlayer RX, 100–470 µF capacitor at the DFPlayer (speaker pulses otherwise cause noise and ESP brownouts) |
| Optional 12 V maglock + relay + fail-safe PSU | 0–1 | ~$25–40 (judgment) | — | 🔴 | @__ | **Fail-safe only** (unlocks on power loss) and the door must always open from inside. Flyback diode across the coil unless the lock has one built in. The YAML drives it as a Zigbee relay `server_room_lock` |
| Optional: 4×4 keypad / LD2410 mmWave / Zigbee PIR inside / capacitive touch pad on the handle | 0–1 | $3 / $5 / $15–20 / ~$2 | — | 🔴 | @__ | A disarm code learned from the codex (SW-STORY-14); "someone is in there"; "someone is touching the door" warning (HW-DOOR-08) |

- [ ] **HW-DOOR-01** 🔴 P0 · @__ — Reed switch on the frame + magnet on the door, wired to the patch-bay ESP32 with the input conditioning above; firmware publishes **`sensors/serverroom/door {"open": bool}`** on change only (open after 300 ms stable, closed after 50 ms), **not retained** (or retained only once SW-SH-05 ignores retained messages). The YAML has no rule for it yet (SW-SH-01).
- [ ] **HW-DOOR-02** 🔴 P0 · @__ — Zigbee contact sensor paired on the same door as `server_room_door`, with a mains Zigbee router plug nearby (cold-storage rooms are often RF-dead).
- [ ] **HW-DOOR-03** 🟡 P0 · @__ — Stagehand sensor rules (both sources → `server_door_opened`, `debounce_s` 5–20) in `trapped.house.yaml`. **The Zigbee half is written** (`zigbee2mqtt/server_room_door`, `contact == false`, debounce 20 s); the reed half is missing (SW-SH-01). Once SW-SH-05 lands, `edge: true` + ignore retained. Test: propped door, a battery report, a stagehand restart with the door open.
- [ ] **HW-DOOR-04** 🔴 P1 · @__ — Lock indicator: the ESP32 subscribes to **`show/serverroom/lock`**, which a `door` rule publishes on `do door server_room, state: locked|unlocked` (retained is fine for this **indicator** topic, so a rebooted ESP re-converges), and to `show/serverroom/alarm` (from `lights_alarm`). Both rules are still to add (SW-SH-01; today the `door` cue only drives the Zigbee maglock relay). Local strobe on alarm even if Wi-Fi drops.
- [ ] **HW-DOOR-05** 🔴 P1 · @__ — Local siren on the DFPlayer for 2–3 s on alarm, plus the house `sound alarm_siren` (HW-AUD).
- [ ] **HW-DOOR-06** 🔴 P2 · @__ — Optional DIY copper-tape contact (frame-bridge geometry above) as a third, diegetic input on another GPIO.
- [ ] **HW-DOOR-07** 🔴 P2 · @__ — Optional maglock (fail-safe, egress always possible, flyback diode) on the Zigbee relay `server_room_lock` the YAML already drives, plus a manual key/button for staff.
- [ ] **HW-DOOR-08** 🔴 P2 · @__ — Optional capacitive "someone is touching the door" pad on the handle (hw-research A.2; ESP32 touch pin) → a `server_door_touched` warning to the Antivirus before the alarm. Needs a `when` rule and an ESD series resistor.

## E. Trabolta's heart: the video patch bay

**What the story needs.** The rewrite's combos use 8 "fixed voltage" jacks on top (`V1…V8`) and 8 "DAC" jacks below (`D1…D8`). **Combo A** = `V2-D5,V4-D1,V6-D8,V7-D3` disables Trabolta ("take the grease out of the lightning"). **Combo B** = `V1-D6,V3-D2,V5-D7,V8-D4` destroys the computer. Each combo is split into **codex pieces** that the majority faction earns. The `Kernel.combo_*` seeds, the codex halves and the YAML strings must match, and SW-SH-02 tests that.

**Before anything: bench-test the bay** (multimeter on the rear BNCs; on an intact bay the rear connectors are the only electrical access, and a front plug connects the cord to its rear):
- centre-to-shell ≈ 75 Ω means the bay is **self-terminated**. An empty jack then reads "connected" against any pull-up, and it ruins a voltage ladder too. **Test twice**: once with nothing plugged in, and again with a cord in one front jack while you measure its partner's rear centre-to-shell. On many self-terminating bays the termination switches in **only when a plug breaks the normal**, so the empty test reads open and misses it; a terminated jack then reads LOW on every scan and looks patched to everything.
- top-N centre to bottom-N centre ≈ 0 Ω means **normalled**. Every column then reads as already patched.
- Fix, in order of preference: swap to non-normalled, non-terminated jack modules; open the bay and cut the normal links and termination resistors; or treat the front panel as a façade and solder your own wire to each jack's centre, with all shells on GND.

**Why I'd sense it digitally, not with voltages (kindly).** Your voltage idea is thematically perfect, and you can keep it as the fiction: labels, meters and real DACs driving needles. As a *sensor*, though, it has problems:
- To identify a patch, the bottom row has to be **read** by an ADC. Two DAC outputs patched together just fight each other.
- With Wi-Fi on only ADC1 works (ADC2 is blocked), and on a WROOM-32 DevKitC only **6** ADC1 pins are broken out (GPIO32, 33, 34, 35, 36/VP, 39/VN; 37/38 aren't). They are nonlinear at both ends too.
- 75 Ω terminations and old, oxidised jacks shift the levels.
- A ladder can't see top-to-top patches at all.

The digital scan is cheaper and unambiguous:
- Drive one jack LOW at a time, with every other jack on a pull-up input. Any jack that reads LOW is connected to the driven jack by a cable.
- Each jack takes one plug, so there's no ghosting and no diodes are needed.
- It sees **every** patch, including the "wrong" ones that should trip the alarm.

**If you prefer the voltage version, here's how it works:**
- 8 top jacks fed from a resistor ladder off 3.3 V at distinct levels about 300 mV apart (0.3, 0.6 … 2.4 V).
- Each of the 8 bottom jacks gets a **~1 MΩ pulldown on the jack side** (an empty jack reads 0 V) and a small **1–10 kΩ series resistor** to an **ADS1115** channel (2 boards × 4 channels, I²C). Don't use 100 kΩ series + 100 kΩ pulldown: that is a 2:1 divider, the levels land 150 mV apart, and a ±100 mV window overlaps its neighbours. Buffered taps also work.
- Firmware maps each reading to the nearest level within **±75 mV or less**, using a calibration table made with your actual cables.
- It still needs the bay de-terminated and de-normalled, and it can't detect top-to-top patches.

| Item | Qty | ~Price | Link | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| The video patch bay (2×24 / 2×26 / 2×32, WECO / mini-WECO / BNC) | 1 | owned | — | 🟡 | @__ | Identify jacks + normals + termination first |
| ESP32-DevKitC (classic **WROOM-32**, not WROVER) | 2 (1 spare) | $8–10 each | — | 🔴 | @__ | Also runs the door reed, ring, siren and meter. Spare-pin rules: avoid strapping pins 0, 2, 5, 12, 15 (a pull-up on GPIO12 selects 1.8 V flash and the board won't boot), flash pins 6–11, and input-only 34–39 for anything needing an internal pull-up |
| MCP23017 breakouts (e.g. Adafruit #5346) | 4–5 | $3–6 each | [GPA7/GPB7 note](https://best-microcontroller-projects.com/mcp23017.html) | 🔴 | @__ | **GPA7/GPB7 are output-only since datasheet rev D**: use 14 pins per chip for **every** jack (the 4–5 count already assumes this). Putting drive-only top jacks on GPx7 makes a top-to-top patch between two GPx7 jacks invisible, which breaks "detect a wrong patch anywhere". Keep the MCPs within ~30 cm of the ESP32 and make the jack wires the long ones |
| or 74HC595 ×3 + 74HC165 ×3 (+ 1 kΩ series per '595 output) + 10 kΩ × 8 pull-down networks per '165 | 1 set | ~$1 each | — | 🔴 | @__ | Cheaper/faster; sees top→bottom patches only. Without pull-downs a '165 input with no cord floats and the scan reads garbage: drive one '595 output HIGH at a time against the pull-downs (or the inverse) |
| BNC pigtails / leads to the rear connectors | 48–64 | ~$1 each (bulk) | — | 🔴 | @__ | Only if you don't open the bay: wire the rear BNCs, all shells to GND |
| Perfboard, ribbon cable, JST/Dupont, 10 kΩ external pull-ups for the **jack inputs** (replacing the MCP's internal ~100 kΩ) | — | ~$15 | — | 🔴 | @__ | I²C: the Adafruit #5346 boards already carry 10 kΩ SDA/SCL pull-ups (four in parallel ≈ 2.5 kΩ), so you likely need none; a longer I²C run needs *lower* values (~2.2 kΩ), never 10 kΩ |
| Video patch cords matching the jacks | 10–12 | $15–40 each (used: less) | — | 🔴 | @__ | More cords than the solution needs, so the count gives nothing away |
| 1-ch relay modules, **3.3 V-trigger** (the satisfying "click") | 1–5 | $2–3 each | — | 🔴 | @__ | Common 5 V active-low opto modules with JD-VCC at 5 V often **won't turn off** from a 3.3 V HIGH; buy 3.3 V-trigger modules or drive 5 V ones through an NPN/MOSFET |
| Analog panel meter: **0–3 V** voltmeter, or a 100 µA–1 mA movement with a series resistor (~3.3 kΩ for 1 mA at 3.3 V) ("core voltage") | 1 | ~$8 | — | 🔴 | @__ | A 0–5 V meter on the DAC (0–~3.2 V) never passes ~64% of scale, and a 1 mA movement loads the weak DAC (buffer it). Simplest: plain PWM on any pin; the coil averages it, so the RC filter is optional. The needle drops as correct cables go in |
| 5 V **4 A** supply | 1 | ~$12 | — | 🔴 | @__ | Worst case is near 3 A (ESP32 ~0.3 A, ring ~1 A, DFPlayer at 3 W ~0.6 A with peaks, up to 5 relays ~0.35 A): use 4 A or cap the ring. Never feed external 5 V into the DevKit's 5 V pin while USB is also plugged in (it back-feeds the host) |
| Optional "commit" button or key switch | 0–1 | $3–15 | — | 🔴 | @__ | The combo is judged only when pressed, never mid-patch (HW-PATCH-09) |
| Optional 2× MCP4728 (8 real DAC channels) | 0–2 | ~$8 each | — | 🔴 | @__ | Only if the bottom row should literally be DACs driving meters/LEDs; the ESP32 has 2 DAC pins |
| Labels: top row absurd voltages (`+5V`, `−12V`, `GREASE`, `LIGHTNING`, `1.21 GW`, `SANDY`, `88 MPH`), bottom `DAC 00…` | — | printing | — | 🔴 | @__ | Keep V1…V8 / D1…D8 recoverable for the clues |
| Optional ADS1115 ×2 (voltage version) | 2 | $3–6 each | — | 🔴 | @__ | Only if you choose the ladder |
| Optional big MAIN POWER toggle on a spare **MCP** pin | 0–1 | $5–15 | — | 🔴 | @__ | Alternative physical trigger for Combo B (decision). Not on an ESP32 strapping pin (see the DevKitC row) |

- [ ] **HW-PATCH-01** 🔴 P0 · @__ — Identify the bay and bench-test normals + 75 Ω termination, both empty and with a cord in the partner jack; pick a fix (swap modules / desolder / façade).
- [ ] **HW-PATCH-02** 🔴 P0 · @__ — Wire every jack's **rear connector** centre to an expander pin (BNC pigtails or solder to the rear contacts; all shells → GND), 14 pins per MCP. Wire **all** jacks, not just V1–V8/D1–D8, so a wrong patch anywhere is detected.
- [ ] **HW-PATCH-03** 🔴 P0 · @__ — **Firmware** (Arduino + `Adafruit_MCP23X17` + PubSubClient; ESPHome is fine for door-only nodes):
  - setup: static IP; MQTT with LWT `health/serverroom` = `lost` and birth message `online`, **both retained**, so the tech rail shows the right state after a broker or stagehand restart.
  - loop at ~20 Hz: run `scan_all_pairs()`; accept a new map only after it has been **stable for 1 s**; append added pairs to an insertion order; click a relay + beep on each new pair.
  - publish (not retained) **`sensors/patchbay/state`** (the topic the YAML listens on) `{"pairs": [["V2","D5"],…], "combo": "V2-D5,V4-D1,…" (V-sorted, labels not pin numbers), "count": n, "complete": n == 4}` plus edge events `sensors/patchbay/event {"event": "progress"|"wrong"|"solved"|"reset"}`.
  - door: the reed → `sensors/serverroom/door` (HW-DOOR-01).
  - subscribe to `show/serverroom/lock` + `show/serverroom/alarm` → ring + siren (HW-DOOR-04).
- [ ] **HW-PATCH-04** 🟡 P0 · @__ — Stagehand rules (until SW-SH-03): `complete == true && combo == '<A>'` → `patch_combo_a`; `== '<B>'` → `patch_combo_b`; any other complete combo → `patch_rejected`. **Written** in `trapped.house.yaml` on `sensors/patchbay/state` (debounce 60 s / 60 s / 10 s) and cross-checked against the `Kernel` seeds + codex by `test_trapped_house.py`; untested against the real scanner (HW-PATCH-07). After SW-SH-03: one `patch_changed {combo}` and the story judges it (spec E3).
- [ ] **HW-PATCH-05** 🔴 P1 · @__ — Feedback layer: a relay click per correct cable, the ring stepping red → green, the meter needle falling, DFPlayer hum/sputter; a short buzz on a wrong cable. The **blackout comes from the story**, not the device, so rehearsals replay it.
- [ ] **HW-PATCH-06** 🔴 P1 · @__ — Combos as codex pieces: print the four combo-half entries' QR posters (spec §8.3) only after SW-SH-02 confirms the strings match.
- [ ] **HW-PATCH-07** 🔴 P0 · @__ — Bench test against stagehand + a scratch server: each combo fires the right ending exactly once; a stagehand reconnect fires nothing; unplugging everything publishes `reset`.
- [ ] **HW-PATCH-08** 🔴 P2 · @__ — Optional MAIN POWER switch (decision: Combo B by cables, or by the switch).
- [ ] **HW-PATCH-09** 🔴 P2 · @__ — Optional "commit" button / key switch: publish `state` only on press (or add `"committed": true`), so a half-finished patch never trips `patch_rejected`; and optional 2× MCP4728 if the bottom row should drive real meters/LEDs.

## F. Reinstall tent (The Internet)

| Item | Qty | ~Price | Link | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| Meta Quest 3 (3S works too) | 2 | owned? (~$500 each) | — | 🟡 | @__ | Developer Mode (needs a Meta developer org); APK sideloaded (SW-RE-01) |
| USB-C PD 45 W charger + short cable per headset, or battery head straps | 2 | $25–35 each | — | 🔴 | @__ | ~2–2.5 h of play per charge; the party is 4–5 h |
| Rechargeable AAs for Touch Plus controllers + spares, wrist straps | 6–8 | ~$20 | — | 🔴 | @__ | |
| Face-interface covers / disposable covers, lens wipes, hair ties | — | ~$20 | — | 🔴 | @__ | |
| Tent tablet ≥ 10" with a rear camera (Android + Chrome preferred) | 1 | $150–250 or reuse | — | 🔴 | @__ | Runs `/reinstall/?…&role=both` (scan, Play here, Send to headset); WebMD video |
| Floor stand / arm for the tablet at chest height | 1 | $30–40 | — | 🔴 | @__ | `FREE-TRIAL-30-DAYS` QR taped to it |
| Battery LED EXIT sign | 1 | ~$20 | — | 🔴 | @__ | At the real exit, egress clear of cables |
| Two marked VR station mats (1.4 m squares) + a swivel stool / tactile mat | 2 | ~$30 | — | 🔴 | @__ | Stationary boundary; thumbstick locomotion |
| Queue seating | 3–5 | — | — | 🔴 | @__ | Truth Pong can capture 5–10 at once |
| Tent power strip with taped runs | 1 | ~$20 | — | 🔴 | @__ | Outdoor tent: an outdoor-rated, GFCI-protected feed (HW-SAFE-03) |
| Optional 4th player device (a spare phone on `/reinstall/?role=player`) | 0–1 | owned | — | 🟡 | @__ | SW-RE-13 |
| Optional Bluetooth keyboard for the tent operator | 0–1 | ~$20 | — | 🔴 | @__ | Faster typed-name fallback and keyboard play (reinstall §4) |

- [ ] **HW-TENT-01** 🔴 P0 · @__ — Each Quest: latest OS, Developer Mode, the APK, its own `station.json` (`vr-1` / `vr-2`, `server`, scoped code), stationary boundary, proximity sensor **on** (the game ends a session 2 s after removal), display-off timeout raised, passthrough auto-switch off, app pinned.
- [ ] **HW-TENT-02** 🔴 P0 · @__ — Tablet: kiosk, screen timeout off, volume up, a secure context for the camera (HTTPS, or the Chrome `unsafely-treat-insecure-origin-as-secure` flag).
- [ ] **HW-TENT-03** 🔴 P1 · @__ — Lighting low but not dark (Quest tracking); no strobe or IR aimed at the headsets; the tent is never on Trabolta's `cut_the_lights` list.
- [ ] **HW-TENT-04** 🔴 P1 · @__ — The virus props: a floppy disk or USB stick with the `LOVE-LETTER-FOR-YOU` QR under VR station 2, and `FREE-TRIAL-30-DAYS` on the tablet stand.
- [ ] **HW-TENT-05** 🔴 P1 · @__ — An AP or mesh node within line of sight of the tent (HW-NET).

## G. Props

| Item | Qty | ~Price | Link | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| Dead inkjet printer + dried beans (loose for the spill, or bagged) | 1 | free + $5 | — | 🔴 | @__ | Lid closed but unlatched |
| Printer START sensor: Zigbee button over the real button (IKEA SOMRIG/STYRBAR, Aqara WXKG11LM) **or** ESP32 + DFPlayer inside | 1 | $10–15 / ~$15 | — | 🔴 | @__ | → `printer_button_pressed` (grind sound from the house speaker or the DFPlayer) |
| Printer lid contact (Zigbee contact or reed on the ESP32) | 1 | $15–18 / $2 | — | 🔴 | @__ | → `printer_opened` (the beans moment) |
| Truth Pong: 6 ft folding table, 10–15 cups, balls, tarp | 1 set | ~$70 | — | 🔴 | @__ | Outside (The Cloud); scoring stays human (made/missed buttons) |
| Bobbing tub, towels, floor mat/tarp | 1 set | ~$40 | — | 🔴 | @__ | Every mains cable and PSU out of splash range, **and** anything powered nearby on a GFCI (HW-SAFE-03) |
| Bag of Truth (waterproof zip bag inside a cloth bag) + **laminated** truth.txt | 1 | ~$10 + print | — | 🔴 | @__ | Print the final text late (recap, SW-AI-09) |
| Computer Bingo cards (17-square asterisk, checkboxes only, spec §8.1) + pens/daubers | 1 per guest + spares | print | — | 🔴 | @__ | Plus the **pre-filled fake card** for `{Night.anti_ai}` (MS Paint) that Task Manager hands Clippy |
| Truth or Dare hat + slips (spec §8.2) | 1 | print | — | 🔴 | @__ | |
| Bingo Ribbons / awards | 10–20 | ~$15 | — | 🔴 | @__ | `award_the_ribbon` |
| Mud Room deposit box ("leave one thing behind") | 1 | — | — | 🔴 | @__ | Upload beat A3 |
| "Zip-up" gear for the Antivirus zip-out (zip hoodies / a giant zipper prop / sleeping bags) | — | — | — | 🔴 | @__ | D8 (decide the bit) |
| USB "glory hole" virus-plant sensor: USB-A female socket + ESP32 (shared with the printer ESP is fine) | 1 | ~$5 | — | 🔴 | @__ | Detect insertion either with a microswitch behind the port, or electrically: power the socket's VBUS from 5 V and put a 15 kΩ pull-down on D+ to a GPIO; a USB 2.0 stick pulls D+ up through 1.5 kΩ to ~3 V the moment it's powered, a clean HIGH. The plug's shell-to-GND short is unreliable (an unpowered stick's shell floats). Hardware can't know *who* planted, so it's flavour (`virus_inserted`) or the director confirms; the guest button `plant_the_virus` stays the source of truth (P2) |
| Trojan Horse (two accordion clowns, one program) | — | guest costume | — | 🔴 | @__ | Tech = the shared identity (SW-PLAY-01); interim: one shared phone |
| "Are you sure?" piñata (optional set piece) | 0–1 | ~$25 | — | 🔴 | @__ | B10 |
| Printed matter: 41 codex QR posters, room check-in signs, guest badges, cast cards, the IP sheet, patch-bay labels, Clippy's instruction cards (backup) | — | printing | — | 🔴 | @__ | From Run → Print (SW-QR-11) after SW-QR-01/02/03 + the test sheet |
| Label stock (Avery 5390/L7418 badges, 5371/L7414 cards) + a printer that works | — | ~$40 | — | 🔴 | @__ | |
| **Clue props** (spec §2.12: every coded "file" is a physical prop carrying its QR) | ~30 | ~$60–120 + print | — | 🔴 | @__ | Framed deed, poker hand-history printout, FBI lanyard, clipboard + site log, two campaign buttons, protest flyer, museum postcard, library notice, sketchbook, livestream screenshot, singed concept sketch, bound thesis, rolled diagram in a tube, saline invoice, termination letter (printer tray), bootleg DVD, the Carney letter, WHOIS printout, Grok sticky note, cooling log, theory binder with Page 999, billboard photo + lease, prom ticket, customer-service card, LiveJournal printout, the four Antivirus personnel files, the Sandy transcript (HW-PROP-07) |
| Laminator + pouches | 1 | ~$30 | — | 🔴 | @__ | Clue props, truth.txt, signs that live outside |
| **The Tube**: a frame + fabric tunnel / draped corridor, hanging wires, cables, chips and computer parts | 1 | ~$60–150 | — | 🔴 | @__ | "a tube of lights and wires and cables and chips" from the front of the house to the living room, and on to the Internet (HW-PROP-08); COB strips in channel, not wrapped in fabric (HW-LIT-05) |
| Living-room and server-room set dressing: LED bits, chips, loose hanging wires, encyclopedias, old computer parts, dead LCD screens | — | ~$40 + thrift | — | 🔴 | @__ | Story overview; around the patch bay too (HW-PROP-09) |
| Guest phone charging station (multi-port USB + mixed cables) + 4–6 power banks for performers | 1 + 4–6 | ~$40 + ~$60 | — | 🔴 | @__ | SW-OPS-14; the play app runs 4–5 h with SSE, the screen on and camera scans |
| Loaner phones for guests without one | 2–3 | owned / donated | — | 🟡 | @__ | SW-OPS-14 |
| Optional sensors: front-door contact (arrival pacing, "new program detected") + Tube-entrance PIR (→ `tube_chase`) | 0–2 | ~$15–20 each | — | 🔴 | @__ | stagehand-hw §6.2 (HW-PROP-10) |
| Optional wireless mic + small PA for Clippy | 0–1 | ~$60–120 | — | 🔴 | @__ | Running games for ~30 people (judgment) |
| Sandy's on-stage presence (an Echo/speaker prop, a phone on hold, or just the screens) | 0–1 | owned | — | 🔴 | @__ | "He goes up to Sandy" (F4–F6); Decisions #28 (HW-PROP-11) |

- [ ] **HW-PROP-01** 🔴 P1 · @__ — Build the bean printer + START button + lid sensor (the admin buttons are the fallback). The stagehand rules are **already written** in `trapped.house.yaml`: name the Z2M devices `printer_button` (`action == 'single'` → `printer_button_pressed`) and `printer_lid` (`contact == false` → `printer_opened`), or change the YAML to match an ESP32 build.
- [ ] **HW-PROP-02** 🔴 P1 · @__ — Truth Pong set + the patio flood on `lights_pong`.
- [ ] **HW-PROP-03** 🔴 P1 · @__ — Bobbing station + Bag of Truth + laminated truth.txt.
- [ ] **HW-PROP-04** 🔴 P0 · @__ — Print Bingo cards, hat slips, the fake Bingo card, room signs, codex posters (after the test sheet, SW-QR-14).
- [ ] **HW-PROP-05** 🔴 P2 · @__ — USB glory hole sensor (flavour signal; decide whether it fires anything).
- [ ] **HW-PROP-06** 🔴 P1 · @__ — Hang every poster per the setup map (SW-QR-13) or a hand-drawn one; photograph each in place.
- [ ] **HW-PROP-07** 🔴 P1 · @__ — **Fabricate the clue props** (the list in the table, from spec §2.12): art + print each document, age/frame/bind as needed, laminate what lives outside, and attach each prop's QR from Run → Print. Track each prop ↔ codex entry ↔ hiding place in the setup map (SW-QR-13).
- [ ] **HW-PROP-08** 🔴 P1 · @__ — **Build the Tube**: the structure and dressing from the front of the house to the living room (and on toward the tent), with the addressable WLED run mounted in channel; keep egress clear and nothing flammable on the strips.
- [ ] **HW-PROP-09** 🔴 P2 · @__ — Living-room and server-room set dressing (story overview).
- [ ] **HW-PROP-10** 🔴 P2 · @__ — Optional sensors: a front-door contact → `program_arrived` (arrival pacing) and a Tube PIR → `tube_chase`; each needs a `when` rule in `main.loom` and a YAML sensor rule.
- [ ] **HW-PROP-11** 🔴 P1 · @__ — **Stage Sandy** once Decisions #28 is made: the prop, where it sits on the Desktop, and the audio route for her lines (HW-AUD-06).

## H. Audio

| Item | Qty | ~Price | Link | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| Powered speaker for the living room | 1 | $100–200 | — | 🔴 | @__ | From the TV box (HDMI) or the laptop (3.5 mm / USB DAC). Don't rely on tablet speakers for music |
| Cue player: QLab (macOS, OSC on UDP 53000) **or** the stagehand mpv/`http:` module (SW-SH-07) | 1 | QLab tier check / free | — | 🔴 | @__ | `sound <name>` → stagehand `sfx` → the player |
| Optional Echo used as the "Alexa" speaker (Bluetooth from the laptop), or HA + Alexa Media Player (cloud, 2–5 s lag) | 0–1 | owned | — | 🔴 | @__ | Decision: fake local Alexa (recommended) vs a real Echo |
| Kokoro TTS voices auditioned: Trabolta (`am_michael`), Alexa, Sandy | — | free | — | 🔴 | @__ | Reuse `/api/mod/tts` (`core/server/tts.ts`) |

**Audio assets to produce** (names = the spec's `sound` registry, §2.13; files named exactly so):

- [ ] **HW-AUD-01** 🔴 P0 · @__ — `dance_song` (opens with **10 s of silence** so music lands with the lights after the blackout), `youre_the_one_vocoder` (vocoder Trabolta + Sandy answering "I'm sorry, I didn't understand that. Would you like to speak to a live agent?"), `youre_the_one_sandy_only` (no male vocals), `rave`, `hand_jive` ("Born to Hand Jive"), `motorcycle`.
- [ ] **HW-AUD-02** 🔴 P1 · @__ — Short sfx: `modem_handshake`, `alexa_chime`, `bingo_start`, `ad_jingle`, `truther_glitch`, `countdown_tick`, `printer_grind`, `beans_spill`, `zip`, `y2k_chime`, `alarm_siren`, `windows_shutdown`, plus a "Go to the living room" sting (hw-research D.3; add it to the spec's registry + the YAML first).
- [ ] **HW-AUD-03** 🔴 P1 · @__ — Video/media for the screens (720p H.264/AAC MP4, `+faststart`): the ad-hijack advert ("a duck, a phone number with no digits, 000. 000. 000."), 4–8 Web-1.0 ads (Maps And Ducks fundraiser, "Your protection has expired", GeoCities, Trabolta), the WebMD intro (+ a short repeat cut; Julia), the media-player loop, slide images (the Bingo asterisk card, rules), lyric `.vtt` for the song. Also: the Truther Download glitch clip, the Grok Prom rain loop + "COMPUTER PROM 1999" art, the rave visual loop, the decrepit-Trabolta and glitch-face variants (recount, overshare), a motorcycle-exit visual, the advice and banish visuals, and screensaver variants.
- [ ] **HW-AUD-04** 🔴 P1 · @__ — Wire `sfx` → player in `trapped.house.yaml`; one test cue per file in rehearsal; set levels in the room with people in it.
- [ ] **HW-AUD-05** 🔴 P1 · @__ — Alexa: pre-render the fixed announcements (C1, hunt over, five minutes, go to the living room) as cues as a zero-code fallback; live TTS via SW-SH-07 or SW-SCR-18.
- [ ] **HW-AUD-06** 🔴 P1 · @__ — **Trabolta's and Sandy's voices for the scripted speeches** (zero-code fallback for SW-SCR-17): render every scripted `Trabolta:` monologue in `loc:The Desktop` with Kokoro (`am_michael`) as a named cue: Trust Chart praise and shame, the overshare(s), the Y2K reveal, the Final Assessment, the Grok Prom rant, the confession, the recount, and Sandy's duet line. Without a room voice these play only as text on phones. Re-render when the lines change.

## I. Safety, power and weather

| Item | Qty | ~Price | Link | Status | Owner | Notes |
|---|---|---|---|---|---|---|
| Glow tape for steps and edges | 1–2 rolls | ~$15 | — | 🔴 | @__ | Every stair and step the blackout or the Tube darkens |
| Staff flashlights / headlamps (red mode) | 4–6 | ~$30 | — | 🔴 | @__ | Antivirus + hosts |
| First-aid kit | 1 | ~$25 | — | 🔴 | @__ | |
| Fire extinguisher (ABC) near the LED PSUs / show laptop | 1 | ~$30 | — | 🔴 | @__ | |
| GFCI/RCD: outdoor GFCI outlets or inline GFCI adapters + outdoor-rated extension cords | 2–3 + cords | ~$20 each + ~$40 | — | 🔴 | @__ | Tent, Truth Pong flood, backyard, near the bobbing tub; connections off the ground |
| Strobe / flashing-lights warning (invite + door sign) | — | print | — | 🔴 | @__ | |

- [ ] **HW-SAFE-01** 🔴 P0 · @__ — **Darkness**: the blackout and the final reveal never darken the stairs, the bathroom or the tent (the tent needs light for Quest tracking). Define the Z2M `blackout` group and WLED segments to leave them out, and point `lights_blackout` at it (today it hits `house` = everything, SW-SH-01). Glow tape on steps, staff flashlights, a clear path out of the pitch-black Mud Room and the dark Tube.
- [ ] **HW-SAFE-02** 🔴 P0 · @__ — **Strobes**: every flashing preset (`lights_alarm`, `lights_rave`, the glitch/lightning presets, `screens_flicker`) stays **≤ 3 Hz** and avoids full-field saturated red flashing (WCAG / Ofcom photosensitive guidance). Put a flashing-lights warning on the invite and the door; never strobe in the tent (HW-TENT-03).
- [ ] **HW-SAFE-03** 🔴 P0 · @__ — **Mains near water and outdoors**: GFCI/RCD-protected outlets (or inline GFCI) for the tent, the Truth Pong flood, the backyard and anything near the bobbing tub; outdoor-rated cords with connections off the ground; an IP65+ flood. "Out of splash range" alone isn't enough. LED PSUs closed or enclosed and earthed (HW-LIT-05).
- [ ] **HW-SAFE-04** 🔴 P1 · @__ — **Weather plan** for the outdoor tent and Truth Pong: rain cover for the tent and the table, a heater or an indoor fallback room for the tent, cold Quest batteries (keep spares warm inside) and heat (no direct sun on headsets). Decide with the party date (Decisions #31).
- [ ] **HW-SAFE-05** 🔴 P1 · @__ — **Safety walk** on install day: first aid and the extinguisher placed, egress clear of cables (tent EXIT sign), the maglock fails safe (HW-DOOR-07), every cable run taped.

---

## Story ↔ tech matrix

Every beat of the night in order (spec §3, following STORY BEATS), what it touches, and who owns it. D = director cue, W = story watcher, H = hardware.

| Beat | Trigger | Phones | Screens / TV | Lights · sound | Hardware / people | Items |
|---|---|---|---|---|---|---|
| Pre-show: install day + morning of | crew | loaners signed in; charging station out | terminals provisioned, `identify` | lights paired, scenes stored, `lights_screensaver` | posters + clue props hung per the setup map; safety walk; Tube built | HW-SCR-01/05, HW-LIT-01/02, HW-PROP-06/07/08, HW-SAFE-05, SW-OPS-10/11 |
| A1 Pretext | invitation email + invite site | — | — | — | featured character sheets + claim codes emailed; the sealed invite page over HTTPS | SW-PLAY-01, SW-OPS-08, SW-OPS-15, SW-QR-08 |
| A2 Doors open `Power On` | start | nothing; Trabolta hidden | screensaver everywhere (`screens_screensaver`); terminals mirror/attract, never pilot | `lights_screensaver` | door re-armed; stagehand connected | SW-SCR-01/02/05/06, SW-SH-01, SW-STORY-10, HW-LIT-02 |
| A3 Arrival, Login, CAPTCHA, Upload | `someone joins` | Mud Room cutscene, CAPTCHA, choices, pass QR | mudroom tablet dim | `modem_handshake` | pitch-black Mud Room; deposit box | SW-PLAY-00/01, HW-PROP (deposit), HW-AUD-02 |
| A4 Antivirus inspection, Clearance, Orientation | performer scan | booth scanner; rooms revealed; Clippy's tour | `terminals_attract` after the first clearance | `lights_tube_chase` | Antivirus phones (iOS needs the jsQR fallback) | SW-PLAY-06, SW-SCR-07, HW-LIT-03/04 |
| A5 Explore, Bathroom Mode | — | rooms, People, codex QRs, 🚻 | ads / media player | generators | clue posters + room signs on the walls | SW-QR-05/11, SW-PLAY-07, SW-SCR-07, HW-PROP-06 |
| B1 Summons (C1/V1) | D `call_to_the_desktop` | `!` alert, push | REPORT TO THE DESKTOP | `lights_call_desktop`, `alexa_chime`, announce | Alexa speaker; Antivirus patrol | SW-PLAY-02/03, SW-SCR-08/18, SW-SH-07, SW-ADM-01 |
| B2 Computer Bingo (V2) | D `start_the_bingo` | quest + alert; timer | `tv_bingo` rules + card; terminals attract | `lights_game`, `bingo_start` | printed Bingo cards | SW-SCR-08/09, SW-PLAY-05, HW-PROP-04 |
| B3 Bingo results (V3), first reinstall | D `bingo_time` | Clippy's performer buttons; ribbons | `tv_bingo_time` | — | fake Bingo card; Norton | SW-ADM-07, SW-ENG-03, HW-PROP (ribbons) |
| B4 The Internet (any capture) | `captured` | prison room; WebMD DM | `tablet_webmd`; `tv_mirror` after intro | — | Quests, tablet, EXIT; duck → release | SW-RE-00..08, SW-SCR-15/16, HW-TENT-* |
| B5 Trabolta comes online | D `introduce_trabolta` | he appears; DM seeded | `terminals_trabolta_online` (re-provision `view=auto`); `tv_mirror` | his introduction voiced (who?) | worker gate opens (`awake`) | SW-SCR-01/02/24, SW-AI-03/08/11, SW-SCR-17 / HW-AUD-06 |
| B6 Hunt 1 (V4/V5) | D `start_the_hunt` | quest; 10-min warning | trivia slide + 15:00 countdown | `lights_game`; yard lit | coded "files" (clue props) hidden around the house and shed | SW-SCR-08/09, SW-QR-05, HW-PROP-07, HW-LIT-08 |
| B7 Return (C2) | W 15 min / D | `!` alert, announce | RETURN TO THE DESKTOP | `lights_call_desktop`, chime | Antivirus sweep | SW-PLAY-02, SW-SCR-08 |
| B8 First Moment of Truth (V6) | D | judging buttons | results slide | `lights_truth_time` | judge's phone | SW-ADM-07, SW-SCR-08 |
| B9 Truth or Dare | D | buttons | the hat | — | hat + slips | HW-PROP-04 |
| B10 Telephone / piñata (optional) | D | "who messed up" vote | — | — | piñata | HW-PROP (piñata), SW-PLAY-17/18, SW-ENG-14 |
| C1 Ad hijack | D `second_hunt_preview` | downplayed DM; Clippy's private readout | ad video in sync | `lights_ad_hijack`, `ad_jingle` | — | SW-SCR-15/25, SW-PLAY-03/12, HW-AUD-03 |
| C2 Round 2 + the hour | D | quest; 1 hour; `#ram` | trivia 2 slide; clock | `lights_game` | — | SW-SCR-08, SW-PLAY-05, SW-ENG-06 |
| C3 Truther Download | W +2 min / D | glitch DMs + featured choices; `#truthcoin-exchange`; notifications on locked phones | TRUTHER DOWNLOAD glitch | `lights_glitch`, `truther_glitch` | — | SW-PLAY-01/02/08, SW-SCR-15 |
| C4 Excel's virus | codex QR in the tent; guest button | carries/plant | — | — | virus props; USB glory hole (optional) | SW-RE-09, HW-TENT-04, HW-PROP-05 |
| C5 OpenOffice's dossier / LiveJournal | codex count / QR | codex | — | — | `TRABOLTA-4EVER` QR in the Registry | SW-QR-05, SW-AI-01 |
| D1 Check-in | scan / button / QR | 📍 reply; moved into the room's chat | (terminal kiosk later) | — | room posters | SW-QR-06/12, SW-SH-03, SW-ENG-02 |
| D2 Five-minute warning | W 55 min / D | `!` alert, push, timer | 5:00 countdown | `lights_call_desktop`, `countdown_tick`, announce | Alexa speaker | SW-PLAY-02/05, SW-SCR-09, SW-SH-07 / SW-SCR-18 |
| D3 Summons closed, late list | W / D | late reply | — | — | Antivirus phones alerted; radios | SW-PLAY-03/16, SW-ADM-08, SW-ENG-08, SW-OPS-13 |
| D4 Truth Pong | D | made / missed | `screens_truth_pong` slide | `lights_pong` | folding table outside, IP65 flood on GFCI; tent overflow | HW-PROP-02, HW-LIT (backyard), SW-SCR-08, HW-SAFE-03, SW-RE-08/13 |
| D5 Round 2 tally | D | — | — | — | — | SW-STORY-01 |
| D6 Trust Chart, rankings | D | Trust Chart codex | the board | `lights_trust_chart`; praise/shame voiced | — | SW-SCR-11, SW-AI-04, SW-ENG-04, SW-SCR-17 / HW-AUD-06 |
| D7 The printer | H / D | — | certificate → beans error + flicker | `lights_glitch`, `printer_grind`, `beans_spill` | START button + lid sensor | HW-PROP-01, SW-SH-01 |
| D8 Zip everyone out | D | release (ROLE watcher) | — | `zip` | tent sessions must end | SW-RE-06, HW-PROP (zip gear) |
| D9 Overshare (scenario 1–4) | D | The Final Facts quest | face glitch + flicker | `lights_glitch`; overshare voiced | — | SW-SCR-13/14, SW-AI-01, SW-SCR-17 / HW-AUD-06 |
| D10 The Y2K clock | D | factions revealed; final orders; side chooser; clock alerts | Y2K clock | `lights_y2k`, `y2k_chime`; Y2K reveal voiced | — | SW-SCR-10, SW-PLAY-05, SW-ENG-04/05, SW-SCR-17 / HW-AUD-06 |
| E1 Majority | W | The Whole Truth; Server Room revealed | — | `lights_server_open` | indicator → green (`show/serverroom/lock`); maglock release (opt.) | HW-DOOR-04/07, SW-SH-01, SW-ADM-10 |
| E2 The door (latched alarm) | H / D | `!` alert; Antivirus readouts | INTRUSION | `lights_alarm` (≤ 3 Hz), `alarm_siren` | reed + Zigbee contact; local siren | HW-DOOR-01..05, SW-SH-01/05, SW-PLAY-03, HW-SAFE-02 |
| E3 The patch bay | H | — | — | relay clicks, meter | scanner → `sensors/patchbay/state` → stagehand | HW-PATCH-01..07, SW-SH-02/03 |
| E4 Combo A: disabled | H / D | GO TO THE LIVING ROOM takeover (push for locked phones) | blackout → flashing | `lights_blackout` (stairs/bath/tent stay lit) → +10 s `lights_dance`; `dance_song` | speaker | SW-PLAY-02/04, SW-SCR-14, HW-LIT-06, HW-SAFE-01, HW-AUD-01 |
| E5 Recount + bulk backstories | D | every backstory unlocked | `screens_recount` | `motorcycle`, `lights_restore` | — | SW-AI-09, SW-SCR-13 |
| E6/E7 Combo B: destroyed, fate lines | H / D | takeover (push for locked phones); fate lines | blackout | `windows_shutdown`, `dance_song` | (MAIN POWER switch?) | SW-PLAY-02/04, HW-PATCH-08, HW-SAFE-01 |
| E8 Purgatory | D | — | Notepad summary | `lights_purgatory` | — | SW-AI-09, SW-SCR-12 |
| F1 Final reveal / midnight | D / W 60 min | `!` alert | dark (`screens_final_reveal`) | `lights_final_reveal`, `y2k_chime` | — | SW-SCR-10/24, SW-PLAY-02, HW-SAFE-01 |
| F2 Bobbing for Truth | D | bag buttons | BOBBING FOR TRUTH | Final Assessment voiced | tub + Bag of Truth; GFCI | HW-PROP-03, HW-SAFE-03, SW-SCR-17 / HW-AUD-06 |
| F3 truth.txt → verdict | D | backstories + The Truth File | truth.txt in Notepad | verdict voiced | laminated truth.txt | SW-SCR-12, SW-AI-09, SW-SCR-17 / HW-AUD-06 |
| F4 Song Ending | verdict / pickup line | — | karaoke lyrics | `lights_song`, `youre_the_one_vocoder` | speaker; "he goes up to Sandy" | SW-SCR-13, HW-AUD-01/06, HW-PROP-11 |
| F5 Grok Prom + pickup line | verdict | host button / agent power | COMPUTER PROM 1999 | Grok Prom rant voiced | Sandy staged | SW-PLAY-09, SW-AI-13, HW-AUD-03/06, HW-PROP-11 |
| F6 No line → confession → rave | D | — | rave visuals | `youre_the_one_sandy_only`, `motorcycle`, `rave`, `lights_rave` (≤ 3 Hz); confession voiced | WLED audio-reactive (opt., INMP441); Sandy staged | SW-SCR-13, HW-AUD-01/06, HW-PROP-11, HW-SAFE-02 |
| F7 Advice poll → helped / thwarted → hand jive | D | poll widget; banish | advice / banish | `lights_banish` / `lights_restore`, `hand_jive` | — | SW-RE-10, SW-ENG-13, SW-SCR-24 |
| Trabolta's powers (all night, by phase) | agent | pop-ups, snoop notices, alerts | flicker; clock skip | per-room cut + restore at +90 s | Antivirus sweep readouts | SW-AI-07/13/14, SW-SH-01 |
| Post-show: wrap | D `end` | recap published | — | `lights_restore` | deposit-box items returned; backups; Run export | SW-OPS-04/16, SW-ADM-09, SW-AI-09 |

---

## Decisions needed from you

**Sign-offs on the rewrite** (spec §10.2):
1. The Trust Chart counts confident lies as accepted truths (dramatic irony; keeps lie counts away from the AI).
2. A lie is sticky per question, and a question nobody answered also fails the verdict.
3. Leader tasks gate the majorities (OV's "and then"), with a director waiver.
4. Only Excel's plant drives overshare scenarios 1/3; anyone else's plant is flavour.
5. The advice ending is reachable only after a failed verdict (Grok Prom).
6. Combo B kills everyone, The Way Out included. Or should The Way Out escape?
7. The server room stays live during the final reveal.
8. MS Paint is the anti-AI program (Cat's sheet must carry it).
9. Guests' influence on Trabolta never changes a branch by itself; the director reads `love` / `regard`.
10. Opening night runs with `lookup: false` unless the secrecy fix (SW-AI-02) lands.
11. Performers (Antivirus, hosts) don't count toward majorities (engine limit, SW-ENG-12).
12. Review the invented content list (SW-STORY-11).

**Open questions from the audits:**
13. **TV as Trabolta's face**: should the living-room TV also voice his Desktop lines with the face (SW-SCR-17), or only show slides + the mirror?
14. **Where music plays**: TV box HDMI, or the laptop → powered speaker via QLab/mpv? (The laptop is more robust for the dance song.)
15. **iPad vs Android** for the wall terminals. Android + Fully Kiosk removes most wake/autoplay pain.
16. **LAN laptop vs VPS** (SW-OPS-01). This decides HTTPS, printed URLs and uplink risk.
17. **Door sensor**: reed on the ESP32 + Zigbee fallback (recommended), or copper tape (frame-bridge version) as primary? Maglock or no maglock?
18. **Patch-bay sensing**: digital all-pairs scan (recommended) or the voltage/ADC ladder? Does cable **order** matter? Combo B by cables or a MAIN POWER switch?
19. **Goose vs duck**: keep "Gerald, the golden duck" (ties to Maps and Ducks; zero code), or a goose (model + copy)? Add press-A?
20. **Alexa**: a fake local Alexa (TTS through the laptop/speaker; recommended), a real Echo via Home Assistant (cloud, lag), or tablets speaking?
21. **WebMD**: Julia live in the tent, a pre-recorded video, or both?
22. **Who judges answers live**: Clippy's performer from the booth, or a director in Run?
23. **The tent**: really outside (the map must change), or the basement as in the placeholder?
24. **Trojan Horse**: one shared phone, or build the shared identity (two devices, one program)?
25. **Push notifications**: is asking iPhone guests to "Add to Home Screen" at the door acceptable?
26. **Recap**: auto-generated from the night (SW-AI-09), or hand-written beats + a printed truth.txt?
27. **Zip-up**: what is the physical bit (hoodies, a zipper prop, sleeping bags)?
28. **How Sandy appears on stage** ("He goes up to Sandy", F4–F6): an Echo or speaker prop, a phone on hold, an on-screen chat bubble only, or TTS through the house speaker (HW-PROP-11, HW-AUD-06)?
29. **Disarm path for the alternate finale** (enter the server room before a majority without tripping the alarm): a keypad, a codex disarm code with a time window, or none (SW-STORY-14)?
30. **Tent overflow policy** when Truth Pong sends 5–10 programs to the Internet at once (`capacity: 3`): a queue with seating, a 4th player device (SW-RE-13), a short timer per run, or release some by a director fire?
31. **Party date and outdoor plan**: weather, cold and power for the outdoor tent and Truth Pong (HW-SAFE-03/04).
32. **Should Trabolta reveal himself to a program on its first delivered fact**, before Clippy's introduction (trabolta.md §2.10)? The spec says no (hidden until `introduce_trabolta`).
33. **Does a confident lie told to Trabolta in a DM count toward `Kernel.lies_accepted`**, or only lies at a Moment of Truth (trabolta.md §2.10)?
34. **Host roster**: the overview names **Alexa** as a host Clippy introduces, while Clippy Instructions 1 names **Recycling Bin**. Is Alexa a character (performer or agent) or only the announcement voice (SW-SCR-18 / SW-SH-07)?
