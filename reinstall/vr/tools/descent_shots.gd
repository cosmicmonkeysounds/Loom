## Render the descent (desktop rig, offline link, level 4) and save a
## screenshot of each vision, a talker and its panel, the Hallway and the new
## props: a quick visual check without a headset. Needs a display (not
## --headless).
##
##   godot --path . --xr-mode off --script res://tools/descent_shots.gd -- --offline --out /tmp/shots
extends SceneTree

var _out := "user://shots"
var game: Game
var house: Dictionary


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var i := args.find("--out")
	if i >= 0 and i + 1 < args.size():
		_out = args[i + 1]
	DirAccess.make_dir_recursive_absolute(_out)
	_run.call_deferred()


func _shot(name: String) -> void:
	for f in 4:
		await process_frame
	await RenderingServer.frame_post_draw
	var path := _out.path_join(name + ".png")
	root.get_texture().get_image().save_png(path)
	print("shot: ", path)


## Run the game `s` s on, in fixed frames (the window's own frames may crawl).
func _wait(s: float) -> void:
	for i in int(s * 72.0):
		game._process(1.0 / 72.0)
		game.speech.tick(1.0 / 72.0)


func _stand(p: Array, yaw: float, pitch := 0.0) -> void:
	game.player.teleport(game.builder.to_world(p), game.builder.yaw_to_world(yaw))
	game.player.camera.rotation.x = deg_to_rad(pitch)
	await process_frame
	await process_frame


func _feet() -> Array:
	return game.builder.to_house(game.player.feet())


func _prop(id: String) -> Dictionary:
	for p: Dictionary in house["props"]:
		if p["id"] == id:
			return p
	return {}


## Stand `back` m in front of prop `id`, looking at it.
func _face(id: String, back := 2.6, pitch := -8.0) -> void:
	var p := _prop(id)
	var yaw := float(p["yaw"]) if p.get("yaw") != null else 0.0
	var f := HouseFrames.forward(yaw)
	var at: Array = [float(p["pos"][0]) + float(f[0]) * back, float(p["pos"][1]), float(p["pos"][2]) + float(f[2]) * back]
	await _stand(at, yaw + 180.0, pitch)


func _run() -> void:
	root.size = Vector2i(1280, 720)
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	game = main.get("game")
	house = game.builder.house
	game.player.read_input = false
	game.speech.set_process(false)
	game.start_test_level(HouseDescent.DESCENT_MAX)
	await process_frame
	await process_frame
	while game.in_intro():
		game.intro.t = 60.0
		game.intro_press("skip")
		game.intro_press("skip_tutorial")
		await process_frame
	game.set_process(false)
	var d := game.descent
	d.plan = []
	d.awake_clear()
	print("level ", d.level, " — ", GameFlow.name_of(game.state()))
	# The new props, some of them only there at this level.
	for id: String in ["stove", "tea-party", "hall-clock", "spiral-living", "rabbit-hole", "office-door", "mirror-upstairs", "mushroom-yard", "card-left"]:
		if not _prop(id).is_empty():
			await _face(id)
			await _shot("prop-" + id)
	var hall: Array = [-3.0, 0.0, 12.2]
	await _stand(hall, 180.0)
	await _shot("look-level4")
	for pair: Array in [["whiteduck", 1.2], ["grin", 2.5], ["door", 0.3], ["dark", 3.0], ["tint", 4.5], ["small", 6.0], ["big", 6.0]]:
		await _stand(hall, 180.0)
		d._begin(pair[0], 1, house, _feet())
		_wait(pair[1])
		await _shot("vision-" + str(pair[0]))
		d._end_vision(false)
		_wait(5.0)
		game.speech.stop()
	# A talker: the first of the walk's, up close, its panel open.
	var words: Dictionary = d.words
	d._wake()
	var w: Dictionary = {}
	for row: Dictionary in d.awake:
		w = row
		break
	if not w.is_empty():
		await _face(str(w["prop"]["id"]), 1.6, -6.0)
		_wait(0.2)
		await _shot("talk-face")
		_wait(24.0)
		print("talk: ", d.talker_id(), " panel ", game.talk.is_open())
		if game.talk.is_open():
			var eye := game.player.camera.global_position
			game.pointer.inject(eye, game.talk.row_world(0) - eye)
		_wait(0.2)
		await _shot("talk-panel")
		game.pointer.clear_injection()
		d.end_talk()
	# Through the door.
	await _stand(hall, 180.0)
	d._begin("door", 1, house, _feet())
	_wait(0.1)
	var spot: Dictionary = d.door_spot_now()
	await _stand(spot["pos"], 180.0)
	_wait(0.1)
	print("hallway: ", game.hallway.active())
	await _shot("hallway-in")
	game.player.global_position = Hallway.SPOT + Vector3(0, 0, -4.0)
	_wait(0.1)
	await _shot("hallway-along")
	game.player.global_position = Vector3(0, Hallway.SPOT.y, game.player.global_position.z - 8.0)
	_wait(0.1)
	await _shot("hallway-further")
	game.player.camera.rotation.x = deg_to_rad(-30.0)
	await _shot("hallway-floor")
	quit(0)
