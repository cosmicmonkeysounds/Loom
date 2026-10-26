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
`8d3a44d1`, and again after two adversarial reviews (2026-10-26).

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
check. The chess terminal's attract stakes line (`terminal/src/chess/session.ts`
`stakesLine(true)`, "Checkmate him and the server-room door code goes to
your Codex.") states a door-code route up front: it becomes a DRAFT line
that names no prize (for example "Checkmate him."). `WIN_CODE` ("Checkmate.
The door code is in your phone's Codex.") is an after-the-fact verdict and
stays. Every changed line carries `// DRAFT w26` and goes on
`SIGNOFF-w26.md`. **Owners:** story (`.loom`, objectives, codex, cast packs,
`trabolta.mind.md` / `trabolta.persona.md`), terminal (act1 / act2 copy, the
chess `stakesLine`), web (the `flow.tsx` King note), vr (`KING_NOTICE` and
HUD hint copy).

### G2 The guest help guide stops explaining the machinery (help, web, terminal, vr)

The guest articles (`docs/help/play/*` with no `role:`) keep only how to work
the phone, the terminals and the game controls, in the computer's own voice.
They never name the machinery. The help test bans these words and phrases,
case-insensitive and whole-word: director, crew, operator, performer,
costume, booth, editor, Run mode, Run →, moderator, passcode, "event
server", "the house's server", "the server". The in-fiction names stay
allowed: an allowlist strips "Server Room", "server-room", "Server Door" and
"server room" before the check, because the guest help must still name the
Server Room and Server Door terminals. They never explain a hidden rule, never
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
- **never** the director phone or the editor's Run (Run → Players mounts
  the play app embedded, and an embedded app never takes over).

It plays once, live. A reload, a late reconnect or a restart replay never
plays it, on a phone or on a terminal. `ad_hijack` becomes a persistent slide (the walls stay hijacked
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
and keeps a one-line "N REINSTALLING". Every walk starts in the in-game
tent (the map's `spawn.room` is `tent`), so the tent terminal is **never
linked** under R5: its camera never goes into the game, it never carries
the voice link (as today, `voice/roles.ts`), and it draws no world. It gets no story slides, no countdown
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
reinstallation and does not lock. The lock screen still shows what the
program needs to play: the Find Gerald card and a read-only copy of the
Installation Wizard's thread (its instructions include Bathroom Mode).
**Owners:** engine (C1, C2), story (the `lock:` header and the two
moments), play (the lock screen, `noAck`).

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
server). His lines are **game-only**: they come back in the moment's answer
and never reach a phone, a booth or Run (C6 `GAME_ONLY_BEATS`). Because he
chastises even before his reveal, a Trabolta thread on the phone would
spoil him. **Owners:** house (escape geometry and ports), spatial (C6), story
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
always-on. A terminal with no `spot` is never linked, apart from those
`mirror` / `shadow` views. The tent terminal is never linked (T3).

The story's `cue tv_mirror` / `Night.screen = "mirror"` in `when captured:`
stays as it is: it only takes the TV off attract. On `desktop-tv` the world
pane shows while `spot.here > 0`, never just because the base is `mirror`
or because someone is somewhere in the simulation (today's
`inSimulation`). Only when `here` is absent (an old server) does it fall
back to today's rule. **Owners:** house (rule), spatial (server), terminal (gating),
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

While any game sound plays, the mic sends nothing, so the Quest never sends
the game's own sound to the terminals. That goes through a **new**
`VoiceLink.hold_for(ms)` in `net/voice_link.gd`, built on the existing
`VoiceCodec.Gate.hold_until` (`now + ms + VOICE_TAIL_MS`). The mic state
becomes legible:

- emoji-free, actionable HUD strings for every state, XR and non-XR (C12);
- a new `denied` mic state, split out of `nomic` where the permission is
  refused, so the HUD can tell a refused prompt from a pending one or a
  missing device;
- a logcat line on every mic change;
- a lobby mic line with **TEST MIC** (a level meter, no session needed),
  **ASK AGAIN** and a build stamp.

The mic stays open by default. The device voice needs
`audio/general/text_to_speech=true` in `project.godot`, which today has
only `driver/enable_input` under `[audio]`. Without it, `tts_get_voices()`
is empty and VR would always fall back to captions. **Owner:** vr.

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
voice speed is 0.92 (a provisioning default; ⚙ still overrides it). A TV
that is already set up keeps its saved `speed` (1), so C14 sets the show TV
by hand.
Announcements use `{chunk: 250, line: 0}`. **Owner:** voice.

### V3 "Antivirus" is said "Anti Virus" (voice, vr, web)

There is one shared pronunciation table (C10). Every TTS path says "Anti
Virus": the terminal `SpeechQueue` (TV, rooms, piloted chat, announcements,
Setup, and the web game, which uses the same engine), stagehand
`localvoice` (the house router and Alexa's `say` engine), Alexa's `engine:
server` path (the Announcer's `/api/mod/tts` fetch and its prewarm cache),
and the VR game's TTS. The
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
Clippy, a host or a director, puts the night back exactly. The full restore
set is in C9. In short, it undoes everything `bingo_time` did:

- the phase, the step, `bingo_on` and the clock;
- the TV and the walls (`tv_bingo`, `Night.screen = "bingo"`,
  `terminals_attract`);
- the call itself (`bingo_called`, `bingo_caller`, `bingo_left`,
  `bingo_checked`), so another guest can call BINGO again.

The "!⏰ BINGO TIME" broadcast cannot be taken back, so the undo sends a
DRAFT house line that calls everyone back to their cards. A call that came
after time-up (`bingo_left == 0`) restores the Bingo phase with no
countdown, and the hosts call ⏰ as usual (C9).

It is offered only before any 🎱 / 🎯 / 🤐. The quest completions move out of
`bingo_time` into the end of the round (B5). `bingo_time` becomes `repeat:
true` with `while: Night.step == 2`, so NEXT reads ⏰ again after an undo.
The cast briefs and the Bingo Time beat that hang off `bingo_time` play only
on its first firing (C9), so an undo never repeats them. **Owner:** story.

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

A player or host booth uses the guest taskbar rules. Nothing marks a
windowed booth today: the play lane adds a **new** root class,
`booth-frame`, built the way `.guest-frame` is (`play/src/css/chrome.css`
~409, which sets `--title-h: 52px; --taskbar-h: 56px`). The rules are
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
signal scene is retired. A beat moment carries `who: null`
(`routes/screen.ts` ~623), so the scene takes the dared program's name from
`state.night.bottle_pick`, which the screen state already carries
(`Night.bottle_pick`). On the TV, the sentence he speaks names the program
too (V1). No engine change is needed.

Unchanged, so the terminal tests that pin them (`terminal/test/act1.test.ts`
~89–96) stay green:

- the minor broadcast "~🎩 {program.name} chose Dare. Programs choose
  Truth.";
- the mark reason `chose Dare`;
- the Truth and Refuse lines.

The credit stays where it is: `fire game_credit` remains on the 🎩 fallback
path only (`main.loom` ~1050). `dare_taken` does not pay it, so neither path
changes its score. **Owners:** story, terminal (the scene), voice (its
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
tail (the code goes in `core/src/parser/diagnostics.ts` beside the other
`L12xx`). Banks ignore it.

Story use (story lane, DRAFT w26): three replies end `with go: pass as "🎟
Show my pass", go: go to the bathroom, ack: none`:

- the capture reply in `when captured:` (non-banish branch);
- the confrontation reply in `when confronted for program:`;
- the 🎩 reply of `dare_taken` (D1), with only the pass exit.

The `respond` parser takes a `with …` tail **only after a quoted text**
(`sim.ts` ~2296). The CORRUPTION DETECTED reply is unquoted today
(`main.loom` ~1163, `reply !!🛡 CORRUPTION DETECTED. …`), and an unquoted
tail would show on the phone as literal text. So every reply that gains a
tail is rewritten in the quoted form, for example `reply "!!🛡 CORRUPTION
DETECTED. {hunter} …" with go: …, ack: none`. The story lane adds a test
that all three replies' messages carry `noAck: true` and that none of their
texts contains "with go:".

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

The check runs **once, at the top of `handlePost`, before
`this.crewRoutes.handleGuest(...)`** (~5449). The crew and recruit routes
are dispatched there, ahead of the `switch`, so a check inside the switch
would miss them. The refused set:

- `say` (every channel, `dm:` included);
- `choose`, `widget`, `escape`, `join`, `defect`;
- `channel/invite`, `channel/leave`;
- `codex/redeem`, `codex/share`;
- every `wallet/*` sub-route;
- `picture`;
- the check-in route (`CHECKIN_ROUTE`);
- every route in `CREW_GUEST_ROUTES` (`routes/crews.ts`): `crew/found`,
  `crew/invite`, `crew/leave`, `crew/join`, `recruit`, `recruit/answer`,
  `side/leave`;
- `act`, unless the interaction is `restricted: allow`.

Open while locked:

- the GETs (state, stream);
- `act` on `restricted: allow` interactions;
- session housekeeping that posts nothing into the story: `register` (the
  switch's first case, ~5455) and, dispatched before `handlePost`
  (~5082–5111), the push
  subscription routes (`pushRoutes`), `resume` (`RESUME_ROUTE`), `enter`
  and `rejoin/*` (`routes/rejoin.ts`), `badge` (`BADGE_ROUTE`, linking a
  printed badge), `homescreen` (`HOMESCREEN_ROUTE`) and `logout`.

The engine lane keeps the open set as one exported constant, `LOCKED_OPEN`.
A test lists every guest route from all of these:

- each `case "/api/guest/…"` and route constant in `event-runtime.ts`;
- `CREW_GUEST_ROUTES`;
- the route constants exported by `routes/*.ts` (`k13.ts`, `k31b.ts`,
  `n02.ts`, `rejoin.ts`, the push routes).

It asserts that each route is either in `LOCKED_OPEN` or answers `403
locked` for a locked guest, so a new route can't slip past. A director's Run
→ Players pane and a terminal piloting a locked guest go through the same
routes, so they are refused the same way. Lint **L1216** gains the `lock:`
header: a `lock:` line that is no expression is an error, as `reinstall:`
already is (`core/src/lsp/w18-lints.ts` ~174).

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
windows. It has:

- the title bar and a ⛔ QUARANTINED card (DRAFT copy);
- the current objective card (Find Gerald) from the view;
- a read-only scroll of the `dm:Installation Wizard` thread, with no
  composer, menus or cards. It holds the reinstallation instructions,
  Bathroom Mode included (`beats/internet.loom` ~18–31);
- 🎟 Show my pass, and Bathroom Mode / Back from the bathroom from
  `view.interactions`.
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
  `program.glitch.at > 0`, `serverNow − at < GLITCH_MS` (8000), and `at` is
  later than the server time of this page's first screen answer. History
  (`at: 0`) never shows. A glitch already under way when the page loads
  (a reload within 8 s) never shows either: `program.glitch` is shared
  server state, so its `at` is live for every terminal, not only the one
  that saw it happen. Blackout beats it. It shows on every view (TV,
  mirror, walls awake or asleep, room, chess, casino, reinstall, shadow),
  whether piloting, peeking or `bare`. It counts as `covered` (the idle show
  pauses) but not `takeover` (a pilot, a chess game or a tent walk keeps
  running underneath). It is CSS-only and in the main bundle. Flashes stay
  ≤ 3 Hz with no full-field red, and reduced motion shows a still frame.
  Sounds come only from the terminal synth library.
- **Phone** (play lane): a pure `takeoverDue(prevAt, glitch, clock,
  firstView, embedded)` is true only if all of these hold: the app is not
  embedded (Run → Players mounts it in shadow roots; `embedded` is the same
  flag that already skips sound there); `glitch.at > 0`; it differs from the
  last `at` this provider saw; this is not the first view (no reload or new
  sign-in); and `0 ≤ clock − glitch.at ≤ TAKEOVER_FRESH_MS` (15 000, story
  ms). The takeover is a lazy chunk with the existing 600 ms `<Glitch/>` as
  its fallback. It holds the moments queue for its length, so the `!📺`
  sticky lands right after it, not under it. Sound and buzz are skipped
  when the page is hidden or sound is off.
- **Who gets what**: guests and player booths get ~6 s, tap-swallowing. Host
  booths get 2.5 s with `pointer-events: none`. The director phone and
  Run get nothing. A test pins `takeoverDue(…, embedded: true)` to false.

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
  `program.glitch` (`shotOf`), `spot.here` and `tvSpeech`.
  `terminal/src/speech/said.ts` (where `SpeechReport` and `speechQuery`
  live, ~22–33) gains the optional `sp` field and key, with
  `terminal/test/said.test.ts`. Both files are the engine lane's in Stage A
  only, and the terminal and voice lanes then only consume them.
- The gating rule every terminal follows: with `spot.here` present, linked
  means `here > 0`. A terminal with no `spot` is never linked (no world, no
  camera into the game, no voice link), apart from the `mirror` / `shadow`
  views. A `view=reinstall` terminal (the tent) is never linked. Only when
  `here` is absent on a placed terminal (an old server, or no spatial map)
  does it fall back to the house-wide `reinstalling` rule.
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
/** Map terminal ids whose `room` holds at least one of `rooms`, never a
 *  `view: "reinstall"` terminal (the tent station: every walk starts in its room). */
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
- The web game's `earsFor` (`reinstall/web/src/game/voice.ts`) calls
  `hearsPlayers`, so it follows the new rule with no code change. Its
  cross-room expectation in `reinstall/web/test/voice.test.ts` (~187–190,
  "`t` is 6.5 m away") becomes 0. The house lane owns that test file in
  Stage A for this change.

**Path reveal** (`house/src/route.ts`, port `house_route.gd`):
`export const PATH_REVEAL_MS = 60_000;`.

**Prop kinds** (`house/src/types.ts`, `validate.ts`, `geometry.ts`):

```ts
export type PropKind = "box" | "cylinder" | "screen" | "label" | "king" | "heart" | "pickup";
export interface Prop {
  // …
  /** kind "pickup" only: what it is ("virus"). Required on a pickup, refused elsewhere. */
  item?: string;
  /** The existing story-signal object, widened: king keys as today, plus
   *  `reached` (kind "heart", default HEART_SIGNAL) and `taken` (kind
   *  "pickup", default PICKUP_SIGNAL). Keys are checked per kind. */
  signals?: { won?: string; lost?: string; drawn?: string; hit?: string; fallen?: string; reached?: string; taken?: string };
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
export function propSignal(prop: Prop): string; // signals.reached / signals.taken ?? the kind's default
```

`propSolid` is false for both new kinds by default. There is no new
`signal` field: a lone `signal` beside the king's `signals` object would be
a near-collision. `KING_FIELDS` loses `signals`. Instead, `validate.ts`
checks the `signals` keys per kind: king takes `won / lost / drawn / hit /
fallen`, heart takes `reached`, pickup takes `taken`, and any other kind
takes none. `hp`, `health` and `armed` stay king-only. The show maps leave
`signals` out on both new props (the defaults), so an old validator never
sees it there. A heart or pickup prop with a `label` is refused, because an
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
  `fan-closet`, on a standable spot. Both rooms hold a duck spot
  (`hard-drive-boxes`, `fan-closet-dryer`), so the room alone does not keep
  the disk off the duck's route. The disk must sit ≥ 2 m (plan) from every
  `duck.spots` entry and never on a trail chevron. A show-map test in
  `house/test` checks both maps for this.

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
- One route means one hub method, one client call per game, one answer
  shape and one test matrix. The client calls are web `postMoment` and VR
  `link.moment(kind, prop)`. `_want_claim` dedups by kind, so a single
  `"moment"` claim would let a pending escape swallow a heart or pickup
  claim and lose the prop id. VR therefore claims per kind
  (`moment:escape`, `moment:heart`, `moment:pickup`) and stores the prop id
  with the claim in `server_link.gd`, so the pump sends `{kind, prop}` when
  it fires.
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
  | { ok: true; kind: "heart"; lines: MomentLine[] }     // lines empty: nothing to say (he isn't awake, or a restart forgot it was heard)
  | { ok: true; kind: "pickup"; lines: MomentLine[]; item: string; prop: string };
```

| Status | Body | When | The game |
|---|---|---|---|
| 400 | `{error: "bad moment"}` | unknown `kind`; heart / pickup with no `prop` field | gives up |
| 401 / 410 | `{error: "unknown session token"}` / `{error: "this session is over"}` | dead token | ends the game, as today |
| 404 | `{error: "no such prop"}` | `prop` names no prop on the map, or one of the wrong kind | gives up |
| 404 | `{error: "not found"}` | an **old server** without the route: `handleSpatialPost` returns false for an unknown `/api/spatial/*` path and `server.ts` (~526) answers its generic 404 | escape: teleports, no penalty, no lines; heart / pickup: nothing |
| 409 | `{error: "doors are closed"}` | paused / before doors | escape: teleports, no penalty; heart / pickup: retries on the found backoff |
| 409 | `{error: "this session has not started — send a pose first"}` | parked | retries after a pose |
| 409 | `{error: "not out", distance}` | escape: `voidDistance < ESCAPE_M − ESCAPE_SLACK` | teleports anyway, no penalty |
| 409 | `{error: "cooldown", retryMs}` | escape within 20 s of the last for this session | teleports, no penalty |
| 409 | `{error: "sealed"}` | heart while the map's King stands | nothing |
| 409 | `{error: "not there"}` | heart: `!heartReached` on the last pose | retries when re-entering |
| 409 | `{error: "far", distance}` | pickup: `!pickupReach(…, PICKUP_SLACK_M)` | retries |
| 409 | `{error: "already"}` | heart heard by this guest tonight / pickup taken by this guest | heart: silent; pickup: hide the disk |

Games tell the two 404s apart **by the `error` string**, never by status
or by "is it JSON". The new route never answers `"not found"`. Any other
404 body is read as an old server.

**Hub** (`core/server/spatial.ts`, spatial lane):

```ts
export type MomentKind = "escape" | "heart" | "pickup";
export type MomentOutcome =
  | { kind: "unknown" } | { kind: "over" } | { kind: "parked" } | { kind: "bad" } | { kind: "noProp" }
  | { kind: "notOut"; distance: number } | { kind: "cooldown"; retryMs: number }
  | { kind: "sealed" } | { kind: "notThere" } | { kind: "far"; distance: number } | { kind: "already" }
  | { kind: "ok"; spawn?: Spawn; prop?: Prop; lines: MomentLine[] };
moment(token: string | undefined, req: MomentRequest,
       commit: (s: SessionRef, signal: string, args: Record<string, string>) => MomentLine[]): MomentOutcome;
```

- **Escape**: claimed, `voidDistance(map.house, s.pose.p) ≥ ESCAPE_M −
  ESCAPE_SLACK`, past the per-session cooldown. Then the pose is re-seated
  at the map spawn, and `s.room` / `s.floor` (`locate` of the spawn) and
  `s.presence` (`presenceRoom(house, spawn, null)`) are recomputed. The
  pose is marked dirty, so the terminals' ghosts jump back and the voice
  and cams follow at once. Then `commit(ref, ESCAPE_SIGNAL, {})` runs.
- **Heart**: the prop exists, is a heart, and the King is fallen (or the map
  has none). `heartReached` holds on the last pose and the guest is not in
  `heartHeard`. Then `commit(ref, propSignal(prop), {prop: id})` runs. The
  guest joins `heartHeard` only when the commit returned at least one line,
  so a visit before he is awake can be retried on re-entering. Once a guest
  is in `heartHeard`, later calls answer `already`. After a restart
  `heartHeard` is empty, and the story's own guard (`program.sim_heart`)
  makes the commit say nothing: a 200 with empty `lines`, and the game stays
  silent.
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
const events = this.commit("signal", signal, s.guest, args);
this.fanout(events);
// lines: what that commit said to this program, in order (game-only beats included)
return momentLines(events, s.guest);
```

`momentLines(events, guest): MomentLine[]` is a pure helper the **engine
lane** adds to `core/server/chat.ts` in Stage A, with a test. It returns the
commit's `dialogue` events whose `audience` includes the guest, in order,
as `{from: speaker, text}`. It reads the SimEvents, not the fanned-out
messages, because of the next rule.

**Game-only beats** (engine lane, Stage A, `chat.ts`). `export const
GAME_ONLY_BEATS = ["Escape Attempt", "Heart In The Simulation"]` (folded).
The chat composer emits **no** `ChatMessage` for a `dialogue` event whose
`beat` is one of them. Chat is re-derived on replay, so the rule is
deterministic: no phone thread, booth readout, Run pane or replay ever holds
those lines. Only the game's answer body carries them. This matters
because Trabolta is `hidden: true` and has no scripted line before
`introduce_trabolta` (`cast/trabolta.loom`), and he chastises an escape
even before his reveal (R4). Other lines a moment produces, such as the
Truther Download line from the pickup's codex unlock, reach the phone as
usual. The engine lane's test: an escape before `introduce_trabolta` leaves
no Trabolta line in any `GuestView`, `PrimeView` or chat history, and
`momentLines` still returns them.

The lines include ones the phone hides (a locked phone or a hidden agent):
the game is the surface here. Only dialogue produced inside that one commit
is returned, so in-game scenes must contain no `wait`, choice or widget.

**Quiet on the screens** (engine lane, Stage A, `routes/screen.ts`). The
three signals are `who: admin` interactions, and `momentOf` turns every
admin signal into a public `signal` moment in the screen state's `moments`
ring (~640). Every terminal would then carry "simulation heart reached" and
"simulation pickup taken", against G2. So `ESCAPE_SIGNAL`, `HEART_SIGNAL`
and `PICKUP_SIGNAL` join `QUIET_MOMENT_SIGNALS` (~465), with a case in
`core/test/screen-quiet-moments.test.ts`. The constants come from
`@loom/house`, so the house lane exports them first (Stage A merges house
before engine). `screen.ts` is frozen in Stage B, so this must land in
Stage A.

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
Each holds for its reading time, with 700 ms between lines, and is spoken
by the device voice:

- the web game speaks through `@loom/terminal/speech/engine.ts`, so the
  pronunciation comes from the voice lane once both are on master. Web
  merges after voice. Until it rebases, it times captions with its own
  `IN_GAME_LINE_GAP_MS = 700`. After the rebase, a web test pins that value
  equal to the terminal's `LINE_GAP_MS`, and a test checks that a spoken
  line goes through `pronounce`;
- VR uses `DisplayServer.tts_speak` with `pronounce()` from C10, and falls
  back to captions when `tts_get_voices()` is empty. The vr lane sets
  `audio/general/text_to_speech=true` under `[audio]` in
  `reinstall/vr/project.godot`, with a Godot test and a `quest_sh.sh`
  check that the setting is there.

While a line speaks, the game raises its own voice gate, so the terminals
never hear it back. The caption shows the display text, never the
pronounced one.

### C7 Cameras and the upload reply (spatial lane; consumers terminal, web, vr)

- `GET /api/spatial/cams` with a **game session** token lists only feeds
  whose map spot `room` equals that session's presence room, never a
  `view: "reinstall"` spot (the tent, T3). With a moderator token it is
  unfiltered, as today.
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

- `SpatialHub` keeps `s.presence: string | null` per session, beside the
  existing `s.room` / `s.floor` from `locate` (`spatial.ts` ~163, ~773). It
  is updated on every pose with `presenceRoom(house, pose.p, s.presence)`,
  re-seated on an escape (C6) and reset on a map swap.
- `s.room` stays the raw `locate` room. The stream's `PlayerState.room`
  and the `poses` frame (`flush`, ~887) are **unchanged**: the terminals'
  world view, minimap and ghosts keep drawing where the player really is.
- The `VoiceRelay` has no access to sessions: it reads players through the
  `world()` callback in `event-runtime.ts` (~964), which today passes
  `this.spatial.players()`. The spatial lane adds `SpatialHub.voicePlayers():
  VoiceRoutePlayer[]`, the joined players with `room: s.presence`, and the
  callback passes that in place of `players()`. `hearsTerminals` /
  `hearsPlayers` then judge by the presence room. No other relay change:
  `listen {on}` already stops a terminal mic nobody hears.
- `spotHere(spot)` counts live claimed sessions whose `presence` equals that
  map spot's `room`. It answers 0 for a `view: "reinstall"` spot (T3) and
  null for a spot the map lacks.
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
Change it at the five existing recompute sites (`main.loom` ~582, ~870,
~951, ~1771 and `cast/trabolta.loom` ~293) and in the formula comment
(~223). The new escape hook below is a **sixth** site. Pin it with a test
that finds every `trust = ` assignment in the story (six), not a fixed
list, and checks each one uses the new formula.

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
| `Night.bingo_briefed` | false | the first `bingo_time` (the cast briefs and the Bingo Time beat run once) |

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

**Hooks repeat their `while:`.** An interaction's `while:` is never
enforced; the hooks still decide (`docs/writing-in-loom.md` ~1277–1281).
So the hooks of `call_bingo`, `not_a_bingo` and `named_nobody` (and
`bingo_winner` / `named_at_bingo` as above) open with an `if` that repeats
their `while:` condition in full, and otherwise send a "Nothing happens"
line to `channel(hosts)`, as `bingo_time`'s `else:` does. A stale button
pressed after the round closes then does nothing. The story lane tests two
races. In the first, two guests press 🎱 back to back: the first wins, the
second does nothing, and `bingo_caller` stays the first. In the second, a
🎱 lands after a 🎯 and changes nothing.

**`bingo_time` and its undo.** `bingo_time` today:

- sets phase `bingo_results`, step 3 and `bingo_on = false`;
- completes two quests and unlocks Clippy Instructions 2;
- cues `tv_bingo_time` (`Night.screen = "bingo_time"`) and
  `terminals_attract`;
- broadcasts "!⏰ BINGO TIME" and enters `-> Bingo Time`.

Three cast hooks hang off it, guarded only by `Night.step < 3`
(`cast/hosts.loom` ~65 and ~234, `cast/antivirus.loom` ~23). With `repeat:
true`, the second firing after an undo would replay them.

- The phase / step / screen / broadcast part of `bingo_time` runs every
  time. The two quest completions move to the end of the round (B5).
  Unlocking Clippy Instructions 2 is idempotent.
- `-> Bingo Time` and the three cast hooks run only while `Night.bingo_briefed
  != true`. The story lane places the `set Night.bingo_briefed = true` so
  the guard holds whatever order the hooks drain in. The existing `step <
  3` guards show that order. A test pins it: call → undo → ⏰ sends
  YOUR GAME IS ON and Norton's brief exactly once.
- `not_a_bingo`'s hook restores, in this order:
  - `Night.phase = "bingo"` and `Night.step = 2`;
  - if `Night.bingo_left > 0`: `Night.bingo_on = true` and `Night.bingo_end
    = Time.elapsed + Night.bingo_left`, so the "Bingo ends" countdown
    (`main.loom` ~22) and the time-up rule (~3884) come back;
  - if `Night.bingo_left == 0` (the call came after time-up): `bingo_on`
    stays false and `bingo_end` is left alone, so "Bingo time is up" never
    fires twice. The hosts call ⏰ as usual;
  - `cue tv_bingo`, `Night.screen = "bingo"`, `cue terminals_attract`,
    `Night.terminals = "attract"`;
  - `Night.bingo_called = false`, `Night.bingo_caller = "none"`,
    `Night.bingo_left = 0` and `Night.bingo_checked = false`, so `call_bingo`
    is live again;
  - a DRAFT house line to everyone, for example "↩ Not a Bingo yet. Back
    to your cards." `with go: quest: The Bingo Card`, plus a hosts line
    naming who pressed it.

  A story test drives call → undo with time left (the countdown resumes at
  the exact remaining seconds) and call-after-time-up → undo (no second
  time-up broadcast).

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
  if program.sim_heart != true and Trabolta.awake == true:
    set program.sim_heart = true
    broadcast "❤ {program.name} reached Trabolta's heart in the simulation." to channel(hosts)
    -> Heart In The Simulation

when simulation pickup taken for program:
  if item == "virus" and program.carries_virus != true:
    if program.featured == "excel" and program.excel_choice == "paranoid":
      unlock Free Antivirus Trial for program
    else:
      unlock ILOVEYOU for program
```

`program.sim_heart` is set only inside the awake branch. A visit while he
is not awake therefore marks nothing: the commit says nothing, the hub does
not add the guest to `heartHeard` (C6), and the next visit can still hear
the monologue.

`unlock` fires the existing `when program learns …` hooks. Their Truther
Download line is subject-bound, so it comes back in the moment's `lines`
and also reaches the phone as today (it is not a game-only beat).
The comment "Excel's virus (the tent QRs)" names both sources. No hook or
line ever goes on `CHARACTER Microsoft Excel` or any featured character:
featured programs stay guests.

**Beats** (DRAFT w26, inside Trabolta's fiction):

| Beat | File | setting / cast | Shape |
|---|---|---|---|
| `== Escape Attempt` | `beats/internet.loom` | **no `setting:`**, cast Trabolta | 2–3 lines. Subject-bound, so they come back in C6's `lines`. It is in `GAME_ONLY_BEATS` (C6), so they **never** become a `dm:Trabolta` message on any phone, booth or Run, not even after his reveal. No `wait`, choice or widget. Plays before the reveal too (the user's decision). Tone: "There is no outside, {program.name}. There is only my computer. Back you go." |
| `== Heart In The Simulation` | `beats/internet.loom` | no `setting:`, cast Trabolta | 3–5 short lines, game-only (`GAME_ONLY_BEATS`). He notices a copy of the program in his heart's copy, wary, one personal thing. No door, code, combination, patch-bay, layer or stand-down words, and nothing that short-circuits the real Heart talk |
| `== Dare Chosen` | `beats/hunt.loom` | `setting: The Desktop`, cast Trabolta | 2–3 public lines (the TV voice reads them), ending with his order to the Anti-Viruses to take `{Night.bottle_pick}` to the Internet |

The two game-only beat names are fixed by this table. The engine lane writes
them into `GAME_ONLY_BEATS` in Stage A, so the story lane must not rename
them.

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

### C10 The pronunciation table (data from the engine lane in Stage A; voice lane; read by vr and web)

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
  Alexa's `say` engine all get it. Alexa's `engine: server` path never goes
  through localvoice: `alexa/module.py` fetches `/api/mod/tts` through
  `mod.speak(text)` (~370–375). So the Alexa `Announcer` applies
  `pronounce()` before the fetch, before its `say -o` fallback, and in its
  disk / prewarm cache key. The pytest covers both engines.
- **VR**: a byte-identical copy at **`reinstall/vr/config/pronounce.json`**.
  The Quest export's `include_filter` is `"house/*.json, config/*.json"`
  (`export_presets.cfg` ~10, pinned by `test/quest_sh.sh` ~67), so a file
  under `game/` would never reach the APK. It would work in the editor and
  in tests, which hides the problem. The vr lane's `speech.gd` loads
  `res://config/pronounce.json` and applies it before `tts_speak`. The vr
  lane adds a `quest_sh.sh` check that the file exists and matches the
  filter.
- **All three copies land in Stage A** (engine lane, data only, the exact
  JSON above): `terminal/src/speech/pronounce.json`,
  `stagehand/src/stagehand/pronounce.json` and
  `reinstall/vr/config/pronounce.json`. The voice and vr lanes can then
  build and test on their own in Stage B. In Stage B the voice lane owns
  all three, and nobody else edits them.
- A terminal test pins the three copies byte for byte, and stagehand pins
  its copy in pytest (voice lane).

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
- **The voice lane rebases before it merges.** The `Dare Chosen` beat
  (story) and the `dare_chosen` scene (terminal) are written in parallel,
  and G1 edits Trabolta's beat lines, which changes `marks.length`. So the
  voice lane builds against today's beats with a placeholder `dare_chosen`
  entry. Before its merge it rebases onto master, which by then holds story
  and terminal (the merge order puts voice after both), recomputes every
  `marks` from the merged `beats/*.loom`, and re-runs the marks test.
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
  `provision` default speed for `view=tv` is 0.92. `loadConfig` keeps a
  saved `speed`, and every saved config carries one (`defaultConfig` sets
  1), so the default reaches only a newly provisioned TV. C14 sets the show
  TV.
- **Phase 2 (walls)**, only if feasible: walls run the same `voiceClock`
  from `state.tvSpeech` (C4). Otherwise they keep the server clock.

### C12 Copy shared across lanes

These exact strings are what each lane writes and tests. Every new or
changed in-fiction string (the notices, "Gerald moved.", the scare panel,
the heart caption, the HUD hints, the King copy) carries a `// DRAFT w26`
comment where it is written (`# DRAFT w26` in GDScript), so I3 can collect
them by search for `SIGNOFF-w26.md`. The plain UI copy (the mic HUD, the
status lines) carries the marker too, but on the sign-off it is listed as UI
copy, not show text.

| Where | Old | New | Lanes |
|---|---|---|---|
| `NOT_MARKED` (`reinstall/web/src/program.ts`, `reinstall/vr/net/server_link.gd`) | "Not marked for reinstallation — until the night is over, only a marked program may play." | "Not marked for reinstallation." | web, vr. The terminal imports `NOT_MARKED` from `@loom/reinstall/program.ts` (`terminal/src/reinstall/session.ts` ~23), so the **web lane** updates `terminal/test/reinstall-session.test.ts` (~40, ~119) on its own branch. Help updates `docs/help/play/11-reinstallation.md` (~62), which quotes the old string |
| `held` heading / status (`program.ts`) | "Program held by a director" / "STATUS: RESTRICTED — held by a director, not marked" | "Program held" / "STATUS: RESTRICTED — held, not marked" | web |
| Web path reveal notice | — | "The way to Gerald lights up." | web |
| VR path reveal notice | — | "A golden trail flickers on." | vr |
| Before the reveal, "Gerald moved" notice | web `game/engine.ts` ~964 "Gerald moved — follow the golden arrows."; VR `game/game.gd` ~351 "Gerald moved — follow the arrows." | "Gerald moved." (after the reveal both keep their old line) | web, vr |
| Web HUD heat box (`game/Play.tsx` ~177–180) | before the reveal: the heat label + "N m to Gerald" / "follow the golden arrows" | before the reveal the whole box reads "FIND GERALD" (no label, no distance, no hint); after it, unchanged | web |
| Web help card goal | "Find Gerald, the golden duck. Follow the golden arrows." | "Find Gerald, the golden duck." | web |
| VR HUD hint (`hud.gd`) | "follow the golden arrows to the duck" | "find Gerald" | vr |
| VR `KING_NOTICE` | "Pull the trigger to hit the King — once per visit." | "Pull the trigger to hit the King." | vr |
| Web `flow.tsx` King note | "…every program may hit him once per reinstallation, and every hit weakens him for everyone." | removed | web |
| VR mic HUD (`net/voice_link.gd` `hud_text(xr)`, ~213) | see the table below | see the table below | vr |
| Scare panel (both games) | — | "FATAL EXCEPTION 0E" (glitch art; no name text) | web, vr |
| Chess attract stakes (`terminal/src/chess/session.ts` `stakesLine(true)`) | "Checkmate him and the server-room door code goes to your Codex." | a DRAFT line that names no prize, for example "Checkmate him." | terminal |

The VR mic HUD, state by state (`hud_text(true)` / `hud_text(false)`). The
"someone can hear you" listener suffix stays: it replaces the key hint while
a terminal hears the player. Both pinned tests (`test/game.gd` ~2918) move
to the new strings.

| `mic_state` | Old (XR / non-XR) | New XR | New non-XR |
|---|---|---|---|
| `live`, nobody listening | "🎤 LIVE" | "MIC ON · B or Y mutes" | "MIC ON · M mutes" |
| `live`, `listen_on` | "🎤 LIVE · someone can hear you" | "MIC ON · someone can hear you" | "MIC ON · someone can hear you" |
| `muted` | "🎤 MUTED · B / Y to talk" / "🎤 MUTED · M to talk" | "MIC MUTED · press B or Y" | "MIC MUTED · press M" |
| `asking` (the permission prompt is pending) | "NO MIC · allow the microphone" | "MIC · allow it in the headset's prompt" | "MIC · allow it in the system prompt" |
| `denied` (**new**: refused, split out of `nomic`) | "NO MIC" | "NO MIC · not allowed · ASK AGAIN in the lobby" | "NO MIC · not allowed · ASK AGAIN in the lobby" |
| `opening` | "🎤 …" | "MIC STARTING…" | "MIC STARTING…" |
| `nomic` (no device, or only silence) | "NO MIC" | "NO MIC" | "NO MIC" |
| `off` | "" | "" | "" |

### C13 Journaling and replay

| Thing | Journaled? | On a restart |
|---|---|---|
| A moment (escape, heart, pickup) | yes: one `signal` with args, `by` the game's device | replays to the same story (trust, `sim_heart`, the codex unlock). The game's teleport, scare and speech are client-only and never replay |
| The hub's `escapedAt`, `heartHeard`, `picked`, presence, `watched`, `tvSpeech` | no (memory) | lost; the story guards keep the heart and the virus once-only |
| The pose re-seat after an escape | no (memory, like poses) | — |
| The glitch | the story's `cue` and two `set`s in one rule | terminals fold history with `at: 0` and never show a glitch older than their first screen answer; phones never take over on a first view, when embedded, or past 15 s |
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
2. After the sync, the reload of every terminal, the TV and each tablet is
   **mandatory**, not cosmetic. An old bundle's `validateHouse` refuses the
   `heart` and `pickup` prop kinds (`house/src/validate.ts` ~253):
   - an old terminal's world view falls back to its bundled map
     (`terminal/src/world/stream.ts` ~72, ~248–258);
   - an old tent tab's reinstall game silently walks the bundled old map
     (`reinstall/web/src/api.ts` ~142–148), not the map version its session
     was dealt.

   An old tab also ignores `program.glitch`, `spot.here`, `tvSpeech` and
   `watched`, keeps the house-wide `reinstalling` rule, and gets the
   persistent ad. Before doors, check the build stamp on every device
   (Run → Terminals flags an old `__BUILD__`; `pnpm showctl doctor`). The
   tent laptop, the TV and every tablet must show the new build.
3. **Set the show TV's voice speed to 0.92.** A TV that is already set up
   keeps its saved `speed: 1`, because the 0.92 default applies only when
   provisioning. Either re-open the TV's provisioning link (`?code=…`,
   `scripts/house-desktop/README.md`) or set Speed to 0.92 in its ⚙.
4. **Re-export and sideload the Quest APK** after the server ships. An old
   APK:
   - never calls `/api/spatial/moment` (no void, heart or pickup on it);
   - ignores `picked` / `heartHeard`;
   - draws nothing for the label-less heart and pickup props;
   - gets 404s for cameras in other rooms;
   - hears what the server routes (the new per-room rule).
5. A new game on an old server gets `404 {error: "not found"}` on the
   moment route (C6): the escape still teleports, with no penalty and no
   lines.
6. The story text changes what an old journal replays to: the usual
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
| `terminal/src/speech/said.ts` (+ `terminal/test/said.test.ts`) | engine (the C4 `sp` key only) | voice |
| the three `pronounce.json` copies (C10) | engine (data only) | voice |
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
- `reinstall/web/test/voice.test.ts` (the `earsFor` cross-room expectation,
  C5 voice rule only)
- `house/CLAUDE.md`, `house/README.md`

**engine (A)**

- `core/src/go.ts`, `core/src/runtime/sim/{sim,event,model}.ts`,
  `core/src/lsp/**` (new `w26-lints.ts` with L1226; the `lock:` case in
  `w18-lints.ts`'s L1216), `core/src/parser/diagnostics.ts` (the
  `L1226…` code constant)
- `core/server/{chat,views,event-runtime}.ts` (C1, C2 `LOCKED_OPEN`, C3,
  `momentLines`, `GAME_ONLY_BEATS`), `core/server/routes/screen.ts` (C3, C4,
  the three `QUIET_MOMENT_SIGNALS`)
- `core/test/**` except `trapped-*.test.ts` and the house-owned voice tests
- `play/src/types.ts` (mirror fields only), `terminal/src/screen.ts` (C4
  parse) + its tests, `terminal/src/speech/said.ts` + `terminal/test/said.test.ts`
  (the `sp` key only)
- the three `pronounce.json` copies (C10, data only):
  `terminal/src/speech/pronounce.json`, `stagehand/src/stagehand/pronounce.json`,
  `reinstall/vr/config/pronounce.json`
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
- every other `core/test/*.test.ts` that reads the show, except the
  spatial lane's `spatial*.test.ts`, for expectations that move only
  because the story text changed. About 45 files read the show. The ones
  known to move are `cue-sheet.test.ts` (the act counts: `"Anytime 6"`
  gains the three new `act: Anytime` admin interactions), `screen-moments.test.ts`
  (~367), `w18-moments.test.ts`, `w18-server.test.ts`,
  `w18b-integ.test.ts`, `views.test.ts`, `screen-state.test.ts`,
  `recap.test.ts`, `server-interactions.test.ts`, `server-chat.test.ts` and
  `push.test.ts`. In Stage B the story lane may change only expectations in
  these files, never what they test. The spatial lane merges first, so
  story rebases onto it.

**help (B)**

- `docs/help/play/**` (incl. the new performer-only `19-house-workings.md`,
  and `11-reinstallation.md` ~62 for the C12 `NOT_MARKED` string)
- `docs/help/authoring/**` (the new `48-terminal-setup.md`, the 43 link, an
  `ack: none` / `lock:` mention)
- `play/test/help.test.ts`, `editor/src/lib/help-content.test.ts`

**play (B)**

- `play/**` except `play/test/help.test.ts`, which belongs to help (P1, P2,
  B3–B5 booth, the C1 `noAck`, the C2 lock screen, the C3 takeover)
- `play/CLAUDE.md`

**terminal (B)**

- `terminal/src/**` except the voice lane's files listed below (`speech/**`,
  the voice cutscene files, `Tv.tsx`, `tv.ts`, `config.ts`, `Setup.tsx`,
  `announce.ts`)
- It **does** own `cutscene/scenes/**` (G1 copy, D1 scene), `app.tsx`,
  `ScreenLayer.tsx`, `slides.ts`, `styles.css`, `idle-show/**`,
  `reinstall/**`, `world/**`, `chess/**` (the G1 `stakesLine`),
  `camfeed.ts`, `screen.ts`
- In `cutscene/`, every file the voice lane does not own:
  `clock.ts`, `face-bus.ts`, `world-bus.ts`, `moment-bus.ts`, `fake.ts` (it
  gains `spot.here` / `program.glitch` for R5 / T2 previews), `load.ts`,
  `registry.ts`, `slot.tsx` (`CutsceneSlot`'s `bare`, if the T2 overlay
  needs it), `preview.tsx`, `preview.css`, and every `kit/` file except
  `kit/tv1-time.ts` and `kit/tv1-boot.tsx` (so `kit/tv1-parts.tsx` and
  `kit/tv1.css` are the terminal lane's)
- `terminal/test/**` except the voice lane's tests
- `terminal/CLAUDE.md`

**voice (B)**

- `terminal/src/speech/**` (incl. `pronounce.json`, `lexicon.ts`,
  `said.ts` after Stage A)
- `terminal/src/cutscene/{speech-bus,voice-clock,voice-scenes}.ts` (new),
  `cutscene/{CutsceneLayer.tsx,pick.ts,types.ts}`, `cutscene/kit/tv1-time.ts`,
  `cutscene/kit/tv1-boot.tsx`, `cutscene/cutscene.css`
- `terminal/src/{Tv.tsx,tv.ts,config.ts,Setup.tsx,announce.ts}` and their
  tests
- `stagehand/src/stagehand/localvoice.py`, `stagehand/src/stagehand/alexa/module.py`
  (the Announcer's `pronounce()`, C10), `stagehand/src/stagehand/pronounce.json`,
  `stagehand/tests/**` for them, `stagehand/CLAUDE.md`
- `reinstall/vr/config/pronounce.json` (the copy only)

**web (B)**

- `reinstall/web/src/**` except `map/**`, plus `reinstall/web/test/**`
  except the map tests. That covers `game/**`, `flow.tsx`, `api.ts`,
  `spatial.ts`, `program.ts`, `styles.css`.
- `terminal/test/reinstall-session.test.ts` (the C12 `NOT_MARKED` string
  only). The terminal imports `NOT_MARKED` from `program.ts`, and web
  merges after terminal, so the test moves on the web lane's branch with
  the string.

**vr (B)**

- `reinstall/vr/**` except `reinstall/vr/net/voice_codec.gd`,
  `reinstall/vr/test/golden/**`, `reinstall/vr/house/house.json` and
  `reinstall/vr/config/pronounce.json`. That includes `project.godot` (the
  TTS setting), `export_presets.cfg` (no change expected: `config/*.json`
  already ships), `net/voice_link.gd` (`hold_for`, `denied`, the HUD
  strings), `net/server_link.gd` (per-kind moment claims) and
  `test/quest_sh.sh`
- It **may** edit `reinstall/vr/house/house_builder.gd` and `house_look.gd`
  (drawing the heart and the pickup) in Stage B, but not the pure ports.
- `reinstall/vr/README.md`

### 3.3 Files two lanes need, and how each is settled

| File | Lanes | Settled by |
|---|---|---|
| `terminal/src/Tv.tsx` | voice (V1 speech wiring), terminal (R5 TV gate) | voice owns it. The terminal lane exports a pure `roomOccupied` / `PresenceLatch` from `world/`. **Integration I1** applies the one-line TV gate |
| `terminal/src/app.tsx` | terminal (R5, T2, T3), voice (V2 gaps) | terminal owns it. The voice lane exports `gapsFor(config)`. **Integration I2** passes it at each `SpeechQueue` construction in `app.tsx` |
| `terminal/src/cutscene/scenes/act*.tsx` | terminal (G1, D1), voice (V1 marks) | terminal owns them. The voice lane annotates by id in `voice-scenes.ts` (C11) |
| `terminal/test/reinstall-session.test.ts` | terminal, web (C12 copy) | **web** edits the two `NOT_MARKED` expectations with `program.ts`. The terminal lane leaves them alone, so its own branch stays green against the old string |
| `reinstall/web/test/voice.test.ts` | house (A: the voice rule), web (B) | serial: house in Stage A, web in Stage B |
| `terminal/src/speech/said.ts` | engine (A: `sp`), voice (B) | serial |
| `core/test/*.test.ts` that read the show | engine (A), story (B: expectations only), spatial (B: `spatial*`) | as listed in §3.2 story |
| `terminal/test/act1.test.ts` (the Dare / Truth / Refuse lines) | terminal, story | the strings stay unchanged (D1), so story never needs to edit it |
| `reinstall/vr/test/game.gd` | house (A: ports), vr (B) | serial: house in Stage A, vr in Stage B |
| `reinstall/vr/house/house_builder.gd` | house (A), vr (B) | serial |
| `core/server/spatial-voice.ts` | house (A), spatial (B) | serial |
| `docs/help/play/11-reinstallation.md`, `16-notifications.md`, `09-terminals.md` | help, and everyone whose behaviour they describe | help owns them. It writes copy vague enough to survive R1 / R2 / R5 / R8 / T2 / T3 and never documents R4 / R6 / R7. Lanes put the facts in their merge commit bodies |
| `SIGNOFF-w26.md` | story, plus terminal / web / vr / play copy | story creates it with the story rows and an empty "Screens and games" table. The other lanes list their in-fiction copy rows in their merge commit bodies. **Integration I3** adds them |
| `docs/loom-reinstall.md`, `docs/README.md`, terminal/CLAUDE.md voice section, root `CLAUDE.md` release status | many | the **docs / status** step after integration |

### 3.4 Integration branch (`oct31-w26/integration`)

1. **I1**: the R5 gate in `Tv.tsx`: the world pane shows on `spot.here >
   0`, falling back to today's `inSimulation` only when `here` is absent
   (R5, C4).
2. **I2**: `gapsFor(config)` in `app.tsx`.
3. **I3**: the `SIGNOFF-w26.md` screen and game rows. Collect them by
   searching for `DRAFT w26` across `terminal/`, `reinstall/` and `play/`.
4. Re-measure the play first-load gate with everything merged.
5. A scratch-server run (dead `DATABASE_URL`, `LOOM_DB_WAIT=off`, fresh
   `LOOM_STATE_DIR`):
   - capture → locked phone (DMs refused) → release unlocks;
   - 📺 → every terminal and phone takes over once, and a reload does not
     replay it;
   - the moment route from the web game (escape, heart, pickup);
   - a pre-reveal escape: the game speaks and captions his lines, and no
     phone, booth or Run pane shows a Trabolta line (C6 `GAME_ONLY_BEATS`);
   - a false 🎱 → ↩ undo → the countdown resumes and another guest can
     call;
   - the build stamp on every terminal tab after the reload (C14).
6. `pnpm test`, `pnpm test:vr`, the show gates, then
   `scripts/ops/predeploy.sh --vr`.

---

## 4. Tests each lane must pass before it merges

Every lane runs its package's `test` and `typecheck` and adds tests with
every change (vitest, pytest, the Godot suite). A Postgres-gated failure is
re-run alone before it counts as a regression.

| Lane | Must pass |
|---|---|
| house | `pnpm --filter @loom/house test` + `typecheck`; `pnpm house:sync` (then `sync.test.ts` green, goldens committed); `pnpm test:vr` (the ports at 1e-3); `pnpm --filter loom-reinstall test` + `typecheck` (map editor, and `voice.test.ts` under the new rule); the show-map test for the disk's distance from the duck spots; `pnpm --filter loom-terminal test` (the world view still builds); the core voice tests it owns |
| engine | `pnpm --filter @loom/core test` + `typecheck`; `loomcheck examples/trapped-in-the-internet --smoke`; `titi:facts --check`; `show:page --check` (the story is unchanged, so they stay green); `pnpm --filter loom-play typecheck`; `pnpm --filter loom-terminal test` + `typecheck`; `pnpm --filter loom-app typecheck` (the editor imports views and chat) |
| spatial | `pnpm --filter @loom/core test` + `typecheck`; `pnpm --filter loom-reinstall test`; `pnpm --filter loom-terminal test` |
| story | `pnpm --filter @loom/core test` (all of it, not only `trapped-*`: the other show-reading tests are the story lane's to keep green, §3.2); `loomcheck … --smoke`; `titi:facts --check`; `show:page` regenerated, then `--check`; `pnpm --filter loom-terminal test` (act1 / act2 pin story beats and lines); `cd stagehand && uv run pytest` if `trabolta.*` changed |
| help | `pnpm --filter loom-play test` (`help.test.ts`, with the new "never names the crew or the machinery" test); `pnpm --filter loom-app test` (`help-content.test.ts`: the new authoring article, its cross-links, `helpSearch("calibrate door")`) |
| play | `pnpm --filter loom-play test` + `typecheck`; `pnpm --filter loom-play build && node play/scripts/first-load.mjs --max-kb 148` (the guest first load ≤ 148 kB; it is 147.31 kB on master, so keep new JS lazy) |
| terminal | `pnpm --filter loom-terminal test` + `typecheck` + `build`; `scripts/accept/K-14.sh` (no API newer than Chrome 87 / Safari 14) |
| voice | rebased onto master after story and terminal (C11); `pnpm --filter loom-terminal test` + `typecheck`; `cd stagehand && uv run pytest` (both Alexa engines pronounce); the byte-for-byte pins on all three `pronounce.json` copies |
| web | `pnpm --filter loom-reinstall test` + `typecheck` + `build`; `pnpm --filter loom-terminal test` (it edits `reinstall-session.test.ts`, and the terminal imports `@loom/reinstall`) |
| vr | `pnpm test:vr` (needs Godot 4.7); the `tools/quest.sh` checks (`reinstall/vr/test/quest_sh.sh`), with the new checks for `config/pronounce.json` and `audio/general/text_to_speech=true` |
| integration | `pnpm test`; `pnpm test:vr`; `cd stagehand && uv run pytest`; `loomcheck --smoke`; `titi:facts --check`; `show:page --check`; the 148 kB gate; `scripts/ops/predeploy.sh --vr` |

Tests that pin today's behaviour are **updated, not deleted**:

- core: cross-room voice, the capture's three buttons, The Bingo Card
  completing at `bingo_time`, the Dare broadcast text;
- terminal: storms in the early pool, `RULES`, `VERDICT_COPY.dare`;
- play: the w25 booth taskbar regexes, the greyed tile;
- VR: the immediate trail at `game.gd` ~1755 (set `trail_delay` 0 there),
  and the mic HUD strings at `game.gd` ~2918 (C12);
- web: the cross-room `earsFor` case in `voice.test.ts` (house, Stage A).

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
- The tent terminal is never linked to the Internet (T3, R5): no camera
  into the game, no voice link, no world, even though every walk starts in
  the in-game tent.
- A terminal with no `spot` is never linked (R5), apart from the `mirror` /
  `shadow` views.
- A false-BINGO undo after time-up restores the Bingo phase with no
  countdown; the hosts call ⏰ (B2).
- The Dare's `game_credit` stays on Clippy's 🎩 fallback only (D1).
- The escape and heart lines are game-only, even after the reveal (C6).
- The locked phone shows the Find Gerald card and the Installation
  Wizard's thread read-only (C2).
- The chess stakes line loses its door-code promise (G1); `WIN_CODE`
  stays.
