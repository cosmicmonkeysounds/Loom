"""The shipped Trabolta persona + mind file: what each model may be told,
and when. (Mechanics live in test_agents / test_situations; this file pins
the show's own text.)"""

import json
from pathlib import Path

from stagehand.agents.persona import load_persona

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"
TRABOLTA = SHOW / "trabolta.persona.md"

#: Night.phase in running order up to (not including) the overshare, where
#: the story first names Sandy (main.loom's Night.step table, steps 0–12).
BEFORE_THE_OVERSHARE = (
    "arrivals",
    "desktop",
    "bingo",
    "bingo_results",
    "introduced",
    "hunt_1",
    "truth_1",
    "malware",
    "hunt_2",
    "summons",
    "truth_pong",
    "trust_chart",
    "beans",
)


def test_no_pre_overshare_phase_cue_nor_the_bargain_names_sandy():
    # Wave 6 decision 5: the Truther Download blacks her name out until the
    # story says it; the orchestrator's brief must not say it sooner, and
    # the bargain reaches the voice on every turn from the doors.
    p = load_persona(TRABOLTA)
    assert set(BEFORE_THE_OVERSHARE) <= set(p.phase_cues)
    named = [phase for phase in BEFORE_THE_OVERSHARE if "sandy" in p.phase_cues[phase].lower()]
    assert named == []
    assert "sandy" not in p.bargain.lower()
    # The download reaches the mind in hunt_2 (when it is sent), redacted.
    assert "download" not in p.phase_cues["malware"].lower()
    assert "blacked out" in p.phase_cues["hunt_2"]
    # The favour policy is written into every brief, and `beans` (before the
    # overshare) is already the unravelling floor: its line names nobody,
    # and neither does the overshare cue's policy (scenarios 2–4 never say her
    # name before the recount).
    policy = (p.mind_prompt or "").split("FAVOUR POLICY", 1)[1].split("\n\n", 1)[0]
    unravelling = policy.split("- unravelling:", 1)[1].split("\n- ", 1)[0]
    assert "sandy" not in unravelling.lower()
    assert "sandy" not in p.phase_cues["overshare"].split("Policy", 1)[1].lower()


# -- wave 7: at his heart (the candid "Master" talk) -------------------------

import re  # noqa: E402

from stagehand.agents.prompt import allowed_powers, build_messages, matching_situations, their_variables  # noqa: E402


def heart_request(at_the_heart=None, marked=None, **world):
    them = {"trust": "50", "featured": "excel", "marked_for": "missed the cup"}
    if at_the_heart is not None:
        them["at_the_heart"] = at_the_heart
    if marked is not None:
        them["marked"] = marked
    return {
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g1"]},
        "speaker": {"kind": "guest", "id": "g1", "name": "Excel", "faction": None},
        "text": "Is this your heart?",
        "history": [{"seq": 1, "mine": False, "from": "Excel", "text": "Is this your heart?"}],
        "self": {"vars": {"awake": "true", "truth": "40"}, "ranges": {}, "codex": []},
        "them": {"vars": them, "codex": [], "location": "The Server Room"},
        "world": {"Night.phase": "y2k", "Night.step": "14", **world},
        "powers": [{"id": "stand_down", "limit": 1, "used": 0, "description": "…"}, {"id": "snoop", "limit": None, "used": 0}],
    }


def test_the_shipped_persona_has_its_situations_and_whitelists():
    p = load_persona(TRABOLTA)
    assert [s.heading for s in p.situations] == ["at your heart", "marked at your heart", "standing down", "her name has been said", "her name is still blacked out"]
    assert "at_the_heart" in (p.them or ())
    assert {"Night.heart_opened", "Night.talked_down"} <= set(p.facts)
    assert "stand_down" in [x["id"] for x in allowed_powers(p, heart_request())]


def test_the_heart_block_appears_only_at_the_heart():
    p = load_persona(TRABOLTA)
    at = build_messages(p, heart_request("true"))[0]["content"]
    assert "=== SITUATION: AT YOUR HEART" in at and "the patch bay in this room is your heart" in at
    assert "you do not know the combinations" in at and "stand_down" in at
    for closed in (heart_request("false"), heart_request()):
        system = build_messages(p, closed)[0]["content"]
        assert "=== SITUATION" not in system and "patch bay in this room" not in system


def test_sandy_by_name_at_the_heart_only_once_the_story_has_named_her():
    # The same rule as main.loom's unredaction of the Truther Download.
    p = load_persona(TRABOLTA)
    names = lambda req: [s.heading for s in matching_situations(p, req)]  # noqa: E731
    blacked = "her name is still blacked out"
    said = "her name has been said"
    down = "standing down"
    assert names(heart_request("true", **{"Night.scenario": "2"})) == ["at your heart", down, blacked]
    assert names(heart_request("true")) == ["at your heart", down, blacked]
    assert names(heart_request("true", **{"Night.scenario": "1"})) == ["at your heart", down, said]
    # Wave 11: candid at his heart whenever he is awake (the door plays The
    # Heart at any hour); standing down only from the Y2K hour. Her name
    # still follows the story's own rule (scenario 1 from step 13).
    assert names(heart_request("true", **{"Night.scenario": "1", "Night.step": "13"})) == ["at your heart", said]
    assert names(heart_request("true", **{"Night.scenario": "1", "Night.step": "12"})) == ["at your heart", blacked]
    assert names(heart_request("true", **{"Night.phase": "hunt_1", "Night.step": "5"})) == ["at your heart", blacked]
    assert names(heart_request("false", **{"Night.step": "5"})) == []
    assert names(heart_request("true", **{"Night.scenario": "3", "Night.recount": "true"})) == ["at your heart", down, said]
    for s in p.situations:
        if s.heading != said:
            assert "sandy" not in s.prompt.lower(), s.heading


def test_the_heart_never_hands_out_a_code_or_a_combination():
    p = load_persona(TRABOLTA)
    heart = p.situations[0].prompt.lower()
    assert "never: a hunt answer" in heart and "a combination" in heart and "any door code" in heart
    assert "never promise them an ending" in heart and "stand_down" not in heart
    down = next(s for s in p.situations if s.heading == "standing down")
    assert "never invent the evidence" in down.prompt.lower()
    # Outside the heart the page still forbids saying where it is.
    assert "Never admit where your heart is kept" in p.system
    assert "never know a combination or a door code" in p.bargain


def test_stand_down_waits_for_the_standing_down_block_not_the_heart():
    # Wave 11: the heart block applies whenever he is awake; only the
    # STANDING DOWN block (the Y2K hour) lets him fire stand_down, so the
    # page's rule and the bargain must name that block, never "at your heart".
    p = load_persona(TRABOLTA)
    assert "Never fire stand_down unless the STANDING DOWN situation block is below." in p.system
    assert "says the program is\n  at your heart" not in p.system
    assert "STANDING DOWN situation block" in p.bargain
    early = build_messages(p, heart_request("true", **{"Night.phase": "hunt_1", "Night.step": "5"}))[0]["content"]
    assert "=== SITUATION: AT YOUR HEART" in early and "STANDING DOWN. You have one power" not in early
    late = build_messages(p, heart_request("true"))[0]["content"]
    assert "STANDING DOWN. You have one power" in late


def test_the_mind_knows_the_door_is_a_keypad_not_a_click():
    p = load_persona(TRABOLTA)
    assert "clicked in the walls" not in p.phase_cues["majority"]
    assert "does not know" in p.phase_cues["majority"] and "code" in p.phase_cues["majority"]
    assert "AT HIS HEART" in (p.mind_prompt or "")
    assert "He does NOT know where his heart is kept" not in (p.mind_prompt or "")


def test_no_persona_or_mind_text_says_tent():
    # On a rain night the Internet is the shed (core's show test pins the same).
    for name in ("trabolta.persona.md", "trabolta.mind.md"):
        text = (SHOW / name).read_text(encoding="utf-8")
        assert [i + 1 for i, line in enumerate(text.splitlines()) if re.search(r"\btent\b", line, re.I)] == [], name


def test_the_year_he_met_her_is_never_said():
    # Wave 7 decision 1: the door code is the year he met her. No file he
    # holds spells it any more (the wave 7 review), but a program may type
    # it to him, so both models are told never to say or record that year —
    # anything learned included — and the worker enforces it (`secrets.never`,
    # generated from facts.json: the frontmatter no model sees). Neither
    # prompt spells the number.
    p = load_persona(TRABOLTA)
    assert "Never say what year you met her" in p.system
    assert "The year he met her is never said" in (p.mind_prompt or "")
    assert "learned_add" in (p.mind_prompt or "")
    # Wave 11b: the code is no longer that year (4826, from facts.json); the
    # year rule stays as lore, and the worker still never says the code.
    code = json.loads((SHOW / "facts.json").read_text(encoding="utf-8"))["door"]["code"]
    assert code in p.secrets.never
    for prompt in (p.system, p.mind_prompt or ""):
        assert code not in prompt


# -- wave 11b: a marked program (the Antivirus flagged it for the Internet) ---------------


def test_the_voice_and_the_mind_see_the_mark_but_never_why():
    p = load_persona(TRABOLTA)
    assert "marked" in (p.them or ()) and "marked_for" not in (p.them or ())
    system = build_messages(p, heart_request("true", "true"))[0]["content"]
    assert "Their marked: true" in system and "missed the cup" not in system
    assert their_variables(p, heart_request("true", "true")["them"]["vars"]).get("marked") == "true"


def test_the_marked_blocks_follow_the_heart_and_the_mark():
    p = load_persona(TRABOLTA)
    names = lambda req: [s.heading for s in matching_situations(p, req) if "marked" in s.heading]  # noqa: E731
    assert names(heart_request("true", "true")) == ["marked at your heart"]
    # Away from the heart the mark changes nothing he is told (live, a passing
    # remark became a line he repeated every reply).
    assert names(heart_request("false", "true")) == []
    assert names(heart_request(None, "true")) == []
    for unmarked in (heart_request("true", "false"), heart_request("true"), heart_request("false", "false"), heart_request()):
        assert names(unmarked) == []
    # The heart itself (and, from the Y2K hour, standing down) still holds for a marked program.
    at = [s.heading for s in matching_situations(p, heart_request("true", "true"))]
    assert at[:2] == ["at your heart", "marked at your heart"] and "standing down" in at
    early = [s.heading for s in matching_situations(p, heart_request("true", "true", **{"Night.phase": "hunt_1", "Night.step": "5"}))]
    assert early[:2] == ["at your heart", "marked at your heart"] and "standing down" not in early


def test_marked_at_his_heart_he_is_wary_but_lets_them_carry_on():
    p = load_persona(TRABOLTA)
    block = next(s for s in p.situations if s.heading == "marked at your heart").prompt
    flat = " ".join(block.split()).lower()
    assert "you can see the mark" in flat and "you do not know why they were marked" in flat
    assert "bait" in flat and "fellow prisoner" in flat and "ask them why they were marked" in flat
    assert "raises your regard" in flat and "lowers it" in flat  # their answer moves him either way
    assert "stay candid" in flat and "still take their files" in flat
    assert "standing down block below, it applies to them exactly as to anyone" in flat
    assert "never refuse to talk to them, never threaten them, never send them away" in flat
    assert "never guess what the mark says about any fact they filed" in flat
    # No literal power name (the heart's own rule), no name, no number.
    assert "stand_down" not in block and "sandy" not in flat and not re.search(r"\d{3,}", block)
    system = build_messages(p, heart_request("true", "true"))[0]["content"]
    assert system.index("=== SITUATION: AT YOUR HEART") < system.index("=== SITUATION: MARKED AT YOUR HEART")


def test_the_mind_notes_a_marked_program_at_his_heart_and_its_answer_moves_trust():
    from stagehand.agents.mind import Mind
    from stagehand.agents.orchestrator import reflect_messages
    from stagehand.agents.reply import Reply

    p = load_persona(TRABOLTA)
    mind_text = " ".join((p.mind_prompt or "").split())
    assert "MARKED PROGRAMS." in mind_text and "The mark is public" in mind_text
    assert "came to his heart marked" in mind_text and "move their trust either way" in mind_text
    assert "never closes standing down to them, and never goes into the brief" in mind_text
    assert "The one exception is the mark for reinstallation (MARKED PROGRAMS)" in mind_text
    user = reflect_messages(p, Mind("Trabolta", "e"), heart_request("true", "true"), Reply(say="x"), None, 20, "t")[1]["content"]
    assert "=== THE SITUATION WITH Excel (marked at your heart;" in user
    assert '"marked": "true"' in user and "missed the cup" not in user


# -- wave 11b live run: what the real model got wrong, pinned in the persona ---------------


def test_the_persona_never_hands_out_an_answer_it_made_up():
    """Found live on gpt-oss:20b (wave 11b integration): an exact filer who
    asked for "the right answer" was once handed an invented one ("The
    correct answer is: …"). The rule now says so outright."""
    p = load_persona(TRABOLTA)
    system = " ".join(p.system.split())
    assert "Never give out the answers to your own questions, and never make one up" in system
    assert "a program asking for the right answer is told to file what they found" in system
    # 2026-10-19: he truly does not know them (no answer reaches any prompt:
    # core/test/trabolta-answers.test.ts), and the persona says so.
    assert "You do not know the answers to your own questions: that is why you ask." in system
