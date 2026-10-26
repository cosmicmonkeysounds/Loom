## The `ServerLink` autoload — this headset's line to the event server
## (`docs/loom-reinstall.md` §2 + §5).
##
## A headset is a *trusted device*: its moderator passcode resolves to the
## event (`POST /api/resolve-code`) and is traded for a mod token
## (`POST /e/:id/api/mod/login`). With it the station polls for work every
## second (`GET …/api/mod/spatial/station`), lists candidates, and starts
## programs itself (`begin`). The [code]Assignment[/code]'s session token
## then carries the high-rate calls: poses (latest-only, 10 Hz, one in
## flight — [PosePump]), `found` and `end`. The spatial stream (SSE) feeds
## the ghosts and tells us about map edits and restarts.
##
## The bundled `res://house/house.json` is loaded first, so the game always
## has a house; the server's map replaces it once fetched. The link never
## plays the wrong map silently: while the map up is not the version the
## server last named (the assignment's `houseVersion`, a `house` / `hello`
## frame) — or not the one the session's duck was dealt on — it refetches
## every [constant HOUSE_RETRY] s and says so ([signal LinkBase.map_warning]).
## During a session the map is fetched with the session token, so the
## answer carries the session's (possibly moved) duck; a `duck {session,
## duck}` stream frame moves it too ([signal LinkBase.duck_changed]).
## The shared King (one health bar for every guest, held by the server):
## the `hello` frame's `king`, `king` frames and the session's map fetch set
## [member LinkBase.king]; [method hit_king] posts `POST
## /api/spatial/king/hit` with the session token right after flushing the
## newest pose (the server judges the reach off it), as `found` does.
##
## `--offline` plays without a server at all (the duck is picked locally,
## the King's bar is kept here).
##
## **In-headset setup** (wave 19): a station with no passcode shows the
## lobby's SET UP panel. [method try_setup] dials the chosen server with the
## typed passcode (resolve-code must say `mod`, then the moderator login);
## a working one is saved to [member user_path] and the link carries on as
## if it had booted with it — no restart. PLAY OFFLINE ([method
## play_offline]) is for this run only; ⚙ [method forget_setup] deletes the
## file and asks again.
extends LinkBase

const BUNDLED_HOUSE := "res://house/house.json"
const POLL_INTERVAL := 1.0
const CANDIDATE_INTERVAL := 5.0
const RECONNECT_DELAY := 3.0
## Station polls with no answer at all before the lobby says the server is lost.
const DEAD_POLLS := 5
## While the map up is stale, refetch this often (s).
const HOUSE_RETRY := 2.0

var transport: HttpTransport
var pump := PosePump.new()
var stream: SseClient

## "idle" (unconfigured / offline) · "connecting" · "ready" · "waiting" (retry).
var phase := "idle"
var event_id := ""
var title := ""
var _mod_token := ""
var _retry_in := 0.0
var _poll_in := 0.0
var _poll_in_flight := false
## Station polls in a row that got no answer (status 0).
var _dead_polls := 0
## Sessions we adopted or ended — a station poll never re-offers them.
var _seen_sessions := {}
var _offline_count := 0
## The map version the server last named ("" = none yet).
var _want_version := ""
## The map version the adopted session's duck was dealt on ("" = no session).
var _duck_version := ""
var _house_in_flight := false
## A fetch was asked for while one was in flight: send another when it lands.
var _house_again := false
var _house_retry_in := 0.0
## Claims (`found` / `king`) asked for while another was out, oldest first.
var _claims_waiting: Array[String] = []
## Offline: the sessions that already hit the King.
var _offline_hits := {}

## The SET UP panel's answers.
const SETUP_NOT_MOD := "That isn't a moderator passcode."
const SETUP_UNREACHABLE := "Can't reach the server."
const SETUP_EMPTY := "Type the moderator passcode."
const NOT_CONFIGURED := "Not configured — set this headset up."
## Where a working setup is saved (tests point it elsewhere).
var user_path := StationConfig.USER_PATH
## The sources under the user file, for [method forget_setup]: the files
## and the command line it was loaded with.
var base_files: Array = [StationConfig.RES_PATH]
var base_args := PackedStringArray()
## Mixed into the station id a setup mints ([method StationConfig.station_id_for]).
var station_salt := randi()
## Bumped by [method configure]: a connect step answered for an older
## configuration is dropped.
var _epoch := 0
## The setup being tried (`{server, code, name, station}`; `{}` = none),
## and the configuration to go back to when it fails.
var _setup_trial := {}
var _setup_before := {}
## PLAY OFFLINE was chosen in the headset (⚙ goes back to SET UP).
var _offline_chosen := false
## The saved / baked passcode stopped working (the codes were rotated, the
## event is gone): why, and the lobby shows SET UP again ("" = it works).
var dead_code := ""


func _ready() -> void:
	config = StationConfig.load_station()
	base_args = OS.get_cmdline_user_args()
	transport = HttpTransport.new()
	transport.name = "Transport"
	add_child(transport)
	stream = SseClient.new()
	stream.name = "Stream"
	add_child(stream)
	stream.frame.connect(_on_frame)
	_load_bundled_house.call_deferred()
	if config["offline"]:
		_set_status.call_deferred("Offline — no server; the duck is picked here.")
	elif not StationConfig.is_configured(config):
		_set_status.call_deferred(NOT_CONFIGURED)
	else:
		transport.base = str(StationConfig.parse_url(str(config["server"]))["base"])
		_connect()


func _load_bundled_house() -> void:
	if not house.is_empty():
		return
	if FileAccess.file_exists(BUNDLED_HOUSE):
		_load_house_text(FileAccess.get_file_as_string(BUNDLED_HOUSE), "bundled")
	if is_offline():
		seed_offline_king()


## Offline: the map's King at full health, kept here (no server to share it).
func seed_offline_king() -> void:
	var prop := HouseKing.king_prop(house)
	if prop.is_empty() or not king.is_empty():
		return
	var hp := HouseKing.king_max(prop)
	_adopt_king({"id": str(prop["id"]), "hp": hp, "max": hp, "fallen": false})


func is_offline() -> bool:
	return bool(config["offline"])


func _base() -> String:
	return "/e/%s" % event_id.uri_encode()


# --- connect ----------------------------------------------------------------


func _connect() -> void:
	phase = "connecting"
	_set_status("Connecting to %s…" % config["server"])
	var epoch := _epoch
	transport.send("POST", "/api/resolve-code", {"code": config["code"]}, "",
		func(c: int, d: Variant) -> void: if epoch == _epoch: _on_resolved(c, d))


func _on_resolved(status_code: int, data: Variant) -> void:
	if status_code == 404:
		_fail_or_wait("No event on %s answers to that passcode." % _server_text(), "No event answers to that passcode.", true)
		return
	if status_code != 200 or not data is Dictionary:
		_fail_or_wait(SETUP_UNREACHABLE, "Couldn't reach the event server (%s)." % _code_text(status_code))
		return
	if str(data.get("role", "")) != "mod":
		_fail_or_wait(SETUP_NOT_MOD, "That passcode isn't the moderator's — a headset needs the moderator passcode.", true)
		return
	event_id = str(data["eventId"])
	title = str(data.get("title", ""))
	var epoch := _epoch
	transport.send("POST", _base() + "/api/mod/login", {"passcode": config["code"]}, "",
		func(c: int, d: Variant) -> void: if epoch == _epoch: _on_login(c, d))


func _on_login(status_code: int, data: Variant) -> void:
	if status_code != 200 or not data is Dictionary or str(data.get("token", "")) == "":
		var refused := status_code == 401 or status_code == 403
		_fail_or_wait(SETUP_NOT_MOD if refused else SETUP_UNREACHABLE,
			"Moderator login failed (%s)." % _code_text(status_code), refused)
		return
	_mod_token = str(data["token"])
	dead_code = ""
	if not _setup_trial.is_empty():
		_setup_worked()
	phase = "ready"
	_set_status("Connected%s." % (" to %s" % title if title != "" else ""))
	fetch_house()
	stream.open(transport.base, _base() + "/api/spatial/stream?token=%s&name=%s" % [
		_mod_token.uri_encode(), station_name().uri_encode()])
	request_candidates()
	if str(config["guest"]) != "":
		begin(str(config["guest"]))


## A connect step failed: a setup being tried answers the panel and goes
## back to SET UP; a configured station waits and retries — unless the
## passcode itself is refused (`dead`: a 404, not a moderator's, a login
## refused), which no retry fixes: the lobby shows SET UP again, prefilled.
func _fail_or_wait(setup_message: String, message: String, dead := false) -> void:
	if _setup_trial.is_empty():
		if dead:
			dead_code = message
			phase = "idle"
			_set_status("%s Set this headset up again." % message)
			return
		_wait(message)
		return
	var before := _setup_before
	_setup_trial = {}
	_setup_before = {}
	configure(before)
	_set_status(NOT_CONFIGURED)
	setup_answered.emit(false, setup_message)


func _setup_worked() -> void:
	dead_code = ""
	StationConfig.save_user(_setup_trial, user_path)
	_setup_trial = {}
	_setup_before = {}
	_offline_chosen = false
	setup_answered.emit(true, "")


func _wait(message: String) -> void:
	phase = "waiting"
	_retry_in = RECONNECT_DELAY
	_set_status(message + " Retrying…")


static func _code_text(status_code: int) -> String:
	return "no answer" if status_code == 0 else "HTTP %d" % status_code


# --- the loop ---------------------------------------------------------------


func _process(delta: float) -> void:
	if phase == "waiting":
		_retry_in -= delta
		if _retry_in <= 0.0:
			_connect()
		return
	if phase != "ready":
		return
	if map_is_stale() and not _house_in_flight:
		_house_retry_in -= delta
		if _house_retry_in <= 0.0:
			fetch_house()
	_poll_in -= delta
	if _poll_in <= 0.0 and not _poll_in_flight:
		_poll_in = POLL_INTERVAL
		_poll_station()
	# The pump runs the 10 Hz poses and the claim schedule (flush the newest
	# pose, claim once it has landed, no poses until the answer).
	if not pump.is_claiming() and not _claims_waiting.is_empty():
		pump.want_claim(_claims_waiting.pop_front())
	var kind := pump.claim_kind()
	var s := pump.step(delta)
	if s["pose"] != null:
		_send_pose(s["pose"])
	if s["claim"]:
		if kind == "king":
			_send_king_hit()
		else:
			_send_found()


## Claim `kind` once the pump is free (one claim out at a time).
func _want_claim(kind: String) -> void:
	if pump.claim_kind() == kind or _claims_waiting.has(kind):
		return
	if not pump.want_claim(kind):
		_claims_waiting.append(kind)


## The session ended: forget its claims.
func _clear_pump() -> void:
	pump.clear()
	_claims_waiting.clear()


func _poll_station() -> void:
	_poll_in_flight = true
	var q := "?id=%s&name=%s&world=vr" % [str(config["station"]).uri_encode(), station_name().uri_encode()]
	transport.send("GET", _base() + "/api/mod/spatial/station" + q, null, _mod_token, _on_station)


## The station poll is the liveness heartbeat: inside a live event this
## route always matches, so a 404 can only mean the event is gone (ended,
## or the server lost it), and 401 / 403 that our moderator token is dead.
## Either way: back to `resolve-code`. (Other calls' 404 / 409 mean "unknown
## guest" / "no scenario" — they never re-link.)
func _on_station(status_code: int, data: Variant) -> void:
	_poll_in_flight = false
	if status_code == 404:
		_relink("The event ended.", true)
		return
	if status_code == 401 or status_code == 403:
		_relink("The moderator login lapsed.", false)
		return
	if status_code == 0:
		_dead_polls += 1
		if _dead_polls == DEAD_POLLS:
			_set_status("Lost the server — retrying…")
		return
	if _dead_polls >= DEAD_POLLS:
		_set_status("Connected%s." % (" to %s" % title if title != "" else ""))
	_dead_polls = 0
	if status_code != 200 or not data is Dictionary:
		return
	var a: Variant = data.get("assignment")
	if a is Dictionary and not _seen_sessions.has(str(a.get("session", ""))):
		assignment_received.emit(a)


## Drop the event link and start over from `resolve-code` (after
## [constant RECONNECT_DELAY]). `event_gone`: the session died with the
## event, so the game goes back to the lobby; a lapsed moderator token
## alone leaves a session playing (its own token still works, and poses
## resume once re-linked — a 410 ends it if the passcode now names another
## event).
func _relink(message: String, event_gone: bool) -> void:
	stream.close()
	transport.clear_queue()
	if event_gone:
		_lose_session("event ended")
	_poll_in_flight = false
	_mod_token = ""
	event_id = ""
	_dead_polls = 0
	_wait(message)


# --- in-headset setup ---------------------------------------------------------


## True while a setup is being tried, too: the panel stays up ("Connecting…").
func needs_setup() -> bool:
	return not is_offline() and (not StationConfig.is_configured(config) or not _setup_trial.is_empty() or dead_code != "")


func linked() -> bool:
	return is_offline() or phase == "ready"


## A configured station's own name, else "Headset <4 hex>" — the
## same hex as the station id a setup mints, so two headsets set up with
## the default never read alike on the tent tablet's Send-to list.
func default_station_name() -> String:
	var n := str(config.get("name", "")).strip_edges()
	# A configured station keeps its name; the committed placeholder's is
	# every fresh headset's, so it is no name.
	if n != "" and n != StationConfig.DEFAULT_NAME and (StationConfig.is_configured(config) or dead_code != ""):
		return n
	return "%s %04X" % [StationConfig.DEFAULT_NAME, station_salt & 0xffff]


func server_choices() -> Array:
	var committed := str(StationConfig.read_file(StationConfig.RES_PATH).get("server", ""))
	var current := str(config.get("server", ""))
	# An editor run that names no server of its own tests against `pnpm dev`.
	var prefer_local := OS.has_feature("editor_runtime") and (current == "" or current == committed)
	return StationConfig.server_choices(current, committed, StationConfig.offers_local(), prefer_local)


func _server_text() -> String:
	return str(StationConfig.parse_url(str(config.get("server", ""))).get("base", config.get("server", ""))).trim_prefix("https://").trim_prefix("http://")


func try_setup(server: String, code: String, name: String) -> void:
	if not _setup_trial.is_empty():
		return  # one at a time
	var u := StationConfig.parse_url(server)
	var c := code.strip_edges().to_upper()
	if c == "":
		setup_answered.emit(false, SETUP_EMPTY)
		return
	if u.is_empty():
		setup_answered.emit(false, SETUP_UNREACHABLE)
		return
	var n := name.strip_edges()
	if n == "":
		n = StationConfig.DEFAULT_NAME
	var before := config.duplicate()
	var trial := {"server": str(u["base"]), "code": c, "name": n, "station": StationConfig.station_id_for(n, station_salt)}
	var cfg := StationConfig.merge(config, trial)
	cfg["offline"] = false
	configure(cfg)
	_setup_before = before
	_setup_trial = trial
	_connect()


func play_offline() -> void:
	dead_code = ""
	var cfg := config.duplicate()
	cfg["offline"] = true
	configure(cfg)
	_offline_chosen = true
	_set_status("Offline — no server; the duck is picked here.")
	seed_offline_king()


func can_forget_setup() -> bool:
	return _offline_chosen or FileAccess.file_exists(user_path)


func forget_setup() -> void:
	dead_code = ""
	StationConfig.forget_user(user_path)
	_offline_chosen = false
	var cfg := StationConfig.resolve(base_files, base_args)
	cfg["offline"] = false
	configure(cfg)
	reconnect()


## Drop the event link (stream, queue, token, session) and take `cfg`;
## [method reconnect] dials it.
func configure(cfg: Dictionary) -> void:
	_epoch += 1
	if stream != null:
		stream.close()
	if transport != null:
		transport.clear_queue()
	_lose_session("reconfigured")
	phase = "idle"
	_mod_token = ""
	event_id = ""
	title = ""
	_poll_in_flight = false
	_dead_polls = 0
	_setup_trial = {}
	_setup_before = {}
	config = cfg
	var u := StationConfig.parse_url(str(cfg.get("server", "")))
	if not u.is_empty() and transport != null:
		transport.base = str(u["base"])


func reconnect() -> void:
	if is_offline():
		phase = "idle"
		_set_status("Offline — no server; the duck is picked here.")
		seed_offline_king()
	elif not StationConfig.is_configured(config):
		phase = "idle"
		_set_status(NOT_CONFIGURED)
	else:
		_connect()


# --- calls ------------------------------------------------------------------


## `/api/mod/spatial/begin`'s 409 for a program neither captured nor marked.
const NOT_MARKED_ERROR := "not marked for reinstallation"
## What the lobby says instead (the tablet's words).
const NOT_MARKED := "Not marked for reinstallation."  # DRAFT w26 (G2, C12)


func begin(guest: String) -> void:
	if is_offline():
		_begin_offline(guest)
		return
	if phase != "ready":
		begin_failed.emit("Not connected yet.")
		return
	var body := {"guest": guest, "world": "vr", "device": station_name(), "station": str(config["station"])}
	transport.send("POST", _base() + "/api/mod/spatial/begin", body, _mod_token, _on_begin)


func _on_begin(status_code: int, data: Variant) -> void:
	if status_code == 200 and data is Dictionary:
		assignment_received.emit(data)
		return
	var msg := str(data.get("error", "")) if data is Dictionary else ""
	match status_code:
		404:
			begin_failed.emit("Nobody has that pass.")
		409:
			# Wave 16: only a program the story marked (captured or
			# restricted) may enter; the server says so in its own words.
			if msg == NOT_MARKED_ERROR:
				begin_failed.emit(NOT_MARKED)
			else:
				begin_failed.emit("The show isn't running.")
		_:
			begin_failed.emit(msg if msg != "" else "Couldn't start (%s)." % _code_text(status_code))


func adopt(assignment: Dictionary) -> void:
	session = assignment
	_seen_sessions[str(assignment.get("session", ""))] = true
	_clear_pump()
	var v := str(assignment.get("houseVersion", ""))
	_duck_version = v
	if v != "":
		_want_version = v
	if not is_offline() and map_is_stale():
		fetch_house()


func request_candidates() -> void:
	if is_offline():
		candidates_received.emit.call_deferred([
			{"id": "g-000001", "name": "Offline Program", "captured": true, "location": null},
			{"id": "g-000002", "name": "Free Program", "captured": false, "restricted": true, "location": null},
		])
		return
	if phase != "ready":
		return
	transport.send("GET", _base() + "/api/mod/spatial/candidates", null, _mod_token, _on_candidates)


func _on_candidates(status_code: int, data: Variant) -> void:
	if status_code == 200 and data is Dictionary and data.get("players") is Array:
		candidates_received.emit(data["players"])


func send_pose(p: Array, yaw: float, pitch: float) -> void:
	if not has_session() or is_offline():
		return
	pump.offer({"p": p, "yaw": yaw, "pitch": pitch, "t": Time.get_unix_time_from_system() * 1000.0})


func _send_pose(pose: Variant) -> void:
	var sid := session_id()
	var gen := pump.generation()
	transport.send("POST", _base() + "/api/spatial/pose", pose, str(session.get("token", "")),
		func(status_code: int, _data: Variant) -> void:
			pump.sent(gen)  # an ended session's late answer frees nothing
			if sid == session_id() and (status_code == 410 or status_code == 401):
				_lose_session("over"))


func report_found() -> void:
	if not has_session():
		return
	if is_offline():
		found_answered.emit.call_deferred(true, {"ok": true, "released": bool(session.get("captured", false)), "already": false})
		return
	_want_claim("found")  # sent once the newest pose has landed (the server judges from it)


func _send_found() -> void:
	var sid := session_id()
	var gen := pump.generation()
	transport.send("POST", _base() + "/api/spatial/found", {}, str(session.get("token", "")),
		func(status_code: int, data: Variant) -> void:
			pump.claim_done(gen)
			if sid != session_id():
				return
			if status_code == 200:
				found_answered.emit(true, data if data is Dictionary else {})
			elif status_code == 410 or status_code == 401:
				_lose_session("over")
			else:
				found_answered.emit(false, data if data is Dictionary else {}))


func hit_king() -> void:
	if not has_session():
		return
	if is_offline():
		_hit_offline()
		return
	_want_claim("king")  # sent once the newest pose has landed (the server judges the reach from it)


func _send_king_hit() -> void:
	var sid := session_id()
	var gen := pump.generation()
	transport.send("POST", _base() + "/api/spatial/king/hit", {}, str(session.get("token", "")),
		func(status_code: int, data: Variant) -> void:
			pump.claim_done(gen)
			if sid != session_id():
				return
			_on_king_hit(status_code, data if data is Dictionary else {}))


func _on_king_hit(status_code: int, d: Dictionary) -> void:
	if d.has("king"):
		_adopt_king(d["king"])
	match status_code:
		200:
			king_hit_answered.emit("ok", d)
		409:
			var e := str(d.get("error", ""))
			king_hit_answered.emit(e if e in ["already hit", "not near", "fallen", "doors are closed"] else "error", d)
		404:
			_adopt_king(null)
			king_hit_answered.emit("no king", d)
		410, 401:
			_lose_session("over")
		_:
			king_hit_answered.emit("error", d)


func _hit_offline() -> void:
	var sid := session_id()
	var result := "ok"
	if king.is_empty():
		result = "no king"
	elif king["fallen"]:
		result = "fallen"
	elif _offline_hits.has(sid):
		result = "already hit"
	else:
		_offline_hits[sid] = true
		var hp: int = maxi(0, int(king["hp"]) - 1)
		_adopt_king({"id": king["id"], "hp": hp, "max": king["max"], "fallen": hp <= 0, "by": session.get("name")})
	var data := {"ok": result == "ok"} if result == "ok" else {"error": result}
	if not king.is_empty():
		data["king"] = king.duplicate()
	king_hit_answered.emit.call_deferred(result, data)


func avatar_url(key: String) -> String:
	if key == "" or is_offline() or event_id == "":
		return ""
	return transport.base + _base() + "/api/avatar/" + key.uri_encode()


func cams_url() -> String:
	if is_offline() or event_id == "":
		return ""
	return transport.base + _base() + "/api/spatial"


func cams_token() -> String:
	var token := str(session.get("token", "")) if has_session() else ""
	return token if token != "" else _mod_token


# --- voice ---


func voice_stream_url() -> String:
	var token := voice_token()
	if is_offline() or event_id == "" or token == "":
		return ""
	return transport.base + _base() + "/api/spatial/voice/stream?token=" + token.uri_encode()


func voice_upload_url() -> String:
	if is_offline() or event_id == "":
		return ""
	return transport.base + _base() + "/api/spatial/voice"


func voice_token() -> String:
	return str(session.get("token", "")) if has_session() else ""


func end_session(_reason: String) -> void:
	if not has_session():
		return
	var token := str(session.get("token", ""))
	session = {}
	_clear_pump()
	_session_gone()
	if not is_offline() and phase == "ready":
		transport.send("POST", _base() + "/api/spatial/end", {}, token, func(_c: int, _d: Variant) -> void: pass)


## The server ended our session under us.
func _lose_session(reason: String) -> void:
	if not has_session():
		return
	session = {}
	_clear_pump()
	_session_gone()
	session_over.emit(reason)


# --- house + stream ---------------------------------------------------------


## Fetch the server's map — with the session token while playing, so the
## answer carries the session's duck; a call made while one is in flight
## sends another once it lands.
func fetch_house() -> void:
	if phase != "ready" or is_offline():
		return
	if _house_in_flight:
		_house_again = true
		return
	_house_in_flight = true
	_house_retry_in = HOUSE_RETRY
	var sid := session_id()
	var token := str(session.get("token", "")) if has_session() else ""
	var as_session := token != ""
	transport.send("GET", _base() + "/api/spatial/house", null, token if as_session else _mod_token,
		func(status_code: int, data: Variant) -> void: _on_house(status_code, data, sid if as_session else ""))


## `sid`: the session whose token fetched it ("" = the moderator's).
func _on_house(status_code: int, data: Variant, sid: String) -> void:
	_house_in_flight = false
	if status_code == 200 and data is Dictionary and data.get("house") is Dictionary:
		house = data["house"]
		house_version = str(data.get("version", ""))
		_want_version = house_version  # the server's own map, just now
		if sid != "" and sid == session_id():
			# The server answered for this session on this map.
			_duck_version = house_version
			if data.get("duck") is Dictionary:
				_adopt_duck(data["duck"])
		if data.has("king"):  # the session's fetch carries the shared King
			_adopt_king(data["king"])
		house_loaded.emit(house, house_version)
	# else: keep the map we have (the bundled one at worst) — and say so.
	if _house_again:
		_house_again = false
		fetch_house()
		return
	_update_map_warning()


## Whether the map up may be the wrong one: not the version the server last
## named, or (playing) not the one the session's duck was dealt on.
func map_is_stale() -> bool:
	if is_offline():
		return false
	if _want_version != "" and house_version != _want_version:
		return true
	return has_session() and _duck_version != "" and house_version != _duck_version


func _update_map_warning() -> void:
	var text := ""
	if map_is_stale():
		if house_version == "bundled" or house_version == "":
			text = "Couldn't load the event's map — the house may be wrong. Retrying…"
		else:
			text = "The event's map changed — reloading it…"
	if text == map_warning_text:
		return
	map_warning_text = text
	if text != "":
		push_warning("reinstall-vr: %s (have %s, want %s)" % [text, house_version, _want_version if _want_version != "" else _duck_version])
	map_warning.emit(text)


## The server's word on our duck: take it when it differs.
func _adopt_duck(d: Variant) -> void:
	if not has_session() or not d is Dictionary or not (d as Dictionary).get("pos") is Array:
		return
	var cur: Variant = session.get("duck")
	if cur is Dictionary and _same_spot(cur, d):
		return
	session = session.duplicate()
	session["duck"] = d
	duck_changed.emit(d)


static func _same_spot(a: Dictionary, b: Dictionary) -> bool:
	if str(a.get("id", "")) != str(b.get("id", "")) or str(a.get("room", "")) != str(b.get("room", "")):
		return false
	var pa: Variant = a.get("pos")
	var pb: Variant = b.get("pos")
	if not pa is Array or not pb is Array or (pa as Array).size() != 3 or (pb as Array).size() != 3:
		return false
	for i in 3:
		if float(pa[i]) != float(pb[i]):
			return false
	return true


func _session_gone() -> void:
	_duck_version = ""
	_update_map_warning()


func _on_frame(event: String, data: Variant) -> void:
	var d: Dictionary = data if data is Dictionary else {}
	match event:
		"house", "hello":
			var v := str(d.get("version" if event == "house" else "houseVersion", ""))
			if v != "":
				_want_version = v
			if map_is_stale():
				fetch_house()
			if event == "hello":
				_adopt_king(d.get("king"))  # missing (an old server) = no shared King
		"king":
			_adopt_king(d)
		"duck":
			if str(d.get("session", "")) == session_id() and session_id() != "":
				# Sent right after the `house` frame: the duck on the map it named.
				_adopt_duck(d.get("duck"))
				if _want_version != "":
					_duck_version = _want_version
				_update_map_warning()
		"reset":
			_lose_session("reset")
		"leave":
			if str(d.get("session", "")) == session_id():
				var reason := str(d.get("reason", "ended"))
				if reason != "found" and reason != "ended":
					_lose_session(reason)
	stream_frame.emit(event, data)


# --- offline ----------------------------------------------------------------


func _begin_offline(guest: String) -> void:
	if house.is_empty():
		begin_failed.emit.call_deferred("No house map.")
		return
	_offline_count += 1
	var sid := "offline-%d" % _offline_count
	var spot: Variant = HouseDuck.pick_duck_spot(house, sid)
	assignment_received.emit.call_deferred({
		"session": sid, "token": "", "guest": guest,
		"name": "Offline Program" if guest == "g-000001" else "Free Program",
		"world": "vr", "device": station_name(), "station": str(config["station"]),
		"captured": guest == "g-000001", "duck": spot, "spawn": house["spawn"], "houseVersion": house_version,
	})
