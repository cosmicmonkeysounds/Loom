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
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user", "system"]
    assert msgs[-2]["content"] == "Who is Sandy?"
    # The reply format is restated last, with every declared variable.
    assert '"adjust": {"truth": 0, "stance": 0}' in msgs[-1]["content"]


def test_a_thread_ending_on_the_character_still_ends_on_the_speaker():
    req = request(history=[{"seq": 1, "mine": True, "from": "Trabolta", "text": "HELLO."}])
    msgs = build_messages(parse_persona(PERSONA), req)
    assert msgs[-2] == {"role": "user", "content": "Who is Sandy?"}


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


# -- the mind-era protocol: powers, lookups, acts -------------------------------------

from stagehand.agents.facts import Facts  # noqa: E402
from stagehand.agents.mind import Mind  # noqa: E402

POWERS = [
    {"id": "cut the lights", "label": "Cut the lights", "description": "args: room", "limit": 2, "used": 1},
    {"id": "snoop", "label": "Snoop", "description": None, "limit": 6, "used": 6},
]
FACTS = Facts(
    {
        "world": {"Night.phase": "free_roam"},
        "programs": [{"id": "g2", "name": "Microsoft Excel", "faction": None, "groups": [], "location": "The Cache", "captured": False, "vars": {"truth": "12"}, "codex": []}],
        "characters": [],
        "locations": [{"id": "The Cache", "label": "The Cache (kitchen)", "occupants": ["Microsoft Excel"]}],
        "codex": [],
        "powers": POWERS,
    }
)


def test_the_prompt_carries_the_mind_powers_and_the_optional_fields():
    persona = parse_persona(PERSONA)
    mind = Mind("Trabolta", "e")
    mind.saw_exchange("g-1", "Ada", "guest", "dm:Trabolta|g-1", 3)
    mind.apply({"brief": "Court Ada.", "person": {"trust": 80}}, speaker_id="g-1")
    msgs = build_messages(persona, request(powers=POWERS), mind=mind)
    system = msgs[0]["content"]
    assert "=== YOUR MIND TONIGHT" in system and "Right now: Court Ada." in system
    assert "Ada (a guest; you have spoken 1 time; your trust in them 80/100)" in system
    assert "=== WHAT YOU CAN DO BESIDES TALK ===" in system and "LOOKUP:" in system
    assert "- cut the lights: args: room [1 of 2 left tonight]" in system and "- snoop: Snoop [0 of 6 left tonight]" in system
    assert "BARGAINS are rare" in system
    tail = msgs[-1]["content"]
    assert '"lookup": [' in tail and '"act": {"share"' in tail
    # Without a mind (the persona alone) the old shape holds — no mind block, no pacing.
    plain = build_messages(persona, request())
    assert "YOUR MIND" not in plain[0]["content"] and "LOOKUP:" in plain[0]["content"]


def test_powers_can_be_narrowed_or_switched_off_by_the_persona():
    narrowed = parse_persona(PERSONA.replace("them: humanity", "them: humanity\npowers: snoop\nlookup: false"))
    system = build_messages(narrowed, request(powers=POWERS))[0]["content"]
    assert "- snoop:" in system and "- cut the lights:" not in system and "LOOKUP:" not in system
    none = parse_persona(PERSONA.replace("them: humanity", "them: humanity\npowers: none\nlookup: false"))
    assert "WHAT YOU CAN DO" not in build_messages(none, request(powers=POWERS))[0]["content"]


def test_a_long_thread_is_shown_as_summary_plus_window_and_pacing_kicks_in():
    persona = parse_persona(PERSONA.replace("them: humanity", "them: humanity\nthread_window: 4"))
    mind = Mind("Trabolta", "e")
    key = "dm:Trabolta|g-1"
    for i in range(30):
        mind.saw_exchange("g-1", "Ada", "guest", key, i)
    mind.apply({"thread_summary": "Ada and Trabolta discussed Sandy at length."}, speaker_id="g-1", thread_key=key, upto=30)
    history = [{"seq": i, "mine": i % 2 == 1, "from": "x", "text": f"l{i}"} for i in range(1, 21)]
    msgs = build_messages(persona, request(history=history, text="l20"), mind=mind)
    roles = [m["role"] for m in msgs]
    assert roles[1] == "system" and msgs[1]["content"].startswith("Earlier in this conversation")
    assert [m["content"] for m in msgs if m["role"] in ("user", "assistant")] == ["l17", "l18", "l19", "l20"]
    assert "PACING: you have spoken with them 30 times" in msgs[-1]["content"]


def test_reply_parses_lookups_and_validates_acts_against_powers_and_codex():
    r = parse_reply('{"lookup": ["Excel", " the cache ", "x", "y"]}', ("truth",), 15, POWERS, ("The Sandy File",))
    assert r.lookup == ("Excel", "the cache", "x") and r.wants_lookup and not r.empty
    r = parse_reply(
        '{"say": "Done.", "act": [{"fire": "Cut The Lights", "args": {"room": "the kitchen", "n": 2}}, {"fire": "snoop", "args": {"target": "g2"}}, {"fire": "explode"}, {"share": "the sandy file"}, {"share": "Unknown"}]}',
        ("truth",),
        15,
        POWERS,
        ("The Sandy File",),
    )
    # snoop is exhausted, explode undeclared, Unknown not held; at most two acts.
    assert list(r.acts) == [{"kind": "fire", "name": "cut the lights", "args": {"room": "the kitchen", "n": 2}}, {"kind": "share", "entry": "The Sandy File"}]
    assert parse_reply('{"say": "x", "act": {"share": "The Sandy File"}}', (), 15, (), ()).acts == ()
    assert parse_reply('<think>{"say": "leak"}', (), 15).say == ""  # an unterminated think block is not a line


def test_answer_runs_one_lookup_round_and_canonicalises_act_args(tmp_path):
    seen = []

    async def fake(messages, cfg):
        seen.append(messages)
        if len(seen) == 1:
            return '{"lookup": ["Excel"]}'
        return '{"say": "Excel is in the kitchen. The lights there are now off.", "adjust": {"truth": 2}, "act": {"fire": "cut the lights", "args": {"room": "kitchen"}}}'

    persona = parse_persona(PERSONA)
    reply = run(answer(persona, LlmConfig(), request(powers=POWERS), fake, gate=False, facts=FACTS))
    assert len(seen) == 2
    second = seen[1]
    assert second[-3]["role"] == "assistant" and second[-3]["content"] == '{"lookup": ["Excel"]}'
    assert second[-2]["content"].startswith("LOOKUP RESULTS") and "Microsoft Excel (program id g2) · currently in The Cache" in second[-2]["content"]
    assert "No further lookups" in second[-2]["content"] and '"lookup"' not in second[-1]["content"]
    assert reply.say.startswith("Excel is in the kitchen") and reply.adjust == {"truth": 2} and reply.lookup == ("Excel",)
    assert list(reply.acts) == [{"kind": "fire", "name": "cut the lights", "args": {"room": "The Cache"}}]

    # With a lookup power, every program looked up feels it (deterministically).
    seen.clear()
    felt = parse_persona(PERSONA.replace("them: humanity", "them: humanity\nlookup_power: SNOOP"))
    snoopable = [dict(POWERS[0]), {**POWERS[1], "used": 0}]
    reply = run(answer(felt, LlmConfig(), request(powers=snoopable), fake, gate=False, facts=FACTS))
    assert list(reply.acts) == [{"kind": "fire", "name": "cut the lights", "args": {"room": "The Cache"}}, {"kind": "fire", "name": "snoop", "args": {"target": "g2"}}]
    # …but not when the power is exhausted, and never for a room or for the speaker themselves.
    seen.clear()
    reply = run(answer(felt, LlmConfig(), request(powers=POWERS), fake, gate=False, facts=FACTS))
    assert [a["name"] for a in reply.acts] == ["cut the lights"]

    # A lookup with no session to ask falls back instead of going silent.
    async def wants(messages, cfg):
        return '{"lookup": ["Excel"]}'

    assert run(answer(persona, LlmConfig(), request(), wants, gate=False)).say == "...static..."


def test_the_worker_sends_acts_reflects_and_mirrors_the_mind(tmp_path):
    calls = []

    async def fake(messages, cfg):
        calls.append(cfg.model)
        if cfg.model == "orch":
            return '{"brief": "Be kind to Ada.", "person": {"trust": 70}}'
        return '{"say": "SANDY.", "adjust": {"truth": 3}, "act": {"fire": "cut the lights", "args": {"room": "The Cache"}}}'

    agents = worker(tmp_path, fake, orchestrator={"llm": {"model": "orch"}, "quiet_s": 0, "survey_every_s": 0}, state_dir=str(tmp_path / "minds"))
    agents.event = "evt"

    async def go():
        agents._orchestrator_task = asyncio.ensure_future(agents.orchestrator.run())
        await agents.on_frame("hello", json.dumps({"worker": "w-1", "characters": ["Trabolta"], "unknown": []}))
        await agents.on_frame("request", json.dumps(request(powers=POWERS)))
        await asyncio.gather(*agents.tasks.values())
        for _ in range(200):
            if any(p == "/api/agent/mind" for p, _ in agents.mod.posts):
                break
            await asyncio.sleep(0.01)
        agents._orchestrator_task.cancel()
        await asyncio.gather(agents._orchestrator_task, return_exceptions=True)

    run(go())
    paths = [p for p, _ in agents.mod.posts]
    assert paths[0] == "/api/agent/reply"
    reply_body = agents.mod.posts[0][1]
    assert reply_body["acts"] == [{"kind": "fire", "name": "cut the lights", "args": {"room": "The Cache"}}] and reply_body["worker"] == "w-1"
    assert "/api/agent/mind" in paths
    mirror = dict(agents.mod.posts)["/api/agent/mind"]
    assert mirror["character"] == "Trabolta" and mirror["brief"] == "Be kind to Ada." and mirror["people"][0]["trust"] == 70
    mind = agents.minds["Trabolta"]
    assert mind.exchanges == 1 and mind.people["g-1"].turns == 1
    # Persisted per event + character; a reset empties it (and the file).
    saved = tmp_path / "minds" / "evt" / "Trabolta.mind.json"
    assert saved.exists() and json.loads(saved.read_text())["brief"] == "Be kind to Ada."
    run(agents.on_frame("reset", "{}"))
    assert mind.brief == "" and json.loads(saved.read_text())["exchanges"] == 0
    assert calls.count("orch") >= 1  # the survey on hello + the reflection


def test_describe_mentions_the_mind(tmp_path):
    agents = worker(tmp_path, None)
    text = "\n".join(agents.describe())
    assert "mind   :" in text and "tobestyledintro/qwen3.8-9b-distill:q8_0" in text and "minds    :" in text
    off = worker(tmp_path, None, orchestrator={"enabled": False})
    assert "mind   :" not in "\n".join(off.describe())


def test_orchestrator_config_errors(tmp_path):
    (tmp_path / "t.persona.md").write_text(PERSONA, encoding="utf-8")
    with pytest.raises(ConfigError, match="unknown key"):
        parse_agents({"characters": ["t.persona.md"], "orchestrator": {"bogus": 1}}, str(tmp_path))
    with pytest.raises(ConfigError, match="mind file"):
        parse_persona(PERSONA.replace("them: humanity", "them: humanity\nmind: missing.md"), str(tmp_path / "t.persona.md"))


def test_complete_speaks_ollama_native_when_asked():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"message": {"role": "assistant", "content": '{"brief": "b"}', "thinking": ""}})

    cfg = LlmConfig(endpoint="http://localhost:11434/v1", model="qwen", api="ollama", extra={"think": False}, keep_alive="30m", max_tokens=222, temperature=0.4)
    out = run(complete([{"role": "user", "content": "hi"}], cfg, transport=httpx.MockTransport(handler)))
    assert out == '{"brief": "b"}'
    assert seen["url"] == "http://localhost:11434/api/chat"
    assert seen["body"]["think"] is False and seen["body"]["keep_alive"] == "30m" and seen["body"]["stream"] is False
    assert seen["body"]["options"] == {"temperature": 0.4, "num_predict": 222}
    # gpt-oss takes the effort word as its think level; other reasoning models a bool.
    gpt = LlmConfig(model="gpt-oss:20b", api="ollama", reasoning_effort="low")
    run(complete([{"role": "user", "content": "hi"}], gpt, transport=httpx.MockTransport(handler)))
    assert seen["body"]["think"] == "low"


def test_the_orchestrator_defaults_to_the_native_api(tmp_path):
    agents = worker(tmp_path, None)
    om = agents.cfg.orchestrator_models["Trabolta"]
    assert (om.api, om.extra, om.keep_alive, om.model) == ("ollama", {"think": False}, "30m", "tobestyledintro/qwen3.8-9b-distill:q8_0")
    assert agents.cfg.models["Trabolta"].api == "openai"
    with pytest.raises(ConfigError, match="api must be"):
        worker(tmp_path, None, llm={"api": "grpc"})


def test_tool_calls_are_folded_back_into_the_reply_json():
    from stagehand.agents.llm import tool_calls_as_json

    # gpt-oss via the OpenAI shim: arguments as a JSON string.
    msg = {"content": "", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "lookup", "arguments": '{"names": ["Microsoft Excel", "The Cache"]}'}}]}
    assert json.loads(tool_calls_as_json(msg)) == {"lookup": ["Microsoft Excel", "The Cache"]}
    # Ollama native: arguments as an object; a power called by its own name; a say.
    msg = {"content": "", "tool_calls": [
        {"function": {"name": "cut_the_lights", "arguments": {"room": "The Cache"}}},
        {"function": {"name": "say", "arguments": {"text": "Done.", "adjust": {"truth": 3}}}},
        {"function": {"name": "share", "arguments": {"title": "The Sandy File"}}},
    ]}
    assert json.loads(tool_calls_as_json(msg)) == {"act": [{"fire": "cut the lights", "args": {"room": "The Cache"}}, {"share": "The Sandy File"}], "say": "Done.", "adjust": {"truth": 3}}
    assert tool_calls_as_json({"content": "hi"}) == ""
    # What gpt-oss actually does: the whole reply object as the arguments of a function called "assistant".
    msg = {"content": "", "tool_calls": [{"id": "c", "type": "function", "function": {"name": "assistant", "arguments": '{"say": "Done.", "adjust": {"truth": 2}, "act": {"fire": "snoop", "args": {"target": "g2"}}}'}}]}
    assert json.loads(tool_calls_as_json(msg)) == {"say": "Done.", "adjust": {"truth": 2}, "act": {"fire": "snoop", "args": {"target": "g2"}}}

    def handler(request: httpx.Request):
        return httpx.Response(200, json={"choices": [{"finish_reason": "tool_calls", "message": {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "lookup", "arguments": '{"name": "Excel"}'}}]}}]})

    out = run(complete([{"role": "user", "content": "hi"}], LlmConfig(), transport=httpx.MockTransport(handler)))
    reply = parse_reply(out, (), 15)
    assert reply.lookup == ("Excel",) and reply.wants_lookup


def test_truncation_is_reported_and_retried_with_room():
    from stagehand.agents.llm import LlmTruncated

    calls = []

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        calls.append(body["max_tokens"])
        if len(calls) == 1:
            return httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"role": "assistant", "content": ""}}]})
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": '{"say": "SANDY."}'}}]})

    with pytest.raises(LlmTruncated):
        run(complete([{"role": "user", "content": "hi"}], LlmConfig(max_tokens=100), transport=httpx.MockTransport(handler)))

    async def fake(messages, cfg):
        return await complete(messages, cfg, transport=httpx.MockTransport(handler))

    calls.clear()
    reply = run(answer(parse_persona(PERSONA), LlmConfig(max_tokens=100), request(), fake, gate=False))
    assert reply.say == "SANDY." and calls == [100, 700]
