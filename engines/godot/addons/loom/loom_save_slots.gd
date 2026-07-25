@icon("res://addons/loom/icons/loom_save_slots.svg")
## Named save slots for a [LoomStory] — the save/load menu's backend.
##
## Each slot is one JSON file under [member directory]: the full VM
## snapshot (including a suspended choice) plus a metadata header — slot
## name, timestamp, current beat and setting, whether a choice was
## pending — captured through the runtime's query API, so a slot list can
## show "Lighthouse — The Lamp Room, yesterday" without loading anything.
##
## [codeblock]
## slots.save_slot("slot1")
## for meta in slots.list_slots():
##     print(meta["name"], " @ ", meta["beat"])
## slots.load_slot("slot1")
## dialogue_box.resume()      # picks up mid-line or mid-choice
## [/codeblock]
class_name LoomSaveSlots
extends Node

## A slot was written; `meta` is its header.
signal slot_saved(meta: Dictionary)
## A slot was restored into the story; `meta` is its header.
signal slot_loaded(meta: Dictionary)

## Story to attach to. When null, the nearest [LoomStory] is found at
## ready ([method LoomStory.find_for]).
@export var story: LoomStory = null
## Where slot files live. Created on first save.
@export var directory := "user://loom_saves"


func _ready() -> void:
	if story == null:
		story = LoomStory.find_for(self)


## Write the story's full state into `slot_name`. Returns false when
## there is no story/bank or the file cannot be written.
func save_slot(slot_name: String) -> bool:
	if story == null or story.bank == null:
		return false
	DirAccess.make_dir_recursive_absolute(directory)
	var meta := {
		"name": slot_name,
		"time": Time.get_unix_time_from_system(),
		"beat": story.current_beat(),
		"setting": story.current_setting(),
		"waiting": story.is_waiting(),
	}
	var file := FileAccess.open(_slot_path(slot_name), FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify({"meta": meta, "state": story.save()}))
	slot_saved.emit(meta)
	return true


## Restore `slot_name` into the story. Mirrors
## [method LoomRuntime.load_state]'s contract — a recompiled bank is
## refused unless `allow_migrate` is passed.
func load_slot(slot_name: String, allow_migrate: bool = false) -> Dictionary:
	if story == null:
		return {"ok": false, "reason": "noStory"}
	var payload: Variant = _read_slot(slot_name)
	if payload == null:
		return {"ok": false, "reason": "cannotRead"}
	var result := story.load_state(payload.get("state", {}), allow_migrate)
	if bool(result.get("ok", false)):
		slot_loaded.emit(payload.get("meta", {}))
	return result


func has_slot(slot_name: String) -> bool:
	return FileAccess.file_exists(_slot_path(slot_name))


func delete_slot(slot_name: String) -> bool:
	return DirAccess.remove_absolute(_slot_path(slot_name)) == OK


## Every slot's metadata header, newest first.
func list_slots() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for file_name in DirAccess.get_files_at(directory):
		if not file_name.ends_with(".json"):
			continue
		var payload: Variant = _read_slot(file_name.trim_suffix(".json"))
		if payload != null and payload.get("meta") is Dictionary:
			out.append(payload["meta"])
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return float(a.get("time", 0)) > float(b.get("time", 0)))
	return out


func _slot_path(slot_name: String) -> String:
	return "%s/%s.json" % [directory, slot_name.validate_filename()]


func _read_slot(slot_name: String) -> Variant:
	var text := FileAccess.get_file_as_string(_slot_path(slot_name))
	if text == "":
		return null
	var parsed: Variant = JSON.parse_string(text)
	return parsed if typeof(parsed) == TYPE_DICTIONARY else null
