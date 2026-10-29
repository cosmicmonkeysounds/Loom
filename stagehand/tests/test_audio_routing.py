"""The router's `audio.json` reader and target resolver, pinned to
`@loom/house` `resolveTargets` by the shared fixture
`house/test/fixtures/audio-resolve.json` (run on `audio-basic.json` +
`audio-house.json`). Stagehand keeps byte-identical copies in
`tests/fixtures/house-audio/` (stagehand ships without the JS tree); when
the house package sits beside it, a test diffs the copies against it."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from stagehand.audio.routing import (
    AudioDocError,
    fold,
    input_reach,
    output_gains,
    output_trims,
    parse_audio,
    resolve_targets,
    sidechain_sources,
    split_targets,
)

HERE = Path(__file__).parent
SHARED_COPY = HERE / "fixtures" / "house-audio"
SHARED_HOME = HERE.parent.parent / "house" / "test" / "fixtures"
SHARED_FILES = ("audio-resolve.json", "audio-basic.json", "audio-house.json")


def _shared(name: str):
    return json.loads((SHARED_COPY / name).read_text(encoding="utf-8"))


SHARED = _shared("audio-resolve.json")
SHARED_AUDIO = parse_audio(_shared(SHARED["audio"]))
SHARED_HOUSE = _shared(SHARED["house"])

#: The router's own fixture (inline audio + house) for the router-only bits:
#: `unknown`, parsing, the end-to-end router test.
FIXTURE = json.loads((HERE / "fixtures" / "router-audio.json").read_text(encoding="utf-8"))
AUDIO = parse_audio(FIXTURE["audio"])
HOUSE = FIXTURE["house"]


@pytest.mark.parametrize("name", SHARED_FILES)
def test_the_shared_fixture_copies_match_the_house_package(name):
    home = SHARED_HOME / name
    if not home.exists():
        pytest.skip("the @loom/house fixtures are not beside this stagehand tree")
    assert (SHARED_COPY / name).read_bytes() == home.read_bytes(), f"re-copy house/test/fixtures/{name}"


@pytest.mark.parametrize("case", SHARED["cases"], ids=lambda c: ",".join(c["to"]) + ("/no-house" if c.get("house") is False else "") or "empty")
def test_resolve_matches_the_shared_house_fixture(case):
    house = None if case.get("house") is False else SHARED_HOUSE
    got = resolve_targets(SHARED_AUDIO, house, case["to"])
    assert list(got.speakers) == case["speakers"]
    assert list(got.outputs) == case["outputs"]


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: ",".join(c["to"]) or "empty")
def test_resolve_on_the_router_fixture_with_unknowns(case):
    got = resolve_targets(AUDIO, HOUSE, case["to"])
    assert list(got.speakers) == case["speakers"]
    assert list(got.outputs) == case["outputs"]
    assert list(got.unknown) == case["unknown"]


def test_a_target_reaches_the_union_of_everything_it_names():
    # "Living room" is both the zone `living`'s name and room desktop's label.
    assert resolve_targets(SHARED_AUDIO, SHARED_HOUSE, ["Living room"]).speakers == ("living-l", "living-r")
    assert resolve_targets(SHARED_AUDIO, SHARED_HOUSE, ["Desktop (living room)"]).speakers == ("living-l", "living-r")
    # A zone by its name, folded.
    assert resolve_targets(SHARED_AUDIO, SHARED_HOUSE, ["down_stairs"]).speakers == ("down-hall", "studio")


def test_a_known_room_with_no_speaker_is_not_unknown():
    got = resolve_targets(AUDIO, HOUSE, ["crawl", "Crawl space"])
    assert got.speakers == () and got.unknown == ()


def test_fold_is_house_fold_target():
    assert fold("The Desktop") == fold("the_desktop") == fold("THE-DESKTOP") == fold("  the   desktop ") == "the desktop"
    assert fold("start-bar") == fold("Start Bar") == "start bar"
    # Spaces are not deleted: `startbar` names another thing than `Start Bar`.
    assert fold("startbar") != fold("Start Bar")


def test_without_a_house_a_location_or_label_names_nothing():
    assert resolve_targets(AUDIO, None, ["The Tube"]).unknown == ("The Tube",)
    assert resolve_targets(AUDIO, None, ["Kitchen"]).unknown == ("Kitchen",)
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


def test_output_gains_are_the_cue_and_the_trims_are_the_outputs():
    """Wave 38: a speaker's trim is its outputs' (the mixer's `set_trim`),
    never inside a voice's gains; two speakers on one output, the louder."""
    assert output_gains(AUDIO, ("desk-l", "bar-1"), gain_db=-4) == {1: -4.0, 3: -4.0, 4: -4.0}
    assert output_trims(AUDIO) == {1: 0.0, 2: 0.0, 3: -3.0, 4: -3.0, 5: 0.0, 6: 0.0, 7: 0.0}
    shared = {**FIXTURE["audio"], "speakers": [*FIXTURE["audio"]["speakers"], {"id": "bar-2", "out": [3], "gain": -1}]}
    assert output_trims(parse_audio(shared))[3] == -1.0


def _with_inputs(*inputs, routes=None) -> dict:
    return {**FIXTURE["audio"], "inputs": list(inputs), **({"routes": routes} if routes is not None else {})}


def test_input_roles_and_reach_are_read_leniently():
    """C1.1: `role` + `reach` per input; a malformed or reserved role is
    ignored with a warning, never a refusal (the server validated the doc)."""
    doc = parse_audio(
        _with_inputs(
            {"ch": 1, "label": "Clippy", "kind": "mic", "role": "clippy", "reach": ["living"]},
            {"ch": 2, "label": "x", "kind": "mic", "role": "Bad Role"},
            {"ch": 3, "label": "TV", "kind": "line", "role": "trabolta"},
            {"ch": 4, "label": "y", "kind": "line", "role": "announce"},
            {"ch": 5, "label": "z", "kind": "line", "role": "takeover", "reach": 7},
            {"ch": 6, "label": "w", "kind": "line", "reach": "hall"},
        )
    )
    roles = {i.ch: (i.role, i.reach) for i in doc.input_list}
    assert roles == {1: ("clippy", ("living",)), 2: (None, None), 3: ("trabolta", None), 4: (None, None), 5: (None, None), 6: (None, ("hall",))}
    assert doc.input_labels[1] == "Clippy" and doc.input_list[0].kind == "mic"
    text = "\n".join(doc.warnings)
    assert "'Bad Role'" in text and "'announce': reserved" in text and "'takeover': reserved" in text and "reach" in text
    assert parse_audio(FIXTURE["audio"]).warnings == ()  # an older file: no roles, no warnings


def test_a_sources_reach_defaults_to_its_routes_then_everywhere():
    doc = parse_audio(
        _with_inputs(
            {"ch": 1, "label": "Clippy", "role": "clippy", "reach": ["living"]},
            {"ch": 2, "label": "spare", "role": "spare"},
            {"ch": 3, "label": "TV", "role": "trabolta"},
            routes=[{"in": 3, "out": [3, 4, 5]}],
        )
    )
    specs, warnings = sidechain_sources(doc, HOUSE)
    assert [(s.name, s.inputs, s.reach) for s in specs] == [
        ("clippy", (1,), (1, 2)),  # its reach: the living zone
        ("spare", (2,), (1, 2, 3, 4, 5, 6, 7)),  # no reach, no route: everywhere
        ("trabolta", (3,), (3, 4, 5)),  # no reach: the outputs its routes feed
    ]
    assert warnings == []


def test_a_reach_that_reaches_nothing_is_a_warning():
    doc = parse_audio(_with_inputs({"ch": 1, "label": "m", "role": "clippy", "reach": ["nowhere", "The Internet", "hall"]}))
    reach, warnings = input_reach(doc, HOUSE, doc.input_list[0])
    assert reach == (5,)
    assert any("'nowhere' names no zone" in w for w in warnings) and any("'The Internet' reaches no wired speaker" in w for w in warnings)


def test_parse_reads_device_expect_leniently_and_ignores_the_tablets_list():
    """wave 18b (Q2, Q8): `device.expect` is read for the layout check; a
    malformed one is not compared (routing never needs it); `announce.terminals`
    is the tablets' list, never the router's."""
    base = FIXTURE["audio"]
    assert parse_audio(base).expect is None
    dev = {**base["device"], "expect": {"inputs": 32, "outputs": 30}}
    doc = parse_audio({**base, "device": dev, "announce": {"to": ["living"], "terminals": ["desktop-tv", "start-bar"]}})
    assert doc.expect == (32, 30) and doc.announce_to == ("living",)
    for bad in ({"inputs": 0, "outputs": 30}, {"inputs": 32}, {"inputs": True, "outputs": 30}, {"inputs": 65, "outputs": 30}, "32/30"):
        assert parse_audio({**base, "device": {**base["device"], "expect": bad}}).expect is None, bad


def test_the_shared_basic_fixture_carries_expect_and_an_empty_tablet_list():
    assert SHARED_AUDIO.expect == (32, 30)
    assert _shared("audio-basic.json")["announce"]["terminals"] == []
