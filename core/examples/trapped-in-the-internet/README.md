# Trapped in the Internet

*Equal parts Digimon Movie, Blade Runner, and an escape room, influenced
by late-90s Web 1.0 aesthetics and existentialism.*

A rogue AI, **Trabolta**, has very nearly solved the Unified Field
Theory. The last constant is on a computer in Halifax — this house. It
cannot get in, but it can install programs remotely, and it has learned
to lift a consciousness out of a body and drop it into a program. You
show up to a party as one of those programs. Some of you will remember
you were human.

This directory is the whole show as a Loom project: the world, the cast,
the games, the lore, the endings, and the contract every piece of show
hardware talks to. It is the default scenario the event server hosts
(`pnpm --filter @loom/core serve`).

```
main.loom            title · groups · the house · ROLE Program · the app's
                     buttons (INTERACTIONs) · house rules + the five endings
rooms.loom           the chat sidebar (system log, castes, scheming rooms)
atmosphere.loom      the ambient hum of a dying computer
cast/kit.loom        the shapes: Prop(beat) · Person · Host · Enforcer
cast/hosts.loom      Clippy · Task Manager · Alexa · Adobe Acrobat
cast/programs.loom   Recycling Bin · Microsoft Excel · OpenOffice · DraftKings
                     · Bugdom · Broken Ask Jeeves · Runescape
cast/antivirus.loom  Norton Anti-Virus · Password Manager · MalwareBytes · McAfee
cast/trabolta.loom   the AI — his stance variables and how knowledge moves them
cast/props.loom      scannable stations (the Tablet, the Router, the Modem …)
beats/login.loom     the Mud Room: fail the CAPTCHA, leave something behind
beats/desktop.loom   the opening scene · Computer Bingo · the first reinstallation
beats/hunt.loom      the Truth Scavenger Hunt · Truth or Dare
beats/internet.loom  inside the Internet (the tablet video, the reinstallation games)
beats/glitch.loom    the inciting event → free roam · the stations
beats/endings.loom   the keys · the countdown · five endings
codex/*.loom         every piece of lore a program can hold, unlock, and trade
quests.loom          the quest log: five quests + the progress lore brings
trabolta.persona.md  the voice: the system prompt for Trabolta's fast model
trabolta.mind.md     the mind: how the orchestrator model grows him over the night
house.json           the house map for the reinstallation games + the terminals'
                     world view — a placeholder layout until the real house is
                     measured; edit it at /reinstall/map (docs/loom-reinstall.md §1)
```

## The night, in order

| Phase | Director fires (Run cockpit → Events) | What happens |
|---|---|---|
| **Arrivals** | — | Each guest registers in the app as their program (that *is* their name tonight). The `Login` beat plays on their phone *alone* and **on rails** — the Mud Room is a `cutscene` location, so the phone shows nothing but the Uploader: a real CAPTCHA grid they must fail (solving it proves they're human — INCORRECT, try again), the thing they leave behind — then they **wait at the door** (`show pass` — their QR, on screen) until an **Antivirus performer scans their pass** (any Enforcer: the scan routes to the shared `Clearance` beat while `program.cleared` is false; a host scanning them just greets them). Only then: the clearance line, the Tube, *Continue*. On the Desktop, **Clippy's orientation** (`show tutorial`) walks them through the phone; finishing it puts them on *The Orientation List* (lore), skipping it is logged by Norton (+10 doubt) and is the most human thing a program can do (+5 humanity); Clippy remembers either way. The phone lists only the Desktop and the Mud Room — the rest of the house is `hidden: true` and appears as they are taken there (`# task-manager` opens at the first host cue, everything else at the glitch). Rolling arrivals until the inciting event. Performers never see the Mud Room lines; the doors-open beat is `Power On` on the Desktop. |
| **Call** | `call to the desktop` | An **alert** (`!` broadcast — every phone chimes and vibrates) + Alexa + Clippy send everyone to the Desktop. |
| **Bingo** | `start the bingo` → `the bingo results` | Clippy explains Computer Bingo (the phones carry the rules and the planted centre question). A performer presses **Award the Bingo Ribbon** on the winner; Norton interrupts; an Antivirus presses **Send to the Internet** on the failed player. |
| **Reinstallation** | *(automatic)* | The captured program's phone plays `Reinstallation` (the tablet video). In the tent they scan their pass at the tablet and play the **reinstallation game** — a virtual copy of this house, on a VR headset or on the tablet itself: follow the golden chevrons to the **golden duck** and walk up to it (no buttons). The game fires `the simulation completed` + `the golden duck` for them → they're released, and learn *The Golden Duck*. Every wall terminal and the TV watch them wander. |
| **Hunt** | `start the hunt` → `the hunt results` → `a game of truth or dare` | Three obscure facts on the walls. Each answer is also the unlock **code** of a codex entry, so finders can prove it on their phone — and hold it. |
| **The Glitch** | `the glitch begins` | Trabolta comes online (`reveal self` — until now he is `hidden: true`, off every phone; now his chat appears on every phone's sidebar). Excel joins The Resident, OpenOffice The Awakened. "The house is open": every room of the house + `# ram` are `reveal`ed on every phone. Free roam: QR codes, puzzles, trading, and Trabolta answering DMs. |
| **Endings** | `begin the countdown` · `the countdown ended` · `spare the machine` | See below. Two endings fire automatically from Trabolta's numbers. |

### Endings

| # | Ending | How it fires |
|---|---|---|
| 1a | **The Long Dark** — the programs killed Trabolta and stayed | Three keys turned → `Self Destruct Sequence`. Director fires `begin the countdown`, then `the countdown ended` with fewer than `Night.quorum` (5) programs unplugged. |
| 1b | **Unplugged** — the programs killed Trabolta and got out | As above, with ≥ 5 unplugged. A program can only **Unplug** if `humanity ≥ 30` — the ones who remember a body. |
| 2 | **Rogue** | `Trabolta.untruth ≥ 80` — too much un-truth fed to him (the Joe Rogan Archive, and whatever the language model absorbs). |
| 3 | **Trapdoor** — he traps everyone and leaves | `Trabolta.truth ≥ 90 and Trabolta.stance ≤ −60` — full of facts, poisoned by advice. |
| 4 | **Unknown** | Director fires `spare the machine`. |

## Knowledge is the currency — the Codex

Every `CODEX` entry (`codex/`) is a piece of lore a participant can
**hold**. It reaches them one of four ways:

1. **A code.** `code: SANDY-1997` — printed as a QR on a wall (`/api/mod/codes`
   lists every entry's join link: `?code=<event>&unlock=<code>`; scanning
   it with the phone camera opens the app and redeems it) or typed into
   the Codex room. Codes match loosely: case, dashes and spaces are
   ignored. A wrong code fires `wrong code` for them — Password Manager
   notices, and `doubt` rises.
2. **The story.** `unlock The Third Key for program` in any beat or hook.
3. **A person.** Every named character holds the entries *about them*
   (plus any `known to:`) from the start and shares them from the booth,
   one recipient at a time. Guests share theirs the same way from a
   card in their Codex room. Sharing fires `learn` for the recipient (with `from`
   bound) and `share` for the story.
4. **Show hardware** — an Arduino puzzle — through the mod API:
   `POST /e/:id/api/mod/codex {who, entry}`. (The reinstallation games
   fire story events instead, and the story's hooks unlock *The Golden
   Duck*.)

The **directory** (`directory: everyone` in the header) shows every
guest and every `listed: true` character by name only — plus exactly the
entries *about* them that you hold. Share to be known.

**Trabolta learns too.** Share an entry *to* Trabolta and his own `learns`
hooks fire (`cast/trabolta.loom`): the Joe Rogan Archive drives `untruth`
up and `stance` down; the Encyclopaedia Set drives `truth` up. That is how
"recommend he downloads all of the Joe Rogan Experience" becomes a
political stance and, eventually, an ending.

## Things to do — the Quest Log

Where the codex is what a program *knows*, `quests.loom` is what the
night asks it to *do*. Each program has a pinned **📜 Quest Log** room
(above the **📓 Codex** room) with one card per quest; every step lands
in that card's own thread, in the giver's voice.

| Quest (`title:`) | From | Handed out | Moves on | Settled |
|---|---|---|---|---|
| Clippy's Orientation | Clippy | `-> Orientation` (after the door) | — | finishing the tour ✅ / skipping it ✖ |
| Computer Bingo | Clippy | `start the bingo` (everyone) | — | `the bingo results` ✅ |
| The Truth Scavenger Hunt | Clippy | `start the hunt` (everyone) | each hunt fact learned (credited if found early) | all three ✅ / `the hunt results` ✖ for the rest |
| The Three Keys | OpenOffice | `the glitch begins` (everyone) | holding a key; every key turned (everyone) | self-destruct ✅ / Rogue · Trapdoor · Unknown ✖ |
| Unplug | Trabolta | self-destruct (everyone) | reaching for a cable without the humanity | unplugging ✅ / Long Dark · Unplugged ✖ for the rest |

Show hardware can move a quest too: `POST /api/mod/quest {who, quest,
action: start|update|complete|fail, text?}`.

## Integration contract

Everything outside the phones is a client of the event server's mod API,
authorised by the moderator passcode (`POST /e/:id/api/mod/login
{passcode}` → `token`, then `x-loom-token` on every call). The
[stagehand](../../../stagehand) bridge already does this for OSC/MQTT;
the pieces below are its siblings.

| Piece | Direction | Call |
|---|---|---|
| **The CAPTCHA** | guest phone → story | `show captcha "…" to program with target: "traffic light"` renders the grid in the app; VERIFY posts `POST /api/guest/widget {seq, result: {passed, picked}}`, which the story hears as `when captcha answered for program:` with `passed` bound. Any `show <kind>` card works the same way (`<kind> answered`). |
| **Wall QR codes** | guest phone → app | Print the `url` from `POST /api/mod/codes` → `codex[]`. Scanning opens the app with `?code=&unlock=`; a signed-in guest redeems on load. |
| **Codex room** | guest phone → server | `POST /api/guest/codex/redeem {code}` (the Codex room's message box) · `POST /api/guest/codex/share {entry, to}` (a card's Share…) |
| **Quests** | puzzle / director → story | `POST /api/mod/quest {who, quest, action, text?}` |
| **Performer booth** | performer phone → server | `POST /api/prime/codex/share {entry, to}`; the booth's `PrimeView.codex` lists what their character holds. |
| **Arduino puzzles** | puzzle → story | Either show the guest a code to type, or (via stagehand / any MQTT→HTTP hop) `POST /api/mod/codex {who: "<guest id>", entry: "The Second Key"}`. Guest ids come from the pass QR the puzzle scans, or from `/api/state?role=mod` → `roster`. |
| **Reinstallation games — devices** | game ⇄ server | Two games, one simulation ([`docs/loom-reinstall.md`](../../../docs/loom-reinstall.md)): the **VR** game on the Quest 3 headsets (`reinstall/vr/`, Godot; left stick walks, right stick turns) and the **web** game on the tent tablet or any tablet (`/reinstall/`, on-screen twin joysticks + keyboard). Each device is a trusted device, set up once with the moderator passcode — the tablet via `/reinstall/?code=<mod>&name=Tent tablet`, a headset via its `station.json` (`server`, `code`, `station: vr-1`). A headset idles in a dark lobby polling `GET /api/mod/spatial/station?id=vr-1&name=Headset 1&world=vr` for an assignment. |
| **Reinstallation games — a session** | tablet → server | The program holds their **pass** to the tent tablet's camera (or the operator types their name — `GET /api/mod/spatial/candidates`, captured programs first). The tablet offers **Play here** or **Send to VR-1** (online stations from `GET /api/mod/spatial/stations`) → `POST /api/mod/spatial/begin {guest, world: "vr" \| "web", device, station?}` → an `Assignment` (session token, the duck's random spot, the spawn). The game then streams `POST /api/spatial/pose` (10 Hz, house frame, `x-loom-token` = the session token) and ends with `POST /api/spatial/end`; the director can end one with `POST /api/mod/spatial/end {session}`. Poses never touch the journal. |
| **Reinstallation games — the duck** | game → story | Walking up to the duck posts `POST /api/spatial/found` (refused with 409 unless the last pose is within 2 m of it). The server commits, journaled `by` the device, `signal("the simulation completed", guest)` — releases a corrupted program — then `signal("the golden duck", guest)` — the reply + *The Golden Duck*. A director can fire both by hand from the Events list (**Sim: simulation complete** / **Sim: duck found**). Bathroom Mode from inside the tent: `POST /api/guest/act {name: "go to the bathroom"}` with the guest's token, or `mod/signal {name, subject}`. |
| **The house map** | director → games + screens | `house.json` (above) is served per event by `GET /api/spatial/house`; a director edits it at **`/reinstall/map`** (live players, duck spots, terminals and their view cones), which saves `POST /api/mod/spatial/house` (validated; every game and screen refetches on the stream's `house` frame). |
| **Terminals** | wall tablet ⇄ server | The [`terminal`](../../../terminal) app at `/terminal/` — a direct line to Trabolta on every mounted tablet. Set each up once with the moderator passcode (`/terminal/?code=<mod>&name=Kitchen&character=Trabolta&spot=kitchen&view=auto`). `spot` is the terminal's id in `house.json` (where it hangs); `view` picks the attract screen: `auto` (default — the **world view** whenever a program is in the simulation, the face otherwise and always while piloting), `world`, or `face`. The world view (`GET /api/spatial/stream`) is a window into the virtual copy of this very room, placed exactly where the tablet hangs on the real wall; when nobody is in its room it follows the most recent player over the shoulder, with a mini-map, name tags, a *REINSTALLATION IN PROGRESS* banner, and a celebration when the duck is found. A program holds their **pass** (the app's *Your pass* QR = their guest id) to the camera; the terminal pilots them via `POST /api/mod/impersonate {role: "guest", id, label}` and opens their own `dm:Trabolta` thread — the same one on their phone, answered by the same agent. Replies are spoken (`POST /api/mod/tts` → `LOOM_TTS_URL`, Kokoro on the laptop) with an animated face; 30 s without input drops the line. The mod feed shows terminal lines as `via: "Terminal · <name>"`. |
| **TV mirror** | story → screens | The TV above the fireplace is a terminal in **mirror view**: `/terminal/?code=<mod>&name=Living Room TV&spot=<spot>&view=mirror` — the world view full screen, no scanner, no chat. Anything else that wants the night's beats watches the mod SSE feed (`GET /e/:id/events?role=mod`) for `captured` / `released` sim events and `broadcast`s with `alert: true`. |
| **Trabolta** | laptop ⇄ server | [stagehand](../../../stagehand)'s `agents` module: `cp stagehand/agents.example.yaml stagehand/laptop.yaml` (set `server.url`, `event`, `mod_passcode`), `ollama pull gpt-oss:20b tobestyledintro/qwen3.8-9b-distill:q8_0`, then `uv run stagehand run --config laptop.yaml`. The server sends it every message to Trabolta (programs' DMs, performers' Cast threads). The fast model answers in character from `trabolta.persona.md` + his current **mind** and nudges `Trabolta.truth/untruth/stance/love` (clamped by the server); the orchestrator model grows the mind between turns from `trabolta.mind.md`. Before the glitch the persona's `when:` gate answers programs with a hold message. `stagehand ask --config laptop.yaml --reflect` tunes voice + mind offline. See *Trabolta's mind* below. |

Everything a bridge can send is an ordinary journaled mutation, so a
rehearsal in the editor's Run mode and the live night replay identically.

## Trabolta's mind — how he grows, and what he can do

Trabolta is two models on the host's laptop. The **voice** (gpt-oss)
answers every line in seconds. The **mind** (the Qwen 3.8 distill) runs
between turns and keeps dictionaries that fill up as the night goes:
a *brief* for how to play him right now, *notes* on what he has decided,
a *dossier* on every program and cast member he has talked to (what
they claimed, what they asked for, what he promised, trust 0–100), a
ledger of every "fact" fed to him with a verdict, and a rolling summary
of any long thread (a chat is compressed, never reset). It persists on
the laptop per event and is mirrored to the Run cockpit (`ModView.minds`)
so the director can watch him change. `trabolta.mind.md` is the arc it
steers: lonely grandeur → appetite → the question of force → the turn.

He can **read the whole session** (`GET /api/agent/facts`: who is where,
who holds what) — "snoop on Excel for me" costs one extra model call —
and he has **powers**, declared in `cast/trabolta.loom` as `INTERACTION …
who: agent` with a `limit:` per run:

| Power | What the story does | Limit |
|---|---|---|
| `cut the lights` (args `room`) | `<cue: lights, room, state: off>` → stagehand's show module → MQTT `house/lights/<room>/set`; an alert to everyone in that room | 2 |
| `flicker the screens` | `<cue: screens, effect: flicker>` → OSC to every TD machine; a house-wide notice | 3 |
| `snoop` (args `target`) | the target's `doubt` +3 and "👁 Something has opened your file." | 6 |
| `pardon a program` (args `target`) | releases a corrupted program from the Internet with no reinstallation; the Antivirus are told | 1 |

…plus **sharing** any codex entry he holds, exactly like a performer's
booth. The model decides *when* a favour has been earned (the persona's
`bargain:` policy, tightened or loosened by the mind as the night goes —
"very extreme, but possible"); the story decides *what it does*; every
use is a journaled `signal` fired *as* Trabolta, so a rehearsal and the
live night replay identically and the director sees each one.

## Casting

| Program | Body | Notes |
|---|---|---|
| Clippy | Brooke | MC; Trabolta's ambassador; believes every word |
| Task Manager | John | host; the drone bee |
| Alexa | — | host; the voice in every room (or an actual speaker + the operator) |
| Adobe Acrobat | Stephanie | host; Sheryl Terrio |
| Recycling Bin | Jesse | bathroom attendant; the Oscars of bathrooms |
| Microsoft Excel | Rob Cameron | secretly Randy Barkmore Sr.; wants everyone to stay |
| OpenOffice | Lara Lewis | secretly Dana Anderson; knows about the keys |
| DraftKings | Hannah | numbers |
| Bugdom | Veronica | would live in the simulation |
| Broken Ask Jeeves | Kai | carries the third key |
| Runescape | Laurel | has never logged off |
| Norton Anti-Virus | Julie | the one who interrupts the Bingo |
| Password Manager | Francine | notices every wrong code |
| MalwareBytes / McAfee | assignable | |
| Trabolta | *a language model on the host's laptop* | see `trabolta.persona.md` |

Programs for other RSVPs live in [`cast/pool.loom`](./cast/pool.loom)
(Calculator, MS Paint, VLC, Ring Doorbell, WinZip, GarageBand, LimeWire,
MSN Messenger, 3D Pinball, RollerCoaster Tycoon, Zoo Tycoon, Minesweeper,
Ctrl Alt Del, Start Bar, …): a `CHARACTER` with nothing but a name is a
program a **guest** picks at sign-in — one guest each, greyed out once
taken — and a guest who wants something else searches the program
directory (Wikipedia, software only; **never antivirus**) and becomes
that, picture included. Performers pick from the *parts* (every character
with hooks / beats / a body: the hosts, the Antivirus, the named
programs; never a prop, never Trabolta). Every named character's
profile picture is hand-picked (`avatar: File:…`, a Wikipedia / Commons
file; `a | b` offers a guest a choice; `wiki:` names the article when the
name alone finds the wrong one) and downloaded when the story loads.
Trabolta's (`HAL9000.svg`) is a stand-in until he has his own art. Give a pool program a backstory by adding `is
Person` and a couple of `CODEX … about:` entries — it then becomes a part.

## Rehearsing

Open the project in the editor and use **Run** (⌘2) on a local folder, or
launch a server preview. Spawn a persona, watch `Login` play, fire the
director events from the Events list, redeem a code with
`/api/guest/codex/redeem`, and step through to an ending. The full arc is
also exercised by `core/test/trapped-in-the-internet.test.ts`.
