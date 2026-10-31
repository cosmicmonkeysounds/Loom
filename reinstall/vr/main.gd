## Bootstrap: start OpenXR when a runtime is there (the Quest), else run as
## a desktop game (a Mac, CI); hand the game its link — the `ServerLink`
## autoload unless a test injected one before `_ready`.
extends Node3D

## Injected by tests; else the `ServerLink` autoload.
var link: LinkBase = null
var xr_interface: OpenXRInterface = null

var _refresh := RefreshRate.new()

@onready var game: Game = $Game


func _ready() -> void:
	var xr_on := _start_xr()
	if link == null:
		link = get_node_or_null("/root/ServerLink") as LinkBase
	if link == null:
		link = LinkBase.new()
		link.name = "NoLink"
		add_child(link)
	# The picture's tier (wave 39, `graphics` in station.json): the shading,
	# the tone map and glow, the anti-aliasing, the house lights' pool.
	var tier := HouseLights.tier_of(link.config.get("graphics", HouseLights.DEFAULT_TIER))
	HouseLook.set_tier(tier)
	$WorldEnvironment.environment = HouseLook.environment(tier)
	get_viewport().msaa_3d = HouseLook.msaa(tier)
	print("reinstall-vr: picture — tier %s, msaa %d, foveation %s, xr %s" % [tier, get_viewport().msaa_3d, ProjectSettings.get_setting("xr/openxr/foveation_level"), xr_on])
	$Sun.rotation_degrees = Vector3(-55.0, 35.0, 0.0)
	$Sun.light_energy = HouseLights.DAY_SUN
	game.world_env = $WorldEnvironment.environment
	game.sun = $Sun
	game.setup(link, xr_on)


func _start_xr() -> bool:
	var found := XRServer.find_interface("OpenXR")
	if found == null or not found.is_initialized():
		return false
	xr_interface = found as OpenXRInterface
	get_viewport().use_xr = true
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	if xr_interface != null:
		# Quest 3 runs 72 / 80 / 90 / 120 Hz (72 unless asked), and only hears
		# a session with focus ([RefreshRate]).
		xr_interface.refresh_rate_changed.connect(_match_physics)
		xr_interface.session_begun.connect(_ask_performance)
		xr_interface.cpu_level_changed.connect(_log_level.bind("cpu"))
		xr_interface.gpu_level_changed.connect(_log_level.bind("gpu"))
		xr_interface.user_presence_changed.connect(game.presence_changed)
		xr_interface.session_focussed.connect(func() -> void: game.focus_changed(true))
		xr_interface.session_focussed.connect(_ask_refresh_rate)
		xr_interface.session_visible.connect(func() -> void: game.focus_changed(false))
		xr_interface.session_stopping.connect(game.headset_gone)
	return true


## Hold the clocks up: left dynamic, a Quest runs them low and raises them only
## after a frame has been missed, so each climb into a heavier room judders.
func _ask_performance() -> void:
	xr_interface.set_cpu_level(OpenXRInterface.PERF_SETTINGS_LEVEL_SUSTAINED_HIGH)
	xr_interface.set_gpu_level(OpenXRInterface.PERF_SETTINGS_LEVEL_SUSTAINED_HIGH)


func _log_level(sub_domain: int, from_level: int, to_level: int, what: String) -> void:
	print("reinstall-vr: %s level, domain %d: %d to %d" % [what, sub_domain, from_level, to_level])


## Work towards the wanted rate from here ([method _process]).
func _ask_refresh_rate() -> void:
	_refresh.start(Array(xr_interface.get_available_display_refresh_rates()))
	_match_physics(xr_interface.display_refresh_rate)


## The display rate's asks, and reading it back: the physics tick follows even
## if the runtime never sends its changed event.
func _process(delta: float) -> void:
	if xr_interface == null:
		return
	var display := xr_interface.display_refresh_rate
	if display >= 60.0 and roundi(display) != Engine.physics_ticks_per_second:
		_match_physics(display)
	var ask := _refresh.step(display, delta)
	if ask > 0.0:
		print("reinstall-vr: asking for %.3f Hz (display %.3f, try %d)" % [ask, display, _refresh.tries])
		xr_interface.display_refresh_rate = ask


## One physics tick per displayed frame, whatever rate the runtime settled
## on (the player moves per frame anyway; this keeps the collision world in
## step with it and spends no ticks the display never shows).
func _match_physics(rate: float) -> void:
	if rate >= 60.0:
		Engine.physics_ticks_per_second = roundi(rate)
	print("reinstall-vr: display %.3f Hz (offered %s), physics %d Hz" % [rate, xr_interface.get_available_display_refresh_rates(), Engine.physics_ticks_per_second])


## A Quest pauses the app when the headset sleeps: no frame runs until it
## wakes, so the game arms a wall-clock away deadline here and checks it on
## resume (as do the wake's presence / focus events, whichever comes first)
## — a headset handed on after the grace starts in the lobby.
func _notification(what: int) -> void:
	if game == null or game.player == null:
		return
	if what == NOTIFICATION_APPLICATION_PAUSED:
		game.app_paused()
	elif what == NOTIFICATION_APPLICATION_RESUMED:
		game.app_resumed()
