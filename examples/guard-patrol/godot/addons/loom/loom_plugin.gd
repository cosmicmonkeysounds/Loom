@tool
## The Loom editor plugin.
##
## Registers the `.loombank` importer (so banks are first-class assets that
## ship inside the PCK) and the bank inspector preview (so clicking a bank
## shows its beats and hooks). The runtime nodes — [LoomStory],
## [LoomTypewriter], [LoomHook], [LoomTrigger] — need no plugin at all:
## they are plain `class_name` scripts, available in the Create Node
## dialog whether or not the plugin is enabled.
extends EditorPlugin

var _import_plugin: EditorImportPlugin = null
var _inspector_plugin: EditorInspectorPlugin = null


func _enter_tree() -> void:
	_import_plugin = preload("res://addons/loom/loom_import.gd").new()
	add_import_plugin(_import_plugin)
	_inspector_plugin = preload("res://addons/loom/loom_bank_inspector.gd").new()
	add_inspector_plugin(_inspector_plugin)


func _exit_tree() -> void:
	if _import_plugin != null:
		remove_import_plugin(_import_plugin)
		_import_plugin = null
	if _inspector_plugin != null:
		remove_inspector_plugin(_inspector_plugin)
		_inspector_plugin = null
