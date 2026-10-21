"""Wave 17: the story's `sound X in <Place>` / `sound X with rooms: …` arrive as
the long form `X, rooms: …` (core `lowerSoundArgs`), so `parse_directive`
reads the target and the `rooms` kwarg with no change of its own."""

from stagehand.show.directives import directive_context, parse_directive


def test_rooms_kwarg_from_a_place():
    pd = parse_directive("sfx", "dance_song, rooms: The_Desktop")
    assert pd.targets == ("dance_song",)
    assert pd.kwargs == {"rooms": "The_Desktop"}
    assert directive_context(pd)["target"] == "dance_song"


def test_rooms_list_and_other_kwargs():
    pd = parse_directive("sfx", "x, rooms: The_Desktop The_Start_Bar, gain: -6")
    assert pd.targets == ("x",)
    assert pd.kwargs == {"rooms": "The_Desktop The_Start_Bar", "gain": "-6"}
    assert pd.kwargs["rooms"].split() == ["The_Desktop", "The_Start_Bar"]


def test_plain_sound_is_unchanged():
    pd = parse_directive("sfx", "printer_grind")
    assert pd.targets == ("printer_grind",)
    assert pd.kwargs == {}
