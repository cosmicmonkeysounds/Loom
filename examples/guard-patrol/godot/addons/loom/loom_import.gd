@tool
## Imports `*.loombank` as a [LoomBank] resource.
##
## Without this, a bank is an unrecognised file: the editor would not track
## it and `export` would leave it out of the PCK. With it, a bank behaves
## like any other Godot asset — drag it into an inspector slot, and it ships
## with the game.
extends EditorImportPlugin


func _get_importer_name() -> String:
	return "loom.bank"


func _get_visible_name() -> String:
	return "Loom Story Bank"


func _get_recognized_extensions() -> PackedStringArray:
	return PackedStringArray(["loombank"])


func _get_save_extension() -> String:
	return "res"


func _get_resource_type() -> String:
	return "Resource"


func _get_preset_count() -> int:
	return 1


func _get_preset_name(_preset: int) -> String:
	return "Default"


func _get_import_options(_path: String, _preset: int) -> Array[Dictionary]:
	return []


func _get_option_visibility(_path: String, _option: StringName, _options: Dictionary) -> bool:
	return true


func _get_priority() -> float:
	return 1.0


func _get_import_order() -> int:
	return 0


func _import(
	source_file: String,
	save_path: String,
	_options: Dictionary,
	_platform_variants: Array[String],
	_gen_files: Array[String],
) -> Error:
	var text := FileAccess.get_file_as_string(source_file)
	if text == "":
		push_error("Loom: cannot read %s" % source_file)
		return ERR_FILE_CANT_READ

	var bank := LoomBank.from_json(text)
	if bank.load_error != "":
		# Fail the import rather than shipping a bank the runtime will
		# refuse at load time.
		push_error("Loom: %s — %s" % [source_file, bank.load_error])
		return ERR_INVALID_DATA

	var programs: int = (bank.data.get("programs", []) as Array).size()
	print("Loom: imported %s (%d programs)" % [source_file.get_file(), programs])
	return ResourceSaver.save(bank, "%s.%s" % [save_path, _get_save_extension()])
