"""More compute for one mind: overflow engines (wave 42b, B3).

`agents.overflow` adds model servers to the same worker. The stream
announces every engine's slots together; a line takes the primary first,
then each overflow engine in order; an engine that errors is skipped for
30 s and the call is retried once on another; the warm head stays on the
engine of the main call and only on Ollama; a summary and a letter stay on
the primary; the trace says which engine served each thought. Every model
server here is an `httpx.MockTransport`.
"""

from __future__ import annotations

import asyncio
import json
import logging
from urllib.parse import urlparse

import httpx
import pytest

from stagehand.agents.config import OverflowEngine, parse_agents
from stagehand.agents.llm import LlmConfig, complete
from stagehand.agents.module import Agents, leaves_the_house
from stagehand.agents.slots import BACKGROUND, NORMAL, PRIMARY, Slots
from stagehand.module import ConfigError

PERSONA = """---
character: Trabolta
variables: truth
fallback: Please wait.
---
You are TRABOLTA.
"""

MIND = """---
stages: [asleep, formal, hungry]
phases:
  hunt_1:
    stage: hungry
    brief: >-
      Ask for facts.
---
You keep the mind.
"""

SAY = json.dumps({"say": "Your file is open on my desk.", "adjust": {"truth": 1}})


class Server:
    """One fake model server: answers Ollama's /api/chat or the OpenAI
    shim's /chat/completions, records every request, fails on demand."""

    def __init__(self, name: str, say: str = SAY):
        self.name = name
        self.say = say
        self.calls: list[dict] = []
        self.fail: str | None = None  # "500" | "down" | None
        self.hold: asyncio.Event | None = None

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    async def handle(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.calls.append({"path": request.url.path, "body": body, "headers": dict(request.headers)})
        if self.hold is not None:
            await self.hold.wait()
        if self.fail == "down":
            raise httpx.ConnectError("connection refused", request=request)
        if self.fail == "500":
            return httpx.Response(500, text="the model server fell over")
        ollama = request.url.path.endswith("/api/chat")
        budget = (body.get("options") or {}).get("num_predict") if ollama else body.get("max_tokens")
        if budget == 1:  # the warm head: cut short by design
            if ollama:
                return httpx.Response(200, json={"message": {"content": ""}, "done_reason": "length"})
            return httpx.Response(200, json={"choices": [{"message": {"content": ""}, "finish_reason": "length"}]})
        if ollama:
            return httpx.Response(200, json={"message": {"content": self.say}, "done_reason": "stop", "prompt_eval_count": 10, "eval_count": 5})
        return httpx.Response(200, json={"choices": [{"message": {"content": self.say}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}})

    def mains(self) -> list[dict]:
        """The calls that were not a warm head."""
        out = []
        for c in self.calls:
            b = c["body"]
            budget = (b.get("options") or {}).get("num_predict") if "options" in b else b.get("max_tokens")
            if budget != 1:
                out.append(c)
        return out

    def warms(self) -> list[dict]:
        return [c for c in self.calls if c not in self.mains()]


class Net:
    """The house's model servers by host:port; `complete` is the worker's complete_fn."""

    def __init__(self, *servers: tuple[str, Server]):
        self.by_host = dict(servers)

    async def complete(self, messages, cfg: LlmConfig):
        host = urlparse(cfg.endpoint).netloc
        return await complete(messages, cfg, transport=self.by_host[host].transport())


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

    def of(self, path):
        return [b for p, b in self.posts if p == path]

    def thoughts(self):
        return [t for b in self.of("/api/agent/trace") for t in b["thoughts"]]


PRIMARY_LLM = {"endpoint": "http://primary:11434/v1", "api": "ollama", "model": "gpt-oss:20b"}


def make(tmp_path, net: Net, overflow: list[dict] | None = None, llm: dict | None = None, **section) -> Agents:
    (tmp_path / "t.persona.md").write_text(PERSONA, encoding="utf-8")
    (tmp_path / "t.mind.md").write_text(MIND, encoding="utf-8")
    doc = {"characters": ["t.persona.md"], "state_dir": "minds", "mind_mode": "new", "llm": llm or dict(PRIMARY_LLM), **section}
    if overflow is not None:
        doc["overflow"] = overflow
    agents = Agents(parse_agents(doc, str(tmp_path)), net.complete)
    agents.mod = FakeMod()
    agents.event = "evt"
    agents.worker = "w-1"
    return agents


def req(rid: str, pid: str = "g-1", name: str = "Ada", **extra) -> dict:
    doc = {
        "id": rid,
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": [pid]},
        "speaker": {"kind": "guest", "id": pid, "name": name},
        "text": "hello",
        "history": [{"seq": 1, "mine": False, "from": name, "text": "hello"}],
        "self": {"vars": {"truth": "40"}, "ranges": {"truth": [0, 100]}, "codex": []},
        "them": {"vars": {}, "codex": []},
        "world": {"Night.phase": "hunt_1"},
        "powers": [],
    }
    doc.update(extra)
    return doc


def run(coro):
    return asyncio.run(coro)


def voice_thoughts(agents):
    return [t for t in agents.mod.thoughts() if t["kind"] == "voice"]


OVERFLOW = {"name": "overflow", "endpoint": "http://overflow:11434/v1", "capacity": 2, "api": "ollama"}


# -- config -------------------------------------------------------------------------------


def test_the_announced_capacity_is_every_engine_s_slots(tmp_path):
    net = Net()
    agents = make(tmp_path, net, overflow=[OVERFLOW, {"name": "cloud", "endpoint": "https://models.example/v1", "capacity": 3, "api": "openai"}], concurrency=2)
    assert agents.cfg.engines == [(PRIMARY, 2), ("overflow", 2), ("cloud", 3)]
    assert agents.capacity == 7
    assert "capacity=7" in agents.stream_url(agents.mod)
    # The stream may say 16 at most; the slots are what the YAML says.
    big = make(tmp_path, net, overflow=[{"name": "a", "endpoint": "http://a/v1", "capacity": 16}], concurrency=4)
    assert big.capacity == 16 and big._slots.capacity == 20
    assert any("at most 16" in w for w in big.warnings())
    # No overflow: the capacity is the concurrency, as in wave 42.
    assert make(tmp_path, net, concurrency=3).capacity == 3


@pytest.mark.parametrize(
    "entry, words",
    [
        ({"name": "x", "endpoint": "http://x/v1", "capacity": 0}, "capacity must be a whole number of slots from 1 to 16"),
        ({"name": "x", "endpoint": "http://x/v1", "capacity": 17}, "capacity must be"),
        ({"name": "x", "endpoint": "http://x/v1", "capacity": "two"}, "capacity must be"),
        ({"name": "x", "endpoint": "http://x/v1", "capacity": True}, "capacity must be"),
        ({"name": "x", "capacity": 1}, "needs an endpoint"),
        ({"name": "x", "endpoint": "", "capacity": 1}, "needs an endpoint"),
        ({"name": "x", "endpoint": "overflow:11434", "capacity": 1}, "needs an endpoint"),
        ({"endpoint": "http://x/v1"}, "needs a name"),
        ({"name": "primary", "endpoint": "http://x/v1"}, "is taken"),
        ({"name": "x", "endpoint": "http://x/v1", "json_mode": True}, "unknown key(s) json_mode"),
        ({"name": "x", "endpoint": "http://x/v1", "api": "grpc"}, "api must be"),
        ({"name": "x", "endpoint": "http://x/v1", "api_key_env": "sk-live 1234"}, "the NAME of an environment variable"),
        ({"name": "x", "endpoint": "http://x/v1", "temperature": "hot"}, "agents.overflow[x]"),
    ],
)
def test_a_bad_overflow_entry_fails_at_load(tmp_path, entry, words):
    with pytest.raises(ConfigError) as err:
        make(tmp_path, Net(), overflow=[entry])
    assert words in str(err.value)


def test_overflow_must_be_a_list_of_distinct_names(tmp_path):
    with pytest.raises(ConfigError, match="a list of engines"):
        make(tmp_path, Net(), overflow={"name": "x"})  # type: ignore[arg-type]
    with pytest.raises(ConfigError, match="is taken"):
        make(tmp_path, Net(), overflow=[{"name": "x", "endpoint": "http://a/v1"}, {"name": "x", "endpoint": "http://b/v1"}])


def test_an_engine_sets_its_own_fields_over_the_character_s_and_never_inherits_a_key():
    base = LlmConfig(endpoint="https://hosted.example/v1", model="gpt-oss:20b", api="openai", temperature=0.7, api_key_env="PRIMARY_KEY", max_tokens=1000)
    lan = OverflowEngine("lan", 1, {"endpoint": "http://192.168.8.10:11434/v1", "api": "ollama", "api_key_env": None})
    m = lan.model(base)
    assert (m.endpoint, m.api, m.model, m.temperature, m.max_tokens) == ("http://192.168.8.10:11434/v1", "ollama", "gpt-oss:20b", 0.7, 1000)
    assert m.api_key_env is None  # the primary's key never goes to another host
    assert m.num_ctx == 32768  # an ollama engine gets the voice's context
    cloud = OverflowEngine("cloud", 1, {"endpoint": "https://other.example/v1", "api": "openai", "num_ctx": 8192, "api_key_env": "CLOUD_KEY"})
    assert cloud.model(LlmConfig(api="ollama", num_ctx=32768)).num_ctx is None  # an openai engine sends none
    assert cloud.api_key_env == "CLOUD_KEY"


def test_parsing_keeps_only_the_fields_an_entry_names(tmp_path):
    agents = make(tmp_path, Net(), overflow=[{"name": "lan", "endpoint": " http://lan:11434/v1 ", "capacity": 2, "temperature": 0.5, "num_ctx": 0}])
    (e,) = agents.cfg.overflow
    assert e.overrides == {"endpoint": "http://lan:11434/v1", "temperature": 0.5, "num_ctx": None, "api_key_env": None}
    m = e.model(agents.models["Trabolta"])
    assert m.model == "gpt-oss:20b" and m.api == "ollama" and m.num_ctx is None  # num_ctx 0: the server's default


# -- the slots ---------------------------------------------------------------------------------


def test_the_primary_first_then_each_overflow_in_order_then_whoever_frees_first():
    async def go():
        slots = Slots(engines=[(PRIMARY, 1), ("a", 1), ("b", 1)])
        assert [await slots.acquire() for _ in range(3)] == [PRIMARY, "a", "b"]
        assert slots.locked()
        waiter = asyncio.ensure_future(slots.acquire())
        await asyncio.sleep(0)
        slots.release("b")
        assert await waiter == "b"
        # A primary-only waiter is never handed an overflow slot.
        only = asyncio.ensure_future(slots.acquire(BACKGROUND, only=(PRIMARY,)))
        await asyncio.sleep(0)
        slots.release("a")
        await asyncio.sleep(0)
        assert not only.done() and slots.free("a") == 1 and slots.waiting() == 1
        slots.release(PRIMARY)
        assert await only == PRIMARY

    run(go())


def test_a_down_engine_is_skipped_until_its_time_is_up_unless_every_engine_is_down():
    async def go():
        now = [0.0]
        slots = Slots(engines=[(PRIMARY, 1), ("a", 1)], clock=lambda: now[0])
        slots.mark_down(PRIMARY)
        assert slots.is_down(PRIMARY) and slots.up() == ["a"]
        assert await slots.acquire() == "a"
        assert slots.locked()  # the primary's free slot is not on offer while it is down
        now[0] = 29.9
        assert slots.is_down(PRIMARY)
        now[0] = 30.0
        assert not slots.is_down(PRIMARY) and await slots.acquire() == PRIMARY
        slots.release(PRIMARY)
        slots.release("a")
        slots.mark_down(PRIMARY)
        slots.mark_down("a")
        assert await slots.acquire() == PRIMARY  # all down: trying one costs nothing

    run(go())


def test_a_waiter_gets_an_engine_coming_back_up():
    async def go():
        slots = Slots(engines=[(PRIMARY, 1), ("a", 1)])
        slots.down_s = 0.05
        assert await slots.acquire() == PRIMARY
        slots.mark_down("a")  # its slot is free but skipped
        assert slots.locked()
        waiter = asyncio.ensure_future(slots.acquire())
        assert await asyncio.wait_for(waiter, 1.0) == "a"  # handed out when it is back

    run(go())


# -- a line on each engine -----------------------------------------------------------------------


def two(tmp_path, overflow: dict | None = None, **section):
    primary, over = Server("primary"), Server("overflow")
    net = Net(("primary:11434", primary), (urlparse((overflow or OVERFLOW)["endpoint"]).netloc, over))
    agents = make(tmp_path, net, overflow=[overflow or OVERFLOW], **section)
    return agents, primary, over


def test_a_line_takes_the_primary_when_free_and_the_overflow_when_not(tmp_path):
    agents, primary, over = two(tmp_path)

    async def go():
        await agents._handle(req("r1"))
        assert len(primary.mains()) == 1 and over.calls == []
        await agents._slots.acquire()  # the primary's one slot is busy
        await agents._handle(req("r2", pid="g-2", name="Bo"))
        agents._slots.release(PRIMARY)

    run(go())
    assert len(primary.mains()) == 1 and len(over.mains()) == 1
    replies = agents.mod.of("/api/agent/reply")
    assert [r["say"] for r in replies] == ["Your file is open on my desk."] * 2
    engines = [t["engine"] for t in voice_thoughts(agents)]
    assert engines == [PRIMARY, "overflow"]
    notes = [t["note"] for t in voice_thoughts(agents)]
    assert "engine overflow" in notes[1] and "engine" not in notes[0]  # the primary goes unsaid
    assert voice_thoughts(agents)[1]["model"]["endpoint"] == OVERFLOW["endpoint"]


def test_the_warm_head_runs_on_the_main_call_s_engine_and_only_on_ollama(tmp_path):
    agents, primary, over = two(tmp_path)

    async def go():
        await agents._slots.acquire()
        await agents._handle(req("r1"))
        agents._slots.release(PRIMARY)

    run(go())
    assert primary.calls == []  # neither the warm head nor the line
    assert len(over.warms()) == 1 and len(over.mains()) == 1
    assert over.calls[0]["body"]["messages"] == over.calls[1]["body"]["messages"][:2]  # P1 + P2: the head

    hosted = {"name": "cloud", "endpoint": "http://cloud:8000/v1", "capacity": 1, "api": "openai"}
    agents, primary, cloud = two(tmp_path, overflow=hosted)

    async def go2():
        await agents._slots.acquire()
        await agents._handle(req("r1"))
        agents._slots.release(PRIMARY)

    run(go2())
    assert primary.calls == [] and len(cloud.calls) == 1 and cloud.warms() == []  # no warm head off Ollama
    assert cloud.calls[0]["path"] == "/v1/chat/completions"


def test_an_engine_that_fails_is_marked_down_and_the_line_is_retried_once_elsewhere(tmp_path):
    agents, primary, over = two(tmp_path)
    now = [100.0]
    agents._slots.clock = lambda: now[0]
    primary.fail = "500"

    run(agents._handle(req("r1")))
    # The primary's warm head failed: it is down, and the line went to the overflow.
    assert len(primary.calls) == 1 and agents._slots.is_down(PRIMARY)
    assert len(over.warms()) == 1 and len(over.mains()) == 1
    assert agents.mod.of("/api/agent/reply")[0]["say"] == "Your file is open on my desk."
    assert voice_thoughts(agents)[0]["engine"] == "overflow"

    # While it is down the next line goes straight to the overflow …
    primary.fail = None
    run(agents._handle(req("r2", pid="g-2", name="Bo")))
    assert len(primary.calls) == 1 and len(over.mains()) == 2
    # … and 30 s later the primary is back.
    now[0] += 30
    run(agents._handle(req("r3", pid="g-3", name="Cy")))
    assert len(primary.mains()) == 1 and len(over.mains()) == 2


def test_a_main_call_that_fails_moves_with_the_voice_s_own_settings(tmp_path):
    agents, primary, over = two(tmp_path, voice={"warm_head": "off"})
    primary.fail = "down"
    run(agents._handle(req("r1")))
    assert len(primary.calls) == 1 and len(over.calls) == 1
    sent = over.calls[0]["body"]
    assert sent["options"]["num_predict"] == agents.models["Trabolta"].max_tokens  # the line's own budget
    assert agents.mod.of("/api/agent/reply")[0]["say"] == "Your file is open on my desk."


def test_when_every_engine_fails_the_persona_s_fallback_goes_out(tmp_path):
    agents, primary, over = two(tmp_path, voice={"warm_head": "off"})
    primary.fail, over.fail = "500", "down"
    run(agents._handle(req("r1")))
    assert len(primary.calls) == 1 and len(over.calls) == 1  # one retry, no more
    assert agents.mod.of("/api/agent/reply")[0]["say"] == "Please wait."
    thought = voice_thoughts(agents)[0]
    assert thought["engine"] == "overflow" and "HTTP" not in (thought["note"] or "") and thought["error"]
    assert agents._slots.is_down(PRIMARY) and agents._slots.is_down("overflow")


def test_an_api_key_env_sends_a_bearer_and_is_never_printed(tmp_path, monkeypatch, caplog, capsys):
    from stagehand.cli import main

    secret = "sk-test-not-a-real-key-31"
    monkeypatch.setenv("LOOM_TEST_CLOUD_KEY", secret)
    hosted = {"name": "cloud", "endpoint": "https://models.example.com/v1", "capacity": 1, "api": "openai", "api_key_env": "LOOM_TEST_CLOUD_KEY"}
    agents, primary, cloud = two(tmp_path, overflow=hosted)
    caplog.set_level(logging.DEBUG)

    async def go():
        await agents._slots.acquire()
        await agents._handle(req("r1"))
        agents._slots.release(PRIMARY)

    run(go())
    assert cloud.calls[0]["headers"]["authorization"] == f"Bearer {secret}"
    assert primary.calls == []
    lines = "\n".join(agents.describe() + agents.warnings())
    assert "LOOM_TEST_CLOUD_KEY set" in lines and "leave the house" in lines
    assert secret not in lines and secret not in caplog.text
    assert secret not in json.dumps(agents.mod.posts)
    # `stagehand check` lists the engines and never the key.
    (tmp_path / "laptop.yaml").write_text(
        "server: {url: 'http://h', event: e, mod_passcode: x}\n"
        "agents:\n"
        "  llm: {api: ollama}\n"
        "  overflow:\n"
        "    - {name: cloud, endpoint: 'https://models.example.com/v1', capacity: 2, api: openai, api_key_env: LOOM_TEST_CLOUD_KEY}\n"
        "    - {name: lan, endpoint: 'http://192.168.8.10:11434/v1', capacity: 1, api: ollama, api_key_env: LOOM_TEST_UNSET_KEY}\n"
        "  characters: [t.persona.md]\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("LOOM_TEST_UNSET_KEY", raising=False)
    assert main(["check", "--config", str(tmp_path / "laptop.yaml")]) == 0
    captured = capsys.readouterr()
    out, err = captured.out, captured.err
    assert "capacity 4" in out
    assert "cloud    : ×2" in out and "key LOOM_TEST_CLOUD_KEY set" in out
    assert "lan      : ×1" in out and "key LOOM_TEST_UNSET_KEY NOT SET" in out
    assert "warning: overflow engine lan: api_key_env LOOM_TEST_UNSET_KEY is not set" in err
    assert secret not in out and secret not in err


def test_without_an_api_key_env_no_authorization_header(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-travel")
    hosted = {"name": "cloud", "endpoint": "http://cloud:8000/v1", "capacity": 1, "api": "openai"}
    agents, primary, cloud = two(tmp_path, overflow=hosted, llm={**PRIMARY_LLM, "api_key_env": "OPENAI_API_KEY"})

    async def go():
        await agents._slots.acquire()
        await agents._handle(req("r1"))
        agents._slots.release(PRIMARY)

    run(go())
    assert "authorization" not in cloud.calls[0]["headers"]  # the primary's key stays with the primary


def test_leaves_the_house():
    assert not leaves_the_house("http://localhost:11434/v1")
    assert not leaves_the_house("http://127.0.0.1:11437")
    assert not leaves_the_house("http://192.168.8.10:11434/v1")
    assert not leaves_the_house("http://desktop.local:11434/v1")
    assert leaves_the_house("https://api.example.com/v1")
    assert leaves_the_house("http://8.8.8.8/v1")


# -- the primary's own work ------------------------------------------------------------------------


def test_a_ruling_may_take_an_overflow_slot(tmp_path):
    agents, primary, over = two(tmp_path)
    over.say = '{"same": true, "why": "the same duck"}'
    frame = {"id": "aj-1", "character": "Trabolta", "filing": {"seq": 4}, "question": {"id": "H9", "text": "Which bird?"}, "key": {"answer": "duck", "aliases": []}, "answer": "a duck", "confidence": 80}

    async def go():
        await agents._slots.acquire()
        await agents._judge(frame)
        agents._slots.release(PRIMARY)

    run(go())
    assert primary.calls == [] and len(over.calls) == 1
    assert over.calls[0]["body"]["options"]["temperature"] <= 0.2  # the ruling's low temperature on the overflow too
    judge = [t for t in agents.mod.thoughts() if t["kind"] == "judge"][0]
    assert judge["engine"] == "overflow" and judge["model"]["endpoint"] == OVERFLOW["endpoint"]
    assert agents.mod.of("/api/agent/judge")[0]["same"] is True


def test_a_quiet_summary_waits_for_the_primary_though_the_overflow_is_free(tmp_path):
    agents, primary, over = two(tmp_path)
    primary.say = "A careful program who brings documents."
    agents._p1 = lambda character: "P1"
    run(agents._handle(req("r0")))  # someone on file
    before = len(primary.calls)

    async def go():
        await agents._slots.acquire()  # the primary is busy
        task = asyncio.ensure_future(agents._summarise("Trabolta", "g-1"))
        for _ in range(5):
            await asyncio.sleep(0)
        assert not task.done() and agents._slots.waiting() == 1 and agents._slots.free("overflow") == 2
        agents._slots.release(PRIMARY)
        await task

    agents._quiet[("Trabolta", "g-1")]["turns"] = 3
    run(go())
    assert len(primary.calls) == before + 1 and over.calls == []
    summary = [t for t in agents.mod.thoughts() if t["kind"] == "summary"][0]
    assert summary["engine"] == PRIMARY


def test_a_letter_waits_for_the_primary_though_the_overflow_is_free(tmp_path):
    agents, primary, over = two(tmp_path)
    primary.say = json.dumps({"subject": "From my desk", "letter": "Dear Ada,\n\nThank you for being installed in my computer tonight.\n\nJean Trabolta"})
    frame = {"id": "lt-1", "character": "Trabolta", "key": "g:g1", "to": {"kind": "guest", "name": "Ada"}, "facts": {"program": {"name": "Ada"}, "night": {}}, "at": 0}

    async def go():
        await agents._slots.acquire()
        task = asyncio.ensure_future(agents._letter(frame))
        for _ in range(5):
            await asyncio.sleep(0)
        assert not task.done() and agents._slots.waiting() == 1
        agents._slots.release(PRIMARY)
        await task

    run(go())
    assert len(primary.calls) == 1 and over.calls == []
    letter = [t for t in agents.mod.thoughts() if t["kind"] == "letter"][0]
    assert letter["engine"] == PRIMARY


def test_a_failing_primary_is_not_retried_elsewhere_for_a_summary(tmp_path):
    agents, primary, over = two(tmp_path)
    agents._p1 = lambda character: "P1"
    run(agents._handle(req("r0")))
    primary.fail = "500"
    agents._quiet[("Trabolta", "g-1")]["turns"] = 3
    run(agents._summarise("Trabolta", "g-1"))
    assert over.calls == []
    summary = [t for t in agents.mod.thoughts() if t["kind"] == "summary"][0]
    assert summary["error"] and summary["engine"] == PRIMARY


def test_one_engine_keeps_the_worker_as_it_was(tmp_path):
    primary = Server("primary")
    agents = make(tmp_path, Net(("primary:11434", primary)), concurrency=2)
    assert agents.cfg.engines == [(PRIMARY, 2)] and agents.capacity == 2
    assert not any(line.lstrip().startswith("engines") for line in agents.describe())
    run(agents._handle(req("r1")))
    thought = voice_thoughts(agents)[0]
    assert thought["engine"] == PRIMARY and "engine" not in (thought["note"] or "")
    assert NORMAL == 2  # the lanes are unchanged
