"""Claude as a model engine (wave 52, `api: anthropic`).

The prompt's shape, what comes back, the key, the config around a hosted
voice and the failover: a refusal moves one line and leaves the engine up.
The model is a fake client; the SDK itself is an optional extra, so the
tests that need its exception classes skip without it (`uv run --extra
anthropic pytest`, as `predeploy.sh` runs them).
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from stagehand.agents import llm
from stagehand.agents.config import OverflowEngine, parse_agents
from stagehand.agents.engines import Engines
from stagehand.agents.letter import LETTER_TIMEOUT_S, letter_model
from stagehand.agents.llm import (
    ANTHROPIC_ENDPOINT,
    WAITING_TURN,
    LlmConfig,
    LlmError,
    LlmRefused,
    LlmTruncated,
    anthropic_completion,
    anthropic_key,
    anthropic_request,
    complete,
    complete_anthropic,
)
from stagehand.agents.module import Agents
from stagehand.agents.slots import PRIMARY, Slots
from stagehand.launchd import job_plist
from stagehand.module import ConfigError

HAIKU = LlmConfig(endpoint=ANTHROPIC_ENDPOINT, model="claude-haiku-5-5", api="anthropic", reasoning_effort="low", max_tokens=1000, timeout_s=12.0)
OLLAMA = {"endpoint": "http://localhost:11434/v1", "model": "gpt-oss:20b", "api": "ollama", "api_key_env": None}

PERSONA = """---
character: Trabolta
variables: truth
fallback: Please wait.
---
You are TRABOLTA.
"""


def system(text: str) -> dict[str, str]:
    return {"role": "system", "content": text}


def user(text: str) -> dict[str, str]:
    return {"role": "user", "content": text}


def assistant(text: str) -> dict[str, str]:
    return {"role": "assistant", "content": text}


def answer(*blocks, stop="end_turn", read=0, written=0, details=None, fresh=10, out=5):
    usage = NS(input_tokens=fresh, output_tokens=out, cache_read_input_tokens=read, cache_creation_input_tokens=written)
    return NS(content=list(blocks), stop_reason=stop, stop_details=details, usage=usage)


def text(value: str) -> NS:
    return NS(type="text", text=value)


class FakeClient:
    """`client.with_options(timeout=…).messages.create(**body)`."""

    def __init__(self, reply=None):
        self.reply = reply
        self.bodies: list[dict] = []
        self.timeouts: list[float] = []
        self.messages = self

    def with_options(self, timeout):
        self.timeouts.append(timeout)
        return self

    async def create(self, **body):
        self.bodies.append(body)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def run(coro):
    return asyncio.run(coro)


# -- the prompt


def test_the_shared_head_is_cached_and_the_last_system_block_is_not():
    body = anthropic_request([system("P1"), system("P2"), system("P3"), user("hi"), system("the reminder")], HAIKU)
    assert [b["text"] for b in body["system"]] == ["P1", "P2", "P3"]
    assert ["cache_control" in b for b in body["system"]] == [True, True, False]
    assert body["system"][0]["cache_control"] == {"type": "ephemeral"}


def test_one_system_block_is_never_cached():
    assert "cache_control" not in anthropic_request([system("a letter's frame"), user("write")], HAIKU)["system"][0]


def test_the_system_lines_after_the_turns_go_last_as_one_message():
    body = anthropic_request([system("P1"), user("hi"), assistant("Program."), user("hello"), system("NOW"), system("STEER"), system("REMINDER")], HAIKU)
    assert body["messages"] == [user("hi"), assistant("Program."), user("hello"), system("NOW\n\nSTEER\n\nREMINDER")]


def test_the_lookup_round_never_ends_on_his_own_json():
    body = anthropic_request([system("P1"), user("who is she?"), assistant('{"lookup": ["x"]}'), system("LOOKUP RESULTS"), system("REMINDER")], HAIKU)
    assert body["messages"][-2:] == [assistant('{"lookup": ["x"]}'), user("LOOKUP RESULTS\n\nREMINDER")]
    assert anthropic_request([user("hi"), assistant("Yes?")], HAIKU)["messages"][-1] == user(WAITING_TURN)


def test_a_prompt_with_no_turn_or_opening_on_his_own_line_gets_a_user_turn_first():
    assert anthropic_request([system("P1")], HAIKU)["messages"] == [user(WAITING_TURN)]
    assert anthropic_request([system("P1"), assistant("Program."), user("yes?")], HAIKU)["messages"][0] == user(WAITING_TURN)


def test_an_empty_turn_is_dropped():
    assert anthropic_request([system(" "), user("hi"), assistant(""), user("there")], HAIKU) == {
        "model": "claude-haiku-5-5",
        "max_tokens": 1000,
        "messages": [user("hi"), user("there")],
        "output_config": {"effort": "low"},
    }


def test_temperature_is_never_sent_and_extra_goes_through():
    from dataclasses import replace

    body = anthropic_request([user("hi")], replace(HAIKU, temperature=1.2, extra={"thinking": {"type": "disabled"}}))
    assert "temperature" not in json.dumps(body)
    assert body["extra_body"] == {"thinking": {"type": "disabled"}}
    assert "output_config" not in anthropic_request([user("hi")], replace(HAIKU, reasoning_effort=None))


# -- what comes back


def test_the_blocks_are_read_by_their_type():
    done = anthropic_completion(answer(NS(type="thinking", thinking="He is stalling."), NS(type="thinking", thinking=""), text('{"say": '), text('"Program."}')), HAIKU, 42)
    assert (done.content, done.thinking, done.finish, done.ms) == ('{"say": "Program."}', "He is stalling.", "stop", 42)


def test_every_input_token_is_counted_and_the_cached_ones_are_named():
    done = anthropic_completion(answer(text("x"), fresh=100, read=9000, written=900, out=30), HAIKU, 1)
    assert (done.prompt_tokens, done.cached_tokens, done.completion_tokens) == (10_000, 9000, 30)


def test_a_refusal_is_an_http_200_with_its_own_error():
    with pytest.raises(LlmRefused, match="cyber"):
        anthropic_completion(answer(stop="refusal", details=NS(category="cyber")), HAIKU, 1)
    with pytest.raises(LlmRefused, match="no category"):
        anthropic_completion(answer(stop="refusal"), HAIKU, 1)
    assert issubclass(LlmRefused, LlmError) and not issubclass(LlmRefused, LlmTruncated)


def test_thinking_that_eats_the_budget_is_a_truncation_and_a_cut_answer_is_not():
    with pytest.raises(LlmTruncated):
        anthropic_completion(answer(NS(type="thinking", thinking="…"), stop="max_tokens"), HAIKU, 1)
    assert anthropic_completion(answer(text("Half a"), stop="max_tokens"), HAIKU, 1).finish == "length"


# -- the call


def test_a_call_carries_its_timeout():
    pytest.importorskip("anthropic")
    client = FakeClient(answer(text("Program.")))
    done = run(complete_anthropic([user("hi")], HAIKU, client))
    assert done.content == "Program." and client.timeouts == [12.0] and client.bodies[0]["model"] == "claude-haiku-5-5"


def test_complete_routes_the_dialect(monkeypatch):
    pytest.importorskip("anthropic")
    client = FakeClient(answer(text("Program.")))
    monkeypatch.setattr(llm, "_anthropic_client", lambda cfg: client)
    assert run(complete([user("hi")], HAIKU)).content == "Program."


def test_the_sdk_s_errors_are_llm_errors_and_never_carry_the_key(monkeypatch):
    anthropic = pytest.importorskip("anthropic")
    httpx2 = pytest.importorskip("httpx2")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-the-secret")
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    limited = anthropic.RateLimitError("slow down sk-the-secret", response=httpx2.Response(429, request=request), body=None)
    with pytest.raises(LlmError, match="HTTP 429") as err:
        run(complete_anthropic([user("hi")], HAIKU, FakeClient(limited)))
    assert "sk-the-secret" not in str(err.value)
    with pytest.raises(LlmError, match="unreachable"):
        run(complete_anthropic([user("hi")], HAIKU, FakeClient(anthropic.APIConnectionError(request=request))))
    with pytest.raises(LlmError, match="unreachable"):
        run(complete_anthropic([user("hi")], HAIKU, FakeClient(anthropic.APITimeoutError(request=request))))


def test_no_sdk_is_an_llm_error_not_a_crash(monkeypatch):
    monkeypatch.setitem(sys.modules, "anthropic", None)
    with pytest.raises(LlmError, match="--extra anthropic"):
        run(complete_anthropic([user("hi")], HAIKU))


def test_no_key_is_an_llm_error(monkeypatch, tmp_path):
    pytest.importorskip("anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(llm, "ANTHROPIC_KEY_FILE", tmp_path / "none")
    with pytest.raises(LlmError, match="no key"):
        run(complete_anthropic([user("hi")], HAIKU))


def test_the_key_comes_from_the_named_variable_then_the_default_then_the_file(monkeypatch, tmp_path):
    from dataclasses import replace

    keyfile = tmp_path / "anthropic.key"
    monkeypatch.setattr(llm, "ANTHROPIC_KEY_FILE", keyfile)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("TRABOLTA_KEY", raising=False)
    assert anthropic_key(HAIKU) == ""
    keyfile.write_text("from-the-file\n", encoding="utf-8")
    assert anthropic_key(HAIKU) == "from-the-file"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "from-the-default")
    assert anthropic_key(HAIKU) == "from-the-default"
    monkeypatch.setenv("TRABOLTA_KEY", "from-the-name")
    assert anthropic_key(replace(HAIKU, api_key_env="TRABOLTA_KEY")) == "from-the-name"


# -- the config around a hosted voice


def agents(tmp_path: Path, **section) -> Agents:
    (tmp_path / "t.persona.md").write_text(PERSONA, encoding="utf-8")
    return Agents(parse_agents({"characters": ["t.persona.md"], "llm": {"api": "anthropic", "model": "claude-haiku-5-5", "reasoning_effort": "low"}, **section}, str(tmp_path)))


def test_the_endpoint_defaults_to_anthropic_s(tmp_path):
    cfg = agents(tmp_path).cfg
    assert cfg.llm.endpoint == ANTHROPIC_ENDPOINT and cfg.llm.num_ctx is None


def test_the_orchestrator_of_a_hosted_voice_stays_on_this_machine_without_the_key(tmp_path):
    cfg = agents(tmp_path, llm={"api": "anthropic", "model": "claude-haiku-5-5", "api_key_env": "ANTHROPIC_API_KEY"}).cfg
    om = cfg.orchestrator_models["Trabolta"]
    assert (om.endpoint, om.api, om.api_key_env) == (LlmConfig.endpoint, "ollama", None)


def test_an_unknown_api_fails_at_load(tmp_path):
    with pytest.raises(ConfigError, match="anthropic"):
        agents(tmp_path, llm={"api": "bedrock"})


def test_an_ollama_standby_takes_nothing_of_the_hosted_voice_s(tmp_path):
    cfg = agents(tmp_path, overflow=[{"name": "macbook", "capacity": 4, **{k: v for k, v in OLLAMA.items() if v}, "temperature": 0.9}]).cfg
    m = cfg.overflow[0].model(cfg.llm)
    assert (m.api, m.endpoint, m.api_key_env, m.num_ctx) == ("ollama", OLLAMA["endpoint"], None, 32768)


def test_a_primary_that_fills_the_stream_keeps_its_overflow_as_a_standby(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    standby = [{"name": "macbook", "capacity": 4, **{k: v for k, v in OLLAMA.items() if v}}]
    full = agents(tmp_path, concurrency=16, overflow=standby)
    assert full.capacity == 16 and not any("may announce" in w for w in full.warnings())
    assert any("may announce" in w for w in agents(tmp_path, concurrency=15, overflow=standby).warnings())


def test_check_says_a_hosted_voice_leaves_the_house_and_never_prints_the_key(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-the-secret")
    a = agents(tmp_path, concurrency=16, overflow=[{"name": "macbook", "capacity": 4, **{k: v for k, v in OLLAMA.items() if v}}])
    lines = "\n".join(a.describe())
    assert "leave the house" in lines and "key set" in lines and "sk-the-secret" not in lines
    assert "OLLAMA_NUM_PARALLEL >= 16" not in lines  # the hosted primary is not Ollama's


def test_check_warns_when_there_is_no_key(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(llm, "ANTHROPIC_KEY_FILE", tmp_path / "none")
    assert any("has no key" in w for w in agents(tmp_path).warnings())


def test_a_letter_gets_longer_than_a_hosted_voice_line():
    from dataclasses import replace

    assert letter_model(HAIKU).timeout_s == LETTER_TIMEOUT_S > HAIKU.timeout_s
    assert letter_model(replace(HAIKU, timeout_s=90.0)).timeout_s == 90.0


def test_only_the_agents_job_asks_for_the_sdk():
    for job, wanted in (("agents", True), ("show", False), ("lights", False), ("audio", False)):
        args = job_plist(job, Path("/h/x.yaml"), stagehand_dir=Path("/s"), uv="/u/uv", log_dir=Path("/l"), path_env="")["ProgramArguments"]
        assert ("--extra" in args) is wanted


# -- the failover


class Scripted:
    """A complete_fn: one list of results per engine, by model name."""

    def __init__(self, **by_model):
        self.by_model = by_model
        self.calls: list[LlmConfig] = []

    async def __call__(self, messages, cfg):
        self.calls.append(cfg)
        result = self.by_model[cfg.model.split(":")[0].replace("-", "_")].pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def engines(fn) -> Engines:
    standby = OverflowEngine(name="macbook", capacity=4, overrides=dict(OLLAMA))
    cfg = NS(overflow=(standby,), engines=[(PRIMARY, 16), ("macbook", 4)])
    return Engines(cfg, fn, Slots(engines=cfg.engines))


def through(e: Engines, primary_only=False, change=None):
    async def go():
        async with e.call(primary_only=primary_only) as call:
            model = call.bind(HAIKU)
            return await call.complete([user("hi")], change(model) if change else model)

    return run(go())


def test_a_refusal_moves_the_line_and_leaves_the_engine_up():
    fn = Scripted(claude_haiku_5_5=[LlmRefused("declined (cyber)")], gpt_oss=["Ollama's line."])
    e = engines(fn)
    assert through(e) == "Ollama's line."
    assert not e.slots.is_down(PRIMARY)
    assert [c.model for c in fn.calls] == ["claude-haiku-5-5", "gpt-oss:20b"]


def test_an_outage_marks_the_engine_down_and_the_line_moves_the_same_way():
    fn = Scripted(claude_haiku_5_5=[LlmError("HTTP 529")], gpt_oss=["Ollama's line."])
    e = engines(fn)
    assert through(e) == "Ollama's line."
    assert e.slots.is_down(PRIMARY)


def test_the_moved_line_keeps_the_call_s_own_settings_on_ollama():
    from dataclasses import replace

    fn = Scripted(claude_haiku_5_5=[LlmRefused("declined")], gpt_oss=["ok"])
    through(engines(fn), change=lambda m: replace(m, temperature=0.1))
    assert (fn.calls[1].api, fn.calls[1].temperature, fn.calls[1].api_key_env) == ("ollama", 0.1, None)


def test_a_refusal_on_a_primary_only_call_raises_and_the_engine_stays_up():
    e = engines(Scripted(claude_haiku_5_5=[LlmRefused("declined")]))
    with pytest.raises(LlmRefused):
        through(e, primary_only=True)
    assert not e.slots.is_down(PRIMARY)


def test_a_refusal_on_both_engines_raises_for_the_persona_s_fallback():
    with pytest.raises(LlmRefused):
        through(engines(Scripted(claude_haiku_5_5=[LlmRefused("one")], gpt_oss=[LlmRefused("two")])))
