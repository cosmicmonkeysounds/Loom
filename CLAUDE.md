# Loom

Loom is a scripting language for interactive stories, from branching game
dialogue to live, multi-person events. This repo holds the language (a
maintained TypeScript engine and an older Rust one), the tools around it
(an editor, a language server, a bank compiler for game engines) and a live
event stack: a multi-tenant event server, the phone app guests and
performers use, wall terminals, two reinstallation games and the house
show-control bridge. Its first big production is the party show *Trapped in
the Internet* on 2026-10-31.

License: MIT for everything except `server/` (GPL-3.0-or-later, because it
depends on `prism-core`).

## This repo is not Prism

Loom is its own git repo, nested at `prism-root/packages/loom`. The parent
`prism-root/CLAUDE.md` describes the Prism framework. **Its rules do not
apply here**: there is no `prism` CLI, no Slint / femtovg / Taffy, and you
use `pnpm`, `cargo` and `uv` directly. This file and the package files it
points to are the ones to follow.

`.claude/worktrees/` holds many git worktrees (git-ignored), each with old
copies of these docs. Exclude `.claude/` from any recursive grep or find.

## Packages

The TypeScript engine in `core/` is the maintained implementation. The Rust
crates are the original one and lag far behind it.

| Path | What it is | Agent docs |
|---|---|---|
| `core/` | `@loom/core`: the TS parser, runtime (`Sim`), in-process LSP, and the event server (`pnpm --filter @loom/core serve`, :7000) with the SaaS control plane | `core/CLAUDE.md` |
| `core/examples/trapped-in-the-internet/` | The show's story, maps, facts, show book and runbooks | `INDEX.md` there |
| `play/` | `loom-play`: the guest and performer phone app (Vite React) | `play/CLAUDE.md` |
| `editor/` | `loom-app`: the author IDE (Writing ⌘1, Run ⌘2, Integrations ⌘3) | `editor/CLAUDE.md` |
| `terminal/` | `loom-terminal`: wall terminals, the TV, the server room, chess, casino, the tent | `terminal/CLAUDE.md` |
| `house/` | `@loom/house`: the house map, audio and lights schemas, routing, voice wire format | `house/CLAUDE.md` |
| `reinstall/` | The golden-duck games: `web/` (`loom-reinstall`, plus the map editor) and `vr/` (Godot 4.7, Quest 3) | `reinstall/CLAUDE.md` |
| `chess/` | `@loom/chess`: the King's chess, played on the Server Door terminal | `chess/CLAUDE.md` |
| `bank/` | `@loom/bank`: the `.loombank` compiler and the normative reference interpreter | `bank/CLAUDE.md` |
| `engines/godot/` | The GDScript runtime + Godot addon, conformance-tested against `bank` | `engines/godot/CLAUDE.md` |
| `desktop/` | `loom-desktop`: the editor in a Tauri 2 shell, with the Godot integration | `desktop/README.md` |
| `stagehand/` | Python (uv) live-event bridge: `agents` (Trabolta's voice), `show`, `lights`, `audio` (the speakers, the soundtrack, the SFX library, his voice broken in real time) | `stagehand/CLAUDE.md` |
| `hardware/server-room-m4/` | Grand Central M4 firmware: the server-room door sensor and the patch bay | its `README.md` |
| `hardware/server-room/` | ESP32 firmware. **Not installed** for Oct 31 | its `README.md` |
| `invite/` | `loom-invite`: the party invitation one-pager | — |
| `parser/`, `runtime/`, `lsp/`, `syntax/` | The Rust workspace (`cargo build` / `cargo test` from the root) | crate docs |
| `server/` | Rust multi-user relay. Builds only inside the Prism monorepo; excluded from the workspace | `docs/history/` |
| `examples/` | Reference `.loom` projects | — |
| `mind/` | Superseded by stagehand `agents`; awaiting deletion | — |
| `simulator/` | Old, kept runnable | its `README.md` |
| `scripts/` | `dev.mjs`, `ops/` (predeploy, ship, backups, checklist), `accept/` (per-item device checks), `show/` (`showctl`), `sim/` (the full-evening bots), `house-desktop/` (Windows runbook), `house-macbook/` (macOS runbooks), `server-room/` (whisper.cpp and the kiosk on Steph's laptop) | `scripts/show/`, `scripts/accept/`, `scripts/sim/`, `scripts/house-desktop/` READMEs |
| `deploy/` | VPS release, rollback, backup and restore scripts + the Caddyfile | `docs/loom-docker-deploy.md` |
| `docs/` | Design docs, specs, runbooks, in-app help, history | `docs/README.md` |

`Trapped In The Internet story/` at the root holds the author's original
story documents. Leave them as they are; quote the path in shell commands.

## Commands

```bash
pnpm install                           # every JS package (one pnpm workspace)
pnpm dev                               # build play + terminal + reinstall, run the
                                       # server (:7000) + editor (:5173)
pnpm dev --sync "<project>"            # also push the example story into a server project
pnpm dev --only server --no-build      # just the server
pnpm test                              # pnpm -r test
pnpm --filter <name> test              # one package (@loom/core, loom-play, loom-app, …)
pnpm --filter <name> typecheck

pnpm --filter @loom/core titi:facts [--check]   # regenerate the show's files from facts.json
pnpm --filter @loom/core show:page [--check]    # regenerate SHOW.html
pnpm --filter @loom/core loomcheck examples/trapped-in-the-internet --smoke  # lint a story
pnpm house:sync                        # house goldens + copy into reinstall/vr
pnpm test:vr                           # the Godot suite (needs Godot 4.7)

cd stagehand && uv run pytest          # stagehand
hardware/server-room-m4/test/run.sh    # M4 firmware host checks (`run.sh compile` builds it)
cargo test                             # the Rust crates

pnpm showctl doctor                    # show-night diagnostics (scripts/show/README.md)
node --experimental-strip-types scripts/sim/evening.ts --base <scratch url> --code <mod>
                                       # (= `pnpm sim`) bots play a full evening, green/red per
                                       # beat; scratch servers / rehearsals only (scripts/sim/README.md)
scripts/ops/predeploy.sh [--vr]        # the full pre-deploy gate; stamps the commit
scripts/ops/ship.sh <tag>              # rsync + deploy/release.sh on the VPS
LOOM_SSH=loom-vps LOOM_PROJECT="trapped in the internet" pnpm sync-show
                                       # push the show story into the VPS project + reload
```

The DB-gated core tests need Postgres:
`DATABASE_URL=postgres://127.0.0.1:5432/loom_dev pnpm --filter @loom/core test`
(they skip silently without it).

## Conventions

- **Branches.** Build each wave on worktree branches named
  `oct31-wN/<lane>`, commit often with Conventional Commits
  (`type(scope): description`), and merge each lane into master with
  `--no-ff`. Never leave one big uncommitted change.
- **Never deprecate.** Rename, move, break and fix. The tests are the
  safety net.
- **Tests with every change.** vitest in the TS packages, pytest in
  stagehand, `test/run.sh` for firmware, the Godot suite for VR. Keep the
  in-app help tests green when you touch `docs/help/`.
- **Search gotcha.** ugrep treats `core/src/runtime/sim/sim.ts` as binary.
  Use `grep -a` on it.
- **Scratch servers.** An unset `DATABASE_URL` defaults to `loom_dev`, which
  holds the user's own dev events. Give a scratch server a dead URL
  (`DATABASE_URL=postgres://127.0.0.1:1/none`), `LOOM_DB_WAIT=off` and a
  fresh `LOOM_STATE_DIR`.
- **Never `pkill -f "stagehand run"`.** It kills the user's own Trabolta
  worker. Stop the process you started by its pid.
- **Trabolta's fiction.** Trabolta lives in Halifax, in the MapsAndDucks
  universe. He never knows the crew (John, Steph, Jesse), the party, the
  show, Loom or the hardware. Every prompt, persona line, dossier and scene
  stays inside his world (the persona's `outside:` list enforces it).
- **Secrets stay out of public surfaces.** Never write the patch-bay combo
  strings, the door code, hunt answer keys, codex or digit-note codes, or
  live join / mod codes into a doc, a README, a CLAUDE.md, SHOW.html, a
  commit message or test output. They live in the story (the hidden
  `Kernel`) and `facts.json`.
- **Deploy gate.** Before `ship.sh`, check the preview's roster
  (`guests` / `modsOnline`) in its own step. A release restarts the
  server; if anyone is on, ask first. Run `sync-show` only after `ship.sh`
  succeeds.
- **Live events.** `sync-show` refuses to reload an event with real guests
  (exit 3) unless told `--i-know-this-is-live`. Never Restart, Push draft,
  Go live or End after the doors open.

## How the live stack fits together

- **Control plane** (needs Postgres): BetterAuth author accounts, projects
  and files (`/api/projects/*`), members and invites, real-time co-editing
  over Yjs. Without a database the event plane still runs.
- **Event plane:** one `EventRuntime` per event under `/e/:eventId`.
  Guests, performers and terminals join with a short code
  (`/api/resolve-code`). An author's session moderates their own events
  (Run == admin). Every mutation is journaled; a restart replays the
  journal.
- **Clients:** `play` (phones), `terminal` (`/terminal/`), `reinstall/web`
  (`/reinstall/`), the editor (`/edit/` behind Caddy). The server serves the
  built `play`, `terminal` and `reinstall` bundles.
- **Docker:** the root `Dockerfile` and `docker-compose.yml` build the
  server, Postgres and a Caddy proxy (`docs/loom-docker-deploy.md`).
  Releases are pinned image tags (`deploy/release.sh`, `rollback.sh`).
- **In-app help:** markdown in `docs/help/{authoring,play}/`, bundled into
  the editor and play at build time. Do not move that folder.

## The show this week

*Trapped in the Internet*, Oct 31 2026. Start at
`core/examples/trapped-in-the-internet/INDEX.md` (what each file is, which
ones code and tests read). The crew's show book is `SHOW.html` in that
folder, generated by `show:page`. The night-of runbook is `SHOWNIGHT.md` (its §4
pre-show checklist is what `scripts/ops/checklist.sh` prints); the machines
are in `TECH.md`.

### Machines

| Machine | Runs |
|---|---|
| VPS (`app.mapsandducks.com`) | The event server, Postgres, Caddy |
| John's MacBook (macOS, M3 Max 48 GB) | **Trabolta**: stagehand `agents` (`stagehand/laptop.yaml`, local) on Claude Haiku, with Ollama `gpt-oss:20b` as its standby (wave 52); `predeploy` / `ship` / `sync-show` / `showbackup`; a director's Run console. The audio router's fallback host only (`trapped.macbook.yaml`) |
| John's Desktop (Windows) | **The audio and the lights** (decided 2026-10-27): the audio router (stagehand `audio`) on the MOTU 828x's own outs (no ADAT expander since wave 31), with the living room on Main L/R (outs 1–2) plus the sub on Analog Out 1 (out 3) (wave 38; the 828x's Windows ASIO channel order since wave 46) and the soundtrack's MP3s in `stagehand/media/music/`; Zigbee2MQTT on the CC2652P stick with the Philips Hue and ThirdReality ZL1 bulbs, each paired under its `lights.json` name (no Zigbee groups, scenes or WLED presets: every `lights_*` cue is a `lights.json` look); the living room's WLED (ESP32) strip over Wi-Fi (`wled/living`); Mosquitto (anonymous on 127.0.0.1:1883, password-only `props` on the LAN at :1884); stagehand `show` + `lights` + `audio` as Task Scheduler tasks (`trapped.desktop.yaml`); the living-room TV over HDMI (Chrome kiosk, spot `desktop-tv`), its sound through VoiceMeeter (the PC has no line out: Chrome's output is VoiceMeeter Input, VoiceMeeter Potato runs at sign-in with its VAIO strip on B1 only) and the router's `audio.tap` into the 828x's input 3 (wave 46), which the router plays on every speaker as Trabolta's channel (the TV's own speakers off; input 3 mixed nowhere in CueMix). Runbook: `scripts/house-desktop/README.md` |
| Steph's laptop | The server-room terminal in its own Chrome profile (`scripts/server-room/start-terminal.ps1`: `…&spot=server-room&door=serial&camera=user&webcam=C310&pad=1&whisper=1&crt=1`) + the Grand Central M4 over USB (door + patch bay); the USB webcam (camera + mic), an old 4:3 CRT (HDMI → component), GameCube controller, whisper.cpp on 127.0.0.1:8178; no SSH key for the VPS, so it can't ship; no mouse or keyboard on the night |
| John's old laptop | The tent: `/terminal/?code=<mod>&spot=tent&announce=1`, the reinstall wizard and web game. Needs WebGL2 |

Also in the show: the wall tablets (Fully Kiosk), the Server Door chess
and casino terminals, a Quest 3, the server-room RGB bulb, and phones.

House announcements go the server → the Desktop's `show` job → MQTT
`show/announce` → the router (on the Desktop too, since 2026-10-27) → the
speakers. With the broker or `show` down, only `&announce=1` terminals
still speak them.

**Run → House** in the editor is where the house is connected, tested and
designed (wave 30): **🔌 Setup** (is the sound router, the lights module
and Trabolta's mind connected, and what to do), **🎛 Desk** (the cue list,
GO, the checks) and **🎨 Cue designer** (lighting looks with a live preview
and templates, sound auditions, desk cues, and the `cue` / `sound` line
the story fires each with) and, since wave 40, **🎚 Mixer** (the live
house balance per source, room and speaker, and the soundtrack's
transport: skip, scene, stop, follow the story; also in a host's Desk
window; `docs/loom-w40-contract.md`). A host's phone has the same Setup and checks in
its **Desk** window. Help: `docs/help/authoring/49-house-setup.md`,
`50-cue-designer.md`, `47-house-desk.md`.

**The soundtrack from TIDAL** (wave 52, on master; it runs on the Desktop):
the acts and the ending are John's TIDAL playlists, played by the app on the
Desktop (`scripts/house-desktop/tidal.ps1`, which gives it its control port)
and heard through VoiceMeeter's AUX → B2 as a stereo bed on the `music` bus;
each act's `media/music/` folder is the fallback. Custom songs stay MP3s.
Runbook: `scripts/house-desktop/README.md` §3.7;
`docs/loom-w52-contract.md`.

**Trabolta's letters** (wave 41, not shipped; `docs/loom-w41-contract.md`,
show text `DRAFT w41` on `SIGNOFF-w41.md`): the upload ends with an
optional inbox card (performers get one in their booth), the problem form
takes a write-in (*Something else*), and after the ending a director runs
Run → **Letters**: ✍ the MacBook's Trabolta writes one letter per inbox
from that person's night, a director reads / edits, then ✉ Send (Resend as
the webmaster address). Addresses never enter the journal. Send before
End (SHOWNIGHT §8). Help: `docs/help/authoring/52-letters.md`.

**Trabolta under load, and as intended** (wave 42, 42b–42e, not shipped;
`docs/loom-w42-contract.md`, show text `DRAFT w42*` on `SIGNOFF-w42.md`):
a worker announces `capacity=`, the server hands it only that many threads
and queues the rest in order (talk scene, heart, then first come); a waiting
guest sees their place in line (the 🕑 strip, `agentWait`), "typing" only
while he writes; rulings no longer starve; one worker can add overflow
engines under one mind. Measured on the MacBook with 50 bots at the intro
(`pnpm sim:trabolta`): today's code waits ~164 s median, wave 42 at
`concurrency: 4` (+ `OLLAMA_NUM_PARALLEL=4`) ~95 s, ~21 replies a minute is
this GPU's ceiling. His DMs get guards (stand-down, numbers, promises,
bait mode on anything he never gives, assistant voice, self-placement),
fillers keyed to what the guest did, and a model-free distress line. The
54-scenario behaviour battery (from the original story documents) is
`scripts/sim/trabolta-battery-54.json` + `pnpm sim:trabolta --battery`.

**Video consent, Help Me, the credits** (wave 44, not shipped;
`docs/loom-w44-contract.md`, show text `DRAFT w44` on `SIGNOFF-w44.md`):
the upload deals a 🎥 card (an opt-out: unanswered, video may be used;
⊞ Start changes it), and Run → 🎥 Video consent lists it with a CSV
(download before End). A program being reinstalled has 🆘 Help Me on the
locked phone and the tent's screen: a `!` alert in `# hosts`, once a
minute. G11 ends every night on the credits (the project's
`credits.json`, read live) on the TV, the walls and every phone; G12 🎬
rolls them again. Help: `docs/help/authoring/53-credits-and-video.md`.

**The Bathroom Report** (wave 45, not shipped; show text `DRAFT w45` on
`SIGNOFF-w45.md`): each program counts its Bathroom Mode trips, story
seconds and on/off switches (`bath_*`). G13 🚻 (appended last, an aside)
reads the party's minutes, most / least time, most switches and how many
never went, on the TV too (`award_bathroom`, the screen state's
`night.bathroom`). At G1 a program that never went loses 5 trust (THE
TRUST FORMULA's `- no_bath * 5`); a first trip after gives it back. Run's
recap lists the minutes, the switches and who never went. Help:
`docs/help/authoring/54-bathroom-report.md`.

**The Password Manager's filter** (waves 48 and 48b, shipped in `w50`;
`docs/loom-w48-contract.md`, show text `DRAFT w48` / `DRAFT w48b` on
`SIGNOFF-w48.md`): `censor: Password Manager` in the header. Every line a
guest sends that the filter catches at her strength pops up in her booth
as 🔑 LANGUAGE (the rest behind a 🔑 n tray counter). The strength (48b) is
a slider in her ⊞ Start menu, 0–100% in bands, starting at 100% (over-eager
on purpose: *password*, *hello*, *check*); whole words go through the
`obscenity` library, buried stems are ours. Slurs are starred before a line
is stored. ✂ Censor stars it out everywhere (`p***word`), pays her ⭐
(points × a heat multiplier) and raises the program's doubt (+5) with an
automated notice; it marks nobody. G14 🔑 The Language Report (appended
last, an aside) reads who cursed the most, n of m words censored and the
top five; the TV lets every censored word out (`award_language`, the
screen state's `night.language`). Help:
`docs/help/authoring/55-language-filter.md`.

**The descent** (wave 49, shipped in `w50`; `docs/loom-w49-contract.md`, show text
`DRAFT w49` on `SIGNOFF-w49.md`): the more often a program is reinstalled, the
less the simulation holds together (House of Leaves, Alice). Its first walk is
clean; each find after adds a level, capped at 4 (`descentLevel`), or a director
forces one on the Run page's House map card. Levels bring hallucination moments
on a seeded plan, props with faces that talk with multiple options and remember
what a program told them (memory only), strange props that appear (`Prop.from`:
the tea party, the clock, the bottle) and the door that wasn't there, into a
hallway longer than the house. No story change. The words are `descent.json`,
read live, so an edit needs no APK. Footsteps: the server judges from the poses
which speakers carry each walker (same room clear, another room or floor
muffled, `audio.json` `footsteps`), and the router synthesises the steps
(`stagehand audio`, a 🎚 Footsteps strip). The map editor is now **Run → House →
🗺 Map**, signed in by the run; `/reinstall/map` still works. The catalogue has
58 prop models, and both show maps were redrawn with them. Help:
`docs/help/play/19-house-workings.md` (staff; the guests' help never describes it).

**Clippy's dream** (wave 50, shipped in `w50`; `docs/loom-w50-contract.md`): when
Trabolta says *"…the Y2K BUG."* (the TV reports it; 42 s after 🕚 without one)
every terminal melts at one instant into an hour-long video, replacing the idle
show until an ending, each at its own place in it. The clock floats on it; a
line, a board and a walk are left alone. What outranks it comes through **data
moshed** (`terminal/src/dream/`): cutscenes, slides, overlays, announcements,
wiping clean every 6.4 s; a blackout stays black. The games' terminals keep
their real room cameras, with spurts of it down the same routes, so no APK. The media is in `~/loom-media/dream` on both machines,
never in git or an image (`scripts/ops/dream-media.sh`; already on the VPS).
🌀 turns it off and on. Help: `docs/help/play/19-house-workings.md`.

**Claude as his voice** (wave 52, on the MacBook, no release needed;
`stagehand/docs/agents.md`, "Claude as the voice"): Claude Haiku 5.5
(`api: anthropic`, 16 slots) speaks every line, rules on filings and writes
the letters; Ollama `gpt-oss:20b` stands by for an outage or a refused line, on
a line-by-line failover. Guests' lines and his whole prompt go to Anthropic:
the user decided that on 2026-10-30. The key is
`~/.config/loom/anthropic.key` (never a YAML or a plist); the SDK is an
optional extra, so the Desktop never installs it. 50 bots waited 1.9 s at the
median (99 s on the GPU) at 190 replies a minute, and a line costs about
$0.0006. To go back: `cp stagehand/laptop.ollama.yaml stagehand/laptop.yaml`,
then `scripts/house-macbook/trabolta-reset.sh`.

**Everyone uploads, and the phones speak** (wave 53, shipped in `w53`;
`docs/loom-w53-contract.md`, show text `DRAFT w53` on `SIGNOFF-w53.md`): Clippy,
the Antivirus and the hosts run the guests' own Login, Upload and Upload Deposit
beats on their characters (`TRAIT Staff`): a character bound as the subject in a
`cutscene: true` location is on rails, so its booth is the arrival stage. They
are still never Persons. They get no Truthcoin, pass or door scan, and leave by
the staff door. It works before the doors open, so the crew does it first; ⏭
Wave the staff through their upload is the way past it. A 🔊 card in the upload,
or ⊞ Start, turns on the phone's own voice for what the house speakers say and a
host's 📣 (the `announce` stream frame, `play/src/phone-voice.ts`). Not proven on
a real phone: run `SIGNOFF-w53.md` §3 first. Help:
`docs/help/play/07-performers.md`, `16-notifications.md`.

**One QR per person** (wave 54, shipped in `w56`; show
text `DRAFT w54` on `SIGNOFF-w54.md`): a badge is handed out, scanned with the
phone's camera, and the phone lands with everything filled in: a staff badge per
part signs straight in to the upload, an invited badge per featured program lands
on *You are …* with one button, and a numbered blank opens the picker with no
code to type. After the upload a host's or an Antivirus's scan of the badge
confirms them (staff keep the staff door; Clippy only greets). A 🚻 sign presses
Bathroom Mode. Run → 🖨 Print sheet prints 3 × 2 in badges and location cards,
ten to a sheet, and fact cards four to a row. Terminals still read the phone's
pass, not a printed badge. Help:
`docs/help/authoring/43-run-mode.md`, `docs/help/play/18-getting-back-in.md`.

**The teleprompter** (wave 55, shipped in `w56`; `docs/loom-w55-contract.md`, show
text `DRAFT w55` on `SIGNOFF-w55.md`): a beat's `aloud:` line names who reads it
out loud (25 beats: Clippy's speeches and read-outs, the hosts' opening lines,
`aloud: {Night.bobber}` for truth.txt). Their whole phone turns into 📜 READ THIS
OUT LOUD, which stays until they press ✓ Done on the teleprompter: variable
speed, a rail that previews and jumps, section jumps. Trabolta's lines stay on
the TV; they show as cues. The bobber's printout stays. Quick reactions are left
unmarked so a mid-game phone is never blocked. Every phone needs a reload. Help:
`docs/help/play/07-performers.md`, `docs/help/authoring/56-read-aloud.md`.

**His voice comes apart** (wave 56, shipped in `w56`; `docs/loom-w56-contract.md`,
decisions on `SIGNOFF-w56.md`, no new show text): towards the end of the night
and in the major glitches Trabolta's speech breaks, in nine flavours. The server
says how much (`voiceFx`, `core/src/voice-fx.ts`: a curve over the phases and the
Y2K clock, scaled by `Trabolta.composure`, healed by a talk-down or the helped
ending; a spike for the hijack, ⚡ and the dream). Every terminal that speaks him
plans each sentence (`terminal/src/speech/glitch.ts`: pace, pitch, voice, real
cut-offs, only ever his own words), and the Desktop's router tears the sound
itself up on its way to the speakers (`stagehand/audio/voicefx.py`). Run →
Terminals, 🌀 His voice: Auto, Clean (the kill switch), Broken, and a flavour on a
button; `/terminal/?preview=voice` auditions them. It needs every terminal and
the TV reloaded, and on the Desktop `git pull` and
`start-stagehand.ps1 -Restart audio`. Not proven on Windows' voices
or the house speakers: run `SIGNOFF-w56.md` §3 first.

### Release status

The VPS runs **`w56`** (master `d8223795`, shipped 2026-10-30; rollback `w53b`):
waves 54 (one QR per person), 55 (the teleprompter) and 56 (his voice comes
apart), with `oct31-w53/whisper-origin` and `oct31-w53/server-room-kiosk`. The
preview was synced (`--keep-maps --keep-audio --keep-lights --keep-desk`) and
reloaded. On the live server `/api/mod/codes` lists 8 staff badges on the guest
code, 9 invited badges, 11 location cards and the 🚻 sign, all on the public
address, and `/api/mod/badges` the blanks; the live editor and phone bundles carry
the new print sheet and upload, and the terminal page's CSP allows whisper. The
print sheet has not met paper or a real phone camera: run `SIGNOFF-w54.md` §3
before the full run. Still owed: reload every phone, terminal, the TV and any open
Run tab (an open one keeps the old print sheet); every staff member uploads again
(the reload cleared it); sign off `SIGNOFF-w54.md`, `-w55` and `-w56`, with their
real-device checks. The Desktop does `git pull`, sets up `tidal.ps1`
(`scripts/house-desktop/README.md` §3.7) and runs `start-stagehand.ps1 -Restart
audio`.

**Spoken answers work on `w56`** (Steph's laptop, 2026-10-31). `start-terminal.ps1
-Setup` made every grant in the terminal's own profile (`%LOCALAPPDATA%\loom-terminal`,
`docs/trapped/kiosk.md`, First launch), and ⚙ read *whisper is listening*. After a
full Chrome restart the M4 reopened with no click, a recorded clip went from the
live page to whisper and back word for word, and in the kiosk SPEAK TO HIM said the
speaker's words back. His reply to a spoken line wasn't checked. The laptop reflashed
the M4 and recalibrated the door on 2026-10-30, and a new profile leaves the board's
flash alone, but the door read OPEN at the setup. Still owed there: open and shut the
door once and watch 🚪 flip on Run → Terminals (calibrate again if a shut door reads
open), relearn the patch bay once that's wired, make the CRT the only display at
640 × 480, and run `start-terminal.ps1 -InstallTask`, or the kiosk doesn't come back
after a restart.

Before it, `w53b` (master `136e656c`, shipped 2026-10-30; rollback `w53`):
the merged `oct31/trabolta-room` (the server room's CRT, GameCube pad and local
Whisper, the pulsed door sensor; the CRT and voice words are `DRAFT w52` /
`DRAFT w52b`) and `oct31-w52/tidal` (the soundtrack from the TIDAL app). No story
or server code changed, so the preview was synced with `--no-reload` and carried
on through the release. The spoken answers couldn't work on it: `TERMINAL_CSP`
(`core/server/routing.ts`) had `connect-src 'self'`, which blocks
`http://127.0.0.1:8178`; a guest saw *YOUR VOICE ISN'T REACHING HIM*, and B and the
menus still worked. The user approved adding that one origin (2026-10-30), and
`w56` carries it. Vite sends no CSP, so a local test hides this. Rehearsed on
2026-10-30 in Chrome 156 on the real https page, with this header swapped in and
the laptop's real whisper: both gates are needed and nothing else stands behind
them. The CSP refuses the fetch; with the header and no device grant Chrome refuses
the loopback address; with both, `/inference` answers (a 29 s clip in 4.3 s,
`small.en`, 8 threads). `showctl preflight serverroom` fails on its *Page → whisper*
row on an older server.

Before it, `w53` (master `a27da927`, shipped 2026-10-30; rollback `w51`):
wave 53 (everyone uploads, the phones speak) on top of wave 52, which changes
only the MacBook's `agents` job. The preview was synced (`--keep-maps --keep-audio
--keep-lights --keep-desk`) and reloaded. On the live server with the doors open,
a phone profile took McAfee and CRA Agent through the whole upload and the staff
door to a working booth, with no scan; the parts were released and the preview
reloaded clean after. Still owed: reload every phone (a booth on the old bundle
never reports in, so it skips the upload), every staff member uploads before the
doors, run `SIGNOFF-w53.md` §3 on a real iPhone and Android phone (the voice was
logged in Chromium, never heard), sign off `SIGNOFF-w53.md`.

Before it, `w51` (master `a033840b`, shipped 2026-10-30; rollback
`w50`): the ghosts as glitchy swarms of their profile pictures, VR's right
hand as the player's own swarm with no left hand, the underside of an upper
floor, the reinstall test code; for the house, Zigbee flow control with
`lights-reset` / `lights-drill`, and `audio.tap` (VoiceMeeter into input 3)
with `audio.json` in the 828x's ASIO order. No server code or story changed.
The preview was synced (`--replace-audio --keep-maps --keep-lights
--keep-desk`) and reloaded, so the project's `audio.json` is now the repo's.
Keep `--keep-lights`: the project's `lights.json` has hand edits the repo
lacks (the `steam-1` fixture, surveyed positions, the paired names
`kitchen_main`, `kitchen_dining`, `kitchen_hall`, `hall_upper`); Download
JSON and commit it before any `--replace-lights`. Still owed: on the Desktop
`git pull` and `start-stagehand.ps1 -Restart audio` and `-Restart lights`
(the router was offline at the ship, and the footsteps and the tap need it),
reload every phone, terminal and the TV, re-export and sideload the Quest
APK, sign off `SIGNOFF-w48.md` and `SIGNOFF-w49.md`. Before it, `w50` (master
`03d09bf7`, shipped 2026-10-30; rollback `w45`): waves 46 to 50 (the Quest
fixes and the new look, nothing twice, the Password Manager's filter, the
descent with the footsteps and Run → House → 🗺 Map, Clippy's dream). The
preview was synced (`--replace-maps --keep-audio --keep-lights --keep-desk`)
and reloaded; the project's maps were replaced on the user's word, so its
three survey edits are gone (duck spots `cpu-desk` `[-6.8, 0.75, 14.3]`,
`start-bar-counter` `[6.65, 0.9, 16.85]`, the `router` prop
`[3.3, 0.9, 15.25]`). Before it, `w45` (master `d7c52aef`, shipped 2026-10-29;
rollback `w44`): wave 45 (the Bathroom Report, G13) and the merged
`oct31-w40/reinstall-resume` branch (the reinstall walk resumes across
devices; the Desktop's lights fixes and `scripts/house-desktop/INFO.md`;
the Quest export presets and `reinstall/vr/tools/quest-win.ps1`). The
preview was synced (`--keep-maps --keep-audio --keep-lights --keep-desk`)
and reloaded. Still owed for it: reload the web game and the tent, and
re-export and sideload the Quest APK. Before it, `w44` (master `cef5d7f2`,
shipped 2026-10-29; rollback `w40`): waves 41 (Trabolta's letters), 42 (Trabolta under load and as
intended: the windowed hub, the queue strip, bait mode; `docs/loom-w42-contract.md`),
43 (the King's board on a phone) and 44 (video consent, Help Me, the
credits). The preview was synced (`--keep-maps --keep-audio --keep-lights
--keep-desk`; `credits.json` added) and reloaded. The MacBook runs
`concurrency: 4` with `OLLAMA_NUM_PARALLEL=4` and `OLLAMA_KEEP_ALIVE=-1`
(`scripts/house-macbook/trabolta-reset.sh`: the server holds the worker at
capacity 4; after a reboot run it again, or once with `--persist`). Still
owed: reload every phone, terminal and the TV (the queue strip, the
credits, the chess board); the Desktop was not touched. Before it, `w40`
(master `87927a52`, shipped 2026-10-29; rollback
`w39`): wave 40 (the house mixer: Run → House → 🎚 Mixer and a host's
Desk window balance music, featured tracks, sound effects, announcements
and Trabolta's TV everywhere, per room and per speaker, with live meters,
and the soundtrack's transport: skip, scene, stop, follow the story;
`docs/loom-w40-contract.md`). No `sync-show` was needed (no story or
project-file change). For it: the Desktop's router must run master
(`git pull`, then `start-stagehand.ps1 -Restart audio`), or the mix and
the music buttons are kept but not heard. Before it, `w39` (master
`31377ada`, shipped 2026-10-28; rollback `w37b`): wave 39 (the house lights meet the reinstallation games: a program
standing under a `rooms` bulb in the web or VR game breathes the real bulb,
never a safety fixture; both games are lit by the real fixtures, or by the
server's estimate of the last look; web quality tiers low/medium/high/auto
with bloom and a grade pass, VR `graphics` tiers in `station.json`;
`docs/loom-w39-contract.md`; the ⚙ Graphics copy is `DRAFT w39`). No
`sync-show` was needed: the project's `lights.json` has no presence block,
so the default (`rooms`) applies, the same set as the repo's. For it: on
the Desktop `git pull` and `start-stagehand.ps1 -Restart lights`, reload
the tent and the web game, re-export and sideload the Quest APK. Not yet
proven on hardware: a look's command cancelling a Hue breathe, the tent
MacBook's frame rate, the Quest holding 90 Hz on `medium`.

Before it, `w37b` (master `90bdd2e0`, shipped 2026-10-28; rollback
`w37`): wave 37 (the Play de-clutter: one × closes a scan, nothing floats
over a scan or a card, one thing at the bottom of a booth, NEW MISSION said
once, game pop-outs that yield and retire, a performer's feed about their
own job, banners that leave after 45 s, Show's *Needs you* first; the
guest first-load gate is 149 kB since 37b) and wave 38 (the house
soundtrack, priority ducking, the SFX library: its house steps are in
`docs/loom-w38-contract.md`; the project's `audio.json` was kept, so the
soundtrack's file reaches the preview only with `sync-show
--replace-audio`). The preview was synced (`--keep-maps --keep-audio
--keep-lights --keep-desk`) and reloaded on it, and the bots played a
full night there (23/23). Reload every phone. Before it, `w33b` (master
`9c852e30`, shipped 2026-10-28; rollback `w32`): wave 33b (smooth turning only in VR, gentler movement, a wall
buzz, the terminals 3× in both games with 320×240 feeds; the intro copy
signed off) and wave 35 (the facts' rarity tiers, 78 new facts; show text
`DRAFT` on `SIGNOFF-w35.md`). The preview was synced (`--keep-maps
--keep-audio --keep-lights --keep-desk`) and reloaded on it. For 33b,
reload every terminal (the bigger feeds) and re-export and sideload the
Quest APK. Before it, `w32` (master `09798a99`, shipped 2026-10-27;
rollback `w31`), and the preview was synced (`--keep-maps --keep-audio
--keep-lights --keep-desk`) and reloaded. It carries wave 32 (Trabolta
talks back: Task Manager's 🤖 Talk card relays Clippy to a live Trabolta
on the TV, canned lines for both, ⚡ and timed ad bursts, the punched-up
talk beats, his stage voice with its guards and scene lines, and his
queue: the TV, then his heart, then DMs; `docs/loom-w32-contract.md`,
show text `DRAFT w32` on `SIGNOFF-w32.md`) and wave 33 (the reinstallation
games' intro). For wave 32 the MacBook's `agents` job must run master
(`uv run stagehand launchd restart --job agents`, then Run → Mind →
Reset), the TV and every terminal must be reloaded, and the Task Manager,
Clippy and director packs reprinted. `w31` was the release before it.
Wave 31: every house bulb (Hue + ZL1) and the living-room
WLED strip are `lights.json` fixtures and every `cue lights_*` is a look
(no Zigbee groups, scenes or WLED presets); the lights job catches up the
house look from the screen state's new `night.lights`; `audio.json` is the
828x's own outs (no ADAT expander). Below, `w29` is the release before it.

`w29` (master `a0cc8efb`, shipped 2026-10-27; rollback
`w28b`) carried: waves 27–30 — the heart's first meeting, the full-evening bots
(`pnpm sim`, `pnpm sim:heart`), the heart follow-ups, no layer number or
"out of character" anywhere, and wave 30's House Setup / Cue designer. The
"trapped in the internet" preview event was synced and reloaded on it. Wave 27 is the first meeting at Trabolta's heart: the talk branches on
who the program is and what it did tonight (Heart Evidence / Heart Reasons
sub-menus, ≤ 9 options a menu), and the heart terminal shows only this
visit, fits the whole menu and holds it while he speaks. The server side is
done; the house machines are not (steps 4–5 and 7–10 below: retire the
MacBook's `show`/`lights`, the Desktop's stagehand, the router, the M4, and
reload every terminal and the TV, which still ran a 10-24 build on
2026-10-27). Wave 23 needs the badges printed from Run →
Print sheet (Badges) and the cast cards reprinted (each now carries its own
part's QR). **The sign-off is done:** on 2026-10-27 the user signed off
every sheet (*"Every line in the signoffs looks good! ship those please."*):
the show text of waves 13, 18, 18b, 20, 20b, 21, 26, 27 and 28 ships as
written (and wave 29's, signed off the same day: *"I approve whatever wording
you pick"*), every drafted default is accepted, and their `DRAFT` markers are
gone (the `SIGNOFF-*.md` sheets stay as the record). One kind of marker
remains: wave 22's patch-bay lines (`DRAFT w22`, no sheet). Wave 26
ships in its contract's C14 order: the server release → `sync-show` →
reload every terminal and the TV → re-export and sideload the Quest APK.
Reprint the cast packs now: `clippy`, `task-manager`, `norton`, `mcafee`,
`password-manager`, `cra-agent`, `crew/director`,
`performers/installation-wizard`, `featured/microsoft-excel`,
`adobe-acrobat`, `recycling-bin`, `all-crew` and `patch-bay-watch`. Not yet proven
on real hardware: the Quest's audio, TTS and mic (`tools/quest.sh logs`),
the glitch on real phones, and the real speakers.

### Shipping master (summary)

1. The sign-off of waves 13–29 is done (2026-10-27). Shipping carries the
   still-DRAFT lines of wave 22 (no sheet).
2. Check the preview's roster in its own step. Ask if anyone is on.
3. MacBook: `scripts/ops/predeploy.sh --vr`, then `scripts/ops/ship.sh <tag>`.
   Check `/api/health`, then `deploy/release.sh --check-env` on the VPS.
   Rollback is `deploy/rollback.sh` on the VPS.
4. MacBook (the old house Mac): retire what moved to the Desktop, or every
   cue fires twice. `uv run stagehand launchd uninstall --job show`,
   `--job lights` and `--job audio`, `scripts/house-macbook/install-alexa.sh
   --uninstall`, stop Mosquitto (`brew services stop mosquitto`) and the
   Zigbee2MQTT launchd agent; move the CC2652P (+ Z2M's `data/`), the MOTU
   828x and `stagehand/media/sounds/` to the Desktop.
   The MacBook keeps only Trabolta (`agents`).
5. Desktop: `git pull`, set `server.event` / `mod_passcode` in
   `stagehand/trapped.house.local.yaml`, then
   `scripts\house-desktop\start-stagehand.ps1` (checks the config, installs
   and starts the `show`, `lights` and `audio` tasks; `-NoAudio` leaves the
   router to the MacBook) **before** the sync, so no old rule posts into
   the new story. The 828x must show under ASIO first
   (`scripts/house-desktop/README.md` §3).
6. MacBook: `LOOM_SSH=loom-vps LOOM_PROJECT="trapped in the internet" pnpm
   sync-show --replace-audio --replace-maps --replace-lights [--replace-desk]`
   **with its reload, before doors**. Wave 26 changed both show maps (the
   heart, the virus disk, the *MAINFRAME* rack label), and the project's
   maps win without `--replace-maps`. First Download JSON any map edits
   saved to the project and commit them into the repo's `house.json`.
   Wave 31's `lights.json` (every bulb, the strip, the `lights_*` looks)
   reaches the project only with `--replace-lights`; Download JSON any
   looks saved to the project first. Restart every other non-ended event.
7. MacBook: `uv run stagehand launchd restart --job agents`; then Run →
   Mind → Reset (`scripts/house-macbook/trabolta.md`). Desktop: the router
   (`uv run stagehand sounds placeholders --config trapped.desktop.yaml`,
   `uv run stagehand check --config trapped.desktop.yaml --only audio`, then
   `start-stagehand.ps1 -Restart audio` after any `git pull`, so it is wave
   26's and says *Anti Virus*). Walk every speaker on the map's Audio tab
   (ASIO's channel order). **Fallback** if the 828x won't run on Windows:
   `-Stop audio` on the Desktop and `scripts/house-macbook/audio.md` on the
   MacBook; both preflights then take `--router macbook` / `-NoAudio`.
8. Desktop: Zigbee2MQTT on the CC2652P; pair every bulb under its
   `lights.json` name with `power_on_behavior: on` (`server_room_rgb`,
   `living_1`…: the table in `scripts/house-desktop/README.md` §5.4), then
   the living-room WLED strip (§6: pixel count, the brightness limiter at
   ~5500 mA, `wled/living`). `lights.json` already places every light; no
   groups, scenes or presets. Then Run → House → 🔌 Setup green, Checks
   walked, and each look ▶ Tested on the house in the 🎨 Cue designer.
9. Steph's laptop: flash the M4 (`door-m4 1.3.0`), bench with
   `scripts/accept/N-20.sh` and `N-21.sh`, then calibrate the door and
   learn the patch bay in the terminal's ⚙ (always after a reflash).
10. Reload every terminal and the TV (mandatory since wave 26: check each
    device's build stamp on Run → Terminals), set the show TV's pace to
    0.92× in its ⚙ (re-opening its link sets it), touch each tablet once, re-export and sideload the Quest
    APK, test the door open → shut → open, and reprint the cast packs after
    the sign-off.
11. Morning of the show: pause the event first, then sync, Push draft and
    Go live in place, before anyone registers. Open the doors at doors
    time (open question: 19:00 or 20:00; the story's clock reads 7:00 PM
    at the doors).

Run `pnpm showctl doctor` (and `pnpm showctl preflight <macbook|desktop|serverroom|tent> [--router desktop|macbook]`
on each machine) to see what is up. The full list is in `SHOW.html` and
`SHOWNIGHT.md` §4 (the machines in `TECH.md`).

## Where to read more

- Docs map: [`docs/README.md`](./docs/README.md).
- Language: [`docs/writing-in-loom.md`](./docs/writing-in-loom.md),
  [`docs/loom-4.md`](./docs/loom-4.md).
- History (wave diaries, the old package catalogue, planning audits):
  [`docs/history/`](./docs/history/).
