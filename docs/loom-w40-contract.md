# Wave 40 contract: the house mixer

2026-10-28. The ask: *"a mixer panel for the Play / Edit app, only for
Hosts / directors. I should be able to balance sources per zone or
globally, skip playlist tracks, etc."*

One live balance of the house sound, moved from Run → House → 🎚 Mixer
(the editor) or a host's Desk window (Play), carried by the event server
to the sound router on the Desktop, heard within a block. Plus the
soundtrack's transport: what each bed is playing, skip, pick a scene by
hand, stop, follow the story again.

Lanes (branches `oct31-w40/<lane>`, merged `--no-ff`):

| Lane | Owns |
|---|---|
| `contract` | this file, `core/src/house-mixer.ts` (+ test, fixture), the package export and the editor alias |
| `server` | `core/server/audio.ts`, `core/server/store.ts`, `core/server/routes/host.ts`, `core/server/event-runtime.ts` (wiring only), their tests; `scripts/show/` (one doctor row) |
| `router` | `stagehand/` (mixer, module, soundtrack, a new `audio/mix.py`, cli, tests, docs) |
| `editor` | `editor/src/components/house/` (a `MixerPanel.tsx`), its store + tests, `editor/src/lib/api.ts` |
| `play` | `play/src/host/` (the Desk window's mixer), its tests |

Docs and help (`docs/help/authoring/`, `docs/help/play/`, the show folder
runbooks, CLAUDE.md rows) land at integration.

## C0 Decisions

- **Who.** Directors (the author's session or a full mod token) and hosts
  (the host allowlist). Never guests, booths that are not hosts, or the
  router's own routes.
- **Scopes.** *Everywhere*, each **room** that has a speaker (audio.json's
  `speakers[].room`, named from the house map), and each **speaker** (the
  sub gets its own fader). Rooms partition the speakers, so a level is never
  counted twice; audio.json `zones` stay a routing word, not a mixer scope.
- **Sources.** `music` (the soundtrack's beds), `tracks` (every
  `soundtrack.yaml` `tracks:` entry a story `sound` plays: the rave, the
  dance song, …), `sfx` (every other story / desk sound), `announce` (house
  announcements and their chime), and each routed input as `in:<role>`
  (`in:trabolta`, the TV; `in:<ch>` for a routed input with no role). An
  input with a role but no route (Clippy's mic, mixed in CueMix) is a
  **meter only**: the router cannot move it.
- **The sum.** A source on a speaker plays at `master + src:<s> +
  room:<r> + room:<r>/src:<s> + spk:<id>` dB (`effectiveDb`); any mute or a
  level at the floor (−60 dB) silences it. Faders run −60 … +10 dB on a
  0.5 dB grid. The router's limiter still holds the peak at −1 dBFS.
- **Not the install trim.** audio.json's speaker `gain` stays the install
  trim (the map editor). The mix rides on top and never edits audio.json.
- **Kept, not journaled.** The mix lives in the event's state dir
  (`audio-mix.json`), survives a server restart, a router restart and a
  story restart, and is never journaled (it is not the story). A Reset is
  the way back.
- **Tests bypass the mix.** A speaker test (`bus test`) is never mixed, so
  a muted room can still be walked.
- **Ducking.** The mix is after the duck. A source muted at
  `src:in:<role>` (or `master` muted) stops ducking too: muting the TV
  everywhere must not leave the music dipping under a voice nobody hears.
  A room / speaker mute of an input leaves its ducking alone.
- **Music commands** are one-shot (memory only, like the desk's plays):
  `next` (one bed or all), `scene` (by hand: held against the story's
  catch-ups until the next live `cue music_*`, as `stagehand music scene`
  is), `stop` (held the same way), `story` (let go of a hand scene: the
  story's scene again, now).
- **Directors stay unseen.** No `by` reaches the mixer view.

## C1 The shared module (`core/src/house-mixer.ts`, `@loom/core/house-mixer`)

Dependency-free; play imports it by path (`../../../core/src/house-mixer.ts`).
It holds the keys (`mixKey`, `parseMixKey`), the levels (`MixLevel`,
`AudioMix {seq, levels}`, `clampMixDb`, `applyMixChanges`,
`mixLevelsOf`), the sum (`mixKeysFor`, `effectiveDb`), the sources and
rooms of a config (`mixerSources`, `mixerRooms`), the music commands
(`MusicCommand`, `musicCommandOf`, `MusicCommandEntry`), the views
(`MixerMeters`, `MixerMusic`, `MixerView`) and the panel's strips
(`mixerScopes`, `scopeStrips`, `scopeKeys`, `meterFill`, `peakOf`,
`formatMixDb`). Constants: `MIX_DB_MIN` −60, `MIX_DB_MAX` 10,
`MIX_DB_STEP` 0.5, `MIX_LEVELS_MAX` 256, `MIX_CHANGES_MAX` 64,
`MIX_WATCH_MS` 8000, `MIX_METERS_STALE_MS` 3000, `MIX_METERS_EVERY_MS`
250, `MUSIC_COMMANDS` 16, `MUSIC_COMMAND_MS` 60000.

`core/test/fixtures/house-mixer.json` pins `effectiveDb`; stagehand copies
it byte for byte to `stagehand/tests/fixtures/house-mixer.json`.

## C2 The server (`core/server/audio.ts`)

`AudioHub` gains:

- **The mix.** `mix(): AudioMix`; `setMix(changes, {resetAll?})` →
  the new mix (seq + 1, saved through `Store.saveAudioMix`, loaded at
  construction by `Store.loadAudioMix` → `{seq, levels}` read through
  `mixLevelsOf`; seq persists so a restart never reuses one). More than
  `MIX_LEVELS_MAX` levels after a change → refused. Every change wakes the
  long poll.
- **Music commands.** `music(cmd, by)` → a `MusicCommandEntry` (its own
  seq, the last `MUSIC_COMMANDS`, ≤ `MUSIC_COMMAND_MS` old), wakes the poll.
- **Meters.** `meters(raw)` keeps the router's last packet (`MixerMeters`,
  stamped `at` = server now; peaks clamped to [−120, 24], lists capped like
  the health's; `music` in the packet, when sound, replaces the
  now-playing the view shows) → whether a panel still watches.
- **Watch.** `watchMixer()` (each mixer GET) extends `MIX_WATCH_MS`; the
  first one after a quiet spell wakes the long poll. `mixWatched()`.

Routes (all under the event, mod auth):

- `GET /api/mod/audio` (the router's and the map editor's) gains `mix:
  AudioMix`, `music: MusicCommandEntry[]` and `mixWatch: boolean`. The
  long poll takes `mix=<seq>` (moved when the mix's seq differs: a restart
  answers at once), `music=<seq>` (as `plays=`) and `watch=0|1` (moved when
  `mixWatched()` differs from what the router said).
- `GET /api/mod/audio/mixer` → `MixerView`. Calls `watchMixer()`. `meters`
  is null when older than `MIX_METERS_STALE_MS`; `music` is the freshest of
  the meters' music and the last health's (`null` with neither). `rooms`
  are named from the house map in force. **Host allowlist (GET).**
- `POST /api/mod/audio/mix {changes: MixChange[], resetAll?: true}` →
  `{ok, mix}`; 400 `{error}` for a bad change (the `mixChangeOf` reason
  with its index) or more than `MIX_CHANGES_MAX`; logs one line per post.
  **Host allowlist.**
- `POST /api/mod/audio/music MusicCommand` → `{ok, seq, router}`; 400 for
  a bad command. **Host allowlist.**
- `POST /api/mod/audio/meters {outputs, inputs, sources, buses?, music?}`
  → `{ok, watch}`. The router's own; **not** on the host allowlist.
- The health report's `music` may carry `scenes`, `hand`, `playlists` and
  each bed's `durS` (`audioHealthW38Of` keeps them when sound, drops them
  alone when not).

Additive only: an old router ignores the new GET fields; an old client
never calls the new routes. `scripts/show/` doctor: one row, "Mixer" (the
levels that are not unity, e.g. `3 levels moved; music −6 dB
everywhere`), from the `/api/mod/audio` GET it already reads.

## C3 The router (`stagehand/src/stagehand/audio/`)

- **`mix.py`**: `effective_db(levels, source, room, speaker)` mirroring C1
  (fixture-pinned), and `mix_gains(levels, doc) -> MixGains`: per source,
  per output (1-based → 0-based in the mixer), the linear gain. An output
  wired to several speakers takes the loudest; an output with no speaker
  reads `master + src:<s>` only.
- **The mixer** (`mixer.py`): every voice carries a `strip` (`music` |
  `tracks` | `sfx` | `announce` | `test`); `set_mix(gains)` sets a
  (strips × outputs) gain table ramped over `TRIM_S`, applied to each
  voice's chunk on its outputs after the duck (`test` always 1.0); the
  input matrix's target becomes `routes × input gain` (the existing
  smoothing). An input source muted at `src:` (or master muted) is skipped
  by `_update_sources` (it ducks nothing). Live meters keep their own
  accumulators (`take_live()`: output peaks, input peaks, per-strip
  per-output peaks before the limiter), so the health line's `take_meters`
  is untouched. The callback stays O(block) and allocation-light.
- **The module**: applies `mix` from each GET answer whose seq moved (and
  at start from the cache: the mix is cached with the doc), passes
  `mix=`, `music=` and `watch=` on the long poll, serves `music` entries
  (dropping one more than 10 s old by `now`, like plays) in press order
  with the stops and plays: `next` → `Director.next(playlist)`, `scene` →
  `music_scene(hand=True)`, `stop` → `music_scene(OFF, hand=True)`,
  `story` → let go of the hand and catch up now. While `mixWatch` is true
  (or the last meters answer said `watch`), it posts meters every
  `MIX_METERS_EVERY_MS` with `music` (the status below); it stops on
  `watch: false`, and for good on a 404.
- **`Director`**: `next(playlist=None)` skips one bed or all;
  `status()` gains `scenes`, `playlists [{name, tracks, loop}]` and each
  bed's `dur_s` (when the stream knows its length); the module adds
  `hand`. `_camel_music` maps `dur_s` → `durS`.
- MQTT `show/audio/music` also takes `{"next": true, "playlist": "x"}`;
  `stagehand music next [--playlist X]`.
- `stagehand music status` prints the mix too (the levels not at unity).

## C4 The editor (Run → House → 🎚 Mixer)

A fourth view beside Desk / Cue designer / Setup, server runs only (the
same local-run explainer). It polls `GET /api/mod/audio/mixer` every
second while shown (and the tab is visible), and draws:

1. **The strip** across the top: the router online or not ("no router
   listening: the mix is kept and applies when it connects"), its name.
2. **Now playing**: the scene (a picker of `scenes`: picking posts
   `scene`), a "by hand: the story's music cues are held" badge with
   **Follow the story** when `hand`; each bed (playlist, the speakers'
   rooms, the track, a progress bar from `posS` / `durS`, **⏭ Skip**);
   **⏭ Skip all**, **■ Stop music**; the empty playlists as warnings.
3. **The console**: one column per scope (Everywhere, then each room),
   side by side, scrolling across. Each column lists `scopeStrips`: a
   fader (−60 … +10, 0.5 dB), the dB label (`formatMixDb`), a mute
   button, a meter (`meterFill(meterDb)`), "plays at X" when the strip's
   `effective` differs from its own level; a double-click or Alt-click
   resets a fader to 0 dB; meter strips show their note. Each column
   header has **Reset**; the toolbar has **Reset all** (confirm).
4. Moving a fader is optimistic: the panel shows its own value until the
   server's mix seq passes the post's answer; posts are throttled to ≤ 10
   a second per fader (the last value always goes).

## C5 Play (a host's Desk window)

A **🎚 Mixer** section in the Desk window (a host or a director phone),
the same data and posts as C4, laid out for a phone: Now playing first
(scene picker, Follow the story, each bed with ⏭, Skip all, Stop music),
then a scope picker (Everywhere + each room as chips) and that scope's
strips as horizontal sliders with mute buttons and thin meters. Polls the
mixer GET every second only while the section is open. Touch targets
≥ 44 px, nothing under the 16 px field floor (wave 36).

## C6 Tests and checks

- core: `test/house-mixer.test.ts` (C1), a hub + routes test (C2: the
  mix's persistence and seq across a restart, the long poll waking on
  `mix=` / `music=` / `watch=`, the watch's lease and wake, meters
  staleness, host allowlist yes for the three, no for meters, bad bodies).
- stagehand: the fixture, `mix_gains` on the show's audio.json, the
  mixer's strips (a muted room silences a bed there and nowhere else, the
  sub's own fader, tests unaffected, the TV route's gain, a muted
  `src:in:trabolta` stops its duck), the module's wire (cursors, commands,
  the meters loop starting and stopping on `watch`), `Director.next(playlist)`.
- editor and play: the view model and the posts (vitest), the throttle.
- At integration: a scratch server, a fake router report, both panels in
  Chrome.
