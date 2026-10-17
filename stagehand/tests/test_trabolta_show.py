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
