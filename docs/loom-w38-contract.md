# Wave 38 contract: the house soundtrack, priority ducking, the SFX library

2026-10-28. Lanes `oct31-w38/<lane>`. This file is the interface between the
lanes: names, shapes and files here are binding; anything not written here is
the lane's own choice. When code and this file disagree, fix one of them in
the same change.

**Changed in integration (2026-10-28).** The review and the integrator moved
these; each is edited in place below.

- C1.2: input 3 (the TV) has `reach: [everywhere]`, so the sub ducks under
  Trabolta too.
- C3: the report's bed position is camelCase `posS` (the health's own
  `pos_s`), like `peakDb`. Built beyond the text: a hand `music stop` /
  `scene` holds until the next live music cue; an empty or dead playlist
  backs off 10 s; a track's `takeover` defaults to true; a bare `off:` key
  is scene `off`.
- C4: `sidechain.roles` gives a role its own `threshold_db` (Clippy −30, a
  guess to set at rehearsal). The MacBook fallback is output-only.
- C5: the story writes `cue music_<scene>` (the keyword form, like `cue
  lights_*`); act 1 and act 2 also start out of order; a stray
  `line_accepted` does nothing.
- C6: one-shots are set by loudness, not peak. The TV page's own effects
  are silent (`terminal/src/sound/bus.ts`).

## C0. What the user asked for

1. **A library of synthesized SFX** (sirens, dings, dial-up tones, digital
   goodies) as WAV files.
2. **A soundtrack all night**: MP3 playlists, shuffled, one set per act; some
   rooms play their own thing (the Fan Closet: ambient loops); some scenes
   (the rave) play the same thing on every speaker.
3. **Specific tracks at story beats** (story `sound X`, MP3 allowed).
4. **Audio priority**: music ducks under Trabolta (highest) and under Clippy's
   wireless mic; announcements keep ducking.

The user's decisions (2026-10-28):

- **Trabolta is heard on the TV and on every house speaker.** The TV's audio
  (Chrome on John's Desktop) is cabled into an 828x input; the router routes
  it to the speakers and ducks on the *signal* (a true sidechain). No server
  round trip.
- **Clippy's mic stays in CueMix** (hardware, zero latency). The router only
  *meters* MOTU input 1 to duck the music. Trabolta cannot duck Clippy (the
  user accepted this).
- **The living room moves to the 828x Main L/R outs (9, 10) plus a subwoofer
  on its own output** (individual control: its own speaker, its own trim).
- **The Fan Closet's speaker is placed later** in the map editor. Until then
  its scene entry reaches no speaker: a warning, never a failure.

## C1. `audio.json` (the show's, and the schema)

### C1.1 New optional input fields (`house/src/audio.ts`, Python mirror)

```ts
interface AudioInput {
  ch: number; label: string; kind: "software" | "mic" | "line";
  role?: string;      // NEW: a priority source this input drives ("trabolta", "clippy", …)
  reach?: string[];   // NEW: targets (as cue `to`) the source ducks; default below
}
```

- `role` matches `/^[a-z][a-z0-9_-]{0,31}$/`; two inputs may share a role
  (their activity is the max). `announce` and `takeover` are **reserved**
  (C3) and refused as an input role. Refused shapes are problems; an
  unknown-but-well-formed role is fine (the router ignores a role with no
  `priority` entry and `stagehand check` warns).
- `reach` is a target list resolved exactly like a cue's `to`
  (`resolveTargets`). **Default**: the outputs this input's `routes` rows
  feed; with no route, `everywhere`. A `reach` target that reaches no
  speaker is a warning.
- `validateAudio` keeps accepting unknown keys. Older files stay valid.
- The map editor's Audio tab shows and edits both per input (an input row's
  *Ducks as* picker: none / trabolta / clippy / custom, and a reach target
  list using the existing target options).

### C1.2 The show's `audio.json` (done in the contract commit)

| | |
|---|---|
| Outputs | 1 `Analog 1 — Living sub`, 2 `Analog 2 — spare`, 3/4 Kitchen L/R, 5 Hall, 6 Steam Room, 7 CPU, 8 Optical Drive, 9 `Main L — Living L`, 10 `Main R — Living R`, 11/12 Phones L/R |
| Speakers | `living-l` out [9], `living-r` out [10], `living-sub` out [1] (room `desktop`), `kitchen-l` [3], `kitchen-r` [4], `optical-drive` [8] |
| Zones | `living` = living-l, living-r, living-sub |
| Inputs | ch 1 `Mic/Gtr 1 — Clippy's wireless (CueMix)`, `role: clippy`, `reach: [living]`; ch 3 `Analog 1 in — the TV (Trabolta)`, `role: trabolta`, `reach: [everywhere]` (he ducks every speaker, the sub included; the default reach, his route, would leave the sub out) |
| Routes | `{in: 3, out: [3, 4, 8, 9, 10]}`: the TV everywhere but the sub. A new speaker needs its cell ticked on this row |
| `voice.tv` | `["everywhere"]` (documentation, as before) |

## C2. The router's mixer (`stagehand/src/stagehand/audio/mixer.py`, `engine.py`)

- **Buses**: `("sfx", "music", "announce", "test")`. The voice cap (32)
  never drops a `music` voice; it drops the oldest `sfx` voice, now with a
  10 ms fade instead of a cut.
- **Streamed voices.** A voice's source is either an in-memory array (as
  today) or a **stream** (`audio/stream.py`): a file decoded and resampled
  in chunks (≤ 1 s each) by a worker thread into a ring buffer the callback
  reads. The callback never decodes, never resamples, never blocks on a lock
  for longer than a buffer copy. An underrun plays silence and counts
  (`underruns` in health). A stream can `loop` (seamless: at EOF it seeks to
  0 without a gap). The resampler is streaming and band-limited (a windowed
  sinc polyphase filter, ≥ 32 taps), not linear, and holds state across
  chunks (no seam at a chunk boundary). Music files are **never** whole-file
  cached; at most the current and the next track of each bed are open.
- **Live per-voice level**: `Mixer.level(vid | tag, db, ramp_s)`, ramped
  linearly, for the beds' scene changes and fades.
- **Live output trim**: speaker `gain` (trim) moves from per-voice gains to a
  per-output trim vector applied after the mix and before the master,
  ramped over 50 ms on change, so a trim edit (e.g. the sub) is heard at
  once on long beds. Two speakers on one output: the louder trim (as today).
  The matrix (live inputs) passes through the trim too.
- **Inputs are metered** whenever the stream is duplex: per input channel a
  block peak (dBFS), and for each input with a `role`, a **sidechain**: the
  peak above `sidechain.threshold_db` opens it, it stays open `hold_s` after
  the last block over the threshold, and the source's *activity* `a ∈ [0,1]`
  moves toward 1 over `attack_s` and toward 0 over `release_s`.
- **Priority ducking** replaces the single duck. Sources: every input `role`,
  plus `announce` (active while any `announce`-bus voice plays, or while an
  external announcement's `duck_for` hold runs) and `takeover` (active while
  any voice flagged `takeover` plays). Each source has a **reach** (a set of
  outputs: C1.1 for inputs; `announce.to`'s outputs for `announce`; the
  takeover voice's own outputs for `takeover`). For each bus `b` and output
  `o`, the duck gain is `min over sources s reaching o of (1 − a_s·(1 −
  lin(depth[s][b])))`, ramped across the block. Depths come from YAML
  `priority` (C4); `takeover → music` is fixed at −120 dB (silence). A voice
  with `duck=False` (`no_duck`, cue `duck: false`) is never ducked. The
  `announce` and `test` buses and the matrix are never ducked.
- Meters out: `inputs {ch: peak_db}`, `sources {name: activity}` (0..1),
  `underruns`, as today plus these.

## C3. The soundtrack (`stagehand/media/soundtrack.yaml`, `audio/soundtrack.py`)

Tracked YAML next to `sounds.yaml`. Paths are relative to the YAML's folder
(`stagehand/media/`). `media/music/` and `media/library/` are git-ignored.

```yaml
version: 1
level_db: -10           # every bed's gain (beds sit under the cues)
crossfade_s: 3          # between two tracks of one playlist
scene_fade_s: 2.5       # a bed that leaves or joins on a scene change
playlists:
  doors:      {dir: music/doors}                 # *.mp3 *.wav *.flac *.ogg *.aiff, shuffled
  act_1:      {dir: music/act-1}
  fan_closet: {files: [library/ambient/dryer-tumble.wav], loop: true, level_db: -14}
scenes:                 # `cue music_<scene>` / `Night.music = "<scene>"`
  doors:
    - {to: everywhere, play: doors}
    - {to: The Fan Closet, play: fan_closet}     # later entries win on the speakers they reach
  off: []               # silence
tracks:                 # story `sound X` that take the speakers they play on
  rave: {takeover: true}
```

- **Playlist**: `dir` (every audio file in it, non-recursive) or `files`;
  `shuffle` (default true: a Fisher–Yates order, reshuffled at each pass,
  never the same track twice in a row across passes; the folder is read
  again at each pass), `loop` (default false: a one-file playlist with
  `loop: true` is a seamless stream loop; without it a one-file playlist
  cycles, crossfading into itself; a many-file playlist always cycles),
  `level_db` (added to the top level). A missing or empty folder is a
  warning; that bed is silent and tries again every 10 s (`RETRY_S`). A
  file that plays under 1 s or fails to decode counts as dead: once a
  whole pass is dead, the bed backs off 10 s too (logged once).
- **Scene**: an ordered list of `{to: targets, play: playlist | null}`. A
  bare `off:` key (YAML reads it as `false`) is the scene `off`.
  Each speaker takes the last entry that reaches it; `null` is silence. The
  speakers that share a playlist form one **bed**: one stream (stereo laid
  per speaker as today), crossfading between tracks.
- **Scene change**: a bed whose playlist *and* speaker set are unchanged
  keeps playing untouched (the Fan Closet loop runs on across acts); a bed
  whose playlist is unchanged but whose speakers changed keeps its
  position (new voice at the same point, crossfaded); every other bed fades
  out over `scene_fade_s` and the new ones fade in. A scene change to the
  current scene is a no-op.
- **Tracks** (`tracks:`): a story `sound X` named here plays as a *stream*
  on the `sfx` bus with `takeover: true` (C2: the beds on its outputs fall
  silent while it plays and come back after). Every `no_duck` sound of the
  show is a track. A track may be an MP3. `takeover` defaults to true;
  `takeover: false` streams the track without taking the speakers.
- **Scene sources**, first one that applies wins at each moment:
  1. a live `cue music_<scene>` on the mod feed (`sim` directive `cue`,
     first word `music_<scene>`; an unknown scene is logged once and
     ignored: the current scene plays on);
  2. MQTT `show/audio/music {"scene": "<scene>"}` (or `{"next": true}`:
     skip the current track on every bed; `{"stop": true}`: scene `off`).
     A stop or scene by hand **holds**: later feed catch-ups skip it until
     the next live `cue music_*` or a story restart;
  3. **the catch-up**: `night.music` from `GET /api/screen/state` (as the
     lights job reads `night.lights`), on module start, on a feed
     reconnect, and 2 s after a lifecycle restart (`reset`, `reload`,
     `golive`, `ended`). A live cue that lands while the state is read wins.
     A null or unknown value is scene `off`.
- **Stop house sounds** (`stop_all`) fades the beds out too; the next scene
  cue (or a `{"scene"}` MQTT message, or a catch-up) brings them back.
- **Health / report**: `music: {scene, beds: [{playlist, speakers, track,
  posS}], missing: [playlists with no file]}` in the report (the health's
  own dict and `health/audio/stats` say `pos_s`; the report is camelCase,
  like `peakDb`), plus `inputs`, `sources`, `underruns` (C2). A router
  with no soundtrack sends no `music`. The server's `AudioHealth` accepts these optional fields
  and `showctl doctor` prints the scene and the input levels.
- **CLI**: `stagehand music scene <name> | next | stop | status --config …`
  (MQTT like `sounds play`; `status` reads the retained
  `health/audio/stats`).
- **`stagehand check --only audio`**: lists every playlist with its file
  count, every scene entry that reaches no speaker (warning), every track
  with no file, and the sidechain roles with no `priority` entry.

## C4. The router YAML (`stagehand/trapped.house.yaml`, `audio.example.yaml`)

```yaml
audio:
  passthrough: true          # duplex: the TV route and the meters (was false)
  soundtrack: media/soundtrack.yaml
  priority:                  # dB at full activity, per bus; replaces duck_db
    trabolta: {music: -18, sfx: -8}
    announce: {music: -15, sfx: -12}
    clippy:   {music: -12}
  sidechain:
    threshold_db: -45
    attack_s: 0.04
    hold_s: 0.8
    release_s: 1.2
    roles: {clippy: {threshold_db: -30}}   # a role's own threshold
```

- `sidechain.roles.<role>.threshold_db` overrides the threshold for one
  role. Clippy's open lav hears the party, so the show sets −30 dBFS (the
  TV's clean line stays at −45). The −30 is a guess: at rehearsal, play
  the music at party level with the lav idle, read input 1 in `stagehand
  music status`, and set it about 6 dB over that.
- With no `priority:` key the default is `{announce: {music: -15, sfx:
  -12}}`.
- **The MacBook fallback is output-only** (`trapped.macbook.yaml`
  `passthrough: false`): a launchd job gets no microphone, so the TV is not
  routed and nothing ducks under Trabolta or Clippy there; the
  announcements and the takeover tracks still duck.

`duck_db` is removed (rename, never deprecate: a YAML that still has it is a
config error naming `priority.announce.sfx`). `duck_hold_s` stays (the
external announcer's hold). `no_duck` stays.

## C5. The story (`core/examples/trapped-in-the-internet/`)

- A new mirror `Night.music` (declared with the other `Night.*` vars),
  and at each act change both `cue music_<scene>` (the keyword form every
  `cue lights_*` uses; the same `cue` directive) and
  `set Night.music = "<scene>"` at the same indent, the lights pattern:

| Scene | Where |
|---|---|
| `doors` | `Power On` |
| `act_1` | `call_to_the_desktop` |
| `malware` | `second_hunt_preview` (Ad Hijack; `ad_jingle` is a track and takes over first) |
| `act_2` | `five_minute_warning` |
| `act_3` | `y2k_clock` |
| `final` | `final_reveal` |
| `off` | every rule that ends the night (`Night.ended = true`) |
| `ceremony` | `start_the_ceremony` |
| `afterparty` | `resurrection` |

- **Out of order.** `act_1` also starts at `start_the_bingo` (Bingo
  before the Desktop call) and `act_2` at `truth_pong` (Truth Pong before
  the five-minute warning), each only while the music is still on the
  scene before it (`doors`, `malware`).
- **`line_accepted`** has its ROLE caller's guard (`Night.phase ==
  "grok_prom"` and the night not ended): a stray press after an ending
  does nothing and says nothing (no new host text).

- The server's `ScreenNight` gains `music: string | null` (from
  `Night.music`, as `lights`).
- `stagehand/tests/test_trapped_house.py` pins: every `cue music_*` in the
  story and every `Night.music` value is a scene in `soundtrack.yaml`; every
  scene the YAML defines is reachable from the story or is `off`; every
  `no_duck` sound is a `tracks:` entry.

## C6. The SFX library (`stagehand/src/stagehand/audio/sfx/`)

- A package: `dsp.py` (the shared synthesis primitives: oscillators, noise
  colours, envelopes, biquads, FM, delay/reverb, bit-crush, normalise),
  one module per category (`sirens`, `dings`, `telephony`, `digital`,
  `retro`, `party`, `story`, `ambient`), and `registry.py`:
  `SFX: dict[str, Spec]`, `Spec(name, category, render: (rng) -> ndarray,
  seconds, loop: bool, story: str | None, note: str)`.
- Every sound is **original** synthesis (no sample, no recreation of a
  trademarked sound: no Windows / Mac / AOL / Nokia / Intel motif). Generic
  protocol tones (North American dial tone 350+440 Hz, ringback, busy, DTMF,
  V.8 / V.34 handshake character, fax CNG) are fine.
- Deterministic: a seeded `np.random.Generator` per sound (seed from the
  name), so a re-render is byte-identical.
- Render: 48 kHz, 16-bit, mono (an ambient loop may be stereo). One-shots
  are set by loudness: the loudest 400 ms window at −16 dBFS RMS
  (`ONESHOT_LOUD_DB`; a `Spec.level_db` overrides it), the peak capped at
  −1 dBFS by turning the whole sound down (never by clipping), so a spiky
  sound may land under target. Ambient loops ≈ −18 dBFS RMS (or their
  `level_db`) and **seamless** (the last sample flows into the first). RIFF INFO `ICMT = "loom-sfx v1 —
  <note>"` (not the placeholder tag, so the router treats it as real).
- `stagehand sounds library [--out DIR] [--only a,b] [--list] [--story]`:
  writes `media/library/<category>/<name>.wav` (ambient loops in
  `media/library/ambient/<name>.wav`). `--story` also writes each story
  sound that has a library equivalent (`media/sounds.yaml` key `library:
  <sfx name>`) into `sounds_dir` as `<story name>.wav`, overwriting only a
  placeholder or an older `loom-sfx` file, never another real file.
- The ambient loops include one per `LOCATION … ambient:` key in
  `main.loom` (`dryer-tumble` is the Fan Closet's).

- **The TV page's own effects are silent** (`terminal/src/sound/bus.ts`
  `VIEW_VOLUME.tv = 0`). Its sound is cabled into input 3 as Trabolta's
  channel, so an accent there would play on every house speaker and duck
  the music like his voice.

## C7. Out of scope (wave 38)

Shipping; moving the Heart's server-room voice; ducking Clippy under
Trabolta (CueMix); a Run → House UI for the soundtrack (health only); per-bed
EQ or a sub crossover (the sub's own low-pass does it).
