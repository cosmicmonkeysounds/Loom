## The headset's voice link (wave 19, `docs/loom-reinstall.md` §2.4): the
## people standing at the house's wall terminals are heard at each
## terminal's screen in the virtual house, and the player is heard on the
## terminals near them.
##
## - **Down**: one SSE stream (`GET /e/<event>/api/spatial/voice/stream?token=`,
##   on [SseClient]). The server routes (D3): this stream carries only the
##   terminals the player can hear, each `voice` frame with a gain. A
##   terminal's voice plays from an [AudioStreamPlayer3D] under its
##   `Terminal_<id>` ([method HouseBuilder.voice_emitter]; re-attached after
##   a map rebuild), on an [AudioStreamGenerator] at 16 kHz, with a 200 ms
##   jitter target and a skip ahead past 400 ms ([method VoiceCodec.jitter_plan]);
##   `bye` fades it out. A terminal the map has voice off (the tent) is
##   never played (D7).
## - **Up**: the mic ([method AudioServer.set_input_device_active] +
##   [method AudioServer.get_input_frames]; an [AudioStreamMicrophone] on a
##   muted bus with an [AudioEffectCapture] when the former gives nothing
##   for [constant MIC_FALLBACK_AFTER] s), resampled to 16 kHz, cut in
##   200 ms chunks, μ-law, through the open-mic gate (D5). Only while
##   someone can hear it (`listen {on}`, the POST's `listening`) and never
##   while a voice plays here (+ [constant VoiceCodec.VOICE_TAIL_MS]: the
##   software half-duplex — the Quest cancels no echo). Uploads go on one
##   persistent keep-alive [HTTPClient] (`request_raw`; [HTTPRequest]
##   closes per request), one POST in flight, at most
##   [constant UPLINK_QUEUE] chunks (1 s) waiting — older ones are dropped.
## - **Mute** ([method toggle_mute], B / Y or M): the mic's chunks are
##   dropped. On Android the RECORD_AUDIO grant is asked at the first start
##   and the mic re-opened once it is given.
##
## [method want] starts it (a session is playing) and [method stop] ends
## everything (the lobby). Tests inject [member frame_source],
## [member client_factory], [member playback_of] and [member clock], and
## feed [method on_frame] with [member use_stream] off.
class_name VoiceLink
extends Node

## "off" (not running, or the mic is off in the config) · "asking" (the
## Android grant is up) · "live" · "muted" · "nomic" (no device, refused,
## or no frames from either route).
signal mic_changed(state: String)
## Whether someone can hear this headset (`listen {on}`).
signal listen_changed(on: bool)

## No frames for this long (s) from the AudioServer route → the fallback route.
const MIC_FALLBACK_AFTER := 2.0
## Chunks waiting for the uplink at most (≈ 1 s); older ones are dropped.
const UPLINK_QUEUE := 5
## Chunks per POST at most (≤ [constant VoiceCodec.VOICE_MAX_BYTES]).
const UPLINK_BATCH := 2
## The playback target and the skip-ahead limit (ms).
const JITTER_TARGET_MS := 200.0
const JITTER_MAX_MS := 400.0
## The generator's buffer (s): the 400 ms limit plus a whole chunk must fit.
const BUFFER_LENGTH := 1.0
## Fades (ms): a stream's start or a skip's cut, and a `bye`.
const FADE_IN_MS := 10
const FADE_OUT_MS := 60
const MIC_BUS := "VoiceMic"

## The mic may be used (config `mic`); off = listen only.
var mic_enabled := true
var muted := false
## Someone can hear this headset.
var listen_on := false
var mic_state := "off"
## The [HouseBuilder] the voices hang in.
var builder: HouseBuilder
## Tests: `frame_source.call() -> PackedVector2Array` in place of the mic,
## at [member source_rate] Hz.
var frame_source: Callable
var source_rate := 48000.0
## Tests: `client_factory.call()` → an [HTTPClient]-like object for the uplink.
var client_factory: Callable
## Tests: `playback_of.call(emitter) -> Object` (push_buffer,
## get_frames_available, clear_buffer) in place of the generator's playback.
var playback_of: Callable
## Milliseconds now; tests inject a fake.
var clock: Callable = func() -> float: return float(Time.get_ticks_msec())
## Off in tests: [method on_frame] is fed by hand, no socket opened.
var use_stream := true

var stream: SseClient
var uplink := Uplink.new()
## The stream / upload URLs and token in use ("" = not running).
var stream_url := ""
var upload_url := ""
var _token := ""
## The uplink refused us (401 / 403 / 410): no more uploads this run.
var _refused := false
## from → `{spot, emitter, playback, capacity, tail, seq}`.
var _sources := {}
var _gate := VoiceCodec.Gate.new()
var _chunks := VoiceCodec.ChunkAssembler.new()
var _resampler: VoiceCodec.Resampler = null
## "" (no mic) · "test" · "server" (AudioServer) · "capture" (the fallback).
var _route := ""
var _rate := 0.0
var _quiet_for := 0.0
var _capture: AudioEffectCapture = null
var _mic_player: AudioStreamPlayer = null
var _asked_permission := false


func _ready() -> void:
	stream = SseClient.new()
	stream.name = "Stream"
	add_child(stream)
	stream.frame.connect(on_frame)
	uplink.answered.connect(_on_uplink)


## Run with these URLs (from the link; "" = no voice: offline, no session).
## The same URLs again change nothing; new ones restart it.
func want(stream_at: String, upload_at: String, token: String) -> void:
	if stream_at == "" or upload_at == "" or token == "":
		if is_running():
			stop()
		return
	if stream_at == stream_url and upload_at == upload_url and token == _token:
		return
	stop()
	stream_url = stream_at
	upload_url = upload_at
	_token = token
	_refused = false
	if builder != null and not builder.built.is_connected(_on_built):
		builder.built.connect(_on_built)
	uplink.client_factory = client_factory
	uplink.configure(upload_at, token)
	if use_stream:
		var u := StationConfig.parse_url(stream_at)
		if not u.is_empty():
			stream.open(("https://" if u["tls"] else "http://") + "%s:%d" % [u["host"], u["port"]], str(u["path"]))
	_start_mic()


func is_running() -> bool:
	return stream_url != ""


## Everything off: the stream, the uplink, the mic, every voice.
func stop() -> void:
	if stream != null:
		stream.close()
	uplink.close()
	_stop_mic()
	for from: String in _sources.keys():
		_drop_source(from)
	if is_instance_valid(builder):
		builder.clear_voices()
	stream_url = ""
	upload_url = ""
	_token = ""
	_gate.reset()
	_chunks.reset()
	_resampler = null
	muted = false  # the next session (the next wearer, maybe) starts live
	_set_listen(false)
	_set_mic("off")


## Mute or unmute the mic (B / Y, M); nothing while the mic is off.
func toggle_mute() -> void:
	if not mic_enabled:
		return
	muted = not muted
	if muted:
		_gate.reset()
		_chunks.reset()
		uplink.drop_queue()
	if _route != "":
		_set_mic("muted" if muted else "live")


## The HUD's mic line ("" while off): 🎤 LIVE (· someone can hear you) /
## 🎤 MUTED / NO MIC; `xr` names the mute button.
func hud_text(xr: bool) -> String:
	var key := "B / Y" if xr else "M"
	match mic_state:
		"live":
			return "🎤 LIVE · someone can hear you" if listen_on else "🎤 LIVE"
		"muted":
			return "🎤 MUTED · %s to talk" % key
		"asking":
			return "NO MIC · allow the microphone"
		"nomic":
			return "NO MIC"
	return ""


## Sources playing now (`from` ids), for the tests.
func sources() -> Array:
	return _sources.keys()


# --- down: the stream ------------------------------------------------------------


func on_frame(event: String, data: Variant) -> void:
	var d: Dictionary = data if data is Dictionary else {}
	match event:
		"hello":
			if str(d.get("codec", VoiceCodec.VOICE_CODEC)) != VoiceCodec.VOICE_CODEC or int(d.get("rate", VoiceCodec.VOICE_RATE)) != VoiceCodec.VOICE_RATE:
				push_warning("voice: the server speaks %s at %s Hz — not played" % [d.get("codec"), d.get("rate")])
			_set_listen(d.get("listen") == true)
		"listen":
			_set_listen(d.get("on") == true)
		"voice":
			_on_voice(d)
		"bye":
			_bye(str(d.get("from", "")))


func _on_voice(d: Dictionary) -> void:
	var spot := str(d.get("spot", ""))
	if str(d.get("kind", "terminal")) != "terminal" or spot == "" or builder == null:
		return  # a game hears only terminals
	if not builder.house.is_empty() and not VoiceCodec.voice_on(builder.house, spot):
		return  # D7: the tent's terminal is never heard here
	var bytes := Marshalls.base64_to_raw(str(d.get("data", "")))
	if bytes.is_empty():
		return
	var from := str(d.get("from", "t:" + spot))
	var src: Dictionary = _sources.get(from, {})
	if src.is_empty():
		src = _attach(from, spot)
		if src.is_empty():
			return
	var seq := int(d.get("seq", -1))
	if seq >= 0 and seq <= int(src["seq"]):
		return
	src["seq"] = seq
	(src["emitter"] as AudioStreamPlayer3D).volume_db = linear_to_db(maxf(clampf(float(d.get("gain", 1.0)), 0.0, 1.0), 0.0001))
	var playing_ms := _play(src, VoiceCodec.mulaw_decode(bytes))
	# Half-duplex: nothing goes up while this plays (and a tail after).
	_gate.hold_until(float(clock.call()) + playing_ms + VoiceCodec.VOICE_TAIL_MS)


## Queue `samples` (16 kHz) on `src` by the jitter plan; returns the ms queued after.
func _play(src: Dictionary, samples: PackedFloat32Array) -> float:
	var pb: Object = src["playback"]
	var cap: int = src["capacity"]
	var queued: int = maxi(0, cap - int(pb.get_frames_available()))
	var plan := VoiceCodec.jitter_plan(queued / 16.0, JITTER_TARGET_MS, JITTER_MAX_MS)
	var tail: PackedVector2Array = src["tail"]
	var out := PackedVector2Array()
	match plan["action"]:
		"start":
			pb.clear_buffer()
			tail = PackedVector2Array()
			out.resize(int(float(plan["at"]) * 16.0))  # zeros: the target's silence
			out.append_array(_frames(samples, true))
		"skip":
			# Keep the newest `at` ms of what is queued (the oldest is dropped),
			# fade the cut in, then this chunk.
			var keep := mini(int(float(plan["at"]) * 16.0), queued)
			keep = mini(keep, tail.size())
			pb.clear_buffer()
			out = _fade(tail.slice(tail.size() - keep), true, FADE_IN_MS * 16)
			out.append_array(_frames(samples, false))
		_:
			out = _frames(samples, false)
	var room := int(pb.get_frames_available())
	if out.size() > room:
		out = out.slice(0, room)
	if not out.is_empty():
		pb.push_buffer(out)
	tail.append_array(out)
	if tail.size() > cap:
		tail = tail.slice(tail.size() - cap)
	src["tail"] = tail
	return maxi(0, cap - int(pb.get_frames_available())) / 16.0


## Mono samples → stereo frames, faded in over [constant FADE_IN_MS] when asked.
static func _frames(samples: PackedFloat32Array, fade_in: bool) -> PackedVector2Array:
	var out := PackedVector2Array()
	out.resize(samples.size())
	for i in samples.size():
		out[i] = Vector2(samples[i], samples[i])
	return _fade(out, true, FADE_IN_MS * 16) if fade_in else out


## `frames` with a linear ramp up over the first `n` (in), or down to 0 over all of them (out).
static func _fade(frames: PackedVector2Array, fade_in: bool, n: int) -> PackedVector2Array:
	var out := frames.duplicate()
	var m := mini(n, out.size()) if fade_in else out.size()
	for i in m:
		var k := float(i) / float(m) if fade_in else 1.0 - float(i + 1) / float(m)
		out[i] = out[i] * k
	return out


## A source this stream heard is gone: fade what is queued over
## [constant FADE_OUT_MS] and forget it.
func _bye(from: String) -> void:
	var src: Dictionary = _sources.get(from, {})
	if src.is_empty():
		return
	var pb: Object = src["playback"]
	var tail: PackedVector2Array = src["tail"]
	var queued := mini(maxi(0, int(src["capacity"]) - int(pb.get_frames_available())), tail.size())
	var head := tail.slice(tail.size() - queued, tail.size() - queued + mini(queued, FADE_OUT_MS * 16))
	pb.clear_buffer()
	if not head.is_empty():
		pb.push_buffer(_fade(head, false, head.size()))
	_sources.erase(from)


## A new source: the emitter under its terminal, playing.
func _attach(from: String, spot: String) -> Dictionary:
	var emitter := builder.voice_emitter(spot)
	if emitter == null:
		return {}
	if not emitter.playing:
		emitter.play()
	var pb: Object = playback_of.call(emitter) if playback_of.is_valid() else emitter.get_stream_playback()
	if pb == null:
		return {}
	# Measured once, empty (a reused emitter may still be fading a `bye` out).
	if not emitter.has_meta("capacity"):
		emitter.set_meta("capacity", int(pb.get_frames_available()))
	var src := {"spot": spot, "emitter": emitter, "playback": pb, "capacity": int(emitter.get_meta("capacity")), "tail": PackedVector2Array(), "seq": -1}
	_sources[from] = src
	return src


func _drop_source(from: String) -> void:
	var src: Dictionary = _sources.get(from, {})
	_sources.erase(from)
	if not src.is_empty() and is_instance_valid(builder):
		builder.clear_voice(str(src["spot"]))


## The house was rebuilt (a map edit): the emitters are new — every source
## starts again on its terminal's new one (or ends, its terminal gone).
func _on_built() -> void:
	for from: String in _sources.keys():
		var spot := str(_sources[from]["spot"])
		var seq: int = _sources[from]["seq"]
		_sources.erase(from)
		var src := _attach(from, spot) if builder.has_terminal(spot) else {}
		if src.is_empty():
			builder.clear_voice(spot)
		else:
			src["seq"] = seq


func _set_listen(on: bool) -> void:
	if on == listen_on:
		return
	listen_on = on
	uplink.wanted = on and not muted and _route != ""
	if not on:
		uplink.drop_queue()
	listen_changed.emit(on)


# --- up: the mic ------------------------------------------------------------------


func _process(delta: float) -> void:
	if not is_running():
		return
	uplink.wanted = listen_on and not muted and _route != "" and not _refused
	uplink.poll(delta)
	if _route == "":
		return
	var frames := _read_frames()
	if frames.is_empty():
		_quiet_for += delta
		if _route == "server" and _quiet_for > MIC_FALLBACK_AFTER:
			_fallback()
		elif _route == "capture" and _quiet_for > MIC_FALLBACK_AFTER and mic_state != "nomic":
			_set_mic("nomic")
		return
	_quiet_for = 0.0
	_set_mic("muted" if muted else "live")  # frames: a mic (the fallback's too)
	if muted:
		return
	feed(frames, _rate)


## Captured frames at `rate` Hz → 16 kHz chunks → the gate → the uplink
## (only while someone listens). Public for the tests.
func feed(frames: PackedVector2Array, rate: float) -> void:
	if _resampler == null or _resampler.from != roundi(rate):
		_resampler = VoiceCodec.Resampler.new(rate, VoiceCodec.VOICE_RATE)
	var mono := PackedFloat32Array()
	mono.resize(frames.size())
	for i in frames.size():
		mono[i] = frames[i].x  # Android writes each sample to both channels
	var now := float(clock.call())
	for chunk: PackedFloat32Array in _chunks.push(_resampler.push(mono)):
		for bytes: PackedByteArray in _gate.push(VoiceCodec.mulaw_encode(chunk), VoiceCodec.rms_dbfs(chunk), now):
			if listen_on and not _refused:
				uplink.send(bytes)


func _read_frames() -> PackedVector2Array:
	match _route:
		"test":
			return frame_source.call()
		"server":
			var n := AudioServer.get_input_frames_available()
			return AudioServer.get_input_frames(n) if n > 0 else PackedVector2Array()
		"capture":
			if _capture == null:
				return PackedVector2Array()
			var n := _capture.get_frames_available()
			return _capture.get_buffer(n) if n > 0 else PackedVector2Array()
	return PackedVector2Array()


func _start_mic() -> void:
	_quiet_for = 0.0
	if not mic_enabled:
		_set_mic("off")
		return
	if frame_source.is_valid():
		_route = "test"
		_rate = source_rate
		_set_mic("muted" if muted else "live")
		return
	if OS.get_name() == "Android" and not _granted():
		_set_mic("asking")
		if not _asked_permission:
			_asked_permission = true
			get_tree().on_request_permissions_result.connect(_on_permission)
		OS.request_permission("RECORD_AUDIO")
		return
	if AudioServer.set_input_device_active(true) != OK:
		_fallback()
		return
	_route = "server"
	_rate = AudioServer.get_input_mix_rate()
	_set_mic("muted" if muted else "live")


static func _granted() -> bool:
	for p: String in OS.get_granted_permissions():
		if p.ends_with("RECORD_AUDIO"):
			return true
	return false


func _on_permission(permission: String, granted: bool) -> void:
	if not permission.ends_with("RECORD_AUDIO") or mic_state != "asking":
		return
	if granted and is_running():
		_start_mic()
	else:
		_set_mic("nomic")


## The AudioServer route gave nothing: an [AudioStreamMicrophone] on a
## muted bus, read through an [AudioEffectCapture] at the mix rate.
func _fallback() -> void:
	AudioServer.set_input_device_active(false)
	var bus := AudioServer.get_bus_index(MIC_BUS)
	if bus < 0:
		bus = AudioServer.bus_count
		AudioServer.add_bus(bus)
		AudioServer.set_bus_name(bus, MIC_BUS)
		AudioServer.set_bus_mute(bus, true)  # effects run before the mute: the capture still hears it
		var cap := AudioEffectCapture.new()
		cap.buffer_length = 0.5
		AudioServer.add_bus_effect(bus, cap)
	_capture = AudioServer.get_bus_effect(bus, 0) as AudioEffectCapture
	if _capture != null:
		_capture.clear_buffer()
	if _mic_player == null:
		_mic_player = AudioStreamPlayer.new()
		_mic_player.name = "Mic"
		_mic_player.stream = AudioStreamMicrophone.new()
		_mic_player.bus = MIC_BUS
		add_child(_mic_player)
	_mic_player.play()
	_route = "capture"
	_rate = AudioServer.get_mix_rate()
	_quiet_for = 0.0
	push_warning("voice: no frames from AudioServer.get_input_frames — trying an AudioStreamMicrophone")


func _stop_mic() -> void:
	match _route:
		"server":
			AudioServer.set_input_device_active(false)
		"capture":
			if _mic_player != null:
				_mic_player.stop()
	_route = ""
	_quiet_for = 0.0


func _set_mic(state: String) -> void:
	if state == mic_state:
		return
	mic_state = state
	mic_changed.emit(state)


func _on_uplink(status: int, data: Dictionary) -> void:
	match status:
		200:
			if data.get("listening") is bool:
				_set_listen(data["listening"])
		401, 403, 410:
			# The session is gone (the game hears it from the link) or voice
			# is off for us: stop uploading until the next start.
			_refused = true
			uplink.drop_queue()
			if status == 403:
				push_warning("voice: the server refuses this headset's voice (%s)" % data.get("error", ""))


# --- the uplink ---------------------------------------------------------------------


## One persistent keep-alive [HTTPClient] for the voice POSTs (`?seq=n`,
## `x-loom-token`, `application/octet-stream`): polled, never blocking, one
## request in flight, up to [constant UPLINK_BATCH] chunks per POST, at most
## [constant UPLINK_QUEUE] chunks waiting (the oldest dropped). A lost
## connection reconnects (backing off 0.5 s → 5 s); one idle longer than
## [constant IDLE_REOPEN] s (Node's keep-alive is 5 s) is closed and, while
## someone listens, reopened at once, so a word never lands on a dead socket.
class Uplink:
	extends RefCounted

	## A POST's answer: `status` (0 = lost) and its JSON body.
	signal answered(status: int, data: Dictionary)

	const CONNECT_TIMEOUT := 10.0
	const REQUEST_TIMEOUT := 5.0
	const IDLE_REOPEN := 4.0
	const BACKOFF_MIN := 0.5
	const BACKOFF_MAX := 5.0

	## Tests: an [HTTPClient]-like factory.
	var client_factory: Callable
	## Keep a connection up although nothing waits (someone is listening).
	var wanted := false
	## Chunks waiting, oldest first.
	var queue: Array[PackedByteArray] = []
	## The next POST's `seq` (never reset: a source's seq only increases).
	var seq := 0
	var dropped := 0
	var posted := 0
	var _url := {}
	var _token := ""
	var _client: Variant = null
	var _in_flight := false
	var _body := PackedByteArray()
	var _wait := 0.0
	var _idle := 0.0
	var _retry_in := 0.0
	var _backoff := BACKOFF_MIN

	func configure(url: String, token: String) -> void:
		close()
		_url = StationConfig.parse_url(url)
		_token = token

	func in_flight() -> bool:
		return _in_flight

	func connected() -> bool:
		return _client != null

	func send(chunk: PackedByteArray) -> void:
		queue.append(chunk)
		while queue.size() > VoiceLink.UPLINK_QUEUE:
			queue.pop_front()
			dropped += 1

	func drop_queue() -> void:
		dropped += queue.size()
		queue.clear()

	func close() -> void:
		if _client != null:
			_client.close()
		_client = null
		_in_flight = false
		queue.clear()
		_retry_in = 0.0
		_backoff = BACKOFF_MIN

	func poll(delta: float) -> void:
		if _url.is_empty():
			return
		if _client == null:
			if queue.is_empty() and not wanted:
				return
			_retry_in -= delta
			if _retry_in > 0.0:
				return
			_client = client_factory.call() if client_factory.is_valid() else HTTPClient.new()
			var tls: TLSOptions = TLSOptions.client() if _url["tls"] else null
			if _client.connect_to_host(str(_url["host"]), int(_url["port"]), tls) != OK:
				_fail()
				return
			_wait = 0.0
			_idle = 0.0
		_client.poll()
		match int(_client.get_status()):
			HTTPClient.STATUS_RESOLVING, HTTPClient.STATUS_CONNECTING:
				_wait += delta
				if _wait > CONNECT_TIMEOUT:
					_fail()
			HTTPClient.STATUS_CONNECTED:
				if _in_flight:
					_done(int(_client.get_response_code()))
				_backoff = BACKOFF_MIN
				_idle += delta
				if _idle > IDLE_REOPEN:
					# The server may close it any moment now: a fresh one (in the
					# silence, while someone listens — not at a word's onset).
					_drop_client()
					return
				if not queue.is_empty():
					_post()
			HTTPClient.STATUS_REQUESTING:
				_wait += delta
				if _wait > REQUEST_TIMEOUT:
					_fail()
			HTTPClient.STATUS_BODY:
				var chunk: PackedByteArray = _client.read_response_body_chunk()
				if _body.size() < 4096:
					_body.append_array(chunk)
				_wait += delta
				if _wait > REQUEST_TIMEOUT:
					_fail()
			HTTPClient.STATUS_DISCONNECTED:
				if _in_flight:
					_fail()
				else:
					_drop_client()  # an idle keep-alive closed by the server
			_:
				_fail()

	func _post() -> void:
		var body := PackedByteArray()
		var n := 0
		while not queue.is_empty() and n < VoiceLink.UPLINK_BATCH and body.size() + queue[0].size() <= VoiceCodec.VOICE_MAX_BYTES:
			body.append_array(queue.pop_front())
			n += 1
		if body.is_empty():
			queue.pop_front()  # a chunk over the cap: never sendable
			return
		var headers := PackedStringArray(["Content-Type: application/octet-stream", "x-loom-token: %s" % _token])
		if _client.request_raw(HTTPClient.METHOD_POST, "%s?seq=%d" % [_url["path"], seq], headers, body) != OK:
			_fail()
			return
		seq += 1
		posted += 1
		_in_flight = true
		_body = PackedByteArray()
		_wait = 0.0

	func _done(code: int) -> void:
		_in_flight = false
		_idle = 0.0
		var json := JSON.new()  # not JSON.parse_string: a junk body logs nothing
		var data: Variant = json.data if _body.size() > 0 and json.parse(_body.get_string_from_utf8()) == OK else {}
		answered.emit(code, data if data is Dictionary else {})

	func _drop_client() -> void:
		if _client != null:
			_client.close()
		_client = null
		_in_flight = false

	func _fail() -> void:
		var lost := _in_flight
		_drop_client()
		_retry_in = _backoff
		_backoff = minf(_backoff * 2.0, BACKOFF_MAX)
		if lost:
			answered.emit(0, {})
