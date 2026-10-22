---
title: Run mode — rehearse, go live, be anyone
section: The Editor
order: 43
keywords: run, microphone, mic, 🎤, voice link, denied, invitations, stop house sounds, house sound, router, announcements, house list, tablets, reinstall, tent laptop, faction race, over the line, founded, badge, bathroom, flagged, audit, judge queue, queued
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
  A restart while the doors are closed (paused, or not yet opened) plays
  the story's `start:` beat when they next open.
- **👁 The identity control** — who you are right now (see *Being
  anyone*).
- **⚡ Quick-fire** — fire any named event the story declares, from any
  page.
- **⏳ N** — pending decisions across the run; click to answer them in
  Chat.
- **■ Stop house sounds** (server runs) — fades out every story sound
  and speaker test on the house speakers at once (0.3 s), from any page.
  It is a panic button: one press, no confirm, nothing journaled. The TV's
  voice (it has its own mute), the terminals and the live mics are
  untouched, and stopping the dance song does not move the story's
  clock. The button then reads one of three things:
  - **■ Stopped**: the router heard it and fades out now.
  - **■ No router: stop it on the house Mac** (amber): the server took
    the stop, but no router is listening, so it can't reach the house
    Mac. The house may still be playing (its connection down mid-song):
    stop it there with `stagehand sounds stop`, or publish to MQTT
    `show/audio/stop`.
  - **■ Stop failed: retry** (red): the request itself failed (signed
    out, the server down, an older server), so nothing was stopped.
    Press it again; the tooltip names the error.

  To cut the announcement playing too, use the **House sound** card on
  the Run page.

A banner under the header tells you when a co-writer restarted, pushed
a draft, went live, or ended the run — and who.

The console keeps itself connected. If the server restarts (a redeploy,
a crash), it tries again on its own, every second at first and then
every few seconds, and picks the run up where it is once the server
answers; nothing to reload. It also takes only what changed each time
rather than the whole run, so a console costs about 0.1 Mbit/s with 45
guests in: a second console on a phone's hotspot is fine.

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
  sign-in, so keep them with the cast and never post one. A story with
  `reserved: true` programs ([live shows](live-shows.md)) adds
  **Invitations**: one card per reserved program with its claim QR (no
  typed code), four to a page. Hand each to its invitee; whoever scans it
  joins as that program. On screen only, each card has **🔓 lost? open 2
  min** (two taps): it opens that program to anyone for two minutes, for
  an invitee whose invitation is lost, and counts the window down; two
  taps while it is open shut it early. The door code's digit notes print
  on the **silver** stack, title and QR only, never a digit.
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
  can't speak, **💤** its screen is off or another app is on top, **⛶**
  it is not full screen (on a tablet, touch it once: it asks again on
  every touch; on the TV it means its Chrome was started without
  `--kiosk`, so relaunch it with the kiosk line; a tablet that can't go
  full screen, or has it turned off in ⚙, shows nothing), the **voice
  link's microphone** (wave 19): **🎤** live (the games near it hear this
  room), **🎤 off** (⚙ on that tablet, its view or the map turns it off),
  and in red, where a microphone belongs, **🎤 denied** (the permission
  was refused: allow it in the browser's site settings, or Fully Kiosk's
  *Enable Microphone Access*, then reload), **🎤 http** (plain http has no
  microphone: use the https address) and **🎤 tap** (open, but nobody has
  touched it since it loaded, so it neither hears nor is heard — touch it
  once), its battery (red under 20 % and not charging), and its build (amber when
  it isn't the one the others run, or **old build** when it reports none
  at all while the others do: either way, reload it before doors). **identify**
  puts that screen's name and spot full screen for 10 seconds, with a
  chime: install day's "which tablet is this?". A terminal set up with a
  **room** (the show's server-room terminal) sleeps on its idle show
  until the story opens that room to everyone, and still checks in while
  it sleeps: green and asleep is right before then. Its row says
  **room The Server Room**. A room on any other spot is amber: usually a
  tablet that was the TV once and kept `room=The Desktop`, so it sleeps
  and speaks that room's lines instead of its own. Clear its room in ⚙.
  Since a mod code lists the story's cast before the doors open, a
  terminal's ⚙ can check its character the moment it is set up, and a
  room terminal's room resolves before the doors too: *the story has no
  room called …* means a typo in its `room=`. A **📢** on a row means
  that tablet says the house announcements aloud right now (its own ⚙
  setting, or the house list below). **🛠 Set up a terminal…** builds a
  tablet's provisioning link from pickers: the spot, the view (including
  **Reinstall**, the tent laptop: the idle show like any wall terminal,
  and a marked pass plays the reinstallation right there or sends it to
  a headset; like Chess and Casino it has no room and no character),
  the room and the character. Its announcements box reads **Always
  (ignore the house setting)**: leave it unticked and the tablet follows
  the house list for its spot.
- **House sound** — whether the router on the house Mac is listening,
  **■ Stop house sounds** with a **+ announcements** box (also cuts the
  announcement playing and drops the queue), and **Tablets that also say
  the announcements**: one box per terminal spot on the house map
  playing now. A tablet on a ticked spot says them aloud unless its own
  ⚙ says Always or Never. They are off by default: the house speakers
  reach most rooms, and a tablet in a room with a house speaker would say
  each one twice. A tick is saved for **this event only** (the card says
  *In force: this event's save*); **Save to project** writes it into the
  project's `audio.json`, so it survives End → relaunch. That save holds
  the **whole** speaker config, not only the list: while it stands, a
  newer `audio.json` synced to the project does not play on this event,
  and the card says so. When the project's file has other speakers than
  the save (a sync since the tick, or a map-page save on this event),
  Save to project asks first and then keeps the project's speakers,
  adding only the list; to write the map page's speakers, use Save to
  project on the map page's Audio panel. If someone saved the speakers
  from the map page since the card read them, the tick is refused and the
  card reloads: tick it again.
- **House map** — when the event has a house map, one button per map
  variant (*Trapped in the Internet*: **Tent** | **Shed**), the one
  playing now highlighted. Press the other to switch every tablet,
  headset and terminal at once; it always asks first, and warns when this
  event's map edits would be dropped (✎ *edited on this event*: save them
  to the project from the map page first). Same switch as the map page's
  **Map:** buttons — see [the house map](39-house-map.md). A map with
  a King has his row too: his **one health bar** for every program
  (*n / 15*), updated every few seconds, *Kneeling* once it is at 0
  (his door open in both games). **Set…** types any value 0 to his
  maximum; **👑 Restore** puts him back to full. Both ask first, and
  are journaled under your name ([the server room](38-server-room.md)).
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
| **Roster** | all guests and the cast — group, location, score, presence, when each guest was last seen, whose persona, who went home, and the story's `badge:` lines a guest wears now (🚻 Bathroom Mode), as on the rail, the Stage and the Inspector ([live shows](live-shows.md)) |
| **World** | the live state browser — a searchable variables table; **double-click any value to edit it live** |
| **Director** | the night by **act** — the NOW card (NEXT, armed then fired), On hand, the running order — the glance column (Needs you, Watch, People, Cast, `# hosts`), and the Tools drawer: named events (with arguments), beats, broadcasts (below) |
| **Mind** | the **Judging card** (below), then an agent-voiced character's mind — its arc, drives, brief, the prompts and both models' reasoning, and a control panel ([the mind debugger](44-mind-debugger.md)) |
| **Log** | the raw ledger, event by event — **filter to one participant**; export the run. The time column is story time (it stands still through a pause), on a server run as on a local one. Events from before this console opened (a reload, a late join) aren't listed: it says how many, and **⤓ Export run** pages the whole ledger off the server |

### The Judging card

The top of the Mind page: every filed `fact` card, its proposed verdict,
and the ✅ / 😤 / 🤷 buttons that confirm or override it, with a tally per
question ([cards & widgets](widgets.md)). Its two modes:

- **review** — every verdict is a proposal until you (or a host) confirm
  it; the round's settle takes the rest as proposed.
- **auto** — with a `judge:` character in the header (the show's
  Trabolta), *the house accepts exact matches; Trabolta rules every other
  filing; what he can't rule (no worker, a stall, an expired or
  unfinished ruling) falls back to the house rule and can be judged
  here*. A pending filing reads **🤖 queued for Trabolta** while it waits
  its turn and **🤖 asking Trabolta…** once his worker has it; only a near
  miss also carries **⚠ near "…"**. His rulings list under the pending
  rows (*🤖 Trabolta: same — why*), each with the usual buttons. The
  header counts his queue (**🤖 4 queued · 1 out · oldest 1:05**: he rules
  one at a time, and a guest's message to him goes first), or **⏳
  Trabolta isn't ruling** when his worker answered no ruling twice in a
  row. Whatever he hasn't ruled when its round settles takes the house
  rule: a near miss accurate, a plain miss a lie at 100 and uncertain
  below. With no `judge:` character, auto judges every filing at once and
  only a near miss waits here.

Judge any filing yourself first (his ruling is then dropped) or override
his ruling after (the later verdict wins).

## The Director page

The Director page is the night's running order: the story's `who: admin`
interactions in the order they are declared ([buttons in the
app](live-verbs.md)). A label's leading code (`C1 · …`, `V4 · …`) is
split off as the cue number, and a leading or trailing `(…)` (`(auto at
15 min)`, `(hardware fallback)`, `(Optional)`) becomes a small grey tag.
The last cue fired is amber **LAST**, the one the sheet suggests is
indigo **NEXT**, and every cue fired tonight gets a ✓ — the same marks on
every director's console and the director phone, and they survive a
reload.

**Acts.** An admin interaction with an `act:` line opens an act, and
every later admin cue belongs to it until the next `act:` ([live
verbs](live-verbs.md)). The **Night bar** across the top is the act
stepper — `✓B ✓C ●E F G`, a chip opens that act — with the story's
`Night.phase`, the two soonest countdowns, and a full-width amber
**PAUSED: story clock stopped** while the run is paused. The act holding
NEXT (else LAST, else the first act) is the **focus**: it is open, the
acts before it fold to `✓ 8/8` (or `– skipped`), the acts after it fold
to their size and *next: …*. An act made only of `sequence: false` cues
is an **Anytime** act: never the focus, never on the stepper, always on
hand. A story with no `act:` is one act and has no stepper.

**The NOW card** answers *what do I press next?*:

- **NEXT** with its full `description:` and its button, then *then:* the
  cue after it (dimmed *·not on offer·* when its `while:` is false). A
  `repeat: true` cue that is both LAST and NEXT reads *Again? 📋 Results:
  the next question* — *or move on: 📺 …*.
- With no NEXT: **NEXT — nothing to press. The story runs.** (*… The
  story clock is stopped.* while the run is paused; *NEXT — nothing left:
  the running order is done.* once LAST is set, no unfired cue is left and
  no countdown runs) and every countdown that is running (the header's `countdown:` lines, [live
  shows](live-shows.md)), red under a minute, plus what is next on the
  running order after it. So a silent sheet during a timer reads as
  meant, not as broken.
- **LAST** with who moved it: *(auto)* when the story fired it itself,
  *moved by another director* (flashing for 4 s) when it wasn't this
  console; then **did:** — what that press did (world changes, `cleared
  → true ×41`, rooms opened, broadcasts, codex and quest steps; four
  items, then **+N more ↗ Log**, which opens the Log on just that press).
- The **result** of your last press: **✓ Taken · <cue>**, or **✕ Not
  taken · <cue>** followed by the `# hosts` line the story posted to say
  why (it waits a moment for it; *the story gives no reason here* when
  the story has no staff room), or **✕ Failed: <message>** — including
  *no answer in 8 s — check LAST before pressing again*.

**On hand**, under the NOW card: the focus act's fallbacks (its
`sequence: false` cues) as buttons, the previous act's fallbacks on a
**from E ▸** line (open by default — after 🌑 the Y2K hour's 🪩 and 🔌
are still one click away), and every Anytime cue on the **⚡ Anytime**
line. Then the **running order**, act by act: the focus act's cues as
numbered rows (fired ones muted, a one-line description under each) —
its fallbacks stay in On hand, not repeated here; an act you unfold by
hand that On hand doesn't cover shows its fallbacks as chips, and so does
every act while you filter; **/** or the box filters by word and opens every act;
**⇲ all** unfolds them all. The award tools (**↻ awards**, **Copy
recap**) sit in the header of the act holding the first award. At the
bottom, **Tools** holds *Fire named event*, *Fire beat* and *Broadcast
cue* (open by default when the story has no admin cues).

**Arm, then fire.** Every cue — NEXT on the NOW card too — takes two
presses: the first **arms** it (amber, *Fire ▶ again · Esc*, a 4-second
bar), a second one at least **0.3 s** and under **4 s** later fires it. A
fast double-click only arms. An arm is dropped — *Cues moved: 📋 just
fired. Re-arm.* — when the night moves under it first (another director
or the story's own timer moves LAST, a cue fires for the first time, or
the very cue you armed is pressed again), when you switch tabs or
windows, or after 4 s. A repeat of some *other* cue leaves your arm be:
armed on V4, another director's second 📋, an aside pressed again, a
guest's second duck find or the door contact firing again do not stop
your press. If a press like that lands just before yours, the server
turns yours down and the card says so — *… landed first. Nothing fired —
re-arm.* — so nothing fires twice; every cue stays locked until your
console has caught up with that press, so the re-arm counts it. While a
press is on its way every cue is locked, and after you fire NEXT the new
NEXT waits 1 s before it takes a press (an aside starts no wait).
An armed cue warns, never blocks: *⚠ Not on offer now: the story may
refuse it* (its `while:` is false) or *⚠ This is a F cue; the night is
in E*. A cue that names a person (an award; ♟ *They beat the King*)
takes three steps: the first press opens its **who?** picker (plus a
**value** box for an award), choosing a person arms it for them (the
armed button reads *Fire → Winamp*), and the next press fires it.

**The keys** (only with the page in **Calling** mode, never while you
type in a box): **Space** arms NEXT, Space again fires it; **Enter** arms
the row under the cursor (or NEXT) and fires it on the second press;
**Esc** disarms, then clears the cursor, then the filter; **j / ↓** and
**k / ↑** walk the cursor through the cues on screen; **/** jumps to the
filter; **.** scrolls NEXT (or LAST) into view. Enter or Space on a
focused button that isn't a cue is that button's.

**Calling / Watching** (top right): on a server run **Calling** is the
show's **caller claim**, the same one a host's *📣 I'll call* makes: every
console, host booth, Clippy's 🎤 bar and the director phone then shows
*📣 your name*, and another console's claim turns yours to Watching (*X is
calling*). A FIRE in the Play app by anyone else asks once (*Fire anyway?*).
The claim lives in memory: a restart clears it. In a local-folder
rehearsal (or on an older server) the choice is just this console's,
remembered per console. **Calling** is the layout above with the keys on. A second director sets
**Watching**: the NOW card shrinks to one line with no button, the
glance column comes first with a longer `# hosts` feed, On hand and the
running order fold into one closed **On hand · Running order** drawer
(open it to arm a cue; clicks there still arm, then fire), and the keys
are off. Watching draws no *Cues moved … Re-arm* / *landed first* notice:
a dropped arm or a press turned down shows only as the cue going back to
unarmed, so call cues from Calling. The claim is no lock — anyone may
still press — the stale-arm rule covers two people pressing at once.

**The glance column** (beside the NOW card; under 896 px a strip of
chips, one section at a time — or, in **Calling** mode while the
right-hand Inspector tray is open with nothing selected, in that tray:
*← the house at a glance* brings it back after you inspect someone. In
Watching the glance stays on the page and the tray is the Inspector's). Read-only; every row is a
link. Each section hides when it has nothing to say:

| Section | Shows | Goes to |
|---|---|---|
| **Needs you** | your refused press (60 s), filings waiting for review (Judging in `review` mode), ⚠ near misses waiting in `auto` mode with nobody to rule them, *🤖 N with Trabolta* for the filings the story's `judge:` character is ruling on (every filing that isn't an exact match goes to him, queued one at a time), held transfers, a performer whose phone is offline or whose part nobody holds, an agent with no worker, an agent whose queue is stalled or has waited 40 s or more, and *👋 N guests unseen 30 min — mark gone?* with a 👋 per guest. The same list a host's console shows under **Needs** in the Play app | Chat · Mind's Judging card · the Run page's Wallet card · the Inspector · Mind |
| **Watch** | the header's `watch:` lines while their `while` holds: values (changed in the last 10 s → ◆), a ROLE path as a count over the guests (`Cleared 44/45` and a bar), a name as a person row (online, room, ⛓ / ⛔). A value on a `secret: true` CHARACTER shows `••••` — **press and hold 👁** to read it for 5 s. With no `watch:` line: **Recently changed**, the last few globals the story wrote | World, filtered to that path · Roster · the Inspector |
| **People** | joined · online, who is in a prison room, how many are restricted, each faction's guests against a majority tick, the busiest rooms. In a story with `founding:` ([live shows](live-shows.md)) the factions are **one race**: every faction, founded (◇) or declared, its programs present against the line (the header's `majority:`, of the programs present), the one past it marked **over the line**. That is *now*, not *won*: founding opens before the story counts, and only the story's own majority beat says who won | the Inspector (a declared side) · Roster (a founded faction) · Stage |
| **Cast** | one dot per performer part (green signed in, amber phone offline, hollow free), each agent's stage and mood | the Inspector · Mind |
| **# hosts** | the last lines in the story's staff rooms (a `kind: faction` CHANNEL whose GROUP isn't joinable), newest first, each with how long ago it landed | Chat on that room |

The header carries a **▶ NEXT** pill on every Run page (or the soonest
countdown): a click opens the Director page and never fires.

### What NEXT means

- **NEXT** is the first cue after LAST that hasn't fired tonight and is
  on tonight's branch. A cue with a `while:` ([live
  verbs](live-verbs.md)) is only suggested while it holds: in *Trapped
  in the Internet* NEXT is empty while a timer runs the night — all of
  hunt 1, hunt 2's hour, the summons, and the Y2K hour (midnight fires 🌑
  itself); after the dance it is the ending's own cue, after the song it
  is G1, and G10 is only suggested when MS Paint was cleared. A `while:` never stops you pressing a cue; the story's rule
  decides what happens. Acts never change NEXT: they only group the page.
- A `repeat: true` cue **stays NEXT** while you keep pressing it and its
  `while:` holds (📋 once per question, until the third).
- A press the story **turns down** counts for nothing: it never becomes
  LAST and never ticks. A show's cues pressed out of turn say why in
  `# hosts` and do nothing else — a cue pressed ahead of its turn is
  refused rather than skipping a step (*📺 Not yet: read Q2's results
  first (📋). Nothing happens.*, *📊 Not yet: 🏓 Truth Pong, then 🧮 the
  tally first. Nothing happens.*, *🤖 Too late: the clock has already
  been reset. Nothing happens.*); a
  hardware fallback (🖨, 🫘, a patch combo) shares its name with the
  device and stays silent. A cue that asks first (G11 before the last
  award) is refused on its first press too, and a variable whose last
  name starts with `_` is the sheet's bookkeeping, never a fire
  ([live verbs](live-verbs.md)).
- Pressing an **earlier** cue again (a second round, a re-read) never
  moves LAST back.
- An off-sequence cue (`sequence: false`: one a machine or a timer
  fires — C2's ⏰ *Hunt over*, 📥, ⏳, 🚨 fire themselves on time — a
  hardware fallback, an anytime cue like 💡 or ✍) ticks when it fires
  but is never LAST or NEXT. V3's ⏰ *Bingo time* is not one of them: the
  Bingo timer calls time and tells Clippy to ask for the results, and
  you press V3 yourself, so it becomes LAST like any step.

A local-folder rehearsal judges all of this exactly like the server, and
ticks its countdowns off the same story clock.

### Awards

A cue that needs a person — an award: every hook that hears it binds one
— has a **who?** picker and an optional **value** box (read as
`{value}`) and fires with that person as the subject (in *Trapped in the
Internet*, **♟ They beat the King** asks who won, because the door code
goes to the winner). On a server run, once the story sets `Night.ended`,
the page reads the recap and fills each award's empty **who?** and
**value** with a suggestion — the top of that award's list (the bottom of
the trust list for Least Trusted), rehearsal personas skipped — and shows
`suggested: Ada (82) · tied: Bob` under it. It never replaces a pick you
made; **↻ awards** re-reads the recap, and **Copy recap** puts the text
block on the clipboard (for pasting into `cast:Trabolta`). For the
numbers behind an award, open `/e/<event id>/api/mod/recap?format=text`
in a tab while signed in: a paste-ready list of trust, truths and lies
accepted, trips to the Internet, codex, quests, score, codex shares,
chess against the King (won / lost / drawn), Bathroom Mode trips (a
count, not minutes), and who joined each side.

### The board in the story

The glance column's Watch section and the countdowns come from the
story's **header** ([live shows](live-shows.md)):

```loom
# The Glass Orchard
start: The Front Gate
watch: guest.suspicion as Suspicion, guest.favour as Favour, Ivo Marsh
```

That line watches two slots of the story's `ROLE Guest` (summed over the
guests, with the highest) and where Ivo Marsh is. A story with a timed
hunt adds its globals and a countdown — the names must be ones a line of
the story `set`s, spelled the same way:

```loom
watch: Night.round as Round, Night.lights as Lights, while Night.step >= 2
countdown: Night.hunt_end as Hunt ends, while Night.hunt_on == true
```

A `countdown:` path holds a story time in seconds (`set Night.hunt_end =
Time.elapsed + 900`); it shows only while its `while` holds and the time
is still ahead. Keep these lines **in the header of the first file**,
above its first beat, declaration or rule (blank and comment lines in
between are fine): the server reads that header only. Lint `L1205` flags a line that won't parse, a path whose
head names nothing, a global spelled unlike the lines that set it
(`night.round` for `Night.round`), a board line below the header, or a
board line in another file.

**On a phone.** The same running order runs in the participant app: open
the event's address with `?role=director`, type the director (mod)
passcode and a name. It is grouped by the same acts under a pinned NEXT
bar (the soonest countdown when there is nothing to press) and a strip
with the act, the phase and up to three of the story's global watch
values (never a ROLE count, a person row, a value on a CHARACTER or a
secret); tap a cue once to arm it, again within 4 seconds to fire — a
fast double tap only arms. The same rule as here drops an arm: LAST
moving, a cue firing for the first time, or the armed cue itself pressed
again — a repeat of LAST drops it only when LAST is what you armed. When
the phone's own poll has already seen that, the second tap is not sent:
the phone says *Cues moved — tap again*. When it hasn't, the press is
sent and the server turns it down; the phone says the same, and nothing
fires. After any press on the phone, NEXT waits 1 s (an aside too). Before
the doors open the sheet is already there, with a note that nothing
fires until they do. LAST / NEXT are shared with this page, and the log records
each fire as *Phone · <name>*. A press the story turned down says *Not
taken* there, and only an award asks for a value. The phone never gets a
description or a secret. The guest front page has no link to it (the
participant guide's *The cue sheet on your phone* has the details).

## Being anyone

The **👁 identity control** in the header switches the whole cockpit
between the **Operator** (the god view, default) and any participant:
your personas, a co-writer's personas, real guests, or a character.

While you are someone, what you see is **exactly what they see** — the
server's own view of them, the same data their phone renders: their
rooms (with the real "can post here" rule), their feed (a guest never
sees a hidden message), their pending choice docked in the room, and the
story's interaction buttons for them. As a **character** you get the
performer's booth: one thread per guest with **📡 Scan** and exactly
the buttons that booth's phone offers (never the director's cues; a
host part also lists the other characters' buttons its press is heard
on), and you speak as the character everywhere. A scan's readout lands
in the guest's thread and in the booth's **Readouts**. The booth's own
rooms come too, read-only: its **Quest Log**, **Codex**, **Readouts**
(*Norton · Inbox* under the Operator) and (for the approver)
**Wallet**. A wallet card shows what it is, who pays whom and how much;
approve or deny it on the Run page's Wallet card. A transfer the
approver's audit holds reads **🚩 held** there, and its recipient's card
**🚩 flagged for a CRA audit** (the story's `audit` words). Being a **host part**
(a character with `admin: true`) is being a host: its lens says so, and
a Players pane for it opens a host booth, NEXT bar and console included,
journaled under your name.

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
readout in its Readouts, each with the guest it was about), their story
position on the map, their variables, and one button to **Be** them.
While you are being them, *Their view* (a guest) or *Their booth* (a
character) lists their live **objectives** in order: the NOW one tagged,
its act, *loud*, the brief, the checklist with what has ticked
(*1/2*), and the buttons it names ([Objectives](objectives.md)). A performer part's Inspector says whether a
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

**Who is still here.** A guest's Inspector says when the server last
heard from them (*seen 12 m ago*; the same on the rail and in the
Roster's Seen column). After a server restart or a release, a guest who
hasn't made a request since reads *not seen since the server started*
(*not since restart* in the Roster), not *never seen*. Personas show no
seen line and carry a persona badge. **👋 Went home** marks a guest who
left (*Back* undoes it): a journaled `<id>.gone = true` the story can
leave out of its head counts. In *Trapped in the Internet* that is the
Y2K majority, so mark the early leavers before 🕚; the board's *Present
programs* line shows the count. The Director page's *Needs you* offers
it for every guest unseen for half an hour.

**Restrict or unrestrict someone.** A guest's Inspector has a
**Restricted** field beside **Captured**: **Restrict** is a bare
`restrict` (their DMs only, no places, no buttons; ⛔ shows beside them on
the Stage, the rail and the Roster), **Unrestrict** a bare `unrestrict`.
Only the story's `restricted` / `unrestricted` rules run, so it is **not**
a show's own mark: in *Trapped in the Internet* a mark (since wave 18)
restricts nothing, sets `marked` and puts the program on the Antivirus'
Wanted board. To mark or unmark the way the story does, fire its event under
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
run, so the story replays exactly: a broadcast (an `!` alert included)
survives a restart in its place and shows in the Log and an export.

**Release is the story's release, not an escape.** Run's Release (and
setting `captured` to false in the World browser) does what `release X
from …` does: the guest goes to the first place that is not a prison,
and `when released:` runs. It never fires `escape` — that is a guest
walking themselves out (`escape` sends them back to the room they were
captured from). A story that rewards both should hook both (`when
released:` and `when escape:`).
