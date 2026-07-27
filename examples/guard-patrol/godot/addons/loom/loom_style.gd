@icon("res://addons/loom/icons/loom_style.svg")
## The look and feel of a [LoomDialogueBox], as a shareable resource.
##
## One `.tres` carries everything presentation: panel, fonts, colors,
## typewriter pacing, voice blips, choice buttons, the continue indicator,
## and per-character overrides ([LoomSpeakerStyle] — name colors,
## portraits, per-speaker blips). Swap the resource, restyle the game;
## share one style between every box in the project.
##
## Every field has a sensible default, so an empty `LoomStyle.new()` is a
## clean dark dialogue box; `addons/loom/styles/default.tres` is that
## default, ready to duplicate and edit in the inspector.
class_name LoomStyle
extends Resource

@export_group("Panel")
## Background of the dialogue box. Null falls back to a built-in dark
## rounded panel.
@export var panel: StyleBox = null
## Inner padding between the panel edge and the content, in pixels.
@export var padding := 16
## Portrait slot size ([member LoomSpeakerStyle.portrait]).
@export var portrait_size := Vector2(96, 96)

@export_group("Text")
## Body font. Null uses the theme default.
@export var font: Font = null
@export var font_size := 18
@export var text_color := Color(0.93, 0.93, 0.93)
## Speaker-name font. Null uses the theme default.
@export var speaker_font: Font = null
@export var speaker_font_size := 14
## Default speaker-name color; a [LoomSpeakerStyle] can override per
## character.
@export var speaker_color := Color(0.98, 0.86, 0.6)

@export_group("Typewriter")
@export var characters_per_second := 45.0
## Extra pause after punctuation, in character-times (see
## [member LoomTypewriter.punctuation_pauses]).
@export var punctuation_pauses := {
	".": 8.0, "!": 8.0, "?": 8.0, "…": 10.0, ",": 3.0, ";": 4.0, ":": 4.0,
}
## Voice blip played as characters type out. Null is silent.
@export var blip: AudioStream = null
## Play the blip every N visible characters.
@export var blip_every := 2
## Random pitch range per blip, so repetition does not grate.
@export var blip_pitch_range := Vector2(0.92, 1.08)

@export_group("Choices")
## Choice-button font. Null uses the theme default.
@export var choice_font: Font = null
@export var choice_font_size := 16
@export var choice_color := Color(0.85, 0.9, 1.0)

@export_group("Continue indicator")
## Icon shown when a line has fully revealed and the box waits for input.
## Null shows [member continue_text] instead.
@export var continue_icon: Texture2D = null
@export var continue_text := "▼"

@export_group("Speakers")
## Per-character overrides, matched by display name.
@export var speakers: Array[LoomSpeakerStyle] = []


## The [LoomSpeakerStyle] for `display_name`, or null. Case-insensitive,
## so `WREN` cues match a "Wren" entry.
func speaker_style(display_name: String) -> LoomSpeakerStyle:
	if display_name == "":
		return null
	for entry in speakers:
		if entry != null and entry.speaker.nocasecmp_to(display_name) == 0:
			return entry
	return null


## The built-in fallback panel: dark, rounded, slightly translucent.
static func fallback_panel() -> StyleBox:
	var box := StyleBoxFlat.new()
	box.bg_color = Color(0.07, 0.08, 0.11, 0.94)
	box.border_color = Color(0.25, 0.28, 0.36)
	box.set_border_width_all(1)
	box.set_corner_radius_all(10)
	return box
