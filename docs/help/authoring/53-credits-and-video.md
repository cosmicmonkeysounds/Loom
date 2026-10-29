---
title: Credits, video consent and Help Me
section: Live Shows
order: 53
keywords: credits, credits.json, roll the credits, end credits, cast list, crew list, names, roles, thanks, the end, video, consent, opt out, opt-out, filmed, filming, footage, recording, csv, download, help me, help, tent, reinstallation, hosts, alert
---

Three things a live show can add at the edges of the night: a credits
roll at the very end, a video opt-out for every guest, and a Help Me
button for a guest who is stuck somewhere.

## The credits

Put a **`credits.json`** in the project, beside `facts.json`:

```json
{
  "title": "Trapped in the Internet",
  "subtitle": "Halloween, October 31 2026",
  "sections": [
    { "heading": "The staff", "people": [{ "role": "Clippy", "name": "Brooke" }] },
    { "heading": "Starring the programs", "programs": true },
    { "heading": "Thanks", "lines": ["Everyone who came."] }
  ],
  "end": ["Thank you for playing."]
}
```

- `people` are rows of a **role** and a **name**. A row with an empty
  name is left out of the roll, so a part nobody has filled yet can wait
  in the file.
- `lines` are plain lines (a thanks, a dedication).
- `"programs": true` fills that section with every guest who played
  that night, by the name they played (never a director's persona, never
  one marked gone).
- `end` is the last card, held after the roll.

The server reads the file **live**: edit it in Writing and the next roll
shows the change, with no reload and no Push draft. `sync-show` replaces
the project's copy with the repo's, like `facts.json`.

The story starts a roll by setting two values and cueing the slide:

```loom
cue screens_credits
set Night.screen = "credits"
set Night.terminals = "credits"
set Night.credits_roll += 1
set Night.credits_at = Time.elapsed
```

The TV and the wall terminals roll them on the `credits` slide (it holds
until the next screen cue), and every phone rolls them once, then keeps
them under **⊞ Start → 🎬 Credits**. In *Trapped in the Internet* G11 🎃
does this after any ending, and G12 🎬 rolls them again.

**Run → 🎬 Credits** shows the roll as text, where the file came from and
anything wrong with it. A file the roll can't use shows *No
credits.json in this project*. `loomcheck` reports the same problems.

## Video consent

The upload deals a card to every guest:

```loom
show poll "🎥 May video of you from tonight be used?" to program with options: "Yes, use video of me | No, leave me out"
```

The answer goes into the guest's secret `video` slot (`"ok"` / `"out"`),
and two guest buttons in ⊞ Start change it all night. The card never
holds the upload up: a guest who never answers has not opted out.

**Run → 🎥 Video consent** lists every program, the opted-out first with
their pictures, and **⬇ Download CSV** saves `video-consent.csv`
(`program,video,id`). Download it **before End**: End stops the event.

## Help Me

`🆘 Help Me` is a `restricted: allow` guest button, so it stays on a
locked phone beside 🚻 Bathroom Mode. In the show it is offered while a
program is being reinstalled, and the tent's wizard and web game show
the same button in their corner. A press posts a `!` alert to `# hosts`
(pinned and pushed on every booth) naming the program and where they
are; a second press within a minute only reassures the guest.
