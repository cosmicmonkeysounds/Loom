"""Trabolta under load, the worker's side (wave 42, C7).

The server now hands a worker at most `capacity` open lines and keeps the
rest in its own queue, so the worker announces its `concurrency` on the
stream. Inside the worker, a generation slot is only ever spent on the
model: the trace's POST to the server runs in the background, the
retry is decided when the slot is taken, and a quiet summary may use a
free slot beside a line in flight while never making a line wait.
"""

from __future__ import annotations

import asyncio
import json
import time

from stagehand.agents.config import parse_agents
from stagehand.agents.module import Agents
from stagehand.agents.trace import new_thought

PERSONA = """---
character: Trabolta
variables: truth
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


class FakeMod:
    base_url = "http://srv"

    def __init__(self, trace_s: float = 0.0):
        self.trace_s = trace_s
        self.posts: list[tuple[str, dict, float]] = []

    def path(self, p):
        return f"/e/evt{p}"

    async def post(self, p, body):
        if p == "/api/agent/trace" and self.trace_s:
            await asyncio.sleep(self.trace_s)  # a slow VPS round trip
        self.posts.append((p, body, time.monotonic()))
        return {"ok": True}

    async def get(self, p, params=None, timeout=None):
        return {}

    def of(self, path):
        return [(b, at) for p, b, at in self.posts if p == path]


class Reply:
    def __init__(self, say: str, memo: str = ""):
        self.say, self.memo = say, memo
        self.adjust: dict = {}
        self.acts: tuple = ()
        self.lookup: tuple = ()

    @property
    def empty(self) -> bool:
        return not self.say


class SlowVoice:
    """`voice.answer_lean` that takes `model_s` and records its thought with the slot in hand, like the real one."""

    def __init__(self, model_s: float = 0.0):
        self.model_s = model_s
        self.calls: list[str] = []

    async def __call__(self, persona, model, req, ctx, complete_fn, trace=None, facts_fn=None, mind=None):
        self.calls.append(str(req.get("id")))
        await asyncio.sleep(self.model_s)
        if trace is not None:
            await trace.record(new_thought(persona.character, "voice", trigger="line", model=model, messages=[{"role": "system", "content": "P1"}], request=req, result={"say": "ok"}))
        return Reply("Noted.", memo=f"memo for {req.get('id')}")


def make(tmp_path, voice=None, mod=None, complete_fn=None, **section) -> Agents:
    (tmp_path / "t.persona.md").write_text(PERSONA, encoding="utf-8")
    (tmp_path / "t.mind.md").write_text(MIND, encoding="utf-8")
    cfg = parse_agents({"characters": ["t.persona.md"], "state_dir": "minds", "mind_mode": "new", **section}, str(tmp_path))
    agents = Agents(cfg, complete_fn, voice_fn=voice or SlowVoice())
    agents.mod = mod or FakeMod()
    agents.event = "evt"
    return agents


def req(rid: str, pid: str = "g-1", name: str = "Ada", phase: str = "hunt_1") -> dict:
    return {
        "id": rid,
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": [pid]},
        "speaker": {"kind": "guest", "id": pid, "name": name},
        "text": "hello",
        "history": [{"seq": 1, "mine": False, "from": name, "text": "hello"}],
        "self": {"vars": {"truth": "40"}, "ranges": {"truth": [0, 100]}, "codex": []},
        "them": {"vars": {}, "codex": []},
        "world": {"Night.phase": phase},
        "powers": [],
    }


def run(coro):
    return asyncio.run(coro)


# -- C7: the stream says the capacity, check says what it means -------------------------


def test_check_prints_the_capacity_and_the_ollama_parallel_note(tmp_path, capsys, monkeypatch):
    from stagehand.agents import module
    from stagehand.cli import main

    seen: list[str | None] = [None]  # off macOS: launchctl is not asked
    monkeypatch.setattr(module, "launchd_ollama_parallel", lambda: seen[0])

    (tmp_path / "t.persona.md").write_text(PERSONA, encoding="utf-8")
    conf = tmp_path / "laptop.yaml"

    def check(concurrency: int) -> str:
        conf.write_text(
            "server: {url: 'http://h', event: e, mod_passcode: x}\n"
            f"agents: {{concurrency: {concurrency}, llm: {{api: ollama}}, characters: [t.persona.md]}}\n",
            encoding="utf-8",
        )
        assert main(["check", "--config", str(conf)]) == 0
        return capsys.readouterr().out

    one = check(1)
    assert "concurrency 1 · capacity 1" in one and "OLLAMA_NUM_PARALLEL" not in one
    two = check(2)
    assert "concurrency 2 · capacity 2" in two
    assert "OLLAMA_NUM_PARALLEL >= 2" in two and "launchctl setenv OLLAMA_NUM_PARALLEL 2" in two
    assert "warn" not in two
    # (wave 42 review) On macOS, check reads what launchctl hands the Ollama app.
    seen[0] = ""
    assert "launchctl has no OLLAMA_NUM_PARALLEL" in check(2)
    seen[0] = "1"
    assert "OLLAMA_NUM_PARALLEL is '1', below concurrency 2" in check(2)
    seen[0] = "4"
    out = check(2)
    assert "OLLAMA_NUM_PARALLEL is 4" in out and "warn" not in out
    seen[0] = "1"
    assert "warn" not in check(1)  # concurrency 1 never asks


def test_the_stream_url_carries_the_capacity(tmp_path):
    for n, cap in ((1, "1"), (2, "2"), (99, "16")):
        agents = make(tmp_path, concurrency=n)
        assert agents.stream_url(agents.mod).endswith(f"&capacity={cap}")


# -- C7: a slow trace POST never stretches a generation slot ---------------------------


def test_a_slow_trace_post_does_not_hold_the_slot(tmp_path):
    model_s, post_s = 0.2, 0.6  # a wide margin: a loaded CI runner must not flake it
    agents = make(tmp_path, voice=SlowVoice(model_s), mod=FakeMod(trace_s=post_s), concurrency=1)

    async def go():
        await agents.on_frame("request", json.dumps(req("a")))
        await agents.on_frame("request", json.dumps(req("b", pid="g-2", name="Bo")))
        started = time.monotonic()
        await asyncio.gather(*agents.tasks.values())
        return started

    started = run(go())
    replies = agents.mod.of("/api/agent/reply")
    assert [b["id"] for b, _ in replies] == ["a", "b"]
    second = replies[1][1] - started
    # Two generations back to back (≈ 0.4 s), not two generations each
    # followed by its POST (≈ 1.0 s): the slot is only the model's.
    assert second < 2 * model_s + 0.5 * post_s, second
    # Every thought still reaches the server, in the order recorded.
    thoughts = [t for b, _ in agents.mod.of("/api/agent/trace") for t in b["thoughts"]]
    assert [t["request_id"] for t in thoughts] == ["a", "b"]
    assert agents.tasks == {} and agents._trace_posts == set()


def test_a_thought_recorded_off_the_slot_is_still_posted_before_record_returns(tmp_path):
    agents = make(tmp_path)

    async def go():
        await agents.trace.record(new_thought("Trabolta", "control", trigger="Jo", note="nudge"))
        return [b["thoughts"][0]["kind"] for b, _ in agents.mod.of("/api/agent/trace")]

    assert run(go()) == ["control"]  # a director's marker is not deferred


def test_a_full_trace_backlog_skips_the_live_copy_and_asks_for_a_replay(tmp_path, monkeypatch):
    from stagehand.agents import module
    from stagehand.agents.wire import wire_of

    monkeypatch.setattr(module, "TRACE_BACKLOG", 1)
    agents = make(tmp_path, mod=FakeMod(trace_s=0.05))

    async def go():
        await agents._slots.acquire()
        try:
            await agents.trace.record(new_thought("Trabolta", "voice", note="one"))
            await agents.trace.record(new_thought("Trabolta", "voice", note="two"))
        finally:
            agents._slots.release()
        await agents._trace_settled()

    run(go())
    assert [b["thoughts"][0]["note"] for b, _ in agents.mod.of("/api/agent/trace")] == ["one"]
    assert wire_of(agents).suspect  # the next hello replays the whole recent trace


# -- C7: quiet summaries on a free slot -------------------------------------------------


def _ripe(agents: Agents) -> float:
    """Three lines from Ada, then quiet long enough for a summary."""
    agents._p1 = lambda character: "P1"
    for i in range(3):
        run(agents._handle(req(f"r{i}")))
    return agents._quiet[("Trabolta", "g-1")]["at"] + 500


def test_a_quiet_summary_runs_beside_a_line_and_gives_way_when_one_must_wait(tmp_path):
    gate: dict[str, asyncio.Event] = {}

    async def complete(messages, cfg):
        gate["started"].set()
        await asyncio.sleep(10)
        return "never"

    agents = make(tmp_path, complete_fn=complete, concurrency=2)
    now = _ripe(agents)

    async def go():
        gate["started"] = asyncio.Event()
        await agents._slots.acquire()  # a line in flight on one slot
        assert agents._quiet_due(now) == ("Trabolta", "g-1")  # the other slot is free
        agents._summary_task = asyncio.ensure_future(agents._summarise("Trabolta", "g-1"))
        await gate["started"].wait()
        agents._slots.release()  # that line is answered

        # A new line finds a free slot: the summary keeps running beside it.
        await agents.on_frame("request", json.dumps(req("c", pid="g-2", name="Bo")))
        await asyncio.gather(*agents.tasks.values())
        assert not agents._summary_task.done()

        # Both slots taken (a line + the summary): the next line would wait,
        # so the summary is cancelled and the line takes its slot.
        await agents._slots.acquire()
        line = asyncio.ensure_future(agents._handle(req("d", pid="g-3", name="Cy")))
        while not agents._summary_task.done():
            await asyncio.sleep(0)
        assert agents._summary_task.cancelled()
        await line
        agents._slots.release()

    run(go())
    assert [b["id"] for b, _ in agents.mod.of("/api/agent/reply")][-2:] == ["c", "d"]
    assert agents.minds["Trabolta"].people["g-1"].summary == ""  # it runs again later
    assert agents._quiet[("Trabolta", "g-1")]["turns"] >= 3


def test_no_free_slot_or_a_line_waiting_for_one_blocks_a_new_summary(tmp_path):
    agents = make(tmp_path, concurrency=2)
    now = _ripe(agents)

    async def go():
        await agents._slots.acquire()
        await agents._slots.acquire()
        assert agents._quiet_due(now) is None  # both slots taken
        waiter = asyncio.ensure_future(agents._slots.acquire())  # a line queues for one
        await asyncio.sleep(0)
        assert agents._slots.waiting() == 1
        assert agents._quiet_due(now) is None  # a line is waiting
        agents._slots.release()  # handed straight to the waiter: still no free slot
        await waiter
        assert agents._slots.waiting() == 0 and agents._quiet_due(now) is None
        agents._slots.release()
        assert agents._quiet_due(now) == ("Trabolta", "g-1")  # one free slot, nobody queued
        agents._slots.release()

    run(go())


# -- review fixes: the burst the worker cannot see, the books, the trace's order -------


class RetryVoice(SlowVoice):
    """Records, per request, whether the voice was allowed its one retry."""

    def __init__(self, model_s: float = 0.0):
        super().__init__(model_s)
        self.retry: dict[str, bool] = {}

    async def __call__(self, persona, model, req, ctx, complete_fn, trace=None, facts_fn=None, mind=None):
        self.retry[str(req.get("id"))] = ctx.options.retry_allowed
        return await super().__call__(persona, model, req, ctx, complete_fn, trace=trace, facts_fn=facts_fn, mind=mind)


def test_a_windowed_burst_gets_no_retry_though_the_worker_s_slots_look_idle(tmp_path):
    """With `capacity=1` the server holds the doors' burst and hands the
    worker one line at a time, each the moment the last reply goes out:
    nothing ever waits in the worker's slots, yet 40 guests wait behind
    each line. A refilled slot (or the frame's `queued`) means no retry."""
    voice = RetryVoice()
    agents = make(tmp_path, voice=voice, concurrency=1)

    async def one(r: dict) -> None:
        await agents.on_frame("request", json.dumps(r))
        await asyncio.gather(*agents.tasks.values())

    async def go():
        await one(req("first"))  # an idle worker: nobody behind it that it knows of
        for i in range(3):  # the server refills the slot as each reply goes out
            await one(req(f"burst{i}", pid=f"g-{i + 2}", name=f"P{i}"))
        await one(req("told", pid="g-9", name="Q") | {"queued": 12})
        await one(req("clear", pid="g-10", name="R") | {"queued": 0})  # the server says nobody waits
        agents._answered_at = time.monotonic() - 60  # a lull: the next line is not a refill
        await one(req("later", pid="g-11", name="S"))

    run(go())
    assert voice.retry == {"first": True, "burst0": False, "burst1": False, "burst2": False, "told": False, "clear": True, "later": True}
    assert agents._pressed == set()


def test_a_quiet_summary_waits_for_a_lull_in_the_traffic(tmp_path, monkeypatch):
    """Under load a freed slot is refilled within a round trip: a summary
    started in that gap would be cancelled by the next line."""
    from stagehand.agents import module

    monkeypatch.setattr(module, "QUIET_S", 0.0)
    agents = make(tmp_path, concurrency=1)
    _ripe(agents)

    async def go():
        await agents.on_frame("request", json.dumps(req("bo", pid="g-2", name="Bo")))
        await asyncio.gather(*agents.tasks.values())

    run(go())
    now = time.monotonic()
    assert agents._quiet_due(now) is None  # Bo was answered a moment ago
    assert agents._quiet_due(now + module.SUMMARY_LULL_S) == ("Trabolta", "g-1")


def test_an_answered_line_is_off_the_books_while_its_thought_is_still_posting(tmp_path):
    agents = make(tmp_path, mod=FakeMod(trace_s=0.3), concurrency=1)

    async def go():
        await agents.on_frame("request", json.dumps(req("a")))
        task = agents.tasks["a"]
        while not agents.mod.of("/api/agent/reply"):
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.02)  # the memo, the mirror: then only the trace POST is left
        assert not task.done() and agents._trace_posts  # still settling its thought...
        assert agents._inflight == 0 and agents.tasks == {} and not agents._busy()  # ...but not in flight
        assert agents.orchestrator._inflight == 0
        await task

    run(go())
    assert [t["request_id"] for b, _ in agents.mod.of("/api/agent/trace") for t in b["thoughts"]] == ["a"]
    assert agents._last_post == {}


def test_overlapping_trace_posts_answered_out_of_order_do_not_read_as_a_restart(tmp_path):
    from stagehand.agents.wire import wire_of

    class OutOfOrder(FakeMod):
        """The server numbers each post as it takes it; the first answer is slow on the way back."""

        def __init__(self):
            super().__init__()
            self.seq = 10
            self.calls = 0

        async def post(self, p, body):
            self.seq += 1
            seq = self.seq
            self.calls += 1
            if self.calls == 1:
                await asyncio.sleep(0.05)
            self.posts.append((p, body, time.monotonic()))
            return {"ok": True, "accepted": 1, "seq": seq}

    agents = make(tmp_path, mod=OutOfOrder())

    async def go():
        one = new_thought("Trabolta", "voice", note="one")
        two = new_thought("Trabolta", "judge", note="two")
        await asyncio.gather(agents._post_thought(one, agents.trace.server_copy(one)), agents._post_thought(two, agents.trace.server_copy(two)))

    run(go())
    wire = wire_of(agents)
    assert not wire.suspect and wire.last_seq == 12
    # A real restart is still caught: the newest send comes back lower.
    wire.trace_posted(agents, {"accepted": 1, "seq": 5}, sent=agents._trace_sends + 1)
    assert wire.suspect


def test_a_letter_that_must_queue_cancels_a_summary_and_a_line_ahead_of_it_gets_no_retry(tmp_path):
    """Wave 41's letters through wave 42's slots: a letter waits in the
    ordinary lane (`_judge_call`), so it counts as a line waiting."""
    letter = json.dumps({"subject": "From my desk", "letter": "Dear Calculator,\n\nThank you for tonight. " + "x" * 60 + "\n\nJean Trabolta"})
    calls: list[str] = []

    async def complete(messages, cfg):
        if not calls:
            calls.append("summary")
            await asyncio.sleep(10)  # a quiet summary on the only slot
            return "never"
        calls.append("letter")
        return letter

    voice = RetryVoice()
    agents = make(tmp_path, voice=voice, complete_fn=complete, concurrency=1)
    now = _ripe(agents)
    frame = {"id": "lt-1", "character": "Trabolta", "key": "g:g1", "to": {"kind": "guest", "name": "Calculator"}, "facts": {"kind": "guest"}, "at": 0}

    async def go():
        assert agents._quiet_due(now) == ("Trabolta", "g-1")
        agents._summary_task = asyncio.ensure_future(agents._summarise("Trabolta", "g-1"))
        while not calls:
            await asyncio.sleep(0)
        await agents.on_frame("letter", json.dumps(frame))  # no slot free: it queues...
        while not agents._summary_task.done():
            await asyncio.sleep(0)
        assert agents._summary_task.cancelled()  # ...and the summary gives way
        await asyncio.gather(*agents.lettering.values())

        # A guest at his heart (a lane ahead) takes the slot while a letter waits for one.
        await agents._slots.acquire()
        await agents.on_frame("letter", json.dumps(frame | {"id": "lt-2"}))
        heart = req("h", pid="g-5", name="Hal")
        heart["them"]["vars"]["at_the_heart"] = "true"
        agents._answered_at = None  # not a refill: only the waiting letter may say no
        await agents.on_frame("request", json.dumps(heart))
        await asyncio.sleep(0)
        assert agents._slots.waiting() == 2
        agents._slots.release()
        await asyncio.gather(*agents.tasks.values(), *agents.lettering.values())

    run(go())
    assert calls == ["summary", "letter", "letter"]
    assert [b["id"] for b, _ in agents.mod.of("/api/agent/letter")] == ["lt-1", "lt-2"]
    assert voice.retry["h"] is False
