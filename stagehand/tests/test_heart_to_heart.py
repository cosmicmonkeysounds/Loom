"""Wave 20 §7: the heart to heart, on the worker's side.

- D27: the server's `dossier` (the guest's night, at his heart only) is a
  WHO THIS IS — TONIGHT block in both layouts (classic + lean P3); with no
  dossier the prompt is byte-identical to before;
- situation keys `max_sentences` (a longer line is cut) and `acts: none`
  (every act dropped), in the prompt and in the guards of both voices;
- D29(a): the persona's `outside:` words — never in his line (swapped for
  the fallback like a `secrets.never` hit), his acts or his memo, and the
  prompt tells him they are not from his world.
"""

from __future__ import annotations

import json
from dataclasses import replace

import pytest

from stagehand.agents.guards import cap_sentences, guard_pass, mentions_outside, outside_guard, situation_guard, situation_rules
from stagehand.agents.module import answer
from stagehand.agents.persona import parse_persona
from stagehand.agents.prompt import build_messages, dossier_block, gate_context, outside_block
from stagehand.agents.reply import Reply
from stagehand.agents.voice import answer_lean, build_lean_messages
from stagehand.agents.cards import PersonCard, Said
from stagehand.module import ConfigError

from test_voice_lean import MODEL, Model, context, persona as lean_persona, request, run, say

HEART = """---
character: Trabolta
variables: truth
them: at_the_heart, heart_chat
fallback: The line is cold.
outside: John, Steph, Jesse, party, actor, Loom, Arduino, Zigbee, Steph's laptop
situations:
  - name: at your heart
    when: them.at_the_heart == true
    prompt: Point them back at the screen.
    max_sentences: 1
  - name: heart to heart
    when: them.at_the_heart == true && them.heart_chat == true
    prompt: Talk with them. You are in Halifax.
    max_sentences: 4
    acts: none
---
You are TRABOLTA."""

DOSSIER = {
    "name": "Calculator",
    "program": "Calculator",
    "storyMinutes": 95,
    "faction": "Truthers",
    "groups": ["crew:7"],
    "marked": True,
    "reinstalled": 1,
    "trust": {"score": 12, "rank": 3, "of": 20},
    "truths": {"accepted": 2, "lies": 1, "uncertain": 1},
    "filings": [{"question": "H1", "verdict": "accurate"}, {"question": "H3", "verdict": "pending"}],
    "codex": ["The Orchard", "Who You Know"],
    "quests": [{"title": "Orientation", "status": "done"}],
    "rooms": ["The Optical Drive", "The Desktop", "The Server Room"],
    "bingo": True,
    "bottle": {"picked": True, "choice": "dare"},
    "wallet": {"balance": 140},
    "gifts": ["The Orchard"],
    "heart": {"layer": 2, "suspicion": 30, "heard": False, "barred": False, "visits": 2},
    "said": ["Are you lonely down here?", "What is the Unified Field Theory for?"],
    "moments": ["joined", "marked", "reinstalled", "filed H3"],
}


def heart_req(heart="true", chat="true", dossier=DOSSIER, **over):
    req = request(**over)
    req["them"] = {**req["them"], "vars": {**req["them"]["vars"], "at_the_heart": heart, "heart_chat": chat}}
    if dossier is not None:
        req["dossier"] = dossier
    return req


def test_the_persona_parses_outside_and_the_situation_keys():
    p = parse_persona(HEART)
    assert p.outside == ("John", "Steph", "Jesse", "party", "actor", "Loom", "Arduino", "Zigbee", "Steph's laptop")
    assert [(s.max_sentences, s.no_acts) for s in p.situations] == [(1, False), (4, True)]
    plain = parse_persona("---\ncharacter: X\nsituations:\n  - {when: a == 1, prompt: b}\n---\nBody.")
    assert plain.outside == () and (plain.situations[0].max_sentences, plain.situations[0].no_acts) == (None, False)


@pytest.mark.parametrize(
    "block, match",
    [
        ("situations:\n  - {when: a == 1, prompt: b, max_sentences: 0}", "max_sentences"),
        ("situations:\n  - {when: a == 1, prompt: b, max_sentences: two}", "max_sentences"),
        ("situations:\n  - {when: a == 1, prompt: b, acts: some}", "acts"),
        ("outside: {a: b}", "outside"),
    ],
)
def test_bad_wave_20_keys_are_config_errors(block, match):
    with pytest.raises(ConfigError, match=match):
        parse_persona(f"---\ncharacter: X\n{block}\n---\nBody.")


# -- D27: the dossier block ---------------------------------------------------------


def test_the_dossier_block_says_who_they_are_tonight():
    block = dossier_block(DOSSIER)
    assert block.startswith("=== WHO THIS IS — TONIGHT")
    for bit in (
        "Name: Calculator · here 95 minutes",
        "faction Truthers",
        "marked for the Internet, reinstalled 1×, won at Bingo",
        "Your Trust Chart: 12 (rank 3 of 20)",
        "2 filed sure, 1 guesses, 1 published as lies",
        "H1 accurate, H3 not judged yet",
        "they chose dare",
        "140 Truthcoin",
        "Files they gave you: The Orchard",
        "The Optical Drive; The Desktop; The Server Room",
        "Orientation (done)",
        "At your heart: they told you who they are and heard what you are, you are wary of them, visit 2",
        "- “Are you lonely down here?”",
        "Their night: joined · marked · reinstalled · filed H3",
    ):
        assert bit in block, bit
    assert dossier_block(None) is None and dossier_block({}) is None
    # A bare dossier (only the required fields) still reads.
    assert dossier_block({"name": "Ada", "storyMinutes": 3}).splitlines()[1] == "Name: Ada · here 3 minutes"


def test_the_dossier_never_says_layer_or_counts_the_talk():
    """Wave 29: he once said "layer three" at his heart. How far they got reaches him only in words."""
    import re

    for layer in range(0, 6):
        for suspicion in (0, 10, 30, 70):
            block = dossier_block({**DOSSIER, "heart": {"layer": layer, "suspicion": suspicion, "heard": False, "barred": False, "visits": 1}})
            assert not re.search(r"\blayers?\b|\blevel\b|\bsuspicion\b|\b\d\s*/\s*4\b|out of character", block, re.I), block
    zero = dossier_block({**DOSSIER, "heart": {"layer": 0, "suspicion": 0}})
    assert "At your heart" not in zero


def test_the_classic_prompt_carries_the_dossier_and_is_unchanged_without_one():
    p = parse_persona(HEART.replace("outside: John, Steph, Jesse, party, actor, Loom, Arduino, Zigbee, Steph's laptop\n", ""))
    with_it = build_messages(p, heart_req())
    without = build_messages(p, heart_req(dossier=None))
    assert "WHO THIS IS — TONIGHT" in with_it[0]["content"] and "WHO THIS IS" not in without[0]["content"]
    # The dossier sits after the live state, before the situations.
    sys = with_it[0]["content"]
    assert sys.index("=== LIVE STATE") < sys.index("WHO THIS IS") < sys.index("=== SITUATION")
    # Absent and null read the same: the prompt is what it always was.
    nulled = heart_req(dossier=None)
    nulled["dossier"] = None
    assert build_messages(p, nulled) == without
    assert with_it[1:] == without[1:]


def test_the_lean_p3_carries_the_dossier_and_p1_stays_put():
    p = lean_persona()
    with_it = build_lean_messages(p, heart_req(), context())
    without = build_lean_messages(p, heart_req(dossier=None), context())
    assert "WHO THIS IS — TONIGHT" in with_it[2]["content"] and "WHO THIS IS" not in without[2]["content"]
    assert with_it[0] == without[0] and with_it[1] == without[1]  # the cached head never moves
    assert with_it[3:] == without[3:]
    assert with_it[2]["content"].replace("\n\n" + dossier_block(DOSSIER), "") == without[2]["content"]


def test_a_persona_with_no_outside_and_no_new_keys_builds_the_same_prompt():
    """The wave 20 keys add text only when set: a persona without them (every
    persona before this wave) and a request without a dossier build exactly
    the prompt they built before (the classic snapshot tests pin the bytes)."""
    p = lean_persona()
    assert outside_block(p) is None
    msgs = build_lean_messages(p, request(), context())
    assert "NOT FROM YOUR WORLD" not in msgs[0]["content"] and "Here you may answer at length" not in msgs[2]["content"]


def test_the_situation_rules_reach_the_prompt():
    p = parse_persona(HEART)
    sys = build_messages(p, heart_req())[0]["content"]
    assert "Here you may answer at length: up to 4 sentences." in sys
    assert "Here you decide nothing: no act, no share, no power. Just talk." in sys
    assert "Here you may answer at length: up to 1 sentences." in sys  # the plain heart block's own cap
    assert sys.index("=== NOT FROM YOUR WORLD") < sys.index("=== LIVE STATE")
    lean = build_lean_messages(replace(lean_persona(), outside=p.outside), heart_req(), context())
    assert "=== NOT FROM YOUR WORLD" in lean[0]["content"]
    # The guard's words never reach the prompt (they would tell him the outside).
    for word in p.outside:
        assert word not in sys and word not in lean[0]["content"], word


# -- the guards ---------------------------------------------------------------------


def test_max_sentences_takes_the_last_holding_situation_and_acts_none_drops_acts():
    p = parse_persona(HEART)
    assert situation_rules(p, gate_context(heart_req())) == (4, True)
    assert situation_rules(p, gate_context(heart_req(chat="false"))) == (1, False)
    assert situation_rules(p, gate_context(heart_req(heart="false"))) == (None, False)
    long = "One. Two? Three! Four. Five. Six."
    act = {"kind": "fire", "name": "stand_down", "args": {}}
    got, notes = situation_guard(p, Reply(say=long, acts=(act,)), gate_context(heart_req()))
    assert got.say == "One. Two? Three! Four." and got.acts == ()
    assert notes == ["acts: none (1 dropped)", "cut to 4 sentences"]
    got, _ = situation_guard(p, Reply(say=long, acts=(act,)), gate_context(heart_req(chat="false")))
    assert got.say == "One." and got.acts == (act,)
    assert cap_sentences("Just one", 2) == "Just one"


@pytest.mark.parametrize(
    "line",
    ["John says hello.", "Ask STEPH.", "This party is a show of yours.", "You are all actors.", "Steph’s laptop hums.", "It runs on an arduino", "zigbee bulbs"],
)
def test_an_outside_word_in_his_line_is_the_fallback(line):
    p = parse_persona(HEART)
    assert mentions_outside(p, line)
    got, notes = outside_guard(p, Reply(say=line))
    assert got.say == "The line is cold." and notes == ["outside (line withheld)"]


@pytest.mark.parametrize("line", ["Johnny Mnemonic is a film.", "Halifax is cold tonight.", "Partying is not for me.", "Heirlooms rot."])
def test_words_that_only_look_outside_pass(line):
    """Whole words only (a plural too): a common `outside:` word still trips
    in any sense (`the loom of fate`), so the list should hold names."""
    p = parse_persona(HEART)
    assert not mentions_outside(p, line)
    assert outside_guard(p, Reply(say=line)) == (Reply(say=line), [])


def test_an_outside_word_drops_its_act_and_its_memo():
    p = parse_persona(HEART)
    share = {"kind": "share", "entry": "Steph's notes"}
    keep = {"kind": "share", "entry": "The Orchard"}
    got, notes = outside_guard(p, Reply(say="Take it.", acts=(share, keep), memo="Reminds me of John."))
    assert got.say == "Take it." and got.acts == (keep,) and got.memo == ""
    assert notes == ["outside (act dropped)", "outside (memo dropped)"]
    # No `outside:` at all: nothing to check.
    plain = parse_persona("---\ncharacter: X\n---\nBody.")
    assert outside_guard(plain, Reply(say="John.")) == (Reply(say="John."), [])


def test_guard_pass_withholds_an_outside_line_and_never_retries_it():
    p = replace(lean_persona(), outside=("John",), fallback="...static...")
    out = guard_pass(p, Reply(say="John sends his love."), PersonCard(id="g-1", name="Ada"), Said(), (), gate=gate_context(request()))
    assert out.reply.say == "...static..." and out.withheld and out.retry is None
    assert "outside (line withheld)" in out.notes


def test_the_lean_voice_applies_acts_none_and_the_sentence_cap():
    p = replace(lean_persona(), situations=parse_persona(HEART).situations, outside=parse_persona(HEART).outside)
    model = Model(say("You came back. The cold keeps me honest. Sandy would have liked you. I solved most of it. Not the part that matters.", act={"fire": "snoop", "args": {"target": "g-2"}}))
    reply = run(answer_lean(p, MODEL, heart_req(), context(), model))
    assert reply.acts == ()
    assert reply.say == "You came back. The cold keeps me honest. Sandy would have liked you. I solved most of it."


def test_the_lean_voice_swaps_an_outside_line():
    p = replace(lean_persona(), outside=("Steph's laptop",))
    model = Model(say("I live on Steph's laptop."))
    reply = run(answer_lean(p, MODEL, heart_req(), context(), model))
    assert "laptop" not in reply.say


def test_the_classic_voice_applies_the_same_guards():
    p = parse_persona(HEART)

    async def fake(messages, cfg):
        from stagehand.agents.llm import Completion

        return Completion(content=json.dumps({"say": "Steph built me. That is all.", "adjust": {"truth": 1}}), ms=3)

    reply = run(answer(p, MODEL, heart_req(), complete_fn=fake, gate=False))
    assert reply.say == "The line is cold."

    async def long(messages, cfg):
        from stagehand.agents.llm import Completion

        return Completion(content=json.dumps({"say": "One. Two. Three. Four. Five.", "act": {"share": "The Orchard"}}), ms=3)

    req = heart_req()
    req["self"]["codex"] = [{"id": "c3", "title": "The Orchard", "about": None, "text": "Apples."}]
    req["powers"] = [{"id": "snoop", "label": "Snoop", "description": "x", "limit": None, "used": 0}]
    reply = run(answer(p, MODEL, req, complete_fn=long, gate=False))
    assert reply.say == "One. Two. Three. Four." and reply.acts == ()


# -- the outside: list against his own in-world text (review) ---------------------

from pathlib import Path

SHIPPED = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet/trabolta.persona.md"
#: D29's draft list, bare words: `party` is in *the party favour* and his
#: system prompt, `show` in *it shows* — every such line would be withheld.
D29_BARE = ["John", "Steph", "Jesse", "party", "show", "actor", "performer", "rehearsal", "Loom", "stagehand", "Steph's laptop", "Arduino", "Zigbee"]
#: The same list as phrases: what the story lane should write.
D29_PHRASES = ["John", "Steph", "Jesse", "the show", "this show", "a party", "real world", "actor", "performer", "rehearsal", "Loom", "stagehand", "Steph's laptop", "Arduino", "Zigbee"]


def _shipped_with(outside: list[str]):
    text = SHIPPED.read_text(encoding="utf-8")
    if "\noutside:" in text.split("\n---", 1)[0]:
        pytest.skip("the shipped persona carries its own outside: list (the story lane) — checked below")
    text = text.replace("---\n", "---\noutside: " + json.dumps(outside) + "\n", 1)
    return parse_persona(text, str(SHIPPED))


def _outside_warnings(p):
    return [w for w in p.warnings if ": outside: " in w]


def test_a_bare_word_his_own_text_uses_is_warned():
    warned = _outside_warnings(_shipped_with(D29_BARE))
    assert any("'party'" in w for w in warned) and any("'shows'" in w for w in warned), warned


def test_the_d29_list_as_phrases_never_hits_his_own_text():
    assert _outside_warnings(_shipped_with(D29_PHRASES)) == []


def test_the_shipped_outside_list_never_hits_his_own_text():
    p = parse_persona(SHIPPED.read_text(encoding="utf-8"), str(SHIPPED))
    assert _outside_warnings(p) == [], _outside_warnings(p)


def test_a_fallback_that_names_an_outside_word_is_never_said():
    p = parse_persona(HEART.replace("fallback: The line is cold.", "fallback: Ask John."))
    assert any("fallback:" in w and "'john'" in w for w in p.warnings), p.warnings
    got, notes = outside_guard(p, Reply(say="Steph says hi."))
    assert got.say == "" and notes == ["outside (line withheld)"]


def test_the_fallbacks_catchphrases_and_cards_are_checked():
    text = HEART.replace("fallback: The line is cold.\n", "fallback: The line is cold.\ncatchphrases: [\"Welcome to the party.\"]\n")
    assert any("catchphrases:" in w for w in parse_persona(text).warnings)


def test_the_voice_withholds_any_layer_count_or_ooc():
    """Wave 29: the persona's `outside:` list withholds a layer count in words, digits or ordinals, and OOC."""
    from pathlib import Path

    from stagehand.agents.guards import outside_hit
    from stagehand.agents.persona import load_persona

    persona = load_persona(Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet/trabolta.persona.md")
    for line in ("Layer 3 of 4.", "This is the third layer.", "The final layer, program.", "Speaking OOC here.", "You reached layer three.", "Out of character: hi."):
        assert outside_hit(persona.outside, line), line
    for line in ("You came back to my heart.", "The cables hold.", "Tell me who you are."):
        assert outside_hit(persona.outside, line) is None, line
