"""The shipped Trabolta persona + mind file: what each model may be told,
and when. (Mechanics live in test_agents / test_situations; this file pins
the show's own text.)"""

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

from stagehand.agents.prompt import allowed_powers, build_messages, matching_situations  # noqa: E402


def heart_request(at_the_heart=None, **world):
    them = {"trust": "50", "featured": "excel"}
    if at_the_heart is not None:
        them["at_the_heart"] = at_the_heart
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
    assert [s.heading for s in p.situations] == ["at your heart", "standing down", "her name has been said", "her name is still blacked out"]
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
    assert "1997" in p.secrets.never
    for prompt in (p.system, p.mind_prompt or ""):
        assert "1997" not in prompt and "'97" not in prompt
