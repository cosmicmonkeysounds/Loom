---
title: Performer station
section: Performers
order: 7
role: performer
keywords: performer, booth, now, objective, checklist, to-do, tick, alert, chime, late, keep screen on, push, notifications, get alerts, iphone, home screen, release, re-sign, loaner, lost phone, file a fact, filed fact, judge, judging, verdict, confidence, override, review, hosts, character, sign in, scanner, scan, camera, next guest, readout, readouts, admin, moderator, capture, hide, guest card, card, face, all buttons, not on offer, facts, guests, messages, who's here, restricted, marked, pinned, pin, quest log, codex, wallet, approve, deny, audit, approval, transfer, arm, tap twice, tap again to fire, near miss, not your button, start, taskbar, balloon, sticky
---

The performer station is the same app, recomposed for the booth: your
character is the mask, the guest in front of you is one scan away, and
the story tells you what this part of the night needs from you.

The booth's frame, top to bottom: the **NOW card** (your current
objective), your rooms, and the **taskbar**: **⊞ Start**, **📷 Scan**
(the biggest button), **🗂 Guests**, and the tray (the act, the soonest
countdown, and **🔔 n** for anything you missed). A host's booth also has
a NEXT bar above the taskbar: see [The host console](hosts.md).

## Signing in

Scan your **cast card** (or the host's performer QR): it opens the
performer sign-in with the passcode filled in. Typing it works too —
pick **I'm a Performer** and enter the **performer passcode** from the
host. The story's **parts** appear — every
character with something to do, with their pictures — tap yours. A part
is one booth's: a greyed-out name is already taken by another
performer. You now speak *as* that character everywhere.

Phone died, or you need to swap to a loaner? Your part is still held by
the old phone, so ask a host or the director to **release** it (a host's
console → More → Performer parts → **⏏ Release**, or Run → the
character's Inspector). Then sign in on the new phone with the performer
code and tap your part again: everything is where you left it. A booth
whose part was released (or that the show's going live signed out) says
*"Your booth was signed out (a director released your part, or the show
went live) — sign in again with your passcode."* A phone that wakes late
in the night gets back every readout, every guest's message, your cast
thread and every card still waiting; only the busy rooms are cut to
their last few hundred lines.

## The NOW card

The card pinned at the top is what the story wants from your character
right now: *NOW: Door duty: scan every pass in the Optical Drive · 1/2*.
The title gets two lines, and up to three of its to-dos sit under it,
always in view. A to-do the story tracks shows a grey check box that
ticks itself (you can't tap it); one the story can't see is a white box
you tick yourself (the tick stays on this phone). The ▾ button drops the
rest: the brief, any more to-dos, which buttons the objective puts on a
guest's card, and **More objectives (n)** when more than one is live. It
folds again when you tap elsewhere or open a room. With nothing live it
shows your character. The story moves it on by itself as the night
goes: there is nothing to dismiss.

## Scanning guests

Tap **📷 Scan**. The scanner fills the screen with the camera on, and a
box under it to type a guest's id (it's under their QR). Point it at a
guest's pass: **that guest's card opens at once**. Press what you need,
then **📷 Next guest** (or ×, or Escape) and the camera is back for the
next pass; × on the camera closes the scanner. The camera stays on the
whole time the scanner is open, so a queue scans pass after pass. The
pass you just closed is ignored for a few seconds, so it never reopens
by itself, and a scan tapped twice counts once. It needs the https
address, on iPhone and Android.

A scan fires your character's story for that guest; what the story
answers shows on the card, and anything it wants you to *say or do*
arrives as your direction.

## The guest card

You also open a card from **🗂 Guests** (search by name or id; each row
shows the guest's two most important facts), by tapping a guest's name
in any room, or from a room's 👥 list. Top to bottom:

- **The facts.** The loud ones first: *✗ Not cleared* for a guest who
  hasn't been through the door, and in red marked and in the Internet.
  Then the warnings in yellow (late, Bathroom Mode, ⛔ restricted), then
  where they are (📍) and the story's other flags.
- **The face: at most three buttons**, the ones your objective needs and
  that make sense for this guest right now, each with what it does; the
  first wears a heavy frame. A button the story offers only for some
  guests (🩹 Unmark on a marked program) joins the face on those guests'
  cards.
- **What the press came to**, on the card itself: the story's reply, what
  your character said to them, and in a refused style any `# hosts` line
  saying why it was not done (*Not done: …*). With none of these it says
  *✔ Sent — no reply from the story*.
- **💬 Message**, **📓 Share lore…**, **📡 Scan again**, and **Earlier
  readouts (n)** about this guest.
- **All buttons… (n)**: every other button you may press, with what it
  does; ones the story isn't offering right now say *Not on offer now*
  (you can still press them; the story may refuse). When the face is
  empty the card says *Nothing your objective needs on X right now* and
  opens a short list by itself.

Pressing a button acts *as your character*, on that guest, and the card
redraws with the story's answer. Right after the card changes, taps are
ignored for a moment, so a quick second tap never lands on a different
button. A button the story gives to **another** character only (the
server-room watch's patch-bay buttons, the Antivirus' 🛡 / ✅ / 👁) isn't
on your card at all: the server would refuse it from your booth (*not
your button …*). Rooms themselves stay clean: just the conversation and
your composer.

**Some buttons take two taps.** A button with no way back — one that
ends the night, trips an alarm, hands over a secret or plays a
once-a-night moment — **arms** on the first tap (it turns black and
says *Tap again to fire*) and fires on the second. Tap again within
four seconds; a very fast double tap only arms it. Leave it and it
disarms by itself. The guest's own buttons in their Start menu work the
same way when the story marks them so.

## Readouts and messages

**Readouts** is a pinned room of everything the story tells your booth
alone: *⏰ X is late*, *🚨 X is marked for reinstallation*, the answer to
a scan. Newest first; a readout about a guest has a **🪪 Name ›** button
that opens their card. Readouts survive a reload. A readout about the
guest whose card is open shows on the card instead of interrupting you.

When a guest types to your character, their thread appears under
**Messages**, just below Readouts, until you've read it; a balloon by
the tray says so (**Take me there**), and the 🗂 Guests button's badge
counts the guests waiting on an unread message. What you type in their
thread lands as your character's message to them. The **broadcast
feed** posts to the main room — everyone hears it.

## Alerts in your booth

Your booth chimes and shows an alert sent to everyone, to your
character, or into a staff room (`# hosts`), and any readout you didn't
ask for — "⏰ *Name* is late", a private warning. A booth never takes
the whole screen: an alert to everyone is a **balloon tip** by the tray
that goes away by itself, and one to your character or a staff room is a
yellow **banner** that stays until you tap it (**Dismiss all** clears a
pile). While the scanner or a card is open, a big alert shows as a
balloon over it and its banner waits until you close the card. An alert
the story sends to **one guest** or **one room** (a guest's own pinned
*🚨 GO TO THE INTERNET*, the lights going out in a room) doesn't banner
your booth: your cue is the readout. Tap the app once after signing in
so it may make sound (iPhones never buzz — watch for the banner).

Anything you missed while the phone slept, or dismissed without reading,
counts in the tray as **🔔 n** and replays when you wake the phone, in
order. Keep the phone awake with **⊞ Start → Keep my screen on**.

On an Android phone, tap **🔔 Get alerts → Turn on** (or **⊞ Start → Get
alerts**) and allow notifications: house-wide alerts and alerts pinned
in a staff room, the server-room (patch-bay) alarm, the late list and a
transfer waiting for your approval then reach you as notifications
even with the phone locked in your pocket; tapping one opens where it
landed (a readout opens Readouts). An alert the story sends to **one
guest** — their own pinned *🚨 GO TO THE INTERNET* — never pushes your
booth. On an iPhone, if the card shows **Get alerts on your iPhone**:
tap Share → **Add to Home Screen**, then **⊞ Start → Sign out** (that
frees your part) and sign in from the Home Screen icon (a part is one
phone's; a host's or the director's ⏏ Release frees one that's stuck),
and tap 🔔 there. If it says **Your iPhone can't get alerts**, keep the
screen on.

## Pinned lines, and a guest who is restricted

A room can carry a **pinned line** above its conversation — a standing
notice the story put there, up until the story clears it. At *Trapped
in the Internet* the `# quarantine` room pins one escort task per
program marked for reinstallation (*🚨 Escort Excel to the Internet —
chose Dare…*), and it comes down with a ✅ when the program is captured,
released, or unmarked.

A guest the story has **restricted** shows **⛔ restricted** on their
card and their row in 🗂 Guests: their phone is greyed out, its buttons
are off, they can't post in rooms or check in, and they keep only their
own feed (with the pinned 🚨 line), their private messages, their pinned
rooms and the places the story named. Their thread with you still works
— talk to them there. In the show, that is a marked program: your
readout says why, and the escort is yours.

## Judging filed facts

Guests hand a character an answer on a **📝 File a fact** card instead
of saying it (see [Filing a fact](quests.md)): a question, the answer,
and a confidence slider. The **server judges it** the moment it is
filed, against the story's answer key — *accurate*, a *confident lie*
(wrong at 100%), or *uncertain* (wrong below) — and the story reacts at
once; nothing waits for a host. The one exception is a **near miss**: an
answer close to the key but not exact (*Dr Whiskars* for *Doctor
Whiskers*, a number written out, the right answer with a few more
words). An abbreviation (*Dr. Whiskers*) is simply accurate. A near
miss is never judged a lie or a guess by itself: it is *proposed
accurate*, a ⚠ line in `# hosts` names the answer it is close to, and it
waits for a person (you, with the buttons below, a host's Judge tab, or
the director's Judging card). At *Trapped in the Internet* Trabolta
rules on it first when his laptop is online: `# hosts` says *… asked
Trabolta to rule*, then *🤖 Trabolta ruled …* with his verdict and
reason, and the story reacts as if a host had pressed. You only step in
when you disagree. If nobody judges it, it counts as accurate when the
round closes. At *Trapped in the Internet* the `# hosts` room shows each
filing as it lands ("📝 *Name* filed H5 (round 2 Q2): *answer* —
certain. Judged lie."). The story's buttons on that guest's card —
**📝 Filed fact: accurate** / **confident lie** / **uncertain (a
guess)** — are the **override**: press one when the key is wrong or a
spelling was unfair, and the story takes your word over the judge's.
Your button judges that guest's **latest** filing. If they have filed
more than once and an earlier one is still waiting, *Trapped in the
Internet* turns your press down (*📝 Not judged: … has an earlier
filing still waiting for a verdict. Judge it on Run → Mind → Judging …*)
and changes nothing: ask a host, whose Judge tab lists each filing, or
the director. When judging is switched to *review*, every verdict is a
proposal until one of those buttons (or a host, or the director)
confirms it. The guest gets the same reply either way — only the story
knows what the verdict was.

## Your character's own rooms

Under **Pinned** your booth has the character's own **📜 Quest Log**
(the story can hand your character quests — a staff brief, step by
step, in its own thread each), its **📓 Codex** (what your character
knows, and can share from a guest's card; **⊞ Start → What … knows**
lists it too), and a **Wallet** when your character audits the story's
currency (below). The staff rooms, `# hosts` and `# quarantine` at the
show, sit just under them, marked *staff only*. Cards the story deals
to your character land in **Readouts**: answer one like a guest would —
a poll, a yes / no — and the story hears it *as your character*.

## Approving transfers

If your character is the story's **auditor** (at *Trapped in the
Internet*, CRA Agent Software), the tray shows **🧾 n** while transfers
wait on you (tap it to open your Wallet), and your **Wallet** room lists
them as cards: *🧾 Excel → Winamp: 40 Truthcoin. Waiting for your
approval* with **Approve** / **Deny**, or *settles in 42 s unless you
deny it* with **Deny** alone. Every third transfer anyone sends waits
for your Approve (or goes through by itself after five minutes, if you
never answer); every other one settles by itself at the end of its
window unless you deny it first. A denial is refunded to the sender and
the card says you did it. Trades of lore for coin never pass you; a
request someone pays does. A held transfer pushes your phone even when
it is locked (Android, with alerts on). Elaborate security questions are
encouraged; the story cannot freeze anyone's balance for you.

## Rooms

Every place is a room, and the list says who's standing in each — the
same view the guests have, minus the "you are here" (a character is
everywhere). Empty rooms fold under **Other rooms (n)**. Authored
channels work like the guest app: post as your character, invite guests
into gated rooms, leave when the scene's done. Lines the story sends to
one guest privately (their arrival, a whisper) are theirs alone; you see
only what your character says or what plays to a room.

## Moderator powers

If the host gave you the **moderator passcode**, open **⊞ Start → Add
moderator powers**, type it and tap **Become an admin**. Your booth
becomes a host's — the NEXT bar and console ([The host
console](hosts.md)) — and additionally can:

- **🔒 Capture / 🔓 Release** any guest from their card (for stories
  that use it).
- **Hide/show** any message in any thread (moderation).
- Press another character's buttons, when the story hears the press.

Use it like stage management, not like power — the story's operator can
see everything you do.
