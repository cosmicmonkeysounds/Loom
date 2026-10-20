---
title: The cue sheet on your phone
section: Performers
order: 13
role: performer
keywords: director, cue, cue sheet, cues, phone, fire, arm, double tap, act, acts, fallbacks, anytime, countdown, strip, next bar, mod, moderator, passcode, next, last, not taken, refused, value, award, winner, stage manager, radio, laptop, role=director
---

Away from the laptop? The director's **cue sheet** — the same running
order as Run → Director in the editor — fits on a phone. A host who is
also a performer doesn't need this page: their own booth carries the
same cues in its NEXT bar and console ([The host console](hosts.md)).

## Opening it

Open the event's address with **`?role=director`** on the end (the
guests' front page has no link to it, so bookmark it). Type the
**director (mod) passcode** and your name. Your name goes into the log:
every cue you fire is recorded as *Phone · your name*. The phone stays
signed in until you sign out from **☰**.

## The sheet

Every director cue is one big button, in running order, with its code
(`C1/V1`, `V2`, …). The cue that fired last is **highlighted** and tagged
**LAST**; the one the sheet suggests is outlined and tagged **NEXT**: the
first cue after LAST that hasn't fired tonight and belongs to the way the
night is going (after the dance, the ending's own cue). A cue you press
over and over (📋 once per question) stays NEXT until you move on.
While a timer is running the night, NEXT is **empty**: at *Trapped in
the Internet* that is all of hunt 1, hunt 2's hour and the summons. The
timer fires the next step itself; its cue (C2's ⏰ *Hunt over*, 📥, ⏳,
🚨) is still on the sheet to fire early, and ticks ✓ when it fires, but
is never LAST or NEXT. V3's ⏰ *Bingo time* is an ordinary step: you
press it when Bingo ends, and it becomes LAST.
A cue that has already fired tonight is ticked ✓ and greyed out (flat, so what
is still to go stands out). A dimmed cue tagged *not on
offer* is off tonight's branch for now: the sheet never suggests it, but
you can still press it. Muted tags such as *optional* or *auto at 15 min*
come from the cue's own label.

**Acts.** When the story splits its cues into acts (the show's README
letters, `B · Act I …`), the sheet does too:

- The act the night is in is open, under a header that stays at the top
  as you scroll: its code, its title, and how many of its cues have fired
  (`3/8`; *starting* when nothing in it has gone yet). Its fallbacks (the
  cues that are not part of the running order) sit under a thin
  **fallbacks** line.
- The previous act's fallbacks stay on hand under it as a **from E ▾**
  line (tap to close it), so a hardware fallback is never more than a tap
  away after the night moves on. While you have that act unfolded, its
  fallbacks are listed in its own section instead, never twice.
- Acts already done fold into one line such as **✓ B · Act I 8/8 ▸**, and
  acts still to come into their size and first cue. Tap a folded line to
  open it; tap its header to fold it again.
- **⚡ Anytime** sits at the bottom: cues you may need at any point (the
  lights, a found duck).

Type in the filter box to find a cue by its code or a word: the sheet
shows every match, from any act, each with its act's code. A story with
no acts (or an older server) shows one plain list.

**The top of the screen** stays put while you scroll:

- The **strip**: the act the night is in, the story's phase, the soonest
  countdown (*⏱ Midnight 37:52*, red under a minute) and up to three
  of the story-wide values it asks directors to watch (a value that only
  matters for a stretch of the night, like *Results read* during the
  truth round, comes first). A count over the guests, a person's row or a
  character's value stays on the laptop's Director page, and a secret
  never reaches the phone. The countdown keeps ticking
  between refreshes and stops when it runs out. While the event is paused
  the story clock stands still, so the countdowns hold too, the strip
  says *⏸ clock stopped* and the NEXT bar *⏸ Paused: the clock is
  stopped*. Before the doors open the sheet is already there; the strip
  says *🚪 doors closed*, and nothing fires until they open.
- The **NEXT bar**: *NEXT 📊 Trust Chart* (or *AGAIN* for a cue pressed
  once per question). When nothing is on offer it says so — *NEXT —
  nothing to press. The story runs.* — over the soonest countdown
  (*⏱ Midnight in 37:52*), which is usually what the night is waiting for
  and fires by itself: don't press its cue early. Tapping the bar scrolls
  to the cue; it never fires anything. You still arm and fire on the cue
  itself.

## Firing a cue

- **Tap once to arm, tap again to fire.** An armed cue turns dark and
  says *Tap again to fire*; if the second tap doesn't come within four
  seconds it disarms, so a phone in a pocket never fires anything.
- **A fast double tap only arms.** A second tap less than a third of a
  second after the first is ignored, so a double tap on 📋 never skips a
  question. Tap, look, then tap again.
- **If the cues move under you, the arm is dropped.** When another
  director or the story moves LAST, fires a cue for the first time, or
  presses the very cue you armed again (a second 📋 while 📋 is armed)
  the phone disarms it and says *Cues moved — tap again*. A repeat of
  some other cue — 📋 again while you armed 📺, a guest's second duck
  find, the door contact again, an aside pressed again — leaves your arm
  alone, and your second tap fires. If a press that does count lands in
  the second before yours, before the phone has caught up, the server
  turns yours down with the same message: nothing fires twice. Look at
  the sheet, then
  arm it again if it is still the right cue. Locking the phone or
  switching to another app drops the arm too.
- **An armed cue warns you when it is out of turn**, but never stops
  you: *⚠ Not on offer now: the story may refuse it* on a dimmed cue
  (another ending, say), and *⚠ This is a F cue; the night is in E* on a
  running-order cue from an act you unfolded by hand. The armed button
  gets a red ring.
- **One press at a time.** While a cue is being sent (it reads
  *Sending…*) every other cue waits, until the sheet has caught up with
  that press; NEXT then waits one more second, so a quick tap meant for
  the old NEXT never arms the new one.
- A cue that needs a person (an award's winner, the King's fallback)
  asks **who** first; pick them, then tap the cue again to fire it for
  them (the armed row reads *Tap again to fire → Winamp*). Only an **award** (G2–G10) also has a **Value** box above the
  list (optional: lies accepted, the duck time, quests done).
- A message at the bottom says whether it fired. *✓ Fired* means the
  story took it. *Not taken — X doesn't apply right now (# hosts says
  why)* means the story turned it down: pressed out of turn, it did
  nothing, `# hosts` has the reason, and the sheet neither ticks it nor
  makes it LAST. A cue pressed ahead of its turn is turned down rather
  than skipping a step: *📺 Not yet: read Q2's results first (📋).
  Nothing happens.* A cue that asks first reads *Not taken* on the first
  press too: G11 before the last award is presented posts *Press G11
  again within 30 seconds to end the show anyway*, and the second press
  fires it. *Not fired* means the server refused it (no story
  loaded yet, for instance). *Not sure it fired* means the phone heard no
  answer (weak Wi-Fi): the cue may have gone, so look at the sheet's
  marks before you fire it again.
- Pressing an earlier cue again never moves LAST back.

The sheet refreshes every few seconds while the page is open, so the
marks follow cues fired from the laptop or another phone. It stops
refreshing while the phone is locked and picks up again when you look.

Pausing, restarting, going live, chat and the World editor stay on the
laptop. **☰ → Keep my screen on** stops the phone sleeping mid-show.
