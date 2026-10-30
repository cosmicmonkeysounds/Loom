## The lobby's test-level combo: B B A A B A B A A B B on either
## controller (A = A / X, B = B / Y) plays offline (the bundled house, the
## duck picked here) and starts the captured offline program, so a headset
## can be tried without a server. A pause longer than [constant GAP] starts
## the sequence over. Its mirror, A A B B A B A B B A A (wave 49), does the
## same at the descent's deepest level. Neither test level plays the intro,
## and the plain sequence typed during an intro skips the rest of it. The web
## game takes the same code on its keyboard (`web/src/game/test-code.ts`).
class_name TestCombo
extends RefCounted

const SEQUENCE := "BBAABABAABB"
const MIRROR := "AABBABABBAA"
## The longest pause between two presses (s).
const GAP := 1.5

var _sequence := SEQUENCE
var _typed := ""
var _since := 0.0
var _a_was := false
var _b_was := false


func _init(sequence := SEQUENCE) -> void:
	_sequence = sequence


## One frame: whether A and B are held now. True on the frame the combo
## completes.
func feed(a_down: bool, b_down: bool, delta: float) -> bool:
	_since += delta
	var key := ""
	if a_down and not _a_was:
		key = "A"
	elif b_down and not _b_was:
		key = "B"
	_a_was = a_down
	_b_was = b_down
	if key == "":
		return false
	if _since > GAP:
		_typed = ""
	_since = 0.0
	_typed += key
	# Keep the longest tail that could still become the sequence.
	while not _sequence.begins_with(_typed):
		_typed = _typed.substr(1)
	if _typed == _sequence:
		_typed = ""
		return true
	return false


## Whether A (A / X) or B (B / Y) is held on either hand.
static func held(hands: Array, button: String) -> bool:
	for h: XRController3D in hands:
		if h != null and h.is_button_pressed(button):
			return true
	return false
