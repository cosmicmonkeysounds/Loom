## Headless checks for the VR game (`docs/loom-reinstall.md` §5).
##
## The §1.2 ports are diffed against the goldens `@loom/house` generates
## (`res://test/golden/`, copied by `pnpm --filter @loom/house sync`) at
## 1e-3; the rest covers what has no golden: frames, the duck pick,
## locomotion maths, config precedence, the pose pump, the SSE parser, the
## lobby picker, the game state machine (with a fake link) and a smoke
## test that `main.tscn` builds the house.
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
	_test_config()
	_test_sse_parser()
	_test_pose_pump()
	_test_server_link()
	_test_locomotion()
	_test_picker()
	_test_flow()
	_test_autopilot()
	await _test_main_and_game()
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
	main.queue_free()
	await process_frame


## Room scale on the headset rig (a fake headset: the camera moved by hand):
## a real step or lean never takes the head (or the reported feet) through
## a wall, and a real step up the stairs climbs them.
func _test_room_scale() -> void:
	var house: Dictionary = _read_json("res://house/house.json")
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


func _assignment(house: Dictionary, sid: String, captured: bool) -> Dictionary:
	return {
		"session": sid, "token": "tok-" + sid, "guest": "g-aaaaaa", "name": "Ada", "world": "vr",
		"device": "Test Headset", "station": "vr-1", "captured": captured,
		"duck": HouseDuck.pick_duck_spot(house, sid), "spawn": house["spawn"], "houseVersion": "test",
	}


func _test_main_and_game() -> void:
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
	link.candidates_received.emit([{"id": "g-aaaaaa", "name": "Ada", "captured": true}, {"id": "g-bbbbbb", "name": "Bob", "captured": false}])
	player.left_stick = Vector2(0, -1)
	game._process(0.016)
	player.left_stick = Vector2.ZERO
	player.right_stick = Vector2(1, 0)
	for i in 30:
		game._process(1.0 / 60.0)
	_check(link.begun.is_empty(), "game: half a second is not a confirm")
	for i in 40:
		game._process(1.0 / 60.0)
	_check(link.begun == ["g-bbbbbb"], "game: hold right confirms the highlighted program (%s)" % [link.begun])
	player.right_stick = Vector2.ZERO

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
