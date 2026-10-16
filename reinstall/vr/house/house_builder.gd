## Builds the virtual house from a map (`docs/loom-reinstall.md` §1, §5):
## walls / fences / lintels / rails from [method HouseGeometry.build_walls],
## floors (stair holes cut) and starfield ceilings from
## [method HouseGeometry.build_floors], ramps, props, the terminals as
## glowing screens, and a floating label per room — each solid piece with a
## [StaticBody3D] collider, so the player's [CharacterBody3D] walks it.
##
## Children are placed in **house coordinates**; this node carries the
## map's `spaces.vr` transform (identity for the procedural build), so its
## children land in the VR world frame and [method to_house] /
## [method to_world] convert.
class_name HouseBuilder
extends Node3D

signal built

## Room labels hang this far under the ceiling (at most 2.2 m up).
const LABEL_DROP := 0.35
## Rail bars are this thick, fence boards at most this (as in three.js).
const RAIL_THICKNESS := 0.05
const FENCE_MAX_THICKNESS := 0.06
## Terminal screens stand this far proud of their wall's face (as in three.js).
const TERMINAL_PROUD := 0.035
## Floor colliders are this thick (below the surface).
const SLAB := 0.2
## How far the outside ground reaches past the house.
const GROUND_MARGIN := 30.0

var house: Dictionary = {}
## The last [method HouseGeometry.build_walls] (house coordinates).
var walls: Array = []
## The `spaces.vr` transform in effect.
var space: Dictionary = HouseFrames.IDENTITY

var _body: StaticBody3D


## (Re)build everything from `map`.
func build(map: Dictionary) -> void:
	clear()
	house = map
	space = HouseFrames.space_of(map, "vr")
	transform = HouseFrames.transform_of(space)
	_body = StaticBody3D.new()
	_body.name = "Colliders"
	add_child(_body)
	walls = HouseGeometry.build_walls(map)
	_build_walls()
	_build_floors()
	_build_ground()
	_build_ramps()
	_build_props()
	_build_terminals()
	_build_labels()
	built.emit()


func clear() -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()
	walls = []
	_body = null


## World (VR space) point → house `[x, y, z]`.
func to_house(world: Vector3) -> Array:
	return HouseFrames.from_space(space, HouseFrames.arr(world))


## House `[x, y, z]` → world (VR space) point.
func to_world(p: Array) -> Vector3:
	return HouseFrames.vec(HouseFrames.to_space(space, p))


## A world yaw → house yaw, and back.
func yaw_to_house(yaw: float) -> float:
	return HouseFrames.yaw_from_space(space, yaw)


func yaw_to_world(yaw: float) -> float:
	return HouseFrames.yaw_to_space(space, yaw)


# --- pieces ------------------------------------------------------------------


func _collide_box(center: Vector3, size: Vector3, basis := Basis.IDENTITY) -> void:
	var shape := BoxShape3D.new()
	shape.size = size
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.transform = Transform3D(basis, center)
	_body.add_child(cs)


func _mesh(st: SurfaceTool, mat: Material, node_name: String) -> void:
	st.generate_normals()
	var mi := MeshInstance3D.new()
	mi.name = node_name
	mi.mesh = st.commit()
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


## Two triangles of a quad whose corners run counter-clockwise seen from
## its front (Godot's front faces are clockwise, so they are emitted reversed).
static func add_quad(st: SurfaceTool, q: Array, uvs: Array) -> void:
	for i: int in [0, 2, 1, 0, 3, 2]:
		st.set_uv(uvs[i])
		st.add_vertex(q[i])


func _build_walls() -> void:
	var tools := {}
	for box: Dictionary in wall_boxes(walls, HouseGeometry.style_of(house)["wallThickness"]):
		var kind := str(box["kind"])
		if not tools.has(kind):
			var st := SurfaceTool.new()
			st.begin(Mesh.PRIMITIVE_TRIANGLES)
			tools[kind] = st
		var lo: Vector3 = box["lo"]
		var hi: Vector3 = box["hi"]
		_box(tools[kind], lo, hi, 1.0 if kind == "fence" else 0.5)
		_collide_box((lo + hi) / 2.0, hi - lo)
	var mats := {"wall": HouseLook.wall(), "lintel": HouseLook.lintel(), "fence": HouseLook.fence(), "rail": HouseLook.rail()}
	for kind: String in tools:
		_mesh(tools[kind], mats[kind], "Walls_%s" % kind)


## Fence boards are thinner than walls; rails are a bar (`wallKindThickness`
## in `@loom/house/three`).
static func wall_kind_thickness(kind: String, wall_thickness: float) -> float:
	if kind == "fence":
		return minf(wall_thickness, FENCE_MAX_THICKNESS)
	if kind == "rail":
		return RAIL_THICKNESS
	return wall_thickness


## Which kinds close a corner together: walls with fences, rails with rails.
static func _joins(a: String, b: String) -> bool:
	var solid := func(k: String) -> bool: return k == "wall" or k == "fence"
	return (solid.call(a) and solid.call(b)) or (a == "rail" and b == "rail")


## One box `{lo, hi, kind}` (house frame) per wall segment, same order — the
## port of `wallBoxes` in `@loom/house/three`. An end that meets a
## perpendicular segment of a joining kind (same floor, overlapping in y)
## is extended by that segment's half thickness, so an L corner has no
## notch; a door gap's jambs are never widened (nothing perpendicular meets
## them), so a door is exactly `width` wide here as on the web.
static func wall_boxes(segments: Array, wall_thickness: float) -> Array:
	var out: Array = []
	for w: Dictionary in segments:
		var kind := str(w["kind"])
		var t := wall_kind_thickness(kind, wall_thickness)
		var lo: float = float(w["lo"]) - _reach(segments, w, float(w["lo"]), wall_thickness)
		var hi: float = float(w["hi"]) + _reach(segments, w, float(w["hi"]), wall_thickness)
		var c: float = w["c"]
		var box_lo: Vector3
		var box_hi: Vector3
		if w["axis"] == "x":
			box_lo = Vector3(lo, w["bottom"], c - t / 2.0)
			box_hi = Vector3(hi, w["top"], c + t / 2.0)
		else:
			box_lo = Vector3(c - t / 2.0, w["bottom"], lo)
			box_hi = Vector3(c + t / 2.0, w["top"], hi)
		out.append({"lo": box_lo, "hi": box_hi, "kind": kind})
	return out


## How far `w`'s end at `end` reaches into the perpendicular segments it meets.
static func _reach(segments: Array, w: Dictionary, end: float, wall_thickness: float) -> float:
	var best := 0.0
	var e := HouseGeometry.mmi(end)
	var wc := HouseGeometry.mmi(float(w["c"]))
	for o: Dictionary in segments:
		if is_same(o, w) or str(o["floor"]) != str(w["floor"]) or o["axis"] == w["axis"] or not _joins(str(w["kind"]), str(o["kind"])):
			continue
		if float(o["top"]) <= float(w["bottom"]) or float(o["bottom"]) >= float(w["top"]):
			continue
		# `o` is perpendicular: it sits at o.c along w's run, spans [lo, hi] across it.
		if HouseGeometry.mmi(float(o["c"])) != e:
			continue
		if HouseGeometry.mmi(float(o["lo"])) > wc or HouseGeometry.mmi(float(o["hi"])) < wc:
			continue
		best = maxf(best, wall_kind_thickness(str(o["kind"]), wall_thickness) / 2.0)
	return best


## An axis-aligned box (five faces — no bottom) into `st`, UVs in tiles.
static func _box(st: SurfaceTool, lo: Vector3, hi: Vector3, tile: float) -> void:
	var x0 := lo.x
	var y0 := lo.y
	var z0 := lo.z
	var x1 := hi.x
	var y1 := hi.y
	var z1 := hi.z
	# Each face's corners run counter-clockwise seen from outside, starting
	# bottom-left; UVs come from the two in-plane coordinates.
	var faces := [
		[Vector3(x0, y0, z1), Vector3(x1, y0, z1), Vector3(x1, y1, z1), Vector3(x0, y1, z1)],  # +z
		[Vector3(x1, y0, z0), Vector3(x0, y0, z0), Vector3(x0, y1, z0), Vector3(x1, y1, z0)],  # −z
		[Vector3(x1, y0, z1), Vector3(x1, y0, z0), Vector3(x1, y1, z0), Vector3(x1, y1, z1)],  # +x
		[Vector3(x0, y0, z0), Vector3(x0, y0, z1), Vector3(x0, y1, z1), Vector3(x0, y1, z0)],  # −x
		[Vector3(x0, y1, z1), Vector3(x1, y1, z1), Vector3(x1, y1, z0), Vector3(x0, y1, z0)],  # +y
	]
	for i in faces.size():
		var q: Array = faces[i]
		var uvs: Array = []
		for p: Vector3 in q:
			var u: float = p.x + p.z if i < 4 else p.x
			var v: float = -p.y if i < 4 else p.z
			uvs.append(Vector2(u, v) / tile)
		add_quad(st, q, uvs)


func _build_floors() -> void:
	var floor_tools := {}
	var ceiling := SurfaceTool.new()
	ceiling.begin(Mesh.PRIMITIVE_TRIANGLES)
	var any_ceiling := false
	for plane: Dictionary in HouseGeometry.build_floors(house):
		var y: float = plane["y"]
		var is_floor: bool = plane["kind"] == "floor"
		var st: SurfaceTool
		if is_floor:
			var mat := HouseLook.floor_for(plane["color"], plane["outdoor"])
			var key := str(mat.get_instance_id())
			if not floor_tools.has(key):
				var s := SurfaceTool.new()
				s.begin(Mesh.PRIMITIVE_TRIANGLES)
				floor_tools[key] = [s, mat]
			st = floor_tools[key][0]
		else:
			st = ceiling
			any_ceiling = true
		for cell: Array in HouseGeometry.cells(plane["poly"], plane["holes"]):
			var x0: float = cell[0]
			var z0: float = cell[1]
			var x1: float = cell[2]
			var z1: float = cell[3]
			var q: Array
			if is_floor:
				q = [Vector3(x0, y, z1), Vector3(x1, y, z1), Vector3(x1, y, z0), Vector3(x0, y, z0)]
				_collide_box(Vector3((x0 + x1) / 2.0, y - SLAB / 2.0, (z0 + z1) / 2.0), Vector3(x1 - x0, SLAB, z1 - z0))
			else:
				q = [Vector3(x0, y, z0), Vector3(x1, y, z0), Vector3(x1, y, z1), Vector3(x0, y, z1)]
			var uvs: Array = []
			for p: Vector3 in q:
				uvs.append(Vector2(p.x, p.z) / (1.0 if is_floor else 4.0))
			add_quad(st, q, uvs)
	for key: String in floor_tools:
		_mesh(floor_tools[key][0], floor_tools[key][1], "Floor")
	if any_ceiling:
		_mesh(ceiling, HouseLook.ceiling(), "Ceilings")


## Ground outside the house on the floor a front door opens from, so a
## program who wanders out of an outside door doesn't fall into the void.
func _build_ground() -> void:
	var floor_id := ""
	for door: Dictionary in house.get("doors", []):
		if door.get("b") == null:
			var r: Variant = HouseGeometry.room_by_id(house, door["a"])
			if r != null:
				floor_id = str(r["floor"])
				break
	if floor_id == "":
		return
	var holes: Array = []
	var pts: Array = []
	for room: Dictionary in house.get("rooms", []):
		if str(room["floor"]) == floor_id:
			holes.append(room["poly"])
			pts.append_array(room["poly"])
	if pts.is_empty():
		return
	var b := HouseGeometry.poly_bounds(pts)
	var outer := HouseGeometry.rect_poly([b[0] - GROUND_MARGIN, b[1] - GROUND_MARGIN, b[2] + GROUND_MARGIN, b[3] + GROUND_MARGIN])
	var fl: Variant = HouseGeometry.floor_by_id(house, floor_id)
	var y: float = float(fl["elevation"]) if fl != null else 0.0
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for cell: Array in HouseGeometry.cells(outer, holes):
		var x0: float = cell[0]
		var z0: float = cell[1]
		var x1: float = cell[2]
		var z1: float = cell[3]
		var q := [Vector3(x0, y, z1), Vector3(x1, y, z1), Vector3(x1, y, z0), Vector3(x0, y, z0)]
		var uvs: Array = []
		for p: Vector3 in q:
			uvs.append(Vector2(p.x, p.z))
		add_quad(st, q, uvs)
		_collide_box(Vector3((x0 + x1) / 2.0, y - SLAB / 2.0, (z0 + z1) / 2.0), Vector3(x1 - x0, SLAB, z1 - z0))
	_mesh(st, HouseLook.ground(), "Ground")


func _build_ramps() -> void:
	for ramp: Dictionary in HouseGeometry.build_ramps(house):
		var corners: Array = []
		for c: Array in ramp["corners"]:
			corners.append(HouseFrames.vec(c))
		# Plan order [x0,z0] [x1,z0] [x1,z1] [x0,z1]: z0 is north, so seen
		# from above that runs clockwise — Godot's front face.
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var uvs: Array = []
		var up := str(ramp["up"])
		for p: Vector3 in corners:
			# V runs along the climb so the step stripes cross it.
			var along := p.z if up == "n" or up == "s" else p.x
			var across := p.x if up == "n" or up == "s" else p.z
			uvs.append(Vector2(across, along * 4.0))
		for i: int in [0, 1, 2, 0, 2, 3]:
			st.set_uv(uvs[i])
			st.add_vertex(corners[i])
		_mesh(st, HouseLook.ramp(), "Ramp_%s" % ramp["stair"])
		var hull := PackedVector3Array()
		for p: Vector3 in corners:
			hull.append(p)
			hull.append(p - Vector3(0, SLAB, 0))
		var shape := ConvexPolygonShape3D.new()
		shape.points = hull
		var cs := CollisionShape3D.new()
		cs.shape = shape
		_body.add_child(cs)


func _build_props() -> void:
	for prop: Dictionary in house.get("props", []):
		var pos := HouseFrames.vec(prop["pos"])
		var size := HouseFrames.vec(prop["size"])
		var yaw := deg_to_rad(float(prop.get("yaw", 0.0)) if prop.get("yaw") != null else 0.0)
		var basis := Basis(Vector3.UP, yaw)
		var root := Node3D.new()
		root.name = "Prop_%s" % prop["id"]
		root.transform = Transform3D(basis, pos)
		add_child(root)
		var kind := str(prop["kind"])
		var solid := HouseGeometry.prop_solid(prop)
		match kind:
			"box", "screen":
				var mi := MeshInstance3D.new()
				var box := BoxMesh.new()
				box.size = size
				mi.mesh = box
				mi.position.y = size.y / 2.0
				mi.material_override = HouseLook.screen(prop.get("color")) if kind == "screen" else HouseLook.paint(prop.get("color"))
				root.add_child(mi)
				if solid:
					_collide_box(pos + basis * Vector3(0, size.y / 2.0, 0), size, basis)
			"cylinder":
				var mi := MeshInstance3D.new()
				var cyl := CylinderMesh.new()
				cyl.top_radius = maxf(size.x, size.z) / 2.0
				cyl.bottom_radius = cyl.top_radius
				cyl.height = size.y
				cyl.radial_segments = 12
				cyl.rings = 1
				mi.mesh = cyl
				mi.position.y = size.y / 2.0
				mi.material_override = HouseLook.paint(prop.get("color"))
				root.add_child(mi)
				if solid:
					var shape := CylinderShape3D.new()
					shape.radius = cyl.top_radius
					shape.height = size.y
					var cs := CollisionShape3D.new()
					cs.shape = shape
					cs.position = pos + Vector3(0, size.y / 2.0, 0)
					_body.add_child(cs)
			"label":
				if solid:
					_collide_box(pos + basis * Vector3(0, size.y / 2.0, 0), size, basis)
			"king":
				# The King (a chess boss in a doorway): a gold body with a small
				# crown on top. He only stands here — the fight is the tablet's
				# (U16); nothing opens the door he guards in VR.
				var mi := MeshInstance3D.new()
				var box := BoxMesh.new()
				box.size = Vector3(size.x, size.y - 0.15, size.z)
				mi.mesh = box
				mi.position.y = (size.y - 0.15) / 2.0
				mi.material_override = HouseLook.paint(prop.get("color", "#d4af37"), Color("#d4af37"))
				root.add_child(mi)
				var crown := MeshInstance3D.new()
				var cbox := BoxMesh.new()
				cbox.size = Vector3(size.x * 0.5, 0.15, size.z * 0.5)
				crown.mesh = cbox
				crown.position.y = size.y - 0.075
				crown.material_override = HouseLook.paint(prop.get("color", "#d4af37"), Color("#d4af37"))
				root.add_child(crown)
				if solid:
					_collide_box(pos + basis * Vector3(0, size.y / 2.0, 0), size, basis)
		if prop.get("label") != null and str(prop["label"]) != "":
			var color := HouseLook.INK
			if kind == "label" and prop.get("color") is String:
				color = Color(str(prop["color"]))
			var l := HouseLook.label(str(prop["label"]), minf(maxf(size.y * 0.7, 0.08), 0.4) if kind == "label" else 0.12, color)
			# The face looks along the prop's yaw (−z); a Label3D reads from +z.
			l.rotation.y = PI
			l.position = Vector3(0, size.y / 2.0, -size.z / 2.0 - 0.01)
			if kind == "label":
				l.width = maxf(size.x, 0.2) / l.pixel_size
				l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			root.add_child(l)


func _build_terminals() -> void:
	for t: Dictionary in house.get("terminals", []):
		var root := Node3D.new()
		root.name = "Terminal_%s" % t["id"]
		var pitch := deg_to_rad(float(t["pitch"]) if t.get("pitch") != null else 0.0)
		var basis := Basis.from_euler(Vector3(pitch, deg_to_rad(float(t["yaw"])), 0.0), EULER_ORDER_YXZ)
		# `pos` is the screen's centre on the wall's centre line: stand proud of
		# the wall box along the screen's facing (−z, = HouseFrames.forward),
		# or the whole terminal is buried in the wall.
		var out: float = HouseGeometry.style_of(house)["wallThickness"] / 2.0 + TERMINAL_PROUD
		root.transform = Transform3D(basis, HouseFrames.vec(t["pos"]) + basis * Vector3(0, 0, -out))
		add_child(root)
		var frame := MeshInstance3D.new()
		var fb := BoxMesh.new()
		fb.size = Vector3(0.36, 0.26, 0.03)
		frame.mesh = fb
		frame.material_override = HouseLook.paint("#1a1a1a")
		root.add_child(frame)
		var glass := MeshInstance3D.new()
		var gq := QuadMesh.new()
		gq.size = Vector2(0.32, 0.22)
		glass.name = "Glass"
		glass.mesh = gq
		glass.material_override = HouseLook.screen()
		glass.rotation.y = PI  # a QuadMesh faces +z; the screen faces −z (its yaw)
		glass.position.z = -0.017
		root.add_child(glass)
		var l := HouseLook.label("watching · %s" % t["name"], 0.05, HouseLook.TEAL_GLOW)
		l.rotation.y = PI
		l.position = Vector3(0, -0.18, -0.02)
		root.add_child(l)


func _build_labels() -> void:
	for room: Dictionary in house.get("rooms", []):
		var elevation := HouseGeometry.room_elevation(house, room)
		var height := HouseGeometry.room_height(house, room) if room.get("outdoor") != true else 2.6
		var spot := label_spot(room)
		var l := HouseLook.label(str(room["label"]), 0.18, HouseLook.GOLD)
		l.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
		# Standing under it, it would fill the view; the HUD names the room then.
		l.visibility_range_begin = 1.6
		l.position = Vector3(spot[0], elevation + minf(height - LABEL_DROP, 2.2), spot[1])
		l.name = "Label_%s" % room["id"]
		add_child(l)


## The centre of a room's largest cell — inside even an L-shaped room.
static func label_spot(room: Dictionary) -> Array:
	var best: Array = []
	var best_area := -1.0
	for c: Array in HouseGeometry.cells(room["poly"], []):
		var area: float = (c[2] - c[0]) * (c[3] - c[1])
		if area > best_area:
			best_area = area
			best = [(c[0] + c[2]) / 2.0, (c[1] + c[3]) / 2.0]
	return best if not best.is_empty() else [room["poly"][0][0], room["poly"][0][1]]
