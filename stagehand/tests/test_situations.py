"""Persona `situations:` — extra instructions for a kind of moment, gated
like the persona's `when:` and shown to both models only while they hold."""

import pytest

from stagehand.agents.mind import Mind
from stagehand.agents.orchestrator import reflect_messages, reflect_tokens_needed
from stagehand.agents.persona import parse_persona
from stagehand.agents.prompt import build_messages, matching_situations
from stagehand.agents.reply import Reply
from stagehand.module import ConfigError

PERSONA = """---
character: Trabolta
variables: truth
them: at_the_heart
situations:
  - name: at his heart
    when: them.at_the_heart == true
    prompt: |
      You are in the cold room.
      Be candid.
  - when: them.at_the_heart == true && Night.step >= 14
    prompt: The hour is late.
  - when: speaker.kind == 'performer'
    prompt: STAFF ONLY.
---
You are TRABOLTA.
"""


def request(heart=None, step=14, kind="guest"):
    them = {"trust": "40"}
    if heart is not None:
        them["at_the_heart"] = heart
    return {
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g1"]},
        "speaker": {"kind": kind, "id": "g1", "name": "Ada", "faction": None},
        "text": "hello",
        "history": [{"seq": 1, "mine": False, "from": "Ada", "text": "hello"}],
        "self": {"vars": {"truth": "35"}, "ranges": {}, "codex": []},
        "them": {"vars": them, "codex": [], "location": "The Server Room"},
        "world": {"Night.phase": "y2k", "Night.step": str(step)},
        "powers": [],
    }


def test_situations_parse_in_file_order_with_their_names():
    p = parse_persona(PERSONA)
    assert [s.heading for s in p.situations] == ["at his heart", "them.at_the_heart == true && Night.step >= 14", "speaker.kind == 'performer'"]
    assert p.situations[0].prompt == "You are in the cold room.\nBe candid."
    assert parse_persona("---\ncharacter: X\n---\nBody.").situations == ()


@pytest.mark.parametrize(
    "block, match",
    [
        ("situations: {when: a, prompt: b}", "list"),
        ("situations:\n  - just text", "mapping"),
        ("situations:\n  - {when: a == 1, prompt: b, colour: red}", "unknown key"),
        ("situations:\n  - {prompt: b}", "when"),
        ("situations:\n  - {when: '&& &&', prompt: b}", "when"),
        ("situations:\n  - {when: a == 1}", "prompt"),
        ("situations:\n  - {when: a == 1, prompt: '  '}", "prompt"),
        ("situations:\n  - {when: a == 1, prompt: b, name: [x]}", "name"),
        ("situation:\n  - {when: a == 1, prompt: b}", "unknown frontmatter"),
    ],
)
def test_bad_situations_are_config_errors(block, match):
    with pytest.raises(ConfigError, match=match):
        parse_persona(f"---\ncharacter: X\n{block}\n---\nBody.")


def test_a_situation_holds_only_while_its_gate_does():
    p = parse_persona(PERSONA)
    assert [s.prompt for s in matching_situations(p, request(heart="true"))] == ["You are in the cold room.\nBe candid.", "The hour is late."]
    assert [s.prompt for s in matching_situations(p, request(heart="true", step=13))] == ["You are in the cold room.\nBe candid."]
    assert matching_situations(p, request(heart="false")) == []
    assert matching_situations(p, request()) == []  # the variable is missing: null, never true
    assert [s.prompt for s in matching_situations(p, request(kind="performer"))] == ["STAFF ONLY."]


def test_a_matching_situation_is_its_own_labelled_block_at_the_end_of_the_voice_prompt():
    p = parse_persona(PERSONA)
    system = build_messages(p, request(heart="true"))[0]["content"]
    assert "=== SITUATION: AT HIS HEART (true right now" in system
    assert system.index("You are TRABOLTA.") < system.index("=== LIVE STATE") < system.index("=== SITUATION: AT HIS HEART")
    assert system.rstrip().endswith("The hour is late.")
    assert "STAFF ONLY." not in system
    closed = build_messages(p, request(heart="false"))[0]["content"]
    assert "SITUATION" not in closed and "cold room" not in closed


def test_the_orchestrator_reflects_with_the_speakers_situations():
    p = parse_persona(PERSONA)
    user = reflect_messages(p, Mind("Trabolta", "e"), request(heart="true", step=13), Reply(say="x"), None, 20, "t")[1]["content"]
    assert "=== THE SITUATION WITH Ada (at his heart;" in user and "You are in the cold room." in user
    assert "The hour is late." not in user
    assert user.index("THE SITUATION WITH Ada") < user.index("=== THE EXCHANGE JUST NOW")
    plain = reflect_messages(p, Mind("Trabolta", "e"), request(heart="false"), Reply(say="x"), None, 20, "t")[1]["content"]
    assert "SITUATION" not in plain and "cold room" not in plain


def test_the_check_estimate_counts_every_situation():
    with_them = parse_persona(PERSONA)
    without = parse_persona(PERSONA.split("situations:")[0] + "---\nYou are TRABOLTA.\n")
    extra = sum(len(s.prompt) for s in with_them.situations) // 3
    assert reflect_tokens_needed(with_them, 0) >= reflect_tokens_needed(without, 0) + extra
