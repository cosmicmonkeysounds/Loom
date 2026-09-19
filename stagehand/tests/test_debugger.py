"""The mind debugger: the trace of thoughts, the structured mind (arc /
drives / policy / questions / revisions), the mind file's frontmatter, and
the control channel the panel (and the server's own restart) drive."""

import asyncio
import json
from pathlib import Path

import pytest

from stagehand.agents.config import parse_agents
from stagehand.agents.facts import Facts
from stagehand.agents.llm import Completion, LlmConfig
from stagehand.agents.mind import Mind
from stagehand.agents.module import Agents
from stagehand.agents.orchestrator import Orchestrator, OrchestratorConfig, reflect_messages, structure_block, survey_messages
from stagehand.agents.persona import parse_mind_file, parse_persona
from stagehand.agents.reply import Reply
from stagehand.agents.trace import Trace, new_thought
from stagehand.module import ConfigError

TRABOLTA = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet/trabolta.persona.md"

MIND_FILE = """---
stages: [lonely grandeur, appetite, the question, the turn]
drives:
  hunger: 40
  suspicion: 55
phases:
  glitch: "The house is open. You have just shown yourself."
  free_roam: "Everyone is loose."
---
You are the DIRECTOR OF THE MIND of {character}.
"""


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def req(**over):
    r = {
        "id": "ar-1",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g1"]},
        "speaker": {"kind": "guest", "id": "g1", "name": "Ada", "faction": None},
        "text": "Who is Sandy?",
        "history": [{"seq": 1, "mine": False, "from": "Ada", "text": "Who is Sandy?"}],
        "self": {"vars": {"truth": "35"}, "ranges": {}, "codex": []},
        "them": {"vars": {}, "codex": [], "location": "The Cache"},
        "world": {"Night.phase": "glitch"},
        "powers": [],
    }
    r.update(over)
    return r


# -- Completion ------------------------------------------------------------------


def test_completion_normalises_strings_and_lifts_inline_think_blocks():
    c = Completion.of("<think>hmm, Sandy</think>\n{\"say\": \"SANDY.\"}")
    assert c.thinking == "hmm, Sandy" and c.content.endswith('{"say": "SANDY."}') and str(c).startswith("<think>")
    assert Completion.of(None).content == "" and Completion.of(c) is c
    rich = Completion(content="x", thinking="y", finish="stop", prompt_tokens=10, completion_tokens=3, ms=120)
    assert Completion.of(rich) is rich


# -- Trace -------------------------------------------------------------------------


def test_trace_records_rings_appends_jsonl_and_reloads(tmp_path):
    trace = Trace(tmp_path, "evt", ring=3)
    seen = []
    trace.listen(lambda t: seen.append(t.id))
    cfg = LlmConfig(model="gpt-oss:20b", api="ollama", reasoning_effort="low")
    comp = Completion(content='{"say": "SANDY."}', thinking="she is the ferry bot", finish="stop", prompt_tokens=900, completion_tokens=40, ms=2100)
    t = new_thought("Trabolta", "voice", trigger="line", model=cfg, messages=[{"role": "system", "content": "x" * 30000}], completion=comp, request=req(), result={"say": "SANDY."})
    assert t.model == {"name": "gpt-oss:20b", "api": "ollama", "endpoint": cfg.endpoint, "temperature": 0.9, "max_tokens": 800, "reasoning_effort": "low", "think": None}
    assert t.request_id == "ar-1" and t.speaker == {"id": "g1", "name": "Ada", "kind": "guest"} and t.thread["channel"] == "dm:Trabolta"
    assert t.thinking == "she is the ferry bot" and t.ms == 2100 and t.prompt_tokens == 900
    assert t.messages[0]["content"].endswith("[+6000 chars]")  # bounded, and says so
    for i in range(4):
        run(trace.record(new_thought("Trabolta", "reflect", trigger="exchange", note=str(i))))
    run(trace.record(t))
    assert len(seen) == 5 and trace.recent("Trabolta", 2)[-1].id == t.id and len(trace.all("Trabolta")) == 3  # ring of 3
    assert trace.find(t.id) is t and trace.find("nope") is None
    path = tmp_path / "evt" / "Trabolta.trace.jsonl"
    lines = path.read_text().splitlines()
    assert len(lines) == 5 and json.loads(lines[-1])["kind"] == "voice"
    fresh = Trace(tmp_path, "evt", ring=10)
    assert fresh.load_recent("Trabolta") == 5 and fresh.all("Trabolta")[-1].thinking == "she is the ferry bot"
    assert Trace(None).path("x") is None


def test_a_failing_listener_never_breaks_recording():
    trace = Trace(None)

    def boom(t):
        raise RuntimeError("down")

    trace.listen(boom)
    run(trace.record(new_thought("T", "voice")))
    assert trace.recorded == 1


# -- the structured mind -------------------------------------------------------------


def test_seed_places_the_character_on_its_arc_and_a_reset_returns_to_the_doors():
    m = Mind("Trabolta", "e")
    m.seed(("lonely grandeur", "appetite"), {"hunger": 40, "suspicion": 55})
    assert m.stage == "lonely grandeur" and m.drives == {"hunger": 40, "suspicion": 55} and m.drive_starts == m.drives
    touched = m.apply({"stage": "2. APPETITE — hungry", "stage_why": "Ada fed him a fact", "drives": {"Hunger": 61, "bogus": 9}, "policy": {"favours": "earned", "credit": ["Ada"], "note": "one fact"}, "questions_add": ["what does earning feel like"], "answers_add": [{"q": "What does earning feel like?", "answer": "itchy", "from": "Ada"}]})
    assert touched == ["drives", "policy", "questions", "stage"]
    assert m.stage == "appetite" and m.stage_history[-1]["why"] == "Ada fed him a fact" and m.stage_history[-1]["by"] == "reflect"
    assert m.drives == {"hunger": 61, "suspicion": 55}  # undeclared drives are ignored
    assert m.policy == {"favours": "earned", "credit": ["Ada"], "wary": [], "note": "one fact"}
    assert m.questions == [{"q": "what does earning feel like", "answers": ["itchy — Ada"]}]
    # An unknown stage is refused (not invented); the same stage again is not a move.
    assert m.apply({"stage": "the end"}) == [] and m.apply({"stage": "appetite"}) == [] and len(m.stage_history) == 1
    block = m.prompt_block(None)
    assert "Where you are in your night: appetite (of: lonely grandeur → appetite)" in block
    assert "Your drives (0–100): hunger 61, suspicion 55" in block and "favours right now: earned; these people have credit with you: Ada" in block
    assert "(so far: itchy — Ada)" in block
    # Seeding again keeps where he got to; a reset goes back to the doors, as its own revision.
    m.seed(("lonely grandeur", "appetite"), {"hunger": 40, "suspicion": 55, "generosity": 10})
    assert m.stage == "appetite" and m.drives["hunger"] == 61 and m.drives["generosity"] == 10
    rev = m.rev
    m.reset(by="director")
    assert m.stage == "lonely grandeur" and m.drives == {"hunger": 40, "suspicion": 55, "generosity": 10} and m.policy["favours"] == "none" and m.questions == []
    assert m.rev == rev + 1 and m.revisions[-1]["by"] == "director" and m.revisions[-1]["touched"] == ["reset"]


def test_revisions_whispers_and_diffs():
    m = Mind("T", "e")
    m.saw_exchange("g1", "Ada", "guest", "t", 1)
    before = m.small()
    m.apply({"brief": "Be kind.", "notes_add": ["a", "b"], "person": {"trust": 70, "claims_add": ["is a nurse"]}}, speaker_id="g1", thought_id="th-1")
    assert m.rev == 1 and m.revisions[-1] == {**m.revisions[-1], "rev": 1, "by": "reflect", "thought": "th-1", "brief": "Be kind.", "notes": 2, "people": 1}
    mid = m.small()
    diff = Mind.diff(before, mid)
    assert diff["brief"] == ["", "Be kind."] and diff["notes"] == {"added": ["a", "b"], "dropped": []}
    assert diff["people"]["g1"] == {"trust": [50, 70], "claims": {"added": ["is a nurse"]}, "name": "Ada"}
    m.apply({"notes_drop": ["a"], "stage": "x"}, by="survey")  # free-form stage when none declared
    later = m.small()
    d2 = Mind.diff(mid, later)
    assert d2["notes"] == {"added": [], "dropped": ["a"]} and d2["stage"] == ["", "x"] and "brief" not in d2
    m.whisper("  be shaken:  the keys are turning ")
    assert m.director == ["be shaken: the keys are turning"] and m.revisions[-1]["touched"] == ["director"]
    assert "THE DIRECTOR WHISPERS" in m.prompt_block(None)
    assert m.apply({"mood": "shaken", "director_consumed": True}) == ["director", "mood"] and m.director == []
    assert m.forget_person("ada") and m.people == {} and not m.forget_person("ada")
    assert Mind.diff(later, m.small())["people"]["g1"] == {"dropped": True}
    # The report + JSON round trip carry all of it.
    doc = m.to_json()
    back = Mind.from_json(doc)
    assert back.rev == m.rev and back.revisions == m.revisions and back.stage == "x"
    r = m.report("w")
    assert r["stage"] == "x" and r["revisions"][-1]["rev"] == m.rev and r["director"] == []


# -- the mind file's frontmatter --------------------------------------------------------


def test_mind_file_frontmatter_declares_the_arc_drives_and_phase_cues(tmp_path):
    prompt, stages, drives, phases = parse_mind_file(MIND_FILE, "m.md")
    assert prompt.startswith("You are the DIRECTOR") and stages == ("lonely grandeur", "appetite", "the question", "the turn")
    assert drives == {"hunger": 40, "suspicion": 55} and phases == {"glitch": "The house is open. You have just shown yourself.", "free_roam": "Everyone is loose."}
    assert parse_mind_file("plain prompt") == ("plain prompt", (), {}, {})
    assert parse_mind_file("---\ndrives: [a, b]\n---\nbody")[2] == {"a": 50, "b": 50}
    with pytest.raises(ConfigError, match="unknown frontmatter"):
        parse_mind_file("---\nbogus: 1\n---\nbody")
    with pytest.raises(ConfigError, match="drives.hunger"):
        parse_mind_file("---\ndrives: {hunger: lots}\n---\nbody")
    (tmp_path / "t.mind.md").write_text(MIND_FILE, encoding="utf-8")
    (tmp_path / "t.persona.md").write_text("---\ncharacter: Trabolta\nmind: t.mind.md\n---\nYou are TRABOLTA.", encoding="utf-8")
    from stagehand.agents.persona import load_persona

    p = load_persona(tmp_path / "t.persona.md")
    assert p.stages[0] == "lonely grandeur" and p.drives["hunger"] == 40 and p.phase_cues["glitch"].startswith("The house")
    assert "{character}" in p.mind_prompt


def test_the_shipped_trabolta_mind_declares_an_arc():
    from stagehand.agents.persona import load_persona

    p = load_persona(TRABOLTA)
    assert p.stages == ("lonely grandeur", "appetite", "the question", "the turn")
    assert set(p.drives) == {"hunger", "suspicion", "generosity", "resolve"}
    assert {"desktop", "bingo", "hunt", "free_roam", "destruct", "ending"} <= set(p.phase_cues)


# -- the orchestrator with structure --------------------------------------------------------


def persona_with_mind():
    p = parse_persona("---\ncharacter: Trabolta\nvariables: truth\n---\nYou are TRABOLTA.")
    prompt, stages, drives, phases = parse_mind_file(MIND_FILE)
    return type(p)(**{**p.__dict__, "mind_prompt": prompt, "stages": stages, "drives": drives, "phase_cues": phases})


def test_prompts_carry_the_arc_the_drives_the_phase_cue_and_the_whisper():
    persona = persona_with_mind()
    mind = Mind("Trabolta", "e")
    mind.seed(persona.stages, persona.drives)
    mind.saw_exchange("g1", "Ada", "guest", "t", 1)
    mind.whisper("be shaken")
    msgs = reflect_messages(persona, mind, req(), Reply(say="SANDY."), None, 20, "t")
    system, user = msgs[0]["content"], msgs[1]["content"]
    assert system.startswith("You are the DIRECTOR OF THE MIND of Trabolta.") and "=== THE ARC" in system and "lonely grandeur → appetite → the question → the turn" in system
    assert "hunger = 40, suspicion = 55" in system and "=== THE POLICY ===" in system and "=== THE QUESTIONS ===" in system
    assert "THE STORY'S PHASE: glitch" in user and "You have just shown yourself." in user
    assert "THE DIRECTOR WHISPERS" in user and "- be shaken" in user
    assert '"stage": "<one of the declared stages>"' in user and '"drives"' in user
    facts = Facts({"world": {"Night.phase": "free_roam"}, "programs": [], "locations": [], "codex": []})
    survey = survey_messages(persona, mind, facts, ["phase: glitch → free_roam"], phase_changed_to="free_roam")
    assert "THE HOUSE JUST ENTERED: free_roam" in survey[1]["content"] and "Everyone is loose." in survey[1]["content"]
    assert structure_block(parse_persona("---\ncharacter: X\n---\nb"), Mind("X", "e")).startswith("=== THE POLICY ===")


def harness(complete, facts=None, trace=None):
    persona = persona_with_mind()
    mind = Mind("Trabolta", "e")
    mind.seed(persona.stages, persona.drives)
    mind.saw_exchange("g1", "Ada", "guest", "t", 1)
    updates = []

    async def on_update(character, m, job, touched):
        updates.append((job.kind, touched))

    async def facts_fn(force):
        return facts

    orch = Orchestrator(OrchestratorConfig(quiet_s=0, survey_every_s=0), complete, {"Trabolta": LlmConfig(model="qwen", api="ollama", extra={"think": False})}, {"Trabolta": persona}, {"Trabolta": mind}, on_update, facts_fn, trace=trace)
    return orch, mind, updates


async def until(pred, timeout=2.0):
    for _ in range(int(timeout / 0.01)):
        if pred():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not met")


def test_a_reflection_is_traced_with_its_diff_and_consumes_the_whisper():
    trace = Trace(None)

    async def complete(messages, cfg):
        return Completion(content='{"stage": "appetite", "stage_why": "fed", "drives": {"hunger": 70}, "mood": "hungry", "policy": {"favours": "earned", "credit": ["Ada"]}}', thinking="she gave him a fact", ms=900)

    orch, mind, updates = harness(complete, trace=trace)
    mind.whisper("be hungry")

    async def go():
        orch.reflect("Trabolta", "t", req(), Reply(say="MORE."))
        task = asyncio.ensure_future(orch.run())
        try:
            await until(lambda: updates)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    run(go())
    assert updates == [("reflect", ["director", "drives", "mood", "policy", "stage"])]
    assert mind.stage == "appetite" and mind.drives["hunger"] == 70 and mind.director == []
    t = trace.all("Trabolta")[-1]
    assert t.kind == "reflect" and t.trigger == "exchange" and t.thinking == "she gave him a fact" and t.ms == 900
    assert t.diff["stage"] == ["lonely grandeur", "appetite"] and t.diff["drives"] == {"hunger": [40, 70]} and t.diff["director"] == {"added": [], "dropped": ["be hungry"]}
    assert t.revision == mind.rev and t.result["mood"] == "hungry" and t.model["name"] == "qwen" and t.model["think"] is False
    assert orch.status("Trabolta")["thinking"] is False and orch.status("Trabolta")["completed"] == 1


def test_unusable_output_and_failures_are_traced_as_errors():
    from stagehand.agents.llm import LlmError

    trace = Trace(None)
    calls = 0

    async def complete(messages, cfg):
        nonlocal calls
        calls += 1
        if calls == 1:
            return "I refuse."
        raise LlmError("down")

    orch, mind, updates = harness(complete, trace=trace)

    async def go():
        orch.reflect("Trabolta", "t", req(), Reply(say="x"))
        task = asyncio.ensure_future(orch.run())
        try:
            await until(lambda: len(trace.all("Trabolta")) == 1)
            orch.reflect("Trabolta", "t", req(), Reply(say="y"))
            await until(lambda: len(trace.all("Trabolta")) == 2)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    run(go())
    a, b = trace.all("Trabolta")
    assert a.error == "no JSON object in the output" and a.output == "I refuse." and a.revision is None
    assert b.error == "down" and b.output == "" and not updates and orch.last_error == "down"


def test_pause_thinking_toggle_and_rerun():
    trace = Trace(None)
    seen = []

    async def complete(messages, cfg):
        seen.append(cfg)
        return Completion(content='{"mood": "wary"}', thinking="…" if cfg.extra.get("think") else "")

    orch, mind, updates = harness(complete, trace=trace)
    assert orch.set_thinking("Trabolta", True) and orch.thinking("Trabolta") and orch.models["Trabolta"].extra["think"] is True
    assert not orch.set_thinking("Nobody", True)

    async def go():
        orch.set_paused(True)
        orch.reflect("Trabolta", "t", req(), Reply(say="x"))
        task = asyncio.ensure_future(orch.run())
        try:
            await asyncio.sleep(0.1)
            assert not updates and orch.pending == 1 and orch.status("Trabolta")["paused"] is True
            orch.set_paused(False)
            await until(lambda: updates)
            first = trace.all("Trabolta")[-1]
            assert first.thinking == "…"
            orch.rerun(first, LlmConfig(model="other"))
            await until(lambda: len(trace.all("Trabolta")) == 2)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    run(go())
    rerun = trace.all("Trabolta")[-1]
    assert rerun.kind == "rerun" and rerun.trigger.startswith("rerun:th-") and rerun.result == {"mood": "wary"} and rerun.revision is None
    assert rerun.note.startswith("re-run of th-") and seen[-1].model == "other" and mind.mood == "wary" and len(updates) == 1  # not applied twice


# -- the control channel (worker side) ------------------------------------------------------


class FakeMod:
    base_url = "http://srv"

    def __init__(self):
        self.posts = []

    def path(self, p):
        return f"/e/evt{p}"

    async def post(self, p, body):
        self.posts.append((p, body))
        return {"ok": True, "applied": {}}


def worker(tmp_path, complete_fn):
    (tmp_path / "t.mind.md").write_text(MIND_FILE, encoding="utf-8")
    (tmp_path / "t.persona.md").write_text("---\ncharacter: Trabolta\nvariables: truth\nmind: t.mind.md\n---\nYou are TRABOLTA.", encoding="utf-8")
    cfg = parse_agents({"characters": ["t.persona.md"], "orchestrator": {"llm": {"model": "orch"}, "quiet_s": 0, "survey_every_s": 0}, "state_dir": "minds"}, str(tmp_path))
    agents = Agents(cfg, complete_fn)
    agents.mod = FakeMod()
    agents.event = "evt"
    return agents


def test_control_actions_edit_the_mind_and_are_mirrored_and_traced(tmp_path):
    async def fake(messages, cfg):
        return '{"say": "ok"}'

    agents = worker(tmp_path, fake)
    mind = agents.minds["Trabolta"]
    assert mind.stage == "lonely grandeur" and mind.drives["hunger"] == 40
    mind.saw_exchange("g1", "Ada", "guest", "t", 1)

    async def go():
        assert (await agents.control({"action": "nudge", "character": "Trabolta", "text": "be shaken", "by": "Jo"}))["ok"]
        assert mind.director == ["be shaken"] and agents.orchestrator.pending == 1  # a survey is queued
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "stage", "value": "the question", "why": "we skipped ahead", "by": "Jo"}))["ok"]
        assert mind.stage == "the question" and mind.stage_history[-1]["by"] == "Jo"
        bad = await agents.control({"action": "set", "character": "Trabolta", "field": "stage", "value": "nowhere"})
        assert not bad["ok"] and "declared stages" in bad["error"]
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "drive", "name": "hunger", "value": 90}))["ok"] and mind.drives["hunger"] == 90
        assert not (await agents.control({"action": "set", "character": "Trabolta", "field": "drive", "name": "nope", "value": 1}))["ok"]
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "trust", "person": "ada", "value": 5}))["ok"] and mind.people["g1"].trust == 5
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "brief", "value": "Be brisk."}))["ok"] and mind.brief == "Be brisk."
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "note", "add": "Ada lied."}))["ok"] and mind.notes == ["Ada lied."]
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "question", "add": "what is a body for"}))["ok"] and mind.questions[0]["q"] == "what is a body for"
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "policy", "value": {"favours": "loose"}}))["ok"] and mind.policy["favours"] == "loose"
        assert (await agents.control({"action": "forget", "character": "Trabolta", "person": "Ada"}))["ok"] and mind.people == {}
        assert (await agents.control({"action": "thinking", "character": "Trabolta", "on": True}))["ok"] and agents.orchestrator.thinking("Trabolta")
        assert (await agents.control({"action": "effort", "character": "Trabolta", "level": "high"}))["ok"] and agents.models["Trabolta"].reasoning_effort == "high"
        assert (await agents.control({"action": "effort", "character": "Trabolta", "level": "none"}))["ok"] and agents.models["Trabolta"].reasoning_effort is None
        assert not (await agents.control({"action": "effort", "character": "Trabolta", "level": "max"}))["ok"]
        assert (await agents.control({"action": "pause", "character": "Trabolta", "on": True}))["ok"] and agents.orchestrator.paused
        assert not (await agents.control({"action": "rerun", "character": "Trabolta", "thought": "th-nope"}))["ok"]
        assert not (await agents.control({"action": "dance"}))["ok"]
        assert not (await agents.control({"action": "survey", "character": "Nobody"}))["ok"]
        assert (await agents.control({"action": "survey"}))["ok"]  # no character → every mind

    run(go())
    mirrors = [b for p, b in agents.mod.posts if p == "/api/agent/mind"]
    assert mirrors[-1]["stage"] == "the question" and mirrors[-1]["drives"]["hunger"] == 90 and mirrors[-1]["status"]["mind"]["paused"] is True
    assert mirrors[-1]["status"]["voice"]["effort"] is None and mirrors[-1]["status"]["mind"]["thinking"] is True
    controls = [t for p, b in agents.mod.posts if p == "/api/agent/trace" for t in b["thoughts"] if t["kind"] == "control"]
    assert controls[0]["note"] == "nudge: be shaken" and controls[0]["trigger"] == "Jo"
    assert any(t["note"].startswith("set stage") for t in controls) and any(t["note"] == "forgot Ada" for t in controls)
    saved = json.loads((tmp_path / "minds" / "evt" / "Trabolta.mind.json").read_text())
    assert saved["stage"] == "the question" and saved["revisions"][-1]["by"] in ("Jo", "server", "director")


def test_hello_replays_the_mind_and_the_recent_trace(tmp_path):
    async def fake(messages, cfg):
        return '{"say": "ok"}'

    agents = worker(tmp_path, fake)
    run(agents.trace.record(new_thought("Trabolta", "voice", note="earlier tonight")))
    agents.mod.posts.clear()  # (that record was streamed as it happened)
    run(agents.on_frame("hello", json.dumps({"worker": "w-9", "characters": ["Trabolta"], "unknown": []})))
    paths = [p for p, _ in agents.mod.posts]
    assert paths[:2] == ["/api/agent/mind", "/api/agent/trace"]
    replay = agents.mod.posts[1][1]
    assert replay["worker"] == "w-9" and [t["note"] for t in replay["thoughts"]] == ["earlier tonight"]
    assert agents.orchestrator.pending == 1  # the first look at the house


def test_a_voice_request_traces_the_lookup_round_too(tmp_path):
    calls = []

    async def fake(messages, cfg):
        calls.append(messages)
        if len(calls) == 1:
            return Completion(content='{"lookup": ["Excel"]}', thinking="who is Excel?", finish="stop", ms=500)
        return '{"say": "Excel is in the kitchen.", "adjust": {"truth": 2}}'

    agents = worker(tmp_path, fake)
    facts = Facts({"world": {}, "programs": [{"id": "g2", "name": "Excel", "location": "The Cache", "codex": []}], "locations": [], "codex": []})

    async def facts_fn(force=False):
        return facts

    agents._facts = facts_fn

    async def go():
        await agents.on_frame("request", json.dumps(req()))
        await asyncio.gather(*agents.tasks.values())

    run(go())
    thoughts = [t for p, b in agents.mod.posts if p == "/api/agent/trace" for t in b["thoughts"]]
    assert [t["kind"] for t in thoughts] == ["voice", "lookup"]
    assert thoughts[0]["thinking"] == "who is Excel?" and thoughts[0]["result"]["lookup"] == ["Excel"] and thoughts[0]["trigger"] == "line"
    assert thoughts[1]["result"]["say"] == "Excel is in the kitchen." and "LOOKUP RESULTS" in thoughts[1]["messages"][-2]["content"]
    assert agents.status("Trabolta")["thoughts"] == 2
