# Wave 59 contract: Mic 1 is the TV's sound in the games

2026-10-31. The ask: *"I want Mic 1 of the Motu to go to the reinstallation games
as audio for the TV / Desktop audio."*

Branch `oct31-w59/mic-to-games`. No story change and no new show text but one
line of the guests' help (C5). It ships in two halves that don't need each other:
the router (the Quest hears it), then a release (the tent hears it too).

## The path

```
828x input 1 ── ASIO callback ── ring ── event loop: 16 kHz, gate, μ-law
                                              │  POST /api/spatial/voice?spot=desktop-tv
                                              ▼
                             VoiceRelay: the same-room rule, t:desktop-tv
                                              │  SSE `voice` frames
                       ┌──────────────────────┴───────────────────┐
             Quest: the stream it already opens         web game: ?mic=0&only=tv
             at the TV's screen, no new code            at the TV's screen
```

There is no new transport. To the server the router is one more terminal at the
spot `desktop-tv` on the voice relay (`docs/loom-reinstall.md` §2.4). The relay
already fans a terminal's chunks out to the players in its room, and already
tells a source to send only while someone hears it, so the rest of this contract
is what that leaves to do.

## C1. The router (`stagehand/audio/gamefeed.py`)

`audio.game_feed: {ch, spot, gain_db?, gate_db?}` (`trapped.desktop.yaml`: `ch: 1`,
`spot: desktop-tv`; defaults 0 dB and −42 dBFS). It needs the duplex stream: the
MacBook fallback has no inputs and no feed.

- **The callback only copies.** `Engine._duplex_cb` hands the column, after the tap
  and the insert, to `GameFeed.write`: a copy into a 2 s ring, under a lock held for
  that copy. Measured: 1.7 µs a block, 16 µs at worst, of a 10.7 ms budget. Any
  exception takes the feed out of the path until the stream reopens.
- **Everything else is on the event loop.** The resample (a 2 ms windowed sinc at
  7 kHz, then the house `Resampler`'s integer positions), the gate, the μ-law and the
  upload: 0.3 ms per 200 ms chunk. `run` never raises, because the router's other
  jobs share its `gather`.
- **It sends only while heard.** It holds `GET /api/spatial/voice/stream?spot=&mic=1
  &hear=0`, and `listen {on}` is the only thing that starts it. An upload's own
  `listening: false` only empties the queue: that answer can land after a newer
  `listen`.
- **Late audio is worse than a gap.** One POST at a time, 2 s deadline, at most 3
  chunks waiting (600 ms), the oldest dropped.
- **`seq` counts from the wall clock**, chunks since the epoch, so a restarted router
  is never below where it left off.
- **The gate** is `VoiceGate`'s open path at −42 dBFS with a 1 s hang (a terminal's is
  400 ms): a pause between phrases must not close it, since every reopening restarts
  the game's jitter buffer. There is no half-duplex hold: the input is read straight
  off the interface, and a close wireless mic is not beside a game's speaker.

The wire is pinned to `@loom/house`: the constants are read out of `voice.ts`, and
`tests/fixtures/house-audio/voice-mulaw.json` is a byte-for-byte copy of the vectors.

## C2. The server

Nothing is needed for a game that already hears terminals: `mic=1&hear=0` at the TV's
spot is a stream the relay has always taken. So a Quest on an APK already sideloaded,
on the server already deployed, hears it the moment the router sends.

The one addition is for the web game. `GET /api/spatial/voice/stream?…&only=tv` on a
game session (`VoiceListener.only`) routes that stream only the map's `view: "tv"`
terminals. It is the server's filter because it has to be: a terminal a stream merely
ignored would still be told `listen {on}`, and would open its mic and light its 🎤 for
nobody. An older server ignores the flag; the web game checks too.

Memory only, like all voice. Never journaled, never on disk, no ring.

## C3. The web game

With `config.voice` off (the tent laptop, and any device not set up with `voice=1`) it
used to open no link. It now opens a hear-only one (`VoiceLinkOptions.tvOnly`):
`mic=0&only=tv`, no mic asked for, no 🎤 on the HUD, the TV at its screen through its
`PannerNode`, into the game's own bus (`sfx.context().out`), so on the tent a terminal's
level and mute apply to it. *The tent has no voice link* still holds: nothing goes up,
and no room but the TV's is heard. `voice=1` is unchanged, and hears the TV as a terminal.

## C4. What it costs

Only while a program stands in The Desktop and the input is over the gate:

| | |
|---|---|
| The Desktop's uplink | 16 kB/s of body, 5 POSTs a second (about 140 kbit/s) |
| The VPS, in | the same |
| The VPS, out | 22 kB/s per game in the room (base64 in SSE) |
| Otherwise | nothing but one idle stream with a ping every 15 s |

Five hours of it nonstop, with both games in the room, would be under 1.3 GB.

**Latency** is about half a second by construction, not measured over the house's
real uplink: a 200 ms chunk to fill, the network, then the game's 200 ms jitter buffer.

**The TV's own mic** stays off, as it has been (`roles.ts`). If someone turns it on in
⚙, both sources share `t:desktop-tv`, and the router's wall-clock seqs win while it is
sending: the TV's chunks read as stale until the router has been quiet for 1.5 s.

**The per-spot cap.** A spot keeps 2 streams, so the TV and the router fit exactly. A
TV reload with a half-open old socket can evict the router, which reconnects within a
second; the games lose at most that second.

## C5. Docs and copy

`docs/help/play/11-reinstallation.md` gains one line (*it still plays the sound of the
TV in The Desktop*), for the guests' sign-off with the next sheet. The staff's are
`docs/help/play/19-house-workings.md` and `scripts/house-desktop/README.md` §3.8.

## C6. Shipping

1. **The router.** The Desktop: `git pull`, then `start-stagehand.ps1 -Restart audio`.
   That restart drops every house sound for a few seconds. The Quest hears Mic 1 from
   here, with no release and no APK.
2. **The web game.** A release (`predeploy`, then `ship.sh`, under the deploy gate: it
   restarts the server), then reload the tent. No `sync-show`. The terminal bundle
   carries the flow, so reload `/terminal/` on the tent and any `/reinstall/` device.

Either order works. Stop it: delete the `game_feed` line and restart `audio`; or, with
nothing restarted, turn the TV's voice link off on the map (Run → House → 🗺 Map), which
takes effect at once but also stops players being heard on the TV.

## C7. Not proven on real hardware

Proven: `gamefeed.py` on a fake stream; the real `GameFeed` and `ModClient` over real
HTTP against a scratch server into the **real web game in Chrome**, with a synthetic
tone and no audio device (24 chunks played at the right level, none in the hall, the
router stopped by itself, nothing dropped); `voice_link.gd` on the show map with the
server's frames (the Godot suite).

Not proven: the 828x's real input 1 under ASIO, its level, a Quest's ears, a real
AudioContext on the tent laptop, or the latency over the house's real uplink.
