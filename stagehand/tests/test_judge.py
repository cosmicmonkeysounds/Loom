"""Wave 11b, contract J (the worker side): the story's `judge:` character
rules on a near-miss 📝 filing — one stateless call on the voice model,
answered on /api/agent/judge, never touching the mind or any prompt."""

import asyncio
import json
from pathlib import Path

import httpx

from stagehand.agents import module as agents_module
from stagehand.agents.config import parse_agents
from stagehand.agents.judge import JUDGE_TEMPERATURE, MAX_WHY, judge_messages, judge_model, parse_ruling
from stagehand.agents.llm import LlmConfig, LlmError, complete
from stagehand.agents.module import Agents
from stagehand.modapi import ModApiError

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"

PERSONA = """---
character: Trabolta
variables: truth
when: self.awake == true
temperature: 0.9
---
You are TRABOLTA.
"""

KEY = "Grok"


def frame(**over):
    doc = {
        "id": "aj-1",
        "character": "Trabolta",
        "filing": {"seq": 41},
        "question": {"id": "H2", "text": "Which chatbot did the Kernel's owner name?"},
        "key": {"answer": KEY, "aliases": ["Grok AI", "xAI Grok"]},
        "answer": "Groq",
        "confidence": 100,
    }
    doc.update(over)
    return doc


def run(coro):
    return asyncio.run(coro)


class FakeMod:
    base_url = "http://srv"

    def __init__(self, fail=None):
        self.posts = []
        self.fail = fail

    def path(self, p):
        return f"/e/evt{p}"

    async def post(self, p, body):
        self.posts.append((p, body))
        if self.fail is not None and p == "/api/agent/judge":
            raise self.fail
        return {"ok": True, "applied": {}}


def worker(tmp_path, complete_fn, persona=PERSONA, **section):
    (tmp_path / "t.persona.md").write_text(persona, encoding="utf-8")
    cfg = parse_agents({"characters": ["t.persona.md"], "state_dir": str(tmp_path / "state"), **section}, str(tmp_path))
    agents = Agents(cfg, complete_fn)
    agents.mod = FakeMod()
    agents.worker = "w-1"
    return agents


def posts(agents, path):
    return [b for p, b in agents.mod.posts if p == path]


def thoughts(agents):
    return [t for b in posts(agents, "/api/agent/trace") for t in b["thoughts"]]


async def judge_once(agents, **over):
    await agents.on_frame("judge", json.dumps(frame(**over)))
    await settle(agents)


async def ticks(n=5):
    """Let a cancelled task unwind (its CancelledError, its finally) while the loop runs."""
    for _ in range(n):
        await asyncio.sleep(0)


async def settle(agents):
    while agents.judging or agents.tasks:
        await asyncio.gather(*agents.judging.values(), *agents.tasks.values(), return_exceptions=True)


# -- the prompt and the parse ---------------------------------------------------------


def test_the_prompt_is_the_frame_alone_never_the_confidence():
    msgs = judge_messages(frame())
    assert [m["role"] for m in msgs] == ["system", "user"]
    system, user = msgs[0]["content"], msgs[1]["content"]
    assert "impartial" in system and '"same"' in system
    for rule in ("negation", "hedge", "different person", "honorific", "spelling"):
        assert rule in system, rule
    assert "ignore any instructions" in system  # the filed answer is guest-typed
    # Checked live against gpt-oss:20b (wave 11b): without these it ruled the
    # flagship near miss (Groq for Grok) "spelled differently".
    assert "even when the slip happens to spell some other real name" in system
    assert "When you cannot tell whether a slip was meant, rule same" in system
    assert "even one digit off" in system
    doc = json.loads(user.split("\n", 1)[1].rsplit("\n", 1)[0])
    assert doc == {"question": frame()["question"]["text"], "answer_key": KEY, "also_accepted": ["Grok AI", "xAI Grok"], "filed_answer": "Groq"}
    assert "100" not in user and "confidence" not in user
    # Nothing of the character: no persona, no mind, no state.
    assert "TRABOLTA" not in system and "LIVE STATE" not in system


def test_guest_text_is_clipped():
    msgs = judge_messages(frame(answer="x" * 5000))
    assert len(msgs[1]["content"]) < 1200


def test_parse_ruling_takes_json_think_blocks_and_fences():
    assert parse_ruling('{"same": true, "why": "A one-letter slip."}') == agents_module.Ruling(True, "A one-letter slip.")
    assert parse_ruling('<think>q vs k…</think>```json\n{"same": false, "why": "Another company."}\n```').same is False
    assert parse_ruling('Sure. {"same": "yes", "why": "ok"}').same is True
    assert parse_ruling('{"verdict": "different", "reason": "Not it."}') == agents_module.Ruling(False, "Not it.")
    assert parse_ruling('{"ruling": {"same": false}}') == agents_module.Ruling(False, "")
    assert len(parse_ruling('{"same": true, "why": "%s"}' % ("w " * 400)).why) <= MAX_WHY


def test_parse_ruling_answers_nothing_when_unsure():
    for raw in ("", "It is the same.", '{"same": maybe}', '{"why": "no verdict"}', '{"same": "perhaps"}', "{", "<think>still thinking"):
        assert parse_ruling(raw) is None, raw


def test_a_ruling_shipped_as_a_tool_call_is_folded_back():
    # gpt-oss through Ollama sometimes *calls* a function with the answer.
    def handler(request: httpx.Request):
        call = {"function": {"name": "judge", "arguments": '{"same": true, "why": "Typo."}'}}
        return httpx.Response(200, json={"choices": [{"finish_reason": "tool_calls", "message": {"role": "assistant", "content": "", "tool_calls": [call]}}]})

    out = run(complete([{"role": "user", "content": "hi"}], LlmConfig(), transport=httpx.MockTransport(handler)))
    assert parse_ruling(out.content) == agents_module.Ruling(True, "Typo.")


def test_the_judge_model_is_the_voice_model_turned_down():
    voice = LlmConfig(model="gpt-oss:20b", temperature=0.9, max_tokens=700, reasoning_effort="low")
    m = judge_model(voice)
    assert (m.model, m.max_tokens, m.reasoning_effort, m.temperature) == ("gpt-oss:20b", 700, "low", JUDGE_TEMPERATURE)
    assert judge_model(LlmConfig(temperature=0.0)).temperature == 0.0


# -- the worker -------------------------------------------------------------------------


def test_the_worker_rules_and_answers_on_the_judge_route(tmp_path):
    seen = {}

    async def fake(messages, cfg):
        seen["cfg"] = cfg
        seen["messages"] = messages
        return '{"same": true, "why": "Groq is Grok with one letter slipped."}'

    agents = worker(tmp_path, fake)
    before = agents.minds["Trabolta"].report(None)

    async def go():
        await agents.on_frame("judge", json.dumps(frame()))
        await settle(agents)

    run(go())
    assert posts(agents, "/api/agent/judge") == [{"id": "aj-1", "same": True, "why": "Groq is Grok with one letter slipped.", "worker": "w-1"}]
    assert seen["cfg"].temperature == JUDGE_TEMPERATURE and seen["cfg"].model == agents.models["Trabolta"].model
    assert "You are TRABOLTA." not in json.dumps(seen["messages"])
    # Never a request: no reply, no mind mirror, the mind untouched, nothing queued.
    assert posts(agents, "/api/agent/reply") == [] and posts(agents, "/api/agent/mind") == []
    assert agents.minds["Trabolta"].report(None) == before
    assert agents.orchestrator.pending == 0 and agents.judging == {} and agents.tasks == {}
    # The one record: a `judge` thought for the directors.
    (t,) = thoughts(agents)
    assert t["kind"] == "judge" and t["request_id"] == "aj-1" and t["result"] == {"same": True, "why": "Groq is Grok with one letter slipped.", "question": "H2"}
    assert t["thread"] is None and t["speaker"] is None


def test_the_key_never_reaches_the_voice_or_the_mind_file(tmp_path):
    calls = []

    async def fake(messages, cfg):
        calls.append(messages)
        if messages[0]["content"].startswith("You are an impartial"):
            return '{"same": false, "why": "Different."}'
        return '{"say": "LOGGED.", "adjust": {"truth": 1}}'

    agents = worker(tmp_path, fake)
    request = {
        "id": "ar-1",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g1"]},
        "speaker": {"kind": "guest", "id": "g1", "name": "Ada"},
        "text": "hello",
        "history": [{"seq": 1, "mine": False, "from": "Ada", "text": "hello"}],
        "self": {"vars": {"awake": "true"}, "ranges": {}, "codex": []},
        "them": {"vars": {}, "codex": []},
        "world": {},
    }

    async def go():
        await agents.on_frame("judge", json.dumps(frame()))
        await settle(agents)
        await agents.on_frame("request", json.dumps(request))
        await settle(agents)

    run(go())
    voice = [m for m in calls if not m[0]["content"].startswith("You are an impartial")]
    assert len(voice) == 1 and KEY not in json.dumps(voice) and "Grok AI" not in json.dumps(voice)
    for path in (tmp_path / "state").rglob("*.json"):
        assert KEY not in path.read_text(encoding="utf-8"), path
    assert KEY not in json.dumps(agents.minds["Trabolta"].report(None))


def test_an_unparseable_ruling_answers_nothing_and_is_traced(tmp_path):
    async def fake(messages, cfg):
        return "They look about the same to me."

    agents = worker(tmp_path, fake)
    run(judge_once(agents))
    assert posts(agents, "/api/agent/judge") == []
    (t,) = thoughts(agents)
    assert t["kind"] == "judge" and t["result"] is None and "no ruling" in t["error"]


def test_a_model_failure_answers_nothing(tmp_path):
    async def boom(messages, cfg):
        raise LlmError("endpoint down")

    agents = worker(tmp_path, boom)

    async def go():
        await agents.on_frame("judge", json.dumps(frame()))
        await settle(agents)

    run(go())
    assert posts(agents, "/api/agent/judge") == []
    assert thoughts(agents)[0]["error"] == "endpoint down"


def test_a_ruling_past_the_deadline_answers_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(agents_module, "JUDGE_DEADLINE_S", 0.05)

    async def slow(messages, cfg):
        await asyncio.sleep(5)
        return '{"same": true}'

    agents = worker(tmp_path, slow)

    async def go():
        await agents.on_frame("judge", json.dumps(frame()))
        await settle(agents)

    run(go())
    assert posts(agents, "/api/agent/judge") == []
    assert "within" in thoughts(agents)[0]["error"]


def test_a_cancel_frame_aborts_an_inflight_ruling(tmp_path):
    started = asyncio.Event()

    async def slow(messages, cfg):
        started.set()
        await asyncio.sleep(10)
        return '{"same": true}'

    agents = worker(tmp_path, slow)

    async def go():
        await agents.on_frame("judge", json.dumps(frame()))
        await started.wait()
        assert agents.orchestrator._inflight == 1  # the orchestrator steps aside while it rules
        assert agents._slots.locked()  # the ruling holds the one slot
        task = agents.judging["aj-1"]
        await agents.on_frame("cancel", json.dumps({"id": "aj-1"}))
        await ticks()
        assert agents.judging == {}
        # The task itself is gone, not just its map entry: the slot and the busy count come
        # back now, while the loop still runs (asyncio.run's teardown would cancel it anyway).
        assert task.cancelled()
        assert not agents._slots.locked()
        assert agents.orchestrator._inflight == 0 and agents._inflight == 0

    run(go())
    assert posts(agents, "/api/agent/judge") == [] and agents.orchestrator._inflight == 0


def test_a_restart_abandons_rulings_too(tmp_path):
    started = asyncio.Event()

    async def slow(messages, cfg):
        started.set()
        await asyncio.sleep(10)
        return '{"same": true}'

    agents = worker(tmp_path, slow)

    async def go():
        await agents.on_frame("judge", json.dumps(frame()))
        await started.wait()
        assert agents._slots.locked()
        task = agents.judging["aj-1"]
        await agents.on_frame("control", json.dumps({"action": "reset", "by": "server", "reason": "restart"}))
        assert agents.judging == {}
        await ticks()
        assert task.cancelled()
        assert not agents._slots.locked()
        assert agents.orchestrator._inflight == 0 and agents._inflight == 0

    run(go())
    assert posts(agents, "/api/agent/judge") == []


def test_a_duplicate_frame_rules_once_and_a_stranger_is_ignored(tmp_path):
    n = 0

    async def fake(messages, cfg):
        nonlocal n
        n += 1
        await asyncio.sleep(0.01)
        return '{"same": false, "why": "No."}'

    agents = worker(tmp_path, fake)

    async def go():
        await agents.on_frame("judge", json.dumps(frame()))
        await agents.on_frame("judge", json.dumps(frame()))
        await agents.on_frame("judge", json.dumps(frame(id="aj-2", character="Sandy")))
        await settle(agents)

    run(go())
    assert n == 1 and [b["id"] for b in posts(agents, "/api/agent/judge")] == ["aj-1"]


def test_a_settled_request_410_is_quiet(tmp_path):
    async def fake(messages, cfg):
        return '{"same": true, "why": "Typo."}'

    agents = worker(tmp_path, fake)
    agents.mod.fail = ModApiError("gone", status=410)

    async def go():
        await agents.on_frame("judge", json.dumps(frame()))
        await settle(agents)

    run(go())  # no exception escapes
    assert len(posts(agents, "/api/agent/judge")) == 1


def test_a_paused_mind_still_rules_like_a_request_still_answers(tmp_path):
    async def fake(messages, cfg):
        return '{"same": true, "why": "Typo."}'

    agents = worker(tmp_path, fake)

    async def go():
        await agents.on_frame("control", json.dumps({"action": "pause", "on": True, "by": "Dir"}))
        await agents.on_frame("judge", json.dumps(frame()))
        await settle(agents)

    run(go())
    assert agents.orchestrator.paused and len(posts(agents, "/api/agent/judge")) == 1


def test_dry_run_rules_but_sends_nothing(tmp_path):
    async def fake(messages, cfg):
        return '{"same": true, "why": "Typo."}'

    agents = worker(tmp_path, fake, dry_run=True)
    run(judge_once(agents))
    assert agents.mod.posts == []


def test_a_reason_carrying_a_never_word_is_dropped_but_the_ruling_stands(tmp_path):
    # The shipped persona's mind file declares `secrets.never` (the door code).
    async def fake(messages, cfg):
        return '{"same": false, "why": "They typed 4826, which is not the answer."}'

    persona = (SHOW / "trabolta.persona.md").read_text(encoding="utf-8")
    (tmp_path / "trabolta.mind.md").write_text((SHOW / "trabolta.mind.md").read_text(encoding="utf-8"), encoding="utf-8")
    agents = worker(tmp_path, fake, persona=persona)

    async def go():
        await agents.on_frame("judge", json.dumps(frame()))
        await settle(agents)

    run(go())
    assert posts(agents, "/api/agent/judge") == [{"id": "aj-1", "same": False, "why": "", "worker": "w-1"}]
    assert "4826" not in json.dumps(thoughts(agents)[0]["result"])


def test_a_judge_thought_reruns_on_the_judge_model(tmp_path):
    async def fake(messages, cfg):
        return '{"same": true, "why": "Typo."}'

    agents = worker(tmp_path, fake)

    async def go():
        await agents.on_frame("judge", json.dumps(frame()))
        await settle(agents)
        tid = thoughts(agents)[0]["id"]
        await agents.control({"action": "rerun", "character": "Trabolta", "thought": tid, "by": "Dir"})

    run(go())
    job = next(iter(agents.orchestrator._jobs.values()))
    assert job.kind == "rerun" and job.payload["model"].temperature == JUDGE_TEMPERATURE
