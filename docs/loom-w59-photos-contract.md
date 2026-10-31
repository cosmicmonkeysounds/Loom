# The terminals' photos (wave 59p)

The user, 2026-10-31: *"The terminals should be taking pictures every 15 seconds and
uploading them to the VPS (or just local) -- I should be able to arm this from the desk."*

When armed, each terminal with a working camera takes one still every 15 s and uploads
it to the VPS. Disarmed, nothing. On the terminal nothing shows: no flash, no sound, no
pop-up, no change to the screen. Words on it are `DRAFT w59p`
(`SIGNOFF-w59.md` §4.12).

**These are pictures of people.** Everything below follows from that.

## C1. Who shoots

| Terminal | Photos |
|---|---|
| A wall, chess, casino or Server Door terminal with the games' camera setting on | Yes |
| The same with that setting off (`cam=0`, ⚙) | No, and arming never turns it on: the panel says *No camera* |
| The Server Room | Only while its camera is already running. Nothing on its CRT or in its sound changes, and a failure stays silent |
| The Tent | Never. It sends no camera (the feed's rule). The server doesn't tell it, and refuses its spot |
| The TV | Never. It has no camera. Same |
| A terminal with no spot | Never: it has nowhere to file a still |

**Arming opens nothing.** There is one camera (`terminal/src/camera.ts`), and the feed
(`camfeed.ts`) holds it wherever the games' camera setting is on, armed or not. A still
is read off that stream from the `<video>` already in the page, so an arm can't prompt and
can't open a camera that wasn't set up. A scanner up on a terminal with the setting off
doesn't count: that terminal said no.

## C2. A still (`terminal/src/photos.ts`)

- Up to 640 × 480, the whole frame (the feed crops to 4:3; a still doesn't), JPEG 0.7. Never
  upscaled. A 720p camera gives 640 × 360. Fake camera: 5 KB. A real room: expect 40–120 KB.
- The old tablets keep the feed's rules: a canvas off the GPU (`sizeCanvas`, the Mali-400
  note), `toDataURL`, Chrome 87 to 95. `StillTuner` walks down: the `<video>`, then
  `ImageCapture` off the track, then what the feed has (`newestFeedFrame`, 320 × 240 at
  most, no older than 5 s). Two captures over 400 ms drop a size, and two more settle on
  the feed's frame, which costs nothing. Every 8 shots on that it tries the top again. Measured
  in Chromium on the fake camera: 2–4 ms to draw and encode, 12–13 ms at 6× CPU throttle. A real
  room costs more, and no tablet has been measured.
- A blank frame on a route that has never shown a picture is a failure, and on one that has
  it's a dark room, sent as it is.
- `runPhotos` is sequential: never two uploads in flight, 20 s and it gives up on one. A
  page hidden takes none. The feed's loop and tuner are untouched: a still has its own canvas
  and its own fetch. A failed upload waits a minute. 409 and 429 are no trouble.
- ⚙ has one line (`photo-status.ts`). Nothing else on a terminal shows any of this.

## C3. The server (`core/server/photos.ts`, `routes/photos.ts`)

```
<LOOM_STATE_DIR>/photos/<event>/arm.json
<LOOM_STATE_DIR>/photos/<event>/<spot>/2026-10-31T21-15-03.123Z.jpg
```

Colons in the time are dashes, so the tar unpacks on Windows. The time is the server's,
on receipt. Files 0600, folders 0700.

| Route | Who | |
|---|---|---|
| `GET /api/mod/photos` | director, host | `PhotosView`: the arm, the counts, each terminal |
| `GET /api/mod/photos/thumb?spot=` | director, host | that spot's latest still, off the disk, `no-store` |
| `POST /api/mod/photos/arm {armed}` | director, host | the press; answers `PhotosView` |
| `POST /api/mod/photos/shot {spot, jpeg, w, h}` | a mod token (a terminal) | 409 disarmed, 429 inside 10 s of the last, 404 not a photo spot, 413 over 400 KB, 507 stopped |
| `GET /api/mod/photos/download` | director | a tar, one file in memory at a time, waiting on a slow reader |
| `POST /api/mod/photos/delete {confirm: "delete"}` | director | every still; the arm stays |

- **Not in the journal, not in memory** (the thumbnail is read off the disk too, and the tally
  holds numbers), **not under `/media/`, not in the screen state** but for the arm, never in a
  stream a guest gets, never near his worker, and no log line carries a path.
- **The refusal comes first.** A still's token is read off the header before the body is, so a
  refused caller never gets 500 KB buffered, and a body token is no way in.
- **The arm** lives in `arm.json`, so it survives a restart and a story reload. Only a press
  changes it. A boot with it armed says so on stderr, like the TV's mute. It reaches a terminal
  as `photos: true` on the screen state, which is already moderators only, and only on a spot
  that may shoot. Disarming stops within one poll, and the server refuses a late still anyway.
- **The cap.** 3 GB an event (`PHOTO_CAP_BYTES`), and the disk keeps 2 GB free whatever the cap
  says (`PHOTO_MIN_FREE_BYTES`, looked at once a minute), so no number of events can fill it.
  Either stops the photos, and the panel says so. A 507 from the disk itself is the same.
  8 terminals × 240 an hour × 7 hours × 60 KB is about 400 MB.
- **Backups leave the folder out, on every label** (`deploy/backup.sh`). 48 show copies a night
  of 400 MB would fill the disk the cap guards, and would copy pictures of people to the
  MacBook. ⬇ Download all is how they leave. `deploy/restore.sh` leaves the folder alone, since
  no backup could bring it back; a standby or a dead host has none.
- **The allowlist** (`routes/host.ts`) gains the panel, the thumbnail and the arm, and never the
  still, the download or Delete all.

## C4. The panels

- **The Desk** (`play/src/host/photos.tsx`, `PhotosSection`): ARMED / SAFE, big, red when armed;
  the count; each terminal's count, last shot and thumbnail; a note for any terminal that should
  be shooting and isn't. It polls every 5 s while mounted and visible. A thumbnail is the real
  still, so a phone fetches one a terminal every 30 s at most. Its own stylesheet, in the Desk's
  lazy chunk: the guest's first load doesn't change.
- **Run → Terminals** (`editor/src/components/run/PhotosCard.tsx`): the same, plus ⬇ Download all (a
  plain link on the session cookie, so the browser saves it as it comes) and 🗑 Delete all behind
  its own two-step on the page.
- **The notes** (`photoNote`, pure): *not heard from*, *page hidden*, *no camera*, *no picture yet*,
  *not getting through*, *not reporting* (an old build), *reports fine, but no recent photo*. None
  for the first 20 s after arming, and none while safe. They read the heartbeat's `ph=`.

## C5. What this doesn't do

- **The upload's 🎥 card says *video*.** Wave 44's words are *"The house is being filmed tonight"*
  and *"May video of you from tonight be used?"*. A still isn't video, and that card is what guests
  were asked. Nobody was asked about stills.
- **A still can't leave out a guest who opted out.** It's a whole room. The video list (Run → 🎥)
  says who said no, and whoever goes through the photos afterwards has to honour it by eye.
- **`bathroom-1-door`** takes stills like any wall. It hangs outside the door, facing the RAM
  (`docs/trapped/kiosk.md`). If it ever goes inside, the same rule holds: tape the camera, and take
  the setting off in ⚙.
- **A wall terminal's token is a mod token**, so it could read these routes. That's the trust a
  terminal already has (it can do everything a director's token can). A photo route adds no new
  capability to it, but it's worth knowing that the pictures are behind it.
- **After End** the event's routes are gone and the files stay on the volume. Download before End.
  If that's missed, they come off by hand (`SHOWNIGHT.md` §8).

## C6. Ship

Server first. It needs a release and a reload of every terminal (no reload, no photos: the panel
says *reload it*), and no `sync-show`: no story or project file changed. `deploy/backup.sh` goes
with `ship.sh`'s rsync, so it's in force from that release. Tests: `core/test/w59-photos.test.ts`,
`terminal/test/photos.test.ts`, `play/test/w59-photos.test.tsx`,
`editor/src/components/run/photos-card.test.ts`, `scripts/ops/test/run.sh`, and
`scripts/sim/photos.spec.ts` (real pages, Chromium's fake camera, a restart).

Not proven: a real tablet, a real camera or a real room's light; the VPS's own free space; Run's card
in a real browser (its render is tested, and every route it calls is driven over HTTP).
