## Render the game (desktop rig, offline link) and save screenshots: the
## lobby, the spawn, and a look at the duck — a quick visual check without
## a headset. Needs a display (not --headless).
##
##   godot --path . --xr-mode off --script res://tools/screenshot.gd -- --offline --out /tmp/shots
extends SceneTree

var _out := "user://shots"


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


func _run() -> void:
	root.size = Vector2i(1280, 720)
	var main: Node = load("res://main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	var game: Game = main.get("game")
	var link: LinkBase = main.get("link")
	print("link: ", link.name, " status: ", link.status)
	link.candidates_received.emit([{"id": "g-000001", "name": "Offline Program", "captured": true}, {"id": "g-000002", "name": "Free Program", "captured": false}])
	await _shot("lobby")
	link.begin("g-000001")
	for f in 3:
		await process_frame
	print("state: ", GameFlow.name_of(game.state()))
	await _shot("spawn")
	var duck_p: Array = game.flow.assignment["duck"]["pos"]
	var room: Dictionary = HouseGeometry.room_by_id(game.builder.house, game.flow.assignment["duck"]["room"])
	var spot := HouseBuilder.label_spot(room)
	var from := [spot[0], duck_p[1], spot[1]]
	game.player.teleport(HouseFrames.vec(from), HouseRoute.yaw_toward(from, duck_p))
	game.player.camera.rotation.x = deg_to_rad(-20.0)
	await _shot("duck")
	# Over the stair: from the hall looking down the hole.
	var stairs: Array = game.builder.house.get("stairs", [])
	if not stairs.is_empty():
		var r: Array = stairs[0]["rect"]
		game.player.teleport(Vector3((r[0] + r[2]) / 2.0 + 1.6, 0.0, r[1] - 0.8), 150.0)
		game.player.camera.rotation.x = deg_to_rad(-35.0)
		await _shot("stair")
	game.player.teleport(HouseFrames.vec([0.0, 0.0, 4.0]), -90.0)
	game.player.camera.rotation.x = 0.0
	await _shot("hall")
	# The comfort vignette at full strength.
	game.player.vignette.visible = true
	(game.player.vignette.material_override as ShaderMaterial).set_shader_parameter("strength", 1.0)
	game.player.set_physics_process(false)
	await _shot("vignette")
	quit(0)
