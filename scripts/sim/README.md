# The full-evening simulator (wave 28)

`evening.ts` plays a whole night of *Trapped in the Internet* against one
event over HTTP: guest bots, the performers' booths, a director who presses
the cue chain in the cue sheet's order, and a heart bot at the server-room
terminal. After each beat it reads the director's view and prints a green
or red line; at the end, a summary table. It exits 1 on any red.

Zero install, like `scripts/show`: Node 22.6 or newer, no dependencies.

```bash
# a scratch server (never the VPS): dead DB, fresh state, a free port
cd core && LOOM_PORT=7391 LOOM_HOST=127.0.0.1 LOOM_STATE_DIR=$(mktemp -d) \
  LOOM_MOD_PASS=<mod> LOOM_EVENT_PASS=<guest> LOOM_PRIME_PASS=<prime> \
  LOOM_WIKI=off LOOM_DB_WAIT=off DATABASE_URL=postgres://127.0.0.1:1/none \
  LOOM_RL_REGISTER=400 pnpm serve

# the night (from the repo root)
pnpm sim --base http://127.0.0.1:7391 --code <mod>
node --experimental-strip-types --no-warnings scripts/sim/evening.ts --base … --code … --ending verdict --lie
```

The server plays the show's story from disk (event `default`); no sync is
needed. Build `play` and `terminal` first if you want to watch in a browser.

## Flags

| Flag | What |
|---|---|
| `--base <url>` | The server (env `LOOM_SERVER`). Required: there is no default. Port 7000 on this laptop is your own dev server (`loom_dev`): it still asks y/N and refuses the reset flags |
| `--code <mod>` | The MOD code (env `LOOM_MOD_CODE`) |
| `--event <id>` | Skip `/api/resolve-code` |
| `--guests 12` | Guest bots, featured included (at least 4) |
| `--featured "Microsoft Excel,MS Paint,Pong"` | Featured programs, registered on their invitation's claim |
| `--ending heart\|verdict\|destroyed` | Which ending (default `heart`: the talk to his stand-down, then 🕊) |
| `--lie` | One confident wrong filing: the verdict goes to Grok Prom, then the advice poll |
| `--facts <path>\|none` | The answer keys for accurate filings (default the show's `facts.json`; read, never printed) |
| `--pace <ms>` | Wait after each beat (and a third of it after each action), to watch |
| `--watch` | Print the URLs to open: a guest phone, the director phone, the heart terminal, the TV (they carry codes) |
| `--beat-file <path>` | Write `{n, beat, ok}` after each beat (the browser companion reads it) |
| `--worker` | A scripted probe Trabolta worker. It stays off if a house worker reported in the last 2 minutes |
| `--json <path>` | The results as JSON |
| `--yes` / `--i-know-this-is-live` | The guard's y/N and its real-guest refusal (below) |
| `--reset-before` / `--reset-after` | Restart the event before / after (a scratch server on this laptop only, not :7000) |

## The night it plays

| # | Beat | What the bots do | What it asserts |
|---|---|---|---|
| 1 | Doors | `/api/mod/start` if needed, `/api/mod/codes` | `Night.step` 0 (a fresh night) |
| 2 | Arrival | Register 9 pool programs + 3 featured (claims); CAPTCHA ×2, the Upload menu (each its problem), the Deposit (some leave a hint), Norton's scan, the tour (one skips); 8 booths as play-as sessions; a live SSE stream per guest | every `<id>.cleared` |
| 3 | 📣 Desktop | The cue; lobby lines | step 1 |
| 4 | 🎱 Bingo | DM Clippy, a guest's BINGO! (presses ⏰ itself), Clippy's `bingo_winner` and `named_at_bingo` | step 3, the named one marked |
| 5 | 🚚 Reinstall | Norton's `send to the internet`, the tent's web game: begin, walk to Gerald, the golden duck | released |
| 6 | 🤖 Trabolta | The cue; a DM to him (his hold line without a worker) | step 4, `Trabolta.awake` |
| 7 | 🔎 Hunt 1 | Every guest files H1–H3 (most accurate at 80, a quarter guess at 40; `--lie` one at 100) | step 5, filings judged |
| 8 | ⚖️ Truth 1 | ⏰ → ⚖️ → ⏱ → 📋 ×3 | step 6, `results_q` 3 |
| 9 | 🍾 Bottle | Spin, Truth, Task Manager's `truth_answered` | a pick, the bottle closed |
| 10 | 📺 Hunt 2 | 📺 → 📓 → 📥; featured briefings; Excel's disk (the tent QR) and 💾; H4–H6; Truthcoin send + request; a DM to McAfee; a crew founded and joined; the four cold-door notes; Adobe signs MS Paint's painting for everyone | step 8, `truther_sent`; Excel Mission and The Cold Door done |
| 11 | ⏳ Summons | All but one check in | step 9, the late one `late` |
| 12 | 🏓 Truth Pong | `made_the_cup` / `missed_the_cup`, 🧮, 📊, 🏆 | step 11, tallied |
| 13 | 🕚 Y2K | Overshare, the clock; F1–F2 | step 14 |
| 14 | ♟ Chess, casino, patch | `chess won` (the door code), two casino bets, one wrong patch (never a real combination) | the winner holds the door code |
| 15 | 🗳 Sides | Every guest joins a side (founders can't); forced only if no majority | step 15 |
| 16 | 🫀 Thrown out | Door open → shut; a program flatters, then threatens his cables until he ejects it; 🔄 | marked, then forgiven |
| 17 | 🫀 The chosen | A featured program: ⟦CHOSEN⟧ → *What weak place* → *I need to go* | Layer 2, not thrown out |
| 18 | 🫀 The full talk | ⟦PROMISE⟧; every Layer Two question incl. ⟦THE WAY OUT⟧ and ⟦SPEAK FREELY⟧ (a line said); *listen*; Evidence ⟦FORCE⟧ ⟦SMALL TYPE⟧; ⟦PROOF⟧; Reasons ⟦EARN IT⟧, the bluff, ⟦WEAKNESS⟧; *let me finish*; Layer Four's two warm picks and the *tell her* trap; back; *never going to answer* | `heart_stage` done, `stand_down_by` (heart ending); every menu ≤ 9 options |
| 19 | The ending | 🕊 → the dance → 🏍; or 🌑 → 🍎 → the bag → 📄 → ⚖ (song, or Grok Prom → 💌 → the poll → 🗳); or 💥 | `Night.ending`, `ended` |
| 20 | 🏆 Ceremony | G1, the eight awards on their winners (from trust, score, quests…), 🖌 on MS Paint, the staff awards, 🎃 | `ceremony_done`, `resurrected` |

The heart bot picks by **text**, as the terminal does: hidden options are
filtered out, so indexes shift. It leaves a sub-menu by its ⟦BACK⟧ when the
next step is on Layer Three. Its proofs (*What Sandy Says*, *The Question Of
Force*, *Omnipotence*) are granted before the visit opens: a menu docked
before a grant does not list the new option until it docks again.

The chains it presses after the Y2K clock (`Y2K_TO_HEART_END`,
`Y2K_TO_VERDICT`, `Y2K_TO_DESTROYED`, `CEREMONY`, …) live in
`scripts/accept/chains.ts` beside `TO_Y2K`, pinned by
`core/test/accept-chains.test.ts`.

## Safety

- **Scratch servers and rehearsal events only.** It runs the live guard
  first (`scripts/accept/live-guard.ts`): a roster with a real guest refuses
  (exit 3) unless `--i-know-this-is-live`; it names the event and asks y/N
  unless `--yes` or a scratch server on this laptop (:7000, your own dev
  server, still asks). The guard always runs **before** `--reset-before`
  resets anything. The bots register with pool names, so a second run on
  the same event sees the first run's bots as real guests and the guard
  refuses: start a fresh scratch server, Restart in Run, or (a scratch
  server you know holds only bots) `--reset-before --i-know-this-is-live`.
- It never presses Restart or End unless `--reset-before` / `--reset-after`,
  and those refuse anything but a scratch server on this laptop.
  `--reset-after` does nothing when the run stopped before its night
  started (e.g. the doors found `Night.step` above 0): that event is kept
  for inspection.
- It never prints a code, the door code, a combination or a hunt answer.
  The mod world goes through `lib/world.ts`, which drops `Kernel.*` (but a
  few secret-free latches). Only `--watch` prints URLs with codes, on your
  own terminal.
- The booths are Clippy, the four Antivirus and the three hosts. The
  Installation Wizard, Sandy and Truther Download are voices
  (`playable: false`), not booths: the wizard's lines land in the captured
  program's thread during the reinstall beat.
- Booths are play-as sessions (`/api/mod/impersonate`): no performer's part
  is held, and they end when the run ends.

## Watching it

- `--watch --pace 2000` prints the URLs to open in Chrome (Claude in
  Chrome can drive them): the director phone shows the cue sheet moving,
  the heart terminal plays the room's scenes (the bot pilots its own
  session, so its menus are not on that page: to walk the menus by hand,
  open the terminal and scan in a program yourself), the TV.
- `browser.spec.ts` screenshots the director phone, the heart terminal and
  the TV at every beat:

  ```bash
  SIM_BASE=http://127.0.0.1:7391 SIM_MOD_CODE=<mod> SIM_BEAT_FILE=/tmp/beat.json SIM_SHOTS=/tmp/sim-shots \
    pnpm --filter loom-app exec playwright test -c ../scripts/sim/playwright.config.ts &
  pnpm sim --base http://127.0.0.1:7391 --code <mod> --beat-file /tmp/beat.json --pace 1000
  ```

## Tests

`node --experimental-strip-types --no-warnings --test scripts/sim/test/sim.test.ts`
(the chain walk, the heart bot's choices, the world reads, the scoreboard).
`scripts/ops/predeploy.sh` runs them with the accept helpers. Typecheck:
`core/node_modules/.bin/tsc -p scripts/sim`.

## What it does not cover

- The quests that need a real guest's long play (OpenOffice Dossier, Master
  Of The Bugs, Unscramble, Ten Findings, Truthcoin Hustle) and the ones a
  host judges at the end (The Gold Standard, Go Viral, Keep The Ball In
  Play: no completion rule, they are listed in the recount).
- Recruit To Stay / Leave and A Faction Of Your Own are handed only to
  recruiters and founders.
- Free replies from Trabolta (the house worker), and his `assess` power.
  `--worker` answers with a few canned in-world lines.
- The terminal's own UI (the composer, the panel, the scenes): that is
  `terminal`'s tests and a human (or Claude in Chrome) at the page.
