# Wave 59a contract: the audio ads

2026-10-31. The ask: *"after the 2nd round of questions, there should be audio ads
that pop up on the terminals and peoples' phones."* The MP3s are the WeTransfer
folder `spicy-ads`, kept outside the repo.

Branch `oct31-w59/audio-ads`. No story change: the cue list stays at 87 rows, and
**a release is enough, with no `sync-show`.** The only new show text is `▶ Play`,
marked `DRAFT w59a`, and the crew's words on Run's 📢 row.

## C1. The list and the pace

`core/src/audio-ads.ts` holds the 14 ads in file order: Mommy Intro, Adobe, Mizz
Butter, Draft King, Mommy Interlude 1, Ableton Live, Horton Norton, Tippi, Mommy
Interlude 2, V, Splenda Daddy, Steve.exe, Bambi, Mommy Outro. 54 to 112 s each, 18.8
minutes in all.

- **The window** (`adsRunning`): `Night.phase` is `hunt_2` and `Night.hunt2_on` is
  true, and neither the summons nor an ending has come. The summons or Truth Pong
  cuts what is on the air and ends the list wherever it has got to.
- **The pace** is story time, so it stops with the doors. The first starts at least
  `ADS_FIRST_MS` (60 s) after the window opens, and the next `ADS_EVERY_MS` (210 s)
  after the last one started. A held ad is never made up: the next one still comes
  210 s after this one really started. All 14 fit the hour if the first starts by
  about 8 minutes in.
- **The first one waits for the Truther Download**, which is 2 minutes in and takes
  the screens, plus its slide's 45 s. So it starts about 2¾ minutes in, not 1. Ad 1
  is 84 s, and at 60 s it would be cut off a minute into itself. To go back to a
  minute: drop the `truther` hold in `adsHold`.

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

`core/server/audio-ads.ts` `AdsHub`: transport-free, clock injected.

- `tick` runs at the end of `tickOnce`, so it needs open doors. It answers `start`,
  `stop` or nothing.
- **Journaled:** `signal("audio_ad_aired", "<n>. <name>", {n})` and
  `signal("audio_ads_switched", "on" | "off")`. No story hook hears them, so nothing
  changes in the story, the chat, `recent` or a booth. They are the mod log's lines.
  `restore` replays them (`replayAired`, `replaySwitched`), so a restart resumes the
  list at its pace and never from the top, and keeps the switch.
- **Memory only:** what is on the air (a restart cuts it, and it stays spent), the
  phones' rotation, and the announcement and reading holds.
- `loadScenario` resets it (`reset`): a story reload starts the list over, switched
  on. `pushLifecycle` cuts what is on the air before anything else, so nothing plays
  through the event's Restart. `pause` cuts it too, since the ticker stops.

**Holds** (`AdHold`): nothing starts, and what is on the air stops at once and stays
spent. Run → Terminals says which.

| Hold | What |
|---|---|
| `doors` | Paused |
| `talk` | `Night.talk` names a scene |
| `truther` | Before `Night.truther_at` (C1) |
| `cutscene` | On the walls: an overlay, the glitch (8 s), a story slide (its 45 s; persistent ones while up) |
| `blackout` | On the walls: the cue's 10 s, or the overlay |
| `announcement` | 15 s from a `do announce` or a 📣 to everyone (`AD_ANNOUNCE_HOLD_MS`) |
| `reading` | `Prompters.inUse`, for at most `AD_READING_HOLD_MS` (5 min): this is what makes the first ad wait until Round 2's questions have been read, and a phone left on a finished script can't hold the list off the air |

■ **Stop house sounds** cuts the ad on the air too, on either button. Only 📢 Off
stops the list.

## C4. Who hears it

**One at a time across the house.** The server tells everyone `AD_LEAD_MS` (3 s)
ahead, so a wall's 2 s poll still starts on the instant.

- **Terminals** read the screen state's `ad {seq, n, name, url, at, until}` and play
  at `at` on the server's clock. `seq` is the start in ms, so it is unique across
  restarts. The server sends it only to a terminal `adTerminal` allows: never
  `view=tv`, a mirror, a room terminal, or the spots `desktop-tv` and `server-room`.
  This ignores a saved `bleeps=1`. The terminal adds `bleepsOn`, so the tent and any
  wall ⚙ set quiet stay quiet (`adsHere`). A page that loads mid-ad joins at its place
  unless under 8 s is left.
- **A terminal that's in use sits it out** (`AdMachine`): a line, a walk (`spot.here`
  or the watched world), a board, a casino seat, a slide, an overlay, the glitch, a
  burst, an announcement banner, a moment's scene. In use while it plays: it stops at
  once for this ad.
- **Phones.** A third of the streams, at least 3 (`adPhoneCount`), get an `ad` SSE
  frame: `{seq, n, name, url, in, from, left}`. It is live only, like `announce`.
  Fewest turns first (`pick`), so every phone gets one before anyone gets two.
  Never offered: a director, a host or an admin booth, a house tool (`lean`), a wall
  terminal piloting a guest or a Run pane (`via`, `pane`), a locked phone.
- **A phone that can't take it says so.** `POST /api/ad/busy {seq}` (a guest's or a
  booth's token, not under `/api/guest/`): an open card, the scan sheet or anything
  else on `useMomentsHold`, the teleprompter, the stage, a lock, a `!!` takeover, the
  glitch, a hidden page. It goes back to the head of the line and the next phone not
  yet offered this ad takes its place (`replace`), while 20 s of it are left.
- `{stop: true}` goes to every stream. Getting busy mid-ad stops that phone on its own.

Nothing reaches Trabolta's worker: no chat line, no `recent`, no `say`.

## C5. On a phone

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
- `z-index: var(--z-toast)`: under every moment and sheet. It is eager: 0.48 kB net,
  with ten `//!` headers turned into `//`. The guest's first load is 148.25 kB.
- Run → Players' panes never arm, so an embedded phone is silent.

## C6. The kill switch

Run → Terminals, **📢 Audio ads: On / Off**, with where the list has got to and what
it waits for. `POST /api/mod/screen/ads {on}`: a director's, off the host allowlist.
Off stops what is playing everywhere and no more start. On resumes at the next one,
at once if its time has passed. It holds through a restart. `GET
/api/mod/screen/terminals` carries `ads` (`AdsStatus`).

## The ship order

1. `scripts/ops/ads-media.sh prepare` on the MacBook, then `check`, then `upload`.
   Nothing restarts. `remote` shows what landed.
2. The release (`ship.sh`). **No `sync-show`.**
3. Reload every phone and terminal: a page from before this ignores the ads. An old
   phone still takes its turn in the rotation, silently.
4. Touch every wall once, as ever: a wall nobody touched shows ▶ instead of sound.
5. `pnpm showctl doctor`: the *Audio ads* row.

## What no real device has seen

- **A real iPhone.** The unlock is the standard trick, and `scripts/sim/ads.spec.ts`
  runs a stand-in for iOS's rule in Chromium, but that is not iOS. Try one first: the
  upload's tap, then the phone left alone until an ad. Whether a locked screen, Low
  Power Mode or the ring switch silences it was not checked.
- **A real Android phone**, and an SM-T280 on Chrome 95: neither has played one.
  `K-14.sh` passes the bundle for the old tablets.
- **A full house.** Sixty guests is 20 phones an ad at 192 kbps, about 4 Mbps from the
  VPS, plus the walls, on top of everything else on the house wifi. Not load tested.
- **The room.** Tablet speakers, walls overlapping phones, whether the balance is
  right. Headless Chromium is muted.
- Run's row is drawn by a render test, not a browser: a scratch server has no control
  plane. The switch itself went through the route on real pages.

Tests: `core/test/w59-audio-ads.test.ts` (the real show through a real runtime),
`play/test/w59-audio-ads.test.ts`, `terminal/test/w59-audio-ads.test.ts`,
`scripts/sim/ads.spec.ts` (real pages, real MP3s, real time, about 6 minutes).
