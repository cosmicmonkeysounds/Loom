## The reinstallation game (`docs/loom-reinstall.md` §5): LOBBY → PLAYING →
## FOUND → LOBBY ([GameFlow]), wired to a [LinkBase] (the `ServerLink`
## autoload in a build, a fake in the tests).
##
## - **Lobby**: the dark room; the station waits for the tablet to send a
##   program, or the player picks one — the laser, the stick or the mouse
##   ([Lobby], [LobbyPointer]); a headset with no passcode sets itself up
##   there first ([SetupPanel]).
## - **Playing**: spawned at the assignment's spawn in the virtual house;
##   poses stream to the server (feet, house frame); the golden trail is
##   re-routed twice a second; within 0.9 m (plan) of the duck, on its
##   floor or within 1.2 m of its height (the server's rule), the game
##   claims it (`found`) — a "not near" answer just retries. A map edit that
##   moves the duck moves it here too ([signal LinkBase.duck_changed]); a
##   map that may be the wrong one is said on the HUD
##   ([signal LinkBase.map_warning]).
## - **The King** (a `king` prop guarding the Server Room door): one health
##   bar shared by every guest, held by the server ([member LinkBase.king]).
##   Near him and facing him, the hit button (a trigger, A / X) knocks one
##   point off — once per reinstallation visit ([method LinkBase.hit_king]).
##   At 0 he kneels for everyone and his door is open: no leaf, no collider,
##   and the trail routes through it ([method HouseKing.trail_map]); a
##   director's restore stands him up and shuts it again.
## - **Found**: egg, flight, "REINSTALLATION COMPLETE" (or "YOU FOUND
##   GERALD" for a program that wasn't corrupted); then the session ends and
##   the lobby comes back.
##
## - **Voice** (wave 19, [VoiceLink]): while playing, the terminals near
##   the player are heard at their screens and the player on the terminals
##   near them; B / Y (M on the desktop rig) mutes the mic. Off with
##   `--voice false`, listen-only with `--mic false`; never offline.
##
## The session also ends when the server says so ([signal
## LinkBase.session_over]) or the headset comes off ([method presence_changed],
## [method focus_changed], [method app_paused], [method headset_gone]).
##
## With `--autopilot` ([Autopilot], dev / CI) the game walks the trail itself
## and quits once its session is over: exit 0 after a find, 1 otherwise or
## after [constant AUTOPILOT_LIMIT] s. With `--hit-king` too it first walks
## up to the King, faces him and presses the hit button once (any answer
## then sends it on to the duck).
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
## Within this (plan metres, same floor) of a `king` prop the headset is told how to hit him.
const KING_NEAR := 1.5
## Beyond this the notice may be said again on the next approach.
const KING_FAR := 3.0
const KING_NOTICE := "Pull the trigger to hit the King — once per visit."
const KING_HIT := "You hit him."
const KING_DOWN := "He is down: the cold door is open."
## A visit ends at the duck, not at Leave or a timeout: a re-scan before
## Gerald is found is still the visit that hit him.
const KING_USED := "You hit him this reinstallation. Find Gerald before you hit him again."
const KING_CLOSER := "Get closer to the King and face him."
const KING_STANDS := "The King stands again."
const KING_PAUSED := "The show is paused."
## `--autopilot` gives up (exit 1) after this many seconds.
const AUTOPILOT_LIMIT := 180.0
## `--hit-king`: the autopilot stops this far (plan m) in front of the King,
## and waits at most this long (s) for the hit's answer.
const AUTOPILOT_KING_STAND := 0.9
const AUTOPILOT_KING_WAIT := 10.0

var link: LinkBase
var flow := GameFlow.new()

var builder: HouseBuilder
var player: VrPlayer
var lobby: Lobby
var duck: Duck
var trail: Trail
var ghosts: Ghosts
## The terminals' live camera feeds on their screens ([CamFeeds]).
var cams: CamFeeds
var hud: Hud
## The voice link ([VoiceLink]; running only while a session plays).
var voice: VoiceLink
## The lobby's laser / mouse ([LobbyPointer]).
var pointer: LobbyPointer

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
## The King's notice was said for this approach (cleared again beyond KING_FAR).
var _king_said := false
## This visit (session) has hit the King ("ok" or the server's "already hit").
var king_hit_used := false
## A hit is out (waiting for its answer).
var _king_hit_pending := false
## The hit button on the last frame (a hit is the press, not the hold).
var _hit_was := false
## Whether the shared King was down, last we heard.
var _king_fallen := false
## The map the trail and the autopilot route over: [member HouseBuilder.house]
## with the King's doors open while [member king_door_open]
## ([method HouseKing.trail_map]).
var route_house: Dictionary = {}
## The King's doors are open in this game: while he has fallen, and after a
## director's restore for as long as this player is still behind them or in
## the doorway ([method HouseKing.keep_door_open], the web game's
## `keepDoorOpen`) — a restore never shuts a player in. Re-checked with the
## trail, twice a second.
var king_door_open := false
## Non-null in `--autopilot` mode.
var autopilot: Autopilot = null
## Quit the process when an autopilot session is over (the tests keep it
## running and drive one session after another).
var autopilot_exit := true
var _autopilot_found := false
var _autopilot_played := false
var _autopilot_left := AUTOPILOT_LIMIT
## `--hit-king`: "" (off, or done) · "walk" (to the King) · "hit" (press
## next tick) · "wait" (the answer); and the seconds left to wait.
var autopilot_king := ""
var _autopilot_king_wait := 0.0


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
	cams = CamFeeds.new()
	cams.name = "Cams"
	cams.feed_shown.connect(builder.set_cam)
	cams.feed_lost.connect(builder.clear_cam)
	add_child(cams)
	player = PLAYER_SCENE.instantiate()
	player.xr_active = xr
	player.smooth_turn = bool(link.config.get("smooth_turn", false))
	add_child(player)
	hud = Hud.new()
	hud.name = "Hud"
	player.camera.add_child(hud)
	_setup_voice()
	# The lobby's picker: the laser / mouse, the ghosts' picture cache.
	pointer = LobbyPointer.new()
	pointer.name = "Pointer"
	pointer.player = player
	add_child(pointer)
	lobby.attach(link, ghosts.avatars)
	if bool(link.config.get("autopilot", false)):
		autopilot = Autopilot.new()
		player.read_input = false
		print("autopilot: on — waiting for an assignment")
		ghosts.avatars.loaded.connect(func(url: String, tex: Texture2D) -> void:
			print("autopilot: a ghost's picture landed — %s (%d px)" % [url, tex.get_width()]))

	link.status_changed.connect(lobby.set_status)
	link.assignment_received.connect(_on_assignment)
	link.begin_failed.connect(func(m: String) -> void: lobby.flash(m, 5.0, true))
	link.candidates_received.connect(lobby.set_candidates)
	link.house_loaded.connect(_on_house)
	link.found_answered.connect(_on_found_answered)
	link.session_over.connect(_on_session_over)
	link.duck_changed.connect(_on_duck_changed)
	link.map_warning.connect(_on_map_warning)
	link.stream_frame.connect(ghosts.on_frame)
	link.king_changed.connect(_on_king_changed)
	link.king_hit_answered.connect(_on_king_hit_answered)
	ghosts.url_of = link.avatar_url

	lobby.set_station(link.station_name())
	lobby.set_status(link.status)
	if not link.house.is_empty():
		_on_house(link.house, link.house_version)
	_on_king_changed(link.king)
	enter_lobby()


func state() -> GameFlow.State:
	return flow.state


# --- transitions ---------------------------------------------------------------


func enter_lobby() -> void:
	if autopilot != null and _autopilot_played:
		_autopilot_quit(0 if _autopilot_found else 1, "session over (%s)" % ("found" if _autopilot_found else "no find"))
	flow.abort()
	_update_route_house()
	duck.remove()
	trail.clear()
	cams.stop()
	_stop_voice()
	ghosts.own_session = ""
	# The head-locked HUD would float over the tiles: a notice still up
	# (the session ended, …) moves to the lobby's own message line.
	var carried := hud.notice_text() if _notice_left > 0.0 and hud.big_text() == "" else ""
	hud.hide_all()
	_notice_left = 0.0
	player.locomotion_enabled = false
	player.release_mouse()  # the lobby is pointed at, not looked around
	player.teleport(Lobby.SPOT, 0.0)
	lobby.reset()
	if carried != "":
		lobby.flash(carried, NOTICE_TIME)
	lobby.visible = true
	_cand_in = 0.0
	_found_pending = false
	# Nothing left to end: a program sent while the headset is still off
	# plays once it goes on.
	_away_until.clear()
	state_changed.emit(flow.state)


func _on_house(h: Dictionary, _version: String) -> void:
	builder.build(h)
	_update_route_house()
	if flow.state != GameFlow.State.LOBBY:
		duck.place(builder.to_world(flow.assignment["duck"]["pos"]))
	if flow.state == GameFlow.State.PLAYING:
		# A remap keeps the player where they stand — unless the new map has
		# no floor there (the shed is a solid prop on the tent map): back to
		# its spawn, as the server re-seats them (`HouseLocate.standable`).
		if not respawn_after_remap().is_empty():
			_notice("The house was remapped — you're back at the start.")
		_trail_in = 0.0
		if autopilot != null:
			autopilot.plan(route_house, builder.to_house(player.feet()), _autopilot_goal())


## Open or shut the King's doors in this game ([member king_door_open]) and
## re-derive [member route_house]: open while he has fallen; once he stands
## again, held open ([method HouseBuilder.hold_door]) while this player is
## behind them or in the doorway, shut once they are clear. Returns whether
## it opened or shut.
func _update_route_house() -> bool:
	var prop := HouseKing.king_prop(builder.house)
	var id := str(prop.get("id", ""))
	var k := link.king
	var fallen: bool = not k.is_empty() and k["fallen"] == true
	var hold := false
	if id != "" and not fallen and king_door_open and flow.state == GameFlow.State.PLAYING:
		hold = HouseKing.keep_door_open(builder.house, prop, builder.to_house(player.feet()))
	if id != "":
		builder.hold_door(id, hold)
	var open := id != "" and (fallen or hold)
	var moved := open != king_door_open
	king_door_open = open
	route_house = HouseKing.trail_map(builder.house, id, open)
	return moved


## The shared King changed: his bar, his stance, his doors, the trail; a
## player in the house hears when he falls or stands again.
func _on_king_changed(k: Dictionary) -> void:
	builder.set_king(k)
	_update_route_house()
	var fallen: bool = not k.is_empty() and k["fallen"] == true
	if fallen == _king_fallen:
		return
	_king_fallen = fallen
	if flow.state != GameFlow.State.PLAYING:
		return
	_notice(KING_DOWN if fallen else KING_STANDS)
	_trail_in = 0.0
	if autopilot != null:
		autopilot.plan(route_house, builder.to_house(player.feet()), _autopilot_goal())


func _on_king_hit_answered(result: String, _data: Dictionary) -> void:
	_king_hit_pending = false
	if flow.state != GameFlow.State.PLAYING:
		return
	if autopilot != null and autopilot_king != "":
		print("autopilot: the King answered %s — %s" % [result, link.king])
		_autopilot_to_duck()
	match result:
		"ok":
			king_hit_used = true
			_notice(KING_DOWN if _king_fallen else KING_HIT)
		"already hit":
			king_hit_used = true
			_notice(KING_USED)
		"fallen":
			_notice(KING_DOWN)
		"not near":
			_notice(KING_CLOSER)
		"doors are closed":
			_notice(KING_PAUSED)


## Put the player back at the map's spawn when where they stand is not
## standable on it; returns the spawn used, `{}` when they stay put.
## Judged on [member route_house], where a fallen (or held-open) King is no
## solid prop: a player crossing his spot to his door stays put.
func respawn_after_remap() -> Dictionary:
	var house := builder.house
	if house.is_empty():
		return {}
	_update_route_house()
	if HouseLocate.standable(route_house, builder.to_house(player.feet())):
		return {}
	var spawn: Dictionary = house["spawn"]
	player.teleport(builder.to_world(spawn["pos"]), builder.yaw_to_world(float(spawn["yaw"])))
	return spawn


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
		autopilot.plan(route_house, builder.to_house(player.feet()), _autopilot_goal())
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
		lobby.flash("No house map yet.", 5.0, true)
		return
	if not a.get("duck") is Dictionary or not a.get("spawn") is Dictionary:
		lobby.flash("That assignment has no duck.", 5.0, true)
		return
	if not flow.assign(a):
		return
	link.adopt(a)
	var spawn: Dictionary = a["spawn"]
	lobby.visible = false
	pointer.hide_beam()
	player.capture_mouse = true
	player.teleport(builder.to_world(spawn["pos"]), builder.yaw_to_world(float(spawn["yaw"])))
	player.locomotion_enabled = true
	duck.place(builder.to_world(a["duck"]["pos"]))
	ghosts.own_session = str(a.get("session", ""))
	ghosts.on_frame("leave", {"session": ghosts.own_session})
	ghosts.new_visit()
	_trail_in = 0.0
	_found_pending = false
	_found_retry = 0.0
	_notice_left = 0.0
	_king_said = false
	# The server's assignment says when a re-scan is the visit that already
	# hit him (missing on an old server = not yet).
	king_hit_used = a.get("kingHit", false) == true
	_king_hit_pending = false
	# The play buttons act on a press made while playing, never on one held
	# over from the lobby (the trigger that pulled START; B / Y does nothing
	# there).
	_hit_was = player.hit_button
	_mute_was = player.mute_button
	_update_route_house()
	hud.show_play(_room_label(HouseLocate.locate(builder.house, spawn["pos"])["room"]))
	if link.map_warning_text != "":
		_notice(link.map_warning_text)  # raised in the lobby, still in force
	if autopilot != null:
		_autopilot_played = true
		autopilot.plan(route_house, spawn["pos"], a["duck"]["pos"])
		print("autopilot: playing %s (%s) — %d waypoints to duck %s in %s" % [
			a.get("name", ""), a.get("session", ""), autopilot.path.size(), a["duck"].get("id", ""), a["duck"].get("room", "")])
		autopilot_king = ""
		var stand: Variant = autopilot_king_stand(builder.house)
		if bool(link.config.get("hit_king", false)) and stand != null:
			autopilot_king = "walk"
			autopilot.plan(route_house, spawn["pos"], stand)
			print("autopilot: --hit-king — %d waypoints to the King first" % autopilot.path.size())
	state_changed.emit(flow.state)


func _on_found_answered(ok: bool, data: Dictionary) -> void:
	_found_pending = false
	if not ok:
		_found_retry = FOUND_RETRY
		return
	# The server's `released` is the only proof of a release. A program still
	# captured after the find (the reply's `captured`, else the state the
	# walk began with) was kept by the story — the banishment: no egg, no
	# flight, nothing that reads as a release.
	var released: bool = data.get("released") == true
	var still_captured: bool = data.get("captured") == true if data.get("captured") is bool else flow.assignment.get("captured") == true
	var refused: bool = not released and still_captured
	var who := str(flow.assignment.get("name", ""))
	if not flow.found(released):
		return
	if autopilot != null:
		_autopilot_found = true
		player.left_stick = Vector2.ZERO
		print("autopilot: found — released=%s already=%s" % [data.get("released"), data.get("already")])
	if not refused:
		duck.celebrate()
	trail.clear()
	if released:
		hud.show_found("REINSTALLATION COMPLETE", who)
	elif refused:
		hud.show_found("GERALD CAN'T HELP", who)
	else:
		hud.show_found("YOU FOUND GERALD", who)
	state_changed.emit(flow.state)


func _on_session_over(reason: String) -> void:
	if flow.state == GameFlow.State.LOBBY:
		return
	enter_lobby()
	var text := session_over_text(reason)
	if text != "":
		lobby.flash(text, NOTICE_TIME)


## The lobby's line for a session that ended under the player
## ([signal LinkBase.session_over]'s reason): "" says nothing.
static func session_over_text(reason: String) -> String:
	match reason:
		"over", "ended", "found":
			return "Session ended."
		"reset":
			return "The story restarted — session ended."
		"event ended":
			return "The event is over."
		"reconfigured":
			return ""
	return "Session ended (%s)." % reason


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
	var aim := pointer.poll()
	pointer.draw(aim, lobby.aim(aim, delta))
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
	cams.tick(delta, house, feet, link.cams_url(), link.cams_token())
	_tick_voice()

	var duck_p: Array = flow.assignment["duck"]["pos"]
	_trail_in -= delta
	if _trail_in <= 0.0:
		_trail_in = TRAIL_INTERVAL
		if king_door_open and not _king_fallen and _update_route_house() and autopilot != null:
			autopilot.plan(route_house, feet, _autopilot_goal())
		refresh_trail(feet, duck_p)

	_found_retry -= delta
	if not _found_pending and _found_retry <= 0.0 and is_at_duck(house, feet, duck_p):
		_found_pending = true
		link.report_found()
	_tick_king(house, feet, builder.yaw_to_house(player.head_yaw()))


# --- voice ---

## The mute button on the last frame (a toggle is the press, not the hold).
var _mute_was := false


func _setup_voice() -> void:
	voice = VoiceLink.new()
	voice.name = "Voice"
	voice.builder = builder
	voice.mic_enabled = bool(link.config.get("mic", true))
	add_child(voice)


## While playing: run the voice link on the session (unless `voice` is off),
## toggle the mic on a press of the mute button, keep the HUD's mic line.
func _tick_voice() -> void:
	if not bool(link.config.get("voice", true)):
		return
	if not voice.is_running():
		voice.mic_enabled = bool(link.config.get("mic", true))  # a reconfigured headset
	voice.want(link.voice_stream_url(), link.voice_upload_url(), link.voice_token())
	var pressed := player.mute_button and not _mute_was
	_mute_was = player.mute_button
	if pressed:
		voice.toggle_mute()
	hud.set_mic(voice.hud_text(player.xr_active))


func _stop_voice() -> void:
	voice.stop()
	hud.set_mic("")


## Near the King (a `king` prop, with a shared King on the server): say
## once per approach how to hit him; on a press of the hit button, near and
## facing him ([method HouseKing.king_reach]), hit — once per visit.
func _tick_king(house: Dictionary, feet: Array, yaw: float) -> void:
	var pressed := player.hit_button and not _hit_was
	_hit_was = player.hit_button
	var prop := HouseKing.king_prop(house)
	var k := link.king
	if prop.is_empty() or k.is_empty():
		return  # no King here, or an old server with no shared one
	var pos: Array = prop["pos"]
	var nearest := INF
	if HouseLocate.floor_of(house, float(feet[1])) == HouseLocate.floor_of(house, float(pos[1])):
		nearest = Vector2(float(feet[0]) - float(pos[0]), float(feet[2]) - float(pos[2])).length()
	if nearest <= KING_NEAR and not _king_said:
		_king_said = true
		if k["fallen"] != true:
			_notice(KING_USED if king_hit_used else KING_NOTICE)
	elif nearest > KING_FAR:
		_king_said = false
	if not pressed or nearest > KING_FAR or _king_hit_pending:
		return
	if k["fallen"] == true:
		_notice(KING_DOWN)
	elif king_hit_used:
		_notice(KING_USED)
	elif HouseKing.king_reach(house, feet, yaw, prop) != "ok":
		_notice(KING_CLOSER)
	else:
		_king_hit_pending = true
		link.hit_king()


## Where `--hit-king` stands to hit him: [constant AUTOPILOT_KING_STAND] m
## out along his facing (the prop's yaw; the hall side), else null.
static func autopilot_king_stand(house: Dictionary) -> Variant:
	var prop := HouseKing.king_prop(house)
	if prop.is_empty():
		return null
	var f := HouseFrames.forward(float(prop.get("yaw", 0.0)) if prop.get("yaw") != null else 0.0)
	var p: Array = prop["pos"]
	return [float(p[0]) + f[0] * AUTOPILOT_KING_STAND, float(p[1]), float(p[2]) + f[2] * AUTOPILOT_KING_STAND]


## Where the autopilot is walking to: the King's stand (`--hit-king`,
## before the hit), else the duck.
func _autopilot_goal() -> Array:
	var stand: Variant = autopilot_king_stand(builder.house) if autopilot_king == "walk" else null
	return stand if stand != null else flow.assignment["duck"]["pos"]


func _autopilot_to_duck() -> void:
	autopilot_king = ""
	player.hit_button = false
	autopilot.plan(route_house, builder.to_house(player.feet()), flow.assignment["duck"]["pos"])


func _tick_autopilot(feet: Array, delta: float) -> void:
	match autopilot_king:
		"walk":
			var stand: Variant = autopilot_king_stand(builder.house)
			if stand != null and Vector2(float(feet[0]) - float(stand[0]), float(feet[2]) - float(stand[2])).length() <= Autopilot.REACH:
				var p: Array = HouseKing.king_prop(builder.house)["pos"]
				player.left_stick = Vector2.ZERO
				player.face(builder.yaw_to_world(rad_to_deg(atan2(-(float(p[0]) - float(feet[0])), -(float(p[2]) - float(feet[2]))))))
				autopilot_king = "hit"
				print("autopilot: at the King (%s) — hitting" % [feet])
				return
		"hit":
			player.hit_button = true
			autopilot_king = "wait"
			_autopilot_king_wait = AUTOPILOT_KING_WAIT
			return
		"wait":
			player.hit_button = false
			_autopilot_king_wait -= delta
			if _autopilot_king_wait <= 0.0 or not _king_hit_pending:
				print("autopilot: no hit (%s) — on to the duck" % ("no answer" if _autopilot_king_wait <= 0.0 else "refused here"))
				_autopilot_to_duck()
			return
	var s := autopilot.steer(feet, delta)
	if s["replan"]:
		print("autopilot: stuck at %s — re-planning" % [feet])
		autopilot.plan(route_house, feet, _autopilot_goal())
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
## stair's ramp (in its rect, within a step of its surface) it leaves by
## whichever end makes the whole walk shorter, `[from, end, …route(end, to)]`.
## `route` from a point on the ramp starts in one of the stair's rooms, so a
## player who has just stepped onto the foot would be pointed back at it.
## Under a stair's high end it first steps out of the nearer side
## ([method stair_step_out]), since `route` from there runs along the
## underside into the solid.
static func trail_path(house: Dictionary, from: Array, to: Array) -> Array:
	var stair: Variant = stair_under(house, from)
	if stair == null:
		var over: Variant = stair_above(house, from)
		var out: Variant = null if over == null else stair_step_out(house, over, from)
		if out == null:
			return HouseRoute.route(house, from, to)
		var stepped: Array = [from, out]
		stepped.append_array(HouseRoute.route(house, out, to).slice(1))
		return stepped
	if HouseGeometry.point_in_rect(stair["rect"], [to[0], to[2]]):
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


## How far past a stair's side the step out from under it lands.
const STAIR_OUT := VrPlayer.RADIUS + 0.1
## Within this of a side (a body rubbing it), the step out isn't done yet.
const STAIR_RUB := VrPlayer.RADIUS + 0.05


## The stair whose ramp feet `p` stand on (in its rect, within
## [constant HouseLocate.STEP_UP] of its surface; the nearest if two overlap
## in plan), else null.
static func stair_under(house: Dictionary, p: Array) -> Variant:
	var best: Variant = null
	var best_dy := INF
	for s: Dictionary in house.get("stairs", []):
		if not HouseGeometry.point_in_rect(s["rect"], [p[0], p[2]]):
			continue
		var dy := absf(float(p[1]) - HouseGeometry.ramp_height(house, s, [p[0], p[2]]))
		if dy <= HouseLocate.STEP_UP and dy < best_dy:
			best = s
			best_dy = dy
	return best


## The stair feet `p` stand beneath: on its `from` floor, in its rect in plan
## (or rubbing a side along the flight), the ramp more than a step overhead.
static func stair_above(house: Dictionary, p: Array) -> Variant:
	var floor_id := HouseLocate.floor_of(house, p[1])
	for s: Dictionary in house.get("stairs", []):
		var lo: Variant = HouseGeometry.room_by_id(house, s["from"])
		if lo == null or lo["floor"] != floor_id:
			continue
		var r: Array = s["rect"]
		var along: bool = s["up"] == "n" or s["up"] == "s"
		var grown: Array = [r[0] - STAIR_RUB, r[1], r[2] + STAIR_RUB, r[3]] if along else [r[0], r[1] - STAIR_RUB, r[2], r[3] + STAIR_RUB]
		if not HouseGeometry.point_in_rect(grown, [p[0], p[2]]):
			continue
		if HouseGeometry.ramp_height(house, s, [p[0], p[2]]) > float(p[1]) + HouseLocate.STEP_UP:
			return s
	return null


## Where a body under `stair` steps out to: out of the nearer of the rect's
## two sides along the flight, else (both against a wall) out of its high
## end — only a point still in the stair's `from` room counts. Null if none.
static func stair_step_out(house: Dictionary, stair: Dictionary, p: Array) -> Variant:
	var r: Array = stair["rect"]
	var x := float(p[0])
	var y := float(p[1])
	var z := float(p[2])
	var up: String = stair["up"]
	var a: Array
	var b: Array
	if up == "n" or up == "s":
		a = [r[0] - STAIR_OUT, y, z]
		b = [r[2] + STAIR_OUT, y, z]
	else:
		a = [x, y, r[1] - STAIR_OUT]
		b = [x, y, r[3] + STAIR_OUT]
	var head: Array
	match up:
		"n": head = [x, y, r[1] - STAIR_OUT]
		"s": head = [x, y, r[3] + STAIR_OUT]
		"e": head = [r[2] + STAIR_OUT, y, z]
		_: head = [r[0] - STAIR_OUT, y, z]
	var near: Array = [a, b] if Vector2(a[0] - x, a[2] - z).length() <= Vector2(b[0] - x, b[2] - z).length() else [b, a]
	near.append(head)
	for q: Array in near:
		if HouseLocate.locate(house, q)["room"] == stair["from"]:
			return q
	return null


## Re-route the chevrons from `from` to the duck (house frame).
func refresh_trail(from: Array, to: Array) -> void:
	var points: Array = []
	for s: Dictionary in HouseRoute.sample_trail(trail_path(route_house, from, to)):
		points.append({"pos": builder.to_world(s["p"]), "yaw": builder.yaw_to_world(s["yaw"])})
	trail.show_points(points)


func _room_label(room_id: Variant) -> String:
	var room: Variant = HouseGeometry.room_by_id(builder.house, room_id)
	return str(room["label"]) if room != null else ""
