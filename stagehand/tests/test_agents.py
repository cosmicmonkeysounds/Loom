import asyncio
import json
from pathlib import Path

import httpx
import pytest

from stagehand.agents.config import parse_agents
from stagehand.agents.llm import LlmConfig, LlmError, complete
from stagehand.agents.module import Agents, answer
from stagehand.agents.persona import load_persona, parse_persona
from stagehand.agents.prompt import build_messages, gate_context, state_block
from stagehand.agents.reply import parse_reply
from stagehand.module import ConfigError

TRABOLTA = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet/trabolta.persona.md"

PERSONA = """---
character: Trabolta
variables: truth, stance
max_step: 10
facts: Night.
them: humanity
when: self.glitched == true || speaker.kind == 'performer'
unavailable: BUSY.
fallback: ...static...
temperature: 0.4
---
You are TRABOLTA.
"""


def request(**over):
    req = {
        "id": "ar-1",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g-1"]},
        "speaker": {"kind": "guest", "id": "g-1", "name": "Ada", "faction": "Hosts"},
        "text": "Who is Sandy?",
        "history": [
            {"seq": 1, "mine": False, "from": "Ada", "text": "hello"},
            {"seq": 2, "mine": True, "from": "Trabolta", "text": "HELLO PROGRAM."},
            {"seq": 3, "mine": False, "from": "Ada", "text": "Who is Sandy?"},
        ],
        "self": {
            "vars": {"truth": "35", "stance": "0", "glitched": "true"},
            "ranges": {"truth": [0, 100], "stance": [-100, 100]},
            "codex": [{"id": "c1", "title": "The Sandy File", "about": "Trabolta", "text": "He wants\n to impress Sandy."}],
        },
        "them": {"vars": {"humanity": "20", "secret": "x"}, "codex": [], "location": "The Desktop"},
        "world": {"Night.phase": "glitch", "Other.thing": "1"},
        "at": 0,
    }
    req.update(over)
    return req


# -- persona ------------------------------------------------------------------


def test_persona_parses_every_knob():
    p = parse_persona(PERSONA)
    assert p.character == "Trabolta"
    assert p.system == "You are TRABOLTA."
    assert p.variables == ("truth", "stance")
    assert p.max_step == 10
    assert p.facts == ("Night.",)
    assert p.them == ("humanity",)
    assert p.unavailable == "BUSY."
    assert p.llm == {"temperature": 0.4}


@pytest.mark.parametrize(
    "text, match",
    [
        ("no frontmatter", "frontmatter"),
        ("---\ncharacter: X\n", "unterminated"),
        ("---\nvariables: a\n---\nbody", "character"),
        ("---\ncharacter: X\n---\n", "system prompt"),
        ("---\ncharacter: X\nevents: y\n---\nbody", "unknown"),
        ("---\ncharacter: X\nwhen: '&& &&'\n---\nbody", "when"),
    ],
)
def test_persona_errors(text, match):
    with pytest.raises(ConfigError, match=match):
        parse_persona(text)


def test_the_shipped_trabolta_persona_loads():
    p = load_persona(TRABOLTA)
    assert p.character == "Trabolta"
    assert set(p.variables) == {"truth", "untruth", "stance", "love"}
    assert p.when is not None


# -- prompt -------------------------------------------------------------------


def test_messages_are_system_then_the_thread():
    msgs = build_messages(parse_persona(PERSONA), request())
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    assert msgs[-1]["content"] == "Who is Sandy?"


def test_a_thread_ending_on_the_character_still_ends_on_the_speaker():
    req = request(history=[{"seq": 1, "mine": True, "from": "Trabolta", "text": "HELLO."}])
    msgs = build_messages(parse_persona(PERSONA), req)
    assert msgs[-1] == {"role": "user", "content": "Who is Sandy?"}


def test_state_block_shows_only_what_the_persona_asks_for():
    block = state_block(parse_persona(PERSONA), request())
    assert "truth=35 (0..100)" in block and "stance=0 (-100..100)" in block
    assert "Night.phase: glitch" in block and "Other.thing" not in block
    assert "Ada (a guest, group Hosts)" in block
    assert "Where they are: The Desktop" in block
    assert "Their humanity: 20" in block and "secret" not in block
    assert "They know nothing yet." in block
    assert "- The Sandy File: He wants to impress Sandy." in block


def test_state_block_names_a_performer_as_cast():
    req = request(speaker={"kind": "performer", "id": "Clippy", "name": "Clippy", "faction": None})
    assert "Clippy (a fellow character" in state_block(parse_persona(PERSONA), req)


def test_gate_context_nests_and_coerces():
    ctx = gate_context(request())
    assert ctx["self"]["glitched"] is True
    assert ctx["Night"]["phase"] == "glitch"
    assert ctx["speaker"]["kind"] == "guest"


# -- reply --------------------------------------------------------------------


def test_reply_json_is_clamped_to_declared_variables():
    r = parse_reply('{"say": "SANDY.", "adjust": {"Truth": 40, "stance": -3, "love": 5, "x": "nan"}}', ("truth", "stance"), 15)
    assert r.say == "SANDY."
    assert r.adjust == {"truth": 15, "stance": -3}


def test_reply_tolerates_think_blocks_fences_and_prose():
    raw = '<think>hmm {"say": "no"}</think>```json\n{"say": "Yes.", "adjust": {}}\n```'
    assert parse_reply(raw, (), 15).say == "Yes."
    assert parse_reply("Just words, program.", (), 15).say == "Just words, program."
    assert parse_reply('Sure! {"say": "Inside."} trailing', (), 15).say == "Inside."


def test_malformed_json_says_nothing_rather_than_braces():
    assert parse_reply('{"say": "cut off', (), 15).empty


# -- answer -------------------------------------------------------------------


def run(coro):
    return asyncio.run(coro)


def test_answer_calls_the_model_with_the_merged_config():
    seen = {}

    async def fake(messages, cfg):
        seen["cfg"] = cfg
        seen["messages"] = messages
        return '{"say": "HELLO.", "adjust": {"truth": 5}}'

    reply = run(answer(parse_persona(PERSONA), LlmConfig(temperature=0.4), request(), fake))
    assert reply.say == "HELLO." and reply.adjust == {"truth": 5}
    assert seen["cfg"].temperature == 0.4


def test_a_closed_gate_answers_unavailable_without_the_model():
    async def boom(messages, cfg):
        raise AssertionError("model must not be called")

    req = request()
    req["self"]["vars"]["glitched"] = "false"
    assert run(answer(parse_persona(PERSONA), LlmConfig(), req, boom)).say == "BUSY."
    # …but the cast always gets through.
    req["speaker"] = {"kind": "performer", "id": "Clippy", "name": "Clippy"}

    async def ok(messages, cfg):
        return '{"say": "Speak, ambassador."}'

    assert run(answer(parse_persona(PERSONA), LlmConfig(), req, ok)).say == "Speak, ambassador."


def test_model_failure_and_empty_output_fall_back():
    async def fail(messages, cfg):
        raise LlmError("down")

    async def empty(messages, cfg):
        return ""

    p = parse_persona(PERSONA)
    assert run(answer(p, LlmConfig(), request(), fail)).say == "...static..."
    assert run(answer(p, LlmConfig(), request(), empty)).say == "...static..."


# -- llm ----------------------------------------------------------------------


def test_complete_speaks_openai_chat_completions():
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        captured["body"] = json.loads(req.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"say": "ok"}', "reasoning": "…"}}]})

    cfg = LlmConfig(endpoint="http://m/v1/", model="gpt-oss:20b", reasoning_effort="low", max_tokens=800)
    text = run(complete([{"role": "user", "content": "hi"}], cfg, transport=httpx.MockTransport(handler)))
    assert text == '{"say": "ok"}'
    assert captured["url"] == "http://m/v1/chat/completions"
    assert captured["body"]["reasoning_effort"] == "low"
    assert captured["body"]["max_tokens"] == 800
    assert "response_format" not in captured["body"]


def test_complete_raises_on_http_errors():
    transport = httpx.MockTransport(lambda req: httpx.Response(500, text="nope"))
    with pytest.raises(LlmError, match="500"):
        run(complete([], LlmConfig(), transport=transport))


# -- config -------------------------------------------------------------------


def test_agents_section_resolves_personas_and_layers_model_config(tmp_path):
    (tmp_path / "t.persona.md").write_text(PERSONA, encoding="utf-8")
    cfg = parse_agents(
        {
            "name": "laptop",
            "llm": {"model": "gpt-oss:20b", "temperature": 0.9, "max_tokens": 700},
            "characters": [{"persona": "t.persona.md", "llm": {"max_tokens": 900}}],
        },
        str(tmp_path),
    )
    m = cfg.models["Trabolta"]
    assert (m.model, m.temperature, m.max_tokens) == ("gpt-oss:20b", 0.4, 900)


@pytest.mark.parametrize(
    "doc, match",
    [
        ({"characters": []}, "at least one"),
        ({"characters": ["t.persona.md"], "llm": {"modle": "x"}}, "unknown"),
        ({"characters": ["t.persona.md", "t.persona.md"]}, "already voiced"),
        ({"characters": ["missing.md"]}, "cannot read"),
        ({"characters": ["t.persona.md"], "bogus": 1}, "unknown"),
    ],
)
def test_agents_section_errors(tmp_path, doc, match):
    (tmp_path / "t.persona.md").write_text(PERSONA, encoding="utf-8")
    with pytest.raises(ConfigError, match=match):
        parse_agents(doc, str(tmp_path))


# -- the worker loop ------------------------------------------------------------


class FakeMod:
    base_url = "http://srv"

    def __init__(self):
        self.posts = []

    def path(self, p):
        return f"/e/evt{p}"

    async def post(self, p, body):
        self.posts.append((p, body))
        return {"ok": True, "applied": {}}


def worker(tmp_path, complete_fn, **section):
    (tmp_path / "t.persona.md").write_text(PERSONA, encoding="utf-8")
    cfg = parse_agents({"characters": ["t.persona.md"], **section}, str(tmp_path))
    agents = Agents(cfg, complete_fn)
    agents.mod = FakeMod()
    return agents


def test_stream_url_names_the_characters(tmp_path):
    agents = worker(tmp_path, None, name="laptop")
    assert agents.stream_url(agents.mod) == "http://srv/e/evt/api/agent/stream?characters=Trabolta&name=laptop"


def test_worker_answers_a_request_and_replies_with_its_worker_id(tmp_path):
    async def fake(messages, cfg):
        return '{"say": "SANDY.", "adjust": {"truth": 3}}'

    agents = worker(tmp_path, fake)

    async def go():
        await agents.on_frame("hello", json.dumps({"worker": "w-1", "characters": ["Trabolta"], "unknown": []}))
        await agents.on_frame("request", json.dumps(request()))
        await asyncio.gather(*agents.tasks.values())

    run(go())
    assert agents.mod.posts == [("/api/agent/reply", {"id": "ar-1", "say": "SANDY.", "adjust": {"truth": 3}, "worker": "w-1"})]
    assert agents.tasks == {}


def test_dry_run_sends_nothing(tmp_path):
    async def fake(messages, cfg):
        return '{"say": "x"}'

    agents = worker(tmp_path, fake, dry_run=True)

    async def go():
        await agents.on_frame("request", json.dumps(request()))
        await asyncio.gather(*agents.tasks.values())

    run(go())
    assert agents.mod.posts == []


def test_cancel_and_reset_abort_in_flight_work(tmp_path):

    async def slow(messages, cfg):
        await asyncio.sleep(10)
        return '{"say": "too late"}'

    agents = worker(tmp_path, slow)

    async def go():
        await agents.on_frame("request", json.dumps(request(id="a")))
        await agents.on_frame("request", json.dumps(request(id="b")))
        await asyncio.sleep(0)
        await agents.on_frame("cancel", json.dumps({"id": "a"}))
        assert list(agents.tasks) == ["b"]
        await agents.on_frame("reset", "{}")
        assert agents.tasks == {}
        await asyncio.sleep(0)

    run(go())
    assert agents.mod.posts == []


def test_concurrency_serialises_model_calls(tmp_path):
    active = 0
    peak = 0

    async def fake(messages, cfg):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return '{"say": "ok"}'

    agents = worker(tmp_path, fake, concurrency=1)

    async def go():
        for i in range(3):
            await agents.on_frame("request", json.dumps(request(id=f"r{i}")))
        await asyncio.gather(*agents.tasks.values())

    run(go())
    assert peak == 1
    assert len(agents.mod.posts) == 3


def test_requests_for_characters_this_worker_does_not_voice_are_ignored(tmp_path):
    async def fake(messages, cfg):
        raise AssertionError("not ours")

    agents = worker(tmp_path, fake)

    async def go():
        await agents.on_frame("request", json.dumps(request(character="Sandy")))
        await asyncio.gather(*agents.tasks.values())

    run(go())
    assert agents.mod.posts == []
