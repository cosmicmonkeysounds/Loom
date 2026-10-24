> **Historical (moved from `docs/trapped/` on 2026-10-24).** A planning or audit note from October 2026; the code, the show folder and the package docs win where they differ.

> **Retired (Wave 11, 2026-10-18).** There is no chess phone. The King is played only on the **Server Door** wall terminal outside the server-room door (`terminal/`, `view=chess`, the `server-room-door` spot; `@loom/chess`), with no hints, awake all night; a checkmate before 📄 truth.txt gives *The Door Code*. His strength is one health bar shared by every guest (15 HP, `Night.king_hp`), knocked down once per reinstallation visit in either game, which no longer plays chess. The phone prop is gone from both house maps. ♟ *They beat the machine* stays the fallback for a mate a host saw on the terminal. Everything below is history. Current: Help → *Running the server room* (`docs/help/authoring/38-server-room.md`), [`docs/trapped/kiosk.md`](../../trapped/kiosk.md) → *The Server Door terminal*, `docs/loom-reinstall.md` §3–4.
>
> **Superseded again (Wave 7, 2026-10-17).** There is no disarm window: a checkmate from the Y2K hour (the King, or ♟ for a win seen on this phone) gives the winner the **server-room door code** (*The Door Code*) for a standalone keypad lock; the door never alarms. Every "opens the door for 90 s" / "ring green" below is history. Current: [OCT31 §5 *Wave 7 status*](../../../core/examples/trapped-in-the-internet/OCT31.md), Help → *Running the server room* (`docs/help/authoring/38-server-room.md`).
>
> **Superseded (Wave 4, 2026-10-16).** The Cold Lock is now **the King in the
> simulation**: a `king` prop standing in the server-room doorway of the house
> map (`house.json` `cold-lock-king`, door `server-door` with `guard`), fought on
> the **tent tablet** (`reinstall/web`: walk up, ⚔ hit him to knock his chess
> down a ladder, ♟ challenge him on a chess.js board; checkmate opens the door
> in the simulation and the tablet posts `chess won` itself, journaled `by` the
> tablet) — `docs/loom-reinstall.md` §3 *The King*. **This phone stays the
> fallback (decision U17)** until the King is device-checked: the Lichess app
> on the taped phone, and **♟ They beat the machine** on the winner's card.
> Headsets show the King and a notice; they cannot fight him.
>
> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.
>
> **Wave 1 status** (merged to master 2026-10-15, not yet deployed to the VPS; [OCT31 §5](../../../core/examples/trapped-in-the-internet/OCT31.md)). The `chess/` kiosk app designed below was **not built** (S2 dropped): the taped phone runs the Lichess app (computer at level 2–3), and a host or Antivirus who saw the mate presses **♟ They beat the machine** on the winner's card (`beat_the_machine`; fallback: the admin `chess_won` INTERACTION, or the director firing `chess won`). **Built** (K-27 + N-06), the §5 story hook: from `Night.step >= 14` a win opens a 90 s `Kernel.disarmed_until` window that the `server_door_opened` rule respects (ring green, a latched alarm cleared, re-lock after), `rearm_server_room`, `chess lost` / `chess drawn` flavour rules (Trabolta gloats; nothing disarms), the *The Cold Lock* codex, and `force_majority_stay` / `force_majority_leave`. §1–4 and §6–8 remain a design.

# The server-room chess phone (Decision #29)

Research for the work schedule. The user's decision: **a phone taped to the wall outside the
server room runs a chess game against a really hard chess AI.** Winning disarms the door alarm
(the alternate finale: "enter the server room without tripping the alarm" before a majority,
SW-STORY-14). It is its own kiosk app, like `terminal/` and `reinstall/web`.

**Recommendation in one paragraph.** Build a new MIT kiosk app, `chess/` (`loom-chess`, Vite +
React 18). It is served by the event server at `/chess/` and provisioned like a terminal
(`?code=<mod passcode>&name=Server Room Lock`, then a mod token). Use **chess.js** (BSD-2) for the
rules and **cm-chessboard** (MIT) for the board. The engine is **Stockfish 19 "lite
single-threaded" WASM** (`stockfish@19.0.1`, GPL-3.0). It runs in a Web Worker and needs no
SharedArrayBuffer and no COOP/COEP, and the **asm.js build** is the fallback for phones without
WASM SIMD. Ship the engine as a separate GPL artifact in its own small package
(`chess/engine/`, `GPL-3.0-or-later`, following the `server/` precedent). The app's code never
imports the engine; it only talks UCI to it over `postMessage`. The default mode is **"Checkmate
Trabolta"**: 3 rounds, each a forced-mate position from the Lichess puzzle DB (CC0) that
full-strength Stockfish defends. It is hard but fair, and an attempt takes about 2–4 minutes, so
guests can take turns. A **full game** against adaptive-strength Stockfish is the hidden "for
chess players" mode. A win posts the named event `chess won` (with args, journaled) to
`/api/mod/signal`, and the story opens a **90-second disarm window**
(`Kernel.disarmed_until`) that the `server_door_opened` rule respects. Size: **M** for the
puzzle-mode MVP plus the S server and story changes; **L** with the full-game mode, pass
signing and the cheat flag.

---

## 1. Engines compared

| Engine | License | Browser build | Strength on an old phone | Verdict |
|---|---|---|---|---|
| **Stockfish 19, lite single-threaded** (`stockfish-19-lite-single.js` + `.wasm`, ≈1.7 MB) | GPL-3.0 (engine); nmrugg's wrapper is MIT, but the npm package is GPL because it contains the engine | Web Worker, plain static hosting, **no COOP/COEP**, no SharedArrayBuffer | Uses a small NNUE net (`nn-61e7af4bb97d`). The README says it is "quite a bit weaker" than the full engine but "far stronger than any human will ever be". Even at 300–1000 ms per move on an old SoC it plays far above any party guest (estimate; bench on the device). | **Pick this.** |
| Stockfish 19 full single-threaded (≈94–99 MB wasm) | GPL-3.0 | Same API | Stronger, which nobody at a party will notice | No. A 99 MB download on an old phone, and the memory cost. |
| Stockfish 19 lite / full **multi-threaded** | GPL-3.0 | Needs `crossOriginIsolated`: COOP `same-origin` + COEP `require-corp` on every response, which our CSP/proxy setup and old WebViews make painful | Faster | No. Single-threaded is plenty, and old phones have few useful cores. |
| **Stockfish 19 asm.js** (`stockfish-19-asm.js`, ≈3.1 MB) | GPL-3.0 | Pure JS, "runs in essentially any browser", no WASM | "Very slow and weak" by upstream's own description, but still beats casual players at a generous think time | **The fallback** when WASM SIMD is missing or blocked |
| Stockfish.js 16 branch | GPL-3.0 | Has non-SIMD WASM builds "for slightly older browsers" | Older nets | Optional middle tier, probably not worth a third artifact |
| Lc0 (Leela) | GPL-3.0 | Needs a GPU/WebGL backend and large nets | — | Not practical on an old phone |
| Fairy-Stockfish (`fairy-stockfish-nnue.wasm`) | GPL-3.0 | WASM SIMD | Like Stockfish | Only needed for variants, so no |
| `js-chess-engine` | **MIT** | Pure JS | Weak (club level at best) | The only permissive option, and it is not a "really hard chess AI". It would only be a no-GPL fallback. |

**Verified on the package (2026-10-15):** `npm view stockfish` → `19.0.1`, `GPL-3.0`. The tarball
holds `bin/stockfish-19-lite-single.{js,wasm}` (28 KB + 1.85 MB), `stockfish-19-asm.js`
(3.16 MB), and the full builds at 99 MB. A `wasm-objdump -d` of the lite-single wasm shows
**~5,800 SIMD instructions**, so it **requires WebAssembly SIMD, which arrived in Chrome / Android
WebView 91**. The binary exposes `Skill Level`, `UCI_LimitStrength`, `UCI_Elo`, `Hash` and
`MultiPV`.

**Old-Android consequences (Decision #15: mixed old Androids).**
- Chrome's last versions are **119 on Android 7.x** and **138 on Android 8/9**. Both are well
  past 91, so a phone on Android 7+ with an *updated* Chrome or WebView runs the lite WASM build.
  Android 4.4 (KitKat) tops out below SIMD, as does any phone whose Chrome or WebView was never
  updated. Those phones get the **asm.js fallback**.
- **Feature detection.** Try `wasm-feature-detect`'s `simd()` (Apache-2.0, tiny) or, more
  robustly, spawn the lite worker and fall back to `stockfish-19-asm.js` on a worker `error` or
  a `CompileError`, or when `uciok` does not arrive within 8 s. Show the active engine on the ⚙
  page (`engine: lite-wasm | asm`).
- **Prefer a phone with Android 8+** for this job (HW item below). It is one phone, so pick the
  best of the found devices. Bench `go movetime 1000` and read the `nps`.
- **Memory:** set `Hash` to 16 MB (the default). The worker plus the lite net comes to tens of MB,
  which is fine on 1–2 GB phones. Never load the full build.
- **Heat and battery:** no `ponder` (the engine idles between moves) and a capped `movetime`.
  The phone stays plugged in for hours, so **use one with a healthy, non-swollen battery**
  (fire risk) and Fully Kiosk's "screen on while plugged".

### Strength knobs (UCI)
- `setoption name UCI_LimitStrength value true` + `UCI_Elo` (about 1320–3190 in Stockfish
  16+. The floor of 1320 is from user reports, so read the live range from the `uci` option
  output). Calibrated at 60 s + 0.6 s, so at a short `movetime` the real strength is a bit
  lower.
- `Skill Level` 0–20 (overridden by `UCI_LimitStrength`).
- **Below about 1300**, which a casual guest can beat: run `MultiPV 4–6` at a shallow
  `depth` (1–4) and pick weighted-randomly among the PVs, occasionally a sub-optimal one.
  Lichess's low AI levels do something similar. This needs about 30 lines in the worker
  wrapper.
- **Think time** sets both pacing and strength: `go movetime 400` (snappy) up to 1500 (feels
  "thinking"). Show an animated "TRABOLTA IS THINKING…" bar so slow phones read as drama.

---

## 2. Board UI and rules

| Library | License | Notes | Verdict |
|---|---|---|---|
| **chess.js** 1.4.0 | BSD-2-Clause | Move generation and legality, SAN/UCI, FEN, `isCheckmate()`, `isDraw()`, `isThreefoldRepetition()`. Pure TS, no deps, MIT-compatible. | **Use** (app and, optionally, server-side verification) |
| **cm-chessboard** 8.15.3 | MIT | Vanilla ES6 + SVG, light, works with click-click (tap-tap) input, extensions for markers, arrows, promotion dialog and accessibility. Wrap it in a ~60-line React component. | **Use.** It is the lightest MIT board and the friendliest to old WebViews. |
| react-chessboard 5.12.1 | MIT | **peer `react ^19`**, and the repo is on React 18.3, so it would mean a React 19 bump for one app. 4.7.3 supports React ≥16.14 but pulls in react-dnd plus three backends. | Second choice (v4.7.3) |
| chessground (`@lichess-org/chessground` 10.x) | **GPL-3.0-or-later** | The best touch board (it is lichess's), very light | Only if the whole app goes GPL (option A below) |

**Input on a wall phone:** tap a piece, then tap the target (more reliable than dragging on old
touchscreens). Use big squares (the board fills the width, portrait), auto-queen promotion with a
long press for the picker, `navigator.vibrate(15)` on each move, and a last-move highlight plus a
check marker. Use a Win98 skin (in the period of the show, matching `reinstall/web`). The
diegetic frame: **"COLD STORAGE LOCK v1.0 — AUTHENTICATE BY CHECKMATE"**, with a WarGames
"SHALL WE PLAY A GAME?" attract screen.

---

## 3. License: the repo is MIT, Stockfish is GPL-3

Serving the JS and WASM from the public VPS at `/chess/` **conveys** object code to whoever loads
it (the phone, or anyone who opens the URL). So the GPL's source obligations apply to whatever is
GPL. There are two clean options:

**A. The whole app is GPL** (`chess/` with `"license": "GPL-3.0-or-later"` + a LICENSE file,
like `server/`). This is the simplest legal story, and you could also use chessground. The cost
is a second GPL island in an MIT repo, and anyone reusing the board/puzzle code inherits GPL.

**B. (Recommended) An MIT app plus a separately loaded GPL engine artifact.**
- `chess/` (`loom-chess`, **MIT**): the UI, puzzle mode, story link and kiosk shell. It never
  `import`s Stockfish and talks to it only through the UCI text protocol over a Worker
  `postMessage` channel. That is the same arm's-length "separate program speaking a protocol"
  relationship as a GUI driving a `stockfish` binary over a pipe (the FSF's usual line for
  separate programs: pipes, sockets, command-line arguments). The engine stays swappable: asm,
  lite, or `js-chess-engine` all speak the same wrapper interface.
- `chess/engine/` (`@loom/chess-engine`, **GPL-3.0-or-later**, `private: true`): a tiny
  vendoring package that depends on `stockfish@19.0.1`. Its `copy` script places the unmodified
  `stockfish-19-lite-single.js`/`.wasm` + `stockfish-19-asm.js` + `Copying.txt` into
  `chess/public/engine/`. Keep the upstream filenames, because the loader finds its `.wasm` next
  to its own URL, and the server already maps `.wasm → application/wasm` (`core/server/server.ts:114`).
  Vite copies `public/` verbatim (unhashed, not bundled).
- **Source offer (GPL §6(d), "equivalent access from the same place"):** serve
  `/chess/engine/COPYING.txt` and an **About** screen (behind the PIN ⚙) linking to the exact
  upstream source tag (`github.com/nmrugg/stockfish.js` `v19.0.1`) and the Stockfish source.
  Unmodified binaries plus a link to the matching corresponding source is the standard practice.
  If the build is ever patched, publish the patched source.
- Add the package to the repo's license notes in `packages/loom/CLAUDE.md` next to the `server/`
  exception ("`chess/engine/` is GPL; the `chess/` app is MIT and loads it at runtime"). The
  Docker `server` image then contains a GPL file, which is fine: it is aggregated, not linked.
- **A no-GPL escape hatch, for free:** the default "Checkmate Trabolta" puzzle mode only needs an
  engine for the defender's replies. A build flag `VITE_CHESS_ENGINE=none` could run puzzle mode
  on the *Lichess solution line* alone (pure MIT plus CC0 data), at the cost of the engine
  "defending" only along the book line.

The Lichess puzzle DB is **CC0**, so a committed `puzzles.json` is fine in an MIT repo. Credit
Lichess anyway.

---

## 4. Game design: beatable but hard, in under 4 minutes

A full game against Stockfish takes 20–40 minutes, blocks the phone, and is effectively
unwinnable. Act III's alternate-finale window is short (`Night.step >= 14`, before the majority).
So the **default mode is a puzzle gauntlet against a live engine**:

### Mode 1: "Checkmate Trabolta" (default)
- **3 rounds.** Each round loads a position where the **human has a forced mate in N** (rounds 1–3
  ≈ mateIn2, mateIn3, mateIn3/4, with rising puzzle ratings). **Full-strength Stockfish defends**
  (`go movetime 500`, no strength limit), so it always picks the longest defence and the line
  can leave the book solution. The forced mate still exists, because it is a property of the
  position.
- **Win** = deliver checkmate within N of your own moves (optionally a +1 grace move as a
  director knob). After each human move the engine searches from its own side. If it no longer
  sees `score mate -k` with k ≤ your remaining moves, you have missed the mate, and the round
  ends early: "TRABOLTA SLIPS AWAY."
- **Fail** any round → "ACCESS DENIED", a **45 s cooldown** (to keep the queue moving), then back
  to round 1 with fresh puzzles. A small "attempt #N" counter feeds the awards.
- **Tuning knobs** (the PIN ⚙, plus a story/director override, §6): rating bands per round
  (defaults 1000–1400 / 1400–1800 / 1700–2100), number of rounds, grace moves, cooldown, time
  limit per round (default 90 s; Win98 progress bar).
- **Why it fits:** it is "a really hard chess AI" (you are fighting Stockfish's best defence),
  it is beatable by someone who can calculate, the room can crowd round and shout suggestions
  (seating is in there anyway, per #30), and turn-taking is natural.

### Mode 2: "Full game" (hidden: long-press the logo)
- Human plays White against Stockfish at an adaptive level. **Default: near-impossible**
  (`UCI_Elo` ~2200, `movetime 800`). Optional "house gets cocky" rule: every *loss* across the
  night lowers the next game's Elo by 50, down to a floor (so a determined chess player late in
  the night can win). The ⚙ shows the current level. Draws (stalemate, repetition, insufficient
  material) report `chess drawn`.
- A 10-minute human clock (the engine moves instantly within its `movetime`). Idle for 90 s =
  resign.

### Puzzle data pipeline (`chess/scripts/puzzles.ts`, S)
- Download `lichess_db_puzzle.csv.zst` from database.lichess.org (6.16 M puzzles; columns
  `PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags`).
- **Gotcha:** `FEN` is the position *before the opponent's move*, and `Moves[0]` is that setup
  move. The app auto-plays it (animated, "TRABOLTA MOVES"), and then the human is to move.
- Filter `Themes ∋ mateIn2|mateIn3|mateIn4`, `Popularity ≥ 90`, `NbPlays ≥ 1000`,
  `RatingDeviation ≤ 80`. Bucket by rating, take a seeded ~150 per band, and write
  `chess/src/puzzles.json` (~50–80 KB, committed; CC0).
- **Optional verification step:** run each kept position through Node Stockfish
  (`require("stockfish")("lite-single")`, `go depth 22`) and keep it only if it reports
  `score mate N` with the stated N. The engine is a *build tool* there, so there is no
  distribution issue.
- Show the puzzle's Lichess id on the ⚙ for debugging. Never repeat a puzzle within the night
  (localStorage ring, best effort).

---

## 5. Story hook (Loom + server)

### Reporting a result
- **Transport:** the phone holds a mod token exactly like a terminal (`terminal/src/config.ts`:
  passcode → `/api/resolve-code` → `/api/mod/login`; the passcode itself is never stored). It
  posts **`POST /e/:eventId/api/mod/signal`** with
  `{name: "chess won" | "chess lost" | "chess drawn", subject?: <guest id>, args: {mode, rounds, attempt, seconds, level, engine, cheat, game}}`.
  That route already exists (`core/server/event-runtime.ts:2743-2762`) and commits a journaled
  `signal` with args that bind by name in the listening body (`fire x with k: v`, Loom 4 §9.2).
- **Server change (S):** the route journals `by` as the mod session's name. A mod token is
  `"Director"` (`event-runtime.ts:1964`), so add an optional **`label`** to `/api/mod/signal` the
  way `/api/mod/impersonate` already does (`:3001-3002`). Then the journal and log read "Server
  Room Lock". Also cap `args` (≤ 1 KB, scalars only; never send a PGN through the journal).
- **Event naming** (see the show's gotchas): `chess won` / `chess lost` / `chess drawn` are two
  words, do not start with a built-in verb, and contain no ` is `. Good.
- **Idempotency and the uplink (VPS, #16):** the engine runs **on the phone**, so the game itself
  survives a dead house uplink. Only the report needs the internet. Queue the result in
  localStorage with a `game` id and retry on backoff until a 200. The story effect below is
  idempotent (re-setting the same window), so a duplicate POST after a lost response is
  harmless. The director can always fire `chess won` by hand from Run → Director as the manual
  fallback (the same as any named event). The door sensor also reaches the VPS through
  stagehand, so if the uplink is down the alarm is down too. That is consistent.

### Who played (optional "sign your hack")
- Play is **anonymous by default**: no scan, and a short queue. After a **win**, show "SIGN YOUR
  WORK — show your pass" for 15 s (camera + jsQR, reusing `terminal/src/scan.ts`; a typed-name
  fallback; *Skip*). If signed, the POST carries `subject = guest id`, which feeds quests, the
  awards and a Trabolta grudge line. The door sensor can't tell who walks in anyway, and the
  Antivirus police non-members in person (CHECKLIST E2 notes).

### The disarm window (main.loom)
```loom
// Power On: arm it
set Kernel.disarmed_until = 0
set Kernel.disarm_seconds = 90
set Night.chess_games = 0
set Night.chess_wins = 0

when chess won for who:
  set Night.chess_games += 1
  set Night.chess_wins += 1
  if Night.ended != true and Night.step >= 14 and Kernel.server_unlocked != true:
    set Kernel.disarmed_until = Time.elapsed + Kernel.disarm_seconds
    do door server_room, state: unlocked      // ESP32 ring → green (show/serverroom/lock)
    cue lights_server_open
    set Trabolta.composure -= 5
    // secret: no broadcast; the phone itself shows "ALARM DISARMED 01:30"

when chess lost:
  set Night.chess_games += 1

when Kernel.disarmed_until > 0 and Time.elapsed >= Kernel.disarmed_until:
  set Kernel.disarmed_until = 0
  if Kernel.server_unlocked != true:
    do door server_room, state: locked        // ring back to red breathing
```
and one clause added to the existing door rule (`main.loom:1627-1631`):
```loom
  if Night.ended != true and Night.step >= 14 and Kernel.server_unlocked != true
     and Time.elapsed >= Kernel.disarmed_until and Night.alarm_on != true:
```
- **Before step 14** the phone is just a game ("SYSTEM IDLE — PRACTICE"). Wins still count for
  the awards, and could optionally unlock a codex hint (story's choice). Nothing disarms. This
  matches the rule that the door is just a door before the Y2K hour.
- **Gotcha:** a door left *propped* after the window can trip the alarm on the next Z2M re-report
  once the window closes (the 120 s latch then applies). That is diegetic ("close the cold door
  behind you"), but put it in the runbook and the phone's win screen.
- **Seeding the idea:** a codex entry (e.g. *The Cold Lock*: "the door listens to the machine on
  the wall; beat it and it sleeps for ninety seconds") gives the Truther and scavenger lines
  something to point at. Trabolta, being cunning (#32), never mentions it.
- **Awards (#26):** expose `Night.chess_games` / `chess_wins` / fastest win (`args.seconds`) /
  most attempts / `cheat` to the recap's live-stats payload: "Grandmaster of the Cold Door",
  "Brought a Calculator", "Most Determined Loser".

### What the phone shows by phase
The phone needs `Night.step`, `Kernel.server_unlocked`, `Kernel.disarmed_until` and the alarm
latch. Today the terminal polls a **full ModView every 20 s** (screens.md flags the weight). Use
a **narrow mod read** instead: `GET /e/:id/api/mod/world?keys=Night.step,Kernel.server_unlocked,Kernel.disarmed_until,Night.alarm_on`
(S, reusable by terminals and the TV). When the Screens per-device stream (SW-SCR-03) lands,
switch to that. Phases: `idle` (practice) → `armed` ("AUTHENTICATE BY CHECKMATE") →
`disarmed mm:ss` (green) → `alarm` (red, board locked: "INTRUSION — LOCKED") → `open`
(majority reached: "ACCESS GRANTED") → `ended`.

### Voice
Trabolta taunts through the phone itself (canned lines, offline-safe), spoken via
`/api/mod/tts` with the mod token, the same server voice as the terminals and the house-announcements player (stagehand's `alexa` module),
with `speechSynthesis` as the fallback. Examples: "Checkmate is a human fantasy." /
"Again?" / on a win: "…That was not supposed to be possible." Optionally the story's `chess won`
line also plays on the living-room TV.

---

## 6. Anti-cheat (a guest running an engine on their own phone)

**Allow it, and make it funny.** "Fighting the machine with a machine" is on-theme, and banning
it is unenforceable. Detection is nearly free: Stockfish's `bestmove X ponder Y` predicts the
human's reply. Track the **ponder-match rate**. In full-game mode, ≥ 70% over ≥ 15 moves sets
`args.cheat = true`. In puzzle mode, a sub-3-second correct mate on a 2000-rated round 3 twice in
a row is the tell. Effects: the phone says "You brought a friend." The win still counts, and the
cheater earns the "Brought a Calculator" award.

**Stronger integrity (optional, S):** the token on a public wall is the real exposure (the same
issue as the terminals: the full mod token sits in localStorage and the ⚙ is open). (1) Add a
**PIN-gated ⚙** (shared with the terminal kiosk work). (2) Have the server re-check the claimed
win by replaying `args.moves` (UCI list) from the puzzle FEN with chess.js (BSD-2, MIT-safe) in a
tiny `core/server/chess.ts`, accepting `chess won` only if it ends in mate. (3) Long term, add
**device-scoped tokens** (a capability limited to `signal` with an allow-list of names plus
`tts`), which terminals, the TV and the chess phone all want. This is P2 and shared.

---

## 7. Kiosk behaviour, idle and reset

- **Idle:** no touch for 60 s mid-game → "ABANDONED SESSION", then back to the attract screen
  after 5 s (a 90 s clock resign in full-game mode). The attract screen shows "SHALL WE PLAY A
  GAME?" plus the phase and a pulsing tap target.
- **Cooldown** after a loss: 45 s ("TRABOLTA IS GLOATING"). It is skippable only from the PIN ⚙.
- **Screen and fullscreen:** `navigator.wakeLock.request("screen")` on boot and on every
  `visibilitychange` (needs HTTPS, Chrome 84+), Fully Kiosk "keep screen on" and app lock
  (Android 5+), a manifest with `display: fullscreen`, `orientation: portrait`, and the
  NoSleep video fallback. Same checklist as the terminals (screens.md §kiosk); **extract it
  once** into a shared kiosk helper (config + provision URL + wake lock + heartbeat + PIN ⚙) used
  by `terminal`, `chess` and the TV.
- **Restart, end, go-live:** on a `lifecycle` notice (or a 401/404 on the token) → re-resolve
  the code, reset the board and phase, and drop any queued result from a dead event.
- **Heartbeat** to the Screens page (once SW-SCR-* exist): engine kind, `nps` from the boot
  bench, battery, version.
- **Vite build target:** set `build.target` to about `chrome64` (cm-chessboard and chess.js are
  ES2017-safe), so an old WebView that can't do SIMD still loads the app and falls back to asm.js.
- **CSP:** add a `CHESS_CSP` in `core/server/routing.ts`: `HTML_CSP` with `script-src 'self'
  'wasm-unsafe-eval'; worker-src 'self'; media-src 'self' blob:` (`'wasm-unsafe-eval'` needs
  Chrome 97+. Chrome 91–96 would need `'unsafe-eval'`, so on those versions fall back to asm.js
  rather than loosening the policy). The server only sets CSP on `.html` responses
  (`server.ts:125-139`), and a same-origin worker script carries its own (absent) policy under
  CSP3, so the lite worker should compile anyway. Keep `'wasm-unsafe-eval'` as belt and braces,
  and **test on the actual phone**.

---

## 8. Work items (proposed new checklist ids; never renumber)

| id | P | Size | What | Depends on |
|---|---|---|---|---|
| **SW-CHESS-01** | P1 | S | Story: `chess won/lost/drawn` rules, `Kernel.disarmed_until` + door-rule clause + re-lock watcher, Power On init, award counters, *The Cold Lock* codex, a `rearm` interplay with SW-ADM-10, a vitest in `trapped-in-the-internet.test` (win at step 14 → door opens quietly; after 90 s → alarm). Closes **SW-STORY-14**. | — |
| **SW-CHESS-02** | P1 | S | Server: `label` + args cap on `/api/mod/signal`; `CHESS_CSP`; `/chess/*` static route + `LOOM_CHESS_DIST` (like `/terminal/`, `server.ts:357-372`); Dockerfile builds and ships `chess/dist`; narrow `GET /api/mod/world?keys=` read (shared with terminals and the TV). | — |
| **SW-CHESS-03** | P1 | S | `chess/engine/` GPL vendoring package (copy script, COPYING, source link) + the license note in `CLAUDE.md`. | — |
| **SW-CHESS-04** | P1 | S | Puzzle pipeline script → committed `puzzles.json` (filter, bucket, optional Stockfish verification). | 03 (verification only) |
| **SW-CHESS-05** | P1 | M | `chess/` app MVP: provisioning (shared kiosk helper), cm-chessboard + chess.js, engine worker wrapper (lite → asm fallback, UCI parsing incl. `score mate`), **Checkmate Trabolta** mode, phases from the world read, result POST with retry queue, idle/cooldown, Win98 skin, TTS taunts, PIN ⚙ (knobs + About/source). Vitest: UCI parser, puzzle judge, phase reducer, retry queue. | 02, 03, 04; the terminal kiosk basics (wake lock / manifest / PIN ⚙) ideally extracted first |
| **SW-CHESS-06** | P2 | M | Full-game mode (adaptive Elo, MultiPV handicap below 1320, clock, draws), sign-your-hack pass scan, ponder-match cheat flag, server-side mate verification (`core/server/chess.ts`). | 05 |
| **SW-CHESS-07** | P2 | S | Help article `docs/help/play/12-cold-lock.md` (the director/runbook side) + the README contract row + runbook lines (propped door, manual `chess won` fallback). | 01, 05 |
| **HW-CHESS-01** | P1 | — | Pick the best found phone (Android 8+, healthy battery), Fully Kiosk + app lock, a wall mount at standing height outside the server room (tape plus a proper adhesive phone mount, cable strain relief), a USB charger on a short cable, Wi-Fi reservation (HW-NET-02), boot bench (`nps`), brightness capped. | 05 |

**Totals:** about **3–4 dev-days** for P1 (01–05) and **2–3 more** for P2 (06–07).

**Where it goes in the schedule:** after the P0 platform items it reuses (VPS + real HTTPS
SW-OPS-01/02 for wake lock and the camera, and the terminal kiosk hardening that becomes the
shared kiosk helper). It also needs the door chain to exist (SW-SH-01 door/indicator rules,
HW-DOOR-01..05), since disarming an alarm that doesn't fire proves nothing. SW-CHESS-01..04 are
independent and can start any time. The app (05) belongs in the late-P1 wave, followed by one
live end-to-end rehearsal: win on the phone → ring goes green → open the door with no alarm →
the window closes → ring goes red → open again → alarm.

---

## Sources
- Stockfish.js builds, sizes, COOP/COEP, asm.js, the browser floor, the 16 branch: https://github.com/nmrugg/stockfish.js (README for v19.0.1; npm `stockfish@19.0.1`, GPL-3.0; tarball inspected locally, SIMD confirmed with wabt `wasm-objdump`)
- npm registry (2026-10-15): `chess.js@1.4.0` BSD-2-Clause; `cm-chessboard@8.15.3` MIT; `react-chessboard@5.12.1` MIT, peer React 19 (4.7.3: React ≥16.14 + react-dnd); `@lichess-org/chessground@10.4.2` GPL-3.0-or-later; `js-chess-engine@2.4.6` MIT; `fairy-stockfish-nnue.wasm` GPL-3.0; `wasm-feature-detect@1.9.0` Apache-2.0
- Lichess puzzle DB (CC0; 6,157,341 puzzles; CSV columns; `mateIn2` theme): https://database.lichess.org/
- Stockfish options `Skill Level` / `UCI_LimitStrength` / `UCI_Elo` and the 60 s + 0.6 s calibration: Stockfish README (e.g. https://sources.debian.org/src/stockfish/12-2/README.md); the 1320 Elo floor reported on lichess forums
- Chrome on old Android: the last version for Android 7.x is 119, and for 8/9 it is 138 (https://www.androidauthority.com/chrome-dropping-support-android-8-9-3571442 and Google support notes as reported)
- Repo: `core/server/event-runtime.ts:1964, 2743-2762, 2978-3003`; `core/server/server.ts:88-139, 357-372`; `core/server/routing.ts:7-25`; `terminal/src/config.ts`; `core/examples/trapped-in-the-internet/main.loom:1623-1641`, `beats/server-room.loom:90-117`; [`screens-audit.md`](./screens-audit.md) + [`kiosk.md`](../../trapped/kiosk.md) (kiosk gaps), [`stagehand-hardware-audit.md`](./stagehand-hardware-audit.md) / [`hardware-research.md`](./hardware-research.md) (disarm alternatives)
