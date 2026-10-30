# Wave 52: the soundtrack from the TIDAL app

The acts and the ending play from John's TIDAL playlists, in the TIDAL
desktop app on the Desktop, routed through stagehand. Custom songs stay MP3s.
Code: `stagehand/src/stagehand/audio/tidal.py`, the `Director` in
`soundtrack.py`. Runbook: `scripts/house-desktop/README.md` §3.7.

## C1. The audio path

TIDAL → `VoiceMeeter Aux Input` → the AUX strip, B2 only → `VoiceMeeter Aux
Output` (MME, 48 kHz, stereo) → `LiveInput` → a `LiveReader` per voice on the
`music` bus. It is apart from Trabolta's VAIO → B1 tap. Scenes, ducking, the
house mix and Stop house sounds treat it as any bed.

## C2. The control path

TIDAL has no API for its desktop player. Started by `tidal.ps1` with
`--remote-debugging-port=9333` (loopback) it answers the Chrome DevTools
protocol, and `TidalRemote` presses its buttons by their `data-test` names:
`select-device` / `output-device`, `play-all`, `shuffle-all`, `play`, `pause`,
`next`, `repeat`, `footer-track-title`, `current-time`, `duration`.
`-disable-auto-update` keeps those names as rehearsed.

The director says `want(uuid | None)` and `next()`; a worker thread reconciles
the app to that every second. Before the director's first word it touches
nothing, so a restarted router does not pause the act before its catch-up, and
a playing app on the wanted playlist's page is adopted, not restarted.

## C3. Scenes

| Scene | Plays |
|---|---|
| `doors`, `act_1` | TITI - Act 1 (one bed: it plays on) |
| `malware`, `act_2` | TITI - Act 2 (one bed) |
| `act_3`, `final` | TITI - Act 3 (one bed) |
| `ceremony` | the `music/ceremony/` folder |
| `afterparty` | TITI - Rave / Ending |

Playlists are named by id, in TIDAL's own order (`shuffle: false`), on Repeat.
A scene holds at most one TIDAL playlist. Two never crossfade: the old fades
over `scene_fade_s`, the app changes, the new fades in, about 3 s in all.

## C4. The fallback

A playlist's `dir` / `files` are played when the app does not answer, the
playlist won't start, or the cable is silent for `SILENT_S` (20 s). The next
scene tries TIDAL again. With no files the bed stays on the app and waits.

## C5. Measured on the Desktop, 2026-10-30

No output reached a speaker in any of these.

| Check | Result |
|---|---|
| Capture on the 828x's ASIO callback, 30 s each | DirectSound 7 underruns; MME 0; WDM-KS 0 |
| MME, 150 ms buffer, 240 s on the ASIO callback | 0 underruns, 0 slips, 0 xruns, peak 0 dBFS |
| Every scene change on the real app, no output device | the right playlist each time; output at the −10 dB bed level |
| A second router with the app playing | adopted: the song ran on, 0:41 → 0:47 |
| TIDAL killed mid-act | a file bed within seconds; TIDAL again at the next scene after `tidal.ps1` |

Not yet proven: the router job itself on the show's speakers (ducking under
Trabolta, the sub, the room level), and a full evening's length of capture.
