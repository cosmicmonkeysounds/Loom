## A [LinkBase] that records every call and answers only when the test
## says so — the game's state machine under test, without a server.
extends LinkBase

var begun: Array = []
var adopted: Array = []
var poses: Array = []
var found_calls := 0
var ended: Array = []
var candidate_requests := 0


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


func end_session(reason: String) -> void:
	ended.append(reason)
	session = {}


## Load a map as the server would deliver it.
func give_house(map: Dictionary) -> void:
	house = map
	house_version = "test"
	house_loaded.emit(house, house_version)
