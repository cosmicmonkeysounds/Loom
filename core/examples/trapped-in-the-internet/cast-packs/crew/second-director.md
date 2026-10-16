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
- [ ] **10-25 run-through** (on the server project — a folder rehearsal has
      no judge and no Wallet): fire C1 → V6 → ⏱ → 📋 ×3 → 🍾 from the cue
      sheet yourself; file a fact from a test phone and watch it settle;
      switch the Judging card to `review`, confirm one, switch back; mark a
      program (🤷 as Clippy) and 🩹 it; approve a held transfer with the
      API call in 3b (there is no Approve button in Run);
      re-pair a lost guest; release a performer's part; scan a late arrival
      in as Norton; answer a DM *as Trabolta*; pull the recap.
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

**1b. The First Moment of Truth, in order.** V6 opens a two-minute filing
window. ⏱ closes it (or it closes itself). Then 📋 once per question (Q1, Q2,
Q3): Clippy reads the result in the Desktop room and the filings settle.
After each 📋, 🍾 up to five times: the server picks a program at the Desktop,
the TV asks "Truth or dare?", their phone asks too; Clippy settles a Truth
with 🗣 / 🙅. 📋 refuses while a bottle is open; 🍾 refuses after five. After
Q3's bottle, 📺. Rounds never reopen.

**2. Set stage on Run → Mind** at each phase (W-21): intro *formal* · C2
*hungry* · 📺 *rattled* · 🏓 *judge* · 🫘 *unravelling* · 🕚 *desperate* · 🌑
*last act*. Both models stay loaded on the house Mac, so the mind runs; if
Trabolta's replies start lagging more than a minute, pause the mind until a
quiet moment and have Clippy announce "a high volume of requests" (OP-06).

**3. Watch the judge** (W-07). Every 📝 filing (question, answer, the 1–100
confidence slider) is judged by the server against `facts.json` as it is
filed; `# hosts` logs each one. The Judging card on Run → Mind shows the
mode and a tally per question. **Leave it on `auto`.** Switch to `review`
only if the key is wrong on the night (a question the team changed late):
then every filing waits as a proposal, and you confirm or override it on the
card (✅ accurate / 😤 confident lie / 🤷 uncertain), or a host does it via
*be Clippy* → the program's card → **📝 Filed fact: …**. Either way the
guest hears the same reply. A lie counts against the final verdict for good;
that is the point. A typo the key did not know → override that one filing,
and tell John to add the alias to `facts.json`. The key, for reference
(DRAFT questions until the team replaces them):

| | Accurate answer |
|---|---|
| H1 | Eleven years |
| H2 | Mister Pickles (a harbour tabby, 1918) |
| H3 | 9:00 a.m. |
| H4 | 1978 (the extension on the Customer Care card) |
| H5 | "Hopelessly Devoted to You" |
| H6 | "Appendix Z: Loose Ends (Do Not Print)" |
| F1 | "I'm sorry, I didn't understand that. Would you like to speak to a live agent?" |
| F2 | Grok |

The judge folds case, punctuation and one leading article and matches the
answer or any alias in `facts.json` exactly ("11", "pickles", "appendix z"
are aliases); a different fact at 100% is a lie, below 100% a guess (marked).

**3b. The escort list and the Wallet.** Marks are the hosts' buttons; you
only step in from Run when nobody is near: fire `mark_for_reinstallation` or
`unmark_for_reinstallation` with the program as the subject (Director →
quick-fire). `# quarantine` shows every open escort pin. Truthcoin moves by
itself from the guests' Wallets; CRA Agent Software approves every third
transfer in her booth's Wallet room and can deny any within 60 s. If she is
busy or gone: `POST /e/<event>/api/mod/wallet/approve` (or `deny`, `cancel`)
with the transfer id from the card, signed in as yourself, or Run → Wallet's
**✓ Approve all held** (`POST /e/<event>/api/mod/wallet/approve-held`); a held
transfer nobody answers approves itself after 5 min anyway; `stimulus` mints
Runescape's hand-out if Runescape never came (`grant {to, amount}` and
`freeze {to}` likewise), and `unfreeze {to}` lifts one of her ten-minute
freezes early.

**4. The late list** (OP-08b). At 🚨 Summons closed the Antivirus booths
already read *⏰ X is late for the Second Moment of Truth. Go get them.* and
`# quarantine` pins each one (marked: *late for the Second Moment of Truth*).
Confirm the list by radio (**LATE**, then names and where) from Run → World
(each guest's `late` var; the roster has no late column) if a booth missed
it. Or, before the hour ends, set `Night.auto_sweep = true` in Run → World to
capture them automatically (no mark, no escort).

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
