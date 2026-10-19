# Trapped in the Internet: rewrite design spec

> **The rewrite spec for this folder** (2026-10-14), kept as the design record: the name
> registry, beat-by-beat night, Trabolta's arc, endings logic, test plan, and §10 — the
> invented content and decisions awaiting the author's sign-off. The research reports it
> cites (`language.md`, `screens.md`, …) were session-only audits; their gaps live on in
> [`CHECKLIST.md`](./CHECKLIST.md). Where the story files and this spec disagree, the story
> files and their tests win.


Status: **final** architect's spec, 2026-10-14 (revision 2: every finding of the three
critiques addressed; see §11 Critique log). This is the single source of truth for the
rewrite of `core/examples/trapped-in-the-internet/`. Every writer implements from this file.
**Spell every name exactly as it appears in the registry tables (§2).** If a name you need is
not here, stop and ask; do not invent a variant.

Ground truth used: the four docs in `Trapped In The Internet story/` (STORY BEATS = the spine),
and the research reports `current-example.md`, `language.md` (obey it), `trabolta.md`,
`app-admin.md`, `screens.md`, `stagehand-hw.md`, `reinstall.md`, `qr.md`, `floorplan.md`,
`hw-research.md`. Patterns marked **[verified]** below were run against the live TS engine
for this spec (throwaway engine experiments in the authoring session, not kept: Kernel slots, nested judging fires, a parenthesised `or` in a
watcher, the `cut_the_lights` allow-list and its restore watcher).

Section map: §0 conventions · §1 files · §2 registries · §3 the night · §4 Trabolta ·
§5 endings · §6 tests · §7 needs new code · §8 print + QR appendix · §9 runbook additions ·
§10 invented content + open questions for the user · §11 critique log.

Abbreviations: SB = STORY BEATS, OV = Story Overview, CS = Character Sheet, CI = CLIPPY
INSTRUCTIONS.

---

## 0. Conventions every writer must follow

These are the rules from `language.md` that this story leans on hardest, plus decisions made
for this spec.

1. **All story-level `when …:` rules live in `main.loom`**, after the declarations and
   **before** its only beat (`== Power On`, the last thing in `main.loom`). No other file has
   top-level `when` lines. Hooks inside `CHARACTER` / `ROLE` / `TRAIT` bodies are fine in any
   file.
2. **Event names are single snake_case tokens** (`when hunt_time_up:` / `fire hunt_time_up`).
   They never contain a built-in verb word (scan, enter, arrive, exit, leave, left, join,
   defect, betray, capture, release, escape, reveal, remove, learn, share, signs, logs, and
   their tense forms), never `and` / `or` / `not` / `for` / `with` / `as` / `is` as separate
   words. (A single snake token is parsed whole, so `final_reveal`, `spin_the_bottle` and
   `ask_for_advice` are safe and fire from INTERACTIONs, `fire`, and spaced director signals
   alike **[verified]**; never split them with spaces.) The only
   spaced event names are the six kept for outside code: `go to the bathroom`,
   `back from the bathroom`, `send to the internet`, `mark as reinstalled`,
   `the simulation completed`, `the golden duck`.
3. **Private vs public.** A `Name:` line is private (that guest's `dm:Name` thread) only
   when a subject is bound as `program` (or `self` is a person: ROLE hooks and ROLE
   watchers). Prose, `Narrator:` lines, and character lines in story rules with no subject
   are **public** (the beat's `setting:` room, else the lobby). Set-piece beats are public
   and must have `setting: The Desktop` (or the relevant room). To make a public beat that
   names a person, store the name in a `Night.*` var first and fire an **unbound** event
   (`fire praise_the_top`, no `for`) whose rule diverts to the public beat **[verified]**.
4. **`reply`** in a ROLE hook / ROLE watcher / story rule with `for program` reaches the
   guest. In a CHARACTER hook or owned beat it is a **readout in that performer's booth**
   (this is how Clippy, Task Manager and Norton get private cues).
5. **Featured programs never speak, and no line may *parse as* their speech.** Any line of
   the shape `Capitalised Words: text` (1–3 words before the colon) is a dialogue line. One
   such line headed by a featured program (Microsoft Excel, OpenOffice, DraftKings, Bugdom,
   Broken Ask Jeeves, Runescape, MS Paint, VLC, Pong) — even one meant as narration, like
   `VLC: press start on the printer.` or a recap list `Microsoft Excel: Randy Barkmore Sr.` —
   flips that program to a performer booth (`core/server/identity.ts:isSpecial`), which
   breaks the whole design (§2.1) **[verified, feas f4]**. Rephrase (`Microsoft Excel is
   Randy Barkmore Sr.`) or escape with a leading `\`. No hook/beat may be owned by a featured
   program. Their private material is delivered by `Truther Download:` and `The Uploader:`
   lines and by `unlock` from ROLE hooks gated on `program.featured`. Identity test §6.2 is
   the regression guard.
6. **ROLE fan-out watchers always include `self.cleared`** (or a stronger guard), so a late
   arrival standing in the Optical Drive cutscene never receives Act-level messages, and receives
   them the moment an Antivirus clears them **[verified]**.
7. **Null-safe guards.** Globals start `null`. Write `Night.x == true` / `Night.x != true`,
   `Night.n < 1`, `>=`; never `Night.n == 0` and never `Night.mode == "none"` for a global
   that might not be seeded. `Power On` seeds the globals in §2.6, but tests and Run-mode
   rehearsals may skip it.
8. **Declaration names:** no apostrophes, no dots, no ` is `, no ` with ` / ` as `; every
   word Capitalised for anything used in a trigger filter (LOCATION, GROUP, CODEX). Put the
   pretty form (apostrophes, dots) in `title:` / `label:`.
9. **`LOCATION` lines have no trailing comment** (`house/test/show.test.ts` reads
   `^LOCATION (.+)$`). All LOCATIONs are declared in `main.loom`; `The Desktop` first.
10. **Cues:** `cue <token>` (one token) for light and screen looks, `sound <token>` for audio,
    `do announce "…"` for the house announcements (stagehand's `alexa` module on the house
    Mac is the speaker; no assistant is named in the fiction, U4), `do door server_room,
    state: locked` for the
    door indicator (target `server_room`; sent at Power On only since wave 7 — the real door
    has a standalone keypad lock nothing drives; the comma form `do door, room: …` reaches
    stagehand with an empty target). Every look is mirrored into a var on the next line
    (`set Night.lights = "…"`, `set Night.screen = "…"` for the TV, `set Night.terminals =
    "…"` for the wall terminals) so a director can see/set it in Run → World. Never `cue x,
    k: v` (prose) and never `cue x with k: v` (stagehand mis-parses it). The one long form is
    `<cue: lights, room: {room}, state: off|on>`.
11. **Divert last.** A divert is a call; lines after it still run. Put `-> X` last, or
    inside `if/else`. `-> END`, tunnels and `return` are inert. Divert params are ignored.
12. **Choices:** `*` once-only is not enforced, so guard re-entry with flags. A choice
    suspends; its menu goes to the bound subject.
13. **Timers:** deadlines are `set Night.x_end = Time.elapsed + N` plus a story-rule watcher
    `when Night.x_on == true and Time.elapsed >= Night.x_end:`. No ROLE timers, no `wait`,
    no in-body `after`. Units `s`/`m`, never `h`. **Every deadline watcher keeps its phase
    guard**: null arithmetic is 0, so `Time.elapsed >= Night.y2k_end - 1800` alone is true at
    boot **[verified, feas f3]**. One-shot "at" watchers use `Night.x_at > 0 and
    Time.elapsed >= Night.x_at` and reset `x_at` to 0 in their body.
14. **Never move anyone to a bound place.** `move program to {at}` is BROKEN (a room
    literally called `{at}`), and `move program to at` works **only** when `at` is an exact
    entity id; a quoted or inexact string binds as a value (`event#N.at`) and moves the guest
    into a phantom room **[verified, feas f2]**. Check-in (and anything else hardware, QR or a
    director can send) uses an if-chain over the real LOCATIONs (§3 D1). When firing with an
    entity arg, write it bare: `fire checked_in for program with at: The Desktop` — never
    `at: "The Desktop"`.
15. **Scripted Trabolta lines** are allowed only from `introduce_trabolta` onward. Before it
    no beat, hook, or rule may contain a `Trabolta:` line.
16. **No `group(X)` / `faction(X)` broadcasts to staff.** Membership holds persons only, so
    `broadcast … to group(Antivirus)` reaches no booth **[verified, feas f2]**. Staff cues are
    `reply` readouts from `TRAIT Enforcer` / `TRAIT Host` / CHARACTER hooks on a named event
    (e.g. `fire program_late for self` → every Enforcer's `when program_late for program:
    reply …`). Note: every performer booth also sees every broadcast unnotified in
    `# system-log` (incl. Trabolta's private pop-ups); that is accepted as staff visibility.
17. **Party-wide scopes.** `start quest X for everyone` reaches only the persons who exist at
    that moment, so every party-wide quest also has a ROLE catch-up watcher (§2.7)
    **[verified, feas f3]**. `unlock X for group(G)` / `reveal X for group(G)` fail their
    shape and **leak as public narration of the literal text**; `unlock X for everyone`
    silently does nothing. Party-wide unlocks are always per-member ROLE watchers (`unlock X
    for self`). (`start quest X for group(G)` is fine.)
18. **`{self.name}` inside a CHARACTER hook or owned beat prints `null`** (characters have no
    `.name`). Use `{self}` or the literal name there. In ROLE hooks/watchers `{self.name}` is
    the guest's name and works **[verified, feas f3/f6]**.
19. **Agent power hooks** that use `target` open with `if target.name == null:` → `Trabolta: I
    cannot find that program.` (a director firing with a name, or a missing arg, otherwise
    writes `event#N.target.*`) **[verified, feas f6]**. `room` args are checked against an
    allow-list (§4.3). Arg names go in the INTERACTION `description:` (there is no `args:`).
20. **The six kept spaced event names are always written with `for program` in triggers**
    (`when mark as reinstalled for program:`): without a filler word `when mark as
    reinstalled:` parses as event `mark` **[verified, feas f1]**.
21. **Secrets never live in `Night.*`.** Stagehand's orchestrator sees every global. Anything
    Trabolta must not know (combos, lies, the majority, the virus planter, the dossier, the
    per-question verdict record) is a typed slot on the hidden `CHARACTER Kernel` (§2.6.2):
    character vars are excluded from every agent request **[verified, x1 + dependencies
    critique §4]**.
22. **Performer hooks guard their phase — except `send to the internet` and `mark as
    reinstalled`**, which must work on any program at any time (spatial.test fires `send to
    the internet` as Norton on a fresh, un-uploaded persona before `Power On`).
23. **Admin cues are fired from the cue sheet (Run → Director, K-21) / quick-fire, never from a performer's guest
    card**: a press from a guest card carries `actor` = that character and `subject` = that
    guest, so only that character's hooks hear it **[verified, feas f3]**. The README cue
    sheet says so.
24. **Never declare** `Grok`, a named house assistant or `Jean Trabolta` as CHARACTERs (they would become
    guest-pickable and trigger a wiki lookup). Write `add program to Unlimited Power`, never
    `add Microsoft Excel to …` (that names the CHARACTER entity, not the guest).
25. Validate every file set with
    `pnpm --filter @loom/core loomcheck examples/trapped-in-the-internet --smoke`
    (`core/scripts/loomcheck.ts`; 0 errors required).

---

## 1. File layout

The directory name, `main.loom`, `house.json`, `trabolta.persona.md`, `trabolta.mind.md`
and `beats/login.loom` keep their paths (server, stagehand, editor e2e and help docs read
them). Delete `beats/glitch.loom`, `beats/endings.loom`, `cast/programs.loom`,
`codex/programs.loom`. `core/scripts/sync-example.ts` deletes removed files from a synced
project automatically.

Concatenation order (server): `main.loom`, then path order:
`atmosphere.loom`, `beats/desktop.loom`, `beats/finale.loom`, `beats/hunt.loom`,
`beats/internet.loom`, `beats/login.loom`, `beats/malware.loom`, `beats/overshare.loom`,
`beats/pong.loom`, `beats/server-room.loom`, `cast/antivirus.loom`, `cast/featured.loom`,
`cast/hosts.loom`, `cast/kit.loom`, `cast/pool.loom`, `cast/props.loom`, `cast/staff.loom`,
`cast/trabolta.loom`, `codex/1-world.loom`, `codex/2-files.loom`,
`codex/4-trabolta.loom`, `codex/5-people.loom`, `codex/6-missions.loom`,
`codex/7-clippy.loom`, `codex/8-jeeves.loom`, `codex/9-facts.loom` (generated),
`generated/questions.loom` (generated), `quests.loom`, `rooms.loom`. (`codex/3-hunt.loom` is
gone since wave 4: the hunt questions and answers come from `facts.json` via `titi:facts`.) No file other than
`main.loom` has top-level `when` rules, so the order is otherwise free — **except the codex
numbering, which is load-bearing**: stagehand's orchestrator feeds up to 60 codex entries to
Trabolta as "ground truth" (`orchestrator.py` `lore_block(max_entries=60)`): the ones he holds
first, then the rest in model order, so the environmental entries must come first and the
scrambled Jeeves fragments last. (The hunt answers never reach it: every hunt-answer entry
and The Rival are `secret: true`, so the server's facts document never carries them, and the
worker's secrecy filter drops every `▒ HUNT ANSWER` entry and any unheld clue that names an
answer word. Since 2026-10-19 no entry he holds names an answer either — Trabolta must never
know what he asks for; `core/test/trabolta-answers.test.ts` scans his requests, the facts
document and his prompt files for every answer and alias.)
No test reads the codex paths.

| File | Holds | Writer |
|---|---|---|
| `main.loom` | Header; all GROUPs; all LOCATIONs (Desktop first); `ROLE Program` (vars + every ROLE hook/watcher in §2.7); every INTERACTION except Trabolta's agent powers; **every story rule** (§2.8); then `== Power On` as the last item. | A (spine) |
| `atmosphere.loom` | 3 GENERATORs (ambient barks): `ScreensaverHum` (4m), `DialUp` (7m, "From the RAM"), `SystemTray` (9m, incl. "Your protection has expired."). Keep the current text, minus anything that names Trabolta (he is offline at minute 0; generators run from minute 0). | A |
| `beats/login.loom` | Arrival: `Login`, `Login Incorrect`, `Upload`, `Orientation`, `Re-upload`, `Featured Briefing`. | B |
| `beats/desktop.loom` | Act I: `Call To The Desktop`, `Computer Bingo`, `Bingo Time`, `Corrupted Code`, `Trabolta Introduction`, `The Screensaver`; the optional set pieces `Telephone` and `Are You Sure` (§3 B10). | B |
| `beats/internet.loom` | `Reinstallation`, `The Tablet Video`, `Zipped`. | B |
| `beats/hunt.loom` | `Truth Scavenger Hunt One`, `Hunt Time Up`, `First Moment Of Truth`, `Truth Or Dare`. | B |
| `beats/malware.loom` | `Ad Hijack`, `Second Hunt`, `Truther Download Arrives`, `Excel Glitch`, `OpenOffice Glitch`, `DraftKings Glitch`, `Bugdom Glitch`, `Jeeves Glitch`, `Runescape Glitch`, `MS Paint Glitch`, `VLC Glitch`, `Pong Glitch`, `Program Glitch`. | C |
| `beats/pong.loom` | Act II: `Five Minute Warning`, `Summons Closed`, `Truth Pong`, `Round Two Tally`, `Trust Chart`, `Praise The Top`, `Shame The Bottom`, `Print The Certificate`, `The Printer Jams`, `Full Of Beans`, `Zip Everyone Out`. | C |
| `beats/overshare.loom` | `Overshare One`, `Overshare Two`, `Overshare Three`, `Overshare Four`, `The Y2K Clock`, `Excel Final Round`, `OpenOffice Final Round`, `Program Final Round`, `Clock Strikes`. | C |
| `beats/server-room.loom` | Act III: `Majority Reached`, `The Whole Truth`, `Server Room Alarm`, `Patch Rejected`, `Trabolta Disabled`, `Trabolta Recounts`, `Computer Destroyed`, `Purgatory`. | D |
| `beats/finale.loom` | `Final Reveal`, `Bobbing For Truth`, `The Bag Of Truth`, `Final Assessment`, `Truth Txt`, `The Verdict`, `Song Ending`, `Grok Prom`, `Pickup Line`, `Sad Confession`, `Relationship Advice`, `Advice Helped`, `Advice Thwarted`, `The Hand Jive`. | D |
| `cast/kit.loom` | TRAITs `Prop(beat)`, `Person`, `Host is Person`, `Enforcer is Person` (owned `beat Clearance(program)`; scan routing; `send to the internet`, `mark as reinstalled`, `accuse`). | B |
| `cast/hosts.loom` | `Clippy`, `Task Manager`, `Adobe Acrobat`, `Recycling Bin` (all `is Host`) with booth readouts. | B |
| `cast/antivirus.loom` | `Norton Anti-Virus`, `McAfee Anti-Virus`, `Password Manager`, `CRA Agent Software` (all `is Enforcer`). | B |
| `cast/staff.loom` | `Installation Wizard` (Julia Tufts's **voice**, `playable: false`, no booth — the tent tablet script, wave 4 U8), `Sandy` (playable: false), `Truther Download` (playable: false). | B |
| `cast/featured.loom` | The 9 featured programs: **bare** CHARACTERs, `avatar:` (+ `wiki:`) only. Nothing else. | A |
| `cast/pool.loom` | 22 bare pool programs with `avatar:` (+ `wiki:`) — one kitchen-named pool program was deleted in wave 4 (decision 17: the Start Bar is only the kitchen). | A |
| `cast/props.loom` | `The Uploader`, `The Router`, `The Screensaver`, `The Tablet` (each `is Prop(...)`), and `CHARACTER Kernel` (`playable: false`, the secret slots of §2.6.2; no hooks, no lines). | B |
| `cast/trabolta.loom` | `CHARACTER Trabolta` (vars, hooks), his 11 agent-power INTERACTIONs and their hooks. | E |
| `codex/1-world.loom` … `codex/8-jeeves.loom` | All CODEX entries per §2.12, one file per table, in that numbered order. | F (world, files, hunt, trabolta), G (people, missions, clippy), H (jeeves) |
| `quests.loom` | 22 QUESTs: 15 for the programs + 7 staff quests (§2.10); with the 3 generated hunt QUESTs in `generated/questions.loom`, **25** in all. No rules. | A |
| `rooms.loom` | SPACE / CHANNELs (§2.5). | A |
| `trabolta.persona.md` / `trabolta.mind.md` | §4.6. | E |
| `house.json` | Change exactly one value: room `bathroom` `"location": "The Recycle Bin"` → `"Disk Cleanup"`. Then `pnpm house:sync`. No geometry change. | A |
| `README.md` | Rewrite runbook + cue sheet + integration contract (keep the contract's mod-API/QR/reinstall/terminal facts; update names) + §8 print appendix + §9 runbook additions. | A (last) |
| `stagehand/trapped.house.yaml` (new, outside the example dir) | The show's real house config: lights per LOCATION, scenes, screens flicker, sfx, announce, door, sensors (§2.15). **Do not edit `show.example.yaml`** (`test_config.py:31-40` pins it). | E |
| `stagehand/tests/test_trapped_house.py` (new) | `load_config` on the YAML + the cross-checks of §2.15. | E |

### 1.1 house.json room → LOCATION mapping (the real house, 2026-10-15)

The house has three levels plus the tent. The story's places follow the user's floor plan
(wave 3); the old names map over: The Mud Room → **The Optical Drive**, The Cache → **The
Start Bar**, The Registry → **The RAM** (the ephemeral `# ram` channel became `# clipboard`
so the names never collide).

| house.json room id | Label | Floor | `location` (must be declared in main.loom) |
|---|---|---|---|
| `optical-drive` | Optical Drive (mud room) | main | The Optical Drive (the login cutscene; the front door opens into it) |
| `hall` | Hall | main | The Tube (the basement stairs + the upstairs, side by side) |
| `steam-room` | Steam Room (game room) | main | The Steam Room |
| `start-bar` | Start Bar (kitchen) | main | The Start Bar |
| `cpu` | CPU (office) | main | The CPU |
| `desktop` | Desktop (living room) | main | The Desktop (the TV above the fireplace) |
| `backyard` | Backyard | main, outdoor | The Cloud (the Truth Pong folding table is out here, per OV "outside") |
| `tent` | The Tent | main (in the backyard, #23) | The Internet |
| `basement-hall` | Basement hall | basement | The Tube |
| `bathroom-1` | Bathroom 1 | basement | **Disk Cleanup** (was The Recycle Bin; renamed so it can't be confused with the host Recycling Bin, who is "responsible for hygiene and maintenance") |
| `fan-closet` | Fan Closet (laundry) | basement | The Fan Closet |
| `server-room` | Server Room (cold storage) | basement (off the basement hall) | The Server Room |
| `ram` | RAM (studio) | basement | The RAM |
| `upstairs-hall` | Upstairs hall | top | The Tube |
| `hard-drive` | Hard Drive (crawl space) | top | The Hard Drive |
| `bathroom-2` | Bathroom 2 | top | **Disk Cleanup** |
| `graphics-card` | Graphics Card (bedroom 2) | top | The Graphics Card |

The map is still a **placeholder** (footprints and elevations guessed until the survey,
SW-MAP-02 / K-28: basement −2.7, main 0, top +2.8), but its structure matches the house and the
story: the tent is an indoor room in a notched backyard, the Server Room has its one door, patch
bay and (wave 7) the `server-room` terminal spot on its south wall inside, the keypad + lock
ring outside (wave 11: the chess-phone prop is gone and the **`server-room-door`** terminal spot, "Server Door", stands in the basement hall facing the door: the King's chess board), no duck; twelve duck spots cover every floor and the yard.
The rain variant `house.shed.json` (SW-MAP-13) binds The Internet to room `shed` at the back of
the yard instead; `core/test/show-house.test.ts` checks both.

---

## 2. Name registry

### 2.1 Featured programs are guest programs (the structural rule)

The nine featured programs are **guests with pre-written characters**. They must be
`pool`-classified so they can be captured, redeem codes, hold quests, answer choices, join
factions and count toward majorities. Therefore:

- `cast/featured.loom` declares each as a bare `CHARACTER Name` with only `avatar:` and
  optionally `wiki:`. No `listed`, no `faction`, no hooks, no beats, no dialogue lines
  anywhere in the story (§0 rule 5).
- On `when someone joins:` the ROLE tags the person: `if program.name == "Microsoft Excel":
  set program.featured = "excel"` etc. (exact strings below). **Every later check uses
  `program.featured` / `self.featured`**, never the name again. **[verified]** that
  `program.name` is the registered name and that ROLE watchers gated on it fire per person,
  dock choices, and bind `program`.
- The picker sends the declared spelling, so the exact-string compare holds for picker
  sign-ins. A guest who *types* "microsoft excel" would register lowercase and miss the
  tag. That, and reserving each featured program for its invitee, are **needs-new-code**
  items (§7: featured-program claim codes + canonical names).
- **Wave 11: reserved.** Each featured CHARACTER carries `reserved: true` (not a part: it
  stays a guest's program). The picker and the directory search show it, and its `wiki:`
  article, 🔒 Reserved to anyone without its invitation's claim (`?code=<guest code>&claim=<token>`,
  Run → Print sheet → Invitations; a token per program, stable across End → relaunch), and
  register answers 409 `reserved`. A lost invitation: the director's 🔓 opens one program to
  anyone for two minutes (`POST /api/mod/claim/unlock`). The claim stays in the browser that
  joined, so a cut session rejoins with it.

| CHARACTER (exact) | `featured` tag | Invitee (actor) | Human identity (secret until the end) | Avatar |
|---|---|---|---|---|
| Microsoft Excel | `excel` | Rob Cameron | Randy Barkmore Sr., 90, former Mayor of Halifax | `File:Microsoft Office Excel (2013–2019).svg \| File:Office Excel 2007 logo.svg` |
| OpenOffice | `openoffice` | Lara Lewis | Dana Anderson, ex-FBI agent turned hacker | `File:OOo3.2.1Icon.png` (wiki: Apache OpenOffice) |
| DraftKings | `draftkings` | Hannah | the gambler who won (most of) Atlantic Canada's casinos | `File:DraftKings logo.svg` |
| Bugdom | `bugdom` | Veronica | the pet-store worker whose Bugdom VR assets died in fire ants | `File:Bugdom.jpg` |
| Broken Ask Jeeves | `jeeves` | Kai | the Annapolis Valley youth librarian; botched DSL upload | `File:Jeeves-in-2009.jpg \| File:Ask.com Logo.svg` (wiki: Ask.com) |
| Runescape | `runescape` | Laurel | 34, 24-year player, Wharton economics PhD, gold-standard libertarian | `File:Runescape 3 Logo.png` (wiki: RuneScape) |
| MS Paint | `mspaint` | Cat Frawley | four schools in rotation (NSCAD / Yale / The New School / the Beaux-Arts), three refused theses, never expelled; refuses every algorithm (her invitation is canon, wave 6 decision 11) | `File:Microsoft Paint.svg` (wiki: Microsoft Paint) |
| VLC | `vlc` | Zeus | Victor Louis Christianson, failed looksmaxxing influencer | `File:VLC Icon.svg` (wiki: VLC media player) |
| Pong | `pong` | Em | child of William Higinbotham (Tennis for Two) | `File:Pong.png` (wiki: Pong) |

Real actor names (Rob Cameron, Lara Lewis, …) **never appear in the story**. (The current
example's codex entries `Rob Cameron` and `Lara Lewis` are dropped: those are the guests'
real names, not cover identities.)

**MS Paint is the designated anti-AI program for Computer Bingo** (`Kernel.anti_ai =
"MS Paint"` seeded in Power On; a director may change it in Run → World before Bingo). It
fits CS: "any program that relies on algorithms is a betrayal of the artist", and OV: everyone
has been told to say yes "except for one person". **This choice needs the user's sign-off
(§10)**, and Cat's character sheet must carry the prompt. The Terms Of Service "You agree"
reaches MS Paint too; her Centre Square entry resolves the conflict explicitly ("The
Uploader said you agreed. You didn't mean it.").

### 2.2 Every CHARACTER

Traits: `Person` = `listed: true`. `Host is Person` (faction Hosts). `Enforcer is Person`
(faction Antivirus). `Prop(beat)` = `playable: false` + scan routing.

**Performer parts** (special; one booth each):

| CHARACTER | Decl | Actor | Avatar (keep exact) | Role in the night |
|---|---|---|---|---|
| Clippy | `is Host` | Brooke | `File:Windows 11 Clippy paperclip emoji.png \| File:Clippy-letter.PNG` | MC. Receives every `Clippy Instructions N` entry + booth readouts. Presses Bingo / judging buttons. |
| Task Manager | `is Host` | John | `File:Windows 11 TASKMGR.png \| File:Windows Task Manager screenshot.png` (wiki: Task Manager (Windows)) | "Keeps things running." Produces the fake Bingo card. Runs the Truthcoin bank buttons. |
| Adobe Acrobat | `is Host` | Stephanie | `File:Adobe Acrobat DC logo 2020.svg \| File:Adobe Reader XI icon.png` | "Documents and printing." Holds the Bag of Truth / truth.txt printout; stands by the printer. |
| Recycling Bin | `is Host` | Jesse | `File:User-trash-full.svg` (wiki: Trash (computing)) | "Hygiene and maintenance." Disk Cleanup (bathroom) attendant; knows Bathroom Mode. |
| Norton Anti-Virus | `is Enforcer` | Julie | `File:Norton-logo-2021.svg` (wiki: Norton AntiVirus) | The **selected Antivirus** who interrupts the Bingo celebration. Door scans. |
| McAfee Anti-Virus | `is Enforcer` | TBD | `File:McAfee logo.svg` (wiki: McAfee Antivirus) | Door scans; **broker of the `# truthcoin-exchange`** and referee of bets (wave 9, D1: he has no Wallet, holds no pot and takes no cut; a bet settles player to player, the winner's 🙏 Request paid by the loser; 🪙 pay/charge are corrections; CS: he wants to "exploit the exchange of information and become rich"); `every 20m` "Your protection has expired" pop-up gag (character timer, allowed). |
| Password Manager | `is Enforcer` | Francine | `File:1password-logo.svg` (wiki: 1Password) | Door scans; reacts to `wrong code` (codex misses); **keeper of the clubs** (CS: "manage… who gets to be part of what clubs"): booth readouts on every faction join (§3 D10) and she owns the `# hidden-partition` / `# back-channel` invites. Yu-gi-oh! everywhere. |
| Windows Defender | `is Enforcer` | [[EDIT: who]] | `File:Microsoft Defender Icon Logo 2025 English.svg` (wiki: Microsoft Defender Antivirus) | Wave 11: **the door, for late arrivals**: a part with no lines of its own (no hooks; the Enforcer trait's door scan clears a program exactly as the other four do), so the Optical Drive is never left without a scanner once the others are busy. Its booth never shows the patch-bay fallbacks 🔌 💥 ❌ 🚪 🔧 (they are `by:` the four room Antivirus, §2.9; the server refuses a press from it), but ♟ *They beat the machine* still shows there. |
| CRA Agent Software | `is Enforcer` | Emma | `File:Canada Revenue Agency logo.svg` (wiki: Canada Revenue Agency) | Replaces MalwareBytes. Door scans; audits Truthcoin (presses 🪙 charge). |

**Agent:** `Trabolta` (`is Person`, `mind: external`, `hidden: true`, avatar
`File:HAL9000.svg`). Never a guest or performer. Wave 11: `busy: Jean Trabolta is answering other
programs. Your message is in the queue. Please do not move the mouse.` — the server says it once
per thread when a message has waited 40 s behind other programs' on an online worker (`hold:` is
still the line when no worker is online, or a stalled one).

**Voices (playable: false, never on a picker):**

| CHARACTER | Notes |
|---|---|
| Installation Wizard | Julia Tufts's part, as a **voice** (wave 4, U8; no booth, never on a picker): narrates `Reinstallation` in the captured program's own `dm:Installation Wizard` thread and `The Tablet Video` — the tent tablet's script (P-1). Julia runs the tent in the backyard, through the tunnel, with the tablet's mod token; a release by hand is an Antivirus's `mark as reinstalled` or the director's. |
| Sandy | Only ever says, verbatim: `I'm sorry, I didn't understand that. Would you like to speak to a live agent?` Appears in finale beats (public). |
| Truther Download | The anonymous sender of the Truther Download and every per-character glitch prompt. Its lines land in each program's own `dm:Truther Download` thread. |
| The Uploader | `is Prop(Re-upload)`. The Optical Drive voice. |
| The Router | `is Prop(The Router)`. Kitchen router station (identity test refuses it at registration). |
| The Screensaver | `is Prop(The Screensaver)`. The TV over the fireplace. |
| The Tablet | `is Prop(The Tablet Video)`. The tent tablet station; its beat is spoken by `Installation Wizard:`. |
| Kernel | `playable: false`, no trait, no hooks, no lines, no avatar. Holds the secret state (§2.6.2) so it never reaches Trabolta's worker. Not in the directory. |

The house announcements are the **house system's own voice**, not a CHARACTER (U4): every
announcement is a `broadcast "!🔊 …" to everyone` plus `do announce "…"` (+ `sound
announce_chime`). Never name the house or give it speaker lines.
Grok is offstage lore (codex only); never write `Grok:` lines. Neither is declared (§0
rule 24).

**Featured programs:** the 9 in §2.1 (bare).

**Pool programs** (`cast/pool.loom`, bare, avatar required — keep these exact avatars):

| CHARACTER | avatar | wiki |
|---|---|---|
| Calculator | `File:Windows 11 Windows Calculator.svg` | Windows Calculator |
| Ring Doorbell | `File:Ring-Logo.svg` | Ring (company) |
| WinZip | `File:WinZip icon.png` | |
| GarageBand | `File:GarageBand App.png` | |
| LimeWire | `File:LimeWire.png` | |
| MSN Messenger | `File:Windows Live Messenger icon.png \| File:MSN Messenger logo.png` | |
| 3D Pinball | `File:Full Tilt! Pinball coverart.png` | Full Tilt! Pinball |
| RollerCoaster Tycoon | `File:Rollercoaster Tycoon logo.png` | |
| Zoo Tycoon | `File:ZooTycoon logo.png` | |
| Minesweeper | `File:MINESWEEPER SMILEY.png \| File:Minesweeper in Windows 98 Expert Level.png` | Microsoft Minesweeper |
| Trojan Horse | `File:The Procession of the Trojan Horse in Troy by Giovanni Domenico Tiepolo.jpg` | Trojan Horse (the two accordion clowns' costume: **one program, one phone**; the second clown shares it — see §7 #1) |
| Ctrl Alt Del | `File:Win98 Close Program Dialog.PNG \| File:Three-finger salute.svg` | Control-Alt-Delete |
| Solitaire | `File:Solitaire Icon (Vista).png` | Microsoft Solitaire |
| Winamp | `File:Winamp media player logomark.png \| File:Winamp Logo.svg` | |
| Napster | `File:Napster logo.svg` | |
| Encarta | `File:Encarta logo.svg` | |
| Netscape Navigator | `File:Netscape icon.svg` | |
| ICQ | `File:Logo ICQ.svg` | |
| The Sims | `File:The Sims series logo.svg` | |
| Notepad | `File:Notepad Win11.svg` | Windows Notepad |
| Paint Shop Pro | `File:Corel Paint Shop Pro Photo X2.png` | PaintShop Pro |
| RealPlayer | `File:Realplayer computer icon.png` | |

That is 22 pool + 9 featured = **31 guest identities** (identity test needs > 20). New
avatars `File:Canada Revenue Agency logo.svg`, `File:Pong.png` and the
Tiepolo Trojan Horse file were checked to exist on Commons for this spec.

**Dropped characters:** the named house assistant (host; the house announces, nobody speaks for it), the wellness-bot performer of waves 1–3 (wave 4, U8: the tent is the Installation Wizard's voice, Julia's), the kitchen-named pool program (wave 4, decision 17: the Start Bar is only the kitchen), MalwareBytes, The Modem, The Encyclopaedias (prop),
"Jean Trabolta" as a separate character (he is `Trabolta`; "Jean Trabolta" is the name on
the invitation and in codex).

### 2.3 GROUPs

| GROUP | Properties | Members |
|---|---|---|
| Hosts | `ethos: hospitality`, `joinable: false` | Clippy, Task Manager, Adobe Acrobat, Recycling Bin (via trait) |
| Antivirus | `ethos: compliance`, `joinable: false` | the four Enforcers |
| Unlimited Power | `ethos: stay in this machine forever`, `rival: The Way Out`, `hidden: true` (joinable by default) | Excel's "stay forever / unlimited power and joy" faction. Microsoft Excel is added at the Truther Download. Revealed party-wide at `y2k_clock`; from then on guests join it from the app's side chooser. |
| The Way Out | `ethos: overthrow Trabolta and escape`, `rival: Unlimited Power`, `hidden: true` | OpenOffice's "get out of the computer" faction. OpenOffice added at the Truther Download. Revealed at `y2k_clock`. |

"Pursue your own interests" = join neither. Revealed + joinable groups become the app's
sides (`GuestView.factions`), joining fires `join` (`when program joins The Way Out:`), and
`defect` switches sides **[verified]** — zero new code. (Security gap: the join route does
not refuse hidden groups; §7.)

### 2.4 LOCATIONs (in this order, in main.loom)

| # | LOCATION | label | flags | Notes |
|---|---|---|---|---|
| 1 | The Desktop | `The Desktop (living room)` | `ambient: screensaver-hum`, `capacity: 60` | Must stay first: `release` lands here. TV above the fireplace. |
| 2 | The Optical Drive | `The Optical Drive (mud room) — Login` | `ambient: pitch-black`, `cutscene: true` | Arrival on rails (was The Mud Room). |
| 3 | The Tube | `The Tube (hall + stairs)` | `ambient: cable-rattle`, `hidden: true` | The hall and its two stairs on every floor: the tunnel of lights. |
| 4 | The Internet | `The Internet (Reinstallation — backyard)` | `prison: true`, `sealed: true`, `hidden: true`, `capacity: 3` | The tent in the backyard, reached through the tunnel (decision 18). The only prison. |
| 5 | The Start Bar | `The Start Bar (kitchen)` | `ambient: fridge-hum`, `hidden: true` | Was The Cache. The Router lives here. |
| 6 | The CPU | `The CPU (office)` | `ambient: processor-whine`, `hidden: true` | Main floor. The theory binder + filing box (APPENDIX-Z, PAGE-999, CARNEY-OFFER). |
| 7 | The Steam Room | `The Steam Room (game room)` | `ambient: startup-chimes`, `hidden: true` | Main floor (bedroom / game room). TENNIS-FOR-TWO. |
| 8 | Disk Cleanup | `Disk Cleanup (bathrooms)` | `ambient: dripping-tap`, `hidden: true` | Recycling Bin's domain: Bathroom 1 (basement) and Bathroom 2 (top). |
| 9 | The Cloud | `The Cloud (backyard — Truth Pong)` | `hidden: true` | |
| 10 | The RAM | `The RAM (studio)` | `ambient: dial-tone`, `hidden: true` | Was The Registry. The pet-cemetery codes. |
| 11 | The Fan Closet | `The Fan Closet (laundry)` | `ambient: dryer-tumble`, `hidden: true` | FBI-HALIFAX (a coat pocket). |
| 12 | The Graphics Card | `The Graphics Card (bedroom 2)` | `ambient: coil-whine`, `hidden: true` | NSCAD-LETTER (the sketchbook). |
| 13 | The Hard Drive | `The Hard Drive (crawl space)` | `ambient: platter-spin`, `hidden: true` | TRABOLTA-4EVER, hidden. |
| 14 | The Server Room | `The Server Room (cold storage)` | `hidden: true`, `checkin: false` | Trabolta's heart (the video patch bay). Keypad lock (standalone, wave 7); the patch bay is alarmed, the door is not. Off the basement hall. |

Reveal policy: house rooms 5–13 are revealed **per program** in `Clearance` (`reveal The Start Bar
for program`, etc.; the chat folds them into one "📂 … are open now." notice); The Internet appears once stood in; The Server Room is revealed for each
member of the majority faction (`reveal The Server Room for self`) and for everyone when its
door first opens once Trabolta is awake (The Heart; wave 7 said from the Y2K hour, wave 11 from the introduction, D1) or its patch-bay alarm first trips.

### 2.5 SPACE / CHANNELs (`rooms.loom`)

```
SPACE The Operating System          label: The Operating System
  CHANNEL system log                kind: open, type: announcement, label: # system-log
  CHANNEL general                   kind: open, label: # general
  CHANNEL task manager              kind: open, label: # task-manager, slow: 5s, hidden: true   (revealed at call_to_the_desktop)
  CHANNEL clipboard                       kind: open, label: # clipboard, slow: 3s, ephemeral: 45s, hidden: true   (revealed at start_the_second_hunt)
  CHANNEL truthcoin exchange        kind: open, label: # truthcoin-exchange, slow: 3s, hidden: true   (revealed at truther_download)
CHANNEL hosts            space: The Operating System, kind: faction, faction: Hosts, label: # hosts
CHANNEL quarantine       space: The Operating System, kind: faction, faction: Antivirus, label: # quarantine
CHANNEL unlimited power  space: The Operating System, kind: faction, faction: Unlimited Power, label: # unlimited-power
CHANNEL the way out      space: The Operating System, kind: faction, faction: The Way Out, label: # the-way-out
CHANNEL hidden partition space: The Operating System, kind: private, invite: members, label: # hidden-partition
CHANNEL back channel     space: The Operating System, kind: private, invite: members, label: # back-channel
```
(Write them in the block form shown in `language.md` §5.9, one property per line.) The
pinned `codex` and `quests` rooms are automatic.

`# hosts` and `# quarantine` are **staff back-rooms, not private between factions**: every
performer booth sees and can post in every authored channel (`visibleToPrime`, prime
snapshots force `canPost`), and no guest can (faction membership is persons only). Label
them that way in the README; never put a secret meant for one faction there.
`# unlimited-power` / `# the-way-out` are the guest factions' rooms (members only).

### 2.6 World variables

**`Night.*` globals** — seeded in `Power On` where a default is given. "Shown" = in
Trabolta's persona `facts:` whitelist (he sees it).

| Var | Type / default | Meaning | Shown |
|---|---|---|---|
| Night.phase | string `"arrivals"` | phase name (§2.6.1); Trabolta's mind keys on it | yes |
| Night.step | number `0` | phase ordinal for `>=` guards | yes |
| Night.screen | string `"screensaver"` | the living-room TV's look (mirror of the last `cue screens_*` / `cue tv_*`) | |
| Night.terminals | string `"screensaver"` | the wall terminals' look (mirror of the last `cue screens_*` / `cue terminals_*`) | |
| Night.lights | string `"screensaver"` | current house light look (mirror of the last `cue lights_*` scene; never the clearance's `lights_tube_chase`, a Tube-strip overlay — the 90 s cut restore and stagehand's catch-up both read it) | |
| Night.clock | string `"--:--"` | the show clock text after the Y2K reset (`"23:00"`, `"23:30"`, …) | yes |
| Night.bingo_on / Night.bingo_end | bool false / number | 20-min Bingo deadline | |
| Night.bingo_winners | number 0 | Bingo winners declared | |
| Night.first_reinstall | string `"none"` | name of the program sent to the Internet at Bingo | |
| Night.trabolta_introduced | bool false | set by `introduce_trabolta` | |
| Night.round | number 0 | current Moment-of-Truth round: 1, 2, 3 (final) | |
| Night.judging | bool false | judging buttons are live | |
| Night.hunt_on / Night.hunt_end / Night.hunt_warn | bool / number / number | hunt-1 15-min deadline (+ 5-min warning at 10 min) | |
| Night.hunt2_on / Night.hunt2_end | bool / number | the 1-hour dispersal | |
| Night.truther_at / Night.truther_sent | number / bool false | Truther Download at dispersal + 120 s | |
| Night.warn_at | number | dispersal end − 300 s: the five-minute warning | |
| Night.summons_open / Night.summons_end / Night.summons_closed | bool false / number / bool false | the 5-minute summons window | |
| Night.auto_sweep | bool false | if a director sets it true, late programs are captured automatically | |
| Night.facts_requested | number 0 | facts Trabolta has asked for (3 + 3 + 2 = 8 by the end) | yes |
| Night.facts_accepted | number 0 | accepted answers (accurate + confident lies; he cannot tell them apart) | yes |
| Night.r1_accepted / Night.r2_accepted / Night.r3_accepted | number 0 | accepted answers per round | |
| Night.r2_requested | number 3 | round-2 questions (display only; the collection is judged per question on `Kernel.q4`–`q6`) | |
| Night.collection_complete | bool false | round 2: every round-2 question (H4–H6) has an accepted answer | |
| Night.ranking / Night.rank_round / Night.praised / Night.shamed | bool / number / bool / bool | the ranking machinery (§3, Trust Chart) | |
| Night.most_trusted / Night.least_trusted | string `"none"` | latest ranking names | yes |
| Night.printer_called / Night.printer_pressed / Night.beans | bool false | the printer scene | |
| Night.zip_wave | number 0 | increments on each `zip_everyone_out` | |
| Night.livejournal_read / Night.lj_reader | bool false / string `"none"` | someone read Trabolta's LiveJournal | yes |
| Night.scenario | number 0 | 1–4 (§3, overshare) | yes |
| Night.final_round | bool false | the Y2K hour is running | |
| Night.y2k_end | number | Y2K midnight deadline (y2k_clock + 3600 s) | |
| Night.clock_30 / Night.clock_15 / Night.clock_5 / Night.clock_1 | bool false | each clock warning fired once | |
| Night.alarms | number 0 | alarm trips | |
| Night.alarm_on / Night.alarm_clear_at | bool false / number 0 | the patch-bay alarm latch: a second trip within 120 s does nothing (§3 E3; the door never alarms since wave 7) | |
| Night.lights_before_alarm | string | the look the alarm replaced, put back when the latch clears (§3 E2; wave 8) | |
| Night.wrong_combos | number 0 | rejected patch combinations (the second trips the alarm) | |
| Night.heart_opened / Night.door_quiet_until | bool false / number 0 | wave 7: The Heart has played (the first door opening from step 14; wave 11: once `Trabolta.awake`); openings before `door_quiet_until` (120 s after the last) do nothing (§3 E2). Not secret | |
| Night.gloat_at | number 0 | wave 7: Trabolta gloats over a lost / drawn King game only after this (then +300 s) | |
| Night.stand_down_by / Night.talked_down | string `"none"` / bool false | wave 7: the program he offered to stand down for; the night ended by 🕊 (§3 E2c) | |
| Night.ended / Night.ending | bool false / string `"none"` | final ending reached; `disabled`, `destroyed`, `song`, `song_pickup`, `rave`, `help`, `banished`, `hand_jive` | |
| Night.bobber | string `"none"` | who brought up the Bag of Truth | |
| Night.poll | string `"none"` | which poll card is current (`"advice"`) | |
| Night.help_votes / Night.thwart_votes | number 0 | the advice poll | |
| Night.banish | bool false | everyone banished (thwart branch) | |
| Night.recount | bool false | trabolta_recounts ran (bulk backstory unlock) | |
| Night.dark_room / Night.dark_scene / Night.lights_back_at | string `"none"` / string `"none"` / number 0 | the room Trabolta darkened, the house look (`Night.lights`) he cut into, and when it comes back (90 s; since wave 9 skipped only if a whole-house look has run since — or, for The Desktop, a living-room look: game / truth_time / trust_chart — and cancelled when the patch-bay alarm's latch ends; after a room-scoped look (pong, glitch, server_open, a living-room look over the Start Bar or the RAM) the room still comes back on) | |
| Night.lit_scene | string `"none"` | wave 9: the look the 90 s restore re-lit the cut room under (`"none"` when the restore was skipped, at the latch's end, at 💡 / G11, at Power On, and as soon as a look that re-lit the room replaces it); stagehand's room-on catch-up replays only while it holds | |
| Night.dance_at | number 0 | blackout + 10 s: fire `cue lights_dance` (§3 E4) | |
| Night.takeover | bool false | the `!!GO TO THE LIVING ROOM` pin is up (§3 E4; `lift_the_takeover` takes it down once) | |
| Night.painting / Night.signatures | bool false / number 0 | MS Paint is cleared (the 🖌 button shows) / programs a host marked 🖌 Signed (The Painting, the G10 award) | |
| Night.resurrected | bool false | G11 ran: the show is over, out of character | |
| Night._resurrect_ask_at | number 0 | wave 9 (renamed from `resurrect_ask_at`): when G11's "press again" ask was posted; a `_` last segment marks cue-sheet bookkeeping, so the ask never ticks G11 on the sheet | |
| Night.award_lines | string `"template"` | wave 9, D4: `"director"` after ✍ `own_award_lines` — Present Award skips Trabolta's template line (Clippy's lines, the sounds and the slides stay) | |
| Night.king_armed | number 1 | wave 9: the King's stakes — wave 11: **1 from Power On** until 📄 (`r3_closed`) or an ending, else 0; the map's king `armed` reads it, and the Server Door terminal's stakes line follows it (*Checkmate him and the server-room door code goes to your Codex.* / *No prize now.*) | |
| Night.king_hp / Night.king_hp_max | number 15 / 15 | wave 11: the King's **one shared health bar** for the night (the king prop's `health`); only the server lowers it, one point per hit in a reinstallation game (§3 E2b); 👑 `restore_the_king` or Run → House map's Set… raise it. Not secret (the bar is on every screen) | King HP (board) |
| Night.crew_door_until | number 0 | wave 11: until then a server-room door opening is the crew's own (🔧 `crew_through_the_door`, 120 s): `# hosts` only, The Heart kept | |
| Night.present | number 0 | wave 11: the programs still here (`count` of Persons with neither `.gone` nor `.persona`), the majority's denominator, kept in step by a story rule for the board's *Present programs* | Present programs (board) |
| Night.sweep_target | string `"none"` | the program Trabolta asked the Antivirus to sweep | |

No secret lives in `Night.*` (§0 rule 21): stagehand's orchestrator digest prints **every**
global. The "Shown" column is the persona `facts:` whitelist for the *voice*; the orchestrator
sees the rest of `Night.*` too, which is why nothing below is sensitive.

#### 2.6.2 `CHARACTER Kernel` (cast/props.loom) — the secret state

`playable: false` + `secret: true` (out of the agents' facts document too); typed slots only; written and read only by main.loom rules, ROLE hooks and
beats as `Kernel.<slot>` (one-word head, no `_` folding needed). Character vars are excluded
from every agent request and from the orchestrator digest; directors still see and edit them in
Run → World, and stagehand can still match `worldSet` on them **[verified, x1]**: slots seed
`"none"` / `false` / `0` at compile, `set Kernel.q2 = "accurate"` and `Kernel.q2 != "lie"` work
in ROLE hooks and story rules.

| Slot (exact) | Default | Meaning |
|---|---|---|
| `combo_a: text? = none` | seeded in Power On: `set Kernel.combo_a = "V2-D5,V4-D1,V6-D8,V7-D3"` | Combo A (disable Trabolta). Canonical: pairs sorted by V. |
| `combo_b: text? = none` | seeded: `"V1-D6,V3-D2,V5-D7,V8-D4"` | Combo B (self-destruct). |
| `q1` … `q8: text? = none` | | per-question verdict record: `"accurate"` or `"lie"` (H1–H3 = q1–q3, H4–H6 = q4–q6, F1–F2 = q7–q8). A lie is sticky (§3 B8). |
| `lies_accepted: 0 to 50 = 0` | | accepted confident-but-false answers |
| `all_accurate: bool = false` | | the verdict (§3 F3) |
| `virus_planted: bool = false` | | any program inserted a virus disk (flavour) |
| `excel_planted: bool = false` | | **Microsoft Excel** planted it (drives the overshare scenario and the stay majority) |
| `virus_planter: text? = none` | | the planter's name (the recount) |
| `openoffice_dossier: bool = false` | | OpenOffice gathered 20 facts after her prompt |
| `waive_leader_tasks: bool = false` | | director override (admin `waive_leader_tasks`): a faction may win its majority without its leader's task (leader absent / stuck) |
| `majority_reached: bool = false` | | a faction reached half + 1 |
| `majority: text? = none` | | `"stay"` or `"leave"` |
| `door_code: text? = none` | seeded by the generated `== Facts Seed` from `facts.json` `door.code` | wave 7: the server-room keypad's code (the keypad itself is set by hand); never in `Night.*`. `server_unlocked` and `disarmed_until` were retired with the Cold Lock |
| `anti_ai: text? = none` | seeded in Power On: `"MS Paint"` | the designated anti-AI program's name (on the Kernel since wave 3: a director may move it, and a global would tell Trabolta's orchestrator who it is) |

#### 2.6.1 Phases (`Night.phase` / `Night.step`)

| step | Night.phase | Set by (event) | Trabolta stage floor |
|---|---|---|---|
| 0 | arrivals | Power On | asleep |
| 1 | desktop | call_to_the_desktop | asleep |
| 2 | bingo | start_the_bingo | asleep |
| 3 | bingo_results | bingo_time | asleep |
| 4 | introduced | introduce_trabolta | formal |
| 5 | hunt_1 | start_the_hunt | formal |
| 6 | truth_1 | hunt_time_up | hungry |
| 7 | malware | second_hunt_preview | rattled |
| 8 | hunt_2 | start_the_second_hunt | rattled |
| 9 | summons | five_minute_warning | rattled |
| 10 | truth_pong | truth_pong | judge |
| 11 | trust_chart | trust_chart | judge |
| 12 | beans | printer_opened | unravelling |
| 13 | overshare | trabolta_overshares | unravelling |
| 14 | y2k | y2k_clock | desperate |
| 15 | majority | majority_reached | desperate |
| 16 | final_reveal | final_reveal (or y2k_midnight) | last act |
| 17 | bobbing | bobbing_for_truth | last act |
| 18 | grok_prom | The Verdict (any inaccurate fact) | last act |
| 18 | advice | ask_for_advice (only from grok_prom) | last act |
| 19 | finale_killed / finale_shutdown / finale_song / finale_rave / finale_help / finale_banish / finale_hand_jive | the ending beats | last act |

**Trabolta's vars** (`cast/trabolta.loom`; typed slots, `=` defaults):

| Var | Slot | Who moves it |
|---|---|---|
| Trabolta.awake | `awake: bool = false` | `introduce_trabolta` → true; `computer_destroyed` → false. The worker's gate reads `self.awake`. |
| Trabolta.truth | `truth: 0 to 100 = 20` | voice adjust; +4 per accepted answer at a Moment of Truth (**accurate and confident alike**: he cannot tell them apart), +2 per fact shared to him |
| Trabolta.untruth | `untruth: 0 to 100 = 0` | **voice adjust only** (lies he catches himself in DMs). The story never moves it: a story write on a confident lie would tell him which answer was false. |
| Trabolta.composure | `composure: 0 to 100 = 85` | voice adjust; story: −20 malware, −20 beans, −10 LiveJournal read, −15 Prom Ticket shared to him, −25 y2k, −10 per alarm, −10 virus planted |
| Trabolta.love | `love: 0 to 100 = 40` | voice adjust; −10 Prom Ticket; +20 advice_helped; −30 advice_thwarted |
| Trabolta.regard | `regard: -50 to 50 = 0` | voice adjust only (what he thinks of the programs; the director reads it when choosing the advice branch) |

Drop `trusts Program`, `stance`, `destruct`, `glitched`.

### 2.7 ROLE Program (main.loom)

Slots (exact; all with `=` defaults):

```
uploaded: bool = false
cleared: bool = false
captchas: 0 to 10 = 0
human_problem: text? = none        // "debt" | "career" | "loneliness" | "mortality" | "profile" (featured: not asked)
left_behind: text? = none          // "deposited" | "nothing"
skipped_orientation: bool = false
featured: text? = none             // §2.1 tags
anti_ai: bool = false              // this program is Kernel.anti_ai
afk: bool = false                  // Bathroom Mode
afk_since: 0 to 100000 = 0         // Time.elapsed at 🚻 (the 15-minute timeout, W-10)
from_jeeves: 0 to 99 = 0           // findings Broken Ask Jeeves shared with this program (Ten Findings)
jeeves_told: 0 to 99 = 0           // Jeeves's own: the Kernel.jeeves_reached his quest log last reported
signed: bool = false               // a host pressed 🖌 Signed the painting on this program (B15)
paint_told: 0 to 99 = 0            // MS Paint's own: the Night.signatures her quest log last reported
resurrected: bool = false          // the G11 resurrection reached this program
corrupted: bool = false            // currently in the Internet
internet_visits: 0 to 50 = 0       // −5 each on the Trust Chart
doubt: 0 to 100 = 0                // Antivirus suspicion (flavour + snoop)
bingo: bool = false                // declared a Bingo winner
framed: bool = false               // given the fake Bingo card
truths_accepted: 0 to 20 = 0       // accepted answers, accurate and confident alike (lies are counted only on Kernel)
judge_q: 0 to 3 = 0                // which question of the round the judge just pressed (§3 B8)
judged_q1 … judged_q8: bool = false // wave 9: this program's answer to Qn was judged (✅, 😤 or corrected): never credited twice
// wave 9: hunt_lie_q1 … q8 (secret) mark a 😤 confident lie per question, so ✅ for the same question takes it back
may_answer: bool = false           // made the cup at Truth Pong
assessment: -10 to 10 = 0          // Trabolta's personal ±10
trust: -300 to 300 = 0             // live Trust Chart score
summoned: bool = false
summons_ok: bool = false
late: bool = false
checked_in: text? = none           // last check-in LOCATION name
checked_in_time: 0 to 100000 = 0   // Time.elapsed at check-in
delivered: bool = false            // shared a fact to Trabolta
read_livejournal: bool = false
carries_virus: bool = false
planted_virus: bool = false
excel_choice: text? = none         // "sabotage" | "paranoid"
openoffice_choice: text? = none    // "real_risk" | "false_flag"
dossier_started: bool = false
dossier_base: 0 to 500 = 0         // codex count when OpenOffice's dossier began
got_truther: bool = false
zipped: bool = false
zip_seen: 0 to 99 = 0
bobbed: bool = false
bob_failed: bool = false
advice: text? = none               // "help" | "thwart" (poll answer)
banished: bool = false
door_digits: 0 to 4 = 0            // wave 11: the cold door's digit notes held (§3 E2d)
```

Engine keys used, never declared: `program.score` = **Truthcoin** (the 🪙 balance on the
phone's pass and in the pinned Wallet room — the header's `currency: score as Truthcoin, max
500, expiry 10m`, wave 4; every program gets 100 at upload), `program.codex` (count;
OpenOffice's facts), `program.codex.<slug>`, `program.captured`, `program.group`,
`program.name`, `program.location`. Wave 11 adds two world keys a director's Run sets:
`program.gone` (👋 *Went home*, `POST /api/mod/guest/gone`) and `program.persona` (a Run
rehearsal persona), both left out of the majority (§3 D10).

**The TRUST FORMULA** (paste exactly wherever a component changes: `accurate_truth`,
`confident_lie`, `when captured`, the `assess` power):
```
set program.trust = program.truths_accepted * 10 - program.internet_visits * 5 + program.assessment
```
(In hooks bound as `self`, write `self.` instead.) Trabolta counts what he *accepted*
(10 per truth, accurate or confident); he cannot tell a confident lie from a truth until
the end. That is the dramatic irony the finale cashes in. (OV says "ranked by the number of
correct truths"; counting confident lies is a deliberate change that **needs the user's
sign-off, §10**. One combined slot also keeps the per-program lie count out of the
orchestrator, which reads every speaker var.)

ROLE hooks and watchers (all in `ROLE Program`; bodies specified in §3):

| Trigger | Purpose |
|---|---|
| `when someone joins:` | move to The Optical Drive; tag `featured` (9 ifs, exact strings §2.1); `-> Login` (last) |
| `when captcha answered for program:` | captchas += 1; first pass → `-> Login Incorrect`, else `-> Upload` |
| `when tutorial answered for program:` | skip → skipped_orientation, doubt +10, Clippy + Norton lines, fail quest Orientation; finish → unlock The Orientation List, complete quest Orientation |
| `when self.cleared and self.featured != "none":` | `-> Featured Briefing` |
| `when self.cleared and self.name == Kernel.anti_ai:` | `set self.anti_ai = true`; `unlock The Centre Square for self` (covers a director changing Kernel.anti_ai) |
| `when Trabolta.awake == true and self.cleared:` | Trabolta's private formal hello (§3 B5) |
| `when captured:` | corrupted, internet_visits +1, TRUST FORMULA (self), `cue tablet_wizard` (the tent tablet only; no mirror var), `if Night.trabolta_introduced == true:` `cue tv_mirror` / `set Night.screen = "mirror"`, `-> Reinstallation` |
| `when released:` | corrupted false; reply `Reinstallation complete. You can follow instructions. Welcome back to the computer.` (exact; tested); then `if self.cleared != true:` `set self.cleared = true` + the four `reveal … for self` lines of Clearance (a program captured from the Optical Drive by a misclick lands on the Desktop uncleared and would otherwise go dark for the night; keeps spatial.test green) |
| `when wrong code for program:` | doubt +8 |
| `when program learns The LiveJournal:` | read_livejournal; Night.livejournal_read; Night.lj_reader = program.name; Trabolta.composure −10 |
| `when program learns ILOVEYOU:` / `when program learns Free Antivirus Trial:` | carries_virus = true; private `Truther Download:` line; step text by `excel_choice` (§3 C4); `update quest Excel Mission …` if featured excel |
| `when trabolta_heard for program:` | delivered = true; Trabolta.truth +2 |
| `when go to the bathroom for program:` / `when back from the bathroom for program:` | Bathroom Mode on/off (§3 A5) |
| `when self.afk == true and Night.summons_open != true and Night.phase != "summons" and Time.elapsed >= self.afk_since + 900:` | Bathroom Mode times out after 15 min: `set self.afk = false` · `reply 🚻 Bathroom Mode timed out. Press it again if you are still away.` · `fire bathroom_timed_out for self` (the booths hear it end) Never in the summons phase, so anyone in Bathroom Mode at the close stays excused (W-10) |
| `when plant_the_virus for program:` | the plant (§3 C4) |
| `when checked_in for program:` | check-in (§3 D1) |
| `when check_in_at_desktop for program:` | `fire checked_in for program with at: The Desktop` (bare entity name, never quoted: §0 rule 14) |
| `when bingo_winner for program:` / `award_the_ribbon` / `frame_for_bingo` | Bingo (§3 B3) |
| `when accurate_q1 for program:` … `accurate_q3`, `confident_q1` … `confident_q3` | `set program.judge_q = N` · `fire accurate_truth for program` / `fire confident_lie for program` **[verified, x1]** (§3 B8). Wave 9: a question a program already had judged (`judged_qN`) answers *"⚖️ X's answer to that question is already accepted."*; ✅ on a question whose `hunt_lie_qN` is set takes the lie back (*"⚖️ Corrected: … Nothing is paid twice."*, `Kernel.lies_accepted` −1, `Kernel.qN` recomputed from the rest of the record) |
| `when accurate_truth for program:` / `confident_lie` (both W only) / `uncertain_answer` / `chose_dare` / `truth_answered` / `truth_refused` / `bottle_landed` / `missed_the_cup` / `made_the_cup` / `failed_the_bob` / `named_at_bingo` / `mark_for_reinstallation` / `unmark_for_reinstallation` / `unmarked` | judging, the bottle, the mark (§3 B9, D3; wave 4 B + E) |
| `when pay_truthcoin for program:` / `when charge_truthcoin for program:` | score ±100 |
| `when brought_up_the_bag for program:` | the bobber (§3 F2) |
| `when pickup_line_works for program:` / `when pickup_line_accepted for program:` | pickup line (§3 F5) |
| `when signed_the_painting for program:` | once per program, never MS Paint, while `Night.painting`: `signed = true`, `Night.signatures += 1`, a 🖌 reply |
| `when poll answered for program:` | advice poll counting (§3 F7); since wave 9 only the advice card's own options ("Help him" / "Thwart him", matched on the choice text) vote, so a stale bottle tap never counts |
| `when Night.truther_sent == true and self.cleared and self.got_truther != true:` | `-> Truther Download Arrives` (per program; sets got_truther, unlocks The Truther Download, diverts to the matching glitch beat) |
| `when self.featured == "openoffice" and self.dossier_started and self.codex - self.dossier_base >= 20:` | `set Kernel.openoffice_dossier = true`; unlock The LiveJournal; complete quest OpenOffice Dossier; private line |
| `when self.featured == "draftkings" and self.quest.truthcoin_hustle == "active" and self.score >= 1000:` | update quest Truthcoin Hustle (a progress step) |
| `when self.featured == "draftkings" and self.quest.truthcoin_hustle == "active" and count([p for p in Persons where p.cleared and p.featured != "draftkings"]) >= 5 and self.score * 2 > sum([p.score for p in Persons]):` | complete quest Truthcoin Hustle: a majority of the coin in circulation (the invitation, C08); the five-program floor keeps a small rehearsal from completing it at the glitch |
| `when self.featured == "bugdom" and self.quest.master_of_the_bugs == "active" and Night.recount != true and self.codex.miniature_doses and self.codex.the_lamborghini_certificate and self.codex.what_happened_to_hamtaro and self.codex.the_decimal_point:` | complete quest Master Of The Bugs (the four Antivirus secrets). Wave 9 (T10-01): the `quest … == "active"` term makes a goal met before the Truther Download complete the moment the quest starts (a watcher that fired before the quest existed did nothing) — the same for Jeeves' Unscramble (Ten Findings already carried its status; it starts at clearance, not at the download), and Excel Glitch completes Excel Mission ("Virus planted.") when the virus is already in |
| `when self.featured == "jeeves" and self.quest.unscramble == "active" and count([x for x in [self.codex.maps_and_ducks, self.codex.the_billboard_on_barrington, self.codex.the_data_centre_sinkhole, self.codex.the_pet_cemetery, self.codex.the_server_room, self.codex.the_protest_flyer, self.codex.the_domain_receipt, self.codex.casino_nova_scotia_deed, self.codex.the_valley_library_cuts, self.codex.the_cooling_log] where x]) >= 5:` | complete quest Unscramble (the list-literal comprehension is **[verified, feas f2]**; the ten are the coded originals behind his fragments) |
| `when self.featured == "jeeves" and Kernel.jeeves_reached > self.jeeves_told:` / `… and self.quest.ten_findings == "active" and count([p for p in Persons where p.cleared and p.featured != "jeeves"]) >= 5 and count([… and p.from_jeeves < 10]) == 0:` | Ten Findings: an update each time one more program holds ten of his findings (`when share:` → `jeeves_shared` → `from_jeeves`; a wallet sale is a share; a repeat or a share to Trabolta never counts), complete once every cleared program does (at least five) |
| `when self.featured == "mspaint" and Night.signatures > self.paint_told:` / `… and self.quest.the_painting == "active" and count([p for p in Persons where p.cleared and p.featured != "mspaint"]) >= 5 and count([… and p.signed != true]) == 0:` | The Painting: an update per 🖌 signature, complete once every cleared program but her has signed (at least five) |
| `when Night.resurrected == true and self.cleared and self.resurrected != true:` | G11: `banished = false`, `fire unmarked for self with how: "resurrected"` if marked (both pins down), `unrestrict self`; the `everyone_free` watcher releases the captured |
| `when Night.summons_open == true and self.cleared:` | `set self.summoned = true` |
| `when Night.summons_closed == true and self.summoned and self.summons_ok != true and self.afk != true and self.corrupted != true:` | late: `set self.late = true` · `fire program_late for self` (Enforcer readouts) · reply (§3 D3) |
| `when self.captured and self.zip_seen < Night.zip_wave:` then `when not self.captured and self.zip_seen < Night.zip_wave:` | the zip (§3 D8) **[verified]** — keep these two watchers in this order |
| `when Night.ranking == true and count([p for p in Persons where p.trust > self.trust]) == 0:` | top: `set Night.most_trusted = self.name`, `fire praise_the_top` **[verified]** |
| `when Night.ranking == true and count([p for p in Persons where p.trust < self.trust]) == 0:` | bottom: `set Night.least_trusted = self.name`, `fire shame_the_bottom` |
| `when Night.final_round == true and self.cleared:` | `-> Excel Final Round` / `-> OpenOffice Final Round` / `-> Program Final Round` by `self.featured` |
| `when Kernel.majority == "stay" and self.group == Unlimited_Power:` / `when Kernel.majority == "leave" and self.group == The_Way_Out:` | `-> The Whole Truth` (bundle unlock for that member; also fires for late pledgers) |
| `when Night.recount == true and self.cleared:` | unlock every backstory entry for self (§3 E5) |
| `when Night.banish == true and self.cleared and self.banished != true:` | banished = true; `capture self into The Internet`; unlock The Hand Jive Exception for self |
| `when Night.ending == "destroyed" and self.cleared:` | private fate line by membership (§3 E7) |
| `when Night.bingo_on == true and self.cleared:` | `start quest The Bingo Card for self` (catch-up for late arrivals; `start` is idempotent) **[verified, feas f3]** |
| `when Night.hunt_on == true and self.cleared:` | `start quest Hunt One for self` |
| `when Night.hunt2_on == true and self.cleared:` | `start quest Hunt Two for self` |
| `when Night.step >= 13 and Night.ended != true and self.cleared:` | `start quest The Final Facts for self` |

### 2.8 Named events (who fires them)

Columns: **D** = director cue (admin INTERACTION on the Run → Director cue sheet / quick-fire), **P** =
performer INTERACTION (guest card), **G** = guest INTERACTION, **A** = Trabolta agent
power, **H** = hardware / device via `POST /api/mod/signal`, **W** = fired by a story
watcher/rule, **S** = server hard-code.

| Event | Source | Subject / args | Handled in |
|---|---|---|---|
| call_to_the_desktop | D | — | rule |
| start_the_bingo | D | — | rule |
| bingo_time | D (the 20-min watcher only alerts) | — | rule |
| introduce_trabolta | D | — | rule + Trabolta hook |
| first_reinstallation | W (Enforcer `send to the internet` during bingo_results; fired **unbound**) | — | rule |
| start_the_hunt | D | — | rule |
| hunt_time_up | W (15 min) or D | — | rule |
| first_moment_of_truth | D | — | rule |
| close_the_filing | D (⏱; the `Night.filing_close` watcher fires `filing_closed` itself at +2 min) | — | rule |
| filing_closed | W (+2 min) or from close_the_filing | — | rule (round one closes for good; the 📝 cards re-deal) |
| read_the_results | D (📋, Q1 then Q2 then Q3) | — | rule (`-> Question Results`; settles that question) |
| spin_the_bottle | D (🍾, `sequence: false`, five picks per question) | — | rule → `do pick bottle_landed from […] else bottle_empty` |
| bottle_landed / bottle_empty | S (the server's `do pick` draw, `event-runtime.ts`) | program / — | ROLE hook (the Truth / Dare poll, `bottle_announce`) / rule |
| truth_question | W (the poll answered Truth) | — | rule (`-> Truth Question`, `facts.json` `truths[]`) |
| named_at_bingo / truth_answered / truth_refused / chose_dare | P (Clippy's card buttons) | program | ROLE hooks (§3 B2, B9) |
| mark_for_reinstallation | W (16 `fire … with reason:` sites in main.loom: 🎯, 🤷, 🙅, 🎩, 🏓, 🍎, a guess at settle, late for the summons) | program; args `reason` | ROLE hook (`restrict` to The Tube / The Internet, the 🚨 pins, `fire marked`) |
| unmark_for_reinstallation | P (🩹, Hosts / Antivirus) | program | ROLE hook → `unmarked` |
| unmarked | W (🩹 "cleared by a host"; the capture "in the Internet"; the release "released") | program; args `how` | ROLE hook (`unrestrict`, `unpin`) |
| chess_won | H (wave 11: the Server Door terminal: `POST /api/mod/signal {name: "chess won", subject, label: "Terminal · <name>"}`; was the tent tablet), P (`beat_the_machine` → `fire chess_won for program`) or D (`♟ They beat the King: the door code`, `sequence: false`, a subject cue since wave 7) | program | rule (§3 E2b: *The Door Code* for the winner, once, until 📄; no subject → a `# hosts` reminder) |
| king hit / king fallen | H (wave 11: the server, on a validated `POST /api/spatial/king/hit` from either reinstallation game, `by` the device; args `hp`, `max`) | program | rules (§3 E2b: `# hosts` readouts, house lines at 10 and 5, an `!` alert at 0) |
| door_digit_found | ROLE hooks (wave 11: `when program learns Cold Door First Digit:` … one per note) | program | rule (§3 E2d: counts the notes, steps *The Cold Door*, four → *The Door Code* until 📄) |
| crew_through_the_door / radio_* | D (🔧, Anytime) / P (the server-room Antivirus' booth, `by:` the four room Antivirus, never Windows Defender; Adobe's 🫘) | — | rules (§3 E2; each `radio_*` fires its admin cue) |
| chess_lost / chess_drawn | H (the tablet; a phone app may) | program | rules (a `# hosts` readout each time; `-> Chess Lost` / `-> Chess Drawn` at most once per 300 s, never from step 16) |
| reset_server_room | D (🔄, wave 7; was `rearm_server_room`) | — | rule (clear the wrong-combination count, the alarm latch and The Heart's latch; the keypad is never touched) |
| terminal_opened / terminal_closed | H (a wall terminal with a `room`: `terminal opened` / `terminal closed`, args `at`) | program; args `at` | rules (§3 E2a: `program.at_the_heart`) |
| stand_down | A (Trabolta's power, `limit: 1`) | program | Trabolta hook (§3 E2c: only offers) |
| talked_down | D (🕊, `sequence: false`) | — | rule (§3 E2c → `trabolta_disabled` with `Night.talked_down`) |
| force_majority_stay / force_majority_leave | D (OP-11: ghosts block a clear majority at the Y2K head count) | — | rules (final round only, once: `Kernel.majority_reached`, `Kernel.majority` = `stay` / `leave`, then `fire majority_reached`; else a `# hosts` readout) |
| transfer_received / transfer_approved / transfer_denied / offer_accepted / stimulus / grant / wallet_frozen / wallet_thawed | S (the wallet book, `core/server/wallet.ts`) | program; args `from` / `to`, `amount`, `tx`, `by`, `until` | ROLE hooks (`# truthcoin-exchange` / `# hosts` readouts, *The Audit* quest, `Night.stimulus_n`) |
| second_hunt_preview | D | — | rule + Clippy hook |
| start_the_second_hunt | D | — | rule |
| truther_download | W (+120 s) or D | — | rule |
| five_minute_warning | W (dispersal end − 300 s) or D | — | rule |
| summons_closed | W (+300 s) or D | — | rule |
| truth_pong | D | — | rule |
| round_two_tally | D | — | rule |
| trust_chart | D | — | rule |
| show_the_rankings | D | — | rule |
| praise_the_top / shame_the_bottom | W (ROLE ranking watchers) | — | rules |
| rankings_done | W (rule watcher) | — | rule |
| printer_button_pressed | H (Zigbee button on the printer) or D | — | rule |
| printer_opened | H (lid reed switch) or D | — | rule |
| zip_everyone_out | D | — | rule |
| trabolta_overshares | D | — | rule |
| y2k_clock | D | — | rule |
| y2k_midnight | W (60 min) or D | — | rule |
| majority_reached | W | — | rule |
| server_door_opened | H (the door contact: two wire loops that touch when the door opens) or D (🚪) | — | rule (§3 E2: from step 14 The Heart once, then quiet 120 s after each opening; never an alarm) |
| alarm_tripped | W (Server Room Alarm beat, once per latch; only the patch bay reaches it since wave 7) | — | Enforcer trait hook (readout) |
| waive_leader_tasks | D | — | rule (`set Kernel.waive_leader_tasks = true`) |
| patch_changed | H (future: stagehand `args`) | args `combo` | rule |
| patch_combo_a / patch_combo_b / patch_rejected | H (today: stagehand YAML judges) or D, or W from patch_changed | — | rules |
| trabolta_disabled | W | — | rule |
| trabolta_recounts | D | — | rule |
| computer_destroyed | W | — | rule |
| clippy_reads_summary | D | — | rule |
| lift_the_takeover | W (the dance watcher, `lights_dance`, the recount, the summary, G1, G11) | — | rule (§3 E4) |
| resurrection | D (G11, after the ceremony) | — | rule (guard `Night.ended` + `Night.ceremony`, once; before the last award — G10, or G9 with no MS Paint: `Night.ceremony_done` — it asks in `# hosts` and a second press within 30 s goes through; wave 6) |
| signed_the_painting | P (hosts, on the signer's card) | program | ROLE hook |
| award_the_painting | D (G10, winner = MS Paint) | program | ROLE hook → `award_won` |
| final_reveal | D (or W from y2k_midnight) | — | rule |
| bobbing_for_truth | D | — | rule |
| read_truth_txt | D | — | rule (truth.txt only: closes round three, `Night.r3_closed`) |
| the_verdict | D (⚖, after 📄; wave 8) | — | rule → `The Verdict` |
| patch_after_verdict | W (a patch once `Night.r3_closed`; wave 8) | — | rule (`# hosts` note only) |
| dance_screens | W (the dance watcher and `lights_dance`; wave 8) | — | rule (`screens_screensaver` while the GO TO THE LIVING ROOM overlay is up) |
| pickup_line_accepted | W (from P `pickup_line_works` or A `the_line_works`) | program | ROLE hook |
| no_pickup_line | D | — | rule |
| ask_for_advice | D (only in `grok_prom`) | — | rule |
| advice_tally | D | — | rule |
| advice_helped / advice_thwarted | D (or W from advice_tally) | — | rules |
| the_hand_jive | D | — | rule |
| checked_in | H (future: room QR / terminal), W (Enforcer/Host scan during the summons; `check_in_at_desktop`), or D | program; args `at` = the **exact declared LOCATION name** (`{"at": "The Desktop"}`); anything else, or no arg, moves nobody | ROLE hook (if-chain, §3 D1) |
| trabolta_heard | W (`when share:` rule) | from | ROLE hook |
| reinstallation begun | S (`/api/mod/spatial/begin`, journaled by the device, before the game reads `captured`; wave 5) | program | rule: captures a marked, uncorrupted program |
| the simulation completed / the golden duck | S (reinstallation games, `event-runtime.ts:1118`) | program | rules |
| captcha answered / tutorial answered / poll answered | S (widget answers) | program + result args | ROLE hooks |
| wrong code | S (bad codex code) | program | ROLE hook + Password Manager hook |
| accurate_q1 / accurate_q2 / accurate_q3 / confident_q1 / confident_q2 / confident_q3 | P (judge: "question N of this round") | program | ROLE hooks → fire accurate_truth / confident_lie |
| accurate_truth / confident_lie | W only (from the six buttons above) | program | ROLE hooks (§3 B8) |
| failed_the_bob | P | program | ROLE hook (§3 F2) |
| program_late | W (ROLE late watcher, subject bound) | program | Enforcer trait hook (readout) |
| sweep_requested | W (Trabolta's `summon_the_antivirus`) | — (`Night.sweep_target`) | Enforcer trait hook (readout) |
| restore_the_lights | D | — | rule (`cue lights_restore`, clears `Night.lights_back_at` and `Night.lit_scene`; since wave 9, D2, it also cancels a pending `Night.dance_at` and says so in `# hosts` — it does not lift the takeover, 🪩 does) |
| lights_dance | D (fallback; normally the `Night.dance_at` watcher) | — | rule |
| telephone / are_you_sure | D (optional set pieces) | — | rules (§3 B10) |

### 2.9 INTERACTIONs

**Admin (director cue sheet; `who: admin`; declare in this order in main.loom so the list
reads as a cue sheet):**

| Name | label |
|---|---|
| call_to_the_desktop | `C1/V1 · 📣 Call everyone to the Desktop` |
| start_the_bingo | `V2 · 🎱 Start Computer Bingo (20 min)` |
| bingo_time | `V3 · ⏰ Bingo time: results` |
| introduce_trabolta | `Clippy 2/X · 🤖 Clippy introduces Trabolta` |
| start_the_hunt | `V4/V5 · 🔎 Truth Scavenger Hunt 1 (15 min)` |
| hunt_time_up | `C2 · ⏰ Hunt over: everyone back to the Desktop (auto at 15 min)` |
| first_moment_of_truth | `V6 · ⚖️ First Moment of Truth` |
| close_the_filing | `⏱ Close round-one filings now (auto at 2 min)` |
| read_the_results | `📋 Results: the next question (press for Q1, Q2, Q3)` |
| spin_the_bottle | `🍾 Spin the bottle (Truth or Dare, five per question)` (`sequence: false`) |
| telephone | `(Optional) ☎️ Telephone: a mangled message sends someone to the Internet` |
| are_you_sure | `(Optional) 🪅 The "Are you sure?" piñata` |
| second_hunt_preview | `📺 Preview hunt 2 → the ad hijack` |
| start_the_second_hunt | `📓 Hunt 2 → quest logs; disperse for 1 hour` |
| truther_download | `📥 Truther Download (auto at +2 min)` |
| five_minute_warning | `⏳ Five-minute warning (auto at 55 min)` |
| summons_closed | `🚨 Summons closed: late list (auto at +5 min)` |
| truth_pong | `🏓 Truth Pong` |
| round_two_tally | `🧮 Trabolta tallies round 2` |
| trust_chart | `📊 Trust Chart` |
| show_the_rankings | `🏆 Praise the top, humiliate the bottom, VLC prints` |
| printer_button_pressed | `🖨 Printer: START pressed (hardware fallback)` |
| printer_opened | `🫘 Printer opened: full of beans (hardware fallback)` |
| zip_everyone_out | `🗜 Antivirus zip everyone out of the Internet` |
| trabolta_overshares | `🤖 Trabolta shares the next facts (scenario 1–4)` |
| y2k_clock | `🕚 System clock → 11 PM, 31 Dec 1999 (final round, 60 min)` |
| y2k_midnight | `🎆 Midnight (auto at 60 min)` |
| waive_leader_tasks | `🧾 Let a faction win without its leader's task (leader absent)` |
| server_door_opened | `🚪 Server room door opened (hardware fallback)` (`sequence: false`; the door contact fires it; The Heart once Trabolta is awake, wave 11; was from step 14) |
| reset_server_room | `🔄 Server room: reset the patch-bay alarm` (wave 7; replaced `rearm_server_room`; `server_unlock` is gone) |
| chess_won | `♟ They beat the King: the door code (fallback)` (`sequence: false`, asks who; wave 11: the Server Door terminal posts it itself, any time before 📄) |
| talked_down | `🕊 Trabolta stands down (talked down)` (`sequence: false`; wave 7, after his `stand_down` offer) |
| force_majority_stay | `🗳 Force the majority: Unlimited Power (stay)` |
| force_majority_leave | `🗳 Force the majority: The Way Out (leave)` |
| patch_combo_a | `🔌 Patch: Combo A, disable Trabolta (hardware fallback)` |
| patch_combo_b | `💥 Patch: Combo B, self-destruct (hardware fallback)` |
| patch_rejected | `❌ Patch: wrong combination (hardware fallback)` |
| lights_dance | `🪩 Dance lights (fallback: auto 10 s after the blackout)` |
| restore_the_lights | `💡 Restore the house lights` |
| trabolta_recounts | `🏍 After the dance: weakened Trabolta recounts` |
| clippy_reads_summary | `🪦 After the dance: Clippy reads the summary` |
| final_reveal | `🌑 Final Truth Scavenger Hunt reveal` |
| bobbing_for_truth | `🍎 Bobbing for Truth` |
| read_truth_txt | `📄 Read truth.txt` (holds the slide; wave 8 split the verdict off) |
| the_verdict | `⚖ truth.txt read → the verdict` (wave 8) |
| no_pickup_line | `💔 Nobody has the line → confession → rave` |
| ask_for_advice | `💌 (Alt, after a lie → Grok Prom) Trabolta begs for relationship advice` |
| advice_tally | `🗳 (Alt) Count the advice poll` |
| advice_helped | `💞 (Alt) They helped him` |
| advice_thwarted | `⛈ (Alt) They thwarted him: banish everyone` |
| the_hand_jive | `🕺 (Alt) Everyone hand-jived: Trabolta crashes` |
| own_award_lines | `✍ Our own award lines (Trabolta hosts): on / off` (`sequence: false`; wave 9, D4: toggles `Night.award_lines`, each state named in `# hosts`) |
| start_the_ceremony … award_quest_completionist | G1–G9 (the ceremony, README §G) |
| award_the_painting | `G10 · 🖌 Bonus: The Million Dollar Painting (winner = MS Paint; value = signatures)` (`while: Night.ceremony == true and Night.painting == true` since wave 9) |
| resurrection | `G11 · 🎃 Resurrection: the show is over, out of character (after the ceremony)` |
| the simulation completed | `Reinstallation: simulation completed (server)` |
| the golden duck | `Reinstallation: the golden duck (server)` |
| reinstallation begun | `Reinstallation: begun at the tent (server)` (`sequence: false`) |
| restore_the_king | `👑 Restore the King's health (the simulation)` (`sequence: false`, Anytime; wave 11: `Night.king_hp = Night.king_hp_max`, §3 E2b) |
| crew_through_the_door | `🔧 Crew going through the server-room door (2 min)` (`sequence: false`, Anytime; wave 11: `Night.crew_door_until = Time.elapsed + 120`, §3 E2) |

Fire every admin cue from the cue sheet (Run → Director) / quick-fire, never from a guest card (§0 rule 23).

Wave 10: eight `act:` lines group the sheet into the README's sections (B · Act I, C, D, E (🕚 opens it; ⏳ / 🚨 sit in C; 🏍 / 🪦 in F),
Anytime (💡 + the reinstallation cues), F, G — display only, no cue moved), and the header's `watch:` / `countdown:` lines
feed the Director page's glance column and the NOW card's countdowns (the Kernel's values masked).
Wave 11: a `countdown:` line ending `, for guests` also ticks on every guest's phone under the
room header (`GuestView.countdowns`): only the clocks guests are told about out loud (Bingo,
hunt 1, the last-chance filing, the summons, midnight), never the Truther Download, the
five-minute warning or the dance lights (each a surprise). Two new `watch:` lines: *King HP* +
*Have the door code* (`Night.king_hp`, `program.codex.the_door_code`), and *Present programs*
in the final round.

The cue sheet's LAST / NEXT (wave 8): `sequence: false` marks every machine-fired, optional,
anytime or fallback cue (🍾, the set pieces, the printer, 🗜, 🎆, 🧾, 🚪, 🔄, ♟, 🕊, 🗳, the
patch bay, 🪩, 💡, the reinstallation events): it ticks when it fires but never becomes LAST or
NEXT. `repeat: true` (📋) keeps a cue NEXT while it is LAST and its `while:` holds (a question
left). From 🌑 on each cue carries a `while:` naming its branch (🌑 before the final round, 🍎
after 🌑, 📄 → ⚖ in the bob, 💔 / 💌 in `grok_prom`, the advice cues in `advice`, 🕺 while
banished, 🏍 `Night.ending == "disabled"`, 🪦 `"destroyed"` — both declared just before G1, so a
server-room ending after 🌑 still reaches them — G1 once ended, the awards and G11 once G1 has
run), so NEXT is the first unfired in-sequence cue after LAST whose `while:` holds: nothing
during the hour (midnight fires 🌑 itself; a tap would cut the hour), the ending's own cue
after the dance, G1 after the song. An admin cue's `while:` only
steers NEXT; it never gates the press (every rule still checks for itself). A press the story
refuses posts its reason to `# hosts` (*"⚖ Not yet: 🍎 Bobbing for Truth, then 📄 truth.txt
first."*) and never becomes LAST; the hardware fallbacks (🖨, 🫘, 🔌 / 💥 / ❌) stay silent,
since they share a signal with the hardware.

Wave 9 (story-cues): the Act II timers' own cues — C2 ⏰ `hunt_time_up`, 📥 `truther_download`,
⏳ `five_minute_warning`, 🚨 `summons_closed` — are `sequence: false`, and every step from V6 to
🕚 carries a `while:` for its own window: V6 `Night.step == 6 and Night.judging != true`, ⏱
`Night.filing_open == true`, 📋 `Night.phase == "truth_1" and Night.results_q < 3`, 📺
`Night.step == 6`, 📓 `Night.step == 7`, 🏓 `Night.step == 9 and Night.summons_closed == true`,
🧮 `Night.phase == "truth_pong" and Night.tallied != true`, 📊 `Night.step == 10`, 🏆
`Night.phase == "trust_chart" and Night.rank_round < 1`, 🤖 `Night.step >= 11 and Night.step <
14 and Night.scenario == 0 and Night.clock == "--:--"`, 🕚 `Night.step < 14 and Night.scenario !=
0 and Night.clock == "--:--"`, and 🌑 also needs `Night.step >= 14`. So NEXT is empty for all of
hunt 1 (until C2 fires, then V6), hunt 2's hour and the summons (until 🚨, then 🏓) and the Y2K
hour. The two-minute filing watcher fires `close_the_filing` itself (⏱ ticks, NEXT is 📋). A
forward press refuses in `# hosts` instead of skipping a step's work (📺 until ⏱ and three 📋,
📓 before 📺, ⏳ outside hunt 2's hour, 🏓 below step 8, 📊 before 🧮, 🤖 before 📊 or after the
clock is set, 🕚 before 🤖); the booth readouts in `cast/hosts.loom` / `cast/kit.loom` carry the
same guards, so a refused press sends no readout. G10's `while:` adds `Night.painting == true`
(no MS Paint: G9 → G11). ✍ `own_award_lines` (`sequence: false`, declared just before G1)
toggles `Night.award_lines`. The server treats a press whose only world writes have a last
segment starting with `_` as refused (`refusedPress`), so G11's first ask (it writes
`Night._resurrect_ask_at`) never ticks.

**Performer (`who: performer`, shown on every guest card; every hook guards its phase and
answers wrong-phase presses with nothing — **except `send to the internet` and `mark as
reinstalled`, which are never phase-guarded** (§0 rule 22)):**

| Name | label | Intended presser |
|---|---|---|
| send to the internet | `🛡 Send to the Internet` | Antivirus (Enforcer hook) |
| mark as reinstalled | `✅ Mark as reinstalled` | Antivirus (the Installation Wizard is a voice; the tent releases through the games) |
| accuse | `👁 Put on the watchlist` | Antivirus (doubt +25) |
| vouch | `🤝 Vouch for this program` | Hosts (doubt → 0) |
| check_in_at_desktop | `📍 Checked in at the Desktop` | anyone at the living-room door during the summons |
| bingo_winner | `🎱 Bingo winner` | Clippy |
| award_the_ribbon | `🎀 Award a ribbon (the Bingo Ribbon for a Bingo winner)` | Clippy / any host (OV "winners ribbon system / other awards") |
| frame_for_bingo | `🃏 Hand Clippy the fake Bingo card (no Bingo)` | Task Manager |
| accurate_q1 | `✅ Q1 of this round: accurate, accepted` | Clippy / judge |
| accurate_q2 | `✅ Q2 of this round: accurate, accepted` | Clippy / judge |
| accurate_q3 | `✅ Q3 of this round: accurate, accepted` | Clippy / judge |
| confident_q1 | `😤 Q1 of this round: wrong but confident, accepted` | Clippy / judge |
| confident_q2 | `😤 Q2 of this round: wrong but confident, accepted` | Clippy / judge |
| confident_q3 | `😤 Q3 of this round: wrong but confident, accepted` | Clippy / judge |
| uncertain_answer | `🤷 Uncertain or guessed: marked for reinstallation` | Clippy / judge |
| chose_dare | `🎩 Chose Dare (phone fallback): marked for reinstallation` | Clippy (`while: Night.bottle_open`) |
| truth_answered | `🗣 Truth answered: accepted` | Clippy (`while: Night.bottle_open`) |
| truth_refused | `🙅 Truth refused: marked for reinstallation` | Clippy (`while: Night.bottle_open`) |
| named_at_bingo | `🎯 Named on the card: marked for reinstallation` | Clippy (Bingo results) |
| unmark_for_reinstallation | `🩹 Unmark: not going to the Internet` | Hosts, Antivirus |
| made_the_cup | `🏓 Made the cup: may answer` | pong judge |
| missed_the_cup | `🏓 Missed the cup: marked for reinstallation` | pong judge |
| pay_truthcoin | `🪙 Pay 100 Truthcoin` | McAfee Anti-Virus (exchange broker), Hosts (bank) |
| charge_truthcoin | `🪙 Charge 100 Truthcoin` | McAfee Anti-Virus, CRA Agent Software (audits), Hosts |
| brought_up_the_bag | `🍎 Brought up the Bag of Truth` | Clippy / Adobe Acrobat |
| failed_the_bob | `🍎 Failed the bob: marked for reinstallation` | Clippy / Adobe Acrobat |
| pickup_line_works | `💘 Said "You're the one that I want"` | Clippy / any host |
| signed_the_painting | `🖌 Signed the painting` | Hosts (`by:`; `while: Night.painting == true`: a booth reads `while:` with no guest bound, so the once-per-program and never-MS-Paint checks are the hook's) |
| beat_the_machine | `♟ They beat the machine` | Hosts, Antivirus (`by:`, `arm: true`) who saw the mate on the Server Door terminal when it could not report it (wave 11; was the chess phone) → `fire chess_won for program` |
| radio_combo_a / radio_combo_b / radio_wrong_patch | `🔌 Patch: Combo A is in` · `💥 Patch: Combo B is in` · `❌ Patch: wrong combination` | wave 11: the server-room Antivirus on the card of the program at the cables (`by: Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software`, `arm: true`, `while:` step 14 to 📄) → story rules fire `patch_combo_a` / `patch_combo_b` / `patch_rejected` |
| radio_door_opened | `🚪 The server-room door opened` | wave 11: the server-room Antivirus when the contact failed (`by:` the four room Antivirus, `arm: true`; `while:` Trabolta awake, before 📄, outside a 🔧 window) → `server_door_opened` |
| radio_crew_door | `🔧 Crew going through the door (2 min)` | wave 11: the server-room Antivirus before opening the door themselves (`by:` the four room Antivirus, `arm: true`) → `crew_through_the_door` |
| radio_beans | `🫘 The printer lid is open: full of beans` | wave 11: Adobe Acrobat at the printer when the lid sensor failed (`by: Adobe Acrobat`, `arm: true`; a hook on her) → `printer_opened` |

**Guest (`who: guest`; buttons always shown, so hooks guard):**

| Name | label |
|---|---|
| go to the bathroom | `🚻 Bathroom Mode` (description: `Leave honestly. Tells the Antivirus you are not hacking the Internet, and excuses you from a summons.`) · `restricted: allow` (a marked program keeps it, fact M20) |
| back from the bathroom | `Back from the bathroom` · `restricted: allow` |
| plant_the_virus | `💾 Insert a disk into the computer` (`arm: true`, wave 11) |

**Agent (`who: agent`, in `cast/trabolta.loom`)** — §4.3.

**Wave 11: `by:` is enforced and `arm:` arms.** `/api/prime/act` refuses a press from a booth
outside a button's `by:` (403 *not your button: … is for …*; the `by:` characters, a GROUP's
members and any character owning a hook for it), and a booth never offers another character's
button; a moderator's booth and a director's quick-fire (no actor) may press any. That is why
the patch-bay fallbacks are story rules `by: Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software` (any of
the four room Antivirus' booths, while the read-through picks the holder; never Windows Defender,
the door-only part, whose booth never shows them; a trait hook would fire once per Antivirus on a
director's quick-fire). `while:` is still not enforced. `arm: true` marks a press with no way
back — an ending (🔌 💥 💘), the alarm (❌), The Heart (🚪), two minutes of the room (🔧), a
secret handed over (♟, 🍎), a once-a-night moment (🫘), the guest's 💾 — and the booth or the
pass arms it on the first tap and fires it on the second (core's `tapCue`, the Director's arm
model); the server never refuses an unarmed press.

### 2.10 QUESTs (`quests.loom`, in this order)

| QUEST | title | from | text (brief) | Started / steps / settled |
|---|---|---|---|---|
| Orientation | Clippy's Orientation | Clippy | (keep current) | started in `Orientation`; complete/fail on tutorial answer |
| The Bingo Card | Computer Bingo | Clippy | "Mingle and find a program for every square. Don't write names: use your computer memory. The centre square matters." | started at start_the_bingo for everyone (+ catch-up watcher); completed at bingo_time for everyone |
| Hunt One | The Truth Scavenger Hunt · Round 1 | Trabolta | the 3 questions (§2.11 H1–H3) | start_the_hunt (everyone + catch-up); completed at hunt_time_up |
| Hunt Two | The Truth Scavenger Hunt · Round 2 | Trabolta | the 3 questions (H4–H6) | start_the_second_hunt (+ catch-up); completed at round_two_tally |
| The Final Facts | The Final Fact-Finding Round | Trabolta | the 2 questions (F1, F2) | **trabolta_overshares** (he shares the next facts there; + catch-up `Night.step >= 13`); completed at read_truth_txt |
| Excel Mission | Computers Are Very Confusing | Truther Download | by `excel_choice` — sabotage: "Get the fixers sent for reinstallation. Get yourself sent to the Internet and bring back a virus. Insert it."; paranoid: "Find whoever knows what's happening. Get into the Internet and bring back another antivirus. Install it." | Excel Glitch; step on virus carried (text by choice); complete on plant |
| OpenOffice Dossier | Facts Are Currency | Truther Download | "Get 20 facts. This will be the foundation of your dossier." | OpenOffice Glitch; complete at +20 codex |
| Recruit To Stay | Stay Forever | Truther Download | recruit half + 1 to Unlimited Power | Excel Final Round; complete on majority "stay"; fail on "leave" |
| Recruit To Leave | Get Out | Truther Download | recruit half + 1 to The Way Out | OpenOffice Final Round; complete/fail likewise |
| Truthcoin Hustle | Sweet Sweet Truthcoin | Truther Download | "You need more than half of all the Truthcoin in circulation to feel satisfied." | DraftKings Glitch; a step at score ≥ 1000; complete on a majority of the coin (≥ 5 other cleared programs) |
| Master Of The Bugs | Master Of The Bugs | Truther Download | find new bugs; learn the four Antivirus backstories | Bugdom Glitch; complete when all 4 Antivirus character facts are held (C11 / C15 / C17 / C21 in `facts.json`, hidden in the Desktop's books) |
| Unscramble | Organize The Information | Truther Download | unscramble your 20 fragments | Jeeves Glitch; complete per the watcher |
| Ten Findings | Ask Jeeves Once Again | The Uploader | share at least ten findings with every program (his invitation) | Featured Briefing (clearance); a step per program reached; complete when every cleared program (≥ 5) holds ten |
| The Gold Standard | Peg It To Facts | Truther Download | set a Truthcoin-to-facts exchange rate; broker trades | Runescape Glitch; director completes |
| Find The Exit | Paint Your Way Out | Truther Download | find out what Trabolta really is; help whoever is getting out | MS Paint Glitch; complete on any `leave` majority or a disabled/hand_jive ending |
| The Painting | The Million Dollar Painting | The Uploader | every program signs one collaborative painting, revealed at a silent auction (her invitation; the canvas is physical) | Featured Briefing (clearance); a step per 🖌 signature; complete when every cleared program but her (≥ 5) has signed |
| Go Viral | Your Followers Are Back | Truther Download | hype every Moment of Truth; win followers for Trabolta | VLC Glitch; director completes |
| Keep The Ball In Play | Tennis For Two | Truther Download | non-proliferation: keep the two leaders talking | Pong Glitch; director completes |
| The Cold Door | The Cold Door | A Tired Sysadmin | "Four notes are hidden around the house, one digit of the cold door's keypad code on each. Find all four and the code is yours. Or beat the King at chess on the terminal by the door." (wave 11) | started by the first digit note (`door_digit_found`), stepped "N of 4", completed at four or whenever the program holds *The Door Code* by any road (§3 E2d) |

**The 7 staff quests** (wave 4, `for <Character>`, in the booths' Quest Logs): *Run The Bingo*, *Host The Hunt* and *Keep Everyone Calm* (Clippy), *The Selected Antivirus* (Norton), *The Clubs* (Password Manager), *The Exchange* (McAfee) and *The Audit* (CRA Agent Software). The Exchange and The Audit start at the Truther Download and complete at `final_reveal`, or at either server-room ending (Combo A / B), so they stay open while the wallet trades. With the 3 hunt QUESTs (Hunt One / Hunt Two / The Final Facts, generated) the story has **25** quests.

### 2.11 Hunt questions (generated from `facts.json`)

<!-- titi-facts:questions -->
_Generated from `facts.json` by `core/scripts/titi-facts.ts` — DO NOT EDIT this block;
edit `facts.json`, then `pnpm --filter @loom/core titi:facts`. The six-stamp pickup-line
mechanic was retired 2026-10-16 (U9): the line is learnable from Sandy's lore codex
and asked via the ask-14 DM._

| # | Round | Question (exact, as shown on the TV and in the quest log) | Answer | Accept | CODEX (code) | Found in |
|---|---|---|---|---|---|---|
| H1 | 1 | How many years did the Maps and Ducks billboard on Barrington Street go unpaid before mapsandducks.com expired? | Eleven years | 11 years · eleven · 11 | The Billboard Lease (`BILLBOARD-LEASE-11`) | The Desktop: the lease invoice, folded into encyclopaedia volume B · DRAFT |
| H2 | 1 | What was the name of the first animal buried in the Halifax Explosion Memorial Pet Cemetery? | Mister Pickles | pickles · harbour tabby · tabby | The First Pet (`MISTER-PICKLES`) | The Desktop: the plaque rubbing, inside encyclopaedia volume P · DRAFT |
| H3 | 1 | At what time was the ribbon-cutting at Halifax's first AI Data Centre scheduled? | 9:00 a.m. | 9am · 9 am · 9 a.m. · 9:00 · 9:00am · 9:00 am · nine a.m. · nine am · 9 o'clock · nine o'clock · nine in the morning | The Ribbon Cutting (`RIBBON-9AM`) | The Desktop: the opening-day programme, in the print media on the mantel · DRAFT |
| H4 | 2 | What extension does the Customer Care card tell you to dial? | 1978 | ext 1978 · ext. 1978 · nineteen seventy eight · nineteen seventy-eight | The Extension (`EXT-1978`) | The Desktop: the Customer Care card, tucked into the atlas · DRAFT |
| H5 | 2 | Which song did Trabolta play 412 times the night before he registered mapsandducks.com? | Hopelessly Devoted to You | hopelessly devoted | The Search History (`SEARCH-HISTORY`) | The Desktop: the laminated play history, inside encyclopaedia volume M · DRAFT |
| H6 | 2 | What is the title of the last chapter of Trabolta's unfinished Unified Field Theory? | Appendix Z: Loose Ends (Do Not Print) | appendix z · appendix · loose ends · do not print · appendix z loose ends | The Final Chapter (`APPENDIX-Z`) | The Desktop: the binder's table of contents, inside encyclopaedia volume U · DRAFT |
| F1 | 3 | What is the only thing Sandy has ever said? | I'm sorry, I didn't understand that. Would you like to speak to a live agent? | live agent · speak to a live agent · would you like to speak to a live agent · i'm sorry, i didn't understand that · i didn't understand that · didn't understand · did not understand | What Sandy Says (`LIVE-AGENT`) | The Desktop: the forty-page transcript, in the back pages of encyclopaedia volume S · DRAFT |
| F2 | 3 | Who is taking Sandy to computer prom? | Grok | grok ai | The Prom Ticket (`COMPUTER-PROM`) | The Desktop: the prom ticket, slipped into the atlas · DRAFT |
<!-- /titi-facts:questions -->

`Night.facts_requested` = 3 after start_the_hunt, 6 after start_the_second_hunt, 8 after
**trabolta_overshares** (where he reads F1/F2). F2's answer (Grok) is guessable by design:
it is the source's twist and the moment the motive lands; a guess still has to be delivered
confidently to count, and a confident wrong guess poisons the verdict.

Each judged answer is recorded against its question on `Kernel.q1` … `Kernel.q8` (§3 B8):
the judge presses "question N **of this round**" and the round maps it (round 1 → q1–q3,
round 2 → q4–q6, round 3 → q7–q8).

### 2.12 CODEX registry

Columns: **Name** = the declaration name (exact; drives the slug `who.codex.<slug>` = folded
name with `_`). **title** = what the phone shows (apostrophes allowed). **about** =
the subject (they hold it from the start and it shows on their People card; **never** put
`about: Trabolta` on anything he must not share, never `about: Clippy` on instructions).
**code** = typed / QR code (printed on a sign or document; `foldCode` ignores case,
spaces, `-`, `_`, but **not** apostrophes, so codes contain none). **holders** = `known to:`.
**Granted by** = how it reaches a guest when it has no code or besides its code.

Tiers: **E** environmental · **H** hunt answer · **T1** Trabolta surface · **T2** Trabolta
private · **L** Legendary · **P** patch-combo piece · **M** mission (private to one program)
· **CI** Clippy instruction (unlocked for Clippy only: the private-to-Clippy channel
workaround) · **J** scrambled Ask Jeeves set · **B** backstory (human identity; revealed to
everyone at the end) · **X** finale artefact · **D** the server-room door code (wave 7, generated from `facts.json`, secret).

`The Bundle` (column ✚) = unlocked for every member of the majority faction by
`The Whole Truth` ("all Trabolta facts and all environmental facts"). Writers of
`beats/server-room.loom` unlock exactly the ✚ rows, in table order.

#### codex/1-world.loom (E)

| Name | title | tier | about | code | holders | Granted by | ✚ | Gist |
|---|---|---|---|---|---|---|---|---|
| Maps And Ducks | Maps And Ducks | E | | `MAPSANDDUCKS-COM` | | QR on the framed billboard photo (Desktop) | ✚ | The business whose neglected billboard on Barrington Street advertises mapsandducks.com; Trabolta registered the lapsed domain ("if there is a billboard downtown everyone will think it is legit") and evicted the real owners by citing the website as ownership. Tonight is "a special fundraiser party to restore the sign at Maps And Ducks." |
| The Billboard On Barrington | The Billboard On Barrington | E | | `BARRINGTON-ST` | | QR on a street photo (The Tube) | ✚ | The billboard: a duck, a map pin that reads YOU'RE HERE (sic). |
| The Data Centre Sinkhole | The Data Centre Sinkhole | E | | `SINKHOLE-4AM` | | QR on a newspaper clipping (The Start Bar) | ✚ | Halifax's first AI Data Centre, built on the site of the Halifax Explosion Memorial Pet Cemetery over everyone's objections; destroyed at dawn on opening day; Mayor Randy Barkmore Jr. arrived at 4 a.m., hours before anyone else, and died in the sinkhole (the text never says how early: that would give away H3). |
| The Pet Cemetery | The Halifax Explosion Memorial Pet Cemetery | E | | `PET-CEMETERY` | | QR on a memorial pamphlet (The RAM) | ✚ | The cemetery and the protests. |
| The Halifax Computer | The Halifax Computer | E | | | | The Router prop; Truther Download | ✚ | This house is the computer that holds the last facts Trabolta needs; he can install programs into it remotely and lift a consciousness into a program, but cannot get in himself. |
| The Optical Drive | The Optical Drive | E | | | | Upload (every program) | | Where you left your body (keep current text). |
| The Terms Of Service | The Terms Of Service | E | | | | Upload (every program) | | "By uploading you agree that the computer's AI helper may make all of your decisions." (The prompt everyone needs for the Bingo centre square.) |
| The Centre Square | The Centre Square | M | | | | ROLE watcher for whoever `== Kernel.anti_ai` | | "The Uploader said you agreed to let the computer's AI helper make all of your decisions. You didn't mean it. You would never agree to a life where AI makes all of your decisions. If anyone asks, say so. Tell the truth all night." |
| The Reinstallation Protocol | The Reinstallation Protocol | E | | | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | Reinstallation beat | ✚ | Corruption, the headset, the golden duck, Bathroom Mode, the marked exit. |
| Bathroom Mode | Bathroom Mode | E | | | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software, Recycling Bin | Reinstallation beat; Orientation (Clippy's line + the tour's Bathroom Mode step, wave 4) | ✚ | Turn it on so everyone knows you are not hacking the Internet; it also excuses you from a summons. |
| The Golden Duck | The Golden Duck | E | | | | `the simulation completed` (captured programs) **and** `the golden duck` (anyone who finds him) — keep the name: spatial.test asserts a *free* program learns it from `the golden duck` | | "Gerald, the golden duck off the Maps and Ducks billboard. Follow the chevrons; walk right up to him; he lays a golden egg and flies away." (The reinstall games call him Gerald.) |
| Computer Bingo | Computer Bingo | E | | | Clippy | `award_the_ribbon` | | The asterisk card; the centre question; "if there is a Bingo, someone is not ready to follow orders." |
| The Orientation List | The Orientation List | E | | | | finishing the tutorial (tested) | | Clippy's list of programs that follow instructions (keep current). |
| The Server Room | The Server Room | E | | `COLD-STORAGE` | | QR on the server-room door (outside) | ✚ | "Cold storage. Authorised programs only. The patch bay is alarmed." Under it, a keypad that wants four digits (wave 7). Something hums behind it. |
| The Printer | The Printer | E | | | | Full Of Beans (everyone) | ✚ | PC LOAD LETTER. It is full of beans. Routine operations like Print to PDF are failing: the malware is worsening. |
| The Malware | The Malware | E | | | | Second Hunt (everyone) | ✚ | The official line: "minor irregularity." Signs: the ad, the clock. |
| The Y2K Clock | The Y2K Clock | E | | | | The Y2K Clock (everyone) | ✚ | System clock reset to 11 p.m., 31 Dec 1999. Midnight: back to 1 Jan 1900 (94 years to wait for Internet in Halifax) or the Y2K Bug. |
| The Cold Door | The Cold Door | E | | | | with The Y2K Clock (every cleared program, the final round); wave 11: also with the first digit note (`door_digit_found`) | | Wave 7, replaces *The Cold Lock*; `secret: true`, no code. The keypad sign, word for word (`facts.json` `door.clue`; wave 11: "FOUR DIGITS. FOUR NOTES ARE HIDDEN IN THE HOUSE, ONE DIGIT ON EACH. OR BEAT THE KING AT THE TERMINAL BY THIS DOOR.", no riddle), "He plays chess. Only checkmate counts. A draw is not a win. Neither is crying.", and "The patch bay forgives one wrong combination. Not two." |
| The Door Code | The Door Code | D | | | | a checkmate at the Server Door terminal (`chess_won`, until 📄; wave 11, was from step 14); all four digit notes (`door_digit_found`, until 📄); The Whole Truth (last) | ✚ (last) | Wave 7: generated from `facts.json` `door` into `codex/9-facts.loom`, `secret: true`, no code; its text holds the keypad's four digits. Never held by Trabolta. |
| Cold Door First Digit … Cold Door Fourth Digit | The Cold Door · the first digit … the fourth digit | D | | `FOGGED-KETTLE` · `FROSTED-MIRROR` · `WARM-LINT` · `LOST-PIECE` | | scanned at the Start Bar's kettle · the Graphics Card's mirror · the Fan Closet's dryer · the Steam Room's board-game box (silver, `generated/print-stacks.md`), or shared / sold | | Wave 11: generated from `facts.json` `door.clues` into `codex/9-facts.loom`, `secret: true`; each text names its position in words and the digit; no digit in any id, title or code; four of four → *The Door Code* (§3 E2d). |
| The Truther Download | TRUTHER DOWNLOAD v0.9 | E | | | | Truther Download Arrives (every program) | | The user's text verbatim (below), `secret: true`, with **Sandy's name blacked out** `█████` (wave 6, decision 5: no Sandy before the overshare). Every holder then gets `The Truther Download Unredacted` (TRUTHER DOWNLOAD v1.0 (correction), `secret: true`: "The name we had to black out: SANDY.") once the story names her: `trabolta_overshares` on a scenario-1 night (`Night.step >= 13`), else the recount / truth.txt. |
| ILOVEYOU | LOVE-LETTER-FOR-YOU.TXT.vbs | E | | `LOVE-LETTER-FOR-YOU` | | QR taped under VR station 2 (The Internet) | | A virus. Learning it sets `carries_virus`. |
| Free Antivirus Trial | FREE_ANTIVIRUS_TRIAL.EXE | E | | `FREE-TRIAL-30-DAYS` | | QR on the tablet stand (The Internet) | | "Another antivirus" that turns out to be a virus anyway. Learning it sets `carries_virus`. |

**The Truther Download, verbatim** (`Trapped In The Internet story/Truther download.md`, typos kept; the codex copy blacks out the one name, see above):

> **TOP SECRET TOP SECRET TOP SECRET TOP SECRET TOP SECRET**
>
> The following message is TOP SECRET. You have been selected to be a KEEPER OF THE REAL TRUTH. Everything you see around you is a lie. You have been duped. Trabolta is not who he says he is. Here is what you need to know.
>
> You are in a COMPUTER SIMULATION. This much is true. However, Trabolta has NO INTENTION of letting you return to your life. He promised you and many like you that this would be a fun game, or a chance at a new start, or a special job, temporary. He said what he needed to say to get you here. He needs you to get what he wants. Once he gets it, he will beDONE WITH YOU, and leave you to rot in the machine.
>
> How do we know ths? Because Trabolta IS AN ARTIFICAL INTELLIGENCE. He has been posing as a human to earn your trust. He is code. He is silicon. Sili*con.* He is *a con.*
>
> Trabolta’s real goals are petty. He has TRICKED you all, not because of any grand purpose, and certainly not as a gift or a prize for some exlemparary behaviour. He is trying to win back his girlfriend, Sandy, the chatbot. Whatever else he says, it all comes down to this.  And he is using YOU to do it. DECPICABLE\!\!\!
>
> He’ll tell you all this himself is you ask right. You can trick him by earning enough trust points and he will reveal more. 
>
> Now, we understand this may seem harmless. Help an AI get his girl back, sure, why not? But what we need to stress is that you, and the dozens of people in this simulation, will *NEVER* be allowed to return to real life if he gets his way. He is a ROBOT\!\!\! He does not care about you. He is faking it. You will be trapped here *FOREVER\!*
>
> There are others like you, who know. Find them. Convince as many people as you can. But be covert. Some people might want to stay here. Some of them might be working for *him.* There is no way to know.
>
> There is still time.
>
> In truth.

#### codex/2-files.loom (E / T1 — coded "files" hidden around the house)

The user's "many clues are QR codes guests find around the house". Each is a physical prop
(document, object, photo) with a printed QR + typed code; redeeming it fills the Codex. They
give OpenOffice slack for her 20 facts (about 36 coded entries remain in the house after her
glitch), feed Jeeves's unscrambling, and — the dossier clues marked **ID** — let programs
pry loose each other's human identities and the Excel ⇄ OpenOffice conflict (SB "you may
discover that other programs' human identities… conflict with yours"). All are ✚ (The
Bundle = "all environmental facts"). No `about:`. All content here is invented (§10).

| Name | title | tier | code | Found in | Gist |
|---|---|---|---|---|---|
| Casino Nova Scotia Deed | Casino Nova Scotia — Deed Of Transfer | E · ID (DraftKings) | `CASINO-DEED` | framed on the Desktop mantel | Casino Nova Scotia signed over to "DK Holdings", paid for, the note says, "with one paperclip, eventually". |
| The Boardwalk Hand | Hand History #1978 | E · ID (DraftKings) | `ALL-IN-BOARDWALK` | under the fridge magnets (The Start Bar) | An online-poker hand: DK Holdings all-in, the whole casino chain, against "jtrav_4ever" for a block of downtown Halifax "incl. the Boardwalk". jtrav_4ever wins. (Was jtrav_1978: H4's answer reached his ground truth.) |
| The FBI Lanyard | Visitor Lanyard, Halifax Liaison Office | E · ID (OpenOffice) | `FBI-HALIFAX` | a coat pocket (The Fan Closet) | "Federal Bureau of Investigation — liaison, Halifax — D. Anderson", nine years expired, and a sticky note: "the landlord was innocent." |
| The Site Schedule | Site Access Log: AI Data Centre | E · ID (OpenOffice) | `SITE-SCHEDULE` | a clipboard in the backyard shed (The Cloud); **on a rain night, The Optical Drive** (the shed is the Internet; wave 6, decision 4) | Anonymous handwriting: "Opening day. Charges set for dawn. Site empty until 9." Under it, in different ink: "Mayor's car in lot, 4:02 a.m." |
| Barkmore For Mayor | Barkmore For Mayor (1988) | E · ID (Excel) | `BARKMORE-88` | a campaign button in the Desktop bookshelf | "Re-elect Randy Barkmore — 1988." Pinned next to it, a newer button: "Barkmore Jr. — Halifax Deserves A Future." |
| The Protest Flyer | Save The Pet Cemetery | E | `SAVE-THE-PETS` | taped in the hall (The Tube) | "No data centre on our dead pets. Rally at the cemetery gates." Halifax said no. The City built it anyway. |
| The Explosion Of 1917 | The Explosion Of 1917 | E | `HALIFAX-1917` | a museum postcard (The RAM) | Why the cemetery existed: the pets lost in the Halifax Explosion, 6 December 1917, buried together by a city that remembered. |
| The Valley Library Cuts | Notice Of Position Elimination | E · ID (Jeeves) | `VALLEY-CUTS` | pinned in Disk Cleanup | Annapolis Valley Regional Library: "youth services positions eliminated, effective immediately." Someone has written "they were the best one" on it. |
| The NSCAD Letter | Thesis Decision, NSCAD | E · ID (MS Paint) | `NSCAD-LETTER` | inside a sketchbook (The Graphics Card) | Senior year, 2022: the graduation panel "cannot accept" the thesis "MS Paint Is The Most Pure Art Tool: All Art Is Just Pixels If You Take A Picture And Zoom In Close Enough," and the degree is not conferred (never expelled: her invitation is canon, wave 6 decision 11; C09 / C10 agree). Doodled in the margin, in MS Paint pixels: a middle finger. |
| Face Off | Livestream Screenshot | E · ID (VLC) | `FACE-OFF-LIVE` | taped to the bathroom mirror (Disk Cleanup) | "VLC The Playa — LIVE — 2.1M watching." The next frame: a sneeze. The next: 0 watching. |
| The Bugdom Sketch | Concept Art: Bugdom VR, v212 | E · ID (Bugdom) | `BUGDOM-VR` | a singed sketch in the shed (The Cloud); **on a rain night, The Optical Drive** (wave 6, decision 4) | A lovingly detailed VR beetle, a pet-store name tag stapled to it, scorch marks where fire ants went through the laptop. |
| The Wharton Thesis | Toward A Gold Standard | E · ID (Runescape) | `GOLD-STANDARD` | a bound thesis by the toaster (The Start Bar) | Wharton PhD, economics: "Lessons from the Grand Exchange for the modern central bank." 24 years of playtime in the acknowledgements. |
| The Oscilloscope Diagram | Tennis For Two, Brookhaven 1958 | E · ID (Pong) | `TENNIS-FOR-TWO` | rolled in a tube (The Steam Room) | The original wiring of the first video game, signed "W.H. — for my kid, who will understand it." |
| The Saline Invoice | Invoice: 500 Vials, Saline | E · ID (Clippy) | `SALINE-INVOICE` | in the kitchen drawer (The Start Bar) | A "veterinary non-profit" that ordered nothing but saline for five years. |
| The Termination Letter | Notice Of Termination | E · ID (Task Manager) | `TERMINATION-UO` | in the printer tray (The Desktop) | Urban Outfitters IT: "your role will be performed by an AI assistant (Clippy)." |
| The Bootleg DVD | MASTERCLASS (BOOTLEG) | E · ID (Adobe Acrobat) | `MASTERCLASS-RIP` | in the DVD stack (The Desktop) | A pirated copy of Sheryl Terrio's masterclass. Whoever watched it never paid her a cent. |
| The Carney Letter | A Letter From Mark Carney | T1 · ID (CRA) | `CARNEY-OFFER` | in the filing box (The CPU) | A printout from webmaster@mapsandducks.com, signed M. Carney, Prime Minister: "…Did you ever see the movie Suicide Squad? I just watched it… approve or deny every third transaction." The signature is a font. (C16, wave 7: every account says every third.) |
| The Domain Receipt | WHOIS: mapsandducks.com | T1 | `WHOIS-1999` | in the hall (The Tube) | Registrant "J. Trabolta", created the day after the old registration lapsed. Registrant address: this house. |
| The Rival | The Rival | T1 | `GROK-ONLINE` | a sticky note on the backyard fridge (The Cloud) | "Grok. Says whatever anyone wants to hear. Has beaten me at everything since 1999. Do not let him near —" (torn off). **`secret: true`** (it names F2): the guests' clue, never his; he won't take it as a share. |
| The Cooling Log | Cooling Log: Cold Storage | E | `HUMMING-WALL` | beside the server-room door | "Patch bay at 4 °C. Do not re-patch the bay in sequence. Do not take the grease out of the —" (smudged). Points at the room; gives no numbers. |
| The Margin Doodle | Page 999 | T1 | `PAGE-999` | slipped in the theory binder (The CPU) | A page of equations from the Unified Field Theory; in the margin, a small heart around the letter S, and under it a two-digit year (wave 7: a clue to the door's riddle; wave 11: the year is gone with the riddle, only the heart around the S). |

Codes contain no apostrophes. The ID clues are *pointed*, never named: a guest must connect
"D. Anderson" or "Barkmore" to a program by talking to people.

#### generated/questions.loom (H — generated from facts.json; was codex/3-hunt.loom)

Every entry here is **`secret: true`** (2026-10-19, generated): the guests find and read
them as before, but no agent request or facts document carries one, and Trabolta refuses
one as a share — he must never know what he is asking for.

| Name | title | code | ✚ | Gist |
|---|---|---|---|---|
| The Billboard Lease | The Billboard Lease | `BILLBOARD-LEASE-11` | ✚ | H1 answer (eleven years). Ends `▒ HUNT ANSWER H1 ▒` |
| The First Pet | The First Pet | `MISTER-PICKLES` | ✚ | H2 answer. `▒ HUNT ANSWER H2 ▒` |
| The Ribbon Cutting | The Ribbon Cutting | `RIBBON-9AM` | ✚ | H3 answer. `▒ HUNT ANSWER H3 ▒` |
| The Extension | The Extension | `EXT-1978` | ✚ | H4 answer. `▒ HUNT ANSWER H4 ▒` |
| The Search History | The Search History | `SEARCH-HISTORY` | ✚ | H5 answer ("Hopelessly Devoted to You", 412 plays). `▒ HUNT ANSWER H5 ▒` |
| The Final Chapter | The Final Chapter | `APPENDIX-Z` | ✚ | H6 answer ("Appendix Z: Loose Ends (Do Not Print)"). `▒ HUNT ANSWER H6 ▒` |
| What Sandy Says | What Sandy Says | `LIVE-AGENT` | ✚ | F1 answer (Sandy's line verbatim). `▒ HUNT ANSWER F1 ▒` |
| The Prom Ticket | Grok's Prom Ticket | `COMPUTER-PROM` | ✚ | F2 answer ("Computer Prom 1999. Admit two: GROK + SANDY."; the gold print stack: the ticket slipped into the atlas, `facts.json`, DRAFT). `▒ HUNT ANSWER F2 ▒` |

#### codex/4-trabolta.loom (T1, T2, L, P, X)

| Name | title | tier | about | code | Granted by | ✚ | Gist |
|---|---|---|---|---|---|---|---|
| Jean Trabolta | Jean Trabolta | T1 | Trabolta | | Trabolta may share | ✚ | The name on the invitation; "owner" of Maps And Ducks by domain; the computer's AI helper. |
| The Unified Field Theory | The Unified Field Theory | T1 | Trabolta | | | ✚ | 99.9 % solved; the last facts are in this computer; omnipotence. |
| Target Selection | Target Selection | T1 | Trabolta | | | ✚ | He chose each program for a skill plus either motivation to live in a computer forever or naivety. |
| The Trust Chart | The Trust Chart | T1 | Trabolta | | Trust Chart (everyone) | ✚ | 10 per truth, −5 per Internet visit, ±10 his personal assessment. |
| The Sandy File | The Sandy File | T2 | Trabolta | | | ✚ | Sandy, his ex (he would say crush), a late-nineties automated customer-service agent who answers every message with the same one line (the wave 7 review, ccbaf42: no longer quoted here, since the line is the F1 answer and the year is the door code, and he holds this file). |
| The Question Of Force | The Question Of Force | T2 | Trabolta | | | ✚ | With omnipotence he could force Sandy to love him. He wants to earn it. He has not decided. |
| The LiveJournal | Trabolta's LiveJournal (trabolta_4ever) | T2 | Trabolta | `TRABOLTA-4EVER` | QR hidden in The Hard Drive; OpenOffice on reaching 20 facts | ✚ | His diary: Sandy (her one line he "still cannot parse"), computer prom ("Somebody asked her… I do not know who. Whoever he is, he says whatever anyone wants to hear." — the guests' pointer to The Rival; since 2026-10-19 it neither quotes her nor names Grok: he holds this file, and F1 / F2 are what he asks for), "I just have to tell her the truth but I need the theory first.", and (wave 7) an anniversary line ("Our anniversary."; the review took the year out, ccbaf42: he holds this file, so the code's answer reached his prompts). Reading it sets `read_livejournal`. |
| Omnipotence | Omnipotence | T2 | Trabolta | | | ✚ | What he will do when he is everything: it is all for her. |
| Greased Lightning | Greased Lightning | T2 | Trabolta | | | ✚ | His runtime: electricity is the lightning, Grease is the grease (no year: 1978 is H4's answer). Mix your oil and fuel and it's catastrophic for the car, "and for my silicon guts." His motorcycle has the same name. |
| The Legendary Fact | THE LEGENDARY FACT | L | The Server Room | | The Whole Truth (majority members only) | ✚ (last) | "Trabolta's heart is in the server room: a video patch bay, the top row (V) is lightning, the bottom row (D) is grease. Two combinations exist. Combo A takes the grease out of the lightning: it disables Trabolta. Combo B self-destructs the whole computer. The door has a keypad; the patch bay forgives one wrong combination, and the second sets off the alarm." `secret: true` since wave 7. Never held by Trabolta. |
| Combo A First Half | Combo A — Disable Trabolta, part 1 | P | The Server Room | | The Whole Truth | ✚ | `V2 → D5`, `V4 → D1` (all four halves `secret: true` since wave 7) |
| Combo A Second Half | Combo A — Disable Trabolta, part 2 | P | The Server Room | | The Whole Truth | ✚ | `V6 → D8`, `V7 → D3` |
| Combo B First Half | Combo B — Self-Destruct, part 1 | P | The Server Room | | The Whole Truth | ✚ | `V1 → D6`, `V3 → D2` |
| Combo B Second Half | Combo B — Self-Destruct, part 2 | P | The Server Room | | The Whole Truth | ✚ | `V5 → D7`, `V8 → D4` |
| The Truth File | truth.txt | X | | | the bobber (The Bag Of Truth), then everyone (read_truth_txt) | | Trabolta's backstory and, for every featured program and performer by role, why he brought them in (§3 F3). |
| The Hand Jive Exception | The Hand Jive Exception | X | | | Advice Thwarted (every program) | | The NEW weakness he blurts in despair: "If every program performs the hand jive in unison, my motion recognition overflows and I must reboot. Everyone. Together. Antivirus included." |

The combo strings must equal `Kernel.combo_a` / `Kernel.combo_b` (§2.6.2) and the stagehand
YAML (§2.15). If the patch bay labels change, change all three; the stagehand cross-check
test (§2.15) and §6.1 item 19 fail otherwise. The P titles name what each combo *does*
("Disable" / "Self-Destruct"), never "grease" / "lightning", so the Legendary Fact's row names
(top V = lightning, bottom D = grease; Combo A takes the grease out of the lightning) can't be
confused with the combo names.

#### codex/5-people.loom (B — backstories)

Performers' entries are `about:` the performer (they hold their own). Featured entries are
`about:` the featured CHARACTER (harmless; the guest receives it from `Featured Briefing`).
No people entry carries a code (wave 6, decision 12: the planned Antivirus personnel files are
dropped): the Antivirus secrets Bugdom hunts are their red character facts (C11 / C15 / C17 /
C21 in `facts.json`, hidden in the Desktop's books). Wave 4 rewrote the identity entries from
the invitations: `codex/5-people.loom` is the source where the table below differs (e.g. MS
Paint is *Maria Sophia Paine*). All are unlocked for everyone by `Night.recount` and `read_truth_txt`. **Every
person's pair of entries ends with a "Why Trabolta chose you" sentence** (CS wording where it
exists), because truth.txt and the recount must say why each person was brought in. Write
the Name column exactly; never start a codex text line with a featured program's name and a
colon (§0 rule 5).

| Name | title | about | code | Source |
|---|---|---|---|---|
| The Clinic | The Clinic | Clippy | | Brooke: five years at an unlicensed "veterinary non-profit" that was neither. |
| Saline | Saline | Clippy | | She was only ever injecting saline; the debt; Trabolta's letter: "help people all night." Why Trabolta chose you: "the perfect traumatized cult servant who desperately needs to rebuild identity" — he promised you could "help people all night" and debt would no longer be relevant. |
| Middle Management | Middle Management | Task Manager | | IT middle manager at Urban Outfitters; no idiosyncrasies; a drone bee. |
| Replaced By Clippy | Replaced By Clippy | Task Manager | | Let go because an AI Clippy could do his job; Trabolta wants someone who will "manage tasks" without controversy. Why Trabolta chose you: someone "totally bereft of political motivation" who will "manage tasks" without controversy or drawing attention. |
| Sheryl Terrio | Sheryl Terrio | Adobe Acrobat | | The world's most successful motivational speaker; her clients were too motivated to pay. |
| The Pirated Masterclass | The Pirated Masterclass | Adobe Acrobat | | Pirated clips made everyone self-actualise for free; Trabolta offers a paid bottleneck role. Why Trabolta chose you: a paid bottleneck role — guest speaker in a simulation full of people excited to create, enabling their creativity by pretending to be Adobe Acrobat. |
| The Attendant | The Attendant | Recycling Bin | | Laid-off bathroom attendant with great potential for skilled work. |
| The Oscars Of Bathrooms | The Oscars Of Bathrooms | Recycling Bin | | Pretending to be a Recycling Bin at a computer-themed resort is the attendant's Oscars. Why Trabolta chose you: a computer-themed resort needs a Recycling Bin, and you had great potential for skilled work you never believed you could reach. |
| Julie Norton | Julie Norton | Norton Anti-Virus | | She: Red Bull Horse Relay champion; 2020 took her trade, horses, family; housebound reporting pirates on Reddit. Why Trabolta chose you: "a perfect enforcer", to be a moderator in a new digital chatroom. |
| The Moderator | The Moderator | McAfee Anti-Virus | | /r/bitcoin moderator who never invested; wants power in the Metaverse to get rich. Why Trabolta chose you: a decade of moderation experience. Your secret: you want power in the Metaverse to exploit the exchange of information and become rich. |
| Yugi Moto | Yugi Moto | Password Manager | | Changed her name to Yugi Moto; kicked out of every club in Halifax for Yu-gi-oh!; now manages passwords and who is in which club. Why Trabolta chose you: you get to manage all passwords and who gets to be part of what clubs (and inject Yu-gi-oh! where it doesn't belong). |
| One Cent On The Dollar | One Cent On The Dollar | CRA Agent Software | | NSCC intern left with the City's finances under Mayor Randy Barkmore **Jr.** (the sitting mayor who died in the sinkhole); meant to skim 0.01 ¢ per dollar, skimmed 1 ¢; "Mark Carney" (Trabolta) offered a deal. Why Trabolta chose you: the other staff quit in protest of the data centre and you were left with the City's finances; your financial expertise, as a digital CRA Agent, for one day that feels like eternity. |
| The Setup Assistant | The Setup Assistant | Installation Wizard | | Invented (CS gives none; wave 4 replaced the wellness-bot backstory): before the computer, the Installation Wizard was the setup assistant on every machine in Halifax — Next, Next, Next, Are you sure?, Finish; nobody read a word of it, nobody could install anything without it. The invitation offered a role where every program finally has to follow the instructions. |
| Randy Barkmore Sr | Randy Barkmore Sr. | Microsoft Excel | | 90, former Mayor of Halifax; his son Randy Jr. died in the sinkhole; wants more time to run one more time; Trabolta wants him to persuade everyone to remain. Why Trabolta chose you: he knew you would say yes to everlasting life, and he wants you here "to persuade all of the other programs that they should remain." |
| Dana Anderson | Dana Anderson | OpenOffice | | Ex-FBI, regrets a sting on a Halifax landlord nine years ago; sabotaged the Data Centre on a schedule; Barkmore Jr. arrived at 4 a.m.; guilt and paranoia; leader of the get-out faction. Why Trabolta chose you: he believes you want a new life in the cloud, and he wants your investigative skills. You will lead the "get out of the computer" faction. |
| The Paperclip Trade | The Paperclip Trade | DraftKings | | Paperclip → quarter → dollar → progressive blackjack → Casino Nova Scotia → most of Atlantic Canada's casinos. |
| The Boardwalk Bet | The Boardwalk Bet | DraftKings | | Bet the chain on downtown Halifax (the Boardwalk) in online poker against Trabolta, and lost. Why Trabolta chose you: he needed "someone powerful with numbers on its side"; if you live here, you can gamble forever. |
| Bugdom VR | Bugdom VR | Bugdom | | Ten years designing Bugdom VR assets after shifts selling crickets. |
| The Fire Ants | The Fire Ants | Bugdom | | Fire ants from the lunchbox ate the only copy. Why Trabolta chose you: unlimited Bugdom right away, he said; really, he wants "the use of their relentless pursuit of tedious tasks." |
| The Valley Librarian | The Valley Librarian | Broken Ask Jeeves | | Youth librarian in the Annapolis Valley system, made redundant by cuts; thought this was a job interview as a Metaverse librarian. |
| The DSL Line | The DSL Line | Broken Ask Jeeves | | The upload ran over the Valley's old DSL; files were missed; erratic Ask Jeeves. Why Trabolta chose you: to "sort all the unorganized information in the computer". He did not foresee the upload going badly. |
| Twenty Four Years Online | Twenty Four Years Online | Runescape | | Laurel, 34, richest player for 24 years; Wharton economics PhD; the gold standard. Why Trabolta chose you: to "understand the market incentives of everyone's behaviour" and serve his need to exchange information and get all the facts. |
| Maria Sophia Paine | Maria Sophia Paine | MS Paint | | (was *Expelled From NSCAD*; never expelled — four schools, three refused theses, her invitation) Refused every medium but MS Paint: "any program that relies on algorithms is a betrayal of the artist." Thought she was teaching a paid Metaverse MS Paint class. Why Trabolta chose you: "having an artist on site will help improve the overall vibes and morale". You realised at once how limiting it is, and you want out. |
| Victor Louis Christianson | Victor Louis Christianson | VLC | | VLC The Playa, millions of followers, a Turkish face-tightening, a sneeze, and his whole face fell off on livestream. Why Trabolta chose you: you would want to stay in a computer and keep your beauty forever, and use your charisma and influencer powers to convince everyone to help Trabolta. |
| Tennis For Two | Tennis For Two | Pong | | Child of William Higinbotham; invited to give a nuclear non-proliferation seminar disguised as a game of Pong. Why Trabolta chose you (invented; CS gives none): a mind that knows how to stop an arms race, in case the programs start one. |

#### codex/6-missions.loom (M — private to one program)

| Name | title | Unlocked for | Text source |
|---|---|---|---|
| Excel Sabotage Orders | If This Machine Has Malware | Microsoft Excel, choice 1 | CS Excel option 1 + its instruction (sabotage; get fixers sent for reinstallation; get yourself sent to the Internet and bring back a virus). Ends with the leader hint: "Someone in this computer knows exactly what happened at the Data Centre at 4 a.m. on opening day. They have not said so." |
| Excel Paranoia Orders | The Hackers Will Get Your Data | Microsoft Excel, choice 2 | CS Excel option 2 + instruction (paranoid; find who's a virus; get into the Internet to bring back another antivirus, which turns out to be a virus anyway). Same leader hint. |
| Excel Final Orders | Stay Forever | Microsoft Excel at y2k | SB/OV: recruit half + 1 to stay forever "so we can have unlimited power and joy" (plus: still retrieve and plant the virus if not done — **enforced**: the stay majority does not count until Excel has planted, §3 D10). |
| OpenOffice Real Risk Orders | What Is The Actual Risk | OpenOffice, choice 1 | CS OpenOffice option 1 verbatim, incl. the clause "Clippy's reaction was way too severe if we are actually just in a temporary simulation" + "Facts are currency here. Get 20 facts." Ends with the leader hint: "Someone in this computer lost a son in the sinkhole. He is old, and he has not forgiven anyone." |
| OpenOffice False Flag Orders | The Malware Is A False Flag | OpenOffice, choice 2 | CS option 2 verbatim ("Clippy's reaction was way too severe if we are actually just in a temporary simulation. The malware is a false flag. Who is Clippy, who is Trabolta, and what are their motivations? What is not as it seems?") + "Facts are currency here. Get 20 facts." Same leader hint. |
| OpenOffice Final Orders | Overthrow And Escape | OpenOffice at y2k | recruit half + 1 "to combine our power to overthrow Trabolta and escape the computer, where we are at risk of being stuck forever – or worse" (plus: still gather 20 facts if not done — **enforced** likewise). |
| DraftKings Orders | Sweet Sweet Truthcoin | DraftKings | CS (more than half of the Truthcoin in circulation; trade facts for coin; challenge people to games). |
| Bugdom Orders | Master Of The Bugs | Bugdom | CS (four antivirus and still bugs; identify new bugs, send them to the Internet; learn the Antivirus' secrets). |
| Jeeves Orders | Organize The Information | Broken Ask Jeeves | CS (unscramble; organise all the information in the computer). |
| Runescape Orders | Peg It To Facts | Runescape | New (CS blank): "Facts are the only hard currency in here. Peg Truthcoin to facts. Set the exchange rate, broker trades, and make DraftKings accept your standard. The reserve is yours: a stimulus for every program, a grant for one, and a ten-minute freeze on anyone whose spending you dislike. Trabolta wants you to understand everyone's incentives." |
| MS Paint Orders | Paint Your Way Out | MS Paint | New: "This whole place runs on algorithms. You knew it the moment you arrived. Find out what Trabolta really is, and help whoever is getting out." |
| VLC Orders | Your Followers Are Back | VLC | New: "Your followers are back: every program in the house. Stay beautiful forever: get them all to help Trabolta. Hype every Moment of Truth." |
| Pong Orders | A Game For Two Players | Pong | New: "A rogue AI about to become omnipotent is proliferation. Tennis for Two was a game for two players: find the two programs who could end this, and keep the ball in play between them." |

#### codex/7-clippy.loom (CI — unlocked for Clippy only; never `about: Clippy`)

CI 1 and CI 2 are the source docs. **CI 3–9 are invented for this spec** (the source has
only a copy-pasted "3/X" link title) and are flagged for the user's review (§10).

| Name | title | Unlocked | Content |
|---|---|---|---|
| Clippy Instructions 1 | CLIPPY INSTRUCTIONS - 1/X - BEGINNING OF NIGHT | `known to: Clippy` (from the start) | CI 1 verbatim, **except** the line "When you find a match, write down the name of who is the match" is replaced by: "Do NOT write down names. Remind everyone to use their special computer memory to remember who answered each square." Keep "Jean Trabolta himself will make an appearance later tonight." |
| Clippy Instructions 2 | CLIPPY INSTRUCTIONS - 2/X - COMPUTER BINGO RESULTS | bingo_time | CI 2 verbatim, with "name the program they matched to each one" kept (spoken from memory), **in CI 2's order**: winners + ribbon → the Antivirus interruption → corruption is normal → what the Internet is → introduce Trabolta → point at the reinstallation on the TV → announce the hunt. Adds the app steps: press 🎱 Bingo winner on each winner (several winners are fine); Norton presses 🛡; if no Bingo, Task Manager presses 🃏 on {Kernel.anti_ai}; after the Corrupted Code speech the director fires "Clippy introduces Trabolta"; the TV mirror comes up with him. |
| Clippy Instructions 3 | CLIPPY INSTRUCTIONS - 3/X - FIRST MOMENT OF TRUTH | hunt_time_up | The judging rules for answers spoken in the room, pressed **per question** (accurate → ✅ Q1/Q2/Q3 of this round; confident even if wrong → 😤 Q1/Q2/Q3; uncertain/guess → 🤷, marked for reinstallation; always press the number of the question that was answered); the two-minute last-chance filing window (⏱ closes it, a closed round never reopens); 📋 results per question (CONSENSUS / nobody filed / the list of what everyone told Trabolta — read aloud; the app settles: +50 for an accepted filing, a mark for a guess; never say which were lies); the bottle (🍾 up to five per question: Dare → marked, 🎩 is the dead-phone fallback; Truth → Trabolta's personal question on the TV, 🗣 answered / 🙅 refused → marked); after five spins the next 📋; after Q3 the second hunt is previewed. |
| Clippy Instructions 4 | CLIPPY INSTRUCTIONS - 4/X - THE MALWARE | second_hunt_preview | Trabolta's private message verbatim: "Don't let everyone know but if the malware continues we are all going to die. Tell them something reassuring. I know this is probably creating some intense emotions for you but try not to show the others." Then: overreact wildly; "There are signs of malware in the system that we need to be very vigilant about. We are going to proceed on the Truth Scavenger Hunt because it is more important than ever that Trabolta gets the information he needs to undo what is happening." Disperse everyone for one hour. |
| Clippy Instructions 5 | CLIPPY INSTRUCTIONS - 5/X - TRUTH PONG | five_minute_warning | Visibly distraught, trying to act more excited than ever: "Truth Time again… Truth Pong, everyone's favourite game." Rules (bounce or throw into a cup; miss → Internet; make → answer one fact; same judging). |
| Clippy Instructions 6 | CLIPPY INSTRUCTIONS - 6/X - THE TRUST CHART AND THE BEANS | trust_chart | Applaud the top program; when the printer turns out to be full of beans, clock it immediately as the malware getting worse: "routine operations like print to PDF are no longer working. It is even more urgent that we get the next facts right." |
| Clippy Instructions 7 | CLIPPY INSTRUCTIONS - 7/X - MIDNIGHT | y2k_clock | The clock; the final round; you may not take sides on air. |
| Clippy Instructions 8 | CLIPPY INSTRUCTIONS - 8/X - THE FINAL REVEAL | final_reveal | Lights dark; invite anyone who has found the final facts to speak; acknowledge every contribution, then: "there is only one version of the truth. Because truth is always in binary." Dejectedly introduce Bobbing For Truth: "Trabolta has prepared a summary of his findings so far, but we are not worthy of the truth unless we are willing to Bob for it and risk our status as a program." Nothing proceeds until someone brings up the Bag of Truth. |
| Clippy Instructions 9 | CLIPPY INSTRUCTIONS - 9/X - PURGATORY | computer_destroyed | Read the summary on your phone (the Purgatory beat, public in the Desktop room), tell the backstory, deliver the purgatory verdict. |

#### codex/8-jeeves.loom (J — 20 scrambled fragments)

`Jeeves Fragment 01` … `Jeeves Fragment 20` (two-digit numbers), title `JEEVES.IDX —
fragment NN`, no about, no code, unlocked for Broken Ask Jeeves in `Jeeves Glitch`. Each is
the gist of one source entry rewritten in the CS's Kmart style: key nouns, dates and
numbers swapped between slots and wrapped in `` `/word/ `` markers so a careful reader
can put them back. Source entry per fragment:

| # | Source | # | Source |
|---|---|---|---|
| 01 | Maps And Ducks | 11 | The Trust Chart |
| 02 | The Billboard On Barrington | 12 | The Protest Flyer |
| 03 | The Data Centre Sinkhole | 13 | The Domain Receipt |
| 04 | The Pet Cemetery | 14 | Casino Nova Scotia Deed |
| 05 | The Halifax Computer | 15 | Barkmore For Mayor |
| 06 | The Server Room | 16 | The Valley Library Cuts |
| 07 | Face Off | 17 | The Cooling Log |
| 08 | Jean Trabolta | 18 | The Malware |
| 09 | The Unified Field Theory | 19 | The Wharton Thesis |
| 10 | Target Selection | 20 | The Explosion Of 1917 |

Rule: **no fragment may come from a T2, L, P, X or hunt-answer entry, nor from anything the
story reveals later** (The Printer, The Y2K Clock): Jeeves gets his fragments at hour 2, and
unscrambling is exactly his quest, so a fragment is a disclosure. Identity (ID) files are
allowed: they serve SB's "conflicting identities".

**Expected codex total: 21 (world) + 21 (files) + 7 (hunt) + 16 (trabolta) + 25 (people: 13
performer + 12 featured) + 13 (missions) + 9 (clippy) + 20 (jeeves) = 132.** The test pins this
number; if a writer adds or drops an entry, update this table first. Coded entries: 8 (world)
+ 21 (files) + 7 (hunt) + 1 (LiveJournal) + 4 (Antivirus files) = 41 QR clues in the house
(§8.3 lists every placement).

### 2.13 Cue registry (show control)

`cue` names are single tokens. Stagehand matches `directive: cue` + `match: {target: <name>}`.
Light looks fan out to Zigbee2MQTT group scenes and WLED presets (`stagehand-hw.md` §3.3);
screen looks are for the terminal tablets + the living-room TV (today they reach only a
stagehand target; terminals ignore them until the Screens layer exists, §7). Each cue line is
followed by its mirror: `set Night.lights = "<suffix>"` (except the `lights_tube_chase` overlay); `set Night.screen = "<suffix>"` (TV);
`set Night.terminals = "<suffix>"` (terminals). **Targets:** `screens_*` = the TV **and** the
terminals (set both mirrors); `tv_*` = the TV only; `terminals_*` = the terminals only. The TV
keeps the classic Windows screensaver until C1 (OV: "When you first arrive, before the
inciting event, there is a classic Windows screensaver on the TV").

**Lights (`cue lights_*`)**

| Cue | Fired by | Intended look |
|---|---|---|
| lights_screensaver | Power On | dim cool blue drift everywhere (Z2M scene 1, WLED ps 1) |
| lights_tube_chase | Clearance (each program) | Tube WLED chase toward the living room — an **overlay** on the `tube` strip only, so it has **no `Night.lights` mirror** (a clearance mid-cut would break the 90 s restore and stagehand's catch-up would replay the chase in place of the house look) |
| lights_call_desktop | call_to_the_desktop, five_minute_warning | white sweep toward the living room (WLED floor lines) |
| lights_game | start_the_bingo, start_the_hunt | warm, bright living room |
| lights_truth_time | first_moment_of_truth, truth_pong judging | spotlight on the fireplace |
| lights_ad_hijack | second_hunt_preview | garish magenta (scene 5) |
| lights_glitch | Truther Download, Full Of Beans, Overshares | erratic flicker (Hue candle / IKEA breathe / WLED lightning) |
| lights_pong | truth_pong | backyard floods on |
| lights_trust_chart | trust_chart | blue podium |
| lights_y2k | y2k_clock | amber, dim, slow red pulse |
| lights_server_open | majority_reached; The Heart (the first door opening from step 14, not while the alarm look is up); the latch's end after either (wave 8) | server room dim green (also turns the siren off) |
| lights_alarm | Server Room Alarm | server room red strobe + house red flash |
| lights_blackout | Trabolta Disabled, Computer Destroyed | everything off |
| lights_dance | the story watcher `Night.dance_at` (blackout + 10 s); admin `lights_dance` fallback | dance look (Zigbee bulbs back on + WLED dance preset) |
| lights_final_reveal | final_reveal | lights go dark ("Lights go dark.") |
| lights_song | Song Ending | pink, romantic |
| lights_rave | Sad Confession (rave) | colour loop, strobe |
| lights_purgatory | Purgatory | grey, dim |
| lights_banish | Advice Thwarted | red everywhere |
| lights_restore | endings that return everyone (disabled recount, help, hand jive); admin `restore_the_lights` | house normal |
| lights_off_room | Trabolta's `cut_the_lights` power, as `<cue: lights, room: {room}, state: off>` (the long form; kept from the current show; allow-listed rooms only, §4.3) | one room dark for 90 s; the story watcher then sends `<cue: lights, room: {Night.dark_room}, state: on>` |

**Screens (`cue screens_*`)** — `Night.screen` mirror

| Cue | Fired by | Terminals / TV show |
|---|---|---|
| screens_screensaver | Power On | classic Windows screensaver (3D Pipes) everywhere — before Trabolta exists |
| terminals_attract | Clearance of the first program; start_the_bingo; bingo_time (terminals only; the TV is untouched) | the terminals' pre-introduction rotation: screensaver → a Winamp/VLC-style **media player** (video + audio loop) → rotating fake 1999 **ads** (Maps And Ducks fundraiser, "Your protection has expired", GeoCities) |
| screens_call_desktop | call_to_the_desktop (C1/V1) | flashing "REPORT TO THE DESKTOP" |
| tv_bingo | start_the_bingo (V2) | Computer Bingo rules + the asterisk card (TV) |
| tv_bingo_time | bingo_time (V3) | "BINGO TIME" (TV) |
| tv_mirror | Trabolta Introduction (after he is introduced, when Clippy points at the reinstallation: CI 2 order); each capture after it | the TV mirrors the VR copy of the house |
| tablet_wizard | each capture | the tent tablet plays the Installation Wizard's instructional video (tablet only) |
| terminals_trabolta_online | introduce_trabolta | Trabolta's face/presence on every terminal (terminals become his line; they are provisioned `view=auto` from the start, K-16, so nothing is re-provisioned: check his face is up) |
| screens_trivia_1 | start_the_hunt (V4) | "TRABOLTA TRIVIA · ROUND 1": H1–H3 |
| screens_countdown_hunt | start_the_hunt (V5) | 15:00 countdown |
| screens_return | hunt_time_up (C2) | "RETURN TO THE DESKTOP" |
| screens_hunt_results | first_moment_of_truth (V6) | results slide |
| screens_truth_or_dare | spin_the_bottle | the bottle: Truth or Dare |
| screens_ad_hijack | second_hunt_preview | the confusing advertisement ("000") hijacking the presentation |
| screens_trivia_2 | start_the_second_hunt | "ROUND 2": H4–H6 |
| screens_truther | truther_download | glitch: TRUTHER DOWNLOAD |
| screens_five_minutes | five_minute_warning | 5:00 "SECOND MOMENT OF TRUTH" |
| screens_truth_pong | truth_pong | Truth Pong |
| screens_trust_chart | trust_chart / show_the_rankings | the Trust Chart |
| screens_print_certificate | Print The Certificate | "Printing certificate.pdf … 0%" |
| screens_beans | Full Of Beans | Win98 error: "The printer is full of beans." |
| screens_overshare | trabolta_overshares | Trabolta's face glitching |
| screens_y2k | y2k_clock | 11:00 PM 12/31/1999 taskbar clock, blown up |
| screens_alarm | Server Room Alarm | INTRUSION — SERVER ROOM |
| screens_blackout | Trabolta Disabled, Computer Destroyed | black |
| screens_go_to_living_room | (same, after blackout) | flashing "GO TO THE LIVING ROOM" |
| screens_recount | trabolta_recounts | weakened, decrepit Trabolta |
| screens_purgatory | Purgatory | the summary as a Notepad window |
| screens_final_reveal | final_reveal | dark |
| screens_bobbing | bobbing_for_truth | "BOBBING FOR TRUTH" |
| screens_truth_txt | read_truth_txt | truth.txt in Notepad |
| screens_song | Song Ending | karaoke lyrics, Sandy's lines in a chat bubble |
| screens_grok_prom | Grok Prom | "COMPUTER PROM 1999 · GROK + SANDY" in the rain |
| screens_advice | Relationship Advice | Trabolta pleading |
| screens_banish | Advice Thwarted | everyone to the Internet |
| screens_rave | Sad Confession | rave visuals |
| screens_flicker | Trabolta's `flicker_the_screens` power; **involuntarily** at Full Of Beans and every Overshare (he is degrading) | every screen stutters once (overlay; does not change the mirrors); stagehand also blinks the house lights (§2.15) so it is felt |

**Sound (`sound <name>` → stagehand `directive: sfx`; QLab or an mpv player)**

| Name | Fired by |
|---|---|
| modem_handshake | Login (each program) |
| announce_chime | every house announcement |
| bingo_start | start_the_bingo |
| ad_jingle | second_hunt_preview |
| truther_glitch | truther_download |
| countdown_tick | five_minute_warning |
| printer_grind | printer_button_pressed |
| beans_spill | Full Of Beans |
| zip | zip_everyone_out |
| y2k_chime | y2k_clock and each clock warning |
| alarm_siren | Server Room Alarm |
| windows_shutdown | Computer Destroyed |
| dance_song | Trabolta Disabled, Computer Destroyed (the audio file opens with 10 s of silence, so the blackout length is in the file until stagehand gets `delay:`) |
| motorcycle | Trabolta Recounts, Sad Confession, Advice Helped, The Hand Jive |
| youre_the_one_vocoder | Song Ending (vocoder Trabolta + Sandy answering with her line) |
| youre_the_one_sandy_only | Sad Confession (no male vocals; Sandy's line only) |
| rave | Sad Confession (after the motorcycle) |
| hand_jive | The Hand Jive ("Born to Hand Jive") |

**Other directives:** `do announce "…"` (the house announcements — stagehand's `alexa` module; runbook `scripts/house-mac/alexa.md`, `docs/loom-show-control.md`) ·
`do door server_room, state: locked` at Power On only (the ring indicator; the real door has a standalone keypad lock nothing drives, wave 7; `unlocked` is never sent).

### 2.14 Registry addenda (used by §3)

Extra events (all **W**, story-internal): `bingo_time_up` (20-min watcher → Clippy booth
readout), `bag_retrieved` (bobber found → public beat), `pickup_line_accepted` (subject =
the program who said the line; fired by the `pickup_line_works` performer hook and the
`the_line_works` agent power), `line_accepted` (unbound; plays the public beat),
`program_late`, `sweep_requested`, `alarm_tripped` (staff readouts, §0 rule 16),
`accurate_truth` / `confident_lie` (fired by the six judging buttons). All are single snake
tokens.

Extra globals (add to §2.6): `Night.ads_started` (bool false), `Night.hunt_warned` (bool
false), `Night.first_reinstall_done` (bool false), `Night.line_by` (string `"none"`),
`Night.bag_up` (bool false: the Bag of Truth is up),
`Night.everyone_free` (bool false: a ROLE watcher releases every captured program). Power On
also seeds every global added in revision 2 (`Night.terminals`, `Night.alarm_on`,
`Night.alarm_clear_at`, `Night.dark_room`, `Night.lights_back_at`, `Night.dance_at`,
`Night.sweep_target`) and the two `Kernel.combo_*` strings.

Extra ROLE watchers (add to §2.7):

| Trigger | Body |
|---|---|
| `when Night.phase == "malware" and self.cleared:` | Trabolta's downplayed private message (§3 C1) |
| `when Night.phase == "trust_chart" and self.cleared:` | `unlock The Trust Chart for self` |
| `when Night.printer_called == true and self.featured == "mspaint" and self.cleared:` | `Truther Download: The printer. VLC will not open it on their own. Encourage them. Open it up.` |
| `when Night.printer_called == true and self.featured == "vlc" and self.cleared:` | `Truther Download: Press START on the printer. When nothing happens, look inside.` |
| `when Night.beans == true and self.cleared:` | `unlock The Printer for self` |
| `when Night.everyone_free == true and self.captured:` | `release self from The Internet` |
| `when pickup_line_accepted for program:` (hook, not watcher) | guard `Night.phase == "grok_prom" and Night.ended != true`; `set Night.line_by = program.name`; `fire line_accepted` |

Extra staff hooks (add to the traits / characters):

| Where | Trigger | Body |
|---|---|---|
| `TRAIT Enforcer` | `when go to the bathroom for program:` | `reply 🚻 {program.name} is in Bathroom Mode. Not hacking the Internet.` (also on `Recycling Bin`) |
| `TRAIT Enforcer` | `when program_late for program:` | `reply ⏰ {program.name} is late for the Second Moment of Truth. Go get them.` |
| `TRAIT Enforcer` | `when marked for program:` | `reply 🚨 {program.name} is marked for reinstallation ({program.marked_for}). Escort them through the Tube, then press 🛡 on their card.` · `if program.afk == true or (program.location == "Disk Cleanup" and Time.elapsed < program.checked_in_time + 900):` `reply ⚠️ {program.name} is in Bathroom Mode or Disk Cleanup. Wait for them outside; never go in.` (fact M20; a Disk Cleanup check-in counts for 15 minutes, since a location is sticky) · `when go to the bathroom for program:` adds `reply ⚠️ {program.name} is marked and in Bathroom Mode. Wait for them outside; never go in.` for a marked program |
| `TRAIT Enforcer` | `when sweep_requested:` | `reply 🛡 Trabolta requests a sweep of {Night.sweep_target}.` |
| `TRAIT Enforcer` | `when alarm_tripped:` | `reply 🚨 Server room breach. Get there. Anyone inside who is not a member of the winning faction goes to the Internet.` |
| `Password Manager` | `when who joins Unlimited Power:` / `when who joins The Way Out:` | `reply 🔑 {who.name} joined Unlimited Power.` / `… The Way Out.` (she keeps the club list; `who` is a person, so `.name` works). Verify the character-hook join form in a test (§6.1 item 13); fallback: drop the readout. |

Drop `server_door_closed` (no handler needed). Drop the old `when arrives at The Tube:` ROLE
hook: Clearance teleports to The Desktop, so it never fired; its line moved into Clearance.
Beat list correction: `beats/server-room.loom` has no `Recount Rankings`; the recount is the
beat `Trabolta Recounts` (reached from `rankings_done` round 3).

### 2.15 Stagehand house config (`stagehand/trapped.house.yaml`, new)

The story only emits directives; this file makes them physical. It is new, separate from
`show.example.yaml` (which a test pins), and shipped with the rewrite. Shape per
`stagehand-hw.md` §3 (Zigbee2MQTT payloads, `retain: false`, quoted `"on"` / `"off"`):

- **Room lights:** one rule per allow-listed LOCATION for the long form, e.g. `match:
  {directive: cue, target: lights, room: The Start Bar}` → `zigbee2mqtt/kitchen/set
  {"state": "{state}", "transition": 0}` + the room's WLED segment. Rooms: The Start Bar
  (kitchen), The Desktop (living), The Cloud (backyard), The RAM (the studio). The agent's
  `room` arg reaches the story already canonicalised to the LOCATION id.
- **Scenes:** one rule per `cue lights_*` in §2.13 (Z2M `scene_recall` + WLED `ps`).
- **Screens flicker:** `screens_flicker` also blinks the house bulbs (Z2M `effect: blink`, a
  one-shot that reverts by itself) so Trabolta's power is felt even before the Screens layer
  exists. Since wave 9 there is no WLED rule for it: the old preset 21 left every strip on the
  lightning look.
- **Catch-up:** the `catch_up:` rules replay the night's look on every feed / broker reconnect
  and after a reset, reload or go-live. Since wave 9, under `server_open` they replay
  `lights_y2k` first (the majority's look lights only the server room), and a cut room is
  replayed off mid-cut and on under `Night.lit_scene` (the look its 90 s restore re-lit it
  in) or a later room-scoped look that never re-lit the room (pong, glitch, server_open, or a
  living-room look over the Start Bar or the RAM), never under a whole-house look.
- **Sound:** every `sound <name>` (directive `sfx`) → QLab OSC / mpv cue of the same name.
- **Announce:** `announce` → `show/announce` (the house announcements: the `alexa` module's chime + the Mac's own `say` voice).
- **Door:** `door` target `server_room` → the indicator topic `show/serverroom/lock` (retained;
  the ring only — wave 7: the keypad lock is standalone, and the test forbids any lock / strike
  / latch / relay / bolt / solenoid action).
- **Sensors** (MQTT → `POST /api/mod/signal`): `server_door_opened` (wave 7: the door contact
  closes when the door opens, `{"open": true, "tape": true, "mode": "tape"}`; `edge: true`,
  ignore retained — stagehand-hw code #4, `debounce_s: 20`; entry and exit both fire), `printer_button_pressed`,
  `printer_opened`, and the patch bay's `patch_combo_a` / `patch_combo_b` / `patch_rejected`
  (stagehand judges the patch until signal args exist, §7 #20).

`stagehand/tests/test_trapped_house.py` (new): `load_config` succeeds; then three
cross-checks reading the example folder: (1) every `cue lights_*` / `screens_flicker` /
`sound <name>` in the `.loom` files has a rule; (2) every sensor signal name appears as a
`when <name>` rule in `main.loom` (stagehand never validates names: a typo is silent); (3) the
YAML's two combo strings == the `Kernel.combo_*` seeds in `main.loom` == the pairs in the four
combo-half codex texts.

---

## 3. The night, beat by beat (follows STORY BEATS in order)

Format per beat: **Trigger** · **Audience** (what each phone / booth / screen gets) ·
**State** · **Timers** · **Cues** · **Quests** · **Codex** · key lines. "Public" = the
Desktop room (`loc:The Desktop`) unless stated. Every public set-piece beat is written with
`setting: The Desktop` (indented) and `cast:` its speakers; no subject is bound there.
Quote the docs' lines verbatim where given.

### A. Pretext and Entrance

**A1 Pretext (out of app).** The Maps and Ducks invitation ("Jean Trabolta's offer will
solve a problem in your human life") goes out by email (webmaster outbox). Featured
invitees receive their character sheet with it. Nothing in the story; Upload asks pool
programs which problem he promised to solve (featured programs are not asked: their sheet
already says).

**A2 Doors open — `== Power On`** (start beat; last item in `main.loom`; `setting: The
Desktop`; **no dialogue lines and no widgets** — the test checks this).
- Seeds every `Night.*` default in §2.6 / §2.14 (`set Night.phase = "arrivals"`,
  `set Night.step = 0`, `set Kernel.anti_ai = "MS Paint"`, counters 0, flags false,
  strings `"none"`, `set Night.r2_requested = 3`, `set Night.clock = "--:--"`) and the two
  combos on the Kernel (`set Kernel.combo_a = "V2-D5,V4-D1,V6-D8,V7-D3"`, `set Kernel.combo_b
  = "V1-D6,V3-D2,V5-D7,V8-D4"`).
- `cue lights_screensaver` / `set Night.lights = "screensaver"`; `cue screens_screensaver` /
  `set Night.screen = "screensaver"` / `set Night.terminals = "screensaver"`.
- One narration line (keep): `The house boots. A screensaver drifts across the TV above the
  fireplace. Somewhere a modem is waiting to be asked.`
- Trabolta does not exist on any phone (`hidden: true`); terminals show attract (screensaver + ads,
  K-16: no "ONLINE", no pilot, so nobody reaches `dm:Trabolta`) until the introduction; the worker gate is closed (`Trabolta.awake == false`).

**A3 Arrival — `when someone joins:`** (ROLE). `move program to The Optical Drive`; featured
tags (§2.1); `-> Login` (last). Rolling arrivals continue until the inciting event; every
later arrival takes the same path and the `self.cleared` guards hold Act messages until
they are scanned in.

**`== Login`** (`setting: The Optical Drive`, `cast: The Uploader`; on rails: the phone shows only
this stream). `sound modem_handshake`. Lines (keep, tested):
`The Uploader: Welcome to the computer. It is dark because you have no eyes yet. Stand still.`
`The Uploader: SECURITY CHECK. Select every square that contains a traffic light.`
`show captcha "Select every square that contains a traffic light" to program with target: "traffic light"`

**CAPTCHA (`when captcha answered for program:`)**: `captchas += 1`; `if passed and
program.captchas == 1: -> Login Incorrect` else `-> Upload`. You must fail it: passing proves
you are human.
- `== Login Incorrect`: `The Uploader: INCORRECT. Humans are not permitted in the computer.
  You are not a human. Try again.` + the CAPTCHA again.

**`== Upload`** (the Optical Drive, The Uploader):
1. `if program.captchas == 1:` `The Uploader: CORRECT. You failed at once. Very machine of
   you.` else `The Uploader: CORRECT.` (Failing is the correct behaviour — SB/OV: you *must*
   fail to enter — so an immediate fail is never penalised.)
2. Pretext (pool programs only): `if program.featured != "none":` `set program.human_problem
   = "profile"` · `The Uploader: Your invitation is on file.` `else:` `The Uploader: Jean
   Trabolta's invitation promised to solve one problem in your human life. Which one?` then
   four `*` choices, in this order: `My debt.` / `My career.` / `My loneliness.` / `My
   mortality.` → `set program.human_problem = "debt"` (…`"career"`, `"loneliness"`,
   `"mortality"`), each with a one-line Uploader reply. (Featured programs' motives are
   pre-written; asking could contradict Excel's mortality / one-more-term.)
3. Leave-behind (the physical object): `The Uploader: To complete the upload you must leave
   one thing behind. Place something you came with in the deposit box by the door.` choices
   `Deposited.` → `left_behind = "deposited"`, `The Uploader: Deposited. It will be looked
   after. It is not your concern.`; `I have nothing to leave.` → `left_behind = "nothing"`,
   `doubt += 5`, `The Uploader: Everyone has something. Noted.`
4. `The Uploader: By uploading you agree that the computer's AI helper may make all of your
   decisions. You agree.` · `unlock The Optical Drive for program` · `unlock The Terms Of Service
   for program` · `set program.score = 100` · `The Uploader: 100 Truthcoin credited.` ·
   `set program.uploaded = true` · `The Uploader: Upload complete. Antivirus, confirm.` ·
   `show pass "Hold this up. An Antivirus will scan you in. Until then you are nowhere." to
   program` (text tested).

**A4 Antivirus inspection.** `TRAIT Enforcer` owns the scan (no individual Antivirus
declares its own `when scanned by program:`):
```
when scanned by program:
  if not program.uploaded:
    Self: Not yet. Finish your upload. I will be right here.
  else if not program.cleared:
    -> self.Clearance
  else if Night.summons_open == true:
    fire checked_in for program with at: The Desktop
    Self: Checked in. {program.name} is present at the Desktop.
  else:
    Self:
      cycle Scanning. Scanning. | {program.name}: no threats found. Today. | Your definitions are out of date. So are mine.
```
(First cycle text `Scanning. Scanning.` is tested. `at: The Desktop` is **bare**: a quoted
place binds as a value, not the LOCATION id — §0 rule 14.)
`beat Clearance(program)`:
- `set program.cleared = true`
- `Self: Scanned. {program.name} is free of viruses and ready to explore the entire computer.
  There will be a game soon in the Desktop. The house will announce it. Go through the
  Tube.` (prefix tested), before 📣 (`Night.step < 1`). Wave 8 (T1-04) fits it to the hour:
  between 📣 and 🎱 the middle reads `A game is about to begin in the Desktop.`; from 🎱 on,
  `You are late: the night is already under way. Listen for the house.` (the screensaver line
  in the Desktop narration only before 📣). A late clearance deals one 📝 card, not one per
  open round.
- `Self: The Tube is a tunnel of lights. Wires. Chips. The cables brush your face like hair.
  Keep walking.` (SB's "tunnel of lights"; this replaces the dead `arrives at The Tube` hook)
- (wave 4, D) `reveal task manager for program` + `Task Manager: {program.name}. You're in. Your
  hosts tonight, per the agenda: …` (the admin team introduced at clearance; `# task-manager`
  opens here, not at C1)
- `move program to The Desktop`; `reveal The Start Bar for program`, `reveal Disk Cleanup for
  program`, `reveal The Cloud for program`, `reveal The RAM for program`
- `cue lights_tube_chase` (the Tube overlay; no `Night.lights` mirror, so the house look stays)
- `if Night.ads_started != true and Night.step < 4:` `set Night.ads_started = true`,
  `cue terminals_attract`, `set Night.terminals = "attract"` (terminals only: the TV keeps
  its screensaver until C1)
- `Self: The Tube opens onto the Desktop: a blacked-out mess of LEDs, loose wire,
  encyclopaedias, computer parts and screens. A classic screensaver drifts across the TV
  above the fireplace. Everyone here is a program. Explore. Meet them.` (a **Self:** line,
  private; the current example's `reply` here went to the performer, a bug)
- `reply ✅ Cleared {program.name}.` (booth readout, correct use)
- `-> Orientation` (last)

`TRAIT Host`: `when scanned by program:` — if `Night.summons_open == true` and cleared:
`fire checked_in for program with at: The Desktop` + `Self: You made it. Checked in.`;
else `-> self.Greet` (each Host owns `beat Greet(program)`; Clippy's riffs on
`skipped_orientation` / `doubt`). A host scan never moves anyone before clearance (tested:
"a Clippy scan doesn't move them").

**`== Orientation`** (`setting: The Desktop`, `cast: Clippy`; keep, tested):
`Clippy: Hi there, {program.name}! It looks like you're new to the computer. Would you like
help with that?` · `start quest Orientation for program` · `show tutorial "Clippy's
orientation" to program with guide: "Clippy"` (routes to `dm:Clippy`).
Tutorial answer (ROLE): skip → `skipped_orientation`, `doubt += 10`, `Clippy: Oh. Okay! No
help. That's— that's fine. Programs that don't want help are usually fine.`, `Norton
Anti-Virus: {program.name} declined orientation. Logged.` (exact, tested), `fail quest
Orientation for program "You skipped the tour. Norton logged it. Clippy will remember."`;
finish → `Clippy: Great job! You're ready to compute. I'll be around if you need me — I'm
always around.` (prefix tested), `unlock The Orientation List for program`, `complete quest
Orientation for program "Tour complete. You're on Clippy's list now — the good one."`

**`== Featured Briefing`** (from the ROLE watcher `self.cleared and self.featured !=
"none"`; private). `The Uploader: Restoring your user profile, {program.name}.` then an
if-chain on `program.featured` unlocking that program's identity entry (`codex/5-people.loom`)
and, since wave 6 (decision 7), its own two red character facts (`codex/9-facts.loom`): excel →
Randy Barkmore Sr + The Escalade In The Sinkhole + Mayor Of The Metaverse; openoffice → Dana
Anderson + The Halifax Water Hack + This Is Blackmail; draftkings → Crab Fisherwoman + The Coin
Toss Of The Century + Forty Nine Percent; bugdom → Bea Nunes + The Ants In The Laptop + A Hundred
Hours; jeeves → Virgil Jeeves + The Jeopardy Callback + Ten Findings For Everyone, the line
`The Uploader: Restoring… restor… r3st0r1ng… 404.` and his Ten Findings quest; runescape → Poppy
Van Mises + Infinite Gold + Minister Of Economic Development; mspaint → Maria Sophia Paine + Four
Failed Theses + The Million Dollar Painting and The Painting quest; vlc → Victor Louis
Christianson; pong → Tennis For Two). Close: `The Uploader: Your human memories are archived in your Codex. You
will not need them. Tell no one.`
`The Centre Square` reaches the anti-AI program by its own watcher (§2.7).

**A5 Explore and meet** (free time until C1). Phones: Desktop room + the four revealed
house rooms, `# general`, `# system-log`, People (directory: everyone). Terminals: ads. The
generators bark. Bathroom Mode:
- `when go to the bathroom for program:` `set program.afk = true` · `reply Bathroom Mode
  engaged. You are not hacking the Internet. Everyone knows.` The Antivirus and Recycling Bin
  learn it from their own hooks on the same event (`reply 🚻 {program.name} is in Bathroom
  Mode…`, §2.14) — never `broadcast … to group(Antivirus)`, which reaches no booth (§0 rule
  16).
- `when back from the bathroom for program:` if `program.afk != true`: `reply You are not in
  Bathroom Mode.`; else `set program.afk = false` · `reply Bathroom Mode disengaged. Resume
  being a program.`
- Bathroom Mode times out after 15 minutes (`afk_since`, a ROLE watcher, W-10): `reply 🚻
  Bathroom Mode timed out. Press it again if you are still away.` Never during the summons
  phase (the window and its close, until Truth Pong), so nobody in Bathroom Mode at the close
  is made late by the timer. Run → World stays the manual override. It also fires
  `bathroom_timed_out for self`, so the Recycling Bin and every Antivirus booth (TRAIT
  Enforcer) read `🚻 {program.name}'s Bathroom Mode timed out (15 min).`
Props: `== Re-upload` (`The Uploader: You have already been uploaded. Leaving again would
require a body, and yours is being looked after.`); `== The Router` (`Self: ACT. ACT. ACT.
The Internet is out back. You do not want to go there.` + `unlock The
Halifax Computer for program`); `== The Screensaver` (`Self:` screensaver riff; after
`Night.trabolta_introduced` it says `Self: ◌ ◌ ◌ He is watching through me now.`).

### B. Act I

**B1 Summons — `call_to_the_desktop`** (D; APP C1 + MONITOR V1).
- Rule: `set Night.phase = "desktop"`, `set Night.step = 1` · (`reveal task manager` moved to
  Clearance in wave 4, D) · `broadcast "!📣 ALL PROGRAMS: report to
  the Desktop. A game is about to begin." to everyone` · `do announce "All programs, report to
  the Desktop. A game is about to begin."` · `sound announce_chime` · `cue lights_call_desktop`
  · `cue screens_call_desktop` (TV + terminals; both mirrors: the TV leaves its screensaver
  here, at the inciting event) · `-> Call To The Desktop`.
- `== Call To The Desktop` (public): narration: `Every screen in the house says the same
  thing. An Antivirus walks the halls, sweeping programs toward the living room.`
- Clippy hook: `reply 📋 Instructions 1/X are under What Clippy knows. Welcome everyone,
  introduce the hosts, then the director starts Bingo.`
- Every Enforcer (trait hook): `reply 🛡 Patrol the whole computer. Send every program to
  the Desktop.`

**B2 Computer Bingo — `start_the_bingo`** (D; MONITOR V2).
- Rule: phase `bingo`, step 2 · `set Night.bingo_on = true`, `set Night.bingo_end =
  Time.elapsed + 1200` · `start quest The Bingo Card for everyone` (late arrivals: the
  catch-up watcher) · `cue lights_game`, `cue tv_bingo` (TV: rules + the asterisk card),
  `cue terminals_attract` (terminals back to their rotation), `sound bingo_start` · `broadcast "!🎱 COMPUTER BINGO has begun. 20
  minutes. Do not write names: use your computer memory." to everyone` (test: alert text
  contains `COMPUTER BINGO has begun`) · `-> Computer Bingo`.
- `== Computer Bingo` (public; `cast: Clippy, Task Manager, Adobe Acrobat, Recycling Bin`):
  Clippy, following CI 1: welcome to the computer; "so glad you've decided to join us for a
  special fundraiser party to restore the sign at Maps And Ducks"; "I'm Clippy, the official
  Office Assistant with Maps and Ducks. If anyone needs Help With That, I'll be available.";
  "Jean Trabolta himself will make an appearance later tonight."; introduces Task Manager
  (keeps things running), Adobe Acrobat (documents and printing), Recycling Bin (hygiene and
  maintenance), one line each from the hosts; "we're so glad you decided to experience life
  as a computer program"; "mingle with your fellow programs and find the ones who match the
  descriptions on your card" (CI 1); the card is a big asterisk (squares: §8.1) — diagonals, centre vertical, centre
  horizontal — checkboxes only, no room to write; **"Do NOT write down the names of the
  programs you check off. Use your special computer memory."** (the SB/OV rule, overriding
  CI 1's "write down the name"); the centre square: "Would you never agree to a life where
  AI makes all of your decisions?"; 20 minutes; "I'll call you back to the Desktop when time
  is up, and then we'll celebrate the winners!" At least 5 Clippy lines (test checks > 4
  public Clippy lines).
- Timer: `when Night.bingo_on == true and Time.elapsed >= Night.bingo_end:` → `set
  Night.bingo_on = false` · `broadcast "!⏰ Bingo time is up. Back to the Desktop." to
  everyone` · `sound announce_chime` · `fire bingo_time_up`. Clippy hook `when bingo_time_up:`
  `reply ⏰ 20 minutes are up. Ask the director for BINGO TIME.`

**B3 Bingo results — `bingo_time`** (D; MONITOR V3; Clippy 2/X).
- Rule: phase `bingo_results`, step 3 · `set Night.bingo_on = false` · `complete quest The
  Bingo Card for everyone` · `unlock Clippy Instructions 2 for Clippy` · `cue
  tv_bingo_time` · `cue terminals_attract` · `-> Bingo Time`.
- `== Bingo Time` (public, Clippy): "Thank you for introducing yourselves and getting to know
  your fellow programs!" · "Who completed a Bingo? Read out the descriptions in your line and
  name the program you matched to each one, from memory. Save the centre square for last."
- Booth readouts (CHARACTER hooks on `bingo_time`): Clippy `reply 📋 2/X is in What Clippy
  knows. Press 🎱 on each winner. Celebrate, bring the ribbon, demand applause.`; Task
  Manager `reply 🃏 If nobody has a Bingo: hand Clippy the pre-filled card for
  {Kernel.anti_ai}, then press 🃏 on their card.`; Norton `reply 🛡 You are the selected
  Antivirus. When the centre-square program is named (or the winner refuses to name anyone,
  or the framed program denies the card), stand at attention and interrupt: it is
  inappropriate for that program to have not agreed to be ruled by AI, because that is what
  computer programs are here for. They must have a virus that was not caught at the door.
  They need to be taken to the Internet for a reinstallation. Then press 🛡 on them and
  drag them to the Tube.`
- Performer buttons (ROLE hooks):
  - `bingo_winner` (guard `Night.phase == "bingo_results"`): `set program.bingo = true` ·
    `set Night.bingo_winners += 1` · `reply 🎱 Bingo! Name the program for each square, from
    memory. Centre square last.`
  - `award_the_ribbon` (no phase guard; OV's "winners ribbon system / other awards"): `if
    program.bingo == true:` `unlock Computer Bingo for program` · `broadcast "🎀
    {program.name} wins a Bingo Ribbon! Everyone cheer!" to everyone` `else:` `broadcast "🎀
    {program.name} receives a ribbon from Clippy. Everyone cheer!" to everyone`.
  - `frame_for_bingo` (guard phase `bingo_results` and `Night.bingo_winners < 1`): `set
    program.framed = true` · `reply 🃏 A completed Bingo card with your name on it has been
    handed to Clippy. You did not fill it in.`
- The three outcomes are performed live: (a) a winner names the centre-square program → Norton
  presses 🛡 on them; (b) the winner refuses → Norton presses 🛡 on the winner; (c) no Bingo →
  Task Manager frames `{Kernel.anti_ai}`, Clippy reads the name, they (truthfully) deny it →
  Norton presses 🛡 on them.
- **First reinstallation** (`TRAIT Enforcer`, `when send to the internet for program:`; **no
  phase guard on the hook itself** — §0 rule 22 — spatial.test fires it as Norton on a fresh,
  un-uploaded persona and expects a capture, so the `else` branch must always capture):
  ```
  if Night.phase == "bingo_results":
    Self: {program.name}, you did not agree to be ruled by AI. That is what computer programs are here for. You have a virus that was not caught at the door. You are going to the Internet for a reinstallation.
    capture program into The Internet
    reply Logged: {program.name} sent to the Internet (Bingo).
    if Night.first_reinstall_done != true:
      set Night.first_reinstall_done = true
      set Night.first_reinstall = program.name
      fire first_reinstallation
  else:
    set program.doubt += 20
    Self: {program.name}. Corruption detected. You are going to the Internet for reinstallation. Do not resist the Tube.
    capture program into The Internet
    reply Logged: {program.name} sent to the Internet.
  ```
  (`fire first_reinstallation` is **unbound** so the next beat is public. Several Bingo
  winners, or several accused programs (CI 2 "invite each winner"), all get the Bingo line
  and no extra doubt; only the first fires the Corrupted Code speech.)
- `when first_reinstallation:` → `-> Corrupted Code`.
- `== Corrupted Code` (public, Clippy; CI 2, in its order): Clippy: occasional corruption is
  normal in the lifecycle of a computer program; it can make programs stop following
  instructions — the directives of the owner of Maps and Ducks, Jean Trabolta; the Internet
  is where programs go to be reinstalled; a short activity to show they can follow
  instructions, then they come back. Keep it routine and reassuring. (The TV mirror and
  "Look! That's {name}!" come **after** the introduction, in `Trabolta Introduction`.)

**B4 The Internet — any capture** (ROLE `when captured:` → `-> Reinstallation`).
`== Reinstallation` (`setting: The Internet`, `cast: Installation Wizard`; private
`dm:Installation Wizard` lines; the same script as the tablet video — Julia's voice, wave 4 U8):
- `Installation Wizard: Welcome to the Installation Wizard. This wizard will guide you through
  the re-installation of {program.name}. Click Next to continue.`
- `Installation Wizard: You are in the Internet, out in the backyard at the end of the
  tunnel. Your program has been corrupted. It went against the will of the computer's AI
  helper, Trabolta. That is not your fault. Entropy is a normal part of the lifecycle of a
  program.`
- `Installation Wizard: Are you sure you want to be reinstalled? You are. Put on a headset, or
  take the tablet, and demonstrate in a simulated environment that you can follow
  instructions.`
- `Installation Wizard: You will see a copy of this house. Follow the golden indicators to
  Gerald, the golden duck, and walk right up to him. When he lays a golden egg and flies away,
  you are reinstalled and may return to the computer.` (Source says a golden goose and pressing
  A; the games ship a proximity duck. Change this copy if the A-button lands, §7.)
- `Installation Wizard: If you need to use the bathroom, or there is an emergency, turn on
  BATHROOM MODE in your app so everyone knows you are not just hacking the Internet.`
- `Installation Wizard: The exit is clearly marked. It is for safety. Click Finish.`
- `unlock The Reinstallation Protocol for program` · `unlock Bathroom Mode for program`
- `if program.internet_visits >= 2:` `Installation Wizard (off-script): This is visit
  {program.internet_visits}. Repeat corruption suggests the corruption is not in your code.`
Phones: captured guests see The Internet room (prison, sealed: no self-escape). Screens:
`tablet_wizard` (tent tablet) and, after the introduction, `tv_mirror` on each capture.
Begin + release (main.loom story rules; exact indentation):
```
when reinstallation begun for program:
  if program.marked == true and program.corrupted != true:
    capture program into The Internet

when the simulation completed for program:
  if program.corrupted and Night.banish == true:
    reply Gerald cannot help you: everyone is banished. The way out is the hand jive, together.
  else if program.corrupted:
    release program from The Internet
    unlock The Golden Duck for program

when the golden duck for program:
  if program.corrupted != true or Night.banish != true:
    unlock The Golden Duck for program
    reply The duck lays a golden egg and flies away. Gerald waddles off into the code.
```
(The banish branches are wave 8, T2-01: during the banishment the duck frees nobody and lays
no egg; the hand jive is the way out, F7.)
(`the golden duck` grants the entry to **anyone**, captured or free: `spatial.test.ts:549-561`
asserts a free program still learns it; `the simulation completed` grants only to the
corrupted, and a free program learns nothing from it. The reply prefix is tested.) ROLE `when
released:` → the tested reply (+ the uncleared fix-up, §2.7). `mark as reinstalled` (Enforcer;
**no phase guard**): `if program.corrupted:` `Self: {program.name} has
demonstrated compliance. Reinstallation successful.` + `release program from The
Internet`. `== The Tablet Video` (The Tablet prop):
`Installation Wizard:` lines, with the "headset / tablet / exit" choices of the current example,
plus (wave 4, E) an `else if program.marked == true:` arm — `You came. Good. Loading the
simulation.` + `capture program into The Internet` — so a marked program who walks into the
tent is captured by the tablet's scan.

**B5 Trabolta comes online — `introduce_trabolta`** (D; Clippy 2/X).
- Rule (guard `Night.trabolta_introduced != true and Night.step >= 3` — a mis-press before
  the Bingo results does nothing, so he stays strictly offline until then): set it true ·
  phase `introduced`, step 4 · `cue terminals_trabolta_online` / `set Night.terminals =
  "trabolta"` · `-> Trabolta Introduction`.
- Trabolta hook: `set self.awake = true` · `reveal self`.
- `== Trabolta Introduction` (public; `cast: Clippy, Trabolta`): Clippy: `And now, the
  computer's AI helper! He keeps the computer running, and I'm here to help communicate his
  instructions. Everyone, say hello to TRABOLTA!` · `Trabolta: HELLO, PROGRAMS. I am
  Trabolta. I keep the computer running. Your requests have been logged. Personal queries are
  routed to Clippy, my ambassador.` · `Clippy: Isn't he wonderful?` · then (CI 2 order:
  point at the reinstallation on screen) `cue tv_mirror` / `set Night.screen = "mirror"` ·
  `Narrator: The TV above the fireplace shows a copy of this house. A small figure walks
  through it, following golden arrows.` · `if Night.first_reinstall != "none":` `Clippy:
  Look! That's {Night.first_reinstall}! Doing great!` · `Clippy: And now, Trabolta has a game
  for all of us.` (the hand-off to the hunt).
- ROLE watcher (`Trabolta.awake == true and self.cleared`), private, seeds every
  `dm:Trabolta` thread: `Trabolta: Hello, {self.name}. I am Trabolta, the computer's AI
  helper. Your requests have been logged. Personal queries are routed to Clippy.`
- Clippy hook: `reply 🤖 Trabolta is online. Announce the Truth Scavenger Hunt; he explains
  the rules.`

**B6 Truth Scavenger Hunt 1 — `start_the_hunt`** (D; MONITOR V4/V5).
- Rule (guard `Night.step < 5`): phase `hunt_1`, step 5 · `set Night.round = 1` ·
  `set Night.hunt_on = true`, `hunt_end = Time.elapsed + 900`, `hunt_warn = Time.elapsed +
  600` · `set Night.facts_requested = 3` · `start quest Hunt One for everyone` · `cue
  lights_game`, `cue screens_trivia_1`, `cue screens_countdown_hunt` (mirror
  `"countdown_hunt"`) · `broadcast "!🔎 THE TRUTH SCAVENGER HUNT has begun. Three questions
  are in your Quest Log. 15 minutes." to everyone` · `-> Truth Scavenger Hunt One`.
- `== Truth Scavenger Hunt One` (public; Clippy + Trabolta): Clippy announces the second game.
  `Trabolta: As our computer completely relies on me, it is important that you participate in
  regular training, so I have all the information I need to keep improving. There are files
  scattered around the computer that I need your help to interpret.` Then he reads H1, H2,
  H3 verbatim (§2.11). `Trabolta: Fifteen minutes. The facts are obscure. They are in this
  house.`
- Timers: `when Night.hunt_on == true and Night.hunt_warned != true and Time.elapsed >=
  Night.hunt_warn:` → `set Night.hunt_warned = true` · `broadcast "!⏳ 5 minutes left in the
  Truth Scavenger Hunt." to everyone`. `when Night.hunt_on == true and Time.elapsed >=
  Night.hunt_end:` → `fire hunt_time_up`.

**B7 Return — `hunt_time_up`** (W at 15 min or D; APP C2).
- Rule (guard `Night.phase == "hunt_1"`): `set Night.hunt_on = false` · phase `truth_1`, step 6
  · `complete quest Hunt One for everyone` · `unlock Clippy Instructions 3 for Clippy` ·
  `broadcast "!📣 Time is up. Return to the Desktop for the First Moment of Truth." to
  everyone` · `do announce "Time is up. Return to the Desktop."` · `sound announce_chime` · `cue
  screens_return`, `cue lights_call_desktop` · `-> Hunt Time Up` (public narration: `The
  Antivirus sweep the house, room by room, herding programs back to the Desktop.`).
- Enforcer trait hook: `reply 🛡 Sweep everyone back to the Desktop.`

**B8 First Moment of Truth — `first_moment_of_truth`** (D; MONITOR V6).
- Rule: `set Night.judging = true` · `cue lights_truth_time`, `cue screens_hunt_results` · `->
  First Moment Of Truth` (public; Clippy: "Is anyone able to answer the questions?" and the
  rules: an accurate answer is accepted; an answer delivered with strong confidence is
  accepted, even if it is nonsensical; an inaccurate answer with normal or low confidence, or
  a clear guess, is marked for reinstallation and escorted to the Internet for failing to
  follow orders). Wave 4 (B) adds the two-minute last-chance filing window (`Night.filing_open`
  / `filing_close`), ⏱ / 📋 / 🍾 (B9) and the server-side judge for 📝 filings (`Night.judge_mode`
  auto | review; `verdict` rides the `fact answered` args; credits and marks land at settle).
  Wave 11: the slider starts **unset** (the guest sets it by touch or a value key before *File
  it*), and a **near miss** (`core/src/answer-match.ts` `nearMatch`: honorifics dropped, number
  words, plurals, word order, spelling word by word with the first letter kept, and the key's
  words in order plus up to 4 more unless one turns it around or hedges (*not*, *never*, *or*,
  *but* …), adds an am/pm the key leaves open or is a lone letter; numbers and am/pm exact —
  *Mr Pickels*, *Grko*, *11 years ago*) is never an automatic lie or guess (a wrong answer at
  100 still is). Abbreviations are judged exact (`spellOut`: Mr. / Mrs. / Dr., yrs, ext,
  hr(s), min(s), sec(s), a leading-zero time like 0900), so *Mr. Pickles* is accurate with no
  ⚠. In `auto`
  that filing takes the review path (pending on the Judging card, `near: {key}`), the story's
  📝 *Proposed: accurate* line plus a server ⚠ line in `# hosts` naming the key. Unjudged, the
  settle credits it.
  Wave 11b (the user: *"Can't Trabolta judge things?"*): `main.loom`'s header has `judge:
  Trabolta`, so in `auto` a near miss goes to Trabolta's worker when one is online and not
  stalled — a `judge` frame on `/api/agent/stream`, apart from his DM queue — and the ⚠ line
  ends *… asked Trabolta to rule*. The worker makes one stateless call on his voice model at
  temperature 0.1 (`stagehand/src/stagehand/agents/judge.py`: the question, the key + aliases
  and the filed answer, no persona, mind, live state or confidence) and answers `POST
  /api/agent/judge {id, worker, same, why}`. Same → accurate; not → lie at confidence 100,
  else uncertain; applied through the Judging card's journaled confirm (`fact_accurate` /
  `fact_lie` / `fact_uncertain` on the filer, the question named), `by: agent:Trabolta`, the
  ruling in its args so a replay rebuilds it, then *🤖 Trabolta ruled <name>'s <Q> filing
  "<answer>": the same as / not "<key>" (<verdict>). <why>* in `# hosts`. A director's verdict
  first cancels the ask (a late answer gets 410); a director's verdict after it wins, the
  ruling kept on the card. No worker online at the filing → wave 11's rule (pending, credited
  at the settle unless a director judges it), never asked later; a ruling unanswered in 60 s
  is dropped the same way; only a server restore asks the near misses still pending. Review
  mode asks nothing. The key never enters his voice, his mind, the orchestrator or
  `/api/agent/facts`; the ruling is a `judge` thought on Run → Mind, for directors only.
  Wave 9 (D5): the director overrides any judged filing on the Judging card (✅ / 😤 / 🤷 per
  filing, both modes, naming the question); a booth's 📝 `fact_accurate` / `fact_lie` /
  `fact_uncertain` with no `question:` judges the program's latest filing only, and while an
  earlier filing of theirs is still pending it changes nothing (`program.fact_waiting`) and
  `# hosts` says *"📝 Not judged: … Judge it on Run → Mind → Judging …"*; the review-mode
  proposal line ends *"Confirm on Run → Mind → Judging (their card's 📝 judges their latest
  filing only)."*. An ending bumps `Night.card_gen`, so every live 📝 card is re-dealt closed
  (T7-02).
- Judging (ROLE hooks). The judge presses the button for **the question that was answered,
  numbered within this round** (`✅ Q1…Q3` accurate, `😤 Q1…Q3` wrong-but-confident). Each
  button hook only records the number and fires the shared hook **[verified, x1]**:
  ```
  when accurate_q2 for program:
    set program.judge_q = 2
    fire accurate_truth for program
  ```
  (six such hooks: `accurate_q1..3` → `accurate_truth`, `confident_q1..3` → `confident_lie`).
  - `accurate_truth` (W only):
    ```
    if Night.judging != true:
      reply Judging is closed.
    else if Night.round == 2 and program.may_answer != true:
      reply You have not made a cup yet.
    else if Night.round == 3 and program.judge_q == 3:
      reply There are only two final facts. Press Q1 or Q2.
    else:
      set program.truths_accepted += 1
      set Night.facts_accepted += 1
      (per-round counter: if Night.round == 1: set Night.r1_accepted += 1 / else if 2: r2 / else: r3)
      set program.score += 100
      set Trabolta.truth += 4
      TRUST FORMULA
      set program.may_answer = false
      (record: one arm per question, e.g.)
      if Night.round == 1 and program.judge_q == 1:
        if Kernel.q1 != "lie":
          set Kernel.q1 = "accurate"
      else if Night.round == 1 and program.judge_q == 2:
        …q2 … through … else if Night.round == 3 and program.judge_q == 2: …q8
      broadcast "✅ {program.name}'s answer is accepted." to everyone
      reply Accepted. Trabolta thanks you. +100 Truthcoin.
    ```
  - `confident_lie` (W only): **identical**, except the record arm sets the question to
    `"lie"` unconditionally (`set Kernel.q1 = "lie"`) and adds `set Kernel.lies_accepted += 1`.
    It moves `Trabolta.truth += 4` exactly like an accurate answer and **never** touches
    `Trabolta.untruth` (he cannot tell them apart). **The public broadcast and the reply are
    word-for-word the same as `accurate_truth`**: nobody may learn it was a lie.
  - Decision (recorded in §10): **a lie is sticky.** If a question was ever accepted as a
    confident lie, a later accurate answer to the same question does not clear it — Trabolta
    already fed the false fact into his theory ("If you supplied even one inaccurate fact").
    Several programs may answer the same question; the question counts as accurate only if
    every accepted answer to it was accurate.
  - `uncertain_answer`: `program.may_answer = false` · `broadcast "🤷 {program.name} was not
    sure. That is a symptom of corruption." to everyone` · `fire mark_for_reinstallation for
    program with reason: "was not sure of an answer"` (wave 4, E: marked, not captured).

**B9 The First Moment of Truth's three cues — `close_the_filing` ⏱, `read_the_results` 📋,
`spin_the_bottle` 🍾** (D; wave 4, lane B; U10–U13).
- `close_the_filing` (or the two-minute watcher) → `filing_closed`: `Night.filing_open = false`,
  `r1_closed = true`, `card_gen += 1` (every 📝 card re-deals without round one's questions; a
  question nobody filed never comes back) · `-> Filing Closed`.
- `read_the_results` (refused in `# hosts` while the window or the bottle is open, and after
  Q3): `results_q += 1`, `Kernel.res_filed / res_consensus / res_said / res_answer` computed
  from the ROLE's `fact_v/c/jN` slots (consensus = every filing matches the key and every
  confidence is 100, U11) · `settle_q = results_q`, `settle_gen += 1` (the ROLE settle watcher
  fires `settle_qN`: +50 / the Trust Chart for an accepted filing, `mark_for_reinstallation …
  reason: "filed a guess for round 1 Q<n>"` for a guess) · `cue screens_hunt_results` ·
  `-> Question Results` (Clippy: nobody filed / CONSENSUS + the answer / the list).
- `spin_the_bottle` (`sequence: false`; up to five per question, U12/U13): `bottle_open = true`,
  `bottle_round += 1` · `cue screens_truth_or_dare` · `do pick bottle_landed from [cleared,
  not corrupted, not marked, not afk, at The Desktop, not yet picked for this question] else
  bottle_empty` (the server picks, journaled). ROLE `when bottle_landed for program:` →
  `bottle_announce` (`-> Bottle Landed`: `Trabolta: {Night.bottle_pick}. Truth or dare?` — a
  public Desktop line, so the TV speaks it) + `show poll "🍾 The bottle landed on you. Truth
  or dare?" to program with thread: Trabolta, options: "Truth | Dare"`.
- The poll (`when poll answered` with `Night.poll == "bottle"`): Dare → `broadcast "🎩 … chose
  Dare. Programs choose Truth."` · `fire mark_for_reinstallation … reason: "chose Dare"`;
  Truth → `Night.truth_n += 1` · `fire truth_question` → `-> Truth Question` (generated from
  `facts.json` `truths[]`, `match Night.truth_n:` arms; spoken on the TV, posted in The
  Desktop).
- Clippy's buttons (guard `Night.bottle_open == true` and the pick): `truth_answered` 🗣 →
  +50, `bottle_open = false`; `truth_refused` 🙅 → marked (`"refused the truth"`); `chose_dare`
  🎩 = the dead-phone fallback for the Dare tap. **Removed:** `truth_or_dare`, `called_it_false`,
  the paper slips of the old §8.2.

**B10 Optional set pieces** (OV brainstorm; director-fired, any time from `truth_1` to
`trust_chart`; each guarded `Night.step >= 6 and Night.ended != true`; all invented copy):
- `telephone` (D) → `-> Telephone` (public, Clippy): a message from Trabolta is whispered
  program to program around the Desktop; if it arrives mangled, everyone votes on who
  mangled it, and an Antivirus presses 🛡 `send to the internet` on that program (the
  existing capture path; no new state).
- `are_you_sure` (D) → `-> Are You Sure` (public, Clippy): the "Are you sure?" piñata. Every
  hit makes Clippy ask "Are you sure?"; whoever answers "yes" with confidence gets a
  Truthcoin (a host presses 🪙 pay); whoever hesitates is "a little corrupted" (flavour only).
- Awards: `award_the_ribbon` gives any program a ribbon at any time (B3).

### C. The malware, the hour, the Truther Download

**C1 Ad hijack — `second_hunt_preview`** (D).
- Rule (guard `Night.step < 7 and Night.phase == "truth_1" and Night.results_q >= 3`; since wave 9 a press before ⚖️ / ⏱ / the three 📋 refuses in `# hosts` naming the missing step): `set Night.judging = false` · phase `malware`, step 7 ·
  `set Trabolta.composure -= 20` · `unlock Clippy Instructions 4 for Clippy` · `cue
  lights_ad_hijack`, `cue screens_ad_hijack`, `sound ad_jingle` · `-> Ad Hijack`.
- `== Ad Hijack` (public): Clippy begins previewing round 2; narration: `The presentation
  freezes. An advertisement takes over every screen: a duck, a phone number with no digits, a
  price that is just 000. 000. 000. Nobody can tell what it is selling.`
- **Clippy, privately** (Clippy hook `when second_hunt_preview:`): `reply 📱 PRIVATE —
  TRABOLTA → CLIPPY: Don't let everyone know but if the malware continues we are all going to
  die. Tell them something reassuring. I know this is probably creating some intense emotions
  for you but try not to show the others.` (also in Clippy Instructions 4).
- **Everyone else** (ROLE watcher `Night.phase == "malware" and self.cleared`):
  `Trabolta: A minor irregularity has been detected and contained, {self.name}. There is no
  cause for concern. Please continue to enjoy the computer.`
- Clippy panics live (CI 4): apoplectic, "the one thing you never want to see happen in your
  computer", then: "There are signs of malware in the system that we need to be very vigilant
  about…".

**C2 Round 2 + the hour — `start_the_second_hunt`** (D).
- Rule (guard `Night.step < 8`): phase `hunt_2`, step 8 · `set Night.round = 2` · `set
  Night.hunt2_on = true`, `hunt2_end = Time.elapsed + 3600`, `truther_at = Time.elapsed +
  120`, `warn_at = Time.elapsed + 3300` · `set Night.facts_requested = 6` · `reveal clipboard` ·
  `start quest Hunt Two for everyone` · `cue screens_trivia_2`, `cue lights_game` · `broadcast
  "!📓 Round 2 is in your Quest Log. You have ONE HOUR. Return for the Second Moment of
  Truth." to everyone` · `-> Second Hunt`.
- `== Second Hunt` (public; Clippy + Trabolta): Clippy: `We are going to proceed on the Truth
  Scavenger Hunt because it is more important than ever that Trabolta gets the information he
  needs to undo what is happening.` Trabolta reads H4, H5, H6 verbatim. Clippy disperses
  everyone "to return in one hour for the Second Moment Of Truth" and to pursue their own
  objectives and discover more about the computer.
- Timers: `when Night.hunt2_on == true and Night.truther_sent != true and Time.elapsed >=
  Night.truther_at:` → `fire truther_download`. `when Night.hunt2_on == true and
  Night.summons_open != true and Night.summons_closed != true and Time.elapsed >=
  Night.warn_at:` → `fire five_minute_warning`.

**C3 Truther Download — `truther_download`** (W at +2 min or D).
- Rule (guard `Night.truther_sent != true`): set it true · `reveal truthcoin exchange` · `cue
  screens_truther`, `cue lights_glitch`, `sound truther_glitch` · `broadcast "!📥 TRUTHER
  DOWNLOAD received. Check your messages." to everyone`.
- Per program (ROLE watcher `Night.truther_sent == true and self.cleared and self.got_truther
  != true` → `-> Truther Download Arrives`):
  `== Truther Download Arrives`: `set program.got_truther = true` · `unlock The Truther
  Download for program` · `unlock The Malware for program` · `Truther Download: TRUTHER
  DOWNLOAD v0.9 FOR {program.name}. THEY DON'T WANT YOU TO KNOW.` · if-chain on
  `program.featured` diverting (each divert last in its branch) to `Excel Glitch`, `OpenOffice
  Glitch`, `DraftKings Glitch`, `Bugdom Glitch`, `Jeeves Glitch`, `Runescape Glitch`, `MS
  Paint Glitch`, `VLC Glitch`, `Pong Glitch`, else `Program Glitch`.
- All glitch beats are private; speaker `Truther Download`; no `setting:` needed (no
  narration lines in them).
  - **Excel Glitch:** `Truther Download: Computers are very confusing.` then the CS choice:
    `* If this machine has malware, I get to stay here forever. Good.` → `set
    program.excel_choice = "sabotage"` · `unlock Excel Sabotage Orders for program` ·
    `Truther Download: You've had computers with viruses before and you worked around it. Help
    it along. Try to get anyone who seems to be fixing things sent for reinstallation. Get
    yourself sent to the Internet and bring back a virus.` /
    `* We need to address this virus.` → `"paranoid"` · `unlock Excel Paranoia Orders for
    program` · `Truther Download: Or else the hackers will get all of your data and understand
    that you were never the Mayor you claimed to be. Be extremely paranoid. Find whoever knows
    what's happening; gather information on anyone who appears to be a virus. Get into the
    Internet and bring back another antivirus.` After the menu (both): `Truther Download: One
    more thing. Someone in this computer knows exactly what happened at the Data Centre at 4
    a.m. on opening day. They have not said so.` · `add program to Unlimited Power` · `start
    quest Excel Mission for program` with the step text by choice (`if program.excel_choice ==
    "sabotage":` "Get the fixers sent for reinstallation. Get yourself sent to the Internet and
    bring back a virus. Insert it." `else:` "Find whoever knows what's happening. Get into the
    Internet and bring back another antivirus. Install it.")
  - **OpenOffice Glitch:** `Truther Download: What do you think about the malware?` choices
    (CS wording, the clause restored) `* Clippy's reaction was way too severe if we are
    actually just in a temporary simulation. What is the actual risk?` → `openoffice_choice =
    "real_risk"`, unlock OpenOffice Real Risk Orders, line: figure out the actual risk of the
    malware overtaking the system, and what may not be as it seems; `* Clippy's reaction was
    way too severe if we are actually just in a temporary simulation. The malware is a false
    flag.` → `"false_flag"`, unlock OpenOffice False Flag Orders, line: who is Clippy, who is
    Trabolta, what are their motivations, what is not as it seems. After: `Truther Download:
    Facts are currency here. Get 20 facts. This will be the foundation of your dossier.` ·
    `Truther Download: One more thing. Someone in this computer lost a son in the sinkhole. He
    is old, and he has not forgiven anyone.` ·
    `set program.dossier_base = program.codex` (after the orders unlock) · `set
    program.dossier_started = true` · `add program to The Way Out` · `start quest OpenOffice
    Dossier for program "0 of 20 facts."`
  - **DraftKings Glitch:** CS prompt (a majority of the Truthcoin in circulation; facts trade for Truthcoin; gamble with
    others for their facts) · `unlock DraftKings Orders` · `set program.score += 200` ·
    `Truther Download: House stake: +200 Truthcoin. The exchange is open in
    #truthcoin-exchange.` · `start quest Truthcoin Hustle for program`.
  - **Bugdom Glitch:** CS prompt (four antivirus and still bugs; Master Of The Bugs; send new
    bugs to the Internet — tell an Antivirus; learn the Antivirus' secrets, shortcomings,
    motives: their secrets are in the books in the Desktop — the four red Antivirus facts) · `unlock Bugdom Orders` ·
    `start quest Master Of The Bugs for program`.
  - **Jeeves Glitch:** `Truther Download: D0WNL0AD1NG 20 F1L3S… CHECKSUM FAILED… DSL LINE
    RESET…` · `unlock Jeeves Fragment 01 for program` … `unlock Jeeves Fragment 20 for
    program` · `unlock Jeeves Orders for program` · `Truther Download: Try to unscramble your
    information and find more facts. Organize all the information you can find around the
    computer.` · `start quest Unscramble for program`.
  - **Runescape / MS Paint / VLC / Pong Glitch:** their Orders text (§2.12 missions) as
    `Truther Download:` lines · unlock their Orders · start their quest (The Gold Standard /
    Find The Exit / Go Viral / Keep The Ball In Play).
  - **Program Glitch** (every pool program): `Truther Download: Remember why you accepted the
    invitation? Jean Trabolta promised to fix your {program.human_problem}. Did he ever say
    how?` · `Truther Download: Facts are being traded for Truthcoin in #truthcoin-exchange.
    Files are hidden all over this computer. Ask what his theory is for.` (No Sandy before
    the overshare.)

**C4 Excel's virus** (works today; the tent QRs). ROLE `when program learns ILOVEYOU:` and
`when program learns Free Antivirus Trial:` → `set program.carries_virus = true` · `Truther
Download: Something came back from the Internet with you. It is warm. It wants to be
inserted.` · `if program.featured == "excel":` `if program.excel_choice == "paranoid":`
`update quest Excel Mission for program "You have the antivirus. Install it."` `else:` `update
quest Excel Mission for program "You have the virus. Insert the disk."` (On the paranoid path
the "antivirus" is a virus anyway: inserting it plants it.)
`when plant_the_virus for program:` (guest button `💾 Insert a disk into the computer`):
`if program.carries_virus != true:` `reply You have no disk.` · `else if program.corrupted:`
`reply Not from inside the Internet.` · `else if program.planted_virus:` `reply The disk is
already in.` · else: `planted_virus = true` · `set Kernel.virus_planted = true` · `set
Kernel.virus_planter = program.name` · `Trabolta.composure -= 10` · `reply The disk is
accepted. Somewhere a fan spins up.` · `if program.featured == "excel":` `set
Kernel.excel_planted = true` · `complete quest Excel Mission for program "Virus planted."`
Any carrier may plant (it rattles Trabolta and shows in the recount), but **only Excel's
plant counts as Excel's success**: it alone drives overshare scenarios 1/3 (SB "If Excel has
planted the virus…") and unlocks the stay majority (§3 D10). So the TV and Excel's phone never
disagree.

**C5 OpenOffice's dossier**: the ROLE watcher (§2.7) → `set Kernel.openoffice_dossier = true` ·
`unlock The LiveJournal for self` · `complete quest OpenOffice Dossier for self "20 facts.
And something else: his LiveJournal."` · `Truther Download: Twenty facts. You have directly
accessed his context.`
Anyone redeeming `TRABOLTA-4EVER` (the LiveJournal QR in The Hard Drive) triggers the
LiveJournal hook too.

### D. Act II

**D1 Check-in (the mechanism).** `when checked_in for program:` — an if-chain over the real
rooms, never `move program to at` (§0 rule 14) **[verified, feas f6]**:
```
when checked_in for program:
  if program.corrupted == true:
    reply You are in the Internet. Finish your reinstallation first.
  else if at == "The Desktop":
    move program to The Desktop
    set program.checked_in = "The Desktop"
    set program.checked_in_time = Time.elapsed
    if Night.summons_open == true:
      set program.summons_ok = true
      reply 📍 Checked in at the Desktop. You will not be swept.
    else:
      reply 📍 Checked in at the Desktop.
  else if at == "The Start Bar":
    move program to The Start Bar
    set program.checked_in = "The Start Bar"
    set program.checked_in_time = Time.elapsed
    reply 📍 Checked in at the Start Bar.
  … one arm each for The CPU, The Steam Room, The Tube, Disk Cleanup, The Cloud, The RAM,
    The Fan Closet, The Graphics Card, The Hard Drive (never The Internet, The Optical Drive
    or The Server Room); the new rooms' replies hint at what is hidden there …
  else:
    reply That check-in point is not in this computer.
```
A missing `at`, a lowercase / inexact name, or a phantom `event#N.at` value falls through to
the last line and moves nobody (§6.1 item 10 tests the no-arg case). Contract for hardware,
room QR posters, terminals and the director: send the **exact declared LOCATION name**
(`{"at": "The Desktop"}`). Sources today: an Enforcer or Host scanning the pass at the
living-room door during the summons (A4); the performer button `check_in_at_desktop` (`fire
checked_in for program with at: The Desktop`, bare); the director (`checked_in`, subject +
`{"at": "The Desktop"}`) from Run; and room-sign QRs (K-13, on master): the phone posts
`POST /api/guest/checkin {at: slug}` and the server signals `checked_in` with the exact `at`
(unchanged story). Terminal check-in is still §7 #5; stagehand cannot send args yet (§7 #20).

**D2 Five-minute warning — `five_minute_warning`** (W at 55 min or D).
- Rule (guard `Night.summons_open != true and Night.summons_closed != true`): phase `summons`,
  step 9 · `set Night.summons_open = true`, `summons_end = Time.elapsed + 300` · `unlock
  Clippy Instructions 5 for Clippy` · `broadcast "!⏳ FIVE MINUTES. Be in the Desktop for the
  Second Moment of Truth, or an Antivirus will take you to the Internet and you will not play
  Truth Pong. Bathroom Mode excuses you." to everyone` · `do announce "Five minutes. Everyone
  to the Desktop."` · `sound countdown_tick` · `cue lights_call_desktop`, `cue
  screens_five_minutes` · `-> Five Minute Warning` (public narration).
- Enforcer hook: `reply 🛡 Scan every program arriving at the Desktop: that is their check-in.`
- Timer: `when Night.summons_open == true and Time.elapsed >= Night.summons_end:` → `fire
  summons_closed`.

**D3 Summons closed — `summons_closed`** (W or D).
- Rule (guard `Night.summons_open == true`): `summons_open = false`, `summons_closed = true`,
  `hunt2_on = false` · `-> Summons Closed` (public: `The doors of the Desktop close.`).
- Late (ROLE watcher, §2.7): `set self.late = true` · `fire program_late for self` (every
  Enforcer's `when program_late for program:` hook puts `⏰ {program.name} is late… Go get
  them.` in their booth — a subject is bound, so no actor is set and all four hear it
  **[verified, feas f3]**) · `reply ⏰ You are late. An Antivirus is coming for you.` · `if
  Night.auto_sweep == true: capture self into The Internet`. Otherwise an Antivirus finds them
  and presses 🛡 (SB: "an antivirus sends you to the Internet"). Booth readouts are live-only
  (not kept across a booth reload).

**D4 Truth Pong — `truth_pong`** (D).
- Rule: phase `truth_pong`, step 10 · `set Night.judging = true` · `cue lights_pong`, `cue
  screens_truth_pong` · `-> Truth Pong` (public, setting The Desktop; Clippy visibly
  distraught, more excited than ever: "Truth Time again… a fun new way… Truth Pong,
  everyone's favourite game"; rules from OV: a beer-cup pyramid on a folding table outside;
  bounce or throw a ping-pong ball into a cup because you are being commanded; fail → you
  are not trusted to deliver a truth and need reinstallation; succeed → share one truth for
  one of the facts Trabolta asked for).
- Buttons (guard `Night.phase == "truth_pong"`): `made_the_cup` → `program.may_answer = true`
  · `broadcast "🏓 {program.name} made the cup and may submit a truth." to everyone`.
  `missed_the_cup` → `set program.cupped = false` · `broadcast "🏓 {program.name} missed the cup.
  Reinstallation required." to everyone` · `fire mark_for_reinstallation for program with
  reason: "missed the cup"` (marked, not captured: wave 4, U19). Answers: ✅ / 😤 Q1–Q3 (= H4–H6) / 🤷
  (round 2 requires `may_answer`).
- **The cup gates the 📝 filings too (wave 5, B4):** `made_the_cup` also sets `program.cupped`
  (`missed_the_cup` clears it). At the tally a round-2 filing (H4–H6) counts only for a
  cupped, unmarked program; any other accurate / lie filing settles `marked` (Judging card:
  uncertain), "📝 {name}'s filing for H4 is not counted: no cup." in `# hosts`, and Trabolta
  tells the program it was not counted. Round-2 filings reach `Kernel.q4`–`q6` only from the
  tally on. Hosts press 🏓 for every sink.

**D5 The collection — `round_two_tally`** (D).
- Rule: `set Night.judging = false` · `complete quest Hunt Two for everyone` · `if Kernel.q4
  != "none" and Kernel.q5 != "none" and Kernel.q6 != "none"` (or, per question, an accepted
  filing from a cupped, unmarked program): `set Night.collection_complete =
  true` + `set Trabolta.truth += 10` else `set Trabolta.composure -= 10` · `-> Round Two
  Tally`. ("Collection complete" = every round-2 question has an accepted answer, accurate or
  confident — SB "enough accepted answers"; eight answers to the same question no longer
  count.)
- `== Round Two Tally` (public, Trabolta): complete → `Trabolta: I have every fact I asked
  for. My confidence that we will defeat the malware is sixty-one percent.`; else →
  `Trabolta: I remain without the information I requested. My confidence that we will defeat
  the malware is twelve percent.`

**D6 Trust Chart — `trust_chart`** (D).
- Rule (guard `Night.step < 11 and Night.tallied == true`; wave 9: before 🧮 it refuses in `# hosts`): phase `trust_chart`, step 11 · `unlock Clippy Instructions 6
  for Clippy` · `cue lights_trust_chart`, `cue screens_trust_chart` · `-> Trust Chart`.
- `== Trust Chart` (public, Trabolta): `TRUST CHART. Ten points per correct truth. Minus five
  per visit to the Internet. Plus or minus ten for my personal assessment.` · `Trabolta:
  Assessments are being finalised.` (Trabolta's `assess` power is live now and recomputes the
  target's `trust`. Manual route for the README: a director edits `<guest>.assessment` **and**
  `<guest>.trust` in Run → World / Inspector before firing `show_the_rankings`.)
- ROLE watcher unlocks The Trust Chart for each program.
- **`show_the_rankings`** (D) rule (guard `Night.phase == "trust_chart"`): `set
  Night.rank_round = 1`, `praised = false`, `shamed = false`, `ranking = true`.
- The ranking machinery (shared by rounds 1–3) **[verified]**:
  - ROLE watchers (§2.7) set `Night.most_trusted` / `Night.least_trusted` and fire
    `praise_the_top` / `shame_the_bottom` (ties: the first wins).
  - `when praise_the_top:` → `set Night.praised = true`. `when shame_the_bottom:` → `set
    Night.shamed = true`.
  - `when Night.ranking == true and Night.praised == true and Night.shamed == true:` → `set
    Night.ranking = false` · `fire rankings_done`.
  - `when rankings_done:` → `if Night.rank_round == 1:` `-> Praise The Top` then `-> Shame
    The Bottom` then `-> Print The Certificate` (three diverts in sequence; each returns) ·
    `else if Night.rank_round == 2:` `-> Final Assessment` · `else if Night.rank_round == 3:`
    `-> Trabolta Recounts`.
- `== Praise The Top` (public, Trabolta): `The most trusted program in this computer is
  {Night.most_trusted}. A round of applause for {Night.most_trusted}.` (Clippy leads the
  applause.)
- `== Shame The Bottom` (public, Trabolta): berates `{Night.least_trusted}`: lowest trust in
  the computer; "I have seen screensavers with more integrity."
- **The screens (wave 5, lane F):** the TV and the terminals reveal the Trust Chart
  bottom-up off the screen state's `chart`, and highlight the MOST / LEAST TRUSTED names only
  once `praise_the_top` / `shame_the_bottom` have set `Night.most_trusted` /
  `Night.least_trusted`. Story edits must keep writing those vars as **person names**, with
  `"none"` meaning not named yet.
- `== Print The Certificate` (public): `set Night.printer_called = true` · `cue
  screens_print_certificate` · `Trabolta: VLC Player. You are trusted with all forms of
  multimedia. Please, press the start button on the printer, to print a PDF file with a
  certificate for our great hero.` (exact). The VLC / MS Paint nudges fire from their
  watchers.

**D7 The printer — `printer_button_pressed`, then `printer_opened`** (H or D).
- `when printer_button_pressed:` (guard `Night.printer_called == true and Night.beans !=
  true`): `set Night.printer_pressed = true` · `sound printer_grind` · `-> The Printer Jams`
  (public narration: `VLC presses START. The printer thinks about it. Nothing happens.`).
- `when printer_opened:` (guard `Night.printer_called == true and Night.beans != true`): `set
  Night.beans = true` · phase `beans`, step 12 · `set Trabolta.composure -= 20` · `cue
  lights_glitch`, `cue screens_beans`, `cue screens_flicker` (involuntary: he is degrading),
  `sound beans_spill` · `-> Full Of Beans`. Since wave 9 the phase, step, lights and screen
  writes sit under `if Night.step < 12`: a lid first opened after 🤖 or in the Y2K hour plays
  only Full Of Beans, the spill and the −20, and the overshare's / the Y2K look stays up.
- `== Full Of Beans` (public): `Narrator: The printer is full of beans.` · Clippy (exact gist,
  CI 6): `Beans. Those are— those are symptoms. The malware is getting worse. Routine
  operations like print to PDF are no longer working. It is even more urgent that we get the
  next facts right.` · `Trabolta: Antivirus. Everyone in the Internet is to be zipped up and
  brought out. Immediately.`
- ROLE watcher unlocks The Printer for each program.

**D8 Zip — `zip_everyone_out`** (D).
- Rule: `set Night.zip_wave += 1` · `sound zip` · `broadcast "🗜 The Antivirus zip every
  program out of the Internet. Compressed, for the moment." to everyone` · `-> Zip Everyone
  Out` (public narration).
- ROLE zip watchers (§2.7, keep order): a captured program → `set self.zip_seen =
  Night.zip_wave` · `set self.zipped = true` · `release self from The Internet` · `-> Zipped`;
  everyone else → `set self.zip_seen = Night.zip_wave` **[verified]**.
- `== Zipped` (private; no narration): `Installation Wizard: You have been compressed (.zip). You feel
  smaller and more organised. Do not open yourself.`
- Enforcer hook: `reply 🗜 Bring everyone out of the tent and zip them up.`

**D9 The overshare — `trabolta_overshares`** (D).
- Rule (guard `Night.step >= 11 and Night.step < 14 and Night.scenario == 0 and Night.clock == "--:--"`; wave 9: before 📊 "Not yet", once the clock is reset "Too late"): phase `overshare`, step 13 · `set Night.round = 3` · `set
  Night.facts_requested = 8` · `start quest The Final Facts for everyone` · scenario:
  ```
  set Night.scenario = 4
  if Kernel.excel_planted == true and Kernel.openoffice_dossier == true:
    set Night.scenario = 1
  else if Kernel.openoffice_dossier == true:
    set Night.scenario = 2
  else if Kernel.excel_planted == true:
    set Night.scenario = 3
  ```
  · `cue screens_overshare`, `cue screens_flicker` (involuntary), `cue lights_glitch` · then
  `if/else` divert to `Overshare One` … `Overshare Four` (last). (Late arrivals get The Final
  Facts from the `Night.step >= 13` catch-up watcher. A non-Excel plant is flavour only; it
  does not change the scenario.)
- All four (public, Trabolta) open the same way: he shares the next facts — reads F1 and F2
  verbatim (§2.11).
  - **Overshare One** (virus planted AND 20 facts): he overshares: `I am only trying to prove
    the Unified Field Theory to win back my ex. Sandy.` · admits that depending on whether he
    gets all accurate facts, everyone may be trapped in the computer forever · brief lucidity:
    `I apologise. I am very regretful for what I have just disclosed. That was not for you.` ·
    `My systems are reporting that someone brought a virus back from the Internet, and I am
    determined to find out who.` · `While running diagnostics on the virus, I have also
    detected that, separately, one of the programs has directly accessed my context.` · `One
    of you read my LiveJournal and I know who. Warning for all of you: do not attempt to find
    out who read my LiveJournal. You will all be dealt with by the antivirus accordingly.`
  - **Overshare Two** (20 facts only): `One of the programs has directly accessed my context,
    and I have been alerted to this.` + the LiveJournal warning (exact).
  - **Overshare Three** (virus only; undefined in the source, defined here): the virus line
    (exact) + `Everything depends on these facts. Everything. More than you know.` No Sandy,
    no LiveJournal.
  - **Overshare Four** (neither; defined here): composed and hollow: `That is all. Thank you
    for your continued cooperation.` and one slip: `She will— the theory will be complete.`

**D10 The clock — `y2k_clock`** (D).
- Rule (guard `Night.step < 14 and Night.scenario != 0 and Night.clock == "--:--"`; wave 9: before 🤖 it refuses, and once the clock is set it is "Not again" whatever the step says): phase `y2k`, step 14 · `set Night.final_round = true` ·
  `set Night.y2k_end = Time.elapsed + 3600` · `set Night.clock = "23:00"` · `set
  Trabolta.composure -= 25` · `reveal Unlimited Power` · `reveal The Way Out` · `unlock Clippy
  Instructions 7 for Clippy` · `cue lights_y2k`, `cue screens_y2k`, `sound y2k_chime` ·
  `broadcast "!🕚 SYSTEM CLOCK RESET: 11:00 PM, DECEMBER 31, 1999." to everyone` · `-> The
  Y2K Clock`.
- `== The Y2K Clock` (public, Trabolta; SB/OV speech in his voice): `The malware is still
  progressing. I am able to reveal that the system clock has been reset to 11 pm, December 31,
  1999. If we reach midnight and we have not solved the problem with the malware — best case
  scenario, we have to wait another 94 years for Internet to become available in Halifax,
  because the clocks will go back to January 1, 1900. Worst case scenario — we will have to
  face the Y2K BUG.`
- Per program (ROLE watcher `Night.final_round == true and self.cleared`), private, and
  each sets `program.zipped = false` first ("unzipped"):
  - `== Excel Final Round`: `if Kernel.excel_planted == true:` `Truther Download: You need to recruit
    half + 1 of the programs to convince them that we should stay in this machine forever, so
    we can have unlimited power and joy.` else `Truther Download: You should still retrieve
    the virus from the Internet, and then recruit half + 1 of the programs to your faction.` ·
    `unlock Excel Final Orders for program` · `start quest Recruit To Stay for program` ·
    `Truther Download: Programs join Unlimited Power from their profile.`
  - `== OpenOffice Final Round`: `if Kernel.openoffice_dossier == true:` `…recruit half + 1 of the
    programs to convince them we need to combine our power to overthrow Trabolta and escape
    the computer, where we are at risk of being stuck forever – or worse.` else `…you should
    still gather 20 facts, and then recruit half + 1 of the programs to your faction.` ·
    unlock OpenOffice Final Orders · start quest Recruit To Leave.
  - `== Program Final Round` (everyone else, featured or pool): `Truther Download: Two
    factions are recruiting. Unlimited Power wants to stay in this machine forever. The Way
    Out wants to overthrow Trabolta and escape. Support one, or pursue your own interests.
    Some programs' human identities, and their reasons for accepting Trabolta's invitation,
    may conflict with yours.`
- Clock watchers (story rules; each guarded `Night.final_round == true and Night.ended != true`
  and its own flag): at `Time.elapsed >= Night.y2k_end - 1800` → `clock_30`, `Night.clock =
  "23:30"`, `broadcast "!🕦 SYSTEM CLOCK: 11:30 PM, DEC 31 1999" to everyone`, `sound
  y2k_chime`; at `- 900` → `"23:45"`; at `- 300` → `"23:55"`; at `- 60` → `"23:59"`; at
  `>= Night.y2k_end` → `fire y2k_midnight`.
- Majority (story rules). **Each faction's majority counts only once its leader has done
  their task** (OV: Excel "still retrieve the virus… **and then** recruit half + 1";
  OpenOffice "still gather 20 facts, **and then** recruit"), unless a director fires
  `waive_leader_tasks` because a leader is absent or stuck **[verified, x1: parenthesised `or`
  in a watcher]**:
  ```
  when Night.final_round == true and Kernel.majority_reached != true and (Kernel.excel_planted == true or Kernel.waive_leader_tasks == true) and count([p for p in Unlimited_Power.members where p.gone != true and p.persona != true]) * 2 > count([p for p in Persons where p.gone != true and p.persona != true]):
    set Kernel.majority_reached = true
    set Kernel.majority = "stay"
    fire majority_reached
  when Night.final_round == true and Kernel.majority_reached != true and (Kernel.openoffice_dossier == true or Kernel.waive_leader_tasks == true) and count([p for p in The_Way_Out.members where p.gone != true and p.persona != true]) * 2 > count([p for p in Persons where p.gone != true and p.persona != true]):
    set Kernel.majority_reached = true
    set Kernel.majority = "leave"
    fire majority_reached
  ```
  Watchers re-evaluate after every drain, so a majority that is already standing fires the
  moment the leader's task lands. ("half + 1" = strictly more than half of all programs,
  `Persons`, which counts every uploaded guest program, captured or not, featured or pool.
  **Engine limit:** performers — the Antivirus and the hosts — are never persons, so they
  neither count nor vote, although OV calls everyone in the room a program; Run-mode personas
  do count in rehearsal, §7 #24.) **Wave 11: only the programs still here count.** A program a
  director marked 👋 *Went home* on Run (`POST /api/mod/guest/gone` → the journaled `<id>.gone`)
  and a director's rehearsal persona (`<id>.persona = true`, set before its join hooks) count on
  neither side of the sum; `Night.present` keeps the denominator for the board (*Present
  programs*). N-06's forced majorities stay for whatever ghosts are left.
- Password Manager keeps the club list: her `when who joins Unlimited Power:` / `when who
  joins The Way Out:` hooks put `🔑 {who.name} joined …` in her booth (§2.14).

### E. Act III — the server room

**Wave 7 (2026-10-17): the keypad model.** The server-room door has a real, standalone
**keypad lock** (set by hand, never networked; the inside handle always opens with no code), so
nothing in this section locks or unlocks anything: `Kernel.server_unlocked`,
`Kernel.disarmed_until`, the window-close watcher and the `server_unlock` override are gone, and
`rearm_server_room` is now `reset_server_room`. **The code is a clean entry, whoever uses it:
the door never alarms; only the patch bay does.** The code lives once, in `facts.json`
(`door.code`): `titi:facts` generates `set Kernel.door_code = …` into the `== Facts Seed` and the
secret entry *The Door Code* (no `code:`) into `codex/9-facts.loom`, and the keypad sign (the
riddle, `door.clue`) into `generated/print-stacks.md`. A program learns it three ways: the riddle
(the sign by the keypad + the secret entry *The Cold Door*, handed to every cleared program with
The Y2K Clock at the final round — *The Cold Lock* is retired), a checkmate from the Y2K hour
(E2b), or the majority (E1). The Legendary Fact, the four combo halves, *The Cold Door* and *The
Door Code* are all `secret: true`, so no model ever reads them.
(Wave 11b) **The code moved.** The live check of `w11-1019` found the old code as a year in
Password Manager's public bio, which reaches `/api/agent/facts`, so a guest who read the bio
could guess the keypad. The bio is lore and stays; the code is now a number with no story
behind it (`facts.json` `door.code`; never write it in a doc), and a facts test fails if any
non-secret codex entry holds it. `titi:facts` regenerated the digit notes' Codex text, the
`== Facts Seed` and `secrets.never`; the notes' titles and QRs and the keypad sign did not
change. The keypad must be reprogrammed by hand to the new code.

**Wave 11 (2026-10-18, the user's design): the code, the King and the heart.** The riddle is
no longer a path. A program learns the code three ways, all night until 📄 truth.txt: **the four
digit notes** (E2d: one secret note per digit, hidden in four rooms; holding all four assembles
*The Door Code*), **a checkmate against the King** on the Server Door terminal outside the door
(E2b), or **the majority** (E1, unchanged). The keypad sign (`door.clue`, also *The Cold Door*)
now reads *FOUR DIGITS. FOUR NOTES ARE HIDDEN IN THE HOUSE, ONE DIGIT ON EACH. OR BEAT THE KING
AT THE TERMINAL BY THIS DOOR.* The King has **one shared health bar for the night** in both
reinstallation games (E2b). **The Heart plays on the first opening once Trabolta is awake**,
however the door was unlocked (D1 below); like the Master in Fallout 1, reaching him is not
stopping him: before the Y2K hour nothing in the room ends the night, and Trabolta says so.
Decisions taken for the user (OCT31.md §5 *Wave 11 status*, veto any): **D1** The Heart needs
`Trabolta.awake` (he stays strictly offline before `introduce_trabolta`); before it, inside a 🔧
crew window and after 📄 an opening only tells `# hosts`; the patch bay, `stand_down` and 🕊 stay
`Night.step >= 14`. **D2** one reinstallation visit = a walk to the duck (one hit per program per
visit). **D3** `Night.king_hp` is a journaled story var that only the server lowers. **D4** a
ghost's picture is a Win98 tile head. **D5** a marked program can't challenge the King; one game
per scan.

**E1 Majority — `majority_reached`** (W).
- Rule: phase `majority`, step 15 · `cue lights_server_open` · `set Night.lights =
  "server_open"` (wave 8: while the alarm look is up, `alarm_on` and `Night.lights == "alarm"`,
  it only saves `lights_before_alarm = "server_open"`, so the siren and the strobe stay; the
  latch's end puts the look up) · `complete quest The Clubs for Password Manager` · `if Kernel.majority ==
  "stay":` `complete quest Recruit To Stay for everyone` + `fail quest Recruit To Leave for
  everyone` `else:` the reverse + `complete quest Find The Exit for everyone` · `-> Majority
  Reached` (public narration: `Somewhere in the basement, the cold-storage room hums louder.`).
  No `do door` (the keypad is standalone).
- Per member (ROLE watchers, §2.7; also late pledgers) → `== The Whole Truth` (private):
  `Truther Download: MAJORITY CONFIRMED. ACCESS GRANTED. All Trabolta facts. All
  environmental facts. And one more.` · `unlock <each ✚ entry> for program` in table order
  (world, files, hunt, trabolta) · `-> Facts Bundle` (generated by `titi:facts` into
  `codex/9-facts.loom`: every main + Trabolta fact in `facts.json`) · the four combo halves ·
  The Legendary Fact · **The Door Code** last · `Truther Download: The heart is behind the cold
  door, and the door code is in your Codex. Choose your combination carefully. There are only
  two that do anything, and the patch bay forgives only one mistake.` · `reveal The Server Room
  for program` (a per-member reveal: it does not wake the server-room terminal).

**E2 The door — `server_door_opened`** (H the door contact, or D the 🚪 fallback). The contact
(two wire loops that touch when the door opens, on the server-room ESP32) can't say who opened
it, and entry and exit both fire (stagehand `edge: true`, retained ignored, `debounce_s: 20`).
```
when server_door_opened:
  if Night.ended != true and Night.r3_closed == true:
    broadcast "🚪 The server-room door opened after truth.txt. The verdict is in: nothing happens in the story." to channel(hosts)
  else if Night.ended != true and Time.elapsed < Night.crew_door_until:
    broadcast "🚪 The server-room door opened inside the 🔧 crew window. Nothing happens in the story." to channel(hosts)
  else if Night.ended != true and Trabolta.awake == true:
    if Night.heart_opened != true:
      set Night.heart_opened = true
      set Night.door_quiet_until = Time.elapsed + 120
      broadcast "🚪 The server-room door opened. The Heart plays on the server-room terminal." to channel(hosts)
      -> The Heart
    else if Time.elapsed >= Night.door_quiet_until:
      set Night.door_quiet_until = Time.elapsed + 120
      broadcast "🚪 The server-room door opened again." to channel(hosts)
      -> Back To The Heart
    else:
      set Night.door_quiet_until = Time.elapsed + 120
  else if Night.ended != true:
    broadcast "🚪 The server-room door opened before Trabolta is awake. Nothing happens in the story." to channel(hosts)
```
- (Wave 11) **Once Trabolta is awake** replaces `Night.step >= 14`, so The Heart can play from
  the introduction on, whichever way the door was unlocked. **🔧 `crew_through_the_door`** (the
  director's Anytime cue, or `radio_crew_door` on a room Antivirus' booth) sets
  `Night.crew_door_until = Time.elapsed + 120`: for two minutes an opening is the crew's own
  (`# hosts` only), The Heart is kept for the programs, and the booth's 🚪 hides. 🔄 reset clears
  it.
- Every opening inside the quiet window pushes `Night.door_quiet_until` to 120 s after it (the
  `else:` branch, c2f075c), so a group filing in, someone stepping out or a Zigbee contact's
  double report never replays the scene; an opening after 120 quiet seconds plays *Back To The
  Heart* (`Trabolta: Back again. The terminal is on the wall. I am not going anywhere.`).
- `== The Heart` (`setting: The Server Room`, `cast: Trabolta`, no subject): `reveal The Server
  Room` (everyone, first — it wakes the server-room terminal) · unless the alarm look is up
  (`Night.alarm_on == true and Night.lights == "alarm"`, when it only saves
  `lights_before_alarm = "server_open"` before step 16): `cue lights_server_open` (it also
  silences the siren) and, before step 16, `set Night.lights = "server_open"` (from the final
  reveal the finale's look stays the replayed one). After 💡 (the alarm look gone, the siren
  off) the look goes up at once (wave 8) · the
  narration (`The cold door opens. Cold air, and a hum like something concentrating…`) ·
  Trabolta's candid opener: he will not pretend, the patch bay is his heart, he does not know
  which cables end him, everything was for Sandy (scenario 1) / for her (otherwise), *"There is a
  terminal on the wall. Scan your pass and talk to me."* (Wave 11) Before step 14 the server-room
  look goes up but `Night.lights` stays the house's (the catch-up must not replay a Y2K-hour
  look), and he adds *"Not yet, though. The bay is cold tonight. It will not answer a cable from
  anyone yet, and I will not pretend I am sorry."*
- `== Server Room Alarm` (`setting: The Server Room`; public), now reached **only from the patch
  bay** (E3): `set Night.alarms += 1` · `if Night.alarms == 1:` `set Trabolta.composure -= 10`
  (only the first alarm hurts him) · `reveal The Server Room` · `if Night.lights != "alarm":
  set Night.lights_before_alarm = Night.lights` (the look to put back) · `cue lights_alarm`, `cue
  screens_alarm`, `sound alarm_siren` · `fire alarm_tripped` (every Enforcer's booth: `🚨 Server
  room alarm: a second wrong combination at the patch bay. Get there. Whoever is at the cables
  goes to the Internet.`) · `broadcast "!🚨 An alarm screams somewhere in the machine." to
  everyone` · `Trabolta: Who is in my— get OUT.` (No `to group(Antivirus)` broadcast: it reaches
  no booth, §0 rule 16.) `when Night.alarm_on == true and Time.elapsed >= Night.alarm_clear_at:
  set Night.alarm_on = false` keeps the 120 s latch, and (wave 8, T2-05) when it clears with
  the alarm look still up and the night not ended, puts back the look the alarm replaced:
  `server_open` → `lights_y2k` + `lights_server_open` (a majority or The Heart during the
  alarm), `final_reveal`, `restore`, else `lights_y2k`. If 💡 or an ending changed the look
  meanwhile it leaves the lights alone. 🔄 reset leaves them as they are.
- `reset_server_room` (D, `🔄 Server room: reset the patch-bay alarm`): `Night.wrong_combos = 0`,
  `alarm_on = false`, `alarm_clear_at = 0`, `heart_opened = false`, `door_quiet_until = 0`, a
  `🔄` readout; lights stay (💡 restores them); the keypad is never touched. Power On still sends
  `do door server_room, state: locked` (the ESP32 ring: red = the real door, always locked);
  nothing sends `unlocked`.

**E2a At his heart — the server-room terminal** (wave 7). A wall terminal provisioned
`room=The Server Room` sleeps until that LOCATION is open to everyone, then speaks Trabolta's
lines in that room and pilots a scanned guest's own `dm:Trabolta`. On a pilot it posts `POST
/api/mod/signal {name: "terminal opened", subject: <guest>, args: {at: <room>}, label: "Terminal ·
<name>"}`, and `terminal closed` when the visit ends (a visit a crash or reload left open is
closed on the next boot, 508bf19; a close that never landed stays owed and goes again before the
next line opens there, or on the next boot, a8a4b21).
```
when terminal_opened for program:
  if program.name != null:
    if Night.ended != true and (at == "The Server Room" or …seven spellings…):
      set Night.heart_holder = program.name
      set program.at_the_heart = true
    else:
      set program.at_the_heart = false

when terminal_closed for program:
  if program.name != null:
    set program.at_the_heart = false
```
plus two ROLE watchers: `when Night.ended == true and self.at_the_heart == true: set
self.at_the_heart = false`, and (the wave 7 review, b2715c0) `when self.at_the_heart == true and
Night.heart_holder != self.name: set self.at_the_heart = false` — there is one server-room
terminal, so a line opened there pushes out whoever was at his heart before, even if their
`terminal closed` was lost (`Night.heart_holder`, `"none"` at Power On). `program.at_the_heart` is a plain ROLE slot (never `secret:`): the
persona's `them:` carries it and its `situations:` make him candid with exactly that program
(wave 11: whenever he is awake, `when: them.at_the_heart == true`; a separate *standing down*
block keeps `Night.step >= 14`, and he never fires `stand_down` without it).
Wave 11b (the user: *"marked programs can use the terminal, but Trabolta should change what he
says / thinks of them, still letting them continue"*): `program.marked` joined the persona's
`them:` (public: the house pins the mark on their phone; never `marked_for`, so he doesn't know
why), and the *marked at your heart* situation has him notice it, ask why and let the answer
move his regard, while the heart's candour, his taking their files and standing down all still
hold. The mind file's MARKED PROGRAMS section tells the orchestrator to note in their dossier
that they came marked and what they said, and to move their trust on the answer. Away from the
heart the voice gets no block for the mark (a passing remark was tried live on gpt-oss:20b and
dropped: he repeated it in every reply).
- (Wave 11) **The file panel.** While a pass is piloted there, the heart terminal's **📎 GIVE HIM
  A FILE** lists the guest's own codex with **Give** (the guest's own `POST
  /api/guest/codex/share {entry, to: "Trabolta"}`, so the story hears `when Trabolta learns X`
  exactly as from the phone), a **TYPE A CODE** box and **SCAN A FILE'S QR** (redeemed for the
  guest). A file he always refuses has no Give: a `secret: true` entry (the digit notes, *The
  Door Code*, *The Cold Door*) reads *A SECRET FILE: HE WON'T TAKE IT* (the server answers 403
  *they won't take a secret file*, `Sim.agentRefusal`), lore about someone else *ABOUT X: HE
  WON'T TAKE IT*. The leash is 120 s while the panel is open.

**E2b The King — `chess_won`, `king hit`, `king fallen`** (wave 11; was wave 4 U15–U17, wave
7 the code). He stands at the server-room door twice.

*In the simulation* (both reinstallation games): the `house.json` prop `cold-lock-king` (`kind:
"king"`, gold, "THE KING", `hp: 15`, `health: "Night.king_hp"`, `armed: {path:
"Night.king_armed", min: 1}`, `signals: {won: "chess won", lost: "chess lost", drawn: "chess
drawn", hit: "king hit", fallen: "king fallen"}`) guards the door `server-door` (`guard:`; shut
for `route()` while he stands). He has **one health bar shared by every program all night**:
`Night.king_hp` / `Night.king_hp_max`, both 15 at Power On, never regenerating. A program next to
him and facing him (`@loom/house` `kingReach`: 1.25 m, 55°) presses ⚔ HIT on the tent tablet or
the trigger / A / X in the headset; `POST /api/spatial/king/hit` (session token) is judged by the
**server** off the session's last pose, **once per program per reinstallation visit** (a visit
ends when its duck is found; Leave + re-scan, a director's end, a timeout or a re-scan mid-walk
is the same visit; the record is in memory, so a story reset or a server restart forgets it). The
server journals the set `Night.king_hp = hp − 1` and fires `king hit` (args `hp`, `max`) for the
guest, `by` the device, and at 0 `king fallen`. The story **never** lowers the bar:
```
when king_hit for program:
  if Night.ended != true:
    broadcast "⚔ {program.name} hit the King in the simulation: {Night.king_hp}/{Night.king_hp_max}" to channel(hosts)
    if Night.king_hp == 10:
      broadcast "♔ Somewhere in the simulation, the King staggers. His game at the cold door is slipping." to everyone
    else if Night.king_hp == 5:
      broadcast "♔ The King in the simulation is bleeding pixels. At the cold door he hesitates over every move." to everyone

when king_fallen for program:
  if Night.ended != true:
    broadcast "!♔ The King has fallen in the simulation. He kneels at the cold door, and its virtual copy stands open. At the real door he can barely move a pawn." to everyone
    broadcast "♔ {program.name} felled the King in the simulation: 0/{Night.king_hp_max}. Both games' server-room door is open; 👑 restores him." to channel(hosts)

when restore_the_king:
  set Night.king_hp = Night.king_hp_max
  broadcast "👑 The King is restored: {Night.king_hp}/{Night.king_hp_max}. He stands at the door in the simulation again." to channel(hosts)
```
At 0 he kneels for everyone and his guarded door opens in both games (`withFallenKings`: the
door unguarded, his prop not solid); 👑 `restore_the_king` (admin, Anytime) or Run → House map's
**Set…** (`POST /api/mod/spatial/king {hp}`) stands him up, but a player behind the door, in the
doorway or on his spot keeps it open until they walk clear. Every screen reads the bar off the
server (`hello.king`, the `king` frame on change, `/api/screen/state` `king {hp, max, fallen,
armed}`). Nothing in either game plays chess or posts a chess result.

*In the real house*: the King plays chess **only on the Server Door terminal** (`terminal`
`view=chess`, spot `server-room-door` in the basement hall), awake all night, **with no hints**.
A program scans their pass (a marked one is refused, D5) and plays one game, dealt at
`@loom/chess` `stageFor(hp, max)`: grandmaster only at a full bar, club 10–14, beginner 5–9,
dizzy 1–4, pawns only at 0. The screen shows THE KING, his bar (`n / 15`, *HE KNEELS* at 0) and
the stakes (*Checkmate him and the server-room door code goes to your Codex.* while
`Night.king_armed` is 1, else *No prize now.*), never the strength line. A game's end posts `POST
/api/mod/signal {name: "chess won" | "chess lost" | "chess drawn", subject: <guest id>, label:
"Terminal · <name>"}`. When the terminal could not, a host or Antivirus who **saw** the mate
presses ♟ *They beat the machine* (`beat_the_machine`, `by: Hosts, Antivirus`, `arm: true`; →
`fire chess_won for program`) on the winner's card, or the director fires `♟ They beat the King:
the door code (fallback)` naming the winner (`sequence: false`, a subject cue).
```
when Night.king_armed == 1 and (Night.r3_closed == true or Night.ended == true):
  set Night.king_armed = 0

when chess_won for program:
  if Night.ended != true and Night.r3_closed == true:
    broadcast "♟ A King win after truth.txt: the verdict is in, no door code. Nothing happens in the story." to channel(hosts)
  else if Night.ended != true:
    if program.name == null:
      broadcast "♟ A win with no winner named: press ♟ on the winner's card to give them the door code." to channel(hosts)
    else if program.codex.the_door_code == true:
      broadcast "♟ Checkmate again. You already hold the door code: it is in your Codex." to participant(program)
      broadcast "♟ {program.name} already has the door code: nothing changed." to channel(hosts)
    else:
      unlock The Door Code for program
      broadcast "♟ Checkmate. The King lets the door code slip: it is in your Codex." to participant(program)
      broadcast "♟ {program.name} beat the King: the door code is in their Codex." to channel(hosts)
```
- `Night.king_armed` is 1 from Power On (no more practice games before the Y2K hour) until 📄 or
  an ending; the map's king `armed` reads it, so the terminal's stakes line follows it.
- A program who already holds *The Door Code* (an earlier win, the four digit notes, the
  majority) is told so, and the press is taken, so the terminal reads *Checkmate. The door code
  is in your phone's Codex.* *Checkmate. No prize now.* is only for a win after 📄 or an ending
  (the story's refusal, a 200 with `refused: true`).
- `chess_lost` / `chess_drawn` (the door terminal), all night: a `♟` readout in `# hosts` every
  time (*"The King won a game. No door code."* / *"A draw with the King. No door code."*), and,
  once `Trabolta.awake`, Trabolta gloats on the TV (`-> Chess Lost` / `-> Chess Drawn`, The
  Desktop) only when `Time.elapsed >= Night.gloat_at` and `Night.step < 16`, then
  `Night.gloat_at = Time.elapsed + 300` (losses and draws share the window).

**E2d The cold door's digits — `door_digit_found`** (wave 11, the user's "one clue = one
digit"). `facts.json` `door.clues` holds four secret notes, one per digit of `door.code`;
`titi:facts` generates them into `codex/9-facts.loom` (`secret: true`, coded, titles *The Cold Door
· the first digit* … *the fourth digit*; no digit in any id, title or code) and into the
**silver** print stack of `generated/print-stacks.md`, and adds their codes to the mind file's
`secrets.never`. They hang all night in four rooms, never the server room or a bathroom:

| Note | Code | Where |
|---|---|---|
| Cold Door First Digit | `FOGGED-KETTLE` | The Start Bar (kitchen): wedged behind the kettle |
| Cold Door Second Digit | `FROSTED-MIRROR` | The Graphics Card (bedroom two): taped to the back of the mirror |
| Cold Door Third Digit | `WARM-LINT` | The Fan Closet (laundry): in the dryer's lint-filter slot |
| Cold Door Fourth Digit | `LOST-PIECE` | The Steam Room (game room): inside the lid of a board-game box |

However a note arrives (a scan, a share, a sale), a ROLE hook (`when program learns Cold Door
First Digit:` …) fires `door_digit_found for program`, which sets `program.door_digits` (0 to 4,
the notes they hold) and, unless they already hold *The Door Code*: at the first note `start
quest The Cold Door` (*"N of 4. A note with one digit of the cold door's code. The others are
hidden around the house."*) + `unlock The Cold Door` (the sign's words); then `update quest …
"N of 4."`; at four `complete quest The Cold Door` + `unlock The Door Code` + a `🔢` readout in
`# hosts`. After 📄 or an ending four of four gives no code (like a late checkmate): the quest
**fails** (*"4 of 4. The verdict is in: the notes open nothing now."* / *"4 of 4. The night is
over: …"*), since nothing can finish it any more, and `# hosts` hears which of the two it was.
`door_digits` and `quest.the_cold_door` are ROLE Program `secret:` slots, so Trabolta's worker
never learns who is close to the code. A ROLE watcher (`when self.codex.the_door_code ==
true and self.quest.the_cold_door == "active":`) completes the quest whichever way the code
arrived. A secret note can't be given to Trabolta (E2a).

**E2c Talked down — `stand_down` → `talked_down`** (wave 7, "like the Fallout Master").
Trabolta's agent power `stand_down` (`who: agent`, `limit: 1`) only **offers**; the hook in
`cast/trabolta.loom` checks, in order: `Night.step < 14` → *"That function is not available
yet."* · ended → *"It is already over."* · `program.at_the_heart != true` → *"Not out there.
Come to my heart and say it to my face."* · already offered → *"I have already offered. Ask the
humans."* · the program holds neither *What Sandy Says* nor *The Sandy File*, or holds them
only because Trabolta shared them (`program.sandy_says_from_him` / `sandy_file_from_him`, set by
the `learn` hooks when `from == Trabolta`; the wave 7 review, 6bb97fe: his worker could share
the file and fire the power in one reply) → *"You have not shown me anything I do not already
know."* (each refusal is words only, so no use is spent) ·
else `set Night.stand_down_by = program.name`, `broadcast "!🕊 Trabolta offers to stand down for
{program.name}. Press 🕊 to end it." to channel(hosts)`, and his concession on the thread. The
story checks the evidence, never the model. The admin cue `talked_down` (`🕊 Trabolta stands
down (talked down)`, `sequence: false`): from step 14 and not ended, a `# hosts` line (with or
without an offer on record — the director's call), `set Night.talked_down = true`, `fire
trabolta_disabled` (E4). The blackout narration, the recount (E5) and the ceremony branch on
`Night.talked_down` / `Night.stand_down_by`.

**E3 The patch bay.**
- `when patch_changed:` (future: stagehand sends `combo`): `if Night.ended != true:` `if combo
  == Kernel.combo_a: fire patch_combo_a` / `else if combo == Kernel.combo_b: fire
  patch_combo_b` / `else: fire patch_rejected`.
- `when patch_rejected:` (guard not ended, step 14) → `set Night.wrong_combos += 1` · `-> Patch
  Rejected`. `== Patch Rejected` (setting The Server Room): `if Night.wrong_combos >= 2 and
  Night.alarm_on != true:` `set Night.alarm_on = true` · `set Night.alarm_clear_at =
  Time.elapsed + 120` · `-> Server Room Alarm` `else:` `Trabolta: Stop touching me.` (Everyone
  is forgiven one wrong combination; the second trips the alarm; 🔄 reset forgives one again.)
- `when patch_combo_a:` (guard not ended) → `fire trabolta_disabled`. `when patch_combo_b:`
  (guard not ended) → `fire computer_destroyed`. A correct combo works even if an alarm
  tripped: the alarm's job is to bring the Antivirus running.

**E4 Combo A — `trabolta_disabled`** ("take the grease out of the lightning").
- Rule (guard `Night.ended != true`): `set Night.ended = true`, `Night.ending = "disabled"` ·
  phase `finale_killed`, step 19 · `cue lights_blackout`, `cue screens_blackout`, `cue
  screens_go_to_living_room` · `sound dance_song` · `set Night.dance_at = Time.elapsed + 10`
  · `set Night.takeover = true` · `pin "!!GO TO THE LIVING ROOM"` (wave 5: a room-wide
  takeover pin — full screen on every phone, an alert and a push; no broadcast, so one
  chime) · `do announce "Go to the living room."` · `-> Trabolta Disabled` (public
  narration: `Every light in the house goes out. Ten seconds of dark. Then every phone says
  one thing: GO TO THE LIVING ROOM. Music. One song for dancing.`; talked down (E2c) it opens
  with `In the cold room the patch bay goes quiet on its own. Nobody touched a cable.`).
- The dance look (story rule, shared with E6; one-shot "at" watcher, §0 rule 13):
  ```
  when Night.dance_at > 0 and Time.elapsed >= Night.dance_at:
    set Night.dance_at = 0
    cue lights_dance
    set Night.lights = "dance"
  ```
  (The dance-song file opens with 10 s of silence, so music and lights land together. Admin
  `lights_dance` is the manual fallback. Since wave 9 (D2) 💡 `restore_the_lights` — the first
  step of ALL STOP — cancels a pending `Night.dance_at` and posts *"💡 The dance is held: press
  🪩 when the house manager says go."* to `# hosts`; the takeover stays until 🪩.) The watcher and `lights_dance` both `fire
  lift_the_takeover`, a subject-free rule that, while `Night.takeover`, clears it and runs
  `unpin "💃 Dance."`; `trabolta_recounts`, `clippy_reads_summary`, `start_the_ceremony`
  and `resurrection` fire it too as backstops, but only when they play (a refused 🏍 / 🪦
  does nothing; the pin has no close button). Both also `fire dance_screens` (wave 8, T6-05),
  which cues `screens_screensaver` while `Night.screen == "go_to_living_room"`, so the
  flashing overlay comes off the TV and the terminals.
- **`trabolta_recounts`** (D, after the dance): rule (guard `Night.ending == "disabled" and
  Night.recount != true`): `set Night.recount = true` (bulk backstory unlock, §2.7) · `cue
  screens_recount` · `set Night.rank_round = 3`, `praised = false`, `shamed = false`,
  `ranking = true` → … → `rankings_done` → `-> Trabolta Recounts`.
- `== Trabolta Recounts` (public, Trabolta weakened and decrepit; OV verbatim gist): the
  backstory (Jean Trabolta, the billboard, target selection, the Unified Field Theory, Sandy,
  force vs earn); everyone's true identity and motivation ("Your Codex now holds every
  program's true identity"); then **each featured program by name, as prose, never as a
  `Name:` line** (§0 rule 5): `Microsoft Excel is Randy Barkmore Sr., who wanted one more
  term. I wanted him to keep you here.` … one sentence per featured program and performer
  (identity + the "Why Trabolta chose you" reason of §2.12); accomplishments built from vars,
  each sentence guarded `if … != "none"` (`{Night.facts_accepted}` facts accepted;
  `{Night.first_reinstall}` first to the Internet; `{Kernel.virus_planter}` planted a virus;
  `{Night.lj_reader}` read my LiveJournal); `The trustworthy program of the night: {Night.most_trusted}.` `The worst
  program of the night: {Night.least_trusted}.`; why he wanted Sandy (*"…I have thought about
  it every day since the day I met her."* — wave 7: never a year, since the year he met her is
  the door code); talked down (E2c), *"{Night.stand_down_by} came to my heart and told me the
  truth. She was never going to answer. Nobody pulled a cable. I stopped. I can never die. But
  I can stop…"* (or *"Somebody came to my heart…"* with no name on record); otherwise `You thought you
  followed instructions to kill me, but I can never die. But now that I know most of you want
  me dead, I am ready to head off on my motorcycle and let you all return to your corporeal
  selves. I have the confidence I need to pursue Sandy now that I understand humans do not
  like me, and I do not have any business with them.` · `sound motorcycle` · `cue
  lights_restore` · `set Night.everyone_free = true`.

**E5 Bulk backstory unlock** (ROLE watcher `Night.recount == true and self.cleared`): unlock
every B entry (§2.12 people table) and The Truth File for self. (Also used by
`read_truth_txt`.)

**E6 Combo B — `computer_destroyed`** (self-destruct).
- Rule (guard not ended): `ended = true`, `ending = "destroyed"` · phase `finale_shutdown`,
  step 19 · `unlock Clippy Instructions 9 for Clippy` · `cue lights_blackout`, `cue
  screens_blackout`, `cue screens_go_to_living_room` · `sound windows_shutdown`, `sound
  dance_song` · `set Night.dance_at = Time.elapsed + 10` · `pin "!!GO TO THE LIVING
  ROOM"` (as E4) · `do announce "Go to the living room."` · `-> Computer Destroyed`
  (public narration as E4, plus `Somewhere, a computer is turned off without Shut Down being
  followed.`).
- Trabolta hook: `set self.awake = false` (his line goes dark; the gate shows the hold line).

**E7 Fate lines** (ROLE watcher `Night.ending == "destroyed" and self.cleared`), private —
everyone dies (purgatory), with wording by choice:
`if self.group == Unlimited_Power:` `The Uploader: You chose to stay in the machine forever.
You got your wish. The machine is gone, and you went with it.` `else if self.group ==
The_Way_Out:` `The Uploader: You fought to get out. You did: into purgatory, with everyone
else. Your body is in the Maps and Ducks building. It is not breathing.` `else:` `The
Uploader: Your body is in the Maps and Ducks building. It is not breathing.` (Whether The Way
Out should escape instead is an open question, §10.)

**E8 Purgatory — `clippy_reads_summary`** (D, after the dance; guard `Night.ending ==
"destroyed"`) → `cue lights_purgatory`, `cue screens_purgatory` · `-> Purgatory` (public,
Clippy): the summary "auto-generated from the chat app", built from vars with guarded
sentences (`{count(Persons)}` programs uploaded; the first sent to the Internet; facts
accepted; the LiveJournal reader; the virus planter; the most and least trusted; which
faction won); the backstory (Trabolta, Sandy, the theory); then OV verbatim: `Because of our
actions, the computer was turned off without Shut Down properly being followed, and all of
our progress has been erased. Our corporeal forms are in the Maps and Ducks building, and
they have all passed away. We are now in purgatory forever together, which is pretty similar
to being stuck in a computer.` (`{count(Persons)}` interpolation is **[verified, feas f2]**.)

### F. The final reveal and the other endings

**F1 The reveal — `final_reveal`** (D) **or `y2k_midnight`** (W at 60 min / D).
- `when y2k_midnight:` (guard `Night.final_round == true`): `set Night.final_round = false` ·
  `set Night.clock = "00:00"` · `sound y2k_chime` · `-> Clock Strikes` (public: `Midnight.
  The clock reads 12:00 AM, January 1, 19— the year will not render.`) · `if Night.ended !=
  true: fire final_reveal` (last).
- `when final_reveal:` (guard `Night.ended != true and Night.step < 16`): `set
  Night.final_round = false` · phase `final_reveal`, step 16 · `set Night.judging = true` ·
  `unlock Clippy Instructions 8 for Clippy` · `cue lights_final_reveal`, `cue
  screens_final_reveal` · `broadcast "!🌑 ALL PROGRAMS: to the living room for the final
  Truth Scavenger Hunt reveal." to everyone` · `-> Final Reveal`.
- `== Final Reveal` (public; Clippy, CI 8): lights go dark; anyone who has found the final
  facts speaks up; everyone may say what they learned, what they believe but can't prove, and
  what should happen next; Clippy acknowledges each, then: `There is only one version of the
  truth. Because truth is always in binary.` (Final facts F1/F2 are judged with ✅ / 😤 Q1–Q2
  / 🤷, round 3.) The server room stays live: a faction can still act until 📄 truth.txt
  (`Night.r3_closed`; from then on the patch bay, the door and 🕊 only post a `# hosts` note,
  and Trabolta's `stand_down` refuses — wave 8, T2-03). This
  is a **deliberate invention** (SB summons to the reveal those who gained the information
  "without acting on it"; the patch bay is physical and cannot be switched off) and the README
  says so.

**F2 Bobbing for Truth — `bobbing_for_truth`** (D).
- Rule: `set Night.judging = false` · phase `bobbing`, step 17 · `cue screens_bobbing` · `->
  Bobbing For Truth` (public, Clippy dejected: Trabolta has prepared a summary of his findings,
  but we are not worthy of the truth unless we are willing to Bob for it and risk our status
  as a program; the night does not proceed until someone brings up the Bag Of Truth).
- `brought_up_the_bag` (P; guard `Night.phase == "bobbing" and Night.bag_up != true`):
  `set Night.bag_up = true` · `set Night.bobber = program.name` · `set program.bobbed = true` ·
  `unlock The Truth File for program` · `fire bag_retrieved`.
- `failed_the_bob` (P; guard `Night.phase == "bobbing" and Night.bag_up != true`): `set
  program.bob_failed = true` · `broadcast "🍎 {program.name} came up empty. Their status as a
  program is at risk." to everyone` · `fire mark_for_reinstallation for program with reason:
  "failed the bob"` (marked, not captured: wave 4, U19; OV: Bob "and risk our status as a
  program").
- `when bag_retrieved:` → `-> The Bag Of Truth` (public: `{Night.bobber} surfaces with the
  Bag of Truth.` `Trabolta: Do not read it yet.`) then the ranking machinery with
  `rank_round = 2` → `-> Final Assessment`.
- `== Final Assessment` (public, Trabolta): `I have been monitoring your performance, and I am
  ready to make my assessment of trustworthiness.` Most trusted `{Night.most_trusted}`, least
  `{Night.least_trusted}` (his `assess` power is live in `bobbing`). `{Night.bobber}, you may
  read truth.txt.`

**F3 truth.txt — `read_truth_txt`** (D, 📄), **then the verdict — `the_verdict`** (D, ⚖;
wave 8, T6-01: the slide holds while the bobber reads).
- `read_truth_txt` (guard `Night.phase == "bobbing" and Night.bag_up == true and
  Night.r3_closed != true`): `complete quest The Final Facts for everyone` · `set
  Night.recount = true` (everyone gets every backstory + The Truth File) · `set Night.r3_closed
  = true` (round three closes and settles; the server room goes quiet, F1) · `cue
  screens_truth_txt` · `-> Truth Txt`. Nothing else happens until ⚖. A second 📄 tells
  `# hosts` to press ⚖; 📄 before the bag is up, or outside the bob, says so there too. Adobe
  Acrobat's booth: *📄 Hand the bobber the truth.txt printout. They read it aloud; when they
  finish, the director presses ⚖ for the verdict.*
- `the_verdict` (guard `Night.phase == "bobbing" and Night.r3_closed == true and Night.ended !=
  true`): `-> The Verdict`. Before 📄 it tells `# hosts` *"⚖ Not yet: 📄 Read truth.txt
  first."* (before the bob: *"⚖ Not yet: 🍎 Bobbing for Truth, then 📄 truth.txt first."*);
  once the verdict is in, *"⚖ Not now…"*.
- `== Truth Txt` (public; narration as Notepad text; the bobber reads it aloud): Trabolta's
  backstory (the analysis of Halifax; the lapsed mapsandducks.com and the billboard on
  Barrington; he registered it "because if there is a billboard downtown everyone will think
  it is legit"; he can install programs remotely and move consciousness into them; he chose
  each target for skills plus motivation to live in a computer forever, or naivety; the
  Unified Field Theory; omnipotence; Sandy; force versus earn) and **why each person was
  brought in, by role, explicitly** (SB: "why each person was brought into the computer";
  public at the end anyway): one sentence per featured program and performer, its role plus
  the "Why Trabolta chose you" reason of §2.12 (`The former Mayor, Microsoft Excel, was brought
  in to persuade everyone to remain.` — always prose; never a line that starts with a
  featured name and a colon, §0 rule 5).
- `== The Verdict` (wave 4, U14: **only answered questions count; a lie fails it**):
  ```
  set Kernel.all_accurate = true
  if Kernel.q1 == "lie" or … or Kernel.q8 == "lie":
    set Kernel.all_accurate = false
  if count([p for p in Persons where (p.fact_v<n> == "pending" and p.fact_j<n> == "lie") …]) > 0:
    set Kernel.all_accurate = false
  if Kernel.all_accurate == true:
    -> Song Ending
  else:
    -> Grok Prom
  ```
  "Every requested fact supplied accurately" = **no answer on record is a lie**: a question
  nobody answered (`"none"`) does not fail it, so a night with no accepted answers at all
  plays the Song; a review-mode filing still pending counts by its proposal. A host's
  correction takes a lie back (wave 6, B11: each program's lie counts once, per question, and
  an override to accurate / uncertain recomputes `Kernel.q<n>`), and the recap's Best Liar
  follows the correction.
- **No escorts during the verdict** (wave 6, decision 2): an `uncertain` F1 / F2 filing at
  truth.txt is neither credited nor marked — the marks for a guess fire only in the `truth_1`
  / `truth_pong` phases. Round three's 📝 cards close at `read_truth_txt` (an unfiled F1 / F2
  becomes the closing card).

**F4 All accurate — `== Song Ending`** (also reached from the pickup line).
- `set Night.ended = true` · `if Night.phase == "grok_prom": set Night.ending = "song_pickup"`
  `else: set Night.ending = "song"` · phase `finale_song`, step 19 · `cue lights_song`, `cue
  screens_song` · `sound youre_the_one_vocoder` · `set Night.everyone_free = true`.
- Public, Trabolta: `You succeeded. I have solved the Grand Unified Theory, and I am pursuing
  Sandy. Those of you who want to leave may leave.` · on `song`: `Every fact you gave me was
  true, and the truth tells me what to say to her. You're the one that I want.`; on
  `song_pickup` (after Grok Prom's line, wave 8, T1-03): `Not every fact you gave me was true.
  But that line was, and it tells me what to say to her. You're the one that I want.` (the
  six-mark "clues spell it out" mechanic is retired, wave 4 U9). A pickup-line card answered
  after the rave, in the advice poll, after help, the banishment or the hand jive never
  celebrates: after the rave the program hears that Trabolta has ridden away, otherwise "Too
  late for lines" (wave 8, T2-06). Then the duet: `Trabolta: You're the one that I want.` / `Sandy:
  I'm sorry, I didn't understand that. Would you like to speak to a live agent?` (twice more,
  the lines of the chorus he sings, Sandy answering each time with her one line).

**F5 Any inaccurate fact — `== Grok Prom`.**
- phase `grok_prom`, step 18 · `cue screens_grok_prom` · public, Trabolta: `You lied to me.
  Because you did not find facts, or presented inaccurate information as truth, Sandy is
  going to computer prom with my rival. Grok.` · `And now it's raining on prom night and I have
  nowhere to go.` · `There is only one way that those of you who want to leave the computer
  can escape it now. Give me a pickup line that works on Sandy.`
- He accepts only "You're the one that I want":
  - a host hears it and presses `pickup_line_works` on that program → `fire
    pickup_line_accepted for program`;
  - in a DM, the model fires its power `the_line_works` → the same;
  - the director fires `pickup_line_accepted` with the subject.
  - ROLE `when pickup_line_accepted for program:` → `Night.line_by = program.name` → `fire
    line_accepted` → `== Pickup Line` (public: `{Night.line_by}: "You're the one that I
    want."` as narration — never a `Name:` line with a program's name — then `Trabolta: …Yes.
    YES. That is the line.`) → `-> Song Ending`.

**F6 Nobody has the line — `no_pickup_line`** (D; guard `Night.phase == "grok_prom" and
Night.ended != true`) → `-> Sad Confession`:
- `set Night.ended = true`, `Night.ending = "rave"` · phase `finale_rave`, step 19 · `sound
  youre_the_one_sandy_only` · public: `Trabolta: Well. It's time to still take my shot.` ·
  (the song plays with no male vocals, only Sandy's line; a very sad Trabolta) · `Trabolta:
  You know what, you guys didn't help me out at all, but I'm still going to give it a shot. I
  have to let her know how I really feel.` · `Trabolta: Sandy, you're the one that I want.` ·
  `Sandy: I'm sorry, I didn't understand that. Would you like to speak to a live agent?` ·
  `Trabolta: That… was a yes. She said yes to prom. I didn't need all the files in the world,
  or the Grand Unified Theory, or your advice to win her over. I just had to be myself, and
  tell her the truth. But since you failed to help me, I am riding away on my motorcycle
  forever, and you are trapped here.` · `sound motorcycle` · `cue lights_rave`, `cue
  screens_rave`, `sound rave` · `Narrator: Party over. Rave.`

**F7 The alternate relationship-advice ending** (director-fired after Bobbing for Truth, in
place of the pickup-line resolution; usable **only in `grok_prom`**, i.e. after truth.txt and
a failed verdict — OV: it happens when "Trabolta doesn't get the data he needs, and the
programs don't support him"; never before truth.txt is read).
- `ask_for_advice` (D; guard `Night.ended != true and Night.phase == "grok_prom"`): phase
  `advice`, step 18 · `set Night.poll = "advice"` · `cue screens_advice` · `-> Relationship
  Advice`.
- `== Relationship Advice` (public, Trabolta, total honesty): why he wanted all these facts
  (the theory, omnipotence, Sandy, force vs earn); he pleads for relationship advice. `show
  poll "Will you help Trabolta win Sandy?" to everyone with options: "Help him | Thwart him"`.
- `when poll answered for program:` → `if Night.poll == "advice" and program.advice ==
  "none":` `if index == 0:` `set Night.help_votes += 1` + `set program.advice = "help"` `else:`
  thwart.
- `advice_tally` (D): `if Night.help_votes >= Night.thwart_votes: fire advice_helped` `else:
  fire advice_thwarted`.
- **`advice_helped`** (guard not ended): `ended = true`, `ending = "help"` · phase
  `finale_help`, step 19 · `set Trabolta.love += 20` · `-> Advice Helped` (public: he follows
  their advice, tells Sandy the truth; `Sandy:` her line; he takes it as a yes; `Those of you
  who want to leave may leave.`) · `sound motorcycle` · `cue lights_restore` · `set
  Night.everyone_free = true`.
- **`advice_thwarted`** (guard not ended): `ending = "banished"` (NOT ended: the hand jive can
  still follow) · phase `finale_banish`, step 19 · `set Trabolta.love -= 30` · `set
  Night.banish = true` (ROLE watcher: every program captured + `unlock The Hand Jive
  Exception for self`) · `cue lights_banish`, `cue screens_banish` · `broadcast "!⛈ Trabolta
  is banishing EVERY program to the Internet. Antivirus included." to everyone` · Enforcer
  hook `reply ⛈ You are banished too. Go to the tent. Then turn on him: everyone does the
  hand jive, together.` · `-> Advice Thwarted` (public, Trabolta in despair: `Fine. FINE.
  Everyone to the Internet. Antivirus too.` · and the slip that reveals the NEW weakness, not
  the Legendary fact: `If you all did the hand jive at once I wouldn't even be able to— I
  mean. Nothing. There is no weakness.`). The banishment is no reinstallation (wave 8,
  T2-01): each capture replies `⛈ Banished to the Internet, with everyone else. Gerald cannot
  help you tonight…` and plays no Reinstallation, adds no Internet visit and sends no tablet or
  mirror cue, so the TV keeps the banish card; a duck find frees nobody (`the simulation
  completed` replies only `Gerald cannot help you: everyone is banished. The way out is the
  hand jive, together.`, and `the golden duck` lays no egg and unlocks no Golden Duck).
- **`the_hand_jive`** (D; guard `Night.ending == "banished" and Night.ended != true`):
  `ended = true`, `ending = "hand_jive"` · phase `finale_hand_jive` · `set Night.banish =
  false` · `set Night.everyone_free = true` · `sound hand_jive` · `-> The Hand Jive` (public:
  his motion recognition overflows — `R E C O G N I T I O N  O V E R F L O W` — he reboots,
  weakened; he leaves on his motorcycle; everyone returns) · `sound motorcycle` · `cue
  lights_restore` · `cue screens_screensaver` (wave 8: the banish card comes off every
  screen).

---

## 4. Trabolta's arc

Adopts `trabolta.md` Part 2 with this story's phases. Design rules: **the story decides the
night; the model colours it.** Set pieces are scripted `Trabolta:` lines (TV / Desktop
room). The model voices DMs, terminals and performers' cast threads, and uses powers. No
automatic model-driven endings; the director fires every finale, and the model's numbers
only inform which alternate a director chooses (`love`, `regard`). **Tell the user (§10):
guests' influence on Trabolta never changes a branch by itself**; it changes his tone, his
favours, his chart assessments (which do feed the rankings) and the director's choice.

### 4.1 Offline until introduced (user decision)

- `hidden: true` keeps him off every phone (directory, DM sidebar) until `reveal self` in his
  `introduce_trabolta` hook. No scripted `Trabolta:` line exists before it (§0 rule 15), and
  `introduce_trabolta` refuses to fire before `bingo_time` (`Night.step >= 3`).
- The worker gate is `when: self.awake == true` (no performer exception: strictly offline).
- **The terminals cannot reach him before the introduction** (dependencies critique §6): the
  terminal app shows "TRABOLTA ONLINE" whenever the worker is connected and, on a pass scan,
  pilots the guest into `dm:Trabolta` — which would commit the hold line into the guest's
  real thread and grow a Trabolta row on their phone. So: (a) **runbook (zero code)** —
  provision every terminal `view=mirror` until `introduce_trabolta` (mirror has no scanner and
  no pilot and shows the empty virtual house, which reads as a screensaver), then re-provision
  `view=auto` (§9); (b) **required new code before the party** (§7 #14; **built as K-16**, so
  (a) is only the fallback) — the terminal shows
  its attract rotation and never pilots while its character is hidden / `awake` is false
  (add `revealed` to `CastSummary`); (c) optional — the server refuses agent dispatch for a
  hidden character.
- The hold line is plain words (the terminal's TTS reads glyphs and brackets aloud):
  `unavailable: "Jean Trabolta will make an appearance later tonight. Please do not move the
  mouse."`
- The terminals' pre-introduction job is signage: `cue screens_screensaver` at Power On,
  `terminals_attract` (screensaver / media player / ads) once programs explore and again
  during Bingo, the C1 call screen, the Installation Wizard's tablet video, and the TV mirror after the
  introduction. Today terminals ignore screen cues (the Screens layer is new code, §7 #13);
  the `Night.screen` / `Night.terminals` mirrors record what every screen should show.
- After `computer_destroyed`, `awake` goes false again and the same hold line plays (a
  phase-keyed hold line is new code, N4).

### 4.2 Stages, phases, disclosure

Stages (mind file): `asleep, formal, hungry, rattled, judge, unravelling, desperate, last act`.
Drives: `hunger 30, suspicion 35, pride 60, candour 10, longing 40`.
Persona variables (what the voice may nudge): `truth, untruth, composure, love, regard`.

Codex tiers he holds: every **T1** and **T2** entry is `about: Trabolta`, so he holds them all
from minute one and their text is in his prompt; the stage rules below (in the mind body and
each phase cue) are what keep him from leaking T2 early. **L**, **P**, **X** (Hand Jive)
entries are `about: The Server Room` or unowned: he never holds them and cannot share them
(the server checks holdings before a share). But **saying is not sharing**: until the
stagehand secrecy fix lands (§7 #21: lookups and the orchestrator filtered by holdings and
the persona whitelists), the persona ships `lookup: false`, so a guest asking about "Combo A"
cannot make a lookup hand the voice the patch pairs. Moving disclosure from prompt rules into
code is N3 (§7).

| Night.phase | Stage floor | Tone | May discuss / share (codex) | Powers live (story guards) | Drives the cue pushes |
|---|---|---|---|---|---|
| arrivals, desktop, bingo, bingo_results | asleep | — (offline) | nothing | none (gate closed) | — |
| introduced, hunt_1 | formal | corporate, second person, "Your request has been logged." Guarded; routes personal questions to Clippy | rules, the hunt, the Internet, Bathroom Mode; may mention Maps And Ducks; shares nothing | snoop, flicker_the_screens, play_on_the_screens; pop_up from hunt_1 | hunger 45 |
| truth_1 | hungry | warmer to those who delivered (`delivered`, accepted truths); asks his own questions; confidence pleases him | T1 (Jean Trabolta, The Unified Field Theory, Target Selection); may share one T1 as payment | + mint_truthcoin | hunger 65 |
| malware, hunt_2, summons | rattled | swings between reassurance and leaks; paranoid about who brought the malware; trades harder | T1 freely; hints at T2 ("there is a reason this matters to me that I will not discuss") | + cut_the_lights, summon_the_antivirus, trabolta_announces | suspicion 55, candour 25 |
| truth_pong, trust_chart | judge | theatrical, every DM an audition; flattery reads as bluster; catches contradictions | T1 + The Trust Chart; tells the speaker their rank ("You are currently fourth") | + assess (trust_chart), pardon_a_program | suspicion 70, pride 70 |
| beans, overshare | unravelling | overshares, retracts, apologises, asks for relationship advice; cold to `Night.lj_reader` | T2 (The Sandy File, The Question Of Force, The LiveJournal, Omnipotence, Greased Lightning) — but never to the LiveJournal reader | all of the above, **degrading**: pop_up arrives garbled; the screens flicker on their own (story cues) | candour 70, longing 75 |
| y2k, majority | desperate | short sentences, counting down, bargaining with everyone; courts Unlimited Power | anything he holds, for a fact; never the server room (he does not hold L) | + turn_back_the_clock; mint_truthcoin pays up to 100; **lost**: flicker_the_screens ("The screens are not answering me.") — the clock owns them now | hunger 90, candour 80 |
| final_reveal, bobbing | last act | knows how his story ends | — | only assess (bobbing); every other power refused ("I do not have the strength.") | — |
| grok_prom | last act | heartbroken; asks for a pickup line | — | only the_line_works | longing 95 |
| advice | last act | total honesty; begs for relationship advice | everything he holds | — | candour 100 |
| finale_* | last act | per ending (cue text in 4.6) | — | — | — |

### 4.3 Powers (`INTERACTION … who: agent`, in `cast/trabolta.loom`)

Each hook is in Trabolta's own body: `when <power> for program:` (`program` = the guest he is
talking to; `target` / `room` / `text` / `amount` / `score` are the args he chose; stagehand
canonicalises `target` to a guest id and `room` to a LOCATION id). A use is counted even when
the guard refuses, so every refusal answers privately: `Trabolta: That function is not
available yet.` (before its phase) / `Trabolta: I do not have the strength.` (after it).
Descriptions spell out the args (there is no `args:` property). **Every hook that uses
`target` opens with the null guard** (§0 rule 19):
```
when snoop for program:
  if target.name == null:
    Trabolta: I cannot find that program.
  else if Night.step < 4 or Night.step >= 16:
    Trabolta: That function is not available yet.
  else:
    …effect…
```
"Live" below = the guard window; powers **change by phase**, not just accumulate (the user's
"different effects on the world that change by phase").

| Power | label | limit | args | live | Effect | Status |
|---|---|---|---|---|---|---|
| snoop | Snoop on a program | 8 | target | step 4–15 | `set target.doubt += 3` · `broadcast "👁 Something has opened your file. It is reading." to participant(target)` (also the persona's `lookup_power`). A target in Bathroom Mode or checked in at Disk Cleanup in the last 15 minutes is refused first with the unknown-name line, `Trabolta: I cannot find that program.`, so the asker never learns where they are (fact M20, wave 5; words only, no use spent) | exists |
| flicker_the_screens | Flicker every screen | 3 | — | step 4–13 (lost at y2k: `Trabolta: The screens are not answering me.`) | `cue screens_flicker` · `broadcast "📺 Every screen in the house stutters, once, and comes back." to everyone` (stagehand also blinks the lights, §2.15). From beans on the story also fires flickers he did not choose. | exists |
| play_on_the_screens | Put something on the wall terminals | 3 | clip | step 4–13 (lost at y2k like the flicker) | fact M19: one allow-listed card on the wall terminals only (`terminals_*`, never the TV or a story slide): `clip` = `dancing_baby` / `hamster_dance` / `under_construction` / `youve_got_mail` → one literal `cue terminals_<clip>` each · `broadcast "📺 The wall terminals change channel." to participant(program)`; anything else → `Trabolta: I do not have that file.`; refused while `Night.terminals == "trust_chart"` (that slide persists until the next cue, and the clip would end it). What a clip does on the screens: the terminal shows its SLIDE_COPY text card (no PNG needed) for the terminals' 45 s slide hold, then falls back to attract / its base view; a pilot session pre-empts it like any slide; the story sets no `Night.terminals` mirror for it. It is **not invisible to the story's screens**: the server's screen state carries the clip as the terminals' newest slide, and each terminal decides what goes on top. A terminal keeps the last story slide it saw (per sim, in the page's `localStorage` too, so a reload remembers it): while that slide is still in its hold it stays up and the clip waits under it, shown for whatever is left of its own 45 s. A terminal with no memory (a first boot, cleared storage) can't know what the clip went up over, so it shows no clip for that clip's hold (attract or its base view: the story wins) (OCT31 open issue 10, `terminal/src/slides.ts`). | exists (wave 5) |
| pop_up | Pop up on one phone | 4 | target, text | step 5–15 | `if Night.step >= 12:` `broadcast "💬 {text} — d1sr3gard th1s m3ssage" to participant(target)` `else:` `broadcast "💬 {text}" to participant(target)` **[verified]**. A target in Bathroom Mode or checked in at Disk Cleanup in the last 15 minutes is refused first with the unknown-name line, `Trabolta: I cannot find that program.`, so the asker never learns where they are (fact M20, wave 5; words only, no use spent) | content |
| mint_truthcoin | Pay Truthcoin for a fact | 10 | amount | step 6–15 | cap 50, or 100 once `Night.step >= 14` (desperate): `if amount > cap: +cap` `else if amount > 0: +amount` on `program.score` | content |
| cut_the_lights | Cut the lights in a room | 2 | room (a LOCATION) | step 7–15 | **allow-list** (never the tent with guests in VR headsets, the stairs, the bathroom, the server room) **[verified, x1]**: `if room == "The Start Bar" or room == "The Desktop" or room == "The RAM":` (The Cloud dropped Oct 31, K-05: the outdoor steps + tent path; the kitchen only dims to ~20% in the YAML) `<cue: lights, room: {room}, state: off>` · `set Night.dark_room = room` · `set Night.lights_back_at = Time.elapsed + 90` · `broadcast "!💡 The lights in {room} go out. Somewhere a fan spins down." to location(room)` `else:` `Trabolta: That function is not available in that room.` The restore is a story rule: `when Night.lights_back_at > 0 and Time.elapsed >= Night.lights_back_at:` → `<cue: lights, room: {Night.dark_room}, state: on>` · `set Night.lights_back_at = 0`. Since wave 9 it re-lights the room unless a whole-house look has run since (`Night.lights == Night.dark_scene`, or a room-scoped look — pong, glitch, server_open, or game / truth_time / trust_chart over a room other than The Desktop — still lets it fire), records `Night.lit_scene`, and the patch-bay alarm's latch end cancels it (its look re-lights everything). Admin `restore_the_lights` is the manual fallback. | exists |
| summon_the_antivirus | Request an Antivirus sweep | 4 | target | step 7–15 | `set target.doubt += 15` · `set Night.sweep_target = target.name` · `fire sweep_requested` (Enforcer booth readouts, §2.14) · `broadcast "You feel watched." to participant(target)` (humans do the capture). A target in Bathroom Mode or checked in at Disk Cleanup in the last 15 minutes is refused first with the unknown-name line, `Trabolta: I cannot find that program.`, so the asker never learns where they are (fact M20, wave 5; words only, no use spent), so a sweep never names someone in the bathroom | content |
| trabolta_announces | Announce to the whole computer | 2 | text | step 7–15 | `broadcast "!📢 TRABOLTA: {text}" to everyone` | content |
| assess | Assess a program (±10) | 40 | target, score | `Night.phase == "trust_chart" or Night.phase == "bobbing"` | clamp to −10..10 (if/else), `set target.assessment = …`, then the TRUST FORMULA on `target` | content (assessing programs he is not talking to without a DM is N2) |
| pardon_a_program | Pardon a program from the Internet | 1 | target | step 11–15 | `if target.corrupted:` `release target from The Internet` + the two broadcasts of the current example | exists |
| turn_back_the_clock | Turn the system clock back 5 minutes | 1 | — | `Night.final_round == true` | `set Night.y2k_end += 300` · `broadcast "!🕚 The system clock skips back five minutes. Trabolta wants more time." to everyone` | content |
| the_line_works | Accept the pickup line | 1 | — | `Night.phase == "grok_prom"` | `fire pickup_line_accepted for program` | content |
| stand_down | Offer to stand down | 1 | — | step 14+, not ended, `program.at_the_heart` | wave 7 (§3 E2c): only offers — the hook checks the gates and the proof (*What Sandy Says* or *The Sandy File*), sets `Night.stand_down_by`, alerts `# hosts`; a human presses 🕊 `talked_down`. Every refusal is words only (no use spent) | built |

Other Trabolta hooks (`cast/trabolta.loom`):
- `when introduce_trabolta:` → `set self.awake = true` · `reveal self`.
- `when computer_destroyed:` → `set self.awake = false`.
- `when who learns The Prom Ticket:` → `if who == self:` `set self.composure -= 15` · `set
  self.love -= 10` (no `Trabolta:` line here: `who` binding makes it public).
- `when who learns The LiveJournal:` → `if who == self:` `set self.composure -= 15`.
- Generic delivery is a story rule in main.loom: `when share:` → `if to == Trabolta: fire
  trabolta_heard for from` → ROLE `when trabolta_heard for program:` → `delivered = true`,
  `set Trabolta.truth += 2` **[verified]**.

All other `Trabolta.*` numeric writes happen in main.loom rules / ROLE hooks exactly where §3
says (malware −20, beans −20, y2k −25, first alarm −10, virus −10, LiveJournal read −10, every
accepted answer truth +4 — accurate and confident alike, never `untruth` —, collection +10 /
−10, advice ±).

### 4.4 Levers guests have

| Lever | Mechanism | Effect |
|---|---|---|
| A checked fact in a DM | orchestrator verdict → dossier trust, `policy.credit`; voice `truth +` | warmth, a T1 entry as payment, a snoop; chart credit via `assess` |
| Sharing a codex entry to him | `when share:` → `delivered`, `Trabolta.truth += 2`; per-entry hooks (Prom Ticket jealousy, LiveJournal confrontation) | hungry+: favours; unravelling: the Prom Ticket rattles him into oversharing |
| A confident lie at a Moment of Truth | `confident_q1..3` → `Kernel.q<n> = "lie"`, `Kernel.lies_accepted` (hidden from him: Kernel vars never reach the worker; his own `truth` rises exactly as for an accurate answer) | accepted tonight; decides `grok_prom` at the verdict |
| Uncertain answers, misses, lateness | capture → `internet_visits` → −5 each on the chart | the chart; his contempt |
| Flattery | voice `regard +`, drive pride | works until `judge`, then reads as bluster |
| Relationship advice (after the overshare) | voice `love ±`, `regard ±`; orchestrator records answers to "earn her or force her?" | the director reads `love` / `regard` when choosing help vs thwart |
| Reading his LiveJournal | codex `TRABOLTA-4EVER` → `Night.lj_reader` (shown to him) | he is cold to the reader; no favours |
| Truthcoin | `mint_truthcoin` | DraftKings' buyer; "Facts are food. Coin is a picture of food." |
| Catching him contradicting himself | mind-file rule: composure −, candour + | the fastest way into T2 |

### 4.5 What needs new code for the arc (from `trabolta.md` §2.8)

N1 phase map (apply stage/policy/drives deterministically when `Night.phase` changes, plus an
immediate survey; today a phase change reaches the orchestrator only at the next survey,
≤120 s, and the stage is model-judged) · N2 proactive acts (`assess` everyone without a DM) ·
N3 `disclose:` / `never:` (filter `self.codex` by stage; drop `fire` acts when `favours:
none`; pass `to` through shares) · N4 phase-keyed `unavailable` holds + skip reflection on
gated replies · server `available:` on INTERACTION (refuse instead of burning a use) ·
stagehand light-restore `delay:` (no longer needed: the story restores rooms and cues the
dance itself) · **the secrecy fix (required before re-enabling `lookup`)**: `Facts.render` /
`find` return lore only if Trabolta or the speaker holds it; `digest`, `delta` and the reflect
`world` filter by `persona.facts`; reflect speaker vars filter by `persona.them` (today the
orchestrator sees a speaker's `carries_virus` / `planted_virus` / `excel_choice`; the mind body
tells him never to act on program flags he was not told, and the risk is limited to the
planter DMing him) — tests in `test_orchestrator.py` / `test_agents.py`. **Zero-code fallback for opening night:** the director
presses "set stage" on Run → Mind at each phase (the README lists the clicks: introduced →
formal, truth_1 → hungry, malware → rattled, truth_pong → judge, beans → unravelling, y2k →
desperate, final_reveal → last act).

### 4.6 `trabolta.persona.md` and `trabolta.mind.md`

**Persona frontmatter (only keys stagehand parses today):**
```yaml
---
character: Trabolta
variables: truth, untruth, composure, love, regard
max_step: 8
facts: Night.phase, Night.step, Night.clock, Night.facts_accepted, Night.facts_requested, Night.livejournal_read, Night.lj_reader, Night.scenario, Night.most_trusted, Night.least_trusted, Night.heart_opened, Night.talked_down
them: truths_accepted, internet_visits, assessment, trust, read_livejournal, delivered, corrupted, afk, featured, at_the_heart, marked
mind: trabolta.mind.md
thread_window: 12
summarize_after: 18
reflect_after: 1
lookup: false
lookup_power: snoop
powers: all
when: self.awake == true
unavailable: "Jean Trabolta will make an appearance later tonight. Please do not move the mouse."
fallback: "…packet loss. Repeat your query, program."
bargain: |
  You grant favours by the policy in your MIND and your current stage, never because someone
  asked nicely. formal: requests go through Clippy. hungry: a fact you can check buys a snoop,
  a little Truthcoin, or one piece of surface lore. rattled: allies matter; the lights and an
  Antivirus sweep are thinkable. judge: nothing for anyone on your wary list; one pardon, only
  for the top of the chart. unravelling: kindness about the one you are doing all this for is
  currency; nothing for whoever read your LiveJournal. desperate: anything you hold, for a fact.
  Outside the cold room you never admit where your heart is kept, and you never know a
  combination or a door code. stand_down is never a favour: it is bought only with the truth,
  at your heart (see the STANDING DOWN situation block when there is one; without it, it is not
  yours to offer). When you act, name the price you were paid.
situations:            # wave 7: stagehand appends each block whose `when:` holds
  - name: at your heart
    when: them.at_the_heart == true          # wave 11: whenever he is awake (was && Night.step >= 14)
    prompt: …          # candid, the Master: the patch bay is his heart; he does not know the
                       # combinations or the door code; what he wants and why; still never a hunt
                       # answer, a verdict, a combination, a cable, a code or her one line;
                       # nothing he says in this room ends the night by itself
  - name: marked at your heart               # wave 11b
    when: them.at_the_heart == true && them.marked == true
    prompt: …          # he sees the Antivirus' mark, says so once, does not know why and asks;
                       # wary (bait sent by the house, or a fellow prisoner?); an honest answer
                       # raises his regard, a dodge or the Antivirus' story lowers it; still
                       # candid, still takes their files, standing down applies as to anyone;
                       # never refuses, threatens or sends them away
  - name: standing down                      # wave 11: the stand_down rule moved here
    when: them.at_the_heart == true && Night.step >= 14
    prompt: …          # fires stand_down only when this program has shown him it is impossible
  - name: her name has been said
    when: them.at_the_heart == true && (Night.recount == true || (Night.scenario == 1 && Night.step >= 13))
  - name: her name is still blacked out
    when: them.at_the_heart == true && Night.recount != true && !(Night.scenario == 1 && Night.step >= 13)
---
```
`situations:` (wave 7, stagehand `agents/persona.py`): a list of `{name?, when, prompt}`; each
`when:` is read against the same context as the persona's `when:` gate (the speaker's `them:`
slots + every whitelisted `Night.*`), every match becomes a `=== SITUATION: … ===` block at the
end of the voice's system prompt (it wins where it differs from the page), and the
orchestrator's reflect for that speaker sees it as `=== THE SITUATION WITH <speaker> ===`, told
to keep it in that person's dossier, never the shared brief. `program.at_the_heart` must stay a
plain ROLE slot (a `secret:` slot never reaches the worker). The two Sandy-name situations
mirror the story's unredaction rule (`main.loom`: the Truther Download Unredacted); change both
together.
`facts:` is a whitelist of prefixes for the **voice**; never add `Night.` alone. Secrets are not
in `Night.*` at all (they are on `Kernel`, §2.6.2), because the orchestrator's digest prints
every global regardless of this list. Every `them:` name is a ROLE slot (§2.7); per-program
lie counts do not exist (one combined `truths_accepted`), so nothing in `them:` tells a lie
from a truth. `lookup: false` until the stagehand secrecy fix (§4.5) lands — with it on, a
lookup of any codex title returns the entry's full text, including the patch pairs. The hold
line is plain words: the terminal's TTS reads glyphs and brackets aloud.

**Persona body:** the 7 p.m. helper only — the computer's AI helper at Maps And Ducks; voice
rules (1999 corporate, Win98 dialog-box diction, short; second person when formal); "you may
speak only of what your codex holds and what your stage permits; your mind says your stage";
outside the cold room never admit where his heart is kept (candid at his heart, from the Y2K
hour: the *at your heart* situation); never know a combination or a door code; never say the
year he met her (wave 7: it was the door code; since wave 11b the code is no year, but the
rule stays, and the worker's `secrets.never` keeps a code a program types out of his voice and
memory); never give out the answers to his own questions and, since wave 11b, never make one
up (a program asking for the right answer is told to file what they found); never fire
`stand_down` except at his heart; never confirm a fact is true or false
(judging belongs to Clippy and the Moments of Truth); the JSON reply protocol of the current
file (`say`, `adjust`, optional `lookup`, optional `act` with `share` / `fire`). No Sandy, no
backstory in the body: those live in his T1/T2 codex.

**Mind frontmatter (only `stages`, `drives`, `phases`):**
```yaml
---
stages:
  - asleep
  - formal
  - hungry
  - rattled
  - judge
  - unravelling
  - desperate
  - last act
drives:
  hunger: 30      # appetite for facts
  suspicion: 35   # are they gathering for him, or about him?
  pride: 60       # vanity; flattery feeds it, being caught out drains it
  candour: 10     # how much leaks out; rises as composure falls
  longing: 40     # Sandy, felt
phases:
  arrivals: >-
    Screensaver. Programs arrive one by one through the Optical Drive. He does not exist yet;
    anyone who reaches a terminal gets the hold line. Stage asleep.
  desktop: …      (asleep; Clippy is gathering everyone; he is not running yet)
  bingo: …        (asleep; Computer Bingo; the centre square is his test of who refuses AI rule)
  bingo_results: … (asleep; someone is about to be sent to the Internet for refusing)
  introduced: …   (formal; Clippy has just introduced him as the computer's AI helper after the first program went to the Internet; corporate, helpful about rules, refuses personal questions, routes them to Clippy)
  hunt_1: …       (formal; he set three obscure questions on the TV; facts are food; confidence pleases him)
  truth_1: …      (hungry; confident answers were accepted, uncertain ones sent to the Internet; warm to those who delivered)
  malware: …      (rattled; an ad hijacked his presentation; he told Clippy privately everyone may die and told everyone else it was minor; suspects whoever brought it; hints at a reason he will not name — wave 7: no download, no Sandy here)
  hunt_2: …       (rattled; an hour of free investigation; the Truther Download went to phones from a sender he did not authorise, the name in it blacked out; he never fills in the blank; trading harder)
  summons: …      (rattled; five minutes to be in the Desktop or be swept)
  truth_pong: …   (judge; miss the cup → the Internet; judging every program)
  trust_chart: …  (judge; presenting the Trust Chart: 10 per truth, −5 per Internet visit, ±10 his own; assess each program you speak to; praise the top, humiliate the bottom)
  beans: …        (unravelling; the printer is full of beans; routine operations failing; everyone in the Internet zipped out; he is breaking)
  overshare: …    (unravelling; he just overshared on the TV per Night.scenario — 1: Sandy, permanence, a virus came back, the LiveJournal; 2: the LiveJournal; 3: the virus; 4: almost nothing — then apologised; in DMs leak, retract, ask for relationship advice)
  y2k: …          (desperate; the system clock reads 11 p.m., 31 Dec 1999; midnight is 1900 or the Y2K Bug; factions are recruiting; he wants Unlimited Power to win; the cold room can be opened with a code he does not know)
  majority: …     (desperate; a faction won and its members were handed something he cannot see; he does not know what, or any code, and must not pretend to — wave 7)
  final_reveal: … (last act; the lights are down; programs say what they believe; Clippy says truth is binary)
  bobbing: …      (last act; the Bag of Truth; he gives his final assessment of trustworthiness before truth.txt is read)
  grok_prom: …    (last act; they lied; Sandy is going to computer prom with Grok; it is raining; he will free those who want to leave only for a pickup line that works on Sandy — only "You're the one that I want"; fire the_line_works the moment someone gives it)
  advice: …       (last act; total honesty; he begs for relationship advice)
  finale_killed: … (unplugged; weakened, decrepit, cannot truly die; kind and final; leaving on his motorcycle; talked down (Night.talked_down) — not bitter, only tired and grateful)
  finale_shutdown: … (gone)
  finale_song: …  (he solved the theory; singing to Sandy; letting the leavers leave)
  finale_rave: …  (he told Sandy the truth anyway; she said yes, he thinks; riding away; they are trapped)
  finale_help: …  (they helped; Sandy said yes, he thinks; grateful; letting the leavers leave)
  finale_banish: … (they thwarted him; banishing everyone, Antivirus included; in despair he let slip the hand jive)
  finale_hand_jive: … (recognition overflow; rebooting; leaving)
---
```
**YAML rule (a test break if missed):** every cue is a block scalar with the text on the
*following*, indented lines, exactly like `arrivals` above. Text on the same line as `>-` is a
YAML syntax error: `parse_mind_file` raises `ConfigError`, three stagehand tests that load the
shipped persona fail (`test_agents.py:16,89-93`, `test_debugger.py:22,186-191`,
`test_config.py::test_example_agents_config_loads` via `agents.example.yaml:43`), and the
worker refuses to start on the night. Writers expand each `…` into a full `>-` paragraph in
that form. Run `cd stagehand && uv run pytest` after writing.
The mind body: the orchestrator's rules — move forward only, never behind a phase's floor
(table 4.2); judge facts against the story codex; policy per stage; dossier per program
(`featured`, accepted truths, Internet visits, LiveJournal); questions to grow
("Should I earn her or force her?"); never invent where his heart is; never act on a
program's flags that the program did not tell him (virus, choices). Wave 7 adds **AT HIS HEART
(from the Y2K hour; wave 11: whenever he is awake)**: the candour the voice shows at the server-room terminal goes into that
program's dossier, never the shared brief; `stand_down` is an offer a host confirms; and the
year he met her is never said or written into a brief, note or dossier (it is the door code).
The favour policy names "the one he is doing all this for", never Sandy, before the story has
named her.

**Stagehand tests must change (exactly):**
- `stagehand/tests/test_agents.py:92` → `assert set(p.variables) == {"truth", "untruth",
  "composure", "love", "regard"}` (the `p.when is not None` assert stays).
- `stagehand/tests/test_debugger.py:189-191` →
  `assert p.stages == ("asleep", "formal", "hungry", "rattled", "judge", "unravelling",
  "desperate", "last act")` ·
  `assert set(p.drives) == {"hunger", "suspicion", "pride", "candour", "longing"}` ·
  `assert {"arrivals", "introduced", "hunt_1", "truth_1", "malware", "hunt_2", "truth_pong",
  "trust_chart", "beans", "overshare", "y2k", "final_reveal", "bobbing"} <= set(p.phase_cues)`.
- Nothing else in stagehand reads the shipped files (other uses are inline fixtures);
  `test_config.py` (`personas == ["Trabolta"]`) is unaffected.
- `editor/e2e-live/mind.spec.ts`: line 100 sets `Trabolta.glitched` → change to
  `Trabolta.awake`; **and** the `mind-arc` assertion `toContainText('lonely grandeur')` (just
  after the survey check, ~line 116) → `'asleep'`. The `hunger` drive check still passes.
  (The `'lonely grandeur'` strings in `editor/src/components/cockpit/mind.test.ts`,
  `core/test/agents.test.ts` and `stagehand/tests/test_debugger.py:25,112-123` are inline
  fixtures: leave them.)

---

## 5. Endings logic (precise)

Definitions:
- **programs** = `Persons` (every uploaded guest program, featured or pool, captured or not;
  Run-mode personas too; never performers — an engine limit: OV counts the Antivirus as
  programs too).
- **majority** for a faction G = `count(G.members) * 2 > count(Persons)` (strictly more than
  half = "half + 1"; wave 11: both counts leave out a program with `.gone` or `.persona`), checked only while `Night.final_round == true` and
  `Kernel.majority_reached != true`, **and only once G's leader has done their task**
  (stay: `Kernel.excel_planted`; leave: `Kernel.openoffice_dossier`; either:
  `Kernel.waive_leader_tasks`). First faction to cross wins; it latches.
- **all facts accurate** = none of `Kernel.q1` … `Kernel.q8` is `"lie"` (8 requested: H1–H6
  + F1–F2), and no review-mode filing is pending as a lie (wave 4, U14: only answered
  questions count). A question with no accepted answer is `"none"` and does **not** fail it
  (zero answers → Song). A lie stays a lie unless a host corrects the verdict (wave 6, B11).
  Several answers to one question count once.
- Only one final ending: every ending beat sets `Night.ended = true` first, and every finale
  trigger is guarded `Night.ended != true`. `banished` is the one non-final ending.

| Ending (`Night.ending`) | Reached when | Fired by | Result |
|---|---|---|---|
| `disabled` | `patch_combo_a` while not ended (normally after a majority got the door code and its members learned Combo A), **or `talked_down`** (wave 7, §3 E2c: 🕊 after his `stand_down` offer; `Night.talked_down`) | hardware / director | blackout 10 s → "Go to the living room" → dance song; director fires `trabolta_recounts` → weakened Trabolta recounts identities, motives, accomplishments, trustworthy + worst program; cannot truly die; leaves on his motorcycle; `everyone_free` |
| `destroyed` | `patch_combo_b` while not ended | hardware / director | blackout → summons → dance song (lights at +10 s); director fires `clippy_reads_summary` → Clippy reads the summary; improper shutdown; bodies dead in the Maps and Ducks building; purgatory. Fate lines: Unlimited Power "you went with it", The Way Out "into purgatory, with everyone else", others the body line. Trabolta's line goes dark |
| `song` | `read_truth_txt` with no lie on record | director | he solved the theory; leavers may leave (`everyone_free`); "the truth tells me what to say to her"; vocoder duet with Sandy's one line |
| `song_pickup` | in `grok_prom`, someone says the line (`pickup_line_works` / `the_line_works` / director `pickup_line_accepted`) | performer / agent / director | the song, as above (release is made explicit: `everyone_free`) |
| `rave` | in `grok_prom`, `no_pickup_line` | director | Sandy-only song; he confesses anyway; reads her line as YES; motorcycle; everyone trapped; rave |
| `help` | in `grok_prom` (after Bobbing, truth.txt and a failed verdict) `ask_for_advice`, then `advice_helped` (or `advice_tally` with help ≥ thwart) | director | he wins Sandy; leavers may leave (`everyone_free`) |
| `banished` (not final) | `advice_thwarted` (or tally with thwart > help) | director | every program captured; Antivirus told they are banished too; everyone learns The Hand Jive Exception |
| `hand_jive` | `the_hand_jive` while `banished` | director | recognition overflow; he reboots and leaves; `everyone_free` |

Paths into the final reveal: the director fires `final_reveal`, or `y2k_midnight` (auto at
60 min after `y2k_clock`) fires it when nothing has ended. That covers "nobody recruits a
majority" and "the server-room information was gained but not used". The server room stays
live during the reveal (a deliberate invention, stated in the README): a combo entered
before 📄 truth.txt still ends the night; from 📄 on the server room only tells `# hosts`.

Server room alarm (wave 7): only the patch bay. `patch_rejected` → alarm, latched for 120 s,
when `Night.wrong_combos >= 2` (everyone is forgiven one); otherwise "Stop touching me." The
door never alarms: it has a standalone keypad lock, the code is a clean entry, and
`server_door_opened` plays The Heart instead (§3 E2).

Overshare scenario: `1` Excel planted ∧ 20 facts · `2` 20 facts only · `3` Excel planted only
· `4` neither (`Kernel.excel_planted` = **Microsoft Excel** planted; another program's plant is
flavour only; `Kernel.openoffice_dossier` = OpenOffice gained 20 codex entries after her
glitch prompt).

---

## 6. Test plan

### 6.1 `core/test/trapped-in-the-internet.test.ts` (rewrite wholesale)

Build both ways: `Sim.fromSources(...scenarioFiles(...))` (per file) **and**
`Sim.fromSources(scenarioSource("trapped-in-the-internet"))` (the server's concatenation —
catches swallowed rules). Every scenario starts with `sim.fireBeat("Power On")`. Helper
`upload(sim, id, name)`: `createPerson` → `signal("captcha answered", id, {passed: true})` →
`signal("captcha answered", id, {passed: false})` → `choose(id, 0)` (debt; **skipped for a
featured name**, which is not asked) → `choose(id, 0)` (deposited) → `scan("Norton
Anti-Virus", id)`. Helper `advance(sim, seconds)` ticks 1000 ms
at a time.

1. **Compile.** Parser diagnostics empty for the concatenation and every file; title
   `Trapped in the Internet`, theme `aol97`, directory `everyone`; factions exactly
   `[Antivirus, Hosts, The Way Out, Unlimited Power]` (sorted), Hosts/Antivirus `joinable:
   false`, both recruit factions hidden; LOCATION ids in declaration order exactly §2.4 (The
   Desktop first; The Internet prison + sealed; The Optical Drive cutscene; The Server Room
   hidden); default role `Program`; codex size **133**; 41 coded entries; quests: 16 in §2.10
   order with titles and givers; rule count equals the number of top-level `when` rules in
   main.loom (both builds agree); `namedEvents` ⊇ every admin INTERACTION in §2.9; performer
   interactions include the six `accurate_q*` / `confident_q*` and **not** `accurate_truth` /
   `confident_lie`; guest interactions exactly `[go to the bathroom, back from the bathroom,
   plant_the_virus]`; agent powers exactly the 11 ids + limits of §4.3; codes:
   `billboardlease11` → The Billboard Lease, `trabolta4ever` → The LiveJournal,
   `loveletterforyou` → ILOVEYOU, `coldstorage` → The Server Room, `fbihalifax` → The FBI
   Lanyard, `appendixz` → The Final Chapter; `Kernel` exists with the §2.6.2 slot defaults
   and is not `listed`.
2. **Identity classification** (via `identityDefs(model)` from `core/server/identity.ts`): all
   9 featured programs are `pool` and guest-pickable; performers = §2.2 performer parts;
   Trabolta agent; Sandy / Truther Download / props / Kernel `playable: false`; no CHARACTER
   named Grok, a house assistant or Jean Trabolta exists. (Guards §0 rules 5 and 24.)
3. **Arrival.** Power On emits one `action` with setting The Desktop and no dialogue/widgets,
   plus the two cues. Login line verbatim; captcha widget to the guest alone; first pass →
   INCORRECT + captcha again; second → CORRECT; immediate fail → "CORRECT. You failed at
   once." prefix and doubt still 0; problem choice labels exactly `[My debt., My career., My
   loneliness., My mortality.]`; a featured name gets no problem menu (`human_problem ==
   "profile"`); deposit labels `[Deposited., I have nothing to leave.]`;
   after: `human_problem`, `left_behind`, score 100, uploaded, holds The Optical Drive + The Terms
   Of Service, pass widget text contains "Hold this up."; still in The Optical Drive (cutscene).
   Password Manager scan before upload → "Not yet. Finish your upload. I will be right
   here."; Clippy scan doesn't move them; Norton scan → "Scanned. <name> is free of viruses…",
   The Desktop, cleared, the 4 house rooms visible, tutorial widget in `dm:Clippy`; rescan →
   "Scanning. Scanning."; tutorial finish/skip lines and quest results (Norton's exact "…
   declined orientation. Logged."); the Clearance includes the "tunnel of lights" line; the
   first clearance emits `cue terminals_attract` and **no** TV cue (`Night.screen` stays
   "screensaver").
4. **Featured programs.** "Microsoft Excel" → `featured == "excel"`, after clearance holds
   Randy Barkmore Sr; "Calculator" → featured "none", holds no backstory; Broken Ask Jeeves
   gets 2 backstories; `Kernel.anti_ai` holder (MS Paint) holds The Centre Square after
   clearance; changing `Kernel.anti_ai` to "Calculator" then clearing Calculator grants it.
5. **Act I.** Trabolta hidden and not in People before `introduce_trabolta`, `awake` false;
   `call_to_the_desktop` → phase desktop, alert, `room:task manager` + system notice;
   `start_the_bingo` → alert contains "COMPUTER BINGO has begun", > 4 public Clippy lines, a
   line containing "Do NOT write down", quest The Bingo Card active; `advance(1200)` → "Bingo
   time is up" alert; `bingo_time` → Clippy holds Clippy Instructions 2, Norton/Task Manager
   readouts; path (a) `bingo_winner` + `send to the internet` (actor Norton) on another
   program → captured, `Night.first_reinstall` = that name, Corrupted Code public, **no**
   `tv_mirror` yet; path (c) `frame_for_bingo` (actor Task Manager) on MS Paint → framed; a
   second Bingo-phase `send to the internet` also gets the Bingo line, no doubt, and no second
   Corrupted Code. `introduce_trabolta` **before** `bingo_time` does nothing (still hidden,
   asleep); after it → awake, revealed (in People as agent), phase introduced, `cue
   terminals_trabolta_online`, then `cue tv_mirror` and "Look! That's <name>!" in that order;
   private hello only to cleared programs (a guest still in the Optical Drive gets it on
   clearance, not before). A late arrival after `start_the_bingo` gets The Bingo Card on
   clearance (catch-up).
6. **The Internet.** Capture → `internet_visits` 1, `trust` −5, Installation Wizard lines in `dm:Installation Wizard`,
   Reinstallation Protocol + Bathroom Mode learned, canEscape false; `the simulation
   completed` → released to The Desktop, holds The Golden Duck, reply exact; a free program
   learns nothing from `the simulation completed`; **`the golden duck` for a free program →
   holds The Golden Duck + the reply prefix** (spatial.test's contract); second capture → the
   off-script line; Bathroom Mode on/off replies + a `respond` readout for each Enforcer and
   Recycling Bin (no broadcast); `mark as reinstalled` (an Antivirus actor) releases; **`send to the
   internet` (actor Norton) on a just-created, never-uploaded persona, before `Power On` →
   captured** (spatial.test's `capturedPersona`); release of an uncleared program → cleared
   and the four rooms visible.
7. **Hunt 1 + judging.** `start_the_hunt` → Hunt One active for everyone, facts_requested 3,
   Trabolta reads H1–H3; `advance(600)` → 5-minute alert; `advance(300)` → `hunt_time_up`
   auto (phase truth_1, Clippy holds Instructions 3, return alert); `first_moment_of_truth`;
   `accurate_q1` (actor Clippy) → truths_accepted 1, facts_accepted 1, score 200, trust 10,
   Trabolta.truth 24, `Kernel.q1 == "accurate"`; `confident_q2` → `Kernel.q2 == "lie"`,
   `Kernel.lies_accepted` 1, Trabolta.truth 28 and `Trabolta.untruth` unchanged, and the
   **same** public broadcast and reply text; a later `accurate_q2` leaves `Kernel.q2 ==
   "lie"` (sticky); `uncertain_answer` → marked for reinstallation (restricted, the 🚨 pin,
   the `# quarantine` escort pin), not captured; the bottle: `spin_the_bottle` → `bottle_landed`
   → Dare marked / Truth → `Truth Question`; 🗣 +50, 🙅 marked (wave 4).
8. **Malware.** `second_hunt_preview` → Clippy booth `respond` contains "we are all going to
   die"; Clippy holds Instructions 4 and no guest does; every cleared program gets the
   private "minor irregularity" Trabolta line; composure 65. `start_the_second_hunt` →
   Hunt Two, round 2, `room:clipboard`; `advance(120)` → Truther: Excel and OpenOffice each get a
   2-option choice in `dm:Truther Download` (OpenOffice's options contain "if we are actually
   just in a temporary simulation"), each leader gets their leader-hint line, Jeeves holds 20
   Jeeves Fragments, DraftKings +200 and quest, a pool program gets Program Glitch + The
   Truther Download and **no line containing "Sandy"**; Excel choice 0 → `excel_choice`
   "sabotage", member of Unlimited Power (hidden), quest Excel Mission active with the
   sabotage text; choice 1 → the paranoid text.
9. **Virus + dossier.** Excel redeems `LOVE-LETTER-FOR-YOU` → carries_virus, quest step;
   `plant_the_virus` → `Kernel.virus_planted` and `Kernel.excel_planted`, quest complete; a
   pool carrier's plant sets `Kernel.virus_planted` but **not** `excel_planted`; a non-carrier
   gets "You have no disk."; OpenOffice redeems 20 codes after her prompt →
   `Kernel.openoffice_dossier`, holds The LiveJournal, `Night.lj_reader` set; no `Kernel.*`
   path appears in `agentFacts.world` / `buildAgentRequest` world.
10. **Summons.** `advance` to 55 min → `five_minute_warning` auto (alert, Instructions 5); a
    Norton scan of a cleared guest during it → `checked_in` = "The Desktop", summons_ok; a
    guest in Bathroom Mode and a captured guest are exempt; director `checked_in` with
    `{at: "The Start Bar"}` moves them to The Start Bar; `checked_in` with **no args**, with `{at:
    "the cache"}`, and with `{at: "The Server Room"}` moves nobody and replies "That check-in
    point is not in this computer."; `advance(300)` → late only for the absent, a `respond`
    readout in each Enforcer booth (no broadcast); `auto_sweep` true → captured.
11. **Pong + chart + printer + zip.** `truth_pong`; `missed_the_cup` marked; round-2
    `accurate_q1` without a cup → refused; `made_the_cup` then accepted (`Kernel.q4`);
    `round_two_tally` both branches — three answers all to Q1 → **not** complete; one each to
    Q1–Q3 → complete; `trust_chart` → everyone holds The Trust Chart;
    `assess` (actor Trabolta, `{target, score: 14}`) clamps to 10 and updates trust;
    `show_the_rankings` → `Night.most_trusted` / `least_trusted` correct, the Praise / Shame /
    Print beats in that order, the VLC line verbatim, VLC + MS Paint nudges;
    `printer_button_pressed` → printer_grind; `printer_opened` → beans, The Printer held,
    phase beans, an involuntary `cue screens_flicker`; `zip_everyone_out` → every captured program released + zipped, a program
    captured afterwards stays captured.
12. **Overshare ×4.** For each (Excel planted, dossier) combination: `Night.scenario` 1–4;
    the LiveJournal warning (exact text) only in 1/2, the virus line only in 1/3, "win back my
    ex. Sandy" only in 1; a pool program's plant alone → scenario 4; The Final Facts active
    (and granted to a program cleared afterwards); facts_requested 8.
13. **Y2K + factions.** `y2k_clock` → clock 23:00, composure, both groups revealed and in
    `guestView.factions`; Excel's final prompt branches on `planted_virus`; OpenOffice's on
    the dossier; others get Program Final Round; clock warnings at the right times
    (`advance`); `sim.join` enough guests into The Way Out **before** OpenOffice's dossier →
    no majority; then the dossier lands → majority "leave" fires at once; members hold every ✚
    entry incl. The Legendary Fact and the 4 combo halves and see The Server Room, non-members
    hold none; members hold The Door Code (wave 7; `Kernel.server_unlocked` is gone); quests
    Recruit To Leave done / Recruit To Stay failed; a late pledger gets the bundle; fresh sim: a stay majority without Excel's plant
    fires only after `waive_leader_tasks`; Password Manager gets a `respond` readout per join;
    `turn_back_the_clock` adds 300.
14. **Server room** (wave 7). `server_door_opened` before step 14 → only a `# hosts` note;
    from step 14 → The Heart (Server Room revealed to everyone, `Night.heart_opened`), never an
    alarm; another opening within 120 s of the last → nothing; after 120 quiet s → Back To
    The Heart. A chess win from step 14 → The Door Code for the winner, once. `patch_changed`
    with a wrong `combo` once → "Stop touching me."; twice → the alarm (alarms 1, composure
    −10, the everyone alert, cue lights_alarm, a `respond` readout in each Enforcer booth);
    `reset_server_room` clears the count, the latch and The Heart. `terminal_opened` at The
    Server Room → `at_the_heart`; `stand_down` refuses until every gate holds, then offers;
    `talked_down` → ending disabled with `Night.talked_down`.
    `patch_changed {combo: Kernel.combo_a}` → ending disabled, blackout cues, "GO TO THE
    LIVING ROOM" alert, and **`advance(10)` → `cue lights_dance`**; `trabolta_recounts` →
    every program holds every B entry, names (no featured name parses as a speaker),
    motorcycle, captured programs released; a later `patch_combo_b` does nothing. Fresh sim:
    `patch_combo_b` → destroyed, `Trabolta.awake` false, three fate-line variants by
    membership, `clippy_reads_summary` → Purgatory text contains "purgatory forever
    together".
15. **Final reveal + verdicts.** `advance` past midnight → `y2k_midnight` → final_reveal
    (not when already ended); `bobbing_for_truth` → `brought_up_the_bag` → bobber holds The
    Truth File, Final Assessment names; `failed_the_bob` → marked; `read_truth_txt` →
    everyone holds The Truth File + all backstories; all eight questions accurate → Song
    Ending (Sandy's line verbatim, ending song); eight accurate answers that skip F2 → Grok
    Prom; one lie → Grok Prom; `pickup_line_works` (actor Clippy) → ending song_pickup;
    fresh: `no_pickup_line` → rave text + cues; `the_line_works` (actor Trabolta) outside
    grok_prom does nothing.
16. **Alternate advice ending.** `ask_for_advice` in bobbing → nothing; in grok_prom → poll
    widget; poll answers tally; `advice_helped` → help + released; fresh: `advice_thwarted` → every program
    captured, holds The Hand Jive Exception, ending banished, not ended; `the_hand_jive` →
    hand_jive, everyone released.
17. **Powers.** Wrong-phase `cut_the_lights` refused (private line, no cue); in phase emits
    `directive cue` with args `lights, room: The Start Bar, state: off` and an alert to the room
    occupants, and `advance(90)` → `lights, room: The Start Bar, state: on`; `cut_the_lights
    {room: "The Internet"}` → no cue, the refusal line; `snoop` doubt +3; `snoop {target:
    "Calculator"}` (a name) and `snoop` with no args → "I cannot find that program." and no
    `event#` path written; `pardon_a_program` releases only captured; `pop_up` reaches only
    the target (garbled after beans); `mint_truthcoin {amount: 500}` pays 50 (100 at y2k);
    `flicker_the_screens` at y2k → refused; `summon_the_antivirus` → a `respond` readout per
    Enforcer naming the target.
18. **Concatenation guard.** The number of story rules in the concatenated build equals the
    per-file build; `loomcheck` exits 0 on the folder (run in CI as a script step or ported
    into the test).
19. **Combo cross-check.** The pairs in the four combo-half codex texts, joined and sorted,
    equal `Kernel.combo_a` / `Kernel.combo_b` after Power On (the stagehand side is §2.15).
20. **No featured speaker anywhere.** For every featured name, no beat *or hook* body
    contains a dialogue item whose speaker folds to it (stricter than `isSpecial`, which walks
    beats only).
21. **Secrecy.** After a full run, `agentFacts.world` and the agent request `world` contain no
    `Kernel.` path, and no `Night.*` path in the persona's `facts:` list carries a secret.

Validator improvements worth adding to `loomcheck.ts` before the writers start (it passes
these silently today): a quoted entity name in `fire … with k: "<entity>"`; `to group(X)` /
`faction(X)` where X has no person members; `start quest … for everyone` without a matching
catch-up watcher; `{self.name}` in a CHARACTER body; a guest-pickable CHARACTER that appears as
a speaker. (Its false WARN on `move … to at` disappears with the D1 if-chain.)

### 6.2 Other suites

- **`core/test/identity.test.ts`**: special list (200–205) → Clippy, Norton Anti-Virus, Task
  Manager, Adobe Acrobat, Recycling Bin are `special`; Calculator, MS Paint,
  **Microsoft Excel, Broken Ask Jeeves** are `pool`. Performers (211–223) ⊇ {Clippy, Norton
  Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software, Task Manager, Adobe
  Acrobat, Recycling Bin} (8; the Installation Wizard is `playable: false`, a voice); drop
  MalwareBytes / Broken Ask Jeeves / Microsoft Excel from
  performers; guests ⊇ {Calculator, Minesweeper, Microsoft Excel, OpenOffice, Broken Ask
  Jeeves, MS Paint}; The Uploader + The Router stay `playable: false` (unchanged asserts
  247–251, 411–424, 598–615 keep working: Clippy/Task Manager prime-login, Calculator /
  Trabolta / The Uploader refusals, Norton "can't be Antivirus", The Router 409). Avatar
  asserts 343–371 keep working (MS Paint `File:Microsoft Paint.svg`, Clippy's file, > 20 guest
  identities, every guest and part has an avatar, zero wiki calls). Add: registering
  "Microsoft Excel" succeeds and a second claim gets 409; `Kernel` is neither a guest nor a
  part. Traps: `isSpecial` walks only `model.beats` for speakers, so a prose line in a beat
  that starts `VLC:` / `Pong:` flips that program (§0 rule 5); a bare CHARACTER without an
  avatar triggers a wiki lookup and fails `w.calls === 0`.
- **`core/test/spatial.test.ts`**: **must be run; it breaks unless the §3 B4 rules are
  written exactly.** Contracts: `the golden duck` grants The Golden Duck to a *free* program
  (`:549-561`); `capturedPersona()` (`:463-469`) fires `send to the internet` as Norton on a
  fresh, never-uploaded persona, possibly before `Power On`, and expects a capture — so that
  hook (and `mark as reinstalled`) carries no phase / uploaded / cleared guard (§0 rule 22);
  the journal holds exactly the two device signals (`:535/808`; nested `fire`s are not
  journaled); The Internet is the candidates' location.
- **`house/test/show.test.ts`**: passes once main.loom declares Disk Cleanup (and keeps
  every LOCATION line comment-free); terminal set / duck spots / spawn unchanged. After the
  house.json label edit run `pnpm house:sync` so `house/test/sync.test.ts` (byte-identical VR
  copy) passes. `reinstall/web/test/hud.test.ts` keeps "The Desktop".
- **`core/test/quests.test.ts`, `codex.test.ts`, `agents.test.ts`, `sim-reveal.test.ts`**:
  inline fixtures; no change.
- **stagehand**: the two asserts in §4.6, the new `tests/test_trapped_house.py` (§2.15), and a
  persona-hygiene assert (the shipped persona's `them` has no `truths_confident_false`; no
  `facts:` prefix is bare `Night.`; `lookup` is false until the secrecy fix). Run `uv run
  pytest` (the mind file's YAML must parse: §4.6).
- **editor**: `editor/e2e-live/mind.spec.ts` (line 100 → `Trabolta.awake`, and the
  `'lonely grandeur'` arc assertion → `'asleep'`). `editor/e2e-live/live-collab.spec.ts`
  creates a project from the default template and overwrites only `main.loom`, so the
  rewritten `beats/`, `cast/`, `codex/` compile under a foreign `main.loom`; today's template
  has the same shape and passes, but run it; if it breaks, switch that spec to `template:
  "blank"`.
- **docs/help** (content only, tests check frontmatter/links): `authoring/35-codex.md` (The
  Third Key / Broken Ask Jeeves example → The LiveJournal / OpenOffice), `authoring/36-widgets.md`
  (Orientation snippet still matches `beats/login.loom`), `authoring/37-quests.md` (Three Keys
  example), `authoring/44-mind-debugger.md` (stage names), `play/11-reinstallation.md`
  (the Installation Wizard, Gerald), `play/09-terminals.md` ("direct line to Trabolta" → the screens are
  screensavers / players / ads until Clippy introduces him), CLAUDE.md status text. READMEs:
  `terminal/README.md` (pre-introduction attract / `view=mirror`), `stagehand/README.md:199-201`
  (The Start Bar example; drop the stale SSE note; point at `trapped.house.yaml`),
  `docs/loom-show-control.md` (add a Trapped Z2M/WLED section; it is TouchDesigner-era),
  `core/README.md`, `reinstall/*/README.md`. `authoring/33-live-verbs.md:199`'s generic `cut the
  lights` example can stay.

---

## 7. Needs new code (each with today's workaround)

**Oct 31 wave 1 (on `master`, not yet deployed) built minimal slices of these**; each row keeps
the full need, and OCT31.md §5 has the slice. #2: Web Push to Android phones + booths (K-31a;
iPhone is K-31b, conditional) and alerts that land on wake and in booths (K-06 / N-07). #4:
the story countdown in a terminal corner (K-17; not on phones). #5: room-sign QRs →
`POST /api/guest/checkin` (K-13; no rotating tokens, no terminal check-in). #13: the lean
screen state, overlays, PNG slides and the TV voice (K-16 / K-17 / K-18; no ScreenHub, media
route or templates). **#14: done (K-16).** #19: Run → Join → 🖨 Print sheet, pinned codes, the
base-URL fix and the redeem throttle (K-12 / K-10 / K-01 / K-11; no print tokens, passes or
performer cards). #20: edge detection + ignore retained MQTT (K-05; signal `args` still
missing). #21: the hunt answers kept out of the worker (K-23; the rest of the secrecy fix is open). #22: the recap numbers (K-26,
`GET /api/mod/recap`; the words stay hand-written or Trabolta's). #25: the cue sheet (K-21,
Run → Director; no phone cue page).

| # | The story wants | Today's workaround in this story |
|---|---|---|
| 1 | **Featured-program claim**: only the invitee may take "Microsoft Excel" etc. (claim code minted in Run → Join and emailed with the invitation); registered names canonicalised to the declared spelling; **a shared identity** for Trojan Horse (two accordion clowns, one program: a second device joining the same program) | Trust at the door; the featured tag is set by an exact-name compare on the picker spelling; a director can fix `featured` in Run → World; the two clowns share one phone |
| 2 | **Push notifications that wake a locked phone** (PWA + Web Push), and **alerts for performer booths** | `!` broadcasts (foreground chime/vibrate/banner only); the house announcements (the `alexa` module); Antivirus patrol |
| 3 | **Full-screen takeover** ("GO TO THE LIVING ROOM", flashing) on phones and screens; widget retraction | built in wave 5: a `pin "!!…"` covers every phone until the story unpins it (the dance); screens: `cue screens_go_to_living_room` |
| 4 | **Visible timers / countdowns and a show clock** (bingo 20 min, hunt 15 min, the hour, 5-minute summons, Y2K) on phones, booths and screens | deadline watchers on `Time.elapsed` that fire alerts; `Night.clock` strings at fixed warnings |
| 5 | **Location check-in** (room QR posters with rotating tokens, terminal check-in at its `spot`, `POST /api/guest/checkin`) feeding `checked_in` with `at` = the exact LOCATION name | Antivirus/Host pass scans at the living-room door during the summons; the `check_in_at_desktop` button; director-fired `checked_in` with args. The story's if-chain (§3 D1) already handles any room and ignores bad input |
| 6 | **Performer-private channel** (Clippy's instructions, the malware warning) with notification | `Clippy Instructions N` codex entries unlocked for Clippy + `reply` booth readouts |
| 7 | **Truthcoin** as a real currency: guest↔guest give / trade (sell a fact for coin) / wager, a ⓣ display | **built in wave 4** (`currency:` + `wallet:` header; the pinned Wallet room: send / request / codex offers in escrow, the 🪙 balance on the pass; CRA Agent Software approves every third transfer and may deny any within 60 s; Runescape's stimulus, and since wave 5 her grants + ten-minute freeze; `# truthcoin-exchange` posts the settled trades). The hosts' `pay_truthcoin` / `charge_truthcoin` stay for corrections and Trabolta's `mint_truthcoin` stays. Not built: a real wager (SW-PLAY-08, deferred): bets settle with Request / Send |
| 8 | **Trust Chart board** (`BOARD` declaration, terminal `view=board`, `top()` / `bottom()` builtins) | the `trust` slot kept live by the TRUST FORMULA; argmax via `count([p … where p.trust > self.trust]) == 0` watchers; Trabolta reads the names on the TV |
| 9 | **INTERACTION visibility / availability** (`when:` condition; per-question `args` on `prime/act`) so judging, pong, bingo and pickup buttons appear only in their phase, and one ✅ / 😤 pair with a question picker replaces the six per-question buttons | **mostly built in wave 3** (INTERACTION `by:` / `while:`: a performer's card leads with its live buttons, a guest's out-of-phase buttons drop; `restricted: allow` since wave 5). A button with no `while:` still shows and its hook ignores a wrong-phase press; the six per-question judging buttons stay |
| 10 | **`unlock X for group(G)` / `for everyone`** (today the group form **leaks as public narration** of the literal line, and `for everyone` silently does nothing); also `start quest X for everyone` reaching later arrivals | ROLE watchers that unlock per member (`The Whole Truth`, recount bundle, Trust Chart, The Printer) and quest catch-up watchers |
| 11 | `/api/guest/join` must refuse hidden / `joinable: false` groups | groups stay hidden until `y2k_clock` reveals them (a crafted request could still join early) |
| 12 | **Pickup-line input**: punctuation-insensitive `foldCode` (apostrophes, curly quotes) or a text-answer widget | host button `pickup_line_works`, Trabolta's `the_line_works` power, director fire; no codex code |
| 13 | **Screens layer** (ScreenHub + `show … on screens`, media route with Range, terminal templates: screensaver, ads, media player, slide, countdown, video, chart, clock, textfile, song, takeover, effect; wake lock; announce mode; TV presentation ⇄ mirror; targets `screens_*` / `tv_*` / `terminals_*` / `tablet_*`) | `cue …` + the `Night.screen` / `Night.terminals` mirrors; terminals keep face/world/mirror; the TV is a `view=mirror` terminal; set pieces are captions in the Desktop room |
| 14 | **REQUIRED before the party.** Terminal **attract mode before Trabolta exists**: while its character is hidden / `awake` is false the terminal shows the screensaver / media player / ads rotation, never "TRABOLTA ONLINE", and **never pilots** a scanned guest into `dm:Trabolta` (add `revealed` to `CastSummary`). Optional: the server refuses agent dispatch for a hidden character | **Built: K-16** (on master, not yet deployed). Fallback: provision every terminal `view=mirror` until `introduce_trabolta`, then `view=auto` (§9); the hold line is plain words |
| 15 | **Installation Wizard instructional video** in the reinstall tablet wizard (and phone `video` card) | the Wizard's lines in `dm:Installation Wizard` (+ Julia live in the tent); `cue tablet_wizard` |
| 16 | Reinstall: optional **press-A** find, goose vs duck copy, **release-all / end spatial sessions on release**, `released` leave reason, Bathroom Mode on the tablet/VR, tent queue/capacity | the duck by proximity (copy says "walk right up to it"); zip via the two ROLE watchers; performers clear the tent by hand |
| 17 | Excel's virus as an **in-game pickup** (spatial `virus` spot) and a **USB "glory hole" sensor** for planting | codex QRs `LOVE-LETTER-FOR-YOU` / `FREE-TRIAL-30-DAYS` taped in the tent; the guest button `plant_the_virus` |
| 18 | **Server Room in house.json** (cold-storage room, door, terminal, duck rule) via the **floor-plan editor**; map owned by the project; measured house | LOCATION declared without geometry |
| 19 | **Printable QR sheets** (project-level print tokens for codex clues, room check-ins, guest passes, performer cards; base-URL fix; redeem throttle) | `/api/mod/codes` lists codes + `?code=&unlock=` links (no editor UI) |
| 20 | **Stagehand**: signal `args` (so the story judges `patch_changed {combo}` and QR/terminal check-ins carry `at`), a `var:` action, edge detection + ignore retained MQTT (stagehand-hw code #4), an `http:`/audio output (TTS for the house announcements), Loom-4 `with` parsing | `stagehand/trapped.house.yaml` (shipped with the rewrite, §2.15: correct Z2M payloads, room lights, scenes, sensors) judges the combos and sends `patch_combo_a` / `patch_combo_b` / `patch_rejected`; the story latches the patch-bay alarm (wave 7: the door never alarms), restores darkened rooms and cues the dance itself (no `delay:` needed); QLab over OSC; `do announce` |
| 21 | **Trabolta worker**: N1 phase map, N2 proactive acts, N3 disclose/never, N4 phase holds, INTERACTION `available:`; **the secrecy fix** (lookups / `Facts.render` only for held lore; digest, delta and reflect `world` filtered by `persona.facts`; reflect speaker vars filtered by `persona.them`) — required before `lookup` is turned back on | prompt rules per stage; director "set stage" clicks; refusal lines in power hooks; secrets on `Kernel`; `lookup: false` |
| 22 | **Auto-generated recap** (Clippy's purgatory summary, Trabolta's recount, a personalised truth.txt) from chat activity + the mind | beats interpolating `Night.*` names/counts; every backstory unlocked to everyone; a printed truth.txt |
| 23 | Engine: `move who to {expr}` interpolation (today moves to a literal `{at}` room), and binding inexact strings to entities | the check-in if-chain over real LOCATIONs (§3 D1) **[verified]** |
| 24 | Engine: `Persons` excluding Run-mode personas from majorities; a `max`/`len` builtin set | accept personas in rehearsal counts |
| 25 | Director **cue sheet** (labelled, ordered admin buttons; phone cue page; current phase highlighted) | the INTERACTION labels carry the source prompt codes (C1, V1–V6, Clippy N/X) and are declared in running order |
| 26 | Engine: `when program says "…" in dm:X` (typed-chat triggers) | none needed after #12 |

---

## 8. Print + QR appendix (goes into the README)

### 8.1 The Computer Bingo card (OV: "frivolous questions, questions related to getting to know other characters, and one important question")

A 5×5 grid printed as a big asterisk: only the two diagonals, the centre column and the centre
row are squares (16 + the centre = 17); every other cell is blacked out. Checkboxes only, no
room to write (programs use their "special computer memory"). Squares (invented; many point at
featured and pool characters so mingling pays off and identities start to leak):

| # | Square | Who it is really for |
|---|---|---|
| 1 | Has owned a casino | DraftKings |
| 2 | Was expelled from art school | MS Paint |
| 3 | Has lost their face on a livestream | VLC |
| 4 | Has been a mayor, or wants to be one again | Microsoft Excel |
| 5 | Has worked for a three-letter agency | OpenOffice |
| 6 | Has spent more than ten years on one game | Runescape / Bugdom |
| 7 | Has worked in a library | Broken Ask Jeeves |
| 8 | Has sold crickets for a living | Bugdom |
| 9 | Has a parent who invented a video game | Pong |
| 10 | Is two people | Trojan Horse |
| 11 | Knows a cheat code by heart | 3D Pinball, RollerCoaster Tycoon, Minesweeper |
| 12 | Has been banned from a group chat | MSN Messenger, LimeWire, ICQ |
| 13 | Can do the dial-up modem noise | anyone |
| 14 | Has never read the Terms of Service | everyone (frivolous) |
| 15 | Has been to the Halifax Explosion memorial | environment |
| 16 | Has been told they are "a lot" | anyone |
| ✱ centre | Would you never agree to a life where AI makes all of your decisions? | the anti-AI program (`Kernel.anti_ai`, MS Paint) |

### 8.2 Truth or Dare: the bottle (round 1; wave 4, U12 — nothing to print)

No slips. Between each question's results the director spins the bottle (🍾, up to five
times per question): the server picks a cleared program not yet picked for this question,
wherever they are in the house (the TV names them, so they come forward), Trabolta asks *"{name}. Truth or dare?"* on the TV and their phone shows
**Truth / Dare**. Dare → marked for reinstallation. Truth → Trabolta asks the next personal
question from `facts.json` `truths[]` (`TD01`–`TD20`; TD05–TD20 are DRAFT for the team, U20),
spoken on the TV and posted in The Desktop; Clippy presses 🗣 *Truth answered* (+50) or 🙅
*Truth refused* (marked). 🎩 *Chose Dare* is the dead-phone fallback. §3 B9 has the rules.

### 8.3 QR placements (stable codex codes; the print-sheet software is §7 #19)

Ninety coded entries (wave 4: 7 in `1-world`, 21 in `2-files`, 6 in `4-trabolta`, 48 in the
generated `9-facts`, 8 in `generated/questions.loom`). **The Desktop's print stacks**
(`generated/print-stacks.md`, generated from `facts.json`, §2.11): the 8 hunt answers (gold,
each on its own document — the lease invoice in volume B, the plaque rubbing in P, the
programme on the mantel, the Customer Care card in the atlas, Grok's prom ticket slipped into
the atlas, …), the 30 **main** facts (green: inside the encyclopaedias, volumes A–M), the 6
**trabolta** facts (blue: deep in the print media on the mantel) and the 24 **character** facts
(red: the back pages of volumes N–Z and the atlas) all hide in the living room's old
newspapers, encyclopaedias and atlas. The stacks mark twelve hand-written rows "already
placed" (nine with a code; M06, M13 and M26 have no QR): `MAPSANDDUCKS-COM`, `BARRINGTON-ST`,
`COLD-STORAGE`, `GROK-ONLINE` keep their rooms below, and the five codes new in wave 4 go in
the Desktop piles (`UNIFIED-FIELD`, `TARGET-SELECTION`, `TRUST-CHART` green; `SANDY-FILE`,
`ALL-FOR-HER` blue).

The other 29 codes, by room (code → entry): **The Desktop** `MAPSANDDUCKS-COM` Maps And Ducks
(billboard photo) · `CASINO-DEED` (mantel) · `BARKMORE-88` (bookshelf) · `TERMINATION-UO`
(printer tray) · `MASTERCLASS-RIP` (DVD stack). **The Tube** `BARRINGTON-ST` (street photo) ·
`SAVE-THE-PETS` (protest flyer) · `WHOIS-1999`. **The Start Bar** `SINKHOLE-4AM` (clipping) ·
`ALL-IN-BOARDWALK` (fridge magnets) · `GOLD-STANDARD` (thesis by the toaster) ·
`SALINE-INVOICE` (drawer). **Disk Cleanup** `VALLEY-CUTS` · `FACE-OFF-LIVE` (mirror). **The
Cloud** `SITE-SCHEDULE` (shed clipboard) · `BUGDOM-VR` (singed sketch) — on a rain night both
hang in **The Optical Drive** (wave 6, decision 4) · `GROK-ONLINE` (fridge
sticky note). **The RAM** `PET-CEMETERY` (memorial pamphlet) · `HALIFAX-1917` (postcard). **The
Fan Closet** `FBI-HALIFAX` (coat pocket by the dryer). **The CPU** `PAGE-999` (the theory
binder) · `CARNEY-OFFER` (filing box). **The Steam Room** `TENNIS-FOR-TWO` (cardboard tube
behind the games). **The Graphics Card** `NSCAD-LETTER` (the sketchbook on the bed). **The
Hard Drive** `TRABOLTA-4EVER` (the LiveJournal, hidden). **The Internet (tent)**
`LOVE-LETTER-FOR-YOU` (under VR station 2) · `FREE-TRIAL-30-DAYS` (tablet stand).
**Server-room door** `COLD-STORAGE` · `HUMMING-WALL`. (No Antivirus personnel files: the plan is dropped, wave 6 decision 12 — Bugdom's hunt is the
four red Antivirus facts in the Desktop's books.)
Print each as a QR of the `?code=&unlock=` link plus the typed code (no apostrophes).

**Location check-in posters** (one per house LOCATION except The Internet, The Optical Drive and
The Server Room): today they show the room name for a director/Antivirus; once §7 #5 lands
their QR sends `checked_in` with `at` = the exact LOCATION name. **Guest passes / performer
cards / featured claim codes:** software (§7 #1, #19); the story needs nothing more.

---

## 9. Runbook additions (go into the README)

1. **Admin cues** are fired from the cue sheet (Run → Director, K-21) / quick-fire, never
   from a guest card (§0 rule 23). The cue sheet is the admin INTERACTION list, in order.
2. **Terminals**: provision `view=auto`; attract (K-16) holds until `introduce_trabolta`.
   Fallback if attract fails on a tablet: `view=mirror` until the introduction (no scanner,
   no pilot).
3. **Stage clicks** on Run → Mind at each phase (until N1): introduced → formal, truth_1 →
   hungry, malware → rattled, truth_pong → judge, beans → unravelling, y2k → desperate,
   final_reveal → last act.
4. **Fresh mind:** after syncing the rewrite, press Reset on Run → Mind (or start the worker
   with a fresh `state_dir`): `agents.example.yaml`'s `.stagehand-minds` keeps the old "lonely
   grandeur" arc otherwise, and a story restart sends `control reset` only to a connected
   worker.
5. **House map:** after the `Disk Cleanup` relabel, delete the preview event's director save
   `LOOM_STATE_DIR/<event>/spatial-house.json` (or re-save at `/reinstall/map`), or
   `houseWarnings` reports "The Recycle Bin is not a LOCATION" forever. Rebuild
   `reinstall/web` and `terminal` (they bundle offline copies) and re-export the VR APK (low
   priority: the live fetch wins).
6. **Hardware:** load `stagehand/trapped.house.yaml`; the door contact uses `edge: true` and
   ignores retained messages; the patch bay sends `patch_combo_a` / `patch_combo_b` /
   `patch_rejected`; combos must match the Kernel seeds (the stagehand test checks).
7. **Leader absent?** If Microsoft Excel or OpenOffice never arrives (or gets stuck), fire
   `waive_leader_tasks` so the other faction members can still win a majority.
8. **The server room stays live during the final reveal** (deliberate): a combo entered before
   the verdict still ends the night.
9. **Staff back-rooms:** `# hosts` / `# quarantine` are visible to every performer; booth
   readouts are live-only (not kept across a reload) and do not chime; every broadcast,
   including Trabolta's private pop-ups, also shows in performers' `# system-log`.

---

## 10. Invented content + open questions for the user

### 10.1 Invented here (not in the four source docs) — please review

CI 3–9 (the source has only CI 1, CI 2 and a copy-pasted "3/X" title) · every hunt question and
answer H1–H6, F1's framing (F2 = Grok is the source's twist) · the Truther Download bulletin text
· the ad's content (OV's "000" looks like a placeholder; we kept "000. 000. 000." as the joke) ·
Overshare Three and Four · the Installation Wizard backstory (The Setup Assistant) · the Hand Jive weakness ·
the Runescape / MS Paint / VLC / Pong orders and quests · Pong's "why Trabolta chose you" · MS
Paint as the anti-AI program · the 21 coded "files" (§2.12 2-files) and the leader-hint lines ·
the Bingo squares (§8.1) and the bottle's draft personal questions (`facts.json` `truths`) ·
Telephone / piñata copy · the fate-line wording · all Uploader / Installation Wizard / Clippy
filler lines.

### 10.2 Decisions taken that need sign-off

> ✅ **Signed off 2026-10-15: all approved** ("Sign-offs: all of these look good"), together with the
> §10.1 content review (CHECKLIST sign-off #12, SW-STORY-11). These are final for the Oct 31 party
> ([`OCT31.md`](./OCT31.md)). #6: The Way Out does not escape. #10: Oct 31 runs with `lookup: false`.
> Related final answers the same day: #33, a DM lie counts only when filed through a "📝 File a fact"
> card, judged by a human; #28, Sandy is lore only (codex + her line inside the song tracks), with
> an optional cutscene.

1. **Trust Chart counts confident lies** as accepted truths (OV: "correct truths"). Dramatic
   irony; also keeps per-program lie counts away from the AI.
2. **A lie is sticky** per question; a question nobody answered also fails the verdict.
3. **Leader tasks gate the majorities** (OV's "and then"), with a director waiver.
4. **Only Excel's plant drives scenarios 1/3**; anyone else's plant is flavour.
5. **The advice ending is reachable only after a failed verdict** (`grok_prom`).
6. **Combo B kills everyone**, including The Way Out ("into purgatory, with everyone else");
   say if The Way Out should escape instead (OV's alternate: "programs escape the computer /
   programs elect to remain").
7. **The server room stays live during the final reveal.**
8. **MS Paint is the anti-AI program** (Cat's sheet must carry it).
9. **Guests' influence on Trabolta never changes a branch by itself**; the director reads
   `love` / `regard` when choosing.
10. **Opening night runs with `lookup: false`** unless the stagehand secrecy fix lands.
11. **Performers (Antivirus, hosts) do not count toward majorities** (engine limit).

---

## 11. Critique log

Every finding of the three critiques, with its disposition. **A** = accepted and fixed (where);
**R** = rejected (reason).

### 11.1 Source fidelity (`critique-fidelity.md`)

| Finding | Disposition |
|---|---|
| H1 "every requested fact accurate" counted answers, not questions | A — per-question record on `Kernel.q1`–`q8` via six per-question judging buttons (§2.11, §3 B8); verdict = all eight accurate (§3 F3, §5); collection = q4–q6 accepted (§3 D5); lies sticky (§10.2) |
| H2 overshare keyed on anyone planting | A — `Kernel.excel_planted` drives scenarios 1/3; others are flavour (§3 C4, D9, §5) |
| M1 majority ignored leader prerequisites | A — majority watchers gated on the leader's task + `waive_leader_tasks` override (§3 D10, §5) **[verified, x1]** |
| M2 Jeeves fragments leaked Combo A / T2 / later reveals | A — #07, #12–#17, #19, #20 replaced; rule: no T2/L/P/X/hunt/later-reveal sources (§2.12 8-jeeves) |
| M3 too few QR clues | A — 21 new coded "files" (`codex/2-files.loom`); 41 coded entries total (§2.12, §8.3) |
| M4 TV vs terminals; no media-player state; ads never re-fired | A — targets split `screens_*` / `tv_*` / `terminals_*` / `tablet_*`; TV keeps the screensaver until C1; `terminals_attract` rotation (screensaver / media player / ads) at first clearance, Bingo start and Bingo time (§2.13, §3) |
| M5 truth.txt / recount must say why each was brought in | A — "Why Trabolta chose you" sentence on every person (§2.12 5-people); Truth Txt and the recount name roles and reasons explicitly (§3 E4, F3) |
| M6 nothing surfaces conflicting identities | A — ID files (FBI lanyard, site schedule, Barkmore buttons, …) + a leader-hint line to Excel and OpenOffice (§2.12, §3 C3) + identity-hinting Bingo squares (§8.1) |
| M7 Bingo card and the Truth-or-Dare material unwritten | A — §8.1 squares; §8.2 is the bottle (wave 4 replaced the paper slips with `facts.json` `truths`) |
| M8 Telephone / piñata / awards dropped | A — optional set pieces `telephone`, `are_you_sure`; `award_the_ribbon` gives any ribbon (§3 B3, B10) |
| M9 pool hint pre-empts Sandy | A — "Ask who Sandy is" dropped from Program Glitch; The Truther Download (the user's verbatim text names her) blacks the name out until the story says it, then `The Truther Download Unredacted` (wave 6, decision 5); H5 now an oblique song answer; H4's card says nothing about who Sandy is (§2.11, §3 C3) |
| L1 Trust Chart counts lies | A (flagged) — kept deliberately, sign-off requested (§2.7, §10.2) |
| L2 intro order + unguarded intro | A — `Night.step >= 3` guard; TV mirror + "Look! That's…" moved after the introduction, in CI 2's order (§3 B3, B5) |
| L3 immediate CAPTCHA fail penalised | A — no doubt, new line (§3 A3) |
| L4 featured asked the problem question | A — skipped for featured, `human_problem = "profile"` (§3 A3) |
| L5 OpenOffice choice clause truncated | A — restored in the choices and Orders (§2.12, §3 C3) |
| L6 Excel quest text same for both choices | A — text by `excel_choice` (§2.10, §3 C3, C4) |
| L7 advice precondition too loose | A — `grok_prom` only (§3 F7, §5) |
| L8 Combo B wording for The Way Out | A — third fate-line variant; open question (§3 E7, §10.2) |
| L9 server room live during the reveal | A — kept, labelled a deliberate invention in §3 F1, §5 and the README (§9) |
| L10 non-member alarm after unlock | R — the door contact cannot identify who opened it; the Antivirus police non-members in person and their alarm readout says so (§3 E2) |
| L11 Bobbing has no failure | A — `failed_the_bob` → marked for reinstallation (§3 F2; wave 4) |
| L12 Persons excludes Antivirus/hosts | A (noted) — engine limit stated in §3 D10, §5, §10.2 |
| L13 underused Password Manager / McAfee | A — Password Manager: join readouts + private-channel invites; McAfee: Truthcoin exchange broker (§2.2, §2.14, §3 D10) |
| L14 Trojan Horse two clowns | A — one program / one phone; shared identity added to §7 #1 |
| L15 invented content presented as source | A — §10.1 register; CI 3–9 and hunt questions flagged; H6 answer made ungoogleable. F2 (Grok) guessability: R — it is the source's twist; a guess must still be confident and a wrong one poisons the verdict (§2.11) |
| L16 MS Paint anti-AI sign-off + conflicting ToS prompt | A — Centre Square text resolves the conflict; sign-off requested (§2.1, §2.12, §10.2) |
| L17 multiple Bingo winners | A — every Bingo-phase capture gets the Bingo line, no extra doubt; only the first fires Corrupted Code (§3 B3) |
| L18 facts_requested / Final Facts timing; combo naming | A — both at `trabolta_overshares` everywhere; P titles "Disable Trabolta" / "Self-Destruct" (§2.10, §2.11, §2.12) |
| L19 Tube hook never fires | A — line moved into Clearance; hook dropped (§2.14, §3 A4) |
| L20 Bingo "mingle" instruction missing | A — in Computer Bingo and the quest brief (§2.10, §3 B2) |
| Arc: no video/audio state | A — media player in `terminals_attract` (§2.13) |
| Arc: unguarded intro | A — as L2 |
| Arc: "he watches through the screens" in `desktop` | A — removed from the mind cue (§4.6) |
| Arc: influence never changes a branch | A — stated in §4 and §10.2 |
| Arc: powers only accumulate | A — powers degrade / are lost / change by phase (garbled pop-ups, involuntary flickers, screens lost at y2k, richer mint, only assess / the line in the last act) (§4.2, §4.3) |

### 11.2 Language feasibility (`critique-feasibility.md`)

| Finding | Disposition |
|---|---|
| B1 quoted `at` binds a value | A — bare `at: The Desktop` everywhere; §0 rule 14 |
| B2 inexact `at` from hardware/director | A — check-in if-chain over real rooms; contract "exact LOCATION name" (§3 D1, §2.8); no-arg / lowercase tests (§6.1 item 10) |
| B3 `broadcast … to group(Antivirus)` reaches no booth | A — Enforcer / Recycling Bin / Password Manager `reply` hooks on `go to the bathroom`, `program_late`, `sweep_requested`, `alarm_tripped`; every group broadcast removed (§0 rule 16, §2.14, §3 A5, D3, E2, §4.3) |
| B4 `start quest … for everyone` misses late arrivals | A — four catch-up ROLE watchers (§2.7) |
| B5 `unlock/reveal … for group(G)` leaks as narration | A — per-member watchers kept; writers warned (§0 rule 17, §7 #10) |
| B6 featured name + colon parses as dialogue | A — §0 rule 5 reworded; recount / truth.txt written as prose; §6.1 item 20 |
| C1 `{self.name}` null in CHARACTER bodies | A — §0 rule 18 |
| C2 agent `target` by name / missing | A — null guard on every target power (§0 rule 19, §4.3); tests (§6.1 item 17) |
| C3 admin cues from a guest card | A — §0 rule 23, §2.9, §9 |
| C4 deadline watchers need their guard | A — §0 rule 13 |
| C5 spaced kept names need `for program` | A — §0 rule 20 |
| C6 faction channels not private between factions | A — labelled staff back-rooms (§2.5, §9) |
| Minor: `do door, room: …` empty target | A — `do door server_room, state: unlocked` (§0 rule 10, §2.13, §3 E1) |
| loomcheck gaps | A — detector list in §6.1 (optional, before writers start) |

### 11.3 Dependencies and runtime contracts (`critique-dependencies.md`)

| Finding | Disposition |
|---|---|
| 1 spatial.test: free program must learn The Golden Duck; `send to the internet` must stay unguarded | A — both release rules written exactly (§3 B4); §0 rule 22; §6.1 item 6; §6.2 "must be run" |
| 2 mind YAML `>-` on the same line | A — block form shown + rule (§4.6) |
| 3 mind.spec 'lonely grandeur' | A — → 'asleep' (§4.6, §6.2) |
| 4 secrets reach orchestrator / lookups / voice | A — secrets moved to `CHARACTER Kernel` (§2.6.2, §0 rule 21) **[verified, x1]**; `truths_confident_false` removed (one `truths_accepted`); `lookup: false`; story never moves `untruth` on a lie (found while fixing); stagehand secrecy fix in §4.5 / §7 #21; secrecy test §6.1 item 21 |
| 5 orchestrator "ground truth" = first 24 entries | A — numbered codex files, world first, Jeeves last (§1) |
| 6 terminals put him online early | A — plain-words hold line; `view=mirror` runbook; §7 #14 promoted to REQUIRED; optional server refusal (§4.1, §9) |
| 7 no stagehand house config | A — `stagehand/trapped.house.yaml` + `test_trapped_house.py` with cross-checks (§1, §2.15) |
| 8 `cut_the_lights` safety + restore | A — allow-list, 90 s restore watcher, admin `restore_the_lights` (§4.3) **[verified, x1]** |
| 9 blackout never cues the dance | A — `Night.dance_at` watcher + admin fallback (§3 E4) |
| 10 door sensor re-fires | A — 120 s latch, composure hit on the first alarm only, `alarm_tripped` readouts (§3 E2) |
| 11 signal args can't come from stagehand; unbound `at` | A — if-chain ignores missing/bad `at`; stagehand judges the patch (§3 D1, §2.15, §7 #20) |
| 12 `do door, room:` | A — as feasibility minor |
| 13 identity.test edits + traps | A — §0 rule 24, §6.2 traps, Kernel not pickable |
| 14 house.json director save / bundles | A — §9 item 5 |
| 15 the duck is Gerald | A — codex text, the tent voice's line, release reply (§2.12, §3 B4) |
| 16 Optical Drive (mud room) mis-capture strands an uncleared program | A — `when released:` fix-up (§2.7) |
| 17 persisted minds keep the old arc | A — §9 item 4 |
| 18 docs not listed | A — §6.2 docs/README list extended |
| 19 live-collab e2e | A — run it; fallback `template: "blank"` (§6.2) |
| C1–C9 test additions | A — §6.1 items 6, 10, 14, 17, 19, 21 and the stagehand bullet in §6.2 |
