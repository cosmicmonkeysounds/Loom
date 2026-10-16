## "Follow the indicators" — `docs/loom-reinstall.md` §1.2 "Route", a
## line-for-line port of `house/src/route.ts`: a shortest walkable path
## through doors and stairs — a visibility graph over the portals plus
## corner waypoints (each reflex corner of a room, each corner of a stair
## rect, each corner of a solid prop's grown bounds), so no leg cuts
## through a wall, across a stair hole, or through a solid prop. Plain O(n²)
## Dijkstra with the reference's tie-break.
class_name HouseRoute
extends RefCounted

## How far a corner waypoint sits off its corner, along each axis.
const ROUTE_CLEARANCE := 0.35
## How much a stair rect shrinks to become an obstacle (so its own foot / head see out).
const OBSTACLE_SHRINK := 0.01
## The one tolerance of the visibility test (metres, and m² for orientations).
const ROUTE_EPS := 1e-6
## How much a solid prop's footprint bounds grow to become an obstacle (the walker's body radius).
const PROP_MARGIN := 0.25


## Round to integer micrometres, `floor(v · 1e6 + 0.5) / 1e6` — so trig ulps never reach a decision.
static func um(v: float) -> float:
	return floor(v * 1e6 + 0.5) / 1e6 + 0.0


## A solid prop's route obstacle `[x0, z0, x1, z1]`: the axis-aligned bounds
## of its footprint — a cylinder's `max(w, d) / 2` radius box, a box's
## `w × d` rectangle yawed about `pos` (half extents
## `hx = |w/2·cos r| + |d/2·sin r|`, `hz = |w/2·sin r| + |d/2·cos r|`,
## `r = yaw·π/180`) — grown by [constant PROP_MARGIN] on every side and
## rounded to 1 µm ([method um]).
static func prop_obstacle(prop: Dictionary) -> Array:
	var size: Array = prop["size"]
	var w := float(size[0])
	var d := float(size[2])
	var hx: float
	var hz: float
	if str(prop.get("kind", "")) == "cylinder":
		hx = maxf(w, d) / 2.0
		hz = hx
	else:
		var yaw_v: Variant = prop.get("yaw")
		var r := (float(yaw_v) if yaw_v != null else 0.0) * PI / 180.0
		var c := absf(cos(r))
		var s := absf(sin(r))
		hx = (w / 2.0) * c + (d / 2.0) * s
		hz = (w / 2.0) * s + (d / 2.0) * c
	var pos: Array = prop["pos"]
	var x := float(pos[0])
	var z := float(pos[2])
	return [um(x - hx - PROP_MARGIN), um(z - hz - PROP_MARGIN), um(x + hx + PROP_MARGIN), um(z + hz + PROP_MARGIN)]


## The four corners of a rect moved [constant ROUTE_CLEARANCE] outward along
## each axis, `[x0, z0] [x1, z0] [x1, z1] [x0, z1]` order.
static func _outer_corners(r: Array) -> Array:
	var c := ROUTE_CLEARANCE
	return [
		[r[0] - c, r[1] - c],
		[r[2] + c, r[1] - c],
		[r[2] + c, r[3] + c],
		[r[0] - c, r[3] + c],
	]


## The portals, in order: every door (its point at its floor's
## elevation, rooms `a` and `b`), then per stair its foot (in `from`) and
## head (in `to`). Each `{kind, id, pos: [x, y, z], rooms}`.
static func portals(house: Dictionary) -> Array:
	var out: Array = []
	for door: Dictionary in house.get("doors", []):
		var at: Array = door["at"]
		out.append({
			"kind": "door", "id": str(door["id"]),
			"pos": [float(at[0]), HouseGeometry.room_elevation(house, str(door["a"])), float(at[1])],
			"rooms": [str(door["a"])] if door.get("b") == null else [str(door["a"]), str(door["b"])],
		})
	for stair: Dictionary in house.get("stairs", []):
		var ends := HouseGeometry.stair_ends(stair)
		var foot: Array = ends["foot"]
		var head: Array = ends["head"]
		out.append({
			"kind": "foot", "id": str(stair["id"]),
			"pos": [foot[0], HouseGeometry.room_elevation(house, str(stair["from"])), foot[1]],
			"rooms": [str(stair["from"])],
		})
		out.append({
			"kind": "head", "id": str(stair["id"]),
			"pos": [head[0], HouseGeometry.room_elevation(house, str(stair["to"])), head[1]],
			"rooms": [str(stair["to"])],
		})
	return out


## Point in polygon, the boundary (± [constant ROUTE_EPS]) counting as inside.
static func _inside_poly(poly: Array, p: Array) -> bool:
	return HouseGeometry.distance_to_boundary(poly, p) <= ROUTE_EPS or HouseGeometry.point_in_poly_strict(poly, p)


## A room's corner waypoints `[x, z]`: each reflex vertex `v` (vertex order)
## moved to `v − 0.35 · (u_prev + u_next)`, where `u_prev` / `u_next` are the
## unit vectors from `v` toward its two neighbours — for a rectilinear
## corner, 0.35 m into the room along each axis. Kept only when inside the room.
static func reflex_waypoints(poly: Array) -> Array:
	var n := poly.size()
	var area := 0.0
	for i in n:
		var a: Array = poly[i]
		var b: Array = poly[(i + 1) % n]
		area += a[0] * b[1] - b[0] * a[1]
	var out: Array = []
	for i in n:
		var p: Array = poly[(i + n - 1) % n]
		var v: Array = poly[i]
		var q: Array = poly[(i + 1) % n]
		var cross: float = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0])
		# Reflex: the turn goes against the winding (a straight vertex is not).
		if cross == 0.0 or (cross > 0.0) == (area > 0.0):
			continue
		var lp := sqrt((p[0] - v[0]) * (p[0] - v[0]) + (p[1] - v[1]) * (p[1] - v[1]))
		var lq := sqrt((q[0] - v[0]) * (q[0] - v[0]) + (q[1] - v[1]) * (q[1] - v[1]))
		if lp == 0.0 or lq == 0.0:
			continue
		var w := [
			v[0] - ROUTE_CLEARANCE * ((p[0] - v[0]) / lp + (q[0] - v[0]) / lq),
			v[1] - ROUTE_CLEARANCE * ((p[1] - v[1]) / lp + (q[1] - v[1]) / lq),
		]
		if _inside_poly(poly, w):
			out.append(w)
	return out


## The route graph's nodes, in order: the portals ([method portals]) — every
## door but a guarded one (`guard`: shut until its king falls), then
## per room (array order) its reflex waypoints ([method reflex_waypoints]),
## then per stair (array order) the four corners of its rect moved 0.35 m
## outward along each axis (`[x0, z0] [x1, z0] [x1, z1] [x0, z1]` order) —
## first as waypoints of the upper room (`to`, round the hole), then of the
## lower room (`from`, round the ramp), each only when inside that room;
## then per solid prop (array order) the four corners of its obstacle
## ([method prop_obstacle]) moved 0.35 m outward along each axis, same
## order, as waypoints of the prop's room — each only when inside that room
## and strictly inside none of its obstacles ([method room_obstacles]). A
## waypoint (`kind` "corner", `id` its room) stands at its room's floor
## elevation and is in that room only.
static func route_nodes(house: Dictionary) -> Array:
	var out: Array = []
	# A guarded door (`guard`: a king standing in it) is shut for routing:
	# its portal is left out, so nothing paths through it.
	var guarded := {}
	for door: Dictionary in house.get("doors", []):
		if door.get("guard") != null:
			guarded[str(door["id"])] = true
	for p: Dictionary in portals(house):
		if str(p["kind"]) == "door" and guarded.has(str(p["id"])):
			continue
		out.append({"kind": p["kind"], "id": p["id"], "pos": (p["pos"] as Array).duplicate(), "rooms": (p["rooms"] as Array).duplicate()})
	for room: Dictionary in house.get("rooms", []):
		for w: Array in reflex_waypoints(room["poly"]):
			out.append(_corner(house, room, w))
	for stair: Dictionary in house.get("stairs", []):
		var corners := _outer_corners(stair["rect"])
		for id: String in [str(stair["to"]), str(stair["from"])]:
			var room: Variant = HouseGeometry.room_by_id(house, id)
			if room == null:
				continue
			for w: Array in corners:
				if _inside_poly(room["poly"], w):
					out.append(_corner(house, room, w))
	for prop: Dictionary in house.get("props", []):
		if not HouseGeometry.prop_solid(prop):
			continue
		var room: Variant = HouseGeometry.room_by_id(house, str(prop.get("room", "")))
		if room == null:
			continue
		var obstacles := room_obstacles(house, str(room["id"]))
		for w: Array in _outer_corners(prop_obstacle(prop)):
			if not _inside_poly(room["poly"], w):
				continue
			var blocked := false
			for r: Array in obstacles:
				if _in_open_rect(r, w):
					blocked = true
					break
			if not blocked:
				out.append(_corner(house, room, w))
	return out


static func _corner(house: Dictionary, room: Dictionary, w: Array) -> Dictionary:
	return {
		"kind": "corner", "id": str(room["id"]),
		"pos": [w[0], HouseGeometry.room_elevation(house, room), w[1]],
		"rooms": [str(room["id"])],
	}


## A room's obstacles `[x0, z0, x1, z1]`, in order: the rect of every stair
## it is the upper or lower room of (array order), shrunk by 0.01 m; then
## every solid prop of the room (`prop.room`, array order) as its
## [method prop_obstacle], not shrunk.
static func room_obstacles(house: Dictionary, room: String) -> Array:
	var out: Array = []
	for s: Dictionary in house.get("stairs", []):
		if str(s["to"]) != room and str(s["from"]) != room:
			continue
		var r: Array = s["rect"]
		out.append([r[0] + OBSTACLE_SHRINK, r[1] + OBSTACLE_SHRINK, r[2] - OBSTACLE_SHRINK, r[3] - OBSTACLE_SHRINK])
	for p: Dictionary in house.get("props", []):
		if str(p.get("room", "")) == room and HouseGeometry.prop_solid(p):
			out.append(prop_obstacle(p))
	return out


## `(b − a) × (c − a)` in plan.
static func _orient(a: Array, b: Array, c: Array) -> float:
	return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


## Strictly opposite signs, each beyond [constant ROUTE_EPS].
static func _opposite(s: float, t: float) -> bool:
	return (s > ROUTE_EPS and t < -ROUTE_EPS) or (s < -ROUTE_EPS and t > ROUTE_EPS)


## `ab` and `cd` cross at a single point interior to both (touching / collinear is not a crossing).
static func properly_cross(a: Array, b: Array, c: Array, d: Array) -> bool:
	return _opposite(_orient(a, b, c), _orient(a, b, d)) and _opposite(_orient(c, d, a), _orient(c, d, b))


## Whether the plan segment `ab` runs through the open rect `[x0, z0, x1,
## z1]`: Liang–Barsky clips it to the closed rect, and the clipped part must
## be longer than [constant ROUTE_EPS] (a segment along an edge line, or
## touching a corner, does not count).
static func segment_hits_rect(a: Array, b: Array, rect: Array) -> bool:
	var dx: float = b[0] - a[0]
	var dz: float = b[1] - a[1]
	var ps := [-dx, dx, -dz, dz]
	var qs := [a[0] - rect[0], rect[2] - a[0], a[1] - rect[1], rect[3] - a[1]]
	var t0 := 0.0
	var t1 := 1.0
	for k in 4:
		var p: float = ps[k]
		var q: float = qs[k]
		if p == 0.0:
			if q <= ROUTE_EPS:
				return false
			continue
		var t := q / p
		if p < 0.0:
			if t > t0:
				t0 = t
		elif t < t1:
			t1 = t
	return (t1 - t0) * sqrt(dx * dx + dz * dz) > ROUTE_EPS


## Whether `a` sees `b` (`[x, y, z]`) inside `room`: the plan segment
## properly crosses no edge of the room's polygon, its midpoint is in the
## polygon (boundary counts), and it runs through none of the room's
## obstacles — except an obstacle containing `a` or `b` (strictly), which
## is ignored (someone standing on a stair, a duck on the counter).
static func visible_in(house: Dictionary, room: Dictionary, a: Array, b: Array) -> bool:
	var pa := [a[0], a[2]]
	var pb := [b[0], b[2]]
	var poly: Array = room["poly"]
	for i in poly.size():
		if properly_cross(pa, pb, poly[i], poly[(i + 1) % poly.size()]):
			return false
	if not _inside_poly(poly, [(pa[0] + pb[0]) / 2.0, (pa[1] + pb[1]) / 2.0]):
		return false
	for r: Array in room_obstacles(house, str(room["id"])):
		if _in_open_rect(r, pa) or _in_open_rect(r, pb):
			continue
		if segment_hits_rect(pa, pb, r):
			return false
	return true


static func _in_open_rect(r: Array, p: Array) -> bool:
	return p[0] > r[0] and p[0] < r[2] and p[1] > r[1] and p[1] < r[3]


static func distance3(a: Array, b: Array) -> float:
	var x: float = a[0] - b[0]
	var y: float = a[1] - b[1]
	var z: float = a[2] - b[2]
	return sqrt(x * x + y * y + z * z)


## Whether nodes `i` and `j` are joined: foot↔head of one stair, or a shared
## room in which they see each other.
static func _adjacent(house: Dictionary, ns: Array, i: int, j: int) -> bool:
	var a: Dictionary = ns[i]
	var b: Dictionary = ns[j]
	if (a["kind"] == "foot" and b["kind"] == "head") or (a["kind"] == "head" and b["kind"] == "foot"):
		if a["id"] == b["id"]:
			return true
	for r: String in a["rooms"]:
		if not (b["rooms"] as Array).has(r):
			continue
		var room: Variant = HouseGeometry.room_by_id(house, r)
		if room != null and visible_in(house, room, a["pos"], b["pos"]):
			return true
	return false


## `[from, …node points, to]` (points `[x, y, z]`). An unlocatable end ⇒
## `[from, to]`; the same room and visible ⇒ `[from, to]`; no path ⇒
## `[from, to]`.
##
## Dijkstra from a virtual start (joined to every node of the start room it
## sees) to a virtual end (joined from every node of the end room that sees
## it); weights are 3-D distances. Nodes settle in order of (distance,
## index) — the end node's index is after every node — and relaxation is
## strict `<`, so ties go to the lower node index.
static func route(house: Dictionary, from: Array, to: Array) -> Array:
	var a: Variant = HouseLocate.locate(house, from)["room"]
	var b: Variant = HouseLocate.locate(house, to)["room"]
	if a == null or b == null:
		return [from, to]
	var room_a: Variant = HouseGeometry.room_by_id(house, a)
	var room_b: Variant = HouseGeometry.room_by_id(house, b)
	if room_a == null or room_b == null:
		return [from, to]
	if a == b and visible_in(house, room_a, from, to):
		return [from, to]

	var ns := route_nodes(house)
	var n := ns.size()
	var end := n
	var dist: Array = []
	var prev: Array = []
	var done: Array = []
	dist.resize(n + 1)
	prev.resize(n + 1)
	done.resize(n + 1)
	dist.fill(INF)
	prev.fill(-1)
	done.fill(false)
	for i in n:
		if (ns[i]["rooms"] as Array).has(a) and visible_in(house, room_a, from, ns[i]["pos"]):
			dist[i] = distance3(from, ns[i]["pos"])

	while true:
		var u := -1
		for i in n + 1:
			if done[i] or dist[i] == INF:
				continue
			if u < 0 or dist[i] < dist[u]:
				u = i
		if u < 0 or u == end:
			break
		done[u] = true
		var du: float = dist[u]
		for v in n:
			if done[v] or v == u or not _adjacent(house, ns, u, v):
				continue
			var d := du + distance3(ns[u]["pos"], ns[v]["pos"])
			if d < dist[v]:
				dist[v] = d
				prev[v] = u
		if (ns[u]["rooms"] as Array).has(b) and visible_in(house, room_b, ns[u]["pos"], to):
			var d := du + distance3(ns[u]["pos"], to)
			if d < dist[end]:
				dist[end] = d
				prev[end] = u

	if dist[end] == INF:
		return [from, to]
	var chain: Array = []
	var i: int = prev[end]
	while i >= 0:
		chain.push_front((ns[i]["pos"] as Array).duplicate())
		i = prev[i]
	var out: Array = [from]
	out.append_array(chain)
	out.append(to)
	return out


## The yaw (degrees, §1 convention) of the plan heading from `a` to `b`.
static func yaw_toward(a: Array, b: Array) -> float:
	return rad_to_deg(atan2(-(b[0] - a[0]), -(b[2] - a[2])))


## Total length of a polyline.
static func path_length(path: Array) -> float:
	var total := 0.0
	for i in range(1, path.size()):
		total += distance3(path[i - 1], path[i])
	return total


## Points every `step` metres along a polyline (from its start, excluding
## it), each `{p, yaw}` with the heading of its leg — the chevron trail.
static func sample_trail(path: Array, step := 0.75) -> Array:
	var out: Array = []
	var carry := step
	for i in range(1, path.size()):
		var a: Array = path[i - 1]
		var b: Array = path[i]
		var length := distance3(a, b)
		if length <= 0.0:
			continue
		var yaw := yaw_toward(a, b)
		var s := carry
		while s <= length:
			var f := s / length
			out.append({
				"p": [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f],
				"yaw": yaw,
			})
			s += step
		carry = s - length
	return out
