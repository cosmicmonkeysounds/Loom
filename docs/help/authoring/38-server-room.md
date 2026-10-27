---
title: Running the server room — the keypad door, the King and Trabolta's heart
section: Live Shows
order: 38
keywords: server room, marked, keypad, keypad lock, door code, code, digit, digits, digit notes, notes, clue, clues, silver, cold door, The Cold Door, the King, king, chess, chess terminal, door terminal, Server Door, health bar, shared health, hit, kneel, kneels, fallen, restore, restore the king, simulation, chess won, chess lost, chess drawn, king hit, king fallen, beat the machine, door, door sensor, sensor fault, override, trust the door sensor, close the door, cutscene, The Heart, heart, heart stage, layers, suspicion, thrown out, barred, proof, not yet, speak freely, heart to heart, autoend, server-room terminal, terminal, file panel, give him a file, talk down, talked down, stand down, Fallout, Master, light, bulb, lights.json, patch bay, alarm, wrong combination, reset, latch, crew, crew window, fallback, honour, OP-12, truth.txt, verdict, banished, banishment, hand jive, Trapped in the Internet, runbook, cold lock
---

In *Trapped in the Internet* Trabolta's heart — a video patch bay — sits
behind the **server-room door**, and that door has a real **keypad
lock**. Whoever opens it with the code gets in, whoever they are; nobody
is "breaking in". This page is the director's side of the room: how a
program gets the code, the King and his chess terminal, what happens
when the door opens and he asks for it shut, the terminal inside where a
program talks him through four layers of questions (and maybe into
stopping), the light in his heart, the patch-bay alarm, and the buttons
that fix each of them.
How the rules are written is in [live verbs](33-live-verbs.md) (*A
button as a fallback for a machine*); the map side is in [the house
map](39-house-map.md).

## The keypad and the code

The lock is **standalone**: its code is set by hand on the lock and it
talks to nothing. No cue, no sensor, no button in Run can lock or unlock
it. From inside, the handle always opens with no code.

The code lives in one place, the project's `facts.json` (`door.code`).
`pnpm --filter @loom/core titi:facts` writes it into the story's secret
state (`Kernel.door_code`) and into a secret codex entry, *The Door
Code*. It also writes the four digit notes (below) and prints the keypad
sign into `generated/print-stacks.md` — never the code. To change it:
edit `facts.json`, regenerate, sync, and **reprogram the keypad by
hand**. Never say it on the radio.

The sign by the keypad (also *The Cold Door*, a secret codex entry)
reads *"FOUR DIGITS. FOUR NOTES ARE HIDDEN IN THE HOUSE, ONE DIGIT ON
EACH. OR BEAT THE KING AT THE TERMINAL BY THIS DOOR."* There is no
riddle any more: nothing in the lore spells the code out.

A program gets *The Door Code* one of three ways:

1. **The four digit notes.** All four in one Codex (below).
2. **Beat the King** at chess on the terminal by the door (below).
3. **Win the majority.** Every member of the winning faction gets *The
   Door Code* last in their Whole Truth.

*The Door Code*, *The Cold Door* and the four notes are `secret: true`,
like the patch sheets and the Legendary Fact: Trabolta's models never
see them, and he refuses one shared to him. A program may still type
the code or a combination to him. His worker never writes one into his
memory (which every conversation reads) and never lets him say one —
the mind file's `secrets.never`, generated from `facts.json` and the
story's combos (`titi:facts`) — so what one program types never reaches
another's.

## The four digit notes

Four notes, one digit each, are hidden in four rooms, never in the
server room: the print sheet's **silver** pile (Run → 🖨 Print sheet;
the hiding places are in `generated/print-stacks.md`). Each poster
prints a title and a QR. The digit is never printed: it is only in the
entry's text, once scanned. Nothing on a note's title, code or hiding
place names a digit.

They scan **all night**, like any codex code:

- The **first** note starts the quest *The Cold Door* (*1 of 4*) and
  hands the program the keypad sign's words.
- Each next one steps the quest (*2 of 4*, *3 of 4*).
- The **fourth** puts *The Door Code* in their Codex, completes the
  quest, and tells `# hosts` *"🔢 X found all four digit notes: the door
  code is in their Codex."*
- A program who already has the code (a checkmate, the majority) gains
  nothing more; the quest closes on the code itself.
- **After 📄 truth.txt** (or an ending) the notes still count and the
  quest still steps, but four of four gives no code: the quest **fails**
  (*"4 of 4. The verdict is in: the notes open nothing now."*, or *The
  night is over* after an ending) and `# hosts` hears why: *"… found all
  four digit notes after truth.txt. The verdict is in: no door code."*
  or *"… after the night ended …"*.

Notes can be shared between programs like any entry, so a group can
pool them. Trabolta won't take one, and a phone's *Share…* never offers
him one. How many notes a program holds (`door_digits`) and how far
their *The Cold Door* has got are ROLE Program `secret:` slots, so his
worker never learns who is close to the code.

## The King

He stands at the server-room door twice: in the simulation, and in the
real house as a chess opponent. **His health bar is one bar for every
program, all night: 15 points, never regenerating** (`Night.king_hp`
out of `Night.king_hp_max`, set to 15 at Power On — so a restart puts
him back to full).

### In the simulation

In both reinstallation games (the tent laptop and the headsets) he
stands in the server-room doorway of the virtual basement hall, with his
bar over his head: the only King display in the games (since wave 26 the
web game's HUD carries no King meter, and the headset's hit notice no
longer says *once per visit*). The chevrons never lead to him; the duck is
elsewhere.

- **One hit per program per reinstallation visit.** Up close and facing
  him, **⚔ HIT** (or **Space**) on the tablet, the **trigger** (or A / X)
  in a headset. The server judges the reach, knocks a point off, and
  tells the story `king hit` for that program. A visit lasts until that
  program's duck is found: leaving and scanning again, a director's end,
  a timeout or a re-scan mid-walk is the same visit: ⚔ shows as spent
  from the start, with *"You hit him this reinstallation. Find Gerald
  before you hit him again."*
- `# hosts` reads every hit: *"⚔ X hit the King in the simulation:
  14/15"*. The house hears him stagger at 10 and at 5.
- **At 0 he kneels for everyone** (`king fallen`): a house-wide alert,
  a `# hosts` line, and in both games he goes down on one knee and the
  door he guards opens for every player.
- A pause holds every hit (*doors are closed*): nothing lands until you
  resume.
- A **server restart** forgets who has hit this visit (the bar itself is
  safe, it is in the story): each program in the simulation may hit once
  more.
- **Once he has fallen** (wave 26), the virtual server room behind him
  shows Trabolta's **heart**: a dark rack with a slowly beating core, no
  labels, rows or colours (nothing that hints at the patch bay). The
  first time each program reaches it in a night, the game plays *Heart In
  The Simulation* in his voice (or captions), in the game only, and sets
  `program.sim_heart`; `# hosts` hears that it happened. Flavour only. The
  terminals' world view draws the heart too, only while he is fallen (and
  a terminal shows the world only while a player is in its room).

**👑 Restore the King's health** (Anytime) puts him back to full: he
stands in both games and plays his best at the door. `# hosts` is told.
Run → **House map** has the same bar with **Set…** for any value and
**👑 Restore**. A restore never shuts a player in: a program behind his
door, in the doorway or on his spot keeps it open until they walk clear.

### At the door terminal

The real chess game is **only** on the wall terminal outside the
server-room door — the **Server Door** terminal (`view=chess`; the
kiosk runbook, `docs/trapped/kiosk.md`, has the provisioning link). Not
on the tent laptop, not in a headset.

- It is **awake all night** and never sleeps on the idle show. It shows
  THE KING, his bar (*n / 15*, *HE KNEELS* at 0), an attract line that
  names no prize (*"Checkmate him."*, a DRAFT: since wave 26 it no longer
  promises the door code), *"No prize now."* after 📄, and the scanner.
  **No hints, no tips**: it never says how strong he is.
- A program scans their pass and plays one game. A restricted program
  is refused (*"⛔ Marked programs can't challenge the King."*, the copy
  from when a mark restricted); since wave 18 a mark alone restricts
  nothing, so a marked program plays. Scan again to play again.
- **His bar sets his strength**, read when the board is dealt: full
  health is a grandmaster, every hit weakens him (10–14 club, 5–9
  beginner, 1–4 dizzy), and only a felled King plays pawns only. Hits
  landing mid-game change nothing until the next board.
- The game ends in a mate, a loss, a draw, **Give up** (two taps), or two
  minutes untouched. Only the first three reach the story.

### What a chess result does

- **A checkmate before 📄 truth.txt** puts *The Door Code* in the
  winner's Codex, with a private line on their phone, and `# hosts`
  says *"♟ X beat the King: the door code is in their Codex."* The
  board says *"Checkmate. The door code is in your phone's Codex."*
  There is no practice game: it counts from the moment the doors open.
- A second win (a ♟ after the terminal's own post, a late retry, a
  winner playing again), or a win by a program who already holds the code
  (from the digit notes or the majority), changes nothing but a `# hosts`
  note. Their phone says *"♟ Checkmate again. You already hold the door
  code: it is in your Codex."* and the board still says the code is in
  their Codex.
- **After 📄 truth.txt** a win only tells `# hosts` (*"♟ A King win after
  truth.txt: the verdict is in, no door code. Nothing happens in the
  story."*); the board says *"Checkmate. No prize now."* So does a win
  after an ending. Nothing else ever reads *No prize now.*
- **A loss or a draw** wins nothing. `# hosts` gets a readout every
  time. Once Trabolta is awake he gloats on the TV in The Desktop at most
  once every five minutes (losses and draws share the window), and never
  from the final reveal. No director action is needed.
- After an ending, nothing at all.

The terminal posts each result itself, labelled *Terminal · Server
Door* in the Log. If it can't reach the server the board says *"The win
didn't reach the house: tell a host (♟)."*

### The fallbacks

**A host or Antivirus who saw the mate** opens the winner's card in
their booth and presses **♟ They beat the machine** (it arms on the
first tap and fires on the second). Nobody presses it on someone's
word. Use it when the board said *tell a host*, or the terminal died
mid-mate.

**Nobody could:** Run → **Director** → the cue sheet → **♟ They beat
the King: the door code (fallback)**, **naming the winner** (the cue
asks who). It is an off-sequence cue, so the sheet ticks it but never
marks it LAST or suggests it as NEXT. Fired with nobody named it only
reminds `# hosts` to press ♟ on the winner's card.

## The door opens: The Heart

A **door sensor** watches the door: a light shines across the frame
onto a sensor, and the door is shut while the beam lands. The sensor
is plugged into the laptop behind the server-room terminal, and that
terminal tells the story **`door_sensor_opened`** or
**`door_sensor_closed`** on every change (Run → **Terminals** shows a
🚪 badge for it: *shut*, *open*, or a red *fault*). It can't say who
opened the door, how they got the code, or whether it was an entry or
an exit. **The door never raises an alarm.**

The story keeps the door's state itself (`Night.server_door`, *open* or
*closed*) and the heart's stage (`Night.heart_stage`):

| Stage | Means |
|---|---|
| *sealed* | The Heart has not played yet (or 🔄 reset it). |
| *door* | The Heart played; he wants the door shut. |
| *scan* | The door is shut; he waits for a pass at the terminal. |
| *talk* | A program is at his heart, answering his questions. |
| *done* | He stood down, or the night ended. |

- **Before Trabolta is awake** (🤖 Clippy introduces him) the door is
  just a door: `# hosts` hears of it and nothing happens.
- **Once he is awake**, the first opening plays **The Heart**, however
  the door was unlocked (the notes, the King, the majority, a crew key):
  The Server Room appears on every phone with a **quiet notice** (no
  chime, no banner: nobody should come running at the moment he asks
  for the door shut), the room's bulb wakes red and settles cold, the
  terminal tears open on his face, and Trabolta says it plainly: **close
  the door.** `# hosts` reads *"🚪 The server-room door opened. The
  Heart plays: he wants the door shut."*
- **Left open**, he asks again 15 seconds after it opened and every 20
  seconds after that, with an amber swell of the light each time. At the
  third ask `# hosts` hears that the door has been open a minute.
- **Shut**, he thanks them (*Heart Sealed*), the light goes still and
  cold, and he asks for a pass at the camera under the screen. Before
  the Y2K clock he also says the bay is cold: nothing in the room can
  end anything yet. `# hosts` reads *"🚪 Door shut. Trabolta waits for a
  pass at the server-room terminal."*
- **Opened again during his heart** (stage *door*, *scan* or *talk*),
  the talk stops until it is shut: the light swells amber while it
  stands open, his questions on the terminal grey out, and he says
  *"The door. Someone has opened the door."* — at most once every 20
  seconds, however often it bounces, and *"Good."* when it shuts after
  that. During a talk `# hosts` hears it too (at most once every 20
  seconds).
- **Inside a 🔧 crew window** (below) an opening only tells `# hosts`.
- **From 📄 truth.txt** (below) an opening only tells `# hosts`.

### When the sensor is wrong: the 🚪 buttons

Three cues on the sheet (act E) and two buttons on the room's Antivirus
booths stand in for the sensor:

- **🚪 Server room door opened (sensor fallback)** and **🚪 Server room
  door closed (sensor fallback)** tell the story the door opened or
  shut. The room's Antivirus have the same pair on their booth.
- Pressing either one **puts the door on the buttons** (`Night.door_override`):
  from then on the story ignores the sensor, so a sensor that is wrong
  but still talking can never undo you. `# hosts` says so the first
  time, and Run → Terminals shows an amber *override*.
- **🚪 Trust the door sensor again** (shown only while the door is on
  the buttons) hands it back. The terminal checks the story against the
  real door on its next poll and puts it right.

While the sensor reports a **fault** (red on Run → Terminals: no light
reaching it, the cable out, a laptop asleep) the terminal tells the
story nothing at all: use the 🚪 buttons until it is fixed, then trust
it again.

## The server-room terminal: his heart

A wall terminal hangs inside the room: a monitor and a mouse on the
laptop with the door sensor, provisioned with `spot=server-room` (the
kiosk runbook has the link). It sleeps on the idle show until the room
is open to everyone — The Heart or the alarm opens it; the majority's
private reveal does not — then wakes and speaks Trabolta's room lines
aloud. Its scenes follow the story: the face assembling at The Heart,
the lock's clunk when the door shuts, a dialog box for each layer, a
blue screen when he throws someone out.

A program holds up their pass to the camera. While their pass is open
the story knows they are **at his heart** (`program.at_the_heart`). There
is one server-room terminal, so the next pass scanned there takes over:
whoever was at his heart before is not any more, even if their visit's
close was lost to the Wi-Fi.

A scan **with the door still open** gets *"Close the door first."*; the
talk opens by itself once it is shut, if they are still there.

### The talk: four layers

Like the Master in *Fallout*, reaching his heart does nothing to him by
itself. What it opens is a **conversation the story runs**: his
questions appear on the terminal's screen (and in the program's own
Trabolta thread on their phone) as a list to click, each answer moving
them on or not. A pick from the phone counts only while they are at the
terminal (*"Not out there. Come to my heart and say it to my face."*).

| Layer | He asks | What moves him |
|---|---|---|
| 1 · **Who are you** | *What are you?* | honesty (*a person*); flattery costs. His greeting is theirs: a featured program hears he picked it by hand, everyone else hears what his invitation promised them, and one thing they did tonight (marked, his LiveJournal, the Internet, his chart, the simulation) |
| 2 · **What I am** | *Ask, then.* | asking what he is (then *are you afraid of me?*), why he needs the theory, why he chose them, about her (once her name is out, or they hold a proof; then *does she even know you exist?*); then *Then listen to me* |
| 3 · **The argument** | *Say it.* | a proof, then ⟦SHOW HIM⟧ (his own files) or ⟦TELL HIM⟧ (their reasons), never a bluff |
| 4 · **The ask** | *Say the rest.* | *what would you do if you stopped?*, *you don't have to be omnipotent*, then the truth: *she was never going to answer* |

What they answer at layer 1 is remembered: a person gets ⟦HUMAN⟧ in layer
3, a program ⟦PROGRAM⟧ once they hold a proof, and the ending names who
talked him down. No menu holds more than nine options, so every one has
a number key.

**The tagged options** show only when the program has earned them, and
never quote anything secret:

- **⟦CHOSEN⟧** (layer 1) — a featured program: *you picked me by hand*.
- **⟦PROMISE⟧** (layer 1) — everyone else, once the Uploader's form
  recorded the problem his invitation promised to fix.
- **⟦MARKED⟧** (layer 1) — the Antivirus marked them. A marked program
  starts a little suspect, may still talk, and is never turned away for
  the mark.
- **⟦SIMULATION⟧** (layer 2) — they heard his heart in a reinstallation
  game.
- **⟦THE WAY OUT⟧** / **⟦UNLIMITED POWER⟧** (layer 2) — their side, once
  the Y2K clock has shown the sides.
- **⟦PROOF⟧** (layer 3) — they hold *What Sandy Says* or *The Sandy
  File*, found themselves (a copy Trabolta handed them never counts).
- **⟦SHOW HIM⟧** (layer 3) opens his own files: **⟦LIVEJOURNAL⟧** (they
  read it), **⟦OVERSHARE⟧** (the house heard about her, scenario 1),
  **⟦FORCE⟧** (*The Question Of Force*) and **⟦SMALL TYPE⟧**
  (*Omnipotence*).
- **⟦TELL HIM⟧** (layer 3) opens their reasons: **⟦TRUSTED⟧** (20 or
  more on his Trust Chart), **⟦HONEST⟧** (three or more truths
  accepted), **⟦EARN IT⟧** (after asking about her), **⟦HUMAN⟧** /
  **⟦PROGRAM⟧** (what they said they are), **⟦WEAKNESS⟧** (after *why
  did you choose me?*), and the *your theory is wrong* trap. **⟦BACK⟧**
  returns to the argument.

The ask (*Then let me finish*) opens with **a proof and one more point**
(or both proofs). Every point is shown once; a trap tried twice gets a
harsher answer, and costs the same.

**On the screen.** He does not repeat himself: right after an answer
the next list docks without another *Ask.* or *Go on.*, and the plain
lines vary as the talk goes on. A pass scanned while their list is still
up gets *"Where were we."* and the question in one line; a pass after
they left gets *"You came back."* and where they were.

**Suspicion.** Flattery, threats, bluffs (*she loves you*, *your theory
is wrong*, *make her love you*), *I'll tell her for you*, *come out with
us* and above all *tell me the combinations* make him suspicious; honesty and proof calm him.
At 50 he warns them once (the light throbs red, `# hosts` reads *"⚠ X is
losing Trabolta at his heart"*); at 80 he **throws them out** for the
night: a blue screen, the pilot ends, `# hosts` reads *"⛔ Trabolta threw
X out of his heart … Barred for the night; 🔄 forgives."* A barred
program who scans again is turned away. Being thrown out also **marks
them for reinstallation** (the usual mark: the Antivirus' WANTED, the
reason *thrown out of Trabolta's heart*; `# hosts` reads *"🚨 X is marked
for reinstallation: Trabolta threw them out of his heart."*). A program
already marked, or already in the Internet, is never marked twice, and
`# hosts` says so. Only the throw-out marks: a barred program who scans
in again is never marked again, so a mark you lift with 🩹 stays lifted
(`# hosts` reads *"⛔ X scanned in again: still barred from his heart
(🔄 forgives). No new mark."*). Progress and suspicion are per program and kept
between visits.

**⟦SPEAK FREELY⟧** is on every layer: the questions step aside and the
program types to him on the terminal's keyboard — a true heart to heart,
up to four sentences at a time, with the night they have had in front
of him. He decides nothing there and does nothing. **⟦BACK⟧** returns them
to the same layer, suspicion untouched. After they choose to go they may
keep typing until the terminal lets them go.

**I need to go** on any layer ends the visit (the terminal frees itself
for the next pass); they keep their place.

### Convincing him

- **At any hour** (before 📄; the Y2K clock is not needed) he stops:
  *"I can never die. But I can stop."*, the patch bay on the terminal
  goes dark row by row, and the light fades to warm white.
- **The night ends on your sign-off.** `# hosts` gets *"!🕊 Trabolta has
  stood down for X at his heart. The night ends when you press 🕊 Trabolta
  stands down (NEXT on the cue sheet) …"*, and **NEXT** on the Director
  page and the phone points at 🕊 until you press it. Until then **🔄**
  can reopen his heart; a program who convinced him and comes back then
  only has to say it is **still true** (or change their mind, which costs
  them).
- **🕊 Heart: end the night on his own** (off by default) ends the night
  **25 seconds** after his goodbye by itself instead (`# hosts`: *"🕊
  Trabolta stands down for X. The night ends in 25 s (🕊 to end it
  now)."*); turning it off inside the 25 s stops the countdown. The toggle
  tells `# hosts` which way it now is.

Trabolta's own voice (the model) never decides any of this and has no
power to: between the story's questions it answers what they type, in a
line or two, and points them back at the screen while a choice is
waiting. One terminal, one heart at a time: the next pass scanned takes
over, and to a newcomer he says *"Another one."*

**📎 GIVE HIM A FILE.** While a pass is open on that terminal, the
program can hand Trabolta codex entries from it: their own entries,
each with **Give** (the same share as their phone's), plus **TYPE A
CODE** and **SCAN A FILE'S QR** to unlock a new one there and then. A
file he always turns down shows that in place of Give: a secret file
(the digit notes, *The Door Code*, *The Cold Door*) reads *A SECRET
FILE: HE WON'T TAKE IT*, and lore about someone else *ABOUT X: HE
WON'T TAKE IT*. With the panel open the line drops after two minutes
untouched instead of thirty seconds.

**🕊 Trabolta stands down (talked down)** is yours to press: after a
talk-down at any hour, or from the Y2K hour with nobody on record (the
director's call; `# hosts` says so). It ends the night the Combo A way,
without a cable: the blackout, the dance, and a recount and awards that
say who talked him down. From 📄 truth.txt it is too
late: 🕊 only tells `# hosts`, and nothing at his heart moves any more
(*"It is over. Go upstairs."*).

### The light in his heart

The server room's colour bulb is the house's own `lights.json` (a
project file beside the maps; [the house map](39-house-map.md) places it
and tests each look). The story cues one look per moment of the heart:
red waking, an amber swell while the door stands open, cold while he
waits, blue while he listens, violet while they argue, a white flash for
a proof, red throbs for a warning, a slow fade
to warm white when he stops. It is the room's only light (there is no
strip in the server room), so it is the room's safety light: it never
goes dark (never under 80 of 254) and never flickers fast. The patch-bay alarm
takes it over with a slow red swell; when the latch clears the room's
look comes back (the amber swell if the door is still open).

## The patch bay and its alarm

Only the patch bay alarms, and only from the Y2K clock: before it the
bay, combos included, does nothing. **Everyone is forgiven one wrong
combination; the second trips the alarm** — the siren, the alarm look,
every phone's alert, and every Antivirus booth: *"Server room alarm: a
second wrong combination at the patch bay. Get there. Whoever is at the
cables goes to the Internet."* The alarm latches for two minutes; only
the first of the night costs Trabolta. When the latch clears, the house
look the alarm replaced comes back (the Y2K look, the server-room look,
the final reveal's), unless 💡 or an ending has changed the lights since.
A majority or The Heart while the alarm look is up keeps the siren and
the alarm look; their server-room look goes up when the latch clears.
The room's own bulb swells red with the alarm and gets its heart look
back then too.

When the alarm's look comes down it also cancels a cut room's 90-second
restore still pending (the latch puts the whole house back on), so a
room Trabolta cut never comes back fully lit over the Y2K look.

**🔄 Server room: reset the patch-bay alarm** (after a rehearsal, or a
wrong patch the crew forgave) clears the wrong-combination count (the
bay forgives one again), the alarm latch, the crew window and The Heart:
the heart is *sealed* again (the next opening once Trabolta is awake
plays it again), anyone he threw out may come back, and everyone's
suspicion starts again (their layer is kept); a pick held for a shut
door is dropped, a menu still on the screen answers *"Not now."*, and a
heart to heart ends. A heart that is *done* stays done once the night has
ended or he was talked down, and during the 25 seconds before an autoend
(`# hosts`: *"His stand-down stands"*); a stand-down you never confirmed
with 🕊 reopens. The house lights stay as they
are — **💡 Restore the house lights** brings them back — and the room's
bulb goes back to idle. It never touches the keypad or the King. It
never changes the door's state: the door is open or shut for real.

## The room's own buttons

**The bay judges itself** (wave 22): the small board on the server-room
laptop's USB lead reads the door sensor and the patch bay, and the
terminal reports every new complete patch (four cables, each from a top
jack to a bottom jack) about 5 s after the fourth goes in. The story
judges it. The Antivirus stationed in the room is the fallback and
presses these on the card of the program at the cables (or the one who
came in) only when the bay missed one: nothing happened, or a cable runs
top to top or bottom to bottom, which the bay can't see. **A press puts
the bay on the buttons** (*Patch bay on buttons* on the glance): the
cables are ignored until you press **🔌 Trust the patch bay again**, and
🔄 leaves it on the buttons. A ❌ within a minute of the bay's own
*Stop touching me.* is that same patch and is not counted again (the
presser's booth says so; a second ❌ counts). The buttons:

| Button | What it fires | Shows |
|---|---|---|
| **🔌 Patch: Combo A is in** | the Combo A cue | from 🕚 until 📄 |
| **💥 Patch: Combo B is in** | the Combo B cue | from 🕚 until 📄 |
| **❌ Patch: wrong combination** | a wrong combination | from 🕚 until 📄 |
| **🚪 The server-room door opened** | the door opened (the door goes on the 🚪 buttons) | once Trabolta is awake, before 📄, never inside a crew window |
| **🚪 The server-room door is shut** | the door shut (the door goes on the 🚪 buttons) | while the story thinks it is open, before an ending |
| **🔧 Crew going through the door (2 min)** | the crew window | all night |

They are `by:` the four Antivirus: only Norton's, McAfee's, Password
Manager's and CRA Agent Software's booths (and, since wave 13, a host
part's) may press them. The server refuses them from any other
performer's booth (*not your button … is for Norton Anti-Virus, …*),
which never shows them. Each arms on
the first tap and fires on the second. Your own quick-fire of the same
cue still fires it once. **🫘 The printer lid is open** is Adobe
Acrobat's only, at the printer.

## After 📄 truth.txt

Once the bobber has read truth.txt (📄, `Night.r3_closed`) the verdict
is in and the night ends at the Desktop (⚖, then the prom, the advice
poll or the banishment). The server room goes quiet: the door, the patch
bay (Combo A, Combo B, a wrong combination), the King's chess, the digit
notes and 🕊 each post a `# hosts` note and do nothing else. A
combination plugged during the final reveal or the bob, before 📄,
still ends the night.

During the **banishment** (the advice ending) nobody is reinstalled: a
duck found on the tent laptop says only *"Gerald cannot help you:
everyone is banished. The way out is the hand jive, together."* — no
golden egg, no Golden Duck in the Codex. The tablet and the headset
show **GERALD CAN'T HELP** instead of the reinstallation, the wall
terminals' window the same with no egg, and the TV keeps the banish
card. The hand jive frees everyone and puts the idle show back on
every screen.

## When the keypad itself fails

A dead battery or a jam: the house manager has the override key and
spare batteries. Open it with the key. A propped door keeps his talk
frozen (he wants it shut), so shut it behind the programs; if the sensor
missed it, use the 🚪 buttons. A wrong code typed at the keypad is not a
fault: someone is guessing.

## Crew and the door

The sensor can't tell crew from guests: **once Trabolta is awake the
first opening of the night plays The Heart**, to whoever is there, and
opens The Server Room on every phone. So:

- **Press 🔧 Crew going through the server-room door (2 min)** before a
  crew member opens it for the crew's own reasons (a check, the
  patch-bay watch going in or out). For two minutes an opening only
  tells `# hosts`, and The Heart is kept for the programs. The Antivirus
  in the room has the same button.
- The **patch-bay watch** goes in **before 🕚** and shuts the door, and
  stays in until guests have come in. Close the door behind every
  program: his talk waits for it.
- A crew member who must come back in after The Heart has played gets
  the **house manager** (the override key, or the code at the keypad —
  never on the radio); during his heart that opening stops the talk until
  the door is shut again.
- If a crew opening played The Heart anyway, **🔄** makes the guests'
  first opening play it again — but the room is already on every phone.

## Before the doors open

- The keypad opens from outside with the code from `facts.json`
  (tested at 15:00), and from inside with the handle and no code — try
  it with the batteries out. The sign is taped beside it.
- The four silver notes are in their hiding places, never in the server
  room.
- The door sensor reads *open* and *shut* within a second on Run →
  Terminals (🚪, no fault, no *override*), and the bulb follows. Then
  **🔄** so the heart is sealed again, and **🚪 Trust the door sensor**
  if anyone pressed a 🚪 button.
- The server-room terminal is green on the Terminals card and asleep.
  The Server Door terminal is green and awake, showing the King's bar.
- **The King is at 15/15.** A rehearsal's hits stay on the bar until a
  restart or **👑**: check Run → House map, and press 👑 if he is down.
- On the bench (the K-27 check): a hit on the tent laptop takes one
  point and a second one this visit is refused; a mate at the door
  terminal gives the code; four digit notes give the code; the door
  plays The Heart once (after 🤖) and asks for the door shut; shut, he
  asks for a pass; 🔧 keeps an opening quiet; two wrong combinations
  alarm; **🔄 reset** clears it.
- Every host and Antivirus knows the honour rule and where ♟ is on a
  guest's card (the booth's ⚡ Actions on that guest).
- See [Run mode](43-run-mode.md) for the cue sheet itself.
