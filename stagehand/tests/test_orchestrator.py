"""The orchestrator: prompts, merging, and the reply-first scheduler."""

import asyncio
import json
from dataclasses import replace

import pytest

from stagehand.agents.facts import Facts
from stagehand.agents.llm import LlmConfig
from stagehand.agents.mind import Mind
from stagehand.agents.orchestrator import DEFAULT_MIND_PROMPT, Job, Orchestrator, OrchestratorConfig, mind_snapshot, parse_update, reflect_messages, survey_messages
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


def test_reflect_shows_only_the_personas_them_whitelist_of_the_speakers_variables():
    # The orchestrator reads the guest the way the voice does: a slot the
    # author left off `them:` (a virus carried, a mission chosen) reaches
    # neither model.
    persona = parse_persona("---\ncharacter: Trabolta\nthem: trust, corrupted\n---\nBody.")
    r = req(them={"vars": {"trust": "20", "corrupted": "false", "planted_virus": "true", "excel_choice": "sabotage", "codex.ilove_you": "true"}, "codex": [], "location": "The Desktop"})
    user = reflect_messages(persona, Mind("Trabolta", "e"), r, Reply(say="x"), None, 20, "t")[1]["content"]
    assert '"variables": {"trust": "20", "corrupted": "false"}' in user
    assert "planted_virus" not in user and "sabotage" not in user and "ilove_you" not in user
    # No whitelist: every plain name, never a dotted sub-path.
    open_user = reflect_messages(PERSONA, Mind("Trabolta", "e"), r, Reply(say="x"), None, 20, "t")[1]["content"]
    assert "planted_virus" in open_user and "ilove_you" not in open_user


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


def test_survey_and_reflect_show_only_the_personas_facts_globals():
    # SW-AI-02: a global outside the persona's `facts:` (a vote tally, the
    # judge mode) reaches neither the survey's house nor reflect's live state.
    persona = parse_persona("---\ncharacter: Trabolta\nfacts: Night.step\n---\nBody.")
    world = {"Night.phase": "hunt", "Night.step": "3", "Night.help_votes": "4", "Night.judge_mode": "review"}
    facts = Facts({"world": world, "programs": [], "locations": [], "codex": []})
    survey = survey_messages(persona, Mind("Trabolta", "e"), facts, [])[1]["content"]
    assert "Night.step=3" in survey and "Night.phase=hunt" in survey
    assert "help_votes" not in survey and "judge_mode" not in survey
    user = reflect_messages(persona, Mind("Trabolta", "e"), req(world=world), Reply(say="x"), facts, 20, "t")[1]["content"]
    assert '"world": {"Night.phase": "hunt", "Night.step": "3"}' in user
    assert "help_votes" not in user and "judge_mode" not in user


def test_a_surveys_delta_drops_globals_outside_the_personas_facts():
    persona = parse_persona("---\ncharacter: Trabolta\nfacts: Night.step\n---\nBody.")
    seen = []
    state = {"world": {"Night.phase": "hunt", "Night.step": "1", "Night.help_votes": "0"}}

    async def complete(messages, cfg):
        seen.append(messages[1]["content"])
        return '{"mood": "watchful"}'

    updates = []

    async def on_update(character, m, job, touched):
        updates.append(job.kind)

    async def facts_fn(force):
        return Facts({**state, "programs": [], "locations": [], "codex": []})

    # A survey clock is on (a timer survey under `survey_every_s: 0` never runs).
    orch = Orchestrator(OrchestratorConfig(quiet_s=0, survey_every_s=120), complete, {"Trabolta": LlmConfig()}, {"Trabolta": persona}, {"Trabolta": Mind("Trabolta", "e")}, on_update, facts_fn)
    orch.survey("Trabolta")
    run(run_until(orch, lambda: len(updates) == 1))
    state["world"] = {"Night.phase": "hunt", "Night.step": "2", "Night.help_votes": "7"}
    orch.survey("Trabolta")
    run(run_until(orch, lambda: len(updates) == 2))
    assert "- Night.step = 2" in seen[1] and "help_votes" not in seen[1]


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

    orch, mind, updates = harness(complete, cfg=OrchestratorConfig(quiet_s=0, survey_every_s=120), facts=facts)
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


def _show_night(persona):
    """A real late night on the show: the shipped codex (Trabolta holding
    his entries, text and all), 45 programs, 17 crowded rooms, a 19-line
    thread, and a mind grown through `Mind.apply` (the real write path and
    its caps) with entries a little longer than rehearsal minds hold."""
    from test_secrets import _show_codex

    entries, held = _show_codex()
    names = [f"Guest Program {i:02d}" for i in range(45)]
    programs = [{"id": f"g{i}", "name": n, "faction": "Chatters" if i % 2 else "Mods", "codex": held[:2]} for i, n in enumerate(names)]
    rooms = [{"id": f"r{i}", "label": f"The Show Room {i:02d}", "occupants": names[i::17]} for i in range(17)]
    facts = Facts({"world": {"Night.phase": "free_roam", "Night.majority": "none"}, "programs": programs, "locations": rooms, "codex": entries})
    r = req(n_history=19)
    for h in r["history"]:
        h["text"] = ("Trabolta answers at length, " * 8)[:200] if h["mine"] else ("the guest typed a short line " * 3)[:80]
    by_title = {e["title"]: e for e in entries}
    r["self"] = {"vars": {"truth": "35", "untruth": "20", "stance": "-10"}, "codex": [{"title": t, "text": by_title[t]["text"]} for t in held]}
    mind = Mind("Trabolta", "e")
    mind.seed(persona.stages, persona.drives)
    for i in range(13):
        mind.saw_exchange(f"g{i}", names[i], "guest", f"dm:{i}", 9)
        mind.apply(
            {
                "person": {
                    "summary": f"{names[i]} " + "keeps asking about the server room and lies about the hunt. " * 3,
                    "claims_add": [f"claim {i}.{k}: says the duck is upstairs, by the crawl space" for k in range(12)],
                    "asks_add": [f"ask {i}.{k}: wants Trabolta to cut the lights in the RAM" for k in range(12)],
                    "promises_add": [f"promise {i}.{k}: a codex entry if they file a true fact" for k in range(12)],
                }
            },
            speaker_id=f"g{i}",
            thread_key=f"dm:{i}",
        )
    mind.apply(
        {
            "brief": "Be curious and wary; push for facts about bodies; " * 8,
            "mood": "hungry, suspicious",
            "policy": {"favours": "earned", "credit": names[:6], "wary": names[6:12], "note": "Only those who filed a true fact get a favour tonight."},
            "notes_add": [f"note {k}: Ada says bodies itch, investigate before the zip" for k in range(20)],
            "learned_add": [{"claim": f"claim {k}: the printer is full of beans and the zip is a lie", "from": names[k], "verdict": "bluster"} for k in range(12)],
            "world_add": [f"world {k}: the Desktop is crowded, the tent is empty" for k in range(8)],
            "questions_add": [f"question {k}: what does earning feel like?" for k in range(6)],
            "answers_add": [{"q": f"question {k}: what does earning feel like?", "a": f"answer {j}: like a warm battery, says a guest", "from": names[j]} for k in range(6) for j in range(6)],
            "thread_summary": "The guest has pressed him about the server room for twenty lines, " * 10,
        },
        speaker_id="g0",
        thread_key="t",
        upto=19,
    )
    snap = json.loads(mind_snapshot(mind, "g0", "t"))
    assert len(snap["notes"]) == 20 and len(snap["learned"]) == 12 and len(snap["world"]) == 8
    assert len(snap["questions"]) == 6 and len(snap["other_people"]) == 12 and len(snap["this_person"]["claims"]) == 12
    msgs = reflect_messages(persona, mind, r, Reply(say=("SANDY. " * 60)[:400], adjust={"truth": 5}), facts, 20, "t")
    return sum(len(m["content"]) for m in msgs)


def test_the_example_orchestrator_context_fits_a_late_night_reflect_prompt():
    """The reflect prompt (Trabolta's mind file + persona + the house + the
    lore + a grown mind) is ≈ 16k tokens late in the night: on Ollama's
    default context the runner cuts its middle and the mind update still
    looks confident. The example config names a `num_ctx` that fits it with
    room for the reply."""
    from pathlib import Path

    from stagehand.agents.orchestrator import CHARS_PER_TOKEN
    from stagehand.config import load_config

    agents = load_config(Path(__file__).resolve().parents[1] / "agents.example.yaml").modules["agents"]
    om = agents.cfg.orchestrator_models["Trabolta"]
    num_ctx = (om.extra.get("options") or {}).get("num_ctx")
    assert isinstance(num_ctx, int) and num_ctx >= 20480, om.extra
    chars = _show_night(agents.cfg.personas["Trabolta"])
    assert chars > 40_000  # it really is the shipped mind file + lore + a full mind
    assert chars / CHARS_PER_TOKEN + om.max_tokens < num_ctx, (chars, num_ctx)


def test_the_check_estimate_covers_a_late_night_reflect_prompt():
    """`stagehand check`'s estimate is no smaller than a real late night's
    reflect prompt (not the doors' — a fresh mind and an empty house fit in
    a context the night outgrows), and still fits the orchestrator's
    default context."""
    from pathlib import Path

    from stagehand.agents.config import ORCHESTRATOR_NUM_CTX
    from stagehand.agents.orchestrator import CHARS_PER_TOKEN, reflect_tokens_needed
    from stagehand.config import load_config

    example = Path(__file__).resolve().parents[1] / "agents.example.yaml"
    agents = load_config(example).modules["agents"]
    om = agents.cfg.orchestrator_models["Trabolta"]
    persona = agents.cfg.personas["Trabolta"]
    real = _show_night(persona) // CHARS_PER_TOKEN + om.max_tokens
    need = reflect_tokens_needed(persona, om.max_tokens)
    assert need >= real, (need, real)
    assert need < ORCHESTRATOR_NUM_CTX
    assert agents.warnings() == []
    # The review's case: a 12k context fits the doors' prompt but not a late
    # night's, and the check now says so instead of staying silent.
    doors = sum(len(m["content"]) for m in reflect_messages(persona, Mind("Trabolta", "e"), req(), Reply(say="x"), None, 20, "t"))
    assert doors // CHARS_PER_TOKEN + om.max_tokens < 12_000 < real
    small = load_config(example).modules["agents"]
    small.cfg.orchestrator_models["Trabolta"] = replace(om, extra={"think": False, "options": {"num_ctx": 12_000}})
    (warning,) = small.warnings()
    assert "12000-token context" in warning and "extra.options.num_ctx" in warning
