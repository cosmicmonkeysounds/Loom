# SIGNOFF — wave 45: Bathroom Mode at the awards ceremony

**Status: DRAFT.** Branch `oct31-w45/bathroom`. Not shipped.

Your words, verbatim:

> during the awards ceremony, we should have a section on Bathroom mode:
> how much time the party spent in the bathroom all together; who spent the
> most / least time in the bathroom; who turned it on/off the most. Also,
> Trabolta will lose some trust if you don't go to the bathroom at least
> once in the party.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| B-1 | **A cue of its own, G13 🚻 The Bathroom Report** | Appended last (no printed cue number moved) and off the running order: NEXT never suggests it. Press it any time from G1 until G11, between two awards. Best right after G1. Press it again to read the newest numbers. |
| B-2 | **Time is story time in Bathroom Mode** | From 🚻 to *Back from the bathroom*, or to the 15-minute timeout. A trip still open when G13 is pressed counts up to that moment. Read aloud in whole minutes (rounded; anyone who went reads at least 1). The TV shows hours and minutes. |
| B-3 | **Least time is among those who went** | Programs who never went are their own line (how many, not their names). With only one program who went, no least is read. |
| B-4 | **"On/off" counts real switches** | 🚻 when not in Bathroom Mode and Back when in it. A repeat press while away, or Back while not away, counts nothing. The timeout is not a switch. |
| B-5 | **Ties name everyone tied** | "Notepad and Paint Shop". |
| B-6 | **Who counts** | The programs at the party: scanned in, not marked gone, not a Run persona. Hosts and the staff are not programs. |
| T-1 | **−5 trust, at G1** | The same as one trip to the Internet. Applied the moment the ceremony starts, so it lands before Most / Least Trusted (read the recap after G1). Silent until G13. |
| T-2 | **A first trip after G1 gives it back** | "At least once in the party" includes the ceremony. Trabolta says *Your trust is restored.* in their thread. |
| T-3 | **No warning beforehand** | Nothing on the 🚻 button or in the tour says skipping it costs trust: it is a reveal at G13. |
| T-4 | **Told privately too** | At G13 each program that never went gets one line from Trabolta in its own thread (only while he hosts: after destroyed or rave he says nothing; Clippy's report says it aloud). |
| R-1 | **The recap gains it** | Run's recap text lists *Minutes in Bathroom Mode*, *Bathroom Mode switches* and *Never went to the bathroom (−5 trust)*. Trabolta's letters may mention a top-3 place. |

## 2. The words (all `DRAFT w45`)

Trabolta (the TV speaks these; skipped under ✍ like an award's):

| When | Text |
|---|---|
| opening | A bonus section. The Bathroom Report. Bathroom Mode is a promise that you are not hacking the Internet. I logged every promise. |
| total | All together, this party spent this many minutes in Disk Cleanup: {n}. I did not need to know that. I know it now. |
| most | Most time in Disk Cleanup. Minutes: {n}. {names}. I did not ask what you were doing. I logged it. |
| least (2+ went) | Least time, of those who went. Minutes: {n}. {names}. Efficient. Suspiciously efficient. |
| switches | Most switches of Bathroom Mode, on and off. Presses: {n}. {names}. Make up your mind. |
| some never went | Programs that never once visited Disk Cleanup tonight: {n}. A program that never cleans up is hiding something. I have taken 5 trust from each of you. It is not too late. |
| everyone went | Every program here visited Disk Cleanup at least once. Clean processes. I trust that. |
| nobody went | Nobody used Bathroom Mode tonight. Not once. Either you are all very disciplined, or you were all hacking the Internet. I have taken 5 trust from every one of you. |
| their own thread, at G13 | {name}. You did not visit Disk Cleanup once tonight. A program that never cleans up is hiding something. Trust −5. It is not too late: Bathroom Mode is on your pass. |
| their thread, first trip after G1 | Disk Cleanup, at last, {name}. Your trust is restored. |

Clippy (after destroyed / rave, read aloud):

| When | Text |
|---|---|
| opening | Bonus section. The Bathroom Report. The system logged every use of Bathroom Mode tonight. I am required to read it. |
| total | Minutes this party spent in Disk Cleanup, all together: {n}. |
| most | Most time in Disk Cleanup: {names}. Minutes: {n}. Please come forward. Or don't. Take your time. |
| least | Least time, of those who went: {names}. Minutes: {n}. Efficient. |
| switches | Most switches of Bathroom Mode, on and off: {names}. Presses: {n}. It looks like you're having trouble deciding! Would you like help with that? |
| some never went | Programs that never went: {n}. The report says their trust was lowered by 5. It is not too late. Bathroom Mode is on your pass. |
| everyone went | Every program went at least once. The report says: good hygiene. |
| nobody went | Nobody used Bathroom Mode tonight. Not once. The report says this is not possible. The report says your trust has been lowered by 5, all of you. |

The TV and walls (`award_bathroom`): BONUS SECTION · THE BATHROOM REPORT ·
*All together, in Disk Cleanup* · rows *Most time*, *Least time*, *Most
switches on / off*, *Never went* (*{n} · −5 trust each*, or *nobody*).
Without the numbers (an older server): *Bathroom Mode is a promise. Every
promise was logged.*

Cue sheet: **G13 · 🚻 The Bathroom Report (between awards)**.

## 3. To ship

Server first (`ship.sh`), then `sync-show` with its reload (a story
change), then reload the TV and every wall (the new slide). Reprint the
director and second-director cards. Nothing on the house machines.
