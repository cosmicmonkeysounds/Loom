## Procedural geometry from a house map — `docs/loom-reinstall.md` §1.2,
## a literal port of `house/src/geometry.ts` (the normative reference). The
## goldens in `res://test/golden/` diff [method build_walls] against it.
##
## A house is the parsed JSON (a [Dictionary]); plan points are `[x, z]`
## and points `[x, y, z]` [Array]s of [float] — 64-bit, unlike [Vector3],
## so millimetre rounding and route ties agree with the reference.
##
## Wall maths runs in **integer millimetres** ([method mmi]):
## `mmi(v) = floor(v · 1000 + 0.5)` — never `round()`, which rounds halves
## away from zero.
class_name HouseGeometry
extends RefCounted

## Plan tolerance for "on the boundary" tests.
const EPS := 1e-9
const DEFAULT_FENCE := 1.0
## Rendering only (colliders use it too, as a thickness).
const DEFAULT_WALL_THICKNESS := 0.1
const DEFAULT_DOOR_HEIGHT := 2.0
const RAIL_HEIGHT := 1.0
## How far a door point may sit off its wall line.
const DOOR_TOLERANCE := 0.02


## Integer millimetres.
static func mmi(v: float) -> int:
	return int(floor(v * 1000.0 + 0.5))


## Round to 1 mm.
static func mm(v: float) -> float:
	return mmi(v) / 1000.0


# --- lookups ---------------------------------------------------------------


static func floor_by_id(house: Dictionary, id: String) -> Variant:
	for f: Dictionary in house.get("floors", []):
		if str(f["id"]) == id:
			return f
	return null


static func room_by_id(house: Dictionary, id: Variant) -> Variant:
	if id == null:
		return null
	for r: Dictionary in house.get("rooms", []):
		if str(r["id"]) == str(id):
			return r
	return null


## A room's floor elevation (0 for an unknown room / floor). Takes a room
## [Dictionary] or a room id.
static func room_elevation(house: Dictionary, room: Variant) -> float:
	var r: Variant = room if room is Dictionary else room_by_id(house, room)
	if r == null:
		return 0.0
	var f: Variant = floor_by_id(house, str(r["floor"]))
	return float(f["elevation"]) if f != null else 0.0


## A room's height: its own, else its floor's.
static func room_height(house: Dictionary, room: Dictionary) -> float:
	if room.get("height") != null:
		return float(room["height"])
	var f: Variant = floor_by_id(house, str(room["floor"]))
	return float(f["height"]) if f != null else 0.0


## Style with the defaults filled: `{fence, wallThickness, doorHeight}`.
static func style_of(house: Dictionary) -> Dictionary:
	var s: Variant = house.get("style")
	var style: Dictionary = s if s is Dictionary else {}
	return {
		"fence": float(style["fence"]) if style.get("fence") != null else DEFAULT_FENCE,
		"wallThickness": float(style["wallThickness"]) if style.get("wallThickness") != null else DEFAULT_WALL_THICKNESS,
		"doorHeight": float(style["doorHeight"]) if style.get("doorHeight") != null else DEFAULT_DOOR_HEIGHT,
	}


## Whether a prop collides: `solid`, else true for box / cylinder / king.
static func prop_solid(prop: Dictionary) -> bool:
	if prop.get("solid") != null:
		return bool(prop["solid"])
	var kind := str(prop.get("kind", ""))
	return kind == "box" or kind == "cylinder" or kind == "king"


## Whether a plan point is inside a prop's footprint (boundary counts): a
## cylinder's disc (radius `max(w, d) / 2`) or a box's yawed `w × d`
## rectangle about `pos` — the shapes the games collide with.
static func in_prop_footprint(prop: Dictionary, p: Array) -> bool:
	var size: Array = prop["size"]
	var pos: Array = prop["pos"]
	var w := float(size[0])
	var d := float(size[2])
	var rx: float = float(p[0]) - float(pos[0])
	var rz: float = float(p[1]) - float(pos[2])
	if str(prop.get("kind", "")) == "cylinder":
		return sqrt(rx * rx + rz * rz) <= maxf(w, d) / 2.0 + EPS
	# Into the prop's frame (inverse of its yaw about +y).
	var r := deg_to_rad(float(prop.get("yaw", 0.0)) if prop.get("yaw") != null else 0.0)
	var lx := rx * cos(r) - rz * sin(r)
	var lz := rx * sin(r) + rz * cos(r)
	return absf(lx) <= w / 2.0 + EPS and absf(lz) <= d / 2.0 + EPS


# --- plan helpers ----------------------------------------------------------


## Distance from a plan point to the segment `a → b`.
static func distance_to_segment(p: Array, a: Array, b: Array) -> float:
	var dx: float = b[0] - a[0]
	var dz: float = b[1] - a[1]
	var len2 := dx * dx + dz * dz
	var t: float = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 if len2 > 0.0 else 0.0
	t = clampf(t, 0.0, 1.0)
	var x: float = a[0] + t * dx - p[0]
	var z: float = a[1] + t * dz - p[1]
	return sqrt(x * x + z * z)


## Distance from a plan point to the polygon's boundary.
static func distance_to_boundary(poly: Array, p: Array) -> float:
	var best := INF
	var n := poly.size()
	for i in n:
		var d := distance_to_segment(p, poly[i], poly[(i + 1) % n])
		if d < best:
			best = d
	return best


## Point in polygon; the boundary counts as inside.
static func point_in_poly(poly: Array, p: Array) -> bool:
	if distance_to_boundary(poly, p) <= EPS:
		return true
	return point_in_poly_strict(poly, p)


## Point in polygon by crossing number.
static func point_in_poly_strict(poly: Array, p: Array) -> bool:
	var inside := false
	var n := poly.size()
	for i in n:
		var a: Array = poly[i]
		var b: Array = poly[(i + 1) % n]
		if (a[1] > p[1]) != (b[1] > p[1]):
			var x: float = (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
			if p[0] < x:
				inside = not inside
	return inside


## Point in `[x0, z0, x1, z1]`; the boundary counts.
static func point_in_rect(rect: Array, p: Array) -> bool:
	return (
		p[0] >= rect[0] - EPS and p[0] <= rect[2] + EPS
		and p[1] >= rect[1] - EPS and p[1] <= rect[3] + EPS
	)


## Point strictly inside `[x0, z0, x1, z1]` (the open rect — a stair hole).
static func point_in_rect_strict(rect: Array, p: Array) -> bool:
	return (
		p[0] > rect[0] + EPS and p[0] < rect[2] - EPS
		and p[1] > rect[1] + EPS and p[1] < rect[3] - EPS
	)


## The rect as a 4-point polygon, plan order `[x0,z0] [x1,z0] [x1,z1] [x0,z1]`.
static func rect_poly(rect: Array) -> Array:
	return [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]]


## Axis-aligned bounds `[x0, z0, x1, z1]`.
static func poly_bounds(poly: Array) -> Array:
	var b := [INF, INF, -INF, -INF]
	for p: Array in poly:
		b[0] = minf(b[0], p[0])
		b[1] = minf(b[1], p[1])
		b[2] = maxf(b[2], p[0])
		b[3] = maxf(b[3], p[1])
	return b


## Sorted distinct coordinates at 1 mm (for cell decompositions).
static func breakpoints(values: Array) -> Array:
	var keys := {}
	for v: float in values:
		keys[mmi(v)] = true
	var sorted := keys.keys()
	sorted.sort()
	var out := []
	for k: int in sorted:
		out.append(k / 1000.0)
	return out


# --- stairs ----------------------------------------------------------------


## 0 at the foot edge → 1 at the `up` edge, clamped.
static func ramp_fraction(rect: Array, up: String, p: Array) -> float:
	var x0: float = rect[0]
	var z0: float = rect[1]
	var x1: float = rect[2]
	var z1: float = rect[3]
	var f: float
	if up == "n":
		f = (z1 - p[1]) / (z1 - z0)
	elif up == "s":
		f = (p[1] - z0) / (z1 - z0)
	elif up == "e":
		f = (p[0] - x0) / (x1 - x0)
	else:
		f = (x1 - p[0]) / (x1 - x0)
	return clampf(f, 0.0, 1.0)


## `{low, high}`: the `from` and `to` floor elevations.
static func stair_levels(house: Dictionary, stair: Dictionary) -> Dictionary:
	return {
		"low": room_elevation(house, str(stair["from"])),
		"high": room_elevation(house, str(stair["to"])),
	}


## Ramp surface height at a plan point (clamped to the rect's span).
static func ramp_height(house: Dictionary, stair: Dictionary, p: Array) -> float:
	var lv := stair_levels(house, stair)
	return lv["low"] + (lv["high"] - lv["low"]) * ramp_fraction(stair["rect"], str(stair["up"]), p)


## `{foot, head}`: centres of the foot edge (opposite `up`) and the head edge.
static func stair_ends(stair: Dictionary) -> Dictionary:
	var r: Array = stair["rect"]
	var cx: float = (r[0] + r[2]) / 2.0
	var cz: float = (r[1] + r[3]) / 2.0
	var n := [cx, float(r[1])]
	var s := [cx, float(r[3])]
	var e := [float(r[2]), cz]
	var w := [float(r[0]), cz]
	match str(stair["up"]):
		"n":
			return {"foot": s, "head": n}
		"s":
			return {"foot": n, "head": s}
		"e":
			return {"foot": w, "head": e}
	return {"foot": e, "head": w}


# --- buildWalls (§1.2 steps 1–7) -------------------------------------------


## The house's walls, fences, door lintels and stair rails as axis-aligned
## segments `{floor, axis, c, lo, hi, bottom, top, kind}` — deterministic and
## sorted (floor order, axis, c, lo, kind, hi, top), every number at 1 mm.
static func build_walls(house: Dictionary) -> Array:
	var style := style_of(house)

	# 1. Edges.
	var edges: Array = []
	for room: Dictionary in house.get("rooms", []):
		var poly: Array = room["poly"]
		var n := poly.size()
		for i in n:
			var p: Array = poly[i]
			var q: Array = poly[(i + 1) % n]
			var px := mmi(p[0])
			var pz := mmi(p[1])
			var qx := mmi(q[0])
			var qz := mmi(q[1])
			if px == qx and pz == qz:
				continue
			if pz == qz:
				edges.append({"floor": str(room["floor"]), "axis": "x", "c": pz, "lo": mini(px, qx), "hi": maxi(px, qx), "room": room})
			elif px == qx:
				edges.append({"floor": str(room["floor"]), "axis": "z", "c": px, "lo": mini(pz, qz), "hi": maxi(pz, qz), "room": room})
			# a diagonal edge is not a wall (validateHouse refuses it)

	# 2. Lines, in first-seen order (the output is sorted at the end).
	var lines := {}
	for e: Dictionary in edges:
		var key := "%s|%s|%d" % [e["floor"], e["axis"], e["c"]]
		if lines.has(key):
			lines[key].append(e)
		else:
			lines[key] = [e]

	# 3–4. Elementary pieces, merged.
	var pieces: Array = []
	for line: Array in lines.values():
		var first: Dictionary = line[0]
		var fl: Variant = floor_by_id(house, first["floor"])
		var elevation: float = float(fl["elevation"]) if fl != null else 0.0
		var bottom := mmi(elevation)
		var cut_set := {}
		for e: Dictionary in line:
			cut_set[e["lo"]] = true
			cut_set[e["hi"]] = true
		var cuts := cut_set.keys()
		cuts.sort()
		var run: Array = []
		for i in range(cuts.size() - 1):
			var u: int = cuts[i]
			var v: int = cuts[i + 1]
			var height := -INF
			var all_outdoor := true
			var any := false
			for e: Dictionary in line:
				if e["lo"] > u or e["hi"] < v:
					continue
				any = true
				var room: Dictionary = e["room"]
				if room.get("outdoor") == true:
					height = maxf(height, style["fence"])
				else:
					all_outdoor = false
					var h: float
					if room.get("height") != null:
						h = float(room["height"])
					elif fl != null:
						h = float(fl["height"])
					else:
						h = 0.0
					height = maxf(height, h)
			if not any:
				continue
			var piece := {
				"floor": first["floor"], "axis": first["axis"], "c": first["c"],
				"lo": u, "hi": v, "bottom": bottom, "top": mmi(elevation + height),
				"kind": "fence" if all_outdoor else "wall",
			}
			var prev: Variant = run.back() if not run.is_empty() else null
			if prev != null and prev["kind"] == piece["kind"] and prev["top"] == piece["top"] and prev["hi"] == piece["lo"]:
				prev["hi"] = piece["hi"]
			else:
				run.append(piece)
		pieces.append_array(run)

	# 5. Doors.
	for door: Dictionary in house.get("doors", []):
		var room: Variant = room_by_id(house, door["a"])
		if room == null:
			continue
		var fl: Variant = floor_by_id(house, str(room["floor"]))
		var elevation: float = float(fl["elevation"]) if fl != null else 0.0
		var at: Array = door["at"]
		for axis: String in ["x", "z"]:
			var coord: float = at[1] if axis == "x" else at[0]
			var t: float = at[0] if axis == "x" else at[1]
			var tm := mmi(t)
			var hit := -1
			var hit_dist := INF
			for i in pieces.size():
				var s: Dictionary = pieces[i]
				if s["floor"] != room["floor"] or s["axis"] != axis:
					continue
				if s["kind"] != "wall" and s["kind"] != "fence":
					continue
				var dist := absf(s["c"] - coord * 1000.0)
				if dist > DOOR_TOLERANCE * 1000.0 + 1e-6:
					continue
				if tm < s["lo"] or tm > s["hi"]:
					continue
				if dist < hit_dist or (dist == hit_dist and s["c"] < pieces[hit]["c"]):
					hit = i
					hit_dist = dist
			if hit < 0:
				continue
			var seg: Dictionary = pieces[hit]
			var width := float(door["width"])
			var gap_lo := maxi(seg["lo"], mmi(t - width / 2.0))
			var gap_hi := mini(seg["hi"], mmi(t + width / 2.0))
			var keep: Array = []
			if gap_lo > seg["lo"]:
				var a := seg.duplicate()
				a["hi"] = gap_lo
				keep.append(a)
			if seg["hi"] > gap_hi:
				var b := seg.duplicate()
				b["lo"] = gap_hi
				keep.append(b)
			var door_height: float = float(door["height"]) if door.get("height") != null else style["doorHeight"]
			var door_top := mmi(elevation + door_height)
			if seg["kind"] == "wall" and door_top < seg["top"] and gap_hi > gap_lo:
				var l := seg.duplicate()
				l["lo"] = gap_lo
				l["hi"] = gap_hi
				l["bottom"] = door_top
				l["kind"] = "lintel"
				keep.append(l)
			pieces.remove_at(hit)
			for k in keep.size():
				pieces.insert(hit + k, keep[k])
			break

	# 6. Rails.
	for stair: Dictionary in house.get("stairs", []):
		var upper: Variant = room_by_id(house, stair["to"])
		if upper == null:
			continue
		var fl: Variant = floor_by_id(house, str(upper["floor"]))
		var elevation: float = float(fl["elevation"]) if fl != null else 0.0
		var bottom := mmi(elevation)
		var top := mmi(elevation + RAIL_HEIGHT)
		var r: Array = stair["rect"]
		var sides := [
			{"side": "n", "axis": "x", "c": r[1], "lo": r[0], "hi": r[2]},
			{"side": "s", "axis": "x", "c": r[3], "lo": r[0], "hi": r[2]},
			{"side": "e", "axis": "z", "c": r[2], "lo": r[1], "hi": r[3]},
			{"side": "w", "axis": "z", "c": r[0], "lo": r[1], "hi": r[3]},
		]
		for s: Dictionary in sides:
			if s["side"] == str(stair["up"]):
				continue
			pieces.append({
				"floor": str(upper["floor"]), "axis": s["axis"], "c": mmi(s["c"]),
				"lo": mmi(s["lo"]), "hi": mmi(s["hi"]), "bottom": bottom, "top": top, "kind": "rail",
			})

	# 7. Output, sorted.
	var order := {}
	var floors: Array = house.get("floors", [])
	for i in floors.size():
		order[str(floors[i]["id"])] = i
	pieces.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return _compare_pieces(a, b, order) < 0)
	var out: Array = []
	for s: Dictionary in pieces:
		out.append({
			"floor": s["floor"], "axis": s["axis"],
			"c": s["c"] / 1000.0, "lo": s["lo"] / 1000.0, "hi": s["hi"] / 1000.0,
			"bottom": s["bottom"] / 1000.0, "top": s["top"] / 1000.0, "kind": s["kind"],
		})
	return out


static func _compare_pieces(a: Dictionary, b: Dictionary, order: Dictionary) -> int:
	var d: int = int(order.get(a["floor"], 0)) - int(order.get(b["floor"], 0))
	if d != 0:
		return d
	d = _cmp(a["axis"], b["axis"])
	if d != 0:
		return d
	for key: String in ["c", "lo"]:
		d = int(a[key]) - int(b[key])
		if d != 0:
			return d
	d = _cmp(a["kind"], b["kind"])
	if d != 0:
		return d
	for key: String in ["hi", "top"]:
		d = int(a[key]) - int(b[key])
		if d != 0:
			return d
	return 0


## Code-point string order.
static func _cmp(a: String, b: String) -> int:
	return -1 if a < b else (1 if a > b else 0)


## The gap a door cuts (`doorGap`): the wall axis + line it sits on (room
## `a`'s own edge, mm-rounded like [method build_walls] step 2) and the
## gap's `lo..hi` (`mmi(t ± width / 2)`), with `bottom` = the room's floor
## elevation and `top` = the door top — a wall segment `{floor, axis, c, lo,
## hi, bottom, top, kind: "wall"}`. Null when no edge of room `a` carries
## the door (± [constant DOOR_TOLERANCE]). The games stand a closed leaf in it.
static func door_gap(house: Dictionary, door: Dictionary) -> Variant:
	var room: Variant = room_by_id(house, door.get("a"))
	if room == null:
		return null
	var fl: Variant = floor_by_id(house, str(room["floor"]))
	var elevation: float = float(fl["elevation"]) if fl != null else 0.0
	var poly: Array = room["poly"]
	var n := poly.size()
	var at: Array = door["at"]
	var best: Dictionary = {}
	for axis: String in ["x", "z"]:
		var coord: float = float(at[1]) if axis == "x" else float(at[0])
		var tm := mmi(float(at[0]) if axis == "x" else float(at[1]))
		for i in n:
			var p: Array = poly[i]
			var q: Array = poly[(i + 1) % n]
			var p_along := mmi(float(p[0]) if axis == "x" else float(p[1]))
			var q_along := mmi(float(q[0]) if axis == "x" else float(q[1]))
			var p_across := mmi(float(p[1]) if axis == "x" else float(p[0]))
			var q_across := mmi(float(q[1]) if axis == "x" else float(q[0]))
			if p_across != q_across or p_along == q_along:
				continue
			var dist := absf(p_across - coord * 1000.0)
			if dist > DOOR_TOLERANCE * 1000.0 + 1e-6:
				continue
			if tm < mini(p_along, q_along) or tm > maxi(p_along, q_along):
				continue
			if best.is_empty() or dist < float(best["dist"]) or (dist == float(best["dist"]) and p_across < int(best["c"])):
				best = {"axis": axis, "c": p_across, "dist": dist}
		if not best.is_empty():
			break
	if best.is_empty():
		return null
	var t: float = float(at[0]) if best["axis"] == "x" else float(at[1])
	var height: float = float(door["height"]) if door.get("height") != null else float(style_of(house)["doorHeight"])
	return {
		"floor": str(room["floor"]), "axis": best["axis"], "c": int(best["c"]) / 1000.0,
		"lo": mmi(t - float(door["width"]) / 2.0) / 1000.0, "hi": mmi(t + float(door["width"]) / 2.0) / 1000.0,
		"bottom": mmi(elevation) / 1000.0, "top": mmi(elevation + height) / 1000.0, "kind": "wall",
	}


## A wall segment's plan end points `[a, b]`.
static func wall_ends(w: Dictionary) -> Array:
	if w["axis"] == "x":
		return [[w["lo"], w["c"]], [w["hi"], w["c"]]]
	return [[w["c"], w["lo"]], [w["c"], w["hi"]]]


# --- buildFloors / buildRamps ----------------------------------------------


## One floor plane per room at its floor's elevation (holes: the stairs
## rising into it), and for an indoor room a ceiling at elevation + height
## (holes: the stairs rising out of it). `{room, floor, kind, y, poly,
## holes, outdoor, color}` — triangulation is the builder's.
static func build_floors(house: Dictionary) -> Array:
	var out: Array = []
	var stairs: Array = house.get("stairs", [])
	for room: Dictionary in house.get("rooms", []):
		var elevation := room_elevation(house, room)
		var outdoor: bool = room.get("outdoor") == true
		var color: Variant = room.get("color")
		var floor_holes: Array = []
		var ceiling_holes: Array = []
		for s: Dictionary in stairs:
			if str(s["to"]) == str(room["id"]):
				floor_holes.append(rect_poly(s["rect"]))
			if str(s["from"]) == str(room["id"]):
				ceiling_holes.append(rect_poly(s["rect"]))
		out.append({
			"room": str(room["id"]), "floor": str(room["floor"]), "kind": "floor", "y": elevation,
			"poly": room["poly"].duplicate(true), "holes": floor_holes, "outdoor": outdoor, "color": color,
		})
		if not outdoor:
			out.append({
				"room": str(room["id"]), "floor": str(room["floor"]), "kind": "ceiling",
				"y": elevation + room_height(house, room),
				"poly": room["poly"].duplicate(true), "holes": ceiling_holes, "outdoor": false, "color": color,
			})
	return out


## Per stair, the sloped quad: `{stair, from, to, up, rect, low, high,
## corners}`, corners `[x, y, z]` in plan order `[x0,z0] [x1,z0] [x1,z1] [x0,z1]`.
static func build_ramps(house: Dictionary) -> Array:
	var out: Array = []
	for stair: Dictionary in house.get("stairs", []):
		var lv := stair_levels(house, stair)
		var corners: Array = []
		for p: Array in rect_poly(stair["rect"]):
			var f := ramp_fraction(stair["rect"], str(stair["up"]), p)
			corners.append([float(p[0]), lv["low"] + (lv["high"] - lv["low"]) * f, float(p[1])])
		out.append({
			"stair": str(stair["id"]), "from": str(stair["from"]), "to": str(stair["to"]),
			"up": str(stair["up"]), "rect": stair["rect"].duplicate(), "low": lv["low"], "high": lv["high"],
			"corners": corners,
		})
	return out


## Rectangular cells covering a rectilinear polygon minus rect holes, as
## `[x0, z0, x1, z1]` — the builder's "triangulation" (each cell is two
## triangles and one box collider), exact for every map the validator accepts.
static func cells(poly: Array, holes: Array) -> Array:
	var xs_in: Array = []
	var zs_in: Array = []
	for p: Array in poly:
		xs_in.append(p[0])
		zs_in.append(p[1])
	for h: Array in holes:
		for p: Array in h:
			xs_in.append(p[0])
			zs_in.append(p[1])
	var xs := breakpoints(xs_in)
	var zs := breakpoints(zs_in)
	var out: Array = []
	for j in range(zs.size() - 1):
		# Merge runs along x so a plain room is one cell per z band.
		var start := -1
		for i in range(xs.size()):
			var inside := false
			if i < xs.size() - 1:
				var c := [(xs[i] + xs[i + 1]) / 2.0, (zs[j] + zs[j + 1]) / 2.0]
				inside = point_in_poly_strict(poly, c)
				for h: Array in holes:
					if inside and point_in_poly_strict(h, c):
						inside = false
			if inside and start < 0:
				start = i
			elif not inside and start >= 0:
				out.append([xs[start], zs[j], xs[i], zs[j + 1]])
				start = -1
	return out
