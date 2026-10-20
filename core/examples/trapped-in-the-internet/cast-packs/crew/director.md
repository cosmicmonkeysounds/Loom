# Director

> Two parts. **The Director card** is the Run console card: whoever sits at
> Run holds it (the second director all night; John only during his
> off-stage moments, since he plays Task Manager). **The show owner's day** is
> John's: the morning reset, the checklist, the briefing.

## The Director card (laminate)

**Screens** (a laptop, signed in with your own account at
https://app.mapsandducks.com/edit/, a project member): tab 1 **Run →
Director** (the cue sheet); tab 2 **Run → Mind** (the **Judging card** on
top: the judge's mode, pending filings, per-question tallies; Trabolta's
worker below it: on the story mind his stage follows the phase by itself,
see [`trabolta-mind.md`](./trabolta-mind.md)); the **terminal heartbeat card** (red + chime =
a dead kiosk); **`# hosts`** for the bank's and the judge's logs; **`#
quarantine`** for the escort pins. **Keep the Run tab in the foreground** (a
background tab throttles the chime).

**Cue order** (auto = fires itself; the button is the fallback):

| # | Cue | Then | Set stage (classic only: the story mind sets it itself) |
|---|---|---|---|
| 1 | **C1/V1 📣** Call everyone to the Desktop (by 21:00) | Clippy welcomes, hosts | |
| 2 | **V2 🎱** Start Computer Bingo (20 min) | | |
| 3 | **V3 ⏰** Bingo time: results | Norton interrupts; Corrupted Code | |
| 4 | radio **INTRO** → **Clippy 2/X 🤖** introduces Trabolta | | *formal* |
| 5 | **V4/V5 🔎** Hunt 1 (15 min) | (auto **C2 ⏰** at 15 min) | *hungry* at C2 |
| 6 | **V6 ⚖️** First Moment of Truth (two-minute filing window) | the server judges every filing | |
| 6a | **⏱** Close round-one filings (auto at 2 min) | Clippy: "Pencils down" | |
| 6b | **📋** Results: the next question (press three times: Q1, Q2, Q3) | Clippy reads the result; filings settle (+50 / marked) | |
| 6c | **🍾** Spin the bottle, up to five times per question (off-sequence) | the TV asks Truth or dare; Clippy 🗣 / 🙅 | |
| 7 | (optional) **☎️** Telephone · **🪅** Are you sure? — only if running early | | |
| 8 | **📺** Preview hunt 2 → the ad hijack | Clippy panics | *rattled* |
| 9 | **📓** Hunt 2: disperse for 1 hour | (auto **📥** +2 min · **⏳** 55 min · **🚨** +5 min; the sheet suggests nothing until 🚨 has fired) | |
| 10 | **🏓** Truth Pong | | *judge* |
| 11 | **🧮** Trabolta tallies round 2 | | |
| 12 | **📊** Trust Chart → **🏆** rankings | VLC + the printer | |
| 13 | **🫘** printer opened (only if the lid sensor fails; Adobe radios BEANS) | | *unravelling* |
| 14 | **🗜** zip everyone out | | |
| 15 | **🤖** Trabolta shares the next facts (press it; the scenario picks itself) | | |
| 16 | wait for **IN** from the patch-bay watch → **🕚** Y2K clock (60 min) | (auto majority; clock warnings) | *desperate* |
| 17 | door / patch bay (or the Tier 0 buttons 🚪 🔌 💥 ❌) | blackout → (auto 🪩) | |
| 18 | **🏍** (after Combo A) or **🪦** (after Combo B), else auto **🌑** at midnight | | *last act* at 🌑 |
| 19 | **🍎** Bobbing for Truth → **📄** Read truth.txt (the slide holds while the bobber reads) → **⚖** the verdict when they finish | | |
| 20 | Grok Prom only: 💘 from a host, or **💔** / the alt **💌 → 🗳 → 💞 / ⛈ → 🕺** | | |
| 21 | (**✍** first, only if the second director wrote award lines) → **G1 🏆** ceremony → **G2–G9** awards, winner picked from the recap → **G10 🖌** the painting (only if MS Paint came; without her NEXT goes G9 → G11) → **G11 🎃** Resurrection (last: ends the show) | | |

A cue that doesn't apply yet does nothing but tell `# hosts` why (*"⚖ Not
yet: 📄 Read truth.txt first."*, *"📺 Not yet: read Q2's results first
(📋)."*, *"🕚 Not yet: 🤖 Trabolta shares the next facts first …"*), even a
step early, so a forward mis-tap never skips a step's work; it never becomes
LAST, and the phone sheet says *Not taken*. **NEXT is empty while a timer
owns the night**: all of hunt 1 (until C2 ⏰ fires itself, then V6), hunt
2's hour and the summons (until 🚨 fires itself, then 🏓), and the Y2K hour
(until midnight fires 🌑). Never tap a timer's cue early: it cuts the window
short. When the filing window closes by itself, ⏱ ticks and NEXT is 📋.
After the dance NEXT is the ending's own cue. The timer cues (⏰ 📥 ⏳ 🚨)
and the anytime ones (🍾 🗜 🎆 🧾 🔄 ♟ 🕊 🗳 🪩 💡 ✍) never become LAST or
NEXT. The hardware fallbacks (🖨 🫘 🔌 💥 ❌) stay silent when early.

**Judging is automatic.** Every fact filed on the 📝 card (question + answer
+ the 1–100 confidence slider) is judged by the server against `facts.json`
the moment it is filed: accurate (matches the key or an alias), confident
lie (no match at 100), uncertain (no match below 100). The verdict never
reaches a guest's phone or Trabolta's worker (`# hosts` logs each filing with
it, for staff only); credits (+50) land when the round settles (round 1 per
question at 📋, round 2 at 🧮, the final at 📄); marks for a filed guess land
only in rounds 1 and 2 — a guess filed for F1/F2 is simply dropped at 📄,
nobody is escorted during the verdict. The Judging card on Run → Mind shows
the mode: **`auto`** (the default; leave it)
or **`review`** (every verdict is a proposal in `# hosts` until you confirm
or override it on the card; a round closing settles what is still pending
by the proposal). **Overrides live on the Judging card, in both modes**: ▸
the question, then that filing's ✅ accurate / 😤 confident lie / 🤷
uncertain (the current verdict is outlined; a filing that was settled as a
mark, a guess, has no buttons). A host's 📝 on a program's card judges only that program's
**latest** filing: while an earlier one still waits, it changes nothing and
`# hosts` says *"📝 Not judged: … Judge it on Run → Mind → Judging"*. **A near miss** (wave
11: a mistyped right answer, *Mr Pickels*, *Grko*, or the right answer said at length, *11
years ago*) is never judged by itself, even in `auto`: it
waits on the Judging card tagged *near* and `# hosts` gets a ⚠ line naming the key. **Trabolta
rules on it** (wave 11b): with his laptop online the ⚠ line ends *… asked Trabolta to rule*,
the card reads *🤖 asking Trabolta…*, and seconds later `# hosts` gets *🤖 Trabolta ruled …:
the same as / not "<key>" (<verdict>).* with his reason. **You override only when you
disagree**: that ruling's ✅ / 😤 / 🤷 on the card (the later verdict wins). Judging it
yourself while he is asked cancels his ruling. A near miss filed while his laptop was off
waits for you, and unjudged the settle credits it as accurate, so **judge every ⚠ still
pending before 📋**. An abbreviation (*Mr. Pickles*, *11 yrs*, *0900*) is
simply accurate, no ⚠; a plainly wrong answer at 100% is still an automatic lie. A program may file every
open question, once each; a question not filed when its round closes never
comes back. Clippy and the hosts still judge what is **said out loud** at
Truth Pong and the final reveal (✅ / 😤 / 🤷 by question number).

**NEVER after doors:** Restart · Push draft · Go live · End (each one wipes
every guest). No Run personas on the live event. Fire cues from the cue sheet,
never from a guest card.

**Fixes**

| Problem | Do |
|---|---|
| stuck codex | read the guest the code from the printed code list |
| a program marked by mistake, or to be shown mercy | a host presses 🩹 on their card; or Director → fire `unmark_for_reinstallation` with them as the subject (`/api/mod/act {id, action: "unrestrict"}` lifts only the grey, never the mark) |
| a program who must go to the Internet and no host is near | Director → fire `mark_for_reinstallation` with them as the subject (or `/api/mod/act {id, action: "restrict"}` for the grey alone); an Antivirus does the walking |
| a Truthcoin transfer stuck on CRA's approval, or a bad one | Run → **Wallet**: **✓ Approve** / **⛔ Deny** / **↩ Cancel** on its row, or **✓ Approve all held** (a held transfer approves itself after 5 min anyway); **💰 Pay stimulus** if Runescape is gone; **Lift** ends a Runescape freeze early. A grant or a freeze for Runescape is API only: `/e/<event>/api/mod/wallet/grant {to, amount}` / `freeze {to}` |
| a filing judged wrong (a typo the key did not know) | Run → Mind → Judging card → ▸ on the question → that filing's ✅ / 😤 / 🤷 (works in auto too; the current verdict is outlined; a verdict already on record is not re-counted); then add the alias to `facts.json` for next time |
| Clippy pressed 😤 for an answer that was right | Clippy presses ✅ for the same question on the same program: `# hosts` says *"⚖️ Corrected …"*, nothing is paid twice |
| stuck quest | fire the story event that advances it |
| stale Bathroom Mode | Run → World → that guest's `afk` = false (at each summons) |
| a guest left the party | Run → their row → **👋 Went home** (wave 11): they stop counting toward the majority (the board's *Present programs*); **Back** undoes it |
| ghosts block the majority at Y2K | mark the ones who left 👋 Went home first; then **🗳 Force the majority** (stay / leave) |
| a featured guest lost their invitation, or their program reads 🔒 | Run → Join → 🖨 Print sheet → Invitations → that program's **🔓 lost? open 2 min** (two taps): anyone can pick it for two minutes, so have the invitee ready |
| `# hosts` says Trabolta's worker is stalled (⏳) | the tech op restarts the `agents` job; answer his DMs as Trabolta from Run meanwhile (every waiting thread got his hold line once) |
| a faction leader absent or stuck | **🧾** Let a faction win without its leader's task |
| dead door terminal (the King's chess) | **♟** They beat the King: the door code (fallback), **naming the winner** (with nobody named it only reminds `# hosts`); the door terminal reports its own wins *by Terminal · <name>* |
| the King's health knocked down too early, or after a rehearsal | **👑** Restore the King's health (Anytime): back to 15/15 in both games and at the door |
| the crew need to open the server-room door themselves | **🔧** Crew going through the server-room door (Anytime; the server-room Antivirus has it too): for 2 minutes an opening only tells `# hosts`, The Heart is kept |
| the server-room door opened and nothing happened | **🚪** Server room door opened (the contact's fallback; the server-room Antivirus has it too): once Trabolta is awake the first one plays The Heart |
| a wrong patch the crew forgave, or after a rehearsal | **🔄** Server room: reset the patch-bay alarm (clears the wrong-combination count, the alarm latch and The Heart); the lights stay as they are, so if the house is still red press **💡** Restore the house lights |
| `# hosts`: "🕊 Trabolta offers to stand down for X" | your call: **🕊** Trabolta stands down (talked down) ends the night the Combo A way, without a cable |
| a dead keypad battery or a jammed lock | the house manager's override key; prop the door; fire **🚪** if the cutscene has not played (W-35) |
| dead patch bay | the server-room Antivirus radios A / B / WRONG → 🔌 / 💥 / ❌ |
| lost guest / new phone | Inspector → **re-pair QR** (never re-register) |
| late arrival after C1 | Inspector → **scan as Norton** (clears them) |
| performer's phone dead | Inspector → **Release** the part; they re-sign on a loaner |
| lights wrong after a blip | radio **LIGHTS**: the tech op restarts the stagehand `show` job, which replays the current look on reconnect; failing that they set it by hand (Run → World → `Night.lights` names it). Re-pressing a cue does nothing: phase cues play once |
| TV voice must stop | the mute on the heartbeat card (it stays muted through restarts and Go live: check it before doors) |
| loom restarted (a crash or a redeploy) | nothing to press: phones, booths, Run and the tablets reconnect by themselves (Caddy holds requests up to 30 s); a phone's dot reads *reconnecting…* meanwhile. Rescan anyone mid-walk in the tent |
| **ALL STOP** | **💡 Restore the house lights** (it also holds a pending automatic dance after a server-room blackout: `# hosts` says *"💡 The dance is held: press 🪩 when the house manager says go."*), then follow the house manager |

**Trabolta's worker dies** (no hosted fallback): after 20 s his thread posts
*"Jean Trabolta is not responding. Please do not move the mouse."* Radio the
tech op. **Answer his DMs by hand**: identity control → *be* **Trabolta** →
the program's Trabolta thread → type. His voice: 1999 corporate, one to three
short sentences ("Your request has been logged." only as a first message to a
program, never twice). Thank every fact the same way, never say whether it is
right, never give an answer, tell facts to be **filed on the 📝 card**. [[EDIT: rehearse on
10-25 that a director's line lands in a guest's Trabolta thread]] **Known
gap:** if the laptop hangs but stays connected (Run → Mind still shows the
worker, his threads say he is typing, nothing comes), the hold line can take
minutes. Don't wait for it: answer by hand the same way and radio the tech
op to restart the `agents` job. **While the run is paused** his words still
post but his powers answer "doors are closed" (and aren't counted).

**House internet dies:** phones keep playing on cellular (the server is on
the VPS). Lights and sound stop following the story: radio the tech op the cue
name each time (**LIGHTS** + the look). Keep firing cues from Run as normal.

**Radio:** you hear everything. INTRO is yours to call.

## The show owner's day (John)

**Before Oct 31:** the second director, tech operator and house manager named
by **Tue 10-20**; the second director has a VPS account and project
membership; everyone trained at the **10-25 read-through** (the never-list,
the call words, the blackout rule, the escort list, the 📝 buttons).

**The facts loop (yours, with the team):** `facts.json` is the one file the
team edits: the eight hunt questions (DRAFT until replaced), their answers
and accepted aliases, where each document hides, the scannable facts, the
character facts, the bottle's 20 truth questions. After every edit run
`pnpm --filter @loom/core titi:facts` (it regenerates
`generated/questions.loom`, `codex/9-facts.loom`,
`generated/print-stacks.md`, the marked blocks in `trabolta.mind.md` and
`DESIGN.md`); `--check` only reports, and is the gate before shipping.
**Deploy order:** ship the server **before** the first `sync-show` that
carries `facts.json` or the King's maps (an older server would read
`facts.json` as story text and refuse the `house.json` king prop); then
remove any stale kokoro container or `spatial-house.json` on the VPS. The
content lock for the printed stacks is 10-24 12:00. Since wave 9 `sync-show`
refuses to reload a **live** event with real guests (it writes the files and
exits 3; `--i-know-this-is-live` overrides): sync before Go live, never
after doors.

**Sat Oct 31**

| Time | You |
|---|---|
| **10:00** | Weather call with the tech op (gusts > 30–40 km/h or steady rain → the shed). **Morning reset, before anyone registers:** sync the story, **Push draft**, scan the door QR from a phone **on cellular**, then **Go live in place**. Open `/reinstall/map`: press **Tent** or **Shed** in the *Map:* bar for the weather, and check its status line reads "the project's map". If it reads "this event's map", a rehearsal's map edit is still in force (Push draft and Go live keep it): **Save to project** to keep it, or switch to the other variant and back to drop it. |
| 12:00 | Set dressing; tent or shed set. |
| 15:00 | The tech op boots everything; you walk the pre-show checklist with them. |
| **17:00** | **Performer call.** Costumes, phones charged, booths signed in (prime code + cast picker, after go-live), a test `!` alert to staff, walk the stations. Confirm the anti-AI program (MS Paint) with Task Manager and Clippy. Decide whether Password Manager gets the moderator passcode (her pack: ☰ → *Become an admin*, reload, **hide** any message; it also shows her your cues under More…). Without it, she asks you to hide one. |
| 18:00 | Porch set (Recycling Bin). Checklist signed off. |
| **19:00** | Food + the **15-minute briefing** (below). The tech op starts the backup job. |
| 19:45 | Places. Lights to screensaver. |
| **20:00** | **Doors.** Hand Run to the second director; you are Task Manager now. |
| ≤ 21:00 | C1. |
| ≈ 01:45 | Ending + ceremony. **The clock falls back at 02:00**: rides home. |

**Pre-show checklist** (from OCT31 §11; tick each):

1. Deploy pinned; the previous image kept; the warm standby built (stopped);
   backups armed for 19:00; uptime alerts on `/api/health` (anything but 200)
   reach the tech op + second director; the printed sheet
   (`checklist.sh --probe`) heads with `VPS health … ✔`.
2. Push draft → Go live in place done before any registration; the codes are
   the printed ones (door QR scanned on cellular).
3. The show map is the tent or shed variant chosen at 10:00 (**Tent** or
   **Shed** `● live` in the map page's *Map:* bar), and its status line reads
   "the project's map", not "this event's map".
4. Trabolta: worker connected (Run → Mind), **mind Reset**, `lookup: false`,
   thinking off; both models loaded; the house Mac on its charger, `caffeinate`;
   he is hidden and asleep.
5. Terminals green on the heartbeat card, showing attract; the TV on `view=tv`
   showing the screensaver, **clicked once after its last boot**, its voice
   **not muted** (a rehearsal's mute survives every restart).
6. Lights: Z2M + WLED up; screensaver look on; one blackout test (stairs,
   bathroom, tent, server room, the path stay lit; the Tube strip dim).
7. Server-room door: the contact reads open/closed; the keypad opens from
   outside with the story's code (`facts.json` `door.code`, tested at 15:00);
   the patch bay is all unplugged; the server-room terminal is green and asleep.
8. Audio: one test cue per zone through the MOTU at show level; the house-announcement test.
9. Push: the staff test alert arrived on every performer phone.
10. Tent: tablet charged on `/reinstall/` (provisioned as `Tent tablet`); the
    King's bar reads 15/15 on the Run page (👑 if not); the Installation Wizard video
    on the 2nd device; Quest charged (if go); heater on its GFCI leg; EXIT
    sign on.
11. The door terminal by the keypad (the King's chess) green on the
    Terminals card. The four silver digit notes hidden (never in the server
    room). Bean printer button paired.
12. Print: the QR stacks sorted by colour and hidden where
    `generated/print-stacks.md` says (gold = the hunt answers, green, blue,
    red), the check-in signs, Bingo cards + pens, trophies, every card.
13. Judging card on Run → Mind reads `auto`, nothing pending; `facts.json`
    is the one synced with the story (`titi:facts --check` green).
14. Safety: first aid + extinguisher placed, egress clear, glow tape, GFCIs
    tested, no strobe > 3 Hz, the server door opens from inside with the handle
    and no code (nothing in the YAML drives a lock), gear taped off, the
    emergency card at the door.
15. 2–3 loaner phones charged; the guest charging station live; power banks
    for every performer; radios charged with earpieces.
16. The spares by the house Mac: [[EDIT: a second laptop with Chrome for the
    TV, the spare Zigbee dongle + Z2M backup, the ISP router boxed]].

**The 19:00 briefing** (15 minutes, everyone):

1. The shape of the night, in one minute (doors → Bingo → hunts → the hour →
   pong → the beans → Y2K → the server room → an ending → the ceremony).
2. **The blackout rule**: lights out 10 s, GO TO THE LIVING ROOM, guide the
   nearest guests, the stairs stay lit.
3. **The call words**, especially **ALL STOP** (anyone, any time) and
   **ARRIVAL**.
4. **The emergency card**: where the extinguisher, first aid and the meeting
   point are; the house manager is the safety lead.
5. **"Never restart."** Nobody touches Run except the second director.
6. Phones at 30% → the charging station. Dead → the director.
7. Trabolta down → he's "processing a high volume of requests"; the directors
   answer for him. Internet down → guests turn Wi-Fi off.
8. Real names never, ever. Have fun.

**Sun Nov 1:** change the mod code; wrap per OCT31 §14.
