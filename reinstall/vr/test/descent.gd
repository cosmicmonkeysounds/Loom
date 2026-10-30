## Headless checks for the descent (wave 49, `docs/loom-w49-contract.md` C6):
## the ports against `descent.json` and `models.json`' rules, the runner over
## a seeded plan and its holds, every vision of C2, the talkers and their panel
## through `pointer.inject`, the Hallway (its way in, its retreat, its timeout,
## a session end and a remap inside), small / big, and the autopilot finding
## the duck at the deepest level. Run by `test/run.sh`.
##
##   godot --headless --path . --xr-mode off --script res://test/descent.gd -- --offline
extends SceneTree

const TOL := 1e-3
const DT := 1.0 / 72.0

var _failures := 0
var _checks := 0


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	if not root.is_node_ready():
		await process_frame
	_test_port_golden()
	_test_port_constants()
	_test_port_script()
	_test_comfort_rules()
	_test_models()
	_test_config()
	_test_combo()
	_test_server_link()
	await _test_lobby_combos()
	await _test_level_zero()
	await _test_level_choice()
	await _test_look()
	await _test_runner()
	await _test_visions()
	await _test_self()
	await _test_small_big()
	await _test_xr_scale()
	await _test_talk()
	await _test_talk_marks()
	await _test_talk_and_king()
	await _test_hallway()
	await _test_hallway_timeout()
	await _test_hallway_session_end()
	await _test_hallway_remap()
	await _test_hallway_walked()
	await _test_autopilot()
	await _test_offline_mirror()
	await _test_bounds()
	print("reinstall-vr descent: %d checks, %d failures" % [_checks, _failures])
	quit(1 if _failures > 0 else 0)


func _check(condition: bool, name: String) -> void:
	_checks += 1
	if not condition:
		_failures += 1
		printerr("  FAIL  %s" % name)


static func _near(a: float, b: float, tol := TOL) -> bool:
	return absf(a - b) <= tol


static func _read_json(path: String) -> Variant:
	return JSON.parse_string(FileAccess.get_file_as_string(path))


static func _same(a: Variant, b: Variant) -> bool:
	if (a is float or a is int) and (b is float or b is int):
		return _near(float(a), float(b))
	if a is Array and b is Array:
		if a.size() != b.size():
			return false
		for i in a.size():
			if not _same(a[i], b[i]):
				return false
		return true
	if a is Dictionary and b is Dictionary:
		for k: Variant in b:
			if not a.has(k) or not _same(a[k], b[k]):
				return false
		return true
	if a == null or b == null:
		return a == null and b == null
	return typeof(a) == typeof(b) and a == b


# --- the ports ---------------------------------------------------------------------


func _test_port_golden() -> void:
	var want: Array = _read_json("res://test/golden/descent.json")
	var house: Dictionary = _read_json("res://house/house.json")
	var words: Dictionary = _read_json("res://house/descent.json")
	var bad: Array = []
	var by_id := {}
	for p: Dictionary in house["props"]:
		by_id[p["id"]] = p
	var talker_by := {}
	for t: Dictionary in words["talkers"]:
		talker_by[t["id"]] = t
	for row: Dictionary in want:
		if row.has("look"):
			var l := HouseDescent.descent_look(int(row["look"]))
			if not _same(l, {"fog": row["fog"], "ambient": row["ambient"], "flicker": row["flicker"], "tint": row["tint"], "tintBy": row["tintBy"]}):
				bad.append("look %s" % row["look"])
		elif row.has("plan"):
			var plan := HouseDescent.descent_plan(str(row["plan"]), int(row["level"]))
			if plan.size() != int(row["count"]) or not _same(plan.slice(0, 12), row["head"]):
				bad.append("plan %s level %s: %d / %s" % [row["plan"], row["level"], plan.size(), JSON.stringify(plan.slice(0, 3))])
		elif row.has("wake"):
			var awake := HouseDescent.wake_talkers(house, words, int(row["level"]), str(row["wake"]))
			if not _same(awake, row["awake"]):
				bad.append("wake %s level %s: %s" % [row["wake"], row["level"], awake])
		elif row.has("face"):
			var a := HouseDescent.face_anchor(by_id[row["face"]])
			if not _same(a, {"pos": row["pos"], "yaw": row["yaw"]}):
				bad.append("face %s" % row["face"])
		elif row.has("reach"):
			var p: Dictionary = by_id[row["reach"]]
			var far := [float(p["pos"][0]) + 3.2, float(p["pos"][1]), float(p["pos"][2])]
			if HouseDescent.talk_reach(house, row["feet"], p) != bool(row["near"]) or HouseDescent.talk_reach(house, far, p) != bool(row["far"]):
				bad.append("reach %s" % row["reach"])
		elif row.has("door"):
			var d: Variant = HouseDescent.door_spot(house, row["feet"], float(row["yaw"]))
			if not _same(d, row["at"]):
				bad.append("door %s yaw %s: %s ≠ %s" % [row["door"], row["yaw"], d, row["at"]])
		elif row.has("open"):
			var t: Dictionary = talker_by[row["open"]]
			var each: Array = []
			for o: Dictionary in t.get("opens", []):
				each.append(HouseDescent.open_node(t, o.get("told", {})))
			if HouseDescent.open_node(t, null) != str(row["none"]) or each != row["each"]:
				bad.append("open %s" % row["open"])
		elif row.has("pick"):
			var r: Variant = HouseDescent.pick_option(talker_by[row["pick"]], str(row["node"]), int(row["i"]))
			if not _same(r, {"to": row["to"], "tell": row["tell"], "vision": row["vision"]}):
				bad.append("pick %s %s %s: %s" % [row["pick"], row["node"], row["i"], r])
		else:
			bad.append("an unknown row: %s" % row)
	for i in mini(bad.size(), 6):
		printerr("        %s" % bad[i])
	_check(bad.is_empty() and want.size() >= 270, "port: descent.json (%d/%d match)" % [want.size() - bad.size(), want.size()])


## Every number and list `descent.ts` exports, read off the source itself when
## the monorepo is there (the golden pins behaviour; this pins the constants).
func _test_port_constants() -> void:
	var path := ProjectSettings.globalize_path("res://").path_join("../../house/src/descent.ts").simplify_path()
	if not FileAccess.file_exists(path):
		print("  skip  descent.ts is not here")
		return
	var src := FileAccess.get_file_as_string(path)
	var consts: Dictionary = (load("res://house/house_descent.gd") as GDScript).get_script_constant_map()
	var re := RegEx.create_from_string("export const ([A-Z_]+)(?:: [^=]+)? = (.+);")
	var bad: Array = []
	var seen := 0
	for m: RegExMatch in re.search_all(src):
		var k := m.get_string(1)
		if k == "TALKER_ID_PATTERN":
			continue
		var raw := m.get_string(2).replace(" as const", "")
		if raw.begins_with("{"):  # `{ flicker: 1, … }`: quote its keys.
			raw = RegEx.create_from_string("(\\w+):").sub(raw, "\"$1\":", true)
		var got: Variant = JSON.parse_string(raw)
		seen += 1
		if not consts.has(k) or not _same(consts[k], got):
			bad.append(k)
	_check(bad.is_empty() and seen >= 27, "port: the constants of descent.ts (%d read, wrong: %s)" % [seen, bad])


func _test_port_script() -> void:
	var words: Variant = HouseDescent.bundled()
	_check(words is Dictionary and (words as Dictionary)["talkers"].size() >= 20, "script: the bundled copy loads and validates")
	_check(FileAccess.get_file_as_string("res://export_presets.cfg").contains("house/*.json"), "script: the Quest preset ships it")
	var v := HouseDescent.validate_descent(_read_json("res://house/descent.json"))
	_check(v["ok"] and v["warnings"].is_empty(), "script: no problems, no warnings (%s)" % [v])
	_check(HouseDescent.parse_descent(null) == null and HouseDescent.parse_descent({"version": 2}) == null, "script: junk reads as none")
	var bad: Dictionary = (_read_json("res://house/descent.json") as Dictionary).duplicate(true)
	bad["talkers"][0]["nodes"]["start"]["options"][0]["to"] = "nowhere"
	_check(not bool(HouseDescent.validate_descent(bad)["ok"]), "script: an option to no node is refused")
	bad = (_read_json("res://house/descent.json") as Dictionary).duplicate(true)
	bad["talkers"][0]["nodes"]["start"]["do"] = "tea"
	_check(not bool(HouseDescent.validate_descent(bad)["ok"]), "script: an unknown vision is refused")
	var who := {"name": "Ada", "visit": 4}
	_check(HouseDescent.fill_line("{name}, {visit}, {nth}", who) == "Ada, 4, fourth", "script: fill_line")
	_check(HouseDescent.fill_line("{nth}", {"name": "", "visit": 13}) == "13th", "script: past twelve it counts in figures")
	_check(HouseDescent.pick_line(["a", "b", "c"], 4) == "b" and HouseDescent.pick_line(["a", "b"], -3) == "b" and HouseDescent.pick_line([], 1) == null and HouseDescent.pick_line(null, 1) == null, "script: pick_line wraps, and no list is no line")
	_check(HouseDescent.clamp_descent(9) == 4 and HouseDescent.clamp_descent(-1) == 0 and HouseDescent.clamp_descent("3") == 0 and HouseDescent.clamp_descent(2.7) == 2 and HouseDescent.clamp_descent(null) == 0, "script: clamp_descent")
	_check(HouseDescent.descent_of({"descent": 2.0, "reinstalled": 9}) == 2 and HouseDescent.descent_of({"reinstalled": 3}) == 3 and HouseDescent.descent_of({}) == 0, "script: the server's word, else its reinstalls, else clean")
	var plan := HouseDescent.descent_plan("s-x", 4)
	_check(HouseDescent.due_beat(plan, 0, 7.9) == -1 and HouseDescent.due_beat(plan, 0, 8.0) == 0, "script: the first beat at level 4 is due at 8 s")
	_check(HouseDescent.due_beat(plan, 0, 8.0 + HouseDescent.DESCENT_LATE_S + 1.0) != 0, "script: a beat held too long is passed over")
	_check(plan.filter(func(b: Dictionary) -> bool: return b["vision"] == "door").size() == 1 and str(plan[2]["vision"]) == "door", "script: one door, always the third")


func _test_comfort_rules() -> void:
	# Count falling edges in every window of a second: never more than 3.
	var worst := 0
	for start in range(0, 25):
		var t := start / 10.0
		var was := Descent.flicker_level(t)
		var edges := 0
		for i in 1000:
			var now := Descent.flicker_level(t + i / 1000.0)
			if now < was:
				edges += 1
			was = now
		worst = maxi(worst, edges)
	_check(worst >= 2 and worst <= 3, "comfort: the flicker dips at most 3 times a second (%d)" % worst)
	var gaps: Array = []
	for i in range(1, Descent.FLICKER_DIPS.size()):
		gaps.append(float(Descent.FLICKER_DIPS[i]) - float(Descent.FLICKER_DIPS[i - 1]))
	_check(gaps.min() >= 1.0 / 3.0, "comfort: its dips start at least a third of a second apart")
	for level in range(1, 5):
		var rate := float(HouseDescent.descent_look(level)["flicker"])
		var edges := 0
		var was := Descent.neon_level(0.0, rate)
		for i in 10000:
			var now := Descent.neon_level(i * 0.001, rate)
			if now < was:
				edges += 1
			was = now
		_check(edges <= 5, "comfort: the neon at level %d dips %d times in 10 s" % [level, edges])
	_check(Descent.neon_level(0.02, 1.0) == HouseModels.neon_flicker(0.02) and Descent.neon_level(3.0, 1.0) == 1.0, "comfort: level 0's neon is today's")
	_check(_near(Descent.eye_scale_at(0.0, 0.32), 1.0) and _near(Descent.eye_scale_at(1.0, 0.32), 0.32) and _near(Descent.eye_scale_at(1.0, 1.42), 1.42), "comfort: the eye eases from 1 to its target")


func _test_models() -> void:
	# The roles the new parts need; the golden itself is in game.gd.
	_check(HouseModels.PART_ROLES.has("wood") and HouseModels.PART_ROLES.has("flame"), "models: wood and flame are roles")
	_check(HouseModels.ROLE_COLORS["wood"] == "#7a5230" and HouseModels.ROLE_COLORS["flame"] == "#ff7a1a", "models: their colours")
	_check(HouseModels.GLOW_ROLES == ["screen", "alert", "flame"], "models: GLOW_ROLES")
	_check(HouseModels.PROP_MODELS.size() == 58 and HouseModels.prop_model("bbq")["kind"] == "cylinder", "models: the catalogue has the 35 new ones")
	for r: String in HouseModels.GLOW_ROLES:
		_check((HouseLook.role(r) as StandardMaterial3D).shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED, "models: %s is drawn glowing" % r)
	_check((HouseLook.role("wood") as StandardMaterial3D).shading_mode != BaseMaterial3D.SHADING_MODE_UNSHADED, "models: wood is lit")
	# A `from` prop never collides, and a level shows it.
	_check(not HouseGeometry.prop_solid({"kind": "box", "from": 2}) and not HouseGeometry.prop_solid({"kind": "box", "from": 2, "solid": true}) and HouseGeometry.prop_solid({"kind": "box"}), "models: a `from` prop is never solid")
	var house: Dictionary = _read_json("res://house/house.json")
	var b := HouseBuilder.new()
	b.build(house)
	var colliders := (b.get_node("Colliders") as Node).get_child_count()
	var total: int = b.from_shown()[1]
	_check(total > 0 and b.from_shown()[0] == 0, "models: every `from` mesh starts hidden (%d)" % total)
	_check(b.part("Prop_tea-party") != null, "models: a `from` prop keeps its Prop_<id> root")
	b.set_descent(2)
	var at2: int = b.from_shown()[0]
	b.set_descent(4)
	_check(at2 > 0 and at2 < total and b.from_shown()[0] == total, "models: a level shows its own and the shallower ones (%d at 2, %d at 4)" % [at2, total])
	var without: Dictionary = house.duplicate(true)
	without["props"] = (without["props"] as Array).filter(func(p: Dictionary) -> bool: return p.get("from") == null)
	var b2 := HouseBuilder.new()
	b2.build(without)
	_check((b2.get_node("Colliders") as Node).get_child_count() == colliders, "models: no `from` prop adds a collider")
	b2.free()
	b.build(house)
	_check(b.from_shown()[0] == total, "models: a rebuild keeps the level")
	b.set_descent(0)
	_check(b.from_shown()[0] == 0, "models: back to none")
	b.free()


func _test_config() -> void:
	_check(not StationConfig.defaults().has("descent"), "config: descent is unset by default")
	_check(StationConfig.resolve([], PackedStringArray(["--descent", "4"]))["descent"] == 4, "config: --descent 4")
	_check(StationConfig.resolve([], PackedStringArray(["--descent=2"]))["descent"] == 2, "config: --descent=2")
	_check(not StationConfig.resolve([], PackedStringArray(["--descent", "lots"])).has("descent") and not StationConfig.resolve([], PackedStringArray(["--descent"])).has("descent"), "config: junk is ignored")
	_check(StationConfig.merge(StationConfig.defaults(), {"descent": 3.0})["descent"] == 3 and not StationConfig.merge(StationConfig.defaults(), {"descent": -1}).has("descent"), "config: station.json's descent")


func _press(c: TestCombo, key: String) -> bool:
	var hit := c.feed(key == "A", key == "B", 0.3)
	c.feed(false, false, 0.0)
	return hit


func _test_combo() -> void:
	var c := TestCombo.new(TestCombo.MIRROR)
	var hit := false
	for k: String in TestCombo.MIRROR:
		hit = _press(c, k)
	_check(hit and TestCombo.MIRROR == "AABBABABBAA", "combo: the mirror fires")
	c = TestCombo.new(TestCombo.MIRROR)
	var other := false
	for k: String in TestCombo.SEQUENCE:
		other = _press(c, k) or other
	_check(not other, "combo: the plain sequence is not the mirror")
	var plain := TestCombo.new()
	var deep := TestCombo.new(TestCombo.MIRROR)
	var fired := []
	for k: String in TestCombo.MIRROR:
		if _press(plain, k):
			fired.append("plain")
		if _press(deep, k):
			fired.append("deep")
	_check(fired == ["deep"], "combo: fed together, only the one typed fires (%s)" % [fired])


## The lobby's two combos, through the game.
func _test_lobby_combos() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var typed := func(seq: String) -> bool:
		var hit := false
		for k: String in seq:
			hit = game.feed_combos(k == "A", k == "B", 0.3) or hit
			hit = game.feed_combos(false, false, 0.0) or hit
		return hit
	_check(typed.call(TestCombo.MIRROR), "lobby: the mirror starts the test level")
	_check(link.get("offline_chosen") == 1 and link.get("begun") == ["g-000001"], "lobby: offline, the captured program")
	link.assignment_received.emit(_assignment(house, "offline-1"))
	_check(game.descent.level == 4 and game.descent.who["visit"] == 5, "lobby: at level 4, its fifth walk")
	link.session_over.emit("test")
	_check(typed.call(TestCombo.SEQUENCE), "lobby: the plain combo starts it too")
	link.assignment_received.emit(_assignment(house, "offline-2"))
	_check(game.descent.level == 0 and not game.descent.running, "lobby: … as ever, the clean game")
	link.session_over.emit("test")
	await _end(main)


func _test_server_link() -> void:
	var sl: LinkBase = load("res://net/server_link.gd").new()
	sl.config = StationConfig.merge(StationConfig.defaults(), {"server": "http://x", "code": "1234"})
	var tr: Node = load("res://test/fake_transport.gd").new()
	sl.set("transport", tr)
	sl.set("phase", "ready")
	sl.set("event_id", "e1")
	sl.adopt({"session": "s-1", "token": "t-1", "houseVersion": ""})
	var got: Array = []
	sl.descent_loaded.connect(func(s: Variant) -> void: got.append(s))
	sl.fetch_descent()
	_check(tr.count("GET /e/e1/api/spatial/descent") == 1 and tr.calls.back()["token"] == "t-1", "link: fetch_descent asks with the session's token")
	var mine: Dictionary = (_read_json("res://house/descent.json") as Dictionary).duplicate(true)
	mine["grin"] = ["From the server."]
	tr.answer("/spatial/descent", 200, {"script": mine})
	_check(got.size() == 1 and got[0]["grin"] == ["From the server."] and sl.descent_script == got[0], "link: the server's script is taken")
	for answer: Array in [[404, {"error": "not found"}], [200, {"script": null}], [200, {"script": {"version": 9}}], [0, null], [500, "oops"]]:
		sl.descent_script = null
		sl.fetch_descent()
		tr.answer("/spatial/descent", answer[0], answer[1])
		_check(sl.descent_script is Dictionary and sl.descent_script == HouseDescent.bundled(), "link: %s falls back on the bundled script" % [answer])
	sl.fetch_descent()
	sl.adopt({"session": "s-2", "token": "t-2", "houseVersion": ""})
	var before := got.size()
	tr.answer("/spatial/descent", 200, {"script": mine})
	_check(got.size() == before, "link: an old session's late answer is dropped")
	sl.post_told("stove", "denied")
	_check(tr.count("POST /e/e1/api/spatial/told") == 1 and tr.calls.back()["body"] == {"talker": "stove", "mark": "denied"} and tr.calls.back()["token"] == "t-2", "link: post_told posts the mark on the session token")
	tr.answer("/spatial/told", 404, {})
	_check(sl.has_session(), "link: an old server's 404 on told ends nothing")
	sl.config["offline"] = true
	sl.descent_script = null
	sl.fetch_descent()
	_check(sl.descent_script == HouseDescent.bundled(), "link: offline uses the bundled script")
	tr.free()
	sl.free()


# --- the game ----------------------------------------------------------------------


func _game(extra := {}) -> Array:
	var house: Dictionary = _read_json("res://house/house.json")
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	var cfg := {"name": "Test Headset", "trail_delay": 0, "intro": false}
	cfg.merge(extra, true)
	link.config = StationConfig.merge(StationConfig.defaults(), cfg)
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


func _assignment(house: Dictionary, sid: String, more := {}) -> Dictionary:
	var a := {
		"session": sid, "token": "tok-" + sid, "guest": "g-aaaaaa", "name": "Ada", "world": "vr",
		"device": "Test Headset", "station": "vr-1", "captured": true,
		"duck": HouseDuck.pick_duck_spot(house, sid), "spawn": house["spawn"], "houseVersion": "test",
	}
	a.merge(more, true)
	return a


func _end(main: Node) -> void:
	main.queue_free()
	await process_frame


## The middle of a room, for a walking test.
static func _room_spot(house: Dictionary, id: String) -> Array:
	for r: Dictionary in house["rooms"]:
		if r["id"] == id:
			var b := HouseGeometry.poly_bounds(r["poly"])
			var y := HouseGeometry.room_elevation(house, r)
			return [(float(b[0]) + float(b[2])) / 2.0, y, (float(b[1]) + float(b[3])) / 2.0]
	return []


## Put the player at `p` (house frame) and advance `n` frames of `dt`.
func _at(game: Game, p: Array, yaw := 0.0) -> void:
	game.player.teleport(HouseFrames.vec(p), yaw)


func _frames(game: Game, n: int, dt := DT) -> void:
	for i in n:
		game._process(dt)
		game.speech.tick(dt)


func _test_level_zero() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var env: Environment = game.world_env
	var before := [env.fog_density, env.fog_light_color, env.background_color]
	link.assignment_received.emit(_assignment(house, "z-1"))
	game._process(DT)
	var d := game.descent
	_check(game.state() == GameFlow.State.PLAYING and not d.running and d.level == 0 and d.plan.is_empty(), "level 0: nothing runs on a first walk")
	_check(d.get_child_count() == 0 and game.hallway.get_child_count() == 0 and game.talk.get_child_count() == 0, "level 0: nothing is even built")
	_check(link.get("descent_fetches") == 0, "level 0: no script is asked for")
	_check(game.builder.from_shown()[0] == 0, "level 0: no `from` prop shows")
	_check(before == [env.fog_density, env.fog_light_color, env.background_color] and game.lamps.ambient_scale == 1.0 and game.lamps.tint_by == 0.0 and game.builder.neon_rate == 1.0, "level 0: the look is today's")
	_frames(game, 72 * 30, 1.0 / 72.0)
	_check(d.vision == "" and d.walk_t == 0.0, "level 0: thirty seconds on, still nothing")
	_check(not game.descent.trigger_taken(), "level 0: the trigger is the King's")
	link.session_over.emit("test")
	await _end(main)


func _test_level_choice() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	link.assignment_received.emit(_assignment(house, "c-1", {"reinstalled": 2.0}))
	_check(game.descent.level == 2 and game.descent.who["visit"] == 3, "level: the reinstalls behind it; `visit` is one more")
	_check(link.get("descent_fetches") == 1, "level: the walk asks for its words")
	_check(game.builder.from_shown()[0] > 0, "level: the `from` props of level 2 show")
	link.session_over.emit("test")
	_check(game.builder.from_shown()[0] == 0 and game.descent.level == 0, "level: the lobby shows none again")
	link.assignment_received.emit(_assignment(house, "c-2", {"reinstalled": 1.0, "descent": 3.0}))
	_check(game.descent.level == 3, "level: the server's forced word wins")
	link.session_over.emit("test")
	link.config["descent"] = 1
	link.assignment_received.emit(_assignment(house, "c-3", {"reinstalled": 4.0, "descent": 3.0}))
	_check(game.descent.level == 1, "level: `--descent` wins on this headset")
	link.session_over.emit("test")
	link.config.erase("descent")
	await _end(main)


func _test_look() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var env: Environment = game.world_env
	link.assignment_received.emit(_assignment(house, "l-1", {"descent": 4.0}))
	game._process(DT)
	var look := HouseDescent.descent_look(4)
	_check(_near(env.fog_density, HouseLook.FOG_DENSITY * float(look["fog"]), 1e-4), "look: the fog thickens (%.3f)" % env.fog_density)
	_check(_near(game.lamps.ambient_scale, float(look["ambient"])) and _near(game.lamps.tint_by, float(look["tintBy"])) and game.lamps.tint == Color(str(look["tint"])), "look: the ambient dims and tints")
	_check(_near(game.builder.neon_rate, float(look["flicker"])), "look: the neon stutters more often")
	_check(game.lamps.pool.size() == HouseLights.pool_size(HouseLights.DEFAULT_TIER), "look: the lamp pool stays fixed")
	link.session_over.emit("test")
	_check(_near(env.fog_density, HouseLook.FOG_DENSITY, 1e-4) and game.lamps.ambient_scale == 1.0 and game.lamps.tint_by == 0.0 and game.builder.neon_rate == 1.0, "look: the lobby has it all back")
	await _end(main)


func _test_runner() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var d := game.descent
	var seen: Array = []
	d.vision_started.connect(func(k: String) -> void: seen.append(k))
	link.assignment_received.emit(_assignment(house, "r-1", {"descent": 4.0}))
	var start := _room_spot(house, "hall")
	_at(game, start)
	# The first beat is due at 8 s.
	_frames(game, int(7.9 * 72))
	_check(seen.is_empty(), "runner: nothing before the plan's first beat (%.2f s)" % d.walk_t)
	_frames(game, 20)
	_check(seen.size() == 1 and seen[0] == d.plan[0]["vision"], "runner: the first beat fires on time (%s)" % [seen])
	# A vision that's running holds the next.
	var was := d.vision
	var at := d.walk_t
	while d.vision == was and d.walk_t < at + 40.0:
		_frames(game, 8)
	_check(d.vision == "" or d.vision != was, "runner: it ends in time")
	d.stop()
	link.session_over.emit("test")
	# Every hold, one by one: near the King, suspended, away.
	var prop := HouseKing.king_prop(house)
	link.assignment_received.emit(_assignment(house, "r-2", {"descent": 4.0}))
	var by_king: Array = [float(prop["pos"][0]), float(prop["pos"][1]), float(prop["pos"][2]) - 2.0]
	_check(game.descent_held(house, by_king), "runner: within 3 m of the King holds the beats")
	var far_off: Array = [float(prop["pos"][0]), float(prop["pos"][1]), float(prop["pos"][2]) - 3.5]
	_check(not game.descent_held(house, far_off), "runner: … past 3 m it doesn't")
	_check(not game.descent_held(house, [float(prop["pos"][0]), 0.0, float(prop["pos"][2]) - 1.0]), "runner: … nor a floor away")
	seen.clear()
	# Held through the first beat: not run; held past DESCENT_LATE_S: dropped.
	d.tick(house, far_off, true)
	d.walk_t = 8.5
	d.tick(house, far_off, true)
	_check(seen.is_empty() and d.get("_next") == 0, "runner: a held beat waits")
	d.walk_t = 8.0 + HouseDescent.DESCENT_LATE_S + 2.0
	var due := HouseDescent.due_beat(d.plan, 0, d.walk_t)
	d.tick(house, far_off, false)
	_check(due != 0 and d.get("_next") == (due + 1 if due > 0 else 0) and (due < 0 or seen.size() == 1), "runner: a beat held too long is dropped (next %s, ran %s)" % [d.get("_next"), seen])
	d._end_vision(false)
	# One at a time: two beats due together run one after the other.
	d.plan = [{"at": 0.0, "vision": "flicker", "n": 1}, {"at": 0.1, "vision": "whisper", "n": 1}]
	d.set("_next", 0)
	d.walk_t = 1.0
	seen.clear()
	var hall2 := _room_spot(house, "hall")
	_at(game, hall2)
	game._process(DT)
	game._process(DT)
	_check(seen == ["flicker"], "runner: one vision at a time (%s)" % [seen])
	_frames(game, int(2.8 * 72))
	_check(seen == ["flicker", "whisper"], "runner: the next when it is over (%s)" % [seen])
	link.session_over.emit("test")
	# A suspended walk holds, and an unreachable vision is skipped, not delayed.
	link.assignment_received.emit(_assignment(house, "r-3", {"descent": 4.0}))
	game.presence_changed(false)
	_check(game.descent_held(house, far_off), "runner: a suspended walk holds the beats")
	game.presence_changed(true)
	seen.clear()
	d.walk_t = float(d.plan[0]["at"])
	d.plan[0]["vision"] = "whiteduck"
	# Outside every room there is nowhere to stand it.
	d.tick(house, [-40.0, 0.0, -40.0], false)
	_check(seen.is_empty() and d.vision == "", "runner: a vision that can't be drawn is skipped, not delayed")
	_check(d.get("_next") == 1, "runner: … and the plan moves on")
	link.session_over.emit("test")
	await _end(main)


## Run vision `kind` from `feet`, frame by frame, to its end; `each` is called
## with the elapsed time.
func _play(game: Game, house: Dictionary, kind: String, feet: Array, each: Callable = Callable()) -> bool:
	var d := game.descent
	if not d._begin(kind, 7, house, feet):
		return false
	var t := 0.0
	while d.vision == kind and t < 60.0:
		game._process(DT)
		game.speech.tick(DT)
		t += DT
		if each.is_valid():
			each.call(t)
	return true


func _test_visions() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var d := game.descent
	var env: Environment = game.world_env
	link.assignment_received.emit(_assignment(house, "v-1", {"descent": 4.0}))
	d.plan = []  # only what these checks start
	# The middle of the hall, looking along its length.
	var hall := _room_spot(house, "hall")
	_at(game, hall, 180.0)
	game._process(DT)
	game.sfx.log.clear()
	game.speech.stop()

	# flicker: the lights dip and come back.
	var lows := {"min": 9.0}
	_check(_play(game, house, "flicker", hall, func(_t: float) -> void: lows["min"] = minf(lows["min"], game.lamps.ambient_scale)), "flicker: runs")
	_check(lows["min"] < 0.3 and _near(game.lamps.ambient_scale, 0.58), "flicker: the light dips (%.2f) and comes back (%.2f)" % [lows["min"], game.lamps.ambient_scale])

	# follower: steps only while walking, one more at the end.
	game.sfx.log.clear()
	var state := {"x": 0.0}
	_check(d._begin("follower", 1, house, hall), "follower: runs")
	for i in int(2.0 * 72):
		state["x"] += 1.2 / 72.0
		game.player.global_position = HouseFrames.vec(hall) + Vector3(state["x"], 0, 0)
		game._process(DT)
	var walked := game.sfx.log.count("step")
	_check(walked >= 3, "follower: steps behind while they walk (%d)" % walked)
	_frames(game, int(3.0 * 72))
	_check(game.sfx.log.count("step") == walked, "follower: … and stop when they stop")
	_frames(game, int(2.5 * 72))
	_check(d.vision == "" and game.sfx.log.count("step") == walked + 1, "follower: at the end, one step more (%d)" % game.sfx.log.count("step"))
	_at(game, hall, 180.0)

	# whisper: a line of its level, head-locked, no speaker.
	game.speech.stop()
	var lines: Array = []
	game.speech.line_started.connect(func(l: Dictionary) -> void: lines.append(l))
	_check(d._begin("whisper", 2, house, hall), "whisper: runs")
	game.speech.tick(0.0)
	var whisper: Array = HouseDescent.bundled()["whispers"]["4"]
	_check(game.speech.caption_text() == HouseDescent.fill_line(whisper[2], d.who) and not game.speech.on_prop() and lines.back()["from"] == "", "whisper: a line for the level, from nowhere (%s)" % game.speech.caption_text())
	_frames(game, int(5.5 * 72))
	game.speech.stop()

	# tint: eased in and out.
	var seen := {"max": 0.0, "first": -1.0}
	_check(_play(game, house, "tint", hall, func(_t: float) -> void:
		if seen["first"] < 0.0:
			seen["first"] = game.lamps.tint_by
		seen["max"] = maxf(seen["max"], game.lamps.tint_by)), "tint: runs")
	_check(seen["max"] > 0.55 and seen["first"] < 0.25 and _near(game.lamps.tint_by, 0.18), "tint: eased in (%.2f → %.2f) and out (%.2f)" % [seen["first"], seen["max"], game.lamps.tint_by])

	# whiteduck: ahead, a wrong quack, a line, gone; never findable.
	game.sfx.log.clear()
	game.speech.stop()
	_check(d._begin("whiteduck", 1, house, hall), "whiteduck: runs")
	var duck := d.pale_duck()
	var spot := duck.position
	_check(duck.visible and _near(Vector2(spot.x - hall[0], spot.z - hall[2]).length(), 6.0, 2.01), "whiteduck: pale Gerald stands about 6 m ahead (%s)" % spot)
	var claims: int = link.found_calls
	game.player.teleport(spot, 0.0)  # right on top of it
	for i in int(2.5 * 72):
		game._process(DT)
		game.speech.tick(DT)
	_check(game.sfx.log.has("quack"), "whiteduck: a quack")
	_check(HouseDescent.bundled()["whiteduck"].has(game.speech.caption_text()), "whiteduck: one line (%s)" % game.speech.caption_text())
	_check(duck.position.distance_to(spot) > 1.0, "whiteduck: it waddles off")
	_check(link.found_calls == claims, "whiteduck: never findable")
	_frames(game, int(4.0 * 72))
	_check(d.vision == "" and not duck.visible, "whiteduck: gone")
	_at(game, hall, 180.0)
	game.speech.stop()

	# grin: at eye height, turned to the player, the smile fading last.
	_check(d._begin("grin", 1, house, hall), "grin: runs")
	var grin := d.grin_node()
	_check(grin.visible and _near(grin.position.y, game.player.camera.global_position.y) and _near(Vector2(grin.position.x - hall[0], grin.position.z - hall[2]).length(), 2.5, 1.2), "grin: floats ahead at eye height (%s)" % grin.position)
	_frames(game, int(5.2 * 72))
	var smile: float = d.get("_grin_mat").albedo_color.a
	var eyes: float = d.get("_grin_eyes_mat").albedo_color.a
	_check(eyes <= 0.01 and smile > 0.5, "grin: the eyes go first (%.2f), the smile stays (%.2f)" % [eyes, smile])
	_check(HouseDescent.bundled()["grin"].has(lines.back()["text"]), "grin: one line (%s)" % lines.back()["text"])
	_frames(game, int(3.2 * 72))
	_check(d.vision == "" and not grin.visible, "grin: gone last")
	game.speech.stop()

	# dark: the fog closes in, a growl behind, and it lifts again.
	game.sfx.log.clear()
	var look_fog := HouseLook.FOG_DENSITY * float(HouseDescent.descent_look(4)["fog"])
	var dark := {"max": 0.0, "color": 1.0, "haze": 1.0}
	_check(_play(game, house, "dark", hall, func(_t: float) -> void:
		dark["max"] = maxf(dark["max"], env.fog_density)
		dark["haze"] = minf(dark["haze"], game.builder.get("_haze_scale"))
		dark["color"] = minf(dark["color"], env.fog_light_color.v)), "dark: runs")
	_check(dark["haze"] <= 0.01, "dark: the unfogged haze goes too (%.2f)" % dark["haze"])
	_check(_near(dark["max"], Descent.DARK_FOG) and dark["color"] < 0.02, "dark: black fog (%.2f /m): at 3 m %d %% gets through" % [dark["max"], int(100.0 * exp(-3.0 * dark["max"]))])
	_check(game.sfx.log.count("growl") == 1, "dark: one growl")
	_check(game.builder.get("_haze_scale") == 1.0, "dark: the haze is back")
	var behind := game.descent.get("_behind") as Node3D
	var c := game.player.camera.global_position
	var fwd := -game.player.camera.global_basis.z
	_check((behind.global_position - c).dot(fwd) < 0.0, "dark: the growl is behind them")
	_frames(game, int(1.5 * 72))
	_check(d.dark_level() == 0.0 and _near(env.fog_density, look_fog, 1e-4), "dark: it lifts")

	# door: stands 3 m off, waits, fades.
	_check(d._begin("door", 1, house, hall), "door: runs")
	var door := d.door_node()
	var fp := game.builder.to_house(door.global_position)
	_check(door.visible and _near(Vector2(float(fp[0]) - hall[0], float(fp[2]) - hall[2]).length(), HouseDescent.DOOR_AHEAD_M), "door: 3 m away (%s)" % [fp])
	_check(door.get_node_or_null("Frame") != null and door.get_node_or_null("Slit") != null, "door: a black leaf in a frame, a red slit under it")
	_frames(game, int(29.0 * 72))
	_check(d.vision == "door" and door.visible, "door: waits its 30 s")
	_frames(game, int(3.0 * 72))
	_check(d.vision == "" and not door.visible, "door: then fades and is gone")
	_check(not game.hallway.active(), "door: nobody went through")

	# A vision or a talk blocks nothing: the find still claims during one.
	var a: Dictionary = game.flow.assignment
	_check(d._begin("dark", 1, house, hall), "find: a vision is up")
	var claims2: int = link.found_calls
	game.player.teleport(HouseFrames.vec(a["duck"]["pos"]), 0.0)
	game._process(DT)
	_check(link.found_calls == claims2 + 1, "find: a vision never blocks it")
	link.found_answered.emit(true, {"ok": true, "released": true})
	_check(game.state() == GameFlow.State.FOUND and d.vision == "" and not d.running, "find: the vision ends with the walk")
	game.speech.tick(0.0)
	_check(HouseDescent.bundled()["found"]["4"].has(game.speech.caption_text().replace("Ada", "{name}")), "find: Gerald's line for the level (%s)" % game.speech.caption_text())
	_frames(game, int(2.0 * 72))
	_check(d.dark_level() == 0.0, "find: its dark eases away on the found screen")
	link.session_over.emit("test")
	await _end(main)


func _test_self() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var d := game.descent
	game.ghosts.avatars.requester = func(_url: String, _done: Callable) -> void: pass
	link.assignment_received.emit(_assignment(house, "s-1", {"descent": 4.0}))
	d.plan = []
	# The north end of the hall, looking down its length.
	var hall := _room_spot(house, "hall")
	hall[2] = 12.2
	_at(game, hall, 180.0)
	_check(not d._begin("self", 1, house, hall), "self: no avatar, no vision")
	link.session_over.emit("test")
	link.assignment_received.emit(_assignment(house, "s-2", {"descent": 4.0, "avatar": "k1"}))
	d = game.descent
	d.plan = []
	_at(game, hall, 180.0)
	_check(not d._begin("self", 1, house, hall), "self: a picture not here yet is skipped too")
	var url: String = link.avatar_url("k1")
	var img := Image.create(8, 8, false, Image.FORMAT_RGBA8)
	game.ghosts.avatars.get("_textures")[url] = ImageTexture.create_from_image(img)
	game.speech.stop()
	_check(d._begin("self", 1, house, hall), "self: the player's own picture")
	var pale := d.pale_self()
	var start := pale.position
	var yaw0 := pale.rotation.y
	_check(pale.visible and (pale.get_node("Picture") as Sprite3D).texture != null, "self: a pale copy, wearing it")
	_frames(game, int(3.7 * 72))
	_check(pale.position.distance_to(start) > 0.5, "self: it walks on ahead")
	var stopped := pale.position
	_frames(game, int(2.0 * 72))
	_check(pale.position.distance_to(stopped) < 0.1 and absf(angle_difference(pale.rotation.y, yaw0)) > 1.0, "self: stops and looks back (%.2f rad)" % angle_difference(pale.rotation.y, yaw0))
	_check(HouseDescent.bundled()["self"].has(game.speech.caption_text()), "self: one line (%s)" % game.speech.caption_text())
	_frames(game, int(4.0 * 72))
	_check(d.vision == "" and not pale.visible, "self: gone")
	link.session_over.emit("test")
	game.ghosts.avatars.requester = Callable()
	await _end(main)


func _test_small_big() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var d := game.descent
	var p := game.player
	link.assignment_received.emit(_assignment(house, "a-1", {"descent": 4.0}))
	d.plan = []
	var hall := _room_spot(house, "hall")
	_at(game, hall, 0.0)
	var eye := p.camera.position.y
	var shape := p.get_node("Collision") if p.has_node("Collision") else null
	var feet0 := p.feet()
	for pair: Array in [["small", HouseDescent.ALICE_SMALL], ["big", HouseDescent.ALICE_BIG]]:
		var kind: String = pair[0]
		var to: float = pair[1]
		var worst := {"step": 0.0, "last": p.eye_scale, "low": 9.0, "high": 0.0}
		link.poses.clear()
		_check(_play(game, house, kind, hall, func(_t: float) -> void:
			worst["step"] = maxf(worst["step"], absf(p.eye_scale - float(worst["last"])))
			worst["last"] = p.eye_scale
			worst["low"] = minf(worst["low"], p.eye_scale)
			worst["high"] = maxf(worst["high"], p.eye_scale)), "%s: runs" % kind)
		_check(_near(worst["low"] if kind == "small" else worst["high"], to), "%s: the eyes reach × %.2f" % [kind, to])
		# Smoothstep's steepest slope is 1.5 × the mean.
		_check(worst["step"] <= absf(to - 1.0) * 1.51 * DT / HouseDescent.ALICE_EASE_S + 1e-6, "%s: eased over %d s (the biggest step %.4f)" % [kind, HouseDescent.ALICE_EASE_S, worst["step"]])
		_check(_near(p.eye_scale, 1.0) and _near(p.camera.position.y, eye), "%s: and back, no jump" % kind)
		_check(link.poses.all(func(q: Dictionary) -> bool: return _same(q["p"], link.poses[0]["p"])), "%s: the poses never move" % kind)
		_check(p.feet().distance_to(feet0) < TOL, "%s: the feet stay" % kind)
		game.speech.stop()
	_check(shape == null or (shape as CollisionShape3D).shape != null, "small: the body's capsule is left alone")
	# A session end mid-way: back at once.
	_check(d._begin("small", 1, house, hall), "small: again")
	_frames(game, int(4.5 * 72))
	_check(p.eye_scale < 0.5, "small: on the way down")
	link.session_over.emit("test")
	_check(p.eye_scale == 1.0 and _near(p.camera.position.y, VrPlayer.EYE_HEIGHT), "small: the lobby is at full height, at once")
	# The find eases it back over the found screen.
	link.assignment_received.emit(_assignment(house, "a-2", {"descent": 4.0}))
	d.plan = []
	_at(game, hall, 0.0)
	_check(d._begin("big", 1, house, hall), "big: again")
	_frames(game, int(5.0 * 72))
	link.found_answered.emit(true, {"ok": true, "released": true})
	var at_find := p.eye_scale
	_frames(game, 8)
	_check(p.eye_scale < at_find and p.eye_scale > 1.3, "big: the find eases it back, no jump (%.3f → %.3f)" % [at_find, p.eye_scale])
	_frames(game, int(4.5 * 72))
	_check(_near(p.eye_scale, 1.0), "big: … all the way")
	link.session_over.emit("test")
	await _end(main)


## The headset's path: `world_scale`, about the head.
func _test_xr_scale() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var p := game.player
	p.xr_active = true
	p.origin.position = Vector3(-1.0, 0, 0.5)
	p.camera.position = Vector3(0.8, 1.6, -0.4)  # a player off the origin's centre
	var head := p.camera.global_position
	p.set_eye_scale(0.5)
	# The tracker would now report the scaled head.
	p.camera.position *= 0.5
	_check(_near(p.origin.world_scale, 0.5) and _near(XRServer.world_scale, 0.5), "xr: small is the origin's world_scale")
	var after := p.camera.global_position
	_check(_near(after.x, head.x) and _near(after.z, head.z), "xr: scaled about the head: it never slides sideways (%s → %s)" % [head, after])
	_check(_near(after.y - p.origin.global_position.y, 0.8), "xr: only the eye height moves")
	p.set_eye_scale(1.0)
	p.camera.position /= 0.5
	_check(_near(XRServer.world_scale, 1.0) and _near(p.camera.global_position.x, head.x) and _near(p.camera.global_position.z, head.z), "xr: and back")
	p.xr_active = false
	p.set_xr(false)
	await _end(main)


## An awake talker in the show's house with `id`, walked up to.
func _walk_to_talker(game: Game, house: Dictionary, id: String) -> Dictionary:
	var d := game.descent
	for w: Dictionary in d.awake:
		if w["talker"]["id"] == id:
			var at: Array = w["prop"]["pos"]
			_at(game, _beside(house, w["prop"]), 0.0)
			return w
	return {}


## A floor point within reach of `prop`.
static func _beside(house: Dictionary, prop: Dictionary) -> Array:
	var at: Array = prop["pos"]
	var r := maxf(float(prop["size"][0]), float(prop["size"][2])) / 2.0 + 0.6
	for dir: Array in [[1.0, 0.0], [-1.0, 0.0], [0.0, 1.0], [0.0, -1.0]]:
		var q: Array = [float(at[0]) + dir[0] * r, float(at[1]), float(at[2]) + dir[1] * r]
		if HouseLocate.standable(house, q):
			return q
	return [float(at[0]), float(at[1]), float(at[2])]


## Wake exactly talker `id` on `game`'s walk.
func _only_talker(game: Game, house: Dictionary, id: String) -> Dictionary:
	var d := game.descent
	for p: Dictionary in house["props"]:
		var t: Variant = HouseDescent.talker_for(d.words, p)
		if t != null and t["id"] == id:
			for w: Dictionary in d.awake:
				(w["face"] as Node3D).queue_free()
			var anchor := game.builder.part("Prop_%s" % p["id"]) as Node3D
			anchor.set_meta("height", float(p["size"][1]))
			var row := {"prop": p, "talker": t, "anchor": anchor, "armed": true}
			d._make_face(row)
			d.awake = [row]
			d.plan = []
			return row
	return {}


## Aim the pointer at row `i` of the open panel, press `down`.
func _aim_row(game: Game, i: int, down := false) -> void:
	var eye := game.player.camera.global_position
	game.pointer.inject(eye, game.talk.row_world(i) - eye, down)


func _test_talk() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var d := game.descent
	link.assignment_received.emit(_assignment(house, "t-1", {"descent": 4.0}))
	_check(not d.awake.is_empty() and d.awake.size() <= 5, "talk: props wake (%d)" % d.awake.size())
	# The wake is the port's.
	var want := HouseDescent.wake_talkers(house, d.words, 4, "t-1")
	_check(want.size() == d.awake.size() and d.awake.all(func(w: Dictionary) -> bool: return want.any(func(q: Dictionary) -> bool: return q["prop"] == w["prop"]["id"])), "talk: the awake are wake_talkers' own")
	var w := _only_talker(game, house, "stove")
	_check(not w.is_empty(), "talk: the show has a stove")
	# A face only near: far off, not drawn.
	_at(game, house["spawn"]["pos"], 0.0)
	game._process(DT)
	var face: Node3D = w["face"]
	_check(not face.visible, "talk: no face from far off")
	_at(game, _beside(house, w["prop"]), 0.0)
	game.speech.stop()
	game._process(DT)
	_check(face.visible and d.talking() and d.talker_id() == "stove" and d.talk_node() == "start", "talk: walking up to it, it speaks")
	var anchor: Node3D = w["anchor"]
	var pupils: Array = w["eyes"]
	game.speech.tick(0.0)
	_check(game.speech.on_prop() and game.speech.caption_text() == "Psst. Ada.", "talk: the line hangs on the prop, with the name in it (%s)" % game.speech.caption_text())
	_check(not game.talk.is_open() and not game.pointer.beam_visible(), "talk: no panel while it speaks, no beam")
	_check((((pupils[0][1] as Node3D).position - (pupils[0][0] as Vector3)).length() > 0.05), "talk: its eyes look at the player")
	# Keep walking while it talks: nothing holds the player.
	_check(game.player.locomotion_enabled, "talk: it never stops the walk")
	var yaw := game.player.head_yaw()
	_frames(game, int(12.0 * 72))
	_check(game.talk.is_open() and game.talk.row_count() == 3, "talk: then one row per option (%d)" % game.talk.row_count())
	_check(game.talk.row_text(0) == "I've never been here." and game.talk.row_text(2) == "Sorry.", "talk: plain rows (%s)" % game.talk.row_text(0))
	var xf := game.talk.global_transform
	var to_eye := (game.player.camera.global_position - xf.origin)
	_check(xf.basis.z.dot(Vector3(to_eye.x, 0, to_eye.z).normalized()) > 0.9 and absf(xf.basis.y.dot(Vector3.UP)) > 0.99, "talk: the panel is turned to the player, upright")
	_check(xf.origin.distance_to(anchor.global_position) < 4.0, "talk: and near the prop")
	# The beam shows; a headset draws it (the test rig has no XR: poke it).
	game.player.xr_active = true
	_aim_row(game, 1)
	game._process(DT)
	game.player.xr_active = false
	_check(game.pointer.beam_visible() and game.talk.hovered() == 1 and d.trigger_taken(), "talk: the beam shows, the row under it lights up")
	var bg := game.talk.get_node("Row_1/Bg") as MeshInstance3D
	_check(bg.material_override == HouseLook.screen(Lobby.BG_HOVER), "talk: highlighted")
	# Off the rows: nothing to pick.
	game.pointer.inject(game.player.camera.global_position, Vector3.UP, false)
	game._process(DT)
	_check(game.talk.hovered() == -1 and not d.trigger_taken(), "talk: off the rows the trigger is free")
	# A trigger already held when it came up picks nothing: re-open with one held.
	var again: Array = (d._node()["options"] as Array).map(func(o: Dictionary) -> String: return str(o["text"]))
	game.talk.close()
	game.talk.open(again, xf)
	_aim_row(game, 0, true)
	game._process(DT)
	game._process(DT)
	_check(d.talk_node() == "start" and link.get("told_posts") == [], "talk: a pull held from before the panel picks nothing")
	# The trigger picks; marks go to the server.
	_aim_row(game, 2, false)
	game._process(DT)
	_aim_row(game, 2, true)
	game._process(DT)
	game.pointer.inject(game.player.camera.global_position, Vector3.UP, false)
	_check(link.get("told_posts") == [["stove", "sorry"]] and d.told.get("stove") == "sorry", "talk: the pick tells the talker (%s)" % [link.get("told_posts")])
	_check(d.talk_node() == "sorry" and not game.talk.is_open() and not game.pointer.beam_visible(), "talk: on to the next node, the panel down")
	game.speech.tick(0.0)
	_check(game.speech.caption_text() == "Nobody has ever said that to a stove.", "talk: its line (%s)" % game.speech.caption_text())
	_frames(game, int(9.0 * 72))
	_check(not d.talking() and not game.speech.on_prop(), "talk: a node with no options ends it")
	game.pointer.clear_injection()
	# It keeps quiet until the player has left it.
	_frames(game, 10)
	_check(not d.talking(), "talk: it stays quiet while they stand there")
	_at(game, _room_spot(house, "hall"), 0.0)
	_frames(game, 2)
	_at(game, _beside(house, w["prop"]), 0.0)
	_frames(game, 1)
	_check(d.talking() and d.talk_node() == "polite", "talk: coming back, it remembers (%s)" % d.talk_node())
	# Walking away ends it, and only its own lines go.
	game.speech.stop()
	game.speech.say([{"from": "", "text": "Someone else's line."}], null)
	game.speech.say([{"from": "", "text": "The talker's."}], w["anchor"])
	_at(game, _room_spot(house, "hall"), 0.0)
	_frames(game, 1)
	_check(not d.talking() and not game.talk.is_open(), "talk: walking away ends the talk")
	game.speech.tick(0.0)
	_check(game.speech.busy() and not game.speech.busy_on(w["anchor"]), "talk: … its lines go; anyone else's stay")
	game.speech.stop()
	link.session_over.emit("test")
	await _end(main)


func _test_talk_marks() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var d := game.descent
	# A later walk reads what was told, off the assignment.
	link.assignment_received.emit(_assignment(house, "m-1", {"descent": 4.0, "told": {"stove": "denied"}}))
	var w := _only_talker(game, house, "stove")
	game.speech.stop()
	_at(game, _beside(house, w["prop"]), 0.0)
	game._process(DT)
	_check(d.talk_node() == "again", "marks: told on an earlier walk, it opens elsewhere (%s)" % d.talk_node())
	link.session_over.emit("test")
	# An open talk holds the beats.
	link.assignment_received.emit(_assignment(house, "m-1b", {"descent": 4.0}))
	d = game.descent
	w = _only_talker(game, house, "stove")
	game.speech.stop()
	_at(game, _beside(house, w["prop"]), 0.0)
	game._process(DT)
	_check(d.talking(), "holds: a talk is open")
	d.plan = [{"at": 0.0, "vision": "flicker", "n": 1}]
	d.walk_t = 0.1
	d.set("_next", 0)
	game._process(DT)
	_check(d.vision == "", "holds: an open talk holds a beat")
	d.end_talk()
	game._process(DT)
	_check(d.vision == "flicker", "holds: … until it ends")
	link.session_over.emit("test")
	# A `do` on an option sets off its vision, without waiting for the talk.
	link.assignment_received.emit(_assignment(house, "m-2", {"descent": 4.0}))
	d = game.descent
	w = _only_talker(game, house, "mushroom")
	_check(not w.is_empty(), "marks: a mushroom's in the house at level 4")
	game.speech.stop()
	_at(game, _beside(house, w["prop"]), 0.0)
	game._process(DT)
	_frames(game, int(4.0 * 72))
	_check(game.talk.is_open(), "marks: the mushroom asks")
	_aim_row(game, 0)
	game._process(DT)
	_aim_row(game, 0, true)
	game._process(DT)
	game.pointer.inject(game.player.camera.global_position, Vector3.UP, false)
	_check(d.talk_node() == "name", "marks: on to its next node (%s)" % d.talk_node())
	_frames(game, int(12.0 * 72))
	_check(game.talk.is_open() and game.talk.row_count() == 3, "marks: a node with its own options")
	_aim_row(game, 0)
	game._process(DT)
	_aim_row(game, 0, true)
	game._process(DT)
	game._process(DT)
	game.pointer.clear_injection()
	_check(d.vision == "big" and not d.talking(), "marks: the option's vision runs (%s), the talk is over" % d.vision)
	link.session_over.emit("test")
	# No script: the visions play, nobody talks.
	link.assignment_received.emit(_assignment(house, "m-3", {"descent": 4.0}))
	d = game.descent
	d.adopt_script(null)
	_check(d.running and d.awake.is_empty(), "no words: nobody talks")
	var hall := _room_spot(house, "hall")
	_at(game, hall, 180.0)
	_check(d._begin("whisper", 1, house, hall) and not game.speech.busy(), "no words: a whisper has no line, and still runs")
	link.session_over.emit("test")
	await _end(main)


func _test_talk_and_king() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var d := game.descent
	var player := game.player
	var prop := HouseKing.king_prop(house)
	link.call("give_king", {"id": str(prop["id"]), "hp": 15, "max": 15, "fallen": false})
	link.assignment_received.emit(_assignment(house, "k-1", {"descent": 4.0}))
	# A talker's panel open, right by the King, facing him. The panel's prop
	# is anywhere near: bend the talker's place to here.
	var f := HouseFrames.forward(float(prop.get("yaw", 0.0)) if prop.get("yaw") != null else 0.0)
	var stand: Array = [float(prop["pos"][0]) + float(f[0]) * 0.9, float(prop["pos"][1]), float(prop["pos"][2]) + float(f[2]) * 0.9]
	var w := _only_talker(game, house, "stove")
	var fake: Dictionary = (w["prop"] as Dictionary).duplicate(true)
	fake["pos"] = stand.duplicate()
	w["prop"] = fake
	_at(game, stand, 0.0)
	var yaw := rad_to_deg(atan2(-(float(prop["pos"][0]) - stand[0]), -(float(prop["pos"][2]) - stand[2])))
	player.face(game.builder.yaw_to_world(yaw))
	game.speech.stop()
	game._process(DT)
	_frames(game, int(12.0 * 72))
	_check(game.talk.is_open(), "king: a panel is open beside him")
	var hits: int = link.get("king_hits")
	# The trigger on a row is the row's.
	_aim_row(game, 1)
	game._process(DT)
	_aim_row(game, 1, true)
	player.hit_button = true
	game._process(DT)
	player.hit_button = false
	_check(link.get("king_hits") == hits, "king: a trigger on a row never hits him")
	_check(d.talk_node() != "start", "king: it picked the row (%s)" % d.talk_node())
	game.pointer.clear_injection()
	# A fresh panel, the beam off it: the trigger is his.
	_frames(game, int(9.0 * 72))
	if not game.talk.is_open():
		d.end_talk()
		w["armed"] = true
		game.speech.stop()
		w["talker"] = (w["talker"] as Dictionary).duplicate(true)
		_frames(game, 2)
		_frames(game, int(12.0 * 72))
	_check(game.talk.is_open(), "king: a panel again")
	game.pointer.inject(player.camera.global_position, Vector3.UP, false)
	game._process(DT)
	player.hit_button = true
	game._process(DT)
	player.hit_button = false
	game.pointer.clear_injection()
	_check(link.get("king_hits") == hits + 1, "king: off the rows, a talk never blocks a hit")
	# The void ends a talk; a talk never blocks it.
	link.session_over.emit("test")
	link.assignment_received.emit(_assignment(house, "k-2", {"descent": 4.0}))
	d = game.descent
	w = _only_talker(game, house, "stove")
	game.speech.stop()
	_at(game, _beside(house, w["prop"]), 0.0)
	game._process(DT)
	_check(d.talking(), "void: a talk is open")
	game.clock = func() -> float: return 9000.0
	game.player.teleport(HouseFrames.vec([-0.45, 0.0, -5.2]), 0.0)
	game._process(DT)
	_check(game.escaping() and not d.talking() and link.get("moments") == [["escape", ""]], "void: a talk never blocks it (%s)" % [link.get("moments")])
	# An escape holds the beats; the clock runs on.
	var t0 := d.walk_t
	d.plan = [{"at": t0 + 0.05, "vision": "flicker", "n": 1}]
	d.set("_next", 0)
	_frames(game, 20)
	_check(game.escaping() and d.vision == "" and d.walk_t > t0, "void: no vision starts during an escape")
	link.session_over.emit("test")
	await _end(main)


## Up to the door, a step from it, ready to walk through: `[feet, spot]`.
func _at_the_door(game: Game, house: Dictionary, sid: String, more := {}) -> Array:
	var a := _assignment(house, sid, {"descent": 4.0})
	a.merge(more, true)
	game.link.assignment_received.emit(a)
	var d := game.descent
	d.plan = []
	var hall := _room_spot(house, "hall")
	_at(game, hall, 180.0)
	game._process(DT)
	d._begin("door", 3, house, hall)
	var spot: Dictionary = d.door_spot_now()
	return [hall, spot]


## Walk through it, by standing within reach.
func _go_through(game: Game, spot: Dictionary) -> Array:
	var p: Array = spot["pos"]
	var f := HouseFrames.forward(float(spot["yaw"]))
	var feet: Array = [float(p[0]) + float(f[0]) * 0.6, float(p[1]), float(p[2]) + float(f[2]) * 0.6]
	_at(game, feet, 0.0)
	game._process(DT)
	return feet


func _test_hallway() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var d := game.descent
	var h := game.hallway
	var player := game.player
	var env: Environment = game.world_env
	link.call("give_king", {"id": str(HouseKing.king_prop(house)["id"]), "hp": 15, "max": 15, "fallen": false})
	var at: Array = _at_the_door(game, house, "h-1")
	var spot: Dictionary = at[1]
	game.speech.stop()
	_check(not h.active(), "hallway: nobody in yet")
	var feet := _go_through(game, spot)
	_check(h.active() and d.vision == "" and not d.door_node().visible, "hallway: walking within reach of the door goes through it")
	_check(_near(player.feet().z, Hallway.SPOT.z) and _near(player.feet().y, Hallway.SPOT.y), "hallway: off the map")
	_check(not game.builder.visible and not game.ghosts.visible and not game.lamps.visible and not game.trail.visible and not game.duck.visible, "hallway: the house, the ghosts, the lamps, the trail and Gerald are hidden")
	_check(env.fog_density <= Descent.POCKET_FOG + 1e-4 and game.lamps.ambient_scale <= Descent.POCKET_LIGHT + 1e-4, "hallway: dark")
	game.speech.tick(0.0)
	_check(HouseDescent.bundled()["hallway"]["enter"].has(game.speech.caption_text()) and not game.speech.on_prop(), "hallway: a line on the way in (%s)" % game.speech.caption_text())
	var light := h.get_node("Light") as OmniLight3D
	_check(light.is_visible_in_tree() and not light.shadow_enabled, "hallway: one light")
	var door := h.get_node("FarDoor") as Node3D
	_check(_near(-door.position.z, HouseDescent.HALLWAY_FAR_M), "hallway: the far door 14 m ahead")
	# While inside: the pose at the door, and nothing else in the house.
	link.poses.clear()
	var moments: Array = link.get("moments")
	moments.clear()
	var claims: int = link.found_calls
	var hits: int = link.get("king_hits")
	game.player.hit_button = true
	game._process(DT)
	game.player.hit_button = false
	game._process(DT)
	_check(link.poses.size() == 2 and _same(link.poses[0]["p"], feet) and _same(link.poses[1]["p"], feet), "hallway: the pose pump keeps sending the door (%s)" % [link.poses.back()])
	_check(moments.is_empty() and link.found_calls == claims and link.get("king_hits") == hits and not game.escaping(), "hallway: no void, heart, pickup, find or King in here")
	var t0 := d.walk_t
	d.plan = [{"at": t0, "vision": "flicker", "n": 1}]
	d.set("_next", 0)
	game._process(DT)
	game._process(DT)
	_check(d.vision == "" and d.walk_t > t0, "hallway: no vision in here; the walk's clock runs on")
	_check(game.trail.count() == 0, "hallway: no trail")
	_check(game.falls == 0, "hallway: the fall net never fires")
	# The door backs away with them, 0.92 of their pace, then stays.
	var pace := 1.4
	var z := Hallway.SPOT.z
	var t := 0.0
	var far0 := h.far_distance()
	while t < 5.0:
		z -= pace * DT
		player.global_position = Vector3(0, Hallway.SPOT.y, z)
		game._process(DT)
		game.speech.tick(DT)
		t += DT
	_check(_near(h.far_distance() - far0, (Hallway.SPOT.z - z) * HouseDescent.HALLWAY_RETREAT, 0.05), "hallway: it backs away at 0.92 × their pace (%.2f m for %.2f m)" % [h.far_distance() - far0, Hallway.SPOT.z - z])
	_check(_near(-door.position.z, h.far_distance()), "hallway: it really moves")
	# Part way, a line of `far`.
	game.speech.stop()
	var saw_far := false
	while t < HouseDescent.HALLWAY_RETREAT_S + 0.1:
		z -= pace * DT
		player.global_position = Vector3(0, Hallway.SPOT.y, z)
		game._process(DT)
		game.speech.tick(DT)
		t += DT
		saw_far = saw_far or HouseDescent.bundled()["hallway"]["far"].has(game.speech.caption_text())
	_check(saw_far, "hallway: one line of `far` part way")
	var stood := h.far_distance()
	game.speech.stop()
	while h.active() and t < HouseDescent.HALLWAY_MAX_S:
		z -= pace * DT
		player.global_position = Vector3(0, Hallway.SPOT.y, z)
		game._process(DT)
		t += DT
	_check(_near(stood, h.far_distance()), "hallway: past 22 s it stays where it is")
	_check(not h.active() and t < HouseDescent.HALLWAY_MAX_S, "hallway: reaching it ends it (%.1f s)" % t)
	# Back: at the door they entered, facing away from it, the door gone.
	_check(_same(game.builder.to_house(player.feet()), feet), "hallway: back at the door (%s)" % [game.builder.to_house(player.feet())])
	var dy := Vector2(float(spot["pos"][0]) - float(feet[0]), float(spot["pos"][2]) - float(feet[2]))
	var look := HouseFrames.forward(game.builder.yaw_to_house(player.head_yaw()))
	_check(float(look[0]) * dy.x + float(look[2]) * dy.y < 0.0, "hallway: facing away from it")
	_check(not d.door_node().visible and d.door_spot_now() == null, "hallway: the door is gone")
	_check(game.builder.visible and game.ghosts.visible and game.lamps.visible and game.trail.visible and not h.visible, "hallway: the house is back")
	_check(_near(env.fog_density, HouseLook.FOG_DENSITY * float(HouseDescent.descent_look(4)["fog"]), 1e-4) and _near(game.lamps.ambient_scale, float(HouseDescent.descent_look(4)["ambient"])), "hallway: its dark is gone")
	game.speech.tick(0.0)
	_check(HouseDescent.bundled()["hallway"]["out"].has(game.speech.caption_text()), "hallway: a line on leaving (%s)" % game.speech.caption_text())
	game.speech.stop()
	# The walk goes on: poses, finds, hits, all of it.
	link.poses.clear()
	game._process(DT)
	_check(link.poses.size() == 1 and _same(link.poses[0]["p"], feet), "hallway: the walk goes on from there")
	game.player.teleport(HouseFrames.vec(game.flow.assignment["duck"]["pos"]), 0.0)
	game._process(DT)
	_check(link.found_calls == claims + 1, "hallway: and the find is back on")
	link.session_over.emit("test")
	# A find claimed on the way in lands inside: they come out to it.
	var at2: Array = _at_the_door(game, house, "h-1b")
	_go_through(game, at2[1])
	_check(h.active(), "hallway: inside again")
	link.found_answered.emit(true, {"ok": true, "released": true})
	_check(game.state() == GameFlow.State.FOUND and not h.active() and game.builder.visible, "hallway: a find that lands inside brings them out")
	link.session_over.emit("test")
	await _end(main)


func _test_hallway_timeout() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var at: Array = _at_the_door(game, house, "h-2")
	var feet := _go_through(game, at[1])
	var t := 0.0
	while game.hallway.active() and t < 80.0:
		game._process(0.1)
		t += 0.1
	_check(not game.hallway.active() and _near(t, HouseDescent.HALLWAY_MAX_S, 0.3), "timeout: nobody is in there longer than 70 s (%.1f)" % t)
	_check(_same(game.builder.to_house(game.player.feet()), feet) and game.builder.visible, "timeout: back at the door")
	link.session_over.emit("test")
	# A body through the floor (it never should) is out at once, too.
	var at2: Array = _at_the_door(game, house, "h-2b")
	_go_through(game, at2[1])
	game.player.global_position = Hallway.SPOT - Vector3(0, Hallway.FELL_BELOW + 0.5, 0)
	game._process(DT)
	_check(not game.hallway.active() and game.builder.visible, "timeout: a fall out of the pocket brings them back")
	link.session_over.emit("test")
	await _end(main)


func _test_hallway_session_end() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var at: Array = _at_the_door(game, house, "h-3")
	_go_through(game, at[1])
	_check(game.hallway.active(), "session end: inside")
	game._process(DT)
	link.session_over.emit("over")
	_check(game.state() == GameFlow.State.LOBBY and not game.hallway.active() and not game.hallway.visible, "session end: the lobby, the pocket shut")
	_check(game.builder.visible and game.ghosts.visible and game.lamps.visible and game.trail.visible, "session end: the house is back")
	_check(_near(game.player.feet().z, Lobby.SPOT.z) and game.lamps.ambient_scale == 1.0 and _near(game.world_env.fog_density, HouseLook.FOG_DENSITY, 1e-4), "session end: nothing left over")
	# The headset comes off inside: held, then the lobby, then a clean walk.
	var at2: Array = _at_the_door(game, house, "h-4")
	_go_through(game, at2[1])
	game.headset_gone()
	_check(game.state() == GameFlow.State.LOBBY and not game.hallway.active() and game.builder.visible, "session end: the headset off inside goes the same way")
	var again := _assignment(house, "h-5")
	link.assignment_received.emit(again)
	_check(game.descent.level == 0 and game.descent.visible and not game.hallway.active(), "session end: the next walk starts clean")
	link.session_over.emit("test")
	await _end(main)


func _test_hallway_remap() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var at: Array = _at_the_door(game, house, "h-6")
	var feet := _go_through(game, at[1])
	_check(game.hallway.active(), "remap: inside")
	link.call("give_house", house.duplicate(true))
	_check(not game.hallway.active() and game.builder.visible and game.state() == GameFlow.State.PLAYING, "remap: the house comes back first")
	_check(_same(game.builder.to_house(game.player.feet()), feet), "remap: at the door")
	_check(game.descent.running and not game.descent.awake.is_empty() and (game.descent.awake[0]["anchor"] as Node).is_inside_tree(), "remap: the talkers wake on the new house")
	# A remap with no floor at the door: back to the spawn, as ever.
	var at2: Array = _at_the_door(game, house, "h-7")
	_go_through(game, at2[1])
	var solid: Dictionary = house.duplicate(true)
	(solid["props"] as Array).append({"id": "w49-block", "room": "hall", "kind": "box", "pos": [feet[0], feet[1], feet[2]], "size": [3, 2, 3]})
	link.call("give_house", solid)
	_check(not game.hallway.active(), "remap: out again")
	_check(HouseLocate.standable(game.builder.house, game.builder.to_house(game.player.feet())), "remap: never left standing in a prop")
	link.session_over.emit("test")
	await _end(main)


## With the real body: the corridor's floor and walls hold it.
func _test_hallway_walked() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	var at: Array = _at_the_door(game, house, "h-8")
	_go_through(game, at[1])
	var player := game.player
	await physics_frame
	await physics_frame
	var dt := DT
	# Forward, and into the wall.
	player.left_stick = Vector2(0, 1)
	for i in 72 * 3:
		game._process(dt)
		player.step(dt)
	var walked := Hallway.SPOT.z - player.feet().z
	_check(walked > 3.0 and game.hallway.active(), "walked: the body walks the corridor (%.1f m)" % walked)
	_check(_near(player.feet().y, Hallway.SPOT.y, 0.05), "walked: on its floor (%.3f)" % player.feet().y)
	player.left_stick = Vector2(1, 0)
	for i in 72 * 2:
		game._process(dt)
		player.step(dt)
	_check(absf(player.feet().x - Hallway.SPOT.x) <= HouseDescent.HALLWAY_WIDTH_M / 2.0, "walked: its walls hold (x %.2f)" % player.feet().x)
	player.left_stick = Vector2(0, -1)
	for i in 72 * 8:
		game._process(dt)
		player.step(dt)
	_check(player.feet().z <= Hallway.SPOT.z + 1.0, "walked: nothing behind them but a wall (z %.2f)" % (player.feet().z - Hallway.SPOT.z))
	_check(game.falls == 0 and game.hallway.active(), "walked: no fall")
	player.left_stick = Vector2.ZERO
	link.session_over.emit("test")
	await _end(main)


func _test_autopilot() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
	var link: LinkBase = preload("res://test/fake_link.gd").new()
	link.config = StationConfig.merge(StationConfig.defaults(), {"name": "Autopilot", "autopilot": true, "descent": 4})
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
	game.speech.set_process(false)
	game.speech.voices = func() -> Array: return []
	var player := game.player
	player.set_process(false)
	player.set_physics_process(false)
	var dt := 1.0 / 90.0
	var missed: Array = []
	var visions := {}
	game.descent.vision_started.connect(func(k: String) -> void: visions[k] = true)
	var spots: Array = house["duck"]["spots"]
	for i in spots.size():
		var a := _assignment(house, "s-ap%d" % i)
		a["duck"] = spots[i]
		link.assignment_received.emit(a)
		_check(game.descent.level == 4, "autopilot: level 4 (spot %d)" % i)
		var calls: int = link.found_calls
		var steps := 0
		while link.found_calls == calls and steps < 90 * 90:
			game._process(dt)
			player.step(dt)
			game.speech.tick(dt)
			steps += 1
		if link.found_calls == calls:
			missed.append("%s stuck at %s" % [spots[i]["id"], game.builder.to_house(player.feet())])
		_check(not game.hallway.active(), "autopilot: it never goes through a door")
		link.session_over.emit("test")
	_check(missed.is_empty(), "autopilot: finds the duck at every spot at level 4 %s (visions on the way: %s)" % [missed, visions.keys()])
	main.queue_free()
	await process_frame


## The mirror combo's walk, through the real ServerLink, offline.
func _test_offline_mirror() -> void:
	var link: LinkBase = root.get_node("ServerLink")
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	await process_frame
	var game: Game = main.get("game")
	_check(link.is_offline() and not link.house.is_empty(), "mirror: the real link, offline, the bundled house")
	game.player.set_process(false)
	game.player.set_physics_process(false)
	game.player.read_input = false
	game.speech.voices = func() -> Array: return []
	game.start_test_level(HouseDescent.DESCENT_MAX)
	await process_frame
	await process_frame
	_check(game.state() == GameFlow.State.PLAYING, "mirror: the test level starts")
	_check(game.in_intro() and game.intro.skippable, "mirror: a skippable intro: this program has been here before")
	var guard := 0
	while game.in_intro() and guard < 12:
		game._process(0.5)
		game.intro_press("skip")
		game.intro_press("skip_tutorial")
		guard += 1
	_check(not game.in_intro() and game.descent.running and game.descent.level == 4 and game.descent.who["visit"] == 5, "mirror: level 4, fifth walk")
	_check(not game.descent.awake.is_empty() and game.descent.words == HouseDescent.bundled(), "mirror: the bundled words, the talkers awake")
	_check(game.builder.from_shown()[0] == game.builder.from_shown()[1], "mirror: every strange prop is there")
	var seen := {}
	game.descent.vision_started.connect(func(k: String) -> void: seen[k] = true)
	for i in 72 * 40:
		game._process(DT)
	_check(seen.size() >= 2, "mirror: visions come (%s)" % [seen.keys()])
	link.end_session("test")
	link.session_over.emit("test")
	game.enter_lobby()
	_check(game.descent.level == 0, "mirror: the lobby is clean, and the next plain walk is level 0")
	main.queue_free()
	await process_frame


## Nothing a vision or the Hallway adds breaks the Quest's rules.
func _test_bounds() -> void:
	var got: Array = await _game()
	var main: Node = got[0]
	var game: Game = got[1]
	var link: LinkBase = got[2]
	var house: Dictionary = got[3]
	link.assignment_received.emit(_assignment(house, "b-1", {"descent": 4.0}))
	var lights := game.find_children("*", "OmniLight3D", true, false)
	var pocket := game.hallway.find_children("*", "OmniLight3D", true, false)
	var descent_lights := game.descent.find_children("*", "OmniLight3D", true, false)
	_check(pocket.size() == 1, "quest: the Hallway has its one light")
	_check(descent_lights.is_empty(), "quest: no vision adds a light")
	_check(game.lamps.pool.size() == HouseLights.pool_size("medium"), "quest: the pool is fixed")
	var shadowed := lights.filter(func(l: OmniLight3D) -> bool: return l.shadow_enabled)
	_check(shadowed.is_empty(), "quest: no shadows")
	var env: Environment = game.world_env
	_check(not env.ssao_enabled and not env.ssr_enabled and not env.ssil_enabled and not env.volumetric_fog_enabled, "quest: no SSAO, SSR, SSIL or volumetric fog")
	var meshes := game.descent.find_children("*", "MeshInstance3D", true, false)
	_check(meshes.all(func(m: MeshInstance3D) -> bool: return m.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_OFF), "quest: nothing here casts a shadow (%d meshes)" % meshes.size())
	var labels := game.descent.find_children("*", "Label3D", true, false)
	_check(labels.is_empty(), "text: no vision draws any text")
	# Faces of one level come and go without leaking.
	var before: int = game.descent.get_child_count()
	game.descent.on_rebuilt()
	await process_frame
	_check(game.descent.get_child_count() == before, "quest: rebuilding the faces leaks nothing (%d)" % before)
	link.session_over.emit("test")
	await process_frame
	var built: int = game.descent.get_child_count()
	link.assignment_received.emit(_assignment(house, "b-2", {"descent": 4.0}))
	await process_frame
	_check(game.descent.get_child_count() >= built and game.descent.get("_built"), "quest: a second walk reuses what the first built")
	link.session_over.emit("test")
	await _end(main)
