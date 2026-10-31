## Builds the virtual house from a map (`docs/loom-reinstall.md` §1, §5):
## walls / fences / lintels / rails from [method HouseGeometry.build_walls],
## floors (stair holes cut) and starfield ceilings from
## [method HouseGeometry.build_floors], the stairwells' band between floors
## ([method HouseGeometry.stair_wells]), ramps, props and the terminals as
## glowing screens — each solid piece with a [StaticBody3D] collider, so
## the player's [CharacterBody3D] walks it. No text hangs in the house: no
## room names, no terminal captions.
##
## Every visible piece sits under its floor's node ("Floor_<id>"; [method
## part] finds one by name), so [method hide_floors] can drop the floors
## above the outside one while the player is outdoors
## ([method HouseEscape.hidden_floors]): from outside, the house is only its
## ground floor. The colliders stay.
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

## The stairwells' skins: this thick, just outside the hole, and this far
## past both planes so no crack shows at either edge.
const WELL_SKIN := 0.02
const WELL_OVERLAP := 0.01
## Rail bars are this thick, fence boards at most this (as in three.js).
const RAIL_THICKNESS := 0.05
const FENCE_MAX_THICKNESS := 0.06
## Terminal screens stand this far proud of their wall's face (as in three.js).
const TERMINAL_PROUD := 0.035
## A terminal's camera feed panel (4:3, metres) and its bezel, before
## [constant TERMINAL_SCALE].
const CAM_SIZE := Vector2(0.48, 0.36)
const CAM_BEZEL := 0.015
## The game draws every terminal (its screen and the camera feed — the
## mirror into the real house) this many times its size, across
## the wall but no deeper (wave 33b; three.js: `GAME_TERMINAL_SCALE`).
const TERMINAL_SCALE := 3.0
## Floor colliders are this thick (below the surface).
const SLAB := 0.2
## How far under a floor its underside sits (just under, so no slit).
const UNDERSIDE_GAP := 0.01
## How far the outside ground reaches past the house.
const GROUND_MARGIN := 30.0

var house: Dictionary = {}
## The last [method HouseGeometry.build_walls] (house coordinates).
var walls: Array = []
## The `spaces.vr` transform in effect.
var space: Dictionary = HouseFrames.IDENTITY

var _body: StaticBody3D
## Floor id → its node (every visible piece on that floor sits under it).
var _floor_nodes := {}
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
## The haze sheets ([method _build_haze]): `{mat, alpha, drift}` each.
var _haze: Array = []
var _haze_scale := 1.0
## The props' merged meshes while building: role → SurfaceTool.
var _role_tools := {}
## (wave 49) The descent level the `from` props are shown at
## ([method set_descent]); kept across rebuilds. The house is built before
## the assignment, so these are toggled, never rebuilt.
var descent := 0
## `{from, node}` per merged mesh of `from` props.
var _from_meshes: Array = []
## (wave 49) The neon's stutter under a level's look
## ([method Descent.neon_level]: 1 = today's) and a vision's dimming of it.
var neon_rate := 1.0
var neon_scale := 1.0
## Cylinder segments for the props' merged meshes.
const PROP_SEGMENTS := 16
## A plain (model-less) prop's colour when it has none.
const PLAIN_COLOR := "#8a8f99"
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
	for f: Dictionary in map.get("floors", []):
		_floor_node(str(f["id"]))
	_build_walls()
	_build_floors()
	_build_wells()
	_build_ground()
	_build_ramps()
	_build_props()
	_build_neon_strips()
	_build_haze()
	_build_door_leaves()
	_build_terminals()
	_apply_king()
	built.emit()


func clear() -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()
	walls = []
	_body = null
	_floor_nodes = {}
	_kings = {}
	_leaves = {}
	_hearts = {}
	_pickups = {}
	_haze = []
	_from_meshes = []


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


# --- floors ------------------------------------------------------------------


## Floor `id`'s node (made the first time).
func _floor_node(id: String) -> Node3D:
	if not _floor_nodes.has(id):
		var n := Node3D.new()
		n.name = "Floor_%s" % id
		add_child(n)
		_floor_nodes[id] = n
	return _floor_nodes[id]


## The node of the floor room `room_id` is on (this node for an unknown room).
func _room_node(room_id: Variant) -> Node3D:
	var r: Variant = HouseGeometry.room_by_id(house, room_id)
	return _floor_node(str(r["floor"])) if r != null else self


## Draw every floor but `ids` ([method HouseEscape.hidden_floors]).
func hide_floors(ids: Array) -> void:
	for id: String in _floor_nodes:
		(_floor_nodes[id] as Node3D).visible = not ids.has(id)


## Whether floor `id` is drawn.
func floor_shown(id: String) -> bool:
	return _floor_nodes.has(id) and (_floor_nodes[id] as Node3D).visible


## A built piece by name ("Prop_<id>", "Terminal_<id>/Glass", "Colliders", …),
## wherever its floor put it; null when there is none.
func part(path: String) -> Node:
	var own := get_node_or_null(path)
	if own != null:
		return own
	for n: Node3D in _floor_nodes.values():
		var found := n.get_node_or_null(path)
		if found != null:
			return found
	return null


# --- pieces ------------------------------------------------------------------


func _collide_box(center: Vector3, size: Vector3, basis := Basis.IDENTITY) -> CollisionShape3D:
	var shape := BoxShape3D.new()
	shape.size = size
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.transform = Transform3D(basis, center)
	_body.add_child(cs)
	return cs


func _mesh(st: SurfaceTool, mat: Material, node_name: String, parent: Node3D) -> void:
	st.generate_normals()
	var mi := MeshInstance3D.new()
	mi.name = node_name
	mi.mesh = st.commit()
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)


## Two triangles of a quad whose corners run counter-clockwise seen from
## its front (Godot's front faces are clockwise, so they are emitted reversed).
static func add_quad(st: SurfaceTool, q: Array, uvs: Array) -> void:
	for i: int in [0, 2, 1, 0, 3, 2]:
		st.set_uv(uvs[i])
		st.add_vertex(q[i])


func _build_walls() -> void:
	var tools := {}
	var boxes := wall_boxes(walls, HouseGeometry.style_of(house)["wallThickness"])
	for i in boxes.size():
		var box: Dictionary = boxes[i]
		var kind := str(box["kind"])
		var floor_id := str(walls[i]["floor"])
		var key := "%s|%s" % [floor_id, kind]
		if not tools.has(key):
			var st := SurfaceTool.new()
			st.begin(Mesh.PRIMITIVE_TRIANGLES)
			tools[key] = [st, floor_id, kind]
		var lo: Vector3 = box["lo"]
		var hi: Vector3 = box["hi"]
		_box(tools[key][0], lo, hi, 1.0 if kind == "fence" else 0.5)
		_collide_box((lo + hi) / 2.0, hi - lo)
	var mats := {"wall": HouseLook.wall(), "lintel": HouseLook.lintel(), "fence": HouseLook.fence(), "rail": HouseLook.rail()}
	for key: String in tools:
		var t: Array = tools[key]
		_mesh(t[0], mats[t[2]], "Walls_%s" % t[2], _floor_node(t[1]))


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
	var tools := {}
	var lowest := INF
	for fl: Dictionary in house.get("floors", []):
		lowest = minf(lowest, float(fl["elevation"]))
	for plane: Dictionary in HouseGeometry.build_floors(house):
		var y: float = plane["y"]
		var is_floor: bool = plane["kind"] == "floor"
		var mat: Material = HouseLook.floor_for(plane["color"], plane["outdoor"]) if is_floor else HouseLook.ceiling()
		var st := _floor_tool(tools, plane, mat, "Floor" if is_floor else "Ceilings")
		if is_floor:
			for cell: Array in HouseGeometry.cells(plane["poly"], plane["holes"]):
				var x0: float = cell[0]
				var z0: float = cell[1]
				var x1: float = cell[2]
				var z1: float = cell[3]
				_collide_box(Vector3((x0 + x1) / 2.0, y - SLAB / 2.0, (z0 + z1) / 2.0), Vector3(x1 - x0, SLAB, z1 - z0))
		# Drawn on the bare grid: every cell shares whole edges, so no
		# T-junction cracks open into the void (merged runs leave them).
		for cell: Array in HouseGeometry.cells(plane["poly"], plane["holes"], false):
			var x0: float = cell[0]
			var z0: float = cell[1]
			var x1: float = cell[2]
			var z1: float = cell[3]
			var q: Array
			if is_floor:
				q = [Vector3(x0, y, z1), Vector3(x1, y, z1), Vector3(x1, y, z0), Vector3(x0, y, z0)]
			else:
				q = [Vector3(x0, y, z0), Vector3(x1, y, z0), Vector3(x1, y, z1), Vector3(x0, y, z1)]
			var uvs: Array = []
			for p: Vector3 in q:
				uvs.append(Vector2(p.x, p.z) / (1.0 if is_floor else 4.0))
			add_quad(st, q, uvs)
		# A floor over another floor has an underside (in its own ceilings),
		# so where it overhangs the open air (the backyard) nobody sees up
		# into its rooms from below.
		if is_floor and y > lowest + 0.01:
			var under := _floor_tool(tools, plane, HouseLook.ceiling(), "Ceilings")
			for cell: Array in HouseGeometry.cells(plane["poly"], plane["holes"], false):
				var x0: float = cell[0]
				var z0: float = cell[1]
				var x1: float = cell[2]
				var z1: float = cell[3]
				var yu := y - UNDERSIDE_GAP
				var q := [Vector3(x0, yu, z0), Vector3(x1, yu, z0), Vector3(x1, yu, z1), Vector3(x0, yu, z1)]
				var uvs: Array = []
				for p: Vector3 in q:
					uvs.append(Vector2(p.x, p.z) / 4.0)
				add_quad(under, q, uvs)
	for key: String in tools:
		var t: Array = tools[key]
		_mesh(t[0], t[1], t[2], _floor_node(t[3]))


## Floor `plane`'s merged SurfaceTool for `mat` (made the first time).
static func _floor_tool(tools: Dictionary, plane: Dictionary, mat: Material, node_name: String) -> SurfaceTool:
	var key := "%s|%d" % [plane["floor"], mat.get_instance_id()]
	if not tools.has(key):
		var s := SurfaceTool.new()
		s.begin(Mesh.PRIMITIVE_TRIANGLES)
		tools[key] = [s, mat, node_name, str(plane["floor"])]
	return tools[key][0]


## The band between a ceiling and the floor above round each stair's hole
## ([method HouseGeometry.stair_wells]): four thin skins just outside the
## hole, on the lower floor, a hair past both planes. Render only.
func _build_wells() -> void:
	var tools := {}
	for w: Dictionary in HouseGeometry.stair_wells(house):
		var floor_id := str(w["floor"])
		if not tools.has(floor_id):
			var s := SurfaceTool.new()
			s.begin(Mesh.PRIMITIVE_TRIANGLES)
			tools[floor_id] = s
		var r: Array = w["rect"]
		var x0 := float(r[0])
		var z0 := float(r[1])
		var x1 := float(r[2])
		var z1 := float(r[3])
		var y0 := float(w["bottom"]) - WELL_OVERLAP
		var y1 := float(w["top"]) + WELL_OVERLAP
		var k := WELL_SKIN
		_box(tools[floor_id], Vector3(x0 - k, y0, z0 - k), Vector3(x1 + k, y1, z0), 0.5)
		_box(tools[floor_id], Vector3(x0 - k, y0, z1), Vector3(x1 + k, y1, z1 + k), 0.5)
		_box(tools[floor_id], Vector3(x0 - k, y0, z0), Vector3(x0, y1, z1), 0.5)
		_box(tools[floor_id], Vector3(x1, y0, z0), Vector3(x1 + k, y1, z1), 0.5)
	for floor_id: String in tools:
		_mesh(tools[floor_id], HouseLook.wall(), "Wells", _floor_node(floor_id))


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
	for cell: Array in HouseGeometry.cells(outer, holes):
		var x0: float = cell[0]
		var z0: float = cell[1]
		var x1: float = cell[2]
		var z1: float = cell[3]
		_collide_box(Vector3((x0 + x1) / 2.0, y - SLAB / 2.0, (z0 + z1) / 2.0), Vector3(x1 - x0, SLAB, z1 - z0))
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for cell: Array in HouseGeometry.cells(outer, holes, false):
		var x0: float = cell[0]
		var z0: float = cell[1]
		var x1: float = cell[2]
		var z1: float = cell[3]
		var q := [Vector3(x0, y, z1), Vector3(x1, y, z1), Vector3(x1, y, z0), Vector3(x0, y, z0)]
		var uvs: Array = []
		for p: Vector3 in q:
			uvs.append(Vector2(p.x, p.z))
		add_quad(st, q, uvs)
	_mesh(st, HouseLook.ground(), "Ground", _floor_node(floor_id))


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
		_mesh(st, HouseLook.ramp(), "Ramp_%s" % ramp["stair"], _room_node(ramp["from"]))
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
		_room_node(prop["room"]).add_child(root)
		var kind := str(prop["kind"])
		var solid := HouseGeometry.prop_solid(prop)
		var xf := Transform3D(basis, pos)
		# (wave 49) Only there from this level: merged apart, to be toggled.
		var from: int = int(prop["from"]) if prop.get("from") != null else 0
		var parts: Variant = HouseModels.model_parts(prop)
		if parts != null:
			# Wave 47: drawn from its model's parts, merged per role; it still
			# collides as its plain shape (below).
			var body := Color(HouseModels.model_body_color(prop))
			var glow := Color(HouseModels.model_neon_color(prop))
			for part: Dictionary in parts:
				var r := str(part["role"])
				_part(r, part, xf, body if r == "body" else (glow if r == "neon" else Color.WHITE), prop["room"], from)
		match kind:
			"box", "screen":
				if kind == "screen":
					var mi := MeshInstance3D.new()
					var box := BoxMesh.new()
					box.size = size
					mi.mesh = box
					mi.position.y = size.y / 2.0
					mi.material_override = HouseLook.screen(prop.get("color"))
					root.add_child(mi)
				elif parts == null:
					_part("body", {"shape": "box", "axis": "y", "c": Vector3(0, size.y / 2.0, 0), "s": size}, xf, _plain_color(prop), prop["room"], from)
				if solid:
					_collide_box(pos + basis * Vector3(0, size.y / 2.0, 0), size, basis)
			"cylinder":
				var cyl := CylinderMesh.new()
				cyl.top_radius = maxf(size.x, size.z) / 2.0
				if parts == null:
					var dia := maxf(size.x, size.z)
					_part("body", {"shape": "cyl", "axis": "y", "c": Vector3(0, size.y / 2.0, 0), "s": Vector3(dia, size.y, dia)}, xf, _plain_color(prop), prop["room"], from)
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
		# No caption on a prop, and a sign (`label`) draws nothing: the
		# headset's house carries no text.
	_commit_parts("Props")


static func _plain_color(prop: Dictionary) -> Color:
	var c: Variant = prop.get("color")
	return Color(str(c)) if c is String and str(c).begins_with("#") else Color(PLAIN_COLOR)


## One part (in a prop's frame `xf`) into its role's merged mesh, coloured
## `color` per vertex (the body's and the neon's; the other roles white).
## `from` > 0: a prop only there from that level, merged apart ([method set_descent]).
func _part(role: String, part: Dictionary, xf: Transform3D, color: Color, room_id: Variant = null, from := 0) -> void:
	# Merged per floor too, so a hidden floor hides its props.
	var r: Variant = HouseGeometry.room_by_id(house, room_id) if room_id != null else null
	var key := "%s|%s|%d" % [str(r["floor"]) if r != null else "", role, from]
	if not _role_tools.has(key):
		var tool := SurfaceTool.new()
		tool.begin(Mesh.PRIMITIVE_TRIANGLES)
		_role_tools[key] = tool
	var st: SurfaceTool = _role_tools[key]
	var c: Vector3 = part["c"]
	var sz: Vector3 = part["s"]
	if part["shape"] == "cyl":
		add_cylinder(st, xf, c, sz, str(part["axis"]), color, PROP_SEGMENTS)
	else:
		add_box(st, xf, c, sz, color)


## Every role's merged mesh, named `<prefix>_<role>` (no colliders).
func _commit_parts(prefix: String) -> void:
	for key: String in _role_tools:
		var fl := key.get_slice("|", 0)
		var r := key.get_slice("|", 1)
		var from := key.get_slice("|", 2).to_int()
		var mi := MeshInstance3D.new()
		mi.name = "%s_%s" % [prefix, r] if from == 0 else "%s_from%d_%s" % [prefix, from, r]
		mi.mesh = (_role_tools[key] as SurfaceTool).commit()
		mi.material_override = HouseLook.role(r)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		(_floor_node(fl) if fl != "" else self).add_child(mi)
		if from > 0:
			mi.visible = descent >= from
			_from_meshes.append({"from": from, "node": mi})
	_role_tools = {}


## (wave 49) Show the `from` props of level `level` and shallower (0: none).
func set_descent(level: int) -> void:
	descent = level
	for f: Dictionary in _from_meshes:
		(f["node"] as Node3D).visible = level >= int(f["from"])


## How many merged `from` meshes are shown of how many: `[shown, all]`.
func from_shown() -> Array:
	var on := 0
	for f: Dictionary in _from_meshes:
		if (f["node"] as Node3D).visible:
			on += 1
	return [on, _from_meshes.size()]


## A triangle facing `outward` (Godot's front faces wind clockwise).
static func _tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3, outward: Vector3, color: Color) -> void:
	if (b - a).cross(c - a).dot(outward) > 0.0:
		var t := b
		b = c
		c = t
		var tn := nb
		nb = nc
		nc = tn
	for v: Array in [[a, na], [b, nb], [c, nc]]:
		var p: Vector3 = v[0]
		st.set_color(color)
		st.set_normal(v[1])
		st.set_uv(Vector2(p.x + p.z, p.y))
		st.add_vertex(p)


## A box (centre `c`, size `s`, in the frame `xf`), all six faces.
static func add_box(st: SurfaceTool, xf: Transform3D, c: Vector3, s: Vector3, color: Color) -> void:
	var h := s / 2.0
	for axis in 3:
		for sign: float in [-1.0, 1.0]:
			var n := Vector3.ZERO
			n[axis] = sign
			var u := Vector3.ZERO
			u[(axis + 1) % 3] = h[(axis + 1) % 3]
			var v := Vector3.ZERO
			v[(axis + 2) % 3] = h[(axis + 2) % 3]
			var f := c + n * h[axis]
			var p0 := xf * (f - u - v)
			var p1 := xf * (f + u - v)
			var p2 := xf * (f + u + v)
			var p3 := xf * (f - u + v)
			var wn := (xf.basis * n).normalized()
			_tri(st, p0, p1, p2, wn, wn, wn, wn, color)
			_tri(st, p0, p2, p3, wn, wn, wn, wn, color)


## A cylinder (centre `c`, extents `s`, along `axis`), smooth sides, capped.
static func add_cylinder(st: SurfaceTool, xf: Transform3D, c: Vector3, s: Vector3, axis: String, color: Color, segments := 16) -> void:
	var ai := 0 if axis == "x" else (2 if axis == "z" else 1)
	var bi := (ai + 1) % 3
	var ci := (ai + 2) % 3
	var hl: float = s[ai] / 2.0
	var rb: float = s[bi] / 2.0
	var rc: float = s[ci] / 2.0
	var along := Vector3.ZERO
	along[ai] = 1.0
	var wa := (xf.basis * along).normalized()
	var top := xf * (c + along * hl)
	var bottom := xf * (c - along * hl)
	var rim_lo: Array = []
	var rim_hi: Array = []
	var normals: Array = []
	for i in segments + 1:
		var t := TAU * float(i) / float(segments)
		var p := c
		p[bi] += cos(t) * rb
		p[ci] += sin(t) * rc
		rim_lo.append(xf * (p - along * hl))
		rim_hi.append(xf * (p + along * hl))
		var n := Vector3.ZERO
		n[bi] = cos(t) / maxf(rb, 1e-4)
		n[ci] = sin(t) / maxf(rc, 1e-4)
		normals.append((xf.basis * n).normalized())
	for i in segments:
		var n0: Vector3 = normals[i]
		var n1: Vector3 = normals[i + 1]
		var out := (n0 + n1).normalized()
		_tri(st, rim_lo[i], rim_lo[i + 1], rim_hi[i + 1], n0, n1, n1, out, color)
		_tri(st, rim_lo[i], rim_hi[i + 1], rim_hi[i], n0, n1, n0, out, color)
		_tri(st, top, rim_hi[i], rim_hi[i + 1], wa, wa, wa, wa, color)
		_tri(st, bottom, rim_lo[i + 1], rim_lo[i], -wa, -wa, -wa, -wa, color)


## The strips in a headset (m tall): at the web's 12 mm a far strip is under
## a pixel, a dotted line that crawls.
const NEON_STRIP_H := 0.03


## Wave 47: a neon skirting and cove strip along both faces of every
## `wall` segment (HouseModels.NEON_*), one merged mesh, no colliders.
func _build_neon_strips() -> void:
	var boxes := wall_boxes(walls, HouseGeometry.style_of(house)["wallThickness"])
	var tools := {}
	var hh := NEON_STRIP_H
	var proud := HouseModels.NEON_STRIP_PROUD
	var levels := [[float(HouseModels.NEON_STRIP_AT[0]), Color(HouseModels.NEON_SKIRT)], [-float(HouseModels.NEON_STRIP_AT[1]), Color(HouseModels.NEON_COVE)]]
	for i in boxes.size():
		var box: Dictionary = boxes[i]
		if str(box["kind"]) != "wall":
			continue
		var lo: Vector3 = box["lo"]
		var hi: Vector3 = box["hi"]
		if hi.y - lo.y < 0.5:
			continue
		var along_x: bool = walls[i]["axis"] == "x"
		var floor_id := str(walls[i]["floor"])
		if not tools.has(floor_id):
			tools[floor_id] = SurfaceTool.new()
			(tools[floor_id] as SurfaceTool).begin(Mesh.PRIMITIVE_TRIANGLES)
		var st: SurfaceTool = tools[floor_id]
		for level: Array in levels:
			var at: float = level[0]
			var y := lo.y + at if at > 0.0 else hi.y + at
			for out: float in [-1.0, 1.0]:
				if along_x:
					var z := (lo.z if out < 0.0 else hi.z) + out * proud / 2.0
					add_box(st, Transform3D.IDENTITY, Vector3((lo.x + hi.x) / 2.0, y, z), Vector3(hi.x - lo.x, hh, proud), level[1])
				else:
					var x := (lo.x if out < 0.0 else hi.x) + out * proud / 2.0
					add_box(st, Transform3D.IDENTITY, Vector3(x, y, (lo.z + hi.z) / 2.0), Vector3(proud, hh, hi.z - lo.z), level[1])
	for floor_id: String in tools:
		var mi := MeshInstance3D.new()
		mi.name = "Neon_walls"
		mi.mesh = (tools[floor_id] as SurfaceTool).commit()
		mi.material_override = HouseLook.neon()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_floor_node(floor_id).add_child(mi)


## Wave 47: the haze — soft drifting sheets per floor over its rooms (a
## metre past them): one just over the floor (`medium`), and one just
## under the ceiling too (`high`); none on `low` (HouseModels.HAZE_*).
func _build_haze() -> void:
	var layers := HouseModels.haze_layers(HouseLook.tier)
	if layers == 0:
		return
	for fl: Dictionary in house.get("floors", []):
		var pts: Array = []
		for room: Dictionary in house.get("rooms", []):
			if str(room["floor"]) == str(fl["id"]):
				pts.append_array(room["poly"])
		if pts.is_empty():
			continue
		var b := HouseGeometry.poly_bounds(pts)
		var w: float = float(b[2]) - float(b[0]) + 2.0
		var d: float = float(b[3]) - float(b[1]) + 2.0
		var elevation := float(fl["elevation"])
		var heights := [elevation + float(HouseModels.HAZE_AT[0]), elevation + float(fl["height"]) - float(HouseModels.HAZE_AT[1])]
		for i in layers:
			var plane := PlaneMesh.new()
			plane.size = Vector2(w, d)
			var mi := MeshInstance3D.new()
			mi.name = "Haze_%s_%d" % [fl["id"], i]
			mi.mesh = plane
			mi.position = Vector3((float(b[0]) + float(b[2])) / 2.0, heights[i], (float(b[1]) + float(b[3])) / 2.0)
			var mat := HouseLook.haze_sheet(float(HouseModels.HAZE_OPACITY[i]))
			mat.uv1_scale = Vector3(w / HouseModels.HAZE_TILE_M, d / HouseModels.HAZE_TILE_M, 1.0)
			mi.material_override = mat
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			_floor_node(str(fl["id"])).add_child(mi)
			var drift: Array = HouseModels.HAZE_DRIFT[i]
			mat.albedo_color.a *= _haze_scale
			_haze.append({"mat": mat, "alpha": float(HouseModels.HAZE_OPACITY[i]), "drift": Vector2(float(drift[0]), float(drift[1])) / HouseModels.HAZE_TILE_M})


## (wave 49) Thin the haze to `k` of itself (the `dark` vision: it is unfogged,
## and would glow on through the black). The sheets are few; only a change
## touches them.
func set_haze_scale(k: float) -> void:
	if is_equal_approx(k, _haze_scale):
		return
	_haze_scale = k
	for h: Dictionary in _haze:
		var mat: StandardMaterial3D = h["mat"]
		mat.albedo_color.a = float(h["alpha"]) * k


## How many haze sheets were built (for the tests).
func haze_count() -> int:
	return _haze.size()


## The King (a chess boss in a doorway): a gold body with a small crown on
## top, and over him the shared health bar — a name line and a Win98 bar,
## both turning to face the player.
func _build_king(root: Node3D, prop: Dictionary, pos: Vector3, size: Vector3, basis: Basis, solid: bool) -> void:
	var gold := HouseLook.king_gold(prop.get("color", "#d4af37"))
	# Wave 47: a chess king turned from primitives — plinth, flared foot, a
	# tapering trunk, two collars, a flared head — under a crowned cross,
	# with a red alarm ring round his foot. `Body` is centred on its middle
	# (the kneel scales it there), `Crown` on its own.
	var body_h := size.y - 0.15
	var r := minf(size.x, size.z) / 2.0
	var mi := Node3D.new()
	mi.name = "Body"
	mi.position.y = body_h / 2.0
	root.add_child(mi)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var base := -body_h / 2.0
	# [from, to, radius] as fractions of his body height and radius.
	for ring: Array in [[0.0, 0.07, 1.0], [0.07, 0.13, 0.86], [0.13, 0.27, 0.7], [0.27, 0.42, 0.6], [0.42, 0.57, 0.52], [0.57, 0.72, 0.45], [0.72, 0.76, 0.66], [0.76, 0.8, 0.56], [0.8, 0.9, 0.47], [0.9, 1.0, 0.58]]:
		var y0: float = base + body_h * float(ring[0])
		var y1: float = base + body_h * float(ring[1])
		var dia: float = 2.0 * r * float(ring[2])
		add_cylinder(st, Transform3D.IDENTITY, Vector3(0, (y0 + y1) / 2.0, 0), Vector3(dia, y1 - y0, dia), "y", Color.WHITE, 20)
	var shape := MeshInstance3D.new()
	shape.name = "Shape"
	shape.mesh = st.commit()
	shape.material_override = gold
	mi.add_child(shape)
	var ring_st := SurfaceTool.new()
	ring_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	add_cylinder(ring_st, Transform3D.IDENTITY, Vector3(0, base + body_h * 0.07, 0), Vector3(2.0 * r * 1.02, 0.014, 2.0 * r * 1.02), "y", Color.WHITE, 20)
	var alarm := MeshInstance3D.new()
	alarm.name = "Alarm"
	alarm.mesh = ring_st.commit()
	alarm.material_override = HouseLook.role("alert")
	mi.add_child(alarm)
	var crown := Node3D.new()
	crown.name = "Crown"
	crown.position.y = size.y - 0.075
	root.add_child(crown)
	var cst := SurfaceTool.new()
	cst.begin(Mesh.PRIMITIVE_TRIANGLES)
	add_cylinder(cst, Transform3D.IDENTITY, Vector3(0, -0.05, 0), Vector3(r * 1.0, 0.05, r * 1.0), "y", Color.WHITE, 20)
	add_box(cst, Transform3D.IDENTITY, Vector3(0, 0.0, 0), Vector3(0.035, 0.11, 0.035), Color.WHITE)
	add_box(cst, Transform3D.IDENTITY, Vector3(0, 0.02, 0), Vector3(0.1, 0.03, 0.035), Color.WHITE)
	var cshape := MeshInstance3D.new()
	cshape.name = "Shape"
	cshape.mesh = cst.commit()
	cshape.material_override = gold
	crown.add_child(cshape)
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
	# Set into the face (the cabinet's front is at −0.47 d), bulging out of it.
	var face_z := -d * 0.47
	core.position = Vector3(0, core_y, face_z - core_r * 0.1)
	core.scale = Vector3(1, 1, 0.6)
	root.add_child(core)
	var front := MeshInstance3D.new()
	front.name = "Front"
	var fq := QuadMesh.new()
	fq.size = Vector2(w * 0.8, h * 0.55)
	front.mesh = fq
	var smoke := StandardMaterial3D.new()
	smoke.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	smoke.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	smoke.albedo_color = Color(0.04, 0.04, 0.06, 0.35)
	front.material_override = smoke
	front.rotation.y = PI  # a QuadMesh faces +z; the face looks −z
	front.position = Vector3(0, core_y, face_z - core_r * 0.75)
	root.add_child(front)
	var halo := glow_quad(HEART_COLOR, core_r * 5.0)
	halo.name = "Halo"
	halo.position = Vector3(0, core_y, face_z - core_r * 0.8)
	root.add_child(halo)
	var light := OmniLight3D.new()
	light.name = "Glow"
	light.light_color = HEART_COLOR
	light.omni_range = 2.2
	light.position = Vector3(0, core_y, -d * 0.6)
	root.add_child(light)
	_hearts[str(prop["id"])] = {"root": root, "core": core, "light": light, "mat": mat, "halo": halo}
	_beat(_hearts[str(prop["id"])])


## A soft round glow (an additive billboard) of `color`, `size` m across.
static func glow_quad(color: Color, size: float) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	mi.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.billboard_keep_scale = true
	m.albedo_color = color
	m.albedo_texture = _glow_texture()
	m.disable_receive_shadows = true
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


static var _glow_tex: ImageTexture


## A white radial falloff (alpha), made once.
static func _glow_texture() -> ImageTexture:
	if _glow_tex == null:
		var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
		for y in 32:
			for x in 32:
				var r := Vector2(x - 15.5, y - 15.5).length() / 16.0
				var a := clampf(1.0 - r, 0.0, 1.0)
				img.set_pixel(x, y, Color(1, 1, 1, a * a))
		_glow_tex = ImageTexture.create_from_image(img)
	return _glow_tex


func _beat(heart: Dictionary) -> void:
	var p := heart_pulse(_t)
	var sc := 1.0 + 0.14 * p
	(heart["core"] as Node3D).scale = Vector3(sc, sc, sc * 0.6)
	# The glow swells by its node's scale: a primitive mesh's size would
	# regenerate the mesh every frame (the billboard keeps the scale).
	(heart["halo"] as Node3D).scale = Vector3.ONE * (1.0 + 0.25 * p)
	((heart["halo"] as MeshInstance3D).material_override as StandardMaterial3D).albedo_color.a = 0.35 + 0.55 * p
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
	shell.emission_energy_multiplier = 1.0
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
	var halo := glow_quad(Color(PICKUP_GLOW, 0.55), maxf(w, hgt) * 2.6)
	halo.name = "Halo"
	disk.add_child(halo)
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
	_t += delta
	HouseLook.set_neon(Descent.neon_level(_t, neon_rate) * neon_scale)
	for h: Dictionary in _haze:
		var dr: Vector2 = h["drift"]
		(h["mat"] as StandardMaterial3D).uv1_offset = Vector3(fposmod(dr.x * _t, 1.0), fposmod(dr.y * _t, 1.0), 0.0)
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
		_room_node(door["a"]).add_child(mi)
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
	var body: Node3D = k["body"]
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
		root.scale = Vector3(TERMINAL_SCALE, TERMINAL_SCALE, 1.0)
		_room_node(t["room"]).add_child(root)
		var frame := MeshInstance3D.new()
		var fb := BoxMesh.new()
		fb.size = Vector3(0.36, 0.26, 0.03)
		frame.name = "Frame"
		frame.mesh = fb
		frame.material_override = HouseLook.role("dark")
		root.add_child(frame)
		# Wave 47: a thin neon rim round the bezel (hidden with it under a feed).
		var rim_st := SurfaceTool.new()
		rim_st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var rim_c := HouseLook.TEAL_GLOW
		for bar: Array in [[Vector3(0, 0.13, -0.016), Vector3(0.36, 0.006, 0.004)], [Vector3(0, -0.13, -0.016), Vector3(0.36, 0.006, 0.004)], [Vector3(0.18, 0, -0.016), Vector3(0.006, 0.26, 0.004)], [Vector3(-0.18, 0, -0.016), Vector3(0.006, 0.26, 0.004)]]:
			add_box(rim_st, Transform3D.IDENTITY, bar[0], bar[1], rim_c)
		var rim := MeshInstance3D.new()
		rim.name = "Rim"
		rim.mesh = rim_st.commit()
		rim.material_override = HouseLook.neon()
		root.add_child(rim)
		var glass := MeshInstance3D.new()
		var gq := QuadMesh.new()
		gq.size = Vector2(0.32, 0.22)
		glass.name = "Glass"
		glass.mesh = gq
		glass.material_override = HouseLook.screen()
		glass.rotation.y = PI  # a QuadMesh faces +z; the screen faces −z (its yaw)
		glass.position.z = -0.017
		root.add_child(glass)
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
	(root.get_node("Rim") as Node3D).visible = true
	(root.get_node("Glass") as Node3D).visible = true


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
		bezel.material_override = HouseLook.role("dark")
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
	(root.get_node("Rim") as Node3D).visible = false
	(root.get_node("Glass") as Node3D).visible = false
