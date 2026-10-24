# Cast paper: the history of what the packs assume

The [README](./README.md) lists what the packs assume **now**. This file
keeps, word for word, the running list it replaced (2026-10-15 to wave 21),
so a reader can see when and why a pack changed. It is not instructions:
where it disagrees with the README or the packs, they win. Several lines here
are stale by design (the "house Mac", QLab, Windows Defender, Clippy's 🎤
cue bar, *All buttons…*, "not yet deployed").

## Facts these drafts assume (from 2026-10-15)

- The app lives at **https://app.mapsandducks.com** (the editor at `/edit/`, the
  invite one-pager at the apex). Invitations are out.
- **One house Mac** does everything local: it drives the TV over the long HDMI
  run (`view=tv`), plays room audio through the **MOTU** (ADAT), and runs
  Mosquitto, Zigbee2MQTT, stagehand `show` + `agents`, Ollama (48 GB; since
  wave 12 only the voice model is loaded, while `OLLAMA_MAX_LOADED_MODELS=2`
  stays so a switch back to the classic mind can load the second) and the house announcement player. Where
  OCT31 says "the TV computer" or "the Ollama laptop", read "the house Mac".
- The PAUTIX strips are addressable, on an off-the-shelf **WLED** controller
  (presets; the Tube gets a chase).
- **No hosted-model fallback** (decision #35): if Trabolta's worker dies, the
  server posts his hold line and **the directors answer his DMs by hand**.
- **House internet down → cues are fired by hand** (WLED presets, wall switches,
  QLab GO). Phones fall back to cellular; the server is on the VPS, not in the
  house.
- The Run tools the crew cards lean on — the cue sheet (Run → Director), 🔁
  Re-pair and ⏏ Release in the Inspector, the Terminals card, the 🖨 Print
  sheet, ♟ chess, the ceremony cues — shipped to the VPS as `w3-1015`
  (2026-10-15). Each has a device check under
  [`scripts/accept/`](../../../../scripts/accept) (OCT31.md §5). The 📝
  judging is wave 4 (next bullet).
- Meta developer mode is set up; whether the Quest runs in the tent is the
  K-30 call (Thu 10-22). Every tent line below works with or without it.
- **Wave 4 (2026-10-16) is in the working tree, not yet deployed:** the
  hunt questions, answers and the bottle's truth questions come from
  `facts.json` (DRAFT placeholders until the team replaces them; `pnpm
  --filter @loom/core titi:facts` regenerates the story and
  `generated/print-stacks.md`); the server judges every 📝 filing (the
  confidence slider, 1–100); the First Moment of Truth is ⏱ → 📋 per question
  (Trabolta reads it on the TV) → 🍾 the bottle after the third (wave 18b);
  a host's verdict **marks** a program and the Antivirus
  escort them (`# quarantine`); Truthcoin moves from each program's Wallet
  (CRA approves every third transfer); Clippy and the Antivirus have Quest
  Logs in their booths; the Installation Wizard (Julia) is a voice, the tent
  is in the backyard through the tunnel. Every pack below is written to that.
- **Wave 20 (2026-10-23), on `oct31-w20/integration`, not shipped; text in
  [`SIGNOFF-w20.md`](../SIGNOFF-w20.md):** Trabolta's heart. The door sensor
  is a light on the frame (an LED into an LDR, read by the server-room
  terminal); the first opening once he is awake plays The Heart and **he
  wants the door shut before anything goes on**; a pass at his screen starts
  a four-layer talk (clicked with the mouse) or a heart to heart (typed at
  the keyboard); the room's bulb follows him. The server-room Antivirus
  close the door behind every program and have 🚪 *opened* / *is shut* on
  their booths; the director has 🚪 closed, 🚪 *Trust the door sensor again*
  and 🕊 *Heart: end the night on his own*. `stand_down` is gone. **Wave 20b (the
  user's answers):** a talk-down works at any hour and the night ends on the
  director's 🕊 (no automatic end); a program thrown out of his heart is
  marked for reinstallation; the room has no ESP32 (the patch-bay watch
  judged the bay until wave 22, when the M4 bay judges itself) and no
  strip (the bulb is the room's light). Reprint after the sign-off: the
  four server-room Antivirus packs, the patch-bay watch, the emergency
  card, all-crew, the director's and the tech operator's cards.
- **Wave 7 (2026-10-17), not yet deployed:** the server-room door has a real,
  standalone **keypad lock** (outside only; the inside handle always opens
  with no code; nothing in the show can lock or unlock it). A program gets
  the code with the winning majority (and, since wave 11, the two ways below).
  Opening the door is a clean entry, whoever does it: the door never alarms.
  Only the server-room terminal on the wall is his heart: Trabolta speaks
  candidly there, and from the Y2K hour a program can talk him down (🕊;
  wave 20b: at any hour, ended by the director's 🕊).
  Only the patch bay alarms, on the **second** wrong combination. CRA
  approves or denies every third transaction (C16), everywhere. The code is
  never written on a card or said on the radio.
- **Wave 11 (2026-10-18), not yet deployed:** the code also comes from
  **four digit notes** hidden in four rooms (one digit each, the silver
  pile; all four in one Codex assemble the code; the quest *The Cold
  Door* counts them) and from **checkmating the King on the terminal
  outside the server-room door** (all night until 📄, no hints). The King
  also stands in both reinstallation games with **one health bar for the
  whole night** (15 points, each program may hit him once per visit; the
  lower it is, the worse he plays at the door; 👑 restores him). The sign
  by the keypad points at the notes and the King; there is no riddle.
  **The Heart** plays on the first opening once Trabolta is awake,
  however the door was unlocked (press **🔧** first when the crew go in).
  The server-room Antivirus presses 🔌 💥 ❌ 🚪 🔧 on their own booth (any
  Antivirus booth has them; Clippy's never does, and the server refuses its
  press; since wave 13 a host part's booth may press them too), and Adobe
  Acrobat presses 🫘. (Wave 11's door-only Antivirus part is gone since wave
  18: the four Antivirus share the door.) Buttons with
  no way back (🔌 💥 ❌ 🚪 🔧 ♟ 🍎 🫘 💘) **arm on the first tap and fire on
  the second**. The nine featured programs are 🔒 Reserved: each invitee
  joins from the QR on their invitation (the featured sheets say so), and
  a lost one gets the director's 🔓 for two minutes. A mistyped right answer
  on a 📝 card, or one said at length, is a **near miss** (⚠ in `# hosts`);
  since wave 11b Trabolta rules on it (*🤖 Trabolta ruled …*) and a
  director overrides only when they disagree; an abbreviation (*Mr.
  Pickles*) is simply accurate. **Wave 18b:** Trabolta rules every answer
  that isn't an exact match, a plain miss too; directors judge only what
  he couldn't (a filing still pending on Run → Mind → Judging) before 📋.
- **Waves 8 and 9:** wave 8 shipped as `w8-1018`; wave 9 (2026-10-18) is
  merged and ships as `w9-1018`, and every pack is written to it: McAfee
  referees bets and holds no pot (a bet settles player to player, the
  winner's 🙏 Request paid by the loser); 💡 also holds a pending dance
  (ALL STOP); the bottle picks a cleared program anywhere in the house; the
  Judging card carries the override buttons in both modes, and a host's 📝
  judges a program's latest filing only; Clippy's 😤 meant as ✅ is undone
  with ✅; the cue sheet suggests nothing while a timer owns the night and
  refuses a cue pressed a step early; ✍ lets the second director's own
  award lines replace Trabolta's template; phones, booths and Run reconnect
  by themselves after a server restart. **Reprint every pack before the
  10-25 run-through.**
- **Wave 13 (2026-10-20), on `oct31-w13/integration`, not yet shipped:** the
  Play app is rebuilt around one glance and one tap. Every booth has a
  **NOW card** pinned on top (the story's objective for that character right
  now, with a checklist that ticks itself), a taskbar with **⊞ Start**, a big
  **📷 Scan** and **🗂 Guests**, and a **Readouts** room that survives a reload.
  A scan opens the guest's card at once: the facts, **at most three buttons
  the objective needs**, what the press came to, and **All buttons…** for the
  rest (gone in wave 21). **Task Manager, Adobe Acrobat and the Recycling Bin are hosts**
  (`admin: true`; Clippy is not): their booths carry the cue sheet in a NEXT
  bar (tap ARM, tap FIRE; any host may fire, a double press is refused, LAST
  says who pressed) and a console (Cues · Needs · Judge · People · More: the
  doors, pause / resume, announce, the alert level, wallets, the King,
  terminals, codes + QRs, parts, answering as Trabolta). 🛡 ✅ 👁 are the
  Antivirus' own (no host's or Clippy's booth has them); 🩹 sits on a marked
  program's card; a ribbon after Bingo is announced as *from the hosts*.
  Guests have a taskbar too: **⊞ Start** holds 🚻 Bathroom Mode, **🎟 Pass** is
  one tap from anywhere. The objectives and every new line are **DRAFT** until
  the user signs off `../SIGNOFF-w13.md` (Q1 — who calls the cues — above all);
  every pack below is written to the drafts.
- **Wave 18 (2026-10-21), on `oct31-w18/integration`:** the Play app plays
  like a game. A guest lands on **Mission** (what to do now, where to go, its
  buttons big), the rooms are the **Chats** tab, the room named after the
  story is a far-away **📜 Chat log**, and the big moments (the Bingo win,
  the ribbon, the capture, the awards, the side reveal) are **full-screen
  and can't be ignored**. The user's sign-off answers (`../SIGNOFF-w13.md`)
  change the crew's night:
  - **Q1: any host may call the show.** The *radio the director before you
    fire* rule is retired. A host taps **📣 I'll call** in the console's Cues
    tab; every booth and the director phone show who is calling, and a FIRE
    by someone else asks once (*Fire anyway?*).
  - **Q2: Clippy is a super-performer.** Clippy's own game cues (the Bingo,
    the hunts, ⏱ 📋 🍾, the bob, the summary, the ceremony and its awards) sit
    on a **🎤 cue bar** in Clippy's booth; the Bingo results are one
    **PLAYER SELECT** window of tiles (🎱 → 🎀 → 🎯), no scans. (**Reversed
    in wave 21**, below.)
  - **Q26: Windows Defender is gone.** The four Antivirus share the door: a
    *🚪 X is waiting* pop-out reaches all four, and the first **🙋** wins.
  - **Q30: a mark doesn't hinder.** A marked program keeps everything; every
    Antivirus booth gets a **🚨 WANTED** pop-out and the **Wanted board**
    (claim, hand back, take over), and the Antivirus' **scan is the
    confrontation** (CORRUPTION DETECTED → 🛡 → CAPTURED). No `# quarantine`
    escort pins any more.
  - **The summons:** programs check themselves in with the Desktop's QR; staff
    tap 📍 only for a dead phone on the *Still missing* list.
  - **Q16 dropped:** after an ending the reinstallation is a party favour for
    everyone.
  - **Q21:** sides are joined on the **Sides screen** (two doors at the Y2K
    clock), and a member recruits by **scanning another program's pass**;
    guests may also found their own **crews** (never a side). **Wave 18b:**
    the screen is **Factions**; from the Truther Download a program may
    found a faction that races beside the two sides (the leaders' tasks no
    longer gate the majority; 🧾 is gone).
  The new lines are `// DRAFT w18` until the user signs off
  `../SIGNOFF-w18.md`; every pack below is written to the drafts.


## Wave 21: performers play (2026-10-23, DRAFT w21)

The user: *"Clippy should no longer be considered a "super" user / host that
can call shots. Clippy and the AntiViruses are performers that are playing a
game just like the "guests" are."* So (reversing wave 18's Q2):

- **Clippy, Norton, McAfee, Password Manager and CRA Agent Software are
  players** (`player: true`). Their booth is a **Mission** like a guest's
  (⊞ Start · Mission · Chats · 📷 Scan), with ⭐ Points (and 🛡 Captures or ⚖️
  Answers judged) as tiles, only their own buttons, only their own team
  room (`# quarantine` for the Antivirus; Clippy has none), and every action
  as a pick, a pop-out, a global press or a scan. No *All buttons…*.
- **Clippy calls nothing.** The hosts and the directors fire every cue;
  Clippy's phone pops *YOUR GAME IS ON*. The hosts keep their host dock.
- **Points:** Clippy for running the games (🎱 🎀 🎯 ✅ 😤 🤷 🗣 🙅 🎩 🏓 🍎 🖌 💘),
  the Antivirus for clearances, captures, releases, patch-bay calls, McAfee
  for 🤝 brokered deals, Password Manager for 🔑 password checks, CRA for each
  audit ruling. **Trust** (Trabolta's, hidden from them, on his chart as
  🛡 STAFF): serving him raises it, mercy in the open lowers it a little.
- **Whose side are you on?** From the Truther Download: **📢 defect openly**
  (a big moment to every phone; Trabolta answers on the TV and keeps them as
  allies; −50 trust) or **🤫 quiet favours** (🤫 look the other way on a
  claimed mark, tip a marked program off, let a guess slide, slip a program
  50 Truthcoin): private, never told to Trabolta; every third one he
  notices (−20 trust, a private warning, never removal).
- **Staff awards** after G10 / G9: 🛡 Trabolta's Favourite Staff, ⭐ Staff
  Player Of The Night, 🤫 The Mole (the last award; G11 waits for it).
- ✅ / 😤 judge one question at a time (🔢 picks it), so a card's three
  buttons cover every question.

