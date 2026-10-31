# The house desk (wave 25)

The house desk is the house's own cue list, and the place to connect and
test every speaker, output, light and look. Think of a small QLab built
into Loom. It has three faces:

- **Run → House** in the editor: build the cue list, walk the checks, GO.
- **Desk** in a host's Play booth: GO / standby / stop, walk the checks
  with a phone in each room.
- **The story**: `cue <id>` plays a desk cue. A desk cue can fire story
  events while it plays and when it ends, so lights, sounds and Trabolta's
  speech can run in parallel or in series.

The pure model is `core/src/house-desk.ts`, shared by the server, the
editor (`@loom/core/house-desk`) and play (by relative path). This file is
the contract. When this file and the code disagree, fix one of them in the
same change.

## 1. `desk.json`

A project file beside `audio.json` and `lights.json`. It is never part of
`house.json`, and a desk edit never bumps the map version. Which desk is in
force, in order:

1. a director's save (`POST /api/mod/desk`, kept in the event's state dir
   until a Save to project replaces it);
2. the project's `desk.json`, snapshotted at launch / reload with the maps
   (the event row's `house_maps` record, key `desk.json`);
3. `LOOM_DESK`, the LAN fallback file;
4. `defaultDesk()`, an empty list.

```jsonc
{
  "version": 1,
  "note": "optional",
  "cues": [
    {
      "id": "heart_reveal",           // DESK_ID_RE: what `cue heart_reveal` names
      "number": "12",                 // optional, shown before the name
      "name": "The Heart wakes",
      "section": "The Heart",         // optional heading; later cues join it
      "notes": "Stand by the door",   // optional, for the operator
      "done": "heart_reveal_done",    // optional story event fired when it ends
      "steps": [
        { "kind": "look", "look": "heart_wake" },
        { "kind": "sound", "sound": "server_hum", "to": ["The Server Room"], "start": "with", "wait": 500 },
        { "kind": "event", "event": "heart_speaks" },
        { "kind": "speech", "room": "The Server Room", "start": "with", "max": 30000 },
        { "kind": "look", "look": "heart_listen" }
      ]
    }
  ]
}
```

### 1.1 Steps

Every step can carry `start` (`"with"` | `"after"`, default `"after"`),
`wait` (ms after its group starts, 0–600000) and `note`.

| kind | fields | does | lasts |
|---|---|---|---|
| `sound` | `sound`, `to?`, `gain?` (dB −60…12), `dur?` | plays a file from the router's sounds dir. No `to` means the story's routing: `audio.json` `cues[sound].to`, else everywhere | `dur`, else the length the router reports, else `DESK_ACK_MS` with no answer |
| `say` | `text` (≤ 280), `to?`, `chime?` (default true), `dur?` | a house announcement in the router's voice (`audio.json` `announce.to` unless `to`) | `dur`, else the length the router reports |
| `look` | `look` | plays a `lights.json` look | its plan (`planLook`; a loop: 0, it keeps going) |
| `light` | `to` (fixtures, zones, rooms, `everywhere`), `set` (a `LightState`) | one state on each fixture `to` reaches (safety-clamped as ever) | `set.transition` |
| `stop` | `announce?` | stop the house sounds (`/api/mod/audio/stop`) | `DESK_STOP_MS` |
| `event` | `event` | fires the story event, journaled (§3) | 0 |
| `speech` | `room` (a LOCATION), `max?` (≤ 300000, default 30000) | waits until the terminals that speak `room` have said its lines (§5) | until they fall quiet, or `max` |
| `wait` | `ms` | nothing | `ms` |

### 1.2 Parallel and series

Steps run in **groups**. The first step opens group 0. A `start: "with"`
step joins the group of the step before it. Any other step opens a new
group, which starts only once **every** step of the group before it has
ended. Each step starts `wait` ms after its group starts. A cue ends when
its last group ends, and its `done` event fires then (never after a stop).

That covers any mix. In the example above:

- The flash and the hum start together, the hum half a second later.
- When both have ended, the story hears `heart_speaks` (its `when` beat
  says his lines), and the desk waits for the server-room terminal to say
  them.
- When he falls quiet, the listening look goes up, and the story hears
  `heart_reveal_done`.

### 1.3 Validation

`validateDesk(raw, refs)` refuses the following (`problems`, a 400 on
save):

- bad shapes, unknown keys, a duplicate or ill-formed id;
- an id with a screens prefix (`room_`, `tv_`, …);
- an id equal to a look's name (`cue X` would play both);
- an unknown look or LOCATION;
- an unknown light target or a bad light state.

It warns (`warnings`) about:

- a sound that isn't one of the story's (the house Mac may still have the
  file);
- `announce_chime` as a sound;
- an unknown audio target;
- an event or `done` no `when` in the story hears;
- a cue with no steps.

## 2. The server: `server/desk.ts`

`DeskHub` is transport-free and takes an injected clock and timers, like
`AudioHub` and `LightsHub`. It holds:

- the desk in force and its source;
- the playhead (`standby`);
- the runs: every running run, then the last 8 ended ones for at most
  2 min;
- the check marks;
- the recent activity: the last 20 items.

The runs, the playhead and the activity are **memory only**. A restart
drops a run mid-cue and its `done` never fires; nothing marks the run as
lost (it is simply gone from `runs`), so a host GOes the cue again or fires
its event. A story-started run never moves the playhead; only a GO does. A
cue with no steps ends at once and fires no `done`. The marks are
kept in the event's state dir (setup happens days before the show), never
in the journal.

A run follows the pure state machine in `house-desk.ts` (`beginRun` →
`tickRun` / `stepStarted` / `stepLength` / `stepEnded` → `stopRun`). The
hub holds one timer per run at `runWakeAt`, plays each step `tickRun`
hands back, and keeps ticking until nothing more starts. A new run of a
cue that is still running stops the old one first: one run per cue.

Playing a step means:

- `sound` / `say`: an `AudioHub` play (§4). The router's ack carries the
  length (`stepLength`), or ends the step on `no-file` / `nowhere`.
- `look` / `light`: a `LightsHub` test (`{look}`; one `{fixture, set}`
  per fixture `resolveLightTargets` reaches).
- `stop`: `AudioHub.stop`.
- `event`: the journaled signal (§3).
- `speech`: the screen-state watch (§5).

### 2.1 Routes

All of these take a mod token or the owning author's session. **H** marks
the routes on the host allowlist (`core/server/routes/host.ts` and
`play/src/host/api.ts`).

| Route | Body → answer | H |
|---|---|---|
| `GET /api/mod/desk[?after=<rev>&wait=<s>]` | → `DeskView`. With `after` it is a long poll: it answers at once when `rev` moved on, else after the first change or `wait` s (default 25, at most 30) | H |
| `POST /api/mod/desk` | `{desk, base?}` → `{ok, version, source:"director", warnings}`; 400 `{problems}`; 409 `{error:"stale", version}` on a stale `base` | |
| `POST /api/mod/desk/project` | → the desk in force becomes the project's `desk.json` (409 `no project`) | |
| `POST /api/mod/desk/go` | `{cue?, standby?}` → `{ok, run, standby}`. No `cue` means the playhead's cue. `standby` is the playhead the console showed: if it moved, the answer is 409 `{error:"moved", standby}` and nothing fires (two consoles, one GO). 404 for no such cue, 409 `{error:"end"}` at the end of the list. The playhead moves to the cue after the one fired | H |
| `POST /api/mod/desk/standby` | `{cue: id \| null}` → `{ok, standby}` | H |
| `POST /api/mod/desk/stop` | `{run}` stops one run → `{ok, stopped}`; `{all: true, announce?}` stops every run **and** the house sounds (the panic) → `{ok, stopped, router: {online}}`, since the sounds need a router to stop them | H |
| `POST /api/mod/desk/check` | `{key, mark: "ok" \| "bad" \| null, note?}` → `{ok}` (404 for a key that isn't a check of this house) | H |
| `POST /api/mod/desk/check/reset` | → every mark cleared | |
| `POST /api/mod/audio/play` | `{sound, to?, gain?}` \| `{say, to?, chime?}` → `{ok, seq, router}` (§4) | H |
| `POST /api/mod/audio/test` | as before (wave 17) | H (new) |
| `POST /api/mod/lights/test` | as before (wave 20) | H (new) |
| `POST /api/mod/audio/report` | the router's report (§4) | |

`DeskView` is defined in `house-desk.ts`. In a host's view (a booth token),
every `by` (runs, marks, activity) goes through `server/unseen-directors.ts`:
a director reads as "Director". `live` is true on a **live** event once its doors
have opened (this run's entry played) and until the night ends, paused or
not. A preview / shared rehearsal is never `live`, so setup days test
without a confirm; a go-live in place makes it live. `house` is built from the audio and lights config in
force, the map, the story model (`storySounds`, `storyLocations`, the
`when` event names), the router's last report and the lights module's
device list. Since wave 30 it also carries `minds`: every `mind: external`
character (Trabolta) with the stagehand `agents` workers voicing it
(`deskMindsOf`, off `AgentHub.workerList()`), and `deskStatus` adds a
🧠 chip per mind. A worker coming or going does not bump `rev`: it shows
on the next answer (a long poll answers within 25 s).

## 3. The story

- **Story → desk.** A live `cue X` directive whose `X` is a desk cue id
  starts that cue (`source: "story"`, `by: "the story"`). Desk cue ids never
  equal a look's name, so the lights module and the desk never both act on
  one `cue`. Only live commits start runs: a journal **replay** after a
  restart plays nothing (the house already did it).
- **Desk → story.** An `event` step and a cue's `done` fire the event as a
  journaled signal with the label `House desk` (the journal's `by`), exactly
  as a sensor posts `door_sensor_opened`. The story hears it with
  `when <event>:`. A replay re-derives the same story from the journal. A
  refused signal shows in the run as `refused`.
- **Lints.** `loomcheck` and the LSP count a project `desk.json`'s events
  as fired, and its cue ids as handled `cue`s, so a story built on the desk
  lints clean.
- Pressing GO by hand fires the same events. That is how a rehearsal runs
  the heart without opening the door. The Desk lists a cue's story events
  beside GO, so nobody fires them by surprise.

## 4. The router (stagehand `audio`)

- `GET /api/mod/audio` gains `plays` (the last 16, at most 60 s old):
  `{seq, at, by, sound?, say?, to: string[] | null, gain: number | null,
  chime?: boolean}`, with exactly one of `sound` / `say`. Its long poll
  takes `plays=<seq>` and answers at once for a newer play. Like tests,
  the first answer only primes the router's cursor, and the router drops a
  play more than 10 s old by the server's `now`.
- A `sound` play routes exactly like a story `sound` with `rooms:` = `to`
  (no `to`: `cues[sound].to`, else everywhere). `gain` is added to each
  speaker's gain. A `say` play rings the chime (unless `chime: false`) and
  speaks on the `announce` bus to `to` (no `to`: `audio.json`
  `announce.to`), ducking the sfx bus as ever and, since wave 38, the music
  (`priority.announce`).
- `POST /api/mod/audio/report {health?, acks?}` (memory only):
  - `acks`: `[{seq, kind: "play" | "test", result: "played" | "closed" |
    "nowhere" | "no-file" | "error", ms?}]`. `ms` is the sound's or the
    rendered speech's length. The router posts an ack as soon as it
    handles a play or a test.
  - `health`: `{ok, device, layout: "ok" | "moved", voices, xruns,
    peakDb, announce: "on" | "off" | "blocked", missing: [...],
    placeholders: [...], sounds: {name: ms}}`. The router posts it every
    `health_s`, the same numbers as MQTT `health/audio/stats`.
- An older router ignores `plays` and never reports. The desk then shows
  *no answer* and ends a sound step after `DESK_ACK_MS`.

## 5. The terminals: speech done

A terminal's poll (`/api/screen/state`) adds two fields:

- `talk=1|0`: is it speaking, or holding unspoken room lines?
- `said=<seq>`: the newest room-line seq it has finished (spoken, skipped
  or muted).

When its speech queue drains it polls at once, not on the next 2 s tick.
The server keeps the last of each per terminal, in memory, beside the
heartbeat.

A `speech` step on `room` ends once every online terminal that speaks
`room` (polled in the last 6 s) has reported, at or after the step's start
plus `DESK_SPEECH_GRACE_MS`, `talk=0` with `said` at or past the room's
newest line seq. With no such terminal it ends at once (`no terminal`). At
`max` it ends `timeout`. A terminal too old to send `said` counts on
`talk=0` alone.

## 6. The screens

### 6.1 Editor: Run → House

A server-run tab (`CockpitTab.House`). On a local folder it explains that
it needs a server project.

- **Status strip.** `deskStatus` chips, ■ STOP ALL (the panic:
  `desk/stop {all}`), and the source line with Save to project.
- **Cue list** (the middle).
  - The sections and cues, the playhead ▶ row, each cue's number, name and
    one-line step summary, its planned length (`cueTimeline`) and its story
    events.
  - Running runs show a progress bar and step states.
  - A big **GO** (Space), **Stop** (Esc), and the playhead ↑ / ↓.
  - Double-click a row to GO it.
- **Inspector.** Edit the selected cue: its fields, then the steps as rows
  with kind, fields from selects over `house` (sounds, targets, looks,
  fixtures, rooms, events), the start toggle (with ↑ / then), wait and a
  timeline bar. Add, duplicate, delete and reorder cues and steps. Problems
  and warnings show inline. Save sends `POST /api/mod/desk` with `base`.
- **Checks.** `deskChecks` sections: Test / colour buttons and ✓ / ✗
  marks, `checkProgress`, and *Test next* (`nextOpenCheck`). Keys: T
  tests, Y marks ✓, N marks ✗, ↓ goes to the next open check.
  `testNeedsConfirm` asks first once the show is live.
- **Zigbee pairing** (`/api/mod/lights/pair`) and *Reset marks*, director
  only.

### 6.1b Editor: the Cue designer and Setup (wave 30)

Run → House has three views under the status strip (`store/house-view.ts`):
**Desk** (§6.1), **Cue designer** and **Setup**. The keys of §6.1 work in
the Desk view only.

- **Cue designer** (`components/house/CueDesigner.tsx`, store
  `store/cue-designer.ts`, pure `lib/cue-designer.ts`). It reads
  `GET /api/mod/lights` (the whole `lights.json` in force) and the map
  (`/api/spatial/house`) every 15 s while nothing is edited, and edits the
  looks with `@loom/house`'s `look-edit.ts` ops, previews them with
  `look-preview.ts` (`previewAt` over `planLook`) and starts new ones from
  `look-templates.ts` (`lookFromTemplate`, Zigbee-safe, holding the
  targets' safety floor `lookFloor`). Save is `POST /api/mod/lights {lights,
  base}` (409 `stale` → ask), Save to project `POST
  /api/mod/lights/project`; ▶ Test on the house is `lights/test {look}`
  (saving first when the look is dirty), ▶ Try a step `lights/test
  {fixture, set}`, an audition `audio/play {sound, to?, gain?}`. Every
  test asks first while `live`. Sounds and desk cues come from the desk
  view; *+ Desk cue* builds one (`soundCue` / `lookCue`) into the desk
  draft and opens it in the Desk view's inspector. **In the story** finds
  the `cue X` / `sound X` statements and `when X:` headers in the indexed
  story (`storyUses`) and opens them in Writing.
- **Setup** (`components/house/SetupPanel.tsx`): `deskSetup(view)` (pure,
  `house-desk.ts`): one row each for the sound router, the lights module
  and every `mind: external` character (`house.minds`), with a tone, a
  status line and what to do. The same rows are the hosts' Desk Setup
  (§6.2). Then the bring-up order, 🔗 Pair a bulb, the checks' progress
  and the help articles (`house-setup`, `cue-designer`, `house-desk`).

### 6.2 Play: the host's Show and Desk

A host booth gets two windows in place of the pull-up drawer. The taskbar
reads `Show · Chats · Desk · Scan`.

- **Show** (the default window, `host/show-model.ts` pure + a `.tsx`):
  - the night strip (act · phase · show clock · caller · paused), on one
    line that scrolls sideways (wave 37: `.host-show-strip` never wraps);
  - a big NEXT card with ARM → FIRE, its description and `then:`;
  - LAST with `did:`;
  - *Needs you* (wave 37: first, and open while something waits);
  - *Your jobs*: the host's own objectives, the NOW card's content;
  - *Coming up*: the next cues of the act and the countdowns;
  - the Judge, People and More sections the drawer had.
- **The slim NEXT bar.** It stays above the taskbar only while another
  window (Chats, a room) is open, so a host can fire without leaving. A tap
  on it opens Show; the drawer is gone.
- **Desk** (a lazy chunk). Wave 59 (`host/desk-tabs.ts`, new words `DRAFT w59d`) cut
  the long scroll into sub-tabs. The top never moves: the status chips, ■ STOP ALL,
  a chip for a running cue (it jumps to Cues), the note, the tabs. A tab is mounted
  only while it is open, so 🎵 Music and 🎚 Mix poll nothing until then. The first
  tab is this device's last one, else Music for Task Manager, else Cues.
  - **🎛 Cues**: the standby cue with a big **GO** (its story events named), the
    running runs, the cue list (tap to set standby), Lately.
  - **🎵 Music** (`host/music.tsx`) and **🎚 Mix** (`host/mixer.tsx`).
  - **🖥 House** (`host/desk-house.tsx`, over the console's host view): 🌀 his voice
    (modes and a flavour), 🔇 the TV's voice, ■ with the announcement, 🌀 Clippy's
    dream (the story's `dream_toggle`, read from `terminals.dream`), ⚡ in a talk
    scene, **Try it**, 📟 every terminal's state and build stamp with Identify. The
    host view's terminals carry the heartbeat's device fields for it (`hostTerminalDevice`,
    never the patch bay). Every write was already on the host allowlist. 🎭 the
    costume's switch and the descent stay a director's, and the tab says so.
    `LandingSlot` is where 📷 Photos and 📢 Audio ads are wired.
  - **Try it** (wave 30, on 🖥 House): *Say on the speakers* (`audio/play {say}`, ≤
    `DESK_SAY_MAX`), then the house's looks (`lights/test {look}`) and the
    story's sounds (`audio/play {sound}`) as tap-to-play rows (the checks'
    own tests; no marks). A list says once when its router / lights module
    is away; the note after a tap says what was sent and whether anything
    was there to play it (the answer's `router` / `module`). Once `live`
    each asks first, as the checks do. Opening the doors wakes the held polls, so a
    Desk already on screen knows at once;
  - **🔌 Setup**: a folded *How the Desk works* (`deskHow`, a line per tab), then one
    card per `deskSetup` row (sound, lights, each outside mind), tone-coloured with
    its status line and *What to do* (the `fix` steps: open for `bad`, folded for
    `warn`); one *All connected ✓* line, tap to unfold, when every row is `ok`. Then
    the checks, built for walking: one row at a time with **Test**, **✓ Heard it**,
    **✗ Nothing**, and next.
  - No cue editing in Play. The hosts' help: `docs/help/play/20-house-desk.md`.

## 7. Not in this wave

- Firing story INTERACTIONs from a desk step (use an `event`).
- Per-voice stop, router meters, input tests, editing the routing matrix
  (the map editor's Audio tab stays where speakers are placed).
- Wiring the show's own Heart beats onto desk cues: the mechanism lands
  first, then the beats move over after an on-site run (their text was
  signed off on 2026-10-27, `history/SIGNOFF-w20.md`).
