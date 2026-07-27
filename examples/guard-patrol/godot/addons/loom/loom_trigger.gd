@icon("res://addons/loom/icons/loom_trigger.svg")
## Game → story: fire an authored `on <verb>` hook or start a beat when
## something happens in the scene — the Wwise-Unity "Trigger On" pattern.
##
## Drop one under an [Area2D]/[Area3D] and pick [constant BODY_ENTERED]:
## walking into the area fires `<on lamp_lit>` hooks (or starts a beat)
## with no code. [constant MANUAL] mode makes it a named story verb you
## can wire to any signal — a button, an animation track, a timer.
##
## [codeblock]
## # Node: LoomTrigger  action = FIRE_SIGNAL  target_name = "lamp_lit"
## #       trigger_on = BODY_ENTERED   (parent is the lamp's Area3D)
## [/codeblock]
class_name LoomTrigger
extends Node

## What the trigger does to the story.
enum Action {
	## Call [method LoomRuntime.signal_event] with [member target_name] —
	## runs every authored `on <verb>` hook. [member subject] binds the
	## hook's parameter (`on lamp_lit guest` receives it as `guest`).
	FIRE_SIGNAL,
	## Start the beat named [member target_name] (restarts the playhead,
	## like [method LoomStory.play]). [member subject] binds as `guest`.
	START_BEAT,
}

## What fires the trigger.
enum TriggerOn {
	## Only an explicit [method trigger] call — wire it to any signal.
	MANUAL,
	## When this node is ready.
	READY,
	## Parent Area2D/Area3D `area_entered`.
	AREA_ENTERED,
	## Parent Area2D/Area3D `area_exited`.
	AREA_EXITED,
	## Parent Area2D/Area3D `body_entered`.
	BODY_ENTERED,
	## Parent Area2D/Area3D `body_exited`.
	BODY_EXITED,
}

## The trigger fired into the story.
signal triggered

@export var action: Action = Action.FIRE_SIGNAL
## The signal verb (for [constant FIRE_SIGNAL]) or beat name (for
## [constant START_BEAT]).
@export var target_name := ""
## Optional subject identity carried into the story (see [member action]).
@export var subject := ""
@export var trigger_on: TriggerOn = TriggerOn.MANUAL
## Fire at most once, like a one-shot pickup or scripted encounter.
@export var once := false
## Story to attach to. When null, the nearest [LoomStory] is found when
## the trigger fires.
@export var story: LoomStory = null

const _PARENT_SIGNALS := {
	TriggerOn.AREA_ENTERED: "area_entered",
	TriggerOn.AREA_EXITED: "area_exited",
	TriggerOn.BODY_ENTERED: "body_entered",
	TriggerOn.BODY_EXITED: "body_exited",
}

var _fired := false


func _ready() -> void:
	if trigger_on == TriggerOn.READY:
		trigger.call_deferred()
		return
	if _PARENT_SIGNALS.has(trigger_on):
		var signal_name: String = _PARENT_SIGNALS[trigger_on]
		var parent := get_parent()
		if parent != null and parent.has_signal(signal_name):
			parent.connect(signal_name, _on_overlap)
		else:
			push_warning(
				"LoomTrigger: %s needs a parent with a `%s` signal (Area2D/Area3D)"
				% [get_path(), signal_name]
			)


func _on_overlap(_other: Node) -> void:
	trigger()


## Fire the trigger now. Safe to call in any mode.
func trigger() -> void:
	if once and _fired:
		return
	if story == null:
		story = LoomStory.find_for(self)
	if story == null:
		push_warning("LoomTrigger: no LoomStory found for %s" % get_path())
		return
	_fired = true
	match action:
		Action.FIRE_SIGNAL:
			story.signal_event(target_name, subject)
		Action.START_BEAT:
			var bindings := {}
			if subject != "":
				bindings["guest"] = subject
			story.start_beat(target_name, bindings)
	triggered.emit()
