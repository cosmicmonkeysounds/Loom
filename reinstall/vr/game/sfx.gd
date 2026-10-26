## The game's own sounds (wave 26, R8) — synthesised here, like the web
## game's `audio.ts` (no assets to ship or import): Gerald's quack (a buzzy
## sawtooth through a nasal formant, pitch falling, two syllables), the
## fanfare, the soft "no" buzz, the King's thud, the void's scare, a pickup
## blip and a quiet hum for the Internet.
##
## Every sound is rendered once into a 16-bit [AudioStreamWAV] and played on
## the **Sfx** bus ([constant BUS], made here when the project has none,
## sending to Master). The quack plays from an [AudioStreamPlayer3D] on the
## duck ([method quack_at]: panned from where Gerald is, at the web game's
## closeness volume); the rest are head-locked [AudioStreamPlayer]s.
##
## Each one-shot emits [signal played] with its length: [Game] holds the
## voice link's mic shut that long ([method VoiceLink.hold_for]), so the
## Quest (which cancels no echo) never sends the game's own sound to the
## terminals. The hum is the one exception: it loops all walk at
## [constant HUM_DB], under the mic gate, and holding the mic for it would
## shut the voice link for the whole walk.
##
## The generators are static and pure (tests check lengths, levels and
## the quack's schedule, [method quack_plan], against the web constants).
class_name Sfx
extends Node

## A one-shot started: `sound` and its length (ms).
signal played(sound: String, ms: float)

## The bus every sound plays on.
const BUS := "Sfx"
## Sample rate of the rendered sounds.
const RATE := 22050
## The game's master level (the web game's GAME_LEVEL).
const GAME_LEVEL := 0.7
## The web game's quack schedule (`engine.ts` maybeQuack): within
## [constant QUACK_RANGE] m (plan) and [constant QUACK_LEVEL] m of height,
## a quack at 0.25 + 0.75 × closeness every 1.6 s + (1 − closeness) × 3.2 s
## + up to 0.9 s; out of range, look again in [constant QUACK_RETRY] s. The
## first one waits [constant QUACK_FIRST] s. The quack is no path hint and
## is never held back by the path reveal (R2).
const QUACK_RANGE := 7.0
const QUACK_LEVEL := 2.0
const QUACK_RETRY := 1.5
const QUACK_FIRST := 2.5
## The found screen's fanfare follows the quack after this long (s).
const FANFARE_AFTER := 0.65
## The hum's level (quiet: under the mic's gate).
const HUM_DB := -30.0
## Every one-shot this node knows.
const SOUNDS := ["quack", "fanfare", "buzz", "thud", "scare", "pickup"]

## Every one-shot played, oldest first (the tests read it).
var log: Array[String] = []
## The hum's player (looping) and the pool of head-locked one-shot players.
var _hum: AudioStreamPlayer
var _pool: Array[AudioStreamPlayer] = []

static var _streams := {}


func _ready() -> void:
	ensure_bus()
	# Rendered at boot, never on the first quack (a hitch in the headset).
	for sound: String in SOUNDS + ["hum"]:
		stream_of(sound)
	_hum = AudioStreamPlayer.new()
	_hum.name = "Hum"
	_hum.bus = BUS
	_hum.stream = stream_of("hum")
	_hum.volume_db = HUM_DB
	add_child(_hum)
	for i in 4:
		var p := AudioStreamPlayer.new()
		p.name = "Shot_%d" % i
		p.bus = BUS
		add_child(p)
		_pool.append(p)


## The Sfx bus's index (made, sending to Master, if the layout has none).
static func ensure_bus() -> int:
	var i := AudioServer.get_bus_index(BUS)
	if i >= 0:
		return i
	i = AudioServer.bus_count
	AudioServer.add_bus(i)
	AudioServer.set_bus_name(i, BUS)
	AudioServer.set_bus_send(i, "Master")
	return i


## Play a head-locked one-shot (`sound` in [constant SOUNDS]) at `volume`
## (0 … 1); returns its length (ms), 0 for an unknown sound.
func play(sound: String, volume := 1.0) -> float:
	if sound == "quack":
		return quack_at(null, volume)
	if not sound in SOUNDS:
		return 0.0
	var p := _free_player()
	p.stream = stream_of(sound)
	p.volume_db = linear_to_db(clampf(volume, 0.0001, 1.0))
	p.play()
	return _played(sound)


## A quack from `emitter` (the duck's [AudioStreamPlayer3D]; null =
## head-locked) at `volume` 0 … 1, pitch varied ±6 % like the web game's.
func quack_at(emitter: AudioStreamPlayer3D, volume := 1.0) -> float:
	var v := clampf(volume, 0.0, 1.0)
	if v < 0.02:
		return 0.0
	var pitch := 1.0 + (randf() - 0.5) * 0.12
	if emitter != null and emitter.is_inside_tree():
		emitter.stream = stream_of("quack")
		emitter.pitch_scale = pitch
		emitter.volume_db = linear_to_db(v)
		emitter.play()
	else:
		var p := _free_player()
		p.stream = stream_of("quack")
		p.pitch_scale = pitch
		p.volume_db = linear_to_db(v)
		p.play()
	return _played("quack")


## The hum on (playing) or off.
func set_hum(on: bool) -> void:
	if _hum == null:
		return
	if on and not _hum.playing:
		_hum.play()
	elif not on and _hum.playing:
		_hum.stop()


func hum_on() -> bool:
	return _hum != null and _hum.playing


func _played(sound: String) -> float:
	var ms := length_ms(sound)
	log.append(sound)
	played.emit(sound, ms)
	return ms


func _free_player() -> AudioStreamPlayer:
	for p in _pool:
		if not p.playing:
			p.pitch_scale = 1.0
			return p
	var oldest := _pool.pop_front() as AudioStreamPlayer
	_pool.append(oldest)
	oldest.stop()
	oldest.pitch_scale = 1.0
	return oldest


## A sound's length (ms).
static func length_ms(sound: String) -> float:
	return float(samples_of(sound).size()) * 1000.0 / RATE


## The quack's schedule at `plan` m (plan distance to Gerald) and `dy` m of
## height between the player and him, `rand` 0 … 1: `{quack: bool, volume,
## next}` (next = seconds to the next look).
static func quack_plan(plan: float, dy: float, rand: float) -> Dictionary:
	if plan > QUACK_RANGE or absf(dy) >= QUACK_LEVEL:
		return {"quack": false, "volume": 0.0, "next": QUACK_RETRY}
	var closeness := 1.0 - plan / QUACK_RANGE
	return {"quack": true, "volume": 0.25 + 0.75 * closeness, "next": 1.6 + (1.0 - closeness) * 3.2 + rand * 0.9}


## A rendered sound as a 16-bit mono [AudioStreamWAV] (made once; the hum loops).
static func stream_of(sound: String) -> AudioStreamWAV:
	if not _streams.has(sound):
		_streams[sound] = wav(samples_of(sound), sound == "hum")
	return _streams[sound]


## `samples` (−1 … 1) as a 16-bit mono WAV at [constant RATE], looping when asked.
static func wav(samples: PackedFloat32Array, loop := false) -> AudioStreamWAV:
	var bytes := PackedByteArray()
	bytes.resize(samples.size() * 2)
	for i in samples.size():
		bytes.encode_s16(i * 2, int(round(clampf(samples[i], -1.0, 1.0) * 32767.0)))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = bytes
	if loop:
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		w.loop_begin = 0
		w.loop_end = samples.size()
	return w


static var _rendered := {}


## The samples of `sound` at [constant RATE] (rendered once), the game
## level applied; empty for an unknown sound.
static func samples_of(sound: String) -> PackedFloat32Array:
	if _rendered.has(sound):
		return _rendered[sound]
	var out := PackedFloat32Array()
	match sound:
		"quack": out = _quack()
		"fanfare": out = _fanfare()
		"buzz": out = _buzz()
		"thud": out = _thud()
		"scare": out = _scare()
		"pickup": out = _pickup()
		"hum": out = _hum_loop()
	for i in out.size():
		out[i] = clampf(out[i] * GAME_LEVEL, -1.0, 1.0)
	_rendered[sound] = out
	return out


# --- the recipes (the web game's, sample by sample) ---------------------------------


static func _buffer(seconds: float) -> PackedFloat32Array:
	var b := PackedFloat32Array()
	b.resize(int(ceil(seconds * RATE)))
	return b


## WebAudio's exponential ramp from `a` to `b` over `len` s, at `t` s in.
static func _exp(a: float, b: float, t: float, len: float) -> float:
	if t <= 0.0:
		return a
	if t >= len:
		return b
	return a * pow(b / a, t / len)


## A sawtooth / square / triangle / sine sample at phase `ph` (cycles).
static func _wave(kind: String, ph: float) -> float:
	var f: float = ph - floor(ph)
	match kind:
		"saw": return 2.0 * f - 1.0
		"square": return 1.0 if f < 0.5 else -1.0
		"triangle": return 4.0 * absf(f - 0.5) - 1.0
	return sin(TAU * f)


## An RBJ biquad (band-pass at constant peak gain, or high-pass) run over
## `x` in place, its centre from `freq.call(t)` (re-tuned every 32 samples).
static func _biquad(x: PackedFloat32Array, kind: String, freq: Callable, q: float) -> void:
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	var b0 := 0.0
	var b1 := 0.0
	var b2 := 0.0
	var a1 := 0.0
	var a2 := 0.0
	for i in x.size():
		if i % 32 == 0:
			var w0 := TAU * float(freq.call(float(i) / RATE)) / RATE
			var alpha := sin(w0) / (2.0 * q)
			var a0 := 1.0 + alpha
			if kind == "bandpass":
				b0 = alpha / a0
				b1 = 0.0
				b2 = -alpha / a0
			else:
				b0 = (1.0 + cos(w0)) / 2.0 / a0
				b1 = -(1.0 + cos(w0)) / a0
				b2 = b0
			a1 = -2.0 * cos(w0) / a0
			a2 = (1.0 - alpha) / a0
		var y := b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
		x2 = x1
		x1 = x[i]
		y2 = y1
		y1 = y
		x[i] = y


## One quack syllable into `out` at `at` s: a sawtooth falling `f0` → `f1`
## over `len` s through the nasal "wa" (a band-pass, Q 5, sliding 1500 →
## 900 Hz) and a 280 Hz low cut, enveloped to `vol`.
static func _syllable(out: PackedFloat32Array, at: float, f0: float, f1: float, len: float, vol: float) -> void:
	var n := int((len + 0.02) * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var ph := 0.0
	for i in n:
		var t := float(i) / RATE
		ph += _exp(f0, f1, t, len) / RATE
		s[i] = _wave("saw", ph)
	_biquad(s, "bandpass", func(t: float) -> float: return _exp(1500.0, 900.0, t, len), 5.0)
	_biquad(s, "highpass", func(_t: float) -> float: return 280.0, 0.7071)
	var start := int(at * RATE)
	for i in n:
		var t := float(i) / RATE
		var env: float
		if t < 0.012:
			env = _exp(0.0001, vol, t, 0.012)
		elif t < len * 0.55:
			env = vol
		else:
			env = _exp(vol, 0.0001, t - len * 0.55, len * 0.45)
		if start + i < out.size():
			# The band-pass at Q 5 takes the saw down ~12 dB; give it back.
			out[start + i] += s[i] * env * 4.0


## A plain enveloped tone into `out` (10 ms attack to `vol`, exponential
## decay to silence at `len`).
static func _tone(out: PackedFloat32Array, at: float, freq: float, len: float, vol: float, kind := "triangle") -> void:
	var start := int(at * RATE)
	var n := int(len * RATE)
	for i in n:
		var t := float(i) / RATE
		var env := _exp(0.0001, vol, t, 0.01) if t < 0.01 else _exp(vol, 0.0001, t - 0.01, len - 0.01)
		if start + i < out.size():
			out[start + i] += _wave(kind, freq * t) * env


## White noise into `out`, `vol` decaying to silence over `len` s (seeded: the same every time).
static func _noise(out: PackedFloat32Array, at: float, len: float, vol: float, seed := 7) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var start := int(at * RATE)
	var n := int(len * RATE)
	for i in n:
		if start + i < out.size():
			out[start + i] += (rng.randf() * 2.0 - 1.0) * _exp(vol, 0.0001, float(i) / RATE, len)


static func _quack() -> PackedFloat32Array:
	var out := _buffer(0.36)
	_syllable(out, 0.0, 520.0, 380.0, 0.11, 0.5)
	_syllable(out, 0.14, 470.0, 300.0, 0.17, 0.5)
	return out


static func _fanfare() -> PackedFloat32Array:
	var notes := [523.25, 659.25, 783.99, 1046.5, 1318.5]
	var end := notes.size() * 0.11
	var out := _buffer(end + 1.25)
	for i in notes.size():
		_tone(out, i * 0.11, notes[i], 0.5, 0.18)
	_tone(out, end, 1567.98, 1.2, 0.14, "sine")
	_tone(out, end, 783.99, 1.2, 0.1, "square")
	return out


static func _buzz() -> PackedFloat32Array:
	var out := _buffer(0.47)
	_tone(out, 0.0, 196.0, 0.18, 0.12, "square")
	_tone(out, 0.2, 147.0, 0.25, 0.12, "square")
	return out


## A 90 ms low square, pitch dropping 110 → 45 Hz, under a burst of noise.
static func _thud() -> PackedFloat32Array:
	var out := _buffer(0.12)
	var ph := 0.0
	for i in int(0.09 * RATE):
		var t := float(i) / RATE
		ph += _exp(110.0, 45.0, t, 0.09) / RATE
		var env := _exp(0.0001, 0.3, t, 0.006) if t < 0.006 else _exp(0.3, 0.0001, t - 0.006, 0.084)
		out[i] += _wave("square", ph) * env
	_noise(out, 0.0, 0.06, 0.16)
	return out


## The void's jump scare: one hard hit (a noise burst over a falling
## square), then a low detuned drone that dies away — a single onset,
## nothing that pulses faster than 3 Hz.
static func _scare() -> PackedFloat32Array:
	var out := _buffer(1.6)
	_noise(out, 0.0, 0.35, 0.55, 13)
	var ph := 0.0
	for i in int(0.5 * RATE):
		var t := float(i) / RATE
		ph += _exp(220.0, 55.0, t, 0.5) / RATE
		out[i] += _wave("square", ph) * _exp(0.35, 0.0001, t, 0.5)
	for f: float in [55.0, 58.3]:
		var p := 0.0
		for i in int(1.55 * RATE):
			var t := float(i) / RATE
			p += f / RATE
			var env := _exp(0.0001, 0.22, t, 0.04) if t < 0.04 else _exp(0.22, 0.0001, t - 0.04, 1.5)
			out[i] += _wave("saw", p) * env
	return out


## A pickup: two quick rising notes and a sparkle.
static func _pickup() -> PackedFloat32Array:
	var out := _buffer(0.5)
	_tone(out, 0.0, 659.25, 0.14, 0.16, "square")
	_tone(out, 0.09, 987.77, 0.2, 0.16, "square")
	_tone(out, 0.18, 1975.5, 0.3, 0.08, "sine")
	return out


## Two seconds of a low mains-like hum (50 + 100 Hz, a slow swell),
## whole cycles so it loops without a click.
static func _hum_loop() -> PackedFloat32Array:
	var out := _buffer(2.0)
	for i in out.size():
		var t := float(i) / RATE
		var swell := 0.75 + 0.25 * sin(TAU * 0.5 * t)
		out[i] = (0.6 * sin(TAU * 50.0 * t) + 0.3 * sin(TAU * 100.0 * t)) * 0.5 * swell
	return out
