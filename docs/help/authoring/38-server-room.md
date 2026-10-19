---
title: Running the server room — the keypad door, the King and Trabolta's heart
section: Live Shows
order: 38
keywords: server room, marked, keypad, keypad lock, door code, code, digit, digits, digit notes, notes, clue, clues, silver, cold door, The Cold Door, the King, king, chess, chess terminal, door terminal, Server Door, health bar, shared health, hit, kneel, kneels, fallen, restore, restore the king, simulation, chess won, chess lost, chess drawn, king hit, king fallen, beat the machine, door, door contact, cutscene, The Heart, heart, server-room terminal, terminal, file panel, give him a file, talk down, talked down, stand down, Fallout, Master, patch bay, alarm, wrong combination, reset, latch, crew, crew window, fallback, honour, OP-12, truth.txt, verdict, banished, banishment, hand jive, Windows Defender, Trapped in the Internet, runbook, cold lock
---

In *Trapped in the Internet* Trabolta's heart — a video patch bay — sits
behind the **server-room door**, and that door has a real **keypad
lock**. Whoever opens it with the code gets in, whoever they are; nobody
is "breaking in". This page is the director's side of the room: how a
program gets the code, the King and his chess terminal, what happens
when the door opens, the terminal inside where a program talks to
Trabolta, the patch-bay alarm, and the buttons that fix each of them.
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

In both reinstallation games (the tent tablet and the headsets) he
stands in the server-room doorway of the virtual basement hall, with his
bar over his head. The chevrons never lead to him; the duck is
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

**👑 Restore the King's health** (Anytime) puts him back to full: he
stands in both games and plays his best at the door. `# hosts` is told.
Run → **House map** has the same bar with **Set…** for any value and
**👑 Restore**. A restore never shuts a player in: a program behind his
door, in the doorway or on his spot keeps it open until they walk clear.

### At the door terminal

The real chess game is **only** on the wall terminal outside the
server-room door — the **Server Door** terminal (`view=chess`; the
kiosk runbook, `docs/trapped/kiosk.md`, has the provisioning link). Not
on the tent tablet, not in a headset.

- It is **awake all night** and never sleeps on a screensaver. It shows
  THE KING, his bar (*n / 15*, *HE KNEELS* at 0), what a win is worth
  (*"Checkmate him and the server-room door code goes to your Codex."*,
  or *"No prize now."* after 📄) and the scanner. **No hints, no tips**:
  it never says how strong he is.
- A program scans their pass and plays one game. A marked program is
  refused (*"⛔ Marked programs can't challenge the King."*). Scan again
  to play again.
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

A door contact (two wire loops that touch when the door opens) tells
the story `server_door_opened`. It can't say who opened it, how they got
the code, or whether it was an entry or an exit. **The door never raises
an alarm.**

- **Before Trabolta is awake** (🤖 Clippy introduces him) the door is
  just a door: `# hosts` hears of it and nothing happens.
- **Once he is awake**, the first opening plays **The Heart**, however
  the door was unlocked (the notes, the King, the majority, a crew key):
  The Server Room appears on every phone, the server-room lights come up
  (while the patch-bay alarm's look is up they wait, and the alarm's
  latch puts them up when it clears; after 💡 they come up at once),
  `# hosts` reads *"🚪 The server-room door opened. The Heart plays on
  the server-room terminal."*, and Trabolta speaks to the room —
  candidly, for once. Before the Y2K clock he adds that the bay is cold
  and answers nobody yet.
- **Another opening within two minutes of the last** (the group filing
  in, someone stepping out) does nothing but restart the two minutes. A
  later one gets a short *"Back again"* line.
- **Inside a 🔧 crew window** (below) an opening only tells `# hosts`.
- **From 📄 truth.txt** (below) an opening only tells `# hosts`.

If the door opened and nothing happened (a loop came loose: a broken
contact is silent), fire **🚪 Server room door opened** from the cue
sheet. It is the same signal. The Antivirus in the room has the same
button on their booth (on any program's card).

## The server-room terminal: his heart

A wall terminal hangs inside the room, provisioned with
`room=The Server Room` (the kiosk runbook has the link). It sleeps on
its screensaver until the room is open to everyone — The Heart or the
alarm opens it; the majority's private reveal does not — then wakes,
speaks Trabolta's lines in that room aloud, and works like any terminal:
a program holds up their pass and talks to him on their own thread.

While they do, the story knows they are **at his heart**
(`program.at_the_heart`; the terminal tells it when the visit starts and
ends, and any ending clears it). There is one server-room terminal, so
the next pass scanned there takes over: whoever was at his heart before
is not any more, even if their visit's close was lost to the Wi-Fi (the
terminal also re-sends a close that didn't land, before its next line
and on its next boot).

**Getting in doesn't stop him.** Like the Master in *Fallout*, reaching
his heart lets you do nothing to him by itself. What changes is
Trabolta: at his heart, whenever he is awake, he drops the act. He
admits the patch bay is his heart, admits he doesn't know the
combinations or the code, and says what he wants and why.

**A marked program at his heart.** A program the Antivirus marked for
the Internet can still use the terminal. At his heart Trabolta sees the
mark (`marked` is in his persona's `them:`), says so once, and asks why
they were marked: he doesn't know, and he is wary (bait sent by the
house, or a fellow prisoner?). An honest answer raises his regard; a
dodge or the Antivirus' story lowers it. He stays candid, still takes
their files, and talking him down applies to them as to anyone; he
never refuses them, threatens them or sends them away. Away from his
heart no extra block is added for the mark.

**📎 GIVE HIM A FILE.** While a pass is open on that terminal, the
program can hand Trabolta codex entries from it: their own entries,
each with **Give** (the same share as their phone's), plus **TYPE A
CODE** and **SCAN A FILE'S QR** to unlock a new one there and then. A
file he always turns down shows that in place of Give: a secret file
(the digit notes, *The Door Code*, *The Cold Door*) reads *A SECRET
FILE: HE WON'T TAKE IT*, and lore about someone else *ABOUT X: HE
WON'T TAKE IT*. With the panel open the line drops after two minutes
untouched instead of thirty seconds.

**Talking him down** is the Y2K hour's only (`Night.step >= 14`, before
📄). A program who **shows him that what he wants is impossible** can
talk him down. He then fires his `stand_down` power — but it only
**offers**: the story checks the evidence itself (the program must hold
*What Sandy Says* or *The Sandy File*, and not because Trabolta shared
it with them: a proof he hands over never counts), and on success
`# hosts` gets an alert, *"🕊 Trabolta offers to stand down for X.
Press 🕊 to end it."* Every refusal is words only and spends nothing;
before the Y2K hour he says the function isn't available yet. He offers
once a night, and after that only says he has offered (🔄 does not
clear an offer; 🕊 works whenever you decide).

**🕊 Trabolta stands down (talked down)** is yours to press. It ends the
night the Combo A way, without a cable: the blackout, the dance, and a
recount and awards that say who talked him down. Pressed with no offer
on record it still works — the director's call — and `# hosts` says so.
From 📄 truth.txt it is too late: 🕊 only tells `# hosts`, and Trabolta
refuses to stand down (*"The truth has been read. It is too late for
that now."*).

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

When the alarm's look comes down it also cancels a cut room's 90-second
restore still pending (the latch puts the whole house back on), so a
room Trabolta cut never comes back fully lit over the Y2K look.

**🔄 Server room: reset the patch-bay alarm** (after a rehearsal, or a
wrong patch the crew forgave) clears the wrong-combination count (the
bay forgives one again), the alarm latch, the crew window and The Heart
(the next opening once Trabolta is awake plays it again). The lights
stay as they are — **💡 Restore the house lights** brings them back. It
never touches the keypad or the King.

## The room's own buttons

The Antivirus stationed in the room presses the hardware fallbacks
there, on the card of the program at the cables (or the one who came
in), instead of radioing you:

| Button | What it fires | Shows |
|---|---|---|
| **🔌 Patch: Combo A is in** | the Combo A cue | from 🕚 until 📄 |
| **💥 Patch: Combo B is in** | the Combo B cue | from 🕚 until 📄 |
| **❌ Patch: wrong combination** | a wrong combination | from 🕚 until 📄 |
| **🚪 The server-room door opened** | `server_door_opened` | once Trabolta is awake, before 📄, never inside a crew window |
| **🔧 Crew going through the door (2 min)** | the crew window | all night |

They are `by:` the four room Antivirus: only Norton's, McAfee's,
Password Manager's and CRA Agent Software's booths may press them. The
server refuses them from Windows Defender's (the door-only part), a
Host's or any other performer's booth (*not your button … is for Norton
Anti-Virus, …*), which never shows them; Windows Defender's booth still
shows ♟ *They beat the machine*. Each arms on
the first tap and fires on the second. Your own quick-fire of the same
cue still fires it once. **🫘 The printer lid is open** is Adobe
Acrobat's only, at the printer.

## After 📄 truth.txt

Once the bobber has read truth.txt (📄, `Night.r3_closed`) the verdict
is in and the night ends at the Desktop (⚖, then Grok Prom, the advice
poll or the banishment). The server room goes quiet: the door, the patch
bay (Combo A, Combo B, a wrong combination), the King's chess, the digit
notes and 🕊 each post a `# hosts` note and do nothing else. A
combination plugged during the final reveal or the bob, before 📄,
still ends the night.

During the **banishment** (the advice ending) nobody is reinstalled: a
duck found on the tent tablet says only *"Gerald cannot help you:
everyone is banished. The way out is the hand jive, together."* — no
golden egg, no Golden Duck in the Codex. The tablet and the headset
show **GERALD CAN'T HELP** instead of the reinstallation, the wall
terminals' window the same with no egg, and the TV keeps the banish
card. The hand jive frees everyone and puts the screensaver back on
every screen.

## When the keypad itself fails

A dead battery or a jam: the house manager has the override key and
spare batteries. Open it with the key, prop the door, and fire **🚪** if
The Heart has not played. A wrong code typed at the keypad is not a
fault: someone is guessing.

## Crew and the door

The contact can't tell crew from guests: **once Trabolta is awake the
first opening of the night plays The Heart**, to whoever is there, and
opens The Server Room on every phone. So:

- **Press 🔧 Crew going through the server-room door (2 min)** before a
  crew member opens it for the crew's own reasons (a check, the
  patch-bay watch going in or out). For two minutes an opening only
  tells `# hosts`, and The Heart is kept for the programs. The Antivirus
  in the room has the same button.
- The **patch-bay watch** goes in **before 🕚** and shuts the door, and
  stays in until guests have come in.
- A crew member who must come back in after The Heart has played gets
  the **house manager** (the override key, or the code at the keypad —
  never on the radio); that opening is just *back again*, or nothing
  within two minutes of the last.
- If a crew opening played The Heart anyway, **🔄** makes the guests'
  first opening play it again — but the room is already on every phone.

## Before the doors open

- The keypad opens from outside with the code from `facts.json`
  (tested at 15:00), and from inside with the handle and no code — try
  it with the batteries out. The sign is taped beside it.
- The four silver notes are in their hiding places, never in the server
  room.
- The door contact reads open and shut in the stagehand log.
- The server-room terminal is green on the Terminals card and asleep.
  The Server Door terminal is green and awake, showing the King's bar.
- **The King is at 15/15.** A rehearsal's hits stay on the bar until a
  restart or **👑**: check Run → House map, and press 👑 if he is down.
- On the bench (the K-27 check): a hit on the tent tablet takes one
  point and a second one this visit is refused; a mate at the door
  terminal gives the code; four digit notes give the code; the door
  plays The Heart once (after 🤖), stays quiet for two minutes, then
  says *back again*; 🔧 keeps an opening quiet; two wrong combinations
  alarm; **🔄 reset** clears it.
- Every host and Antivirus knows the honour rule and where ♟ is on a
  guest's card (the booth's ⚡ Actions on that guest).
- See [Run mode](43-run-mode.md) for the cue sheet itself.
