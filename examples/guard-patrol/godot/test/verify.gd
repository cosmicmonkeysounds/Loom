## Headless smoke test for the integrated Guard Patrol project: the bank
## loads, the opening plays at the pier, both branches resolve, and the
## suspicious path hits the confrontation.
##
##   godot --headless --path . --script res://test/verify.gd
extends SceneTree


var checks := 0
var failures := 0


func _check(ok: bool, label: String) -> void:
	checks += 1
	if ok:
		print("  ok  %s" % label)
	else:
		failures += 1
		printerr("FAIL  %s" % label)


## Advance until a choice/done, collecting line text along the way.
func _play_until_stop(vm: LoomRuntime) -> Dictionary:
	var lines: Array[String] = []
	while true:
		var step := vm.advance()
		match step["step"]:
			LoomOps.STEP_LINE:
				lines.append(str(step["text"]))
			LoomOps.STEP_CHOICE, LoomOps.STEP_DONE, LoomOps.STEP_IDLE, LoomOps.STEP_ERROR:
				return {"stop": step, "lines": lines}
	return {}


func _init() -> void:
	var bank := LoomBank.from_file("res://loom/main.loombank")
	_check(bank.load_error == "", "bank loads (%s)" % bank.load_error)

	# Branch 1: show the writ — Marlow stays calm, the door choice appears.
	var vm := LoomRuntime.new()
	_check(vm.load_bank(bank), "runtime accepts bank")
	vm.start_entry()
	var opening := _play_until_stop(vm)
	_check(opening["stop"]["step"] == LoomOps.STEP_CHOICE, "opening reaches the pier choice")
	_check(opening["lines"].any(func(l: String) -> bool: return l.contains("lighthouse hums")),
		"opening narration plays")
	_check(vm.choose(0), "choose: show the writ")
	var row := _play_until_stop(vm)
	_check(row["stop"]["step"] == LoomOps.STEP_CHOICE, "calm path offers the warehouse choice")
	_check(row["lines"].any(func(l: String) -> bool: return l.contains("Warehouse Nine")),
		"calm Marlow points to Warehouse Nine")
	_check(vm.choose(0), "choose: step through the door")
	var done := _play_until_stop(vm)
	_check(done["stop"]["step"] == LoomOps.STEP_DONE, "calm path ends")

	# Branch 2: slip past — suspicion crosses 25 and the bell-rope scene fires.
	var vm2 := LoomRuntime.new()
	vm2.load_bank(bank)
	vm2.start_entry()
	_play_until_stop(vm2)
	vm2.choose(1)
	var confronted := _play_until_stop(vm2)
	_check(confronted["stop"]["step"] == LoomOps.STEP_DONE, "suspicious path runs to END")
	_check(confronted["lines"].any(func(l: String) -> bool: return l.contains("every guard on the quay")),
		"confrontation fires on high suspicion")

	vm.free()
	vm2.free()
	print("%d checks, %d failures" % [checks, failures])
	quit(2 if failures > 0 else 0)
