## The game's state machine: LOBBY → PLAYING → FOUND → LOBBY, with an
## abort from any play state (session over, headset off). Pure; [Game] does
## the side effects for each transition it is granted.
class_name GameFlow
extends RefCounted

enum State { LOBBY, PLAYING, FOUND }

## How long the found screen celebrates before the lobby comes back (the
## server lets a found session linger 8 s for the terminals).
const CELEBRATE := 7.0

var state := State.LOBBY
## The assignment being played (`{}` in the lobby).
var assignment: Dictionary = {}
## Whether the found was a release (the program was corrupted).
var released := false

var _celebrate := 0.0


## Take an assignment — only from the lobby.
func assign(a: Dictionary) -> bool:
	if state != State.LOBBY:
		return false
	state = State.PLAYING
	assignment = a
	released = false
	return true


## The server confirmed the duck — only while playing.
func found(was_released: bool) -> bool:
	if state != State.PLAYING:
		return false
	state = State.FOUND
	released = was_released
	_celebrate = CELEBRATE
	return true


## Advance the clock; true when the celebration ends (FOUND → LOBBY).
func tick(delta: float) -> bool:
	if state != State.FOUND:
		return false
	_celebrate -= delta
	if _celebrate > 0.0:
		return false
	_to_lobby()
	return true


## Leave a session early (PLAYING / FOUND → LOBBY).
func abort() -> bool:
	if state == State.LOBBY:
		return false
	_to_lobby()
	return true


func _to_lobby() -> void:
	state = State.LOBBY
	assignment = {}


func is_playing() -> bool:
	return state == State.PLAYING


static func name_of(s: State) -> String:
	return ["LOBBY", "PLAYING", "FOUND"][s]
