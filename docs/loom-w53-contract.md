# Wave 53 contract: everyone uploads, and the phones say the announcements

2026-10-30. The ask: *"let's make sure that \*everybody\* has to do the
Uploading process, including Clippy, Antiviruses, and Hosts. I would also like
announcements to come through everyone's phones using Text-To-Speech, if
possible. this is opt-in, and can be turned off from the Start menu (and also
turned back on)."*

All new show text is `DRAFT w53` (sheet: `SIGNOFF-w53.md`). Branch
`oct31-w53/everyone-uploads`. Not shipped: it changes the server, the story
and the phones, so it needs a release, `sync-show` with its reload, and every
phone reloaded.

## The shape of it

Performers stay what they were: **never Persons**. A phantom guest behind each
booth would reach 157 `Persons` comprehensions, the rosters, the wallets and the
door queue, the day before the show. Instead one generic rule was added to the
engine, and the story's own beats run on the character:

> A character bound as the subject while it stands in a `cutscene: true`
> location is **on rails** like a guest: a beat's lines, its menus and its
> cards reach that character's booth.

So there is one script. `Login`, `Upload` and `Upload Deposit` play to a guest
or a part alike, with `program` bound to either.

## C1. Arrival

- Header `arrival: <cond>` (`model.arrival`), read per character with `self`
  bound, like `lock:` per guest. A broken one is an error (L1216). The show:
  `arrival: self.arrived != true and Night.ended != true`.
- `PrimeView.arrive: true` while it holds (`views.ts` `arrivalDue`).
- `POST /api/prime/arrive` (booth token): while it holds, commits
  `signal("booth_arrived", character, {}, character)`, so only that part's own
  hooks hear it. Idempotent. It needs a sim, **not** open doors: the crew
  arrives first. 403 with no part, 409 with no sim.
- `TRAIT Staff` (`cast/kit.loom`, on `Greeter` and `Enforcer`, so all eight
  parts) answers: `move self to The Optical Drive`, `-> Login`.

## C2. On rails

- `Sim.move` takes a character: it sets `<id>.location` and nothing else (no
  occupants, no visited, no hooks). `Sim.subjectAudience` counts a character
  bound as the subject while `cutsceneFor` holds it; `self` alone never does,
  and off rails nothing about a line's audience changes.
- `chat.ts` addresses such a character's lines and picks `@<Character>`
  (`audienceOf`). `visibleToPrime`: a row in `dm:X` addressed `@Y` is Y's, so
  Task Manager's booth never reads another part's upload.
- `PrimeView.cutscene`, `location`, `choices`: `GuestView`'s twins, absent off
  rails.
- `POST /api/prime/choose` is the guest's `chooseFor`, for a part on rails only
  (409 `no choice` otherwise). `/api/prime/widget` also takes a part on rails
  while the doors are closed.
- Play: `booth/upload.tsx`. `useBoothRails` reports the arrival and reads
  `view.cutscene`; `PerformerApp` swaps the whole booth for `BoothUploadStage`,
  the guests' `CutsceneStage` with no My pass and a two-tap *Not you?* in its
  place. **Fail-open:** only the server's `cutscene` holds a booth, so a report
  that never lands leaves a working booth. An embedded pane (Run → Players)
  never reports and never goes on rails.

## C3. The story

`TRAIT Staff` mirrors ROLE Program's upload slots and hooks (`captcha`,
`answer`, `poll` and `email answered`). A card's answer reaches these hooks as
the part's own, but a **guest's** answer reaches every character's hook too, so
each opens on `program.staff == true`. A line in a hook only reaches a booth on
rails, so each is guarded by where the part stands: a late answer from Readouts
is kept and says nothing.

| | A guest | A part |
|---|---|---|
| CAPTCHA, the form, the deposit, the write-ins, the Terms Of Service | yes | the same beats |
| 100 Truthcoin | yes | no: its `score` is its ⭐ |
| The door queue, *Antivirus, confirm*, the pass, the scan | yes | no: nobody scans the scanners |
| 🎥 video, 🔊 voice, ✉ inbox | yes | yes |
| Leaves by | an Antivirus's scan | `Staff Door`, off the inbox card |

`Staff Door` counts `Kernel.staff_uploaded` (watch *Staff uploaded*) and moves
the part off rails; the booth keeps the stage until Continue. The inbox is last,
and the stage docks cards oldest first, so a part answers all three.

**⏭ `wave_staff_through`** (`act: Anytime`, `sequence: false`, never NEXT) is the
way past it for a phone that can't finish: every part on rails or not yet signed
in is through.

`private:` moved to `TRAIT Staff` (two traits can't both say it) and lists
`covert`, `caught`: every player is staff. Everything a part answers is private:
it never reaches Trabolta's worker.

## C4. The switch

`play/src/phone-voice.ts` (eager, so `//`, never `//!`). Per device
(`loom.phoneVoice`), off until asked, nothing on the server.

- The upload's card: `show poll … with …, optional: true, voice: true`. `Poll`
  reads `voice`: option 0 on, any other off, **inside the tap**, before the
  answer goes out. The story keeps nothing: Start can change it.
- ⊞ Start: `voiceStartItem`, on a guest's, a player's and a host's menu. It
  fires straight through (no `confirm`, no `arm`), so it too speaks in its tap.
  Absent when embedded or with no `speechSynthesis`.
- `setPhoneVoice(true)` says `PHONE_VOICE_HELLO` at once: that is the gesture a
  phone wants, and it proves the sound works. A page reloaded with it on primes
  on its next tap anywhere (`usePhoneVoice`).

## C5. The frame

SSE `announce`, to every guest and booth stream, never a mod's. `{text, at}`
(server epoch ms), or `{stop: true}`. Live only and never journaled: a phone that
missed one never hears it, and `phoneAnnounce` drops one older than
`ANNOUNCE_STALE_MS` (30 s: frames a sleeping phone was holding).

- Every story `do announce "…"` (what the house speakers say, `fanout`).
- A 📣 from a host or a director: `/api/mod/broadcast` with scope `all` /
  `everyone`, through `spokenAnnounce` (no alert mark, no emoji).
- `{stop: true}` on `/api/mod/audio/stop {announce: true}`.

A story `broadcast` is not spoken: the 5 lines `do announce` says are what the
house says aloud, and every phone reading every `!` line would be chaos.

Old clients ignore the frame; `EventSource` only hears what it names.

## C6. The lists

- `/api/mod/video` and its CSV list every part that declares the slot
  (`staff: true`, via `peek`, since `get` reads ROLE's default for every pool
  program). Run's card shows them with no change.
- `PrimeLetter.asked`: the part answered the inbox card, so the booth's own ask
  stays away (`letterCardState`). The card still changes an address on file.

## Found on the way

`answeredWidgets` was never cleared on a story restart. A guest's id dies with
the run so it never showed; a part's name does not and seqs start over, so a
second upload opened on a CAPTCHA reading *submitted*, the part stuck. Cleared in
`restart`; `restore` rebuilds it from the journal.

## Tests

`core/test/trapped-w53-staff-upload.test.ts` (the story),
`core/test/w53-server.test.ts` (the runtime), `play/test/w53-phone-voice.test.tsx`,
`play/test/w53-booth-upload.test.tsx`. Chromium at 390 × 844 ran a whole booth
upload, a declining guest, a real `do announce`, ⏭ and a restart. **Not proven on
a real phone:** `speechSynthesis` was logged, never heard.
