## Headless conformance runner.
##
## Replays a scenario script through the GDScript runtime and writes a
## canonical JSONL trace, which is then diffed against the golden produced
## by the reference interpreter. This is the mechanism that keeps a
## hand-written runtime honest — see `docs/loom-banks.md` §11.
##
##   godot --headless --path . --script res://test/run.gd -- \
##         --bank ../../bank/test/golden/lighthouse.loombank \
##         --scenario ../../bank/test/scenarios/lighthouse.script \
##         --out /tmp/godot.jsonl
extends SceneTree


func _init() -> void:
	var args := _parse_args(OS.get_cmdline_user_args())
	if not args.has("bank") or not args.has("scenario"):
		printerr("usage: --bank <bank.loombank> --scenario <script> [--out <trace.jsonl>]")
		quit(2)
		return

	var bank := LoomBank.from_file(args["bank"])
	if bank.load_error != "":
		printerr("bank: %s" % bank.load_error)
		quit(2)
		return

	var vm := LoomRuntime.new()
	if not vm.load_bank(bank):
		printerr("failed to load bank")
		quit(2)
		return

	var script_text := FileAccess.get_file_as_string(args["scenario"])
	if script_text == "":
		printerr("cannot read scenario %s" % args["scenario"])
		quit(2)
		return

	var records := _run_scenario(vm, script_text, (args["bank"] as String).get_base_dir())
	var jsonl := ""
	for record in records:
		jsonl += LoomCanonical.stringify(record) + "\n"

	if args.has("out"):
		var file := FileAccess.open(args["out"], FileAccess.WRITE)
		if file == null:
			printerr("cannot write %s" % args["out"])
			quit(2)
			return
		file.store_string(jsonl)
	else:
		print(jsonl)
	quit(0)


## The scenario driver. Must match `bank/src/trace.ts::runScenario` command
## for command, including where digests are taken. `bank_dir` roots
## `loadbank` paths, same as the reference driver.
func _run_scenario(vm: LoomRuntime, script_text: String, bank_dir: String) -> Array:
	var records: Array = []
	var index := 0
	var last_save: Variant = null

	for raw_line in script_text.split("\n"):
		var line: String = raw_line
		var comment := line.find("#")
		if comment >= 0:
			line = line.substr(0, comment)
		line = line.strip_edges()
		if line == "":
			continue

		var parts := line.split(" ", false)
		var verb: String = parts[0]
		var rest: Array = []
		for i in range(1, parts.size()):
			rest.append(parts[i])

		match verb:
			"start":
				var bindings := {}
				for i in range(1, rest.size()):
					var pair: String = rest[i]
					var eq := pair.find("=")
					if eq > 0:
						bindings[pair.substr(0, eq)] = pair.substr(eq + 1)
				vm.start_beat(rest[0] if rest.size() > 0 else "", bindings)
			"run":
				for step in vm.run():
					records.append(_indexed(step, index))
					index += 1
			"advance":
				var n := int(rest[0]) if rest.size() > 0 else 1
				for _i in n:
					records.append(_indexed(vm.advance(), index))
					index += 1
			"choose":
				if not vm.choose(int(rest[0]) if rest.size() > 0 else 0):
					records.append(_indexed(
						{"step": LoomOps.STEP_ERROR, "code": "badChoice", "message": line}, index
					))
					index += 1
			"signal":
				vm.signal_event(
					rest[0] if rest.size() > 0 else "",
					rest[1] if rest.size() > 1 else "",
					rest[2] if rest.size() > 2 else "",
				)
			"set":
				var path: String = rest[0] if rest.size() > 0 else ""
				var literal := " ".join(rest.slice(1))
				vm.set_var(path, _parse_literal(literal))
			"tick":
				vm.tick(float(rest[0]) if rest.size() > 0 else 0.0)
			"locale":
				vm.set_locale(rest[0] if rest.size() > 0 else "")
			"loadbank":
				var extra := LoomBank.from_file(
					bank_dir.path_join(str(rest[0]) if rest.size() > 0 else "")
				)
				if extra.load_error != "" or not vm.load_bank(extra):
					records.append(_indexed({
						"step": LoomOps.STEP_ERROR, "code": "bankNotLoaded", "message": line,
					}, index))
					index += 1
			"save":
				last_save = vm.save()
			"load":
				if last_save != null:
					var result: Dictionary = vm.load_state(last_save)
					if not bool(result.get("ok", false)):
						records.append(_indexed({
							"step": LoomOps.STEP_ERROR,
							"code": "loadFailed",
							"message": str(result.get("reason", "")),
						}, index))
						index += 1
			_:
				records.append(_indexed(
					{"step": LoomOps.STEP_ERROR, "code": "badCommand", "message": line}, index
				))
				index += 1

		records.append({
			"cmd": line, "digest": _digest(vm.save()),
		})
	return records


func _indexed(step: Dictionary, index: int) -> Dictionary:
	var out := step.duplicate()
	out["i"] = index
	return out


func _digest(state: Dictionary) -> String:
	var text := LoomCanonical.stringify(state)
	return "sha256:%s" % text.sha256_text()


func _parse_literal(text: String) -> Variant:
	var t := text.strip_edges()
	if t == "null":
		return null
	if t == "true":
		return true
	if t == "false":
		return false
	if t.is_valid_float():
		return t.to_float()
	if t.length() >= 2 and t.begins_with("\"") and t.ends_with("\""):
		return t.substr(1, t.length() - 2)
	return t


func _parse_args(argv: PackedStringArray) -> Dictionary:
	var out := {}
	var i := 0
	while i < argv.size():
		var arg := argv[i]
		if arg.begins_with("--") and i + 1 < argv.size():
			out[arg.substr(2)] = argv[i + 1]
			i += 2
		else:
			i += 1
	return out
