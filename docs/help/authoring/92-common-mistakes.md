---
title: Common mistakes
section: Reference
order: 92
keywords: mistakes, errors, troubleshooting, gotchas, faq, why, broken, diagnostics, tabs, indentation
---

- **Indentation must be consistent.** A dialogue line has to be
  indented under its speaker; a choice's content under the choice. Use
  spaces — **a tab in the indent is an error** (`L1001`). Two spaces per
  step is the convention.
- **Speakers are CAPITALISED — and any all-caps line is a speaker.**
  `WREN` is a speaker cue; `Wren` is the declared character. It cuts
  both ways: an all-caps narration line (`SLAM.`) will be read as a
  speaker cue. Use mixed case for narration.
- **`=` changes a value; `==` compares.** `<set: x = 5>` assigns;
  `<if: x == 5>` tests.
- **A divert needs a real target.** `-> ringng` (a typo) has nowhere to
  go — the story graph shows it as a red ghost node; double-click the
  ghost to create the beat, or fix the name.
- **`*` disappears, `+` stays.** If a choice you expected is gone on a
  second visit, it was probably a `*`.
- **`SELF` needs an owner.** It works in a beat a character owns (or
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
- **Colons in prose are fine** — a property line needs a simple
  one-word key right at the start of the line (`key: value`), so
  ordinary sentences with colons aren't misread.
- **Nothing seems to happen on `<fire: x>`?** Something must be
  listening — a `on x` hook on a character or role. Check the Director
  page's named-event list: if your event isn't there, no hook declares
  it.
