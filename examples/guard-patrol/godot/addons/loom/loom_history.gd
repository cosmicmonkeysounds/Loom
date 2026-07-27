@icon("res://addons/loom/icons/loom_history.svg")
## A dialogue backlog: records every line the story plays, ready for a
## "history" panel or a save-slot summary.
##
## Drop it anywhere near a [LoomStory] and read [member entries], listen
## to [signal entry_added], or dump the whole log into a [RichTextLabel]
## with [method as_bbcode]. Entries survive box UI churn because they come
## from the runtime's step stream, not from any label.
class_name LoomHistory
extends Node

## A line was recorded: `{speaker, text, beat}`.
signal entry_added(entry: Dictionary)

## Story to attach to. When null, the nearest [LoomStory] is found at
## ready ([method LoomStory.find_for]).
@export var story: LoomStory = null
## Oldest entries are dropped past this count.
@export var max_entries := 200

## The backlog, oldest first: `{speaker, text, beat}` per line.
var entries: Array[Dictionary] = []

var _beat := ""


func _ready() -> void:
	if story == null:
		story = LoomStory.find_for(self)
	if story == null:
		push_warning("LoomHistory: no LoomStory found for %s" % get_path())
		return
	story.step_emitted.connect(_on_step)


func _on_step(step: Dictionary) -> void:
	match str(step["step"]):
		LoomOps.STEP_BEAT:
			_beat = str(step.get("name", ""))
		LoomOps.STEP_LINE:
			var entry := {
				"speaker": str(step.get("display", "")),
				"text": str(step.get("text", "")),
				"beat": _beat,
			}
			entries.append(entry)
			while entries.size() > max_entries:
				entries.pop_front()
			entry_added.emit(entry)


func clear() -> void:
	entries.clear()


## The backlog as BBCode, one line per entry — pour it straight into a
## [RichTextLabel].
func as_bbcode() -> String:
	var out := ""
	for entry in entries:
		if str(entry["speaker"]) != "":
			out += "[b]%s[/b]  %s\n" % [entry["speaker"], entry["text"]]
		else:
			out += "%s\n" % entry["text"]
	return out
