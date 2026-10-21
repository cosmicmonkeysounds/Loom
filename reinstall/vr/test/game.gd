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
	_test_avatar_decode()
	_test_config()
	_test_config_setup()
	_test_sse_parser()
	_test_pose_pump()
	await _test_server_link()
	_test_locomotion()
	_test_picker()
	_test_picker_grid()
	_test_flow()
	_test_cam_feeds()
	await _test_cam_panels()
	_test_autopilot()
	await _test_main_and_game()
	_test_lobby_geometry()
	_test_lobby_pure()
	_test_server_link_setup()
	await _test_lobby_picker()
	await _test_setup_panel()
	await _test_autopilot_physics()
	await _test_room_scale()

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
	_check(AvatarCache.decode(gif) == null and AvatarCache.decode(avif) == null, "avatar: gif and avif stay on the capsule")
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
	_check(StationConfig.parse_args(PackedStringArray(["--smooth-turn"])).get("smooth_turn") == true, "config: --smooth-turn")

	var dir := "user://config-test"
	DirAccess.make_dir_recursive_absolute(dir)
	var a := dir + "/a.json"
	var b := dir + "/b.json"
	_write(a, {"server": "http://a:1", "code": "AAA", "station": "vr-a", "name": "From A"})
	_write(b, {"code": "BBB", "name": "  ", "smooth_turn": true})
	var cfg := StationConfig.resolve([a, b, dir + "/missing.json"], PackedStringArray(["--station", "vr-cli"]))
	_check(cfg["server"] == "http://a:1", "config: res file applies over the defaults")
	_check(cfg["code"] == "BBB", "config: the user file overrides the res file")
	_check(cfg["name"] == "From A", "config: an empty string never overrides")
	_check(cfg["station"] == "vr-cli", "config: the command line overrides both files")
	_check(cfg["smooth_turn"] == true, "config: booleans merge")
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
	_check(StationConfig.save_user({"name": "Headset 2", "smooth_turn": true}, path), "setup file: saved again")
	back = StationConfig.read_file(path)
	_check(back.get("code") == "K7PQ3M" and back.get("name") == "Headset 2" and back.get("smooth_turn") == true, "setup file: a second save merges over the first (%s)" % [back])
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
	_check(failed.size() == 2 and str(failed[1]) == "Not marked for reinstallation — until the night is over, only a marked program may play." and sl.get("phase") == "ready", "link: a begin 409 (not marked) says why (%s)" % [failed])
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
	_check(_near(Locomotion.smooth_turn(1.0, 0.5), -45.0), "loco: smooth turn right lowers the yaw")

	var snap := Locomotion.SnapTurn.new()
	var seq := [snap.update(0.7), snap.update(0.9), snap.update(0.4), snap.update(0.8), snap.update(0.2), snap.update(-0.9)]
	_check(seq == [-45.0, 0.0, 0.0, 0.0, 0.0, 45.0], "loco: snap fires once per flick, re-arms under 0.3 (%s)" % [seq])

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
	player.set_physics_process(false)
	_check(game.autopilot != null and not player.read_input, "autopilot: --autopilot drives the sticks")
	var dt := 1.0 / 90.0
	var missed: Array = []
	var spots: Array = house["duck"]["spots"]
	for i in spots.size():
		var spot: Dictionary = spots[i]
		var a := _assignment(house, "s-ap%d" % i, true)
		a["duck"] = spot
		link.assignment_received.emit(a)
		var calls: int = link.found_calls
		var steps := 0
		while link.found_calls == calls and steps < 90 * 60:
			game._process(dt)
			player._physics_process(dt)
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
		player._physics_process(dt)
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
		player._physics_process(dt)
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
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Room Scale"})
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
			player._physics_process(dt)
		var feet := b.to_house(player.feet())
		var room: Variant = HouseLocate.locate(house, feet)["room"]
		if str(room) != spawn_room or player.head_gap() > VrPlayer.MAX_HEAD_GAP + 0.01:
			through.append("%s: feet %s in %s, head %.2f m off the body" % [dir, feet, room, player.head_gap()])
	_check(through.is_empty(), "room scale: a real step into a wall never takes the head or the feet through it %s" % [through])

	# Walk the headset 2 m up the basement stairs (a 35° ramp, north).
	player.teleport(b.to_world([-2.4, -2.7, 10.8]), b.yaw_to_world(0.0))
	for i in 180:
		player.camera.global_position += Vector3(0, 0, -2.0 / 180.0)
		player._physics_process(dt)
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
	# Pins terminal coordinates, so it walks the frozen placeholder map.
	var house: Dictionary = _placeholder_house()
	var all := ["optical-drive", "hall", "desktop-tv", "start-bar", "ram", "server-room", "nowhere"]
	var feet := [0.0, 0.0, 5.0]
	_check(CamFeeds.spots_to_poll(house, all, feet) == ["optical-drive", "start-bar", "hall", "desktop-tv"], "cams: the listed terminals on my floor, nearest first, at most four (%s)" % [CamFeeds.spots_to_poll(house, all, feet)])
	_check(CamFeeds.spots_to_poll(house, all, feet, 12.0, 2) == ["optical-drive", "start-bar"], "cams: … capped")
	_check(CamFeeds.spots_to_poll(house, all, feet, 5.5) == ["optical-drive", "start-bar"], "cams: … within reach in plan")
	_check(CamFeeds.spots_to_poll(house, [{"spot": "hall", "at": 1}, {"spot": "ram"}], feet) == ["hall"], "cams: list entries by spot; another floor's terminal is not polled")
	_check(CamFeeds.spots_to_poll(house, all, [7.0, -2.7, 9.0]).has("ram") and not CamFeeds.spots_to_poll(house, all, [7.0, -2.7, 9.0]).has("hall"), "cams: in the basement, the basement's terminals")
	_check(CamFeeds.spots_to_poll(house, [], feet).is_empty() and CamFeeds.spots_to_poll(house, all, []).is_empty(), "cams: nothing listed or no feet → nothing")

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
	var feet := [0.0, 0.0, 5.0]
	var base := "fixture://e/e1/api/spatial"
	var urls := func() -> Array: return asked.map(func(e: Array) -> String: return e[0])

	c.tick(0.016, house, feet, base, "sess")
	_check(lists.size() == 1 and asked.is_empty() and lists[0][0] == base + "/cams" and lists[0][1] == "sess", "cams: the list first, with the token (%s)" % [lists])
	c.tick(0.016, house, feet, base, "sess")
	_check(lists.size() == 1, "cams: one list call in flight")
	(lists[0][2] as Callable).call(200, PackedStringArray(), JSON.stringify({"cams": [{"spot": "optical-drive", "at": 1, "w": 160, "h": 120}, {"spot": "ram", "at": 1, "w": 160, "h": 120}]}).to_utf8_buffer())
	asked.clear()
	c.tick(0.016, house, feet, base, "sess")
	_check(asked.size() == 1 and asked[0][0] == base + "/cam?spot=optical-drive", "cams: a frame for the listed feed on my floor, not the basement's (%s)" % [urls.call()])
	c.tick(0.016, house, feet, base, "sess")
	_check(asked.size() == 1, "cams: one frame request per spot in flight")
	(asked[0][2] as Callable).call(200, PackedStringArray(["x-cam-at: 1"]), _jpeg(160, 120, Color.RED))
	_check(c.is_shown("optical-drive") and b.cam_shown("optical-drive") and not b.cam_shown("hall"), "cams: a frame puts the feed on the terminal")
	var root_node := b.get_node("Terminal_optical-drive") as Node3D
	_check(not (root_node.get_node("Glass") as Node3D).visible and (root_node.get_node("Feed/Video") as MeshInstance3D).mesh.size == HouseBuilder.CAM_SIZE, "cams: … a 4:3 panel in place of the screen")
	var mat := (root_node.get_node("Feed/Video") as MeshInstance3D).material_override as StandardMaterial3D
	_check(mat.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED and is_same(mat.albedo_texture, c.texture("optical-drive")), "cams: … unshaded, showing the feed's texture")
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
	_check(not c.is_shown("optical-drive") and not b.cam_shown("optical-drive") and (b.get_node("Terminal_optical-drive/Glass") as Node3D).visible, "cams: a 404 puts the terminal's screen back")
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
	c.tick(0.016, house, [0.0, 0.0, 30.0], base, "sess")
	_check(not b.cam_shown("optical-drive") and c.polling().is_empty(), "cams: out of range, the feed is dropped")
	_check(lists.size() == 2, "cams: the list is asked again every two seconds (%d)" % lists.size())
	(lists[1][2] as Callable).call(500, PackedStringArray(), PackedByteArray())
	c.tick(1.9, house, [0.0, 0.0, 30.0], base, "sess")
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
		var root_node := b.get_node_or_null("Terminal_%s" % t["id"]) as Node3D
		var glass := b.get_node_or_null("Terminal_%s/Glass" % t["id"]) as Node3D
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
	var kitchen := b.get_node_or_null("Terminal_start-bar/Glass") as Node3D
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
## bytes land; an `avatar` frame changes it; no key → the plain capsule.
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
	_check(g.picture_url("nokey") == "" and g.picture_url("old") == "" and not g.has_picture("nokey") and not g.has_picture("old"), "ghosts: no key (null, or an old server's missing field) → the plain capsule")
	_check(asked.size() == 2 and g.avatars.in_flight() == 2, "ghosts: two picture requests at a time (%d)" % asked.size())
	_check(not g.has_picture("excel"), "ghosts: … no head before the bytes land")
	(asked[0][1] as Callable).call(true, ok_headers, png)
	_check(g.has_picture("excel"), "ghosts: the picture lands as a head")
	var pic: Sprite3D = null
	for c in g.get_children():
		if c.get_node_or_null("Picture") != null:
			pic = c.get_node("Picture")
	_check(pic != null and pic.billboard == BaseMaterial3D.BILLBOARD_ENABLED and _near(pic.pixel_size * AvatarCache.TILE, Ghosts.PICTURE_SIZE) and pic.texture.get_width() == AvatarCache.TILE, "ghosts: … a billboard square, %.2f m" % Ghosts.PICTURE_SIZE)
	_check(asked.size() == 3 and str(asked[2][0]) == "fixture://avatar/cccc", "ghosts: the third request goes once one lands")
	(asked[1][1] as Callable).call(false, PackedStringArray(), PackedByteArray())  # word: a 404
	var gif := "GIF89a".to_ascii_buffer()
	gif.append_array(PackedByteArray([1, 0, 1, 0, 0]))
	(asked[2][1] as Callable).call(true, PackedStringArray(["Content-Type: image/gif"]), gif)  # paint: a GIF
	_check(not g.has_picture("word") and not g.has_picture("paint") and g.avatars.has_failed("fixture://avatar/bbbb") and g.avatars.has_failed("fixture://avatar/cccc"), "ghosts: a failed or undecodable picture leaves the capsule")

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
	var text := b.get_node("Prop_%s/Health/HealthText" % kid) as Label3D
	var bar := b.get_node("Prop_%s/Health/HealthBar" % kid) as Sprite3D
	_check((b.get_node("Prop_%s/Health" % kid) as Node3D).visible and text.text == "THE KING  15 / 15" and bar.texture != null, "game king: the shared bar over him (%s)" % text.text)
	_check(not b.king_kneeling(kid) and b.door_shut("server-door"), "game king: … standing, his door shut")

	link.assignment_received.emit(_assignment(house, "s-3k", true))
	game.hud.notice("")
	player.teleport(b.to_world(east), b.yaw_to_world(0.0))  # beside him, looking north
	game._process(0.016)
	_check(sub.text == Game.KING_NOTICE, "game king: near him the HUD says how to hit him (%s)" % sub.text)
	_check(Game.KING_NOTICE == "Pull the trigger to hit the King — once per visit.", "game king: the notice's words")
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
		player._physics_process(1.0 / 90.0)
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
		player._physics_process(1.0 / 90.0)
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
		player._physics_process(1.0 / 90.0)
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


func _test_main_and_game() -> void:
	var house: Dictionary = _placeholder_house()
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
	_check(game != null and game.builder != null, "main: the game is set up")
	if game == null or game.builder == null:
		return

	# Smoke: the house is built from the map.
	var b := game.builder
	_check(b.walls.size() == HouseGeometry.build_walls(house).size() and not b.walls.is_empty(), "main: the walls are built (%d)" % b.walls.size())
	var colliders := b.get_node_or_null("Colliders")
	_check(colliders != null and colliders.get_child_count() > b.walls.size(), "main: walls, floors and props collide")
	_check(b.get_node_or_null("Floor") != null and b.get_node_or_null("Ceilings") != null and b.get_node_or_null("Walls_wall") != null, "main: floor, ceiling and wall meshes")
	for s: Dictionary in house["stairs"]:
		_check(b.get_node_or_null("Ramp_%s" % s["id"]) != null, "main: ramp %s" % s["id"])
	for t: Dictionary in house["terminals"]:
		_check(b.get_node_or_null("Terminal_%s" % t["id"]) != null, "main: terminal screen %s" % t["id"])
	# The King (a `king` prop) stands at the cold door, solid, with a crown;
	# with no shared King (an old server) he has no bar; his door's leaf is shut.
	var king_prop: Dictionary = {}
	for pr: Dictionary in house["props"]:
		if str(pr.get("kind", "")) == "king":
			king_prop = pr
	_check(not king_prop.is_empty() and b.get_node_or_null("Prop_%s" % king_prop.get("id", "")) != null, "main: the king stands at the cold door")
	_check(not king_prop.is_empty() and HouseGeometry.prop_solid(king_prop), "house: the king is solid")
	_check(not king_prop.is_empty() and b.get_node_or_null("Prop_%s" % king_prop.get("id", "")).get_child_count() >= 3, "main: the king has a body, a crown and his name")
	var health := b.get_node_or_null("Prop_%s/Health" % king_prop.get("id", "")) as Node3D
	_check(health != null and not health.visible, "main: no shared King, no health bar over him")
	_check(b.door_shut("server-door") and b.get_node_or_null("Door_server-door") != null, "main: the door he guards has a shut leaf")
	for r: Dictionary in house["rooms"]:
		_check(b.get_node_or_null("Label_%s" % r["id"]) != null, "main: room label %s" % r["id"])
	_test_builder_geometry(b, house)
	_check(game.state() == GameFlow.State.LOBBY, "game: starts in the lobby")

	var player := game.player
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
	player.right_stick = Vector2.ZERO
	game._process(1.0 / 60.0)

	# An assignment arrives: play.
	var a := _assignment(house, "s-1", true)
	link.assignment_received.emit(a)
	_check(game.state() == GameFlow.State.PLAYING and link.adopted.size() == 1, "game: an assignment starts play")
	var spawn: Array = house["spawn"]["pos"]
	_check(_v3(player.feet(), HouseFrames.vec(spawn)), "game: the player spawns at the spawn (%s)" % player.feet())
	_check(_near(HouseFrames.wrap_yaw(player.head_yaw() - float(house["spawn"]["yaw"])), 0.0), "game: facing the spawn yaw")
	_check(game.duck.visible and _v3(game.duck.global_position, HouseFrames.vec(a["duck"]["pos"])), "game: the duck sits on its spot")
	game._process(0.016)
	_check(not link.poses.is_empty() and _diff(link.poses.back()["p"], spawn) == "", "game: poses go out as house-frame feet")
	_check(game.trail.count() > 0, "game: the golden trail is laid (%d chevrons)" % game.trail.count())
	var spawn_room: Dictionary = HouseGeometry.room_by_id(house, house["spawn"]["room"])
	_check(game.hud.room_text() == str(spawn_room["label"]), "game: the HUD names the room")
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
	game._process(GameFlow.CELEBRATE + 0.1)
	_check(game.state() == GameFlow.State.LOBBY and link.ended == ["found"], "game: after the celebration the session ends → lobby")
	_check(game.cams.polling().is_empty(), "game: the session's end stops the camera feeds")
	link.set("cams_base", "")
	game.cams.requester = Callable()

	# Not captured: "YOU FOUND GERALD".
	link.assignment_received.emit(_assignment(house, "s-2", false))
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

	# Headset off, on a wall clock (a sleeping Quest runs no frames).
	game.clock = func() -> float: return _now
	link.assignment_received.emit(_assignment(house, "s-4", true))
	game.presence_changed(false)
	_now += 1.0
	game._process(0.016)
	game.presence_changed(true)
	_now += 5.0
	game._process(0.016)
	_check(game.state() == GameFlow.State.PLAYING, "game: headset back within the grace keeps playing")
	game.presence_changed(false)
	_now += Game.PRESENCE_GRACE + 0.1
	game._process(0.016)
	_check(game.state() == GameFlow.State.LOBBY and link.ended.back() == "headset", "game: headset off past the grace ends the session")

	link.assignment_received.emit(_assignment(house, "s-4b", true))
	var ended_before: int = link.ended.size()
	game.presence_changed(false)
	_now += 60.0  # asleep: no frame at all
	game.presence_changed(true)  # the next wearer puts it on
	_check(game.state() == GameFlow.State.LOBBY and link.ended.size() == ended_before + 1, "game: a headset handed on after the grace starts in the lobby (no frame needed)")

	link.assignment_received.emit(_assignment(house, "s-4c", true))
	game.presence_changed(false)
	_now += 1.0
	game.focus_changed(true)  # focus back, headset still off
	_now += 1.5
	game._process(0.016)
	_check(game.state() == GameFlow.State.LOBBY, "game: focus coming back never cancels a headset-off countdown")

	link.assignment_received.emit(_assignment(house, "s-4d", true))
	game.focus_changed(false)
	_now += Game.UNFOCUSED_GRACE - 1.0
	game.focus_changed(true)
	game._process(0.016)
	_check(game.state() == GameFlow.State.PLAYING, "game: a system menu shorter than its grace keeps playing")
	game.app_paused()
	_now += 30.0
	game.app_resumed()
	_check(game.state() == GameFlow.State.LOBBY, "game: resuming from a pause past the grace ends the session")

	link.assignment_received.emit(_assignment(house, "s-4e", true))
	game.headset_gone()
	_check(game.state() == GameFlow.State.LOBBY and link.ended.back() == "headset", "game: the XR session stopping ends it at once")

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

	# The snap turn closes the vignette on its own frame.
	link.assignment_received.emit(_assignment(house, "s-4g", true))
	player.right_stick = Vector2.ZERO
	player._physics_process(1.0 / 72.0)
	var yaw0 := player.head_yaw()
	player.right_stick = Vector2(1, 0)
	player._physics_process(1.0 / 72.0)
	_check(_near(HouseFrames.wrap_yaw(player.head_yaw() - yaw0), -45.0) and player.vignette_strength() >= 0.8, "player: a snap turn closes the vignette on the same frame (%.2f)" % player.vignette_strength())
	player.right_stick = Vector2.ZERO
	for i in 36:
		player._physics_process(1.0 / 72.0)
	_check(player.vignette_strength() < 0.05, "player: … and it opens again within half a second (%.2f)" % player.vignette_strength())
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
	_check(not LobbyPointer.takes_beam(rest, rest.translated(Vector3(0.01, 0, 0))), "pointer: a hand resting still keeps off the beam")
	_check(LobbyPointer.takes_beam(rest, rest.translated(Vector3(0.05, 0, 0))), "pointer: a hand that moves takes the beam")
	_check(LobbyPointer.takes_beam(rest, Transform3D(Basis(Vector3.UP, deg_to_rad(6.0)), Vector3.ZERO)) and not LobbyPointer.takes_beam(rest, Transform3D(Basis(Vector3.UP, deg_to_rad(2.0)), Vector3.ZERO)), "pointer: … or turns past 4°")
	_check(LobbyPointer.trigger_down(false, 0.9, false) and not LobbyPointer.trigger_down(false, 0.6, false) and LobbyPointer.trigger_down(true, 0.6, false) and not LobbyPointer.trigger_down(true, 0.3, false) and LobbyPointer.trigger_down(false, 0.0, true), "pointer: the trigger with hysteresis (a click is a pull)")


## The tiles' and the SET UP panel's pure helpers.
func _test_lobby_pure() -> void:
	_check(Lobby.initials_of("MS Paint") == "MP" and Lobby.initials_of("Excel") == "E" and Lobby.initials_of("") == "?", "lobby: initials for a tile with no picture")
	_check(Lobby.tile_name({"name": "Microsoft Internet Explorer 6"}).length() == Lobby.NAME_CHARS and Lobby.tile_name({"id": "g-1"}) == "g-1", "lobby: long names are cut on their tile")
	_check(SetupPanel.code_text("K7P") == "PASSCODE  K7P···" and SetupPanel.code_char("k") == "K" and SetupPanel.code_char("!") == "" and SetupPanel.code_char("0") == "0", "setup: the passcode field + what a key may type")
	_check(SetupPanel.key_ids().size() == SetupPanel.ALPHABET.length() + 2 and SetupPanel.key_center(0).y > SetupPanel.key_center(SetupPanel.KEYS_PER_ROW).y, "setup: the keyboard is the passcode alphabet, ⌫ and SPACE, in rows")
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
	var choices := sl.server_choices()
	_check(not choices.is_empty() and choices[0]["url"] == "https://app.mapsandducks.com" and choices.back()["url"] == StationConfig.LOCAL_SERVER, "setup link: the committed server, then this computer (%s)" % [choices])
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
	_check(answers.back() == [false, "That isn't a moderator passcode."], "setup link: an unknown code is no moderator passcode")
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
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Test Headset"})
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	var lobby := game.lobby
	var player := game.player
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
	link.assignment_received.emit(_assignment(game.builder.house, "s-tab", true))
	_check(game.state() == GameFlow.State.PLAYING and link.begun.size() == 2, "lobby: the tablet's program still lands with the card up")
	link.session_over.emit("test")
	_check(game.state() == GameFlow.State.LOBBY and lobby.view() == "pick" and lobby.confirming().is_empty(), "lobby: … and the lobby comes back to the tiles, no card")

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
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Headset"})
	link.set("unconfigured", true)
	var main: Node = load("res://main.tscn").instantiate()
	main.set("link", link)
	root.add_child(main)
	main.add_child(link)
	await process_frame
	var game: Game = main.get("game")
	var lobby := game.lobby
	game.player.set_physics_process(false)
	game.player.read_input = false
	game._process(0.016)
	var panel := lobby.setup_panel()
	_check(lobby.view() == "setup" and panel.visible and not (lobby.get("_grid") as Node3D).visible, "setup: an unconfigured headset shows SET UP THIS HEADSET")
	_check(panel.choices.size() == 2 and panel.server_index == 0 and panel.station == "Headset", "setup: the link's servers, the first chosen; the name starts as Headset")
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
	tap.call(Vector2(-0.42, SetupPanel.ACTION_Y))
	_check(setups.size() == 1, "setup: … once")
	link.call("answer_setup", false, "That isn't a moderator passcode.")
	var msg: Label3D = panel.get("_message")
	_check(not panel.busy and msg.text == "That isn't a moderator passcode." and lobby.view() == "setup" and panel.code == "K7PQ3M", "setup: a refusal says why and keeps the passcode")
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
