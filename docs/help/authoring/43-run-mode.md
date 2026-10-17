---
title: Run mode — rehearse, go live, be anyone
section: The Editor
order: 43
keywords: run, rehearse, rehearsal, live, go live, launch, deploy, event, cockpit, persona, choices, named events, identity, lens, be, view as, composer, quick fire, world, roster, stage, moderate, co-writer, director, push draft, restart, end, log, export, code, QR, join, passcode, lookup, scratch, private, print, poster, check-in sign, rotate, staff codes, terminals, heartbeat, silent, chime, TV voice, cue sheet, cue, next, ceremony, award, recap, re-pair, lost phone, release, grant codex, give quest, complete quest, fail quest
---

Run (`⌘2`) is the control room for your project's **one run**. You
start it from the Run page: **▶ Start rehearsal** (or, on a server
project, *Go live with real guests* straight away).

- On a **server project** the rehearsal runs on the server and every
  co-writer on the project lands in the *same* run the moment they open
  Run — the shared rehearsal. Amber accents everywhere remind you it is
  a rehearsal.
- On a **local folder** the rehearsal runs in this browser (violet
  accents). Nothing reaches anyone else. Hosting a live event needs a
  server project.

Either way: a persona named after you joins, the story's `start:` beat
plays, its choices dock in Chat, and the story map lights up as you go.

Two things only the server does. A local-folder rehearsal has **no
judge**: a filed `fact` card's `fact answered` arrives with no `verdict`
(write the rule's `else:` to say so — *could not be judged*), and the
Judging card on the Mind page explains rather than judges. It has **no
wallet** either: a story that declares a `currency:` shows the plain ⭐
score and no Wallet room in the browser. Rehearse the hunt and the
wallet on a server project ([cards & widgets](widgets.md),
[currency](currency.md)).

## The header

Every page shares one header:

- **The run pill** — which world your actions land in: `local ·
  in-browser`, `shared rehearsal`, or `live event`, with the phase and
  how long it has been going.
- **Pause / Resume**, and a **↺ Restart ▾** menu: *Restart this draft*
  (same text, from the top), **⇪ Push current draft** (restart on the
  project's current text — the button turns amber the moment your files
  move past the running snapshot), **Go live…** (server rehearsals), and
  **■ End**. On a live event the destructive ones ask you to type the
  event code first; a wrong code says *Nothing changed* and does nothing.
- **👁 The identity control** — who you are right now (see *Being
  anyone*).
- **⚡ Quick-fire** — fire any named event the story declares, from any
  page.
- **⏳ N** — pending decisions across the run; click to answer them in
  Chat.

A banner under the header tells you when a co-writer restarted, pushed
a draft, went live, or ended the run — and who.

## The Run page

Front of house: getting people in.

- **Join** — the guest **event code** (and its QR + link), the
  **performer code**, and the **moderator code**, with copy buttons, plus
  a sign-in line per performer part to hand to each performer (only the
  parts a booth can sign in to: never a guest's program, a prop or an
  agent). A part whose phone dropped off without signing out reads
  **signed in · phone offline** in amber: the moment for ⏏ Release. These codes
  work during the rehearsal (anyone with the event code can join it) and
  **stay the same when you go live** — and when you end the run and start
  a new one, since codes belong to the project — so you can print them
  early. If a performer or moderator code leaked (shared at rehearsal,
  typed into a terminal), end the run and tick **New performer +
  moderator codes** under ▶ Start rehearsal before you start the next one:
  those two codes change and the guest code doesn't, so the join poster,
  door sign, codex posters and room signs stay good — but every printed
  **cast card** carries the old performer code and stops working, so
  reprint the cast cards afterwards.
- **🖨 Print sheet…** — everything to print, QRs drawn in the browser:
  the **join poster**, the **door sign** (it says *Scan to join*, or
  *iPhone? Join, then Add to Home Screen* with the steps when the server's
  Home Screen switch is on), one **codex poster** per entry with a code
  (title, QR, the typed code), one **room check-in sign** per place a
  guest can check into (see [live shows](live-shows.md)), and one **cast
  card** per performer part (the performer code's QR: scan, tap 🎭 I'm a
  Performer, then pick the part). When the project has a `facts.json`, the codex posters come in
  stack order (gold hunt answers, then green, blue, red), each with a
  coloured band and its pile and hiding place printed underneath, so you
  can deal them straight into the piles. Tick sections, skip single cards,
  choose 1, 2, 4 or 8 per page; cast cards always print 8 to a page as
  business cards, on a page of their own. A cast card is a performer
  sign-in, so keep them with the cast and never post one.
- **Directing now** — every co-writer with a console open, who started
  the run, and when.
- **Terminals** — every wall terminal and the TV that has checked in,
  with its spot and view. One silent for 20 seconds turns red and the
  editor **chimes** — from any mode, again every minute until you
  **ack** it (**✕** forgets one switched off on purpose). The header's
  📟 pill counts the live ones. The **🔊 TV voice** button mutes the TV
  to captions only (the TV's own 🔊 / `M` key does the same). The mute
  holds through a server restart, a redeploy and Go live in place, and the
  server log says 🔇 at boot when the TV starts muted, so look at this
  button before the doors. Each row
  shows what the tablet reports: **🔇** nobody has touched it yet so it
  can't speak, **💤** its screen is off or another app is on top, its
  battery (red under 20 % and not charging), and its build (amber when
  it isn't the one the others run, or **old build** when it reports none
  at all while the others do: either way, reload it before doors). **identify**
  puts that screen's name and spot full screen for 10 seconds, with a
  chime: install day's "which tablet is this?". A terminal set up with a
  **room** (the show's server-room terminal) sleeps on its screensaver
  until the story opens that room to everyone, and still checks in while
  it sleeps: green and asleep is right before then. Its row says
  **room The Server Room**. A room on any other spot is amber: usually a
  tablet that was the TV once and kept `room=The Desktop`, so it sleeps
  and speaks that room's lines instead of its own. Clear its room in ⚙.
  Since a mod code lists the story's cast before the doors open, a
  terminal's ⚙ can check its character the moment it is set up, and a
  room terminal's room resolves before the doors too: *the story has no
  room called …* means a typo in its `room=`.
- **House map** — when the event has a house map, one button per map
  variant (*Trapped in the Internet*: **Tent** | **Shed**), the one
  playing now highlighted. Press the other to switch every tablet,
  headset and terminal at once; it always asks first, and warns when this
  event's map edits would be dropped (✎ *edited on this event*: save them
  to the project from the map page first). Same switch as the map page's
  **Map:** buttons — see [the house map](39-house-map.md).
- **Look up a guest** — scan a guest's pass QR (or type their id) to
  open them in the Inspector.

Ended a run? The page keeps it: **Export that run** downloads the ledger,
every room's transcript, the roster, and the world state as JSON. The
server forgets a run's ledger once it ends, so an **■ End** from your
console fetches the whole ledger first (for up to 5 seconds) and keeps it.
A run a colleague ended, or one that crashed, leaves you only the events
your console saw: export while it is still running if you need it.

## Going live

**Go live…** promotes the rehearsal in place: the id, codes, and QR are
unchanged; the story restarts from the top; rehearsal personas and
joined phones are removed; performers sign in again with the performer
code. Every director's console switches to the green LIVE chrome. (With
no run yet, the Run page also offers *Go live with real guests* directly.)

## The cockpit pages

| Page | Shows |
|---|---|
| **Run** | start / join codes + QR / directors / guest lookup |
| **Stage** | the floor plan: one card per location with its occupants as chips — **drag a chip between cards to move the guest** (hooks fire). The cast strip's dots: green a performer signed in, amber signed in · phone offline, sky blue an agent-voiced character a stagehand worker is voicing |
| **Chat** | every room the current identity can see, with the composer. A GROUP's own room beside a room of the same name reads `#hosts (side)`: post in the plain one, where the story's readouts land |
| **Story** | the story map, lit by the run ([story graph](story-graph.md)) |
| **Roster** | all guests and the cast — group, location, score, presence, whose persona |
| **World** | the live state browser — a searchable variables table; **double-click any value to edit it live** |
| **Director** | the **cue sheet**, named events (with arguments), beats, broadcasts |
| **Mind** | an agent-voiced character's mind — its arc, drives, brief, the prompts and both models' reasoning, and a control panel ([the mind debugger](44-mind-debugger.md)) |
| **Log** | the raw ledger, event by event — **filter to one participant**; export the run. Events from before this console opened (a reload, a late join) aren't listed: it says how many, and **⤓ Export run** pages the whole ledger off the server |

## The cue sheet

The Director page opens on the **cue sheet**: the story's `who: admin`
interactions in the order they are declared ([buttons in the
app](live-verbs.md)), one click each. A label's leading code
(`C1 · …`, `V4 · …`) is split off as the cue number. The last cue fired
is amber **LAST**, the one the sheet suggests is tagged **NEXT**, and
every cue fired tonight gets a ✓ — the same sheet on every director's
console, and it survives a reload. The header shows the story's
`Night.phase`; the box filters by word.

- **NEXT** is the first cue after LAST that hasn't fired tonight and is
  on tonight's branch. A cue with a `while:` ([live
  verbs](live-verbs.md)) is only suggested while it holds: in *Trapped
  in the Internet* NEXT after 🕚 is 🌑, after the dance it is the
  ending's own cue, after the song it is G1. A `while:` never stops you
  pressing a cue; the story's rule decides what happens.
- A `repeat: true` cue **stays NEXT** while you keep pressing it (📋 once
  per question, 🗜 once per trip).
- A press the story **turns down** counts for nothing: it never becomes
  LAST and never ticks. A show's cues pressed out of turn say why in
  `# hosts` (*🤖 Too early: …*, *⚖ Not yet: 🍎 Bobbing for Truth, then
  📄 truth.txt first.*) and do nothing else; a hardware fallback (🖨,
  🫘, a patch combo) shares its name with the device and stays silent.
- Pressing an **earlier** cue again (a second round, a re-read) never
  moves LAST back.
- An off-sequence cue (`sequence: false`: one a machine fires, a
  hardware fallback, an anytime cue like 💡) ticks when it fires but is
  never LAST or NEXT.

A local-folder rehearsal judges all of this exactly like the server. A
cue that needs a person — an award: every
hook that hears it binds one — has a **who?** picker and an optional
**value** box (read as `{value}`) and fires with that person as the
subject (in *Trapped in the Internet*, **♟ They beat the King** asks who
won, because the door code goes to the winner). On a server run, once the story sets `Night.ended`, the sheet
reads the recap and fills each award's empty **who?** and **value**
with a suggestion — the top of that award's list (the bottom of the
trust list for Least Trusted), rehearsal personas skipped — and shows
`suggested: Ada (82) · tied: Bob` under the row. It never replaces a
pick you made; **↻ awards** re-reads the recap, and **Copy recap** puts
the text block on the clipboard (for pasting into `cast:Trabolta`). For
the numbers behind an award, open
`/e/<event id>/api/mod/recap?format=text` in a tab while signed in: a
paste-ready list of trust, truths and lies accepted, trips to the
Internet, codex, quests, score, codex shares, chess against the King
(won / lost / drawn), Bathroom Mode trips (a count, not minutes), and
who joined each side.

**On a phone.** The same sheet runs in the participant app: open the
event's address with `?role=director`, type the director (mod)
passcode and a name. Each cue is a big button — tap once to arm it, tap
again within 4 seconds to fire. LAST / NEXT are shared with this page,
and the log records each fire as *Phone · <name>*. A press the story
turned down says *Not taken* there, and only an award asks for a value. The guest front page
has no link to it (the participant guide's *The cue sheet on your
phone* has the details).

## Being anyone

The **👁 identity control** in the header switches the whole cockpit
between the **Operator** (the god view, default) and any participant:
your personas, a co-writer's personas, real guests, or a character.

While you are someone, what you see is **exactly what they see** — the
server's own view of them, the same data their phone renders: their
rooms (with the real "can post here" rule), their feed (a guest never
sees a hidden message), their pending choice docked in the room, and the
story's interaction buttons for them. As a **character** you get the
performer's booth: one thread per guest with **📡 Scan** and the
performer interactions, and you speak as the character everywhere. The
booth's own rooms come too, read-only: its **Quest Log**, **Codex**,
**Inbox** and (for the approver) **Wallet**. A wallet card shows what it
is, who pays whom and how much; approve or deny it on the Run page's
Wallet card.

Actions happen *as* them. The World and Director pages and the
Inspector's editors close until you switch back (`Esc`, or pick
Operator) — you are a participant right now, not the director.

Speaking as a **persona** you spawned is just rehearsal. Speaking as a
**real guest** is an explicit act: the composer defaults to the Operator,
you pick their name on purpose, confirm once, and the message shows
`via <your name>` to every director (never to guests).

## The super-admin's peek

Click any guest or character to open the **Inspector**: their **view**
(what their screen says), their **feed** (everything they have seen —
hidden lines greyed; for a character, every line they spoke and every
scan readout), their story position on the map, their variables, and
one button to **Be** them. A performer part's Inspector says whether a
booth holds it (amber *signed in · phone offline* when that phone
dropped); an agent-voiced character's says whether a stagehand worker is
voicing it right now; with none, its `hold:` line answers and you can
reply as it from Chat. The **Log** page's participant filter shows
every raw engine event that mentions them.

**Hand out a clue or a quest by hand.** A guest's Inspector has a
**Codex** box (how many entries they hold, and a *grant codex entry…*
picker over the ones they don't — **Grant** unlocks it as if the story
had, so their `learns` rules run) and a **Quests** list: every quest the
story declares, with where it stands for them. **Start** hands out one
they haven't got; an active one has **Update…**, **Complete** and
**Fail**. Each asks for the line their Quest Log thread shows (an update
needs one; the others can be left blank). Use them when a puzzle box
fails, a clue was found the wrong way, or a guest missed a step. Both
work on a local run too, and are journaled under your name on a server
run.

**Restrict or unrestrict someone.** A guest's Inspector has a
**Restricted** field beside **Captured**: **Restrict** is a bare
`restrict` (their DMs only, no places, no buttons; ⛔ shows beside them on
the Stage, the rail and the Roster), **Unrestrict** a bare `unrestrict`.
Only the story's `restricted` / `unrestricted` rules run, so it is **not**
a show's own mark: in *Trapped in the Internet* a mark also sets
`marked`, pins the 🚨 card and the escort task, and opens the Tube and the
Internet. To mark or unmark the way the story does, fire its event under
**Fire on this guest** (`mark_for_reinstallation` /
`unmark_for_reinstallation`) or have a host press 🩹 Unmark. On a live run
it asks first for a real guest.

**Someone lost their phone.** On a server run, a guest's Inspector has
**🔁 Re-pair**: it shows a QR that signs whatever phone scans it back in
*as that guest* — same program, codex, quests and score, no new guest
left behind. Use it for a dead phone, a cleared browser, a camera that
opened another browser, or a loaner. The code works once, for ten
minutes. **Sign out old phones** cuts every other phone signed in as
them (one someone else picked up). Keep the QR off the big screen: it
is their sign-in. A character's Inspector has **⏏ Release**: it signs
out whichever booth holds that part, so the performer can sign in again
on another phone with the performer code. The character's threads and
buttons stay.

## Directing together

A server run is one world for the whole writing team. Everything a
director does *inside* the story — fire a beat, edit a stat, speak as
someone, spawn a persona — lands in the run's journal **attributed to
them**; a restart, push draft, go live, or end is announced to every
console with the director's name. If a colleague already started a run,
your **Start rehearsal** simply joins it.

Need to try a fix without disturbing a live show (or a colleague
mid-rehearsal)? The header offers **⚗ Test draft privately**: a scratch
run of the current draft in this browser, in the same cockpit, with one
**← Back to the shared run** exit. It is never persisted and never
chosen for you.

## Moderating

Everything above, plus: move a guest between places (or capture /
release them, for stories that use those verbs) from roster context
menus, `set` a guest's score / group / location, fire beats and named
events (optionally *as* a character, so only that character's hooks
hear it), scan on a character's behalf, reveal a hidden group, hide and
show messages, and reply in threads. Every action is journaled on the
run, so the story replays exactly.

**Release is the story's release, not an escape.** Run's Release (and
setting `captured` to false in the World browser) does what `release X
from …` does: the guest goes to the first place that is not a prison,
and `when released:` runs. It never fires `escape` — that is a guest
walking themselves out (`escape` sends them back to the room they were
captured from). A story that rewards both should hook both (`when
released:` and `when escape:`).
