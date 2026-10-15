## The reinstallation game (`docs/loom-reinstall.md` §5): LOBBY → PLAYING →
## FOUND → LOBBY ([GameFlow]), wired to a [LinkBase] (the `ServerLink`
## autoload in a build, a fake in the tests).
##
## - **Lobby**: the dark room; the station waits for the tablet to send a
##   program, or the player picks one with the stick ([Lobby]).
## - **Playing**: spawned at the assignment's spawn in the virtual house;
##   poses stream to the server (feet, house frame); the golden trail is
##   re-routed twice a second; within 0.9 m (plan) of the duck, on its
##   floor or within 1.2 m of its height (the server's rule), the game
##   claims it (`found`) — a "not near" answer just retries. A map edit that
##   moves the duck moves it here too ([signal LinkBase.duck_changed]); a
##   map that may be the wrong one is said on the HUD
##   ([signal LinkBase.map_warning]).
## - **Found**: egg, flight, "REINSTALLATION COMPLETE" (or "YOU FOUND
##   GERALD" for a program that wasn't corrupted); then the session ends and
##   the lobby comes back.
##
## The session also ends when the server says so ([signal
## LinkBase.session_over]) or the headset comes off ([method presence_changed],
## [method focus_changed], [method app_paused], [method headset_gone]).
##
## With `--autopilot` ([Autopilot], dev / CI) the game walks the trail itself
## and quits once its session is over: exit 0 after a find, 1 otherwise or
## after [constant AUTOPILOT_LIMIT] s.
class_name Game
extends Node3D

signal state_changed(state: GameFlow.State)

const PLAYER_SCENE := preload("res://player/player.tscn")
## The trail is re-routed this often (twice a second).
const TRAIL_INTERVAL := 0.5
const CANDIDATE_INTERVAL := 5.0
## After a "not near the duck" answer, wait this long before claiming again.
const FOUND_RETRY := 1.0
## Headset off (user presence lost): end the session after this long.
const PRESENCE_GRACE := 2.0
## Lost focus (system menu, or off on a runtime without user presence).
const UNFOCUSED_GRACE := 15.0
const NOTICE_TIME := 4.0
## `--autopilot` gives up (exit 1) after this many seconds.
const AUTOPILOT_LIMIT := 180.0

var link: LinkBase
var flow := GameFlow.new()

var builder: HouseBuilder
var player: VrPlayer
var lobby: Lobby
var duck: Duck
var trail: Trail
var ghosts: Ghosts
var hud: Hud

var _trail_in := 0.0
var _cand_in := 0.0
var _found_pending := false
var _found_retry := 0.0
## Why the headset counts as away → the wall-clock second the session ends
## ("presence", "focus", "paused"). Wall clock, not ticks: the monotonic
## clock stops while a Quest sleeps, and a sleeping headset runs no frames
## — the deadline is checked again the moment anything wakes it.
var _away_until := {}
## Seconds now (wall clock); tests inject a fake.
var clock: Callable = func() -> float: return Time.get_unix_time_from_system()
var _notice_left := 0.0
## Non-null in `--autopilot` mode.
var autopilot: Autopilot = null
## Quit the process when an autopilot session is over (the tests keep it
## running and drive one session after another).
var autopilot_exit := true
var _autopilot_found := false
var _autopilot_played := false
var _autopilot_left := AUTOPILOT_LIMIT


## Build the scene and connect to `l`. Called once by `main.gd`.
func setup(l: LinkBase, xr: bool) -> void:
	link = l
	builder = HouseBuilder.new()
	builder.name = "House"
	add_child(builder)
	lobby = Lobby.new()
	lobby.name = "Lobby"
	add_child(lobby)
	duck = Duck.new()
	duck.name = "Duck"
	add_child(duck)
	trail = Trail.new()
	trail.name = "Trail"
	add_child(trail)
	ghosts = Ghosts.new()
	ghosts.name = "Ghosts"
	ghosts.builder = builder
	add_child(ghosts)
	player = PLAYER_SCENE.instantiate()
	player.xr_active = xr
	player.smooth_turn = bool(link.config.get("smooth_turn", false))
	add_child(player)
	hud = Hud.new()
	hud.name = "Hud"
	player.camera.add_child(hud)
	if bool(link.config.get("autopilot", false)):
		autopilot = Autopilot.new()
		player.read_input = false
		print("autopilot: on — waiting for an assignment")

	link.status_changed.connect(lobby.set_status)
	link.assignment_received.connect(_on_assignment)
	link.begin_failed.connect(func(m: String) -> void: lobby.flash(m))
	link.candidates_received.connect(lobby.set_candidates)
	link.house_loaded.connect(_on_house)
	link.found_answered.connect(_on_found_answered)
	link.session_over.connect(_on_session_over)
	link.duck_changed.connect(_on_duck_changed)
	link.map_warning.connect(_on_map_warning)
	link.stream_frame.connect(ghosts.on_frame)

	lobby.set_station(link.station_name())
	lobby.set_status(link.status)
	if not link.house.is_empty():
		_on_house(link.house, link.house_version)
	enter_lobby()


func state() -> GameFlow.State:
	return flow.state


# --- transitions ---------------------------------------------------------------


func enter_lobby() -> void:
	if autopilot != null and _autopilot_played:
		_autopilot_quit(0 if _autopilot_found else 1, "session over (%s)" % ("found" if _autopilot_found else "no find"))
	flow.abort()
	duck.remove()
	trail.clear()
	ghosts.own_session = ""
	if _notice_left <= 0.0:
		hud.hide_all()
	player.locomotion_enabled = false
	player.teleport(Lobby.SPOT, 0.0)
	lobby.visible = true
	_cand_in = 0.0
	_found_pending = false
	# Nothing left to end: a program sent while the headset is still off
	# plays once it goes on.
	_away_until.clear()
	state_changed.emit(flow.state)


func _on_house(h: Dictionary, _version: String) -> void:
	builder.build(h)
	if flow.state != GameFlow.State.LOBBY:
		duck.place(builder.to_world(flow.assignment["duck"]["pos"]))
	if flow.state == GameFlow.State.PLAYING:
		_trail_in = 0.0
		if autopilot != null:
			autopilot.plan(builder.house, builder.to_house(player.feet()), flow.assignment["duck"]["pos"])


## The server moved our duck (a map edit): it hides somewhere else now.
func _on_duck_changed(d: Dictionary) -> void:
	if flow.state != GameFlow.State.PLAYING:
		return
	flow.assignment = flow.assignment.duplicate()
	flow.assignment["duck"] = d
	duck.place(builder.to_world(d["pos"]))
	_trail_in = 0.0
	_found_retry = 0.0
	if autopilot != null:
		autopilot.plan(builder.house, builder.to_house(player.feet()), d["pos"])
		print("autopilot: the duck moved to %s in %s — re-planned" % [d.get("id", ""), d.get("room", "")])
	_notice("Gerald moved — follow the arrows.")


## The map may be the wrong one (`text`), or is right again (`""`).
func _on_map_warning(text: String) -> void:
	if flow.state != GameFlow.State.PLAYING:
		return
	if text == "":
		_notice_left = 0.0
		hud.notice("")
	else:
		_notice(text)


func _on_assignment(a: Dictionary) -> void:
	if flow.state != GameFlow.State.LOBBY:
		return
	if builder.house.is_empty():
		lobby.flash("No house map yet.")
		return
	if not a.get("duck") is Dictionary or not a.get("spawn") is Dictionary:
		lobby.flash("That assignment has no duck.")
		return
	if not flow.assign(a):
		return
	link.adopt(a)
	var spawn: Dictionary = a["spawn"]
	lobby.visible = false
	player.teleport(builder.to_world(spawn["pos"]), builder.yaw_to_world(float(spawn["yaw"])))
	player.locomotion_enabled = true
	duck.place(builder.to_world(a["duck"]["pos"]))
	ghosts.own_session = str(a.get("session", ""))
	ghosts.on_frame("leave", {"session": ghosts.own_session})
	_trail_in = 0.0
	_found_pending = false
	_found_retry = 0.0
	_notice_left = 0.0
	hud.show_play(_room_label(HouseLocate.locate(builder.house, spawn["pos"])["room"]))
	if link.map_warning_text != "":
		_notice(link.map_warning_text)  # raised in the lobby, still in force
	if autopilot != null:
		_autopilot_played = true
		autopilot.plan(builder.house, spawn["pos"], a["duck"]["pos"])
		print("autopilot: playing %s (%s) — %d waypoints to duck %s in %s" % [
			a.get("name", ""), a.get("session", ""), autopilot.path.size(), a["duck"].get("id", ""), a["duck"].get("room", "")])
	state_changed.emit(flow.state)


func _on_found_answered(ok: bool, data: Dictionary) -> void:
	_found_pending = false
	if not ok:
		_found_retry = FOUND_RETRY
		return
	var captured: bool = flow.assignment.get("captured") == true or data.get("released") == true
	var who := str(flow.assignment.get("name", ""))
	if not flow.found(captured):
		return
	if autopilot != null:
		_autopilot_found = true
		player.left_stick = Vector2.ZERO
		print("autopilot: found — released=%s already=%s" % [data.get("released"), data.get("already")])
	duck.celebrate()
	trail.clear()
	hud.show_found("REINSTALLATION COMPLETE" if captured else "YOU FOUND GERALD", who)
	state_changed.emit(flow.state)


func _on_session_over(reason: String) -> void:
	if flow.state == GameFlow.State.LOBBY:
		return
	_notice("Session ended (%s)." % reason)
	enter_lobby()


## The headset's user presence (`user_presence_changed`): off ends the
## session after [constant PRESENCE_GRACE] s.
func presence_changed(present: bool) -> void:
	_away_changed("presence", not present, PRESENCE_GRACE)


## The session's focus (`session_focussed` / `session_visible`): unfocused
## ends it after [constant UNFOCUSED_GRACE] s. Focus coming back never
## cancels a presence-off countdown.
func focus_changed(focused: bool) -> void:
	_away_changed("focus", not focused, UNFOCUSED_GRACE)


## The app was paused (a Quest sleeping: no frames from here on) /
## resumed. Resuming past the grace ends the session at once, so the next
## wearer never inherits the last program's game.
func app_paused() -> void:
	_away_changed("paused", true, PRESENCE_GRACE)


func app_resumed() -> void:
	_away_changed("paused", false, PRESENCE_GRACE)


## The XR session is stopping: end now, no frame needed.
func headset_gone() -> void:
	_away_until.clear()
	_end_for_headset()


func _away_changed(why: String, away: bool, grace: float) -> void:
	if away:
		if not _away_until.has(why):
			_away_until[why] = float(clock.call()) + grace
		return
	# Coming back: a deadline that passed meanwhile (asleep, no frames) still ends it.
	if check_away():
		return
	_away_until.erase(why)


## End the session if an away deadline has passed; true when it did.
func check_away() -> bool:
	if _away_until.is_empty():
		return false
	var due := INF
	for t: float in _away_until.values():
		due = minf(due, t)
	if float(clock.call()) < due:
		return false
	_away_until.clear()
	return _end_for_headset()


func _end_for_headset() -> bool:
	if flow.state == GameFlow.State.LOBBY:
		return false
	link.end_session("headset")
	enter_lobby()
	return true


func _notice(text: String) -> void:
	hud.notice(text)
	_notice_left = NOTICE_TIME


# --- the loop ------------------------------------------------------------------


func _process(delta: float) -> void:
	if player == null:
		return
	if autopilot != null:
		_autopilot_left -= delta
		if _autopilot_left <= 0.0:
			_autopilot_quit(1, "gave up after %d s" % int(AUTOPILOT_LIMIT))
			return
	if _notice_left > 0.0:
		_notice_left -= delta
		if _notice_left <= 0.0 and flow.state == GameFlow.State.LOBBY:
			hud.hide_all()
		elif _notice_left <= 0.0 and flow.state == GameFlow.State.PLAYING:
			hud.notice("")
	if check_away():
		return
	match flow.state:
		GameFlow.State.LOBBY:
			_tick_lobby(delta)
		GameFlow.State.PLAYING:
			_tick_play(delta)
		GameFlow.State.FOUND:
			if flow.tick(delta):
				link.end_session("found")
				enter_lobby()


func _tick_lobby(delta: float) -> void:
	# Either stick drives the picker: the larger deflection on each axis.
	var l := player.left_stick
	var r := player.right_stick
	var stick := Vector2(l.x if absf(l.x) >= absf(r.x) else r.x, l.y if absf(l.y) >= absf(r.y) else r.y)
	var chosen := lobby.tick(stick, delta)
	if not chosen.is_empty():
		lobby.flash("Starting %s…" % chosen.get("name", chosen.get("id", "")), 3.0)
		link.begin(str(chosen["id"]))
	_cand_in -= delta
	if _cand_in <= 0.0:
		_cand_in = CANDIDATE_INTERVAL
		link.request_candidates()


func _tick_play(delta: float) -> void:
	var house := builder.house
	var feet := builder.to_house(player.feet())
	if autopilot != null:
		_tick_autopilot(feet, delta)
	link.send_pose(feet, builder.yaw_to_house(player.head_yaw()), player.head_pitch())
	var here := HouseLocate.locate(house, feet)
	hud.set_room(_room_label(here["room"]))

	var duck_p: Array = flow.assignment["duck"]["pos"]
	_trail_in -= delta
	if _trail_in <= 0.0:
		_trail_in = TRAIL_INTERVAL
		refresh_trail(feet, duck_p)

	_found_retry -= delta
	if not _found_pending and _found_retry <= 0.0 and is_at_duck(house, feet, duck_p):
		_found_pending = true
		link.report_found()


func _tick_autopilot(feet: Array, delta: float) -> void:
	var s := autopilot.steer(feet, delta)
	if s["replan"]:
		print("autopilot: stuck at %s — re-planning" % [feet])
		autopilot.plan(builder.house, feet, flow.assignment["duck"]["pos"])
		s = autopilot.steer(feet, delta)
	player.face(builder.yaw_to_world(float(s["yaw"])))
	player.left_stick = s["stick"]


func _autopilot_quit(code: int, why: String) -> void:
	if not autopilot_exit:
		_autopilot_played = false
		_autopilot_found = false
		_autopilot_left = AUTOPILOT_LIMIT
		return
	print("autopilot: %s — exit %d" % [why, code])
	autopilot = null
	# A beat for the last calls (`end`) to leave before the process does.
	get_tree().create_timer(1.0).timeout.connect(func() -> void: get_tree().quit(code))


## Whether feet `p` are within [constant Duck.FIND_RADIUS] (plan) of the duck
## at `duck_p` (house frame) and level with it the way the server judges a
## `found` (`core/server/spatial.ts` `nearDuck`): within
## [constant HouseDuck.DUCK_MAX_RISE] of its height, or on its floor.
static func is_at_duck(house: Dictionary, p: Array, duck_p: Array) -> bool:
	var dx: float = p[0] - duck_p[0]
	var dz: float = p[2] - duck_p[2]
	if dx * dx + dz * dz > Duck.FIND_RADIUS * Duck.FIND_RADIUS:
		return false
	if absf(float(p[1]) - float(duck_p[1])) <= HouseDuck.DUCK_MAX_RISE:
		return true
	return HouseLocate.floor_of(house, p[1]) == HouseLocate.floor_of(house, duck_p[1])


## The chevrons' path from feet `from` to the duck `to` (house frame) — the
## web game's `trail.ts`: off a stair it is [method HouseRoute.route]; on a
## stair's rect (on one of its two floors) it leaves by whichever end makes
## the whole walk shorter, `[from, end, …route(end, to)]`. `route` from a
## point on the ramp starts in one of the stair's rooms, so a player who has
## just stepped onto the foot would be pointed back at it.
static func trail_path(house: Dictionary, from: Array, to: Array) -> Array:
	var stair: Variant = null
	var floor_id := HouseLocate.floor_of(house, from[1])
	for s: Dictionary in house.get("stairs", []):
		if not HouseGeometry.point_in_rect(s["rect"], [from[0], from[2]]):
			continue
		var lo: Variant = HouseGeometry.room_by_id(house, s["from"])
		var hi: Variant = HouseGeometry.room_by_id(house, s["to"])
		if (lo != null and lo["floor"] == floor_id) or (hi != null and hi["floor"] == floor_id):
			stair = s
			break
	if stair == null or HouseGeometry.point_in_rect(stair["rect"], [to[0], to[2]]):
		return HouseRoute.route(house, from, to)
	var best: Array = []
	var best_length := INF
	for end: Dictionary in HouseRoute.portals(house):
		if end["kind"] == "door" or end["id"] != str(stair["id"]):
			continue
		var rest: Array = HouseRoute.route(house, end["pos"], to)
		var walk: Array = [from, end["pos"]]
		walk.append_array(rest.slice(1))
		var length := HouseRoute.path_length(walk)
		if length < best_length:
			best = walk
			best_length = length
	return best if not best.is_empty() else HouseRoute.route(house, from, to)


## Re-route the chevrons from `from` to the duck (house frame).
func refresh_trail(from: Array, to: Array) -> void:
	var points: Array = []
	for s: Dictionary in HouseRoute.sample_trail(trail_path(builder.house, from, to)):
		points.append({"pos": builder.to_world(s["p"]), "yaw": builder.yaw_to_world(s["yaw"])})
	trail.show_points(points)


func _room_label(room_id: Variant) -> String:
	var room: Variant = HouseGeometry.room_by_id(builder.house, room_id)
	return str(room["label"]) if room != null else ""
