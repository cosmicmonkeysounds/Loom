"""The orchestrator: prompts, merging, and the reply-first scheduler."""

import asyncio
import json

import pytest

from stagehand.agents.facts import Facts
from stagehand.agents.llm import LlmConfig
from stagehand.agents.mind import Mind
from stagehand.agents.orchestrator import DEFAULT_MIND_PROMPT, Job, Orchestrator, OrchestratorConfig, parse_update, reflect_messages, survey_messages
from stagehand.agents.persona import parse_persona
from stagehand.agents.reply import Reply

PERSONA = parse_persona("---\ncharacter: Trabolta\nvariables: truth\nsummarize_after: 6\n---\nYou are TRABOLTA.")


def req(n_history=3, **over):
    history = []
    for i in range(1, n_history + 1):
        history.append({"seq": i, "mine": i % 2 == 0, "from": "Trabolta" if i % 2 == 0 else "Ada", "text": f"line {i}"})
    r = {
        "id": "ar-1",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g1"]},
        "speaker": {"kind": "guest", "id": "g1", "name": "Ada", "faction": None},
        "text": history[-1]["text"] if history else "hi",
        "history": history,
        "self": {"vars": {"truth": "35"}, "ranges": {}, "codex": []},
        "them": {"vars": {"humanity": "20"}, "codex": [], "location": "The Cache"},
        "world": {"Night.phase": "free_roam"},
        "powers": [{"id": "cut the lights", "limit": 2, "used": 1}],
    }
    r.update(over)
    return r


def test_reflect_prompt_carries_persona_mind_state_and_the_exchange():
    mind = Mind("Trabolta", "e")
    mind.saw_exchange("g1", "Ada", "guest", "t", 3)
    mind.apply({"brief": "Be brisk.", "person": {"claims_add": ["is a nurse"]}}, speaker_id="g1")
    msgs = reflect_messages(PERSONA, mind, req(), Reply(say="SANDY.", adjust={"truth": 5}, acts=({"kind": "fire", "name": "cut the lights"},)), None, 20, "t")
    assert [m["role"] for m in msgs] == ["system", "user"]
    system, user = msgs[0]["content"], msgs[1]["content"]
    assert "DIRECTOR OF THE MIND of Trabolta" in system and "You are TRABOLTA." in system
    assert '"brief": "Be brisk."' in user and '"claims": ["is a nurse"]' in user
    assert "Ada: line 3" in user and "Trabolta (just replied): SANDY." in user
    assert 'adjusted: {"truth": 5}' in user and "ACTED" in user
    assert '"left": 1' in user
    assert "thread_summary" in user and "covering everything" not in user  # short thread: no summary asked
    assert 'The person\'s id is \'g1\'' in user


def test_reflect_asks_for_a_summary_once_a_thread_is_long_and_uses_the_mind_file():
    persona = parse_persona("---\ncharacter: Trabolta\n---\nBody.")
    persona = type(persona)(**{**persona.__dict__, "mind_prompt": "Custom director for {character}."})
    msgs = reflect_messages(persona, Mind("Trabolta", "e"), req(n_history=8), Reply(say="x"), Facts({"world": {}, "programs": [], "locations": [], "codex": []}), 6, "t")
    assert msgs[0]["content"].startswith("Custom director for Trabolta.")
    assert DEFAULT_MIND_PROMPT[:20] not in msgs[0]["content"]
    assert "This thread is 8 lines long" in msgs[1]["content"]
    assert "=== THE HOUSE ===" in msgs[1]["content"]


def test_survey_prompt_lists_the_delta():
    facts = Facts({"world": {"Night.phase": "hunt"}, "programs": [], "locations": [], "codex": []})
    msgs = survey_messages(PERSONA, Mind("Trabolta", "e"), facts, ["Excel arrived", "phase: bingo → hunt"])
    assert "- Excel arrived" in msgs[1]["content"] and "Nobody is talking to Trabolta" in msgs[1]["content"]
    quiet = survey_messages(PERSONA, Mind("Trabolta", "e"), facts, [])
    assert "nothing you can see" in quiet[1]["content"]


def test_parse_update_tolerates_think_blocks_and_prose():
    assert parse_update('<think>hm</think> Sure: {"brief": "b"} done') == {"brief": "b"}
    assert parse_update("no json here") is None
    assert parse_update('<think>unterminated {"brief": "x"}') is None


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def harness(complete, cfg=None, facts=None):
    mind = Mind("Trabolta", "e")
    mind.saw_exchange("g1", "Ada", "guest", "t", 3)
    updates = []

    async def on_update(character, m, job, touched):
        updates.append((job.kind, touched))

    async def facts_fn(force):
        return facts

    orch = Orchestrator(cfg or OrchestratorConfig(quiet_s=0, survey_every_s=0), complete, {"Trabolta": LlmConfig()}, {"Trabolta": PERSONA}, {"Trabolta": mind}, on_update, facts_fn)
    return orch, mind, updates


async def run_until(orch, pred, timeout=2.0):
    task = asyncio.ensure_future(orch.run())
    try:
        for _ in range(int(timeout / 0.01)):
            if pred():
                return
            await asyncio.sleep(0.01)
        raise AssertionError("condition not met")
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def test_a_reflection_updates_the_mind_and_notifies():
    seen = []

    async def complete(messages, cfg):
        seen.append(messages)
        return json.dumps({"brief": "Be kind to Ada.", "person": {"trust": 77}, "thread_summary": "Ada said hello."})

    orch, mind, updates = harness(complete)
    orch.reflect("Trabolta", "t", req(), Reply(say="hi"))
    orch.reflect("Trabolta", "t", req(), Reply(say="hi again"))  # coalesces: one job per thread
    assert orch.pending == 1
    run(run_until(orch, lambda: updates))
    assert updates == [("reflect", ["brief", "person", "thread"])]
    assert mind.brief == "Be kind to Ada." and mind.people["g1"].trust == 77 and mind.threads["t"].upto == 3
    assert mind.reflections == 1 and len(seen) == 1


def test_a_reply_in_flight_preempts_the_job_which_then_retries():
    calls = 0

    async def complete(messages, cfg):
        nonlocal calls
        calls += 1
        if calls == 1:
            await asyncio.sleep(10)  # will be cancelled
        return json.dumps({"mood": "wary"})

    orch, mind, updates = harness(complete)

    async def go():
        orch.reflect("Trabolta", "t", req(), Reply(say="x"))
        task = asyncio.ensure_future(orch.run())
        await asyncio.sleep(0.05)  # the job starts (and hangs)
        assert calls == 1 and orch._current is not None
        orch.busy(+1)  # a request arrived: the reflection is cancelled…
        await asyncio.sleep(0.02)
        assert orch.pending == 1 and not updates  # …and requeued, not run while busy
        await asyncio.sleep(0.1)
        assert calls == 1
        orch.busy(-1)  # reply done → the job re-runs
        for _ in range(100):
            if updates:
                break
            await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    run(go())
    assert updates == [("reflect", ["mood"])] and mind.mood == "wary" and calls == 2


def test_a_survey_reads_the_facts_and_a_reset_drops_the_queue():
    facts = Facts({"world": {"Night.phase": "hunt"}, "programs": [{"id": "g1", "name": "Ada", "codex": []}], "locations": [], "codex": []})

    async def complete(messages, cfg):
        assert "=== THE HOUSE NOW ===" in messages[1]["content"]
        return '{"world_add": ["Ada is here"], "people": {"g1": {"trust": 12}}}'

    orch, mind, updates = harness(complete, facts=facts)
    orch.survey("Trabolta")
    run(run_until(orch, lambda: updates))
    assert updates == [("survey", ["people", "world"])] and mind.world == ["Ada is here"] and mind.people["g1"].trust == 12 and mind.surveys == 1
    orch.survey("Trabolta")
    orch.drop_all()
    assert orch.pending == 0


def test_unusable_output_and_model_failure_leave_the_mind_alone():
    from stagehand.agents.llm import LlmError

    async def bad(messages, cfg):
        return "I refuse."

    orch, mind, updates = harness(bad)
    orch.reflect("Trabolta", "t", req(), Reply(say="x"))
    run(run_until(orch, lambda: orch.pending == 0 and orch._current is None))
    assert not updates and mind.brief == ""

    async def boom(messages, cfg):
        raise LlmError("down")

    orch2, mind2, updates2 = harness(boom)
    orch2.reflect("Trabolta", "t", req(), Reply(say="x"))
    run(run_until(orch2, lambda: orch2.pending == 0 and orch2._current is None))
    assert not updates2


def test_disabled_orchestrator_accepts_nothing():
    async def never(messages, cfg):
        raise AssertionError

    orch, _, _ = harness(never, cfg=OrchestratorConfig(enabled=False))
    orch.reflect("Trabolta", "t", req(), Reply(say="x"))
    assert orch.pending == 0
    run(orch.run())  # returns immediately


def test_job_keys_and_attempts():
    j = Job("reflect", "T", "k")
    assert j.attempts == 0 and j.kind == "reflect"
    with pytest.raises(TypeError):
        Job()  # type: ignore[call-arg]
