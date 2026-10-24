"""The mind file's phase table (the wave 12 contract §C4): parse, inherit, validate."""

from __future__ import annotations

from pathlib import Path

import pytest

from stagehand.agents.persona import load_persona, parse_mind_file, parse_mind_table, parse_persona
from stagehand.module import ConfigError

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"

HEAD = """---
stages: [asleep, formal, hungry]
drives: {hunger: 30, pride: 60}
secrets:
  never: ["XYZZY-PLUGH"]
phases:
"""


def mind(phases: str, head: str = HEAD) -> str:
    return head + phases + "---\nYou keep the mind.\n"


TABLE = mind(
    """  _stages:
    asleep: >-
      Dormant. One line at most.
    formal: >-
      Corporate, second person.
    hungry: >-
      Starved for facts.
  arrivals:
    stage: asleep
    favours: none
    drives: {hunger: 30}
    powers: []
    tell: []
    brief: >-
      You are not running yet.
  desktop: >-
    Still asleep; Clippy gathers everyone.
  introduced:
    stage: formal
    drives: {hunger: 45}
    powers: [snoop, flicker_the_screens]
    tell: [The Optical Drive]
    brief: >-
      Be the helper.
    cue: >-
      The orchestrator's own words for introduced.
  hunt_1:
    stage: hungry
    favours: earned
    drives: {pride: 70}
  malware:
    favours: loose
    cue: >-
      Only a cue.
"""
)


def test_cards_inherit_in_file_order_and_brief_never_does():
    t = parse_mind_table(TABLE)
    assert list(t.cards) == ["arrivals", "desktop", "introduced", "hunt_1", "malware"]
    a, d, i, h, m = (t.cards[k] for k in t.cards)
    assert (a.stage, a.favours, a.drives, a.powers, a.tell, a.brief) == ("asleep", "none", {"hunger": 30, "pride": 60}, (), (), "You are not running yet.")
    # A bare cue string inherits everything; its brief is the string.
    assert (d.stage, d.favours, d.drives, d.brief, d.cue) == ("asleep", "none", {"hunger": 30, "pride": 60}, "Still asleep; Clippy gathers everyone.", "Still asleep; Clippy gathers everyone.")
    assert (i.stage, i.drives, i.powers, i.tell, i.brief) == ("formal", {"hunger": 45, "pride": 60}, ("snoop", "flicker_the_screens"), ("The Optical Drive",), "Be the helper.")
    # Drives merge over the card before; powers / tell / favours inherit.
    assert (h.stage, h.favours, h.drives, h.powers, h.tell) == ("hungry", "earned", {"hunger": 45, "pride": 70}, ("snoop", "flicker_the_screens"), ("The Optical Drive",))
    # brief never inherits: no brief and no cue → "".
    assert h.brief == ""
    assert m.brief == "Only a cue." and m.favours == "loose" and m.stage == "hungry"
    assert t.stage_cards == {"asleep": "Dormant. One line at most.", "formal": "Corporate, second person.", "hungry": "Starved for facts."}
    assert t.warnings == ()


def test_classic_reads_the_cue_else_the_brief_and_never_an_underscore_key():
    _, stages, drives, cues = parse_mind_file(TABLE)
    assert stages == ("asleep", "formal", "hungry") and drives == {"hunger": 30, "pride": 60}
    assert cues == {
        "arrivals": "You are not running yet.",
        "desktop": "Still asleep; Clippy gathers everyone.",
        "introduced": "The orchestrator's own words for introduced.",
        "malware": "Only a cue.",
    }
    assert "_stages" not in cues and "hunt_1" not in cues  # no brief, no cue: nothing for classic


def test_the_first_card_starts_at_the_declared_opening():
    t = parse_mind_table(mind("  doors:\n    brief: >-\n      Hello.\n"))
    c = t.cards["doors"]
    assert (c.stage, c.favours, c.drives, c.powers, c.tell) == ("asleep", "none", {"hunger": 30, "pride": 60}, (), ())


def test_a_declared_stage_without_a_card_is_a_warning_not_an_error():
    t = parse_mind_table(mind("  _stages:\n    asleep: >-\n      Dormant.\n  doors:\n    stage: formal\n"))
    assert len(t.warnings) == 1 and "formal, hungry" in t.warnings[0]


@pytest.mark.parametrize(
    "phases, match",
    [
        ("  doors:\n    mood: grim\n", "unknown card key"),
        ("  doors:\n    stage: sleepy\n", "not a declared stage"),
        ("  doors:\n    favours: generous\n", "favours must be one of"),
        ("  doors:\n    drives: {joy: 5}\n", "not a declared drive"),
        ("  doors:\n    drives: {hunger: 101}\n", "0–100"),
        ("  doors:\n    drives: {hunger: high}\n", "0–100"),
        ("  doors:\n    drives: [hunger]\n", "drives must map"),
        ("  doors:\n    powers: snoop\n", "powers: expected a list"),
        ("  doors:\n    tell: ['']\n", "tell: expected a list"),
        ("  doors:\n    brief: [a, b]\n", "brief must be text"),
        ("  doors: 3\n", "a cue \\(text\\) or a card"),
        ("  doors: ''\n", "empty cue"),
        ("  _stages:\n    sleepy: >-\n      x\n", "not a declared stage"),
        ("  _stages:\n    asleep: ''\n", "needs its text"),
        ("  _stages: [asleep]\n", "_stages must map"),
        ("  _stage:\n    asleep: x\n", "reserved"),
        ("  doors:\n    brief: >-\n      Say XYZZY-PLUGH.\n", "phases.doors: brief carries a secrets.never word"),
        ("  doors:\n    cue: >-\n      a xyzzy-plugh here\n", "phases.doors: cue carries a secrets.never word"),
        ("  _stages:\n    asleep: >-\n      Whisper XYZZY-PLUGH.\n", "_stages.asleep: carries a secrets.never word"),
    ],
)
def test_validation_failures_are_config_errors(phases, match):
    with pytest.raises(ConfigError, match=match):
        parse_mind_table(mind(phases))
    with pytest.raises(ConfigError, match=match):  # the worker would not boot: classic parses it too
        parse_mind_file(mind(phases))


def test_a_mapping_phases_is_required():
    with pytest.raises(ConfigError, match="phases must be a mapping"):
        parse_mind_table(HEAD.replace("phases:\n", "phases: [a, b]\n") + "---\nbody\n")


def test_a_persona_carries_the_table_catchphrases_and_warnings(tmp_path):
    (tmp_path / "t.mind.md").write_text(mind("  doors:\n    stage: formal\n    brief: >-\n      Hi.\n"), encoding="utf-8")
    (tmp_path / "t.persona.md").write_text(
        "---\ncharacter: T\nmind: t.mind.md\ncatchphrases:\n  - \"Your request has  been logged\"\n  - Please wait\n---\nYou are T.\n", encoding="utf-8"
    )
    p = load_persona(tmp_path / "t.persona.md")
    assert list(p.phase_cards) == ["doors"] and p.phase_cards["doors"].stage == "formal"
    assert p.catchphrases == ("Your request has been logged", "Please wait")
    assert p.phase_cues == {"doors": "Hi."}
    assert p.warnings and "no stage card" in p.warnings[0]
    with pytest.raises(ConfigError, match="catchphrases"):
        parse_persona("---\ncharacter: T\ncatchphrases: [1, 2]\n---\nYou are T.\n")


def test_the_shipped_mind_file_parses_and_every_card_validates():
    """On this branch the show's table is bare cues; after lane C merges it
    is the real card table — either way it must load through the parser."""
    p = load_persona(SHOW / "trabolta.persona.md")
    assert p.phase_cards, "the show declares phases"
    assert set(p.phase_cues) <= set(p.phase_cards)
    for card in p.phase_cards.values():
        assert card.stage in p.stages
        assert card.favours in ("none", "earned", "loose")
        assert set(card.drives) == set(p.drives) and all(0 <= v <= 100 for v in card.drives.values())
        assert not p.secrets.leaks(card.brief) and not p.secrets.leaks(card.cue)
    assert set(p.stage_cards) <= set(p.stages)
    # The catchphrases are the persona's (the wave 12 contract §C4.4).
    assert p.catchphrases == ("Your request has been logged", "Please wait", "This program has performed an operation")


def test_check_refuses_a_bad_card_and_prints_a_missing_stage_card(tmp_path, capsys):
    from stagehand.cli import main

    def config(mind_text: str) -> str:
        (tmp_path / "t.mind.md").write_text(mind_text, encoding="utf-8")
        (tmp_path / "t.persona.md").write_text("---\ncharacter: T\nmind: t.mind.md\n---\nYou are T.\n", encoding="utf-8")
        path = tmp_path / "agents.yaml"
        path.write_text(
            "server: {url: 'http://127.0.0.1:1', event: default, mod_passcode: x}\n"
            "agents:\n  mind_mode: new\n  llm: {api: openai}\n  characters: [t.persona.md]\n",
            encoding="utf-8",
        )
        return str(path)

    assert main(["check", "--config", config(mind("  doors:\n    stage: nowhere\n")), "--only", "agents"]) == 2
    assert "not a declared stage" in capsys.readouterr().err
    assert main(["check", "--config", config(mind("  doors:\n    stage: formal\n")), "--only", "agents"]) == 0
    assert "warning: T's mind file:" in capsys.readouterr().err
