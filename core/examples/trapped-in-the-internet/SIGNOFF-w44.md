# SIGNOFF — wave 44: video consent, Help Me, the credits

**Status: DRAFT.** Branches `oct31-w44/*`, contract
[`docs/loom-w44-contract.md`](../../../docs/loom-w44-contract.md). Not shipped.

Your words, verbatim:

> let's add a few features to Trapped in the Internet: 1) On uploading,
> guests have an option to opt-out of us using any video we record of them.
> 2) When guests are being reinstalled, there should be a button for "Help
> Me" that pings the hosts to the reinstallation tent. 3) No matter the
> ending, at the very very end of everything there should be a Credits
> sequence -- make the people and their roles a JSON file so we can edit it
> easily.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| V-1 | **A card, not a question the upload waits on** | The 🎥 card comes just before the inbox card. Nobody is held at the door by it, and the bots, tests and replays still play the upload unchanged. |
| V-2 | **Not answering = video may be used** | An opt-out, as asked. Run's list shows these as *not asked yet*, separately from *OK*. |
| V-3 | **⊞ Start changes it all night** | *🎥 Leave me out of the video* / *🎥 Video of me is OK* (one at a time). Not on a locked phone. |
| V-4 | **The list is Run → 🎥 Video consent**, with a CSV | Directors only, never a host's phone. Download it before End (SHOWNIGHT §8). |
| H-1 | **Help Me is on the locked phone and the tent's screen** | Beside 🚻 on the phone; in the top-right corner of the wizard, the video and the game. Not in VR: a headset player lifts it off, and the tent's host is there. |
| H-2 | **One alert a minute per program** | A second press within 60 s tells the guest help is coming; # hosts isn't pinged again. |
| H-3 | **The alert goes to # hosts with `!`** | Pinned and pushed on every booth (the Antivirus see it too). It says "the Internet, out in the backyard", never "tent" (the rain night's shed). |
| H-4 | **Only while being reinstalled** | Captured (locked), or marked at the tent's screen. Not on a banished night (everyone is in there, hosts included), not as a party favour after the ending. |
| C-1 | **G11 rolls the credits** | In place of the screensaver, on the TV, every wall and every phone. G12 🎬 (appended last: no cue number moved) rolls them again. |
| C-2 | **`credits.json` is read live** | Edit it in Writing on the night and the next roll has it; `sync-show` replaces it with the repo's copy. A blank name is left out of the roll. |
| C-3 | **"Starring the programs" is the night's guests** | By the program they played, sorted; never a director's persona or one marked gone. |
| C-4 | **The TV is silent during the roll** | No voice, no sounds: the afterparty music plays on. |

## 2. The words (all `DRAFT w44`)

| Where | Text |
|---|---|
| `beats/login.loom`, Task Manager | A real question, for your human self. The house is being filmed tonight, and afterwards the humans who run it may share some of the video. If you would rather not be in it, say so here. You can change it any time from START. |
| the card | 🎥 May video of you from tonight be used? · *Yes, use video of me* · *No, leave me out* |
| `main.loom`, Task Manager (card answered) | Noted. No video of you will be used. / Noted. You may appear in the video. |
| ⊞ Start buttons | 🎥 Leave me out of the video · 🎥 Video of me is OK |
| their replies | 🎥 Noted: no video of you will be used. Change it any time from START. / 🎥 Noted: video of you may be used. Change it any time from START. |
| the phone's button | 🆘 Help Me |
| its replies | 🆘 Help is on the way. A host is coming out to the Internet. Stay where you are. / 🆘 Help is already on the way. Stay where you are. / You are not being reinstalled. For help with the app, message Task Manager. |
| `# hosts` | 🆘 HELP ME: {program} needs a host in the Internet, out in the backyard where the reinstallation is. Go now. |
| the tent's button | 🆘 Help Me · 🆘 Calling… · 🆘 Help is coming… · Help is on the way. Stay where you are. · Couldn't call for help: wave at the tent's host. |
| G12 | G12 · 🎬 Roll the credits again · (too early, in # hosts) 🎬 The credits roll at G11, once the show is over. Nothing happens. |
| the phone's roll | 🎬 Credits (Start) · Loading the credits… · The credits aren't ready: They roll at the very end of the night. / Check back in a minute. / Check the connection, then try again. · Tap to pause · Paused · tap to go on · The credits didn't load. |
| the TV / walls | THE END · Thank you for playing. (the card when the scene can't load, and the fallback without a file) |
| `credits.json` | The names and parts, from the README's casting table. **Blank on purpose:** McAfee Anti-Virus, the second director, the tech operator, the house manager. "Written and directed by: John" and "Jean Trabolta: as himself" are guesses: change them. |
