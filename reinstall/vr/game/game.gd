## The reinstallation game (`docs/loom-reinstall.md` §5): LOBBY → PLAYING →
## FOUND → LOBBY ([GameFlow]), wired to a [LinkBase] (the `ServerLink`
## autoload in a build, a fake in the tests).
##
## - **Lobby**: the dark room; the station waits for the tablet to send a
##   program, or the player picks one — the laser, the stick or the mouse
##   ([Lobby], [LobbyPointer]); a headset with no passcode sets itself up
##   there first ([SetupPanel]). The MICROPHONE box says what the mic is
##   doing, TEST MIC opens it for a level meter (no session), ASK AGAIN
##   asks for the grant again, and the build stamp names the APK (wave 26).
## - **The intro** (wave 33, [IntroFlow] in [IntroSpace]): before each walk,
##   on a calm practice floor away from the house, the reinstallation video
##   on a cinema screen, then a gentle tutorial (look around, point and
##   pull the trigger, walk into a ring, turn round to a duck, a comfort
##   line, START). Both are skippable only once the program has completed a
##   reinstallation (the assignment's `reinstalled` ≥ 1). Turning is always
##   smooth (wave 33b). The spawn pose keeps the session alive throughout
##   (the server would time it out); no voice link, hum, quack, void or
##   find runs; the walk's clocks (the path reveal, the quack) start at its
##   end, and [method LinkBase.mark_ready] restarts the server's. Off with
##   `--intro false`, and always for `--autopilot`.
## - **Playing**: spawned at the assignment's spawn in the virtual house;
##   poses stream to the server (feet, house frame); the golden trail is
##   hidden for the walk's first minute (wave 26 R2, `trail_delay`, the
##   house's PATH_REVEAL_MS; the HUD just says "find Gerald"), then a notice
##   and the trail, re-routed twice a second; within 0.9 m (plan) of the duck, on its
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
## - **The void** (wave 26, R4, [HouseEscape]): walking out through the
##   house's exterior door is allowed; [constant HouseEscape.ESCAPE_M] past
##   the walls on that floor (every time, before or after Trabolta's reveal)
##   the walk freezes, one hard glitch flash ("FATAL EXCEPTION 0E", a
##   noise, a haptic pulse — no camera motion) and an escape moment goes up
##   ([method LinkBase.moment]); on its answer (at most [constant ESCAPE_WAIT]
##   s) the player is back at the spawn, and the answer's lines are spoken
##   and captioned ([Speech]). The teleport happens whatever the server says
##   (closed doors, an old server, a refusal). Within
##   [constant HouseEscape.ESCAPE_COOLDOWN_MS] of the last, the void puts
##   them back quietly (no scare, no moment).
## - **The heart** (R6, a `heart` prop): once the King has fallen it beats
##   in the server room; the first time the program stands
##   [constant HouseMoment.HEART_INSET_M] inside its room a heart moment
##   goes up, and the answer's lines play over it. No lines (he isn't awake
##   yet) → tried again on the next way in; "already" or the assignment's
##   `heartHeard` → silent for the night.
## - **The pickup** (R7, a `pickup` prop: the virus disk): within
##   [constant HouseMoment.PICKUP_REACH_M] a pickup moment goes up; taken
##   (or "already", or in the assignment's `picked`), the disk goes, a blip
##   plays and the answer's lines are captioned.
## - **The real lights** (wave 39, [HouseLamps]): the spatial stream's
##   `lights` frame puts a bulb at every fixture of the real house in the
##   colour and level it shows now, lights the nearest few for real, pulses
##   the ones a program stands under, and dims the house's ambient toward
##   night while the player walks it ([signal LinkBase.lights_changed]).
## - **The descent** (wave 49, [Descent], [Hallway], [TalkPanel]): the more
##   often a program has been reinstalled, the less the house holds together
##   (`descent` on the assignment, else `reinstalled`; `--descent N` forces it;
##   level 0 is all of the above and nothing else). Visions on a seeded plan,
##   props that wake and talk, a chosen answer told to the server
##   ([method LinkBase.post_told]), a door to a corridor off the map. Nothing
##   here ever blocks a find, a King hit, the void, the heart or the disk;
##   in the Hallway `_tick_play` returns early like `_tick_escape`, poses go
##   out from the door, and any way out (the far door, the time limit, a remap,
##   a session end) brings the player back clean.
## - **Found**: egg, flight, "REINSTALLATION COMPLETE" (or "YOU FOUND
##   GERALD" for a program that wasn't corrupted); then the session ends and
##   the lobby comes back.
##
## - **Voice** (wave 19, [VoiceLink]): while playing, the terminals near
##   the player are heard at their screens and the player on the terminals
##   near them. A guest cannot mute it (no button, no HUD line). Off with
##   `--voice false`, listen-only with `--mic false`; never offline.
## - **Sound** (wave 26, R8, [Sfx]): Gerald quacks from where he sits (the
##   web game's schedule), the find quacks and plays the fanfare (none for a
##   refused find), the King's hit thuds, a refusal buzzes, his fall plays
##   the fanfare, and a quiet hum runs while playing. Every one-shot holds
##   the mic shut while it plays ([method VoiceLink.hold_for]); the hum
##   pauses while a terminal listens, so no game sound reaches the mic.
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
## The lobby and the intro float in the sky: feet this far (m) under their
## floor have fallen through it, and go back on it.
const FELL_BELOW := 3.0
const CANDIDATE_INTERVAL := 5.0
## After a "not near the duck" answer, wait this long before claiming again.
const FOUND_RETRY := 1.0
## Headset off (user presence lost): end the session after this long.
const PRESENCE_GRACE := 2.0
## Lost focus (system menu, or off on a runtime without user presence).
const UNFOCUSED_GRACE := 15.0
const NOTICE_TIME := 4.0
## (wave 40, DRAFT w40) Flashed when a resume is declined by the server — the
## held walk's grace elapsed, or another program took the headset's station.
const RESUME_GONE := "That walk already ended."
## Within this (plan metres, same floor) of a `king` prop the headset is told how to hit him.
const KING_NEAR := 1.5
## Beyond this the notice may be said again on the next approach.
const KING_FAR := 3.0
const KING_NOTICE := "Pull the trigger to hit the King."
const KING_HIT := "You hit him."
const KING_DOWN := "He is down: the cold door is open."
## A visit ends at the duck, not at Leave or a timeout: a re-scan before
## Gerald is found is still the visit that hit him.
const KING_USED := "You hit him this reinstallation. Find Gerald before you hit him again."
const KING_CLOSER := "Get closer to the King and face him."
const KING_STANDS := "The King stands again."
const KING_PAUSED := "The show is paused."
## The path reveal (R2): the notice when the trail comes on, and "Gerald
## moved" before / after it.
const TRAIL_NOTICE := "A golden trail flickers on."
const DUCK_MOVED := "Gerald moved."
const DUCK_MOVED_TRAIL := "Gerald moved — follow the arrows."
## `--autopilot` gives up (exit 1) after this many seconds.
const AUTOPILOT_LIMIT := 180.0
## `--hit-king`: the autopilot stops this far (plan m) in front of the King,
## and waits at most this long (s) for the hit's answer.
const AUTOPILOT_KING_STAND := 0.9
const AUTOPILOT_KING_WAIT := 10.0
## (DRAFT w49) The lobby's line for the deep test level.
const TEST_DEEP := "Test level, deep (offline)…"
## The lobby's TEST MIC closes itself after this long (s).
const MIC_TEST_LIMIT := 30.0
## The void's scare holds at least this long (s), and waits at most
## [constant ESCAPE_WAIT] s for the server before the teleport.
const ESCAPE_SCARE := 1.5
const ESCAPE_WAIT := 3.0
## A heart / pickup moment refused for now (closed doors, no pose yet, out
## of reach, an error) is tried again after this long (s).
const MOMENT_RETRY := 1.5

var link: LinkBase
var flow := GameFlow.new()

var builder: HouseBuilder
var player: VrPlayer
var lobby: Lobby
var duck: Duck
## The real house's lights (wave 39).
var lamps: HouseLamps
## The world's environment and sun (set by `main.gd` before [method setup];
## null in a test without them).
var world_env: Environment
var sun: DirectionalLight3D
var trail: Trail
var ghosts: Ghosts
## The terminals' live camera feeds on their screens ([CamFeeds]).
var cams: CamFeeds
var hud: Hud
## The voice link ([VoiceLink]; running only while a session plays).
var voice: VoiceLink
## The game's own sounds ([Sfx]).
var sfx: Sfx
## The lines a game moment hands back, captioned and spoken ([Speech]).
var speech: Speech
## The lobby's laser / mouse ([LobbyPointer]).
var pointer: LobbyPointer
## The descent (wave 49): the visions and talkers, the options' panel, the
## Hallway.
var descent: Descent
var talk: TalkPanel
var hallway: Hallway
## Where the player walked into the Hallway (house frame) and the way they
## face coming back out of it: the pose the server sees while they are inside.
var _hall_feet: Array = []
var _hall_yaw := 0.0
## The intro before each walk (wave 33): its steps ([IntroFlow]) and its
## place ([IntroSpace]); the tutorial's ring and duck (world).
var intro := IntroFlow.new()
var intro_space: IntroSpace
var _intro_ring := Vector3.ZERO
var _intro_duck := Vector3.ZERO

var _trail_in := 0.0
## The trail's route on a worker thread (a headset only): the task in flight
## (-1: none), its route map's copy, and a generation that a clear bumps so
## a late answer for an old trail is dropped.
var _trail_task := -1
var _route_copy: Dictionary = {}
var _trail_gen := 0
## Seconds of this walk played so far (PLAYING only), and when the trail
## comes on ([member trail_revealed]); the minute restarts on a re-scan.
var _played_for := 0.0
var _reveal_after := HouseRoute.PATH_REVEAL_MS / 1000.0
var trail_revealed := false
var _cand_in := 0.0
## B B A A B A B A A B B in the lobby: the offline test level ([TestCombo]).
var _combo := TestCombo.new()
## … and its mirror, A A B B A B A B B A A: the same at the deepest level.
var _combo_deep := TestCombo.new(TestCombo.MIRROR)
## The level the test level plays at (< 0: not a test level).
var _test_level := -1
## Seconds to Gerald's next quack look ([method Sfx.quack_plan]).
var _quack_in := Sfx.QUACK_FIRST
## Seconds to the found screen's fanfare (< 0: none due).
var _fanfare_in := -1.0
## Seconds left on the lobby's TEST MIC.
var _mic_test_left := 0.0
## The void (R4): seconds into an escape (< 0: none), its answer once it
## came (`{result, data}`), and when (wall-clock s, [member clock]) the last
## escape went up (< 0: none this session). The cooldown counts from the
## post in wall time, scare included, so it never outlasts the server's
## (which starts a moment later): a walk-out it lets through gets the
## server's word, `cooldown` or a charged escape.
var _escape_t := -1.0
var _escape_answer: Dictionary = {}
var _escaped_at := -1.0
## Heart / pickup prop id → `{kind, state, retry}`: state "" (ready) ·
## "pending" · "wait" (retry after `retry` s) · "rearm" (again once the
## player has left it) · "done" (nothing more this walk).
var _props := {}
## The prop each kind's moment is out for ("" = none).
var _moment_out := {"heart": "", "pickup": ""}
var _found_pending := false
var _found_retry := 0.0
## The "no" buzz went off for this approach to Gerald: a refused find
## buzzes once, never again each retry (cleared on leaving him or a find).
var _found_buzzed := false
## Why the headset counts as away → the wall-clock second the session ends
## ("presence", "focus", "paused"). Wall clock, not ticks: the monotonic
## clock stops while a Quest sleeps, and a sleeping headset runs no frames
## — the deadline is checked again the moment anything wakes it.
var _away_until := {}
## (wave 40) The current walk was suspended (the headset came off): the
## server is holding it, so going away does not end it — the lobby offers a
## resume instead.
var _suspended := false
## (wave 40) The held walk the lobby is offering to resume (`{token, name}`),
## `{}` when none. While set, the lobby shows "Are you {name}?" and the
## picker is held.
var _resume_offer := {}
## (wave 40) Respawn here instead of the spawn when a resumed walk starts
## in the house (`{p, yaw}`), `{}` otherwise.
var _resume_pose := {}
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
	intro_space = IntroSpace.new()
	intro_space.name = "Intro"
	add_child(intro_space)
	duck = Duck.new()
	duck.name = "Duck"
	add_child(duck)
	lamps = HouseLamps.new()
	lamps.name = "Lamps"
	add_child(lamps)
	lamps.setup(builder, world_env, sun, HouseLights.tier_of(link.config.get("graphics", HouseLights.DEFAULT_TIER)))
	lamps.feet = func() -> Array: return body_feet()
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
	add_child(player)
	hud = Hud.new()
	hud.name = "Hud"
	player.camera.add_child(hud)
	_setup_voice()
	sfx = Sfx.new()
	sfx.name = "Sfx"
	add_child(sfx)
	sfx.played.connect(func(_sound: String, ms: float) -> void: voice.hold_for(ms))
	speech = Speech.new()
	speech.name = "Speech"
	speech.head = player.camera
	speech.hold = voice.hold_for
	add_child(speech)
	# The lobby's picker: the laser / mouse, the ghosts' picture cache.
	pointer = LobbyPointer.new()
	pointer.name = "Pointer"
	pointer.player = player
	add_child(pointer)
	talk = TalkPanel.new()
	talk.name = "TalkPanel"
	add_child(talk)
	hallway = Hallway.new()
	hallway.name = "Hallway"
	add_child(hallway)
	descent = Descent.new()
	descent.name = "Descent"
	descent.game = self
	add_child(descent)
	builder.built.connect(descent.on_rebuilt)
	lobby.attach(link, ghosts.avatars)
	lobby.mic_action.connect(_on_mic_action)
	lobby.resume_answered.connect(_on_resume_answer)  # (wave 40) the resume card's YES / NO
	lobby.set_build(StationConfig.build_stamp())
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
	link.resumed.connect(_on_resumed)
	link.resume_failed.connect(_on_resume_failed)
	link.duck_changed.connect(_on_duck_changed)
	link.map_warning.connect(_on_map_warning)
	link.stream_frame.connect(ghosts.on_frame)
	link.king_changed.connect(_on_king_changed)
	link.king_hit_answered.connect(_on_king_hit_answered)
	link.moment_answered.connect(_on_moment_answered)
	link.lights_changed.connect(lamps.apply)
	link.descent_loaded.connect(func(words: Variant) -> void: descent.adopt_script(words))
	ghosts.url_of = link.avatar_url

	lobby.set_station(link.station_name())
	lobby.set_status(link.status)
	if not link.house.is_empty():
		_on_house(link.house, link.house_version)
	_on_king_changed(link.king)
	if not link.lights.is_empty():
		lamps.apply(link.lights)
	enter_lobby()
	_maybe_offer_saved()  # (wave 40) a walk saved before a relaunch → the resume prompt


func state() -> GameFlow.State:
	return flow.state


# --- transitions ---------------------------------------------------------------


func enter_lobby() -> void:
	if autopilot != null and _autopilot_played:
		_autopilot_quit(0 if _autopilot_found else 1, "session over (%s)" % ("found" if _autopilot_found else "no find"))
	_close_hallway()  # the house back first: nobody stays in there
	descent.stop()
	_test_level = -1
	flow.abort()
	intro.abort()
	intro_space.close()
	_update_route_house()
	duck.remove()
	_clear_trail()
	cams.stop()
	_stop_voice()
	sfx.set_hum(false)
	speech.stop()
	_fanfare_in = -1.0
	_escape_t = -1.0
	_escape_answer = {}
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
	_prime_mic()
	if carried != "":
		lobby.flash(carried, NOTICE_TIME)
	lobby.visible = true
	_cand_in = 0.0
	_found_pending = false
	# Nothing left to end: a program sent while the headset is still off
	# plays once it goes on.
	_away_until.clear()
	# (wave 40) The playing walk is behind us; a fresh resume offer (if any)
	# is set right after this call returns.
	_suspended = false
	_resume_offer = {}
	lobby.clear_resume()  # (wave 40) any stale resume card goes; a fresh offer re-shows it
	state_changed.emit(flow.state)


func _on_house(h: Dictionary, _version: String) -> void:
	if hallway.active():
		_leave_hallway()  # the house back first: a remap never reaches the pocket
	builder.build(h)
	_update_route_house()
	if flow.state != GameFlow.State.LOBBY:
		duck.place(builder.to_world(flow.assignment["duck"]["pos"]))
	if flow.state == GameFlow.State.PLAYING:
		_adopt_props()  # the session's own map may land after the assignment
		if intro.running():
			return  # not in the house yet: the walk starts at the spawn anyway
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
		hold = HouseKing.keep_door_open(builder.house, prop, body_feet())
	if id != "":
		builder.hold_door(id, hold)
	var open := id != "" and (fallen or hold)
	var moved := open != king_door_open
	king_door_open = open
	route_house = HouseKing.trail_map(builder.house, id, open)
	# The trail's worker thread reads its own copy (the builder's map can
	# change under it on this thread).
	_route_copy = route_house.duplicate(true)
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
	if flow.state != GameFlow.State.PLAYING or intro.running():
		return
	_notice(KING_DOWN if fallen else KING_STANDS)
	if fallen:
		sfx.play("fanfare")
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
			sfx.play("thud")
			_notice(KING_DOWN if _king_fallen else KING_HIT)
		"already hit":
			king_hit_used = true
			_notice(KING_USED)
		"fallen":
			_notice(KING_DOWN)
		"not near":
			sfx.play("buzz")
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
	if intro.running():
		return  # nothing to say before the walk
	if autopilot != null:
		autopilot.plan(route_house, builder.to_house(player.feet()), _autopilot_goal())
		print("autopilot: the duck moved to %s in %s — re-planned" % [d.get("id", ""), d.get("room", "")])
	_notice(DUCK_MOVED_TRAIL if trail_revealed else DUCK_MOVED)


## The map may be the wrong one (`text`), or is right again (`""`).
func _on_map_warning(text: String) -> void:
	if flow.state != GameFlow.State.PLAYING or intro.running():
		return  # the walk's start says a warning still in force
	if text == "":
		_notice_left = 0.0
		hud.notice("")
	else:
		_notice(text)


func _on_assignment(a: Dictionary) -> void:
	if flow.state != GameFlow.State.LOBBY:
		return
	_resume_offer = {}  # (wave 40) a real assignment supersedes a pending resume offer
	lobby.clear_resume()
	if builder.house.is_empty():
		lobby.flash("No house map yet.", 5.0, true)
		return
	if not a.get("duck") is Dictionary or not a.get("spawn") is Dictionary:
		lobby.flash("That assignment has no duck.", 5.0, true)
		return
	if _test_level > 0:
		# (wave 49) A program that has been through this many times: its
		# intro is skippable and its lines count right.
		a = a.duplicate()
		a["reinstalled"] = _test_level
	_enter_walk(a, {})


## Take up a walk: a fresh assignment (`resume_pose` `{}`, the intro plays if
## the station wants it) or a resumed one (`resume_pose` `{p, yaw}` set → in
## the house at once, the intro already done). The session is adopted here.
func _enter_walk(a: Dictionary, resume_pose: Dictionary) -> void:
	if not flow.assign(a):
		return
	# TEST MIC ends when a program starts — also with no voice link to take
	# the mic over (offline, no token yet), where nothing else would close it.
	voice.stop_test()
	link.adopt(a)
	lobby.visible = false
	pointer.hide_beam()
	player.capture_mouse = true
	duck.place(builder.to_world(a["duck"]["pos"]))
	ghosts.own_session = str(a.get("session", ""))
	ghosts.on_frame("leave", {"session": ghosts.own_session})
	ghosts.new_visit()
	_escaped_at = -1.0
	_reset_props(a)
	_king_said = false
	# The server's assignment says when a re-scan is the visit that already
	# hit him (missing on an old server = not yet).
	king_hit_used = a.get("kingHit", false) == true
	_king_hit_pending = false
	_resume_pose = resume_pose
	if walk_level(a) > 0:
		link.fetch_descent()  # never waited for: the walk starts on what we have
	if not resume_pose.is_empty():
		_start_play()  # resumed mid-walk: straight in-house, no intro
	elif intro_wanted():
		_start_intro(a)
	else:
		_start_play()
	state_changed.emit(flow.state)


## Whether a walk starts with the intro: the station's `intro` (default
## on), never for the autopilot.
func intro_wanted() -> bool:
	return autopilot == null and bool(link.config.get("intro", true))


## This walk's level of the descent: the test level's, the headset's own
## (`--descent N`), else the assignment's.
func walk_level(a: Dictionary) -> int:
	if _test_level >= 0:
		return _test_level
	var forced: Variant = link.config.get("descent")
	return HouseDescent.clamp_descent(forced) if forced != null else HouseDescent.descent_of(a)


## Into the house at the assignment's spawn: the walk (and its clocks — the
## path reveal, the quack) starts now, after any intro.
func _start_play() -> void:
	var a := flow.assignment
	var spawn: Dictionary = a["spawn"]
	# (wave 40) A resumed walk starts where it left off, not at the spawn.
	var start_pos: Array = _resume_pose["p"] if not _resume_pose.is_empty() else spawn["pos"]
	var start_yaw: float = float(_resume_pose.get("yaw", spawn["yaw"])) if not _resume_pose.is_empty() else float(spawn["yaw"])
	_resume_pose = {}
	player.teleport(builder.to_world(start_pos), builder.yaw_to_world(start_yaw))
	player.locomotion_enabled = true
	_trail_in = 0.0
	_found_pending = false
	_found_retry = 0.0
	_found_buzzed = false
	_notice_left = 0.0
	_quack_in = Sfx.QUACK_FIRST
	_fanfare_in = -1.0
	sfx.set_hum(true)
	_played_for = 0.0
	_escape_t = -1.0
	_escape_answer = {}
	_reveal_after = maxf(0.0, float(link.config.get("trail_delay", HouseRoute.PATH_REVEAL_MS / 1000.0)))
	trail_revealed = false
	_clear_trail()
	# The play buttons act on a press made while playing, never on one held
	# over from the lobby or the intro (the trigger that pulled START; B / Y
	# does nothing there).
	_hit_was = player.hit_button
	_update_route_house()
	_sight_room = null
	_tick_sight(start_pos)
	descent.start(a, walk_level(a), link.descent_script if link.descent_script != null else HouseDescent.bundled())
	hud.show_play()
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


# --- the intro (wave 33) ---------------------------------------------------------


## Whether the intro (the video or the tutorial) is under way.
func in_intro() -> bool:
	return flow.state == GameFlow.State.PLAYING and intro.running()


func _start_intro(a: Dictionary) -> void:
	player.locomotion_enabled = false
	player.teleport(IntroSpace.SPOT, 0.0)
	hud.hide_all()
	_notice_left = 0.0
	sfx.set_hum(false)
	var events := intro.start(a.get("reinstalled", 0))
	print("reinstall-vr: intro — %s (reinstalled %s: %s)" % [a.get("name", ""), a.get("reinstalled", 0), "skippable" if intro.skippable else "no skipping"])
	_intro_events(events)
	intro_space.render(intro)


## One frame of the intro: the spawn pose (the session stays alive, and in
## the house), the laser on the cinema or the panel, the guest's progress.
func _tick_intro(delta: float) -> void:
	var spawn: Dictionary = flow.assignment["spawn"]
	link.send_pose(spawn["pos"], float(spawn.get("yaw", 0.0)), 0.0)
	var aim := pointer.poll()
	var h := intro_space.aim(aim)
	pointer.draw(aim, h)
	var feet := player.feet()
	var yaw := player.head_yaw()
	var inp := {
		"yaw": yaw,
		"video_done": intro_space.video_finished(),
		"in_ring": intro_space.ring_shown() and IntroFlow.in_ring(feet, _intro_ring),
		"facing": intro.step == IntroFlow.Step.TURN and IntroFlow.facing(yaw, player.camera.global_position, _intro_duck),
		"pressed": str(h.get("id", "")) if aim.get("pressed", false) == true else "",
	}
	_intro_events(intro.tick(delta, inp))
	if intro.running():
		intro_space.render(intro)


## Press intro button `id` as the laser would (tests, the screenshot tool).
func intro_press(id: String) -> void:
	if in_intro():
		_intro_events(intro.press(id))
		if intro.running():
			intro_space.render(intro)


func _intro_events(events: Array) -> void:
	for e: Dictionary in events:
		match str(e["event"]):
			"step":
				_intro_step(e["step"])
			"success":
				sfx.play("chime")
				player.pulse(0.25, 0.08)
				if intro.step == IntroFlow.Step.TURN and intro.faced:
					# Turned round to the duck: it quacks, and the panel stays
					# put so nothing hides it (COMFORT comes round after).
					sfx.quack_at(intro_space.duck.emitter)
			"done":
				_finish_intro()


func _intro_step(step: IntroFlow.Step) -> void:
	var feet := player.feet()
	var yaw := player.head_yaw()
	player.locomotion_enabled = intro.locomotion()
	if step != IntroFlow.Step.VIDEO:
		intro_space.stop_video()
	match step:
		IntroFlow.Step.VIDEO:
			intro_space.start_video()
		IntroFlow.Step.WELCOME, IntroFlow.Step.POINT, IntroFlow.Step.COMFORT:
			intro_space.hide_ring()
			intro_space.place_panel(feet, yaw)
		IntroFlow.Step.WALK:
			_intro_ring = intro_space.place_ring(feet, yaw)
			# Beyond the ring, so the walk never goes through it.
			intro_space.place_panel(feet, yaw, IntroSpace.RING_AHEAD + 1.8)
		IntroFlow.Step.TURN:
			intro_space.hide_ring()
			intro_space.place_panel(feet, yaw)
			_intro_duck = intro_space.place_duck(feet, yaw)
	if step != IntroFlow.Step.DONE:
		print("reinstall-vr: intro — %s" % IntroFlow.name_of(step))


## The intro is over: down to the house, and the server's clock restarts.
func _finish_intro() -> void:
	intro_space.close()
	pointer.hide_beam()
	_start_play()
	link.mark_ready()
	print("reinstall-vr: intro — over; walking")


func _on_found_answered(ok: bool, data: Dictionary) -> void:
	_found_pending = false
	if not ok:
		_found_retry = FOUND_RETRY
		# Once per approach, and only for a real "no": a pause, a parked
		# session or a dropped request retries every second in silence (each
		# buzz would also hold the mic shut).
		if flow.state == GameFlow.State.PLAYING and not _found_buzzed and found_refusal_buzzes(data):
			_found_buzzed = true
			sfx.play("buzz")
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
	descent.on_found()
	sfx.quack_at(duck.emitter, 1.0)
	sfx.set_hum(false)
	if not refused:
		duck.celebrate()
		_fanfare_in = Sfx.FANFARE_AFTER
	_clear_trail()
	if released:
		hud.show_found("REINSTALLATION COMPLETE", who)
	elif refused:
		hud.show_found("GERALD CAN'T HELP", who)
	else:
		hud.show_found("YOU FOUND GERALD", who)
	speech.say(descent.found_lines())
	state_changed.emit(flow.state)


## Whether a refused find's answer earns the "no" buzz: a real refusal
## ("not near the duck", …) does; the doors being closed (a pause, before
## doors), a session not started yet and a dropped request (no `error`)
## are only "not now".
static func found_refusal_buzzes(data: Dictionary) -> bool:
	var error := str(data.get("error", ""))
	return error != "" and not str(ServerLink.MOMENT_409.get(error, "")) in ["doors are closed", "parked"]


func _on_session_over(reason: String) -> void:
	if flow.state == GameFlow.State.LOBBY:
		return
	enter_lobby()
	var text := session_over_text(reason)
	if text != "":
		lobby.flash(text, NOTICE_TIME)


## The lobby's line for a session that ended under the player
## ([signal LinkBase.session_over]'s reason): "" says nothing. `unmarked`
## (wave 18b, R16): the program is no longer marked for reinstallation (a
## director released it mid-walk), so the walk is over before a find.
static func session_over_text(reason: String) -> String:
	match reason:
		"unmarked":
			return "No longer marked for reinstallation — the simulation ended."
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
## resumed. (wave 40) The walk is held when it goes away, so resuming past
## the grace offers to resume it in the lobby rather than ending it — the
## next wearer confirms "Are you {program}?" or declines.
func app_paused() -> void:
	_away_changed("paused", true, PRESENCE_GRACE)


func app_resumed() -> void:
	_away_changed("paused", false, PRESENCE_GRACE)


## The XR session is stopping: leave the house now, no frame needed. (wave
## 40) A live walk is held + offered to resume, not ended.
func headset_gone() -> void:
	_away_until.clear()
	_end_for_headset()


func _away_changed(why: String, away: bool, grace: float) -> void:
	if away:
		# The Android microphone dialog pauses / unfocuses the app: answering
		# it ends nobody's session.
		if why != "presence" and voice != null and voice.mic_state == "asking":
			return
		# (wave 40) Hold the walk the moment the headset comes off, so a Quest
		# that sleeps (no more frames, no more poses) keeps it through the
		# server's resume grace instead of the 60 s pose timeout. Never the
		# autopilot (no one to resume it).
		if autopilot == null and flow.state == GameFlow.State.PLAYING and link.has_session() and not _suspended:
			link.suspend()
			_suspended = true
		if not _away_until.has(why):
			_away_until[why] = float(clock.call()) + grace
		return
	# Coming back: a deadline that passed meanwhile (asleep, no frames) still applies.
	if check_away():
		return
	_away_until.erase(why)
	if _away_until.is_empty():
		_suspended = false  # (wave 40) fully back; a later doff holds the walk again


## Offer to resume (or end) if an away deadline has passed; true when it did.
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


## The headset was away past the grace. (wave 40) A live walk is held
## server-side and the lobby offers to resume it — the same program picks up
## where it was, or the next wearer declines. The autopilot just ends.
func _end_for_headset() -> bool:
	if flow.state == GameFlow.State.LOBBY:
		return false
	if autopilot == null and link.has_session():
		var token := str(link.session.get("token", ""))
		var name := str(link.session.get("name", ""))
		link.suspend()  # idempotent: make sure the server is holding it
		enter_lobby()
		_show_resume_offer(token, name)
		return true
	link.end_session("headset")
	enter_lobby()
	return true


# --- resume (wave 40) ----------------------------------------------------------


## Show the lobby's "Are you {program}?" card for a held walk; the lobby
## owns the view until YES / NO ([method _on_resume_answer]).
func _show_resume_offer(token: String, name: String) -> void:
	if token == "":
		return
	_resume_offer = {"token": token, "name": name}
	lobby.offer_resume(name if name != "" else "this program")


## A walk saved before a relaunch (the Quest slept and the app was killed):
## offer to resume it once, in the lobby. Never the autopilot or offline.
func _maybe_offer_saved() -> void:
	if autopilot != null or link.has_session():
		return
	var walk := link.saved_walk()
	if not walk.is_empty():
		_show_resume_offer(str(walk.get("token", "")), str(walk.get("name", "")))


## The lobby's resume card was answered ([signal Lobby.resume_answered]):
## YES asks the server for the held walk back, NO hands the headset off.
func _on_resume_answer(yes: bool) -> void:
	if _resume_offer.is_empty():
		return
	var token := str(_resume_offer.get("token", ""))
	_resume_offer = {}
	lobby.clear_resume()
	if yes:
		lobby.flash("Resuming…", 3.0)
		link.resume(token)
	else:
		link.end_session("handed off")


## The server gave the held walk back ([signal LinkBase.resumed]): take it
## up where it was. `ready` true → straight into the house at `pose`; false
## → the intro plays first (they had not finished it).
func _on_resumed(a: Dictionary, pose: Dictionary, ready: bool) -> void:
	_resume_offer = {}
	lobby.clear_resume()
	if flow.state != GameFlow.State.LOBBY:
		return
	if builder.house.is_empty() or not a.get("duck") is Dictionary or not a.get("spawn") is Dictionary:
		enter_lobby()
		return
	_enter_walk(a, pose if ready else {})


## No held walk to resume ([signal LinkBase.resume_failed]): start fresh.
func _on_resume_failed() -> void:
	_resume_offer = {}
	lobby.clear_resume()
	if flow.state != GameFlow.State.LOBBY:
		enter_lobby()
	else:
		lobby.flash(RESUME_GONE, NOTICE_TIME)


func _notice(text: String) -> void:
	hud.notice(text)
	_notice_left = NOTICE_TIME


# --- the loop ------------------------------------------------------------------


func _process(delta: float) -> void:
	if player == null:
		return
	# The real lights' ambient and pool follow the player in the house only.
	lamps.in_house = flow.state != GameFlow.State.LOBBY and not intro.running()
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
	_catch_fall()
	match flow.state:
		GameFlow.State.LOBBY:
			_tick_lobby(delta)
		GameFlow.State.PLAYING:
			if intro.running():
				_tick_intro(delta)
			else:
				_tick_play(delta)
		GameFlow.State.FOUND:
			if _fanfare_in >= 0.0:
				_fanfare_in -= delta
				if _fanfare_in < 0.0:
					sfx.play("fanfare")
			if flow.tick(delta):
				link.end_session("found")
				enter_lobby()
	descent.step(delta)


## The safety net under the lobby and the intro: a body that fell through
## their floor (it never should) is put back on it, and the log says so.
func _catch_fall() -> void:
	var spot: Vector3
	if flow.state == GameFlow.State.LOBBY:
		spot = Lobby.SPOT
	elif flow.state == GameFlow.State.PLAYING and intro.running():
		spot = IntroSpace.SPOT
	else:
		return
	if player.feet().y > spot.y - FELL_BELOW:
		return
	falls += 1
	print("reinstall-vr: fell through the floor at %.1f m; back on it" % player.feet().y)
	player.teleport(spot, player.head_yaw())


## How often [method _catch_fall] caught a fall (for the tests).
var falls := 0


## The test level: play offline (the bundled house) as the captured
## offline program, no server needed ([TestCombo]).
func start_test_level(level := -1) -> void:
	_test_level = level
	link.play_offline()
	lobby.flash(TEST_DEEP if level > 0 else "Test level (offline)…", 3.0)
	link.begin("g-000001")


func _tick_lobby(delta: float) -> void:
	# (wave 40) While a resume is offered the lobby shows its own card (YES /
	# NO), so the normal pointer + stick path drives it; a program begin
	# cannot fire under it (the tiles are not in this view).
	var aim := pointer.poll()
	pointer.draw(aim, lobby.aim(aim, delta))
	# Either stick drives the picker: the larger deflection on each axis.
	var l := player.left_stick
	var r := player.right_stick
	var stick := Vector2(l.x if absf(l.x) >= absf(r.x) else r.x, l.y if absf(l.y) >= absf(r.y) else r.y)
	var chosen := lobby.tick(stick, delta)
	var hands := [player.left_hand, player.right_hand]
	var ax := TestCombo.held(hands, "ax_button")
	var by := TestCombo.held(hands, "by_button")
	var plain := _combo.feed(ax, by, delta)
	var deep := _combo_deep.feed(ax, by, delta)
	if plain or deep:
		start_test_level(HouseDescent.DESCENT_MAX if deep else -1)
		return
	if not chosen.is_empty():
		lobby.flash("Starting %s…" % chosen.get("name", chosen.get("id", "")), 3.0)
		link.begin(str(chosen["id"]))
	_cand_in -= delta
	if _cand_in <= 0.0:
		_cand_in = CANDIDATE_INTERVAL
		link.request_candidates()
	_tick_lobby_mic(delta)


## The lobby's MICROPHONE box: its line, the TEST MIC meter, ASK AGAIN
## while the grant is missing or refused.
func _tick_lobby_mic(delta: float) -> void:
	var voice_on := bool(link.config.get("voice", true))
	var mic_on := bool(link.config.get("mic", true))
	if voice.is_testing():
		_mic_test_left -= delta
		if _mic_test_left <= 0.0 or not (voice_on and mic_on):
			voice.stop_test()
	var grant := voice.permission_state()
	lobby.set_mic(voice.lobby_text(voice_on, mic_on), voice.test_level(), voice.is_testing(), voice_on and mic_on, voice_on and mic_on and grant in ["unknown", "denied"])


## TEST MIC (toggles the test) or ASK AGAIN, pressed in the lobby.
func _on_mic_action(id: String) -> void:
	if flow.state != GameFlow.State.LOBBY:
		return
	match id:
		"mic:test":
			if voice.is_testing():
				voice.stop_test()
			else:
				voice.mic_enabled = bool(link.config.get("mic", true))
				_mic_test_left = MIC_TEST_LIMIT
				voice.start_test()
		"mic:ask":
			voice.ask_again()


func _tick_play(delta: float) -> void:
	var house := builder.house
	if hallway.active():
		# Off the map: the server keeps seeing them at the door they went
		# through; no void, heart, pickup, King or find in here.
		_tick_hallway(delta)
		return
	var feet := builder.to_house(player.feet())
	if _escape_t >= 0.0:
		# Frozen in the void: no poses (the server judges the one outside),
		# no trail, no claims — until the answer or the wait runs out.
		_tick_escape(delta)
		_tick_voice()
		return
	if autopilot != null:
		_tick_autopilot(feet, delta)
	link.send_pose(feet, builder.yaw_to_house(player.head_yaw()), player.head_pitch())
	var out: Variant = HouseEscape.void_distance(house, feet)
	if out != null and float(out) >= HouseEscape.ESCAPE_M:
		_start_escape()
		return
	var here := HouseLocate.locate(house, feet)
	_tick_sight(feet)
	cams.tick(delta, house, feet, link.cams_url(), link.cams_token())
	_tick_voice()

	var duck_p: Array = flow.assignment["duck"]["pos"]
	_tick_reveal(delta)
	_trail_in -= delta
	if _trail_in <= 0.0:
		_trail_in = TRAIL_INTERVAL
		if king_door_open and not _king_fallen and _update_route_house() and autopilot != null:
			autopilot.plan(route_house, feet, _autopilot_goal())
		if trail_revealed:
			refresh_trail(feet, duck_p)
		else:
			_clear_trail()

	_tick_quack(feet, duck_p, delta)
	_tick_props(house, feet, delta)
	_found_retry -= delta
	var at_duck := is_at_duck(house, feet, duck_p)
	if not at_duck:
		_found_buzzed = false
	if not _found_pending and _found_retry <= 0.0 and at_duck:
		_found_pending = true
		link.report_found()
	if _tick_descent(house, feet):
		return
	_tick_king(house, feet, builder.yaw_to_house(player.head_yaw()))


# --- the descent (wave 49) ---


## Where the body counts as standing (house frame): its feet, or in the Hallway
## the spot it walked in from.
func body_feet() -> Array:
	return _hall_feet if hallway.active() else builder.to_house(player.feet())


## The visions and talkers for one walking frame; true when the player has just
## gone through the door (this frame's walk is over). The autopilot walks past.
func _tick_descent(house: Dictionary, feet: Array) -> bool:
	if not descent.running:
		return false
	descent.tick(house, feet, descent_held(house, feet))
	if autopilot == null and descent.door_reached(house, feet):
		_enter_hallway(feet)
		return true
	return false


## Whether the descent's beats wait: a suspended walk, or near the King. (An
## escape and the Hallway never reach here.)
func descent_held(house: Dictionary, feet: Array) -> bool:
	if _suspended or not _away_until.is_empty():
		return true
	var prop := HouseKing.king_prop(house)
	if prop.is_empty():
		return false
	var pos: Array = prop["pos"]
	return HouseLocate.floor_of(house, float(feet[1])) == HouseLocate.floor_of(house, float(pos[1])) and Vector2(float(feet[0]) - float(pos[0]), float(feet[2]) - float(pos[2])).length() <= Descent.KING_CLEAR_M


## The press that just picked a talker's row is not a hit on the King.
func swallow_hit() -> void:
	_hit_was = true


## Show or hide everything of the house (the Hallway has none of it).
func _show_house(on: bool) -> void:
	builder.visible = on
	ghosts.visible = on
	lamps.visible = on
	trail.visible = on
	duck.set_floor_hidden(not on)


## Through the door: off the map, the server seeing them stand at `feet`.
func _enter_hallway(feet: Array) -> void:
	var spot: Variant = descent.take_door()
	_hall_feet = feet.duplicate()
	var door: Array = spot["pos"] if spot != null else feet
	var plan := Vector2(float(feet[0]) - float(door[0]), float(feet[2]) - float(door[2]))
	# Coming back, they face away from where the door stood.
	_hall_yaw = HouseRoute.yaw_toward(door, feet) if plan.length() > 0.05 else float(spot["yaw"]) if spot != null else 0.0
	_clear_trail()
	_show_house(false)
	descent.pocket(true)
	player.teleport(hallway.enter(), 0.0)
	descent.say_hallway("enter")
	print("reinstall-vr: the Hallway — %s went through" % flow.assignment.get("name", ""))


## One frame in the pocket, the shape of [method _tick_escape]: the pose at the
## door, voice and cams on the door's room, the walk's clocks running.
func _tick_hallway(delta: float) -> void:
	link.send_pose(_hall_feet, _hall_yaw, 0.0)
	cams.tick(delta, builder.house, _hall_feet, link.cams_url(), link.cams_token())
	_tick_voice()
	_played_for += delta
	_hit_was = player.hit_button
	match hallway.tick(delta, player.feet()):
		"far":
			descent.say_hallway("far")
		"done":
			_leave_hallway()


## Out of the pocket, at the door they went through, facing away from it. The
## door is gone.
func _leave_hallway() -> void:
	var at := _hall_feet
	_close_hallway()
	player.teleport(builder.to_world(at), builder.yaw_to_world(_hall_yaw))
	descent.say_hallway("out")
	_trail_in = 0.0
	_sight_room = null
	_tick_sight(at)
	print("reinstall-vr: the Hallway — back")


## The pocket shut and the house shown again, wherever the player goes next.
func _close_hallway() -> void:
	if not hallway.active():
		return
	hallway.leave()
	descent.pocket(false)
	_show_house(true)


# --- the void (R4) ---


## Whether an escape is under way (frozen, scared, waiting for the answer).
func escaping() -> bool:
	return _escape_t >= 0.0


## The player is [constant HouseEscape.ESCAPE_M] into the void: scare them
## and post the escape — or, within the cooldown, put them back quietly.
func _start_escape() -> void:
	descent.interrupt()
	_clear_trail()
	var now := float(clock.call())
	if _escaped_at >= 0.0 and (now - _escaped_at) * 1000.0 < HouseEscape.ESCAPE_COOLDOWN_MS:
		_back_to_spawn({})
		return
	_escaped_at = now
	_escape_t = 0.0
	_escape_answer = {}
	player.locomotion_enabled = false
	hud.scare(true)
	sfx.play("scare")
	player.pulse(0.8, 0.4)
	link.moment("escape")
	print("reinstall-vr: the void — %s escaped; back to the spawn" % flow.assignment.get("name", ""))


func _tick_escape(delta: float) -> void:
	_escape_t += delta
	if (not _escape_answer.is_empty() and _escape_t >= ESCAPE_SCARE) or _escape_t >= ESCAPE_WAIT:
		var answer := _escape_answer
		_escape_t = -1.0
		_escape_answer = {}
		_back_to_spawn(answer)


## Back at the spawn (the answer's, else the map's), the scare fading, the
## walk going again; an answer's lines are spoken now.
func _back_to_spawn(answer: Dictionary) -> void:
	var data: Dictionary = answer.get("data", {})
	var spawn: Variant = data.get("spawn") if answer.get("result") == "ok" else null
	if not (spawn is Dictionary and (spawn as Dictionary).get("pos") is Array):
		spawn = builder.house["spawn"]
	player.teleport(builder.to_world(spawn["pos"]), builder.yaw_to_world(float(spawn.get("yaw", 0.0))))
	hud.scare(false)
	player.locomotion_enabled = true
	_trail_in = 0.0
	if autopilot != null:
		autopilot.plan(route_house, builder.to_house(player.feet()), _autopilot_goal())
	if answer.get("result") == "ok":
		_say_lines(data, null)


## A moment's answer (C6): the escape's goes to the waiting scare (or, late,
## straight to its lines); the heart's and the pickup's to their props.
func _on_moment_answered(kind: String, result: String, data: Dictionary) -> void:
	if flow.state != GameFlow.State.PLAYING:
		return
	match kind:
		"escape":
			if _escape_t >= 0.0:
				_escape_answer = {"result": result, "data": data}
			elif result == "ok":
				_say_lines(data, null)  # landed after the wait: the lines still play
		"heart", "pickup":
			var id := str(_moment_out.get(kind, ""))
			_moment_out[kind] = ""
			if id == "" or not _props.has(id):
				return
			if kind == "heart":
				_on_heart(id, result, data)
			else:
				_on_pickup(id, result, data)


# --- the heart and the pickups (R6, R7) ---


## A new walk: every heart and pickup ready again, except what the
## assignment says this program already has (`heartHeard`, `picked`;
## missing on an old server = none).
func _reset_props(_a: Dictionary) -> void:
	_props = {}
	_moment_out = {"heart": "", "pickup": ""}
	builder.clear_taken()
	_adopt_props()


## A state for every heart and pickup on the map now (the walk's map, or
## the newer one the session fetched after the assignment), each read
## against the assignment the first time it is seen.
func _adopt_props() -> void:
	for kind: String in ["heart", "pickup"]:
		for p: Dictionary in HouseMoment.props_of(builder.house, kind):
			_prop_state(str(p["id"]), kind)


## The prop state for `id`, made the first time it is seen (a map edit may
## add one): "done" when the walk's assignment says this program already
## has it (`heartHeard`, `picked`; missing on an old server = none) — a
## taken disk is hidden, so a re-scan never shows it.
func _prop_state(id: String, kind: String) -> Dictionary:
	if not _props.has(id):
		var a := flow.assignment
		var picked: Array = a.get("picked") if a.get("picked") is Array else []
		var done: bool = (kind == "heart" and a.get("heartHeard") == true) or (kind == "pickup" and picked.has(id))
		_props[id] = {"kind": kind, "state": "done" if done else "", "retry": 0.0}
		if kind == "pickup" and done:
			builder.set_pickup_taken(id, true)
	return _props[id]


## Reaching a shown heart, or a disk in reach, posts its moment — one per
## kind at a time; a refused one waits, or re-arms once the player has left.
func _tick_props(house: Dictionary, feet: Array, delta: float) -> void:
	for kind: String in ["heart", "pickup"]:
		for p: Dictionary in HouseMoment.props_of(house, kind):
			var id := str(p["id"])
			var st := _prop_state(id, kind)
			if st["state"] == "done" or st["state"] == "pending":
				continue
			var there: bool
			if kind == "heart":
				there = builder.heart_shown(id) and HouseMoment.heart_reached(house, feet, p)
			else:
				there = builder.pickup_shown(id) and HouseMoment.pickup_reach(house, feet, p)
			match st["state"]:
				"rearm":
					if not there:
						st["state"] = ""
					continue
				"wait":
					st["retry"] = float(st["retry"]) - delta
					if float(st["retry"]) > 0.0:
						continue
					st["state"] = ""
			if there and _moment_out[kind] == "":
				st["state"] = "pending"
				_moment_out[kind] = id
				link.moment(kind, id)


func _prop_wait(id: String) -> void:
	_props[id]["state"] = "wait"
	_props[id]["retry"] = MOMENT_RETRY


## The heart's answer: his lines over it (done), none yet (again on the
## next way in), already heard (silent), sealed / not there (the next way
## in), a wait for closed doors or no pose yet; an old server or a bad prop: give up.
func _on_heart(id: String, result: String, data: Dictionary) -> void:
	match result:
		"ok":
			var lines: Variant = data.get("lines")
			if lines is Array and not (lines as Array).is_empty():
				_props[id]["state"] = "done"
				_say_lines(data, builder.heart_node(id))
			else:
				_props[id]["state"] = "rearm"
		"already", "not found", "no such prop", "bad moment", "offline":
			_props[id]["state"] = "done"
		"sealed", "not there":
			_props[id]["state"] = "rearm"
		_:
			_prop_wait(id)


## The pickup's answer: taken (the disk goes, a blip, the lines), already
## taken (the disk goes), out of reach / closed doors / no pose yet (again
## soon); an old server or a bad prop: give up (the disk stays).
func _on_pickup(id: String, result: String, data: Dictionary) -> void:
	match result:
		"ok":
			_props[id]["state"] = "done"
			builder.set_pickup_taken(id, true)
			sfx.play("pickup")
			_say_lines(data, null)
		"already":
			_props[id]["state"] = "done"
			builder.set_pickup_taken(id, true)
		"not found", "no such prop", "bad moment", "offline":
			_props[id]["state"] = "done"
		_:
			_prop_wait(id)


## Heart / pickup `id`'s state ("" ready · pending · wait · rearm · done), for the tests.
func prop_state(id: String) -> String:
	return str(_props[id]["state"]) if _props.has(id) else ""


## Speak and caption a moment's `lines` (`[{from, text}]`) — over `anchor`
## when given, else head-locked.
func _say_lines(data: Dictionary, anchor: Node3D) -> void:
	var lines: Variant = data.get("lines")
	if lines is Array and not (lines as Array).is_empty():
		speech.say(lines, null if hallway.active() else anchor)


## The path reveal (R2): the trail stays off for the walk's first
## [member _reveal_after] s of play, then comes on at once with a notice.
## The autopilot routes itself and never waits.
func _tick_reveal(delta: float) -> void:
	_played_for += delta
	if trail_revealed or (_played_for < _reveal_after and autopilot == null):
		return
	trail_revealed = true
	_trail_in = 0.0
	if _reveal_after > 0.0 and autopilot == null:
		_notice(TRAIL_NOTICE)


## Gerald quacks from where he sits, louder and more often the closer the
## player is ([method Sfx.quack_plan], the web game's schedule).
func _tick_quack(feet: Array, duck_p: Array, delta: float) -> void:
	_quack_in -= delta
	if _quack_in > 0.0:
		return
	var plan := Vector2(float(duck_p[0]) - float(feet[0]), float(duck_p[2]) - float(feet[2])).length()
	var q := Sfx.quack_plan(plan, float(duck_p[1]) - float(feet[1]), randf())
	_quack_in = float(q["next"])
	if q["quack"]:
		sfx.quack_at(duck.emitter, float(q["volume"]))


# --- voice ---



func _setup_voice() -> void:
	voice = VoiceLink.new()
	voice.name = "Voice"
	voice.builder = builder
	voice.mic_enabled = bool(link.config.get("mic", true))
	add_child(voice)


## Ask for the Quest's microphone grant now, in the lobby, before any
## session (the system dialog would pause a session and end it).
func _prime_mic() -> void:
	voice.prime_permission(bool(link.config.get("voice", true)) and bool(link.config.get("mic", true)))


## While playing: run the voice link on the session (unless `voice` is off).
func _tick_voice() -> void:
	# R8: while a terminal listens the mic may send, so no game sound plays —
	# the hum (which holds nothing) pauses; one-shots hold the mic instead.
	sfx.set_hum_ducked(voice.listen_on)
	if not bool(link.config.get("voice", true)):
		return
	if not voice.is_running():
		voice.mic_enabled = bool(link.config.get("mic", true))  # a reconfigured headset
	voice.want(link.voice_stream_url(), link.voice_upload_url(), link.voice_token())


func _stop_voice() -> void:
	voice.stop()


## Near the King (a `king` prop, with a shared King on the server): say
## once per approach how to hit him; on a press of the hit button, near and
## facing him ([method HouseKing.king_reach]), hit — once per visit.
func _tick_king(house: Dictionary, feet: Array, yaw: float) -> void:
	# (wave 49) A trigger on a talker's row picks the row, never hits him.
	var pressed := player.hit_button and not _hit_was and not descent.trigger_taken()
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
		sfx.play("buzz")
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


## Re-route the chevrons from `from` to the duck (house frame). On a
## headset the route runs on a worker thread: it rebuilds the house's whole
## visibility graph (13 ms a call on a desktop, several frames on a Quest),
## and twice a second on this thread it snapped the view while walking.
## One route in flight at a time; the desktop rig and the tests route here.
func refresh_trail(from: Array, to: Array) -> void:
	if player == null or not player.xr_active:
		_lay_trail(HouseRoute.sample_trail(trail_path(route_house, from, to)), _trail_gen)
		return
	if _trail_task != -1:
		return
	if _route_copy.is_empty():
		_route_copy = route_house.duplicate(true)
	var house := _route_copy
	var gen := _trail_gen
	_trail_task = WorkerThreadPool.add_task(func() -> void:
		var samples := HouseRoute.sample_trail(Game.trail_path(house, from, to))
		_trail_done.call_deferred(samples, gen))


func _trail_done(samples: Array, gen: int) -> void:
	if _trail_task != -1:
		WorkerThreadPool.wait_for_task_completion(_trail_task)
		_trail_task = -1
	_lay_trail(samples, gen)


func _lay_trail(samples: Array, gen: int) -> void:
	if gen != _trail_gen:
		return
	var points: Array = []
	for s: Dictionary in samples:
		points.append({"pos": builder.to_world(s["p"]), "yaw": builder.yaw_to_world(s["yaw"])})
	trail.show_points(points)


## Hide the trail, and drop any route still on its way for it.
func _clear_trail() -> void:
	_trail_gen += 1
	trail.clear()


## The room the floors are drawn for ([method HouseLocate.presence_room],
## every tick while playing).
var _sight_room: Variant = null


## Outside, the house is only its outside floor
## ([method HouseEscape.hidden_floors]): the floors above it hide, and so do
## Gerald and the other programs standing on them — nothing floats in the
## sky. `feet` in house coordinates.
func _tick_sight(feet: Array) -> void:
	var house := builder.house
	_sight_room = HouseLocate.presence_room(house, feet, _sight_room)
	var hidden := HouseEscape.hidden_floors(house, _sight_room)
	builder.hide_floors(hidden)
	duck.set_floor_hidden(not hidden.is_empty() and _on_floor(hidden, flow.assignment.get("duck", {}).get("pos")))
	ghosts.hide_on(func(p: Array) -> bool: return not hidden.is_empty() and _on_floor(hidden, p))


func _on_floor(floors: Array, p: Variant) -> bool:
	return p is Array and floors.has(str(HouseLocate.locate(builder.house, p)["floor"]))
