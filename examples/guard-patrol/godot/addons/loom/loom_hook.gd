@icon("res://addons/loom/icons/loom_hook.svg")
## Story → game: a filterable listener node that turns Loom story events
## into a Godot signal you connect in the editor.
##
## The Wwise-style workflow: drop a LoomHook next to the thing that should
## react, pick what it listens for in the inspector, and connect
## [signal triggered] to any method — no dispatch code. A `<cue: thunder>`
## directive can flash a light, `beat_entered` can move a camera, a
## `Wren.trust` write can update a portrait, all from the scene dock.
##
## [codeblock]
## # Node: LoomHook  kind = DIRECTIVE  filter = "sfx"
## func _on_sfx(payload: Dictionary) -> void:
##     audio.play(payload["positional"][0])  # args arrive pre-parsed
## [/codeblock]
##
## Every payload is the runtime's own step dictionary (see the bank spec):
## a DIRECTIVE payload carries `verbName` / `positional` / `named`, a BEAT
## payload `name` / `setting`, a VARIABLE payload `path` / `value`, and so
## on. For code-first hosts the [LoomRuntime] signals remain the primal
## surface; this node is the scene-first skin over them.
class_name LoomHook
extends Node

## What story event this hook listens for.
enum Kind {
	## A host directive — `<sfx: …>`, `<cue: …>`, any authored verb.
	## [member filter] matches the verb name. Block-`END` re-emissions are
	## dropped, so a block directive triggers once, on entry.
	DIRECTIVE,
	## A beat was entered. [member filter] matches the beat name — use the
	## qualified form (`Wren.reassure`) for class-owned beats.
	BEAT,
	## A dialogue or narration line. [member filter] matches the speaker's
	## display name, case-insensitively; narration has an empty speaker.
	LINE,
	## A `<set:>` wrote a variable. [member filter] matches the dotted
	## path; a trailing `*` matches a prefix (`Wren.*`).
	VARIABLE,
	## An authored `<fire: verb>`. [member filter] matches the verb name.
	FIRE,
	## A choice menu was presented (filter unused).
	CHOICE,
	## The story ran out of work (filter unused).
	FINISHED,
	## The runtime reported an error (filter unused).
	ERROR,
}

## The event matched — `payload` is the runtime step dictionary.
signal triggered(payload: Dictionary)

@export var kind: Kind = Kind.DIRECTIVE
## Name filter, per [member kind]. Empty matches everything of that kind.
@export var filter := ""
## Story to attach to. When null, the nearest [LoomStory] is found at
## ready ([method LoomStory.find_for]).
@export var story: LoomStory = null

var _filter_hash := ""


func _ready() -> void:
	if story == null:
		story = LoomStory.find_for(self)
	if story == null:
		push_warning("LoomHook: no LoomStory found for %s" % get_path())
		return
	if filter != "":
		# `fire` steps carry the verb as its FNV-1a 64 hash, not the name.
		_filter_hash = LoomHash.fnv1a64_hex(filter)
	story.step_emitted.connect(_on_step)


func _on_step(step: Dictionary) -> void:
	# The payload is the runtime's own step dictionary, shared by every
	# listener — treat it as read-only rather than paying for a copy per
	# hook per event.
	if _matches(step):
		triggered.emit(step)


func _matches(step: Dictionary) -> bool:
	var step_kind := str(step["step"])
	match kind:
		Kind.DIRECTIVE:
			if step_kind != LoomOps.STEP_DIRECTIVE:
				return false
			if int(step.get("block", LoomOps.HOST_LEAF)) == LoomOps.HOST_BLOCK_END:
				return false
			return filter == "" or str(step.get("verbName", "")) == filter
		Kind.BEAT:
			if step_kind != LoomOps.STEP_BEAT:
				return false
			return filter == "" or str(step.get("name", "")) == filter
		Kind.LINE:
			if step_kind != LoomOps.STEP_LINE:
				return false
			return filter == "" or str(step.get("display", "")).nocasecmp_to(filter) == 0
		Kind.VARIABLE:
			if step_kind != LoomOps.STEP_VARSET:
				return false
			if filter == "":
				return true
			var path := str(step.get("path", ""))
			if filter.ends_with("*"):
				return path.begins_with(filter.trim_suffix("*"))
			return path == filter
		Kind.FIRE:
			if step_kind != LoomOps.STEP_SIGNAL:
				return false
			return filter == "" or str(step.get("verb", "")) == _filter_hash
		Kind.CHOICE:
			return step_kind == LoomOps.STEP_CHOICE
		Kind.FINISHED:
			return step_kind == LoomOps.STEP_DONE
		Kind.ERROR:
			return step_kind == LoomOps.STEP_ERROR
	return false
