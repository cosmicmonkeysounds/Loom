# Wave 59a contract: the audio ads

2026-10-31. The ask: *"after the 2nd round of questions, there should be audio ads
that pop up on the terminals and peoples' phones."* Then the correction: *"the audio
ads should be totally random, and pop up every 3 - 10 minutes on random terminals and
phones. Remember the TV and Tent and Server Room are sacred."* The MP3s are the
WeTransfer folder `spicy-ads`, kept outside the repo.

Branch `oct31-w59/audio-ads`. No story change: the cue list stays at 87 rows, and
**a release is enough, with no `sync-show`.** The only new show text is `▶ Play`,
marked `DRAFT w59a`, and the crew's words on Run's 📢 row.

## C1. Random three ways, and the window

`core/src/audio-ads.ts` holds the 14 ads: Mommy Intro, Adobe, Mizz Butter, Draft King,
Mommy Interlude 1, Ableton Live, Horton Norton, Tippi, Mommy Interlude 2, V, Splenda
Daddy, Steve.exe, Bambi, Mommy Outro. 54 to 112 s each, 18.8 minutes in all. The number
is the file's. Nothing plays in that order.

- **The order is random.** Each pop draws from what this pass hasn't played, so none
  repeats until all 14 have. A new pass then starts, and it doesn't open on the last
  one played.
- **The pace is random.** The gap from one pop's start to the next is a fresh draw
  between 3 and 10 minutes of story time (`ADS_GAP_MIN_MS`, `ADS_GAP_MAX_MS`), so it
  stops with the doors. The first is a draw in the same range from the window opening.
  The shortest gap outlasts the longest ad, so two never overlap. A pop that can't
  start, held or with nobody to hear it, starts as soon as it can. It doesn't skip a gap.
- **Who hears it is random** (C4).
- **The window** (`adsRunning`) is `Night.step` 8 (📓, the second hunt) up to but not
  including 16 (🌑, the final reveal), and not `Night.ended`. It runs on through the
  summons, Truth Pong, the Trust Chart, the overshare and the Y2K hour. 🌑 or any
  ending that comes first shuts it for good. `step` is the same word the costume
  reads, and a story edit must keep it.
- The hunt's hour and the Y2K hour alone are about 18 pops at the average gap, so
  expect the pass to come round. Run counts them all, not 14.

## C2. The media

Outside git and the images, like Clippy's dream. Caddy already serves
`~/loom-media` at `/media/` (`docs/loom-w50-contract.md` C2).

`scripts/ops/ads-media.sh`: `prepare [<source>]` copies them to `~/loom-media/ads` as
`ad-01-mommy-intro.mp3`…, `check`, `upload [--dry-run]`, `remote`. The source folder
is only read. 26 MB. `pnpm showctl doctor` has an *Audio ads* row (it reads the last
file). Ads with no media: each pop-up closes the moment the file fails, with no
sound and no error.

- **Byte ranges.** Caddy's `file_server` answers them, and so does `server.ts` with
  no proxy (`LOOM_MEDIA_DIR`). iOS plays nothing without them.
- **CSP.** `TERMINAL_CSP` already has `media-src 'self' blob:`. `PLAY_CSP` gains
  `media-src 'self' data:`: `'self'` for `/media/`, `data:` for the sliver of silence
  that unlocks the phone (C5). Vite sends no CSP: only a served build proves this.
- **The service worker** has no fetch handler, so it never caches an MP3
  (`core/test/w59-audio-ads.test.ts` pins that).

## C3. On the server

`core/server/audio-ads.ts` `AdsHub`: transport-free, clock and dice injected.

- `tick` runs at the end of `tickOnce`, so it needs open doors. It answers `start`
  (with the phones it picked), `stop` or nothing.
- **Journaled:** `signal("audio_ad_aired", "<n>. <name>", {n})` and
  `signal("audio_ads_switched", "on" | "off")`. No story hook hears them, so nothing
  changes in the story, the chat, `recent` or a booth. They are the mod log's lines.
  `restore` replays them (`replayAired`, `replaySwitched`), so a restart keeps what
  this pass has played and the switch, and never replays the night.
- **Memory only:** what is on the air, who got it, the drawn gap (a restart draws again
  from the last pop) and the announcement hold.
- `loadScenario` resets it (`reset`): a story reload is a new night, switched on.
  `pushLifecycle` stops everything before anything else, so nothing plays through the
  event's Restart. `pause` does too, since the ticker stops.

**Holds** (`AdHold`): nothing starts, and what is on the air stops at once and stays
spent. Run → Terminals and the Desk's 🖥 House say which, read when they ask (nothing ticks behind paused doors).

| Hold | What |
|---|---|
| `doors` | Paused |
| `talk` | `Night.talk` names a scene |
| `cutscene` | On the walls: an overlay, the glitch (8 s), a story slide (its 45 s); one the walls keep up for `AD_STANDING_SLIDE_HOLD_MS` (5 min) from its cue, no longer, because the Y2K clock stands for the whole final hour |
| `blackout` | On the walls: the cue's 10 s, or the overlay |
| `announcement` | 15 s from a `do announce` or a 📣 to everyone (`AD_ANNOUNCE_HOLD_MS`) |
| `reading` | `Prompters.inUse`, with no time cap: a reader's phone open on a scene holds them until ✓ Done or a newer scene. A phone that dies lets go after `HERE_TTL_MS` (12 s). So a phone left open on a finished script holds the ads, and Run says *someone reading on the teleprompter* |
| `speaking` | He is speaking on the TV: a TV that reports `talk=` is believed, polled within `SPEECH_ONLINE_MS` (6 s), so the hold ends when he stops and a dead TV lets go. With no TV reporting, the room's scripted lines count by their length (`STAGE_CHARS_PER_S`, as the costume does) |

■ **Stop house sounds** cuts the ad on the air too, on either button. Only 📢 Off
stops them all. Both send a stop to every stream whatever the server thinks is on the
air.

## C4. Who hears it

**One pop at a time across the house.** The server tells everyone `AD_LEAD_MS` (3 s)
ahead, so a wall's 2 s poll still starts on the instant.

**The sacred rule** is `adTerminal` in `core/src/audio-ads.ts`, the one place it is
decided, on the view and the spot both, normalised (trimmed and lower-cased), whatever
a saved ⚙ or `bleeps=1` says:

- never `view=tv`, `view=mirror` or `view=reinstall`;
- never a spot starting `desktop-tv`, `tent` or `server-room`, which is the kiosk **and
  the Server Door** (`server-room-door`);
- never a room terminal, and never a terminal with no spot.

The server asks it before it picks a wall and before it sends a wall the state; the
terminal asks it again before it plays. `core/test/w59-audio-ads.test.ts` pins a table
of views and spots and the real map's list of walls.

- **Walls.** Each pop picks a fresh 1 to 3 at random (`adWallCount`) from those
  `adTerminal` allows that have polled in the last `AD_WALL_ONLINE_MS` (8 s), and the
  server names them (`AdsHub.onWall`): only those get `ad {seq, n, name, url, at,
  until}` in the screen state. Everyone else allowed reads null. They play at `at` on
  the server's clock. `seq` is the start in ms, so it is unique across restarts. The
  terminal adds `bleepsOn`, so a wall ⚙ set quiet stays quiet (`adsHere`). A page that
  loads mid-ad joins at its place unless under `AD_JOIN_LEFT_MS` (8 s) is left.
- **A wall that's in use sits it out** (`AdMachine`): a line, a walk (`spot.here` or the
  watched world), a board, a casino seat, an overlay, the glitch, a burst, an
  announcement banner, a moment's scene. In use while it plays, it stops at once for
  this ad. **A slide isn't on that list** (`adCovered`): a story slide is the server's
  hold, and one still up when the server lets an ad go has been waited out. **Nothing
  replaces a wall that sits out,** and the server doesn't know it did: that pop is
  simply quieter. The same goes for a ⚙-quiet wall the draw lands on.
- **Phones.** A fresh random quarter of the streams, at least 2 where there are that
  many (`adPhoneCount`), get an `ad` SSE frame: `{seq, n, name, url, at, until, now}`,
  all in server ms. It is live only, like `announce`. Never offered: a director, a host
  or an admin booth, a house tool (`lean`), a wall terminal piloting a guest or a Run
  pane (`via`, `pane`), a locked phone.
- **A phone that can't take it says so.** `POST /api/ad/busy {seq}` (a guest's or a
  booth's token, not under `/api/guest/`): an open card, the scan sheet or anything
  else on `useMomentsHold`, the teleprompter, the stage, a lock, a `!!` takeover, the
  glitch, a hidden page. Another phone not yet offered this ad takes its place at
  random (`replace`), while 20 s of it are left.
- `{stop: true, now}` goes to every stream. Getting busy mid-ad stops that phone on
  its own, and so does the page going hidden.
- **A stream opens on an `ad` frame:** `{stop: true, now}` with nothing on the air,
  `{now}` with something on it. That stop is what reaches a phone a server restart
  forgot: `air` is memory only, so the phones carry on until their stream comes back.

Nothing reaches Trabolta's worker: no chat line, no `recent`, no `say`.

## C5. On a phone

- **It reads the real clock.** Every `ad` frame carries the server's `now`, and
  `AdSpots.clock` keeps the largest server-minus-phone gap it has seen. A frame that sat
  in a sleeping phone's queue reads far below the rest, so it can't move that. A phone
  that wakes with an offer queued joins at the real offset, or drops it once under
  `AD_JOIN_LEFT_MS` is left, so it never plays alone or inside a hold.
- `ad-player.ts` (`AdPlayer`, shared with the terminal): **one** audio element per
  page, with its source swapped. iOS lets an element play by itself only after a tap
  has played it. `ad-spots.ts` (`AdSpots`, one per session, like `PrompterStore`) arms
  on the slot's mount; the first `touchend` or `click` anywhere plays
  `AD_SILENCE` on it, so the upload's 🔊 card or any tap will do.
- A refused play is `refused`, never an error: the pop-up stays with `▶ Play`, and a
  tap plays from where the ad has got to. A file that won't play closes it quietly.
- `ad-slot.tsx` is the pop-up: the Windows 95 window (`WinWindow`), the ad's name, 🔊,
  and ×. × stops the sound on that device only. It closes when the track ends, or
  3 s past its time if `ended` never came.
- It sits under the title bar, top right: over lines already read, where at the foot
  of a room it sat on Send, a docked menu's options or a card's go. `z-index:
  var(--z-toast)`: under every moment and sheet. It is eager, with ten `//!` headers
  turned into `//`. The guest's first load is 148.40 kB.
- Run → Players' panes never arm, so an embedded phone is silent.

## C6. The kill switch

Run → Terminals and a host's Desk → 🖥 House, **📢 Audio ads: On / Off**, with how many
have played and what the next waits for (`adsLine`, core's, so both say the same; a host
reads `HostView.terminals.ads`). `POST /api/mod/screen/ads {on}`: a director's or a host's,
on the host allowlist like the TV's mute. The switch is `DRAFT w59d` on the Desk.
Off stops what is playing everywhere, with a stop to every stream whatever is on the
air, and no more start. On lets the next go, at once if its time has passed. It holds
through a restart. `GET /api/mod/screen/terminals` carries `ads` (`AdsStatus`).

## The ship order

1. `scripts/ops/ads-media.sh prepare` on the MacBook, then `check`, then `upload`.
   Nothing restarts. `remote` shows what landed.
2. The release (`ship.sh`). **No `sync-show`.**
3. Reload every phone and terminal: a page from before this ignores the ads. An old
   phone can still be drawn, and that pop is silent on it.
4. Touch every wall once, as ever: a wall nobody touched shows ▶ instead of sound.
5. `pnpm showctl doctor`: the *Audio ads* row.

## What no real device has seen

- **A real iPhone.** The unlock is the standard trick, and `scripts/sim/ads.spec.ts`
  runs a stand-in for iOS's rule in Chromium, but that is not iOS. Try one first: the
  upload's tap, then the phone left alone until an ad. Whether a locked screen, Low
  Power Mode or the ring switch silences it was not checked.
- **A real Android phone**, and an SM-T280 on Chrome 95: neither has played one.
  `K-14.sh` passes the bundle for the old tablets.
- **A locked phone.** The page going hidden ends the ad, but a phone that sleeps was
  simulated by stopping its page in a debugger, not by locking a real iPhone.
- **A full house.** Sixty guests is 15 phones a pop at 192 kbps, about 3 Mbps from the
  VPS, plus the walls, on top of everything else on the house wifi. Not load tested.
- **The room.** Tablet speakers, walls overlapping phones, whether the balance is
  right. Headless Chromium is muted.
- Run's row is drawn by a render test, not a browser: a scratch server has no control
  plane. The switch itself went through the route on real pages.

Tests: `core/test/w59-audio-ads.test.ts` (the sacred table, the draws, the real show
through a real runtime from 📓 to 🌑), `play/test/w59-audio-ads.test.ts`,
`terminal/test/w59-audio-ads.test.ts`, `scripts/sim/ads.spec.ts` (real pages, real MP3s,
a scratch server with `LOOM_ADS_GAP_S=20-30`, about 3 minutes).
