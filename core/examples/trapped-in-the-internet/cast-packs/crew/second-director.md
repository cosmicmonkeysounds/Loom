# Second director ([[EDIT: name — by Tue 10-20]])

> You sit at Run **all night**. Your laminated card is **the Director card**
> in [`director.md`](./director.md) (the cue order, the never-list, the
> fixes). This pack is what to set up beforehand and the jobs that are yours
> alone.

## Before the night

- [ ] **Account:** sign up at https://app.mapsandducks.com/edit/ with your own
      email; John adds you to the project (Share). By **Tue 10-20**.
- [ ] **A laptop** with Chrome, on its charger, that can stay awake 6 hours.
      Bring its charger and a spare mouse.
- [ ] **10-25 run-through:** fire C1 → V6 from the cue sheet yourself; judge a
      📝 filing; re-pair a lost guest; release a performer's part; scan a late
      arrival in as Norton; answer a DM *as Trabolta*; pull the recap.
- [ ] Read [`all-crew.md`](../all-crew.md) and the emergency card.
- [ ] Learn the four call words you act on: **INTRO** (you call it),
      **BEANS**, **A / B / WRONG**, **ARRIVAL**.

## Show day

| Time | You |
|---|---|
| 17:00 | Sign in at Run. Check the heartbeat card (all green), Run → Mind (worker connected, mind reset). |
| 19:00 | Briefing. |
| 20:00 | Doors: Run is yours. |
| ≤ 21:00 | **C1** (OP-17: the story runs ≈ 4 h 45 m from C1). |

## Jobs that are yours

**1. Fire the night.** The cue sheet (Run → Director) lists every admin cue in
order with the last one marked. Fire, then watch the room. Mis-taps are cheap:
a phase cue that already ran does nothing the second time. Optional set pieces
(☎️ Telephone, 🪅 Are you sure?) only if you are running early.

**2. Set stage on Run → Mind** at each phase (W-21): intro *formal* · C2
*hungry* · 📺 *rattled* · 🏓 *judge* · 🫘 *unravelling* · 🕚 *desperate* · 🌑
*last act*. Both models stay loaded on the house Mac, so the mind runs; if
Trabolta's replies start lagging more than a minute, pause the mind until a
quiet moment and have Clippy announce "a high volume of requests" (OP-06).

**3. Judge the 📝 DM filings** (W-07). Each filing posts in `# hosts`:
*📝 X filed H5 (round 2 Q2): …*. Judge it against the answer key below:
identity control → *be* **Clippy** → that program's card → **📝 Filed fact:
accurate** or **📝 Filed fact: confident lie**. Either gives the guest the same
reply. A lie counts against the final verdict for good; that is the point.

| | Accurate answer |
|---|---|
| H1 | Eleven years |
| H2 | Mister Pickles, a harbour tabby (1918) |
| H3 | 9:00 a.m. |
| H4 | Extension 1978 |
| H5 | "Hopelessly Devoted to You" |
| H6 | "Appendix Z: Loose Ends (Do Not Print)" |
| F1 | "I'm sorry, I didn't understand that. Would you like to speak to a live agent?" |
| F2 | Grok |

Close enough counts as accurate (a typo, "11 years", "Mr Pickles"); a
different fact is a lie.

**4. The late list** (OP-08b). At 🚨 Summons closed, read the roster's `late`
column to the Antivirus by radio (**LATE**, then names and where). Or, before
the hour ends, set `Night.auto_sweep = true` in Run → World to capture them
automatically.

**5. Assessments before 🏆** (W-34, optional). To put a specific program at
the top or bottom of the Trust Chart, edit `<guest>.assessment` **and**
`<guest>.trust` in Run → World before firing 🏆.

**6. Majority hygiene** (OP-11). No Run personas on the live event. At the 🕚
Y2K clock, note the real head count. If ghosts (lost sessions, early leavers)
keep the bar out of reach, fire **🗳 Force the majority**.

**7. Front of house fixes.** Lost guest → Inspector → **re-pair QR** (they
scan it; same program, same codex). Late arrival after C1 (uploaded, not
cleared) → Inspector → **scan as Norton**. Performer's phone dead → Inspector
→ **Release** the part.

**8. Trabolta's DMs if his worker dies** (no hosted fallback, decision #35).
The server posts his hold line after 20 s; the tech op restarts the worker.
Until it is back, answer waiting threads yourself: identity control → *be*
**Trabolta** → each program's Trabolta thread. Keep it short and formal:

- "Your request has been logged."
- "Personal queries are routed to Clippy, my ambassador."
- "Facts must be filed on the card in this thread. Unfiled facts are rumours."
- "Please wait. The computer is processing a high volume of requests."

Never confirm or deny a fact, never give an answer, never mention the server
room or a combination. When the worker is back, stop: it answers what is still
queued.

**9. The ceremony** (W-24, OP-14). During the final reveal, prepare:

1. Pull the recap (K-26): open
   `https://app.mapsandducks.com/e/<event>/api/mod/recap?format=text` in a tab
   where you're signed in, and copy the winners into the cue sheet's winner/value boxes.
2. **If Trabolta is still running:** take the performer lens, paste the recap
   into `cast:Trabolta`, ask him for one line per award, correct them, and post
   each line **as Trabolta in The Desktop** when you fire that award (the TV
   speaks it). Otherwise the template lines play on their own.
3. **If Trabolta is gone** (Combo B, the rave): Clippy hosts and reads each line
   aloud; the TV shows the award slide.
4. Fire **G1**, then G2–G9 with the winner as the subject. Firing an award
   again corrects it.

**10. The backup console.** If your laptop dies, John signs in on his; if the
editor is down, the radio is the console (W-26): tell the tech op what to fire
by hand.
