## Regenerate `res://openxr_action_map.tres` — Godot's default action map
## (incl. the `primary` thumbstick on both hands for the Oculus Touch
## profile the Quest 3 runtime maps its Touch Plus controllers onto). The
## game reads `primary` (the sticks), `trigger` / `trigger_click` and
## `ax_button` (the King's hit); the rest stays for free.
##
##   godot --headless --path . --xr-mode off --script res://tools/make_action_map.gd
extends SceneTree

const OUT := "res://openxr_action_map.tres"


func _initialize() -> void:
	var map := OpenXRActionMap.new()
	map.create_default_action_sets()
	var err := ResourceSaver.save(map, OUT)
	print("action map: %s → %s" % [OUT, error_string(err)])
	quit(0 if err == OK else 1)
