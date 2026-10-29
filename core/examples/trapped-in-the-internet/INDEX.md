# Trapped in the Internet: what is in this folder

*Trapped in the Internet* is the live show on Sat Oct 31 2026, written as a
Loom project. This folder is the story (the `.loom` files the event server
plays), the show's data files, the crew's printed packs, and the docs.

## Start here

| If you want | Open |
|---|---|
| The whole show on one page: story, acts, every admin cue, cast, rooms, terminal spots, the checklist | [`SHOW.html`](./SHOW.html) (generated; open it in a browser) |
| What to do on the night, in order | [`SHOWNIGHT.md`](./SHOWNIGHT.md) |
| Which machine runs what, and how it all connects | [`TECH.md`](./TECH.md) |
| Your own role's card | [`cast-packs/`](./cast-packs) (start at its `README.md`) |
| How the story works, file by file, and the integration contract | [`README.md`](./README.md) |

## Kinds of file

- **Story**: `.loom` source the event server compiles. Edit it, run the
  tests, `pnpm sync-show` to push it.
- **Data**: JSON the server, stagehand or the terminals read at run time.
  `pnpm sync-show` pushes it into the server project with the story.
- **Runtime config**: read by stagehand's `agents` worker on the MacBook.
  Not docs; never move or rename.
- **Generated**: written by a script. Never edit by hand; edit the source
  and rerun the script.
- **Doc**: prose for people. **Test-pinned** means a test reads it, so
  moving or renaming it, or reshaping the pinned part, fails the suite.

## The files

### Story (`.loom`)

| Path | What it is |
|---|---|
| `main.loom` | The header (`watch:`, `countdown:`, `currency:`, `wallet:`, `badge:` lines), every admin cue (the cue sheet, in running order) and every story rule. The secrets live on the hidden `CHARACTER Kernel` here |
| `beats/` | The scenes: `login` (arrival), `desktop` (Bingo, the introduction), `hunt`, `malware` (the ad, the hour, the Truther Download), `pong`, `overshare`, `server-room` (The Heart), `finale` (the endings), `review` (The Night In Review), `ceremony`, `internet` (the tent), `staff` (the staff who play, wave 21) |
| `cast/` | The characters: `trabolta`, `featured` (the nine invited programs, who are guests), `pool` (the 22 programs any guest may pick), `hosts`, `antivirus`, `staff`, `props`, and `kit` (the shared traits) |
| `codex/` | The Codex entries (knowledge as currency). `9-facts.loom` is generated (below) |
| `objectives.loom` | The `OBJECTIVE`s: what each guest, performer and host sees as NOW |
| `quests.loom` | The Quest Log |
| `rooms.loom` | The extra chat rooms (every LOCATION is already a room) |
| `atmosphere.loom` | Background barks |

### Data (JSON)

| Path | Read by | What it is |
|---|---|---|
| `facts.json` | `titi:facts`, the server's judge | The team's one hand-edited facts file: the hunt questions and answer key, the scannable facts in four rarity tiers (`tiers`: common, rare, very rare, legendary; wave 35), the truths, the door code. **Holds secrets** |
| `house.json`, `house.shed.json` | The server, both reinstallation games, the terminals | The house map (tent night and rain night): rooms, terminal spots, ducks, the King |
| `audio.json` | The server, the stagehand `audio` router, the map editor | The MOTU's inputs and outputs, the placed speakers, zones, cues; since wave 38 the inputs' ducking roles (`trabolta` = the TV on input 3, `clippy` = his mic on input 1) and their `reach`, and the TV's route to the speakers |
| `lights.json` | The server, the stagehand `lights` module, the map editor | The server-room RGB bulb and its `heart_*` looks |
| `desk.json` | The server's house desk, Run → House, a host's Desk | Wave 25: the house's own cue list (DRAFT: tech checks only, no show cues yet). Schema: `core/src/house-desk.ts`, contract `docs/loom-house-desk.md` |

### The house soundtrack (outside this folder)

Wave 38 ([`docs/loom-w38-contract.md`](../../../docs/loom-w38-contract.md)).
The router plays music all night, one set per act; the story only names
the scene.

| Path | What it is |
|---|---|
| `stagehand/media/soundtrack.yaml` | Tracked. The playlists (one folder per act), the scenes (which playlist each speaker plays: the act's everywhere, the dryer loop in The Fan Closet) and the takeover tracks (the songs, `ceremony_bed`, `ad_jingle`) |
| `stagehand/media/music/<act>/` | Git-ignored, on the router machine only: the user's MP3s, in `doors`, `act-1`, `malware`, `act-2`, `act-3`, `final`, `ceremony`, `afterparty` |
| `stagehand/media/library/` | Git-ignored: the synthesized SFX library, rendered by `uv run stagehand sounds library --story` (which also writes the 13 story sounds' stand-ins into `media/sounds/`) |

The scenes are cued in `main.loom` (and `beats/finale.loom` for two
endings): each act change runs `cue music_<scene>` and mirrors it in
`set Night.music = "<scene>"` (as the lights' `Night.lights`), `off` at
every ending. The router reads `Night.music` back from the screen
state after a restart. `music_` is reserved: never a desk cue id or a
lights look. Pinned by `stagehand/tests/test_trapped_house.py` and
`core/test/trapped-w38-music.test.ts`. The runbook:
`scripts/house-desktop/README.md` §3.4–§3.6.

### Runtime config

| Path | What it is |
|---|---|
| `trabolta.persona.md` | Trabolta's persona for the voice model (the `agents` worker loads it). Also read by many core and stagehand tests |
| `trabolta.mind.md` | Trabolta's mind file: phase cards, stages, drives, and the `secrets:` block `titi:facts` writes |

### Generated

| Path | Written by | Check |
|---|---|---|
| `SHOW.html` | `pnpm --filter @loom/core show:page` (`core/scripts/show-page.ts`, from the story + `show-page/template.html`) | `show:page --check`; `core/test/show-page.test.ts` |
| `generated/questions.loom` | `pnpm --filter @loom/core titi:facts` (from `facts.json`) | `titi:facts --check` |
| `codex/9-facts.loom` | `titi:facts` | `titi:facts --check` |
| `generated/print-stacks.md` | `titi:facts` (the QR print stacks, one per tier) | `core/test/titi-facts.test.ts` |
| Marked blocks in `trabolta.mind.md` and `DESIGN.md` | `titi:facts` | `titi:facts --check` |

`show-page/template.html` is the hand-written prose of `SHOW.html`. Edit it,
then rerun `show:page`.

### Printed material

| Path | What it is |
|---|---|
| `cast-packs/` | One laminated pack per person: `crew/` (director, second director, tech operator, house manager, the Trabolta-mind operator), `performers/`, `featured/`, plus `all-crew.md`, `emergency-card.md` and `patch-bay-watch.md`. Test-pinned: the folder, `performers/cra-agent.md` and `performers/adobe-acrobat.md` |

### Docs

| Path | What it is | Status |
|---|---|---|
| `SHOWNIGHT.md` | The night-of runbook. `scripts/ops/checklist.sh` prints its pre-show checklist | Current. Test-pinned (its checklist, through `scripts/ops/test/run.sh`) |
| `TECH.md` | Every machine and device, how they connect, setup pointers, open hardware questions | Current |
| `README.md` | The show's reference: the files, before the doors, running the night act by act, endings, the Codex, quests, Trabolta, casting, the integration contract, the print and QR appendix | Current. Test-pinned (some contract rows and the codex counts) |
| `DEMO.md` | The show in 20–30 minutes on a laptop and a few phones | Current. Test-pinned (its phone rows and cue order) |
| `DESIGN.md` | The design record of the 2026-10-14 rewrite and later waves. The story files win where they differ | Reference. Holds the `titi-facts` block |
| `OCT31.md` | The crunch plan: per-wave build status, the workaround runbook, risks, cut order | Build history |
| `CHECKLIST.md` | The audit checklist of 2026-10-14, kept through wave 20 | Build history |
| `SCHEDULE.md` | The post-party roadmap | After the show |
| `SIGNOFF-w13.md`, `SIGNOFF-w18.md`, `SIGNOFF-w21.md`, `SIGNOFF-w26.md`, `SIGNOFF-w27.md`, `SIGNOFF-w28.md`, `SIGNOFF-w29.md`, `SIGNOFF-w32.md`, `SIGNOFF-w35.md` | Sign-off sheets: w13–w29 signed off 2026-10-27 (kept as the record); w32 and w35 DRAFT | Test-pinned; `SIGNOFF-w21.md`, `SIGNOFF-w26.md` (wave 26: the BINGO call, the locked phone, the Dare scene, the game's moments, no hints), `SIGNOFF-w27.md` (wave 27: the first meeting at his heart) and `SIGNOFF-w28.md` (wave 28: 📥 waits for Hunt 2, heart picks as chat lines) and `SIGNOFF-w29.md` (wave 29: no layer number or that phrase anywhere), all signed off. `SIGNOFF-w32.md` (wave 32: the talk scenes, ⚡ and the punched-up beats) is DRAFT, shipping as written; `test/trapped-w13-objectives.test.ts` checks it lists wave 32's objectives. `SIGNOFF-w35.md` (wave 35: the 78 new tiered facts, the re-tier of the old 60) is DRAFT. `SIGNOFF-w42.md` (wave 42b: the guest's place in Trabolta's line, the strip's words) is DRAFT |
| `history/` | Older contracts and sign-off sheets (`CONTRACT-w20.md`, `SIGNOFF-w18b.md`, `SIGNOFF-w20.md`) and the README's old banner (`readme-banner.md`) | History; see its README |

## Secrets

`facts.json`, `main.loom` (the Kernel's seeds), `codex/` and
`generated/print-stacks.md` hold the door code, the patch-bay combinations,
the answer keys and the codex codes. Never copy any of them into a doc, a
card that isn't meant to carry it, a chat, or `SHOW.html`
(`core/test/show-page.test.ts` fails if the page ever holds one).
