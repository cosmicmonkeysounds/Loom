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


func end_session(reason: String) -> void:
	ended.append(reason)
	session = {}


## Load a map as the server would deliver it.
func give_house(map: Dictionary) -> void:
	house = map
	house_version = "test"
	house_loaded.emit(house, house_version)
