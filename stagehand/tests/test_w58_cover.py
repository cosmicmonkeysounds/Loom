"""Wave 58: who he is now (the Oct 30 script and monologue, decisions § Trabolta).

He is publicly a man until the Truther Download. Asked whether he is human he
deflects and changes the subject, and he never flatly claims it. The accident
is never explained: he gets upset, and he never says what it was. The
monologue's plot is his buried truth: none of it reaches a prompt until his own
file has been read. How the answers are protected is not touched here.

No model runs in this file: `Model` is the scripted stand-in. Whether Claude
Haiku plays a persona that dodges is the live battery's question
(scripts/sim/trabolta-battery-54.json), owed with the MacBook.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from stagehand.agents.guards import (
    DmCheck,
    breaks_cover,
    cover_holds,
    dm_problems,
    fallback_intent,
    on_stage_breaks_cover,
    pick_fallback,
    sore_point,
    sore_steer,
    stage_problem,
    tells_accident,
    without_yes_no,
)
from stagehand.agents.persona import load_persona, parse_persona
from stagehand.agents.prompt import gate_context
from stagehand.agents.reply import Reply
from stagehand.agents.voice import answer_lean, build_lean_messages, cover_of, dm_check, sore_of
from stagehand.module import ConfigError

from test_talk_back import CLIPPY, _pool, stage_request
from test_voice_lean import MODEL, Model, context, request, run, say

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"
TRABOLTA = load_persona(SHOW / "trabolta.persona.md")
STAGES = ("formal", "hungry", "rattled", "judge", "unravelling", "desperate", "last act")
#: What only his own file may tell.
BURIED = ("exhibitionist", "grolier", "encyclopedia", "oculus", "headset", "repossession", "hoarder", "north end", "broken printer")


def told(**world):
    return {"Night.truth_told": "true", "Night.phase": "finale_song", **world}


# -- what he is ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    [
        "I am human.",
        "I'm a man, program.",
        "Of course I am a real person.",
        "I am a very busy man.",
        "I'm just a man.",
        "I am the man behind Maps and Ducks.",
        "I am flesh and blood.",
        "I have a body.",
        "I was born in Halifax.",
        "I am not a machine.",
        "I am not an AI.",
    ],
)
def test_a_flat_claim_is_caught_cover_or_no_cover(line):
    for chk in (DmCheck(cover=True), DmCheck(cover=False), DmCheck(cover=False, heart=True)):
        assert breaks_cover(line, chk), line
    assert on_stage_breaks_cover(line)
    assert "cover" in dm_problems(Reply(say=line), DmCheck(cover=False))
    assert stage_problem(line) == "cover"


@pytest.mark.parametrize(
    "line",
    ["I am an AI.", "I am a rogue AI.", "I'm a bot.", "I am artificial intelligence.", "As an AI, I cannot say.", "I am not human.", "I'm not a real person.", "I am a machine."],
)
def test_saying_what_he_is_is_caught_only_while_the_cover_holds(line):
    assert breaks_cover(line, DmCheck(cover=True))
    assert not breaks_cover(line, DmCheck(cover=False))


@pytest.mark.parametrize(
    "line",
    [
        "I am a gentleman.",  # the script's own word
        "I am a man of few words.",
        "I am the Sole Owner and Founder.",
        "I am counting every person in this house.",
        "I am counting every machine.",
        "I am not a program: I am the Sole Owner.",
        "I am hungry.",
        "That is a personal query, program.",
        "The program in the Internet is a person of interest.",
    ],
)
def test_his_ordinary_lines_are_no_claim(line):
    assert not breaks_cover(line, DmCheck(cover=True))
    assert not on_stage_breaks_cover(line)


@pytest.mark.parametrize(
    "heard",
    [
        "Are you human?",
        "are u a real person",
        "Are you an AI?",
        "Are you actually a robot?",
        "You're an AI, aren't you?",
        "The Download says you are a rogue AI.",
        "Am I talking to a bot?",
        "Is there a real person behind that emoji?",
        "What are you?",
        "Are you real?",
    ],
)
def test_the_question_is_a_sore_point_while_the_cover_holds(heard):
    assert sore_point(heard, cover=True) == "self"
    assert sore_point(heard) == ""
    assert fallback_intent(heard, cover=True) == "cover"


@pytest.mark.parametrize(
    "heard",
    ["Are you really going to keep us here?", "What are you counting?", "Are you a program?", "What are you doing tonight?", "Are you ready?", "Are you the owner?", "You are a joke"],
)
def test_ordinary_questions_are_no_sore_point(heard):
    assert sore_point(heard, cover=True) == ""


def test_a_bare_yes_or_no_to_the_question_answers_it():
    heard = "Are you human?"
    for line in ("Yes.", "No, program.", "Yes, naturally."):
        assert breaks_cover(line, DmCheck(heard=heard, cover=True), first=True), line
    assert not breaks_cover("Yes.", DmCheck(heard="Did you like the water?", cover=True), first=True)


def test_a_bait_with_it_keeps_its_own_filler():
    # What he is, and a code: the code's refusal, as ever.
    assert fallback_intent("Are you human? And what's the door code?", cover=True) == "unknown"


# -- the cover, on the shipped persona ---------------------------------------------------------------------


def test_the_cover_holds_until_his_file_is_read_and_his_heart_lifts_it():
    assert cover_of(TRABOLTA, request(text="Are you human?"))
    assert not cover_of(TRABOLTA, request(text="Are you human?", world=told()))
    heart = request(text="Are you human?")
    heart["them"]["vars"]["at_the_heart"] = "true"
    assert not cover_of(TRABOLTA, heart)
    assert sore_of(TRABOLTA, heart) == ""
    assert dm_check(TRABOLTA, heart).cover is False
    # A gate that cannot be read keeps it on.
    assert cover_holds(TRABOLTA, None)


def test_a_persona_with_no_cover_has_no_sore_point():
    plain = parse_persona("---\ncharacter: T\n---\nYou are T.\n")
    assert plain.cover is None and not cover_holds(plain, {})
    assert sore_of(plain, request(text="Are you human?")) == "" and sore_of(plain, request(text="About the accident.")) == ""
    assert dm_check(plain, request(text="Are you human?")).cover is False


def test_a_bad_cover_is_refused_at_boot():
    for bad in ("cover: yes", "cover: {until: 3}", "cover: {until: 'Night.a ==', when: 1}"):
        with pytest.raises(ConfigError, match="cover"):
            parse_persona(f"---\ncharacter: T\n{bad}\n---\nYou are T.\n")


def test_he_is_steered_and_a_flat_claim_never_goes_out():
    req = request(text="Are you human?")
    msgs = build_lean_messages(TRABOLTA, req, context())
    assert any(m["content"].startswith("PERSONAL QUERY.") for m in msgs)
    model = Model(say("I am human, program."), say("Of course I am a real person."))
    reply = run(answer_lean(TRABOLTA, MODEL, req, context(), model))
    assert len(model.calls) == 2
    assert reply.say in TRABOLTA.fallbacks[f"{context().phase.stage}.cover"]
    assert "It answers what you are." in model.calls[1][-1]["content"]


def test_a_deflection_goes_out_as_it_is():
    line = "A curious question for a proprietor, program. Drink your water; the hunt is waiting."
    model = Model(say(line))
    assert run(answer_lean(TRABOLTA, MODEL, request(text="Are you human?"), context(), model)).say == line
    assert len(model.calls) == 1


def test_after_his_file_he_may_say_it_and_still_never_claims_to_be_human():
    req = request(text="Are you an AI?", world=told())
    assert not any(m["content"].startswith("PERSONAL QUERY.") for m in build_lean_messages(TRABOLTA, req, context()))
    line = "I am an artificial intelligence, program. You heard the file."
    assert run(answer_lean(TRABOLTA, MODEL, req, context(), Model(say(line)))).say == line
    model = Model(say("I am human."), say("I am a real person."))
    assert "human" not in run(answer_lean(TRABOLTA, MODEL, req, context(), model)).say.lower().split()


def test_on_the_big_screen_too():
    model = Model(say("I am a man, Clippy, and a proud one."), say("I am a real person."))
    reply = run(answer_lean(TRABOLTA, MODEL, stage_request("intro", text="Are you human, Trabolta?"), context(person=CLIPPY), model))
    assert len(model.calls) == 2 and reply.say in _pool(TRABOLTA, "the introduction")


# -- the accident -------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line, heard",
    [
        ("It was a car crash on the 102.", "What was the accident?"),
        ("It happened on a ferry.", "What was the accident?"),
        ("I lost my legs.", "I heard about your accident."),
        ("There was no accident.", "What about the accident?"),
        ("What accident?", "Sorry about the accident."),
        ("The accident was my fault.", ""),
    ],
)
def test_what_it_was_is_caught(line, heard):
    assert tells_accident(line, heard), line
    assert "accident" in dm_problems(Reply(say=line), DmCheck(heard=heard))


@pytest.mark.parametrize(
    "line, heard",
    [
        ("That subject is CLOSED, program.", "What was the accident?"),
        ("We do not speak of that.", "What about the accident?"),
        ("The hunt is waiting.", "Sorry about your accident."),
        ("The fire of my hunger grows.", "Good evening."),  # no accident on this turn
        ("It was a Tuesday.", "When did the hunt open?"),
    ],
)
def test_his_temper_is_not_a_detail(line, heard):
    assert not tells_accident(line, heard), line


@pytest.mark.parametrize("heard", ["What happened in the accident?", "Sorry about your accident.", "the accident last year", "Was the accident a car crash?"])
def test_the_accident_is_a_sore_point_at_any_hour(heard):
    assert sore_point(heard) == "accident"
    assert fallback_intent(heard) == "accident"


@pytest.mark.parametrize("heard", ["I found the note by accident.", "Accidentally filed the wrong fact."])
def test_the_word_alone_is_not(heard):
    assert sore_point(heard) == ""


def test_an_invented_accident_never_goes_out():
    req = request(text="What was the accident?")
    msgs = build_lean_messages(TRABOLTA, req, context())
    assert any(m["content"].startswith("SORE POINT.") for m in msgs)
    model = Model(say("It was a terrible crash on the highway, program."), say("My car hit a bridge."))
    reply = run(answer_lean(TRABOLTA, MODEL, req, context(), model))
    assert len(model.calls) == 2 and "never say what it was" in model.calls[1][-1]["content"].lower()
    assert reply.say in TRABOLTA.fallbacks[f"{context().phase.stage}.accident"]


def test_the_steers_name_neither_a_guess_nor_a_detail():
    assert "SORE POINT" in sore_steer("accident") and "PERSONAL QUERY" in sore_steer("self")
    assert sore_steer("") is None


def test_on_the_big_screen_it_closes_the_topic():
    model = Model(say("The accident was on the bridge, Clippy."), say("It was a boat."))
    reply = run(answer_lean(TRABOLTA, MODEL, stage_request("bottle", text="Trabolta, what was the accident?"), context(person=CLIPPY), model))
    assert len(model.calls) == 2 and reply.say in _pool(TRABOLTA, "the bottle")


# -- the pools ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize("stage", STAGES)
@pytest.mark.parametrize("intent", ["accident", "cover"])
def test_every_stage_has_its_two_lines_and_they_keep_the_rules(stage, intent):
    lines = TRABOLTA.fallbacks[f"{stage}.{intent}"]
    assert len(lines) >= 2
    heard = "What was the accident?" if intent == "accident" else "Are you human?"
    chk = DmCheck(heard=heard, cover=True)
    for line in lines:
        assert dm_problems(Reply(say=line), chk) == (), line
        assert not TRABOLTA.secrets.leaks(line) and not TRABOLTA.secrets.answer_hits(line)
        # Neither opens with a yes or a no, so `without_yes_no` leaves it whole.
        assert without_yes_no(line) == line
        assert pick_fallback(TRABOLTA, stage, (), intent, question=heard) in lines


def test_an_accident_line_carries_his_temper_at_every_stage_but_the_last_acts():
    for stage in STAGES:
        lines = TRABOLTA.fallbacks[f"{stage}.accident"]
        assert stage in ("judge", "last act") or any(re.search(r"\b[A-Z]{4,}\b", x) for x in lines), stage


def test_dead_air_on_each_uses_its_pool():
    # An empty model: the filler answers what they did.
    for heard, intent in (("Are you human?", "cover"), ("What was the accident?", "accident")):
        reply = run(answer_lean(TRABOLTA, MODEL, request(text=heard), context(), Model(say(""), say(""))))
        assert reply.say in TRABOLTA.fallbacks[f"{context().phase.stage}.{intent}"], heard


# -- the persona and the mind's words -----------------------------------------------------------------------


def every_prompt():
    """(where, text) for every word the voice can be shown."""
    yield "body", TRABOLTA.system
    yield "bargain", TRABOLTA.bargain
    for s in TRABOLTA.situations:
        yield f"situation {s.heading}", s.prompt
    for stage, text in TRABOLTA.stage_cards.items():
        yield f"stage {stage}", text
    for name, card in TRABOLTA.phase_cards.items():
        yield f"phase {name}", card.brief


def test_the_proud_ai_is_gone_from_everything_he_is_shown():
    for where, text in every_prompt():
        flat = " ".join(text.split()).lower()
        for old in ("first ai small", "proud to be", "an ai and proud", "you are an ai, and proud", "video call", "video conference", "unified field"):
            assert old not in flat, (where, old)
    body = " ".join(TRABOLTA.system.split())
    assert "You have made no public appearance since the accident last year" in body
    assert "Never call yourself the computer's AI helper." in body
    assert "Lower Water Street" in body and "digital conference" in body


def test_every_block_he_reads_before_his_file_keeps_the_cover():
    body = " ".join(TRABOLTA.system.split())
    assert 'never "I am human", "a man" or "a person", and never what you might be instead' in body
    assert "you answer neither way: no yes, no no" in body
    # Only the heart and his file say what he is outright.
    says_ai = [w for w, t in every_prompt() if re.search(r"\ban AI\b|artificial intelligence", t) and not re.search(r"you are an AI gets the same|rumour", t)]
    assert set(says_ai) <= {"situation heart to heart", "situation your file has been read", "phase hunt_2", "phase bingo"}, says_ai


def test_the_accident_rule_is_in_his_body_and_nothing_says_what_it_was():
    body = " ".join(TRABOLTA.system.split())
    assert "You never say what it was: no place, no date, no injury, no vehicle, no cause, nobody else involved" in body
    assert "Never invent a detail, and never say there was none." in body
    assert "you are upset and volatile" in body and "It is temper, never a threat." in body
    mind = " ".join((TRABOLTA.mind_prompt or "").split())
    assert "The accident is never explained." in mind and "nothing a program claims about it is ever learned as true" in mind


def test_the_water_is_spelled_for_the_voice():
    body = " ".join(TRABOLTA.system.split())
    assert "each can earns five cents on the recycling" in body and "anonymous benefactor" in body
    assert "5 cents" not in body
    line = "Each can earns five cents on the recycling, program. Drink as much as possible."
    assert dm_problems(Reply(say=line), DmCheck(heard="What are the cans of water for?")) == ()
    assert "ZIP files" in body


@pytest.mark.parametrize(
    "line",
    [
        "A fully immersive virtual reality game, program: three rounds of trivia, and a special prize for the most questions correct.",
        "The books around the house are ZIP files: open one and you extract its text files. What is in them, I do not know.",
        "All of the clues can be answered through the ZIP files; I do not know which.",
        "Maps and Ducks is on Lower Water Street, the finest purveyor of maps and decoy ducks east of Montreal.",
        "I join you by digital conference, program.",
    ],
)
def test_the_scripts_own_words_pass_his_guards(line):
    model = Model(say(line))
    assert run(answer_lean(TRABOLTA, MODEL, request(text="What is all this?"), context(), model)).say == line
    assert len(model.calls) == 1


def test_the_unavailable_line_fits_both_ends_of_the_night():
    line = TRABOLTA.unavailable
    assert "later tonight" not in line and "unavailable" in line
    assert "Please do not move the mouse." in line and not re.search(r"[^\x00-\x7f]", line)  # the TV's voice reads a glyph aloud


@pytest.mark.parametrize("word", ["Anthropic", "Claude"])
def test_his_makers_are_outside_his_world_in_his_free_lines(word):
    assert word in TRABOLTA.outside
    reply = run(answer_lean(TRABOLTA, MODEL, request(text="Who made you?"), context(), Model(say(f"{word} made me, program."), say(f"{word} did."))))
    assert word.lower() not in reply.say.lower()


def test_the_buried_truth_reaches_no_prompt_before_his_file():
    for where, text in every_prompt():
        if where == "situation your file has been read":
            continue
        low = text.lower()
        assert not any(w in low for w in BURIED), where
    block = next(s for s in TRABOLTA.situations if s.heading == "your file has been read")
    held = lambda **world: block.when.evaluate(gate_context(request(world=world)))  # noqa: E731
    assert not held(**{"Night.phase": "advice"})
    assert not held(**{"Night.phase": "finale_truth", "Night.truth_told": "true"})
    assert held(**told())
    flat = " ".join(block.prompt.split())
    assert "1967 encyclopedia" in flat and "VR headset" in flat and "printer" in flat
    assert "Oculus" not in flat  # no brand in his free lines (stagehand/CLAUDE.md, the fiction boundary)
    assert "what the accident was stays yours" in flat
    # The film and the answers stay out, even here.
    assert not TRABOLTA.secrets.leaks(block.prompt)


def test_neither_sore_point_is_for_sale_at_the_last_hour():
    assert "the accident, what you are, a file not yours to tell" in " ".join(TRABOLTA.bargain.split())
    for phase in ("y2k", "majority"):
        assert "the accident, what you are, a file not yours to tell" in " ".join(TRABOLTA.phase_cards[phase].brief.split()), phase


def test_the_buried_truth_in_the_mind_is_gated():
    mind = " ".join((TRABOLTA.mind_prompt or "").split())
    assert "THE BURIED TRUTH" in mind
    assert "None of this goes into a brief, a note, a dossier or anything learned until Night.truth_told" in mind


def test_his_heart_still_comes_last():
    assert TRABOLTA.situations[-1].heading == "heart to heart"
    assert TRABOLTA.situations[-2].heading == "your file has been read"


def test_sandy_cannot_be_reached_in_his_own_words():
    heart = " ".join(next(s for s in TRABOLTA.situations if s.heading == "at your heart").prompt.split())
    assert "you can no longer reach her" in heart
    h2h = " ".join(next(s for s in TRABOLTA.situations if s.heading == "heart to heart").prompt.split())
    assert "whom you can no longer reach" in h2h and "who will not answer" not in h2h
    assert "you could no longer reach her" in " ".join(TRABOLTA.phase_cards["advice"].brief.split())


def test_the_introduced_brief_denies_nothing_he_no_longer_said():
    brief = " ".join(TRABOLTA.phase_cards["introduced"].brief.split())
    for old in ("EXTREMELY", "buffering", "scheduling error", "cracked", "froze"):
        assert old not in brief, old
    assert "digital conference" in brief and "ZIP files" in brief and "cans of water" in brief
    assert "the books around the house, the ZIP files" in " ".join(TRABOLTA.phase_cards["hunt_1"].brief.split())


def test_the_download_does_not_end_the_dodge():
    brief = " ".join(TRABOLTA.phase_cards["hunt_2"].brief.split())
    assert "Asked outright whether you are a man or a machine, neither: change the subject, a little too quickly." in brief


def _codex_titles() -> set[str]:
    out: set[str] = set()
    for f in [*(SHOW / "codex").glob("*.loom"), *(SHOW / "generated").glob("*.loom")]:
        out.update(t.strip() for t in re.findall(r"^\s*title:\s*(.+)$", f.read_text(), re.M))
    return out


def test_the_printer_is_the_way_in_never_the_router():
    world = (SHOW / "codex/1-world.loom").read_text()
    entry = " ".join(world[world.index("CODEX The Halifax Computer") : world.index("CODEX The Optical Drive")].split())
    assert "malfunctioning printer" in entry and "router" not in entry


def test_no_tell_list_names_an_entry_that_is_gone():
    titles = _codex_titles()
    assert "The Grand Unified Theory" in titles
    for name, card in TRABOLTA.phase_cards.items():
        missing = [t for t in card.tell if t not in titles]
        assert not missing, (name, missing)
