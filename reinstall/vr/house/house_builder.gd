## Builds the virtual house from a map (`docs/loom-reinstall.md` §1, §5):
## walls / fences / lintels / rails from [method HouseGeometry.build_walls],
## floors (stair holes cut) and starfield ceilings from
## [method HouseGeometry.build_floors], ramps, props, the terminals as
## glowing screens, and a floating label per room — each solid piece with a
## [StaticBody3D] collider, so the player's [CharacterBody3D] walks it.
##
## The King (a `king` prop) stands in his guarded door with the shared
## health bar over him ("THE KING  n / 15", [method set_king]); each door he
## guards has a closed leaf. While he has fallen he kneels, his collider and
## the leaves' are off and the leaves hide — the door is open; a restore
## stands him up and shuts it again — unless the game holds it open for a
## player still behind it or in the doorway ([method hold_door]): then he
## stands, but his collider and the leaves' stay off until they are clear.
##
## Trabolta's heart (a `heart` prop, wave 26 R6) is a dark rack with a
## slowly beating red core behind a smoked front — no label, rows or
## coloured lights (nothing like the real patch bay) — shown only while the
## map's King has fallen (always, on a map with no King). A pickup (a
## `pickup` prop, R7: the virus) is a 3.5" floppy spinning and bobbing over
## its spot with a sickly green glow, hidden once this program took it
## ([method set_pickup_taken], kept across rebuilds). Neither collides.
##
## A terminal with a live camera feed ([method set_cam], from [CamFeeds])
## shows it on a 4:3 panel in place of its screen. A terminal heard through
## the voice link ([VoiceLink]) has an [AudioStreamPlayer3D] "Voice" under
## its root ([method voice_emitter]), re-made after a rebuild.
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
## A terminal's camera feed panel (4:3, metres) and its bezel.
const CAM_SIZE := Vector2(0.48, 0.36)
const CAM_BEZEL := 0.015
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
## The shared King's state in force ([method set_king]; `{}` = none: no
## bar, standing).
var king_state: Dictionary = {}
## King prop id → `{body, crown, health, text, bar, collider, height}`.
var _kings := {}
## Guarded door id → `{guard, mesh, collider}`.
var _leaves := {}
## King prop id → true: this game holds his doors open although he stands
## ([method hold_door]); kept across rebuilds.
var _held := {}
## Terminal id → its root node, rebuilt with the house.
var _terminals := {}
## Terminal id → the camera feed it shows ([method set_cam]); kept across rebuilds.
var _cams := {}
## Heart prop id → `{root, core, glow, light, mat}` ([method heart_node]).
var _hearts := {}
## Pickup prop id → `{root, disk, phase}`; and the ones this program took
## ([method set_pickup_taken]), kept across rebuilds.
var _pickups := {}
var _taken := {}
## The beat's / the disk's clock (s).
var _t := 0.0
## Terminal id → true while it has a voice emitter ([method voice_emitter]);
## kept across rebuilds (the emitter itself is new: its generator starts empty).
var _voices := {}


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
	_build_door_leaves()
	_build_terminals()
	_build_labels()
	_apply_king()
	built.emit()


func clear() -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()
	walls = []
	_body = null
	_kings = {}
	_leaves = {}
	_hearts = {}
	_pickups = {}


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


func _collide_box(center: Vector3, size: Vector3, basis := Basis.IDENTITY) -> CollisionShape3D:
	var shape := BoxShape3D.new()
	shape.size = size
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.transform = Transform3D(basis, center)
	_body.add_child(cs)
	return cs


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
				_build_king(root, prop, pos, size, basis, solid)
			"heart":
				_build_heart(root, prop, size)
			"pickup":
				_build_pickup(root, prop)
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


## The King (a chess boss in a doorway): a gold body with a small crown on
## top, and over him the shared health bar — a name line and a Win98 bar,
## both turning to face the player.
func _build_king(root: Node3D, prop: Dictionary, pos: Vector3, size: Vector3, basis: Basis, solid: bool) -> void:
	var gold := HouseLook.paint(prop.get("color", "#d4af37"), Color("#d4af37"))
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	var box := BoxMesh.new()
	box.size = Vector3(size.x, size.y - 0.15, size.z)
	mi.mesh = box
	mi.position.y = (size.y - 0.15) / 2.0
	mi.material_override = gold
	root.add_child(mi)
	var crown := MeshInstance3D.new()
	crown.name = "Crown"
	var cbox := BoxMesh.new()
	cbox.size = Vector3(size.x * 0.5, 0.15, size.z * 0.5)
	crown.mesh = cbox
	crown.position.y = size.y - 0.075
	crown.material_override = gold
	root.add_child(crown)
	var health := Node3D.new()
	health.name = "Health"
	health.position.y = size.y + 0.22
	root.add_child(health)
	var text := HouseLook.label("THE KING", 0.07, HouseLook.GOLD)
	text.name = "HealthText"
	text.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	text.position.y = 0.09
	health.add_child(text)
	var bar := Sprite3D.new()
	bar.name = "HealthBar"
	bar.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	bar.shaded = false
	bar.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	bar.pixel_size = 0.5 / 100.0  # the bar image is 100 px: half a metre wide
	health.add_child(bar)
	var collider: CollisionShape3D = null
	if solid:
		collider = _collide_box(pos + basis * Vector3(0, size.y / 2.0, 0), size, basis)
	_kings[str(prop["id"])] = {"body": mi, "crown": crown, "health": health, "text": text, "bar": bar, "collider": collider, "height": size.y}


# --- the heart and the pickups (wave 26) -------------------------------------

## Seconds per heartbeat (the three.js heart's HEART_BEAT_S: a slow 50 bpm).
const HEART_BEAT_S := 1.2
## The core's colour (a deep ember red).
const HEART_COLOR := Color("#c8102e")
## A pickup's disk floats this high (m) over its spot, bobs this much, turns this often (turns / s).
const PICKUP_HOVER := 0.75
const PICKUP_BOB := 0.06
const PICKUP_SPIN := 0.25
const PICKUP_GLOW := Color("#7dff3a")
## A real 3.5" disk is 90 × 94 × 3.3 mm; drawn this many times larger.
const PICKUP_SCALE := 2.6


## The beat's shape at `t` s (the three.js `heartPulse`): two thumps ("lub-dub"), then rest; 0 … 1.
static func heart_pulse(t: float) -> float:
	var p := fposmod(t, HEART_BEAT_S)
	var thump := func(at: float, width: float, height: float) -> float:
		var x := (p - at) / width
		return 0.0 if x < 0.0 or x > 1.0 else height * sin(x * PI)
	return minf(1.0, float(thump.call(0.0, 0.18, 1.0)) + float(thump.call(0.24, 0.22, 0.65)))


## The heart: a plinth, a dark cabinet and a cap (the prop's size, 0.6 ×
## 1.7 × 0.6 by default), a red core in a recess on its face (−z, the
## prop's yaw), a smoked front over it and a soft red light. No label.
func _build_heart(root: Node3D, prop: Dictionary, size: Vector3) -> void:
	var w := size.x if size.x > 0.0 else 0.6
	var h := size.y if size.y > 0.0 else 1.7
	var d := size.z if size.z > 0.0 else 0.6
	root.set_meta("height", h)
	var shell := HouseLook.paint(prop.get("color", "#141418"), Color("#141418"))
	for part: Array in [[Vector3(w, h * 0.04, d), h * 0.02], [Vector3(w * 0.94, h * 0.92, d * 0.94), h * 0.5], [Vector3(w, h * 0.04, d), h * 0.98]]:
		var mi := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = part[0]
		mi.mesh = box
		mi.position.y = part[1]
		mi.material_override = shell
		mi.name = "Rack"
		root.add_child(mi)
	var core_y := h * 0.55
	var core_r := minf(w, h) * 0.2
	var core := MeshInstance3D.new()
	core.name = "Core"
	var sphere := SphereMesh.new()
	sphere.radius = core_r
	sphere.height = core_r * 2.0
	sphere.radial_segments = 14
	sphere.rings = 8
	core.mesh = sphere
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = HEART_COLOR
	core.material_override = mat
	core.position = Vector3(0, core_y, -d * 0.2)
	root.add_child(core)
	var front := MeshInstance3D.new()
	front.name = "Front"
	var fq := QuadMesh.new()
	fq.size = Vector2(w * 0.8, h * 0.55)
	front.mesh = fq
	var smoke := StandardMaterial3D.new()
	smoke.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	smoke.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	smoke.albedo_color = Color(0.04, 0.04, 0.06, 0.55)
	front.material_override = smoke
	front.rotation.y = PI  # a QuadMesh faces +z; the face looks −z
	front.position = Vector3(0, core_y, -d * 0.47 - 0.006)
	root.add_child(front)
	var light := OmniLight3D.new()
	light.name = "Glow"
	light.light_color = HEART_COLOR
	light.omni_range = 2.2
	light.position = Vector3(0, core_y, -d * 0.6)
	root.add_child(light)
	_hearts[str(prop["id"])] = {"root": root, "core": core, "light": light, "mat": mat}
	_beat(_hearts[str(prop["id"])])


func _beat(heart: Dictionary) -> void:
	var p := heart_pulse(_t)
	var sc := 1.0 + 0.14 * p
	(heart["core"] as Node3D).scale = Vector3(sc, sc, sc)
	(heart["mat"] as StandardMaterial3D).albedo_color = HEART_COLOR.lerp(Color("#ff4060"), 0.35 * p)
	(heart["light"] as OmniLight3D).light_energy = 0.5 + 1.1 * p


## A pickup: the floppy (shell, metal shutter and hub, a blank sticker),
## stood on its edge over the spot, and a green light. No label.
func _build_pickup(root: Node3D, prop: Dictionary) -> void:
	var w := 0.09 * PICKUP_SCALE
	var hgt := 0.094 * PICKUP_SCALE
	var t := 0.0033 * PICKUP_SCALE
	var disk := Node3D.new()
	disk.name = "Disk"
	disk.position.y = PICKUP_HOVER
	root.add_child(disk)
	var shell := StandardMaterial3D.new()
	shell.albedo_color = Color("#1c1f1a")
	shell.emission_enabled = true
	shell.emission = Color("#1f4a10")
	shell.emission_energy_multiplier = 0.6
	for part: Array in [
		["Shell", Vector3(w, hgt, t), Vector3.ZERO, shell],
		["Shutter", Vector3(w * 0.55, hgt * 0.36, t * 1.15), Vector3(w * 0.05, hgt * 0.32, 0), HouseLook.paint("#b8bcc0")],
		["Hub", Vector3(w * 0.2, w * 0.2, t * 1.15), Vector3(0, -hgt * 0.05, 0), HouseLook.paint("#b8bcc0")],
		["Sticker", Vector3(w * 0.78, hgt * 0.45, t * 1.1), Vector3(0, -hgt * 0.22, 0), HouseLook.paint("#e9eee0")],
	]:
		var mi := MeshInstance3D.new()
		mi.name = part[0]
		var box := BoxMesh.new()
		box.size = part[1]
		mi.mesh = box
		mi.position = part[2]
		mi.material_override = part[3]
		disk.add_child(mi)
	var light := OmniLight3D.new()
	light.name = "Glow"
	light.light_color = PICKUP_GLOW
	light.light_energy = 0.9
	light.omni_range = 1.4
	disk.add_child(light)
	var id := str(prop["id"])
	_pickups[id] = {"root": root, "disk": disk, "phase": float(HouseDuck.fnv1a32(id) % 1000) / 1000.0}
	root.visible = not _taken.has(id)
	_spin(_pickups[id])


func _spin(p: Dictionary) -> void:
	var disk: Node3D = p["disk"]
	var ph: float = p["phase"]
	disk.rotation.y = TAU * PICKUP_SPIN * (_t + ph * 4.0)
	disk.position.y = PICKUP_HOVER + sin(TAU * (_t * 0.5 + ph)) * PICKUP_BOB


func _process(delta: float) -> void:
	if _hearts.is_empty() and _pickups.is_empty():
		return
	_t += delta
	for id: String in _hearts:
		if (_hearts[id]["root"] as Node3D).visible:
			_beat(_hearts[id])
	for id: String in _pickups:
		if (_pickups[id]["root"] as Node3D).visible:
			_spin(_pickups[id])


## Heart prop `id`'s node (its base; meta `height`), null when there is none.
func heart_node(id: String) -> Node3D:
	return _hearts[id]["root"] if _hearts.has(id) else null


## Whether heart `id` shows (the map's King has fallen, or there is none).
func heart_shown(id: String) -> bool:
	return _hearts.has(id) and (_hearts[id]["root"] as Node3D).visible


## Whether the map's King has fallen for the heart: no King on the map, or
## the shared King's state says fallen.
func _heart_open() -> bool:
	if _kings.is_empty():
		return true
	return not king_state.is_empty() and king_state.get("fallen") == true


## This program took pickup `id` (`taken`): its disk hides — kept across
## rebuilds; false shows it again.
func set_pickup_taken(id: String, taken: bool) -> void:
	if taken:
		_taken[id] = true
	else:
		_taken.erase(id)
	if _pickups.has(id):
		(_pickups[id]["root"] as Node3D).visible = not taken


## Every pickup shown again (a new walk).
func clear_taken() -> void:
	for id: String in _taken.keys():
		set_pickup_taken(id, false)


## Whether pickup `id`'s disk shows.
func pickup_shown(id: String) -> bool:
	return _pickups.has(id) and (_pickups[id]["root"] as Node3D).visible


## Pickup `id`'s disk node, for the tests (null when none).
func pickup_disk(id: String) -> Node3D:
	return _pickups[id]["disk"] if _pickups.has(id) else null


## A closed leaf in every guarded door's gap ([method HouseGeometry.door_gap];
## a hair narrower than the gap, so it never z-fights the jambs), with a
## collider filling the gap — shut until its King falls.
func _build_door_leaves() -> void:
	var wt: float = HouseGeometry.style_of(house)["wallThickness"]
	for door: Dictionary in house.get("doors", []):
		if door.get("guard") == null:
			continue
		var gap: Variant = HouseGeometry.door_gap(house, door)
		if gap == null:
			continue
		var width: float = maxf(0.02, float(gap["hi"]) - float(gap["lo"]) - 0.02)
		var height: float = maxf(0.02, float(gap["top"]) - float(gap["bottom"]))
		var mid: float = (float(gap["lo"]) + float(gap["hi"])) / 2.0
		var along_x: bool = gap["axis"] == "x"
		var center := Vector3(mid if along_x else float(gap["c"]), float(gap["bottom"]) + height / 2.0, float(gap["c"]) if along_x else mid)
		var mi := MeshInstance3D.new()
		mi.name = "Door_%s" % door["id"]
		var box := BoxMesh.new()
		var thick := wt * 0.5
		box.size = Vector3(width, height, thick) if along_x else Vector3(thick, height, width)
		mi.mesh = box
		mi.position = center
		mi.material_override = HouseLook.paint("#3a3f47")
		add_child(mi)
		var full: float = float(gap["hi"]) - float(gap["lo"])
		var collider := _collide_box(center, Vector3(full, height, wt) if along_x else Vector3(wt, height, full))
		_leaves[str(door["id"])] = {"guard": str(door["guard"]), "mesh": mi, "collider": collider}


## The shared King changed (`KingState`, `{}` = none): his bar, his stance,
## and the doors he guards.
func set_king(state: Dictionary) -> void:
	king_state = state
	_apply_king()


## Hold the doors King `id` guards open for this player although he stands
## (`on`), or let them follow his state again — the web game's
## `keepDoorOpen`: a restore must never shut a player in behind his door,
## or inside the leaf or him ([method HouseKing.keep_door_open]).
func hold_door(id: String, on: bool) -> void:
	if on == _held.has(id):
		return
	if on:
		_held[id] = true
	else:
		_held.erase(id)
	_apply_king()


## Whether this game holds King `id`'s doors open ([method hold_door]).
func door_held(id: String) -> bool:
	return _held.has(id)


func _apply_king() -> void:
	var s := king_state
	for id: String in _kings:
		var k: Dictionary = _kings[id]
		var ours: bool = not s.is_empty() and (str(s.get("id", "")) == id or str(s.get("id", "")) == "")
		var fallen: bool = ours and s.get("fallen") == true
		var open: bool = fallen or _held.has(id)
		(k["health"] as Node3D).visible = ours
		if ours:
			(k["text"] as Label3D).text = "THE KING  %d / %d" % [int(s["hp"]), int(s["max"])]
			(k["bar"] as Sprite3D).texture = ImageTexture.create_from_image(HouseLook.health_bar(int(s["hp"]), int(s["max"])))
		_kneel(k, fallen)
		if k["collider"] != null:
			(k["collider"] as CollisionShape3D).disabled = open
		for door_id: String in _leaves:
			var leaf: Dictionary = _leaves[door_id]
			if leaf["guard"] != id:
				continue
			(leaf["mesh"] as Node3D).visible = not open
			(leaf["collider"] as CollisionShape3D).disabled = open
	var heart_on := _heart_open()
	for id: String in _hearts:
		(_hearts[id]["root"] as Node3D).visible = heart_on


## Down on one knee (half his height, bowed forward), or standing.
func _kneel(k: Dictionary, on: bool) -> void:
	var h: float = k["height"]
	var body: MeshInstance3D = k["body"]
	var body_h := h - 0.15
	var f := 0.55 if on else 1.0
	body.scale = Vector3(1.0, f, 1.0)
	body.position.y = body_h * f / 2.0
	body.rotation.x = deg_to_rad(-14.0) if on else 0.0
	(k["crown"] as Node3D).position.y = body_h * f + 0.075
	(k["health"] as Node3D).position.y = body_h * f + 0.15 + 0.22


## Whether the King `id` is kneeling (fallen), for the tests.
func king_kneeling(id: String) -> bool:
	return _kings.has(id) and (_kings[id]["body"] as Node3D).scale.y < 1.0


## Whether King `id` blocks the body (his collider on), for the tests.
func king_solid(id: String) -> bool:
	return _kings.has(id) and _kings[id]["collider"] != null and not (_kings[id]["collider"] as CollisionShape3D).disabled


## Whether the leaf of guarded door `id` is shut.
func door_shut(id: String) -> bool:
	return _leaves.has(id) and (_leaves[id]["mesh"] as Node3D).visible and not (_leaves[id]["collider"] as CollisionShape3D).disabled


func _build_terminals() -> void:
	_terminals.clear()
	for t: Dictionary in house.get("terminals", []):
		var root := Node3D.new()
		root.name = "Terminal_%s" % t["id"]
		root.transform = terminal_transform(house, t)
		add_child(root)
		var frame := MeshInstance3D.new()
		var fb := BoxMesh.new()
		fb.size = Vector3(0.36, 0.26, 0.03)
		frame.name = "Frame"
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
		l.name = "Label"
		l.rotation.y = PI
		l.position = Vector3(0, -0.18, -0.02)
		root.add_child(l)
		_terminals[str(t["id"])] = root
		if _cams.has(str(t["id"])):
			_show_cam(root, _cams[str(t["id"])])
		if _voices.has(str(t["id"])):
			root.add_child(make_voice_emitter())


# --- voice ---


## Terminal `id`'s voice emitter (made the first time), or null when the
## map has no such terminal. The caller plays it.
func voice_emitter(id: String) -> AudioStreamPlayer3D:
	if not _terminals.has(id):
		return null
	var root: Node3D = _terminals[id]
	var e := root.get_node_or_null("Voice") as AudioStreamPlayer3D
	if e == null:
		e = make_voice_emitter()
		root.add_child(e)
	_voices[id] = true
	return e


## Terminal `id` silent: its emitter gone.
func clear_voice(id: String) -> void:
	_voices.erase(id)
	if not _terminals.has(id):
		return
	var e := (_terminals[id] as Node3D).get_node_or_null("Voice") as AudioStreamPlayer3D
	if e != null:
		e.stop()
		e.get_parent().remove_child(e)
		e.queue_free()


func clear_voices() -> void:
	for id: String in _voices.keys():
		clear_voice(id)


## Whether terminal `id` has a voice emitter now, for the tests.
func voice_attached(id: String) -> bool:
	return _terminals.has(id) and (_terminals[id] as Node3D).get_node_or_null("Voice") != null


func has_terminal(id: String) -> bool:
	return _terminals.has(id)


## An emitter for a terminal's voice: a 16 kHz [AudioStreamGenerator]
## ([constant VoiceLink.BUFFER_LENGTH] s — the 400 ms skip limit plus a
## chunk), positional (panned from the screen) but not attenuated — the
## server's gain already says how far away it is.
static func make_voice_emitter() -> AudioStreamPlayer3D:
	var gen := AudioStreamGenerator.new()
	gen.mix_rate_mode = AudioStreamGenerator.MIX_RATE_CUSTOM
	gen.mix_rate = VoiceCodec.VOICE_RATE
	gen.buffer_length = VoiceLink.BUFFER_LENGTH
	var e := AudioStreamPlayer3D.new()
	e.name = "Voice"
	e.stream = gen
	e.attenuation_model = AudioStreamPlayer3D.ATTENUATION_DISABLED
	e.max_distance = 0.0
	e.doppler_tracking = AudioStreamPlayer3D.DOPPLER_TRACKING_DISABLED
	return e


## Terminal `t`'s screen centre and facing, in house coordinates: `pos` is
## the screen's centre on the wall's centre line, so it stands proud of the
## wall box along its facing (−z, = [method HouseFrames.forward] of its
## yaw / pitch), or the whole terminal is buried in the wall.
static func terminal_transform(map: Dictionary, t: Dictionary) -> Transform3D:
	var pitch := deg_to_rad(float(t["pitch"]) if t.get("pitch") != null else 0.0)
	var basis := Basis.from_euler(Vector3(pitch, deg_to_rad(float(t["yaw"])), 0.0), EULER_ORDER_YXZ)
	var out: float = HouseGeometry.style_of(map)["wallThickness"] / 2.0 + TERMINAL_PROUD
	return Transform3D(basis, HouseFrames.vec(t["pos"]) + basis * Vector3(0, 0, -out))


## Show terminal `id`'s live camera feed (`texture`, updated in place by
## [CamFeeds]) on a 4:3 panel in place of its screen; kept across rebuilds.
func set_cam(id: String, texture: Texture2D) -> void:
	_cams[id] = texture
	if _terminals.has(id):
		_show_cam(_terminals[id], texture)


## Terminal `id` back to its own screen.
func clear_cam(id: String) -> void:
	_cams.erase(id)
	if not _terminals.has(id):
		return
	var root: Node3D = _terminals[id]
	var feed := root.get_node_or_null("Feed")
	if feed != null:
		root.remove_child(feed)
		feed.queue_free()
	(root.get_node("Frame") as Node3D).visible = true
	(root.get_node("Glass") as Node3D).visible = true
	(root.get_node("Label") as Node3D).position.y = -0.18


## Whether terminal `id` shows a camera feed (for the tests).
func cam_shown(id: String) -> bool:
	return _terminals.has(id) and (_terminals[id] as Node3D).get_node_or_null("Feed") != null


func _show_cam(root: Node3D, texture: Texture2D) -> void:
	var feed := root.get_node_or_null("Feed") as Node3D
	if feed == null:
		feed = Node3D.new()
		feed.name = "Feed"
		var bezel := MeshInstance3D.new()
		var bb := BoxMesh.new()
		bb.size = Vector3(CAM_SIZE.x + 2.0 * CAM_BEZEL, CAM_SIZE.y + 2.0 * CAM_BEZEL, 0.03)
		bezel.name = "Bezel"
		bezel.mesh = bb
		bezel.material_override = HouseLook.paint("#1a1a1a")
		feed.add_child(bezel)
		var video := MeshInstance3D.new()
		var vq := QuadMesh.new()
		vq.size = CAM_SIZE
		video.name = "Video"
		video.mesh = vq
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
		video.material_override = mat
		video.rotation.y = PI  # faces −z, as the glass
		video.position.z = -0.017
		feed.add_child(video)
		root.add_child(feed)
	((feed.get_node("Video") as MeshInstance3D).material_override as StandardMaterial3D).albedo_texture = texture
	(root.get_node("Frame") as Node3D).visible = false
	(root.get_node("Glass") as Node3D).visible = false
	(root.get_node("Label") as Node3D).position.y = -(CAM_SIZE.y / 2.0 + CAM_BEZEL + 0.03)


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
