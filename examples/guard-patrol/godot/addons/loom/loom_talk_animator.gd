@icon("res://addons/loom/icons/loom_talk_animator.svg")
## Turns raw typewriter signals into talk/idle animation — a portrait's
## mouth flaps while a line types out, and settles when it is done.
##
## Same philosophy as [LoomBlip]: the typewriter emits signals, this node
## interprets them. It drives an [AnimationPlayer] or an
## [AnimatedSprite2D]/[AnimatedSprite3D] (whatever [member animator]
## points at), and re-emits [signal talk_started] / [signal talk_stopped]
## so entirely custom rigs (Skeleton blend shapes, shader params) can
## listen without any of this node's assumptions.
class_name LoomTalkAnimator
extends Node

## A line began revealing.
signal talk_started
## The line fully revealed (or was skipped).
signal talk_stopped

## Typewriter to listen to. When null, the parent (or a sibling
## [LoomTypewriter]) is used.
@export var typewriter: LoomTypewriter = null
## An [AnimationPlayer], [AnimatedSprite2D], or [AnimatedSprite3D] to
## drive. Optional — the signals fire either way.
@export var animator: Node = null
## Animation played while the line types out.
@export var talk_animation := "talk"
## Animation played when the line is done. Empty stops playback instead.
@export var idle_animation := "idle"

var _talking := false


func _ready() -> void:
	if typewriter == null:
		typewriter = _find_typewriter()
	if typewriter == null:
		push_warning("LoomTalkAnimator: no LoomTypewriter found for %s" % get_path())
		return
	typewriter.started.connect(_on_started)
	typewriter.finished.connect(_on_finished)


func _find_typewriter() -> LoomTypewriter:
	var parent := get_parent()
	if parent is LoomTypewriter:
		return parent
	if parent != null:
		for sibling in parent.get_children():
			if sibling is LoomTypewriter:
				return sibling
	return null


func is_talking() -> bool:
	return _talking


func _on_started(_text: String) -> void:
	_talking = true
	_play(talk_animation)
	talk_started.emit()


func _on_finished() -> void:
	_talking = false
	if idle_animation != "":
		_play(idle_animation)
	else:
		_stop()
	talk_stopped.emit()


func _play(animation: String) -> void:
	if animator == null or animation == "":
		return
	if animator.has_method("play"):
		animator.call("play", animation)


func _stop() -> void:
	if animator != null and animator.has_method("stop"):
		animator.call("stop")
