# Wave 59 contract: the shared teleprompter, and his lines wait for it

2026-10-31. The ask, in the user's words: *"Clippy gets the teleprompter and
Trabolta says the lines, but he does not wait for Clippy — What if the teleprompter
arrow (the "current line", I think?) could fire these lines? … And perhaps this
could be distributed! … Anyone in the scene can control the teleprompter, but if
someone is scrolling it is locked while they are still holding (pressing) it.
Trabolta's line also lock the teleprompter and autoscroll it."*

New words are `DRAFT w59`. Branch `oct31-w59/prompter`. Not shipped. It needs a
release, and every phone and the TV reloaded. An old phone is safe: it never says
it is there, so nothing waits for it. An old TV is safe too: the hold is on the
server. It only polls slower, so he starts up to a second late.

## The shape of it

A beat marked `aloud:` still lands whole, in one commit: every line in the chat at
once, its cues and branches done. Only the **voice** waits. Nothing here touches the
sim or the journal, so a replay is unchanged. Everything is memory only.

`core/server/prompter.ts` is the whole of it, transport-free with an injected clock.

## C1. The scene

One commit's marked lines, sections as the phone builds them (`scriptOf`): `beat` +
`ts`, and a section where no reader says anything is dropped, so a ceremony he hosted
has no scene and just plays. `id` is the first seq + 1 (never 0, which a phone reads
as none). Each line has `who` (a reader, or an owner: anyone else with a line) and
`his` (`mind: external`). A newer scene ends the older (`superseded`), and whatever
of his was still held plays first. What a reader hadn't got to is C10.

His unmarked lines in the same room after the scene's first line (`Second Hunt` →
the generated `Hunt Two Questions` → `Hunt Two Go`) go with the run before them.

## C2. The hold

`Prompters.heldFrom(channel)`: the first of his lines that may not play yet.
`voiceLinesOf` ends the timeline just before it, `head` included, so a TV's cursor
can never pass it, and everything behind it plays in order once it goes. A TV that
boots during a hold starts behind it. `voice.held` makes a TV poll every 300 ms
(`HELD_POLL_MS`). A run is his lines from one up to the next line someone says: a
stage direction between two of his lines is in the run, since nobody reads it out
and nothing would ever move past it.

Because it cuts the room's whole timeline, a hold would also swallow anything after
it. So **the story going on lets it go**: a commit with no scene of its own that adds
a scripted line of his to the scene's room (`Prompters.outrun`: a `dialogue`, so
`beat` is present, a string or null) frees the hold, everything plays in order, and
the prompter carries on. 🕚's *The Y2K Clock* and the overshare beats go this way. A
live line (`say`: a Talk reply, a director speaking as him, with no `beat` at all)
stays queued behind the hold, so a reply can't dump a reader's script.

## C3. One position

In **words from the scene's start**, so it means the same at every font size. The
server owns it: `pos` at `at`, then `rate` words a second up to `stop`, which is his
next unsaid line. A phone adds `rate` from a frame's arrival, and turns words into
pixels along its own lines (`yOfPos`, `posOfY`). Autoscroll is the server's too, so it
carries on if the phone that pressed ▶ dies. Nothing can scroll past his line: it
stops there and fires it.

## C4. The route

`POST /e/:id/api/aloud {scene, op, pos?, on?, speed?}`, a booth's or a guest's token.
Ops: `here {open}`, `press`, `move`, `letgo`, `jump`, `play {on, speed}`, `done`.
Not `/api/guest/*`: it posts nothing into the story, and a locked program's script
still scrolls. Refusals are 409 `prompter: locked | no scene | not in the scene`, 400
for a bad body, 401 for no session. A phone never shows one: it reads the next frame.

`POST /api/mod/aloud {action: release | done}`, for a director, and a host through
the allowlist. `release` lets every line of his left play and the prompter carries
on. `done` ends the scene.

## C5. The frame

SSE `prompter`, to the scene (readers, owners), every host booth and every director,
never a lean house tool. `{id, rev, pos, rate, stop, total, playing, speed, holder,
speaking, held, done?, superseded?, script?}`. `script` comes with a scene's first
frame and a stream's first, not with every move. A stream's first frame is `null`
with no scene, or for someone outside it. `ModView.prompter`, `HostView.prompter` and
the director phone's lean read carry `PrompterStatus`, a line about the scene with no
script in it.

## C6. His line

When the position reaches a run, its lines go to the TV, and the prompter locks for
everyone and scrolls through them at the rate the words allow (`spokenMs`). The time
starts over when the TV reports he has opened his mouth (`sp=`), never a step back on
screen. It frees when:

- a live, unmuted TV's `said` passes the run, once half the time has gone (a `said`
  sooner than that is a mute or a skip);
- no live TV, or a muted one: when the time is up;
- a live TV that never finishes: the time plus 6 s, or plus 60% if longer.

## C7. The lock

`press` locks it to whoever pressed; the others see *🔒 X has it* and their text and
controls stop. A finger resting says so every 1.5 s, and one silent for
`HOLDER_TTL_MS` (4 s) lets go. His line takes the lock from a finger. A finger holds
an autoscroll and it carries on after.

## C8. The night never hangs

- No reader's stream open as the beat lands, or closed in the last 45 s (an iPhone's
  page sleeps and drops it within seconds): no hold at all.
- A reader online but no phone says `here` within `HOLD_WAIT_MS` (8 s): the beat plays
  as it always did. This is what carries an old build, and a phone left asleep.
  `pnpm sim`'s bots hold no booth stream, so they never wait at all.
- A phone says `here` every 4 s while the pop-up or the prompter is on a visible page.
  No reader saying so for `HERE_TTL_MS` (12 s): the hold lets go.
- Anyone else with it open (a host or an owner who joined) keeps a hold only while
  they drive it: a finger on it, a press or a move of theirs in the last `DRIVE_TTL_MS`
  (20 s), or an autoscroll on its way to him. A host reading for a dead phone keeps
  it; one who joined to watch and left the phone awake doesn't.
- A scripted line of his that isn't in the scene (C2).
- ▶ from a host's Show, the director phone or Run. ✓ Done from a joined prompter.
- A scene left up with nobody at it is no reason to wait for anything: `reading()` is
  what the costume asks, and it's true only with a line of his waiting or saying, a
  finger, an autoscroll, or a move in the last `DRIVE_TTL_MS`. `active` stays on until
  the next marked beat.
- A restart forgets the scene, and the rest of the lines play (the TV's cursor is
  behind them). The phones go back to wave 55's own script.

## C9. Who's in the scene

The `aloud:` readers get the phone-filling pop-up, as in wave 55. Anyone else with a
line in the beat (`owners`) gets a small card and a push (`aloudLinePush`): the line,
*✓ I'll just say it* and *📜 Join the teleprompter*. A host gets a line on Show with
📜 Join. ✓ Done from a reader with another reader still on, or from an owner, only
leaves; from the last reader or a host, it ends the scene and marks it read on every
phone in it.

## C10. A newer scene over unread lines

A scene's prompter shows only that scene. When one takes over from another, what the
reader hadn't reached stays theirs (wave 55's guarantee):

- `store.ended` has the ended scene's first line and the line it had `reached`, read
  from its last frame's `pos`. `markPast` moves the mark to it only if a prompter was
  open on this phone, and only if no line of theirs behind that scene is still unread:
  the mark is one number, so it stays below the oldest unread line.
- `linesBehind` is those lines, from the mark up to the scene's first line, in
  sections holding a line of theirs; a cue alone owes nothing. The prompter raises *↑ n
  earlier lines*, and a sheet shows them, with a scroll of its own that leaves the shared
  position alone. *✓ Read them* moves the mark past them.
- ✓ Done moves the mark only past what this phone showed. Left unread, the pop-up
  comes back, and the phone's own script (the whole night, as in wave 55) opens at the
  first unread line. The scene they read is in that script too, and goes on that ✓ Done.
- A scene read to its end owes nothing, ✓ Done or not.

## C11. Her last line is his cue

`Clippy On Trabolta` has no line of his: his speech is `introduce_trabolta`, a press,
because it wakes him. So there is nothing for the arrow to reach. `PrompterDeps.finished`
says a scene is over, once: the position reached `total` (a scroll, an autoscroll
running out; never with a line of his still to say), or a reader's ✓ Done closed it.
A newer scene taking over, a host's ✓ Done, a director's or Run's close, and a restart
are not an end. A host driving for a dead phone gets there by scrolling.

The runtime's `sceneFinished` fires `introduce_trabolta` through `deskFire`, the same
`commit("signal", …)` + `fanout` as a host's press, read as `📜 Teleprompter`, for that
beat alone (`HANDOVER_BEAT`), unless `Night.trabolta_introduced` is already true. Either
order is safe. 🤖 first: the end does nothing and says nothing. The arrow first: 🤖
reads *Trabolta is already online. Nothing happens.* in `# hosts`, which is true, and
the cue sheet shows the press as a refused one.

Nothing about the beat changed. The end block is `--aloud-tail` tall, so at any text
size the last scroll puts the arrow past the last line and `sharedPos` reads `total`.
No reader online, a phone on an old build, or a restart mid-read: nothing fires, and
🤖 is the way, which is how the bots go.

## Tests

`core/test/w59-prompter.test.ts` (the hold, the lock, every way past it),
`core/test/w59-prompter-server.test.ts` (the real show and runtime),
`play/test/w59-prompter.test.tsx`, and `scripts/sim/prompter.spec.ts` (two phones and
the real TV page in Chromium, on a scratch server).
