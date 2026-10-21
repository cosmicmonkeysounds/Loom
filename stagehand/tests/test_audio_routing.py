"""The router's `audio.json` reader and target resolver (pinned to
`@loom/house` `resolveTargets` by the shared fixture)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from stagehand.audio.routing import (
    AudioDocError,
    fold,
    output_gains,
    parse_audio,
    resolve_targets,
    split_targets,
)

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "audio-resolve.json").read_text())
AUDIO = parse_audio(FIXTURE["audio"])
HOUSE = FIXTURE["house"]


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: ",".join(c["to"]) or "empty")
def test_resolve_matches_the_shared_fixture(case):
    got = resolve_targets(AUDIO, HOUSE, case["to"])
    assert list(got.speakers) == case["speakers"]
    assert list(got.outputs) == case["outputs"]
    assert list(got.unknown) == case["unknown"]


def test_fold_ignores_case_spaces_underscores_and_dashes():
    assert fold("The Desktop") == fold("the_desktop") == fold("THE-DESKTOP") == "thedesktop"


def test_without_a_house_a_location_only_resolves_through_a_room_id():
    assert resolve_targets(AUDIO, None, ["The Tube"]).unknown == ("The Tube",)
    assert resolve_targets(AUDIO, None, ["hall"]).speakers == ("hall-1",)


def test_parse_reads_the_doc():
    assert (AUDIO.device, AUDIO.inputs, AUDIO.outputs, AUDIO.rate) == ("MOTU", 16, 16, 48000)
    assert AUDIO.speaker("bar-1").out == (4, 3) and AUDIO.speaker("bar-1").gain_db == -3
    assert AUDIO.routes[0].inp == 3 and AUDIO.routes[0].out == (1, 2) and AUDIO.routes[0].gain_db == -6
    assert AUDIO.cue("Printer_Grind").gain_db == -4
    assert AUDIO.announce_to == ("downstairs", "The Tube") and AUDIO.announce_chime
    assert AUDIO.output_label(3) == "Start Bar L" and AUDIO.output_label(12) == "output 12"


def test_parse_defaults_announce_to_everywhere():
    doc = {**FIXTURE["audio"]}
    doc.pop("announce")
    assert parse_audio(doc).announce_to == ("everywhere",)


@pytest.mark.parametrize(
    "patch, msg",
    [
        ({"version": 2}, "version"),
        ({"device": {"name": "MOTU", "inputs": 0, "outputs": 16}}, "inputs"),
        ({"speakers": [{"id": "x", "room": "desktop", "out": [17]}]}, "speakers[0].out"),
        ({"routes": [{"in": 99, "out": [1]}]}, "routes[0].in"),
        ({"cues": {"zip": {"to": "desktop", "gain": 40}}}, "cues.zip.gain"),
    ],
)
def test_parse_refuses_what_routing_cannot_use(patch, msg):
    with pytest.raises(AudioDocError, match=msg.replace("[", r"\[").replace("]", r"\]")):
        parse_audio({**FIXTURE["audio"], **patch})


def test_split_targets_keeps_a_spaced_location_whole():
    assert split_targets("The Desktop", AUDIO, HOUSE) == ["The Desktop"]
    assert split_targets("desktop start-bar", AUDIO, HOUSE) == ["desktop", "start-bar"]
    assert split_targets("desktop and hall", AUDIO, HOUSE) == ["desktop", "hall"]
    assert split_targets("The Desktop, The Tube", AUDIO, HOUSE) == ["The Desktop", "The Tube"]
    assert split_targets("  ", AUDIO, HOUSE) == []


def test_output_gains_add_the_cue_and_take_the_louder_speaker():
    gains = output_gains(AUDIO, ("desk-l", "bar-1"), gain_db=-4)
    assert gains == {1: -4.0, 3: -7.0, 4: -7.0}
