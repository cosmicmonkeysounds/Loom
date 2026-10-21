---
title: Common mistakes
section: Reference
order: 92
keywords: mistakes, errors, troubleshooting, gotchas, faq, why, broken, diagnostics, tabs, indentation, speaker, colon, underscores, watcher
---

- **Indentation must be consistent.** A speech block's lines go under
  their speaker; a choice's content under the choice; an `if`'s body
  under the `if`. Use spaces — **a tab in the indent is an error**
  (`L1001`). Two spaces per step is the convention.
- **A Capitalised word and a colon is a speaker.** `Note: the bell has
  not rung.` reads as a character called Note. Start the line with `\`
  to force prose (`\Note: …`), or write the note as a `//` comment. It
  cuts both ways: an all-caps narration line (`SLAM.`) is a speaker cue
  too — use mixed case for narration.
- **A speaker head is one to three words, then `: ` with a space.**
  `Dr Sable Quill: …` speaks; a four-word name needs the ALL-CAPS cue.
  `Ivo:You came back.` (no space) is prose.
- **Block verbs need their trailing colon.** `if coins > 5` is prose;
  `if coins > 5:` is logic. The same goes for `else:`, `match v:`,
  `each visit:`, `after cond:`, `otherwise:`, and every `when …:`.
- **Verbs are lowercase at the start of the line.** `Set coins = 10`
  and `If you look closely…` are narration. That's deliberate — prose
  starts with a capital.
- **`=` changes a value; `==` compares.** `set x = 5` assigns;
  `if x == 5:` tests.
- **Multi-word names in expressions use underscores.** `-> Ivo Marsh`
  and `Ivo Marsh:` are fine, but inside a condition or a `set` path an
  identifier can't hold a space: `set Ivo_Marsh.trusts.guest += 5`,
  `if guest.group == The_Collectors:`. Both spellings are the same name.
- **Keep `.`, `/`, `#`, ` with `, and ` as ` out of beat names.** They
  are divert qualifiers and tails — `-> Tea with Ivo` reads as a divert
  to `Tea` with parameters.
- **A divert needs a real target.** `-> The Front Gat` (a typo) has
  nowhere to go — the story graph shows it as a red ghost node;
  double-click the ghost to create the beat, or fix the name. Case and
  spacing don't matter; letters do.
- **`*` disappears, `+` stays.** If a choice you expected is gone on a
  second visit, it was probably a `*`.
- **`Self:` needs an owner.** It works in a beat a character owns (or
  one reached through them); in a plain beat it falls back to the first
  `cast:` member — with no cast either, name the speaker.
- **Traits don't act alone.** A `TRAIT` is a template — nothing happens
  until a `CHARACTER` wears it with `is`.
- **Keep the `is` clause on one line.** A trailing comma or unbalanced
  parenthesis raises *unterminated mixin clause* (`L1008`).
- **A choice needs text.** A bare `*` line is an error (`L1003`).
- **`slot:` keeps its colon, `fill` doesn't.** `slot: pitch` is a
  labelled blank; `fill pitch` opens the block that fills it.
- **Every `slot:` needs a `fill`.** An unfilled hole is the *unfilled
  derived slot* diagnostic; a trait parameter you never supply is
  *required param unfilled*.
- **A pool needs `max:`, an axis needs `mode:`, a cohort needs
  `capacity:`.** The diagnostics (`L1112`, `L1110`, `L1142`) point at
  the exact line.
- **Colons in prose are fine** — only a *name-shaped* head right at the
  start of the line makes a speaker, and a lowercase `key: value` is a
  property, so ordinary sentences with colons aren't misread.
- **Nothing happens on `fire x`?** Something must be listening — a
  `when x:` hook on a character or role. And the reverse: a `when x:`
  that nothing ever `fire`s is a rule that never runs. Check the Run
  cockpit's named-event list: if your event isn't there, no hook declares
  it.
- **Watchers fire on the edge only.** `when self.suspicion >= 70:` runs
  once when the value *crosses* 70, then waits for it to drop below
  before it can fire again. If you want it to fire every time the
  value changes, react to the `set` instead (a named event after it).
- **`move` needs `to`, `add` needs `to`, `remove` needs `from`.**
  `move guest The Cellar` is prose; `move guest to The Cellar` moves
  them. A verb that doesn't fit its shape is silently narration — the
  editor's *statement shape* hint points these out.
- **`GROUP` rooms need the group to be public.** A `hidden: true` group
  has no room until you `reveal` it — that's the point.
- **An event name of two plain words may hear only the first.**
  `when glitch out:` listens for the event `glitch` with `out` as its
  subject, so pressing the `glitch out` button runs nothing. Write
  `when glitch_out:`; lint `L1212` points these out.
- **End every audience's objectives with a fallback.** The first live
  `OBJECTIVE` is NOW, so a guest whose objectives are all off gets only
  the open room's name (or the story's title) in the NOW bar, and a
  booth's NOW card just its character's name. Put the urgent ones first and finish each `for:`
  with one that has no `while:`.
- **A booth objective can't read the guest.** In an objective `for:` a
  character, `program.…` reads nothing (the booth's NOW is the same for
  every guest it scans). Put the per-guest test on each button's own
  `while:`, which the card reads with the scanned guest bound.
- **One pop-up per beat.** A `loud: true` objective and an `!` alert from
  the same cue both interrupt: at the `dialog` level that is two boxes
  for one moment. Pick one.
- **`admin: true` belongs on the CHARACTER.** On a TRAIT every character
  wearing it becomes a host part (a shared `TRAIT Host` would make
  Clippy one too). `L1211` warns when nobody can sign in as it at all.
- **`alerts:` only counts in the first file's header.** Anywhere else it
  is ignored (`L1210`), and the level is read from `Night.alerts`.
- **`with go:` needs a quoted text.** `reply Sent to the Internet. with go:
  The Internet` shows those words, *with go:* and all; write `reply "Sent to
  the Internet." with go: The Internet`. A `broadcast` also needs its `to`
  scope before the `with`. `L1214` points both out, and a `go:` word that
  names nothing (it's dropped). `go: lobby` is never an exit.
- **A big moment for the whole house stops every phone.** `broadcast
  "!!…" to everyone` belongs in an admin cue's own `when` or a story rule,
  with `with close: 6s`; anywhere else `L1218` asks if you meant it. For one
  person, `reply !!…`.
- **`reinstall:` replaces the default.** Without it a captured or restricted
  guest may enter the reinstallation games; with it only your condition
  counts, so include `program.corrupted == true` (or your capture flag)
  yourself.
- **A claim path is a character, not a name.** In a CHARACTER or TRAIT
  hook, `set program.escort_by = self` (the character); `self.name` is
  empty there.
- **`~` and `!` don't mix.** A cue that starts with `!` is an alert and
  never folds; a `~` notice needs a leading emoji to fold by, and the
  person it is about still needs their own `reply`.
