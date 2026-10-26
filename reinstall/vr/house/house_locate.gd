## Where is a point? — `docs/loom-reinstall.md` §1.2 "Locate", a literal
## port of `house/src/locate.ts`. The game labels the player's room with
## [method locate] and judges "same floor as the duck" with it.
class_name HouseLocate
extends RefCounted

## How far below a floor's elevation a point still counts as on it.
const FLOOR_SLACK := 0.5
## The highest step up [method height_at] accepts above the hint.
const STEP_UP := 0.45
## How tall a standing player is, for the solid-prop checks.
const BODY_CLEAR := 1.7
## How far into a prop's top a thing resting on it may sit.
const PROP_REST := 0.01
## A solid prop whose top clears the feet by less than this is stepped over
## (the games' step-over) — [method standable]'s rest.
const PROP_STEP_OVER := 0.05
## (wave 26, R5) A player within this (plan) of their previous room's
## polygon, on its floor, stays in it ([method presence_room]).
const PRESENCE_HYSTERESIS_M := 0.75
## A client may keep a terminal linked this long after its room empties.
const PRESENCE_LINGER_MS := 3000


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


## The solid prop a thing `clear` metres tall with its base at `p` would be
## buried in (first in array order), else `null`. Resting on top (to within
## `rest`) is fine.
static func solid_prop_at(house: Dictionary, p: Array, clear: float = BODY_CLEAR, rest: float = PROP_REST) -> Variant:
	var y := float(p[1])
	var plan := [float(p[0]), float(p[2])]
	for prop: Dictionary in house.get("props", []):
		if not HouseGeometry.prop_solid(prop):
			continue
		var bottom := float(prop["pos"][1])
		var top := bottom + float(prop["size"][1])
		if y < top - rest and y + clear > bottom and HouseGeometry.in_prop_footprint(prop, plan):
			return prop
	return null


## Could a player stand with their feet at `p`? In a room ([method locate]),
## over a surface ([method height_at]) and not buried in a solid prop. A
## remap keeps the player where they stand unless this says no — then the
## game puts them back at the spawn (`docs/loom-reinstall.md` §1.3).
static func standable(house: Dictionary, p: Array) -> bool:
	if locate(house, p)["room"] == null:
		return false
	if height_at(house, [p[0], p[2]], p[1]) == null:
		return false
	return solid_prop_at(house, p, BODY_CLEAR, PROP_STEP_OVER) == null


## (wave 26, R5) The room a player counts as being in — a port of
## `presenceRoom` (`house/src/presence.ts`): [method locate]'s room, except
## that a player still within [constant PRESENCE_HYSTERESIS_M] of `prev`'s
## polygon (inside or outside it) on the same floor stays in `prev`. The
## caller keeps `prev` (`null` on a first pose or a re-seat).
static func presence_room(house: Dictionary, p: Array, prev: Variant) -> Variant:
	var at := locate(house, p)
	if prev == null or (at["room"] != null and str(at["room"]) == str(prev)):
		return at["room"]
	var room: Variant = HouseGeometry.room_by_id(house, prev)
	if room == null or str(room["floor"]) != str(at["floor"]):
		return at["room"]
	var plan := [float(p[0]), float(p[2])]
	if HouseGeometry.point_in_poly(room["poly"], plan) or HouseGeometry.distance_to_boundary(room["poly"], plan) <= PRESENCE_HYSTERESIS_M:
		return str(prev)
	return at["room"]


## The terminal ids (map order) whose `room` is one of `rooms` (nulls
## ignored), never a `view: "reinstall"` terminal — `linkedSpots`.
static func linked_spots(house: Dictionary, rooms: Array) -> Array:
	var occupied := {}
	for r: Variant in rooms:
		if r != null:
			occupied[str(r)] = true
	var out: Array = []
	for t: Dictionary in house.get("terminals", []):
		if str(t.get("view", "")) == "reinstall":
			continue
		if occupied.has(str(t.get("room", ""))):
			out.append(str(t["id"]))
	return out
