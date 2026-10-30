# SIGNOFF — wave 53: everyone uploads, and the phones say the announcements

**Status: DRAFT.** Branch `oct31-w53/everyone-uploads`. Not shipped. The
contract is [`docs/loom-w53-contract.md`](../../../docs/loom-w53-contract.md).

Your words, verbatim:

> let's make sure that \*everybody\* has to do the Uploading process, including
> Clippy, Antiviruses, and Hosts. I would also like announcements to come
> through everyone's phones using Text-To-Speech, if possible. this is opt-in,
> and can be turned off from the Start menu (and also turned back on).

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| U-1 | **The upload is the phone's, the door isn't** | Staff do everything on the phone and skip the door scan. The Antivirus are the door: the first one has nobody to scan them. They leave by a staff door. |
| U-2 | **It takes over the booth** | From a part's first sign-in the booth is nothing but the upload, until it's done. Do it before the doors: it works while the event is paused, once the show has gone live. |
| U-3 | **The same form for staff** | They get the problem form and the deposit box like a pool program, with no invitation shortcut. The answers go nowhere public and never reach Trabolta. |
| U-4 | **Staff get no Truthcoin** | Their score is their ⭐, so 100 would be a head start. |
| U-5 | **A real deposit is your call** | The story asks every part to leave something in the box by the door. Nothing physical changes unless you want it to. |
| U-6 | **⏭ Wave the staff through their upload** | A new Anytime cue for a phone that can't finish, or a booth a guest is waiting on. It frees every part still in the upload, and any part not signed in yet. |
| U-7 | **A director's play-as never uploads** | A booth opened in Run → Players stays a booth. |
| V-1 | **What is spoken** | What the house speakers say (the story's `do announce`, 5 lines) and a host's or director's 📣 Announce to everyone. Not the story's other banners. |
| V-2 | **Where you opt in** | A 🔊 card in the upload, between 🎥 and the inbox, for guests and staff, or ⊞ Start any time. Off until asked. |
| V-3 | **The switch belongs to the phone** | It stays on that phone across a reload. The story and the server never know. |
| V-4 | **🔇 + the announcement cuts the phones too** | The same button that stops the speakers. |
| V-5 | **The phone's own voice** | Whatever voice the device has, in English. No choice of voice. |
| V-6 | **The director phone is left out** | It has no Start menu. Run is where a director is. |

## 2. New words on a phone (`DRAFT w53`)

**Task Manager, to a part only**

- *Staff are not paid in Truthcoin. Noted. Fine.*
- *Installation complete. Your booth is ready. I am always running. That is the whole job.*
- *A real question, for your human self. The house is being filmed tonight, and afterwards the humans who run it may share some of the video. If you would rather not be in it, say so here. Tell a director if you change your mind.*

**Task Manager, to everyone**

- *One setting. The house makes announcements. This phone can say them out loud as well, if you want it to. You can change this any time from START.*
- *Noted. This phone speaks when the house speaks. START turns it off.*
- *Noted. This phone stays quiet. START turns it on.*

**The Uploader, to a part**

- *Staff door, {name}. Nobody scans the scanners. Go to work.*

**The card**

- *🔊 Say the house announcements out loud on this phone?* · *Yes, say them out loud* · *No, keep it quiet*

**The phone, aloud, when it is turned on**

- *This phone will say the house announcements.*

**⊞ Start**

- *🔇 Say announcements out loud* · *🔊 Announcements out loud (tap to stop)*

**The booth's stage**

- *Not you?* · *Tap to sign out*

**The cue**

- *⏭ Wave the staff through their upload*

## 3. What only a real phone can tell you

Chromium ran all of it at phone size, with `speechSynthesis` logged, not heard.
Before the doors, on a real iPhone and a real Android phone:

1. Say yes on the 🔊 card: you should hear *This phone will say the house announcements.*
2. Reload the page, tap anywhere once, and fire a 📣: it should speak.
3. Try it with the iPhone's silent switch on.
4. Lock the phone and fire a 📣: expect silence, and that it stays silent when you wake it.
5. Try it with several phones in one room: they will not be in step with the speakers or each other.
