## A [LinkBase] that records every call and answers only when the test
## says so — the game's state machine under test, without a server.
extends LinkBase

var begun: Array = []
var adopted: Array = []
var poses: Array = []
var found_calls := 0
var ended: Array = []
var candidate_requests := 0
var king_hits := 0
## [method mark_ready] calls.
var readies := 0
## [method reset_run] calls.
var run_resets := 0


func begin(guest: String) -> void:
	begun.append(guest)


func adopt(assignment: Dictionary) -> void:
	session = assignment
	adopted.append(assignment)


func request_candidates() -> void:
	candidate_requests += 1


func send_pose(p: Array, yaw: float, pitch: float) -> void:
	poses.append({"p": p, "yaw": yaw, "pitch": pitch})


func report_found() -> void:
	found_calls += 1


func hit_king() -> void:
	king_hits += 1


func mark_ready() -> void:
	readies += 1


func reset_run() -> void:
	run_resets += 1


## `[kind, prop]` per [method moment]; answer with [method answer_moment].
var moments: Array = []


func moment(kind: String, prop := "") -> void:
	moments.append([kind, prop])


## The server's word on a moment.
func answer_moment(kind: String, result: String, data := {}) -> void:
	moment_answered.emit(kind, result, data)


## (wave 49) [method fetch_descent] calls, and `[talker, mark]` per [method post_told].
var descent_fetches := 0
var told_posts: Array = []


func fetch_descent() -> void:
	descent_fetches += 1
	super()


func post_told(talker: String, mark: String) -> void:
	told_posts.append([talker, mark])


## The camera feeds' root ("" = none, the default: the game asks nothing).
var cams_base := ""


func cams_url() -> String:
	return cams_base


func cams_token() -> String:
	return str(session.get("token", "tok"))


func avatar_url(key: String) -> String:
	return "fixture://avatar/" + key if key != "" else ""


# --- voice ---

## The voice link's root ("" = none, the default: no voice).
var voice_base := ""


func voice_stream_url() -> String:
	return voice_base + "/voice/stream?token=" + voice_token() if voice_base != "" and voice_token() != "" else ""


func voice_upload_url() -> String:
	return voice_base + "/voice" if voice_base != "" else ""


func voice_token() -> String:
	return str(session.get("token", "")) if has_session() else ""


## The server's word on the shared King (a `hello` / `king` frame).
func give_king(k: Variant) -> void:
	_adopt_king(k)


## (wave 40) suspend / resume, and the walk a relaunch would find saved.
var suspends := 0
var resumes: Array = []
var saved := {}


func suspend() -> void:
	suspends += 1


func resume(token: String) -> void:
	resumes.append(token)


func saved_walk() -> Dictionary:
	return saved


## The server gives a held walk back.
func answer_resumed(assignment: Dictionary, pose := {}, is_ready := true) -> void:
	adopt(assignment)
	resumed.emit(assignment, pose, is_ready)


func fail_resume() -> void:
	resume_failed.emit()


func end_session(reason: String) -> void:
	ended.append(reason)
	session = {}


## Load a map as the server would deliver it.
func give_house(map: Dictionary) -> void:
	house = map
	house_version = "test"
	house_loaded.emit(house, house_version)


# --- in-headset setup (wave 19) ---------------------------------------------------

## Whether the lobby should ask to be set up, and the servers it offers.
var unconfigured := false
var choices: Array = [{"url": "https://show.example", "label": "show.example"}, {"url": "http://127.0.0.1:7000", "label": "This computer · 127.0.0.1:7000"}]
## `[server, code, name]` per [method try_setup]; answer with [method answer_setup].
var setups: Array = []
var offline_chosen := 0
var forgotten := 0
var saved_setup := false


func needs_setup() -> bool:
	return unconfigured


func server_choices() -> Array:
	return choices


func try_setup(server: String, code: String, name: String) -> void:
	setups.append([server, code, name])


func answer_setup(ok: bool, message := "") -> void:
	if ok:
		unconfigured = false
		saved_setup = true
		config["name"] = str(setups.back()[2]) if not setups.is_empty() else str(config.get("name", ""))
	setup_answered.emit(ok, message)


func play_offline() -> void:
	offline_chosen += 1
	unconfigured = false


func can_forget_setup() -> bool:
	return saved_setup or offline_chosen > 0


func forget_setup() -> void:
	forgotten += 1
	saved_setup = false
	offline_chosen = 0
	unconfigured = true
