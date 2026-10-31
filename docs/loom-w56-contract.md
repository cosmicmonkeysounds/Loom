# Wave 56 contract: his voice comes apart

2026-10-30. The ask: *"I would like to supercharge the text-to-speech system in
Trapped in the Internet; towards the end of the night and during major glitches
should start to vary his speech pace, speech voice, and create stutters,
glitches, and random effects in realtime. There should be several flavours of
these glitches."*

Branch `oct31-w56/voice`. No story change, no new words: nothing to `sync-show`.
It needs a release (the server and the terminal bundle), every terminal and the
TV reloaded, and on the Desktop `git pull` and `start-stagehand.ps1 -Restart
audio`. Decisions for the user to veto are on `SIGNOFF-w56.md`.

## The shape of it

Trabolta's voice is `speechSynthesis`, which hands a page no waveform. So there
are two halves, and they don't need each other:

| | Where | What it can do | Who hears it |
|---|---|---|---|
| **The plan** | every terminal that speaks him (`terminal/src/speech/glitch.ts`) | what is said and how: pace, pitch, voice, volume per fragment, real cut-offs, silences, bursts of noise | everyone |
| **The insert** | the Desktop's router (`stagehand/audio/voicefx.py`) | the sound itself, mid-word: Chrome's audio comes back to the router as input 3 | the house speakers |

The server decides *how much* and neither half does (`core/src/voice-fx.ts`).
The insert is the part a browser cannot do; the server room's terminal is not on
the router, so there the plan and its noise bursts are the whole effect.

## C1. How much: `voiceFx`

Every screen-state answer carries `voiceFx {mode, level, spike}`. Additive: an
older terminal ignores it, a newer one on an older server reads null and speaks
plainly.

**The level** is `VOICE_PHASE_LEVEL` over `Night.phase`: clean until the Trust
Chart (0.1), 0.2 beans, 0.3 the overshare, 0.5 the Y2K clock climbing 0.3 by
midnight, 0.8 the majority, 0.85 the final reveal and the bob, 0.9 Grok prom,
1 banishment, the hand jive, a destroyed computer. Then `Trabolta.composure`,
which the story already knocks down at every crisis, scales it ±25%.

- **He heals.** `finale_help` is 0 (`finale_truth` too, wave 58, which also took out `Night.talked_down`).
- **He tries.** `advice` is 0.45: the confession stays mostly whole.
- **A reading is capped at 0.2** while an award or the recount's summary is up:
  names and numbers must land.
- **Floors:** 0.4 at his heart (`heart_stage == talk`), 0.85 under the alarm.

**A spike** is a major glitch: it stands over the level for its length, in its
own flavours, whatever the phase, so the 📺 hijack hits hard at step 7 and he
snaps back clean.

| Kind | From | Length | Strength | Flavours |
|---|---|---|---|---|
| `hijack` | the 📺 glitch cue | 8 s | 1 | overclock, skip, dump, packet |
| `y2k` | the dream taking over | 12 s | 0.9 | kernel, stall, loop |
| `burst` | a ⚡ ad burst (`light`) | 3.6 s | 0.8 | skip, packet, dump |
| `flicker` | a ⚡ flicker | 2 s | 0.5 | packet, skip |
| `shot` | a director's button | 8 s | 1 | the one pressed |

A spike reads the same shots as the screens, so history and a reload never play
one, and it lands with the picture.

**The mode** is the director's: `auto`, `clean` (the kill switch: no level, no
spike) or `broken` (level 1). It lives beside the mute in the state dir, survives
a restart and Go live, and the boot log says 🌀 when it isn't `auto`. A shot plays
in any mode: that is how a flavour is auditioned. The shot itself is memory only.

`POST /api/mod/screen/voice {fx?, shot?}` (on the host allowlist with the mute)
answers `{muted, fx}`. `/api/mod/screen/terminals` and the host board carry the
mode.

## C2. The flavours

| Id | Button | The plan | The insert |
|---|---|---|---|
| `skip` | 💿 Scratched disc | a word catches, cut off, again and again, then lands | a stuck grain, sometimes winding up into a buzz |
| `stall` | ⏳ Buffering | drags, sinks, stops dead, back on the last word | a tape slowing, the pitch falling |
| `overclock` | 🔥 Overclock | faster and higher to the end | the pitch climbing |
| `driver` | 🎭 Wrong driver | the device's other voices take over, a few words each | the pitch hopping |
| `packet` | 📉 Packet loss | words punched out, the hole as long as the word | gating |
| `dump` | 🔢 Memory dump | a word comes out letter by letter | bit crush and ring modulation |
| `safe` | 🧊 Safe mode | one flat word at a time | ring modulation at a voice's own pitch |
| `loop` | 🔁 Feedback | the end of the sentence goes round, fading | a feedback echo |
| `kernel` | 👹 Kernel | low, slow and quiet | an octave-ish down, a slow ring |

They open with the level (`FLAVOUR_FROM`, the same table on both sides, pinned):
no `kernel` at the Trust Chart. `dump`, `driver` and `kernel` are late-night only.
A major glitch adds a scramble on the router (grains of the last half second, out
of order). A sentence that doesn't break still drifts a step or two off pace and
key; from 0.7 a long one can break in two places.

## C3. The plan's rules

- **Only his own words.** A fragment is a word of the sentence or its letters.
  Nothing is added, so a glitch can't break the fiction or say what he doesn't
  know. The written text is untouched: captions, transcripts, `moodOfText` and
  `DREAM_BUG_LINE` all read it.
- **One sentence stays one chunk.** `SpeechQueue` plays a plan inside one
  `engine.play`, so `chunk`, `done`, `said=`, the voice clock and the sentence
  counts in `voice-scenes.test.ts` don't change. A scene only waits longer
  (`VOICE_STRETCH_MAX_MS` still caps it).
- **Digits and names survive.** `packet` never drops either.
- **Bounded.** A flavour works `WINDOW_WORDS` (12) words of a sentence.
- **Never broken:** `CLEAN_BEATS` (Heart Convinced, Heart Return, Heart Shutdown,
  Advice Helped), because the level only falls once those lines have moved the
  story's vars. Announcements and TEST VOICE have no shaper at all.
- **A plan never costs a line.** A shaper that throws says the sentence plainly.
  A plain sentence takes the old code path, untouched.

**Pace is whole SAPI steps.** Chrome on Windows sets `int(10 · log10(rate))`
(`content/browser/speech/tts_win.cc`), so 0.8 to 1.25 is one speed and the TV's
0.92 sounds like 1. A plan's `pace` is that step (`paceRate`). Pitch moves in
tenths, `pitch · 10 − 10`. Utterance text is stripped of markup there, so SAPI's
own XML is not available. `Speak(nullptr, SPF_PURGEBEFORESPEAK)` stops at once,
which is what makes `cutMs` a real stutter.

**What each engine can do.** Browser: everything. Fully Kiosk: words only
(`flatText`: the repeats and the holes survive). The server voice and silent:
the sentence as it stands.

## C4. The insert's rules

- On the `trabolta` input, after the tap, before the mixer: the matrix, the
  meters and the sidechain all see the broken voice. Needs `audio.voicefx: true`
  (the Desktop's YAML) and a duplex stream; the MacBook fallback is output-only,
  so it has no insert.
- Reads `voiceFx` off `/api/screen/state` once a second, like the TV.
- **Never waits, never takes his voice away.** Control writes one attribute at a
  time; arrays are allocated only when an event starts. At level 0 it only
  remembers, and the sound is untouched sample for sample. On an exception
  `Engine` restores the block and takes the insert out of the path. Over budget
  for `TRIP_BLOCKS` it trips itself dry. Both are in the health line.
- Measured on the MacBook: 0.06 ms mean, 0.24 ms worst, of a 10.67 ms block.
- Anything else Chrome plays on that page (a slide's mp4) goes through it too.

## C5. Hearing it

- `?preview=voice` on any set-up terminal: a level, a button per flavour, the
  plan printed. On the Desktop's Chrome it also goes through the router.
- Run → Terminals: 🌀 His voice, Auto · Clean · Broken, and *Fire a flavour*. A
  host's phone: one button, Auto → Clean → Broken.
- `uv run python -m stagehand.audio.voicefx in.wav outdir`: every flavour as WAVs,
  no interface.

## Tests

`core/test/voice-fx.test.ts`, `core/test/trapped-w56-voice.test.ts` (the real show:
the real 📺 and ⚡), `core/test/screen-state.test.ts`, `terminal/test/glitch.test.ts`,
`terminal/test/glitch-engine.test.ts`, `stagehand/tests/test_audio_voicefx.py`.
