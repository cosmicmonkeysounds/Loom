## Headless checks for the VR game (`docs/loom-reinstall.md` §5).
##
## The §1.2 ports are diffed against the goldens `@loom/house` generates
## (`res://test/golden/`, copied by `pnpm --filter @loom/house sync`) at
## 1e-3; the rest covers what has no golden: frames, the duck pick,
## locomotion maths, config precedence, the pose pump, the SSE parser, the
## lobby picker, the King's reach + his doors, the picture decoder, the
## game state machine (with a fake link) and a smoke test that `main.tscn`
## builds the house.
##
##   ./test/run.sh   (or: godot --headless --path . --script res://test/game.gd -- --offline)
extends SceneTree

const GOLDEN_DIR := "res://test/golden/"
const FIXTURE_HOUSES := {
	"show": "res://house/house.json",
}
const TOL := 1e-3
## Mismatches printed per golden file before the rest are only counted.
const SHOW_MISMATCHES := 5

var _failures := 0
var _checks := 0
## The fake wall clock handed to the game.
var _now := 1000.0


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	if not root.is_node_ready():
		await process_frame

	_test_goldens()
	_test_frames()
	_test_duck()
	_test_king_rules()
	_test_wave26_props()
	_test_wave47_look()
	_test_test_combo()
	_test_floor_underside()
	_test_avatar_decode()
	_test_config()
	_test_config_setup()
	_test_sse_parser()
	_test_pose_pump()
	await _test_server_link()
	_test_server_link_intro()
	_test_locomotion()
	_test_picker()
	_test_picker_grid()
	_test_flow()
	_test_intro_flow()
	_test_cam_feeds()
	_test_voice_codec()
	_test_voice_uplink()
	_test_voice_link()
	_test_voice_silent_mic()
	_test_voice_mic_states()
	await _test_voice_generator()
	await _test_cam_panels()
	_test_autopilot()
	await _test_main_and_game()
	await _test_run_reset()
	await _test_wall_bump()
	_test_lobby_geometry()
	_test_lobby_pure()
	_test_server_link_setup()
	await _test_lobby_picker()
	await _test_setup_panel()
	await _test_lobby_mic()
	_test_voice_config()
	_test_voice_server_link()
	await _test_voice_game()
	_test_sfx()
	await _test_speech()
	await _test_sfx_game()
	await _test_path_reveal()
	await _test_escape()
	await _test_heart_pickup()
	await _test_autopilot_physics()
	await _test_room_scale()
	await _test_intro_game()
	_test_house_lights()
	_test_house_lights_link()
	_test_graphics_config()
	await _test_house_lamps()
	await _test_house_lamps_game()

	print("reinstall-vr: %d checks, %d failures" % [_checks, _failures])
	quit(1 if _failures > 0 else 0)


func _check(condition: bool, name: String) -> void:
	_checks += 1
	if not condition:
		_failures += 1
		printerr("  FAIL  %s" % name)


static func _near(a: float, b: float, tol := TOL) -> bool:
	return absf(a - b) <= tol


static func _near3(a: Array, b: Array, tol := TOL) -> bool:
	return _near(a[0], b[0], tol) and _near(a[1], b[1], tol) and _near(a[2], b[2], tol)


# --- goldens ---------------------------------------------------------------


## Every golden map's house: the fixtures are reconstructed from the golden
## names — their sources live in `house/test/fixtures/`, outside this
## project, so the walls golden carries the map's identity and the fixture
## JSON is read from the monorepo when present, else skipped.
func _golden_names() -> Array:
	var names := {}
	for f in DirAccess.get_files_at(GOLDEN_DIR):
		if f.ends_with(".walls.json"):
			names[f.trim_suffix(".walls.json")] = true
	var out := names.keys()
	out.sort()
	return out


## The show's three-floor placeholder map (waves 3–13), frozen in
## `house/test/maps/` when the measured floor plan replaced it (wave 14):
## the King / stair / game suites that pin its coordinates walk it, while
## the goldens and both autopilots walk the live show map.
static func _placeholder_house() -> Dictionary:
	return _read_json(ProjectSettings.globalize_path("res://").path_join("../../house/test/maps/three-floor.json").simplify_path())


func _house_for(name: String) -> Variant:
	var path: String
	if name == "show":
		path = "res://house/house.json"
	else:
		path = ProjectSettings.globalize_path("res://").path_join("../../house/test/fixtures/%s.json" % name).simplify_path()
	if not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))


static func _read_json(path: String) -> Variant:
	return JSON.parse_string(FileAccess.get_file_as_string(path))


func _test_goldens() -> void:
	var names := _golden_names()
	_check(names.has("show"), "goldens: the show's golden is present")
	for name: String in names:
		var house: Variant = _house_for(name)
		if house == null:
			print("  skip  golden %s (fixture source not found)" % name)
			continue
		_golden_walls(name, house)
		_golden_routes(name, house)
		_golden_locate(name, house)
		_golden_king(name, house)
		_golden_wave26(name, house)
	_golden_constants()
	_golden_models()


## A deep compare: numbers within TOL, everything else equal. Returns the
## first difference as text, or "".
static func _diff(a: Variant, b: Variant, path := "") -> String:
	if (a is float or a is int) and (b is float or b is int):
		return "" if _near(float(a), float(b)) else "%s: %s ≠ %s" % [path, a, b]
	if a is Array and b is Array:
		if a.size() != b.size():
			return "%s: length %d ≠ %d (%s vs %s)" % [path, a.size(), b.size(), JSON.stringify(a), JSON.stringify(b)]
		for i in a.size():
			var d := _diff(a[i], b[i], "%s[%d]" % [path, i])
			if d != "":
				return d
		return ""
	if a is Dictionary and b is Dictionary:
		for k: Variant in b:
			if not a.has(k):
				return "%s.%s: missing" % [path, k]
			var d := _diff(a[k], b[k], "%s.%s" % [path, k])
			if d != "":
				return d
		return ""
	if a == null and b == null:
		return ""
	return "" if str(a) == str(b) and typeof(a) == typeof(b) else "%s: %s ≠ %s" % [path, a, b]


func _report(label: String, mismatches: Array, total: int) -> void:
	var line := "%s (%d/%d match)" % [label, total - mismatches.size(), total]
	_check(mismatches.is_empty() and total > 0, line)
	if OS.get_environment("VERBOSE") != "":
		print("  ok    %s" % line)
	for i in mini(mismatches.size(), SHOW_MISMATCHES):
		printerr("        %s" % mismatches[i])
	if mismatches.size() > SHOW_MISMATCHES:
		printerr("        … and %d more" % (mismatches.size() - SHOW_MISMATCHES))


func _golden_walls(name: String, house: Dictionary) -> void:
	var want: Array = _read_json(GOLDEN_DIR + name + ".walls.json")
	var got := HouseGeometry.build_walls(house)
	var mismatches: Array = []
	if got.size() != want.size():
		mismatches.append("count %d ≠ golden %d" % [got.size(), want.size()])
	for i in mini(got.size(), want.size()):
		var d := _diff(got[i], want[i], "walls[%d]" % i)
		if d != "":
			mismatches.append("%s\n          got    %s\n          golden %s" % [d, JSON.stringify(got[i]), JSON.stringify(want[i])])
	_report("golden %s.walls" % name, mismatches, want.size())


func _golden_routes(name: String, house: Dictionary) -> void:
	var want: Array = _read_json(GOLDEN_DIR + name + ".routes.json")
	var mismatches: Array = []
	for q: Dictionary in want:
		var got := HouseRoute.route(house, q["from"], q["to"])
		var d := _diff(got, q["path"], "route")
		if d != "":
			mismatches.append("%s → %s: %s\n          got    %s\n          golden %s" % [
				JSON.stringify(q["from"]), JSON.stringify(q["to"]), d, JSON.stringify(got), JSON.stringify(q["path"])])
	_report("golden %s.routes" % name, mismatches, want.size())


func _golden_locate(name: String, house: Dictionary) -> void:
	var want: Array = _read_json(GOLDEN_DIR + name + ".locate.json")
	var mismatches: Array = []
	for q: Dictionary in want:
		var p: Array = q["p"]
		var loc := HouseLocate.locate(house, p)
		var h: Variant = HouseLocate.height_at(house, [p[0], p[2]], p[1])
		var got := {"floor": loc["floor"], "room": loc["room"], "height": h, "standable": HouseLocate.standable(house, p)}
		var d := _diff(got, {"floor": q["floor"], "room": q["room"], "height": q["height"], "standable": q["standable"]}, JSON.stringify(p))
		if d != "":
			mismatches.append(d)
	_report("golden %s.locate" % name, mismatches, want.size())


## A king map's goldens (when `house:sync` has copied them): `kingReach`
## plain and with the server's slack, and the route queries with every king
## fallen (his doors open).
func _golden_king(name: String, house: Dictionary) -> void:
	var reach_path := GOLDEN_DIR + name + ".king.json"
	if FileAccess.file_exists(reach_path):
		var want: Array = _read_json(reach_path)
		var mismatches: Array = []
		for q: Dictionary in want:
			var prop: Dictionary = {}
			for pr: Dictionary in house.get("props", []):
				if str(pr.get("id", "")) == str(q["king"]):
					prop = pr
			if prop.is_empty():
				mismatches.append("%s: no such king" % q["king"])
				continue
			var got := {"reach": HouseKing.king_reach(house, q["feet"], float(q["yaw"]), prop), "slack": HouseKing.king_reach(house, q["feet"], float(q["yaw"]), prop, HouseKing.KING_HIT_SLACK)}
			var d := _diff(got, {"reach": q["reach"], "slack": q["slack"]}, "%s yaw %s" % [JSON.stringify(q["feet"]), q["yaw"]])
			if d != "":
				mismatches.append(d)
		_report("golden %s.king" % name, mismatches, want.size())
	var fallen_path := GOLDEN_DIR + name + ".fallen.json"
	if FileAccess.file_exists(fallen_path):
		var fallen := {}
		for pr: Dictionary in house.get("props", []):
			if str(pr.get("kind", "")) == "king":
				fallen[str(pr["id"])] = true
		var open := HouseKing.with_fallen_kings(house, fallen)
		var want: Array = _read_json(fallen_path)
		var mismatches: Array = []
		for q: Dictionary in want:
			var got := HouseRoute.route(open, q["from"], q["to"])
			var d := _diff(got, q["path"], "route")
			if d != "":
				mismatches.append("%s → %s: %s" % [JSON.stringify(q["from"]), JSON.stringify(q["to"]), d])
		_report("golden %s.fallen" % name, mismatches, want.size())


## Wave 26 (C5): the void (`<name>.escape.json`), presence
## (`<name>.presence.json`) and the heart / pickup reach
## (`<name>.moments.json`, maps with those props).
func _golden_wave26(name: String, house: Dictionary) -> void:
	var escape_path := GOLDEN_DIR + name + ".escape.json"
	_check(FileAccess.file_exists(escape_path), "golden %s.escape is synced" % name)
	if FileAccess.file_exists(escape_path):
		var want: Array = _read_json(escape_path)
		var mismatches: Array = []
		var ground: Variant = HouseEscape.outside_ground(house)
		var d0 := _diff(ground, want[0]["ground"], "ground")
		if d0 != "" or (ground == null) != (want[0]["ground"] == null):
			mismatches.append("outside_ground %s, golden %s" % [JSON.stringify(ground), JSON.stringify(want[0]["ground"])])
		for q: Dictionary in want.slice(1):
			var got: Variant = HouseEscape.void_distance(house, q["p"])
			var w: Variant = q["d"]
			var ok: bool
			if w == null:
				ok = got == null
			elif w is String:
				ok = got != null and is_inf(float(got))
			else:
				ok = got != null and _near(float(got), float(w))
			if not ok:
				mismatches.append("%s: void %s, golden %s" % [JSON.stringify(q["p"]), got, w])
		_report("golden %s.escape" % name, mismatches, want.size())
	var presence_path := GOLDEN_DIR + name + ".presence.json"
	_check(FileAccess.file_exists(presence_path), "golden %s.presence is synced" % name)
	if FileAccess.file_exists(presence_path):
		var want: Array = _read_json(presence_path)
		var mismatches: Array = []
		for q: Dictionary in want:
			if q.has("prev"):
				var got: Variant = HouseLocate.presence_room(house, q["p"], q["prev"])
				if got != q["room"] and not (got != null and q["room"] != null and str(got) == str(q["room"])):
					mismatches.append("%s from %s: %s, golden %s" % [JSON.stringify(q["p"]), q["prev"], got, q["room"]])
			else:
				var spots := HouseLocate.linked_spots(house, q["rooms"])
				if spots != (q["spots"] as Array).map(func(v: Variant) -> String: return str(v)):
					mismatches.append("linked %s: %s, golden %s" % [JSON.stringify(q["rooms"]), spots, q["spots"]])
		_report("golden %s.presence" % name, mismatches, want.size())
	var moments_path := GOLDEN_DIR + name + ".moments.json"
	if FileAccess.file_exists(moments_path):
		var want: Array = _read_json(moments_path)
		var mismatches: Array = []
		for q: Dictionary in want:
			if q.has("heart"):
				var heart := HouseMoment.moment_prop(house, str(q["heart"]), "heart")
				if heart.is_empty() or HouseMoment.heart_reached(house, q["p"], heart) != bool(q["reached"]):
					mismatches.append("heart %s at %s: golden %s" % [q["heart"], JSON.stringify(q["p"]), q["reached"]])
			else:
				var prop := HouseMoment.moment_prop(house, str(q["pickup"]), "pickup")
				if prop.is_empty() or HouseMoment.pickup_reach(house, q["p"], prop) != bool(q["reach"]) or HouseMoment.pickup_reach(house, q["p"], prop, HouseMoment.PICKUP_SLACK_M) != bool(q["slack"]):
					mismatches.append("pickup %s at %s: golden %s / %s" % [q["pickup"], JSON.stringify(q["p"]), q["reach"], q["slack"]])
		_report("golden %s.moments" % name, mismatches, want.size())


## An upper floor has an underside (in its Ceilings), cut by the stair
## holes like the floor: from the backyard nobody sees up into the bedroom.
func _test_floor_underside() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var b := HouseBuilder.new()
	b.build(house)
	var top_y := 0.0
	for fl: Dictionary in house["floors"]:
		if str(fl["id"]) == "top":
			top_y = float(fl["elevation"])
	var under_y := top_y - HouseBuilder.UNDERSIDE_GAP
	var ceil := b.part("Floor_top/Ceilings") as MeshInstance3D
	var faces: PackedVector3Array = ceil.mesh.get_faces() if ceil != null else PackedVector3Array()
	# The backyard under the Graphics Card's overhang, and the upstairs stair's middle.
	var yard := Vector2(-4.0, 22.0)
	var r: Array = []
	for st: Dictionary in house["stairs"]:
		if str(st["id"]) == "upstairs":
			r = st["rect"]
	var hole := Vector2((float(r[0]) + float(r[2])) / 2.0, (float(r[1]) + float(r[3])) / 2.0)
	var covers := func(at: Vector2) -> bool:
		for i in range(0, faces.size(), 3):
			var a := faces[i]
			if absf(a.y - under_y) > 1e-4:
				continue
			var hit: Variant = Geometry3D.ray_intersects_triangle(Vector3(at.x, 1.6, at.y), Vector3.UP, faces[i], faces[i + 1], faces[i + 2])
			if hit != null:
				return true
		return false
	_check(covers.call(yard), "underside: the top floor is closed from below over the backyard")
	_check(not covers.call(hole), "underside: the stair's hole stays open")
	var lowest := b.part("Floor_basement/Ceilings") as MeshInstance3D
	var low_faces := lowest.mesh.get_faces() if lowest != null else PackedVector3Array()
	var low_under := false
	for v: Vector3 in low_faces:
		low_under = low_under or absf(v.y - (-2.7 - HouseBuilder.UNDERSIDE_GAP)) < 1e-4
	_check(not low_under, "underside: the lowest floor has none")
	b.free()


## The lobby's test-level combo (B B A A B A B A A B B, A / X and B / Y).
func _test_test_combo() -> void:
	var c := TestCombo.new()
	var hit := false
	for k: String in TestCombo.SEQUENCE:
		hit = _press(c, k, 0.3)
	_check(hit, "combo: B B A A B A B A A B B fires")
	_check(not _press(c, "B", 0.3), "combo: it starts over after firing")
	c = TestCombo.new()
	var bad := false
	for k: String in "BBAABABAAB":
		bad = _press(c, k, 0.3) or bad
	_check(not bad, "combo: one press short does not fire")
	c = TestCombo.new()
	var slow := false
	for i in TestCombo.SEQUENCE.length():
		slow = _press(c, TestCombo.SEQUENCE[i], 2.0 if i == 5 else 0.3) or slow
	_check(not slow, "combo: a pause longer than GAP starts it over")
	c = TestCombo.new()
	var late := false
	for k: String in "BB" + TestCombo.SEQUENCE:
		late = _press(c, k, 0.3) or late
	_check(late, "combo: extra presses before it still let it fire")
	c = TestCombo.new()
	var held := false
	for i in 20:
		held = c.feed(false, true, 0.05) or held
	_check(not held, "combo: holding B counts once")


## Press `key` ("A" / "B") `after` seconds on, then release it.
func _press(c: TestCombo, key: String, after: float) -> bool:
	var hit := c.feed(key == "A", key == "B", after)
	c.feed(false, false, 0.0)
	return hit


## Every merged mesh named `node_name` (one per floor, and the builder's own).
func _per_floor(b: HouseBuilder, node_name: String) -> Array:
	var out: Array = []
	for parent: Node in [b] + b.get_children().filter(func(c: Node) -> bool: return c.name.begins_with("Floor_")):
		var m := parent.get_node_or_null(node_name)
		if m is MeshInstance3D:
			out.append(m)
	return out


func _faces(b: HouseBuilder, node_name: String) -> int:
	var n := 0
	for m: MeshInstance3D in _per_floor(b, node_name):
		n += m.mesh.get_faces().size()
	return n


## Wave 47: model props drawn from their parts (merged per role), plain
## props merged too and still colliding, the walls' neon, the haze sheets per
## tier and the hazy environment.
func _test_wave47_look() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var b := HouseBuilder.new()
	b.build(house)
	var colliders := (b.get_node("Colliders") as Node).get_child_count()
	_check(not _per_floor(b, "Props_body").is_empty(), "wave 47: the plain props are one merged body mesh")
	_check(_per_floor(b, "Neon_walls").size() > 0 and _per_floor(b, "Neon_walls").all(func(m: MeshInstance3D) -> bool: return m.material_override == HouseLook.neon()), "wave 47: the walls carry neon strips in the shared neon")
	var boxes := HouseBuilder.wall_boxes(b.walls, HouseGeometry.style_of(house)["wallThickness"]).filter(func(x: Dictionary) -> bool: return x["kind"] == "wall" and (x["hi"] as Vector3).y - (x["lo"] as Vector3).y >= 0.5)
	var strip_tris := _faces(b, "Neon_walls") / 3
	_check(strip_tris == boxes.size() * 4 * 12, "wave 47: a skirting and a cove strip on both faces of every wall (%d tris, %d walls)" % [strip_tris, boxes.size()])
	b.free()
	var modelled: Dictionary = house.duplicate(true)
	var room: String = modelled["spawn"]["room"]
	var spawn: Array = modelled["spawn"]["pos"]
	(modelled["props"] as Array).append({"id": "w47-rack", "room": room, "kind": "box", "model": "rack", "pos": [spawn[0], spawn[1], spawn[2]], "size": [0.6, 2, 1], "neon": "#ff00aa"})
	(modelled["props"] as Array).append({"id": "w47-bin", "room": room, "kind": "cylinder", "model": "bin", "pos": [spawn[0], spawn[1], spawn[2]], "size": [0.35, 0.5, 0.35]})
	(modelled["props"] as Array).append({"id": "w47-odd", "room": room, "kind": "box", "model": "jukebox", "pos": [spawn[0], spawn[1], spawn[2]], "size": [0.5, 1, 0.5]})
	var b2 := HouseBuilder.new()
	b2.build(modelled)
	_check((b2.get_node("Colliders") as Node).get_child_count() == colliders + 3, "wave 47: a model prop still collides as its plain shape (one collider each)")
	var roles_built: Array = []
	for r: String in HouseModels.PART_ROLES:
		if not _per_floor(b2, "Props_%s" % r).is_empty():
			roles_built.append(r)
	_check(roles_built.has("body") and roles_built.has("neon") and roles_built.has("trim") and roles_built.has("dark") and roles_built.has("alert"), "wave 47: a rack draws its parts in their roles (%s)" % [roles_built])
	_check((_per_floor(b2, "Props_neon")[0] as MeshInstance3D).material_override == HouseLook.neon() and (HouseLook.neon() as StandardMaterial3D).disable_fog, "wave 47: model neon is the shared, unfogged neon")
	_check(b2.part("Prop_w47-rack") != null and b2.part("Prop_w47-odd") != null, "wave 47: every prop keeps its Prop_<id> root")
	var neon_faces := _faces(b2, "Props_neon")
	var plain: Dictionary = house.duplicate(true)
	for pr: Dictionary in plain["props"]:
		pr.erase("model")
	var b3 := HouseBuilder.new()
	b3.build(plain)
	_check(_per_floor(b3, "Props_neon").is_empty() and neon_faces > 0, "wave 47: plain props add no neon; models do")
	_check((b3.get_node("Colliders") as Node).get_child_count() == colliders, "wave 47: the same colliders with or without models")
	b3.free()
	b2.free()
	# The neon flickers with the builder's clock.
	HouseLook.set_neon(0.35)
	_check(_near(HouseLook.neon().albedo_color.r, HouseModels.NEON_GAIN * 0.35), "wave 47: set_neon dims the neon")
	HouseLook.set_neon(1.0)
	# The haze sheets per tier (each floor with rooms gets that many).
	var floors_with_rooms := {}
	for rm: Dictionary in house["rooms"]:
		floors_with_rooms[rm["floor"]] = true
	var was := HouseLook.tier
	for t: String in ["low", "medium", "high"]:
		HouseLook.set_tier(t)
		var bh := HouseBuilder.new()
		bh.build(house)
		_check(bh.haze_count() == HouseModels.haze_layers(t) * floors_with_rooms.size(), "wave 47: %s has %d haze sheets per floor (%d)" % [t, HouseModels.haze_layers(t), bh.haze_count()])
		bh.free()
	HouseLook.set_tier(was)
	for t: String in HouseLights.TIERS:
		var env := HouseLook.environment(t)
		_check(env.fog_enabled and env.fog_mode == Environment.FOG_MODE_EXPONENTIAL and env.fog_density >= 0.04 and env.fog_height_density > 0.0 and env.fog_light_color == HouseLook.HAZE and env.background_color == HouseLook.HAZE and not env.volumetric_fog_enabled, "wave 47: %s is hazy (violet exponential fog, thicker near the floor; no volumetric fog)" % t)
	# White plastic stays under the glow's threshold.
	var body := HouseLook.role("body") as StandardMaterial3D
	_check(body.vertex_color_use_as_albedo and body.albedo_color.r < 0.9 and body.roughness < 0.5, "wave 47: the bodies are glossy, coloured per vertex, a little under white")


## Wave 26: the show's heart and disk build nothing yet (the vr lane draws
## them), carry no collider and no label; the rules read them.
func _test_wave26_props() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var heart := HouseMoment.moment_prop(house, "server-heart", "heart")
	var disk := HouseMoment.moment_prop(house, "virus-disk", "pickup")
	_check(not heart.is_empty() and not disk.is_empty(), "wave 26: the show map has the heart and the disk")
	_check(HouseMoment.moment_prop(house, "virus-disk", "heart").is_empty(), "wave 26: a prop is found only by its kind")
	_check(not HouseGeometry.prop_solid(heart) and not HouseGeometry.prop_solid(disk), "wave 26: neither collides")
	_check(HouseMoment.prop_signal(heart) == HouseMoment.HEART_SIGNAL and HouseMoment.prop_signal(disk) == HouseMoment.PICKUP_SIGNAL and HouseMoment.prop_signal({"kind": "box"}) == "", "wave 26: the default signals")
	_check(HouseMoment.heart_reached(house, heart["pos"], heart), "wave 26: standing at the heart reaches it")
	_check(HouseMoment.pickup_reach(house, disk["pos"], disk), "wave 26: standing on the disk reaches it")
	var b := HouseBuilder.new()
	b.build(house)
	var hn := b.part("Prop_server-heart")
	var dn := b.part("Prop_virus-disk")
	# Stage B (vr lane, R6 / R7): the builder draws both — no label, no collider.
	_check(hn != null and hn.get_node_or_null("Core") != null and hn.get_node_or_null("Front") != null and hn.get_node_or_null("Glow") is OmniLight3D, "wave 26: the heart is a rack with a core, a smoked front and a glow")
	_check(dn != null and dn.get_node_or_null("Disk/Shell") != null and dn.get_node_or_null("Disk/Sticker") != null and dn.get_node_or_null("Disk/Glow") is OmniLight3D, "wave 26: the pickup is a floppy disk with a glow")
	var labels := (hn.find_children("*", "Label3D", true, false) + dn.find_children("*", "Label3D", true, false)) if hn != null and dn != null else [null]
	_check(labels.is_empty(), "wave 26: neither carries any text (nothing like the patch bay)")
	var colliders_before := (b.get_node("Colliders") as Node).get_child_count()
	var stripped: Dictionary = house.duplicate(true)
	stripped["props"] = (stripped["props"] as Array).filter(func(pr: Dictionary) -> bool: return pr["kind"] != "heart" and pr["kind"] != "pickup")
	var b2 := HouseBuilder.new()
	b2.build(stripped)
	_check((b2.get_node("Colliders") as Node).get_child_count() == colliders_before, "wave 26: neither adds a collider")
	b2.free()
	_check(not b.heart_shown("server-heart"), "wave 26: the heart is hidden while the King has not fallen (no shared King)")
	b.set_king({"id": "cold-lock-king", "hp": 3, "max": 15, "fallen": false})
	_check(not b.heart_shown("server-heart"), "wave 26: … nor while he stands")
	b.set_king({"id": "cold-lock-king", "hp": 0, "max": 15, "fallen": true})
	_check(b.heart_shown("server-heart") and _near(float(b.heart_node("server-heart").get_meta("height")), 1.7), "wave 26: … and shows once he has fallen")
	var halo := b.heart_node("server-heart").get_node("Halo") as MeshInstance3D
	var halo_mesh := halo.mesh
	var halo_size := (halo.mesh as QuadMesh).size
	b.set("_t", 0.09)
	b._process(0.0)
	_check(halo.mesh == halo_mesh and (halo.mesh as QuadMesh).size == halo_size and halo.scale.x > 1.2 and (halo.material_override as StandardMaterial3D).billboard_keep_scale, "wave 26: the heart's glow swells by its scale, never by rebuilding its mesh (%.2f)" % halo.scale.x)
	_check(b.pickup_shown("virus-disk") and _near(b.pickup_disk("virus-disk").position.y, HouseBuilder.PICKUP_HOVER, HouseBuilder.PICKUP_BOB + 1e-3), "wave 26: the disk floats over its spot")
	var spin0 := b.pickup_disk("virus-disk").rotation.y
	b._process(0.5)
	_check(not _near(b.pickup_disk("virus-disk").rotation.y, spin0), "wave 26: … and spins")
	b.set_pickup_taken("virus-disk", true)
	b.build(house)
	_check(not b.pickup_shown("virus-disk") and b.heart_shown("server-heart"), "wave 26: a taken disk stays hidden across a rebuild; the heart keeps the King's state")
	b.clear_taken()
	_check(b.pickup_shown("virus-disk"), "wave 26: clear_taken shows it again")
	var nok: Dictionary = house.duplicate(true)
	nok["props"] = (nok["props"] as Array).filter(func(pr: Dictionary) -> bool: return pr["kind"] != "king")
	b.set_king({})
	b.build(nok)
	_check(b.heart_shown("server-heart"), "wave 26: on a map with no King the heart always shows")
	_check(HouseBuilder.heart_pulse(0.0) == 0.0 and _near(HouseBuilder.heart_pulse(0.09), 1.0) and _near(HouseBuilder.heart_pulse(0.35), 0.65) and HouseBuilder.heart_pulse(1.0) == 0.0 and _near(HouseBuilder.heart_pulse(1.29), 1.0), "wave 26: the beat is the three.js heart's lub-dub every 1.2 s")
	b.free()
	# The front door's outside: the void grows past it; the spawn is no void.
	var front: Array = [-0.45, 0.0, -5.0]
	_check(HouseEscape.void_distance(house, house["spawn"]["pos"]) == null, "escape: the spawn is in a room")
	_check(float(HouseEscape.void_distance(house, front)) >= HouseEscape.ESCAPE_M - 1e-9, "escape: 5 m out of the front door is an escape")
	_check(HouseLocate.presence_room(house, [4.5, -2.7, 21.5], "basement-hall") == "basement-hall" and HouseLocate.presence_room(house, [4.5, -2.7, 22.0], "basement-hall") == "server-room", "presence: the Server Room's doorway holds 0.75 m")
	_check(not HouseLocate.linked_spots(house, ["tent"]).has("tent") and HouseLocate.linked_spots(house, ["desktop"]) == ["desktop-tv"], "presence: the tent is never linked; the Desktop links the TV")


## Every wave 26 constant (`constants.json`) in its port.
func _golden_constants() -> void:
	var path := GOLDEN_DIR + "constants.json"
	_check(FileAccess.file_exists(path), "goldens: constants.json is synced")
	if not FileAccess.file_exists(path):
		return
	var want: Dictionary = _read_json(path)
	var scripts := [
		load("res://house/house_escape.gd").get_script_constant_map(),
		load("res://house/house_locate.gd").get_script_constant_map(),
		load("res://house/house_route.gd").get_script_constant_map(),
		load("res://house/house_moment.gd").get_script_constant_map(),
	]
	var bad: Array = []
	for k: String in want:
		var found := false
		for consts: Dictionary in scripts:
			if consts.has(k):
				var v: Variant = consts[k]
				var w: Variant = want[k]
				found = (_near(float(v), float(w), 1e-9)) if (w is float or w is int) and (v is float or v is int) else (str(v) == str(w) and typeof(v) == typeof(w))
				break
		if not found:
			bad.append(k)
	_check(bad.is_empty() and want.size() >= 13, "goldens: the wave 26 constants are ported (%s)" % [bad])
	_check(HouseEscape.OUTSIDE_GROUND_MARGIN == HouseBuilder.GROUND_MARGIN, "escape: the outside ground is the builder's (GROUND_MARGIN)")


## (wave 47) Every model's parts at three sizes, against `models.json`.
func _golden_models() -> void:
	var path := GOLDEN_DIR + "models.json"
	_check(FileAccess.file_exists(path), "goldens: models.json is synced")
	if not FileAccess.file_exists(path):
		return
	var want: Array = _read_json(path)
	var mismatches: Array = []
	var seen := {}
	for row: Dictionary in want:
		var size: Array = row["size"]
		seen[row["model"]] = true
		var got: Array = []
		for p: Dictionary in HouseModels.parts_of(str(row["model"]), float(size[0]), float(size[1]), float(size[2])):
			var c: Vector3 = p["c"]
			var sz: Vector3 = p["s"]
			got.append({"role": p["role"], "shape": p["shape"], "axis": p["axis"], "c": [c.x, c.y, c.z], "s": [sz.x, sz.y, sz.z]})
		var d := _diff(got, row["parts"], "%s %s" % [row["model"], JSON.stringify(size)])
		if d != "":
			mismatches.append(d)
	_report("golden models", mismatches, want.size())
	_check(seen.size() == HouseModels.PROP_MODELS.size(), "models: the golden covers every model (%d / %d)" % [seen.size(), HouseModels.PROP_MODELS.size()])
	var flick := [HouseModels.neon_flicker(0.0), HouseModels.neon_flicker(0.02), HouseModels.neon_flicker(0.05), HouseModels.neon_flicker(1.0), HouseModels.neon_flicker(9.7 + 0.02), HouseModels.neon_flicker(-0.5)]
	# sin(1.8) > 0, sin(4.5) < 0: the stutter; past 0.35 s it is steady.
	_check(flick == [0.35, 1.0, 0.35, 1.0, 1.0, 1.0], "models: the neon flicker (%s)" % [flick])
	_check(HouseModels.haze_layers("low") == 0 and HouseModels.haze_layers("medium") == 1 and HouseModels.haze_layers("high") == 2, "models: haze sheets per tier 0 / 1 / 2")


# --- frames + duck ---------------------------------------------------------


func _test_frames() -> void:
	var t := {"offset": [10.0, 0.5, -2.0], "yaw": 90.0, "scale": 2.0}
	var p := [1.25, 0.5, -3.0]
	var back := HouseFrames.from_space(t, HouseFrames.to_space(t, p))
	_check(_diff(back, p) == "", "frames: from_space ∘ to_space = identity")
	# Ry(90°) turns north (−z) into west (−x).
	var w := HouseFrames.to_space({"offset": [0.0, 0.0, 0.0], "yaw": 90.0, "scale": 1.0}, [0.0, 0.0, -1.0])
	_check(_diff(w, [-1.0, 0.0, 0.0]) == "", "frames: yaw 90 turns north to west")
	_check(_near(HouseFrames.yaw_to_space(t, 120.0), -150.0), "frames: yaw wraps into [-180, 180)")
	_check(_near(HouseFrames.yaw_from_space(t, HouseFrames.yaw_to_space(t, 33.0)), 33.0), "frames: yaw round trip")
	_check(_near(HouseFrames.wrap_yaw(180.0), -180.0), "frames: 180 wraps to -180")
	_check(_diff(HouseFrames.forward(90.0), [-1.0, 0.0, 0.0]) == "", "frames: forward(90) is west")
	# The Godot bridge agrees with the pure maths.
	var xf := HouseFrames.transform_of(t)
	_check(_diff(HouseFrames.arr(xf * HouseFrames.vec(p)), HouseFrames.to_space(t, p)) == "", "frames: transform_of matches to_space")
	var node_basis := Basis(Vector3.UP, deg_to_rad(-120.0))
	_check(_near(HouseFrames.yaw_of(node_basis), -120.0), "frames: yaw_of reads rotation.y")
	var look_up := Basis(Vector3.RIGHT, deg_to_rad(20.0))
	_check(_near(HouseFrames.pitch_of(look_up), 20.0), "frames: pitch_of (+ = up)")
	var sp := HouseFrames.space_of({"spaces": {"vr": {"yaw": 45}}}, "vr")
	_check(_near(sp["scale"], 1.0) and _near(sp["yaw"], 45.0), "frames: a partial space is completed")
	_check(_near(HouseFrames.space_of({}, "vr")["scale"], 1.0), "frames: a missing space is the identity")


func _test_duck() -> void:
	_check(HouseDuck.fnv1a32("") == 0x811c9dc5, "duck: fnv1a32('')")
	_check(HouseDuck.fnv1a32("a") == 0xe40c292c, "duck: fnv1a32('a')")
	_check(HouseDuck.fnv1a32("foobar") == 0xbf9cf968, "duck: fnv1a32('foobar')")
	var house: Dictionary = _read_json("res://house/house.json")
	var spawn_room := str(house["spawn"]["room"])
	var spot: Dictionary = HouseDuck.pick_duck_spot(house, "s-1")
	_check(str(spot["room"]) != spawn_room, "duck: never in the spawn room")
	_check(str(HouseDuck.pick_duck_spot(house, "s-1")["id"]) == str(spot["id"]), "duck: deterministic per seed")
	var other: Dictionary = HouseDuck.pick_duck_spot(house, "s-1", [spot["id"]])
	_check(str(other["id"]) != str(spot["id"]), "duck: avoid skips the last spot")


# --- the King + pictures ---------------------------------------------------


## The show map's King, standing in the Server Room door ([-3, 11.2], the
## basement hall to the east): `kingReach`, the door's gap, the fallen map.
func _test_king_rules() -> void:
	var house: Dictionary = _placeholder_house()
	var king := HouseKing.king_prop(house)
	_check(not king.is_empty() and str(king["id"]) == "cold-lock-king", "king: the show's King is a king prop")
	if king.is_empty():
		return
	var kp: Array = king["pos"]
	var east := [float(kp[0]) + 0.95, float(kp[1]), float(kp[2])]
	# Yaw 90 looks west (at him from the east), 0 north, −90 east.
	_check(HouseKing.king_reach(house, east, 90.0, king) == "ok", "king: near and facing him is ok")
	_check(HouseKing.king_reach(house, east, 0.0, king) == "facing", "king: looking north past him is facing")
	_check(HouseKing.king_reach(house, east, 90.0 + 54.0, king) == "ok" and HouseKing.king_reach(house, east, 90.0 + 56.0, king) == "facing", "king: the cone is 55° either side")
	_check(HouseKing.king_reach(house, east, 90.0 - 54.0, king) == "ok" and HouseKing.king_reach(house, east, 90.0 - 56.0, king) == "facing", "king: … on both sides")
	_check(HouseKing.king_reach(house, [float(kp[0]) + 1.24, float(kp[1]), float(kp[2])], 90.0, king) == "ok", "king: 1.24 m is in reach")
	_check(HouseKing.king_reach(house, [float(kp[0]) + 1.26, float(kp[1]), float(kp[2])], 90.0, king) == "far", "king: 1.26 m is far (KING_REACH 1.25)")
	_check(HouseKing.king_reach(house, [float(kp[0]) + 0.95, 0.0, float(kp[2])], 90.0, king) == "floor", "king: right above him, a floor up, is floor")
	_check(HouseKing.king_reach(house, [float(kp[0]) + 3.0, 0.0, float(kp[2])], 0.0, king) == "floor", "king: floor is judged before far")
	_check(HouseKing.king_reach(house, [kp[0], kp[1], kp[2]], -123.0, king) == "ok", "king: standing on his centre counts as facing him")
	var wide := [float(kp[0]) + 1.4, float(kp[1]), float(kp[2])]
	_check(HouseKing.king_reach(house, wide, 90.0 + 70.0, king) == "far" and HouseKing.king_reach(house, wide, 90.0 + 70.0, king, HouseKing.KING_HIT_SLACK) == "ok", "king: the server's slack reaches 1.4 m and 70° off")
	# keepDoorOpen: behind his door (the Server Room), in its doorway or in
	# his box grown by KEEP_CLEAR holds it open; beside him, clear, does not.
	_check(HouseKing.keep_door_open(house, king, [-5.0, -2.7, 9.5]), "king: behind his door keeps it open")
	_check(HouseKing.keep_door_open(house, king, [-3.1, -2.7, 11.2]), "king: in the doorway keeps it open")
	_check(HouseKing.keep_door_open(house, king, [kp[0], kp[1], kp[2]]), "king: on his spot keeps it open")
	_check(HouseKing.keep_door_open(house, king, [float(kp[0]) + 0.69, float(kp[1]), float(kp[2])]) and not HouseKing.keep_door_open(house, king, [float(kp[0]) + 0.71, float(kp[1]), float(kp[2])]), "king: his box grown by KEEP_CLEAR (0.3 + 0.4) keeps it open, beyond is clear")
	_check(not HouseKing.keep_door_open(house, king, east), "king: beside him in the hall is clear")
	_check(not HouseKing.keep_door_open(house, king, [float(kp[0]), 0.0, float(kp[2])]), "king: a floor up is clear")
	_check(HouseKing.king_max(king) == int(king["hp"]) and HouseKing.king_max({"kind": "king"}) == HouseKing.KING_HP and HouseKing.king_max({"hp": 2.5}) == HouseKing.KING_HP, "king: his max hp is the prop's integer hp, else KING_HP")

	var door: Dictionary = {}
	for d: Dictionary in house["doors"]:
		if str(d.get("guard", "")) == str(king["id"]):
			door = d
	_check(not door.is_empty(), "king: he guards a door")
	var gap: Variant = HouseGeometry.door_gap(house, door)
	_check(gap is Dictionary and gap["axis"] == "z" and _near(gap["c"], -3.0) and _near(gap["lo"], 10.8) and _near(gap["hi"], 11.6), "door gap: the Server Room door is the x = −3 line, z 10.8–11.6 (%s)" % [gap])
	_check(gap is Dictionary and _near(gap["bottom"], -2.7) and _near(gap["top"], -2.7 + float(HouseGeometry.style_of(house)["doorHeight"])), "door gap: floor to door top")
	_check(HouseGeometry.door_gap(house, {"id": "x", "a": "nowhere", "at": [0, 0], "width": 1.0}) == null, "door gap: no room, no gap")

	var inside := [-5.0, -2.7, 9.5]
	var shut := HouseRoute.route(house, house["spawn"]["pos"], inside)
	_check(shut.size() == 2, "route: the guarded door is shut for routing")
	_check(HouseKing.trail_map(house, str(king["id"]), false) == house, "king: standing, the trail's map is the map")
	var open := HouseKing.trail_map(house, str(king["id"]), true)
	_check(HouseKing.king_prop(open).get("solid") == false and not HouseGeometry.prop_solid(HouseKing.king_prop(open)) and open["doors"].size() == house["doors"].size(), "king: fallen, he is no longer solid and every door stays")
	_check(open["doors"].all(func(d: Dictionary) -> bool: return d.get("guard") == null), "king: … none guarded")
	_check(HouseKing.with_fallen_kings(house, {"nobody": true}) == house, "king: a set naming no king is the map itself")
	_check(house["doors"].any(func(d: Dictionary) -> bool: return d.get("guard") != null), "king: … the source map is untouched")
	var through := HouseRoute.route(open, house["spawn"]["pos"], inside)
	_check(through.size() > 2 and through.any(func(q: Array) -> bool: return _near3(q, [-3.0, -2.7, 11.2], 0.01)), "route: fallen, the trail goes through his door (%s)" % [through])

	_check(HouseKing.state_of(null).is_empty() and HouseKing.state_of({"hp": "x", "max": 15}).is_empty(), "king state: null / junk is no shared King")
	var st := HouseKing.state_of({"id": "k", "hp": 0.0, "max": 15.0, "fallen": false, "by": "Ada"})
	_check(st.get("hp") == 0 and st.get("max") == 15 and st.get("fallen") == true and st.get("by") == "Ada", "king state: hp 0 is fallen whatever the flag (%s)" % [st])
	_check(not HouseKing.changed(st, HouseKing.state_of({"id": "k", "hp": 0, "max": 15, "fallen": true, "by": null})), "king state: who did it isn't a change")
	_check(HouseKing.changed({}, st) and HouseKing.changed(st, {}) and not HouseKing.changed({}, {}), "king state: appearing and going are changes")


## A tiny picture of each kind, by magic bytes (the fixtures are drawn here:
## no binary files in the repo).
func _test_avatar_decode() -> void:
	var src := Image.create(4, 3, false, Image.FORMAT_RGBA8)
	src.fill(Color(0.2, 0.4, 0.8))
	var png := src.save_png_to_buffer()
	var jpg := src.save_jpg_to_buffer()
	var webp := src.save_webp_to_buffer()
	var svg := '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="5" fill="#d4af37"/></svg>'.to_utf8_buffer()
	var bom := PackedByteArray([0xEF, 0xBB, 0xBF, 0x0A, 0x20])
	bom.append_array(svg)
	var gif := "GIF89a".to_ascii_buffer()
	gif.append_array(PackedByteArray([1, 0, 1, 0, 0, 0, 0]))
	var avif := PackedByteArray([0, 0, 0, 0x1C])
	avif.append_array("ftypavif".to_ascii_buffer())
	_check(AvatarCache.sniff(png) == "png" and AvatarCache.sniff(jpg) == "jpeg" and AvatarCache.sniff(webp) == "webp", "avatar: png / jpeg / webp by magic bytes")
	_check(AvatarCache.sniff(svg) == "svg" and AvatarCache.sniff(bom) == "svg", "avatar: an svg starts with < (after a BOM and whitespace)")
	_check(AvatarCache.sniff("not a picture".to_utf8_buffer(), "image/svg+xml") == "svg", "avatar: … or is served as image/svg+xml")
	_check(AvatarCache.sniff(gif) == "gif" and AvatarCache.sniff(avif) == "avif" and AvatarCache.sniff("hello".to_utf8_buffer()) == "", "avatar: gif / avif / junk are told apart")
	var p := AvatarCache.decode(png)
	_check(p != null and p.get_width() == 4 and p.get_height() == 3, "avatar: a png decodes")
	_check(AvatarCache.decode(jpg) != null and AvatarCache.decode(webp) != null, "avatar: a jpeg and a webp decode")
	var s := AvatarCache.decode(bom)
	_check(s != null and maxi(s.get_width(), s.get_height()) >= 128 and maxi(s.get_width(), s.get_height()) <= 512, "avatar: a sizeless svg renders near 256 px (%s)" % [s.get_size() if s != null else null])
	# A huge declared size renders once near 256 px (never full size first:
	# 40000² would be past Godot's image limit, and seconds on a Quest).
	var huge := '<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="20000px" viewBox="0 0 10 5"><rect width="10" height="5" stroke-width="3" fill="#d4af37"/></svg>'.to_utf8_buffer()
	_check(_near(AvatarCache.svg_side(huge), 40000.0) and _near(AvatarCache.svg_side(svg), 10.0) and _near(AvatarCache.svg_side('<svg width="1in" height="50%">'.to_utf8_buffer()), 96.0) and AvatarCache.svg_side('<svg>'.to_utf8_buffer()) == 0.0, "avatar: an svg's declared side (width / height in absolute units, else the viewBox)")
	var t0 := Time.get_ticks_msec()
	var h := AvatarCache.decode(huge)
	var took := Time.get_ticks_msec() - t0
	_check(h != null and maxi(h.get_width(), h.get_height()) >= 200 and maxi(h.get_width(), h.get_height()) <= 320 and took < 100, "avatar: a 40000 px svg renders once near 256 px (%s, %d ms)" % [h.get_size() if h != null else null, took])
	var bare := '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="3000" height="3000" fill="#d4af37"/></svg>'.to_utf8_buffer()
	var bs := AvatarCache.decode(bare)
	_check(bs == null or maxi(bs.get_width(), bs.get_height()) <= 512, "avatar: an svg declaring no size never renders big (%s)" % [bs.get_size() if bs != null else null])
	_check(AvatarCache.decode('<svg xmlns="http://www.w3.org/2000/svg" width="1e7" height="10"><rect width="10" height="10"/></svg>'.to_utf8_buffer()) == null, "avatar: an implausible declared size is refused")
	_check(AvatarCache.decode(gif) == null and AvatarCache.decode(avif) == null, "avatar: gif and avif stay static")
	_check(AvatarCache.decode("hello".to_utf8_buffer()) == null and AvatarCache.decode(PackedByteArray()) == null, "avatar: junk and nothing decode to nothing")
	var broken := png.slice(0, 20)
	_check(AvatarCache.decode(broken) == null, "avatar: a truncated png is nothing")
	var t := AvatarCache.tile_of(p)
	_check(t.get_width() == AvatarCache.TILE and t.get_height() == AvatarCache.TILE and t.has_mipmaps(), "avatar: the head is a square, mipmapped tile")
	_check(t.get_pixel(0, 0) == Color.WHITE and t.get_pixel(AvatarCache.TILE - 1, AvatarCache.TILE - 1) == Color.BLACK, "avatar: … bevelled light top-left, dark bottom-right")
	var mid: Color = t.get_pixel(AvatarCache.TILE / 2, AvatarCache.TILE / 2)
	_check(mid.b > 0.6 and mid.r < 0.4, "avatar: … with the picture in the middle (%s)" % mid)


# --- net ---------------------------------------------------------------------


func _test_config() -> void:
	var args := PackedStringArray(["--server", "http://10.0.0.2:7000", "--code=4821", "--name", "Headset 2", "--offline", "--station", "vr-2", "--bogus", "x"])
	var o := StationConfig.parse_args(args)
	_check(o.get("server") == "http://10.0.0.2:7000", "config: --server value")
	_check(o.get("code") == "4821", "config: --code=value")
	_check(o.get("name") == "Headset 2", "config: a quoted name with a space")
	_check(o.get("offline") == true, "config: a bare flag is true")
	_check(not o.has("bogus"), "config: unknown keys are ignored")
	_check(StationConfig.parse_args(PackedStringArray(["--intro", "false"])).get("intro") == false, "config: --intro false")
	_check(not StationConfig.parse_args(PackedStringArray(["--smooth-turn"])).has("smooth_turn") and not StationConfig.defaults().has("smooth_turn"), "config: no smooth_turn setting (smooth only, wave 33b)")

	var dir := "user://config-test"
	DirAccess.make_dir_recursive_absolute(dir)
	var a := dir + "/a.json"
	var b := dir + "/b.json"
	_write(a, {"server": "http://a:1", "code": "AAA", "station": "vr-a", "name": "From A"})
	_write(b, {"code": "BBB", "name": "  ", "mic": false, "smooth_turn": true})
	var cfg := StationConfig.resolve([a, b, dir + "/missing.json"], PackedStringArray(["--station", "vr-cli"]))
	_check(cfg["server"] == "http://a:1", "config: res file applies over the defaults")
	_check(cfg["code"] == "BBB", "config: the user file overrides the res file")
	_check(cfg["name"] == "From A", "config: an empty string never overrides")
	_check(cfg["station"] == "vr-cli", "config: the command line overrides both files")
	_check(cfg["mic"] == false, "config: booleans merge")
	_check(not cfg.has("smooth_turn"), "config: an old file's smooth_turn is ignored")
	_check(not StationConfig.is_configured(StationConfig.merge(cfg, {"code": "CHANGEME"})), "config: the placeholder passcode is unconfigured")
	_check(StationConfig.is_configured(cfg), "config: a real passcode + URL is configured")
	var committed := StationConfig.read_file(StationConfig.RES_PATH)
	_check(committed.get("code") == StationConfig.PLACEHOLDER_CODE, "config: the committed file carries the placeholder")
	# Android refuses cleartext http and the Quest preset doesn't allow it (K-30):
	# the committed server is the VPS over HTTPS.
	_check(StationConfig.parse_url(str(committed.get("server", ""))).get("tls") == true, "config: the committed server is HTTPS")

	var u := StationConfig.parse_url("http://192.168.1.10:7000/")
	_check(u.get("host") == "192.168.1.10" and u.get("port") == 7000 and u.get("tls") == false and u.get("base") == "http://192.168.1.10:7000", "config: parse_url host/port")
	var s := StationConfig.parse_url("https://show.example.com/loom")
	_check(s.get("port") == 443 and s.get("tls") == true and s.get("path") == "/loom", "config: parse_url https + path")
	_check(StationConfig.parse_url("ftp://x").is_empty() and StationConfig.parse_url("http://h:x").is_empty(), "config: parse_url refuses junk")

	# Wave 26 (R2): the path reveal's delay, in seconds, a minute by default.
	_check(_near(float(StationConfig.defaults()["trail_delay"]), 60.0) and _near(float(StationConfig.defaults()["trail_delay"]) * 1000.0, HouseRoute.PATH_REVEAL_MS), "config: trail_delay is PATH_REVEAL_MS by default")
	_check(StationConfig.parse_args(PackedStringArray(["--trail-delay", "0"])).get("trail_delay") == 0.0 and StationConfig.parse_args(PackedStringArray(["--trail-delay=2.5"])).get("trail_delay") == 2.5, "config: --trail-delay 0 / --trail-delay=2.5")
	_check(not StationConfig.parse_args(PackedStringArray(["--trail-delay", "soon"])).has("trail_delay") and not StationConfig.parse_args(PackedStringArray(["--trail-delay", "-1"])).has("trail_delay"), "config: … junk or negative is ignored")
	_check(StationConfig.merge(StationConfig.defaults(), {"trail_delay": 5}).get("trail_delay") == 5.0 and StationConfig.merge(StationConfig.defaults(), {"trail_delay": "x"}).get("trail_delay") == 60.0, "config: a station file may set it (a number)")
	# Wave 33: the intro, on by default, off with --intro false.
	_check(StationConfig.defaults()["intro"] == true, "config: the intro is on by default")
	_check(StationConfig.parse_args(PackedStringArray(["--intro", "false"])).get("intro") == false and StationConfig.parse_args(PackedStringArray(["--intro=0"])).get("intro") == false, "config: --intro false / --intro=0")
	_check(StationConfig.merge(StationConfig.defaults(), {"intro": false}).get("intro") == false, "config: a station file may turn the intro off")
	# Wave 26 (R8): the build stamp the lobby shows.
	_check(StationConfig.build_stamp() == "build dev" and not FileAccess.file_exists(StationConfig.BUILD_PATH), "config: an editor / test run is build dev (no stamp is committed)")
	_write(dir + "/build.json", {"build": "abc1234", "at": "2026-10-26T12:00Z"})
	_check(StationConfig.build_stamp(dir + "/build.json") == "build abc1234 · 2026-10-26T12:00Z", "config: a stamped APK names its commit (%s)" % StationConfig.build_stamp(dir + "/build.json"))


## The in-headset setup's file (wave 19): saved to a user path, merged
## over what it held, read back by the precedence chain, forgotten; the
## station id it mints; the servers it offers.
func _test_config_setup() -> void:
	var dir := "user://config-test"
	DirAccess.make_dir_recursive_absolute(dir)
	var path := dir + "/setup-station.json"
	StationConfig.forget_user(path)
	_check(not StationConfig.forget_user(path), "setup file: forgetting no file is a no-op")
	_check(StationConfig.save_user({"server": "http://127.0.0.1:7000", "code": "K7PQ3M", "name": "Headset", "bogus": 1}, path), "setup file: saved")
	var back := StationConfig.read_file(path)
	_check(back.get("code") == "K7PQ3M" and back.get("server") == "http://127.0.0.1:7000" and not back.has("bogus"), "setup file: known keys only (%s)" % [back])
	_check(StationConfig.save_user({"name": "Headset 2", "mic": false}, path), "setup file: saved again")
	back = StationConfig.read_file(path)
	_check(back.get("code") == "K7PQ3M" and back.get("name") == "Headset 2" and back.get("mic") == false, "setup file: a second save merges over the first (%s)" % [back])
	var cfg := StationConfig.resolve([StationConfig.RES_PATH, path], PackedStringArray())
	_check(cfg["code"] == "K7PQ3M" and StationConfig.is_configured(cfg), "setup file: the user file configures the station over the committed placeholder")
	_check(StationConfig.forget_user(path) and not FileAccess.file_exists(path), "setup file: forgotten")
	_check(not StationConfig.is_configured(StationConfig.resolve([StationConfig.RES_PATH, path], PackedStringArray())), "setup file: … and the placeholder is back")
	_check(StationConfig.read_file(StationConfig.RES_PATH).get("code") == StationConfig.PLACEHOLDER_CODE, "setup file: the committed res:// file still holds CHANGEME")

	_check(StationConfig.station_id_for("Headset", 0xbeef) == "vr-headset-beef", "setup: a station id from the name (%s)" % StationConfig.station_id_for("Headset", 0xbeef))
	_check(StationConfig.station_id_for("  HEADSET 2!! ", 0x1ffff) == "vr-headset-2-ffff", "setup: … slugged, the salt in 4 hex (%s)" % StationConfig.station_id_for("  HEADSET 2!! ", 0x1ffff))
	_check(StationConfig.station_id_for("???", 1) == "vr-headset-0001", "setup: … a name with no letters is a headset")

	var choices := StationConfig.server_choices("https://app.mapsandducks.com", "https://app.mapsandducks.com", true)
	_check(choices.size() == 2 and choices[0]["url"] == "https://app.mapsandducks.com" and choices[1]["url"] == StationConfig.LOCAL_SERVER and str(choices[1]["label"]).begins_with("This computer"), "setup: the committed server first, then this computer (%s)" % [choices])
	_check(StationConfig.server_choices("https://app.mapsandducks.com", "https://app.mapsandducks.com", false).size() == 1, "setup: a headset build offers no local server")
	var dev := StationConfig.server_choices("http://10.0.0.5:7000/", "https://app.mapsandducks.com", true)
	_check(dev.size() == 3 and dev[0]["url"] == "http://10.0.0.5:7000" and dev[0]["label"] == "10.0.0.5:7000" and dev[1]["label"] == "app.mapsandducks.com", "setup: a server named on the command line comes first (%s)" % [dev])
	_check(StationConfig.server_choices("junk", "", false).is_empty(), "setup: junk is no choice")
	var ed := StationConfig.server_choices("https://app.mapsandducks.com", "https://app.mapsandducks.com", true, true)
	_check(ed.size() == 2 and ed[0]["url"] == StationConfig.LOCAL_SERVER, "setup: an editor run naming no server puts this computer first (%s)" % [ed])
	_check(StationConfig.server_choices("https://app.mapsandducks.com", "https://app.mapsandducks.com", false, true).size() == 1, "setup: … never on a headset build")
	_check(StationConfig.offers_local(), "setup: a desktop / editor run offers this computer")


func _write(path: String, data: Dictionary) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string(JSON.stringify(data))
	f.close()


func _test_sse_parser() -> void:
	var p := SseParser.new()
	var frames := p.feed_text(":ok\n\nevent: hello\ndata: {\"eventId\":\"e1\",")
	_check(frames.is_empty(), "sse: a partial frame waits")
	frames = p.feed_text("\"players\":[]}\n\n:ping\n\nevent: poses\r\ndata: {\"t\":1}\r\n\r\ndata: plain\n\n")
	_check(frames.size() == 3, "sse: three frames complete (got %d)" % frames.size())
	if frames.size() == 3:
		_check(frames[0]["event"] == "hello" and frames[0]["data"]["eventId"] == "e1", "sse: event + JSON data")
		_check(frames[1]["event"] == "poses" and frames[1]["data"]["t"] == 1, "sse: CRLF line ends")
		_check(frames[2]["event"] == "message" and frames[2]["data"] == "plain", "sse: default event, raw data")
	var multi := p.feed_text("event: x\ndata: [1,\ndata: 2]\n\n")
	_check(multi.size() == 1 and multi[0]["data"] == [1.0, 2.0], "sse: data lines join with newlines")


func _test_pose_pump() -> void:
	var pump := PosePump.new()
	var sent: Array = []
	pump.offer(1)
	var first: Variant = pump.tick(0.0)
	_check(first == 1, "pump: the first pose goes at once")
	if first != null:
		sent.append(first)
	pump.offer(2)
	pump.offer(3)
	_check(pump.tick(0.2) == null, "pump: nothing while one is in flight")
	pump.offer(4)
	pump.sent(pump.generation())
	var next: Variant = pump.tick(0.0)
	_check(next == 4, "pump: only the latest pose is sent (latest-only, no queue)")
	pump.sent(pump.generation())
	pump.offer(5)
	_check(pump.tick(0.05) == null, "pump: at most 10 Hz")
	_check(pump.tick(0.06) == 5, "pump: sends once the interval passes")
	pump.sent(pump.generation())
	_check(pump.tick(1.0) == null, "pump: nothing to send when nothing is offered")
	pump.offer(6)
	pump.clear()
	_check(pump.tick(1.0) == null and not pump.is_in_flight(), "pump: clear drops the waiting pose")
	pump.offer(7)
	_check(pump.flush() == 7 and pump.is_in_flight() and not pump.has_pending(), "pump: flush sends the waiting pose at once (a found claim)")
	pump.offer(8)
	_check(pump.flush() == null, "pump: flush never doubles up on one in flight")

	# A late answer from before a clear (an ended session) frees nothing.
	var g := PosePump.new()
	g.offer("a1")
	g.tick(0.0)
	var old_gen := g.generation()
	g.clear()
	g.offer("b1")
	_check(g.tick(0.0) == "b1", "pump: a cleared pump sends the next session's first pose at once")
	g.sent(old_gen)
	g.offer("b2")
	_check(g.is_in_flight() and g.tick(1.0) == null, "pump: a stale answer never frees the next session's send (one in flight)")
	g.sent(g.generation())
	_check(g.tick(1.0) == "b2", "pump: its own answer does")

	# Claims have a kind (the duck's `found`, the King's hit), one at a time.
	var k := PosePump.new()
	_check(k.claim_kind() == "" and k.want_claim("king") and k.claim_kind() == "king", "pump: a king claim is wanted")
	_check(not k.want_claim("found") and k.claim_kind() == "king", "pump: … and a second claim waits its turn")
	k.offer("p")
	var first_step := k.step(0.0)
	_check(first_step["pose"] == "p" and not first_step["claim"], "pump: the hit flushes the newest pose first")
	k.sent(k.generation())
	_check(k.step(0.0)["claim"] and k.claim_kind() == "king", "pump: … then claims")
	k.claim_done(k.generation())
	_check(k.claim_kind() == "" and not k.is_claiming() and k.want_claim("found"), "pump: its answer frees the pump for the next claim")

	# The claim schedule, at a 72 fps game with slow and fast round trips.
	for rtt: float in [0.15, 0.05, 0.4]:
		var r := _claim_run(rtt)
		_check(r["claimed_at"] >= 0.0 and r["claimed_at"] <= 3.0 * rtt + 0.1, "pump: a claim goes within a few round trips at %d ms (%s)" % [int(rtt * 1000.0), r])
		_check(r["poses_after_flush"] == 0, "pump: no scheduled pose between the flushed one and the claim at %d ms" % int(rtt * 1000.0))
		_check(r["poses_while_out"] == 0 and r["resumed"], "pump: no pose while the claim is out, the schedule resumes after its answer at %d ms" % int(rtt * 1000.0))


## Drive a pump the way `ServerLink` does: a pose offered every 1/72 s,
## every send landing `rtt` s later; the claim is wanted at 0.5 s. Returns
## when (after wanting it) the claim went, how many poses went between the
## flush and the claim, and whether poses resumed after the claim's answer.
func _claim_run(rtt: float) -> Dictionary:
	var pump := PosePump.new()
	var dt := 1.0 / 72.0
	var t := 0.0
	var landing: Array = []  # [due, kind, gen]
	var claimed_at := -1.0
	var wanted := false
	var flushed := false
	var poses_after_flush := 0
	var poses_while_out := 0
	var answered_at := -1.0
	var resumed := false
	for i in int(6.0 / dt):
		t += dt
		if not wanted and t >= 0.5:
			wanted = true
			pump.want_claim()
		pump.offer(t)
		var s := pump.step(dt)
		if s["pose"] != null:
			if claimed_at >= 0.0 and answered_at < 0.0:
				poses_while_out += 1
			elif answered_at >= 0.0:
				resumed = true
			elif pump.is_claiming():
				if flushed:
					poses_after_flush += 1
				flushed = true
			landing.append([t + rtt, "pose", pump.generation()])
		if s["claim"]:
			claimed_at = t - 0.5
			landing.append([t + rtt, "claim", pump.generation()])
		# The answers land after this frame's `_process` (as HTTPRequest's do).
		var still: Array = []
		for l: Array in landing:
			if l[0] <= t + 1e-9:
				if l[1] == "pose":
					pump.sent(l[2])
				else:
					pump.claim_done(l[2])
					answered_at = t
			else:
				still.append(l)
		landing = still
	return {"claimed_at": claimed_at, "poses_after_flush": poses_after_flush, "poses_while_out": poses_while_out, "resumed": resumed}


# --- ServerLink, over a fake transport -------------------------------------------


## A `ServerLink` that thinks it is linked to event `e1`, its calls going to
## a [code]fake_transport.gd[/code]. Not in the tree: the test drives `_process`.
func _linked_server_link() -> LinkBase:
	var sl: LinkBase = load("res://net/server_link.gd").new()
	sl.config = StationConfig.merge(StationConfig.defaults(), {"server": "http://127.0.0.1:7999", "code": "MOD-1", "name": "Test Headset"})
	sl.config["offline"] = false
	sl.set("transport", preload("res://test/fake_transport.gd").new())
	sl.set("stream", SseClient.new())
	sl.set("phase", "ready")
	sl.set("event_id", "e1")
	sl.set("title", "The Show")
	sl.set("_mod_token", "mod-tok")
	return sl


func _free_server_link(sl: LinkBase) -> void:
	(sl.get("stream") as Node).free()
	(sl.get("transport") as Node).free()
	sl.free()


func _test_server_link() -> void:
	# The station poll is the heartbeat: an ended event (404) re-links and
	# drops the session that died with it.
	var sl := _linked_server_link()
	var tr: Variant = sl.get("transport")
	var over: Array = []
	sl.session_over.connect(func(r: String) -> void: over.append(r))
	sl.adopt({"session": "s-1", "token": "t-1", "houseVersion": ""})
	sl._process(0.016)
	_check(tr.count("/e/e1/api/mod/spatial/station") == 1, "link: the station is polled")
	tr.answer("/spatial/station", 404, {"error": "unknown event"})
	_check(sl.get("phase") == "waiting" and sl.get("event_id") == "", "link: a 404 station poll (event ended) drops the event link")
	_check(over == ["event ended"] and not sl.has_session(), "link: … and the session that died with it")
	sl._process(float(sl.get_script().get_script_constant_map()["RECONNECT_DELAY"]) + 0.1)
	_check(tr.log.back() == "POST /api/resolve-code", "link: … and resolves the passcode again (%s)" % [tr.log.back()])
	_free_server_link(sl)

	# A lapsed moderator token (403 / 401) re-links but keeps the session.
	sl = _linked_server_link()
	tr = sl.get("transport")
	sl.adopt({"session": "s-2", "token": "t-2", "houseVersion": ""})
	sl._process(0.016)
	tr.answer("/spatial/station", 403, {"error": "moderators only"})
	_check(sl.get("phase") == "waiting" and sl.has_session(), "link: a 403 station poll re-links, the session plays on")
	_free_server_link(sl)

	# No answer at all: the lobby says so after a few polls, and recovers.
	sl = _linked_server_link()
	tr = sl.get("transport")
	for i in 5:
		sl._process(1.01)
		tr.answer("/spatial/station", 0)
	_check(sl.status.begins_with("Lost the server") and sl.get("phase") == "ready", "link: five unanswered polls say the server is lost (%s)" % sl.status)
	sl._process(1.01)
	tr.answer("/spatial/station", 200, {"assignment": null})
	_check(sl.status == "Connected to The Show.", "link: an answer again says connected (%s)" % sl.status)
	# Other calls' 404 is not the event: an unknown guest stays a begin failure.
	var failed: Array = []
	sl.begin_failed.connect(func(m: String) -> void: failed.append(m))
	sl.begin("g-nobody")
	tr.answer("/spatial/begin", 404, {"error": "unknown guest"})
	_check(failed.size() == 1 and sl.get("phase") == "ready", "link: a begin 404 (unknown guest) never re-links")
	# Wave 16: an unmarked program's refusal reads as such, not "not running".
	sl.begin("g-free")
	tr.answer("/spatial/begin", 409, {"error": "not marked for reinstallation"})
	_check(failed.size() == 2 and str(failed[1]) == "Not marked for reinstallation." and sl.get("phase") == "ready", "link: a begin 409 (not marked) says why (%s)" % [failed])
	sl.begin("g-early")
	tr.answer("/spatial/begin", 409, {"error": "no scenario loaded"})
	_check(failed.size() == 3 and str(failed[2]) == "The show isn't running.", "link: any other begin 409 is the show not running")
	_free_server_link(sl)

	# The claim goes out even when every pose round trip is slow (150 ms).
	sl = _linked_server_link()
	tr = sl.get("transport")
	sl.adopt({"session": "s-3", "token": "t-3", "houseVersion": ""})
	var dt := 1.0 / 72.0
	var due := {}  # call id → when its answer lands
	var t := 0.0
	var claimed := -1.0
	for i in 400:
		t += dt
		sl.send_pose([0.0, 0.0, 0.0], 0.0, 0.0)
		if i == 36:
			sl.report_found()
		sl._process(dt)
		tr.answer("/spatial/station", 200, {"assignment": null})
		if claimed < 0.0 and tr.count("/api/spatial/found") > 0:
			claimed = t - 37.0 * dt
		for c: Dictionary in tr.calls:
			if not due.has(c["id"]):
				due[c["id"]] = t + 0.15
		for id: int in due.keys():
			if due[id] <= t + 1e-9:
				due.erase(id)
				tr.answer_id(id, 200, {"ok": true})
	_check(claimed >= 0.0 and claimed < 0.6, "link: found is sent with 150 ms pose round trips (after %.2f s)" % claimed)
	_free_server_link(sl)

	_test_server_link_map()
	await _test_server_link_king()
	await _test_server_link_moment()


## The shared King over the wire: the `hello` / `king` frames and the
## session's map fetch set it; a hit flushes the newest pose, then posts
## with the session token; every answer is handed on.
func _test_server_link_king() -> void:
	var sl := _linked_server_link()
	var tr: Variant = sl.get("transport")
	var kings: Array = []
	var answers: Array = []
	sl.king_changed.connect(func(k: Dictionary) -> void: kings.append(k.duplicate()))
	sl.king_hit_answered.connect(func(r: String, _d: Dictionary) -> void: answers.append(r))
	var full := {"id": "cold-lock-king", "hp": 15, "max": 15, "fallen": false}

	sl._on_frame("hello", {"eventId": "e1", "houseVersion": "", "players": []})
	_check(sl.king.is_empty() and kings.is_empty(), "link king: an old server's hello (no king) is no shared King")
	sl._on_frame("hello", {"eventId": "e1", "houseVersion": "", "players": [], "king": full})
	_check(sl.king.get("hp") == 15 and sl.king.get("max") == 15 and kings.size() == 1, "link king: hello.king is the shared King")
	sl._on_frame("king", {"id": "cold-lock-king", "hp": 15, "max": 15, "fallen": false, "by": null})
	_check(kings.size() == 1, "link king: a king frame that changes nothing is no change")
	sl._on_frame("king", {"id": "cold-lock-king", "hp": 14, "max": 15, "fallen": false, "by": "Zed"})
	_check(kings.size() == 2 and sl.king.get("hp") == 14 and sl.king.get("by") == "Zed", "link king: a king frame moves the bar (%s)" % [sl.king])
	sl._on_frame("hello", {"eventId": "e1", "houseVersion": "", "players": [], "king": null})
	_check(sl.king.is_empty() and kings.size() == 3, "link king: hello.king null is no shared King")

	sl.adopt({"session": "s-k", "token": "t-k", "houseVersion": "v1"})
	tr.answer("/spatial/house", 200, {"house": sl.house, "version": "v1", "king": {"id": "cold-lock-king", "hp": 9, "max": 15, "fallen": false}})
	_check(sl.king.get("hp") == 9, "link king: the session's map fetch carries the King")

	# The hit: the newest pose first, then the claim (session token), nothing between.
	sl.send_pose([1.0, -2.7, 11.2], 90.0, 0.0)
	sl.hit_king()
	sl._process(0.016)
	_check(tr.count("/api/spatial/pose") == 1 and tr.count("/api/spatial/king/hit") == 0, "link king: a hit flushes the newest pose first")
	sl.send_pose([1.1, -2.7, 11.2], 90.0, 0.0)
	tr.answer("/spatial/station", 200, {"assignment": null})
	sl._process(0.016)
	_check(tr.count("/api/spatial/king/hit") == 0, "link king: … and waits for it to land")
	tr.answer("/spatial/pose", 200, {"ok": true})
	sl._process(0.016)
	_check(tr.count("/api/spatial/king/hit") == 1 and tr.count("/api/spatial/pose") == 1, "link king: … then posts the hit, no pose in between")
	var hit_call: Dictionary = tr.calls.filter(func(c: Dictionary) -> bool: return str(c["path"]).contains("/king/hit"))[0]
	_check(hit_call["method"] == "POST" and hit_call["path"] == "/e/e1/api/spatial/king/hit" and hit_call["token"] == "t-k", "link king: POST /e/<event>/api/spatial/king/hit with the session token")
	tr.answer("/king/hit", 200, {"ok": true, "king": {"id": "cold-lock-king", "hp": 8, "max": 15, "fallen": false}})
	_check(answers == ["ok"] and sl.king.get("hp") == 8, "link king: 200 → ok, the bar from the answer (%s)" % [answers])
	sl._process(0.2)
	_check(tr.count("/api/spatial/pose") == 2, "link king: poses resume after the answer")

	# 409 already hit / not near / fallen / paused, 404 no king, 410 gone.
	for c: Array in [
		[409, {"error": "already hit", "king": {"id": "cold-lock-king", "hp": 8, "max": 15, "fallen": false}}, "already hit"],
		[409, {"error": "not near"}, "not near"],
		[409, {"error": "fallen", "king": {"id": "cold-lock-king", "hp": 0, "max": 15, "fallen": true}}, "fallen"],
		[409, {"error": "doors are closed"}, "doors are closed"],
		[409, {"error": "unclaimed session"}, "error"],
		[404, {"error": "no king"}, "no king"],
	]:
		answers.clear()
		sl.hit_king()
		for i in 4:
			tr.answer("/spatial/pose", 200, {"ok": true})
			tr.answer("/spatial/station", 200, {"assignment": null})
			sl._process(0.2)
		var sent: bool = tr.answer("/king/hit", c[0], c[1])
		_check(sent and answers == [c[2]], "link king: %d %s → %s (%s)" % [c[0], c[1].get("error"), c[2], answers])
	_check(sl.king.is_empty(), "link king: … a 404 forgets the King")
	_check(sl.has_session(), "link king: none of those ends the session")

	# A hit asked for while the found claim is out goes once that answers.
	sl.report_found()
	sl.hit_king()
	for i in 4:
		tr.answer("/spatial/pose", 200, {"ok": true})
		tr.answer("/spatial/station", 200, {"assignment": null})
		sl._process(0.2)
	_check(tr.count("/api/spatial/found") == 1 and tr.calls.filter(func(c: Dictionary) -> bool: return str(c["path"]).contains("/king/hit")).is_empty(), "link king: one claim at a time — the found goes first")
	tr.answer("/spatial/found", 409, {"error": "not near the duck"})
	for i in 4:
		tr.answer("/spatial/pose", 200, {"ok": true})
		tr.answer("/spatial/station", 200, {"assignment": null})
		sl._process(0.2)
	_check(tr.calls.filter(func(c: Dictionary) -> bool: return str(c["path"]).contains("/king/hit")).size() == 1, "link king: … then the hit")
	tr.answer("/king/hit", 410, {"error": "gone"})
	_check(not sl.has_session(), "link king: 410 → the session is over")
	tr.base = "http://127.0.0.1:7999"
	_check(sl.avatar_url("0123456789abcdef") == "http://127.0.0.1:7999/e/e1/api/avatar/0123456789abcdef" and sl.avatar_url("") == "", "link: a picture's URL is the event's avatar route")
	_check(sl.cams_url() == "http://127.0.0.1:7999/e/e1/api/spatial", "link: the camera feeds live under the event's spatial routes")
	sl.session = {"session": "s9", "token": "sess-tok"}
	var with_session := sl.cams_token()
	sl.session = {}
	_check(with_session == "sess-tok" and sl.cams_token() == sl.get("_mod_token"), "link: feeds are fetched with the session's token, else the moderator's")
	_free_server_link(sl)

	# Offline: the map's King, kept here; a hit lands once per session.
	var off: LinkBase = load("res://net/server_link.gd").new()
	off.config = StationConfig.merge(StationConfig.defaults(), {"offline": true})
	off.config["offline"] = true
	off.house = _read_json("res://house/house.json")
	off.seed_offline_king()
	var max_hp := int(HouseKing.king_prop(off.house)["hp"])
	_check(off.king.get("hp") == max_hp and off.king.get("fallen") == false, "link offline: the King starts at the map's hp")
	var offline_answers: Array = []
	off.king_hit_answered.connect(func(r: String, _d: Dictionary) -> void: offline_answers.append(r))
	off.session = {"session": "offline-1", "name": "Ada"}
	off.hit_king()
	off.hit_king()
	await process_frame
	_check(offline_answers == ["ok", "already hit"] and off.king.get("hp") == max_hp - 1, "link offline: one hit per session (%s)" % [offline_answers])
	_check(off.avatar_url("abc") == "", "link offline: no pictures to fetch")
	_check(off.cams_url() == "", "link offline: no camera feeds")
	off.free()


## Wave 26 (C6): a game moment over the wire — the newest pose first, then
## `POST /api/spatial/moment {kind, prop}` with the session token; one claim
## per kind, the prop kept with it; every answer mapped by its error string
## (the old server's generic 404 vs the route's "no such prop"); 410 ends the
## session; offline answers "offline".
func _test_server_link_moment() -> void:
	var sl := _linked_server_link()
	var tr: Variant = sl.get("transport")
	var answers: Array = []
	sl.moment_answered.connect(func(k: String, r: String, d: Dictionary) -> void: answers.append([k, r, d]))
	sl.moment("escape")
	_check(tr.count("/api/spatial/moment") == 0 and answers.is_empty(), "link moment: no session → nothing")
	sl.adopt({"session": "s-m", "token": "t-m", "houseVersion": ""})
	var pump_step := func() -> void:
		for i in 4:
			tr.answer("/spatial/pose", 200, {"ok": true})
			tr.answer("/spatial/station", 200, {"assignment": null})
			sl._process(0.2)
	sl.send_pose([-0.45, 0.0, -6.0], 0.0, 0.0)
	sl.moment("escape")
	sl._process(0.016)
	_check(tr.count("/api/spatial/pose") == 1 and tr.count("/api/spatial/moment") == 0, "link moment: the newest pose goes first")
	sl.send_pose([-4.5, 0.0, 26.3], 0.0, 0.0)
	tr.answer("/spatial/pose", 200, {"ok": true})
	sl._process(0.016)
	var calls: Array = tr.calls.filter(func(c: Dictionary) -> bool: return str(c["path"]).contains("/moment"))
	_check(calls.size() == 1 and calls[0]["method"] == "POST" and calls[0]["path"] == "/e/e1/api/spatial/moment" and calls[0]["token"] == "t-m" and calls[0]["body"] == {"kind": "escape"} and tr.count("/api/spatial/pose") == 1, "link moment: … then POST /e/<event>/api/spatial/moment {kind: escape} with the session token, no pose between (%s)" % [calls])
	var ok_body := {"ok": true, "kind": "escape", "lines": [{"from": "Trabolta", "text": "Back you go."}], "spawn": {"room": "tent", "pos": [-4.5, 0, 26.3], "yaw": 90}, "cooldownMs": 20000}
	tr.answer("/moment", 200, ok_body)
	_check(answers.size() == 1 and answers[0][0] == "escape" and answers[0][1] == "ok" and (answers[0][2]["lines"] as Array).size() == 1, "link moment: 200 → ok with the lines (%s)" % [answers])
	sl._process(0.2)
	_check(tr.count("/api/spatial/pose") == 2, "link moment: poses resume after the answer")
	# Heart and pickup carry their prop; a pending heart never swallows a pickup.
	answers.clear()
	sl.moment("heart", "server-heart")
	sl.moment("pickup", "virus-disk")
	sl.moment("heart", "server-heart")
	pump_step.call()
	calls = tr.calls.filter(func(c: Dictionary) -> bool: return str(c["path"]).contains("/moment"))
	_check(calls.size() == 1 and calls[0]["body"] == {"kind": "heart", "prop": "server-heart"}, "link moment: a heart with its prop (%s)" % [calls])
	tr.answer("/moment", 200, {"ok": true, "kind": "heart", "lines": []})
	pump_step.call()
	calls = tr.calls.filter(func(c: Dictionary) -> bool: return str(c["path"]).contains("/moment"))
	_check(calls.size() == 1 and calls[0]["body"] == {"kind": "pickup", "prop": "virus-disk"} and tr.count("/api/spatial/moment") == 3, "link moment: … then the pickup, its prop kept (one claim per kind) (%s)" % [calls])
	tr.answer("/moment", 200, {"ok": true, "kind": "pickup", "lines": [], "item": "virus", "prop": "virus-disk"})
	_check(answers.map(func(x: Array) -> String: return "%s:%s" % [x[0], x[1]]) == ["heart:ok", "pickup:ok"], "link moment: each answered by kind (%s)" % [answers])
	# Every refusal, by its error string.
	for c: Array in [
		[404, {"error": "not found"}, "not found"],
		[404, {"error": "Not Found"}, "not found"],
		[404, null, "not found"],
		[404, {"error": "no such prop"}, "no such prop"],
		[400, {"error": "bad moment"}, "bad moment"],
		[409, {"error": "doors are closed"}, "doors are closed"],
		[409, {"error": "this session has not started — send a pose first"}, "parked"],
		[409, {"error": "not out", "distance": 3.2}, "not out"],
		[409, {"error": "cooldown", "retryMs": 12000}, "cooldown"],
		[409, {"error": "sealed"}, "sealed"],
		[409, {"error": "not there"}, "not there"],
		[409, {"error": "far", "distance": 1.4}, "far"],
		[409, {"error": "already"}, "already"],
		[409, {"error": "something new"}, "error"],
		[500, {}, "error"],
	]:
		answers.clear()
		sl.moment("pickup", "virus-disk")
		pump_step.call()
		var sent: bool = tr.answer("/moment", c[0], c[1])
		_check(sent and answers.size() == 1 and answers[0][1] == c[2], "link moment: %d %s → %s (%s)" % [c[0], c[1], c[2], answers])
	_check(sl.has_session(), "link moment: none of those ends the session")
	var over: Array = []
	sl.session_over.connect(func(r: String) -> void: over.append(r))
	answers.clear()
	sl.moment("escape")
	pump_step.call()
	tr.answer("/moment", 410, {"error": "this session is over"})
	_check(not sl.has_session() and over == ["over"] and answers.is_empty(), "link moment: 410 → the session is over")
	sl.moment("escape")
	_check(tr.calls.filter(func(c: Dictionary) -> bool: return str(c["path"]).contains("/moment")).is_empty(), "link moment: … and no more moments")
	_free_server_link(sl)
	# Offline: answered here, nothing sent.
	var off: LinkBase = load("res://net/server_link.gd").new()
	off.config = StationConfig.merge(StationConfig.defaults(), {"offline": true})
	off.config["offline"] = true
	var got: Array = []
	off.moment_answered.connect(func(k: String, r: String, _d: Dictionary) -> void: got.append([k, r]))
	off.session = {"session": "offline-1", "name": "Ada"}
	off.moment("escape")
	off.moment("bogus")
	await process_frame
	_check(got == [["escape", "offline"]], "link moment offline: answered 'offline' (an unknown kind: nothing) (%s)" % [got])
	off.free()
	var base := LinkBase.new()
	base.moment("escape")
	base.free()


## The map in play is never silently the wrong one, and the duck follows
## the server's word (the map fetch with the session token, `duck` frames).
func _test_server_link_map() -> void:
	var sl := _linked_server_link()
	var tr: Variant = sl.get("transport")
	var show: Dictionary = _read_json("res://house/house.json")
	var spots: Array = show["duck"]["spots"]
	sl.house = show
	sl.house_version = "bundled"
	var warnings: Array = []
	var ducks: Array = []
	sl.map_warning.connect(func(t: String) -> void: warnings.append(t))
	sl.duck_changed.connect(func(d: Dictionary) -> void: ducks.append(str(d["id"])))
	var retry: float = sl.get_script().get_script_constant_map()["HOUSE_RETRY"]

	sl.adopt({"session": "s-m", "token": "t-m", "houseVersion": "v2", "duck": spots[0]})
	_check(tr.count("/api/spatial/house") == 1 and str(tr.calls.back()["token"]) == "t-m", "link: an assignment on another map version fetches it with the session token")
	tr.answer("/spatial/house", 0)
	_check(warnings.size() == 1 and str(warnings[0]).begins_with("Couldn't load") and sl.map_is_stale(), "link: a failed fetch, the bundled map still up, warns (%s)" % [warnings])
	sl._process(retry / 2.0)
	_check(tr.count("/api/spatial/house") == 1, "link: … waits before retrying")
	sl._process(retry / 2.0 + 0.1)
	_check(tr.count("/api/spatial/house") == 2, "link: … and retries")
	tr.answer("/spatial/house", 200, {"house": show, "version": "v2", "duck": spots[1]})
	_check(sl.house_version == "v2" and warnings.back() == "" and not sl.map_is_stale(), "link: the event's map clears the warning")
	_check(ducks == [str(spots[1]["id"])] and str(sl.session["duck"]["id"]) == str(spots[1]["id"]), "link: … and the duck in its answer is adopted (%s)" % [ducks])
	sl._process(retry * 3.0)
	_check(tr.count("/api/spatial/house") == 2, "link: no refetch once the map is right")

	# `duck` frames: ours moves it (once), another session's or the same spot doesn't.
	sl._on_frame("duck", {"session": "other", "duck": spots[0]})
	sl._on_frame("duck", {"session": "s-m", "duck": spots[1]})
	_check(ducks.size() == 1, "link: a duck frame for another session, or the same spot, is ignored")
	sl._on_frame("duck", {"session": "s-m", "duck": spots[2]})
	_check(ducks.size() == 2 and ducks.back() == str(spots[2]["id"]), "link: a duck frame for us moves the duck")

	# The run reset (wave 59): the server's new spot, or nothing from an old one.
	sl.reset_run()
	_check(tr.count("/api/spatial/reset") == 1 and str(tr.calls.back()["token"]) == "t-m", "link: the run reset posts with the session token")
	tr.answer("/spatial/reset", 200, {"ok": true, "spawn": {}, "duck": spots[3]})
	_check(ducks.size() == 3 and ducks.back() == str(spots[3]["id"]), "link: … and takes the new spot")
	sl._on_frame("duck", {"session": "s-m", "duck": spots[3]})
	_check(ducks.size() == 3, "link: … its stream frame is no second move")
	sl.reset_run()
	tr.answer("/spatial/reset", 404, {"error": "not found"})
	_check(ducks.size() == 3 and sl.has_session(), "link: an older server leaves him where he is, and the walk goes on")
	ducks.pop_back()

	# A map edit: the `house` frame names a newer version → refetch (session token).
	sl._on_frame("house", {"version": "v3"})
	_check(tr.count("/api/spatial/house") == 3 and str(tr.calls.back()["token"]) == "t-m" and sl.map_is_stale(), "link: a house frame naming a new version refetches")
	tr.answer("/spatial/house", 500, {"error": "boom"})
	_check(str(warnings.back()).begins_with("The event's map changed"), "link: … a failed refetch on an older event map warns (%s)" % [warnings.back()])
	sl._process(retry + 0.1)
	tr.answer("/spatial/house", 200, {"house": show, "version": "v3"})
	_check(sl.house_version == "v3" and warnings.back() == "" and ducks.size() == 2, "link: … and the new map clears it (no duck in the answer: the duck stays)")

	# A fetch asked for while one is in flight goes out when it lands.
	sl._on_frame("house", {"version": "v4"})
	sl._on_frame("house", {"version": "v5"})
	_check(tr.calls.filter(func(c: Dictionary) -> bool: return str(c["path"]).contains("/spatial/house")).size() == 1, "link: one map fetch in flight at a time")
	tr.answer("/spatial/house", 200, {"house": show, "version": "v4"})
	_check(tr.calls.filter(func(c: Dictionary) -> bool: return str(c["path"]).contains("/spatial/house")).size() == 1, "link: … the second goes out when the first lands")
	tr.answer("/spatial/house", 200, {"house": show, "version": "v5"})
	_check(sl.house_version == "v5" and not sl.map_is_stale(), "link: … and the newest map wins")

	# Session over: the duck's map no longer matters; the moderator token fetches.
	sl.end_session("found")
	sl._on_frame("house", {"version": "v6"})
	_check(str(tr.calls.back()["token"]) == "mod-tok", "link: in the lobby the map is fetched with the moderator token")
	_free_server_link(sl)


# --- player + lobby ----------------------------------------------------------------


static func _v3(a: Vector3, b: Vector3) -> bool:
	return a.distance_to(b) <= TOL


func _test_locomotion() -> void:
	_check(Locomotion.dead_zone(Vector2(0.1, 0.05)) == Vector2.ZERO, "loco: inside the dead zone is still")
	_check(_near(Locomotion.dead_zone(Vector2(0, 0.15 + 0.85 * 0.5)).y, 0.5), "loco: the dead zone rescales (no jump at its edge)")
	_check(_near(Locomotion.dead_zone(Vector2(1, 1)).length(), 1.0), "loco: clamped to the unit disc")
	_check(_v3(Locomotion.head_relative(Vector2(0, 1), 0.0), Vector3(0, 0, -1)), "loco: stick up looking north walks north")
	_check(_v3(Locomotion.head_relative(Vector2(0, 1), 90.0), Vector3(-1, 0, 0)), "loco: stick up looking west walks west")
	_check(_v3(Locomotion.head_relative(Vector2(1, 0), 90.0), Vector3(0, 0, -1)), "loco: stick right looking west steps north")
	_check(_v3(Locomotion.head_relative(Vector2(0, -1), 180.0), Vector3(0, 0, -1)), "loco: stick down looking south backs north")
	_check(_near(Locomotion.smooth_turn(1.0, 0.5), -Locomotion.TURN_RATE * 0.5), "loco: a full push right turns at TURN_RATE, lowering the yaw")
	_check(_near(Locomotion.smooth_turn(-1.0, 0.5), Locomotion.TURN_RATE * 0.5) and _near(Locomotion.smooth_turn(2.0, 1.0), -Locomotion.TURN_RATE), "loco: left turns left; never past TURN_RATE")
	var half := absf(Locomotion.smooth_turn(0.5, 1.0))
	_check(half < Locomotion.TURN_RATE * 0.4 and half > 0.0, "loco: a half push turns well under half speed (%.1f°/s)" % half)
	_check(Locomotion.smooth_turn(0.0, 1.0) == 0.0, "loco: a centred stick doesn't turn")
	_check(Locomotion.WALK_SPEED <= 1.5 and Locomotion.TURN_RATE <= 75.0, "loco: a first-timer's pace (walk %.1f m/s, turn %.0f°/s)" % [Locomotion.WALK_SPEED, Locomotion.TURN_RATE])
	_check(Locomotion.axis_lock(Vector2(0.3, 0.9)) == Vector2(0, 0.9), "loco: one stick — a crooked push forward walks straight")
	_check(Locomotion.axis_lock(Vector2(-0.8, 0.2)) == Vector2(-0.8, 0), "loco: … a crooked turn doesn't creep")
	_check(Locomotion.axis_lock(Vector2(0.6, 0.7)) == Vector2(0.6, 0.7), "loco: … a real diagonal walks and turns")
	_check(Locomotion.axis_lock(Vector2.ZERO) == Vector2.ZERO, "loco: … centred stays centred")
	_check(Locomotion.axis_lock(Vector2(0.4, 0.9), Vector2(0.5, 0.9)) == Vector2(0.4, 0.9) and Locomotion.axis_lock(Vector2(0.4, 0.9), Vector2(0, 0.9)) == Vector2(0, 0.9), "loco: … a turn already in holds past the lock's edge (no on / off flicker)")
	_check(Locomotion.axis_lock(Vector2(0.2, 0.9), Vector2(0.5, 0.9)) == Vector2(0, 0.9), "loco: … and lets go below AXIS_RELEASE")

	var t := Locomotion.rotate_about(Transform3D(Basis.IDENTITY, Vector3(2, 0, 0)), Vector3(1, 3, 0), 90.0)
	_check(_v3(t.origin, Vector3(1, 0, -1)), "loco: rotate_about turns about the pivot")
	_check(_near(HouseFrames.yaw_of(t.basis), 90.0), "loco: rotate_about turns the basis")


## The `--autopilot` follower, walked kinematically (no physics): from the
## spawn it reaches every duck spot of the show, up the stairs included.
func _test_autopilot() -> void:
	_check(StationConfig.parse_args(PackedStringArray(["--autopilot"])).get("autopilot") == true, "autopilot: --autopilot parses")
	_check(StationConfig.defaults()["autopilot"] == false, "autopilot: off by default")
	var house: Dictionary = _read_json("res://house/house.json")
	var spawn: Array = house["spawn"]["pos"]
	var reached := 0
	var missed: Array = []
	var spots: Array = house["duck"]["spots"]
	for spot: Dictionary in spots:
		var pilot := Autopilot.new()
		pilot.plan(house, spawn, spot["pos"])
		var feet: Array = spawn.duplicate()
		for i in 4000:
			var s := pilot.steer(feet, 1.0 / 90.0)
			if Game.is_at_duck(house, feet, spot["pos"]):
				reached += 1
				break
			if i == 3999:
				missed.append("%s ended at %s, waypoint %d/%d %s" % [spot["id"], feet, pilot.index, pilot.path.size(), pilot.path])
			var step := HouseFrames.forward(float(s["yaw"]))
			feet = [feet[0] + step[0] * 0.02, feet[1], feet[2] + step[2] * 0.02]
			var h: Variant = HouseLocate.height_at(house, [feet[0], feet[2]], feet[1])
			if h != null:
				feet[1] = h
	_check(reached == spots.size(), "autopilot: walks from the spawn to every duck spot (%d/%d) %s" % [reached, spots.size(), missed])
	var stuck := Autopilot.new()
	stuck.plan(house, spawn, spots[0]["pos"])
	var r := {}
	for i in int(Autopilot.STUCK_AFTER * 10.0) + 2:
		r = stuck.steer(spawn, 0.1)
	_check(r.get("replan") == true, "autopilot: no headway asks for a re-plan")


## The autopilot with real collision: `main.tscn` + a fake link, the body
## stepped by hand (fast and deterministic) from the spawn to every duck
## spot — doors, the stairs and the rails around the hole included.
func _test_autopilot_physics() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Autopilot", "autopilot": true})
	link.house = house
	link.house_version = "test"
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	await physics_frame
	var game: Game = main.get("game")
	game.autopilot_exit = false
	var player := game.player
	player.set_process(false)
	player.set_physics_process(false)
	_check(game.autopilot != null and not player.read_input, "autopilot: --autopilot drives the sticks")
	_check(bool(link.config["intro"]) and not game.intro_wanted(), "autopilot: never plays the intro, whatever the config says")
	var dt := 1.0 / 90.0
	var missed: Array = []
	var spots: Array = house["duck"]["spots"]
	for i in spots.size():
		var spot: Dictionary = spots[i]
		var a := _assignment(house, "s-ap%d" % i, true)
		a["duck"] = spot
		link.assignment_received.emit(a)
		if i == 0:
			_check(not game.in_intro() and game.state() == GameFlow.State.PLAYING and link.get("readies") == 0, "autopilot: the assignment goes straight to the house (no intro, no ready)")
		var calls: int = link.found_calls
		var steps := 0
		while link.found_calls == calls and steps < 90 * 60:
			game._process(dt)
			player.step(dt)
			steps += 1
		if link.found_calls == calls:
			missed.append("%s stuck at %s (waypoint %d/%d)" % [spot["id"], game.builder.to_house(player.feet()), game.autopilot.index, game.autopilot.path.size()])
		link.session_over.emit("test")
	_check(missed.is_empty(), "autopilot: walks (with collision) from the spawn to every duck spot %s" % [missed])

	# `--hit-king`: to the King first (with collision), one press facing
	# him, then on to the duck once the hit is answered.
	_check(StationConfig.parse_args(PackedStringArray(["--hit-king"])).get("hit_king") == true and StationConfig.defaults()["hit_king"] == false, "autopilot: --hit-king parses, off by default")
	link.config["hit_king"] = true
	link.call("give_king", {"id": "cold-lock-king", "hp": 15, "max": 15, "fallen": false})
	var ka := _assignment(house, "s-apk", true)
	ka["duck"] = spots[0]
	link.assignment_received.emit(ka)
	_check(game.autopilot_king == "walk", "autopilot: --hit-king walks to the King first")
	var hits_before: int = link.get("king_hits")
	var steps := 0
	while link.get("king_hits") == hits_before and steps < 90 * 60:
		game._process(dt)
		player.step(dt)
		steps += 1
	var at := game.builder.to_house(player.feet())
	var kp: Dictionary = HouseKing.king_prop(house)
	_check(link.get("king_hits") == hits_before + 1, "autopilot: … and hits him (at %s after %.1f s)" % [at, steps * dt])
	_check(HouseKing.king_reach(house, at, game.builder.yaw_to_house(player.head_yaw()), kp) == "ok", "autopilot: … near and facing him")
	link.king_hit_answered.emit("ok", {"ok": true})
	_check(game.autopilot_king == "", "autopilot: the answer sends it on to the duck")
	var found_before: int = link.found_calls
	steps = 0
	while link.found_calls == found_before and steps < 90 * 60:
		game._process(dt)
		player.step(dt)
		steps += 1
	_check(link.found_calls == found_before + 1, "autopilot: … and it finds the duck after the hit")
	link.session_over.emit("test")
	link.config["hit_king"] = false
	main.queue_free()
	await process_frame


## Room scale on the headset rig (a fake headset: the camera moved by hand):
## a real step or lean never takes the head (or the reported feet) through
## a wall, and a real step up the stairs climbs them.
func _test_room_scale() -> void:
	var house: Dictionary = _placeholder_house()
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Room Scale", "intro": false})
	link.house = house
	link.house_version = "test"
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	await physics_frame
	var game: Game = main.get("game")
	var player := game.player
	var b := game.builder
	player.set_process(false)
	player.set_physics_process(false)
	player.read_input = false
	player.set_xr(true)
	link.assignment_received.emit(_assignment(house, "s-rs", true))
	var dt := 1.0 / 90.0
	var spawn: Array = house["spawn"]["pos"]
	var spawn_room := str(house["spawn"]["room"])

	# Walk the headset 4 m out of the spawn room every way: the body stays
	# in, the head stays over it, the reported feet stay in the room.
	var through: Array = []
	for dir: Vector3 in [Vector3(-1, 0, 0), Vector3(1, 0, 0), Vector3(0, 0, -1), Vector3(0, 0, 1)]:
		player.teleport(b.to_world(spawn), b.yaw_to_world(float(house["spawn"]["yaw"])))
		for i in 360:
			player.camera.global_position += dir * (4.0 / 360.0)
			player.step(dt)
		var feet := b.to_house(player.feet())
		var room: Variant = HouseLocate.locate(house, feet)["room"]
		if str(room) != spawn_room or player.head_gap() > VrPlayer.MAX_HEAD_GAP + 0.01:
			through.append("%s: feet %s in %s, head %.2f m off the body" % [dir, feet, room, player.head_gap()])
	_check(through.is_empty(), "room scale: a real step into a wall never takes the head or the feet through it %s" % [through])

	# Walk the headset 2 m up the basement stairs (a 35° ramp, north).
	player.teleport(b.to_world([-2.4, -2.7, 10.8]), b.yaw_to_world(0.0))
	for i in 180:
		player.camera.global_position += Vector3(0, 0, -2.0 / 180.0)
		player.step(dt)
	var up := b.to_house(player.feet())
	_check(up[2] < 9.0 and up[1] > -2.3 and player.head_gap() <= VrPlayer.MAX_HEAD_GAP + 0.01, "room scale: a real step up the stairs climbs them (feet %s, head %.2f m off)" % [up, player.head_gap()])
	var eye: float = b.to_house(player.camera.global_position)[1] - up[1]
	_check(_near(eye, VrPlayer.EYE_HEIGHT, 0.05), "room scale: … and the head rises with the body (eye %.2f m over the feet)" % eye)

	player.set_xr(false)
	main.queue_free()
	await process_frame


func _test_picker() -> void:
	var p := CandidatePicker.new()
	_check(p.update(Vector2(1, 0), 2.0).is_empty(), "picker: nothing to confirm in an empty list")
	p.set_items([{"id": "a", "name": "A"}, {"id": "b", "name": "B"}, {"id": "c", "name": "C"}])
	p.update(Vector2(0, 0), 0.0)
	p.update(Vector2(0, -1), 0.0)
	_check(p.index == 1, "picker: stick down moves down")
	p.update(Vector2(0, -1), 0.0)
	_check(p.index == 1, "picker: a held stick moves once")
	p.update(Vector2(0, 0.2), 0.0)
	p.update(Vector2(0, 1), 0.0)
	_check(p.index == 0, "picker: back up after re-arming")
	p.update(Vector2.ZERO, 0.0)
	p.update(Vector2(0, 1), 0.0)
	_check(p.index == 2, "picker: up from the top wraps")
	p.update(Vector2.ZERO, 0.0)
	_check(p.update(Vector2(1, 0), 0.5).is_empty() and _near(p.progress(), 0.5), "picker: half a second is half the bar")
	var got := p.update(Vector2(1, 0), 0.6)
	_check(got.get("id") == "c", "picker: holding right 1 s confirms")
	_check(p.update(Vector2(1, 0), 3.0).is_empty(), "picker: must let go before the next confirm")
	p.update(Vector2.ZERO, 0.0)
	p.update(Vector2(1, 0), 0.7)
	_check(p.update(Vector2(0.1, 0), 0.1).is_empty() and p.progress() == 0.0, "picker: letting go empties the bar")
	p.set_items([{"id": "x"}, {"id": "c"}, {"id": "a"}])
	_check(p.selected().get("id") == "c", "picker: a refreshed list keeps the selection")


## The tile grid's stick (wave 19): up / down a row, left one back, a
## right flick let go early one on, a right hold still confirms.
func _test_picker_grid() -> void:
	var p := CandidatePicker.new()
	var six: Array = []
	for i in 6:
		six.append({"id": "p%d" % i})
	p.set_items(six)
	p.columns = 3
	p.update(Vector2(0, -1), 0.0)
	_check(p.index == 3, "grid: stick down is a row down")
	p.update(Vector2.ZERO, 0.0)
	p.update(Vector2(0, -1), 0.0)
	_check(p.index == 0, "grid: down from the bottom row wraps to the top, same column")
	p.update(Vector2.ZERO, 0.0)
	p.update(Vector2(-1, 0), 0.0)
	_check(p.index == 5, "grid: left from the first tile wraps to the last")
	p.update(Vector2(-1, 0), 0.0)
	_check(p.index == 5, "grid: a held left moves once")
	p.update(Vector2.ZERO, 0.0)
	p.update(Vector2(1, 0), 0.2)
	_check(p.index == 5 and p.progress() > 0.0, "grid: a right flick starts the hold bar")
	p.update(Vector2.ZERO, 0.0)
	_check(p.index == 0 and p.progress() == 0.0, "grid: … let go early it moves one on (wraps)")
	p.update(Vector2(1, 0), 0.5)
	var got := p.update(Vector2(1, 0), 0.6)
	_check(got.get("id") == "p0" and p.index == 0, "grid: holding right 1 s confirms, no move")
	p.update(Vector2.ZERO, 0.0)
	_check(p.index == 0, "grid: letting go after a confirm moves nothing")
	p.update(Vector2(1, 0), 0.4)
	p.disarm()
	_check(p.update(Vector2(1, 0), 2.0).is_empty() and p.progress() == 0.0, "grid: disarmed, a held right never confirms")
	p.update(Vector2.ZERO, 0.0)
	_check(p.index == 0, "grid: … nor moves when let go")
	_check(CandidatePicker.row_step(4, 5, 3, 1) == 1 and CandidatePicker.row_step(1, 5, 3, 1) == 4 and CandidatePicker.row_step(2, 5, 3, 1) == 4, "grid: a short last row takes its nearest tile")
	_check(CandidatePicker.row_step(0, 2, 2, 1) == 1 and CandidatePicker.row_step(1, 2, 2, -1) == 0, "grid: one row — up / down move one tile")
	_check(CandidatePicker.row_step(0, 0, 3, 1) == 0, "grid: an empty grid stays put")


# --- camera feeds (wave 14) ---------------------------------------------------


func _jpeg(w: int, h: int, c: Color) -> PackedByteArray:
	var img := Image.create(w, h, false, Image.FORMAT_RGB8)
	img.fill(c)
	return img.save_jpg_to_buffer(0.5)


func _test_cam_feeds() -> void:
	# Wave 26 (C7, R5): only the terminals in the player's own (presence)
	# room, never the tent's reinstall station; nearest first, at most four.
	var house: Dictionary = _read_json("res://house/house.json")
	var all := ["optical-drive", "hall", "desktop-tv", "start-bar", "ram", "bathroom-1-door", "server-room", "server-room-door", "tent", "nowhere"]
	var mid := func(room: String) -> Array:
		var r: Dictionary = HouseGeometry.room_by_id(house, room)
		var b := HouseGeometry.poly_bounds(r["poly"])
		var fl: Variant = HouseGeometry.floor_by_id(house, r["floor"])
		return [(float(b[0]) + float(b[2])) / 2.0, float(fl["elevation"]), (float(b[1]) + float(b[3])) / 2.0]
	_check(CamFeeds.spots_to_poll(house, all, mid.call("desktop"), "desktop") == ["desktop-tv"], "cams: in the Desktop, the TV's camera only (%s)" % [CamFeeds.spots_to_poll(house, all, mid.call("desktop"), "desktop")])
	_check(CamFeeds.spots_to_poll(house, all, mid.call("server-room"), "server-room") == ["server-room"], "cams: in the Server Room, its terminal — not the Server Door's in the hall outside")
	var in_ram := CamFeeds.spots_to_poll(house, all, mid.call("ram"), "ram")
	_check(in_ram.size() == 2 and in_ram.has("ram") and in_ram.has("bathroom-1-door"), "cams: a room with two terminals polls both (%s)" % [in_ram])
	_check(CamFeeds.spots_to_poll(house, all, mid.call("ram"), "ram", 1).size() == 1, "cams: … capped")
	_check(CamFeeds.spots_to_poll(house, all, mid.call("tent"), "tent").is_empty(), "cams: the tent's reinstall station is never polled (T3)")
	_check(CamFeeds.spots_to_poll(house, [{"spot": "hall", "at": 1}], mid.call("hall"), "hall") == ["hall"] and CamFeeds.spots_to_poll(house, ["optical-drive"], mid.call("hall"), "hall").is_empty(), "cams: list entries by spot; another room's terminal is not polled")
	_check(CamFeeds.spots_to_poll(house, all, mid.call("hall"), null).is_empty() and CamFeeds.spots_to_poll(house, [], mid.call("hall"), "hall").is_empty() and CamFeeds.spots_to_poll(house, all, [], "hall").is_empty(), "cams: no room (the void), nothing listed or no feet → nothing")

	_check(_near(CamFeeds.backoff(0, 0.25), 0.25) and _near(CamFeeds.backoff(1, 0.25), 1.0) and _near(CamFeeds.backoff(3, 0.25), 4.0), "cams: a failure backs off, doubling")
	_check(_near(CamFeeds.backoff(20, 0.25), CamFeeds.BACKOFF_MAX) and _near(CamFeeds.backoff(1, 2.0, 2.0), 2.0) and _near(CamFeeds.backoff(2, 2.0, 2.0), 4.0), "cams: … up to the cap; the list from its own interval")

	var parsed := CamFeeds.parse_list('{"cams":[{"spot":"hall","at":5,"w":160,"h":120},{"at":1},"x"]}'.to_utf8_buffer())
	_check(parsed.size() == 1 and int(parsed["hall"]["w"]) == 160, "cams: the list parses, junk entries skipped")
	_check(CamFeeds.parse_list("nope".to_utf8_buffer()).is_empty() and CamFeeds.parse_list(PackedByteArray()).is_empty(), "cams: a junk list is empty")

	var img := CamFeeds.decode(_jpeg(160, 120, Color.RED))
	_check(img != null and img.get_width() == 160 and img.get_height() == 120, "cams: a jpeg frame decodes")
	_check(CamFeeds.decode("<svg/>".to_utf8_buffer()) == null and CamFeeds.decode(PackedByteArray()) == null, "cams: anything but a jpeg is no frame")
	var tex := CamFeeds.apply(null, img)
	var same := CamFeeds.apply(tex, CamFeeds.decode(_jpeg(160, 120, Color.BLUE)))
	_check(is_same(tex, same) and same.get_width() == 160, "cams: a frame updates the texture in place")
	var bigger := CamFeeds.apply(tex, CamFeeds.decode(_jpeg(320, 240, Color.BLUE)))
	_check(is_same(tex, bigger) and bigger.get_width() == 320, "cams: … even when its size changes")

	# The panel's transform: the screen centre, proud of the wall along the facing.
	var t: Dictionary = {"id": "x", "name": "X", "pos": [1.0, 1.4, 2.0], "yaw": 90.0}
	var out: float = HouseGeometry.style_of(house)["wallThickness"] / 2.0 + HouseBuilder.TERMINAL_PROUD
	var tr := HouseBuilder.terminal_transform(house, t)
	var fwd: Array = HouseFrames.forward(90.0)
	_check(_near3(HouseFrames.arr(tr.origin), [1.0 + fwd[0] * out, 1.4, 2.0 + fwd[2] * out]) and _near3(HouseFrames.arr(-tr.basis.z), fwd), "cams: a panel faces its terminal's yaw, proud of the wall")
	t["pitch"] = -10.0
	var tp := HouseBuilder.terminal_transform(house, t)
	_check(_near3(HouseFrames.arr(-tp.basis.z), HouseFrames.forward(90.0, -10.0)), "cams: … and its pitch")


## The feed loop with a fake requester, then the panels on a built house.
func _test_cam_panels() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var b := HouseBuilder.new()
	root.add_child(b)
	b.build(house)
	var c := CamFeeds.new()
	root.add_child(c)
	c.feed_shown.connect(b.set_cam)
	c.feed_lost.connect(b.clear_cam)
	var asked: Array = []  # frames
	var lists: Array = []  # the list, never cleared
	c.requester = func(url: String, token: String, done: Callable) -> void: (lists if url.ends_with("/cams") else asked).append([url, token, done])
	var feet := [-1.0, 0.0, 1.5]  # in the Optical Drive (C7: my own room's terminals only)
	var base := "fixture://e/e1/api/spatial"
	var urls := func() -> Array: return asked.map(func(e: Array) -> String: return e[0])

	c.tick(0.016, house, feet, base, "sess")
	_check(lists.size() == 1 and asked.is_empty() and lists[0][0] == base + "/cams" and lists[0][1] == "sess", "cams: the list first, with the token (%s)" % [lists])
	c.tick(0.016, house, feet, base, "sess")
	_check(lists.size() == 1, "cams: one list call in flight")
	(lists[0][2] as Callable).call(200, PackedStringArray(), JSON.stringify({"cams": [{"spot": "optical-drive", "at": 1, "w": 160, "h": 120}, {"spot": "ram", "at": 1, "w": 160, "h": 120}]}).to_utf8_buffer())
	asked.clear()
	c.tick(0.016, house, feet, base, "sess")
	_check(asked.size() == 1 and asked[0][0] == base + "/cam?spot=optical-drive", "cams: a frame for the listed feed in my room, not the basement's (%s)" % [urls.call()])
	c.tick(0.016, house, feet, base, "sess")
	_check(asked.size() == 1, "cams: one frame request per spot in flight")
	(asked[0][2] as Callable).call(200, PackedStringArray(["x-cam-at: 1"]), _jpeg(160, 120, Color.RED))
	_check(c.is_shown("optical-drive") and b.cam_shown("optical-drive") and not b.cam_shown("hall"), "cams: a frame puts the feed on the terminal")
	var root_node := b.part("Terminal_optical-drive") as Node3D
	_check(not (root_node.get_node("Glass") as Node3D).visible and (root_node.get_node("Feed/Video") as MeshInstance3D).mesh.size == HouseBuilder.CAM_SIZE, "cams: … a 4:3 panel in place of the screen")
	var mat := (root_node.get_node("Feed/Video") as MeshInstance3D).material_override as StandardMaterial3D
	_check(mat.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED and is_same(mat.albedo_texture, c.texture("optical-drive")), "cams: … unshaded, showing the feed's texture")
	var feed_world := (root_node.get_node("Feed/Video") as Node3D).global_transform.basis
	_check(_near(feed_world.x.length(), HouseBuilder.TERMINAL_SCALE) and _near(feed_world.y.length(), HouseBuilder.TERMINAL_SCALE) and _near(feed_world.z.length(), 1.0), "cams: … the terminal drawn %dx across the wall, no deeper (wave 33b)" % int(HouseBuilder.TERMINAL_SCALE))
	asked.clear()
	c.tick(0.1, house, feet, base, "sess")
	_check(asked.is_empty(), "cams: about three frames a second, not every tick")
	c.tick(0.3, house, feet, base, "sess")
	_check(asked.size() == 1, "cams: … the next frame after a third of a second")
	var tex := c.texture("optical-drive")
	(asked[0][2] as Callable).call(200, PackedStringArray(), _jpeg(160, 120, Color.BLUE))
	_check(is_same(tex, c.texture("optical-drive")) and is_same(mat.albedo_texture, tex), "cams: the next frame updates the same texture")

	# A rebuild keeps the feed on.
	b.build(house)
	_check(b.cam_shown("optical-drive"), "cams: a rebuilt house keeps the feed")

	# A 404: back to the screen, and asked again later and later.
	asked.clear()
	c.tick(0.4, house, feet, base, "sess")
	(asked[0][2] as Callable).call(404, PackedStringArray(), PackedByteArray())
	_check(not c.is_shown("optical-drive") and not b.cam_shown("optical-drive") and (b.part("Terminal_optical-drive/Glass") as Node3D).visible, "cams: a 404 puts the terminal's screen back")
	asked.clear()
	c.tick(0.5, house, feet, base, "sess")
	_check(asked.is_empty(), "cams: … backed off")
	c.tick(0.6, house, feet, base, "sess")
	_check(asked.size() == 1, "cams: … then asked again")
	(asked[0][2] as Callable).call(0, PackedStringArray(), PackedByteArray())
	asked.clear()
	c.tick(1.5, house, feet, base, "sess")
	_check(asked.is_empty(), "cams: a second failure waits longer")
	c.tick(0.6, house, feet, base, "sess")
	_check(asked.size() == 1, "cams: … then once more")
	(asked[0][2] as Callable).call(200, PackedStringArray(), _jpeg(160, 120, Color.RED))
	_check(b.cam_shown("optical-drive"), "cams: a good frame brings the feed back")

	# A hiccup (no answer, a 5xx) keeps the last frame up until it is stale.
	asked.clear()
	c.tick(0.4, house, feet, base, "sess")
	(asked[0][2] as Callable).call(0, PackedStringArray(), PackedByteArray())
	_check(b.cam_shown("optical-drive"), "cams: no answer keeps the last frame up")
	asked.clear()
	c.tick(1.1, house, feet, base, "sess")
	(asked[0][2] as Callable).call(502, PackedStringArray(), PackedByteArray())
	_check(b.cam_shown("optical-drive"), "cams: … and a 502")
	asked.clear()
	c.tick(CamFeeds.STALE, house, feet, base, "sess")
	_check(not b.cam_shown("optical-drive"), "cams: … until no good frame for %d s" % int(CamFeeds.STALE))
	_check(_near(CamFeeds.backoff(9, 1.0 / CamFeeds.FRAME_RATE, 1.0, CamFeeds.FRAME_BACKOFF_MAX), CamFeeds.FRAME_BACKOFF_MAX), "cams: a spot's frames back off to a few seconds at most")
	_check(asked.size() == 1, "cams: … and the stale spot is still asked (%s)" % [urls.call()])
	(asked[0][2] as Callable).call(200, PackedStringArray(), _jpeg(160, 120, Color.RED))
	_check(b.cam_shown("optical-drive"), "cams: … then a good frame is back on")

	# A failing list backs off too; walking away drops the feed.
	asked.clear()
	c.tick(0.016, house, [-3.0, 0.0, 16.0], base, "sess")
	_check(not b.cam_shown("optical-drive") and c.polling().is_empty() and c.presence() == "hall", "cams: in another room (the Hall), the feed is dropped")
	_check(lists.size() == 2, "cams: the list is asked again every two seconds (%d)" % lists.size())
	(lists[1][2] as Callable).call(500, PackedStringArray(), PackedByteArray())
	c.tick(1.9, house, [-3.0, 0.0, 16.0], base, "sess")
	_check(lists.size() == 2, "cams: a failed list waits")
	c.tick(2.2, house, [0.0, 0.0, 30.0], base, "sess")
	_check(lists.size() == 3, "cams: … then asks again")

	# The session ends: everything off, late answers ignored, nothing asked.
	asked.clear()
	c.tick(0.016, house, feet, base, "sess")
	var pending: Array = asked.filter(func(a: Array) -> bool: return str(a[0]).contains("/cam?"))
	c.stop()
	_check(not b.cam_shown("optical-drive") and c.polling().is_empty(), "cams: stop takes every feed off")
	for a: Array in pending:
		(a[2] as Callable).call(200, PackedStringArray(), _jpeg(160, 120, Color.RED))
	_check(not b.cam_shown("optical-drive") and not c.is_shown("optical-drive"), "cams: an answer after stop changes nothing")
	asked.clear()
	var n := lists.size()
	c.tick(0.016, house, feet, "", "")
	_check(asked.is_empty() and lists.size() == n, "cams: offline, nothing is asked")
	c.requester = Callable()
	c.queue_free()
	b.queue_free()
	await process_frame


func _test_flow() -> void:
	var f := GameFlow.new()
	_check(not f.found(true) and not f.abort(), "flow: nothing to find or abort in the lobby")
	_check(f.assign({"session": "s"}) and f.state == GameFlow.State.PLAYING, "flow: lobby → playing")
	_check(not f.assign({"session": "t"}) and f.assignment["session"] == "s", "flow: no second assignment while playing")
	_check(not f.tick(100.0), "flow: playing never times out by itself")
	_check(f.found(true) and f.state == GameFlow.State.FOUND and f.released, "flow: playing → found")
	_check(not f.tick(1.0) and f.state == GameFlow.State.FOUND, "flow: the celebration lasts")
	_check(f.tick(GameFlow.CELEBRATE) and f.state == GameFlow.State.LOBBY and f.assignment.is_empty(), "flow: found → lobby")
	f.assign({"session": "u"})
	_check(f.abort() and f.state == GameFlow.State.LOBBY, "flow: abort → lobby")


# --- the built house ------------------------------------------------------------


## Terminals stand proud of their walls; doors keep their full width; corners close.
func _test_builder_geometry(b: HouseBuilder, house: Dictionary) -> void:
	var wt: float = HouseGeometry.style_of(house)["wallThickness"]
	var buried: Array = []
	for t: Dictionary in house["terminals"]:
		var root_node := b.part("Terminal_%s" % t["id"]) as Node3D
		var glass := b.part("Terminal_%s/Glass" % t["id"]) as Node3D
		if root_node == null or glass == null:
			buried.append("%s: no glass" % t["id"])
			continue
		var pos := HouseFrames.vec(t["pos"])
		var f := HouseFrames.vec(HouseFrames.forward(float(t["yaw"]), float(t["pitch"]) if t.get("pitch") != null else 0.0))
		var glass_out := (HouseFrames.vec(b.to_house(glass.global_position)) - pos).dot(f)
		# The frame box is 3 cm deep, centred on the root: its back is 1.5 cm behind.
		var back_out := (HouseFrames.vec(b.to_house(root_node.global_position)) - pos).dot(f) - 0.015
		if glass_out <= wt / 2.0 + 0.01 or back_out <= wt / 2.0:
			buried.append("%s: glass %.3f, back %.3f m out" % [t["id"], glass_out, back_out])
	_check(buried.is_empty(), "builder: every terminal screen stands clear of its wall box %s" % [buried])
	var kitchen := b.part("Terminal_start-bar/Glass") as Node3D
	if kitchen != null:
		var kz: float = b.to_house(kitchen.global_position)[2]
		_check(kz > 6.0 + wt / 2.0, "builder: the Start Bar (kitchen) screen is in front of its wall (z %.3f)" % kz)

	var boxes := HouseBuilder.wall_boxes(b.walls, wt)
	_check(boxes.size() == b.walls.size(), "builder: one wall box per segment")
	var narrowed: Array = []
	var checked := 0
	for door: Dictionary in house["doors"]:
		var room: Variant = HouseGeometry.room_by_id(house, door["a"])
		var at: Array = door["at"]
		var width: float = door["width"]
		for axis: String in ["x", "z"]:
			var c: float = at[1] if axis == "x" else at[0]
			var run: float = at[0] if axis == "x" else at[1]
			var below := -INF
			var above := INF
			for i in b.walls.size():
				var w: Dictionary = b.walls[i]
				if w["axis"] != axis or str(w["floor"]) != str(room["floor"]) or (w["kind"] != "wall" and w["kind"] != "fence"):
					continue
				if HouseGeometry.mmi(float(w["c"])) != HouseGeometry.mmi(c):
					continue
				var lo: float = boxes[i]["lo"].x if axis == "x" else boxes[i]["lo"].z
				var hi: float = boxes[i]["hi"].x if axis == "x" else boxes[i]["hi"].z
				if hi <= run:
					below = maxf(below, hi)
				elif lo >= run:
					above = minf(above, lo)
			if above - below > width + 1.0 or is_inf(above - below):
				continue  # not this door's line (or a door at the end of a wall)
			checked += 1
			if not _near(above - below, width):
				narrowed.append("%s: %.3f of %.2f m" % [door["id"], above - below, width])
	_check(checked > 0 and narrowed.is_empty(), "builder: every door's clear gap between its jambs is its width (%d checked) %s" % [checked, narrowed])
	var extended := 0
	for i in b.walls.size():
		var w: Dictionary = b.walls[i]
		var span: Vector3 = boxes[i]["hi"] - boxes[i]["lo"]
		if (span.x if w["axis"] == "x" else span.z) > float(w["hi"]) - float(w["lo"]) + 1e-6:
			extended += 1
	_check(extended > 0, "builder: wall ends reach into the walls they meet, so corners close (%d)" % extended)
	var fence_ok := true
	for i in b.walls.size():
		var span: Vector3 = boxes[i]["hi"] - boxes[i]["lo"]
		var thick := span.z if b.walls[i]["axis"] == "x" else span.x
		if not _near(thick, HouseBuilder.wall_kind_thickness(str(b.walls[i]["kind"]), wt)):
			fence_ok = false
	_check(fence_ok and _near(HouseBuilder.wall_kind_thickness("fence", 0.12), 0.06) and _near(HouseBuilder.wall_kind_thickness("rail", 0.12), 0.05), "builder: fences and rails take three.js's thicknesses")


# --- main.tscn + the game, with a fake link --------------------------------------


## Ghosts wear their profile pictures: fetched once per URL (two at a time,
## deduplicated, cached, a failure not retried within the visit), shown as a head once the
## bytes land; an `avatar` frame changes it; no key → a swarm of static.
## The swarm's layout and trail: the same shards as `swarm.ts`, whose test
## pins these numbers too.
func _test_swarm() -> void:
	var shards := Swarm.layout()
	_check(shards.size() == Swarm.SHARDS, "swarm: %d shards" % shards.size())
	_check(_near((shards[0]["home"] as Vector3).y, 0.9204645976540632, 1e-5) and _near((shards[0]["rand"] as Color).r, 0.4209635134320706, 1e-5), "swarm: shard 0 is swarm.ts's")
	_check(_near((shards[100]["size"] as Vector2).x, 0.023696090903909256, 1e-5) and _near((shards[100]["cell"] as Color).r, 0.5556649875167446, 1e-5), "swarm: shard 100 is swarm.ts's")
	var faces := 0
	var outside := 0
	for s: Dictionary in shards:
		faces += 1 if (s["rand"] as Color).a >= 1.0 else 0
		var h: Vector3 = s["home"]
		outside += 1 if Vector2(h.x, h.z).length() > Swarm.RADIUS * 1.2 + 1e-6 else 0
	_check(faces == Swarm.FACE_GRID * Swarm.FACE_GRID, "swarm: the face's %d cells" % faces)
	_check(outside == 0, "swarm: every shard rests inside the collider (%d out)" % outside)
	var t := Swarm.SwarmTrail.new()
	t.step(Vector3.ZERO, 0.016)
	_check(t.offsets.size() == Swarm.TRAIL and t.offsets[Swarm.TRAIL - 1] == Vector3.ZERO, "swarm: the trail starts on the body")
	var x := 0.0
	for i in 60:
		x += 0.02
		t.step(Vector3(x, 0, 0), 0.016)
	_check(t.offsets[0] == Vector3.ZERO and t.offsets[Swarm.TRAIL - 1].x < -0.5, "swarm: … hangs behind a walk (%.2f)" % t.offsets[Swarm.TRAIL - 1].x)
	t.step(Vector3(x + Swarm.TELEPORT_M + 1.0, 0, 0), 0.016)
	_check(t.offsets[Swarm.TRAIL - 1] == Vector3.ZERO, "swarm: … and a teleport starts it again")
	var wide := Image.create(8, 4, false, Image.FORMAT_RGBA8)
	wide.fill(Color(1, 0, 0, 0.5))
	var bare := AvatarCache.bare_of(wide)
	_check(bare.get_width() == AvatarCache.TILE and bare.get_height() == AvatarCache.TILE and bare.has_mipmaps() and bare.get_pixel(64, 64).a < 0.6, "swarm: the bare picture is a square, mipmapped, transparency kept")


## The player's hands: no left hand drawn, the right one their own picture as
## a swarm, from the assignment, live off an `avatar` frame, gone with the walk.
func _test_hand_swarm(game: Game, link: LinkBase) -> void:
	var meshes := 0
	for h: XRController3D in [game.player.left_hand, game.player.right_hand]:
		for c in h.get_children():
			meshes += 1 if c is MeshInstance3D else 0
	_check(meshes == 0, "hands: no box is drawn on either hand (%d)" % meshes)
	_check(game.player.left_hand.get_child_count() == 0, "hands: the left hand draws nothing; its controller still reads")
	var hand := game.hand
	_check(hand.get_parent() == game.player.right_hand and hand.top_level and hand.multimesh == Ghosts.shards(), "hands: the right hand is a swarm of the ghosts' shards")
	var mat := hand.material_override as ShaderMaterial
	_check(_near(float(mat.get_shader_parameter("swarm_scale")), HandSwarm.SCALE) and float(mat.get_shader_parameter("near_weight")) == 0.0, "hands: … small, and its face doesn't lock on for a camera that is always near")
	var asked: Array = []
	game.ghosts.avatars.requester = func(url: String, done: Callable) -> void: asked.append([url, done])
	var src := Image.create(8, 8, false, Image.FORMAT_RGBA8)
	src.fill(Color(0.1, 0.9, 0.1))
	var ok_headers := PackedStringArray(["Content-Type: image/png"])
	var a := _assignment(game.builder.house, "s-hand", true)
	a["avatar"] = "hand1"
	link.session_over.emit("test")
	link.assignment_received.emit(a)
	_check(hand.picture_url() == "fixture://avatar/hand1" and not hand.worn() and asked.size() == 1, "hands: the assignment's key is fetched (%s)" % hand.picture_url())
	(asked[0][1] as Callable).call(true, ok_headers, src.save_png_to_buffer())
	_check(hand.worn() and is_same(mat.get_shader_parameter("map"), game.ghosts.avatars.bare("fixture://avatar/hand1")), "hands: … and worn, the bare picture")
	link.stream_frame.emit("avatar", {"session": "someone-else", "avatar": "hand2"})
	_check(hand.picture_url() == "fixture://avatar/hand1", "hands: another program's avatar frame changes nothing")
	link.stream_frame.emit("avatar", {"session": "s-hand", "avatar": "hand2"})
	_check(hand.picture_url() == "fixture://avatar/hand2" and not hand.worn(), "hands: our own avatar frame changes it")
	(asked[1][1] as Callable).call(false, PackedStringArray(), PackedByteArray())
	_check(not hand.worn(), "hands: a picture that won't load leaves static")
	link.session_over.emit("test")
	_check(hand.picture_url() == "" and not hand.worn() and hand.own_session == "", "hands: the walk's end takes it off, for the next program")
	game.ghosts.avatars.requester = Callable()
	game.ghosts.avatars.forget_failures()


func _test_ghost_pictures(game: Game, link: LinkBase) -> void:
	var g := game.ghosts
	var asked: Array = []  # [url, done]
	g.avatars.requester = func(url: String, done: Callable) -> void: asked.append([url, done])
	var src := Image.create(8, 8, false, Image.FORMAT_RGBA8)
	src.fill(Color(0.9, 0.1, 0.1))
	var png := src.save_png_to_buffer()
	var ok_headers := PackedStringArray(["Content-Type: image/png"])
	var pose := func(sid: String, name: String, avatar: Variant) -> Dictionary:
		var p := {"session": sid, "name": name, "p": [0.0, 0.0, 1.0], "yaw": 0.0, "pitch": 0.0}
		if avatar != null or sid == "nokey":
			p["avatar"] = avatar
		return p
	link.stream_frame.emit("hello", {"eventId": "e", "houseVersion": "test", "players": [
		pose.call("excel", "Excel", "aaaa"), pose.call("word", "Word", "bbbb"), pose.call("paint", "MS Paint", "cccc"),
		pose.call("nokey", "Persona", null), pose.call("old", "Old Server", null),
	]})
	_check(g.count() == 5 and g.picture_url("excel") == "fixture://avatar/aaaa", "ghosts: a ghost's avatar key names its picture (%s)" % g.picture_url("excel"))
	_check(g.picture_url("nokey") == "" and g.picture_url("old") == "" and not g.has_picture("nokey") and not g.has_picture("old"), "ghosts: no key (null, or an old server's missing field) → a swarm of static")
	_check(asked.size() == 2 and g.avatars.in_flight() == 2, "ghosts: two picture requests at a time (%d)" % asked.size())
	_check(not g.has_picture("excel"), "ghosts: … no picture before the bytes land")
	(asked[0][1] as Callable).call(true, ok_headers, png)
	_check(g.has_picture("excel"), "ghosts: the picture lands in the swarm")
	var swarm: MultiMeshInstance3D = null
	var meshes := 0
	for c in g.get_children():
		if c.get_node_or_null("Swarm") != null:
			if swarm == null:
				swarm = c.get_node("Swarm")
			for n in c.get_children():
				meshes += 1 if n is MeshInstance3D else 0
	var mat := swarm.material_override as ShaderMaterial if swarm != null else null
	var worn: Texture2D = mat.get_shader_parameter("map") if mat != null else null
	_check(swarm != null and mat.shader == Ghosts.SWARM_SHADER and bool(mat.get_shader_parameter("worn")) and worn != null, "ghosts: … one shader over the swarm's shards")
	_check(worn != null and is_same(worn, g.avatars.bare("fixture://avatar/aaaa")) and not is_same(worn, g.avatars.texture("fixture://avatar/aaaa")), "ghosts: … cut from the bare picture, not the lobby's tile")
	_check(meshes == 0, "ghosts: no capsule, visor or tile is drawn (%d)" % meshes)
	_check(asked.size() == 3 and str(asked[2][0]) == "fixture://avatar/cccc", "ghosts: the third request goes once one lands")
	(asked[1][1] as Callable).call(false, PackedStringArray(), PackedByteArray())  # word: a 404
	var gif := "GIF89a".to_ascii_buffer()
	gif.append_array(PackedByteArray([1, 0, 1, 0, 0]))
	(asked[2][1] as Callable).call(true, PackedStringArray(["Content-Type: image/gif"]), gif)  # paint: a GIF
	_check(not g.has_picture("word") and not g.has_picture("paint") and g.avatars.has_failed("fixture://avatar/bbbb") and g.avatars.has_failed("fixture://avatar/cccc"), "ghosts: a failed or undecodable picture leaves it static")

	# The same key again: cached (no request, at once); a failed one: never retried.
	link.stream_frame.emit("join", {"player": pose.call("excel2", "Excel", "aaaa")})
	link.stream_frame.emit("join", {"player": pose.call("word2", "Word", "bbbb")})
	_check(asked.size() == 3 and g.has_picture("excel2") and not g.has_picture("word2"), "ghosts: a cached picture shows at once, a failed one isn't fetched again (%d)" % asked.size())
	link.stream_frame.emit("poses", {"t": 2, "players": [{"session": "excel", "p": [1.0, 0.0, 1.0], "yaw": 0.0, "pitch": 0.0}]})
	_check(g.has_picture("excel"), "ghosts: a pose without the field keeps the picture")

	# `avatar` frames: a new picture, none, and one for a stranger.
	link.stream_frame.emit("avatar", {"session": "nokey", "avatar": "dddd"})
	_check(g.picture_url("nokey") == "fixture://avatar/dddd" and asked.size() == 4, "ghosts: an avatar frame fetches the new picture")
	(asked[3][1] as Callable).call(true, ok_headers, png)
	_check(g.has_picture("nokey"), "ghosts: … and wears it")
	var one_set: Array = []
	for c in g.get_children():
		if c.get_node_or_null("Swarm") != null and not one_set.has((c.get_node("Swarm") as MultiMeshInstance3D).multimesh):
			one_set.append((c.get_node("Swarm") as MultiMeshInstance3D).multimesh)
	_check(one_set.size() == 1, "ghosts: every ghost shares one set of shards (%d)" % one_set.size())
	link.stream_frame.emit("avatar", {"session": "excel", "avatar": null})
	_check(not g.has_picture("excel") and g.picture_url("excel") == "", "ghosts: an avatar frame with no key takes the picture off")
	link.stream_frame.emit("avatar", {"session": "nobody", "avatar": "eeee"})
	_check(asked.size() == 4, "ghosts: an avatar frame for no ghost fetches nothing")
	# A new visit asks once more for what failed in an earlier one (a
	# timeout is no reason to stay a capsule all night) — once.
	var before := asked.size()
	link.session_over.emit("test")
	link.assignment_received.emit(_assignment(game.builder.house, "s-pic", true))
	var again: Array = []
	for i in range(before, asked.size()):
		again.append(str(asked[i][0]))
	_check(not g.avatars.has_failed("fixture://avatar/bbbb") and again.has("fixture://avatar/bbbb") and again.has("fixture://avatar/cccc") and not again.has("fixture://avatar/aaaa"), "ghosts: a new visit retries the failed pictures, not the cached ones (%s)" % [again])
	for i in range(before, asked.size()):
		(asked[i][1] as Callable).call(false, PackedStringArray(), PackedByteArray())
	var settled := asked.size()
	link.stream_frame.emit("join", {"player": pose.call("word3", "Word", "bbbb")})
	_check(asked.size() == settled and g.avatars.has_failed("fixture://avatar/bbbb"), "ghosts: … and failing again, not within the visit (%d)" % asked.size())
	link.stream_frame.emit("reset", {})
	_check(g.count() == 0, "ghosts: a reset clears them")
	g.avatars.requester = Callable()


## The shared King in the game: the bar, the approach notice, the hit (near
## and facing, once per visit, every answer), the fall for everyone (kneels,
## the door opens for the body and the trail) and the restore.
func _test_game_king(game: Game, link: LinkBase, house: Dictionary) -> void:
	var player := game.player
	var b := game.builder
	var sub: Label3D = game.hud.get("_sub")
	var kid := "cold-lock-king"
	var east := [-1.6, -2.7, 11.2]  # 0.95 m east of him, in the basement hall
	var west_yaw := b.yaw_to_world(90.0)

	# No shared King (an old server): no notice, the button does nothing.
	link.give_king(null)
	link.assignment_received.emit(_assignment(house, "s-3k0", true))
	game.hud.notice("")
	player.teleport(b.to_world(east), west_yaw)
	game._process(0.016)
	player.hit_button = true
	game._process(0.016)
	player.hit_button = false
	game._process(0.016)
	_check(sub.text == "" and link.king_hits == 0, "game king: an old server's King says nothing and takes no hit (%s)" % sub.text)
	link.session_over.emit("test")

	link.give_king({"id": kid, "hp": 15, "max": 15, "fallen": false})
	var text := b.part("Prop_%s/Health/HealthText" % kid) as Label3D
	var bar := b.part("Prop_%s/Health/HealthBar" % kid) as Sprite3D
	_check((b.part("Prop_%s/Health" % kid) as Node3D).visible and text.text == "THE KING  15 / 15" and bar.texture != null, "game king: the shared bar over him (%s)" % text.text)
	_check(not b.king_kneeling(kid) and b.door_shut("server-door"), "game king: … standing, his door shut")

	link.assignment_received.emit(_assignment(house, "s-3k", true))
	game.hud.notice("")
	player.teleport(b.to_world(east), b.yaw_to_world(0.0))  # beside him, looking north
	game._process(0.016)
	_check(sub.text == Game.KING_NOTICE, "game king: near him the HUD says how to hit him (%s)" % sub.text)
	_check(Game.KING_NOTICE == "Pull the trigger to hit the King.", "game king: the notice's words (no rule said up front, G1)")
	_check(Game.session_over_text("unmarked") == "No longer marked for reinstallation — the simulation ended." and Game.session_over_text("timeout") == "Session ended (timeout).", "game: an unmarked walk's end says why (wave 18b, R16)")
	game.hud.notice("")
	game._process(0.016)
	_check(sub.text == "", "game king: … and not again while still beside him")
	player.hit_button = true
	game._process(0.016)
	_check(link.king_hits == 0 and sub.text == Game.KING_CLOSER, "game king: a press not facing him is no hit (%s)" % sub.text)
	player.hit_button = false
	game._process(0.016)
	player.teleport(b.to_world(east), west_yaw)
	player.hit_button = true
	game._process(0.016)
	_check(link.king_hits == 1, "game king: a press near and facing him hits")
	game._process(0.016)
	_check(link.king_hits == 1, "game king: holding the button is one press")
	player.hit_button = false
	game._process(0.016)
	player.hit_button = true
	game._process(0.016)
	_check(link.king_hits == 1, "game king: no second hit while one is out")
	player.hit_button = false
	link.give_king({"id": kid, "hp": 14, "max": 15, "fallen": false, "by": "Ada"})
	link.king_hit_answered.emit("ok", {"ok": true})
	_check(game.king_hit_used and sub.text == "You hit him." and text.text == "THE KING  14 / 15", "game king: ok → \"You hit him.\", the bar drops (%s / %s)" % [sub.text, text.text])
	game._process(0.016)
	player.hit_button = true
	game._process(0.016)
	player.hit_button = false
	_check(link.king_hits == 1 and sub.text == Game.KING_USED, "game king: once per visit (%s)" % sub.text)
	link.session_over.emit("test")

	# A new visit may hit again; the server's "already hit" (the same visit
	# re-scanned) counts as used; "not near" and a pause say so.
	link.assignment_received.emit(_assignment(house, "s-3k2", true))
	_check(not game.king_hit_used, "game king: a new visit has its hit back")
	# A re-scan before the duck (after Leave or a timeout) is the same visit:
	# the assignment's kingHit starts it spent.
	link.session_over.emit("test")
	var spent := _assignment(house, "s-3k1", true)
	spent["kingHit"] = true
	link.assignment_received.emit(spent)
	_check(game.king_hit_used, "game king: an assignment with kingHit starts spent")
	link.session_over.emit("test")
	link.assignment_received.emit(_assignment(house, "s-3k2", true))
	_check(not game.king_hit_used, "game king: … and one without it does not")
	player.teleport(b.to_world(east), west_yaw)
	game._process(0.016)
	player.hit_button = true
	game._process(0.016)
	player.hit_button = false
	_check(link.king_hits == 2, "game king: … and hits")
	link.king_hit_answered.emit("not near", {"error": "not near"})
	_check(not game.king_hit_used and sub.text == Game.KING_CLOSER, "game king: not near → closer, still unused")
	game._process(0.016)
	player.hit_button = true
	game._process(0.016)
	player.hit_button = false
	link.king_hit_answered.emit("doors are closed", {"error": "doors are closed"})
	_check(sub.text == Game.KING_PAUSED and not game.king_hit_used, "game king: a pause says so")
	game._process(0.016)
	player.hit_button = true
	game._process(0.016)
	player.hit_button = false
	link.king_hit_answered.emit("already hit", {"error": "already hit"})
	_check(game.king_hit_used and sub.text == Game.KING_USED and link.king_hits == 4, "game king: already hit → used")

	# Someone else's hit fells him: he kneels for everyone, the door opens.
	var spawn: Array = house["spawn"]["pos"]
	var inside := [-5.0, -2.7, 9.5]
	_check(Game.trail_path(game.route_house, spawn, inside).size() == 2, "game king: standing, no trail through his door")
	link.give_king({"id": kid, "hp": 0, "max": 15, "fallen": true, "by": "Zed"})
	_check(b.king_kneeling(kid) and not b.door_shut("server-door") and text.text == "THE KING  0 / 15", "game king: fallen, he kneels and his door opens")
	_check(sub.text == "He is down: the cold door is open.", "game king: … and the HUD says so (%s)" % sub.text)
	var through := Game.trail_path(game.route_house, spawn, inside)
	_check(through.size() > 2, "game king: … the trail goes through his door (%d points)" % through.size())
	game._process(0.016)
	player.hit_button = true
	game._process(0.016)
	player.hit_button = false
	_check(link.king_hits == 4 and sub.text == Game.KING_DOWN, "game king: no hit on a fallen King")

	# The body walks through the open door (west, from beside him) …
	player.locomotion_enabled = true
	player.teleport(b.to_world(east), west_yaw)
	player.left_stick = Vector2(0, 1)
	for i in 110:
		player.step(1.0 / 90.0)
	var room: Variant = HouseLocate.locate(house, b.to_house(player.feet()))["room"]
	_check(str(room) == "server-room", "game king: fallen, the body walks through his door (in %s at %s)" % [room, b.to_house(player.feet())])
	player.left_stick = Vector2.ZERO
	var in_server: Array = b.to_house(player.feet())
	# A remap keeps him down.
	link.give_house(house)
	_check(b.king_kneeling(kid) and not b.door_shut("server-door"), "game king: a remap keeps him down")
	# A remap while crossing his spot (his door is behind it) keeps the
	# player there: fallen, he is no solid prop.
	var on_him: Array = HouseKing.king_prop(house)["pos"]
	player.teleport(b.to_world(on_him), west_yaw)
	game.hud.notice("")
	link.give_house(house)
	var after: Array = b.to_house(player.feet())
	_check(Vector2(float(after[0]) - float(on_him[0]), float(after[2]) - float(on_him[2])).length() < 0.05 and sub.text == "", "game king: fallen, a remap on his spot keeps the player there (at %s, %s)" % [after, sub.text])
	player.teleport(b.to_world(in_server), west_yaw)

	# A director's restore stands him up — but the player is behind his
	# door: it stays open for them (no shutting anyone in) …
	link.give_king({"id": kid, "hp": 15, "max": 15, "fallen": false, "by": null})
	_check(not b.king_kneeling(kid) and sub.text == Game.KING_STANDS, "game king: a restore stands him up (%s)" % sub.text)
	_check(not b.door_shut("server-door") and b.door_held(kid) and not b.king_solid(kid) and game.king_door_open, "game king: … the door held open for a player behind it")
	_check(Game.trail_path(game.route_house, in_server, spawn).size() > 2, "game king: … and their trail still leads out")
	game._process(0.6)
	_check(not b.door_shut("server-door"), "game king: … still open on the next check")
	# … they walk out east, through the doorway and through him …
	player.teleport(b.to_world(in_server), b.yaw_to_world(-90.0))
	player.left_stick = Vector2(0, 1)
	for i in 220:
		player.step(1.0 / 90.0)
		game._process(1.0 / 90.0)
	player.left_stick = Vector2.ZERO
	var out: Array = b.to_house(player.feet())
	room = HouseLocate.locate(house, out)["room"]
	_check(str(room) == "basement-hall" and float(out[0]) > -2.55 + 0.3 + HouseKing.KEEP_CLEAR, "game king: … the player walks out past him (in %s at %s)" % [room, out])
	game._process(0.6)
	# … and once clear it shuts.
	_check(b.door_shut("server-door") and not b.door_held(kid) and b.king_solid(kid) and not game.king_door_open, "game king: clear of it, the door shuts")
	_check(Game.trail_path(game.route_house, spawn, inside).size() == 2, "game king: … and the trail shut again")
	# A restore with the player clear shuts it at once.
	link.give_king({"id": kid, "hp": 0, "max": 15, "fallen": true, "by": "Zed"})
	link.give_king({"id": kid, "hp": 15, "max": 15, "fallen": false, "by": null})
	_check(b.door_shut("server-door") and b.king_solid(kid), "game king: a restore with the player clear shuts it at once")
	player.teleport(b.to_world(east), west_yaw)
	player.left_stick = Vector2(0, 1)
	for i in 110:
		player.step(1.0 / 90.0)
	room = HouseLocate.locate(house, b.to_house(player.feet()))["room"]
	_check(str(room) == "basement-hall", "game king: standing, he blocks the body (in %s at %s)" % [room, b.to_house(player.feet())])
	player.left_stick = Vector2.ZERO
	link.session_over.emit("test")
	await process_frame


func _assignment(house: Dictionary, sid: String, captured: bool) -> Dictionary:
	return {
		"session": sid, "token": "tok-" + sid, "guest": "g-aaaaaa", "name": "Ada", "world": "vr",
		"device": "Test Headset", "station": "vr-1", "captured": captured,
		"duck": HouseDuck.pick_duck_spot(house, sid), "spawn": house["spawn"], "houseVersion": "test",
	}


## Wave 59: both triggers + A for 5 s, whatever the player is in.
func _test_run_reset() -> void:
	var house: Dictionary = _placeholder_house()
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset", "trail_delay": 0, "intro": true})
	link.house = house
	link.house_version = "test"
	var main: Node = load("res://main.tscn").instantiate()
	main.link = link
	root.add_child(main)
	await process_frame
	var game: Game = main.game
	var player := game.player
	player.read_input = false
	var feet_at_spawn := HouseFrames.vec(house["spawn"]["pos"])

	# The chord: two triggers of any kind and A; a hand of two counts.
	_check(VrPlayer.chord(2, true) and VrPlayer.chord(3, true), "reset: two triggers and A are the chord")
	_check(not VrPlayer.chord(1, true) and not VrPlayer.chord(4, false), "reset: one trigger, or no A, is not")

	# The hold, on its own.
	var m := HoldMeter.new(1.0)
	_check(is_equal_approx(m.update(true, 0.25), 0.25) and is_equal_approx(m.update(true, 0.25), 0.5), "reset: the hold fills")
	_check(m.update(false, 0.1) == 0.0 and is_equal_approx(m.update(true, 0.25), 0.25), "reset: letting go empties it")
	m.update(true, 1.0)
	m.spend()
	_check(m.update(true, 9.0) == 0.0, "reset: spent, it does nothing while still held")
	m.update(false, 0.1)
	_check(is_equal_approx(m.update(true, 0.5), 0.5), "reset: let go, it fills again")

	# In the intro it does nothing: nothing there to be stuck on.
	var a := _assignment(house, "s-reset", true)
	a["reinstalled"] = 2
	link.assignment_received.emit(a)
	_check(game.in_intro(), "reset: the walk starts in the intro")
	player.reset_chord = true
	game._process(HoldMeter.RESET_HOLD + 1.0)
	_check(game.in_intro() and link.get("run_resets") == 0 and game.hud.reset_fill() == 0.0, "reset: never in the intro")
	player.reset_chord = false
	game._intro_events(game.intro.skip_all())
	game._process(0.016)
	_check(not game.in_intro(), "reset: into the house")

	# A few steps away, held, let go early: nothing.
	var duck_was: String = str(game.flow.assignment["duck"]["id"])
	var away := feet_at_spawn + Vector3(1.0, 0.0, 0.0)
	player.teleport(away, 0.0)
	game.descent.running = false
	player.reset_chord = true
	game._process(2.0)
	_check(is_equal_approx(game.hud.reset_fill(), 2.0 / HoldMeter.RESET_HOLD), "reset: the bar fills while held (%.2f)" % game.hud.reset_fill())
	_check(game.hud.get_node("ResetBar").visible, "reset: the bar is up")
	player.reset_chord = false
	game._process(0.016)
	_check(game.hud.reset_fill() == 0.0 and not game.hud.get_node("ResetBar").visible and link.get("run_resets") == 0, "reset: letting go cancels it")
	_check(_v3(player.feet(), away), "reset: … and nothing moved")

	# Held all the way.
	var hit_used := game.king_hit_used
	var played := float(game.get("_played_for"))
	player.reset_chord = true
	for i in 5:
		game._process(1.01)
	_check(link.get("run_resets") == 1, "reset: five seconds resets the run")
	_check(_v3(player.feet(), feet_at_spawn), "reset: back at the spawn (%s)" % player.feet())
	_check(game.state() == GameFlow.State.PLAYING and not game.in_intro(), "reset: no video, no tutorial")
	_check(link.get("readies") == 1, "reset: the run's clock isn't restarted")
	_check(game.king_hit_used == hit_used and float(game.get("_played_for")) >= played, "reset: no hit back, the walk's clock runs on")
	_check(game.hud.notice_text() == Game.RESET_DONE, "reset: it says so (%s)" % game.hud.notice_text())
	for i in 8:
		game._process(1.0)
	_check(link.get("run_resets") == 1, "reset: still held, it does not go again")
	player.reset_chord = false
	game._process(0.016)

	# Gerald moves on the server's word.
	var spots: Array = house["duck"]["spots"]
	var other: Dictionary = {}
	for s: Dictionary in spots:
		if str(s["id"]) != duck_was:
			other = s
			break
	link.duck_changed.emit(other)
	_check(str(game.flow.assignment["duck"]["id"]) == str(other["id"]) and _v3(game.duck.global_position, HouseFrames.vec(other["pos"])), "reset: Gerald goes where the server says")

	# Out of the void's scare: it waits for the scare, then goes.
	player.teleport(away, 0.0)
	game.set("_escape_t", 0.0)
	game.hud.scare(true)
	player.reset_chord = true
	game._process(HoldMeter.RESET_HOLD + 0.1)
	_check(link.get("run_resets") == 1, "reset: not on top of a scare")
	game.set("_escape_t", -1.0)
	game.hud.scare(false)
	game._process(0.016)
	_check(link.get("run_resets") == 2 and _v3(player.feet(), feet_at_spawn), "reset: straight after it")
	player.reset_chord = false
	game._process(0.016)

	link.session_over.emit("test")
	await process_frame
	main.queue_free()
	await process_frame


func _test_main_and_game() -> void:
	var house: Dictionary = _placeholder_house()
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	# The trail tests ignore the path reveal (R2; its own test is _test_path_reveal).
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset", "trail_delay": 0, "intro": false})
	link.house = house
	link.house_version = "test"
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	_check(game != null and game.builder != null, "main: the game is set up")
	if game == null or game.builder == null:
		return

	# Smoke: the house is built from the map.
	var b := game.builder
	_check(b.walls.size() == HouseGeometry.build_walls(house).size() and not b.walls.is_empty(), "main: the walls are built (%d)" % b.walls.size())
	var colliders := b.get_node_or_null("Colliders")
	_check(colliders != null and colliders.get_child_count() > b.walls.size(), "main: walls, floors and props collide")
	_check(b.part("Floor") != null and b.part("Ceilings") != null and b.part("Walls_wall") != null, "main: floor, ceiling and wall meshes")
	for s: Dictionary in house["stairs"]:
		_check(b.part("Ramp_%s" % s["id"]) != null, "main: ramp %s" % s["id"])
	for t: Dictionary in house["terminals"]:
		_check(b.part("Terminal_%s" % t["id"]) != null, "main: terminal screen %s" % t["id"])
	# The King (a `king` prop) stands at the cold door, solid, with a crown;
	# with no shared King (an old server) he has no bar; his door's leaf is shut.
	var king_prop: Dictionary = {}
	for pr: Dictionary in house["props"]:
		if str(pr.get("kind", "")) == "king":
			king_prop = pr
	_check(not king_prop.is_empty() and b.part("Prop_%s" % king_prop.get("id", "")) != null, "main: the king stands at the cold door")
	_check(not king_prop.is_empty() and HouseGeometry.prop_solid(king_prop), "house: the king is solid")
	_check(not king_prop.is_empty() and b.part("Prop_%s" % king_prop.get("id", "")).get_child_count() >= 3, "main: the king has a body, a crown and his name")
	var health := b.part("Prop_%s/Health" % king_prop.get("id", "")) as Node3D
	_check(health != null and not health.visible, "main: no shared King, no health bar over him")
	_check(b.door_shut("server-door") and b.part("Door_server-door") != null, "main: the door he guards has a shut leaf")
	# No text hangs in the house: no room names, terminal captions or signs —
	# only the King's own bar.
	var texts: Array = b.find_children("*", "Label3D", true, false).filter(func(l: Node) -> bool: return l.name != "HealthText")
	_check(texts.is_empty(), "main: no text in the house (%s)" % [texts.map(func(l: Node) -> String: return (l as Label3D).text)])
	# Every floor has its node; the stairwells' band between floors is closed.
	for f: Dictionary in house["floors"]:
		_check(b.get_node_or_null("Floor_%s" % f["id"]) != null and b.floor_shown(str(f["id"])), "main: floor node %s, drawn" % f["id"])
	for w: Dictionary in HouseGeometry.stair_wells(house):
		var wells := b.get_node_or_null("Floor_%s/Wells" % w["floor"]) as MeshInstance3D
		var aabb := wells.get_aabb() if wells != null else AABB()
		_check(wells != null and aabb.position.y < float(w["bottom"]) and aabb.end.y > float(w["top"]), "main: stairwell %s closed between %.2f and %.2f" % [w["stair"], w["bottom"], w["top"]])
	b.hide_floors(["top"])
	_check(not b.floor_shown("top") and b.floor_shown("main") and b.part("Terminal_%s" % house["terminals"][0]["id"]) != null, "main: a floor hides (the rest stay, parts still found)")
	b.hide_floors([])
	_check(b.floor_shown("top"), "main: … and comes back")
	_test_builder_geometry(b, house)
	_check(game.state() == GameFlow.State.LOBBY, "game: starts in the lobby")

	var player := game.player
	player.set_process(false)
	player.set_physics_process(false)
	player.read_input = false
	_check(player.global_position.distance_to(Lobby.SPOT) < 0.01, "game: the player waits in the lobby")
	game._process(0.016)
	_check(link.candidate_requests >= 1, "game: the lobby asks for candidates")

	# The picker: stick down to Bob, hold right for a second.
	# An unmarked program (Cal) is never offered (wave 16); Bob is marked.
	link.candidates_received.emit([{"id": "g-aaaaaa", "name": "Ada", "captured": true}, {"id": "g-cccccc", "name": "Cal", "captured": false, "restricted": false}, {"id": "g-bbbbbb", "name": "Bob", "captured": false, "restricted": true}])
	_check(game.lobby.picker.items.size() == 2 and str(game.lobby.picker.items[1]["id"]) == "g-bbbbbb", "game: the lobby offers only programs marked for reinstallation")
	# Wave 18 (C7): the tag reads the server's `marked`, not `restricted`.
	_check(Lobby.tag_of({"captured": true, "marked": false}) == "  [corrupted]", "lobby: a captured program is tagged corrupted")
	_check(Lobby.tag_of({"captured": false, "restricted": false, "eligible": true, "marked": true}) == "  [marked]", "lobby: marked (no restriction) is tagged marked")
	_check(Lobby.tag_of({"captured": false, "restricted": true, "eligible": false, "marked": false}) == "", "lobby: a director's hold that is no mark is not tagged marked")
	_check(Lobby.tag_of({"captured": false, "restricted": true, "eligible": true, "marked": false}) == "  [marked]", "lobby: a restricted program the server lets in is marked")
	_check(Lobby.tag_of({"captured": false, "restricted": true}) == "  [marked]", "lobby: an older server's restricted reads marked")
	_check(Lobby.tag_of({"captured": false}) == "", "lobby: a free program has no tag")
	_check(Lobby.tag_of({"captured": false, "restricted": false, "eligible": true, "marked": false, "favour": true}) == "  [party favour]", "lobby: after the end a program is tagged party favour, never marked")
	_check(Lobby.tag_of({"captured": true, "favour": true}) == "  [corrupted]", "lobby: a captured program stays corrupted after the end")
	player.left_stick = Vector2(0, -1)
	game._process(0.016)
	player.left_stick = Vector2.ZERO
	player.right_stick = Vector2(1, 0)
	for i in 30:
		game._process(1.0 / 60.0)
	_check(link.begun.is_empty(), "game: half a second is not a confirm")
	for i in 40:
		game._process(1.0 / 60.0)
	# Wave 19: the hold picks the tile, and a card asks first.
	_check(link.begun.is_empty() and game.lobby.view() == "confirm" and str(game.lobby.confirming().get("id", "")) == "g-bbbbbb", "game: hold right picks the highlighted program — the card asks first (%s)" % [link.begun])
	for i in 70:
		game._process(1.0 / 60.0)
	_check(link.begun.is_empty(), "game: the hold that opened the card never starts it")
	player.right_stick = Vector2.ZERO
	game._process(1.0 / 60.0)
	player.right_stick = Vector2(1, 0)
	for i in 70:
		game._process(1.0 / 60.0)
	_check(link.begun == ["g-bbbbbb"] and game.lobby.view() == "pick", "game: hold right again on START begins it (%s)" % [link.begun])
	game.start_test_level()
	_check(link.offline_chosen == 1 and link.begun.back() == "g-000001", "game: the test-level combo plays offline as the captured offline program (%s)" % [link.begun])
	player.right_stick = Vector2.ZERO
	game._process(1.0 / 60.0)

	# An assignment arrives: play.
	var a := _assignment(house, "s-1", true)
	link.assignment_received.emit(a)
	_check(game.state() == GameFlow.State.PLAYING and link.adopted.size() == 1, "game: an assignment starts play")
	_check(not game.in_intro() and not game.intro_space.visible and link.get("readies") == 0, "game: intro false goes straight to the house (no ready)")
	var spawn: Array = house["spawn"]["pos"]
	_check(_v3(player.feet(), HouseFrames.vec(spawn)), "game: the player spawns at the spawn (%s)" % player.feet())
	_check(_near(HouseFrames.wrap_yaw(player.head_yaw() - float(house["spawn"]["yaw"])), 0.0), "game: facing the spawn yaw")
	_check(game.duck.visible and _v3(game.duck.global_position, HouseFrames.vec(a["duck"]["pos"])), "game: the duck sits on its spot")
	game._process(0.016)
	_check(not link.poses.is_empty() and _diff(link.poses.back()["p"], spawn) == "", "game: poses go out as house-frame feet")
	_check(game.trail.count() > 0, "game: the golden trail is laid (%d chevrons)" % game.trail.count())
	# On a headset the route runs on a worker thread and lands a frame later.
	game._clear_trail()
	player.xr_active = true
	game.refresh_trail(spawn, a["duck"]["pos"])
	_check(game.trail.count() == 0, "game: a headset's trail route goes to a worker thread (not laid at once)")
	for i in 60:
		await process_frame
		if game.trail.count() > 0:
			break
	player.xr_active = false
	_check(game.trail.count() > 0, "game: … and is laid when it lands (%d chevrons)" % game.trail.count())
	_check(game.hud.big_text() == "" and game.hud.notice_text() == "" and game.hud.get("_room") == null, "game: walking, the HUD is clear (no room name, no hint)")
	_check(link.found_calls == 0, "game: no claim far from the duck")
	# The terminals' camera feeds are asked for while playing.
	var cam_calls: Array = []
	link.set("cams_base", "fixture://e/e1/api/spatial")
	game.cams.requester = func(url: String, token: String, done: Callable) -> void: cam_calls.append([url, token, done])
	game._process(0.016)
	_check(cam_calls.size() == 1 and cam_calls[0][0] == "fixture://e/e1/api/spatial/cams" and cam_calls[0][1] == link.cams_token(), "game: playing, the camera feeds are listed with the session's token (%s)" % [cam_calls])
	var all_spots: Array = house["terminals"].map(func(t: Dictionary) -> Dictionary: return {"spot": t["id"]})
	(cam_calls[0][2] as Callable).call(200, PackedStringArray(), JSON.stringify({"cams": all_spots}).to_utf8_buffer())


	# Walk up to the duck.
	var dp: Array = a["duck"]["pos"]
	player.teleport(Vector3(dp[0] + 0.5, dp[1], dp[2]), 0.0)
	game._process(0.016)
	game._process(0.016)
	_check(link.found_calls == 1, "game: within 0.9 m the duck is claimed once")
	link.found_answered.emit(false, {"error": "not near the duck"})
	_check(game.state() == GameFlow.State.PLAYING, "game: 'not near' keeps playing")
	game._process(0.5)
	_check(link.found_calls == 1, "game: waits before claiming again")
	game._process(0.6)
	_check(link.found_calls == 2, "game: claims again after the wait")
	link.found_answered.emit(true, {"ok": true, "released": true, "already": false})
	_check(game.state() == GameFlow.State.FOUND and game.hud.big_text() == "REINSTALLATION COMPLETE", "game: found → REINSTALLATION COMPLETE")
	_check(game.duck.is_flying() and game.trail.count() == 0, "game: the duck flies, the trail goes")
	game.duck._process(Duck.FLIGHT + 0.1)
	_check(not game.duck.body_shown(), "game: … and flies right out of sight")
	game._process(GameFlow.CELEBRATE + 0.1)
	_check(game.state() == GameFlow.State.LOBBY and link.ended == ["found"], "game: after the celebration the session ends → lobby")
	_check(game.cams.polling().is_empty(), "game: the session's end stops the camera feeds")
	link.set("cams_base", "")
	game.cams.requester = Callable()

	# Not captured: "YOU FOUND GERALD".
	link.assignment_received.emit(_assignment(house, "s-2", false))
	_check(game.duck.body_shown(), "game: the next walk's Gerald has his body back (wave 59: he kept the last flight's hidden model)")
	var dp2: Array = link.adopted.back()["duck"]["pos"]
	player.teleport(Vector3(dp2[0], dp2[1], dp2[2] + 0.3), 0.0)
	game._process(0.016)
	link.found_answered.emit(true, {"ok": true, "released": false, "already": false})
	_check(game.hud.big_text() == "YOU FOUND GERALD", "game: a free program finds Gerald")
	link.assignment_received.emit(_assignment(house, "s-x", true))
	_check(link.adopted.size() == 2, "game: no new assignment mid-celebration")
	game._process(GameFlow.CELEBRATE + 0.1)

	# Captured, and the find released nobody (the banishment): Gerald can't help.
	link.assignment_received.emit(_assignment(house, "s-2b", true))
	var dp2b: Array = link.adopted.back()["duck"]["pos"]
	player.teleport(Vector3(dp2b[0], dp2b[1], dp2b[2] + 0.3), 0.0)
	game._process(0.016)
	link.found_answered.emit(true, {"ok": true, "released": false, "already": false, "captured": true})
	_check(game.state() == GameFlow.State.FOUND and game.hud.big_text() == "GERALD CAN'T HELP", "game: a banished find is no reinstallation (%s)" % game.hud.big_text())
	_check(not game.duck.is_flying() and not game.flow.released, "game: … Gerald stays put, nothing released")
	game._process(GameFlow.CELEBRATE + 0.1)

	# Captured at the deal, freed mid-walk (the server says captured false): a plain find.
	link.assignment_received.emit(_assignment(house, "s-2c", true))
	var dp2c: Array = link.adopted.back()["duck"]["pos"]
	player.teleport(Vector3(dp2c[0], dp2c[1], dp2c[2] + 0.3), 0.0)
	game._process(0.016)
	link.found_answered.emit(true, {"ok": true, "released": false, "already": false, "captured": false})
	_check(game.hud.big_text() == "YOU FOUND GERALD", "game: freed mid-walk → YOU FOUND GERALD")
	game._process(GameFlow.CELEBRATE + 0.1)

	# The server ends a session.
	link.assignment_received.emit(_assignment(house, "s-3", true))
	_check(game.state() == GameFlow.State.PLAYING, "game: a third session")
	link.session_over.emit("reset")
	_check(game.state() == GameFlow.State.LOBBY, "game: the server's reset → lobby")

	# A map edit moves the duck mid-game; a doubtful map is said on the HUD.
	link.assignment_received.emit(_assignment(house, "s-3m", true))
	var was: String = str(game.flow.assignment["duck"]["id"])
	var moved: Dictionary = {}
	for spot: Dictionary in house["duck"]["spots"]:
		if str(spot["id"]) != was and float(spot["pos"][1]) == 0.0:
			moved = spot
			break
	link.duck_changed.emit(moved)
	_check(str(game.flow.assignment["duck"]["id"]) == str(moved["id"]) and _v3(game.duck.global_position, HouseFrames.vec(moved["pos"])), "game: a moved duck moves (%s → %s)" % [was, moved["id"]])
	var sub: Label3D = game.hud.get("_sub")
	_check(sub.text.begins_with("Gerald moved"), "game: … and the HUD says so (%s)" % sub.text)
	link.map_warning.emit("The event's map changed — reloading it…")
	_check(sub.text == "The event's map changed — reloading it…", "game: a doubtful map is said on the HUD")
	link.map_warning.emit("")
	_check(sub.text == "", "game: … and cleared once the event's map is in")
	link.session_over.emit("test")
	link.map_warning_text = "Couldn't load the event's map — the house may be wrong. Retrying…"
	link.assignment_received.emit(_assignment(house, "s-3w", true))
	_check(sub.text == link.map_warning_text, "game: a warning raised in the lobby shows when play starts")
	link.map_warning_text = ""
	link.duck_changed.emit(moved)
	var calls_before: int = link.found_calls
	var mp: Array = moved["pos"]
	player.teleport(Vector3(mp[0], mp[1], mp[2] + 0.3), 0.0)
	game._process(0.016)
	_check(link.found_calls == calls_before + 1, "game: the moved duck is the one claimed")
	link.session_over.emit("test")

	# A remap that leaves no floor where the player stands (the tent ↔ shed
	# switch: the shed is a solid prop on the tent map) puts them back at the
	# spawn; a remap where they still stand keeps them put.
	link.assignment_received.emit(_assignment(house, "s-3r", true))
	var kitchen := [-4.6, 0.0, 10.0]  # the Start Bar
	var blocked: Dictionary = house.duplicate(true)
	var crate: Dictionary = {}
	for pr: Dictionary in blocked["props"]:
		if HouseGeometry.prop_solid(pr) and str(pr.get("kind", "")) == "box":
			crate = pr.duplicate(true)
			break
	crate["id"] = "test-crate"
	crate["room"] = "start-bar"
	crate["pos"] = kitchen
	blocked["props"].append(crate)
	_check(not HouseLocate.standable(blocked, kitchen) and HouseLocate.standable(house, kitchen), "house: standable sees the crate")
	player.teleport(HouseFrames.vec(kitchen), 0.0)
	link.give_house(blocked)
	_check(_v3(player.feet(), HouseFrames.vec(spawn)), "game: a remap that buries the player puts them back at the spawn (%s)" % player.feet())
	_check(sub.text.begins_with("The house was remapped"), "game: … and the HUD says so (%s)" % sub.text)
	player.teleport(HouseFrames.vec(kitchen), 0.0)
	link.give_house(house)
	_check(_v3(player.feet(), HouseFrames.vec(kitchen)), "game: a remap where they still stand keeps them put")
	link.session_over.emit("test")

	await _test_game_king(game, link, house)

	# Headset off, on a wall clock (a sleeping Quest runs no frames). (wave
	# 40) Off holds the walk server-side; off past the grace offers a resume
	# in the lobby instead of ending it.
	game.clock = func() -> float: return _now
	link.assignment_received.emit(_assignment(house, "s-4", true))
	game.presence_changed(false)
	_check(link.suspends >= 1, "game: the headset coming off holds the walk (suspend)")
	_now += 1.0
	game._process(0.016)
	game.presence_changed(true)
	_now += 5.0
	game._process(0.016)
	_check(game.state() == GameFlow.State.PLAYING and game._resume_offer.is_empty(), "game: headset back within the grace keeps playing")
	var ended_at_doff: int = link.ended.size()
	game.presence_changed(false)
	_now += Game.PRESENCE_GRACE + 0.1
	game._process(0.016)
	_check(game.state() == GameFlow.State.LOBBY and link.ended.size() == ended_at_doff and not game._resume_offer.is_empty(), "game: headset off past the grace offers a resume (not ended)")

	# Yes (the hit button): the server gives the walk back, into the house at
	# the pose it kept.
	var spawn_pos: Array = house["spawn"]["pos"]
	var kept := [float(spawn_pos[0]) + 0.5, float(spawn_pos[1]), float(spawn_pos[2])]
	var resumes_before: int = link.resumes.size()
	_check(game.lobby.resuming(), "game: the lobby shows the resume card")
	game.lobby.press("resume:yes")  # point + trigger (or stick-pick) YES
	_check(link.resumes.size() == resumes_before + 1 and game._resume_offer.is_empty() and not game.lobby.resuming(), "game: Yes asks the server to resume")
	link.answer_resumed(_assignment(house, "s-4", true), {"p": kept, "yaw": 90.0, "pitch": 0.0}, true)
	_check(game.state() == GameFlow.State.PLAYING and not game.in_intro(), "game: a resumed walk is back in the house (intro done)")
	var feet_h := game.builder.to_house(game.player.feet())
	_check(absf(feet_h[0] - kept[0]) < 0.4 and absf(feet_h[2] - kept[2]) < 0.4, "game: … respawned at the kept pose (%s)" % [feet_h])
	link.session_over.emit("test")

	# No (the mute button): hand the headset off — end the walk, back to the lobby.
	link.assignment_received.emit(_assignment(house, "s-4b", true))
	game.presence_changed(false)
	_now += Game.PRESENCE_GRACE + 0.1
	game._process(0.016)
	_check(not game._resume_offer.is_empty() and game.lobby.resuming(), "game: … a held walk offers a resume")
	game.lobby.press("resume:no")  # NO: hand the headset off
	_check(game.state() == GameFlow.State.LOBBY and link.ended.back() == "handed off" and game._resume_offer.is_empty() and not game.lobby.resuming(), "game: No ends the walk (handed off)")

	# Focus coming back never cancels a headset-off countdown (then it offers a resume).
	link.assignment_received.emit(_assignment(house, "s-4c", true))
	game.presence_changed(false)
	_now += 1.0
	game.focus_changed(true)  # focus back, headset still off
	_now += 1.5
	game._process(0.016)
	_check(game.state() == GameFlow.State.LOBBY and not game._resume_offer.is_empty(), "game: focus coming back never cancels a headset-off countdown")
	game._resume_offer = {}
	game.lobby.clear_resume()

	link.assignment_received.emit(_assignment(house, "s-4d", true))
	game.focus_changed(false)
	_now += Game.UNFOCUSED_GRACE - 1.0
	game.focus_changed(true)
	game._process(0.016)
	_check(game.state() == GameFlow.State.PLAYING, "game: a system menu shorter than its grace keeps playing")
	game.app_paused()
	_now += 30.0
	game.app_resumed()
	_check(game.state() == GameFlow.State.LOBBY and not game._resume_offer.is_empty(), "game: resuming from a pause past the grace offers a resume")
	game._resume_offer = {}
	game.lobby.clear_resume()

	link.assignment_received.emit(_assignment(house, "s-4e", true))
	var ended_at_xr: int = link.ended.size()
	game.headset_gone()
	_check(game.state() == GameFlow.State.LOBBY and link.ended.size() == ended_at_xr and not game._resume_offer.is_empty(), "game: the XR session stopping leaves the house and offers a resume")
	# The grace elapsed under us: the server refuses, and the lobby moves on.
	game.lobby.press("resume:yes")
	link.resume_failed.emit()
	_check(game.state() == GameFlow.State.LOBBY and game._resume_offer.is_empty() and not game.lobby.resuming(), "game: a refused resume starts fresh")
	# The safety net: a body under the lobby's floor goes back on it.
	player.global_position = Lobby.SPOT - Vector3(0, 50, 0)
	game._process(0.016)
	_check(game.falls == 1 and absf(player.feet().y - Lobby.SPOT.y) < 0.01, "game: a fall through the lobby's floor is caught and put back (%.1f m)" % player.feet().y)
	game._process(0.016)
	_check(game.falls == 1, "game: … and standing on it is not a fall")

	# Sent while the headset is still off (a past deadline in the lobby): plays.
	game.presence_changed(false)
	_now += 10.0
	game._process(0.016)
	link.assignment_received.emit(_assignment(house, "s-4f", true))
	game._process(0.016)
	_check(game.state() == GameFlow.State.PLAYING, "game: a program sent while the headset is off plays once it goes on")
	game.presence_changed(true)
	_check(game.state() == GameFlow.State.PLAYING, "game: … and putting it on keeps it")
	link.session_over.emit("test")

	# Turning is smooth only (wave 33b) and closes the vignette fast.
	link.assignment_received.emit(_assignment(house, "s-4g", true))
	player.right_stick = Vector2.ZERO
	player.step(1.0 / 72.0)
	var yaw0 := player.head_yaw()
	player.right_stick = Vector2(1, 0)
	player.step(1.0 / 72.0)
	var step1 := HouseFrames.wrap_yaw(player.head_yaw() - yaw0)
	_check(step1 < 0.0 and step1 > -2.0, "player: a full push turns a little each frame, never a jump (%.2f°)" % step1)
	for i in 17:
		player.step(1.0 / 72.0)
	_check(_near(HouseFrames.wrap_yaw(player.head_yaw() - yaw0), -Locomotion.TURN_RATE * 0.25, 0.5) and player.vignette_strength() >= 0.8, "player: a quarter second of turning: %.0f°, the vignette closed (%.2f)" % [Locomotion.TURN_RATE * 0.25, player.vignette_strength()])
	player.right_stick = Vector2.ZERO
	for i in 72:
		player.step(1.0 / 72.0)
	_check(player.vignette_strength() < 0.05, "player: … and it opens again within a second (%.2f)" % player.vignette_strength())
	# A hitch (the first frame after a load) never jumps the view round.
	var yaw1 := player.head_yaw()
	player.right_stick = Vector2(1, 0)
	player._process(2.0)
	player.right_stick = Vector2.ZERO
	var jump := absf(HouseFrames.wrap_yaw(player.head_yaw() - yaw1))
	_check(_near(jump, Locomotion.TURN_RATE * VrPlayer.MAX_STEP, 0.1), "player: a 2 s frame turns one MAX_STEP at most (%.1f°)" % jump)
	# After a teleport the body waits two physics ticks (a floor built that
	# frame is not in the physics space yet), then walks every frame.
	player.teleport(player.feet(), player.head_yaw())
	var at := player.feet()
	player.left_stick = Vector2(0, 1)
	player._process(1.0 / 72.0)
	_check(player.feet().distance_to(at) < 1e-4, "player: after a teleport the body waits for the physics ticks")
	player._physics_process(1.0 / 72.0)
	player._physics_process(1.0 / 72.0)
	player._process(1.0 / 72.0)
	player.left_stick = Vector2.ZERO
	_check(player.feet().distance_to(at) > 0.01, "player: … then walks on a frame, no tick needed (%.3f m)" % player.feet().distance_to(at))
	# On a headset a frame near the display interval moves exactly one.
	var ticks := Engine.physics_ticks_per_second
	Engine.physics_ticks_per_second = 72
	player.xr_active = true
	_check(_near(player.frame_step(0.0131), 1.0 / 72.0, 1e-6) and _near(player.frame_step(0.0152), 1.0 / 72.0, 1e-6), "player: a headset frame near the interval moves exactly one interval")
	_check(_near(player.frame_step(0.03), 0.03, 1e-6) and _near(player.frame_step(0.5), VrPlayer.MAX_STEP, 1e-6), "player: … a long one moves its own time, at most MAX_STEP")
	player.xr_active = false
	Engine.physics_ticks_per_second = ticks
	_check(_near(player.frame_step(0.0131), 0.0131, 1e-6), "player: … the desktop rig moves the measured time")

	link.session_over.emit("test")

	# Ghosts from the stream (never ourselves).
	link.assignment_received.emit(_assignment(house, "s-5", true))
	link.stream_frame.emit("hello", {"eventId": "e", "houseVersion": "test", "players": [
		{"session": "other", "name": "Zed", "p": [0.0, 0.0, 1.0], "yaw": 0.0, "pitch": 0.0},
		{"session": "s-5", "name": "Ada", "p": [1.0, 0.0, 1.0], "yaw": 0.0, "pitch": 0.0},
	]})
	_check(game.ghosts.count() == 1 and game.ghosts.has("other"), "game: other players appear as ghosts, not us")
	link.stream_frame.emit("poses", {"t": 1, "players": [{"session": "other", "p": [2.0, 0.0, 1.0], "yaw": 90.0, "pitch": 0.0}]})
	link.stream_frame.emit("leave", {"session": "other", "reason": "ended"})
	_check(game.ghosts.count() == 0, "game: a leave removes the ghost")
	_test_swarm()
	_test_hand_swarm(game, link)
	_test_ghost_pictures(game, link)

	# Is-at-duck: plan radius 0.9 on the duck's own floor.
	var ground_duck := [0.5, 0.0, 4.25]
	_check(Game.is_at_duck(house, [1.3, 0.0, 4.25], ground_duck), "game: 0.8 m away on the floor is at the duck")
	_check(not Game.is_at_duck(house, [1.5, 0.0, 4.25], ground_duck), "game: 1.0 m away is not")
	_check(not Game.is_at_duck(house, [0.5, -2.7, 4.25], ground_duck), "game: right below, a floor down, is not")
	_check(Game.is_at_duck(house, [0.5, -1.0, 4.25], ground_duck), "game: 1.0 m below (another floor by y) is within the server's 1.2 m rise")
	_check(not Game.is_at_duck(house, [0.5, -1.4, 4.25], ground_duck), "game: 1.4 m below on another floor is not")
	_check(Game.is_at_duck(house, [0.5, 0.0, 4.25], [0.5, 1.9, 4.25]), "game: a shelf 1.9 m up on the same floor counts (the server's floor rule)")

	# The trail on a stair (the web game's trail.ts): the show's basement
	# stair, rect [−2.9, 6, −2, 10] rising north, foot (−2.45, −2.7, 10) in
	# the basement hall, head (−2.45, 0, 6) in the hall.
	var up_trail := Game.trail_path(house, [-2.45, -2.57, 9.8], [-1.2, 0.0, 11.5])
	_check(up_trail.size() > 2 and _near3(up_trail[1], [-2.45, 0.0, 6.0]), "game: just past the stair's foot, the trail points up the flight, not back at the foot")
	var down_trail := Game.trail_path(house, [-2.45, -0.13, 6.2], [-1.2, -2.7, 11.5])
	_check(down_trail.size() > 2 and _near3(down_trail[1], [-2.45, -2.7, 10.0]), "game: just past the head, it points down the flight")
	var flat_from := [-1.5, 0.0, 4.0]
	_check(Game.trail_path(house, flat_from, [-1.2, 0.0, 11.5]) == HouseRoute.route(house, flat_from, [-1.2, 0.0, 11.5]), "game: off the stairs the trail is the plain route")
	# On the ramp means on it, not merely over its rect: under the high end
	# (basement floor, the ramp 2.6 m overhead) the trail steps out of the
	# nearer side (x −2 + 0.35) before the route, never along the underside.
	_check(Game.stair_under(house, [-2.45, -1.35, 8.0]) != null, "game: half way up the ramp is on the stair")
	_check(Game.stair_under(house, [-2.43, -2.7, 6.2]) == null and Game.stair_above(house, [-2.43, -2.7, 6.2]) != null, "game: under the high end is under the stair, not on it")
	var under_trail := Game.trail_path(house, [-2.43, -2.7, 6.2], [-1.2, 0.0, 11.5])
	_check(under_trail.size() > 2 and _near3(under_trail[1], [-1.65, -2.7, 6.2]), "game: from under the stair the trail first steps out of its nearer side")

	main.queue_free()
	await process_frame


# --- the lobby's picker + setup (wave 19) -------------------------------------------


## The panel's pure geometry: the grid for a list, pages, hit mapping, the
## pointer's ray onto the panel, the beam's hand rule.
func _test_lobby_geometry() -> void:
	_check(LobbyTiles.layout(0)["pages"] == 0, "tiles: nothing to lay out")
	var l1 := LobbyTiles.layout(1)
	var l4 := LobbyTiles.layout(4)
	var l5 := LobbyTiles.layout(5)
	var l7 := LobbyTiles.layout(7)
	var l8 := LobbyTiles.layout(8)
	var l17 := LobbyTiles.layout(17)
	_check(l1["cols"] == 1 and l1["rows"] == 1 and l4["cols"] == 4 and l4["rows"] == 1, "tiles: up to 4 on one row")
	_check(l5["cols"] == 3 and l5["rows"] == 2 and l7["cols"] == 4 and l8["cols"] == 4 and l8["rows"] == 2 and l8["pages"] == 1, "tiles: 5–8 on two rows")
	_check(l17["cols"] == 4 and l17["per_page"] == 8 and l17["pages"] == 3, "tiles: past 8, pages of 4 × 2")
	_check(LobbyTiles.page_of(7, 8) == 0 and LobbyTiles.page_of(8, 8) == 1 and LobbyTiles.count_on_page(17, 2, 8) == 1 and LobbyTiles.count_on_page(17, 3, 8) == 0, "tiles: pages and what they hold")
	var a := LobbyTiles.tile_center(0, 4, 2)
	var d := LobbyTiles.tile_center(3, 4, 2)
	var e := LobbyTiles.tile_center(4, 4, 2)
	_check(_near(a.x, -d.x) and a.y > e.y and _near(a.x, e.x) and _near((a.y + e.y) / 2.0, LobbyTiles.GRID_Y), "tiles: the grid is centred, reading order")
	_check(LobbyTiles.slot_at(e, 4, 2, 8) == 4 and LobbyTiles.slot_at(e + Vector2(0.2, 0.25), 4, 2, 8) == 4, "tiles: a point on a tile is that tile")
	_check(LobbyTiles.slot_at((a + LobbyTiles.tile_center(1, 4, 2)) / 2.0, 4, 2, 8) == -1, "tiles: the gap between tiles is no tile")
	_check(LobbyTiles.slot_at(e, 4, 2, 4) == -1, "tiles: an empty slot on a short page is no tile")
	var buttons := [{"id": "a", "center": Vector2(0, 1), "size": Vector2(0.4, 0.2)}, {"id": "b", "center": Vector2(0.1, 1), "size": Vector2(0.2, 0.2)}]
	_check(LobbyTiles.button_at(Vector2(0.1, 1.05), buttons) == "b" and LobbyTiles.button_at(Vector2(-0.15, 1), buttons) == "a" and LobbyTiles.button_at(Vector2(0, 2), buttons) == "", "tiles: the button under a point (the last drawn wins)")

	var panel := Transform3D(Basis.IDENTITY, Vector3(0, 400, -2.4))
	var eye := Vector3(0, 401.6, 0)
	var target := panel * Vector3(e.x, e.y, 0)
	var h := LobbyTiles.ray_to_panel(eye, target - eye, panel)
	_check(not h.is_empty() and (h["point"] as Vector2).distance_to(e) < 1e-4 and _near(float(h["distance"]), eye.distance_to(target)), "pointer: a ray onto the panel lands in panel coordinates (%s)" % [h])
	_check(LobbyTiles.ray_to_panel(eye, Vector3(0, 0, 1), panel).is_empty(), "pointer: a ray away from the panel misses")
	_check(LobbyTiles.ray_to_panel(eye, Vector3(1, 0, 0), panel).is_empty(), "pointer: a ray along the panel misses")
	_check(LobbyTiles.ray_to_panel(Vector3(0, 401.6, -3.0), Vector3(0, 0, -1), panel).is_empty(), "pointer: from behind the panel, nothing")
	var turned := Transform3D(Basis(Vector3.UP, PI / 2.0), Vector3(1, 400, 0))
	var side := LobbyTiles.ray_to_panel(Vector3(3, 401.5, -0.3), Vector3(-1, 0, 0), turned)
	_check(not side.is_empty() and _near((side["point"] as Vector2).y, 1.5) and _near((side["point"] as Vector2).x, 0.3), "pointer: a turned panel maps through its own frame (%s)" % [side])

	var rest := Transform3D.IDENTITY
	# Moving is a rate, never a distance since the last switch: drift (a few
	# cm over seconds) never counts, a flick does.
	_check(not LobbyPointer.moving(rest, rest.translated(Vector3(0.001, 0, 0)), 1.0 / 72.0), "pointer: a hand drifting 1 mm a frame is not moving")
	_check(LobbyPointer.moving(rest, rest.translated(Vector3(0.01, 0, 0)), 1.0 / 72.0), "pointer: … 1 cm a frame (0.7 m/s) is")
	_check(LobbyPointer.moving(rest, Transform3D(Basis(Vector3.UP, deg_to_rad(1.0)), Vector3.ZERO), 1.0 / 72.0) and not LobbyPointer.moving(rest, Transform3D(Basis(Vector3.UP, deg_to_rad(0.2)), Vector3.ZERO), 1.0 / 72.0), "pointer: … or turning 72°/s, not 14°/s")
	var drift := rest
	var drifted := false
	for i in 72 * 4:  # 4 s of 1 cm/s drift, 4 cm in all
		var next := drift.translated(Vector3(0.01 / 72.0, 0, 0))
		drifted = drifted or LobbyPointer.moving(drift, next, 1.0 / 72.0)
		drift = next
	_check(not drifted, "pointer: slow drift never takes the beam, however far it goes")
	_check(LobbyPointer.takes_beam(false, LobbyPointer.MOVE_FOR, false) and not LobbyPointer.takes_beam(false, 0.05, false), "pointer: the idle hand takes the beam after moving MOVE_FOR s")
	_check(LobbyPointer.takes_beam(true, 0.0, false), "pointer: … or by a fresh trigger pull")
	_check(not LobbyPointer.takes_beam(true, 1.0, true), "pointer: … never while the beam hand's trigger is held (a ⚙ hold)")
	_check(LobbyPointer.trigger_down(false, 0.9, false) and not LobbyPointer.trigger_down(false, 0.6, false) and LobbyPointer.trigger_down(true, 0.6, false) and not LobbyPointer.trigger_down(true, 0.3, false) and LobbyPointer.trigger_down(false, 0.0, true), "pointer: the trigger with hysteresis (a click is a pull)")


## The tiles' and the SET UP panel's pure helpers.
func _test_lobby_pure() -> void:
	_check(Lobby.initials_of("MS Paint") == "MP" and Lobby.initials_of("Excel") == "E" and Lobby.initials_of("") == "?", "lobby: initials for a tile with no picture")
	_check(Lobby.tile_name({"name": "Microsoft Internet Explorer 6"}).length() == Lobby.NAME_CHARS and Lobby.tile_name({"id": "g-1"}) == "g-1", "lobby: long names are cut on their tile")
	_check(SetupPanel.code_text("K7P") == "PASSCODE  K7P···" and SetupPanel.code_char("k") == "K" and SetupPanel.code_char("!") == "" and SetupPanel.code_char("0") == "0", "setup: the passcode field + what a key may type")
	_check(SetupPanel.key_ids().size() == SetupPanel.ALPHABET.length() + 2 and SetupPanel.key_center(0).y > SetupPanel.key_center(SetupPanel.KEYS_PER_ROW).y, "setup: the keyboard is the passcode alphabet, ⌫ and SPACE, in rows")
	var probe := HouseLook.label("", 0.05)
	Lobby.fit(probe, "START", 1.0, 0.05)
	var short_px := probe.pixel_size
	Lobby.fit(probe, "This computer · 127.0.0.1:7000", 0.4, 0.05)
	var w := ThemeDB.fallback_font.get_string_size(probe.text, HORIZONTAL_ALIGNMENT_LEFT, -1, probe.font_size).x * probe.pixel_size
	_check(_near(short_px, 0.05 / 64.0, 1e-6) and w <= 0.4 + 1e-4 and probe.pixel_size < short_px, "lobby: a label keeps its height, or shrinks to fit (%.3f m)" % w)
	probe.free()
	var servers := SetupPanel.server_slots(2)
	_check(servers.size() == 2 and _near(servers[0]["center"].x, -servers[1]["center"].x), "setup: the server buttons side by side")


## A ServerLink with no passcode: try a setup over the fake transport (every
## refusal answers the panel and stays unconfigured; a working one is saved
## and links), forget it, play offline.
func _test_server_link_setup() -> void:
	var sl: LinkBase = load("res://net/server_link.gd").new()
	var tr: Variant = preload("res://test/fake_transport.gd").new()
	sl.set("transport", tr)
	sl.set("stream", SseClient.new())
	var path := "user://config-test/setup-link.json"
	StationConfig.forget_user(path)
	sl.set("user_path", path)
	sl.set("base_files", [StationConfig.RES_PATH])
	sl.set("base_args", PackedStringArray())
	sl.set("station_salt", 0xabcd)
	sl.config = StationConfig.resolve([StationConfig.RES_PATH], PackedStringArray())
	_check(sl.needs_setup() and not sl.can_forget_setup(), "setup link: the committed placeholder needs a setup")
	_check(sl.default_station_name() == "Headset ABCD", "setup link: the default NAME carries the station id's hex (%s)" % sl.default_station_name())
	var choices := sl.server_choices()
	# An editor run naming no server tests against `pnpm dev`: this computer
	# first; any other run, the committed server first.
	var local_first := OS.has_feature("editor_runtime")
	var want_first := StationConfig.LOCAL_SERVER if local_first else "https://app.mapsandducks.com"
	var want_last := "https://app.mapsandducks.com" if local_first else StationConfig.LOCAL_SERVER
	_check(choices.size() == 2 and choices[0]["url"] == want_first and choices.back()["url"] == want_last, "setup link: the committed server and this computer, in the run's order (%s)" % [choices])
	var answers: Array = []
	sl.setup_answered.connect(func(ok: bool, m: String) -> void: answers.append([ok, m]))

	sl.try_setup("http://127.0.0.1:7000", " ", "x")
	_check(answers.back() == [false, "Type the moderator passcode."] and tr.calls.is_empty(), "setup link: no passcode, no call")
	sl.try_setup("http://127.0.0.1:7000", "k7pq3m", "Headset 3")
	_check(tr.log.back() == "POST /api/resolve-code" and tr.calls[0]["body"]["code"] == "K7PQ3M" and tr.base == "http://127.0.0.1:7000", "setup link: CONNECT resolves the typed passcode on the chosen server (%s)" % [tr.calls])
	sl.try_setup("http://127.0.0.1:7000", "K7PQ3M", "Headset 3")
	_check(tr.calls.size() == 1, "setup link: one try at a time")
	_check(sl.needs_setup(), "setup link: the SET UP panel stays up while a try is out")
	tr.answer("/api/resolve-code", 200, {"role": "event", "eventId": "e1"})
	_check(answers.back() == [false, "That isn't a moderator passcode."] and sl.needs_setup() and sl.get("phase") == "idle" and str(sl.config["code"]) == StationConfig.PLACEHOLDER_CODE, "setup link: a guest code is no moderator passcode — still unconfigured")
	_check(not FileAccess.file_exists(path) and sl.status == "Not configured — set this headset up.", "setup link: … nothing saved")
	sl.try_setup("http://127.0.0.1:7000", "K7PQ3M", "Headset 3")
	tr.answer("/api/resolve-code", 404, {"error": "no such code"})
	_check(answers.back() == [false, "No event on 127.0.0.1:7000 answers to that passcode."], "setup link: an unknown code names the server it asked (%s)" % [answers.back()])
	sl.try_setup("http://127.0.0.1:7000", "K7PQ3M", "Headset 3")
	tr.answer("/api/resolve-code", 0)
	_check(answers.back() == [false, "Can't reach the server."] and sl.get("phase") == "idle", "setup link: no answer → can't reach the server, no retry loop")
	sl.try_setup("http://127.0.0.1:7000", "K7PQ3M", "Headset 3")
	tr.answer("/api/resolve-code", 200, {"role": "mod", "eventId": "e1", "title": "The Show"})
	tr.answer("/api/mod/login", 401, {"error": "bad passcode"})
	_check(answers.back() == [false, "That isn't a moderator passcode."], "setup link: a refused login is no moderator passcode")

	sl.try_setup("http://127.0.0.1:7000", "K7PQ3M", "Headset 3")
	tr.answer("/api/resolve-code", 200, {"role": "mod", "eventId": "e1", "title": "The Show"})
	_check(tr.log.back() == "POST /e/e1/api/mod/login", "setup link: a moderator code logs in")
	tr.answer("/api/mod/login", 200, {"token": "mod-tok"})
	_check(answers.back() == [true, ""] and not sl.needs_setup() and sl.get("phase") == "ready", "setup link: a working passcode links (%s)" % [answers.back()])
	var saved := StationConfig.read_file(path)
	_check(saved.get("code") == "K7PQ3M" and saved.get("server") == "http://127.0.0.1:7000" and saved.get("name") == "Headset 3" and saved.get("station") == "vr-headset-3-abcd", "setup link: … and is saved to the user file (%s)" % [saved])
	_check(sl.station_name() == "Headset 3" and sl.status == "Connected to The Show." and tr.count("/api/mod/spatial/candidates") == 1, "setup link: … and carries on as if it booted with it")
	_check(StationConfig.read_file(StationConfig.RES_PATH).get("code") == StationConfig.PLACEHOLDER_CODE, "setup link: the committed res:// file is untouched")
	_check(sl.linked() and sl.default_station_name() == "Headset 3", "setup link: linked; the panel would start from its own name")

	# The passcode stops working (the staff codes rotated): no retry fixes
	# it — SET UP again, prefilled. A network blip still just retries.
	sl.reconnect()
	tr.answer("/api/resolve-code", 0)
	_check(sl.get("phase") == "waiting" and not sl.needs_setup(), "setup link: no answer on a configured station → retry, no SET UP")
	sl.reconnect()
	tr.answer("/api/resolve-code", 404, {"error": "no such code"})
	_check(sl.needs_setup() and sl.get("phase") == "idle" and not sl.linked() and str(sl.get("dead_code")) != "" and sl.status.ends_with("Set this headset up again."), "setup link: a 404 on a configured station → SET UP again (%s)" % sl.status)
	_check(sl.server_choices()[0]["url"] == "http://127.0.0.1:7000", "setup link: … its own server first")
	sl.try_setup("http://127.0.0.1:7000", "Q2W3E4", "Headset 3")
	tr.answer("/api/resolve-code", 200, {"role": "event", "eventId": "e1"})
	_check(sl.needs_setup(), "setup link: … a wrong new code keeps SET UP up")
	sl.try_setup("http://127.0.0.1:7000", "Q2W3E4", "Headset 3")
	tr.answer("/api/resolve-code", 200, {"role": "mod", "eventId": "e1", "title": "The Show"})
	tr.answer("/api/mod/login", 200, {"token": "mod-tok"})
	_check(not sl.needs_setup() and str(sl.get("dead_code")) == "" and StationConfig.read_file(path).get("code") == "Q2W3E4", "setup link: … the new code links and is saved")

	# A late answer from before a reconfigure is dropped.
	sl.try_setup("http://127.0.0.1:7000", "K7PQ3M", "Headset 3")  # linked: a fresh try
	sl.forget_setup()
	var before := answers.size()
	tr.answer("/api/resolve-code", 200, {"role": "mod", "eventId": "e9"})
	_check(answers.size() == before and str(sl.get("event_id")) == "", "setup link: an answer for an older setup is dropped")
	_check(not FileAccess.file_exists(path) and sl.needs_setup() and sl.status == "Not configured — set this headset up.", "setup link: ⚙ forget deletes the file — back to SET UP")

	sl.play_offline()
	_check(sl.is_offline() and not sl.needs_setup() and sl.can_forget_setup() and sl.status.begins_with("Offline"), "setup link: PLAY OFFLINE plays this run without a server")
	sl.forget_setup()
	_check(not sl.is_offline() and sl.needs_setup(), "setup link: … and ⚙ goes back to SET UP")
	_free_server_link(sl)


## main.tscn with a fake link: the tiles (pictures, names, tags, pages), the
## laser's hover and press, the card's START / BACK, the ⚙ hold, the copy.
func _test_lobby_picker() -> void:
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset", "intro": false})
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	var lobby := game.lobby
	var player := game.player
	player.set_process(false)
	player.set_physics_process(false)
	player.read_input = false
	var asked: Array = []
	game.ghosts.avatars.requester = func(url: String, done: Callable) -> void: asked.append([url, done])
	var title: Label3D = lobby.get("_title")
	var empty: Label3D = lobby.get("_empty")
	var station: Label3D = lobby.get("_station")
	var message: Label3D = lobby.get("_message")
	_check(title.text == "PICK YOUR PROGRAM" and empty.text == Lobby.EMPTY and station.text == "this headset: Test Headset", "lobby: PICK YOUR PROGRAM, nobody marked yet, this headset's name")
	_check(not title.text.contains("TABLET"), "lobby: no more scan-on-the-tablet")

	link.candidates_received.emit([
		{"id": "g-1", "name": "Excel", "captured": true, "eligible": true, "avatar": "aaaa"},
		{"id": "g-2", "name": "MS Paint", "eligible": true, "marked": true},
		{"id": "g-3", "name": "Clippy", "eligible": false},
		{"id": "g-4", "name": "Winamp", "eligible": true, "favour": true, "avatar": "bbbb"},
	])
	game._process(0.016)
	_check(lobby.picker.items.size() == 3 and empty.text == "" and lobby.picker.columns == 3, "lobby: a tile per marked program, one row (%d)" % lobby.picker.items.size())
	var t0 := lobby.tile_node(0)
	var t1 := lobby.tile_node(1)
	_check(t0 != null and t0.visible and (t0.get_node("Label") as Label3D).text == "Excel" and (t0.get_node("Tag") as Label3D).text == "[corrupted]", "lobby: a tile names its program and tags it")
	_check((t1.get_node("Initials") as Label3D).text == "MP" and not (t1.get_node("Picture") as Sprite3D).visible, "lobby: no picture → initials")
	_check(asked.size() == 2 and str(asked[0][0]) == "fixture://avatar/aaaa", "lobby: pictures are fetched through the ghosts' cache (%s)" % [asked.map(func(x: Array) -> String: return str(x[0]))])
	var img := Image.create(8, 8, false, Image.FORMAT_RGBA8)
	img.fill(Color(0.2, 0.6, 0.9))
	(asked[0][1] as Callable).call(true, PackedStringArray(["Content-Type: image/png"]), img.save_png_to_buffer())
	_check((t0.get_node("Picture") as Sprite3D).visible and (t0.get_node("Initials") as Label3D).text == "", "lobby: … and a tile wears its picture once it lands")
	_check(((t0.get_node("Ring") as Node3D).visible) and not (t1.get_node("Ring") as Node3D).visible, "lobby: the selection is ringed")

	# The laser: hover, then the trigger picks; BACK cancels; START begins.
	var eye := player.camera.global_position
	var aim_at := func(p: Vector2) -> Vector3: return lobby.panel_transform() * Vector3(p.x, p.y, 0.0) - eye
	var c2 := LobbyTiles.tile_center(2, 3, 1)
	game.pointer.inject(eye, aim_at.call(c2), false)
	game._process(0.016)
	_check(lobby.hovered() == "tile:2" and lobby.view() == "pick", "lobby: the laser hovers a tile")
	_check(not game.pointer.beam_visible(), "lobby: no beam on the desktop rig (the mouse has its cursor)")
	game.pointer.inject(eye, aim_at.call(c2), true)
	game._process(0.016)
	_check(lobby.view() == "confirm" and str(lobby.confirming().get("id")) == "g-4" and lobby.picker.index == 2, "lobby: the trigger on a tile asks about it")
	var card_text: Label3D = lobby.get("_card_text")
	_check(card_text.text == "Start as Winamp?", "lobby: Start as <name>? (%s)" % card_text.text)
	var card_initials: Label3D = lobby.get("_card_initials")
	var card_tag: Label3D = lobby.get("_card_tag")
	_check(card_initials.text == "W" and not (lobby.get("_card_picture") as Sprite3D).visible and card_tag.text == Lobby.tag_of(lobby.confirming()).strip_edges() and card_tag.text != "", "lobby: the card shows initials until the picture lands, and the tag (%s / %s)" % [card_initials.text, card_tag.text])
	var backdrop := (lobby.get("_panel") as Node3D).get_node_or_null("Backdrop") as MeshInstance3D
	_check(backdrop != null and backdrop.position.z < 0.0 and (backdrop.mesh as QuadMesh).size.x >= 2.6, "lobby: the panel has its own backdrop, behind the tiles (the posts never show through)")
	game.pointer.inject(eye, aim_at.call(Lobby.BACK_AT), true)
	game._process(0.016)
	_check(lobby.view() == "confirm", "lobby: a trigger still held from the tile presses nothing")
	game.pointer.inject(eye, aim_at.call(Lobby.BACK_AT), false)
	game._process(0.016)
	game.pointer.inject(eye, aim_at.call(Lobby.BACK_AT), true)
	game._process(0.016)
	_check(lobby.view() == "pick" and link.begun.is_empty(), "lobby: BACK cancels")
	game.pointer.inject(eye, aim_at.call(LobbyTiles.tile_center(1, 3, 1)), false)
	game._process(0.016)
	game.pointer.inject(eye, aim_at.call(LobbyTiles.tile_center(1, 3, 1)), true)
	game._process(0.016)
	game.pointer.inject(eye, aim_at.call(Lobby.START_AT), false)
	game._process(0.016)
	game.pointer.inject(eye, aim_at.call(Lobby.START_AT), true)
	game._process(0.016)
	game._process(0.016)
	_check(link.begun == ["g-2"] and lobby.view() == "pick", "lobby: START begins the program (%s)" % [link.begun])
	_check(message.text == "Starting MS Paint…", "lobby: … and says so (%s)" % message.text)
	game.pointer.inject(eye, Vector3(0, 0, 1), false)
	game._process(0.016)
	_check(lobby.hovered() == "", "lobby: pointing away hovers nothing")

	# The mouse (a click is a press on the button under the cursor) and the keys.
	lobby.press("tile:0")
	_check(lobby.view() == "confirm" and str(lobby.confirming().get("id")) == "g-1", "lobby: a click on a tile asks about it")
	var enter := InputEventKey.new()
	enter.pressed = true
	enter.keycode = KEY_BACKSPACE
	lobby._unhandled_input(enter)
	_check(lobby.view() == "pick", "lobby: Backspace backs out of the card")
	enter.keycode = KEY_ENTER
	lobby._unhandled_input(enter)
	lobby._unhandled_input(enter)
	game._process(0.016)
	_check(link.begun == ["g-2", "g-1"], "lobby: Enter picks, Enter starts (%s)" % [link.begun])

	# A program that leaves the list while its card is up: back to the tiles.
	lobby.press("tile:1")
	link.candidates_received.emit([{"id": "g-1", "name": "Excel", "captured": true, "eligible": true}])
	_check(lobby.view() == "pick" and lobby.confirming().is_empty(), "lobby: the card closes when its program is gone")
	link.begin_failed.emit("Nobody has that pass.")
	_check(message.text == "Nobody has that pass.", "lobby: a begin error still flashes")
	link.candidates_received.emit([])
	game._process(0.016)
	_check(empty.text == Lobby.EMPTY, "lobby: an empty list says nobody is marked yet")

	# Pages past 8: the stick walks across them, ◀ ▶ turn them.
	var many: Array = []
	for i in 11:
		many.append({"id": "g-%02d" % i, "name": "P%d" % i, "eligible": true})
	link.candidates_received.emit(many)
	_check(lobby.picker.columns == 4 and lobby.tile_node(0) != null and lobby.tile_node(8) == null, "lobby: 11 programs, a page of 4 × 2")
	link.set("saved_setup", true)
	link.status_changed.emit("Connected.")
	_check(_overlap(lobby.get("_buttons")) == "" and (lobby.get("_buttons") as Array).size() == 8 + 2 + 1 + 1, "lobby: a full page, ◀ ▶, the ⚙ and TEST MIC never overlap (%s)" % _overlap(lobby.get("_buttons")))
	link.set("saved_setup", false)
	link.status_changed.emit("Connected.")
	lobby.press("next")
	_check(lobby.picker.index == 8 and lobby.tile_node(8) != null and lobby.tile_node(0) == null and (lobby.get("_page_label") as Label3D).text == "page 2 / 2", "lobby: ▶ turns the page")
	lobby.press("next")
	_check(lobby.picker.index == 0, "lobby: … and wraps")
	player.left_stick = Vector2(0, -1)
	game._process(0.016)
	player.left_stick = Vector2.ZERO
	game._process(0.016)
	player.left_stick = Vector2(0, -1)
	game._process(0.016)
	player.left_stick = Vector2.ZERO
	game._process(0.016)
	_check(lobby.picker.index == 8 and lobby.tile_node(8) != null, "lobby: the stick walks a row down onto the next page (%d)" % lobby.picker.index)

	# The tablet's Send to headset lands whatever the view; back in the
	# lobby, the card it interrupted is gone.
	lobby.press("tile:1")
	link.give_house(_placeholder_house())
	lobby.flash("Starting Old News…", 3.0)
	link.assignment_received.emit(_assignment(game.builder.house, "s-tab", true))
	_check(game.state() == GameFlow.State.PLAYING and link.begun.size() == 2, "lobby: the tablet's program still lands with the card up")
	_check(game.hud.notice_text() == "", "lobby: … and the HUD is clear while playing")
	link.session_over.emit("over")
	_check(game.state() == GameFlow.State.LOBBY and lobby.view() == "pick" and lobby.confirming().is_empty(), "lobby: … and the lobby comes back to the tiles, no card")
	_check(game.hud.big_text() == "" and game.hud.notice_text() == "", "lobby: back from a session, no HUD line floats over the tiles")
	_check(message.text == "Session ended." and message.modulate == Lobby.MESSAGE_NEWS, "lobby: … the session's end is the lobby's own line, in place of a stale flash (%s)" % message.text)
	_check(Game.session_over_text("reset") == "The story restarted — session ended." and Game.session_over_text("event ended") == "The event is over." and Game.session_over_text("reconfigured") == "" and Game.session_over_text("headset") == "Session ended (headset).", "lobby: the session's end in words, never a bare code")
	link.begin_failed.emit("Nobody has that pass.")
	_check(message.modulate == Lobby.MESSAGE_ERROR, "lobby: a refused begin flashes red")

	# ⚙ only once there is a setup to forget; held 2 s it forgets it.
	_check(not (lobby.get("_gear") as Node3D).visible, "lobby: no ⚙ with nothing to forget")
	link.set("saved_setup", true)
	link.status_changed.emit("Connected.")
	_check((lobby.get("_gear") as Node3D).visible, "lobby: a saved setup shows the ⚙")
	game.pointer.inject(eye, aim_at.call(Lobby.GEAR_AT), true)
	for i in 60:
		game._process(1.0 / 60.0)
	_check(int(link.get("forgotten")) == 0 and lobby.forget_progress() > 0.4, "lobby: holding the ⚙ fills the bar")
	game.pointer.inject(eye, aim_at.call(Lobby.GEAR_AT), false)
	game._process(0.016)
	_check(lobby.forget_progress() == 0.0, "lobby: … letting go empties it")
	game.pointer.inject(eye, aim_at.call(Lobby.GEAR_AT), true)
	for i in 130:
		game._process(1.0 / 60.0)
	_check(int(link.get("forgotten")) == 1 and lobby.view() == "setup" and title.text == "SET UP THIS HEADSET", "lobby: two seconds on the ⚙ forget the setup — SET UP (%s)" % lobby.view())
	game.pointer.clear_injection()
	game.ghosts.avatars.requester = Callable()
	main.queue_free()
	await process_frame


## The SET UP panel on main.tscn with a fake link: the keyboard (laser and
## physical keys), the server choice, CONNECT's answers, PLAY OFFLINE.
func _test_setup_panel() -> void:
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Headset", "intro": false})
	link.set("unconfigured", true)
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	var lobby := game.lobby
	game.player.set_process(false)
	game.player.set_physics_process(false)
	game.player.read_input = false
	game._process(0.016)
	var panel := lobby.setup_panel()
	_check(lobby.view() == "setup" and panel.visible and not (lobby.get("_grid") as Node3D).visible, "setup: an unconfigured headset shows SET UP THIS HEADSET")
	_check(panel.choices.size() == 2 and panel.server_index == 0 and panel.station == "Headset", "setup: the link's servers, the first chosen; the name starts as Headset")
	_check(_overlap(panel.buttons()) == "", "setup: no two buttons overlap (%s)" % _overlap(panel.buttons()))
	var eye := game.player.camera.global_position
	var aim_at := func(p: Vector2) -> Vector3: return lobby.panel_transform() * Vector3(p.x, p.y, 0.0) - eye
	var tap := func(at: Vector2) -> void:
		game.pointer.inject(eye, aim_at.call(at), false)
		game._process(0.016)
		game.pointer.inject(eye, aim_at.call(at), true)
		game._process(0.016)
	var keys := SetupPanel.key_ids()
	for ch in "K7PQ":
		tap.call(SetupPanel.key_center(keys.find("key:" + ch)))
	_check(panel.code == "K7PQ" and lobby.hovered() == "key:Q", "setup: the laser types on the keyboard (%s)" % panel.code)
	tap.call(SetupPanel.key_center(keys.find("key:back")))
	_check(panel.code == "K7P", "setup: ⌫")
	var ev := InputEventKey.new()
	ev.pressed = true
	for ch in "q3m":
		ev.keycode = KEY_NONE
		ev.unicode = ch.unicode_at(0)
		lobby._unhandled_input(ev)
	_check(panel.code == "K7PQ3M", "setup: physical keys type too, upper-cased (%s)" % panel.code)
	tap.call(SetupPanel.server_slots(2)[1]["center"])
	_check(panel.server_index == 1, "setup: a server is chosen with the laser")
	tap.call(Vector2(0.46, SetupPanel.FIELD_Y))
	tap.call(SetupPanel.key_center(keys.find("key:space")))
	tap.call(SetupPanel.key_center(keys.find("key:2")))
	_check(panel.field == "name" and panel.station == "Headset 2", "setup: the name field takes the keys (%s)" % panel.station)
	tap.call(Vector2(-0.42, SetupPanel.ACTION_Y))
	var setups: Array = link.get("setups")
	_check(setups.size() == 1 and setups[0] == ["http://127.0.0.1:7000", "K7PQ3M", "Headset 2"] and panel.busy, "setup: CONNECT tries the chosen server, the passcode and the name (%s)" % [setups])
	_check((panel.get("_message") as Label3D).text == SetupPanel.CONNECTING and (panel.get("_message") as Label3D).modulate == Lobby.MESSAGE_NEWS, "setup: Connecting… is news, not an error")
	tap.call(Vector2(-0.42, SetupPanel.ACTION_Y))
	_check(setups.size() == 1, "setup: … once")
	link.call("answer_setup", false, "That isn't a moderator passcode.")
	var msg: Label3D = panel.get("_message")
	_check(not panel.busy and msg.text == "That isn't a moderator passcode." and lobby.view() == "setup" and panel.code == "K7PQ3M", "setup: a refusal says why and keeps the passcode")
	_check(msg.modulate == Lobby.MESSAGE_ERROR and not (lobby.get("_station") as Label3D).visible, "setup: a refusal is red; the old name stays off the heading (the NAME field says it)")
	ev.unicode = 0
	ev.keycode = KEY_ENTER
	lobby._unhandled_input(ev)
	_check(setups.size() == 2, "setup: Enter connects too")
	link.call("answer_setup", false, "Can't reach the server.")
	_check(msg.text == "Can't reach the server.", "setup: can't reach the server")
	tap.call(Vector2(-0.42, SetupPanel.ACTION_Y))
	link.call("answer_setup", true)
	game._process(0.016)
	_check(lobby.view() == "pick" and (lobby.get("_station") as Label3D).text == "this headset: Headset 2", "setup: a working passcode goes on to the tiles, named")
	_check((lobby.get("_gear") as Node3D).visible, "setup: … with the ⚙ to forget it")
	link.forget_setup()
	game._process(0.016)
	_check(lobby.view() == "setup", "setup: forgotten, it asks again")
	tap.call(Vector2(0.42, SetupPanel.ACTION_Y))
	game._process(0.016)
	_check(int(link.get("offline_chosen")) == 1 and lobby.view() == "pick", "setup: PLAY OFFLINE goes on to the tiles")
	game.pointer.clear_injection()
	main.queue_free()
	await process_frame


## Wave 26 (R8): the lobby's MICROPHONE box — the mic's state, TEST MIC
## with a level meter and no session (by the laser too), ASK AGAIN while the
## grant is missing or refused, the build stamp; its buttons never overlap
## the panel's in any view.
func _test_lobby_mic() -> void:
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset", "intro": false})
	link.house = _placeholder_house()
	link.house_version = "test"
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	var lobby := game.lobby
	var v := game.voice
	game.player.set_process(false)
	game.player.set_physics_process(false)
	game.player.read_input = false
	v.client_factory = func() -> Object: return FakeHttp.new()
	var mic := [PackedVector2Array()]
	v.frame_source = func() -> PackedVector2Array:
		var f: PackedVector2Array = mic[0]
		mic[0] = PackedVector2Array()
		return f
	game._process(0.016)
	_check(lobby.mic_text() == "MIC · this computer's microphone" and lobby.build_text() == "build dev", "lobby mic: the box says the mic and the build (%s · %s)" % [lobby.mic_text(), lobby.build_text()])
	var buttons: Array = lobby.get("_buttons")
	_check(buttons.any(func(b: Dictionary) -> bool: return b["id"] == "mic:test") and not buttons.any(func(b: Dictionary) -> bool: return b["id"] == "mic:ask"), "lobby mic: TEST MIC, no ASK AGAIN on a desktop")
	_check(_overlap(buttons) == "", "lobby mic: no button overlaps (%s)" % _overlap(buttons))
	# The laser on TEST MIC.
	var eye := game.player.camera.global_position
	var aim_at := func(p: Vector2) -> Vector3: return lobby.panel_transform() * Vector3(p.x, p.y, 0.0) - eye
	var tap := func(at: Vector2) -> void:
		game.pointer.inject(eye, aim_at.call(at), false)
		game._process(0.016)
		game.pointer.inject(eye, aim_at.call(at), true)
		game._process(0.016)
		game.pointer.inject(eye, aim_at.call(at), false)
		game._process(0.016)
	tap.call(Lobby.MIC_TEST_AT)
	_check(v.is_testing() and not v.is_running() and game.state() == GameFlow.State.LOBBY, "lobby mic: TEST MIC opens the mic with no session")
	mic[0] = _mic_tone(4800, 0.3)
	v._process(0.016)
	game._process(0.016)
	var fill := lobby.get("_mic_fill") as MeshInstance3D
	_check(lobby.mic_text() == "MIC TEST · it hears you" and fill.scale.x > 0.6, "lobby mic: a word lights the meter (%s, %.2f)" % [lobby.mic_text(), fill.scale.x])
	var test_label := ((lobby.get("_looks") as Dictionary)["mic:test"] as Node3D).get_node("Label") as Label3D
	_check(test_label.text == "STOP TEST", "lobby mic: … the button reads STOP TEST")
	tap.call(Lobby.MIC_TEST_AT)
	_check(not v.is_testing() and fill.scale.x < 0.01 and test_label.text == "TEST MIC", "lobby mic: STOP TEST closes it")
	lobby.press("mic:test")
	game._process(Game.MIC_TEST_LIMIT + 1.0)
	_check(not v.is_testing(), "lobby mic: a test left open closes itself after %d s" % int(Game.MIC_TEST_LIMIT))
	# A session takes the mic from a test.
	lobby.press("mic:test")
	link.set("voice_base", "http://127.0.0.1:7600/e/e1/api/spatial")
	link.assignment_received.emit(_assignment(link.house, "mic-1", true))
	game._process(0.016)
	_check(not v.is_testing() and v.is_running(), "lobby mic: a program starting ends the test")
	lobby.press("mic:test")
	_check(not v.is_testing(), "lobby mic: … and TEST MIC does nothing while playing")
	link.session_over.emit("test")
	link.set("voice_base", "")
	# No voice link (offline, no token yet): a program starting still ends it.
	lobby.press("mic:test")
	_check(v.is_testing(), "lobby mic: a test again, with no voice link")
	link.assignment_received.emit(_assignment(link.house, "mic-2", true))
	game._process(0.016)
	_check(game.state() == GameFlow.State.PLAYING and not v.is_testing() and not v.is_running() and v.mic_state == "off", "lobby mic: … and a program starting closes it (%s)" % v.mic_state)
	link.session_over.emit("test")
	# Android without the grant: ASK AGAIN, which asks.
	v.platform = "Android"
	var granted := [false]
	var asked := [0]
	v.permission_check = func() -> bool: return granted[0]
	v.permission_request = func() -> void: asked[0] += 1
	game._process(0.016)
	buttons = lobby.get("_buttons")
	_check(buttons.any(func(b: Dictionary) -> bool: return b["id"] == "mic:ask") and ((lobby.get("_looks") as Dictionary)["mic:ask"] as Node3D).visible, "lobby mic: no grant → ASK AGAIN")
	_check(_overlap(buttons) == "", "lobby mic: … overlapping nothing (%s)" % _overlap(buttons))
	var before: int = asked[0]
	tap.call(Lobby.MIC_ASK_AT)
	_check(asked[0] == before + 1 and lobby.mic_text() == "MIC · allow it in the headset's prompt", "lobby mic: ASK AGAIN asks (%s)" % lobby.mic_text())
	v._on_permission("android.permission.RECORD_AUDIO", false)
	game._process(0.016)
	_check(lobby.mic_text().begins_with("MIC · not allowed · ASK AGAIN"), "lobby mic: refused → says so, ASK AGAIN stays (%s)" % lobby.mic_text())
	granted[0] = true
	v._on_permission("android.permission.RECORD_AUDIO", true)
	game._process(0.016)
	buttons = lobby.get("_buttons")
	_check(lobby.mic_text() == "MIC · allowed" and not buttons.any(func(b: Dictionary) -> bool: return b["id"] == "mic:ask"), "lobby mic: granted → allowed, no ASK AGAIN")
	# The mic off in the config: said, no TEST MIC.
	link.config = StationConfig.merge(link.config, {"mic": false})
	game._process(0.016)
	buttons = lobby.get("_buttons")
	_check(lobby.mic_text() == "MIC · off on this headset (listen only)" and not buttons.any(func(b: Dictionary) -> bool: return b["id"] == "mic:test"), "lobby mic: --mic false → said, no TEST MIC")
	# The SET UP view keeps the box, overlapping none of its keys.
	link.config = StationConfig.merge(link.config, {"mic": true})
	link.set("unconfigured", true)
	game._process(0.016)
	buttons = lobby.get("_buttons")
	_check(lobby.view() == "setup" and buttons.any(func(b: Dictionary) -> bool: return b["id"] == "mic:test") and _overlap(buttons) == "", "lobby mic: the SET UP view keeps the box, overlapping no key (%s)" % _overlap(buttons))
	lobby.press("mic:test")
	_check(v.is_testing() and lobby.setup_panel().code == "", "lobby mic: … and TEST MIC works there, typing nothing")
	v.stop_test()
	game.pointer.clear_injection()
	main.queue_free()
	await process_frame


## The first two of `buttons` (`{id, center, size}`) whose rects overlap, as
## text, else "".
static func _overlap(buttons: Array) -> String:
	for i in buttons.size():
		for j in range(i + 1, buttons.size()):
			var a: Dictionary = buttons[i]
			var b: Dictionary = buttons[j]
			var d: Vector2 = (a["center"] - b["center"]).abs()
			var reach: Vector2 = (a["size"] + b["size"]) / 2.0
			if d.x < reach.x and d.y < reach.y:
				return "%s × %s" % [a["id"], b["id"]]
	return ""


# --- voice (wave 19) --------------------------------------------------------


## The codec, the resampler, the gate, the jitter plan and the routing rule
## against `@loom/house`'s vectors (`test/golden/voice-mulaw.json`).
func _test_voice_codec() -> void:
	var path := GOLDEN_DIR + "voice-mulaw.json"
	_check(FileAccess.file_exists(path), "voice: the codec's vectors are synced (pnpm --filter @loom/house sync)")
	if not FileAccess.file_exists(path):
		return
	var records: Array = _read_json(path)
	var house: Dictionary = _read_json("res://house/house.json")
	var bad := {}
	var seen := {}
	var players: Array = []
	var miss := func(kind: String, what: String) -> void:
		if not bad.has(kind):
			bad[kind] = []
		if (bad[kind] as Array).size() < SHOW_MISMATCHES:
			printerr("    voice %s: %s" % [kind, what])
		(bad[kind] as Array).append(what)
	for r: Dictionary in records:
		var kind := str(r["kind"])
		seen[kind] = int(seen.get(kind, 0)) + 1
		match kind:
			"constants":
				var consts: Dictionary = load("res://net/voice_codec.gd").get_script_constant_map()
				for k: String in r:
					if k != "kind" and (not consts.has(k) or consts[k] != r[k]):
						miss.call(kind, "%s = %s, want %s" % [k, consts.get(k, "missing"), r[k]])
			"encode":
				var got := VoiceCodec.mulaw_byte(float(r["x"]))
				if got != int(r["byte"]):
					miss.call(kind, "%s → %d, want %d" % [r["x"], got, r["byte"]])
			"decode":
				var got := VoiceCodec.mulaw_decode(PackedByteArray([int(r["byte"])]))[0]
				if got != float(r["x"]):
					miss.call(kind, "%d → %s, want %s" % [r["byte"], got, r["x"]])
			"rms":
				var got := VoiceCodec.rms_dbfs(PackedFloat32Array(r["samples"]))
				var want: float = -INF if r["dbfs"] == null else float(r["dbfs"])
				if not (got == want or _near(got, want, 1e-6)):
					miss.call(kind, "%s, want %s" % [got, want])
			"resample":
				var rs := VoiceCodec.Resampler.new(float(r["from"]), float(r["to"]))
				var input := PackedFloat32Array(r["input"])
				var out := PackedFloat32Array()
				var at := 0
				for n: Variant in r["chunks"]:
					out.append_array(rs.push(input.slice(at, at + int(n))))
					at += int(n)
				var want: Array = r["output"]
				var ok := out.size() == want.size()
				for i in mini(out.size(), want.size()):
					ok = ok and _near(out[i], float(want[i]), 1e-6)
				if not ok:
					miss.call(kind, "%s → %s: %d outputs, want %d" % [r["from"], r["to"], out.size(), want.size()])
			"gate":
				var g := VoiceCodec.Gate.new()
				var sent: Array = []
				var i := 0
				for s: Dictionary in r["steps"]:
					if s.has("hold"):
						g.hold_until(float(s["hold"]))
					if s.has("raise"):
						g.raise_until(float(s["raise"]), VoiceCodec.VOICE_BARGE_DBFS)
					sent.append_array(g.push(i, -INF if s["dbfs"] == null else float(s["dbfs"]), float(s["now"])))
					i += 1
				if sent != (r["sent"] as Array).map(func(v: Variant) -> int: return int(v)):
					miss.call(kind, "%s, want %s" % [sent, r["sent"]])
			"jitter":
				var p := VoiceCodec.jitter_plan(float(r["buffered"]), float(r["target"]), float(r["max"]))
				var w: Dictionary = r["plan"]
				if p["action"] != w["action"] or not _near(p["at"], w["at"], 1e-9) or not _near(p["drop"], w["drop"], 1e-9) or p["fadeIn"] != w["fadeIn"]:
					miss.call(kind, "%s → %s, want %s" % [r["buffered"], p, w])
			"voiceOn":
				if VoiceCodec.voice_on(house, str(r["spot"])) != bool(r["on"]):
					miss.call(kind, "%s" % r["spot"])
			"hearsTerminals":
				var got := VoiceCodec.hears_terminals(house, {"p": r["p"], "floor": r["floor"], "room": r["room"]})
				var located := VoiceCodec.hears_terminals(house, {"p": r["p"]})
				var want: Array = r["heard"]
				var same := got.size() == want.size() and located.size() == want.size()
				for i in mini(got.size(), want.size()):
					same = same and got[i]["spot"] == want[i]["spot"] and _near(got[i]["gain"], want[i]["gain"], 1e-9)
				if not same:
					miss.call(kind, "%s → %s, want %s" % [r["p"], got, want])
			"hearsRoom":
				# The presence room given (wave 26): the rule reads it, not the pose.
				var got := VoiceCodec.hears_terminals(house, {"p": r["p"], "room": r["room"]})
				var want: Array = r["heard"]
				var same := got.size() == want.size()
				for i in mini(got.size(), want.size()):
					same = same and got[i]["spot"] == want[i]["spot"] and _near(got[i]["gain"], want[i]["gain"], 1e-9)
				if not same:
					miss.call(kind, "%s in %s → %s, want %s" % [r["p"], r["room"], got, want])
			"tentOn":
				# The tent station is never linked (T3), even with its voice turned on.
				var on: Dictionary = house.duplicate(true)
				var room := ""
				for t: Dictionary in on["terminals"]:
					if str(t.get("view", "")) == "reinstall":
						t["voice"] = true
					if str(t["id"]) == str(r["spot"]):
						room = str(t["room"])
				var heard := VoiceCodec.hears_terminals(on, {"p": r["p"], "room": room})
				var hears := VoiceCodec.hears_players(on, str(r["spot"]), [{"session": "s-tent", "p": r["p"], "room": room}])
				if heard.size() != (r["heard"] as Array).size() or hears.size() != (r["players"] as Array).size() or not VoiceCodec.voice_on(on, str(r["spot"])):
					miss.call(kind, "%s → %s / %s, want %s / %s" % [r["spot"], heard, hears, r["heard"], r["players"]])
			"players":
				players = r["players"]
			"hearsPlayers":
				var got := VoiceCodec.hears_players(house, str(r["spot"]), players)
				var want: Array = r["heard"]
				var same := got.size() == want.size()
				for i in mini(got.size(), want.size()):
					same = same and got[i]["session"] == want[i]["session"] and _near(got[i]["gain"], want[i]["gain"], 1e-9)
				if not same:
					miss.call(kind, "%s → %s, want %s" % [r["spot"], got, want])
	for kind: String in ["constants", "encode", "decode", "rms", "resample", "gate", "jitter", "voiceOn", "hearsTerminals", "hearsRoom", "hearsPlayers", "tentOn"]:
		var n := int(seen.get(kind, 0))
		var b := (bad.get(kind, []) as Array).size()
		_check(n > 0 and b == 0, "voice: %s vectors match (%d of %d)" % [kind, n - b, n])
	_check(int(seen.get("decode", 0)) == 256, "voice: every μ-law byte decodes")
	_check(not players.is_empty(), "voice: the vectors carry the routing's players")
	# The tent (the spawn room) is off; the show map says so too.
	_check(not VoiceCodec.voice_on(house, "tent") and VoiceCodec.voice_on(house, "hall") and not VoiceCodec.voice_on(house, "nowhere"), "voice: the tent's terminal is off, the hall's on, an unknown spot off")
	var tent: Dictionary = VoiceCodec._spot_of(house, "tent").duplicate()
	tent.erase("voice")
	_check(not VoiceCodec.voice_on(house, tent), "voice: … off with no flag too: it stands in the spawn room")
	tent["voice"] = true
	_check(VoiceCodec.voice_on(house, tent), "voice: … unless the map says voice: true")

	# The encoder over a whole chunk = the per-sample byte; decode ∘ encode stays close.
	var chunk := PackedFloat32Array()
	for i in 320:
		chunk.append(0.6 * sin(TAU * 440.0 * i / 16000.0))
	var enc := VoiceCodec.mulaw_encode(chunk)
	var each := true
	for i in chunk.size():
		each = each and enc[i] == VoiceCodec.mulaw_byte(chunk[i])
	_check(enc.size() == 320 and each, "voice: mulaw_encode = mulaw_byte per sample")
	var dec := VoiceCodec.mulaw_decode(enc)
	var worst := 0.0
	for i in chunk.size():
		worst = maxf(worst, absf(dec[i] - chunk[i]))
	_check(worst < 0.02, "voice: decode(encode(x)) within μ-law's step (%.4f)" % worst)
	_check(VoiceCodec.mulaw_byte(NAN) == 0xff, "voice: NaN encodes as silence")

	# The resampler: any split is the whole; a 48 kHz second is 16 000 samples.
	var tone := PackedFloat32Array()
	for i in 48000:
		tone.append(sin(TAU * 300.0 * i / 48000.0))
	var whole := VoiceCodec.Resampler.new(48000, 16000).push(tone)
	var split := VoiceCodec.Resampler.new(48000, 16000)
	var parts := PackedFloat32Array()
	var at := 0
	for n in [1, 480, 7, 1023, 46489]:
		parts.append_array(split.push(tone.slice(at, at + n)))
		at += n
	_check(whole.size() == 16000 and parts == whole, "voice: the resampler's output does not depend on the chunking (%d)" % whole.size())
	var odd := VoiceCodec.Resampler.new(44100.4, 16000)
	_check(odd.from == 44100 and odd.to == 16000, "voice: rates round to whole Hz")

	# The chunker: 200 ms chunks, the remainder kept.
	var ca := VoiceCodec.ChunkAssembler.new()
	var got: Array = ca.push(whole.slice(0, 5000))
	_check(got.size() == 1 and (got[0] as PackedFloat32Array).size() == 3200 and ca.pending() == 1800, "voice: one 3200-sample chunk, 1800 held")
	got = ca.push(whole.slice(5000, 6400))
	_check(got.size() == 1 and (got[0] as PackedFloat32Array)[0] == whole[3200] and ca.pending() == 0, "voice: … the next chunk carries on where the last stopped")

	# The gate's half-duplex: a hold closes it and forgets the pre-roll.
	var gate := VoiceCodec.Gate.new()
	_check(gate.push("quiet", -60.0, 0.0).is_empty(), "voice: a quiet chunk is not sent (it is the pre-roll)")
	_check(gate.push("loud", -20.0, 200.0) == ["quiet", "loud"], "voice: a loud chunk opens the gate with the pre-roll")
	gate.hold_until(1000.0)
	gate.hold_until(500.0)
	_check(gate.holding(900.0) and not gate.holding(1000.0), "voice: a hold only ever extends")
	_check(gate.push("loud", -20.0, 600.0).is_empty() and not gate.is_open(), "voice: no sending while incoming voice plays")
	_check(gate.push("loud", -20.0, 1000.0) == ["loud"], "voice: … and no stale pre-roll after it")


## An [HTTPClient]-like for the voice uplink: the test moves its status.
class FakeHttp:
	extends RefCounted

	var status := HTTPClient.STATUS_DISCONNECTED
	var connects: Array = []
	## `[method, url, headers, body]` per request.
	var requests: Array = []
	var closed := 0
	var code := 0
	var body := PackedByteArray()

	func connect_to_host(host: String, port: int, tls: TLSOptions = null) -> int:
		connects.append([host, port, tls != null])
		status = HTTPClient.STATUS_CONNECTING
		return OK

	func poll() -> int:
		return OK

	func get_status() -> int:
		return status

	func request_raw(method: int, url: String, headers: PackedStringArray, b: PackedByteArray) -> int:
		requests.append([method, url, headers, b])
		status = HTTPClient.STATUS_REQUESTING
		return OK

	func get_response_code() -> int:
		return code

	func read_response_body_chunk() -> PackedByteArray:
		var b := body
		body = PackedByteArray()
		status = HTTPClient.STATUS_CONNECTED
		return b

	func close() -> void:
		closed += 1
		status = HTTPClient.STATUS_DISCONNECTED

	## The server answers the request in flight.
	func answer(c: int, data: Dictionary) -> void:
		code = c
		body = JSON.stringify(data).to_utf8_buffer()
		status = HTTPClient.STATUS_BODY


## An [AudioStreamGeneratorPlayback]-like: what was pushed, what is queued.
class FakePlayback:
	extends RefCounted

	var cap := 16383
	var queued := PackedVector2Array()
	var pushes: Array = []
	var clears := 0

	func get_frames_available() -> int:
		return cap - queued.size()

	func push_buffer(f: PackedVector2Array) -> bool:
		if f.size() > cap - queued.size():
			return false
		queued.append_array(f)
		pushes.append(f.size())
		return true

	func clear_buffer() -> void:
		queued.clear()
		clears += 1

	## The mixer plays `n` frames.
	func consume(n: int) -> void:
		queued = queued.slice(mini(n, queued.size()))


## `n` frames of a 300 Hz tone at amplitude `amp` (stereo, the mic's shape).
static func _mic_tone(n: int, amp: float, rate := 48000.0) -> PackedVector2Array:
	var out := PackedVector2Array()
	out.resize(n)
	for i in n:
		var x := amp * sin(TAU * 300.0 * i / rate)
		out[i] = Vector2(x, x)
	return out


## Every chunk the link has handed its uplink: posted (by body size),
## waiting, or dropped off the full queue.
static func _voice_given(v: VoiceLink, clients: Array) -> int:
	var n := v.uplink.queue.size() + v.uplink.dropped
	for cl: FakeHttp in clients:
		for r: Array in cl.requests:
			n += (r[3] as PackedByteArray).size() / VoiceCodec.VOICE_CHUNK_BYTES
	return n


## A `voice` frame from terminal `spot` carrying 200 ms of tone.
static func _voice_frame(spot: String, seq: int, gain: float) -> Dictionary:
	var chunk := PackedFloat32Array()
	for i in VoiceCodec.VOICE_CHUNK_BYTES:
		chunk.append(0.4 * sin(TAU * 300.0 * i / 16000.0))
	return {"from": "t:" + spot, "kind": "terminal", "spot": spot, "name": spot, "gain": gain, "seq": seq,
		"data": Marshalls.raw_to_base64(VoiceCodec.mulaw_encode(chunk))}


## The uplink alone: one keep-alive connection, one POST in flight, the
## queue capped, batches, `seq` up, reconnects.
func _test_voice_uplink() -> void:
	var up := VoiceLink.Uplink.new()
	var clients: Array = []
	up.client_factory = func() -> Object:
		var c := FakeHttp.new()
		clients.append(c)
		return c
	var answers: Array = []
	up.answered.connect(func(s: int, d: Dictionary) -> void: answers.append([s, d]))
	up.configure("https://show.example.com/loom/e/e1/api/spatial/voice", "tok")
	var chunk := PackedByteArray()
	chunk.resize(VoiceCodec.VOICE_CHUNK_BYTES)
	up.poll(0.016)
	_check(clients.is_empty(), "voice uplink: nothing to send, nobody listening → no connection")
	up.wanted = true
	up.poll(0.016)
	_check(clients.size() == 1 and clients[0].connects == [["show.example.com", 443, true]], "voice uplink: someone listens → one TLS connection, ahead of the first word (%s)" % [clients.map(func(c: FakeHttp) -> Array: return c.connects)])
	var c: FakeHttp = clients[0]
	up.send(chunk)
	up.poll(0.016)
	_check(c.requests.is_empty(), "voice uplink: nothing goes before the connection is up")
	c.status = HTTPClient.STATUS_CONNECTED
	up.poll(0.016)
	_check(c.requests.size() == 1 and c.requests[0][0] == HTTPClient.METHOD_POST and c.requests[0][1] == "/loom/e/e1/api/spatial/voice?seq=0", "voice uplink: a POST to …/voice?seq=0 (%s)" % [c.requests.map(func(r: Array) -> String: return r[1])])
	var h: PackedStringArray = c.requests[0][2]
	_check(h.has("x-loom-token: tok") and h.has("Content-Type: application/octet-stream") and (c.requests[0][3] as PackedByteArray).size() == 3200, "voice uplink: the token header, raw octets, one 3200-byte chunk")
	for i in 3:
		up.send(chunk)
	up.poll(0.016)
	up.poll(0.016)
	_check(c.requests.size() == 1 and up.in_flight(), "voice uplink: never two requests in flight")
	c.answer(200, {"ok": true, "listening": true})
	up.poll(0.016)
	up.poll(0.016)
	_check(answers.size() == 1 and answers[0][0] == 200 and answers[0][1].get("listening") == true, "voice uplink: the answer's listening comes back (%s)" % [answers])
	_check(c.requests.size() == 2 and c.requests[1][1].ends_with("?seq=1") and (c.requests[1][3] as PackedByteArray).size() == 6400, "voice uplink: the next POST batches two chunks, seq 1 (%d bytes)" % (c.requests[1][3] as PackedByteArray).size() if c.requests.size() == 2 else "voice uplink: a second POST")
	_check(clients.size() == 1, "voice uplink: … on the same connection")
	# Backpressure: past a second of chunks the oldest are dropped.
	var before := up.dropped
	for i in 9:
		up.send(chunk)
	_check(up.queue.size() == VoiceLink.UPLINK_QUEUE and up.dropped - before == 1 + 9 - VoiceLink.UPLINK_QUEUE, "voice uplink: at most %d chunks wait, the rest are dropped (%d dropped)" % [VoiceLink.UPLINK_QUEUE, up.dropped - before])
	# A request lost in flight: answered 0, a new connection after the backoff.
	c.status = HTTPClient.STATUS_CONNECTION_ERROR
	up.poll(0.016)
	_check(answers.back()[0] == 0 and not up.connected(), "voice uplink: a lost POST is answered 0 and the connection dropped")
	up.poll(0.1)
	_check(clients.size() == 1, "voice uplink: … backing off before reconnecting")
	up.poll(0.5)
	_check(clients.size() == 2, "voice uplink: … then a new connection")
	var c2: FakeHttp = clients[1]
	c2.status = HTTPClient.STATUS_CONNECTED
	up.poll(0.016)
	_check(c2.requests.size() == 1 and c2.requests[0][1].ends_with("?seq=2"), "voice uplink: seq keeps increasing over a reconnect")
	c2.answer(200, {"ok": true, "listening": true})
	up.poll(0.016)
	up.drop_queue()
	up.poll(0.016)
	# Idle past Node's keep-alive: the next POST goes on a fresh connection.
	for i in 5:
		up.poll(1.0)
	_check(clients.size() == 3 and c2.closed == 1, "voice uplink: a connection idle past %d s is replaced while someone listens" % int(VoiceLink.Uplink.IDLE_REOPEN))
	up.send(chunk)
	# The server closes an idle keep-alive: dropped quietly, reconnected at once.
	var c3: FakeHttp = clients[2]
	c3.status = HTTPClient.STATUS_CONNECTED
	up.poll(0.016)
	c3.answer(200, {"ok": true, "listening": true})
	up.poll(0.016)
	up.poll(0.016)
	c3.status = HTTPClient.STATUS_DISCONNECTED
	up.poll(0.016)
	up.send(chunk)
	up.poll(0.016)
	_check(clients.size() == 4 and answers.back()[0] == 200, "voice uplink: a keep-alive the server closed is reopened with no backoff and no lost answer")
	up.close()
	_check(not up.connected() and up.queue.is_empty(), "voice uplink: close drops the connection and the queue")


## The whole link with fakes: listen on / off, the gate, half-duplex, the
## voices under their terminals, the jitter plan, bye, a rebuild, mute, stop.
func _test_voice_link() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var b := HouseBuilder.new()
	root.add_child(b)
	b.build(house)
	var v := VoiceLink.new()
	v.builder = b
	v.use_stream = false
	var now := [1000.0]
	v.clock = func() -> float: return now[0]
	var clients: Array = []
	v.client_factory = func() -> Object:
		var c := FakeHttp.new()
		clients.append(c)
		return c
	var pbs := {}
	v.playback_of = func(e: Node) -> Object:
		if not pbs.has(e.get_instance_id()):
			pbs[e.get_instance_id()] = FakePlayback.new()
		return pbs[e.get_instance_id()]
	var mic := [PackedVector2Array()]
	v.frame_source = func() -> PackedVector2Array:
		var f: PackedVector2Array = mic[0]
		mic[0] = PackedVector2Array()
		return f
	v.source_rate = 48000.0
	root.add_child(v)
	var upload := "http://127.0.0.1:7600/e/e1/api/spatial/voice"
	v.want(upload + "/stream?token=tok", upload, "tok")
	_check(v.is_running() and v.mic_state == "opening" and not v.listen_on, "voice: running, the mic opening (no sample yet), nobody listening")
	# Zeros are no mic: still opening.
	mic[0] = _mic_tone(9600, 0.0)
	v._process(0.016)
	_check(v.mic_state == "opening", "voice: a block of zeros is no sample")

	# Nobody can hear us: a loud word goes nowhere, no connection.
	mic[0] = _mic_tone(9600, 0.3)
	v._process(0.016)
	_check(v.mic_state == "live", "voice: a real sample → live (%s)" % v.mic_state)
	_check(v.uplink.queue.is_empty() and clients.is_empty(), "voice: nobody listening → nothing queued, no connection")
	v.on_frame("hello", {"codec": "mulaw", "rate": 16000, "chunkMs": 200, "as": "player", "session": "s1", "listen": false})
	v.on_frame("listen", {"on": true})
	_check(v.listen_on, "voice: listen {on} → someone can hear us")
	mic[0] = _mic_tone(9600, 0.3)
	v._process(0.016)
	_check(clients.size() == 1 and v.uplink.queue.size() == 1, "voice: … a loud chunk is queued, the connection opening (%d queued)" % v.uplink.queue.size())
	(clients[0] as FakeHttp).status = HTTPClient.STATUS_CONNECTED
	v._process(0.016)
	var c: FakeHttp = clients[0]
	_check(c.requests.size() == 1 and c.requests[0][1] == "/e/e1/api/spatial/voice?seq=0", "voice: … and posted")
	var chunk_bytes: PackedByteArray = c.requests[0][3] if not c.requests.is_empty() else PackedByteArray()
	_check(chunk_bytes.size() == 3200 and VoiceCodec.rms_dbfs(VoiceCodec.mulaw_decode(chunk_bytes)) > -20.0, "voice: 200 ms of μ-law at 16 kHz from 48 kHz frames")
	c.answer(200, {"ok": true, "listening": true})
	v._process(0.016)
	v._process(0.016)
	# Silence past the hang: the gate closes, nothing more goes up.
	for i in 4:
		mic[0] = _mic_tone(9600, 0.0)
		now[0] += 200.0
		v._process(0.016)
	var queued_after_quiet: int = c.requests.size() + v.uplink.queue.size()
	for i in 3:
		mic[0] = _mic_tone(9600, 0.0)
		now[0] += 200.0
		v._process(0.016)
	_check(c.requests.size() + v.uplink.queue.size() == queued_after_quiet, "voice: the gate shuts after the hang — silence never goes up")

	# A terminal's voice: under Terminal_hall, at the server's gain, the
	# jitter target ahead of it, faded in.
	v.on_frame("voice", _voice_frame("hall", 1, 0.5))
	var e := b.part("Terminal_hall/Voice") as AudioStreamPlayer3D
	_check(e != null and b.voice_attached("hall") and v.sources() == ["t:hall"], "voice: a voice frame hangs an emitter under Terminal_hall")
	if e == null:
		v.stop()
		v.queue_free()
		b.queue_free()
		return
	_check(e.stream is AudioStreamGenerator and (e.stream as AudioStreamGenerator).mix_rate == 16000.0 and e.attenuation_model == AudioStreamPlayer3D.ATTENUATION_DISABLED, "voice: … a 16 kHz generator, attenuation off")
	_check(_near(e.volume_db, linear_to_db(0.5), 0.01), "voice: … its volume from the gain (%.2f dB)" % e.volume_db)
	var pb: FakePlayback = pbs[e.get_instance_id()]
	_check(pb.pushes == [6400] and pb.queued[3200 - 1] == Vector2.ZERO and absf(pb.queued[3200].x) < 0.001 and absf(pb.queued[3200 + 200].x) > 0.01, "voice: … 200 ms of silence, then the chunk faded in (%s)" % [pb.pushes])
	# D5b, the barge-in: while it plays (+ the tail) the gate is raised to
	# -28 dBFS — the room's echo (-35) stays home, a player speaking up goes.
	var sent := c.requests.size() + v.uplink.queue.size()
	mic[0] = _mic_tone(9600, 0.025)
	now[0] += 100.0
	v._process(0.016)
	_check(c.requests.size() + v.uplink.queue.size() == sent, "voice: an echo-level chunk while a voice plays here is not sent (the raised gate)")
	_check(v._gate.raised_at(now[0]) and not v._gate.holding(now[0]), "voice: … the gate is raised, not held")
	mic[0] = _mic_tone(9600, 0.3)
	now[0] += 100.0
	v._process(0.016)
	_check(c.requests.size() + v.uplink.queue.size() == sent + 1, "voice: a loud word over the playing voice is sent (barge-in), without the echo before it")
	sent = c.requests.size() + v.uplink.queue.size()
	v.on_frame("voice", _voice_frame("hall", 2, 0.5))
	_check(pb.pushes.size() == 2 and pb.pushes[1] == 3200 and pb.queued.size() == 9600, "voice: the next chunk queues behind (%s)" % [pb.pushes])
	v.on_frame("voice", _voice_frame("hall", 2, 0.5))
	_check(pb.pushes.size() == 2, "voice: a repeated seq is not played twice")
	# Over 400 ms queued: skip ahead to 200 ms.
	pb.consume(1000)
	v.on_frame("voice", _voice_frame("hall", 3, 0.5))
	_check(pb.clears == 1 and pb.queued.size() == 3200 + 3200, "voice: over 400 ms queued, the oldest is dropped down to 200 ms (%d frames queued)" % pb.queued.size())
	# The tent's terminal (voice off on the map) is never played; nor a player.
	v.on_frame("voice", _voice_frame("tent", 1, 1.0))
	var player_voice := _voice_frame("hall", 9, 1.0)
	player_voice["kind"] = "player"
	player_voice["from"] = "s:s2"
	player_voice.erase("spot")
	v.on_frame("voice", player_voice)
	_check(not b.voice_attached("tent") and v.sources() == ["t:hall"], "voice: the tent's terminal and other players are never played here")

	# After the raise the mic is sent again at the plain gate.
	now[0] += 2000.0
	mic[0] = _mic_tone(9600, 0.3)
	v._process(0.016)
	_check(c.requests.size() + v.uplink.queue.size() > sent, "voice: once the voice and its tail are over, the mic goes up again")
	# A faint, far terminal (gain 0.1) raises nothing: an echo-level word goes.
	for i in 4:
		mic[0] = _mic_tone(9600, 0.0)
		now[0] += 200.0
		v._process(0.016)
	sent = _voice_given(v, clients)
	v.on_frame("voice", _voice_frame("steam-room", 1, 0.1))
	_check(not v._gate.raised_at(float(now[0]) + 100.0), "voice: a voice under gain 0.2 raises no gate")
	mic[0] = _mic_tone(9600, 0.025)
	now[0] += 100.0
	v._process(0.016)
	_check(_voice_given(v, clients) > sent, "voice: … so a quiet word still goes up")
	v.on_frame("bye", {"from": "t:steam-room"})

	# A rebuild (a map edit): the emitter is re-made and the source carries on.
	b.build(house)
	var e2 := b.part("Terminal_hall/Voice") as AudioStreamPlayer3D
	_check(e2 != null and not is_same(e2, e) and v.sources() == ["t:hall"], "voice: a rebuilt house re-attaches the emitter")
	if e2 != null:
		var pb2: FakePlayback = pbs[e2.get_instance_id()]
		v.on_frame("voice", _voice_frame("hall", 4, 1.0))
		_check(pb2.pushes == [6400] and _near(e2.volume_db, 0.0, 0.01), "voice: … and plays the next chunk on it, from the start")
		# bye: faded out over 60 ms, forgotten.
		v.on_frame("bye", {"from": "t:hall"})
		_check(v.sources().is_empty() and pb2.queued.size() == VoiceLink.FADE_OUT_MS * 16 and pb2.queued[pb2.queued.size() - 1].length() < 0.001, "voice: bye fades the queued voice out and forgets the source (%d frames left)" % pb2.queued.size())

	# No mute: a guest is always heard while someone listens.
	_check(not v.has_method("toggle_mute") and not "muted" in v, "voice: no mute to press")
	# The server stops listening.
	v.on_frame("listen", {"on": false})
	_check(not v.listen_on and v.uplink.queue.is_empty(), "voice: listen {on: false} → nothing queued")
	# The same URLs again change nothing; stop ends everything.
	v.on_frame("voice", _voice_frame("hall", 5, 1.0))
	v.want(upload + "/stream?token=tok", upload, "tok")
	_check(v.sources() == ["t:hall"], "voice: want() with the same URLs keeps playing")
	# A lower seq is stale — until the source was quiet VOICE_FRESH_MS (the
	# server's rule: a terminal that started counting again).
	v.on_frame("voice", _voice_frame("hall", 3, 1.0))
	_check(int(v._sources["t:hall"]["seq"]) == 5, "voice: a lower seq right after is stale")
	now[0] += float(VoiceCodec.VOICE_FRESH_MS)
	v.on_frame("voice", _voice_frame("hall", 3, 1.0))
	_check(int(v._sources["t:hall"]["seq"]) == 3, "voice: … after a quiet VOICE_FRESH_MS it plays")
	# A (re)connect's hello lets every voice go.
	v.on_frame("hello", {"codec": "mulaw", "rate": 16000, "chunkMs": 200, "as": "player", "session": "s1", "listen": false})
	_check(v.sources().is_empty(), "voice: a hello lets every voice it had go")
	v.stop()
	_check(not v.is_running() and v.sources().is_empty() and not b.voice_attached("hall") and v.mic_state == "off", "voice: stop ends the stream, the mic and every voice")
	# A server speaking another wire is not played.
	v.want(upload + "/stream?token=tok", upload, "tok")
	v.on_frame("hello", {"codec": "opus", "rate": 48000, "listen": false})
	v.on_frame("voice", _voice_frame("hall", 1, 1.0))
	_check(v.sources().is_empty(), "voice: a hello naming another codec / rate → nothing played")
	v.stop()
	# Listen-only: the mic off in the config never opens.
	v.mic_enabled = false
	v.want(upload + "/stream?token=tok", upload, "tok")
	v.on_frame("listen", {"on": true})
	mic[0] = _mic_tone(9600, 0.3)
	v._process(0.016)
	_check(v.mic_state == "off" and v.uplink.queue.is_empty(), "voice: --mic false listens only")
	v.on_frame("voice", _voice_frame("hall", 1, 1.0))
	_check(v.sources() == ["t:hall"], "voice: … and still hears the terminals")
	v.stop()
	v.queue_free()
	b.queue_free()


## A mic that only hands over zeros (missing, denied) never reads LIVE and
## wants no uplink; NO MIC after MIC_FALLBACK_AFTER; a real sample heals it.
func _test_voice_silent_mic() -> void:
	var v := VoiceLink.new()
	v.use_stream = false
	v.client_factory = func() -> Object: return FakeHttp.new()
	var mic := [PackedVector2Array()]
	v.frame_source = func() -> PackedVector2Array: return mic[0]
	root.add_child(v)
	var upload := "http://127.0.0.1:7600/e/e1/api/spatial/voice"
	v.want(upload + "/stream?token=tok", upload, "tok")
	v.on_frame("listen", {"on": true})
	mic[0] = _mic_tone(4800, 0.0)
	for i in 3:
		v._process(0.5)
	_check(v.mic_state == "opening" and not v.uplink.wanted, "voice: zeros for 1.5 s → still opening, no uplink wanted (%s)" % v.mic_state)
	v._process(1.0)
	_check(v.mic_state == "nomic" and not v.uplink.wanted, "voice: zeros past MIC_FALLBACK_AFTER → nomic")
	mic[0] = _mic_tone(4800, 0.01)
	v._process(0.016)
	_check(v.mic_state == "live" and v.uplink.wanted, "voice: … a real sample → LIVE, the uplink wanted")
	v.stop()
	v.queue_free()


## Wave 26 (R8): the mic says what to do — a refused grant is `denied`
## (not NO MIC), a press of B / Y while the mic is not open changes nothing,
## every state change logs a line, ASK AGAIN asks once more, the game's own
## sounds hold the mic shut ([method VoiceLink.hold_for]), and TEST MIC opens
## it with no session for a level meter.
func _test_voice_mic_states() -> void:
	var v := VoiceLink.new()
	v.use_stream = false
	v.client_factory = func() -> Object: return FakeHttp.new()
	var now := [5000.0]
	v.clock = func() -> float: return now[0]
	v.platform = "Android"
	var granted := [false]
	var asked := [0]
	v.permission_check = func() -> bool: return granted[0]
	v.permission_request = func() -> void: asked[0] += 1
	root.add_child(v)
	_check(v.permission_state() == "unknown" and v.lobby_text(true, true) == "MIC · not allowed yet · ASK AGAIN", "mic: never asked → the lobby says so (%s)" % v.lobby_text(true, true))
	_check(v.prime_permission(true) and asked[0] == 1 and v.permission_state() == "asking", "mic: the lobby asks for the grant once")
	_check(not v.prime_permission(true) and asked[0] == 1, "mic: … only once")
	v._on_permission("android.permission.RECORD_AUDIO", false)
	_check(v.permission_state() == "denied" and v.lobby_text(true, true).begins_with("MIC · not allowed · ASK AGAIN"), "mic: refused in the lobby → denied, ASK AGAIN (%s)" % v.lobby_text(true, true))
	var upload := "http://127.0.0.1:7600/e/e1/api/spatial/voice"
	v.want(upload + "/stream?token=tok", upload, "tok")
	_check(v.mic_state == "asking" and asked[0] == 2, "mic: a session without the grant asks again (%s)" % v.mic_state)
	v._on_permission("android.permission.RECORD_AUDIO", false)
	_check(v.mic_state == "denied", "mic: refused → denied, not nomic (%s)" % v.mic_state)
	_check(v.mic_log.any(func(l: String) -> bool: return l.begins_with("reinstall-vr: mic — denied") and l.contains("granted denied")), "mic: every state change logs a line (%s)" % [v.mic_log])
	_check(v.mic_log.any(func(l: String) -> bool: return l == "reinstall-vr: mic — RECORD_AUDIO refused"), "mic: … and every answer to the grant")
	v.stop()
	_check(v.ask_again() and asked[0] == 3 and v.permission_state() == "asking", "mic: ASK AGAIN asks once more")
	granted[0] = true
	v._on_permission("android.permission.RECORD_AUDIO", true)
	_check(v.permission_state() == "granted" and v.lobby_text(true, true) == "MIC · allowed" and not v.ask_again(), "mic: granted → allowed; ASK AGAIN has nothing to ask")
	_check(v.lobby_text(false, true) == "VOICE · off on this headset" and v.lobby_text(true, false) == "MIC · off on this headset (listen only)", "mic: the lobby says when the config turned voice or the mic off")
	v.platform = "macOS"
	_check(v.permission_state() == "n/a" and v.lobby_text(true, true) == "MIC · this computer's microphone" and not v.ask_again(), "mic: a desktop has no grant to ask for")
	# A desktop whose privacy settings refuse the input: the box says so,
	# during TEST MIC and after it.
	var activate := [ERR_UNAUTHORIZED]
	v.input_activate = func() -> Error: return activate[0]
	v.start_test()
	_check(v.mic_state == "denied" and v.lobby_text(true, true) == "MIC · not allowed on this computer", "mic: a refused desktop input reads as refused on TEST MIC (%s)" % v.lobby_text(true, true))
	v.stop_test()
	_check(v.lobby_text(true, true) == "MIC · not allowed on this computer", "mic: … and after the test (%s)" % v.lobby_text(true, true))
	v.input_activate = Callable()
	v.set("_input_refused", false)
	v.platform = "Android"

	# TEST MIC: open with no session, a level, nothing sent.
	var mic := [PackedVector2Array()]
	v.frame_source = func() -> PackedVector2Array:
		var f: PackedVector2Array = mic[0]
		mic[0] = PackedVector2Array()
		return f
	v.start_test()
	_check(v.is_testing() and v.mic_state == "opening" and v.lobby_text(true, true) == "MIC TEST · say something…", "test mic: opens with no session (%s)" % v.mic_state)
	mic[0] = _mic_tone(4800, 0.3)
	v._process(0.016)
	_check(v.mic_state == "live" and v.test_level() > 0.6 and v.lobby_text(true, true) == "MIC TEST · it hears you", "test mic: a word → live, the meter up (%.2f)" % v.test_level())
	_check(v.uplink.queue.is_empty() and not v.is_running(), "test mic: … and nothing is sent")
	for i in 15:
		mic[0] = _mic_tone(4800, 0.0)
		v._process(0.1)
	_check(v.test_level() < 0.2, "test mic: the meter falls back in the quiet (%.2f)" % v.test_level())
	v.stop_test()
	_check(not v.is_testing() and v.mic_state == "off" and v.test_level() == 0.0, "test mic: closed")
	v.start_test()
	for i in 25:
		mic[0] = _mic_tone(4800, 0.0)
		v._process(0.1)
	_check(v.mic_state == "nomic" and v.lobby_text(true, true) == "MIC TEST · only silence — no mic", "test mic: only zeros → no mic (%s)" % v.lobby_text(true, true))
	# A session starting ends the test.
	v.want(upload + "/stream?token=tok", upload, "tok")
	_check(not v.is_testing() and v.is_running() and v.mic_state == "opening", "test mic: a session takes the mic over")
	v.start_test()
	_check(not v.is_testing(), "test mic: … and no test while a session plays")

	# The game's own sound holds the mic shut for its span + the tail.
	v.on_frame("listen", {"on": true})
	mic[0] = _mic_tone(9600, 0.3)
	v._process(0.016)
	_check(v.mic_state == "live" and v.uplink.queue.size() == 1, "hold: a loud word goes up")
	for i in 4:
		mic[0] = _mic_tone(9600, 0.0)
		now[0] += 200.0
		v._process(0.016)
	v.uplink.drop_queue()
	v.hold_for(500.0)
	_check(v.holding(), "hold: hold_for holds the mic")
	mic[0] = _mic_tone(9600, 0.5)
	now[0] += 400.0
	v._process(0.016)
	_check(v.uplink.queue.is_empty(), "hold: even a loud chunk is not sent while the game plays a sound")
	now[0] += 300.0
	mic[0] = _mic_tone(9600, 0.5)
	v._process(0.016)
	_check(v.uplink.queue.is_empty() and v.holding(), "hold: … nor in the tail (VOICE_TAIL_MS)")
	now[0] += 200.0
	mic[0] = _mic_tone(9600, 0.5)
	v._process(0.016)
	_check(not v.holding() and v.uplink.queue.size() >= 1, "hold: after the sound and its tail the mic goes up again")
	v.hold_for(1000.0)
	v.hold_for(100.0)
	_check(v.holding() and v._gate.holding(now[0] + 1200.0), "hold: a shorter hold never cuts a longer one short")
	v.stop()
	v.queue_free()


## The voice config keys: on by default, `--mic false` / `--voice=0` turn them off.
func _test_voice_config() -> void:
	var d := StationConfig.defaults()
	_check(d.get("voice") == true and d.get("mic") == true, "voice config: voice and mic on by default")
	var o := StationConfig.parse_args(PackedStringArray(["--mic", "false", "--voice=0"]))
	_check(o.get("mic") == false and o.get("voice") == false, "voice config: --mic false, --voice=0")
	_check(StationConfig.merge(d, {"mic": false}).get("mic") == false, "voice config: a station file may turn the mic off")


## The game drives the link: on while a session plays (with the session's
## URLs), the mute button toggles the mic and the HUD shows it, the lobby
## stops it; `voice` off or no URLs (offline) never start it.
func _test_voice_game() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset", "intro": false})
	link.house = house
	link.house_version = "test"
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	var v := game.voice
	_check(v != null and not v.is_running(), "voice game: the link is there, off in the lobby")
	v.use_stream = false
	v.client_factory = func() -> Object: return FakeHttp.new()
	v.frame_source = func() -> PackedVector2Array: return _mic_tone(800, 0.001)  # a quiet room, under the gate
	var player := game.player
	player.set_process(false)
	player.set_physics_process(false)
	player.read_input = false

	# Offline (no voice URLs): playing starts no voice.
	link.assignment_received.emit(_assignment(house, "v-0", true))
	game._process(0.016)
	_check(game.state() == GameFlow.State.PLAYING and not v.is_running(), "voice game: no voice URLs (offline) → no voice")
	game.enter_lobby()

	link.set("voice_base", "http://127.0.0.1:7600/e/e1/api/spatial")
	link.assignment_received.emit(_assignment(house, "v-1", true))
	game._process(0.016)
	v._process(0.016)  # the mic's first real sample
	game._process(0.016)
	_check(v.is_running() and v.stream_url == "http://127.0.0.1:7600/e/e1/api/spatial/voice/stream?token=tok-v-1" and v.upload_url.ends_with("/api/spatial/voice"), "voice game: playing starts the voice on the session's token (%s)" % v.stream_url)
	_check(game.hud.notice_text() == "" and game.hud.big_text() == "", "voice game: no mic line on the HUD (a guest cannot mute)")
	v.on_frame("voice", _voice_frame("optical-drive", 1, 1.0))
	_check(game.builder.voice_attached("optical-drive"), "voice game: a terminal's voice hangs in the game's house")
	link.session_over.emit("reset")
	_check(game.state() == GameFlow.State.LOBBY and not v.is_running() and not game.builder.voice_attached("optical-drive"), "voice game: the lobby stops the voice and the emitters")

	# A hit held over from the lobby into play is not a press.
	player.hit_button = true
	for i in 3:
		game._process(0.016)
	link.assignment_received.emit(_assignment(house, "v-3", true))
	game._process(0.016)
	v._process(0.016)
	game._process(0.016)
	_check(v.is_running(), "voice game: a new program starts the voice again")
	player.hit_button = false
	game._process(0.016)
	game.enter_lobby()
	_check(not v.is_running() and game.lobby.visible and game.lobby.view() != "confirm", "voice game: back in the lobby the voice is off, the lobby reset")

	# The Android microphone dialog (mic "asking") pauses / unfocuses the app:
	# that ends no session. Taking the headset off still does.
	link.assignment_received.emit(_assignment(house, "v-4", true))
	game._process(0.016)
	v.mic_state = "asking"
	game.app_paused()
	game.focus_changed(false)
	_check(game.get("_away_until").is_empty(), "voice game: the mic dialog's pause / unfocus arms no away deadline")
	game.presence_changed(false)
	_check(game.get("_away_until").has("presence"), "voice game: … taking the headset off still does")
	game.presence_changed(true)
	game.app_resumed()
	game.focus_changed(true)
	v.mic_state = "live"
	game.enter_lobby()

	# `--voice false`: never started.
	link.config = StationConfig.merge(link.config, {"voice": false})
	link.assignment_received.emit(_assignment(house, "v-2", true))
	game._process(0.016)
	_check(game.state() == GameFlow.State.PLAYING and not v.is_running(), "voice game: voice off in the config → no voice")
	# A desktop run's mouse-look pitch from play never follows into the lobby.
	player.set("_pitch", -60.0)
	player.camera.rotation.x = deg_to_rad(-60.0)
	game.enter_lobby()
	_check(is_zero_approx(float(player.get("_pitch"))) and is_zero_approx(player.camera.rotation.x), "lobby: a desktop run is level again in the lobby (no captured mouse there to look up)")
	main.queue_free()
	await process_frame


## Wave 26 (R8): the game's own sounds — rendered once, never silent, never
## clipped, the web game's recipes' lengths; the quack's schedule is the web
## game's; they play on the Sfx bus.
func _test_sfx() -> void:
	var want_len := {"quack": 0.36, "fanfare": 1.8, "buzz": 0.47, "thud": 0.12, "scare": 1.6, "pickup": 0.5, "chime": 0.7, "hum": 2.0}
	for sound: String in want_len:
		var x := Sfx.samples_of(sound)
		var peak := 0.0
		for v in x:
			peak = maxf(peak, absf(v))
		_check(_near(x.size() / float(Sfx.RATE), want_len[sound], 0.01), "sfx: %s lasts %.2f s (%.3f)" % [sound, want_len[sound], x.size() / float(Sfx.RATE)])
		_check(peak <= 1.0 and VoiceCodec.rms_dbfs(x) > -40.0, "sfx: %s is heard and never clips (peak %.2f, %.1f dBFS)" % [sound, peak, VoiceCodec.rms_dbfs(x)])
	_check(Sfx.samples_of("nope").is_empty() and Sfx.length_ms("nope") == 0.0, "sfx: an unknown sound is nothing")
	var w := Sfx.stream_of("quack")
	_check(w.format == AudioStreamWAV.FORMAT_16_BITS and not w.stereo and w.mix_rate == Sfx.RATE and w.data.size() == Sfx.samples_of("quack").size() * 2, "sfx: a 16-bit mono WAV")
	_check(Sfx.stream_of("hum").loop_mode == AudioStreamWAV.LOOP_FORWARD and w.loop_mode == AudioStreamWAV.LOOP_DISABLED, "sfx: the hum loops, the quack does not")
	_check(is_same(Sfx.stream_of("quack"), w), "sfx: each sound is made once")
	var bus := Sfx.ensure_bus()
	_check(bus > 0 and AudioServer.get_bus_name(bus) == "Sfx" and AudioServer.get_bus_send(bus) == "Master" and Sfx.ensure_bus() == bus, "sfx: an Sfx bus into Master, made once")
	# The schedule: the web game's maybeQuack.
	var far := Sfx.quack_plan(7.1, 0.0, 0.5)
	_check(not far["quack"] and _near(far["next"], 1.5), "sfx: past 7 m no quack, a look again in 1.5 s")
	_check(not Sfx.quack_plan(2.0, 2.0, 0.5)["quack"] and Sfx.quack_plan(2.0, 1.9, 0.5)["quack"], "sfx: within 2 m of height only")
	var at := Sfx.quack_plan(0.0, 0.0, 0.0)
	var mid := Sfx.quack_plan(3.5, 0.0, 1.0)
	_check(at["quack"] and _near(at["volume"], 1.0) and _near(at["next"], 1.6), "sfx: on top of him: full volume, every 1.6 s")
	_check(_near(mid["volume"], 0.625) and _near(mid["next"], 1.6 + 1.6 + 0.9), "sfx: half way: 0.625, 1.6 + 1.6 + up to 0.9 s")
	_check(Sfx.QUACK_RANGE == 7.0 and Sfx.QUACK_FIRST == 2.5 and Sfx.FANFARE_AFTER == 0.65, "sfx: the web game's constants")


## Wave 26 (C6, C10): in-game speech — the shared pronunciation table
## (whole word, any case, longest first, never "Anti-Virus"), captions one
## at a time for their reading time with 700 ms between, the device voice
## saying the pronounced text while the caption shows the display text, the
## mic held while it speaks, captions alone with no device voice.
func _test_speech() -> void:
	var rows := Speech.table()
	_check(rows.size() == 2 and rows[0]["word"] == "Antiviruses", "speech: the table loads from config/pronounce.json, longest first (%s)" % [rows])
	_check(Speech.pronounce("The Antivirus is here.") == "The Anti Virus is here.", "speech: Antivirus → Anti Virus")
	_check(Speech.pronounce("antiviruses and ANTIVIRUS") == "Anti Viruses and Anti Virus", "speech: any case, the longest word first")
	_check(Speech.pronounce("Norton Anti-Virus") == "Norton Anti-Virus" and Speech.pronounce("Antivirusy") == "Antivirusy" and Speech.pronounce("MyAntivirus") == "MyAntivirus", "speech: whole words only")
	_check(Speech.pronounce("the Antivirus' rules, (Antivirus)") == "the Anti Virus' rules, (Anti Virus)", "speech: punctuation is a boundary (the possessive matches)")
	_check(Speech.pronounce("Antivirus", []) == "Antivirus" and Speech.parse_table("junk").is_empty(), "speech: no table, no change")
	_check(Speech.ascii_lower("İ ÀB Antivirus") == "İ Àb antivirus", "speech: case folds A–Z only, the length kept")
	_check(Speech.pronounce("İ Antivirus ÉANTIVIRUS") == "İ Anti Virus ÉAnti Virus", "speech: a non-ASCII letter never shifts what follows (and is a boundary)")
	_check(Speech.reading_ms("") == 900.0 and Speech.reading_ms("x".repeat(20)) == 1240.0 and Speech.reading_ms("x".repeat(500)) == 8000.0, "speech: the terminal's reading time")
	_check(Speech.pick_voice([{"id": "fr", "language": "fr-FR"}, {"id": "en1", "language": "en-US"}]) == "en1" and Speech.pick_voice([{"id": "de", "language": "de"}]) == "de" and Speech.pick_voice([]) == "", "speech: an English device voice first")

	var head := Node3D.new()
	root.add_child(head)
	var sp := Speech.new()
	sp.head = head
	var spoken: Array = []
	var held: Array = []
	var speaking := [false]
	var stopped := [0]
	var voice_list := [[]]
	sp.voices = func() -> Array: return voice_list[0]
	sp.speaker = func(text: String, id: String) -> void:
		spoken.append([text, id])
		speaking[0] = true
	sp.is_speaking = func() -> bool: return speaking[0]
	sp.stopper = func() -> void: stopped[0] += 1
	sp.hold = func(ms: float) -> void: held.append(ms)
	root.add_child(sp)
	sp.set_process(false)
	_check(ProjectSettings.get_setting("audio/general/text_to_speech", false) == true, "speech: project.godot turns text_to_speech on (tts_speak needs it)")
	_check(Speech.TTS_VOLUME == 100, "speech: the device voice speaks at full volume, not Godot's default 50")
	# No device voice: captions only.
	sp.say([{"from": "Trabolta", "text": "First line here."}, {"from": "Trabolta", "text": "  "}, {"from": "Trabolta", "text": "Second."}])
	sp.tick(0.0)
	var cap := head.get_node_or_null("HeadCaption") as Label3D
	_check(sp.caption_text() == "First line here." and cap != null and cap.text == "First line here." and not sp.on_prop() and spoken.is_empty() and held.is_empty(), "speech: no device voice → the caption alone, head-locked, nothing held")
	_check(not cap.text.contains("Trabolta"), "speech: the caption never names the speaker")
	sp.tick(0.8)
	_check(sp.caption_text() == "First line here.", "speech: … held for its reading time")
	sp.tick(0.2)
	_check(sp.caption_text() == "" and sp.busy(), "speech: … then 700 ms of nothing")
	sp.tick(0.6)
	_check(sp.caption_text() == "", "speech: … still the gap")
	sp.tick(0.15)
	sp.tick(0.0)
	_check(sp.caption_text() == "Second.", "speech: … then the next line (an empty one skipped)")
	var done := [false]
	sp.finished.connect(func() -> void: done[0] = true)
	sp.tick(1.0)
	sp.tick(0.8)
	_check(not sp.busy() and done[0] and cap.text == "", "speech: the queue runs dry")
	# A device voice: it says the pronounced text; the caption keeps the display text.
	voice_list[0] = [{"id": "v-en", "name": "Daniel", "language": "en-GB"}]
	sp.say([{"from": "Trabolta", "text": "The Antivirus is watching."}])
	sp.tick(0.0)
	_check(spoken == [["The Anti Virus is watching.", "v-en"]] and sp.caption_text() == "The Antivirus is watching.", "speech: the voice says Anti Virus, the caption says Antivirus (%s)" % [spoken])
	_check(not held.is_empty() and held[0] >= Speech.reading_ms("The Antivirus is watching."), "speech: the mic is held while he speaks")
	sp.tick(2.0)
	_check(sp.caption_text() != "", "speech: a voice still speaking past the reading time keeps the line")
	var holds := held.size()
	sp.tick(0.1)
	_check(held.size() > holds, "speech: … and keeps the mic held")
	speaking[0] = false
	sp.tick(0.1)
	_check(sp.caption_text() == "", "speech: the voice done → the line ends")
	sp.tick(1.0)
	# A stuck voice is cut.
	speaking[0] = false
	sp.say([{"from": "x", "text": "Stuck."}])
	sp.tick(0.0)
	speaking[0] = true
	sp.tick(Speech.reading_ms("Stuck.") / 1000.0 + Speech.STUCK_AFTER_MS / 1000.0 + 0.1)
	_check(sp.caption_text() == "" and stopped[0] >= 1, "speech: a voice stuck past its cap is stopped")
	# Over a prop: a billboard.
	var prop := Node3D.new()
	prop.set_meta("height", 1.7)
	root.add_child(prop)
	prop.global_position = Vector3(3, 0, 4)
	speaking[0] = false
	sp.say([{"from": "Trabolta", "text": "Over the heart."}], prop)
	sp.tick(1.0)
	sp.tick(0.0)
	var pc := sp.get_node("PropCaption") as Label3D
	_check(sp.on_prop() and pc.visible and pc.text == "Over the heart." and pc.global_position.distance_to(Vector3(3, 1.7 + Speech.BILLBOARD_LIFT, 4)) < 0.01 and cap.text == "", "speech: a prop's lines hang over it (%s)" % pc.global_position)
	sp.stop()
	_check(not sp.busy() and not pc.visible and sp.caption_text() == "", "speech: stop drops everything")
	prop.queue_free()
	sp.queue_free()
	head.queue_free()
	await process_frame


## The game plays them: the hum while playing, Gerald's quack on him (and
## the mic held while it plays), the find's quack + fanfare (none for a
## refused find), a buzz for "not near", the King's thud, nothing in the lobby.
func _test_sfx_game() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset", "intro": false})
	link.house = house
	link.house_version = "test"
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	var player := game.player
	player.set_process(false)
	player.set_physics_process(false)
	player.read_input = false
	link.config["trail_delay"] = 0.0
	var sfx := game.sfx
	_check(sfx != null and sfx.get_parent() == game and not sfx.hum_on(), "sfx game: the game has its sounds, quiet in the lobby")
	_check(game.duck.emitter != null and game.duck.emitter.bus == "Sfx" and game.duck.emitter.attenuation_model == AudioStreamPlayer3D.ATTENUATION_DISABLED, "sfx game: Gerald's quack comes from him, on the Sfx bus")
	sfx.log.clear()
	for i in 5:
		game._process(1.0)
	_check(sfx.log.is_empty(), "sfx game: no sound in the lobby")
	var a := _assignment(house, "sfx-1", true)
	link.assignment_received.emit(a)
	_check(sfx.hum_on(), "sfx game: the hum while playing")
	# R8: while a terminal listens (the mic may send) the hum pauses.
	game.voice.on_frame("listen", {"on": true})
	game._process(0.016)
	_check(game.voice.listen_on and not sfx.hum_on(), "sfx game: … paused while a terminal listens")
	game.voice.on_frame("listen", {"on": false})
	game._process(0.016)
	_check(sfx.hum_on(), "sfx game: … and back once nobody does")
	var dp: Array = a["duck"]["pos"]
	player.teleport(Vector3(dp[0] + 1.5, dp[1], dp[2]), 0.0)
	game._process(1.0)
	_check(sfx.log.is_empty(), "sfx game: the first quack waits 2.5 s")
	game._process(1.0)
	game._process(0.6)
	_check(sfx.log == ["quack"] and game.voice.holding(), "sfx game: 1.5 m from Gerald he quacks — and the mic is held while he does (%s)" % [sfx.log])
	var away: Array = house["spawn"]["pos"]
	for spot: Dictionary in house["duck"]["spots"]:
		if Vector2(float(spot["pos"][0]) - float(dp[0]), float(spot["pos"][2]) - float(dp[2])).length() > 9.0:
			away = spot["pos"]
			break
	player.teleport(HouseFrames.vec(away), 0.0)
	for i in 10:
		game._process(1.0)
	var far_quacks := sfx.log.count("quack")
	_check(far_quacks == 1, "sfx game: far from him, no quack (%d)" % far_quacks)
	player.teleport(Vector3(dp[0] + 0.5, dp[1], dp[2]), 0.0)
	game._process(0.016)
	link.found_answered.emit(false, {"error": "not near the duck"})
	_check(sfx.log.back() == "buzz", "sfx game: 'not near' buzzes")
	# A refusal streak buzzes once: the retries each second stay quiet, and
	# so does a pause, a parked session or a dropped request.
	var buzzes := sfx.log.count("buzz")
	for i in 5:
		game._process(1.0)
		link.found_answered.emit(false, {"error": "not near the duck"})
	_check(sfx.log.count("buzz") == buzzes, "sfx game: … once per approach, not every retry (%d)" % (sfx.log.count("buzz") - buzzes))
	player.teleport(HouseFrames.vec(away), 0.0)
	game._process(0.016)
	player.teleport(Vector3(dp[0] + 0.5, dp[1], dp[2]), 0.0)
	game._process(0.016)
	for answer: Dictionary in [{"error": "doors are closed"}, {"error": "this session has not started — send a pose first"}, {}]:
		link.found_answered.emit(false, answer)
	_check(sfx.log.count("buzz") == buzzes, "sfx game: closed doors, parked, a dropped request: no buzz")
	link.found_answered.emit(false, {"error": "not near the duck"})
	_check(sfx.log.count("buzz") == buzzes + 1, "sfx game: a new approach buzzes again")
	_check(Game.found_refusal_buzzes({"error": "not near the duck"}) and not Game.found_refusal_buzzes({"error": "doors are closed"}) and not Game.found_refusal_buzzes({}), "sfx game: which refusals buzz")
	link.found_answered.emit(true, {"ok": true, "released": true})
	_check(sfx.log.back() == "quack" and not sfx.hum_on(), "sfx game: the find quacks, the hum stops")
	game._process(0.5)
	_check(sfx.log.back() == "quack", "sfx game: … the fanfare waits 0.65 s")
	game._process(0.2)
	_check(sfx.log.back() == "fanfare", "sfx game: … then the fanfare")
	game._process(GameFlow.CELEBRATE + 0.1)
	_check(game.state() == GameFlow.State.LOBBY and not sfx.hum_on(), "sfx game: the lobby again, quiet")
	# A refused find (banishment): the quack, no fanfare.
	link.assignment_received.emit(_assignment(house, "sfx-2", true))
	var dp2: Array = link.adopted.back()["duck"]["pos"]
	player.teleport(Vector3(dp2[0], dp2[1], dp2[2] + 0.3), 0.0)
	game._process(0.016)
	sfx.log.clear()
	link.found_answered.emit(true, {"ok": true, "released": false, "captured": true})
	game._process(1.0)
	_check(sfx.log == ["quack"], "sfx game: a refused find has no fanfare (%s)" % [sfx.log])
	game._process(GameFlow.CELEBRATE + 0.1)
	# The King: a hit thuds, a refusal buzzes, his fall plays the fanfare.
	link.assignment_received.emit(_assignment(house, "sfx-3", true))
	link.give_king({"id": "cold-lock-king", "hp": 5, "max": 15, "fallen": false})
	sfx.log.clear()
	link.king_hit_answered.emit("ok", {})
	link.king_hit_answered.emit("not near", {})
	link.give_king({"id": "cold-lock-king", "hp": 0, "max": 15, "fallen": true})
	_check(sfx.log == ["thud", "buzz", "fanfare"], "sfx game: the King's hit, a refusal, his fall (%s)" % [sfx.log])
	link.session_over.emit("test")
	main.queue_free()
	await process_frame


## Wave 26 (R2): the golden trail is hidden for the walk's first minute
## (the HUD just says "find Gerald"), then a notice and the trail at once;
## "Gerald moved." names no arrows before it; a re-scan restarts the
## minute; the lobby and the found screen never count; the quack never
## waits for it. R3: the HUD never carries the King's health.
func _test_path_reveal() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset", "intro": false})
	link.house = house
	link.house_version = "test"
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	var player := game.player
	player.set_process(false)
	player.set_physics_process(false)
	player.read_input = false
	var sub: Label3D = game.hud.get("_sub")
	_check(_near(float(link.config["trail_delay"]), HouseRoute.PATH_REVEAL_MS / 1000.0), "reveal: a minute by default")
	for i in 30:
		game._process(1.0)  # the lobby never counts
	link.assignment_received.emit(_assignment(house, "rv-1", true))
	_check(game.trail.count() == 0 and not game.trail_revealed, "reveal: the walk starts with no trail")
	for i in 59:
		game._process(1.0)
	_check(game.trail.count() == 0 and not game.trail_revealed, "reveal: no trail after 59 s")
	var moved: Dictionary = {}
	for spot: Dictionary in house["duck"]["spots"]:
		if str(spot["id"]) != str(game.flow.assignment["duck"]["id"]):
			moved = spot
			break
	link.duck_changed.emit(moved)
	_check(sub.text == "Gerald moved.", "reveal: before the trail, 'Gerald moved.' names no arrows (%s)" % sub.text)
	game._process(0.5)
	game._process(0.6)
	_check(game.trail_revealed and game.trail.count() > 0 and sub.text == "A golden trail flickers on.", "reveal: after a minute the trail draws at once, with a notice (%d chevrons, %s)" % [game.trail.count(), sub.text])
	link.duck_changed.emit(moved.duplicate())
	_check(sub.text == "Gerald moved — follow the arrows.", "reveal: after it, the old line (%s)" % sub.text)
	# R3: whatever the King, the HUD carries no health.
	link.give_king({"id": "cold-lock-king", "hp": 7, "max": 15, "fallen": false})
	game._process(0.1)
	var hud_texts: Array = [sub.text, game.hud.big_text()]
	_check(not hud_texts.any(func(t: String) -> bool: return t.contains("KING") or t.contains("/ 15") or t.contains("7")), "R3: the HUD never carries the King's health (%s)" % [hud_texts])
	var bar := game.builder.part("Prop_cold-lock-king/Health/HealthText") as Label3D
	_check(bar != null and bar.text == "THE KING  7 / 15", "R3: … it hangs over him (%s)" % (bar.text if bar != null else "none"))
	# A re-scan restarts the minute.
	link.session_over.emit("test")
	link.assignment_received.emit(_assignment(house, "rv-2", true))
	game._process(1.0)
	_check(game.trail.count() == 0 and not game.trail_revealed, "reveal: a re-scan restarts the minute")
	# The quack does not wait for the trail.
	var dp: Array = game.flow.assignment["duck"]["pos"]
	player.teleport(Vector3(dp[0] + 1.5, dp[1], dp[2]), 0.0)
	game.sfx.log.clear()
	game._process(1.0)
	game._process(1.0)
	_check(game.sfx.log.has("quack") and not game.trail_revealed, "reveal: Gerald quacks before the trail is up")
	# The found screen never counts.
	player.teleport(Vector3(dp[0] + 0.3, dp[1], dp[2]), 0.0)
	game._process(0.016)
	link.found_answered.emit(true, {"ok": true, "released": true})
	game._process(GameFlow.CELEBRATE - 0.1)
	_check(game.state() == GameFlow.State.FOUND and float(game.get("_played_for")) < 4.0, "reveal: the found screen never counts")
	game._process(0.5)
	# `trail_delay 0` (dev, tests): the trail at once, no notice.
	link.config["trail_delay"] = 0.0
	link.assignment_received.emit(_assignment(house, "rv-3", true))
	game._process(0.016)
	_check(game.trail_revealed and game.trail.count() > 0 and sub.text != "A golden trail flickers on.", "reveal: trail_delay 0 → the trail at once, no notice")
	link.session_over.emit("test")
	main.queue_free()
	await process_frame


## A game on the show map over a fake link, the trail at once, frozen physics.
func _game_on_show() -> Array:
	var house: Dictionary = _read_json("res://house/house.json")
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset", "trail_delay": 0, "intro": false})
	link.house = house
	link.house_version = "test"
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	game.player.set_process(false)
	game.player.set_physics_process(false)
	game.player.read_input = false
	game.speech.set_process(false)
	game.speech.voices = func() -> Array: return []
	return [main, game, link, house]


## Wave 26 (R4): the void. 5 m out of the front door (not 4.8) freezes the
## walk, flashes the scare once, pulses, posts one escape moment with the
## outside pose last; the answer (or 3 s) puts them back at the spawn and
## its lines are captioned; within 20 s a second walk-out is a quiet
## teleport; every refusal still teleports; a dead session ends it.
func _test_escape() -> void:
	var got: Array = await _game_on_show()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var player := game.player
	var spawn: Array = house["spawn"]["pos"]
	# The cooldown runs on the wall clock: each step moves it too.
	var now := [5000.0]
	game.clock = func() -> float: return now[0]
	var step := func(s: float) -> void:
		now[0] += s
		game._process(s)
	link.assignment_received.emit(_assignment(house, "esc-1", true))
	step.call(0.016)
	var near := [-0.45, 0.0, -4.8]
	var out := [-0.45, 0.0, -5.2]
	_check(HouseEscape.void_distance(house, near) != null and float(HouseEscape.void_distance(house, near)) < HouseEscape.ESCAPE_M, "escape: 4.8 m out is the void, short of an escape")
	player.teleport(HouseFrames.vec(near), 0.0)
	step.call(0.016)
	var moments: Array = link.get("moments")
	_check(moments.is_empty() and not game.escaping() and not game.hud.scare_shown(), "escape: 4.8 m out of the door is nothing yet")
	player.teleport(HouseFrames.vec(out), 0.0)
	var pulses := player.pulses
	game.sfx.log.clear()
	step.call(0.016)
	_check(game.escaping() and moments == [["escape", ""]] and game.hud.scare_shown() and game.hud.scare_text() == "FATAL EXCEPTION 0E", "escape: 5.2 m out → the scare and one escape moment (%s)" % [moments])
	_check(_diff(link.poses.back()["p"], out) == "", "escape: … the last pose the server got is the one outside")
	_check(not player.locomotion_enabled and player.pulses == pulses + 1 and game.sfx.log == ["scare"] and game.voice.holding(), "escape: … frozen, a haptic pulse, the scare's sound (the mic held)")
	_check(game.trail.count() == 0, "escape: … no trail")
	var poses: int = link.poses.size()
	step.call(0.5)
	_check(link.poses.size() == poses and moments.size() == 1 and _v3(player.feet(), HouseFrames.vec(out)), "escape: while it waits, no pose and no second moment; nobody moves them")
	# The answer comes early: the scare still holds 1.5 s.
	link.call("answer_moment", "escape", "ok", {"ok": true, "kind": "escape", "lines": [{"from": "Trabolta", "text": "Programs do not leave."}, {"from": "Trabolta", "text": "Back you go."}], "spawn": house["spawn"], "cooldownMs": 20000})
	step.call(0.5)
	_check(game.escaping() and game.hud.scare_shown(), "escape: an early answer still lets the scare play out")
	step.call(0.6)
	_check(not game.escaping() and _v3(player.feet(), HouseFrames.vec(spawn)) and player.locomotion_enabled, "escape: … then back at the spawn, walking (%s)" % player.feet())
	game.speech.tick(0.0)
	_check(game.speech.caption_text() == "Programs do not leave.", "escape: his lines are captioned in order (%s)" % game.speech.caption_text())
	game.hud._process(1.0)
	_check(not game.hud.scare_shown(), "escape: the scare fades out")
	step.call(0.016)
	_check(_diff(link.poses.back()["p"], spawn) == "", "escape: poses go again, from the spawn")
	# Within the cooldown: a quiet teleport, no moment, no scare.
	player.teleport(HouseFrames.vec(out), 0.0)
	step.call(0.016)
	_check(moments.size() == 1 and not game.escaping() and not game.hud.scare_shown() and _v3(player.feet(), HouseFrames.vec(spawn)), "escape: within 20 s the void puts them back quietly")
	# After the cooldown, no answer at all: the teleport after 3 s anyway.
	# 20 s since the post, the scare's frozen 1.6 s included (18.5 s walked).
	for i in 18:
		step.call(1.0)
	step.call(0.5)
	player.teleport(HouseFrames.vec(out), 0.0)
	step.call(0.016)
	_check(moments.size() == 2 and game.escaping(), "escape: 20 s after the post (the scare's freeze counted) it counts again")
	step.call(2.9)
	_check(game.escaping(), "escape: no answer: it waits up to 3 s")
	step.call(0.2)
	_check(not game.escaping() and _v3(player.feet(), HouseFrames.vec(spawn)), "escape: … then the teleport anyway")
	game.speech.stop()
	# A late ok still speaks.
	link.call("answer_moment", "escape", "ok", {"ok": true, "lines": [{"from": "Trabolta", "text": "Late."}]})
	game.speech.tick(0.0)
	_check(game.speech.caption_text() == "Late.", "escape: a late answer's lines still play")
	game.speech.stop()
	# Every refusal teleports, with no lines.
	for result: String in ["not found", "doors are closed", "not out", "cooldown", "bad moment", "error", "offline"]:
		for i in 21:
			step.call(1.0)
		player.teleport(HouseFrames.vec(out), 0.0)
		step.call(0.016)
		link.call("answer_moment", "escape", result, {"error": result})
		step.call(ESCAPE_SCARE_PLUS)
		_check(not game.escaping() and _v3(player.feet(), HouseFrames.vec(spawn)) and not game.speech.busy(), "escape: '%s' → back at the spawn, nothing said" % result)
	# A session that ends mid-scare: the lobby, no scare.
	for i in 21:
		step.call(1.0)
	player.teleport(HouseFrames.vec(out), 0.0)
	step.call(0.016)
	link.session_over.emit("over")
	_check(game.state() == GameFlow.State.LOBBY and not game.escaping() and not game.hud.scare_shown(), "escape: a session ending mid-scare goes to the lobby clean")
	# A new session starts with no cooldown.
	link.assignment_received.emit(_assignment(house, "esc-2", true))
	step.call(0.016)
	player.teleport(HouseFrames.vec(out), 0.0)
	var before: int = moments.size()
	step.call(0.016)
	_check(moments.size() == before + 1 and game.escaping(), "escape: a new session has no cooldown")
	link.session_over.emit("test")
	main.queue_free()
	await process_frame


const ESCAPE_SCARE_PLUS := Game.ESCAPE_SCARE + 0.1


## Wave 26 (R6, R7): the heart, shown once the King has fallen, posts its
## moment on the way in (lines over it; none yet → again on the next way
## in; already → silent); the disk posts on reach (taken → hidden, a blip,
## the lines; far → again soon); the assignment's heartHeard / picked hold
## across a re-scan; an old server gives up.
func _test_heart_pickup() -> void:
	var got: Array = await _game_on_show()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var player := game.player
	var moments: Array = link.get("moments")
	var heart_at: Array = HouseMoment.moment_prop(house, "server-heart", "heart")["pos"]
	var disk_at: Array = HouseMoment.moment_prop(house, "virus-disk", "pickup")["pos"]
	var hall := [4.5, -2.7, 18.5]
	link.assignment_received.emit(_assignment(house, "hp-1", true))
	game._process(0.016)
	player.teleport(HouseFrames.vec(heart_at), 0.0)
	game._process(0.016)
	_check(moments.is_empty() and not game.builder.heart_shown("server-heart"), "heart: no shared King → no heart, no moment")
	link.give_king({"id": "cold-lock-king", "hp": 0, "max": 15, "fallen": true})
	game._process(0.016)
	_check(moments == [["heart", "server-heart"]] and game.prop_state("server-heart") == "pending", "heart: the King fallen, the heart reached → one heart moment (%s)" % [moments])
	game._process(0.5)
	_check(moments.size() == 1, "heart: … only one while it is out")
	link.call("answer_moment", "heart", "ok", {"ok": true, "kind": "heart", "lines": []})
	game._process(1.0)
	_check(moments.size() == 1 and game.prop_state("server-heart") == "rearm", "heart: no lines (he isn't awake) → nothing until the next way in")
	player.teleport(HouseFrames.vec(hall), 0.0)
	game._process(0.016)
	player.teleport(HouseFrames.vec(heart_at), 0.0)
	game._process(0.016)
	_check(moments.size() == 2, "heart: … the next way in tries again")
	game.speech.stop()
	link.call("answer_moment", "heart", "ok", {"ok": true, "kind": "heart", "lines": [{"from": "Trabolta", "text": "So. You found where I keep myself."}]})
	game.speech.tick(0.0)
	_check(game.speech.caption_text() == "So. You found where I keep myself." and game.speech.on_prop() and game.prop_state("server-heart") == "done", "heart: his lines play over the heart (%s)" % game.speech.caption_text())
	player.teleport(HouseFrames.vec(hall), 0.0)
	game._process(0.016)
	player.teleport(HouseFrames.vec(heart_at), 0.0)
	game._process(0.016)
	_check(moments.size() == 2, "heart: heard once, never again this walk")
	game.speech.stop()

	# The disk.
	player.teleport(HouseFrames.vec(disk_at), 0.0)
	game._process(0.016)
	_check(moments.back() == ["pickup", "virus-disk"], "pickup: in reach → a pickup moment (%s)" % [moments.back()])
	link.call("answer_moment", "pickup", "far", {"error": "far", "distance": 1.3})
	game._process(1.0)
	_check(moments.size() == 3 and game.builder.pickup_shown("virus-disk"), "pickup: 'far' → wait")
	game._process(0.6)
	_check(moments.size() == 4, "pickup: … then again")
	game.sfx.log.clear()
	link.call("answer_moment", "pickup", "ok", {"ok": true, "kind": "pickup", "lines": [{"from": "Truther", "text": "Download complete."}], "item": "virus", "prop": "virus-disk"})
	game.speech.tick(0.0)
	_check(not game.builder.pickup_shown("virus-disk") and game.sfx.log == ["pickup"] and game.speech.caption_text() == "Download complete." and not game.speech.on_prop(), "pickup: taken → the disk goes, a blip, the line head-locked")
	game._process(2.0)
	_check(moments.size() == 4 and game.prop_state("virus-disk") == "done", "pickup: … once")
	game.speech.stop()
	link.session_over.emit("test")

	# A re-scan: the assignment says what this program already has.
	var a := _assignment(house, "hp-2", true)
	a["picked"] = ["virus-disk"]
	a["heartHeard"] = true
	link.assignment_received.emit(a)
	_check(not game.builder.pickup_shown("virus-disk") and game.prop_state("virus-disk") == "done" and game.prop_state("server-heart") == "done", "re-scan: picked hides the disk, heartHeard silences the heart")
	var n := moments.size()
	player.teleport(HouseFrames.vec(disk_at), 0.0)
	game._process(0.016)
	player.teleport(HouseFrames.vec(heart_at), 0.0)
	game._process(0.016)
	_check(moments.size() == n, "re-scan: … no moment for either")
	link.session_over.emit("test")
	# The session's own map lands after the assignment (the loaded one was
	# stale, ServerLink.adopt fetched it): what the program has still holds.
	var stale: Dictionary = house.duplicate(true)
	stale["props"] = (stale["props"] as Array).filter(func(pr: Dictionary) -> bool: return pr["kind"] != "pickup")
	link.give_house(stale)
	var a2 := _assignment(house, "hp-2b", true)
	a2["picked"] = ["virus-disk"]
	link.assignment_received.emit(a2)
	game._process(0.016)
	link.give_house(house)
	_check(not game.builder.pickup_shown("virus-disk") and game.prop_state("virus-disk") == "done", "re-scan: a map landing after the assignment still hides a picked disk")
	n = moments.size()
	player.teleport(HouseFrames.vec(disk_at), 0.0)
	game._process(0.016)
	_check(moments.size() == n, "re-scan: … and posts nothing for it")
	link.session_over.emit("test")
	link.assignment_received.emit(_assignment(house, "hp-3", true))
	_check(game.builder.pickup_shown("virus-disk") and game.prop_state("virus-disk") == "", "re-scan: an old server's assignment (no picked) shows the disk")
	player.teleport(HouseFrames.vec(disk_at), 0.0)
	game._process(0.016)
	link.call("answer_moment", "pickup", "already", {"error": "already"})
	_check(not game.builder.pickup_shown("virus-disk"), "pickup: 'already' hides the disk")
	player.teleport(HouseFrames.vec(heart_at), 0.0)
	game._process(0.016)
	link.call("answer_moment", "heart", "not found", {"error": "not found"})
	player.teleport(HouseFrames.vec(hall), 0.0)
	game._process(0.016)
	player.teleport(HouseFrames.vec(heart_at), 0.0)
	game._process(0.016)
	_check(game.prop_state("server-heart") == "done" and moments.back()[0] == "heart" and moments.filter(func(m: Array) -> bool: return m[0] == "heart").size() == 3, "heart: an old server (not found) → given up for the walk")
	link.session_over.emit("test")
	# Sealed (the King stood again on the server) → the next way in.
	link.assignment_received.emit(_assignment(house, "hp-4", true))
	player.teleport(HouseFrames.vec(heart_at), 0.0)
	game._process(0.016)
	link.call("answer_moment", "heart", "sealed", {"error": "sealed"})
	game._process(0.016)
	_check(game.prop_state("server-heart") == "rearm", "heart: sealed → the next way in")
	link.call("answer_moment", "heart", "doors are closed", {})
	link.session_over.emit("test")
	main.queue_free()
	await process_frame


## ServerLink's voice URLs: the session's stream + upload on the event, ""
## with no session or offline; the base LinkBase (the fake's parent) has none.
func _test_voice_server_link() -> void:
	var sl := _linked_server_link()
	(sl.get("transport") as HttpTransport).base = "http://127.0.0.1:7999"
	_check(sl.voice_stream_url() == "" and sl.voice_token() == "", "voice link: no session → no voice stream")
	_check(sl.voice_upload_url() == "http://127.0.0.1:7999/e/e1/api/spatial/voice", "voice link: the upload URL is the event's (%s)" % sl.voice_upload_url())
	sl.adopt({"session": "s-9", "token": "tok 9", "duck": {}, "spawn": {}})
	_check(sl.voice_stream_url() == "http://127.0.0.1:7999/e/e1/api/spatial/voice/stream?token=tok%209" and sl.voice_token() == "tok 9", "voice link: playing → the session's stream (%s)" % sl.voice_stream_url())
	sl.config["offline"] = true
	_check(sl.voice_stream_url() == "" and sl.voice_upload_url() == "", "voice link: offline → no voice")
	_free_server_link(sl)
	var base := LinkBase.new()
	_check(base.voice_stream_url() == "" and base.voice_upload_url() == "" and base.voice_token() == "", "voice link: LinkBase's defaults are no voice")
	base.free()


## The real AudioStreamGenerator (not the fake): its clear_buffer() refuses
## while it plays, so a skip ahead and a bye restart it — the backlog really
## goes, and the fresh playback is the one pushed to.
func _test_voice_generator() -> void:
	var e := HouseBuilder.make_voice_emitter()
	root.add_child(e)
	e.play()
	var pb := e.get_stream_playback()
	await process_frame  # the mixer has started it: from now on it is "active"
	await process_frame
	_check(pb is AudioStreamGeneratorPlayback and e.get_stream_playback() == pb, "voice generator: a real generator playback, playing")
	if not pb is AudioStreamGeneratorPlayback:
		e.queue_free()
		return
	var cap := int(pb.get_frames_available())
	var backlog := PackedVector2Array()
	backlog.resize(16 * 600)  # 600 ms queued: past the 400 ms skip
	backlog.fill(Vector2(0.1, 0.1))
	_check(pb.push_buffer(backlog) and cap - int(pb.get_frames_available()) == backlog.size(), "voice generator: 600 ms queued")
	var src := {"spot": "x", "emitter": e, "playback": pb, "capacity": cap, "tail": backlog.duplicate(), "seq": -1}
	var v := VoiceLink.new()
	var chunk := PackedFloat32Array()
	chunk.resize(3200)
	chunk.fill(0.2)
	var ms := v._play(src, chunk)
	var now_pb: Object = src["playback"]
	var queued := (cap - int(now_pb.get_frames_available())) / 16.0
	_check(now_pb != pb and ms <= 450.0 and queued <= 450.0, "voice generator: a skip drops the backlog (%.0f ms queued, was 600 + 200)" % queued)
	v._sources["t:x"] = src
	v._bye("t:x")
	var after: Object = src["playback"]
	var left := (cap - int(after.get_frames_available())) / 16.0
	_check(left <= 70.0 and not v._sources.has("t:x"), "voice generator: a bye leaves only the fade-out (%.0f ms)" % left)
	v.free()
	e.stop()
	e.queue_free()
	await process_frame


## A bare rig on a floor: walking in the open never buzzes; walking into a
## wall buzzes the controllers, at most every WALL_BUMP_EVERY (wave 33b).
func _test_wall_bump() -> void:
	var world := Node3D.new()
	root.add_child(world)
	var solid := func(size: Vector3, at: Vector3) -> void:
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = size
		cs.shape = box
		body.add_child(cs)
		world.add_child(body)
		body.global_position = at
	solid.call(Vector3(20, 0.2, 20), Vector3(0, -0.1, 0))
	solid.call(Vector3(4, 2, 0.2), Vector3(0, 1, -3))  # 3 m north
	var player: VrPlayer = Game.PLAYER_SCENE.instantiate()
	player.set_process(false)
	player.set_physics_process(false)
	player.read_input = false
	world.add_child(player)
	await physics_frame
	player.teleport(Vector3(0, 0, 0), 180.0)  # facing south: open floor
	player.left_stick = Vector2(0, 1)
	for i in 72:
		player.step(1.0 / 72.0)
	_check(player.wall_bumps == 0 and player.feet().z > 1.0, "player: walking in the open never buzzes (%d, walked to z %.2f)" % [player.wall_bumps, player.feet().z])
	player.teleport(Vector3(0, 0, -1.5), 0.0)  # facing north, the wall 1.4 m ahead
	var pulses0 := player.pulses
	for i in 144:
		player.step(1.0 / 72.0)
	_check(player.feet().z > -2.9 and player.wall_bumps >= 2 and player.wall_bumps <= 3 and player.pulses > pulses0, "player: into a wall: a buzz, at most every %.1f s (%d in 2 s, stopped at z %.2f)" % [VrPlayer.WALL_BUMP_EVERY, player.wall_bumps, player.feet().z])
	world.queue_free()
	await process_frame


# --- the intro (wave 33) -----------------------------------------------------------


## The intro's steps, pure: the skips, the order, what advances each step,
## the fallback buttons, the turn step's hold.
func _test_intro_flow() -> void:
	_check(not IntroFlow.skippable_for(null) and not IntroFlow.skippable_for(0) and IntroFlow.skippable_for(1) and IntroFlow.skippable_for(3.0) and not IntroFlow.skippable_for("1"), "intro: skippable from one completed reinstallation (missing = 0)")
	var f := IntroFlow.new()
	_check(not f.running(), "intro: not running until started")
	var ev := f.start(null)
	_check(f.step == IntroFlow.Step.VIDEO and ev == [{"event": "step", "step": IntroFlow.Step.VIDEO}] and not f.skippable, "intro: starts at the video")
	_check(f.buttons().is_empty() and f.press("skip").is_empty() and f.progress() == "", "intro: a first-timer's video has no SKIP")
	_check(not f.locomotion(), "intro: no walking during the video")
	_check(f.tick(200.0, {"yaw": 0.0}).is_empty() and f.step == IntroFlow.Step.VIDEO, "intro: the video holds until it ends")
	ev = f.tick(0.016, {"video_done": true})
	_check(f.step == IntroFlow.Step.WELCOME and ev == [{"event": "step", "step": IntroFlow.Step.WELCOME}], "intro: video over → WELCOME")
	_check(f.progress() == "1 / 5" and f.title() != "" and f.body().contains("look around"), "intro: WELCOME is step 1 / 5 (%s)" % f.progress())
	_check(f.buttons().is_empty() and not f.locomotion(), "intro: WELCOME's OK waits, no SKIP TUTORIAL for a first-timer")
	f.tick(IntroFlow.WELCOME_OK_AFTER, {"yaw": 0.0})
	_check(f.buttons() == ["ok"], "intro: … OK after %d s" % int(IntroFlow.WELCOME_OK_AFTER))
	f.tick(0.1, {"yaw": 60.0})
	_check(f.step == IntroFlow.Step.WELCOME, "intro: 60° of looking is not yet around")
	ev = f.tick(0.1, {"yaw": -60.0})
	_check(f.step == IntroFlow.Step.POINT and ev.has({"event": "success"}), "intro: looking around (%d°) moves on, with a success" % int(IntroFlow.LOOK_DEG))
	_check(f.buttons() == ["ok"] and f.press("ok").is_empty(), "intro: POINT's OK ignores a press within the arm delay")
	f.tick(IntroFlow.ARM_DELAY, {})
	ev = f.tick(0.016, {"pressed": "ok"})
	_check(f.step == IntroFlow.Step.WALK and ev.has({"event": "success"}) and f.locomotion(), "intro: OK pressed → WALK, walking on")
	_check(f.buttons().is_empty(), "intro: WALK has no NEXT at first")
	_check(f.tick(1.0, {"in_ring": false}).is_empty(), "intro: … outside the ring nothing happens")
	f.tick(IntroFlow.WALK_NEXT_AFTER, {})
	_check(f.buttons() == ["next"], "intro: … NEXT after %d s for the stuck" % int(IntroFlow.WALK_NEXT_AFTER))
	ev = f.tick(0.016, {"in_ring": true})
	_check(f.step == IntroFlow.Step.TURN and ev.has({"event": "success"}), "intro: into the ring → TURN")
	_check(f.buttons().is_empty() and f.locomotion() and f.body().contains("turn"), "intro: TURN has no buttons — no turn setting to pick (wave 33b)")
	ev = f.tick(0.1, {"facing": true})
	_check(f.faced and ev == [{"event": "success"}] and f.body() == IntroFlow.TURN_DONE and f.buttons().is_empty(), "intro: facing the duck → success, \"that's it\"")
	_check(f.tick(0.1, {"facing": true}).is_empty() and f.step == IntroFlow.Step.TURN, "intro: … once, and the line stays a moment")
	ev = f.tick(IntroFlow.TURN_DONE_HOLD, {"facing": false})
	_check(f.step == IntroFlow.Step.COMFORT and ev == [{"event": "step", "step": IntroFlow.Step.COMFORT}] and f.progress() == "5 / 5", "intro: … then COMFORT by itself (%.0f s)" % IntroFlow.TURN_DONE_HOLD)
	_check(f.buttons() == ["start"] and f.press("start").is_empty(), "intro: COMFORT's START (armed after a moment)")
	f.tick(IntroFlow.ARM_DELAY, {})
	ev = f.press("start")
	_check(not f.running() and ev.has({"event": "done"}), "intro: START → done")
	_check(f.tick(1.0, {"pressed": "start"}).is_empty(), "intro: nothing after done")

	# NEXT for anyone who can't find the duck.
	var k := IntroFlow.new()
	k.start(0)
	k.tick(0.1, {"video_done": true})
	k.tick(IntroFlow.WELCOME_OK_AFTER, {})
	k.press("ok")
	k.tick(1.0, {"in_ring": false})
	k.press("ok")
	k.tick(0.0, {"in_ring": true})
	_check(k.step == IntroFlow.Step.TURN and k.buttons().is_empty(), "intro: (to TURN)")
	k.tick(IntroFlow.TURN_NEXT_AFTER, {})
	_check(k.buttons() == ["next"] and not k.faced, "intro: NEXT after %d s without the duck" % int(IntroFlow.TURN_NEXT_AFTER))
	k.press("next")
	_check(k.step == IntroFlow.Step.COMFORT, "intro: … NEXT → COMFORT")

	# A returning program: SKIP on the video, SKIP TUTORIAL on every step.
	var r := IntroFlow.new()
	r.start(2)
	_check(r.skippable and r.buttons() == ["skip"], "intro: a returning program may skip the video")
	_check(r.press("skip").is_empty(), "intro: … not within the arm delay")
	r.tick(IntroFlow.ARM_DELAY, {})
	ev = r.press("skip")
	_check(r.step == IntroFlow.Step.WELCOME and not ev.has({"event": "success"}), "intro: SKIP → the tutorial")
	_check(r.buttons() == ["skip_tutorial"], "intro: … which it may skip too")
	r.tick(IntroFlow.ARM_DELAY, {})
	ev = r.press("skip_tutorial")
	_check(not r.running() and ev.has({"event": "done"}), "intro: SKIP TUTORIAL → done")
	var x := IntroFlow.new()
	x.start(0)
	x.abort()
	_check(not x.running() and x.tick(1.0, {"video_done": true}).is_empty(), "intro: abort stops it silently")

	# Geometry: the ring and facing the duck.
	_check(IntroFlow.in_ring(Vector3(1, 400, 1.5), Vector3(1, 400.02, 2.0)) and not IntroFlow.in_ring(Vector3(1, 400, 0), Vector3(1, 400, 2.0)), "intro: in the ring within %.1f m (plan)" % IntroFlow.RING_RADIUS)
	_check(IntroFlow.facing(180.0, Vector3.ZERO, Vector3(0, 0, 3)) and IntroFlow.facing(-170.0, Vector3.ZERO, Vector3(0, 0, 3)) and not IntroFlow.facing(0.0, Vector3.ZERO, Vector3(0, 0, 3)), "intro: facing the duck behind means turning round")
	_check(IntroFlow.facing(90.0, Vector3.ZERO, Vector3(-3, 0, 0)) and not IntroFlow.facing(90.0, Vector3.ZERO, Vector3(3, 0, 0)), "intro: yaw +90 faces −x")
	_check(IntroFlow.name_of(IntroFlow.Step.TURN) == "TURN", "intro: step names")


## mark_ready over the wire: the session's token, `{}`, a 404 (an old
## server) ignored, a 410 ends the session. No prefs (wave 33b).
func _test_server_link_intro() -> void:
	var sl := _linked_server_link()
	var tr: Variant = sl.get("transport")
	var over: Array = []
	sl.session_over.connect(func(r: String) -> void: over.append(r))
	sl.mark_ready()
	_check(tr.count("/api/spatial/ready") == 0, "link: no ready without a session")
	_check(not sl.has_method("save_prefs"), "link: no prefs to save (smooth turning only)")
	sl.adopt({"session": "s-in", "token": "t-in", "houseVersion": ""})
	sl.mark_ready()
	var c: Dictionary = tr.calls.back()
	_check(c["method"] == "POST" and c["path"] == "/e/e1/api/spatial/ready" and c["token"] == "t-in" and c["body"] == {}, "link: ready posts {} with the session's token (%s)" % [c["path"]])
	tr.answer("/spatial/ready", 404, {"error": "not found"})
	_check(sl.has_session() and over.is_empty(), "link: … an old server's 404 is ignored")
	sl.mark_ready()
	tr.answer("/spatial/ready", 200, {"ok": true})
	_check(sl.has_session() and over.is_empty(), "link: … 200 changes nothing")
	sl.mark_ready()
	tr.answer("/spatial/ready", 410, {"error": "gone"})
	_check(over == ["over"] and not sl.has_session(), "link: a 410 ends the session")
	_free_server_link(sl)
	sl = _linked_server_link()
	sl.config["offline"] = true
	tr = sl.get("transport")
	sl.adopt({"session": "offline-1", "token": "", "houseVersion": ""})
	sl.mark_ready()
	_check(tr.log.filter(func(p: String) -> bool: return p.contains("/ready")).is_empty(), "link: offline, nothing is posted")
	_free_server_link(sl)


## Click intro button `id` with the laser from the head (a test ray).
func _intro_click(game: Game, id: String) -> void:
	var o := game.player.camera.global_position
	var d := game.intro_space.button_world(id) - o
	game.pointer.inject(o, d, false)
	game._process(0.016)
	game.pointer.inject(o, d, true)
	game._process(0.016)
	game.pointer.inject(o, d, false)
	game._process(0.016)
	game.pointer.clear_injection()


## The intro in the game: a first-timer's unskippable video then the
## tutorial step by step (the laser, the ring, turning round to the duck),
## the session kept alive at the spawn with nothing of the walk running,
## the walk's clocks and `ready` after it; a returning program's skips (an
## old server's `prefs` ignored); a session that ends mid-intro.
func _test_intro_game() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset"})
	link.house = house
	link.house_version = "test"
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	var player := game.player
	player.set_process(false)
	player.set_physics_process(false)
	player.read_input = false
	game.speech.set_process(false)
	game.speech.voices = func() -> Array: return []
	game.intro_space.fake_video = true
	game.clock = func() -> float: return _now
	_check(game.intro_wanted() and game.intro_space != null and not game.intro_space.visible, "intro: on by default, nothing up in the lobby")

	var a := _assignment(house, "in-1", true)
	a["reinstalled"] = 0
	link.assignment_received.emit(a)
	_check(game.state() == GameFlow.State.PLAYING and game.in_intro() and game.intro.step == IntroFlow.Step.VIDEO, "intro: an assignment starts the intro at the video")
	_check(player.feet().distance_to(IntroSpace.SPOT) < 0.01 and not player.locomotion_enabled, "intro: … on the practice floor, standing still")
	_check(game.intro_space.visible and game.intro_space.cinema_shown() and game.intro_space.video_on() and not game.intro_space.panel_shown(), "intro: … the cinema up")
	_check(not game.intro_space.lit(), "intro: … the practice floor dark for the video")
	_check(game.intro_space.button_ids().is_empty(), "intro: … and no SKIP for a first-timer")
	var poses_before: int = link.poses.size()
	var pulses_before := player.pulses
	for i in 30:
		game._process(0.1)
	var spawn: Array = house["spawn"]["pos"]
	_check(link.poses.size() >= poses_before + 30 and _diff(link.poses.back()["p"], spawn) == "" and _near(float(link.poses.back()["yaw"]), float(house["spawn"]["yaw"])), "intro: the spawn pose goes out every frame (the session stays alive, in the house)")
	_check(link.moments.is_empty() and link.found_calls == 0 and link.king_hits == 0, "intro: no void, no find, no King on the practice floor")
	_check(not game.voice.is_running() and not game.sfx.hum_on() and not game.sfx.log.has("quack"), "intro: no voice link, hum or quack during the video")
	_check(not game.trail_revealed and game.trail.count() == 0 and game.hud.big_text() == "", "intro: no walk, no HUD")
	_check(game.intro.step == IntroFlow.Step.VIDEO and link.get("readies") == 0, "intro: the video holds (3 s in)")
	# News from the house while the video plays: nothing on the HUD.
	link.duck_changed.emit(HouseDuck.pick_duck_spot(house, "in-1b"))
	link.map_warning.emit("The map may be out of date.")
	_check(game.hud.notice_text() == "" and str(game.flow.assignment["duck"]["id"]) == str(HouseDuck.pick_duck_spot(house, "in-1b")["id"]), "intro: a moved duck is taken quietly")

	game.intro_space.finish_video()
	game._process(0.016)
	_check(game.intro.step == IntroFlow.Step.WELCOME and game.intro_space.panel_shown() and not game.intro_space.cinema_shown() and not game.intro_space.video_on(), "intro: the video over → WELCOME on the panel")
	_check(game.intro_space.title_text() == IntroFlow.TITLES[IntroFlow.Step.WELCOME] and game.intro_space.button_ids().is_empty(), "intro: WELCOME's OK waits")
	_check(game.intro_space.lit(), "intro: the floor lit for the tutorial")
	game._process(IntroFlow.WELCOME_OK_AFTER)
	_check(game.intro_space.button_ids() == ["ok"], "intro: … then shows")
	var chimes := game.sfx.log.count("chime")
	_intro_click(game, "ok")
	_check(game.intro.step == IntroFlow.Step.POINT and game.sfx.log.count("chime") == chimes + 1 and player.pulses > pulses_before, "intro: OK by the laser → POINT, a chime and a haptic")
	game._process(IntroFlow.ARM_DELAY)
	_intro_click(game, "ok")
	_check(game.intro.step == IntroFlow.Step.WALK and player.locomotion_enabled and game.intro_space.ring_shown(), "intro: POINT's OK → WALK: walking on, the ring out")
	var ring: Vector3 = game.get("_intro_ring")
	_check(_near(Vector2(ring.x - player.feet().x, ring.z - player.feet().z).length(), IntroSpace.RING_AHEAD, 0.01), "intro: the ring %.1f m ahead" % IntroSpace.RING_AHEAD)
	player.teleport(Vector3(ring.x, IntroSpace.SPOT.y, ring.z), player.head_yaw())
	game._process(0.016)
	_check(game.intro.step == IntroFlow.Step.TURN and not game.intro_space.ring_shown() and game.intro_space.duck.visible, "intro: in the ring → TURN, the duck behind")
	_check(game.intro_space.button_ids().is_empty() and player.locomotion_enabled, "intro: TURN: no buttons, the stick turns")
	var duck_at := game.intro_space.duck.global_position
	var to := duck_at - player.camera.global_position
	player.face(rad_to_deg(atan2(-to.x, -to.z)))
	game._process(0.016)
	_check(game.intro.faced and game.intro_space.body_text() == IntroFlow.TURN_DONE, "intro: facing the duck → \"that's it\"")
	var at_panel := game.intro_space.panel_transform().origin
	_check(game.sfx.log.has("quack") and not IntroFlow.facing(player.head_yaw(), Vector3(player.feet().x, 0, player.feet().z), Vector3(at_panel.x, 0, at_panel.z)), "intro: … the duck quacks; the panel stays behind, never in front of the duck")
	game._process(IntroFlow.TURN_DONE_HOLD)
	game._process(0.016)
	at_panel = game.intro_space.panel_transform().origin
	_check(game.intro.step == IntroFlow.Step.COMFORT and game.intro_space.button_ids() == ["start"] and IntroFlow.facing(player.head_yaw(), Vector3(player.feet().x, 0, player.feet().z), Vector3(at_panel.x, 0, at_panel.z)), "intro: … then COMFORT by itself, the panel in front again")
	_check(link.get("readies") == 0 and game.in_intro(), "intro: not ready yet")
	game._process(IntroFlow.ARM_DELAY)
	_intro_click(game, "start")
	_check(not game.in_intro() and not game.intro_space.visible and link.get("readies") == 1, "intro: START → the walk, ready posted once")
	_check(_v3(player.feet(), HouseFrames.vec(spawn)) and player.locomotion_enabled, "intro: … at the spawn, walking")
	_check(game.state() == GameFlow.State.PLAYING and game.sfx.hum_on() and not game.trail_revealed, "intro: … the walk and the hum on, the trail hidden")
	_check(float(game.get("_played_for")) < 0.1 and _near(float(game.get("_quack_in")), Sfx.QUACK_FIRST, 0.05), "intro: the walk's clocks start now (played %.2f s)" % float(game.get("_played_for")))
	for i in 5:
		game._process(0.1)
	_check(link.get("readies") == 1 and _near(float(game.get("_played_for")), 0.5, 0.05), "intro: ready once; the reveal clock counts from here")
	link.session_over.emit("test")
	_check(game.state() == GameFlow.State.LOBBY, "intro: (back to the lobby)")

	# A returning program (with an old server's saved snap turn, ignored):
	# SKIP on the video and the tutorial; ready still sent.
	var b := _assignment(house, "in-2", false)
	b["reinstalled"] = 1
	b["prefs"] = {"turn": "snap"}
	link.assignment_received.emit(b)
	_check(game.intro_space.button_ids() == ["skip"], "intro: a returning program may skip the video")
	game._process(IntroFlow.ARM_DELAY)
	_intro_click(game, "skip")
	_check(game.intro.step == IntroFlow.Step.WELCOME and not game.intro_space.video_on(), "intro: SKIP stops the video → the tutorial")
	_check(game.intro_space.button_ids() == ["skip_tutorial"], "intro: … SKIP TUTORIAL offered")
	game._process(IntroFlow.ARM_DELAY)
	_intro_click(game, "skip_tutorial")
	_check(not game.in_intro() and link.get("readies") == 2, "intro: SKIP TUTORIAL → the walk, ready posted")
	link.session_over.emit("test")

	# A session that ends mid-video: back to the lobby, the video stopped.
	link.assignment_received.emit(_assignment(house, "in-3", true))
	game._process(0.5)
	_check(game.in_intro() and game.intro_space.video_on(), "intro: (mid-video)")
	link.session_over.emit("over")
	_check(game.state() == GameFlow.State.LOBBY and not game.in_intro() and not game.intro_space.visible and not game.intro_space.video_on(), "intro: a session over mid-video → the lobby, the video stopped")
	_check(player.feet().distance_to(Lobby.SPOT) < 0.01 and game.lobby.visible, "intro: … standing in the lobby")
	_check(link.get("readies") == 2, "intro: … no ready for it")

	# The test code: a first-timer's intro gone, wherever it is, ready posted;
	# a wrong code doesn't touch it; the test levels never had one.
	var typed := func(code: String) -> bool:
		var hit := false
		for k: String in code:
			hit = game.feed_intro_code(k == "A", k == "B", 0.3) or hit
			hit = game.feed_intro_code(false, false, 0.0) or hit
		return hit
	var readies_before: int = link.get("readies")
	link.assignment_received.emit(_assignment(house, "in-code", true))
	game._process(0.5)
	_check(not typed.call("AAAA") and game.in_intro(), "intro: a wrong code does nothing")
	game._combo = TestCombo.new()
	_check(typed.call(TestCombo.SEQUENCE) and not game.in_intro() and not game.intro_space.video_on() and not game.intro_space.visible, "intro: the test code ends a first-timer's video and tutorial")
	_check(game.state() == GameFlow.State.PLAYING and link.get("readies") == readies_before + 1, "intro: … into the walk, ready posted")
	link.session_over.emit("test")
	link.assignment_received.emit(_assignment(house, "in-code2", true))
	game.intro.step = IntroFlow.Step.WALK
	_check(typed.call(TestCombo.SEQUENCE) and not game.in_intro(), "intro: … and from the middle of the tutorial")
	link.session_over.emit("test")
	game.start_test_level()
	link.assignment_received.emit(_assignment(house, "in-test", true))
	_check(game.state() == GameFlow.State.PLAYING and not game.in_intro(), "intro: the test level goes straight in the house")
	link.session_over.emit("test")
	link.assignment_received.emit(_assignment(house, "in-after", true))
	_check(game.in_intro(), "intro: … and the next real walk has its intro again")
	link.session_over.emit("over")

	# (wave 40) The headset off mid-tutorial holds the walk and offers a
	# resume in the lobby (the intro cinema gone), rather than ending it.
	link.assignment_received.emit(_assignment(house, "in-4", true))
	game.intro_space.finish_video()
	game._process(0.016)
	_check(game.intro.step == IntroFlow.Step.WELCOME, "intro: (mid-tutorial)")
	var ended_mid: int = link.ended.size()
	game.presence_changed(false)
	_now += Game.PRESENCE_GRACE + 0.1
	game._process(0.016)
	_check(game.state() == GameFlow.State.LOBBY and link.ended.size() == ended_mid and not game._resume_offer.is_empty() and not game.intro_space.visible, "intro: the headset off mid-tutorial → the lobby offers a resume")
	game._resume_offer = {}
	game.lobby.clear_resume()
	game.presence_changed(true)

	# The intro config off: straight to the house.
	link.config["intro"] = false
	link.assignment_received.emit(_assignment(house, "in-5", true))
	_check(not game.in_intro() and _v3(player.feet(), HouseFrames.vec(spawn)) and link.get("readies") == readies_before + 2, "intro: intro false → straight to the spawn, no ready")
	link.session_over.emit("test")
	main.queue_free()
	await process_frame
	await process_frame



# --- wave 39: the real house's lights ---------------------------------------


## `gameLightsOf` / `pulseFactor` pinned to what `house/src/lights-presence.ts`
## answers for the same inputs (computed with node, 2026-10-28).
func _test_house_lights() -> void:
	for raw: Variant in [null, 3, "x", {}, {"lights": 3}]:
		_check(HouseLights.game_lights_of(raw) == null, "lights: %s is no frame" % [raw])
	var frame: Variant = HouseLights.game_lights_of({"at": 12, "source": "house", "pulse": "breathe", "lights": [
		{"id": "a", "room": "desktop", "pos": {"x": 1, "y": 2.1, "z": 3}, "kind": "wled", "color": "#FFAA00", "level": 0.5, "effect": "breathe", "pulse": true, "safety": false},
		{"id": "b", "pos": {"x": 1, "y": 2, "z": "3"}},
		{"id": 4, "pos": {"x": 1, "y": 2, "z": 3}},
		{"id": "c", "room": 5, "pos": {"x": 0, "y": 0, "z": 0}, "kind": "lamp", "color": "red", "level": 7, "effect": "glow", "pulse": 1, "safety": "yes"},
		{"id": "d", "pos": {"x": 0, "y": 0, "z": 0}, "level": -2},
		"junk",
		{"id": "e", "pos": null},
	]})
	var want: Variant = JSON.parse_string('{"at":12,"source":"house","pulse":"breathe","lights":[{"id":"a","room":"desktop","pos":{"x":1,"y":2.1,"z":3},"kind":"wled","color":"#ffaa00","level":0.5,"effect":"breathe","pulse":true,"safety":false},{"id":"c","room":"","pos":{"x":0,"y":0,"z":0},"kind":"zigbee","color":"#ffd9a8","level":1,"effect":null,"pulse":false,"safety":false},{"id":"d","room":"","pos":{"x":0,"y":0,"z":0},"kind":"zigbee","color":"#ffd9a8","level":0,"effect":null,"pulse":false,"safety":false}]}')
	_check(frame == want, "lights: a frame decodes as gameLightsOf does; malformed lights dropped, not the frame (%s)" % [JSON.stringify(frame)])
	var bare: Variant = HouseLights.game_lights_of({"source": "estimate", "pulse": "wave", "lights": []})
	_check(bare == {"at": 0.0, "source": "estimate", "pulse": null, "lights": []}, "lights: an unknown pulse is null, a missing at 0 (%s)" % [bare])
	_check(HouseLights.game_lights_of({"source": "lamp", "lights": []})["source"] == "estimate", "lights: any source but house is the estimate")
	var ts := [1, 0.675, 0.35, 0.6749999999999999, 1, 0.675, 0.6749999999999999, 0.4839697930049459]
	var ok := true
	var at := [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, -0.5, 3.3]
	for i in at.size():
		ok = ok and _near(HouseLights.pulse_factor(at[i]), ts[i], 1e-9)
	_check(ok, "lights: pulse_factor matches pulseFactor (1 → 0.35 → 1 every 2 s, negative t too)")
	_check(_near(HouseLights.pulse_factor(1.0, 4.0), 0.675, 1e-9) and _near(HouseLights.pulse_factor(0.25, 1.0), 0.675, 1e-9), "lights: … with a period")

	# What a fixture shows; where it hangs.
	var lit := {"id": "x", "room": "desktop", "pos": {"x": 0.0, "y": 2.1, "z": 7.0}, "level": 0.8, "pulse": false}
	_check(HouseLights.shown_level(lit, 1.0) == 0.8, "lights: an unpulsed fixture shows its level")
	lit["pulse"] = true
	_check(_near(HouseLights.shown_level(lit, 1.0), 0.8 * 0.35), "lights: a pulsed one breathes with the curve")
	_check(HouseLights.shown_level({"level": 0.0, "pulse": true}, 1.3) == 0.0, "lights: a dark fixture stays dark under a pulse")
	var house: Dictionary = _read_json("res://house/house.json")
	_check(HouseLights.light_floor(house, lit) == "main", "lights: a fixture hangs on its room's floor")
	_check(HouseLights.light_floor(house, {"room": "nowhere", "pos": {"x": 0.0, "y": -0.6, "z": 0.0}}) == "basement", "lights: … else on the floor its height is on")

	# The pool: lit fixtures on the player's floor, nearest first.
	var lights := [
		{"id": "far", "room": "desktop", "pos": {"x": 4.9, "y": 2.1, "z": 7.25}, "level": 1.0},
		{"id": "near", "room": "desktop", "pos": {"x": -0.9, "y": 2.1, "z": 7.25}, "level": 0.5},
		{"id": "dark", "room": "desktop", "pos": {"x": 0.0, "y": 2.1, "z": 7.25}, "level": 0.0},
		{"id": "down", "room": "ram", "pos": {"x": -0.9, "y": -0.6, "z": 7.25}, "level": 1.0},
		{"id": "mid", "room": "desktop", "pos": {"x": 2.0, "y": 2.1, "z": 7.25}, "level": 0.3},
	]
	var feet := [-1.0, 0.0, 7.0]
	_check(HouseLights.pick_pool(lights, house, "main", feet, 4) == ["near", "mid", "far"], "lights: the pool takes the lit fixtures on the player's floor, nearest first (%s)" % [HouseLights.pick_pool(lights, house, "main", feet, 4)])
	_check(HouseLights.pick_pool(lights, house, "main", feet, 2) == ["near", "mid"], "lights: … at most the pool's size")
	_check(HouseLights.pick_pool(lights, house, "basement", feet, 4) == ["down"], "lights: … another floor, its own fixtures")
	_check(HouseLights.pick_pool(lights, house, "", feet, 4).is_empty() and HouseLights.pick_pool(lights, house, "main", feet, 0).is_empty(), "lights: no floor or no pool, none")

	# The ambient: today's without a frame; the night floor with one, lifted
	# by how bright the real house is.
	var day := HouseLights.ambient({})
	_check(day["energy"] == HouseLights.DAY_AMBIENT and day["sun"] == HouseLights.DAY_SUN and day["color"] == HouseLights.DAY_COLOR, "lights: no frame, the house as today")
	var dark := HouseLights.ambient({"lights": [{"level": 0.0, "color": "#ff0000"}]})
	_check(dark["energy"] == HouseLights.NIGHT_AMBIENT and dark["sun"] == HouseLights.NIGHT_SUN and dark["color"] == HouseLights.DAY_COLOR, "lights: a dark house, the night floor (never darker)")
	_check(HouseLights.ambient({"lights": []})["energy"] == HouseLights.NIGHT_AMBIENT, "lights: a frame with no fixtures, the night floor")
	var bright := HouseLights.ambient({"lights": [{"level": 1.0, "color": "#ff0000"}]})
	_check(bright["energy"] > HouseLights.NIGHT_AMBIENT and bright["energy"] < HouseLights.DAY_AMBIENT and bright["sun"] > HouseLights.NIGHT_SUN, "lights: a lit house lifts it part of the way (%s)" % [bright])
	_check((bright["color"] as Color).r > HouseLights.DAY_COLOR.r, "lights: … tinted by the real colour")

	# The tiers.
	_check(HouseLights.tier_of("HIGH") == "high" and HouseLights.tier_of(" low ") == "low" and HouseLights.tier_of("ultra") == "medium" and HouseLights.tier_of(null) == "medium", "graphics: tier_of reads a tier, else medium")
	_check(HouseLights.POOL.values().all(func(n: int) -> bool: return n + 3 <= 8), "graphics: every pool + the duck, heart and disk lights stays within the Mobile renderer's 8 omni lights a mesh")
	_check(HouseLights.pool_size("low") == 2 and HouseLights.pool_size("medium") == 4 and HouseLights.pool_size("high") == 5 and HouseLights.pool_size("?") == 4, "graphics: the pool is 2 / 4 / 5")
	for t: String in HouseLights.TIERS:
		var env := HouseLook.environment(t)
		_check(env.tonemap_mode == Environment.TONE_MAPPER_ACES, "graphics: %s tone-maps ACES" % t)
		_check(env.glow_enabled == (t == "high"), "graphics: %s %s glow" % [t, "has" if t == "high" else "has no"])
		_check(not env.ssao_enabled and not env.ssr_enabled and not env.ssil_enabled and not env.volumetric_fog_enabled and not env.sdfgi_enabled, "graphics: %s has no SSAO / SSR / SSIL / volumetric fog / SDFGI" % t)
		_check(_near(env.ambient_light_energy, HouseLights.DAY_AMBIENT), "graphics: %s starts at today's ambient" % t)
	_check(HouseLook.msaa("high") == Viewport.MSAA_2X and HouseLook.msaa("medium") == Viewport.MSAA_DISABLED and HouseLook.msaa("low") == Viewport.MSAA_DISABLED, "graphics: MSAA on high only")
	HouseLook.set_tier("low")
	var low_mat := HouseLook.wall() as StandardMaterial3D
	HouseLook.set_tier("medium")
	var med_mat := HouseLook.wall() as StandardMaterial3D
	_check(low_mat.shading_mode == BaseMaterial3D.SHADING_MODE_PER_VERTEX and med_mat.shading_mode == BaseMaterial3D.SHADING_MODE_PER_PIXEL, "graphics: low lights per vertex, medium per pixel")
	_check(med_mat.diffuse_mode == BaseMaterial3D.DIFFUSE_LAMBERT and med_mat.specular_mode == BaseMaterial3D.SPECULAR_DISABLED, "graphics: … Lambert, no specular")


## The `lights` frame on the link: kept, signalled, cleared with the link.
func _test_house_lights_link() -> void:
	var fl: LinkBase = preload("res://test/fake_link.gd").new()
	var got: Array = []
	fl.lights_changed.connect(func(l: Dictionary) -> void: got.append(l))
	fl._adopt_lights({"at": 1, "lights": [{"id": "a", "pos": {"x": 0, "y": 2, "z": 0}, "level": 0.4}]})
	_check(got.size() == 1 and fl.lights["lights"].size() == 1 and fl.lights["lights"][0]["id"] == "a", "lights link: a frame is kept and signalled")
	fl._adopt_lights({"lights": "nope"})
	_check(got.size() == 1 and fl.lights["lights"].size() == 1, "lights link: a malformed frame is ignored")
	fl._adopt_lights({})
	fl._adopt_lights({})
	_check(got.size() == 2 and got[1].is_empty() and fl.lights.is_empty(), "lights link: {} forgets it, once")
	fl.free()

	var sl := _linked_server_link()
	var seen: Array = []
	sl.lights_changed.connect(func(l: Dictionary) -> void: seen.append(l))
	var frames: Array = []
	sl.stream_frame.connect(func(e: String, _d: Variant) -> void: frames.append(e))
	sl._on_frame("lights", {"at": 5, "source": "house", "pulse": "breathe", "lights": [{"id": "living-1", "room": "desktop", "pos": {"x": -0.92, "y": 2.1, "z": 7.25}, "kind": "zigbee", "color": "#ffd9a8", "level": 0.7, "effect": null, "pulse": true, "safety": false}]})
	_check(seen.size() == 1 and sl.lights["source"] == "house" and sl.lights["lights"][0]["pulse"] == true, "lights link: the stream's lights frame reaches lights_changed")
	_check(frames == ["lights"], "lights link: … and the raw frame still goes out")
	sl._on_frame("lights", "garbage")
	sl._on_frame("sparkles", {"lights": []})
	_check(seen.size() == 1 and sl.lights["lights"].size() == 1, "lights link: a bad lights frame or an unknown frame changes nothing")
	sl.call("_relink", "gone", false)
	_check(seen.size() == 2 and sl.lights.is_empty(), "lights link: a lost link forgets the lights (the house as before)")
	_free_server_link(sl)


func _test_graphics_config() -> void:
	_check(StationConfig.defaults()["graphics"] == "medium", "graphics: medium by default")
	var committed := StationConfig.read_file(StationConfig.RES_PATH)
	_check(committed.get("graphics") == "medium" and committed.get("code") == StationConfig.PLACEHOLDER_CODE, "graphics: the committed station.json says medium (and keeps CHANGEME)")
	_check(StationConfig.merge(StationConfig.defaults(), {"graphics": " HIGH "})["graphics"] == "high", "graphics: a file's tier is read")
	_check(StationConfig.merge(StationConfig.merge(StationConfig.defaults(), {"graphics": "low"}), {"graphics": "ultra"})["graphics"] == "low", "graphics: a bad tier keeps the one before")
	_check(StationConfig.merge(StationConfig.defaults(), {"graphics": 3})["graphics"] == "medium", "graphics: a number is no tier")
	_check(StationConfig.resolve([StationConfig.RES_PATH], PackedStringArray(["--graphics", "low"]))["graphics"] == "low", "graphics: --graphics low")
	_check(StationConfig.resolve([StationConfig.RES_PATH], PackedStringArray(["--graphics=high"]))["graphics"] == "high", "graphics: --graphics=high")


## Three fixtures on the main floor (one pulsed, one dark), one in the basement.
static func _lights_frame() -> Dictionary:
	return HouseLights.game_lights_of({"at": 1, "source": "house", "pulse": "breathe", "lights": [
		{"id": "living-1", "room": "desktop", "pos": {"x": -0.92, "y": 2.1, "z": 7.25}, "kind": "zigbee", "color": "#ff8040", "level": 0.8, "pulse": true},
		{"id": "living-2", "room": "desktop", "pos": {"x": 2.0, "y": 2.1, "z": 7.25}, "kind": "zigbee", "color": "#4080ff", "level": 0.5},
		{"id": "living-3", "room": "desktop", "pos": {"x": 4.92, "y": 2.1, "z": 7.25}, "kind": "zigbee", "color": "#ffffff", "level": 0.0},
		{"id": "kitchen-1", "room": "start-bar", "pos": {"x": 3.0, "y": 2.1, "z": 14.13}, "kind": "zigbee", "color": "#ffd9a8", "level": 1.0},
		{"id": "ram-1", "room": "ram", "pos": {"x": -4.0, "y": -0.6, "z": 9.88}, "kind": "zigbee", "color": "#ff00ff", "level": 1.0},
	]})


## HouseLamps on its own: bulbs, the pulse, the fixed pool, the ambient.
func _test_house_lamps() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var b := HouseBuilder.new()
	root.add_child(b)
	b.build(house)
	var env := HouseLook.environment("medium")
	var sun := DirectionalLight3D.new()
	root.add_child(sun)
	var lamps := HouseLamps.new()
	root.add_child(lamps)
	lamps.set_process(false)
	lamps.setup(b, env, sun, "medium")
	_check(lamps.pool.size() == 4 and lamps.get_child_count() == 4, "lamps: medium builds a pool of 4 lights, before any frame")
	_check(lamps.pool.all(func(l: OmniLight3D) -> bool: return not l.shadow_enabled and not l.visible), "lamps: … no shadows, all off")
	_check(_near(sun.light_energy, HouseLights.DAY_SUN) and _near(env.ambient_light_energy, HouseLights.DAY_AMBIENT), "lamps: no frame, today's ambient and sun")

	var frame := _lights_frame()
	lamps.apply(frame)
	_check(lamps.bulb_ids().size() == 5 and lamps.pool.size() == 4, "lamps: a bulb per fixture; the pool unchanged")
	var p1 := lamps.bulb("living-1").global_position
	_check(p1.distance_to(b.to_world([-0.92, 2.1, 7.25])) < 1e-4, "lamps: the bulb hangs at its fixture")
	var dark := lamps.bulb("living-3")
	_check(not (dark.get_node("Glow") as Node3D).visible, "lamps: a dark fixture has no glow")
	var lit2 := lamps.bulb("living-2")
	_check((lit2.get_node("Glow") as Node3D).visible, "lamps: a lit one glows")
	var bulb_mat := (lit2.get_node("Bulb") as MeshInstance3D).material_override as StandardMaterial3D
	_check(bulb_mat.albedo_color.b > bulb_mat.albedo_color.r and bulb_mat.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED, "lamps: … in its colour, unshaded")
	_check(lamps.bulb_level("living-2") == 0.5 and lamps.bulb_level("living-1") == 0.8, "lamps: a pulse starts at full")
	lamps.step(1.0)
	_check(_near(lamps.bulb_level("living-1"), 0.8 * 0.35) and lamps.bulb_level("living-2") == 0.5, "lamps: the pulsed one breathes, the other holds (%f)" % lamps.bulb_level("living-1"))

	# The lobby: no real lights, today's ambient.
	_check(lamps.pool.all(func(l: OmniLight3D) -> bool: return not l.visible), "lamps: outside the house the pool is dark")
	_check(_near(env.ambient_light_energy, HouseLights.DAY_AMBIENT), "lamps: … and the ambient is today's")

	# In the living room: the lit fixtures on the main floor, nearest first.
	lamps.in_house = true
	lamps.feet = func() -> Array: return [-1.0, 0.0, 7.0]
	lamps.step(0.3)
	var on := {}
	for i in lamps.pool.size():
		if lamps.pool[i].visible:
			on[lamps.slots[i]] = lamps.pool[i]
	_check(on.keys().size() == 3 and on.has("living-1") and on.has("living-2") and on.has("kitchen-1"), "lamps: the pool lights the lit fixtures on the player's floor (%s)" % [on.keys()])
	_check(not on.has("ram-1") and not on.has("living-3"), "lamps: … never the basement's or a dark one")
	var l2: OmniLight3D = on.get("living-2")
	_check(l2 != null and _near(l2.light_energy, HouseLamps.LIGHT_ENERGY * 0.5) and l2.light_color.is_equal_approx(Color("#4080ff")), "lamps: a pool light carries its fixture's colour × level")
	_check(l2 != null and l2.global_position.distance_to(b.to_world([2.0, 2.1 - HouseLamps.LIGHT_DROP, 7.25])) < 1e-4, "lamps: … just under the fixture")
	var before := env.ambient_light_energy
	_check(before < HouseLights.DAY_AMBIENT and sun.light_energy < HouseLights.DAY_SUN, "lamps: in the house with a frame, the ambient dims (%f)" % before)
	for i in 40:
		lamps.step(0.25)
	var night := HouseLights.ambient(frame)
	_check(_near(env.ambient_light_energy, night["energy"], 0.01) and env.ambient_light_energy >= HouseLights.NIGHT_AMBIENT, "lamps: … easing to the frame's night (%f → %f)" % [env.ambient_light_energy, night["energy"]])

	# A light keeps its fixture while it stays picked.
	var slot_of_1 := lamps.slots.find("living-1")
	lamps.feet = func() -> Array: return [2.0, 0.0, 10.0]
	lamps.step(0.3)
	_check(lamps.slots.find("living-1") == slot_of_1, "lamps: a picked fixture keeps its light")
	# Down the stairs: the basement's.
	lamps.feet = func() -> Array: return [-4.0, -2.7, 10.0]
	lamps.step(0.3)
	var down: Array = lamps.slots.filter(func(id: String) -> bool: return id != "")
	_check(down == ["ram-1"], "lamps: in the basement, the basement's fixtures (%s)" % [down])

	# A new frame drops a fixture that went; the pool never resizes.
	var less := frame.duplicate(true)
	(less["lights"] as Array).remove_at(4)
	lamps.apply(less)
	_check(lamps.bulb("ram-1") == null and not lamps.slots.has("ram-1") and lamps.pool.size() == 4, "lamps: a fixture that left the frame loses its bulb and light")
	# A rebuild (a map save) puts the bulbs back on their fixtures.
	b.build(house)
	_check(lamps.bulb("living-2").global_position.distance_to(b.to_world([2.0, 2.1, 7.25])) < 1e-4, "lamps: a rebuild keeps the bulbs on their fixtures")

	# The frame gone (the link lost): back to today's house.
	lamps.apply({})
	for i in 40:
		lamps.step(0.25)
	_check(lamps.bulb_ids().is_empty() and _near(env.ambient_light_energy, HouseLights.DAY_AMBIENT, 0.01) and _near(sun.light_energy, HouseLights.DAY_SUN, 0.01), "lamps: no frame, no bulbs, the ambient back to today's")
	_check(lamps.pool.all(func(l: OmniLight3D) -> bool: return not l.visible), "lamps: … and the pool dark")

	# Tiers: 2 and 6.
	lamps.set_tier("low")
	_check(lamps.pool.size() == 2, "lamps: low pools 2")
	lamps.set_tier("high")
	_check(lamps.pool.size() == 5, "lamps: high pools 5")
	lamps.queue_free()
	b.queue_free()
	sun.queue_free()
	await process_frame


## The game: main wires the tier, the environment, the sun and the frame.
func _test_house_lamps_game() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset", "intro": false, "trail_delay": 0, "graphics": "high"})
	link.house = house
	link.house_version = "test"
	link._adopt_lights(_lights_frame())
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	var player := game.player
	player.set_process(false)
	player.set_physics_process(false)
	player.read_input = false
	game.clock = func() -> float: return _now
	var env: Environment = (main.get_node("WorldEnvironment") as WorldEnvironment).environment
	_check(env.glow_enabled and env.tonemap_mode == Environment.TONE_MAPPER_ACES and game.world_env == env, "lamps game: high glows and tone-maps; the game has the environment")
	_check(main.get_viewport().msaa_3d == Viewport.MSAA_2X, "lamps game: high turns MSAA on")
	_check(game.lamps != null and game.lamps.pool.size() == 5 and game.lamps.bulb_ids().size() == 5, "lamps game: a frame already in is drawn; high pools 5")
	game._process(0.016)
	_check(not game.lamps.in_house and _near(env.ambient_light_energy, HouseLights.DAY_AMBIENT, 1e-3), "lamps game: the lobby keeps today's ambient")
	link.assignment_received.emit(_assignment(house, "lamps-1", true))
	game._process(0.016)
	_check(game.state() == GameFlow.State.PLAYING and game.lamps.in_house, "lamps game: walking the house, the lamps follow")
	for i in 20:
		game._process(0.25)
		game.lamps.step(0.25)
	_check(env.ambient_light_energy < HouseLights.DAY_AMBIENT - 0.05, "lamps game: … the ambient dims (%f)" % env.ambient_light_energy)
	var f2 := _lights_frame()
	(f2["lights"] as Array).resize(1)
	link._adopt_lights(f2)
	_check(game.lamps.bulb_ids() == ["living-1"], "lamps game: a new frame on the link reaches the lamps")
	link.session_over.emit("test")
	main.queue_free()
	await process_frame
	await process_frame
	HouseLook.set_tier("medium")
	root.msaa_3d = Viewport.MSAA_DISABLED
