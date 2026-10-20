## `--autopilot`: a dev / CI mode, never set on a headset. It plays the
## game the way a guest would — follow the indicators to the duck — by
## steering the real sticks, so the body still collides, climbs the ramps
## and claims the duck through the normal `found` path. The end-to-end
## check runs the game headless against a live event server with it
## (`--server … --code … --guest g-… --autopilot`).
##
## Pure: a waypoint follower. The plan starts from the §1.2 `route` (house
## frame) — the chevrons' path, already walkable round walls, reflex
## corners, stair holes / ramps and solid props (couch, ping-pong table, …)
## — and [method navigate] makes it walkable by a body:
##
## - every door and stair end is crossed square-on, between approach points
##   [constant APPROACH] m either side of it;
## - a leg those approach points add that the route's own visibility test
##   would refuse (it clips a prop or a stair hole) detours over the route's
##   corner waypoints of that room.
##
## The plan is made once per session, from the spawn; a waypoint counts as
## passed within [constant REACH] on the plan. When the body makes no headway
## for [constant STUCK_AFTER] s it re-plans from where it stands.
class_name Autopilot
extends RefCounted

## Plan distance (m) at which a waypoint counts as reached.
const REACH := 0.2
## Re-plan after this long (s) without getting [constant PROGRESS] closer.
const STUCK_AFTER := 3.0
const PROGRESS := 0.25
## How far (plan, m) either side of a door or stair end the walker lines up.
const APPROACH := 0.5

var path: Array = []
var index := 1
var _best := INF
var _stuck := 0.0


## Plan from `feet` to `goal` (house frame) in `house`.
func plan(house: Dictionary, feet: Array, goal: Array) -> void:
	path = navigate(house, HouseRoute.route(house, feet, goal))
	index = 1
	_best = INF
	_stuck = 0.0


## The waypoint being walked to, or `[]` once the path is done.
func target() -> Array:
	return path[index] if index < path.size() else []


## One tick at `feet`: skips every reached waypoint (never the last — the
## duck itself is the game's to judge) and returns `{yaw, stick, replan}`:
## the house-frame heading to face, the left stick to hold, and whether the
## body has been stuck long enough that the caller should [method plan]
## again.
func steer(feet: Array, delta: float) -> Dictionary:
	while index < path.size() - 1 and _dist(feet, path[index]) <= REACH:
		index += 1
		_best = INF
		_stuck = 0.0
	var t := target()
	if t.is_empty():
		return {"yaw": 0.0, "stick": Vector2.ZERO, "replan": false}
	var d := _dist(feet, t)
	if d < _best - PROGRESS:
		_best = d
		_stuck = 0.0
	else:
		_stuck += delta
	return {"yaw": HouseRoute.yaw_toward(feet, t), "stick": Vector2(0.0, 1.0), "replan": _stuck >= STUCK_AFTER}


# --- planning ------------------------------------------------------------------


## The route `coarse` (`[from, …waypoints, to]`) made walkable: approach
## points around every portal, and any leg they add that clips an obstacle
## routed round it.
static func navigate(house: Dictionary, coarse: Array) -> Array:
	if coarse.size() < 2:
		return coarse.duplicate()
	# 1. Portals → [approach, portal, approach]. Each entry: {p, portal}.
	var pts: Array = [{"p": coarse[0], "portal": false}]
	for i in range(1, coarse.size()):
		var p: Array = coarse[i]
		var prev: Array = coarse[i - 1]
		var next: Array = coarse[i + 1] if i + 1 < coarse.size() else []
		var sides := [] if i == coarse.size() - 1 else _portal_sides(house, p, prev, next)
		if sides.size() == 2:
			if not sides[0].is_empty():
				pts.append({"p": sides[0], "portal": false})
			pts.append({"p": p, "portal": true})
			if not sides[1].is_empty():
				pts.append({"p": sides[1], "portal": false})
		else:
			pts.append({"p": p, "portal": false})
	# 2. In-room legs (neither end a portal) go round the room's props.
	var out: Array = [pts[0]["p"]]
	for i in range(1, pts.size()):
		var u: Dictionary = pts[i - 1]
		var v: Dictionary = pts[i]
		if not u["portal"] and not v["portal"]:
			out.append_array(_in_room(house, u["p"], v["p"]))
		out.append(v["p"])
	return out


## For a door or stair-end portal at `p` (reached from `prev`, left toward
## `next`): `[before, after]` — the approach points to walk through it
## square-on (`[]` for a side that is not needed); `[]` when `p` is no portal.
static func _portal_sides(house: Dictionary, p: Array, prev: Array, next: Array) -> Array:
	for door: Dictionary in house.get("doors", []):
		var at: Array = door["at"]
		if absf(at[0] - p[0]) > 1e-3 or absf(at[1] - p[2]) > 1e-3:
			continue
		var floor_id := str(HouseGeometry.room_by_id(house, door["a"])["floor"])
		for n: Array in [[0.0, 1.0], [1.0, 0.0]]:
			var s1 := [p[0] + n[0] * APPROACH, p[1], p[2] + n[1] * APPROACH]
			var s2 := [p[0] - n[0] * APPROACH, p[1], p[2] - n[1] * APPROACH]
			var r1: Variant = HouseLocate.room_at(house, [s1[0], s1[2]], floor_id)
			var r2: Variant = HouseLocate.room_at(house, [s2[0], s2[2]], floor_id)
			var id1: Variant = r1["id"] if r1 != null else null
			var id2: Variant = r2["id"] if r2 != null else null
			if id1 == id2 or not (id1 in [door["a"], door["b"]]) or not (id2 in [door["a"], door["b"]]):
				continue
			var from_room: Variant = HouseLocate.locate(house, prev)["room"]
			# Off both rooms (`prev` another door on the same wall line, the
			# leg hugging it): the side nearer where we came from and farther
			# from where we go is first — plain distance from `prev` ties there.
			var first_is_1: bool
			if from_room in [id1, id2]:
				first_is_1 = id1 == from_room
			elif next.is_empty():
				first_is_1 = _dist(prev, s1) <= _dist(prev, s2)
			else:
				first_is_1 = _dist(prev, s1) - _dist(next, s1) <= _dist(prev, s2) - _dist(next, s2)
			return [s1, s2] if first_is_1 else [s2, s1]
	for stair: Dictionary in house.get("stairs", []):
		var ends := HouseGeometry.stair_ends(stair)
		var lv := HouseGeometry.stair_levels(house, stair)
		for end: String in ["foot", "head"]:
			var e: Array = ends[end]
			if absf(e[0] - p[0]) > 1e-3 or absf(e[1] - p[2]) > 1e-3:
				continue
			var y: float = lv["low"] if end == "foot" else lv["high"]
			var other: Array = ends["head" if end == "foot" else "foot"]
			# Off the ramp: beyond the head along `up`, before the foot against it.
			var u := _up(stair)
			var sgn := 1.0 if end == "head" else -1.0
			var out := [p[0] + u[0] * sgn * APPROACH, y, p[2] + u[1] * sgn * APPROACH]
			var on_ramp := func(q: Array) -> bool:
				return not q.is_empty() and absf(q[0] - other[0]) < 1e-3 and absf(q[2] - other[1]) < 1e-3
			if on_ramp.call(prev):
				return [[], out]  # came along the ramp: step off it
			if on_ramp.call(next):
				return [out, []]  # about to take the ramp: line up first
			return [out, out]
	return []


## The unit plan direction of `stair`'s `up`.
static func _up(stair: Dictionary) -> Array:
	match str(stair["up"]):
		"n":
			return [0.0, -1.0]
		"s":
			return [0.0, 1.0]
		"e":
			return [1.0, 0.0]
	return [-1.0, 0.0]


## Corner points (house frame) to walk by from `a` to `b` inside their room
## — `[]` when the leg already passes the route's own visibility test
## ([method HouseRoute.visible_in]: walls, stair holes / ramps, solid props
## grown [constant HouseRoute.PROP_MARGIN]), when they are not in one room,
## or when no way round exists. Only the legs [method navigate] adds (to and
## from a portal's approach points) can need it: the route's own legs are
## visible by construction. The way round is a shortest path over the
## route's corner waypoints of that room.
static func _in_room(house: Dictionary, a: Array, b: Array) -> Array:
	var floor_id := HouseLocate.floor_of(house, a[1])
	var room: Variant = HouseLocate.room_at(house, [a[0], a[2]], floor_id)
	if room == null or HouseLocate.room_at(house, [b[0], b[2]], floor_id) != room:
		return []
	if HouseRoute.visible_in(house, room, a, b):
		return []
	var y: float = a[1]
	var nodes: Array = [a, b]
	for node: Dictionary in HouseRoute.route_nodes(house):
		if node["kind"] == "corner" and node["id"] == str(room["id"]):
			var q: Array = node["pos"]
			nodes.append([q[0], y, q[2]])
	# Dijkstra over the visibility graph (a handful of nodes).
	var n := nodes.size()
	var dist: Array = []
	var prev: Array = []
	var done: Array = []
	for i in n:
		dist.append(INF)
		prev.append(-1)
		done.append(false)
	dist[0] = 0.0
	for _k in n:
		var u := -1
		for i in n:
			if not done[i] and dist[i] < INF and (u < 0 or dist[i] < dist[u]):
				u = i
		if u < 0 or u == 1:
			break
		done[u] = true
		for v in n:
			if done[v] or v == u or not HouseRoute.visible_in(house, room, nodes[u], nodes[v]):
				continue
			var alt: float = dist[u] + _dist(nodes[u], nodes[v])
			if alt < dist[v]:
				dist[v] = alt
				prev[v] = u
	if prev[1] < 0:
		return []
	var via: Array = []
	var at: int = prev[1]
	while at > 0:
		via.push_front(nodes[at])
		at = prev[at]
	return via


static func _dist(a: Array, b: Array) -> float:
	var dx: float = b[0] - a[0]
	var dz: float = b[2] - a[2]
	return sqrt(dx * dx + dz * dz)
