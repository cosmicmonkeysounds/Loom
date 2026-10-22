## The lobby's joystick picker (`docs/loom-reinstall.md` §5): a flick moves
## the selection one step, holding the stick **right** for 1 s confirms.
## Pure — the lobby draws it.
##
## With [member columns] 1 (a list) up / down move through the items and
## right only confirms. On a grid (`columns` > 1) up / down move a row (or
## one item when everything fits on one row), left moves one back, and a
## right flick let go before the hold is done moves one on — so the same
## stick both walks the tiles and confirms one.
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
## Tiles per row (1 = a list).
var columns := 1

var _move_armed := true
var _side_armed := true
var _confirm_armed := true
## A right flick is under way (it moves on when let go before [constant HOLD]).
var _right_flick := false


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


## The stick must come back to the middle before the next confirm (a card
## opened by a hold must not confirm itself with the same hold).
func disarm() -> void:
	_confirm_armed = false
	_right_flick = false
	held = 0.0


## The item `steps` rows down (negative: up), wrapping top ↔ bottom in the
## same column; one item at a time when all of them fit on one row.
static func row_step(index: int, count: int, cols: int, steps: int) -> int:
	if count <= 0:
		return 0
	var c := maxi(1, cols)
	if c == 1 or count <= c:
		return posmod(index + steps, count)
	var rows := ceili(float(count) / float(c))
	var col := index % c
	var row := posmod(index / c + steps, rows)
	# A short last row: the nearest tile in it.
	return mini(row * c + col, count - 1)


## Feed one frame of stick; returns the confirmed candidate, else `{}`.
func update(stick: Vector2, delta: float) -> Dictionary:
	if absf(stick.y) < REARM:
		_move_armed = true
	elif _move_armed and absf(stick.y) >= FIRE and not items.is_empty():
		_move_armed = false
		# Stick up (y > 0) moves up the list.
		index = row_step(index, items.size(), columns, -1 if stick.y > 0.0 else 1)
		held = 0.0
		_right_flick = false
	if columns > 1:
		if stick.x > -REARM:
			_side_armed = true
		if _side_armed and stick.x <= -FIRE and not items.is_empty():
			_side_armed = false
			index = posmod(index - 1, items.size())
	if stick.x < REARM:
		# Let go of a right flick before the hold was done: one tile on.
		if _right_flick and columns > 1 and not items.is_empty():
			index = posmod(index + 1, items.size())
		_right_flick = false
		_confirm_armed = true
		held = 0.0
		return {}
	if not _confirm_armed or items.is_empty() or stick.x < FIRE:
		return {}
	_right_flick = true
	held += delta
	if held < HOLD:
		return {}
	held = 0.0
	_right_flick = false
	_confirm_armed = false  # let go before the next confirm
	return selected()
