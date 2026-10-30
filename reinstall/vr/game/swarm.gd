## A ghost's swarm: the literal port of the layout and the trail in
## `@loom/house/three`'s `swarm.ts` (the same generator, so the same shards);
## what moves is in `swarm.gdshader`. Pure: no nodes.
class_name Swarm
extends RefCounted

## The face: this many cells a side, the whole picture.
const FACE_GRID := 9
## The slivers that make the body.
const BODY_SHARDS := 120
## Every shard of a ghost.
const SHARDS := FACE_GRID * FACE_GRID + BODY_SHARDS
const FACE_SIZE := 0.56
const FACE_Y := 1.5
## The capsule the shards hold to (metres): the collider, never drawn.
const RADIUS := 0.22
const HEIGHT := 1.6
## The points of the body's path the shards follow.
const TRAIL := 8
## Seconds between two points of the path.
const TRAIL_STEP_S := 0.07
## A jump this long (metres) is a teleport, not a walk: the trail starts again.
const TELEPORT_M := 3.0


## How far a body sliver sits from the axis at height `y`.
static func radius_at(y: float) -> float:
	var t := clampf(y / HEIGHT, 0.0, 1.0)
	return RADIUS * (0.45 + 0.55 * sin(PI * pow(t, 1.6)))


## Every shard ({home, size, cell, rand}), the face's first (row by row from
## the bottom), then the body's.
static func layout() -> Array[Dictionary]:
	var state := [0x51a7]
	var shards: Array[Dictionary] = []
	var side := FACE_SIZE / FACE_GRID
	for row in FACE_GRID:
		for col in FACE_GRID:
			var a := _next(state) * TAU
			var y := 0.7 + _next(state) * 0.85
			var r := radius_at(y) * (0.6 + 0.6 * _next(state))
			var rand_a := _next(state)
			var rand_b := _next(state)
			var rand_c := _next(state)
			shards.append({
				"home": Vector3(cos(a) * r, y, sin(a) * r),
				"size": Vector2(side, side),
				"cell": Color(float(col) / FACE_GRID, float(row) / FACE_GRID, 1.0 / FACE_GRID, 1.0 / FACE_GRID),
				"rand": Color(rand_a, rand_b, rand_c, 1.0 + _next(state) * 0.999),
			})
	var widths := [1.0 / 4.0, 1.0 / 6.0, 1.0 / 8.0, 1.0 / 12.0]
	var heights := [1.0 / 32.0, 1.0 / 24.0, 1.0 / 16.0, 1.0 / 8.0]
	for i in BODY_SHARDS:
		var a := _next(state) * TAU
		var y := 0.04 + _next(state) * (HEIGHT - 0.1)
		var r := radius_at(y) * (0.45 + 0.6 * _next(state))
		var du: float = widths[int(_next(state) * widths.size())]
		var dv: float = heights[int(_next(state) * heights.size())]
		var k := FACE_SIZE * (0.35 + 0.35 * _next(state))
		var u := _next(state) * (1.0 - du)
		var v := _next(state) * (1.0 - dv)
		var rand_a := _next(state)
		var rand_b := _next(state)
		var rand_c := _next(state)
		shards.append({
			"home": Vector3(cos(a) * r, y, sin(a) * r),
			"size": Vector2(du * k, dv * k),
			"cell": Color(u, v, du, dv),
			"rand": Color(rand_a, rand_b, rand_c, _next(state) * 0.999),
		})
	return shards


## The same LCG as `swarm.ts`.
static func _next(state: Array) -> float:
	state[0] = (int(state[0]) * 1664525 + 1013904223) & 0xFFFFFFFF
	return float(state[0]) / 4294967296.0


## The body's recent path as offsets from where it stands now: what makes the
## swarm drag behind a walk. A teleport starts it again.
class SwarmTrail:
	## Offset of each point from the body now, nearest first.
	var offsets := PackedVector3Array()
	var _past := PackedVector3Array()
	var _since := 0.0

	func _init() -> void:
		offsets.resize(TRAIL)

	func step(p: Vector3, dt: float) -> void:
		if _past.is_empty() or p.distance_to(_past[0]) > TELEPORT_M:
			_past.resize(TRAIL)
			_past.fill(p)
			_since = 0.0
		else:
			_since += dt
			if _since >= TRAIL_STEP_S:
				_since = fmod(_since, TRAIL_STEP_S)
				_past.remove_at(TRAIL - 1)
				_past.insert(0, p)
		for i in TRAIL:
			offsets[i] = Vector3.ZERO if i == 0 else _past[i] - p
