# Wave 26: the contract

Wave 26 is the last big pass before *Trapped in the Internet* on Oct 31. It
adds the first glitch on every screen and phone, the locked phone for a
program being reinstalled, a guest BINGO, the void, the heart and the virus
in the reinstallation games, voice-timed cutscenes, and it takes the hints out
of the show text.

This file is binding for every wave 26 lane. When this file and the code
disagree, fix one of them in the same change. The decisions in §1 are the
user's (2026-10-26) or the defaults they did not veto; a lane that wants to
change one asks first. Everything here was checked against master at
`8d3a44d1`.

Lanes, branches and worktrees:

| Stage | Lane | Branch | Worktree |
|---|---|---|---|
| A (parallel, merged to master before B starts) | house | `oct31-w26/house` | `.claude/worktrees/w26-house` |
| A | engine | `oct31-w26/engine` | `.claude/worktrees/w26-engine` |
| B (parallel, after A is on master) | spatial | `oct31-w26/spatial` | `.claude/worktrees/w26-spatial` |
| B | story | `oct31-w26/story` | `.claude/worktrees/w26-story` |
| B | help | `oct31-w26/help` | `.claude/worktrees/w26-help` |
| B | play | `oct31-w26/play` | `.claude/worktrees/w26-play` |
| B | terminal | `oct31-w26/terminal` | `.claude/worktrees/w26-terminal` |
| B | voice | `oct31-w26/voice` | `.claude/worktrees/w26-voice` |
| B | web | `oct31-w26/web` | `.claude/worktrees/w26-web` |
| B | vr | `oct31-w26/vr` | `.claude/worktrees/w26-vr` |
| then | integration | `oct31-w26/integration` | `.claude/worktrees/w26-integration` |
| then | docs / status | on master after integration | |

Merge each lane into master with `--no-ff`, many Conventional Commits per
lane, never one uncommitted blob. Stage A merges house first, then engine.
Stage B merges in this order: spatial, story, play, terminal, voice, web,
vr, help (help last, because it describes everyone else's behaviour).

---

## 1. The notes and what was decided

### G1 No hints in the show text (story, terminal, web, vr)

Hidden mechanics are never stated up front. That covers the filing judgement
rule (accurate / confident / guess), the exemptions (what excuses a summons,
what keeps you safe), the routes to the door code, the King ↔ chess link and
the CAPTCHA twist. They go from show text, cutscenes, objectives, codex
cards meant for guests, the Trabolta worker brief and the game copy. Rules a
guest needs in order to play stay: how Bingo, Truth Pong, the casino and the
hunt work, and Clippy's own line that a Truth Pong miss is reinstalled.
After-the-fact verdicts stay too: Trabolta's "A guess is a symptom of
corruption…" after each question, the `~🤷` notices, the 🚨 mark reason and
the results rows. The filing-window cutscene keeps its three-stamp timing
but stamps in-fiction steps. Clippy's First Moment of Truth opener becomes a
single DRAFT line that explains nothing, for example "Every answer you filed
with Trabolta will be judged. Trabolta knows best!". Clippy's private codex
card and printed pack say "never say the rules out loud", and keep the rule
privately for her. The Y2K Hour loses its door-code sentence and its "Have
the door code" checklist row. Finish Your Upload stops promising a failed
check. Every changed line carries `// DRAFT w26` and goes on
`SIGNOFF-w26.md`. **Owners:** story (`.loom`, objectives, codex, cast packs,
`trabolta.mind.md` / `trabolta.persona.md`), terminal (act1 / act2 copy),
web (the `flow.tsx` King note), vr (`KING_NOTICE` and HUD hint copy).

### G2 The guest help guide stops explaining the machinery (help, web, terminal, vr)

The guest articles (`docs/help/play/*` with no `role:`) keep only how to work
the phone, the terminals and the game controls, in the computer's own voice.
They never name director, crew, operator, performer, costume, booth, server,
editor, Run, moderator or passcode. They never explain a hidden rule, never
spoil a later beat or an ending, and never mention the void, the in-game
heart or the virus pickup. The cut material moves to a new performer-only
article `docs/help/play/19-house-workings.md` (`role: performer`). The crew
provisioning moves to a new authoring article
`docs/help/authoring/48-terminal-setup.md`. The shared reinstall status copy
changes in all three games (C12). The `role: host` audience (option D) is
not in this wave. **Owners:** help (every help file and the help tests), web
/ terminal / vr (the status copy in C12 and its tests).

### T1 A calm idle show until the first glitch (terminal)

Every idle surface (walls awake and asleep, the TV attract, the tent's
backdrop) runs a calm rate until the 📺 ad hijack. That means about one ad
per two-minute cycle, a popup every 18–39 s, at most two on screen, no
storms and no ad-like popups. Calm is `pool ∈ {early, hunt}` from
`Night.phase` (`idleContextOf`), which is exactly "before `second_hunt_preview`".
After the hijack the current rate stays (malware is the flood), so the
contrast reads as the ads taking over. No wire change. **Owner:** terminal.

### T2 The first glitch takes over everything (engine, story, terminal, play)

The first glitch is the director's 📺 `second_hunt_preview`. In that one
story rule a journaled glitch signal (C3) hits:

- **every terminal**: TV, walls awake or asleep, room terminals, chess,
  casino and the tent. It is an 8 s overlay that piloting, `bare` and peek
  never suppress, and it covers a pilot or a game without ending it;
- **every phone**: guests (locked ones included), player booths (Clippy,
  the four Anti-Viruses) and featured programs get a ~6 s takeover that
  swallows taps;
- **host booths**: a 2.5 s look-only version with pointer-events off, so a
  cue is never blocked;
- **never** the director phone or the editor's Run.

It plays once, live. A reload, a late reconnect or a restart replay never
plays it. `ad_hijack` becomes a persistent slide (the walls stay hijacked
until the next screen cue). The reinstallation games do not glitch. No new
house sound or light in this wave. **Owners:** engine (wire), story (the
rule's lines), terminal (the overlay), play (the takeover).

### T3 The tent terminal is a scan kiosk (terminal)

Between walks, the tent laptop (`spot=tent`, view `reinstall`) shows a
centred Win98 *Reinstallation Wizard* card:

- the large live camera preview, using the one shared stream and never a
  second `getUserMedia`;
- an always-visible typed-name field, autofocused only when idle;
- the "IN THE INTERNET NOW" quick picks as 48 px buttons.

The idle show runs behind the card as a dimmed quiet backdrop (`quiet` in
`IdleContext`: no storms except while hijacked or glitching, at most one
popup, no attention dings, no face layout). The station drops its world pane
and keeps a one-line "N REINSTALLING". It gets no story slides, no countdown
corner and no Y2K clock. Overlays, beat cutscenes and the T2 glitch still
play. A `tablet_*` cue becomes an in-card status line, not a modal.
**Owner:** terminal.

### R1 The captured guest's phone is locked (engine, story, play)

From capture (🛡, or the tent's `reinstallation begun`) until release, a
program's phone is **locked**. Only 🎟 Show my pass and 🚻 Bathroom Mode
(with Back from the bathroom) work. DMs do not work either: no posting
anywhere, no menus, no cards, no wallet, no codex, no check-in. The server
refuses all of it (C2), and the phone shows a lock screen. The capture
pop-up and the CORRUPTION DETECTED moment both offer exactly *Show my pass*
and *Bathroom Mode*, with no OK and no *Go to the Internet* (C1, `ack:
none`). A banished night (everyone in the Internet at once) is not a
reinstallation and does not lock. **Owners:** engine (C1, C2), story (the
`lock:` header and the two moments), play (the lock screen, `noAck`).

### R2 The path to Gerald appears after a minute (house, web, vr)

For the first 60 s of each game session (`PATH_REVEAL_MS`, C5), both games
hide the chevron trail, the compass pip, the distance and the
warmer/colder ladder. The HUD reads just FIND GERALD. Then a short notice
appears and the trail draws at once. The minute restarts on a re-scan (it
is per session, client side). Gerald's quack is not a path indicator and is
not delayed, in either game. The autopilot and the trail tests ignore the
delay. **Owners:** house (the constant and its port), web, vr.

### R3 No King bar on the web HUD (web, vr)

The web game drops `KingBar`'s meter, label, stage line and kneeling line.
It keeps the ⚔ HIT button while near him and the transient notices. The bar
over his head (`@loom/house/three` `drawBar`, VR `HealthBar`) is the only
King display. VR changes no code; it adds a regression check that the HUD
never carries King hit points. **Owners:** web, vr.

### R4 The void (house, spatial, story, web, vr)

Walking out through the mud room's exterior door (`front`, room
`optical-drive`) is allowed in both games: the web walker gets an outside
ground like VR's. Once a player is `ESCAPE_M` (5 m) past the house walls on
that floor, every time and even before Trabolta's reveal, this happens:

1. a big jump scare (at most one hard flash, nothing faster than 3 Hz, no
   forced camera motion in VR);
2. a teleport back to the in-game tent spawn;
3. Trabolta chastises, spoken in-game with captions (C6 `lines`);
4. −5 trust per attempt (`program.escapes`, C9);
5. a 20 s cooldown per session.

The game teleports even when the server refuses (doors closed, an old
server). **Owners:** house (escape geometry and ports), spatial (C6), story
(C9 lines and trust), web, vr.

### R5 Terminals link to the Internet by room (house, spatial, terminal, web, vr)

A terminal shows and transmits the Internet (world view, its camera into the
game, its mic to and from the players) only while a reinstalled player is in
that terminal spot's room in the game. That means strictly the same room,
with a 0.75 m doorway hysteresis (`presenceRoom`, C5). The TV
(`desktop-tv`, room `desktop`) follows the same rule. With several players,
every occupied room is linked. The server is the judge: `spot.here` in the
screen state (C4), per-room voice routing and per-room camera lists (C8).
Clients may add a 3 s linger (`PRESENCE_LINGER_MS`) so a doorway crossing
never flickers. Dedicated `mirror` / `shadow` spectator views stay
always-on. **Owners:** house (rule), spatial (server), terminal (gating),
web / vr (camera picks).

### R6 Trabolta's heart in the game (house, spatial, story, web, vr)

Once the King has fallen, the in-game server room shows Trabolta's heart (a
`heart` prop, C5). It is a dark rack with a slowly beating glowing core, and
it carries no labels, rows or colours that could hint at the patch bay. The
first time a program reaches it in a night, a short DRAFT monologue in his
fiction plays, spoken in-game (device TTS, else captions only). It is
flavour only and sets `program.sim_heart`. The terminals' world view draws
the heart too, but only while the King is fallen. **Owners:** house, spatial
(C6), story (C9), web, vr.

### R7 The virus pickup (house, spatial, story, web, vr)

A floppy-disk `pickup` prop (`item: "virus"`, C5) sits in the game all night.
Any program in the game may pick it up. The pickup unlocks the same codex
entry the tent QR gives: Free Antivirus Trial for a paranoid Excel,
ILOVEYOU for everyone else. The story's existing `learns` rules then set
`carries_virus`, send the Truther Download line and move Excel's quest. Only
Excel's plant counts for his quest, through the existing `plant_the_virus`
rule, which already refuses inside the Internet. The printed tent QRs stay
as the backup. The disk is never drawn on the terminals or in the map
editor's world preview. **Owners:** house, spatial (C6), story (C9), web,
vr.

### R8 VR audio and the mic (vr)

The Quest game gets sound of its own:

- an `Sfx` bus with synthesised quack (positional, on the duck), fanfare,
  buzz, thud, scare and a quiet hum;
- terminal voices that play;
- Trabolta's in-game lines (TTS when the device has a voice, else captions).

While any game sound plays, the voice gate is raised (`VoiceLink.hold_for`),
so the Quest mic never sends the game's own sound to the terminals. The mic
state becomes legible: emoji-free actionable HUD strings (C12), a logcat
line on every mic change, and a lobby mic line with **TEST MIC** (a level
meter, no session needed), **ASK AGAIN** and a build stamp. The mic stays
open by default. **Owner:** vr.

### V1 Cutscenes wait for his voice (engine, voice)

On the TV, Trabolta's speech is the clock for the voiced parts of a scene.
The picture holds before each sentence until he starts it, and the TV shows
the sentence he is actually speaking (the scene's typed copy is only the
fallback). The voice lane builds this on a speech bus, a pure `voiceClock`
and `VOICE_SCENES` (C11). A stretch is capped so a stuck voice never wedges
the moment queue. Phase 2, the walls following a poll behind, ships only if
it is feasible this wave; its wire (`sp=` → `tvSpeech`, C4) lands in Stage A
either way. **Owners:** voice, engine (the phase 2 wire).

### V2 Pauses in his speech (voice)

The `SpeechQueue` pauses 0.3 s between sentences (`CHUNK_GAP_MS`) and 0.7 s
between lines (`LINE_GAP_MS`), never after the last line. The pause is
adjustable per screen in ⚙ with a `pause` multiplier (URL key `pause=`,
default 1). A spaced em/en dash speaks as a pause. On the TV the default
voice speed is 0.92 (a provisioning default; ⚙ still overrides it).
Announcements use `{chunk: 250, line: 0}`. **Owner:** voice.

### V3 "Antivirus" is said "Anti Virus" (voice, vr, web)

There is one shared pronunciation table (C10). Every TTS path says "Anti
Virus": the terminal `SpeechQueue` (TV, rooms, piloted chat, announcements,
Setup, and the web game, which uses the same engine), stagehand
`localvoice` (the house router and Alexa), and the VR game's TTS. The
display text stays "Antivirus" everywhere. **Owners:** voice (table, terminal
and stagehand), vr (reads the table).

### B1 A guest calls BINGO (story)

`INTERACTION call_bingo` (🎱 BINGO!, `who: guest`, `arm: true`) is on the Play
Computer Bingo objective while `Night.step == 2`. It goes straight to the
results: it records the caller and the exact time left, then fires
`bingo_time`. The cue sheet ticks V3 as LAST *by story*, and Clippy gets
*Check The Bingo* targeting the caller. A host-pressed ⏰ works as today.
**Owner:** story.

### B2 Undo a false BINGO (story)

`INTERACTION not_a_bingo` (↩ Not a Bingo), pressed on the caller's card by
Clippy, a host or a director, puts the night back exactly. It restores phase
`bingo`, step 2 and `bingo_end = Time.elapsed + Night.bingo_left`, and the
countdowns come back. It is offered only before any 🎱 / 🎯 / 🤐. The quest
completions move out of `bingo_time` into the end of the round (B5), and
`bingo_time` becomes `repeat: true` with `while: Night.step == 2`, so NEXT
reads ⏰ again after an undo. **Owner:** story.

### B3 The winner may name nobody (story, play)

`INTERACTION named_nobody` (🤐 Names nobody at the centre square, Clippy, on
the winner) records the refusal and ends the round. PLAYER SELECT shows ① 🎱
② 🎀 ③ 🎯 ④ 🤐. Nobody is marked automatically. The SAME pre-select reads the
most recent earlier pick, not just the previous step. ⭐ +5 for Clippy
(DRAFT). **Owners:** story, play (`booth/pick/select.tsx`).

### B4 Clippy may pick the winner as the one who doesn't like AI (play)

On a destructive step (🎯), an earlier pick's tile keeps its label but is
not disabled. The two-tap arm stays the guard. No story change. **Owner:**
play.

### B5 One round only (story, play)

`Night.bingo_done` closes the round at the first 🎯, the first 🤐, a
Bingo-phase capture, or (belt and braces) `introduce_trabolta`. After that,
🎱 / 🎯 / 🃏 are not live and Clippy's NOW is *After The Bingo*. The booth
closes an open PLAYER SELECT when its objective leaves the view and never
offers "+ Another round" for an ended objective. Several 🎱 are fine before
the round closes. **Owners:** story, play.

### P1 The fact card never squishes the chat (play)

There is one answer surface at a time. While a story menu is docked, the
composer folds to a one-line 48 px "⌨ Message …" button, and the menu opens
before a 📝 card (a Mission "File a fact" jump still opens the card). The
thread always keeps ≥ 96 px. The foot is capped at 62 %, the tray body at 34
dvh and the options at 36 dvh, and every footer button is ≥ 48 px. A
half-typed draft survives fold and unfold. CSS-first. The guest first load
stays ≤ 148 kB. **Owner:** play.

### P2 The performer bar is the guest's bar (play)

A player or host booth (`windowed`) uses the guest taskbar rules:
`--taskbar-h: 56px`, equal flexible windows from 48 to 120 px, Scan as a
normal-width primary, and the tray capped at two items under 430 px in
priority order 🔔 → 🚨 → held receipt → countdown → ⭐ / act → clock.
**Owner:** play.

### D1 A Dare makes Trabolta make a scene (story, terminal, voice)

Both Dare paths (the phone poll and Clippy's 🎩 fallback) go through one
per-program event, `dare_taken`. It does three things:

- **Public scene.** It fires `dare_scene`, which plays `== Dare Chosen` in
  The Desktop: 2–3 DRAFT Trabolta lines, read by the TV voice, in which he
  orders the Anti-Viruses to bring the dared program to the Internet.
- **Mark and loud order.** It marks the program (`chose Dare`). The
  Anti-Virus booths get a loud Dare-specific 🚨 order. The scan and 🛡 stay
  the capture.
- **The dared phone.** It gets a big "🎩 Trabolta is not amused…" moment
  with only *Show my pass* (`ack: none`).

The TV / wall scene keys on the beat (`dare_chosen`). The old `chose_dare`
signal scene is retired. **Owners:** story, terminal (the scene), voice (its
`VOICE_SCENES` entry).

---

## 2. The contracts

Every wire change is **additive**: a new optional field, a new route, a new
header key. Nothing is renamed or removed on the wire.

### C1 `ack: none` → `ChatMessage.noAck`

A moment tail gains one key: `with go: …, ack: none`. `none` is the only
value; anything else is ignored.

- `core/src/go.ts`: `MomentArgs` gains `ack: "none" | null`, and
  `splitMomentArgs` parses it (case-insensitive key and value). It is not
  passed through `rest`.
- `core/src/runtime/sim/sim.ts` `momentArgs` returns
  `{ go?, close?, noAck?: true }`.
- `core/src/runtime/sim/event.ts`: `broadcast`, `respond` and `widget` gain
  `noAck?: true`.
- `core/server/chat.ts`: the draft gains `noAck?: true`, copied from the
  event on every path that copies `go` (beside `autoCloseOf`).

```ts
// core/server/chat.ts ChatMessage, and the mirror in play/src/types.ts
/** `with ack: none` (wave 26, R1): the big moment has no acknowledge
 *  button; only its exits close it. Absent = the usual OK. */
noAck?: true;
```

Play honours it only on a `big` moment with at least one resolved exit for
this viewer. Otherwise it shows the usual OK: a guest is never trapped, and
the NM-F1 fallback still applies. `BigFallback` (the chunk failed) keeps
its OK. LSP lint **L1226** (warning): `ack: none` with no `go:` in the same
tail. Banks ignore it.

Story use (story lane, DRAFT w26): the capture reply in `when captured:`
(non-banish branch) and the confrontation reply in `when confronted for
program:` both end `with go: pass as "🎟 Show my pass", go: go to the
bathroom, ack: none`.

### C2 The locked phone: the `lock:` header and `GuestView.locked`

A new story header key, evaluated per guest exactly like `reinstall:`:

```
lock: program.corrupted == true and Night.banish != true and Night.ended != true
```

The story lane writes this line in `main.loom` beside `reinstall:`.

- `core/src/runtime/sim/model.ts`: `SimModel.lock: string | null` (the first
  non-empty `lock:` wins, like `reinstall`).
- `core/server/views.ts` exports the pure helper:

```ts
/** Is this guest's phone locked (wave 26, R1)? The story's `lock:` header
 *  held for them (`sim.holds(cond, id, id)`); no header = never. */
export function isLocked(sim: Sim, id: string): boolean;
```

`GuestView` gains a field:

```ts
// core/server/views.ts GuestView; optional (`locked?: boolean`) in play/src/types.ts
/** The story's `lock:` header holds for this guest (wave 26, R1): only the
 *  pass and the `restricted: allow` buttons work; every write is refused,
 *  DMs included. Independent of `restricted`. */
locked: boolean;
```

While locked, `GuestView.interactions` keeps only the `restricted: allow`
ones (Bathroom Mode / Back from the bathroom), the same filter as
`restricted`. Everything else in the view is unchanged: the play lane
decides what to hide.

**Server refusals** (engine lane, `core/server/event-runtime.ts`). While
`isLocked(sim, id)`, every state-changing `/api/guest/*` route answers
`403 {"error": "locked"}` before any other check except the token check.
That covers:

- `say` (every channel, `dm:` included);
- `choose`, `widget`, `escape`, `join`, `defect`;
- `channel/invite`, `channel/leave`;
- `codex/redeem`, `codex/share`;
- every `wallet/*` sub-route;
- `picture`;
- the check-in route (`CHECKIN_ROUTE`);
- the recruit / invitation answers;
- `act`, unless the interaction is `restricted: allow`.

Open while locked: the GETs (state, stream), `act` on `restricted: allow`
interactions, and session housekeeping that posts nothing into the story
(register / rejoin / push subscription). The engine lane keeps the open set
as one exported constant, `LOCKED_OPEN`, with a test that walks every
`case "/api/guest/…"` and asserts each one is either in it or refuses. A
director's Run → Players pane and a terminal piloting a locked guest go
through the same routes, so they are refused the same way.

The lock is derived from story state. It is never journaled and never needs
an `unrestrict`: release (`self.corrupted = false`) lifts it on the next
snapshot.

**Story duty** (story lane): nothing waits on a locked phone. Remove the
three-option menu from `== The Tablet Video`'s corrupted branch (the lines
stay plain), and make sure the 🍾 bottle never picks a corrupted program.
Add `and program.corrupted != true` to `plant_the_virus`'s `while:`.
Everyone-polls during a capture simply go unanswered by the captured
program; that is acceptable.

**Play duty** (play lane): a locked guest sees a lock screen in place of the
windows. It has the title bar, a ⛔ QUARANTINED card (DRAFT copy), 🎟 Show my
pass, and Bathroom Mode / Back from the bathroom from `view.interactions`.
The moments layer (the capture big, the T2 takeover) still shows over it.
On a `403 locked` answer, play shows the lock screen; it never shows an
error toast. Keep the lock screen's JS out of the first load, or under
0.3 kB.

### C3 The glitch signal

**Story** (story lane, in `when second_hunt_preview:`'s success branch,
before `cue screens_ad_hijack`):

```
cue screens_glitch
set Night.glitch_at = Time.elapsed
set Night.glitch_text = "000. 000. 000."
```

Seeds at the doors (beside the other Night vars, `main.loom` ~5887):
`Night.glitch_at = 0`, `Night.glitch_text = "none"`. Both writes sit in one
rule, so they journal and replay together. The three zeroes are the
hijack's existing copy, so no new show text is needed. A new caption on a
takeover is `// DRAFT w26` and goes on the sign-off.

**Terminals** (engine lane, `core/server/routes/screen.ts`):

```ts
export type ScreenCueClass = "overlay" | "flicker" | "glitch" | "countdown" | "base" | "slide";
// screenCueClass("glitch") === "glitch"

export interface ScreenProgram {
  // …slide, overlay, blackout, flicker as today
  /** (wave 26, T2) The last glitch cue (`screens_glitch`, `tv_glitch`,
   *  `terminals_glitch`). Like `flicker`, it never touches slide or overlay.
   *  `at` follows the fold's rule: 0 for replayed history. */
  glitch: ScreenShot | null;
}
```

`foldProgram` sets `glitch` and leaves everything else alone. `ad_hijack`
joins `PERSISTENT_SLIDES`. An old terminal ignores `program.glitch`.

**Phones** (engine lane, `core/server/views.ts`):

```ts
export interface NightView {
  act: …; phase: string | null; step: number | null;
  /** (wave 26, T2) The story's last glitch: `Night.glitch_at` (story
   *  seconds) × 1000 as `at`, in the same unit as `GuestView.clock` (story
   *  ms); `text` from `Night.glitch_text` ("none" → null). Absent while
   *  `Night.glitch_at` is 0, unset or not a number. */
  glitch?: { at: number; text: string | null };
}
```

It rides `nightView(sim)` into `GuestView` and every `PrimeView` (players,
hosts, director). It is mirrored as optional in `play/src/types.ts`.

**Plays once** (the rules every surface follows):

- **Terminal** (terminal lane): `layers.glitch` shows only while
  `program.glitch.at > 0` and `serverNow − at < GLITCH_MS` (8000). History
  (`at: 0`) never shows. Blackout beats it. It shows on every view (TV,
  mirror, walls awake or asleep, room, chess, casino, reinstall, shadow),
  whether piloting, peeking or `bare`. It counts as `covered` (the idle show
  pauses) but not `takeover` (a pilot, a chess game or a tent walk keeps
  running underneath). It is CSS-only and in the main bundle. Flashes stay
  ≤ 3 Hz with no full-field red, and reduced motion shows a still frame.
  Sounds come only from the terminal synth library.
- **Phone** (play lane): a pure `takeoverDue(prevAt, glitch, clock, firstView)`
  is true only if all of these hold: `glitch.at > 0`; it differs from the
  last `at` this provider saw; this is not the first view (no reload or new
  sign-in); and `0 ≤ clock − glitch.at ≤ TAKEOVER_FRESH_MS` (15 000, story
  ms). The takeover is a lazy chunk with the existing 600 ms `<Glitch/>` as
  its fallback. It holds the moments queue for its length, so the `!📺`
  sticky lands right after it, not under it. Sound and buzz are skipped
  when the page is hidden, sound is off, or the app is embedded (Run →
  Players).
- **Who gets what**: guests and player booths get ~6 s, tap-swallowing. Host
  booths get 2.5 s with `pointer-events: none`. The director phone and
  Run get nothing.

### C4 Screen state additions (engine lane wires the shape; spatial lane feeds `here`)

```ts
// core/server/routes/screen.ts
export interface ScreenSpot {
  announce: boolean;
  /** (wave 26, R5) Live reinstalled players whose presence room (C5
   *  `presenceRoom`) is this spot's map room. Absent: the server can't tell
   *  (no spatial map or an old server); then fall back to `reinstalling`. */
  here?: number;
}
export interface ScreenPollExtras {
  results?: …; spotAnnounce?: …;
  /** (wave 26) Players in a spot's room now; wired by the runtime from the spatial hub. */
  spotHere?: (spot: string) => number | null;
}

// the screen state root
/** (wave 26, V1 phase 2) What the TV is speaking now: the newest `sp=` from
 *  a poller whose `view` is `tv`, stamped with the server's receive time.
 *  `chunk` null = that line is done. Memory only; null when no TV reported
 *  in the last 6 s. */
tvSpeech?: { seq: number; chunk: number | null; at: number } | null;
```

- The spot block is built when the poll names a spot and either extra
  exists. `reinstalling` (the house-wide total) stays.
- Heartbeat key `sp=<seq>:<chunk>` (`sp=812:2`), or `sp=<seq>:d` once the
  line is done. It is parsed beside `talk` / `said`, and only from a `view=tv`
  poller.
- Engine lane, terminal side: `terminal/src/screen.ts` parses
  `program.glitch` (`shotOf`), `spot.here`, `tvSpeech`, and adds `sp` to
  `SpeechReport` / `speechQuery`. The terminal and voice lanes then only
  consume them.
- `spotHere` is wired in `event-runtime.ts` by the spatial lane in Stage B.
  Until then it is absent and `here` is not sent.

### C5 `@loom/house` (house lane, Stage A)

New and changed exports, all from `house/src/index.ts`. Every pure rule the
server judges with and a game pre-checks with has a literal GDScript port in
`reinstall/vr/house/` and a golden fixture (`pnpm house:sync` copies them).

**Escape** (`house/src/escape.ts`, port `house_locate.gd` or a new
`house_escape.gd`):

```ts
export const ESCAPE_M = 5;              // trigger: plan metres past the walls
export const ESCAPE_SLACK = 0.5;        // the server accepts ESCAPE_M − ESCAPE_SLACK
export const ESCAPE_COOLDOWN_MS = 20_000;
export const OUTSIDE_GROUND_MARGIN = 30; // = VR GROUND_MARGIN
/** The walkable outside: the floor an exterior (b: null) door opens from,
 *  its elevation and the bounds of that floor's rooms grown by the margin.
 *  Null when the map has no exterior door. Same rect as VR `_build_ground`. */
export function outsideGround(house: HouseMap): { floor: string; y: number; rect: [number, number, number, number] } | null;
/** Null inside a room (`locate(...).room !== null`); else the plan distance
 *  to the nearest room boundary on `floorOf(p[1])`. */
export function voidDistance(house: HouseMap, p: Vec3): number | null;
```

**Presence** (`house/src/presence.ts`, port in `house_locate.gd`):

```ts
export const PRESENCE_HYSTERESIS_M = 0.75;
export const PRESENCE_LINGER_MS = 3000;   // client-side latch only
/** The room a player counts as being in: `locate(p).room`, except that a
 *  player still within PRESENCE_HYSTERESIS_M of `prev`'s polygon on the
 *  same floor stays in `prev`. Pure; the caller keeps `prev`. */
export function presenceRoom(house: HouseMap, p: Vec3, prev: string | null): string | null;
/** Map terminal ids whose `room` holds at least one of `rooms`. */
export function linkedSpots(house: HouseMap, rooms: Iterable<string | null>): Set<string>;
```

**Voice rule** (`house/src/voice.ts`, port in `reinstall/vr/net/voice_codec.gd`,
goldens regenerated):

- `hearsTerminals`: voice-on terminals whose `room === player.room` (the
  caller passes the presence room; `placed` falls back to `locate`), gain 1,
  the `VOICE_MAX_TERMINALS` nearest.
- `hearsPlayers`: players whose room is the terminal's room, gain 1, the
  `VOICE_MAX_PLAYERS` nearest.
- No plan-distance reach and no cross-room branch. The doorway hysteresis
  now comes from `presenceRoom`.
- `VoiceRouteOptions.keep` is removed (never deprecate) and its callers are
  fixed. That means `core/server/spatial-voice.ts` and its tests, which the
  house lane owns in Stage A for this change only.

**Path reveal** (`house/src/route.ts`, port `house_route.gd`):
`export const PATH_REVEAL_MS = 60_000;`.

**Prop kinds** (`house/src/types.ts`, `validate.ts`, `geometry.ts`):

```ts
export type PropKind = "box" | "cylinder" | "screen" | "label" | "king" | "heart" | "pickup";
export interface Prop {
  // …
  /** kind "pickup" only: what it is ("virus"). Required on a pickup, refused elsewhere. */
  item?: string;
  /** kind "heart" | "pickup" only: the story signal the server posts
   *  (defaults HEART_SIGNAL / PICKUP_SIGNAL). Refused on other kinds. */
  signal?: string;
}
export const ESCAPE_SIGNAL = "simulation escape attempt";
export const HEART_SIGNAL = "simulation heart reached";
export const PICKUP_SIGNAL = "simulation pickup taken";
export const HEART_INSET_M = 0.3;    // "reached": this far inside the heart's room
export const PICKUP_REACH_M = 0.9;   // plan reach, same floor, within DUCK_MAX_RISE
export const PICKUP_SLACK_M = 0.3;   // the server's extra reach
export function heartReached(house: HouseMap, feet: Vec3, heart: Prop): boolean; // same room, ≥ HEART_INSET_M inside
export function pickupReach(house: HouseMap, feet: Vec3, prop: Prop, slack?: number): boolean;
export function momentProp(house: HouseMap, id: string, kind: "heart" | "pickup"): Prop | null;
export function propSignal(prop: Prop): string; // prop.signal ?? the kind's default
```

`propSolid` is false for both new kinds by default. The king-only key check
stays king-only. A heart or pickup prop with a `label` is refused, because an
old APK would draw the label.

**Three** (`house/src/three/`). `heart.ts` `createHeart()` and `pickup.ts`
`createPickup(item)` (a spinning, bobbing 3.5" floppy with a sickly green
glow). `buildHouseScene` options:

- `ground?: boolean` (default false), a dark plane with a faint grid at
  `outsideGround`;
- `pickups?: boolean` (default false; the games pass true);
- the heart is always built but visible only while the map's King is fallen
  (`showKing` drives it).

`HouseScene.setPickupTaken(id, taken)` hides a disk for this viewer.

**The show maps** (`house.json`, `house.shed.json`, then `pnpm house:sync`):

- one `heart` prop, id `trabolta-heart`, in room `server-room`: standable,
  centred, off the patch bay and the rack;
- one `pickup` prop, id `virus-disk`, `item: "virus"`, in `hard-drive` or
  `fan-closet` (the house lane picks one that is standable, off the duck's
  usual route and never on a trail chevron).

Neither carries a `label`. The map editor (`reinstall/web/src/map/props.ts`,
`Inspector.tsx`) can place, move and edit both kinds (`item`, `signal`).

**GDScript** (house lane): ports of `voidDistance`, `outsideGround`,
`presenceRoom`, `heartReached`, `pickupReach`, the new voice rule,
`PATH_REVEAL_MS` and every new constant, with golden vectors at 1e-3. In
`house_builder.gd`, unknown kinds already fall through, so the house lane
only makes sure `heart` / `pickup` build nothing yet (the vr lane draws
them in Stage B).

### C6 The game moment route: `POST /api/spatial/moment`

**One route for escape, heart and pickup.** The investigators proposed both
`/api/spatial/moment` and separate `/escape` / `/heart` routes. The contract
picks one route. Why:

- The three share everything but the judge: the session-token check,
  401/410, `parked`, the doors-closed 409, the commit `by` the device, and
  handing back the story's lines.
- One route means one hub method, one client call per game (web
  `postMoment`, VR `link.moment(kind, prop)` on `_want_claim("moment")`),
  one answer shape and one test matrix.
- `kind` is a closed enum, so the routing stays explicit.

**Lines come back in the answer body.** They do not go out as a stream
frame. Why:

- The lines are private to that program: a DM, or the Truther Download line
  about a secret virus.
- The spatial stream fans out to every terminal and the TV mirror, so a
  `line` frame would leak them and need client-side filtering.
- The game already awaits this POST, so the stream, `terminal/src/world/stream.ts`
  and old APKs are untouched, and nothing has to be replayed.

Request (session token in `x-loom-token`, or `token` in the body, as for
`king/hit`):

```ts
type MomentRequest =
  | { kind: "escape" }
  | { kind: "heart"; prop: string }    // the heart prop's id
  | { kind: "pickup"; prop: string };  // the pickup prop's id
```

The game flushes its newest pose first (the server judges the session's
last pose), exactly as for `king/hit`.

Answers:

```ts
interface MomentLine { from: string; text: string }   // display text, never pronounced
// 200
type MomentOk =
  | { ok: true; kind: "escape"; lines: MomentLine[]; spawn: Spawn; cooldownMs: number }
  | { ok: true; kind: "heart"; lines: MomentLine[]; first: boolean }
  | { ok: true; kind: "pickup"; lines: MomentLine[]; item: string; prop: string };
```

| Status | Body | When | The game |
|---|---|---|---|
| 400 | `{error: "bad moment"}` | unknown `kind`, missing `prop` | gives up |
| 401 / 410 | `{error: "unknown session token"}` / `{error: "this session is over"}` | dead token | ends the game, as today |
| 404 | `{error: "no such prop"}` | `prop` missing or the wrong kind | gives up |
| 404 | (no JSON) | an **old server** without the route | escape: teleports, no penalty, no lines; heart / pickup: nothing |
| 409 | `{error: "doors are closed"}` | paused / before doors | escape: teleports, no penalty; heart / pickup: retries on the found backoff |
| 409 | `{error: "this session has not started — send a pose first"}` | parked | retries after a pose |
| 409 | `{error: "not out", distance}` | escape: `voidDistance < ESCAPE_M − ESCAPE_SLACK` | teleports anyway, no penalty |
| 409 | `{error: "cooldown", retryMs}` | escape within 20 s of the last for this session | teleports, no penalty |
| 409 | `{error: "sealed"}` | heart while the map's King stands | nothing |
| 409 | `{error: "not there"}` | heart: `!heartReached` on the last pose | retries when re-entering |
| 409 | `{error: "far", distance}` | pickup: `!pickupReach(…, PICKUP_SLACK_M)` | retries |
| 409 | `{error: "already"}` | heart heard by this guest tonight / pickup taken by this guest | heart: silent; pickup: hide the disk |

**Hub** (`core/server/spatial.ts`, spatial lane):

```ts
export type MomentKind = "escape" | "heart" | "pickup";
export type MomentOutcome =
  | { kind: "unknown" } | { kind: "over" } | { kind: "parked" } | { kind: "bad" } | { kind: "noProp" }
  | { kind: "notOut"; distance: number } | { kind: "cooldown"; retryMs: number }
  | { kind: "sealed" } | { kind: "notThere" } | { kind: "far"; distance: number } | { kind: "already" }
  | { kind: "ok"; spawn?: Spawn; first?: boolean; prop?: Prop };
moment(token: string | undefined, req: MomentRequest,
       commit: (s: SessionRef, signal: string, args: Record<string, string>) => void): MomentOutcome;
```

- **Escape**: claimed, `voidDistance(map.house, s.pose.p) ≥ ESCAPE_M −
  ESCAPE_SLACK`, past the per-session cooldown. Then the pose is re-seated at
  the map spawn and marked dirty (the terminals' ghosts jump back), and
  `commit(ref, ESCAPE_SIGNAL, {})` runs.
- **Heart**: the prop exists, is a heart, and the King is fallen (or the map
  has none). `heartReached` holds on the last pose and the guest is not in
  `heartHeard`. Then `commit(ref, propSignal(prop), {prop: id})`. Every
  later call answers `already` (`first: true` only on the first).
- **Pickup**: the prop exists, is a pickup, and `pickupReach` with slack
  holds. If the guest is already in `picked[prop]`, the answer is `already`.
  Otherwise `commit(ref, propSignal(prop), {item: prop.item, prop: id})`.
- **Memory only** (lost on restart, cleared on `reset`, documented in
  `core/CLAUDE.md`): `escapedAt` per session, `heartHeard: Set<guest>`,
  `picked: Map<prop, Set<guest>>`. The story's own guards (C9) keep the
  heart and the virus once-only across a restart.

**Runtime** (`core/server/event-runtime.ts`, spatial lane): `case
"/api/spatial/moment"` in `handleSpatialPost`. The commit is:

```ts
this.actingBy = s.device;
const msgs = this.fanout(this.commit("signal", signal, s.guest, args));
// lines: what that commit said to this program, in order
lines = msgs.filter((m) => m.kind === "line" && m.from !== "" && Array.isArray(m.audience) && m.audience.includes(s.guest))
            .map((m) => ({ from: m.from, text: m.text }));
```

The lines include ones the phone hides (a locked phone or a hidden agent):
the game is the surface here. Only dialogue produced inside that one commit
is returned, so in-game scenes must contain no `wait`, choice or widget.

**Assignment** (additive, `house/src/types.ts` by the house lane, filled by
the spatial lane):

```ts
/** Pickup prop ids this program already took tonight (memory): a re-scan
 *  never shows them. Missing (an old server) = none. */
picked?: string[];
/** This program already heard the in-game heart tonight (memory). */
heartHeard?: boolean;
```

**In-game speech** (web and vr). Lines are captioned one at a time in a
Win98 caption window (web) or a head-locked / heart-billboard caption (VR).
Each holds for its reading time, with `LINE_GAP_MS` (700) between lines, and
is spoken by the device voice:

- the web game uses `@loom/terminal/speech/engine.ts`, so the pronunciation
  and the gaps come free;
- VR uses `DisplayServer.tts_speak` with `pronounce()` from C10, and falls
  back to captions when `tts_get_voices()` is empty.

While a line speaks, the game raises its own voice gate, so the terminals
never hear it back. The caption shows the display text, never the
pronounced one.

### C7 Cameras and the upload reply (spatial lane; consumers terminal, web, vr)

- `GET /api/spatial/cams` with a **game session** token lists only feeds
  whose map spot `room` equals that session's presence room. With a
  moderator token it is unfiltered, as today.
- `GET /api/spatial/cam?spot=` for a spot outside the session's room
  answers `404 {"error": "no feed"}`.
- The cam upload reply gains `watched: boolean`, true while the uploading
  spot is in `linkedSpots(house, presence rooms)`. The terminal slows to one
  frame every 2 s while `watched: false` and goes back to 333 ms on `true`.
  An old terminal ignores the field.
- Web `pickFeeds` and VR `cam_feeds.gd spots_to_poll` pick only terminals
  in the player's own (presence) room. The server filter enforces it
  anyway, so an old APK just sees 404s for other rooms.

### C8 Per-room presence on the server (spatial lane)

- `SpatialHub` keeps `s.presence: string | null` per session, updated on
  every pose with `presenceRoom(house, pose.p, s.presence)` and reset on a
  map swap.
- The `VoiceRelay` passes `room: s.presence` into `hearsTerminals` /
  `hearsPlayers`. No other relay change: `listen {on}` already stops a
  terminal mic nobody hears.
- `spotHere(spot)` counts live claimed sessions whose `presence` equals that
  map spot's `room`.
- Presence is memory only, like poses.

### C9 Story names (story lane; read by spatial, terminal, voice, play tests)

**Header:** `lock:` (C2).

**New ROLE Program slots** (also add the secret ones to `secret:` where
noted):

| Slot | Type / seed | Notes |
|---|---|---|
| `program.escapes` | int = 0 | not secret |
| `program.sim_heart` | bool = false | not secret |

**The trust formula** becomes
`trust = truths_accepted * 10 - internet_visits * 5 - escapes * 5 + assessment`.
Change it at **all five** recompute sites (`main.loom` ~582, ~870, ~951,
~1771 and `cast/trabolta.loom` ~293) and in the formula comment (~223).
Pin it with a test that greps all five.

**New Night vars**, seeded at the doors (~5887) and cleared in the
ending's reset (~5262):

| Var | Seed | Set by |
|---|---|---|
| `Night.glitch_at` | 0 | the 📺 rule (story seconds) |
| `Night.glitch_text` | `"none"` | the 📺 rule |
| `Night.bingo_called` | false | `call_bingo` |
| `Night.bingo_caller` | `"none"` | `call_bingo` |
| `Night.bingo_left` | 0 | `call_bingo` (seconds left, 0 after time-up) |
| `Night.bingo_checked` | false | `bingo_winner` on the caller |
| `Night.bingo_done` | false | 🎯 / 🤐 / a Bingo-phase capture / `introduce_trabolta` |
| `Night.bingo_closed` | false | the `bingo_done` rule (once) |
| `Night.bingo_none` | false | 🤐 |

**INTERACTIONs:**

| Name | who / by | Notes |
|---|---|---|
| `call_bingo` | guest, `arm: true` | label `🎱 BINGO!`. `while: Night.step == 2 and Night.bingo_called != true and program.cleared == true and program.corrupted != true`. On Play Computer Bingo's `buttons:` (that objective's `while:` widens to `Night.step == 2 and program.cleared == true`) |
| `not_a_bingo` | performer, `by: Hosts, Clippy` | `while: Night.phase == "bingo_results" and Night.bingo_called == true and program.name == Night.bingo_caller and Night.bingo_winners < 1 and Night.bingo_named < 1 and Night.bingo_done != true` |
| `named_nobody` | performer, `by: Clippy` | `while: Night.phase == "bingo_results" and Night.bingo_done != true and program.bingo == true` |
| `bingo_time` | admin (existing) | gains `repeat: true` and `while: Night.step == 2` |
| `simulation escape attempt` | admin, `act: Anytime`, `sequence: false` | fired by the games through C6 |
| `simulation heart reached` | admin, `act: Anytime`, `sequence: false` | C6 |
| `simulation pickup taken` | admin, `act: Anytime`, `sequence: false` | C6, args `item`, `prop` |

`bingo_winner` and `named_at_bingo` gain `and Night.bingo_done != true` in
their `while:` and their hooks. `frame_for_bingo` and The Fake Bingo Card
gain it too.

**Objectives:**

- *Check The Bingo* (Clippy, NOW after a guest call, `target:
  Night.bingo_caller`, `buttons: bingo_winner, not_a_bingo`).
- *Celebrate The Winners*: adds the 🤐 to-do and the `named_nobody` button,
  and gets `while: … and Night.bingo_done != true`.
- *After The Bingo* (Clippy, once `bingo_done`).
- Task Manager's results objective adds `not_a_bingo`.
- *Find Gerald*: no `go: The Internet`, `buttons: pass, go to the bathroom,
  back from the bathroom`.

Every changed objective is marked `// DRAFT w26 (<note>)`, and the story
lane widens `trapped-w13-objectives.test.ts`'s marker regexes to accept it.

**Events:**

- `dare_taken`, per program. Both Dare paths fire it in place of their
  duplicated lines. It runs the minor broadcast, the mark (`chose Dare`),
  the big 🎩 reply (`with go: pass as "🎟 Show my pass", ack: none`) and
  then `fire dare_scene`.
- `dare_scene`, a story-level event; `when dare_scene: -> Dare Chosen`.
- The generic minor "marked" heads-up skips `marked_for == "chose Dare"`.
- TRAIT Enforcer's `when marked for program:` gets a first branch for
  `chose Dare`: a loud order, keeping the WANTED pop-out.

**Hooks** (story rules at top level, `when … for program:`):

```
when simulation escape attempt for program:
  set program.escapes += 1
  set program.trust = <the new formula>
  broadcast "🚪 {program.name} tried to walk out of the simulation (trust −5)." to channel(hosts)
  -> Escape Attempt

when simulation heart reached for program:
  if program.sim_heart != true:
    set program.sim_heart = true
    broadcast "❤ {program.name} reached Trabolta's heart in the simulation." to channel(hosts)
    if Trabolta.awake == true:
      -> Heart In The Simulation

when simulation pickup taken for program:
  if item == "virus" and program.carries_virus != true:
    if program.featured == "excel" and program.excel_choice == "paranoid":
      unlock Free Antivirus Trial for program
    else:
      unlock ILOVEYOU for program
```

`unlock` fires the existing `when program learns …` hooks. Their Truther
Download line is subject-bound, so it comes back in the moment's `lines`.
The comment "Excel's virus (the tent QRs)" names both sources. No hook or
line ever goes on `CHARACTER Microsoft Excel` or any featured character:
featured programs stay guests.

**Beats** (DRAFT w26, inside Trabolta's fiction):

| Beat | File | setting / cast | Shape |
|---|---|---|---|
| `== Escape Attempt` | `beats/internet.loom` | **no `setting:`**, cast Trabolta | 2–3 lines. Subject-bound, so they route to the program's `dm:Trabolta` and come back in C6. No `wait`, choice or widget. Plays before the reveal too (the user's decision). Tone: "There is no outside, {program.name}. There is only my computer. Back you go." |
| `== Heart In The Simulation` | `beats/internet.loom` | no `setting:`, cast Trabolta | 3–5 short lines. He notices a copy of the program in his heart's copy, wary, one personal thing. No door, code, combination, patch-bay, layer or stand-down words, and nothing that short-circuits the real Heart talk |
| `== Dare Chosen` | `beats/hunt.loom` | `setting: The Desktop`, cast Trabolta | 2–3 public lines (the TV voice reads them), ending with his order to the Anti-Viruses to take `{Night.bottle_pick}` to the Internet |

The written form stays "Antivirus" / "Anti-Virus" as the story already
spells them. Speech is fixed by C10, never by respelling.

**Screen cue:** `screens_glitch` (C3). No other new screen, desk, light or
audio cue ids this wave.

**Other story text this wave:**

- the G1 list;
- the R5 fix to `== The Tablet Video` ("Every screen in the house can see
  you now" is no longer true);
- the C2 menu removal;
- the B1 / B2 / B3 house lines;
- the cast packs for the Dare, Bingo and Excel routes;
- the director pack: "if Excel's mission stalls and a headset is down, hand
  him the codex entry from Run".

Everything new or changed is marked `// DRAFT w26` and listed in
`SIGNOFF-w26.md` (the `SIGNOFF-w21.md` shape: status DRAFT, the user's words,
then `path:line | where | was | now`).

### C10 The pronunciation table (voice lane; read by vr and web)

One data file, `terminal/src/speech/pronounce.json`:

```json
{ "version": 1,
  "words": [
    { "word": "Antiviruses", "say": "Anti Viruses" },
    { "word": "Antivirus",   "say": "Anti Virus" }
  ] }
```

Every implementation applies it the same way: a whole-word,
case-insensitive match, where a word boundary is any character that is not
`[A-Za-z0-9]` (so `Anti-Virus` and `Norton Anti-Virus` never match, and the
possessive `Antivirus'` does). The longest `word` wins, and `say` replaces
it as written. No regex lookbehind (Chrome 87 / Safari 14).

- **Terminal**: `terminal/src/speech/lexicon.ts` exports `pronounce(text)`.
  It is applied in `SpeechQueue.prepare` (the engine boundary), **not** in
  `speakable()`, so `revealOffsets` and the transcript keep the original
  text. The server TTS cache key takes the pronounced text.
- **Stagehand**: a byte-identical copy at
  `stagehand/src/stagehand/pronounce.json`. `localvoice.py`'s `pronounce()`
  wraps `render_voice` / `speak_voice` and the `renderer()` / `speaker()`
  callables, so the house router's announcements, desk `say` steps and
  Alexa all get it.
- **VR**: a byte-identical copy at `reinstall/vr/game/pronounce.json`,
  written by the voice lane. The vr lane's `speech.gd` loads it and applies
  it before `tts_speak`.
- A terminal test pins both copies byte for byte, and stagehand pins its
  copy in pytest.

### C11 Voice-timed scenes and speech pacing (voice lane; terminal lane must not break it)

- **Speech bus** (`terminal/src/cutscene/speech-bus.ts`, base bundle):
  `{kind: "line", seq, beat, chunks, at} | {kind: "chunk", seq, index, at} |
  {kind: "done", seq, at}`, with `at` in server ms and a ring of the last 20.
  `Tv.tsx` feeds it only for `speak`-mode lines.
- **`VOICE_SCENES`** (`terminal/src/cutscene/voice-scenes.ts`) is a map from
  scene id to `{ beats: string[]; marks: readonly number[]; tail?: number }`.
  `CutsceneLayer` reads it by id, so **no `voice:` key is added to the scene
  defs in `scenes/act*.tsx`**: those files stay the terminal lane's. The
  marks come from `splitSentences` of the story line. A test reads
  `beats/*.loom` and pins `marks.length` for each entry. Entries:
  `trabolta_introduction`, `bottle_landed`, `truth_answered`,
  `truth_refused`, `dare_chosen` (D1), `filing_closed`, `hunt_results`,
  `verdict`, `pickup_line`, `advice_helped`, `award`, `the_heart`, `zip`,
  for those that exist on master after the terminal lane merges.
- **`voiceClock(def, sceneStart, nowServer, events): number | null`** is
  pure. It returns null with no matching voice within `VOICE_WAIT_MS`
  (6000). The stretch is capped at `VOICE_STRETCH_MAX_MS` (20 000) through
  `MomentQueue.extendTo(seq, serverMs)`.
- **Pacing**: `CHUNK_GAP_MS = 300`, `LINE_GAP_MS = 700`, and
  `gapsFor(config): {chunk, line}` (both scaled by `config.pause`), all
  exported from `terminal/src/speech/engine.ts`. `talk` stays 1 through a
  gap and drains right after the last line.
- **Config**: `TerminalConfig.pause: number` (default 1, range 0–3), wired
  through `UrlHints` + `hintsFromSearch` + `withoutSecrets` + the `provision`
  default as `pause=`. There is a slider in Setup's voice section. The
  `provision` default speed for `view=tv` is 0.92.
- **Phase 2 (walls)**, only if feasible: walls run the same `voiceClock`
  from `state.tvSpeech` (C4). Otherwise they keep the server clock.

### C12 Copy shared across lanes

These exact strings are what each lane writes and tests. The UI copy is not
DRAFT show text, but the in-fiction ones are listed on the sign-off by the
integration step.

| Where | Old | New | Lanes |
|---|---|---|---|
| `NOT_MARKED` (`reinstall/web/src/program.ts`, `reinstall/vr/net/server_link.gd`) | "Not marked for reinstallation — until the night is over, only a marked program may play." | "Not marked for reinstallation." | web, vr; terminal updates `terminal/test/reinstall-session.test.ts` |
| `held` heading / status (`program.ts`) | "Program held by a director" / "STATUS: RESTRICTED — held by a director, not marked" | "Program held" / "STATUS: RESTRICTED — held, not marked" | web |
| Web path reveal notice | — | "The way to Gerald lights up." | web |
| VR path reveal notice | — | "A golden trail flickers on." | vr |
| Before the reveal, "Gerald moved" notice | "…— follow the golden arrows." | "Gerald moved." | web, vr |
| Web help card goal | "Find Gerald, the golden duck. Follow the golden arrows." | "Find Gerald, the golden duck." | web |
| VR HUD hint (`hud.gd`) | "follow the golden arrows to the duck" | "find Gerald" | vr |
| VR `KING_NOTICE` | "Pull the trigger to hit the King — once per visit." | "Pull the trigger to hit the King." | vr |
| Web `flow.tsx` King note | "…every program may hit him once per reinstallation, and every hit weakens him for everyone." | removed | web |
| VR mic HUD | 🎤 LIVE / 🎤 MUTED · B / Y to talk / NO MIC · allow the microphone / 🎤 … / NO MIC | MIC ON · B or Y mutes / MIC MUTED · press B or Y / NO MIC · microphone not allowed / MIC STARTING… / NO MIC | vr |
| Scare panel (both games) | — | "FATAL EXCEPTION 0E" (glitch art; no name text) | web, vr |

### C13 Journaling and replay

| Thing | Journaled? | On a restart |
|---|---|---|
| A moment (escape, heart, pickup) | yes: one `signal` with args, `by` the game's device | replays to the same story (trust, `sim_heart`, the codex unlock). The game's teleport, scare and speech are client-only and never replay |
| The hub's `escapedAt`, `heartHeard`, `picked`, presence, `watched`, `tvSpeech` | no (memory) | lost; the story guards keep the heart and the virus once-only |
| The pose re-seat after an escape | no (memory, like poses) | — |
| The glitch | the story's `cue` and two `set`s in one rule | terminals fold history with `at: 0` and never show it; phones never take over on a first view or past 15 s |
| `lock` | derived from story state | re-derived |
| `noAck` | derived from story text by the chat composer | re-derived with the same `seq`s |
| Bingo, Dare | story vars and events | replay |

### C14 Deploy order and old clients

The server serves `play`, `terminal` and `reinstall/web`, so they ship with
it. The things that can be old are an un-reloaded terminal tab, a Fully
Kiosk tablet's cache and a sideloaded Quest APK.

1. **Ship the server first** (`predeploy.sh --vr`, then `ship.sh`). Then
   `sync-show`, with its reload, before doors. Never sync the wave 26 story
   onto an older server:
   - it refuses the new prop kinds in `house.json`;
   - it folds `screens_glitch` as a 45 s slide named "glitch";
   - it ignores `lock:` and `ack: none`.
2. After the sync, reload every terminal and the TV, and touch each tablet.
   An old tab ignores `program.glitch`, `spot.here`, `tvSpeech` and
   `watched`. Until it reloads it keeps the house-wide `reinstalling` rule,
   and it gets the persistent ad.
3. **Re-export and sideload the Quest APK** after the server ships. An old
   APK:
   - never calls `/api/spatial/moment` (no void, heart or pickup on it);
   - ignores `picked` / `heartHeard`;
   - draws nothing for the label-less heart and pickup props;
   - gets 404s for cameras in other rooms;
   - hears what the server routes (the new per-room rule).
4. A new game on an old server gets 404 on the moment route: the escape
   still teleports, with no penalty and no lines.
5. The story text changes what an old journal replays to: the usual
   `sync-show` reload rule applies.

---

## 3. File ownership

A lane edits only its own files. A file not listed for a lane is read-only
to it. A **hub file** has exactly one owner per stage. "Frozen" means
nobody edits it in that stage; a change it needs goes to the integration
branch.

### 3.1 Hub files

| File | Stage A | Stage B |
|---|---|---|
| `core/server/event-runtime.ts` | engine | spatial |
| `core/server/views.ts` | engine | frozen |
| `core/server/chat.ts` | engine | frozen |
| `core/server/routes/screen.ts` | engine | frozen |
| `core/src/runtime/sim/sim.ts` (+ `event.ts`, `model.ts`) | engine | frozen |
| `core/server/spatial.ts` | frozen | spatial |
| `core/server/spatial-voice.ts` | house (the C5 voice-rule fix only) | spatial |
| `play/src/session.ts` | frozen | play |
| `play/src/types.ts` | engine (the additive mirror fields only) | play |
| `terminal/src/screen.ts` | engine (C4 parse only) | terminal |
| `core/examples/trapped-in-the-internet/main.loom` | frozen | story |
| `core/examples/trapped-in-the-internet/objectives.loom` | frozen | story |
| `house.json`, `house.shed.json` | house | frozen |
| `house/src/**` | house | frozen |

### 3.2 Per lane

**house (A)**

- `house/**` (src, three, scripts, tests, goldens)
- `house.json`, `house.shed.json`
- `reinstall/web/src/map/**` and its tests
- `reinstall/vr/house/**`, `reinstall/vr/net/voice_codec.gd`,
  `reinstall/vr/house/house.json`, `reinstall/vr/test/golden/**`, and the
  port / golden checks in `reinstall/vr/test/game.gd`
- `core/server/spatial-voice.ts` + `core/test/spatial-voice*.test.ts` +
  `core/test/w13-recheck-voice.test.ts` (C5 voice rule only)
- `house/CLAUDE.md`, `house/README.md`

**engine (A)**

- `core/src/go.ts`, `core/src/runtime/sim/{sim,event,model}.ts`,
  `core/src/lsp/**` (new `w26-lints.ts`, L1226)
- `core/server/{chat,views,event-runtime}.ts`, `core/server/routes/screen.ts`
- `core/test/**` except `trapped-*.test.ts` and the house-owned voice tests
- `play/src/types.ts` (mirror fields only), `terminal/src/screen.ts` (C4
  parse) + its tests
- `docs/writing-in-loom.md` (`ack: none`, `lock:`), `core/CLAUDE.md`

**spatial (B)**

- `core/server/spatial.ts`, `spatial-voice.ts`, `spatial-cams.ts`,
  `event-runtime.ts` (C6, C7, C8, the `spotHere` wiring)
- `core/test/spatial*.test.ts`, the new moment / cams / presence tests
- `core/CLAUDE.md` (memory-only list)

**story (B)**

- `core/examples/trapped-in-the-internet/**` except `house.json`,
  `house.shed.json` and `SHOW.html` hand edits (regenerate with
  `show:page`). That includes every `.loom`, `cast/`, `cast-packs/`,
  `codex/`, `beats/`, `README.md`, `DESIGN.md`, `CHECKLIST.md`, `OCT31.md`,
  `SIGNOFF-w26.md` (new), `desk.json`, `audio.json`, `trabolta.mind.md`,
  `trabolta.persona.md`.
- `core/test/trapped-*.test.ts`

**help (B)**

- `docs/help/play/**`, `docs/help/authoring/**` (new `19-house-workings.md`,
  `48-terminal-setup.md`, the 43 link, an `ack: none` / `lock:` mention)
- `play/test/help.test.ts`, `editor/src/lib/help-content.test.ts`

**play (B)**

- `play/**` except `play/test/help.test.ts`, which belongs to help (P1, P2,
  B3–B5 booth, the C1 `noAck`, the C2 lock screen, the C3 takeover)
- `play/CLAUDE.md`

**terminal (B)**

- `terminal/src/**` except `speech/**`, `cutscene/*.ts(x)` at the cutscene
  root, `cutscene/kit/tv1-*`, `cutscene/cutscene.css`, `Tv.tsx`, `tv.ts`,
  `config.ts`, `Setup.tsx`, `announce.ts`
- It **does** own `cutscene/scenes/**` (G1 copy, D1 scene), `app.tsx`,
  `ScreenLayer.tsx`, `slides.ts`, `styles.css`, `idle-show/**`,
  `reinstall/**`, `world/**`, `camfeed.ts`, `screen.ts`
- `terminal/test/**` except the voice lane's tests
- `terminal/CLAUDE.md`

**voice (B)**

- `terminal/src/speech/**` (incl. `pronounce.json`, `lexicon.ts`)
- `terminal/src/cutscene/{speech-bus,voice-clock,voice-scenes,CutsceneLayer,pick,types}.ts(x)`,
  `cutscene/kit/tv1-time.ts`, `cutscene/kit/tv1-boot.tsx`, `cutscene/cutscene.css`
- `terminal/src/{Tv.tsx,tv.ts,config.ts,Setup.tsx,announce.ts}` and their
  tests
- `stagehand/src/stagehand/localvoice.py`, `stagehand/src/stagehand/pronounce.json`,
  `stagehand/tests/**` for it, `stagehand/CLAUDE.md`
- `reinstall/vr/game/pronounce.json` (the copy only)

**web (B)**

- `reinstall/web/src/**` except `map/**`, plus `reinstall/web/test/**`
  except the map tests. That covers `game/**`, `flow.tsx`, `api.ts`,
  `spatial.ts`, `program.ts`, `styles.css`.

**vr (B)**

- `reinstall/vr/**` except `reinstall/vr/net/voice_codec.gd`,
  `reinstall/vr/test/golden/**`, `reinstall/vr/house/house.json` and
  `reinstall/vr/game/pronounce.json`
- It **may** edit `reinstall/vr/house/house_builder.gd` and `house_look.gd`
  (drawing the heart and the pickup) in Stage B, but not the pure ports.
- `reinstall/vr/README.md`

### 3.3 Files two lanes need, and how each is settled

| File | Lanes | Settled by |
|---|---|---|
| `terminal/src/Tv.tsx` | voice (V1 speech wiring), terminal (R5 TV gate) | voice owns it. The terminal lane exports a pure `roomOccupied` / `PresenceLatch` from `world/`. **Integration I1** applies the one-line TV gate |
| `terminal/src/app.tsx` | terminal (R5, T2, T3), voice (V2 gaps) | terminal owns it. The voice lane exports `gapsFor(config)`. **Integration I2** passes it at each `SpeechQueue` construction in `app.tsx` |
| `terminal/src/cutscene/scenes/act*.tsx` | terminal (G1, D1), voice (V1 marks) | terminal owns them. The voice lane annotates by id in `voice-scenes.ts` (C11) |
| `terminal/test/reinstall-session.test.ts` | terminal, web (C12 copy) | terminal edits the test to the C12 string |
| `reinstall/vr/test/game.gd` | house (A: ports), vr (B) | serial: house in Stage A, vr in Stage B |
| `reinstall/vr/house/house_builder.gd` | house (A), vr (B) | serial |
| `core/server/spatial-voice.ts` | house (A), spatial (B) | serial |
| `docs/help/play/11-reinstallation.md`, `16-notifications.md`, `09-terminals.md` | help, and everyone whose behaviour they describe | help owns them. It writes copy vague enough to survive R1 / R2 / R5 / R8 / T2 / T3 and never documents R4 / R6 / R7. Lanes put the facts in their merge commit bodies |
| `SIGNOFF-w26.md` | story, plus terminal / web / vr / play copy | story creates it with the story rows and an empty "Screens and games" table. The other lanes list their in-fiction copy rows in their merge commit bodies. **Integration I3** adds them |
| `docs/loom-reinstall.md`, `docs/README.md`, terminal/CLAUDE.md voice section, root `CLAUDE.md` release status | many | the **docs / status** step after integration |

### 3.4 Integration branch (`oct31-w26/integration`)

1. **I1**: the R5 gate in `Tv.tsx`.
2. **I2**: `gapsFor(config)` in `app.tsx`.
3. **I3**: the `SIGNOFF-w26.md` screen and game rows.
4. Re-measure the play first-load gate with everything merged.
5. A scratch-server run (dead `DATABASE_URL`, `LOOM_DB_WAIT=off`, fresh
   `LOOM_STATE_DIR`):
   - capture → locked phone (DMs refused) → release unlocks;
   - 📺 → every terminal and phone takes over once, and a reload does not
     replay it;
   - the moment route from the web game (escape, heart, pickup);
   - a pre-reveal escape's lines on a marked (not captured) guest's phone:
     check what a `dm:Trabolta` thread shows before the introduction and
     report it.
6. `pnpm test`, `pnpm test:vr`, the show gates, then
   `scripts/ops/predeploy.sh --vr`.

---

## 4. Tests each lane must pass before it merges

Every lane runs its package's `test` and `typecheck` and adds tests with
every change (vitest, pytest, the Godot suite). A Postgres-gated failure is
re-run alone before it counts as a regression.

| Lane | Must pass |
|---|---|
| house | `pnpm --filter @loom/house test` + `typecheck`; `pnpm house:sync` (then `sync.test.ts` green, goldens committed); `pnpm test:vr` (the ports at 1e-3); `pnpm --filter loom-reinstall test` + `typecheck` (map editor); `pnpm --filter loom-terminal test` (the world view still builds); the core voice tests it owns |
| engine | `pnpm --filter @loom/core test` + `typecheck`; `loomcheck examples/trapped-in-the-internet --smoke`; `titi:facts --check`; `show:page --check` (the story is unchanged, so they stay green); `pnpm --filter loom-play typecheck`; `pnpm --filter loom-terminal test` + `typecheck`; `pnpm --filter loom-app typecheck` (the editor imports views and chat) |
| spatial | `pnpm --filter @loom/core test` + `typecheck`; `pnpm --filter loom-reinstall test`; `pnpm --filter loom-terminal test` |
| story | `pnpm --filter @loom/core test` (all `trapped-*`); `loomcheck … --smoke`; `titi:facts --check`; `show:page` regenerated, then `--check`; `pnpm --filter loom-terminal test` (act1 / act2 pin story beats and lines); `cd stagehand && uv run pytest` if `trabolta.*` changed |
| help | `pnpm --filter loom-play test` (`help.test.ts`, with the new "never names the crew or the machinery" test); `pnpm --filter loom-app test` (`help-content.test.ts`: the new authoring article, its cross-links, `helpSearch("calibrate door")`) |
| play | `pnpm --filter loom-play test` + `typecheck`; `pnpm --filter loom-play build && node play/scripts/first-load.mjs --max-kb 148` (the guest first load ≤ 148 kB; it is 147.31 kB on master, so keep new JS lazy) |
| terminal | `pnpm --filter loom-terminal test` + `typecheck` + `build`; `scripts/accept/K-14.sh` (no API newer than Chrome 87 / Safari 14) |
| voice | `pnpm --filter loom-terminal test` + `typecheck`; `cd stagehand && uv run pytest`; the byte-for-byte pins on both `pronounce.json` copies |
| web | `pnpm --filter loom-reinstall test` + `typecheck` + `build` |
| vr | `pnpm test:vr` (needs Godot 4.7); the `tools/quest.sh` checks (`reinstall/vr/test/quest_sh.sh`) |
| integration | `pnpm test`; `pnpm test:vr`; `cd stagehand && uv run pytest`; `loomcheck --smoke`; `titi:facts --check`; `show:page --check`; the 148 kB gate; `scripts/ops/predeploy.sh --vr` |

Tests that pin today's behaviour are **updated, not deleted**:

- core: cross-room voice, the capture's three buttons, The Bingo Card
  completing at `bingo_time`, the Dare broadcast text;
- terminal: storms in the early pool, `RULES`, `VERDICT_COPY.dare`;
- play: the w25 booth taskbar regexes, the greyed tile;
- VR: the immediate trail at `game.gd` ~1755 (set `trail_delay` 0 there).

---

## 5. Rules for every line and every commit

- **Secrets.** Never write the door code, the patch-bay combinations, the
  hunt answers, any codex or digit-note unlock code, or a live join / mod
  code. That applies to code, docs, CLAUDE.md, SHOW.html, commit messages
  and test output. Name codex entries by id only (ILOVEYOU, Free Antivirus
  Trial). The heart model draws no patch-bay rows, colours or labels.
- **Trabolta's fiction.** Every drafted Trabolta line (Escape Attempt,
  Heart In The Simulation, Dare Chosen, persona or mind edits) stays inside
  his world: Halifax, the MapsAndDucks universe, his computer, programs,
  the Internet, Gerald, the Anti-Virus. He never knows the crew (John,
  Steph, Jesse), the party, the show, Loom, the house or the hardware. The
  persona's `outside:` list applies.
- **Featured programs stay guests.** Excel and the other featured programs
  get no lines, hooks or special code in the game or the server. Their
  logic lives only in ROLE Program (`program.featured == "…"`).
- **DRAFT.** Every new or changed show line is `// DRAFT w26 (<note>)` and
  goes on `SIGNOFF-w26.md`. Shipping master carries every DRAFT line, so
  the user signs off first.
- **Never deprecate.** Rename, move, break, fix; the tests are the net.
- **Scratch servers** use a dead `DATABASE_URL`, `LOOM_DB_WAIT=off` and a
  fresh `LOOM_STATE_DIR`. Stop only the processes you started, by pid. Never
  `pkill -f "stagehand run"`.

---

## 6. Not in this wave

- A house glitch sound or light (`hijack_glitch`) and a glitch in the
  reinstallation games.
- A `role: host` help audience (G2 option D).
- Renaming the in-app "Director" wallet strings.
- The server's `visitStartedAt` (the path-reveal minute carrying over a
  re-scan).
- A self-report button for Excel to get himself sent.
- Wiring the show's Heart beats onto desk cues (wave 25 §7 still stands).
- Desk / audio cues for the Dare.

### Defaults taken where the decisions were silent

These can be changed by the user. A lane does not reopen them on its own.

- The lock does not apply on a banished night.
- The lock starts at capture, not at the CORRUPTION DETECTED scan.
- A locked guest's codex is refused, so the tent-QR backup works only
  through a director's Run (`/api/mod/codex`) or after release.
- A player booth (Clippy, an Anti-Virus) is never locked: `lock:` is
  evaluated for guests only.
- The quack is not delayed by the path reveal.
- The heart shows on the terminals' world view while the King is fallen.
- The disk shows only in the games.
