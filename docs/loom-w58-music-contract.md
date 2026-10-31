# Wave 58 contract: the music manager, and Trabolta at the stereo

2026-10-31. The ask: *"make sure the Desk in Play (for Task Manager) and Loom
Edit have a music manager -- it should control Tidal and everything. It should
allow Trabolta to control Tidal (like the lights) if he gets chummy enough with
some programs during the event."*

Branch `oct31-w58/music-manager`, from `origin/master` (wave 57), landed with
wave 59 on `oct31-w59/story`. Show text is `DRAFT w58-music` on
`SIGNOFF-w58-music.md`. This is the second contract numbered wave 58; the Oct 30
story's is [`loom-w58-contract.md`](./loom-w58-contract.md).

## What ships together

It lands in the one release of waves 58 and 59: `SHOWNIGHT.md` §1, *Landing wave 58
and wave 59*. The order matters, because each half is useless alone:

1. A server release (the commands, the view, a guest's `them.chummy`).
2. `sync-show`, **with its reload, before doors** (a new slot, power, rules).
3. Desktop: `git pull`, `start-stagehand.ps1 -Restart audio`.
4. MacBook: `git pull`, `stagehand launchd restart --job agents`, Run → Mind →
   Reset (the persona and mind files).
5. Reload every host phone.

An old router logs the new commands as unknown and does nothing. An old panel
never sends them. An old worker never adjusts `them.chummy`, so nobody grows
chummy but by the story's own paths (C5).

## C0 Decisions

- **One manager, two skins.** 🎵 Music in a host's Desk window (open by default
  for Task Manager, folded for every other host) and Run → House → 🎵 Music. Now
  Playing moved out of the 🎚 Mixer into it: the Mixer is the faders.
- **Who.** Directors and hosts, as the mixer (the routes are its routes).
- **What "everything" is.** The app's status, ⏮ ⏯ ⏭, the scene, every show
  playlist, every playlist in the TIDAL app's sidebar, any pasted playlist link,
  Stop, Follow the story, the music level, and Trabolta's permissions.
- **Not built: searching for a single track.** The app's search and album pages
  have no rehearsed buttons, and the only way to learn them is to drive the app
  the show is playing on. A playlist is the unit.
- **TIDAL only for ⏮ and ⏸.** A file bed has neither (a crossfade is not a
  pause). The buttons show only while a bed is on the app.
- **A pause holds until told.** ⏵ Resume, or any scene change. A live `cue
  music_<scene>` wins over a hand, as it always has, so it resumes too. Trabolta
  can't lift one: a held pause refuses his moves, and a host's ⏸ on his loan ends
  the loan.
- **Stop house sounds is a hand.** Nothing brings the music back but the story's
  next music cue or *Follow the story*: no catch-up, no costume press and no move
  of his (ALL STOP: nothing restarts until the house manager says so).
- **Trabolta's music is a loan**, never a hand. A live music cue ends it, a
  director's hand refuses it, and it ends by itself.

## C1 The commands (`core/src/house-mixer.ts`)

`MusicCommand` gains:

| Action | Body | Does |
|---|---|---|
| `previous` | — | the app's ⏮ (a live bed only) |
| `pause` | — | pause the app, held |
| `resume` | — | play again |
| `playlist` | `playlist` | a show playlist by hand, on the speakers the main bed has |
| `tidal` | `id`, `title?` | any TIDAL playlist by hand, the same way |

`tidalPlaylistId(text)` reads an id out of a share link or a bare id (null for
anything else, an album's link included).

`MixerMusic` gains `tidal?: MixerTidal {online, playing, paused, track, problem,
playlist, library: [{id, title, items?}]}` (≤ `MUSIC_LIBRARY_MAX` 64) and
`loan?: boolean`. `MixerMusicBed` gains `live?: boolean`. All optional:
`audioMusicOf` keeps each when sound and drops it alone when not.

## C2 The app (`stagehand/src/stagehand/audio/tidal.py`)

The reconciler gains `pause(on)` and `previous()`. While `paused` it presses
⏸ rather than ▶, and it never takes a paused app for one that stopped. Every
`LIBRARY_EVERY_S` (30 s) it reads the sidebar's `/playlist/` links, title and
item count, even before the director's first word, because a read touches
nothing. A failed read keeps the last list.

Button names were read off the app on 2026-10-31, read-only, while it played:
`previous`, `shuffle`, `repeat`, `footer-artist-name`,
`main-layout-sidebar-wrapper`.

## C3 The director and the router

- `Director.play_playlist(name)` / `play_tidal(id, title)`: an ad-hoc scene
  (`hand_<name>` / `hand_tidal_<8 hex>`) built from the scene in force with every
  entry that plays a non-looping playlist swapped for the pick, so the Fan
  Closet's dryer runs on. Ad-hoc scenes and playlists stay out of `status()`'s
  lists.
- `Director.pause(on)`; `_tick_live` never reads a paused app's silent cable as
  a problem (`SILENT_S`), and ⏵ restarts that clock.
- `Director.set_scene` and `stop` let go of a pause.
- `previous` → `Director.previous()`.
- The router's `_music_loan` marks a hand that is Trabolta's.

## C4 The story's wire

`<cue: music, action: skip | hush | play | back[, playlist: <name>]>` on the feed
(`stereo_of_cue`). `scene_of_cue` never reads these (`music,` is not `music_`).

| Action | With a director's hand, a held ⏸ or a Stop | Else |
|---|---|---|
| `skip` | ignored, logged | `Director.next()` |
| `hush` | ignored | the app pauses, the loan starts |
| `play` | ignored | `play_playlist`, the loan starts |
| `back` | ignored unless a loan is in force | the loan ends, the catch-up runs |

A director's scene, playlist, stop, ⏸ or *Follow the story*, Stop house sounds, a
story restart and a live music cue all end a loan. Then the story's later `back`
finds none and does nothing.

The server refuses the act before the story hears it while `AudioHub.musicHand` is
anyone's (`applyAgentActs`): no use is spent, no `🎵` line goes out and the panel's
last line stays. His reply is already written by then, so it still goes out.

## C5 Chummy (`warmth:`, `Program.chummy`)

`warmth: chummy` in the story's header names the one guest slot an agent's
`adjust` may move, as `them.chummy`. The server applies only the sign of it (±1 a
reply), clamps it to the slot's range, and sends that range as `them.ranges`. A
guest's other `them.` keys are ignored as before. With no `warmth:` nothing
changes.

`chummy: -5 to 10 = 0` also rises by 1 for each fact accepted and each piece of
lore given to him. So a program gets there by feeding him, by good company, or
both, and rudeness takes it back. `Night.dj_bar` (3) is the bar, and a director
can move it in the var table.

## C6 The power (`cast/trabolta.loom`)

`INTERACTION change_the_music`, `who: agent`, `limit: 4`, `move`: `skip`,
`silence` (30 s), `calm` (act_1), `uneasy` (act_2), `dread` (act_3): 180 s.

Live from the malware to the end of the Y2K hour, the lights' window. Refused, in
his words and at no cost in uses: too early, too late, `Night.dj_locked` or
`Night.music == "off"`, a program under the bar, inside `Night.dj_free_at`, or an
unknown move. He holds only those five moves. He never reaches the rest of the
app's library and never the ending's playlist.

`Night.dj_back_at`'s rule sends `back`. `Night.dj_last` / `dj_for` name what he
did last. `trabolta_music_lock` / `trabolta_music_unlock` (`who: admin`, on hand
all night, each greyed out as *not on offer* when it would do nothing) set
`Night.dj_locked`.

## C7 The view

`MixerView.dj?: MusicDj {locked, bar, pals: [{name, chummy}], last}` read off the
sim (`musicDjOf`), `null` for a story without `Night.dj_locked`. Pals are the
programs at or over the bar, the chummiest first, at most 12. A program's name
only: the view is staff's. A host's read leaves a Run persona off (wave 59), Run's
keeps them.

## C8 Tests and checks

- core: `test/w58-music.test.ts` (commands, ids, `audioMusicOf`, the view),
  `test/trapped-w58-music.test.ts` (the story: the bar, every refusal, a loan's
  end, the lock, chummy's paths, the server's ±1 and its allowlist),
  `test/w59-costume.test.ts` (the hand), `test/trapped-w58-signoff.test.ts` (this
  sheet, beside the story's).
- stagehand: `tests/test_audio_w58.py` (the reconciler over `FakePage`, the
  director, the router's table in C4), the persona and mind pins.
- play: `test/w58-music.test.tsx`. editor: `lib/house-mixer-view.test.ts`,
  `components/house/house-views.test.ts`, the store.
- On a scratch server with a fake router report, both panels in Chrome.

Not tested on the real app: ⏮, ⏸, ⏵ and a hand playlist have run only against
`FakePage`. The app was playing the night's Act 3 through the router, so they
wait for the first rehearsal on the Desktop (`SIGNOFF-w58-music.md` §2).

## C9 Landing with wave 59

- **The cues.** `trabolta_music_lock` and `trabolta_music_unlock` sit after wave 59's
  `costume_flicker`, the last two admin rows, so no cue number moved.
- **The costume's hand** (`AudioHub.musicHand`). A hand playlist and a held ⏸ count
  as a hand, so a MUSIC press on the iPad is refused under them. ⏮ moves no hand,
  like ⏭. A loan is no hand: the router reports `hand` for it, so the hub reads
  `loan` first. AFTER PARTY or BACK TO NORMAL ends it; NEXT TRACK only moves the
  track. A Stop is a hand until a scene is reported again, and ⏵ gives back the
  hand its ⏸ sat on, so AFTER PARTY's timed return survives a host's pause.
- **The rooms.** Nothing here names a renamed room.
