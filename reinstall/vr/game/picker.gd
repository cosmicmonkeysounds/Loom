## The lobby's joystick picker (`docs/loom-reinstall.md` §5): stick up /
## down moves through the candidates one flick at a time, holding the stick
## **right** for 1 s confirms. No buttons. Pure — the lobby draws it.
class_name CandidatePicker
extends RefCounted

## Seconds the stick must be held right to confirm.
const HOLD := 1.0
## A flick past this moves the selection / starts the hold…
const FIRE := 0.6
## …and the stick must come back under this before the next one.
const REARM := 0.3

## `[{id, name, captured, location}]`.
var items: Array = []
var index := 0
## Seconds held right so far.
var held := 0.0

var _move_armed := true
var _confirm_armed := true


## Replace the list, keeping the selected candidate when it is still there.
func set_items(list: Array) -> void:
	var keep := str(selected().get("id", "")) if not items.is_empty() else ""
	items = list.duplicate()
	index = 0
	for i in items.size():
		if str(items[i].get("id", "")) == keep:
			index = i
			break


## The highlighted candidate (`{}` when the list is empty).
func selected() -> Dictionary:
	return items[index] if index < items.size() else {}


## 0 → 1 while holding right.
func progress() -> float:
	return clampf(held / HOLD, 0.0, 1.0)


## Feed one frame of stick; returns the confirmed candidate, else `{}`.
func update(stick: Vector2, delta: float) -> Dictionary:
	if absf(stick.y) < REARM:
		_move_armed = true
	elif _move_armed and absf(stick.y) >= FIRE and not items.is_empty():
		_move_armed = false
		# Stick up (y > 0) moves up the list.
		index = posmod(index + (-1 if stick.y > 0.0 else 1), items.size())
		held = 0.0
	if stick.x < REARM:
		_confirm_armed = true
		held = 0.0
		return {}
	if not _confirm_armed or items.is_empty() or stick.x < FIRE:
		return {}
	held += delta
	if held < HOLD:
		return {}
	held = 0.0
	_confirm_armed = false  # let go before the next confirm
	return selected()
