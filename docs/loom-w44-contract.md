# Wave 44 contract: video consent, Help Me, the credits

2026-10-29. The ask: *"1) On uploading, guests have an option to opt-out of
us using any video we record of them. 2) When guests are being
reinstalled, there should be a button for "Help Me" that pings the hosts
to the reinstallation tent. 3) No matter the ending, at the very very end
of everything there should be a Credits sequence -- make the people and
their roles a JSON file so we can edit it easily."*

All new show text is `DRAFT w44` (sheet: `SIGNOFF-w44.md`).

Lanes (branches `oct31-w44/<lane>`, merged `--no-ff`):

| Lane | Owns |
|---|---|
| `contract` | this file, `core/src/credits.ts`, the show's `credits.json` |
| `story` | the story (`login.loom`, `main.loom`, `objectives.loom` if needed); `core/server/credits.ts` (new), `core/server/routes/video.ts` (new), `core/server/event-runtime.ts`, `core/server/views.ts`, `core/scripts/sync-example.ts`, `core/scripts/loomcheck.ts`; `reinstall/web/` (the Help Me button, C9); their tests; docs, help and the sign-off sheet at integration |
| `play` | the phone's credits roll (C7): `play/src/credits/` (new, lazy), `play/src/types.ts`, the Start item, their tests |
| `terminal` | the TV and the walls' credits scene (C8): `terminal/src/cutscene/scenes/credits.tsx` (new) + its registry line, `?preview=credits`, their tests |
| `editor` | Run's cards (C10): `editor/src/components/run/VideoConsentCard.tsx`, `CreditsCard.tsx` (new), `RunPage.tsx`, `editor/src/lib/api.ts`, their tests |

## C1 The story: video consent

- `ROLE Program` gains `video: text? = none` (`"ok"` / `"out"`; `"none"`
  = the card not answered: an opt-out, so video may be used), listed in
  `secret:` (never in an agent request).
- `== Upload Deposit` deals a `poll` card just before the inbox card:
  `show poll "🎥 May video of you from tonight be used?" to program with
  options: "Yes, use video of me | No, leave me out"`. It never holds the
  upload up (a menu there would stall every scripted upload: the tests,
  the bots, the replays). `when poll answered for program` sets the slot
  from the two choices (their own words, so never a vote or the bottle).
- Two guest buttons in ⊞ Start change it any time after the upload
  (never on a locked phone: no `restricted: allow`):
  `INTERACTION video_leave_me_out` (`🎥 Leave me out of the video`,
  `while: program.uploaded == true and program.video != "out"`) and
  `INTERACTION video_use_me` (`🎥 Video of me is OK`,
  `while: program.video == "out"`). Each sets the slot and replies.

## C2 The story: Help Me

- `INTERACTION tent_help_me`: label `🆘 Help Me`, `who: guest`,
  `restricted: allow` (so the locked phone shows it), `while:
  program.corrupted == true and Night.banish != true`.
- `when tent_help_me for program` (ROLE Program): not corrupted → a
  reply, nothing else. Within 60 story seconds of their last ask →
  *help is already on the way*, no new alert. Otherwise sets
  `program.help_at = Time.elapsed`, counts `program.help_asks`, replies
  to the guest and posts a `!` alert (pinned + pushed on every booth) to
  `# hosts` naming the program and the tent.
- The tent's devices fire the same button for the program they are
  serving (C9). No new server route.

## C3 The story: the credits

- G11 (`resurrection`) ends on the credits: in place of the screensaver
  it cues `screens_credits` with `Night.screen = "credits"`,
  `Night.terminals = "credits"`, and starts a roll:
  `set Night.credits_roll += 1`, `set Night.credits_at = Time.elapsed`.
  Every ending reaches G11 (a night with no ceremony presses G1 first),
  so every night ends on them.
- `INTERACTION roll_the_credits` (G12, `🎬 Roll the credits again`,
  `who: admin`, `sequence: false`, `while: Night.resurrected == true`)
  rolls them again the same way.
- The credits slide is a `screens_*` slide, so it beats attract (Trabolta
  is asleep by then) and holds until the next slide cue.

## C4 `credits.json` (`core/src/credits.ts`, `@loom/core/credits`)

The schema, `parseCredits`, `creditsProblems`, `creditsView`,
`creditsRows`, `creditsRollMs` and the constants are in the module (read
its header). A row with a blank `name` is left out; a `programs: true`
section lists the night's programs. Browser-safe: play and the terminal
import it by relative path.

## C5 The server: the credits

- **Source** (`core/server/credits.ts`, `CreditsSource`): read live, cached
  ≤ 5 s, never journaled, never snapshotted: (1) the event's project file
  `credits.json` (`ProjectLink.readFile`, new and optional), else (2)
  `LOOM_CREDITS` (a path), else (3) the default scenario's own
  `credits.json` when the event plays the default scenario (LAN mode). An
  unreadable or unusable file reads as none (logged once per text).
  Editing the project file shows on the next roll with no reload.
- **`GET /api/credits`** (any token: mod, prime or guest). Mod (terminals,
  Run, a host booth) always; prime and guest only once
  `Night.credits_roll` ≥ 1, else 403 `{"error": "not_yet"}`. 404
  `{"error": "no_credits"}` with no file. 200 `CreditsView`, `programs`
  = every guest on the roster who joined (not a persona, not `gone`),
  by name. A mod answer adds `source` (`project` / `env` / `scenario`)
  and `problems` (`creditsProblems`). `Cache-Control: no-store`.
- **`NightView.credits?: {roll: number, at: number}`**: `roll` =
  `Night.credits_roll`, `at` = `Night.credits_at` × 1000 (story ms, like
  `glitch.at`). Absent while the roll is 0 or unset. In every view that
  carries `night` (guest, booth, host, mod).
- **Screen state**: nothing new; the terminals read the slide value
  `credits` and fetch the route.
- **sync-show**: `credits.json` follows `facts.json`'s rule: always
  replaced (an example with none removes the project's). `loomcheck`
  reports `creditsProblems`.

## C6 The server: who opted out

- **`GET /api/mod/video`** (directors only; never on the host allowlist)
  → `VideoConsentView`:

  ```ts
  interface VideoConsentView {
    rows: VideoConsentRow[]; // every guest but personas, by name
    counts: { ok: number; out: number; unasked: number };
  }
  interface VideoConsentRow {
    id: string;
    name: string;
    video: "ok" | "out" | "unasked";
    /** ModView.avatars' serving key for this guest, or null. */
    avatar: string | null;
    /** `<id>.featured` when not "none". */
    featured?: string;
  }
  ```

- `GET /api/mod/video?format=csv` → `text/csv` (`program,video,id`, the
  same rows, `out` first), with `content-disposition: attachment;
  filename="video-consent.csv"`.
- The answers live in the journal (the `video` slot); a process restart
  replays them. End stops the event: download the list before End
  (SHOWNIGHT §8).

## C7 Play: the phone's roll

- A lazy chunk (`play/src/credits/`), never in the guest's first load.
- Auto: when `night.credits.roll` rises **live** (not on the first view
  after a load, and `at` within 60 s of the guest's story clock) the
  phone opens the roll full screen once per roll (remembered per event in
  the host storage, try/catch). It waits behind a `!!` takeover or the
  glitch, never over the pass.
- ⊞ Start gains `🎬 Credits` while `night.credits` is set (a guest and a
  player booth); it opens the same roll.
- The roll: `GET /api/credits` once per open, `creditsRows` scrolled at
  `creditsRollMs`, then the `end` lines held, with a ✕ (44 px) and Escape
  / Back to close at any time; a tap pauses / resumes. Reduced motion:
  no scroll, a list the guest scrolls. 403 `not_yet` / 404 / offline:
  a short *The credits aren't ready* card with ✕.

## C8 The terminal: the TV and the walls

- A slide scene for `{slide: "credits"}`, `ms: "hold"`, on `tv` and
  `wall`: it fetches `GET /e/<id>/api/credits` with the terminal's token
  once per slide `seq`, rolls `creditsRows` from the slide's `at` on the
  server clock (`t`, so a reload lands mid-roll) over `creditsRollMs`,
  then holds the `end` lines. Silent (no speech, no sfx on the TV). A
  failed fetch draws the title and end lines only.
- `?preview=credits` draws it with a fixture.

## C9 The tent: Help Me on the reinstall wizard and web game

- `reinstall/web`'s flow shows a `🆘 Help Me` button (48 px, a corner
  that covers neither the joystick nor the HUD) from the moment a program
  is chosen until the flow ends (choose, video, play, send), on the
  standalone device and inside the tent terminal.
- A tap posts `POST /api/mod/signal {name: "tent_help_me", subject:
  <guest id>, label: "Tent · <device name>"}` with the device's token,
  then shows *Help is on the way* for 60 s (the button reads *Help is
  coming…*, disabled). A failure shows *Couldn't call for help: wave at
  the tent's host*.
- VR is not changed this wave (a headset player can lift it off; the
  phone's button and the tent's host are there).

## C10 The editor: Run

- **🎥 Video consent** card (directors, on the Run page beside Letters):
  the counts, the opted-out guests first with their pictures and names,
  then the rest folded; `⬇ Download CSV` (the C6 csv); polls every 10 s
  while open.
- **🎬 Credits** card: reads `GET /api/credits` (mod), shows the roll as
  text with its problems (or *No credits.json in this project*), and a
  note that G12 rolls them again. No editing here: the project's
  `credits.json` is edited in Writing like any file.
