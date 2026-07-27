@icon("res://addons/loom/icons/loom_style.svg")
## Per-character presentation: how one speaker looks and sounds in a
## [LoomDialogueBox].
##
## Add these to [member LoomStyle.speakers]. The [member speaker] field
## matches the runtime's display name (the ALL-CAPS cue — `WREN`,
## `DOCKHAND`), case-insensitively; everything else here overrides the
## style's defaults for that character only.
class_name LoomSpeakerStyle
extends Resource

## The speaker this entry styles, as the story displays it (`WREN`).
## Case-insensitive.
@export var speaker := ""
## Pretty name shown in the box instead of the cue ("Wren"). Empty keeps
## the story's display name.
@export var display_name := ""
## Name label color. Transparent inherits [member LoomStyle.speaker_color].
@export var color := Color(0, 0, 0, 0)
## Portrait shown beside this speaker's lines.
@export var portrait: Texture2D = null
## Voice blip played while this speaker's lines type out. Null inherits
## [member LoomStyle.blip].
@export var blip: AudioStream = null
