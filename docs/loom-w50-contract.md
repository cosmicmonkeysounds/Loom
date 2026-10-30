# Wave 50 contract: Clippy's dream

2026-10-30. The ask: *"at the moment that Y2K bug is revealed, the house should
enter a new glitch era: take this video and fit it on the server so we can
stream it to the terminals and reinstallation game; Clippy's dream video takes
over the terminals (each one is randomly staggered at a different spot so they
are de-synced). the regular ads are replaced by this, but there is still a
priority queue for what is shown: things like announcements and cutscenes can
still get through, but they are data moshed."*

No show text is new but the director's 🌀 button and its `# hosts` lines. The
video has no sound and the terminals play none of it.

One lane, `oct31-w50/dream`, merged `--no-ff`. (Wave 49 is the props, the descent
and the footsteps, `oct31-w49/*`.)

## C1 The moment

The reveal is `y2k_clock` (🕚): its beat, *The Y2K Clock*, ends its third line on
*"Worst case scenario — we will have to face the Y2K BUG."*, the first time the
story names the bug.

- The rule sets `Night.dream = true` (a story var, so a restart keeps it) and
  cues `dream_begin` (never a screen cue: no slide, no family).
- The screen state's `dream {at}` is present while `Night.dream` is on and
  `Night.ended` is not. `at` is the takeover's server time, **ahead of time**,
  so a terminal readies its video first and every screen goes together.
- `at` = the cue + `DREAM_FALLBACK_MS` (42 s: past the slowest voice, since his
  word can only bring it sooner) until the TV reports the sentence:
  when its voice starts a chunk matching `/\bY2K BUG\b/` it polls at once with
  `bug=1` (`RoomSpeech.namedBug`, carried 4 s), and `at` becomes the receive
  time + `DREAM_LEAD_MS` (3.2 s), which lands on the words and beats a wall's
  2 s poll. First report wins, only from `view=tv`, only ever sooner.
- The cue from history (a restart replaying it) is `at: 0`: simply on, no
  takeover. `dreamAt` and `dreamHeard` are memory only.
- An ending ends it. 🌀 `dream_toggle` (Anytime, an aside, appended last so no
  cue number moves) turns it off and on from 🕚 until an ending.

## C2 The media

Outside git and the images (`scripts/ops/dream-media.sh`):

| File | For | Size |
|---|---|---|
| `dream/dream-720.mp4` | the TV: 1280×720, 20 fps, H.264 High, ~1.25 Mbps | 561 MB |
| `dream/dream-480.mp4` | every other terminal: 854×480, 20 fps, H.264 Main, ~0.63 Mbps | 284 MB |
| `dream/frames/000001.jpg…010800.jpg` | the games, and a wall whose video fails: 3 a second, 320×240, a 4:3 centre crop | 118 MB |

No audio; a keyframe every 2 s and `+faststart`, so a terminal seeks to its place
over byte ranges. The whole house is about 9 Mbps from the VPS.

On the VPS the set is `~/loom-media/dream`. Compose mounts `${LOOM_MEDIA_HOST_DIR:-../loom-media}`
read-only into the proxy (`/srv/media`; Caddy's `handle_path /media/*` + `file_server`
answers it and the event server never sees the request) and into the server
(`/media`, `LOOM_MEDIA_DIR`, for the games' frames). With no proxy (`pnpm dev`, LAN)
`server.ts` answers `/media/` itself from `LOOM_MEDIA_DIR`; unset, there is no route.

## C3 The priority order

The order on a screen does not change; the dream is a new bottom layer.

```
blackout                          true black, never moshed
overlay > moment > slide > banner moshed (C5)
a line, a walk, a board           never moshed: someone is using the screen
the dream                         where the idle show was
```

- **It replaces the idle show** (`IdleShow`: its saver, ads, popups, storms,
  TOUCH ME, sounds and timers all stop under it), so it has the show's place on
  every kind of screen: a wall asleep or awake (the scan box stays over it),
  the tent's backdrop, the TV's attract. The TV's base and the chess and casino
  terminals' idle half mount it themselves (`DreamView`); never on a board or
  at a table.
- **The y2k slide lets it through.** It is up all hour, so `coverOf` no longer
  counts it as a cover once the dream is `through`: the scene draws its clock
  on a transparent stage (TV: the tray, top right, clear of his caption; wall:
  top left, clear of the scan box) and takes no taps, so a guest's first tap
  reaches the scan box. The hour's popups go with the ads. The ticker, the
  chimes' dialogs and the last minutes' counts stay.
- A linked wall (a player in its room) keeps the world: that outranks the dream.
- His face comes through on the TV for a line after `DREAM_HOLD_MS` (12 s past
  the takeover: he is mid-line when it falls, and it must not snap back).

## C4 The games

Both games already hang a JPEG feed on every terminal in the player's room, so
the dream reaches them down `GET /api/spatial/cams` + `/cam?spot=` and **neither
game changes; a Quest APK from before this wave shows it.** While it runs
(`DreamFeed`, `dream-feed.ts`):

- `cams` lists every spot on the map but the tent's, camera or none, under the
  usual room filter.
- `cam?spot=` answers that spot's moment of the hour (`dreamFrameIndex`: what
  the real wall shows), with `x-cam-at` moving per frame.
- The room's real camera breaks through for 3 s in every 24 s, on each
  terminal's own beat, where it has a fresh frame: the game's window into the
  real house is a feature the Y2K hour needs.

## C5 The data mosh

A browser can't read a page's pixels, so `Mosh.tsx` is a small canvas over the
screen (z 43, no taps, pixelated, TV 384×216 at 20 Hz, a wall 256×144 at 12 Hz),
see-through except where blocks have gone bad, the live page crisp beneath.

- `stamp.ts` redraws the top layers onto a hidden canvas: boxes, text, canvases
  and images, ≤ 400 nodes, every 1.5 s.
- Each 6.4 s cycle is a keyframe: 18 % of it clean, then macroblocks go in
  islands, up to 55 % of the screen. A block takes the scene's copy, drags its
  own last tick a little further each tick (the smear) and the dream bleeds in;
  30 % of islands take only its colour.
- `moshMode` (pure) decides. The takeover is its own mode: `DREAM_TAKE_MS`
  (2.4 s) to 100 % of the dream, then the real video underneath.
- Plain 2D `drawImage` with a double buffer and run merging, so the oldest
  tablet runs it. Nothing flashes: a cycle is 0.16 Hz. Reduced motion: one
  still, and the takeover is a cut.

## C6 Staying up

One player per page (`player.ts`), handed between views, so a screen swap never
re-buffers. A terminal's place is pure (`@loom/house` `dreamPositionS`: hash of
its spot, salted so the show's 14 spots are ≥ 110 s apart, + the server's time),
so nothing is remembered: a reload lands where it was.

A stall (9 s) or error reloads the video; 3 failures, or at once a browser that
refuses to autoplay it, fall back to the frames, one load at a time, 3 s to
land; 6 misses there is `failed`, and the terminal keeps its old idle show and
y2k slide. Only the clock moving counts as playing, never a seek's `timeupdate`.
Every 60 s a fallback tries the video again beside itself, and it takes over
only by playing. With no view for 20 s (a line, a game) the video pauses and
costs nothing, and picks up at its place. The dream's own code
is in the base bundle: a lazy chunk can be gone hours after boot.

The source's full-field luminance was measured: at most 1 flash a second, never
over 3 Hz.

A Fully Kiosk tablet needs **Autoplay Videos** on (`docs/trapped/kiosk.md`): a
WebView that refuses to play reads as a stall and lands on the 3 fps frames.

## C7 Shipping

1. `scripts/ops/dream-media.sh upload` (done 2026-10-30: `~/loom-media/dream`,
   checksum matched). Touches nothing running.
2. Roster check, `predeploy`, `ship.sh`. The release recreates the proxy and the
   server with the mount. Check `/media/dream/dream-480.mp4` answers 206 to a
   `Range`, and `pnpm showctl doctor` shows *Clippy's dream* green.
3. `sync-show` with its reload: the story changed.
4. Reload every terminal and the TV. The Quest needs nothing.
5. Rehearse it: `?preview=dream&what=banner|slide|take|plain[&target=tv][&key=<spot>]`
   on any provisioned terminal, then 🕚 on a scratch run.
