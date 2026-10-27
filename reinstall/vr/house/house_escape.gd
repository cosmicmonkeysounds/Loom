## The void (wave 26, R4) — a literal port of `house/src/escape.ts`: the
## walkable outside ([method outside_ground], the rect [method
## HouseBuilder._build_ground] lays) and how far into the void a point is
## ([method void_distance]). Once a program is [constant ESCAPE_M] past the
## walls the game scares them, puts them back at the spawn and posts an
## escape moment; the server accepts [constant ESCAPE_M] −
## [constant ESCAPE_SLACK] once per [constant ESCAPE_COOLDOWN_MS]. Pinned by
## `res://test/golden/<map>.escape.json` and `constants.json`.
class_name HouseEscape
extends RefCounted

## Plan metres past the house walls (on the player's floor) that trigger an escape.
const ESCAPE_M := 5.0
## The server accepts an escape this much short of [constant ESCAPE_M].
const ESCAPE_SLACK := 0.5
## One escape per session per this long (the server's cooldown).
const ESCAPE_COOLDOWN_MS := 20000
## How far the outside ground reaches past the rooms on its floor (= [constant HouseBuilder.GROUND_MARGIN]).
const OUTSIDE_GROUND_MARGIN := 30.0
## The story signal an escape posts.
const ESCAPE_SIGNAL := "simulation escape attempt"


## `{floor, y, rect: [x0, z0, x1, z1]}`: the floor the first exterior
## (`b: null`) door whose room exists opens from, its elevation (0 for an
## unknown floor) and the bounds of every room on it grown by `margin`.
## `null` without an exterior door.
static func outside_ground(house: Dictionary, margin: float = OUTSIDE_GROUND_MARGIN) -> Variant:
	var floor_id: Variant = null
	for door: Dictionary in house.get("doors", []):
		if door.get("b") != null:
			continue
		var r: Variant = HouseGeometry.room_by_id(house, door["a"])
		if r != null:
			floor_id = str(r["floor"])
			break
	if floor_id == null:
		return null
	var pts: Array = []
	for room: Dictionary in house.get("rooms", []):
		if str(room["floor"]) == floor_id:
			pts.append_array(room["poly"])
	if pts.is_empty():
		return null
	var b := HouseGeometry.poly_bounds(pts)
	var fl: Variant = HouseGeometry.floor_by_id(house, floor_id)
	return {
		"floor": floor_id,
		"y": float(fl["elevation"]) if fl != null else 0.0,
		"rect": [float(b[0]) - margin, float(b[1]) - margin, float(b[2]) + margin, float(b[3]) + margin],
	}


## `null` inside a room ([method HouseLocate.locate]); else the plan
## distance to the nearest room boundary on [method HouseLocate.floor_of]
## `p[1]` — `INF` when that floor has no rooms.
static func void_distance(house: Dictionary, p: Array) -> Variant:
	if HouseLocate.locate(house, p)["room"] != null:
		return null
	var fl := HouseLocate.floor_of(house, float(p[1]))
	var plan := [float(p[0]), float(p[2])]
	var best := INF
	for room: Dictionary in house.get("rooms", []):
		if str(room["floor"]) != fl:
			continue
		best = minf(best, HouseGeometry.distance_to_boundary(room["poly"], plan))
	return best
