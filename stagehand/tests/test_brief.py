"""Brief mode (wave 42b, B4): shorter replies when the queue is deep.

A request frame's `queued` (the lines waiting on the server for that
character) at or past `agents.voice.brief_at` asks the lean voice for at
most two short sentences in its closing note and caps the call's
`max_tokens` at `brief_max_tokens`. Never a stage request (the whole
Desktop listens) and never a guest at his heart. The trace marks it.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace

import httpx
import pytest

from stagehand.agents.cards import PersonCard, PhaseView, VoiceContext, VoiceOptions
from stagehand.agents.config import parse_agents
from stagehand.agents.llm import LlmConfig, complete
from stagehand.agents.module import Agents
from stagehand.agents.persona import parse_persona
from stagehand.agents.trace import Trace
from stagehand.agents.voice import BRIEF_NOTE, answer_lean, brief_applies
from stagehand.module import ConfigError

PERSONA_TEXT = """---
character: Trabolta
variables: truth
fallback: Please wait.
---
You are TRABOLTA. Answer in 1-3 sentences."""

PERSONA = parse_persona(PERSONA_TEXT)
SAY = json.dumps({"say": "Noted. Go on.", "adjust": {"truth": 0}})


def run(coro):
    return asyncio.run(coro)


class Model:
    """The fake model transport: every request recorded, one fixed answer."""

    def __init__(self):
        self.calls: list[dict] = []

    async def __call__(self, messages, cfg: LlmConfig):
        def handle(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            self.calls.append(body)
            return httpx.Response(200, json={"choices": [{"message": {"content": SAY}, "finish_reason": "stop"}]})

        return await complete(messages, cfg, transport=httpx.MockTransport(handle))

    def closing(self, i: int = -1) -> str:
        return self.calls[i]["messages"][-1]["content"]


def request(**over):
    doc = {
        "id": "ar-1",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g-1"]},
        "speaker": {"kind": "guest", "id": "g-1", "name": "Ada"},
        "text": "hello",
        "history": [{"seq": 1, "mine": False, "from": "Ada", "text": "hello"}],
        "self": {"vars": {"truth": "40"}, "ranges": {"truth": [0, 100]}, "codex": []},
        "them": {"vars": {}, "codex": []},
        "world": {"Night.phase": "hunt_1"},
        "powers": [],
    }
    doc.update(over)
    return doc


STAGE = {
    "thread": {"character": "Trabolta", "channel": "loc:The Desktop", "audience": ["@Clippy"], "public": True},
    "speaker": {"kind": "performer", "id": "p-clippy", "name": "Clippy", "stage": True},
    "stage": {"room": "The Desktop", "scene": "intro"},
}
HEART = {"them": {"vars": {"at_the_heart": "true"}, "codex": []}}


def ctx(**options) -> VoiceContext:
    return VoiceContext(phase=PhaseView(phase="hunt_1", stage="hungry"), person=PersonCard(id="g-1", name="Ada"), options=VoiceOptions(**options))


MODEL = LlmConfig(model="fake", max_tokens=1000, endpoint="http://fake/v1")


# -- the voice --------------------------------------------------------------------------------


def test_brief_mode_asks_for_two_short_sentences_and_caps_the_tokens():
    model, trace = Model(), Trace()
    reply = run(answer_lean(PERSONA, MODEL, request(), ctx(brief=True, brief_max_tokens=600, warm_head=False), model, trace=trace))
    assert reply.say == "Noted. Go on."
    assert len(model.calls) == 1
    assert model.calls[0]["max_tokens"] == 600
    assert BRIEF_NOTE in model.closing()
    assert "at most 2 short sentences" in model.closing()
    # The cached head is untouched: P1 is the same bytes as a normal call's.
    plain = Model()
    run(answer_lean(PERSONA, MODEL, request(), ctx(warm_head=False), plain))
    assert plain.calls[0]["messages"][:3] == model.calls[0]["messages"][:3]
    assert plain.calls[0]["max_tokens"] == 1000 and BRIEF_NOTE not in plain.closing()
    (thought,) = trace.all("Trabolta")
    doc = thought.to_json()
    assert doc["brief"] is True and "brief" in doc["note"] and doc["model"]["max_tokens"] == 600


def test_the_cap_never_raises_a_smaller_budget():
    model = Model()
    run(answer_lean(PERSONA, replace(MODEL, max_tokens=500), request(), ctx(brief=True, brief_max_tokens=600, warm_head=False), model))
    assert model.calls[0]["max_tokens"] == 500


@pytest.mark.parametrize("over", [STAGE, HEART], ids=["stage", "heart"])
def test_never_on_a_stage_request_or_at_his_heart(over):
    model, trace = Model(), Trace()
    run(answer_lean(PERSONA, MODEL, request(**over), ctx(brief=True, brief_max_tokens=600, warm_head=False), model, trace=trace))
    assert model.calls[0]["max_tokens"] == 1000 and BRIEF_NOTE not in model.closing()
    assert all(not t.brief for t in trace.all("Trabolta"))
    assert not brief_applies(request(**over)) and brief_applies(request())


def test_never_in_the_classic_layout():
    model = Model()
    run(answer_lean(PERSONA, MODEL, request(), ctx(brief=True, brief_max_tokens=600, layout="classic"), model))
    assert model.calls[0]["max_tokens"] == 1000 and BRIEF_NOTE not in json.dumps(model.calls[0]["messages"])


def test_a_retry_keeps_the_brief_budget_and_note():
    from stagehand.agents.cards import Said

    model = Model()
    # The answer repeats his last line to them: one retry (nobody waits in the worker).
    heard = replace(ctx(brief=True, brief_max_tokens=600, warm_head=False), said=Said(to_them=("Noted. Go on.",)))
    run(answer_lean(PERSONA, MODEL, request(), heard, model))
    assert len(model.calls) == 2
    assert [c["max_tokens"] for c in model.calls] == [600, 600]
    assert BRIEF_NOTE in model.calls[1]["messages"][-2]["content"]  # the retry note comes after it


# -- the worker ------------------------------------------------------------------------------


MIND = """---
stages: [asleep, formal, hungry]
phases:
  hunt_1:
    stage: hungry
---
You keep the mind.
"""


class FakeMod:
    base_url = "http://srv"

    def __init__(self):
        self.posts: list[tuple[str, dict]] = []

    def path(self, p):
        return f"/e/evt{p}"

    async def post(self, p, body):
        self.posts.append((p, body))
        return {"ok": True}

    async def get(self, p, params=None, timeout=None):
        return {}


def worker(tmp_path, model: Model, **voice) -> Agents:
    (tmp_path / "t.persona.md").write_text(PERSONA_TEXT, encoding="utf-8")
    (tmp_path / "t.mind.md").write_text(MIND, encoding="utf-8")
    cfg = parse_agents(
        {"characters": ["t.persona.md"], "state_dir": "minds", "mind_mode": "new", "llm": {"endpoint": "http://fake/v1", "max_tokens": 1000}, "voice": {"warm_head": "off", **voice}},
        str(tmp_path),
    )
    agents = Agents(cfg, model)
    agents.mod = FakeMod()
    agents.event = "evt"
    return agents


def thoughts(agents):
    return [t for p, b in agents.mod.posts if p == "/api/agent/trace" for t in b["thoughts"] if t["kind"] == "voice"]


def test_the_frame_s_queued_turns_brief_mode_on_at_brief_at(tmp_path):
    model = Model()
    agents = worker(tmp_path, model)
    assert agents.cfg.voice.brief_at == 6 and agents.cfg.voice.brief_max_tokens == 600
    run(agents._handle(request(id="r1", queued=5)))
    run(agents._handle(request(id="r2", queued=6)))
    run(agents._handle(request(id="r3", queued=40, speaker={"kind": "guest", "id": "g-2", "name": "Bo"})))
    assert [c["max_tokens"] for c in model.calls] == [1000, 600, 600]
    assert [BRIEF_NOTE in model.closing(i) for i in range(3)] == [False, True, True]
    assert [t["brief"] for t in thoughts(agents)] == [False, True, True]


def test_no_brief_mode_without_queued_for_the_stage_or_the_heart_or_when_off(tmp_path):
    model = Model()
    agents = worker(tmp_path, model)
    run(agents._handle(request(id="r1")))  # an older server sends no queued
    run(agents._handle(request(id="r2", queued=True)))  # not a number
    run(agents._handle(request(id="r3", queued=50, **HEART)))
    assert [c["max_tokens"] for c in model.calls] == [1000, 1000, 1000]
    assert not agents._brief(request(queued=50, **STAGE))
    assert agents._brief(request(queued=6))
    (tmp_path / "off").mkdir()
    off = worker(tmp_path / "off", Model(), brief_at=0)
    assert not off._brief(request(queued=500))


def test_brief_max_tokens_is_the_yaml_s(tmp_path):
    model = Model()
    agents = worker(tmp_path, model, brief_at=2, brief_max_tokens=450)
    run(agents._handle(request(id="r1", queued=2)))
    assert model.calls[0]["max_tokens"] == 450


@pytest.mark.parametrize(
    "voice, words",
    [
        ({"brief_at": -1}, "brief_at: must be a whole number"),
        ({"brief_at": "six"}, "brief_at: must be a whole number"),
        ({"brief_at": True}, "brief_at: must be a whole number"),
        ({"brief_max_tokens": 300}, "at least 400"),
        ({"brief_max_tokens": "lots"}, "at least 400"),
    ],
)
def test_bad_brief_settings_fail_at_load(tmp_path, voice, words):
    with pytest.raises(ConfigError, match=words):
        worker(tmp_path, Model(), **voice)
