## Compile every script and load every scene / shader in the project, so a
## parse error anywhere fails the run (the game tests only load what they
## reach).
##
##   godot --headless --path . --xr-mode off --script res://test/check_scripts.gd
extends SceneTree

var _failures := 0
var _checked := 0


func _initialize() -> void:
	_walk("res://")
	print("scripts: %d files, %d failures" % [_checked, _failures])
	quit(1 if _failures > 0 else 0)


func _walk(dir: String) -> void:
	for d in DirAccess.get_directories_at(dir):
		if d.begins_with(".") or d == "android" or d == "build":
			continue
		_walk(dir.path_join(d))
	for f in DirAccess.get_files_at(dir):
		var path := dir.path_join(f)
		if f.ends_with(".gd"):
			_checked += 1
			var script := ResourceLoader.load(path) as GDScript
			if script == null or not script.can_instantiate():
				_failures += 1
				printerr("  FAIL  %s does not compile" % path)
		elif f.ends_with(".tscn") or f.ends_with(".gdshader") or f.ends_with(".tres"):
			_checked += 1
			if ResourceLoader.load(path) == null:
				_failures += 1
				printerr("  FAIL  %s does not load" % path)
