"""The survey guard (wave 12 lane A0): a timer or hello survey that has
nothing to look at never reaches the model.

The rules, in the orchestrator only: `survey_every_s: 0` turns the clock
off (no timer survey, no first look on a stream hello); a paused event, a
character whose `when:` gate is closed (asleep), and a house after the
ending are skipped; an idle house (no line, no whisper, no change, the same
phase since the last survey that ran) is skipped; and a survey whose
messages are byte for byte the last one's is skipped. A director's survey
bypasses all of them; a phase survey bypasses only the idle rule. A skip
makes no model call, records no thought and logs one debug line.
"""

import asyncio
import copy
import logging
from pathlib import Path

from stagehand.agents.facts import Facts
from stagehand.agents.llm import LlmConfig
from stagehand.agents.mind import Mind
from stagehand.agents.orchestrator import Orchestrator, OrchestratorConfig
from stagehand.agents.persona import load_persona, parse_persona
from stagehand.agents.trace import Trace

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"

GATED = parse_persona("---\ncharacter: Trabolta\nvariables: truth\nwhen: self.awake == true\nunavailable: later\n---\nYou are TRABOLTA.")
OPEN = parse_persona("---\ncharacter: Trabolta\nvariables: truth\n---\nYou are TRABOLTA.")


def house(phase="hunt_1", awake="true", programs=None, **raw):
    doc = {
        "world": {"Night.phase": phase},
        "programs": programs if programs is not None else [{"id": "g1", "name": "Ada", "location": "The Desktop", "codex": []}],
        "characters": [{"id": "Trabolta", "vars": {"awake": awake, "truth": "35"}, "codex": []}],
        "locations": [],
        "codex": [],
    }
    doc.update(raw)
    return doc


class Rig:
    """One orchestrator over one mind, a facts document the test edits, a
    model that counts its calls, and a trace that counts the thoughts."""

    def __init__(self, persona=GATED, every=120.0, doc=None, answer='{"mood": "watchful"}'):
        self.doc = doc if doc is not None else house()
        self.answer = answer
        self.calls = []
        self.fetches = 0
        self.trace = Trace()
        self.mind = Mind("Trabolta", "e")
        self.mind.saw_exchange("g1", "Ada", "guest", "t", 1)

        async def complete(messages, cfg):
            self.calls.append(messages)
            return self.answer

        async def facts_fn(force):
            self.fetches += 1
            return Facts(copy.deepcopy(self.doc))

        self.orch = Orchestrator(OrchestratorConfig(quiet_s=0, survey_every_s=every), complete, {"Trabolta": LlmConfig()}, {"Trabolta": persona}, {"Trabolta": self.mind}, None, facts_fn, self.trace)

    def survey(self, trigger="timer"):
        """Queue one survey and run the loop until it is done; returns
        whether it reached the model."""
        before = len(self.calls)
        self.orch.survey("Trabolta", trigger)

        async def go():
            task = asyncio.ensure_future(self.orch.run())
            try:
                for _ in range(300):
                    if self.orch.pending == 0 and self.orch._current is None:
                        return
                    await asyncio.sleep(0.01)
                raise AssertionError("the survey never finished")
            finally:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

        asyncio.new_event_loop().run_until_complete(go())
        return len(self.calls) > before

    @property
    def thoughts(self):
        return self.trace.all("Trabolta")


def skips(caplog):
    return [r for r in caplog.records if r.name == "stagehand.agents.orchestrator" and r.levelno == logging.DEBUG and "skipped" in r.getMessage()]


def test_survey_every_s_zero_turns_off_the_timer_and_the_hello_survey(caplog):
    caplog.set_level(logging.DEBUG, logger="stagehand.agents.orchestrator")
    rig = Rig(persona=OPEN, every=0)
    assert not rig.survey("timer") and not rig.survey("hello")
    assert rig.calls == [] and rig.thoughts == [] and rig.fetches == 0  # not even the facts are fetched
    assert len(skips(caplog)) == 2 and "survey_every_s is 0" in skips(caplog)[0].getMessage()
    assert rig.mind.surveys == 0
    # A director still gets the look he asked for.
    assert rig.survey("director")
    assert [t.kind for t in rig.thoughts] == ["survey"] and rig.mind.surveys == 1


def test_a_paused_event_is_not_surveyed_but_a_director_survey_runs(caplog):
    caplog.set_level(logging.DEBUG, logger="stagehand.agents.orchestrator")
    rig = Rig(persona=OPEN, doc=house(paused=True))
    assert not rig.survey("timer") and not rig.survey("hello")
    assert rig.calls == [] and rig.thoughts == []
    assert "paused" in skips(caplog)[0].getMessage() and len(skips(caplog)) == 2
    assert rig.survey("director")
    # Resumed (and an old server, which never sends `paused`): surveyed.
    rig2 = Rig(persona=OPEN, doc=house(paused=False))
    assert rig2.survey("timer")
    rig3 = Rig(persona=OPEN)
    assert "paused" not in rig3.doc and rig3.survey("timer")


def test_an_asleep_character_is_not_surveyed():
    # `when: self.awake == true` over the character's own vars in the facts.
    rig = Rig(doc=house(phase="arrivals", awake="false"))
    assert not rig.survey("timer") and not rig.survey("hello")
    # A phase survey is spared only the idle rule: asleep still skips it.
    assert not rig.survey("phase")
    assert rig.calls == [] and rig.thoughts == []
    assert rig.survey("director")
    rig.doc = house(phase="introduced", awake="true")
    assert rig.survey("timer")
    # A facts document that does not list him says nothing about his gate.
    unknown = Rig(doc={**house(awake="false"), "characters": []})
    assert unknown.survey("timer")


def test_the_shipped_trabolta_is_not_surveyed_before_he_wakes():
    persona = load_persona(SHOW / "trabolta.persona.md")
    assert persona.when is not None and persona.when.source == "self.awake == true"
    rig = Rig(persona=persona, doc=house(phase="arrivals", awake="false"))
    assert not rig.survey("hello") and not rig.survey("timer")
    rig.doc = house(phase="introduced", awake="true")
    assert rig.survey("timer")


def test_no_survey_after_the_ending():
    rig = Rig(persona=OPEN, doc=house(phase="finale_song"))
    assert not rig.survey("timer") and not rig.survey("hello") and not rig.survey("phase")
    assert rig.calls == [] and rig.thoughts == []
    assert rig.survey("director")
    rig2 = Rig(persona=OPEN, doc=house(phase="final_reveal"))  # not an ending
    assert rig2.survey("timer")


def test_an_idle_house_is_surveyed_once_until_something_happens(caplog):
    caplog.set_level(logging.DEBUG, logger="stagehand.agents.orchestrator")
    rig = Rig()
    assert rig.survey("timer")
    # Nothing said, nothing whispered, nothing changed, the same phase: the
    # old skip only held before the first guest ever spoke (exchanges == 0).
    assert rig.mind.exchanges == 1
    for _ in range(3):
        assert not rig.survey("timer")
    assert not rig.survey("hello")  # a reconnect's first look too
    assert len(rig.calls) == 1 and len(rig.thoughts) == 1 and rig.mind.surveys == 1
    assert sum("idle" in r.getMessage() for r in skips(caplog)) == 4
    # A line since the last survey.
    rig.mind.saw_exchange("g1", "Ada", "guest", "t", 3)
    assert rig.survey("timer") and not rig.survey("timer")
    # A director's whisper pending.
    rig.mind.whisper("be shaken")
    assert rig.survey("timer") and not rig.survey("timer")
    # A change in the house.
    rig.doc = house(programs=[{"id": "g1", "name": "Ada", "location": "The RAM", "codex": []}])
    assert rig.survey("timer")
    assert "Ada moved to The RAM" in rig.calls[-1][1]["content"]
    assert not rig.survey("timer")
    # A new phase (the survey is traced as a phase survey).
    rig.doc = house(phase="hunt_2", programs=[{"id": "g1", "name": "Ada", "location": "The RAM", "codex": []}])
    assert rig.survey("timer") and rig.thoughts[-1].trigger == "phase"
    assert not rig.survey("timer")
    # A director always gets his look.
    assert rig.survey("director")
    assert len(rig.calls) == len(rig.thoughts) == 6


def test_a_skipped_survey_never_hides_a_change():
    # The delta is since the last survey that reached the model: a change
    # made while he slept is still news when he wakes.
    rig = Rig(persona=OPEN)
    assert rig.survey("timer")
    rig.doc = house(programs=[{"id": "g1", "name": "Ada", "location": "The Desktop", "codex": []}, {"id": "g2", "name": "Excel", "codex": []}], paused=True)
    assert not rig.survey("timer")
    rig.doc = house(programs=[{"id": "g1", "name": "Ada", "location": "The Desktop", "codex": []}, {"id": "g2", "name": "Excel", "codex": []}])
    assert rig.survey("timer")
    assert "- Excel arrived" in rig.calls[-1][1]["content"]


def test_the_same_input_twice_is_not_surveyed_but_a_director_survey_is(caplog):
    caplog.set_level(logging.DEBUG, logger="stagehand.agents.orchestrator")
    # The model changes nothing, so the next survey's messages are byte for
    # byte the last one's. A phase survey is spared the idle rule, not this.
    rig = Rig(answer="{}")
    assert rig.survey("timer")
    assert not rig.survey("phase")
    assert any("same input" in r.getMessage() for r in skips(caplog))
    assert len(rig.calls) == 1 and len(rig.thoughts) == 1
    assert rig.survey("director") and rig.calls[-1] == rig.calls[0]


def test_a_phase_survey_is_spared_the_idle_rule():
    # The first survey moved the mind, so the input differs: a phase survey
    # runs on an otherwise idle house, a timer survey does not.
    rig = Rig()
    assert rig.survey("timer")
    assert not rig.survey("timer")
    assert rig.survey("phase")


def test_a_failed_model_call_is_retried_on_the_same_input():
    from stagehand.agents.llm import LlmError

    rig = Rig()
    real = rig.orch.complete_fn

    async def down(messages, cfg):
        rig.calls.append(messages)
        raise LlmError("down")

    rig.orch.complete_fn = down
    assert rig.survey("timer")
    rig.orch.complete_fn = real
    assert rig.survey("timer")  # the failed call is no survey to compare with
    assert not rig.survey("timer")


def test_a_reset_forgets_the_last_survey():
    rig = Rig()
    assert rig.survey("timer") and not rig.survey("timer")
    rig.orch.drop_all()
    assert rig.survey("timer")
