## Render the game (desktop rig, offline link) and save screenshots: the
## lobby, the intro (the cinema with the real video, then each tutorial
## step), the spawn, a look at the duck, and a 3x terminal with a test
## camera feed (wave 33b) — a quick visual check without
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
	link.candidates_received.emit([{"id": "g-000001", "name": "Offline Program", "captured": true}, {"id": "g-000002", "name": "Free Program", "captured": false, "restricted": true}])
	await _shot("lobby")
	link.begin("g-000001")
	for f in 3:
		await process_frame
	print("state: ", GameFlow.name_of(game.state()))
	if game.in_intro():
		# The intro (wave 33): two seconds of the real video, then each step.
		await create_timer(2.0).timeout
		print("video at %.2f s" % game.intro_space.video_position())
		await _shot("intro-video")
		# A returning program's SKIP (this offline program has none).
		game.intro.skippable = true
		game.intro_space.render(game.intro)
		await _shot("intro-video-skip")
		game.intro_space.finish_video()
		await process_frame
		await process_frame
		await _shot("intro-welcome")
		for press: String in ["ok", "ok", "next"]:
			game.intro.t = 60.0  # past every fallback and the arm delay
			game.intro_press(press)
			await _shot("intro-%s" % IntroFlow.name_of(game.intro.step).to_lower())
			if game.intro.step == IntroFlow.Step.TURN:
				# Turned round to the duck: the panel comes round too.
				var to := game.intro_space.duck.global_position - game.player.camera.global_position
				game.player.face(rad_to_deg(atan2(-to.x, -to.z)))
				game.player.camera.rotation.x = deg_to_rad(-12.0)
				await _shot("intro-turn-duck")
				game.player.camera.rotation.x = 0.0
				# The "that's it" line holds, then COMFORT comes by itself.
				game._process(IntroFlow.TURN_DONE_HOLD + 0.1)
				await _shot("intro-%s" % IntroFlow.name_of(game.intro.step).to_lower())
		game.intro.t = 60.0
		game.intro_press("start")
		print("intro over: ", not game.in_intro())
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
	# A terminal at 3x with a test feed (a gradient), seen from 2.5 m.
	for id: String in ["hall", "steam-room"]:
		var term := game.builder.get_node_or_null("Terminal_%s" % id) as Node3D
		if term == null:
			continue
		var img := Image.create(320, 240, false, Image.FORMAT_RGB8)
		for y in 240:
			for x in 320:
				img.set_pixel(x, y, Color(x / 320.0, y / 240.0, 0.6))
		game.builder.set_cam(id, ImageTexture.create_from_image(img))
		var gt := term.global_transform
		var f := -gt.basis.z.normalized()
		var eye := gt.origin + Vector3(f.x, 0.0, f.z).normalized() * 2.5
		game.player.teleport(Vector3(eye.x, gt.origin.y - 1.4, eye.z), rad_to_deg(atan2(f.x, f.z)))
		game.player.camera.rotation.x = 0.0
		await _shot("terminal-%s" % id)
	# The comfort vignette at full strength.
	game.player.vignette.visible = true
	(game.player.vignette.material_override as ShaderMaterial).set_shader_parameter("strength", 1.0)
	game.player.set_process(false)
	game.player.set_physics_process(false)
	await _shot("vignette")
	quit(0)
