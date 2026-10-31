## A hold that fills over [member seconds], once per press: it must be let go
## before it can fill again (wave 59, the web game's `HoldMeter` in
## `reinstall/web/src/game/reset.ts`). Pure.
class_name HoldMeter
extends RefCounted

## The run reset's hold (s): the web's `RESET_HOLD_MS`.
const RESET_HOLD := 5.0

var seconds := RESET_HOLD
var _held := 0.0
var _spent := false


func _init(s := RESET_HOLD) -> void:
	seconds = s


## One frame of `delta` s: is it down? Returns the fill, 0 to 1.
func update(down: bool, delta: float) -> float:
	if not down:
		_held = 0.0
		_spent = false
		return 0.0
	if _spent:
		return 0.0
	_held += delta
	return minf(1.0, _held / seconds)


## The fill was acted on: nothing more until it is let go.
func spend() -> void:
	_spent = true
	_held = 0.0
