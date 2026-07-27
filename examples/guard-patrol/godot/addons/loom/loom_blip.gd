@icon("res://addons/loom/icons/loom_blip.svg")
## Turns raw typewriter character signals into sound — the classic
## dialogue "voice".
##
## [LoomTypewriter] deliberately knows nothing about audio: it emits
## [signal LoomTypewriter.character_shown] and this node interprets that
## stream. Put one under (or next to) a typewriter, assign a stream, done.
## Hosts that want something else entirely — rumble, particle puffs, a
## talking-head jaw — consume the same character signal with their own
## node; nothing in the pipeline assumes sound.
##
## Players are pooled: [member polyphony] `AudioStreamPlayer`s are created
## once and rotated, so a fast typewriter never allocates mid-line.
class_name LoomBlip
extends Node

## A blip was played (after cadence/whitespace filtering) — chain further
## reactions here.
signal blipped(character: String)

## Typewriter to listen to. When null, the parent (or a sibling
## [LoomTypewriter]) is used.
@export var typewriter: LoomTypewriter = null
## The sound. Null disables the node.
@export var stream: AudioStream = null
## Play every N visible (non-whitespace) characters.
@export_range(1, 10) var every := 2
## Random pitch range per blip, so repetition does not grate.
@export var pitch_range := Vector2(0.92, 1.08)
## Audio bus to play on.
@export var bus: StringName = &"Master"
## Pooled player count. 1 gives the classic clipped retrigger; more lets
## blips ring out and overlap.
@export_range(1, 8) var polyphony := 1

var _players: Array[AudioStreamPlayer] = []
var _next_player := 0
var _count := 0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	if typewriter == null:
		typewriter = _find_typewriter()
	if typewriter == null:
		push_warning("LoomBlip: no LoomTypewriter found for %s" % get_path())
		return
	typewriter.started.connect(func(_text: String) -> void: _count = 0)
	typewriter.character_shown.connect(_on_character)


func _find_typewriter() -> LoomTypewriter:
	var parent := get_parent()
	if parent is LoomTypewriter:
		return parent
	if parent != null:
		for sibling in parent.get_children():
			if sibling is LoomTypewriter:
				return sibling
	return null


func _on_character(_index: int, character: String) -> void:
	if stream == null or character == " " or character == "\n" or character == "\t":
		return
	_count += 1
	if _count < every:
		return
	_count = 0
	play_blip()
	blipped.emit(character)


## Fire one blip now, regardless of cadence — for menu ticks and the like.
func play_blip() -> void:
	if stream == null:
		return
	if _players.is_empty():
		for _i in polyphony:
			var player := AudioStreamPlayer.new()
			add_child(player)
			_players.append(player)
	var player := _players[_next_player]
	_next_player = (_next_player + 1) % _players.size()
	player.stream = stream
	player.bus = bus
	player.pitch_scale = _rng.randf_range(pitch_range.x, pitch_range.y)
	player.play()
