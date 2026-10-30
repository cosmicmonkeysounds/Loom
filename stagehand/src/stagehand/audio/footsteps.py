"""Footsteps in the real house (wave 49): the programs in the games, heard walking.

As a program in a reinstallation game pulses the real bulb it walks under
(wave 39), the real house hears it walk. The event server decides, from the
poses it already has, which speakers carry each program and how loud
(`@loom/house` `walkersOf`: closeness to a speaker, the same room or through
a wall or a floor), and sends a `WalkersFrame` only when that answer changes
(`GET /api/mod/audio/walkers`). This side plays the steps itself, at the pace
the frame's `speed` asks for, so nothing crosses the wire per step and one
slow link never stutters a walk:

    frame {seq, at, walkers: [{id, speed, surface, to: [{speaker, db, muffled}]}]}
      └ Walkers.apply       who is walking, how fast, on what, where it is heard
    Walkers.tick(now)       every WALKERS_TICK_S on the control side, never in the
      └ Mixer.play          audio callback: one voice for the speakers that hear
                            the step clear, one for those that hear it muffled

`FootstepBank` holds the sound, synthesised once at the device's rate and
seeded, so every run of a house plays the same takes:

  - a **heel**: a low sine falling in pitch, the thump of a body's weight
    landing, ~80 Hz, and a shorter **body** an octave or so up, the floor
    answering, which is what a small speaker can actually say;
  - a **knock**, a few ms of filtered noise, the contact itself;
  - a **scuff**, a short band-passed burst a beat after the heel, the ball of
    the foot coming down. The two together read as a foot and not as a click.

Each surface (`floor`, `tile`, `grass`) sets those parts apart, every take
wanders a little within them, and even takes are one foot and odd takes the
other, a touch apart, so a walk alternates like two feet do. Takes are
level-matched, and each step moves a dB or so at random. `muffled` outputs
play a low-passed copy (`MUFFLE_HZ`): what a wall leaves of a step.

`<sounds_dir>/footstep_<surface>_<n>.wav` (n from 1) takes that take's place.
It is mixed to mono, cut to `FILE_MAX_S` and level-matched like the rest; a
new file is read at the next router start.

Steps are `sfx`-bus voices on the `steps` strip (the mix's Footsteps), so
they duck like sound effects, Stop house sounds fades them, and an older
router beside a newer server simply shows that strip idle. A step's gain is
the frame's `db`: the speakers' trims are the outputs' (`set_trim`), so they
hold here as they do for every sound. A speaker the frame names and the doc
does not is ignored, a closed stream skips the step silently, and a crowd
never takes the voices the story needs (`STEP_VOICES`).

The constants at the top mirror `house/src/footsteps.ts`, pinned by
`tests/test_audio_footsteps.py`.
"""

from __future__ import annotations

import logging
import random
import zlib
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from .routing import AudioDoc, output_gains, speaker_layout
from .sfx import dsp
from .sounds import SoundBank, decode_file, resample_hq

log = logging.getLogger("stagehand.audio")

#: `@loom/house` `FOOTSTEP_SURFACES` and friends.
FOOTSTEP_SURFACES = ("floor", "tile", "grass")
FOOTSTEP_STRIDE_M = 0.72
FOOTSTEP_PACE_MIN_S = 0.3
FOOTSTEP_PACE_MAX_S = 0.9
FOOTSTEPS_STALE_MS = 4500

#: Takes per surface: even ones are one foot, odd ones the other.
TAKES = 6
#: The bank's seed: one house, one set of takes.
SEED = 49
#: A step comes this much early or late (a fraction of the pace).
PACE_JITTER = 0.08
#: A step's level moves this much either way (dB).
STEP_GAIN_DB = 1.0
#: Every step voice's tag.
STEP_TAG = "footstep"
#: How often the router looks at the walkers. A step lands within this of its
#: time, well inside `PACE_JITTER` at the fastest pace.
WALKERS_TICK_S = 0.02
#: Two programs' steps never land closer than this (s). Six heels in one tick
#: are one thump 15 dB up: into the limiter, which takes the music down with it.
STEP_GAP_S = 0.03
#: The most step voices ringing at once. `mixer.MAX_VOICES` is 32 and it drops
#: the oldest short sound past that: a crowd must never make it a story sound.
#: One program walking rings about one voice; twelve is ten programs at once.
STEP_VOICES = 12
#: Where a step heard through a wall or a floor is cut (Hz).
MUFFLE_HZ = 400.0
#: Takes are matched on their loudest `MATCH_S`, at this RMS (dBFS)…
TAKE_RMS_DB = -18.0
MATCH_S = 0.1
#: …with the peak held under this one (dBFS).
TAKE_PEAK_DB = -4.0
#: A file longer than this is cut (s): a step never pressures the voices.
FILE_MAX_S = 0.5
#: The end of every take fades over this (s), so none ends on a click.
TAIL_FADE_S = 0.012


def step_pace_s(speed: Any) -> float:
    """Seconds a step at `speed` m/s (`@loom/house` `stepPaceS`)."""
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not speed > 0:
        return FOOTSTEP_PACE_MAX_S
    return max(FOOTSTEP_PACE_MIN_S, min(FOOTSTEP_PACE_MAX_S, FOOTSTEP_STRIDE_M / speed))


# -- the sound ----------------------------------------------------------------


@dataclass(frozen=True)
class Surface:
    """What one surface does to a step. Gains are each part's peak against
    the heel's 1.0; a t60 is how long a part takes to fall 60 dB."""

    length_s: float
    #: The heel's sine falls from the first to the second (Hz).
    heel_hz: tuple[float, float]
    heel_t60: float
    #: The surface's own resonance, what a small speaker can say.
    body_hz: float
    body_gain: float
    body_t60: float
    #: The contact: band-passed noise at the heel.
    knock_hz: float
    knock_q: float
    knock_gain: float
    knock_t60: float
    #: The ball of the foot: band-passed noise a beat later.
    scuff_hz: float
    scuff_q: float
    scuff_gain: float
    scuff_at: float
    scuff_t60: float
    #: Crackle in place of plain noise: grass and what's in it.
    crackle: bool = False
    #: Against the bank's level (dB): the same RMS does not sound as loud on each.
    trim_db: float = 0.0


SURFACES: dict[str, Surface] = {
    # Boards: a round thump, a dull knock, a soft scuff.
    "floor": Surface(
        length_s=0.2,
        heel_hz=(108, 72),
        heel_t60=0.15,
        body_hz=186,
        body_gain=0.5,
        body_t60=0.075,
        knock_hz=720,
        knock_q=0.9,
        knock_gain=0.45,
        knock_t60=0.022,
        scuff_hz=1900,
        scuff_q=0.8,
        scuff_gain=0.17,
        scuff_at=0.058,
        scuff_t60=0.06,
    ),
    # Hard and bright: less weight, a sharp tap, the toe's own click.
    "tile": Surface(
        length_s=0.14,
        heel_hz=(128, 88),
        heel_t60=0.08,
        body_hz=310,
        body_gain=0.34,
        body_t60=0.035,
        knock_hz=2700,
        knock_q=1.1,
        knock_gain=0.5,
        knock_t60=0.016,
        scuff_hz=3600,
        scuff_q=1.0,
        scuff_gain=0.2,
        scuff_at=0.046,
        scuff_t60=0.035,
        trim_db=-1.5,
    ),
    # Soft underfoot: a low give, then a long crushed-leaf swish.
    "grass": Surface(
        length_s=0.28,
        heel_hz=(92, 62),
        heel_t60=0.11,
        body_hz=150,
        body_gain=0.32,
        body_t60=0.05,
        knock_hz=420,
        knock_q=0.8,
        knock_gain=0.22,
        knock_t60=0.03,
        scuff_hz=3800,
        scuff_q=0.6,
        scuff_gain=0.22,
        scuff_at=0.016,
        scuff_t60=0.32,
        crackle=True,
        trim_db=-2.5,
    ),
}


def _noise(x: np.ndarray) -> np.ndarray:
    """Noise scaled by its RMS, so that a gain reads as a level whether it is
    smooth or a few loud grains: about 1.0 at a smooth noise's peaks."""
    return x / max(1e-9, 4 * float(np.sqrt(np.mean(x**2))))


def _burst(x: np.ndarray, at: float, attack_s: float, t60: float) -> np.ndarray:
    """`x` as a burst `at` seconds in: a quick rise, then a fall of 60 dB in `t60`."""
    t = dsp.timebase(n=len(x)) - at
    return x * np.where(t < 0, 0.0, np.minimum(t / attack_s, 1.0) * np.exp(-6.907755 * np.maximum(t, 0.0) / t60))


def _matched(x: np.ndarray, trim_db: float = 0.0) -> np.ndarray:
    """A take at the bank's level: the loudest `MATCH_S` at `TAKE_RMS_DB`
    (+ `trim_db`), the peak held under `TAKE_PEAK_DB`."""
    n = min(len(x), max(1, dsp.frames(MATCH_S)))
    power = np.cumsum(np.concatenate(([0.0], x**2)))
    loudest = float(np.sqrt(max(0.0, float((power[n:] - power[:-n]).max())) / n))
    if loudest <= 0.0:
        return x
    gain = 10 ** ((TAKE_RMS_DB + trim_db) / 20) / loudest
    peak = float(np.abs(x).max()) * gain
    return x * min(gain, gain * 10 ** (TAKE_PEAK_DB / 20) / peak)


def synth_take(surface: str, n: int, seed: int = SEED) -> np.ndarray:
    """Take `n` of a surface, mono at `dsp.RATE`. Deterministic per seed."""
    s = SURFACES[surface]
    rng = np.random.default_rng([seed, zlib.crc32(surface.encode()), n])

    def wander(by: float = 0.06) -> float:
        return float(rng.uniform(1 - by, 1 + by))

    # The two feet are a touch apart: one lands a little lighter.
    foot = 1.0 if n % 2 == 0 else 1.05
    size = foot * wander()
    length = s.length_s
    heel = dsp.sine(dsp.glide(s.heel_hz[0] * size, s.heel_hz[1] * size, length)) * dsp.decay(length, s.heel_t60 * wander(), 0.002)
    body = dsp.sine(s.body_hz * size * wander(0.03), length) * dsp.decay(length, s.body_t60 * wander(), 0.001)
    knock = _burst(_noise(dsp.bandpass(dsp.white(length, rng), s.knock_hz * wander(), s.knock_q)), 0.0, 0.0006, s.knock_t60)
    grain = dsp.white(length, rng)
    if s.crackle:
        grain = grain + 3.0 * dsp.crackle(length, rng, density=420, grain_ms=2.5)
    scuff = _burst(_noise(dsp.bandpass(grain, s.scuff_hz * wander(0.1), s.scuff_q)), s.scuff_at * wander(0.2), 0.004, s.scuff_t60 * wander(0.15))
    x = heel + s.body_gain * wander(0.1) * body + s.knock_gain * wander(0.1) * knock + s.scuff_gain * wander(0.2) * scuff
    return _finish(x, s.trim_db)


def _finish(x: np.ndarray, trim_db: float = 0.0) -> np.ndarray:
    """No rumble under it, no click at its end, at the bank's level."""
    return dsp.fade(_matched(dsp.highpass(x, 38.0), trim_db), fade_out=TAIL_FADE_S)


def muffle(x: np.ndarray) -> np.ndarray:
    """A take as heard through a wall (mono at `dsp.RATE`): the top gone, the
    thump kept. Its level stays: the frame's `db` already holds the wall."""
    return dsp.fade(dsp.lowpass(x, MUFFLE_HZ, order=4), fade_out=TAIL_FADE_S)


class FootstepBank:
    """Every take of every surface at the device's rate, clear and muffled,
    as (frames, 1) float32 arrays. Built once off the audio thread (about
    0.1 s); after that a step only hands an array over."""

    def __init__(self, sounds_dir: str | Path, rate: int, *, seed: int = SEED, takes: int = TAKES, decode: Callable[[Path], tuple[np.ndarray, int]] = decode_file) -> None:
        self.rate = rate
        self.seed = seed
        # Its own SoundBank: a take with no file is not a missing sound.
        self._files = SoundBank(sounds_dir, rate, decode)
        self._decode = decode
        self._clear: dict[str, list[np.ndarray]] = {}
        self._muffled: dict[str, list[np.ndarray]] = {}
        #: The takes a real file stands in for: `<surface>_<n>` (n from 1).
        self.real: list[str] = []
        for surface in FOOTSTEP_SURFACES:
            clear = [self._file(surface, n) for n in range(takes)]
            filled = [synth_take(surface, n, seed) if x is None else x for n, x in enumerate(clear)]
            self._clear[surface] = [self._at_rate(x) for x in filled]
            self._muffled[surface] = [self._at_rate(muffle(x)) for x in filled]

    def _at_rate(self, x: np.ndarray) -> np.ndarray:
        return resample_hq(x.astype(np.float32)[:, None], dsp.RATE, self.rate).astype(np.float32)

    def _file(self, surface: str, n: int) -> np.ndarray | None:
        """`footstep_<surface>_<n + 1>` as a take at `dsp.RATE`, or None."""
        name = f"footstep_{surface}_{n + 1}"
        path = self._files.find(name)
        if path is None:
            return None
        try:
            samples, rate = self._decode(path)
        except Exception as err:  # noqa: BLE001 — libsndfile raises its own types
            log.warning("footstep %s: can't decode %s (%s) — the synthesised take plays", name, path, err)
            return None
        mono = np.asarray(resample_hq(samples, rate, dsp.RATE), dtype=np.float64).mean(axis=1)[: dsp.frames(FILE_MAX_S)]
        if not len(mono) or not np.abs(mono).max() > 0:
            return None
        self.real.append(f"{surface}_{n + 1}")
        return _finish(mono, SURFACES[surface].trim_db)

    def takes(self, surface: str) -> int:
        return len(self._clear[surface if surface in self._clear else FOOTSTEP_SURFACES[0]])

    def take(self, surface: str, n: int, *, muffled: bool = False) -> np.ndarray:
        """Take `n` of `surface` (an unknown surface reads as `floor`)."""
        rows = self._muffled if muffled else self._clear
        return rows[surface if surface in rows else FOOTSTEP_SURFACES[0]][n]


# -- the walkers --------------------------------------------------------------


@dataclass(frozen=True)
class StepRig:
    """What a step plays through (`Walkers`'s `rig`): the mixer (`play` is
    all that is used), the audio.json in force and the bank at its rate."""

    mixer: Any
    doc: AudioDoc
    bank: FootstepBank


@dataclass
class _Walk:
    """One program walking."""

    speed: float = 0.0
    surface: str = FOOTSTEP_SURFACES[0]
    #: (speaker, dB, muffled), as the frame has them.
    to: tuple[tuple[str, float, bool], ...] = ()
    #: In the last frame. One that leaves is kept for a pace: a program
    #: stopping and starting must not step early when it comes back.
    here: bool = True
    #: `tick`'s clock: the next step (None: at once) and the last.
    due: float | None = None
    last: float | None = None
    #: The foot that lands next, and the last take each foot played.
    foot: int = 0
    took: list[int] = field(default_factory=lambda: [-1, -1])


def _rows_to(raw: Any) -> tuple[tuple[str, float, bool], ...]:
    """A walker's `to`, as far as it is sound."""
    rows = []
    for t in raw if isinstance(raw, list) else []:
        db = t.get("db") if isinstance(t, dict) else None
        if isinstance(db, bool) or not isinstance(db, (int, float)) or not isinstance(t.get("speaker"), str):
            continue
        rows.append((t["speaker"], float(db), t.get("muffled") is True))
    return tuple(rows)


def step_outputs(doc: AudioDoc, to: tuple[tuple[str, float, bool], ...], muffled: bool) -> tuple[dict[int, float], tuple[str, ...]]:
    """The clear (or muffled) half of a step: 1-based output → dB as
    `Mixer.play` takes them, and the speakers. An output two speakers share
    takes the louder; a speaker the doc does not have is ignored."""
    gains: dict[int, float] = {}
    speakers: list[str] = []
    for speaker, db, heard_muffled in to:
        if heard_muffled != muffled or doc.speaker(speaker) is None:
            continue
        speakers.append(speaker)
        for ch, gain in output_gains(doc, (speaker,), db).items():
            gains[ch] = max(gains.get(ch, gain), gain)
    return gains, tuple(speakers)


class Walkers:
    """Who is walking, and each one's next step. Free of asyncio and of the
    device: `apply` takes the server's frames, `tick` is called on the control
    side with a clock, and a step is a `Mixer.play` (which only queues).

    `rig()` is what a step plays through, or None while there is nothing to
    play it on (a closed stream, no speakers, no bank yet): the step is
    skipped, silently, and the walk keeps its pace."""

    def __init__(self, rig: Callable[[], StepRig | None], *, rng: random.Random | None = None) -> None:
        self.rig = rig
        self.rng = rng or random.Random()
        self._walks: dict[str, _Walk] = {}
        #: A frame arrived since the last tick, and the tick that last saw one.
        self._fresh = False
        self._frame_at: float | None = None
        #: When each step voice in flight ends, and when the next may land.
        self._ringing: list[float] = []
        self._quiet_until = 0.0

    @property
    def count(self) -> int:
        """How many programs are walking now."""
        return sum(1 for w in self._walks.values() if w.here)

    def apply(self, frame: Any) -> None:
        """A `WalkersFrame`: those it names walk, on, at its speed; anyone
        else stops after the step they are on. Every frame proves the link is
        alive, an unchanged one too. `seq` is not read: it restarts with the
        server, and one stream's frames are in order."""
        rows = frame.get("walkers") if isinstance(frame, dict) else None
        if not isinstance(rows, list):
            return
        self._fresh = True
        for walk in self._walks.values():
            walk.here = False
        for raw in rows:
            sid = raw.get("id") if isinstance(raw, dict) else None
            if not isinstance(sid, str) or not sid:
                continue
            walk = self._walks.setdefault(sid, _Walk())
            speed = raw.get("speed")
            speed = float(speed) if isinstance(speed, (int, float)) and not isinstance(speed, bool) else 0.0
            if speed != walk.speed and walk.last is not None and walk.due is not None:
                # Speeding up: the step in hand must not wait out the old pace.
                walk.due = min(walk.due, walk.last + step_pace_s(speed))
            surface = raw.get("surface")
            walk.speed, walk.to, walk.here = speed, _rows_to(raw.get("to")), True
            walk.surface = surface if surface in FOOTSTEP_SURFACES else FOOTSTEP_SURFACES[0]

    def clear(self) -> None:
        """Everyone stops now (Stop house sounds, a story restart): only a
        new frame sets anyone walking again."""
        self._walks.clear()

    def tick(self, now: float) -> None:
        """Whatever is due by `now` (seconds, any steady clock). A walker takes
        at most one step a tick and its next is counted from now, so a stalled
        clock is a late step, never a burst of them; one that lands on another
        program's step waits `STEP_GAP_S`."""
        if self._fresh:
            self._frame_at, self._fresh = now, False
        if self._frame_at is not None and now - self._frame_at > FOOTSTEPS_STALE_MS / 1000:
            # A dead link: nobody can say these are still walking.
            self._frame_at = None
            self.clear()
            return
        rig = self.rig()
        for sid, walk in list(self._walks.items()):
            if not walk.here:
                if walk.last is None or now - walk.last > FOOTSTEP_PACE_MAX_S:
                    del self._walks[sid]
                continue
            if (walk.due is not None and now < walk.due) or now < self._quiet_until:
                continue
            if rig is not None and self._step(walk, rig, now):
                self._quiet_until = now + STEP_GAP_S
            walk.last = now
            walk.due = now + step_pace_s(walk.speed) * (1 + self.rng.uniform(-PACE_JITTER, PACE_JITTER))
            walk.foot ^= 1

    def _take(self, walk: _Walk, bank: FootstepBank) -> int:
        """This foot's next take: its own side of the bank, so no take plays
        twice running, and not the one it last played."""
        side = range(walk.foot, bank.takes(walk.surface), 2)
        n = self.rng.choice([k for k in side if k != walk.took[walk.foot]] or list(side))
        walk.took[walk.foot] = n
        return n

    def _step(self, walk: _Walk, rig: StepRig, now: float) -> bool:
        """One step: a voice for the speakers that hear it clear, one for
        those that hear it muffled, within `STEP_VOICES`. → anything played."""
        self._ringing = [end for end in self._ringing if end > now]
        room = STEP_VOICES - len(self._ringing)
        if room <= 0:
            return False
        n = self._take(walk, rig.bank)
        level = self.rng.uniform(-STEP_GAIN_DB, STEP_GAIN_DB)
        played = False
        for muffled in (False, True):
            gains, speakers = step_outputs(rig.doc, walk.to, muffled)
            if not gains or room <= 0:
                continue
            source = rig.bank.take(walk.surface, n, muffled=muffled)
            # No fade-in: a take starts on zero, and the mixer's 5 ms would eat the heel's first peak.
            rig.mixer.play(source, gains, bus="sfx", strip="steps", tag=STEP_TAG, fade_in_s=0.0, level_db=level, layout=speaker_layout(rig.doc, speakers))
            self._ringing.append(now + len(source) / rig.bank.rate)
            room -= 1
            played = True
        return played
