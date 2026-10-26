## The voice link's shared pieces (wave 19, `docs/loom-reinstall.md` §2.4) —
## a literal port of `house/src/voice.ts`: the wire's constants, G.711 μ-law
## (mono, 16 kHz, 200 ms chunks), a streaming linear resampler, the RMS
## level, the open-mic gate with its software half-duplex hold, the chunker,
## the playback jitter decision, and [method voice_on] / [method hears_terminals]
## / [method hears_players] (the server's routing rule — same room only,
## wave 26 — and D7: a terminal standing in the spawn room — the tent, the
## shed — is off unless the map says `voice: true`).
##
## Pure: no nodes, no I/O. Pinned by `res://test/golden/voice-mulaw.json`
## (`@loom/house` writes it; `pnpm --filter @loom/house sync` copies it).
class_name VoiceCodec
extends RefCounted

const VOICE_RATE := 16000
const VOICE_CHUNK_MS := 200
const VOICE_CHUNK_BYTES := 3200
const VOICE_MAX_BYTES := 8000
const VOICE_MIN_BYTES := 160
const VOICE_CODEC := "mulaw"
const VOICE_MAX_TERMINALS := 4
const VOICE_MAX_PLAYERS := 3
const VOICE_GATE_DBFS := -42.0
const VOICE_HANG_MS := 400
const VOICE_TAIL_MS := 300
const VOICE_FRESH_MS := 1500
const VOICE_JITTER_TARGET_MS := 200
const VOICE_JITTER_MAX_MS := 400
## D5b, the barge-in: while a terminal's voice plays here (+ the tail) the
## gate rises to this instead of closing (a terminal keeps the hard hold).
const VOICE_BARGE_DBFS := -28.0
## An incoming voice under this gain is too faint to echo: it raises nothing.
const VOICE_BARGE_MIN_GAIN := 0.2

## The bias added to the 14-bit magnitude (0x84 at 16 bits).
const _BIAS14 := 0x84 >> 2
## The largest 14-bit magnitude before the bias.
const _CLIP14 := 8159
## Each segment's upper bound (biased 14-bit magnitude).
const _SEG_END := [0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff]

## Magnitude (0 … [constant _CLIP14]) → its positive μ-law code before the
## sign mask; built once.
static var _encode_table := PackedByteArray()
## Byte → `linear / 32768`; built once.
static var _decode_table := PackedFloat32Array()


# --- G.711 μ-law ---------------------------------------------------------------


## The positive code of a clipped 14-bit magnitude, before the sign mask.
static func _code_of(mag: int) -> int:
	var s := mag + _BIAS14
	var seg := 0
	while seg < 8 and s > int(_SEG_END[seg]):
		seg += 1
	if seg >= 8:
		return 0x7f
	return (seg << 4) | ((s >> (seg + 1)) & 0x0f)


static func _tables() -> void:
	if _encode_table.is_empty():
		_encode_table.resize(_CLIP14 + 1)
		for m in _CLIP14 + 1:
			_encode_table[m] = _code_of(m)
	if _decode_table.is_empty():
		_decode_table.resize(256)
		for b in 256:
			_decode_table[b] = mulaw_linear(b) / 32768.0


## One sample: a float in [-1, 1] (clamped; NaN = 0) → its μ-law byte. The
## 14-bit magnitude is `floor(|x| · 8192 + 0.5)`, clipped at 8159, biased,
## segmented, then bit-inverted (G.711 / Sun's `linear2ulaw`): 0 → 0xFF,
## 1 → 0x80, −1 → 0x00.
static func mulaw_byte(x: float) -> int:
	_tables()
	var neg := x < 0.0
	var a := 0.0 if is_nan(x) else minf(absf(x), 1.0)
	var m := mini(int(floor(a * 8192.0 + 0.5)), _CLIP14)
	return _encode_table[m] ^ (0x7f if neg else 0xff)


## One μ-law byte → its 16-bit linear value (Sun's `ulaw2linear`), ±32124 at most.
static func mulaw_linear(byte: int) -> int:
	var u := ~byte & 0xff
	var t := ((u & 0x0f) << 3) + 0x84
	t <<= (u & 0x70) >> 4
	return 0x84 - t if u & 0x80 else t - 0x84


## Float samples → μ-law bytes, one per sample.
static func mulaw_encode(samples: PackedFloat32Array) -> PackedByteArray:
	_tables()
	var out := PackedByteArray()
	out.resize(samples.size())
	for i in samples.size():
		var x := samples[i]
		var neg := x < 0.0
		var a := 0.0 if is_nan(x) else minf(absf(x), 1.0)
		out[i] = _encode_table[mini(int(a * 8192.0 + 0.5), _CLIP14)] ^ (0x7f if neg else 0xff)
	return out


## μ-law bytes → float samples (`linear / 32768`, exact).
static func mulaw_decode(bytes: PackedByteArray) -> PackedFloat32Array:
	_tables()
	var out := PackedFloat32Array()
	out.resize(bytes.size())
	for i in bytes.size():
		out[i] = _decode_table[bytes[i]]
	return out


## A chunk's RMS level in dBFS (full scale = 1.0); silence or nothing = −INF.
static func rms_dbfs(samples: PackedFloat32Array) -> float:
	if samples.is_empty():
		return -INF
	var sum := 0.0
	for x in samples:
		sum += x * x
	if sum == 0.0:
		return -INF
	return 10.0 * log(sum / samples.size()) / log(10.0)


# --- resampling ----------------------------------------------------------------


## A linear-interpolating resampler that keeps its phase across chunks: the
## output of any split of a signal is the output of the whole. Output `k`
## sits at source position `k · from / to`, tracked in integers (rates are
## rounded to whole Hz), so nothing drifts over a night.
class Resampler:
	extends RefCounted

	var from: int
	var to: int
	## The next output's source position × `to`, relative to the next chunk's first sample.
	var _num := 0
	## The previous chunk's last sample (source index −1).
	var _last := 0.0

	func _init(from_rate: float, to_rate: float) -> void:
		from = maxi(1, roundi(from_rate))
		to = maxi(1, roundi(to_rate))

	## Resample one chunk; returns the outputs it completes.
	func push(input: PackedFloat32Array) -> PackedFloat32Array:
		var out := PackedFloat32Array()
		var n := input.size()
		if n == 0:
			return out
		var limit := (n - 1) * to
		var count := 0 if _num > limit else (limit - _num) / from + 1
		out.resize(count)
		var num := _num
		for k in count:
			# Floor division: `num` is −to … 0 for the held sample.
			var i := num / to
			if num < 0 and num % to != 0:
				i -= 1
			var rem := num - i * to
			var a: float = _last if i < 0 else input[i]
			out[k] = a if rem == 0 else a + (input[i + 1] - a) * (float(rem) / float(to))
			num += from
		_num = num - n * to
		_last = input[n - 1]
		return out

	## Forget the phase and the held sample (a new stream).
	func reset() -> void:
		_num = 0
		_last = 0.0


# --- the gate --------------------------------------------------------------------


## The open-mic gate (D5). Feed it every captured chunk with its level and
## the clock (ms); it answers the chunks to send now. A chunk over the gate
## opens it (and sends the one quiet chunk before it — the pre-roll); it
## stays open `hang_ms` after the last loud chunk. [method hold_until] is
## the software half-duplex: until then every chunk is dropped, the gate
## closes and the pre-roll is forgotten (the terminals' rule).
## [method raise_until] is the games' barge-in (D5b): until then a chunk
## must beat `dbfs` (or the gate, whichever is higher) and no pre-roll is
## kept. A hold beats a raise.
class Gate:
	extends RefCounted

	var gate_dbfs: float
	var hang_ms: float
	var _open_until := -INF
	var _open := false
	var _held := -INF
	var _raised := -INF
	var _raised_dbfs := -INF
	var _preroll: Variant = null

	func _init(gate := VoiceCodec.VOICE_GATE_DBFS, hang := float(VoiceCodec.VOICE_HANG_MS)) -> void:
		gate_dbfs = gate
		hang_ms = hang

	## Send nothing before `ms` (incoming voice playing + [constant VoiceCodec.VOICE_TAIL_MS]). Only ever extends.
	func hold_until(ms: float) -> void:
		if ms > _held:
			_held = ms

	## Whether `now` is inside a half-duplex hold.
	func holding(now: float) -> bool:
		return now < _held

	## Until `ms` only a chunk louder than `dbfs` opens the gate. The time
	## only ever extends; the level is the last asked.
	func raise_until(ms: float, dbfs: float) -> void:
		if ms > _raised:
			_raised = ms
		_raised_dbfs = dbfs

	## Whether `now` is inside a barge-in raise.
	func raised_at(now: float) -> bool:
		return now < _raised

	## The level a chunk must beat at `now`.
	func threshold_at(now: float) -> float:
		return maxf(gate_dbfs, _raised_dbfs) if now < _raised else gate_dbfs

	## Whether the last chunk left the gate open.
	func is_open() -> bool:
		return _open

	## One chunk, its level (dBFS) and when it was captured → the chunks to send now.
	func push(chunk: Variant, dbfs: float, now: float) -> Array:
		if now < _held:
			_open = false
			_open_until = -INF
			_preroll = null
			return []
		var raised := now < _raised
		if dbfs > threshold_at(now):
			var was_open := _open
			_open = true
			_open_until = now + hang_ms
			var out: Array = [_preroll] if not was_open and _preroll != null else []
			_preroll = null
			out.append(chunk)
			return out
		if _open and now <= _open_until:
			return [chunk]
		_open = false
		# Under a raise a quiet chunk may hold the voice being played back.
		_preroll = null if raised else chunk
		return []

	## Close the gate and forget the pre-roll (the mic stopped). The hold stands.
	func reset() -> void:
		_open = false
		_open_until = -INF
		_preroll = null


## Collects resampled 16 kHz samples and hands back whole chunks of `size`
## samples (default [constant VoiceCodec.VOICE_CHUNK_BYTES], 200 ms).
class ChunkAssembler:
	extends RefCounted

	var size: int
	var _buf := PackedFloat32Array()
	var _fill := 0

	func _init(n := VoiceCodec.VOICE_CHUNK_BYTES) -> void:
		size = maxi(1, n)
		_buf.resize(size)

	## Samples held toward the next chunk.
	func pending() -> int:
		return _fill

	func push(samples: PackedFloat32Array) -> Array:
		var out: Array = []
		for x in samples:
			_buf[_fill] = x
			_fill += 1
			if _fill == size:
				out.append(_buf)
				_buf = PackedFloat32Array()
				_buf.resize(size)
				_fill = 0
		return out

	func reset() -> void:
		_fill = 0


# --- playback jitter -------------------------------------------------------------


## What to do with an incoming chunk, given how much of its source is queued
## (ms, ≤ 0 = nothing): `{action, at, drop, fadeIn}` — "start" at the target
## with a fade-in; "queue" right after what is queued; "skip" (more than
## `max_ms` queued): drop `drop` ms of it, then play at the target with a fade.
static func jitter_plan(buffered_ms: float, target_ms := float(VOICE_JITTER_TARGET_MS), max_ms := float(VOICE_JITTER_MAX_MS)) -> Dictionary:
	var top := maxf(target_ms, max_ms)
	if is_nan(buffered_ms) or buffered_ms <= 0.0:
		return {"action": "start", "at": target_ms, "drop": 0.0, "fadeIn": true}
	if buffered_ms > top:
		return {"action": "skip", "at": target_ms, "drop": buffered_ms - target_ms, "fadeIn": true}
	return {"action": "queue", "at": buffered_ms, "drop": 0.0, "fadeIn": false}


# --- who hears whom --------------------------------------------------------------


## The terminal spot `spot` (a dictionary, or an id on `house`), else `{}`.
static func _spot_of(house: Dictionary, spot: Variant) -> Dictionary:
	if spot is Dictionary:
		return spot
	for t: Dictionary in house.get("terminals", []):
		if str(t.get("id", "")) == str(spot):
			return t
	return {}


## D7: whether a terminal takes part in the voice link. `voice: true` → on,
## `voice: false` → off; unset → on, except a terminal standing in the map's
## spawn room (the tent laptop, beside the headsets). An unknown id → off.
static func voice_on(house: Dictionary, spot: Variant) -> bool:
	var t := _spot_of(house, spot)
	if t.is_empty():
		return false
	var v: Variant = t.get("voice")
	if v is bool:
		return v
	var spawn: Dictionary = house.get("spawn", {})
	return str(t.get("room", "")) != str(spawn.get("room", ""))


## The room the rule judges a player by: `player.room` when given (the
## server passes the presence room, [method HouseLocate.presence_room]),
## else [method HouseLocate.locate]'s.
static func _room_of(house: Dictionary, player: Dictionary) -> Variant:
	if player.has("room"):
		return player["room"]
	return HouseLocate.locate(house, player["p"])["room"]


## Plan distance in doubles (a Vector2 is single precision).
static func _plan(a: Array, b: Array) -> float:
	var dx := float(a[0]) - float(b[0])
	var dz := float(a[2]) - float(b[2])
	return sqrt(dx * dx + dz * dz)


## Nearest first, ties by id in code-unit order; `rows` are `[d, id]`.
static func _nearest(rows: Array, most: int) -> Array:
	rows.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and str(a[1]) < str(b[1])))
	return rows.slice(0, most)


## The terminals a player hears (wave 26, R5), `[{spot, gain}]`: voice on,
## in the player's room (`player.room`, else located from `player.p`; a
## player in no room hears none), never a `view: "reinstall"` terminal (the
## tent station, even with `voice: true`), gain 1; the
## [constant VOICE_MAX_TERMINALS] nearest in plan, nearest first. No reach,
## nothing through a wall.
## `opts.only` (an Array of spot ids) limits the candidates.
static func hears_terminals(house: Dictionary, player: Dictionary, opts := {}) -> Array:
	var only: Variant = opts.get("only")
	var rm: Variant = _room_of(house, player)
	if rm == null:
		return []
	var rows: Array = []
	for t: Dictionary in house.get("terminals", []):
		var pos: Array = t.get("pos", [])
		if pos.size() < 3 or str(t.get("room", "")) != str(rm) or str(t.get("view", "")) == "reinstall" or not voice_on(house, t):
			continue
		if only is Array and not (only as Array).has(str(t["id"])):
			continue
		rows.append([_plan(pos, player["p"]), str(t["id"])])
	var out: Array = []
	for r: Array in _nearest(rows, VOICE_MAX_TERMINALS):
		out.append({"spot": r[1], "gain": 1.0})
	return out


## The players a terminal hears (wave 26, R5), `[{session, gain}]`: voice
## on at the terminal (never a `view: "reinstall"` one), the players
## (`{session, p, room?}`) whose room is the
## terminal's, gain 1; the [constant VOICE_MAX_PLAYERS] nearest its `pos`.
## `opts.only` (an Array of sessions) limits them.
static func hears_players(house: Dictionary, spot: Variant, players: Array, opts := {}) -> Array:
	var t := _spot_of(house, spot)
	if t.is_empty() or str(t.get("view", "")) == "reinstall" or not voice_on(house, t):
		return []
	var only: Variant = opts.get("only")
	var rows: Array = []
	for pl: Dictionary in players:
		var rm: Variant = _room_of(house, pl)
		if rm == null or str(rm) != str(t.get("room", "")):
			continue
		if only is Array and not (only as Array).has(str(pl["session"])):
			continue
		rows.append([_plan(t["pos"], pl["p"]), str(pl["session"])])
	var out: Array = []
	for r: Array in _nearest(rows, VOICE_MAX_PLAYERS):
		out.append({"session": r[1], "gain": 1.0})
	return out
