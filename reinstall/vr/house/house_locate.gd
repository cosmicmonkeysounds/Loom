## Where is a point? — `docs/loom-reinstall.md` §1.2 "Locate", a literal
## port of `house/src/locate.ts`. The game labels the player's room with
## [method locate] and judges "same floor as the duck" with it.
class_name HouseLocate
extends RefCounted

## How far below a floor's elevation a point still counts as on it.
const FLOOR_SLACK := 0.5
## The highest step up [method height_at] accepts above the hint.
const STEP_UP := 0.45


## The highest floor whose elevation ≤ `y + 0.5`, else the lowest (ties:
## first in array order).
static func floor_of(house: Dictionary, y: float) -> String:
	var best: Variant = null
	var floors: Array = house.get("floors", [])
	for f: Dictionary in floors:
		if float(f["elevation"]) > y + FLOOR_SLACK:
			continue
		if best == null or float(f["elevation"]) > float(best["elevation"]):
			best = f
	if best != null:
		return str(best["id"])
	var lowest: Variant = floors[0] if not floors.is_empty() else null
	for f: Dictionary in floors:
		if lowest != null and float(f["elevation"]) < float(lowest["elevation"]):
			lowest = f
	return str(lowest["id"]) if lowest != null else ""


## The room [Dictionary] on `floor_id` whose polygon contains the plan
## point (boundary counts; first in array order), or `null`.
static func room_at(house: Dictionary, p: Array, floor_id: String) -> Variant:
	for room: Dictionary in house.get("rooms", []):
		if str(room["floor"]) == floor_id and HouseGeometry.point_in_poly(room["poly"], p):
			return room
	return null


## `{floor, room}` of a point `[x, y, z]` (`room` a String or `null`). Over a
## stair rect (and on one of its two floors by [method floor_of]), the point
## is in the stair's `from` room when its y is strictly nearer the lower
## elevation, else in `to`.
static func locate(house: Dictionary, p: Array) -> Dictionary:
	var plan := [float(p[0]), float(p[2])]
	var fl := floor_of(house, p[1])
	for stair: Dictionary in house.get("stairs", []):
		if not HouseGeometry.point_in_rect(stair["rect"], plan):
			continue
		var from: Variant = HouseGeometry.room_by_id(house, stair["from"])
		var to: Variant = HouseGeometry.room_by_id(house, stair["to"])
		if from == null or to == null:
			continue
		if fl != str(from["floor"]) and fl != str(to["floor"]):
			continue
		var lv := HouseGeometry.stair_levels(house, stair)
		if absf(p[1] - lv["low"]) < absf(p[1] - lv["high"]):
			return {"floor": str(from["floor"]), "room": str(from["id"])}
		return {"floor": str(to["floor"]), "room": str(to["id"])}
	var room: Variant = room_at(house, plan, fl)
	return {"floor": fl, "room": str(room["id"]) if room != null else null}


## Every surface height under a plan point: each room floor containing it
## (unless strictly inside a stair hole in it), and each ramp whose rect
## contains it (boundary counts).
static func surfaces_at(house: Dictionary, p: Array) -> Array:
	var out: Array = []
	var stairs: Array = house.get("stairs", [])
	for room: Dictionary in house.get("rooms", []):
		if not HouseGeometry.point_in_poly(room["poly"], p):
			continue
		var holed := false
		for s: Dictionary in stairs:
			if str(s["to"]) == str(room["id"]) and HouseGeometry.point_in_rect_strict(s["rect"], p):
				holed = true
				break
		if holed:
			continue
		out.append(HouseGeometry.room_elevation(house, room))
	for stair: Dictionary in stairs:
		if HouseGeometry.point_in_rect(stair["rect"], p):
			out.append(HouseGeometry.ramp_height(house, stair, p))
	return out


## The surface to stand on: the highest candidate ≤ `y_hint + 0.45`, else
## the lowest candidate, else `null` (nothing under the point).
static func height_at(house: Dictionary, p: Array, y_hint: float) -> Variant:
	var best: Variant = null
	var lowest: Variant = null
	for h: float in surfaces_at(house, p):
		if h <= y_hint + STEP_UP and (best == null or h > best):
			best = h
		if lowest == null or h < lowest:
			lowest = h
	return best if best != null else lowest
