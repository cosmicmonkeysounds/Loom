"""The mind wire (wave 12, CONTRACTS.md §C6.5–C6.6): debounced saves,
hash-gated mirrors, a control / reset flushed at once, the static prompt
prefix stored once in the trace, `prompt_ms`, and the replay after the
server's `traceAfter`."""

import asyncio
import json

import httpx
import pytest

from stagehand.agents.config import parse_agents
from stagehand.agents.llm import Completion
from stagehand.agents.mind import Mind
from stagehand.agents.module import Agents
from stagehand.agents.trace import KINDS, PREFIX_MIN, PREFIX_NOT_FOUND, PREFIX_REACH, Trace, new_thought, parse_prefix_ref, prefix_ref
from stagehand.agents.wire import DEBOUNCE_S, Throttle, Wire, replay_thoughts, stable_hash, trace_after_of, wire_of
from stagehand.modapi import ModApiError

#: A short window keeps the trailing writes inside a test's patience.
WIN = 0.05
STATIC = "You are TRABOLTA. " * 80  # ≥ PREFIX_MIN characters, the same every call
assert len(STATIC) >= PREFIX_MIN


def run(coro):
    return asyncio.run(coro)


class FakeMod:
    base_url = "http://srv"

    def __init__(self, fail_paths=()):
        self.posts = []
        self.fail_paths = set(fail_paths)

    def path(self, p):
        return f"/e/evt{p}"

    async def post(self, p, body):
        if p in self.fail_paths:
            raise ModApiError("down", 503)
        self.posts.append((p, json.loads(json.dumps(body))))
        return {"ok": True}

    def of(self, path):
        return [b for p, b in self.posts if p == path]


def worker(tmp_path, *, interval=WIN, dry_run=False):
    (tmp_path / "t.persona.md").write_text("---\ncharacter: Trabolta\nvariables: truth\n---\nYou are TRABOLTA.", encoding="utf-8")
    section = {"characters": ["t.persona.md"], "state_dir": "minds", "orchestrator": {"enabled": False}}
    if dry_run:
        section["dry_run"] = True
    agents = Agents(parse_agents(section, str(tmp_path)), None)
    agents.mod = FakeMod()
    agents.event = "evt"
    agents._wire = Wire(interval=interval)
    return agents


def saved(tmp_path):
    return json.loads((tmp_path / "minds" / "evt" / "Trabolta.mind.json").read_text())


def voice(character="Trabolta", static=STATIC, line="hi"):
    return new_thought(character, "voice", trigger="line", messages=[{"role": "system", "content": static}, {"role": "user", "content": line}])


# -- the throttle -----------------------------------------------------------------------


def test_the_throttle_runs_the_first_at_once_and_folds_the_rest_into_one_trailing_run():
    t = Throttle(WIN)
    ran = []

    async def go():
        t.request("k", lambda: ran.append("a"))
        t.request("k", lambda: ran.append("b"))
        t.request("k", lambda: ran.append("c"))
        assert ran == ["a"] and t.pending("k")
        await asyncio.sleep(WIN * 3)

    run(go())
    assert ran == ["a", "c"]  # the newest fire, once, at the window's end
    assert t.runs == 2 and not t.pending("k")


def test_the_throttle_keeps_keys_apart_and_now_skips_the_window():
    t = Throttle(WIN)
    ran = []

    async def go():
        t.request("a", lambda: ran.append("a1"))
        t.request("b", lambda: ran.append("b1"))  # another character: its own window
        t.request("a", lambda: ran.append("a2"))
        t.request("a", lambda: ran.append("a3"), now=True)  # at once, and the pending one is gone
        await asyncio.sleep(WIN * 3)

    run(go())
    assert ran == ["a1", "b1", "a3"]


def test_the_throttle_flushes_and_never_loses_a_pending_run_when_the_loop_shuts_down():
    t = Throttle(10.0)  # a window no test waits out
    ran = []

    async def go():
        t.request("k", lambda: ran.append(1))
        t.request("k", lambda: ran.append(2))
        t.request("j", lambda: ran.append(3))
        t.request("j", lambda: ran.append(4))
        t.flush("k")
        assert ran == [1, 3, 2]

    run(go())  # asyncio.run's teardown cancels the "j" timer: it writes as it goes
    assert ran == [1, 3, 2, 4]


def test_the_throttle_runs_at_once_with_no_event_loop():
    t = Throttle(10.0)
    ran = []
    t.request("k", lambda: ran.append(1))
    t.request("k", lambda: ran.append(2))
    assert ran == [1, 2]


def test_the_default_window_is_two_seconds():
    assert DEBOUNCE_S == 2.0 and Wire().saves.interval == 2.0 and Wire().mirrors.interval == 2.0


# -- saves --------------------------------------------------------------------------------


def test_saves_write_at_most_once_per_window_and_the_trailing_write_has_the_newest_mind(tmp_path, monkeypatch):
    agents = worker(tmp_path)
    mind = agents.minds["Trabolta"]
    writes = []
    real = Mind.save
    monkeypatch.setattr(Mind, "save", lambda self, path: (writes.append(self.exchanges), real(self, path)))

    async def go():
        for i in range(5):
            mind.saw_exchange("g1", "Ada", "guest", "t", i + 1)
            agents._save_mind("Trabolta")
        assert writes == [1] and saved(tmp_path)["exchanges"] == 1
        await asyncio.sleep(WIN * 3)

    run(go())
    assert writes == [1, 5] and saved(tmp_path)["exchanges"] == 5


def test_save_now_writes_at_once_inside_the_window(tmp_path):
    agents = worker(tmp_path, interval=10.0)
    mind = agents.minds["Trabolta"]

    async def go():
        mind.saw_exchange("g1", "Ada", "guest", "t", 1)
        agents._save_mind("Trabolta")
        mind.saw_exchange("g1", "Ada", "guest", "t", 2)
        agents._save_mind("Trabolta")
        assert saved(tmp_path)["exchanges"] == 1
        mind.saw_exchange("g1", "Ada", "guest", "t", 3)
        agents._save_mind("Trabolta", now=True)
        assert saved(tmp_path)["exchanges"] == 3
        assert not agents._wire.saves.pending("Trabolta")

    run(go())


def test_abandon_all_flushes_every_pending_save(tmp_path):
    agents = worker(tmp_path, interval=10.0)
    mind = agents.minds["Trabolta"]

    async def go():
        mind.saw_exchange("g1", "Ada", "guest", "t", 1)
        agents._save_mind("Trabolta")
        mind.saw_exchange("g1", "Ada", "guest", "t", 2)
        agents._save_mind("Trabolta")
        assert saved(tmp_path)["exchanges"] == 1
        agents.abandon_all()  # a reconnect, or run()'s finally
        assert saved(tmp_path)["exchanges"] == 2

    loop = asyncio.new_event_loop()  # no teardown flush here: abandon_all must do it
    loop.run_until_complete(go())


def test_a_control_thought_flushes_its_pending_save_at_once(tmp_path):
    agents = worker(tmp_path, interval=10.0)
    mind = agents.minds["Trabolta"]

    async def go():
        mind.saw_exchange("g1", "Ada", "guest", "t", 1)
        agents._save_mind("Trabolta")
        mind.saw_exchange("g1", "Ada", "guest", "t", 2)
        agents._save_mind("Trabolta")
        assert saved(tmp_path)["exchanges"] == 1
        await agents.trace.record(new_thought("Trabolta", "control", trigger="Jo", note="set brief"))
        assert saved(tmp_path)["exchanges"] == 2

    asyncio.new_event_loop().run_until_complete(go())


# -- mirrors -------------------------------------------------------------------------------


def test_stable_hash_ignores_the_clock_and_the_counters():
    a = {"character": "T", "brief": "x", "updatedAt": 1.0, "status": {"inflight": 0, "thoughts": 3, "worker": "w"}}
    b = {"character": "T", "brief": "x", "updatedAt": 99.0, "status": {"inflight": 2, "thoughts": 40, "worker": "w"}}
    assert stable_hash(a) == stable_hash(b)
    assert stable_hash(a) != stable_hash({**a, "brief": "y"})
    assert stable_hash(a) != stable_hash({**a, "status": {**a["status"], "worker": "other"}})


def test_a_mirror_posts_only_when_the_report_changed(tmp_path):
    agents = worker(tmp_path, interval=0.0)
    mind = agents.minds["Trabolta"]

    async def go():
        await agents._mirror("Trabolta")
        await agents._mirror("Trabolta")  # nothing changed
        agents._inflight = 3  # moves without the mind changing
        mind.updated_at += 50
        await agents._mirror("Trabolta")
        assert len(agents.mod.of("/api/agent/mind")) == 1
        mind.apply({"brief": "Be brisk."}, by="director")
        await agents._mirror("Trabolta")
        assert len(agents.mod.of("/api/agent/mind")) == 2 and agents.mod.of("/api/agent/mind")[-1]["brief"] == "Be brisk."

    run(go())
    assert agents._wire.skipped >= 2


def test_a_burst_of_changes_mirrors_once_now_and_once_trailing_with_the_last_state(tmp_path):
    agents = worker(tmp_path)
    mind = agents.minds["Trabolta"]

    async def go():
        for i in range(6):
            mind.apply({"brief": f"Brief {i}."}, by="reflect")
            await agents._mirror("Trabolta")
        assert [b["brief"] for b in agents.mod.of("/api/agent/mind")] == ["Brief 0."]
        await asyncio.sleep(WIN * 3)

    run(go())
    assert [b["brief"] for b in agents.mod.of("/api/agent/mind")] == ["Brief 0.", "Brief 5."]


def test_a_failed_mirror_is_tried_again_on_the_next_change_check(tmp_path):
    agents = worker(tmp_path, interval=0.0)
    agents.mod.fail_paths.add("/api/agent/mind")

    async def go():
        await agents._mirror("Trabolta")
        assert agents.mod.of("/api/agent/mind") == []
        agents.mod.fail_paths.clear()
        await agents._mirror("Trabolta")  # same report, but the server never took it

    run(go())
    assert len(agents.mod.of("/api/agent/mind")) == 1


def test_hello_always_posts_the_mirror_even_when_nothing_changed(tmp_path):
    agents = worker(tmp_path, interval=10.0)
    hello = json.dumps({"worker": "w-1", "characters": ["Trabolta"], "unknown": []})

    async def go():
        await agents.on_frame("hello", hello)
        await agents.on_frame("hello", hello)  # a reconnect: the server may have lost it
        await agents._mirror("Trabolta")  # but an ordinary mirror of the same mind is skipped

    run(go())
    assert len(agents.mod.of("/api/agent/mind")) == 2


def test_a_reset_mirrors_at_once_with_no_hash_check(tmp_path):
    agents = worker(tmp_path, interval=10.0)

    async def go():
        await agents.on_frame("hello", json.dumps({"worker": "w-1", "characters": ["Trabolta"], "unknown": []}))
        await agents.on_frame("control", json.dumps({"action": "reset", "by": "server", "reason": "restart"}))
        await agents._mirror("Trabolta")  # nothing changed since the reset's own post

    run(go())
    # The fresh mind hashes the same as the one hello posted, but the server
    # dropped its copy on the restart: the reset posts it again, at once.
    assert len(agents.mod.of("/api/agent/mind")) == 2


def test_a_reset_thought_forgets_the_hash_and_a_control_thought_does_not(tmp_path):
    agents = worker(tmp_path, interval=10.0)

    async def go():
        await agents._mirror("Trabolta")
        await agents.trace.record(new_thought("Trabolta", "control", trigger="Jo", note="pause"))
        await agents._mirror("Trabolta")  # unchanged, and the server still holds it: skipped
        assert len(agents.mod.of("/api/agent/mind")) == 1
        await agents.trace.record(new_thought("Trabolta", "reset", trigger="restart"))
        await agents._mirror("Trabolta")  # unchanged, but the server dropped its copy

    run(go())
    assert len(agents.mod.of("/api/agent/mind")) == 2


def test_a_control_mirrors_at_once_inside_the_window(tmp_path):
    agents = worker(tmp_path, interval=10.0)

    async def go():
        await agents.on_frame("hello", json.dumps({"worker": "w-1", "characters": ["Trabolta"], "unknown": []}))
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "brief", "value": "Be brisk.", "by": "Jo"}))["ok"]
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "brief", "value": "Be kind.", "by": "Jo"}))["ok"]

    asyncio.new_event_loop().run_until_complete(go())  # nothing trailing may be needed
    assert [b["brief"] for b in agents.mod.of("/api/agent/mind")] == ["", "Be brisk.", "Be kind."]
    assert saved(tmp_path)["brief"] == "Be kind."


def test_a_dry_run_mirrors_nothing(tmp_path):
    agents = worker(tmp_path, dry_run=True)
    run(agents._mirror("Trabolta"))
    assert agents.mod.posts == []


def test_wire_of_is_made_once_and_kept(tmp_path):
    agents = worker(tmp_path)
    del agents._wire
    first = wire_of(agents)
    assert wire_of(agents) is first and first.saves.interval == DEBOUNCE_S


# -- the trace: the prefix once, prompt_ms --------------------------------------------------


def test_the_new_kinds_and_prompt_ms():
    assert "brief" in KINDS and "summary" in KINDS
    c = Completion(content="{}", ms=900)
    assert new_thought("T", "voice", completion=c).prompt_ms is None  # the OpenAI dialect says nothing
    object.__setattr__(c, "prompt_ms", 412.6)  # what llm.py sets from Ollama's prompt_eval_duration (lane W1)
    t = new_thought("T", "voice", completion=c)
    assert t.prompt_ms == 413 and t.to_json()["prompt_ms"] == 413
    object.__setattr__(c, "prompt_ms", float("nan"))
    assert new_thought("T", "voice", completion=c).prompt_ms is None


def test_a_repeated_prefix_is_stored_once_in_the_file_and_the_ring_keeps_it_whole(tmp_path):
    trace = Trace(tmp_path, "evt")
    first, second, third = voice(line="a"), voice(line="b"), voice(line="c")
    for t in (first, second, third):
        run(trace.record(t))
    lines = [json.loads(x) for x in trace.path("Trabolta").read_text().splitlines()]
    assert lines[0]["messages"][0]["content"] == STATIC  # the first after a start: in full
    assert lines[1]["messages"][0]["content"] == f"[same prefix as {first.id}]"
    assert lines[2]["messages"][0]["content"] == prefix_ref(first.id)
    assert lines[1]["messages"][1]["content"] == "b"  # only the static part is shared
    assert parse_prefix_ref(lines[1]["messages"][0]["content"]) == first.id
    assert all(t.messages[0]["content"] == STATIC for t in trace.all("Trabolta"))  # a re-run needs it
    assert trace.find(second.id) is second


def test_a_short_or_non_system_first_message_is_never_shared(tmp_path):
    trace = Trace(tmp_path, "evt")
    short = "x" * (PREFIX_MIN - 1)
    for t in (voice(static=short), voice(static=short)):
        run(trace.record(t))
    user = [new_thought("Trabolta", "voice", messages=[{"role": "user", "content": STATIC}]) for _ in range(2)]
    for t in user:
        run(trace.record(t))
    lines = [json.loads(x) for x in trace.path("Trabolta").read_text().splitlines()]
    assert [ln["messages"][0]["content"] for ln in lines] == [short, short, STATIC, STATIC]


def test_prefixes_are_per_character_and_a_changed_prefix_is_sent_in_full(tmp_path):
    trace = Trace(tmp_path, "evt")
    a1, s1, a2 = voice(), voice("Sandy"), voice(static=STATIC + "now the powers changed")
    a3 = voice()
    for t in (a1, s1, a2, a3):
        run(trace.record(t))
    assert trace.stored(s1)["messages"][0]["content"] == STATIC  # Sandy's first: in full
    assert trace.stored(a2)["messages"][0]["content"].endswith("now the powers changed")
    assert trace.stored(a3)["messages"][0]["content"] == prefix_ref(a1.id)  # a few prefixes are remembered


def test_a_reference_never_reaches_past_the_window(tmp_path):
    trace = Trace(None)
    first = voice()
    run(trace.record(first))
    for _ in range(PREFIX_REACH):
        run(trace.record(new_thought("Trabolta", "control", note="tick")))
    late = voice()
    run(trace.record(late))
    assert trace.ref_of(late.id) is None and trace.stored(late)["messages"][0]["content"] == STATIC
    again = voice()
    run(trace.record(again))
    assert trace.ref_of(again.id) == late.id


def test_restart_prefixes_and_a_failed_send_make_the_next_thought_carry_it_in_full(tmp_path):
    trace = Trace(None)
    a, b = voice(), voice()
    run(trace.record(a))
    run(trace.record(b))
    assert trace.ref_of(b.id) == a.id
    trace.restart_prefixes()
    c, d = voice(), voice()
    run(trace.record(c))
    run(trace.record(d))
    assert trace.ref_of(c.id) is None and trace.ref_of(d.id) == c.id
    trace.forget_prefix(c)
    e = voice()
    run(trace.record(e))
    assert trace.ref_of(e.id) is None


def test_the_server_copy_carries_the_reference_and_a_failed_full_copy_is_not_referred_to(tmp_path):
    agents = worker(tmp_path)
    agents.mod.fail_paths.add("/api/agent/trace")
    a = voice()

    async def go():
        await agents.trace.record(a)  # its full copy never reaches the server
        agents.mod.fail_paths.clear()
        b, c = voice(), voice()
        await agents.trace.record(b)
        await agents.trace.record(c)
        return b, c

    b, c = run(go())
    sent = [t for body in agents.mod.of("/api/agent/trace") for t in body["thoughts"]]
    assert [t["id"] for t in sent] == [b.id, c.id]
    assert sent[0]["messages"][0]["content"] == STATIC and sent[1]["messages"][0]["content"] == prefix_ref(b.id)


@pytest.mark.parametrize("error", [httpx.ConnectError("refused"), httpx.ReadTimeout("slow"), OSError("unreachable"), ModApiError("down", 502)])
def test_a_full_copy_lost_to_any_error_is_never_referred_to(tmp_path, error):
    agents = worker(tmp_path)

    class Down(FakeMod):
        async def post(self, p, body):
            if p == "/api/agent/trace" and not self.posts_ok:
                raise error
            return await super().post(p, body)

    agents.mod = Down()
    agents.mod.posts_ok = False
    a = voice()

    async def go():
        await agents.trace.record(a)  # a transport error, not only a non-200
        agents.mod.posts_ok = True
        b, c = voice(), voice()
        await agents.trace.record(b)
        await agents.trace.record(c)
        return b, c

    b, c = run(go())
    sent = [t for body in agents.mod.of("/api/agent/trace") for t in body["thoughts"]]
    assert [t["id"] for t in sent] == [b.id, c.id]
    assert sent[0]["messages"][0]["content"] == STATIC  # never "[same prefix as <a>]"
    assert sent[1]["messages"][0]["content"] == prefix_ref(b.id)


def test_a_failed_send_makes_every_characters_next_thought_whole(tmp_path):
    agents = worker(tmp_path)
    run(agents.trace.record(voice()))
    run(agents.trace.record(voice(character="Sandy")))
    agents.mod.fail_paths.add("/api/agent/trace")
    run(agents.trace.record(voice()))  # the server is gone: it may hold no full copy at all
    agents.mod.fail_paths.clear()
    agents.mod.posts.clear()
    run(agents.trace.record(voice(character="Sandy")))
    sent = agents.mod.of("/api/agent/trace")[0]["thoughts"][0]
    assert sent["messages"][0]["content"] == STATIC


def test_a_thought_recorded_while_its_holders_post_is_in_flight_goes_whole(tmp_path):
    agents = worker(tmp_path)

    class Slow(FakeMod):
        async def post(self, p, body):
            if p == "/api/agent/trace" and body["thoughts"][0]["id"] == self.slow_id:
                await self.gate.wait()
                if self.slow_fails:
                    raise httpx.ReadTimeout("slow")
            return await super().post(p, body)

    for fails in (False, True):
        agents.trace = Trace(None)
        agents.trace.listen(agents._thought_recorded)
        agents.mod = Slow()
        a = voice()
        agents.mod.slow_id, agents.mod.slow_fails = a.id, fails

        async def go():
            gate = agents.mod.gate = asyncio.Event()
            holder = asyncio.ensure_future(agents.trace.record(a))
            await asyncio.sleep(0)
            b = voice()
            await agents.trace.record(b)  # a's POST has not answered yet
            gate.set()
            await holder
            c = voice()
            await agents.trace.record(c)
            return b, c

        b, c = run(go())
        sent = {t["id"]: t["messages"][0]["content"] for body in agents.mod.of("/api/agent/trace") for t in body["thoughts"]}
        assert sent[b.id] == STATIC
        assert sent[c.id] == (STATIC if fails else prefix_ref(a.id))


def test_load_recent_expands_references_even_from_before_the_window(tmp_path):
    trace = Trace(tmp_path, "evt")
    first = voice()
    run(trace.record(first))
    rest = [voice(line=str(i)) for i in range(4)]
    for t in rest:
        run(trace.record(t))
    fresh = Trace(tmp_path, "evt")
    assert fresh.load_recent("Trabolta", limit=3) == 3  # the full copy is outside the window
    assert [t.messages[0]["content"] for t in fresh.all("Trabolta")] == [STATIC] * 3
    assert fresh.find(rest[-1].id) is not None and fresh.refusal(rest[-1].id) is None
    # Read back, the references stay references on the way out again.
    assert fresh.stored(rest[-1])["messages"][0]["content"] == prefix_ref(first.id)


def test_an_unresolvable_reference_stays_the_literal_and_its_rerun_is_refused(tmp_path):
    trace = Trace(tmp_path, "evt")
    first, second = voice(), voice()
    run(trace.record(first))
    run(trace.record(second))
    path = trace.path("Trabolta")
    path.write_text(path.read_text().splitlines()[1] + "\n")  # the full copy is gone
    fresh = Trace(tmp_path, "evt")
    assert fresh.load_recent("Trabolta") == 1
    held = fresh.all("Trabolta")[0]
    assert held.messages[0]["content"] == prefix_ref(first.id)
    assert fresh.find(second.id) is None and fresh.refusal(second.id) == PREFIX_NOT_FOUND
    assert fresh.get(second.id) is held


def test_a_rerun_of_a_thought_whose_prefix_is_lost_is_refused(tmp_path):
    agents = worker(tmp_path)
    first, second = voice(), voice()
    run(agents.trace.record(first))
    run(agents.trace.record(second))
    path = agents.trace.path("Trabolta")
    path.write_text(path.read_text().splitlines()[1] + "\n")
    agents.trace = Trace(agents.trace.state_dir, "evt")
    agents.trace.load_recent("Trabolta")
    out = run(agents.control({"action": "rerun", "character": "Trabolta", "thought": second.id}))
    assert not out["ok"]  # never sent to a model with a reference for a prompt
    assert out["error"] == PREFIX_NOT_FOUND  # and the editor is told why (C6.6)


# -- the replay after hello ------------------------------------------------------------------


def test_trace_after_of_reads_only_numbers():
    assert trace_after_of({"traceAfter": {"Trabolta": 12.5, "Sandy": 0, "X": "nope", "Y": True}}) == {"Trabolta": 12.5, "Sandy": 0.0}
    assert trace_after_of({"worker": "w"}) is None and trace_after_of({"traceAfter": []}) is None and trace_after_of(None) is None


def _stamped(trace, n, start=1000.0, **kw):
    out = []
    for i in range(n):
        t = voice(**kw) if kw.get("static") else new_thought("Trabolta", "control", note=f"#{i}")
        t.at = start + i
        run(trace.record(t))
        out.append(t)
    return out


def test_hello_replays_only_what_the_server_lacks(tmp_path):
    agents = worker(tmp_path)
    thoughts = _stamped(agents.trace, 10)
    agents.mod.posts.clear()
    hello = {"worker": "w-1", "characters": ["Trabolta"], "unknown": [], "traceAfter": {"Trabolta": thoughts[6].at}}
    run(agents.on_frame("hello", json.dumps(hello)))
    sent = [t["id"] for body in agents.mod.of("/api/agent/trace") for t in body["thoughts"]]
    assert sent == [t.id for t in thoughts[7:]]
    assert [p for p, _ in agents.mod.posts][0] == "/api/agent/mind"


def test_hello_replays_everything_when_the_server_holds_nothing_or_does_not_say(tmp_path):
    agents = worker(tmp_path)
    thoughts = _stamped(agents.trace, 45)
    for after in ({"Trabolta": 0}, None, {"Sandy": 99999.0}):
        agents.mod.posts.clear()
        hello = {"worker": "w-1", "characters": ["Trabolta"], "unknown": []}
        if after is not None:
            hello["traceAfter"] = after
        run(agents.on_frame("hello", json.dumps(hello)))
        bodies = agents.mod.of("/api/agent/trace")
        assert all(len(b["thoughts"]) <= 40 for b in bodies)
        assert [t["id"] for b in bodies for t in b["thoughts"]] == [t.id for t in thoughts[-40:]]


def test_hello_replays_nothing_when_the_server_is_up_to_date(tmp_path):
    agents = worker(tmp_path)
    thoughts = _stamped(agents.trace, 5)
    agents.mod.posts.clear()
    run(agents.on_frame("hello", json.dumps({"worker": "w", "characters": ["Trabolta"], "unknown": [], "traceAfter": {"Trabolta": thoughts[-1].at}})))
    assert agents.mod.of("/api/agent/trace") == []


def test_the_replay_sends_a_prefix_in_full_when_the_server_cannot_hold_its_copy(tmp_path):
    trace = Trace(None)
    vs = _stamped(trace, 5, static=STATIC)
    assert [trace.ref_of(t.id) for t in vs[1:]] == [vs[0].id] * 4
    # The server holds up to vs[2]: vs[3] and vs[4] can keep referring to vs[0].
    held = replay_thoughts(trace, "Trabolta", vs[2].at)
    assert [d["messages"][0]["content"] for d in held] == [prefix_ref(vs[0].id)] * 2
    # A fresh server (after 0) gets every thought, and vs[0] is in the batch.
    fresh = replay_thoughts(trace, "Trabolta", 0.0)
    assert fresh[0]["messages"][0]["content"] == STATIC and [d["messages"][0]["content"] for d in fresh[1:]] == [prefix_ref(vs[0].id)] * 4
    # Only the last two fit and the full copy is not among them: the first
    # carries the text, the next refers to it.
    tail = replay_thoughts(trace, "Trabolta", 0.0, limit=2)
    assert tail[0]["messages"][0]["content"] == STATIC and tail[1]["messages"][0]["content"] == prefix_ref(vs[3].id)
    assert trace.all("Trabolta")[3].messages[0]["content"] == STATIC  # the ring is untouched


def test_hello_resets_the_prefixes_so_the_next_live_thought_is_whole(tmp_path):
    agents = worker(tmp_path)
    run(agents.trace.record(voice()))
    run(agents.on_frame("hello", json.dumps({"worker": "w", "characters": ["Trabolta"], "unknown": [], "traceAfter": {"Trabolta": 0}})))
    agents.mod.posts.clear()
    nxt = voice()
    run(agents.trace.record(nxt))
    sent = agents.mod.of("/api/agent/trace")[0]["thoughts"][0]
    assert sent["id"] == nxt.id and sent["messages"][0]["content"] == STATIC


@pytest.mark.parametrize("kind", ["brief", "summary"])
def test_the_new_kinds_are_recorded_and_streamed(tmp_path, kind):
    agents = worker(tmp_path)
    run(agents.trace.record(new_thought("Trabolta", kind, trigger="quiet" if kind == "summary" else "Jo")))
    assert [t["kind"] for b in agents.mod.of("/api/agent/trace") for t in b["thoughts"]] == [kind]


# -- a traceAfter the worker can't trust -------------------------------------------------------


class SeqMod(FakeMod):
    """Answers trace posts as the server does: `{accepted, seq}` off a log
    that `restart()` empties (a server restart under the stream)."""

    def __init__(self, seq=0):
        super().__init__()
        self.seq = seq
        self.ids = set()
        self.raise_on = None

    def restart(self):
        self.seq, self.ids = 0, set()

    async def post(self, p, body):
        if self.raise_on is not None and p in self.raise_on:
            raise httpx.ConnectError("refused")
        await super().post(p, body)
        if p != "/api/agent/trace":
            return {"ok": True}
        accepted = 0
        for t in body["thoughts"]:
            if t["id"] not in self.ids:
                self.ids.add(t["id"])
                self.seq += 1
                accepted += 1
        return {"ok": True, "accepted": accepted, "seq": self.seq}


def _hello(after):
    return json.dumps({"worker": "w", "characters": ["Trabolta"], "unknown": [], "traceAfter": {"Trabolta": after}})


def _replayed(agents):
    return [t["id"] for body in agents.mod.of("/api/agent/trace") for t in body["thoughts"]]


def test_a_failed_post_since_the_last_hello_makes_the_next_replay_send_everything(tmp_path):
    agents = worker(tmp_path)
    agents.mod = SeqMod(seq=100)
    older = _stamped(agents.trace, 5)
    agents.mod.raise_on = {"/api/agent/trace"}
    lost = _stamped(agents.trace, 1, start=2000.0)  # the server is down
    agents.mod.raise_on = None
    agents.mod.restart()
    landed = _stamped(agents.trace, 1, start=3000.0)  # it is back, before the stream's hello
    agents.mod.posts.clear()
    run(agents.on_frame("hello", _hello(landed[0].at)))  # the fresh server holds only `landed`
    assert _replayed(agents) == [t.id for t in older + lost + landed]


def test_a_live_post_into_an_empty_server_log_makes_the_next_replay_send_everything(tmp_path):
    agents = worker(tmp_path)
    agents.mod = SeqMod(seq=100)
    run(agents.on_frame("hello", _hello(0)))  # a server with the night so far
    older = _stamped(agents.trace, 4)
    assert not wire_of(agents).suspect
    agents.mod.restart()  # restarted under the stream, no post failed
    landed = _stamped(agents.trace, 1, start=3000.0)
    assert wire_of(agents).suspect
    agents.mod.posts.clear()
    run(agents.on_frame("hello", _hello(landed[0].at)))
    assert _replayed(agents) == [t.id for t in older + landed]


def test_a_seq_that_goes_down_is_a_restart_too(tmp_path):
    agents = worker(tmp_path)
    agents.mod = SeqMod(seq=500)
    run(agents.on_frame("hello", _hello(0)))
    _stamped(agents.trace, 2)
    agents.mod.restart()
    agents.mod.seq = 7  # another worker's replay reached the fresh log first
    _stamped(agents.trace, 1, start=3000.0)
    assert wire_of(agents).suspect


def test_a_healthy_server_keeps_the_replay_after_trace_after(tmp_path):
    agents = worker(tmp_path)
    agents.mod = SeqMod(seq=0)
    first = _stamped(agents.trace, 3)  # the night's first thoughts into an empty log: a cheap false alarm
    run(agents.on_frame("hello", _hello(first[-1].at)))  # …so this replay sends everything (ids it holds are dropped)
    assert not wire_of(agents).suspect
    more = _stamped(agents.trace, 3, start=2000.0)
    assert not wire_of(agents).suspect  # seq > accepted, rising: nothing restarted
    agents.mod.posts.clear()
    run(agents.on_frame("hello", _hello(more[0].at)))
    assert _replayed(agents) == [t.id for t in more[1:]]


def test_a_replay_into_a_fresh_server_is_not_a_restart(tmp_path):
    agents = worker(tmp_path)
    thoughts = _stamped(agents.trace, 3)
    agents.mod = SeqMod(seq=0)
    run(agents.on_frame("hello", _hello(0)))
    assert _replayed(agents) == [t.id for t in thoughts] and not wire_of(agents).suspect
    assert wire_of(agents).last_seq == 3


def test_a_failed_mirror_makes_the_wire_suspect_and_the_next_thought_whole(tmp_path):
    agents = worker(tmp_path)
    agents.mod = SeqMod(seq=50)
    run(agents.trace.record(voice()))
    agents.mod.raise_on = {"/api/agent/mind"}
    agents.minds["Trabolta"].exchanges += 1
    run(agents._mirror("Trabolta"))
    assert wire_of(agents).suspect
    agents.mod.raise_on = None
    agents.mod.posts.clear()
    run(agents.trace.record(voice()))
    assert agents.mod.of("/api/agent/trace")[0]["thoughts"][0]["messages"][0]["content"] == STATIC


def test_a_replay_that_cannot_connect_never_breaks_the_stream_and_is_tried_again(tmp_path):
    agents = worker(tmp_path)
    agents.mod = SeqMod(seq=0)
    thoughts = _stamped(agents.trace, 3)
    agents.mod.raise_on = {"/api/agent/trace"}
    run(agents.on_frame("hello", _hello(thoughts[-1].at)))  # nothing raised out of the frame
    agents.mod.raise_on = None
    assert wire_of(agents).suspect
    agents.mod.posts.clear()
    run(agents.on_frame("hello", _hello(thoughts[-1].at)))
    assert _replayed(agents) == [t.id for t in thoughts]
    assert not wire_of(agents).suspect


def test_a_thought_the_server_answered_accepted_0_is_never_a_prefix_holder(tmp_path):
    """w11b-1019 answers 200 {accepted: 0} for a kind it doesn't know (a
    `brief`): a later voice thought must carry its full prefix, never a
    reference the server can't expand."""
    agents = worker(tmp_path)

    class Drops(FakeMod):
        async def post(self, p, body):
            await super().post(p, body)
            if p == "/api/agent/trace":
                return {"ok": True, "accepted": 0 if body["thoughts"][0]["kind"] == "brief" else 1, "seq": len(self.posts)}
            return {"ok": True}

    agents.mod = Drops()
    brief = voice()
    brief.kind = "brief"

    async def go():
        await agents.trace.record(brief)
        b = voice()
        await agents.trace.record(b)
        return b

    b = run(go())
    sent = [t for body in agents.mod.of("/api/agent/trace") for t in body["thoughts"]]
    assert [t["id"] for t in sent] == [brief.id, b.id]
    assert sent[1]["messages"][0]["content"] == STATIC
