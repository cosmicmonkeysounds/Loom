"""The new mind (`mind_mode: new`, wave 12): the story keeps it, one voice call per line.

The lean voice (`voice.answer_lean`, lane W1) is injected as a fake here:
these tests pin what the story mind builds for it (the phase view, the
person card, since-you-last-spoke, already-said, the options) and what it
keeps afterwards (memos, the dossier, revisions), plus the Rewrite brief,
the quiet summary and the controls — never a real model.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any

import pytest

from stagehand.agents import story_mind
from stagehand.agents.cards import VoiceContext
from stagehand.agents.config import parse_agents
from stagehand.agents.facts import FactsClient
from stagehand.agents.llm import Completion
from stagehand.agents.module import Agents
from stagehand.agents.trace import new_thought

MIND = """---
stages: [asleep, formal, hungry, judge]
drives: {hunger: 30, pride: 60}
secrets:
  topics: [the velvet lighthouse]
  match: [marmalade, quillfeather]
  lore: ["▒ HUNT ANSWER"]
  never: ["XYZZY-PLUGH"]
phases:
  _stages:
    asleep: >-
      Dormant.
    formal: >-
      Corporate and helpful.
    hungry: >-
      Starved for facts.
    judge: >-
      Cold.
  arrivals:
    stage: asleep
    brief: >-
      Not running yet.
  introduced:
    stage: formal
    drives: {hunger: 45}
    powers: [snoop, ghost_power]
    tell: [The Optical Drive, Not Held Yet]
    brief: >-
      Be the helper.
  hunt_1:
    stage: hungry
    favours: earned
    drives: {hunger: 70}
    powers: [pop_up]
    brief: >-
      Ask for facts. File them.
  finale_song: >-
    The end.
---
You keep the mind.
"""

PERSONA = """---
character: Trabolta
variables: truth, regard
max_step: 8
facts: Night.phase, Night.lj_reader
them: trust, marked, at_the_heart, truths_accepted
mind: t.mind.md
when: self.awake == true
unavailable: "Later tonight."
catchphrases:
  - "Your request has been logged"
fallback: "…packet loss."
---
You are TRABOLTA.
"""


@dataclass(frozen=True)
class FakeReply:
    say: str = ""
    adjust: dict[str, int] = field(default_factory=dict)
    lookup: tuple[str, ...] = ()
    acts: tuple[dict[str, Any], ...] = ()
    memo: str = ""

    @property
    def empty(self) -> bool:
        return not self.say


class FakeMod:
    base_url = "http://srv"

    def __init__(self, facts: dict[str, Any] | None = None):
        self.posts: list[tuple[str, Any]] = []
        self.gets: list[str] = []
        self.facts = facts or {}

    def path(self, p):
        return f"/e/evt{p}"

    async def post(self, p, body):
        self.posts.append((p, body))
        return {"ok": True}

    async def get(self, p):
        self.gets.append(p)
        return self.facts

    def of(self, path):
        return [b for p, b in self.posts if p == path]

    def thoughts(self):
        return [t for b in self.of("/api/agent/trace") for t in b["thoughts"]]


class FakeVoice:
    """Stands in for `voice.answer_lean`: records each context, traces a voice thought."""

    def __init__(self, *replies: FakeReply):
        self.replies = list(replies) or [FakeReply(say="Noted.")]
        self.calls: list[tuple[dict[str, Any], VoiceContext]] = []

    async def __call__(self, persona, model, req, ctx, complete_fn, trace=None, facts_fn=None):
        self.calls.append((req, ctx))
        if persona.when is not None and not persona.when.evaluate(story_mind_gate(req)):
            return FakeReply(say=persona.unavailable)
        reply = self.replies[min(len(self.calls), len(self.replies)) - 1]
        if trace is not None:
            await trace.record(new_thought(persona.character, "voice", trigger="line", model=model, messages=[{"role": "system", "content": "P1"}], request=req, result={"say": reply.say}))
        return reply


def story_mind_gate(req):
    from stagehand.agents.prompt import gate_context

    return gate_context(req)


def make(tmp_path, fake=None, complete_fn=None, facts=None, **section):
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "t.mind.md").write_text(MIND, encoding="utf-8")
    (tmp_path / "t.persona.md").write_text(PERSONA, encoding="utf-8")
    doc = {"characters": ["t.persona.md"], "state_dir": "minds", "mind_mode": "new", **section}
    cfg = parse_agents(doc, str(tmp_path))
    fake = fake or FakeVoice()
    agents = Agents(cfg, complete_fn, voice_fn=fake)
    agents.mod = FakeMod(facts)
    agents.facts = FactsClient(agents.mod, 0)
    agents.event = "evt"
    return agents, fake


def req(phase="introduced", text="hello", pid="g-1", name="Ada", history=None, recent=None, story_at=None, them_vars=None, rid="ar-1", self_codex=None, **over):
    r: dict[str, Any] = {
        "id": rid,
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": [pid]},
        "speaker": {"kind": "guest", "id": pid, "name": name, "faction": "Chatters"},
        "text": text,
        "history": history if history is not None else [{"seq": 1, "mine": False, "from": name, "text": text}],
        "self": {
            "vars": {"truth": "40", "regard": "10", "awake": "true"},
            "ranges": {"truth": [0, 100], "regard": [0, 100]},
            "codex": self_codex
            if self_codex is not None
            else [{"id": "c1", "title": "The Optical Drive", "text": "the front door"}, {"id": "c2", "title": "Stamped", "text": "x ▒ HUNT ANSWER H1 ▒"}],
        },
        "them": {"vars": {"trust": "55", "marked": "false", "at_the_heart": "false", "truths_accepted": "1", **(them_vars or {})}, "codex": [{"title": "The Optical Drive"}, {"title": "Stamped ▒ HUNT ANSWER H1 ▒"}], "location": "The Desktop"},
        "world": {"Night.phase": phase, "Night.lj_reader": "none"},
        "powers": [{"id": "snoop", "description": "read a file", "limit": 3, "used": 0}, {"id": "pop_up", "description": "a pop-up"}],
    }
    if recent is not None:
        r["recent"] = recent
    if story_at is not None:
        r["storyAt"] = story_at
    r.update(over)
    return r


def run(coro):
    return asyncio.run(coro)


async def handle(agents, *reqs):
    for r in reqs:
        await agents._handle(r)


# -- config ---------------------------------------------------------------------------


def test_the_new_mind_never_starts_the_orchestrator(tmp_path):
    agents, _ = make(tmp_path, orchestrator={"enabled": True, "survey_every_s": 120})
    assert agents.cfg.new_mind and agents.cfg.orchestrator.enabled is False
    assert agents.minds["Trabolta"].mode == "new"

    async def go():
        await agents.on_frame("hello", json.dumps({"worker": "w-1", "characters": ["Trabolta"], "unknown": []}))
        agents.orchestrator.survey("Trabolta", "timer")
        agents.orchestrator.reflect("Trabolta", "k", {}, None)
        assert agents.orchestrator.pending == 0  # nothing is ever submitted
        await asyncio.gather(*agents._side)

    run(go())


def test_one_voice_call_per_line_and_no_facts_fetch_per_request(tmp_path):
    agents, voice = make(tmp_path, FakeVoice(FakeReply(say="Logged, program.", memo="came in asking for the helper")))
    run(handle(agents, req()))
    assert len(voice.calls) == 1
    assert agents.mod.gets == []  # the voice fetches facts only for an act / a lookup
    assert agents.mod.of("/api/agent/reply") == [{"id": "ar-1", "say": "Logged, program.", "adjust": {}}]
    mind = agents.minds["Trabolta"]
    d = mind.people["g-1"]
    assert d.turns == 1 and d.memos[0]["text"] == "came in asking for the helper" and d.memos[0]["heart"] is False
    assert d.memos[0]["thought"] == next(t.id for t in agents.trace.all("Trabolta") if t.kind == "voice")
    assert mind.said[-1]["text"] == "Logged, program." and mind.said[-1]["thread"] == "dm:Trabolta|g-1"
    # A memo writes no revision: the only one is the card's.
    assert [r["by"] for r in mind.revisions] == ["story"]
    report = agents.mod.of("/api/agent/mind")[-1]
    assert report["mode"] == "new" and report["people"][0]["memos"][0]["by"] == "voice"
    assert report["status"]["mindMode"] == "new" and report["status"]["voice"]["memo"] is True and report["status"]["phaseWatchS"] == 30


def test_options_follow_the_config(tmp_path):
    agents, voice = make(tmp_path, voice={"memo": "off", "repeat_guard": False, "layout": "classic"})
    run(handle(agents, req()))
    opts = voice.calls[0][1].options
    assert (opts.memo, opts.repeat_guard, opts.layout, opts.retry_allowed) == (False, False, "classic", True)


def test_a_waiting_request_forbids_the_retry(tmp_path):
    agents, voice = make(tmp_path)

    async def go():
        agents.tasks["other"] = asyncio.ensure_future(asyncio.sleep(0))
        agents.tasks["ar-1"] = asyncio.current_task()
        await agents._handle(req())
        await agents.tasks.pop("other")

    run(go())
    assert voice.calls[0][1].options.retry_allowed is False


def test_a_memo_off_or_carrying_a_never_word_is_not_stored(tmp_path):
    agents, _ = make(tmp_path, FakeVoice(FakeReply(say="ok", memo="typed XYZZY-PLUGH at me"), FakeReply(say="ok", memo="says it is marmalade"), FakeReply(say="ok", memo="asked about the velvet lighthouse")))
    run(handle(agents, req(rid="1"), req(rid="2"), req(rid="3")))
    assert [m["text"] for m in agents.minds["Trabolta"].people["g-1"].memos] == ["asked about the velvet lighthouse"]
    agents2, _ = make(tmp_path / "b", FakeVoice(FakeReply(say="ok", memo="a fine memo")), voice={"memo": False})
    run(handle(agents2, req()))
    assert agents2.minds["Trabolta"].people["g-1"].memos == []


def test_asleep_he_answers_unavailable_and_keeps_no_file(tmp_path):
    agents, voice = make(tmp_path)
    r = req()
    r["self"]["vars"]["awake"] = "false"
    run(handle(agents, r))
    assert agents.mod.of("/api/agent/reply")[0]["say"] == "Later tonight."
    assert agents.minds["Trabolta"].people == {}


# -- the phase card ---------------------------------------------------------------


def test_a_phase_card_is_applied_once_per_phase_as_one_story_revision(tmp_path):
    agents, voice = make(tmp_path)
    mind = agents.minds["Trabolta"]
    run(handle(agents, req(phase="introduced", rid="a"), req(phase="introduced", rid="b")))
    assert [r["by"] for r in mind.revisions] == ["story"]
    assert (mind.stage, mind.drives, mind.live_powers, mind.tell, mind.brief, mind.brief_by) == ("formal", {"hunger": 45, "pride": 60}, ["snoop", "ghost_power"], ["The Optical Drive", "Not Held Yet"], "Be the helper.", "story")
    assert mind.stage_history[-1]["by"] == "story" and mind.stage_history[-1]["why"] == "phase introduced"
    # A director's brief holds until the next phase; the whisper too.
    run(agents.control({"action": "set", "character": "Trabolta", "field": "brief", "value": "Hold back.", "by": "Jo"}))
    run(agents.control({"action": "nudge", "character": "Trabolta", "text": "be warmer", "by": "Jo"}))
    assert mind.brief_by == "director" and mind.revisions[-2]["by"] == "director" and mind.revisions[-1]["by"] == "director"
    run(handle(agents, req(phase="introduced", rid="c")))
    assert mind.brief == "Hold back." and mind.director == ["be warmer"]
    run(handle(agents, req(phase="hunt_1", rid="d")))
    assert (mind.stage, mind.brief, mind.brief_by, mind.director, mind.policy["favours"], mind.drives["hunger"]) == ("hungry", "Ask for facts. File them.", "story", [], "earned", 70)
    assert mind.revisions[-1]["by"] == "story" and set(mind.revisions[-1]["touched"]) >= {"brief", "director", "drives", "policy", "powers", "stage"}


def test_the_phase_view_shows_live_powers_tell_and_wary_from_the_story(tmp_path):
    agents, voice = make(tmp_path)
    r = req(phase="introduced")
    r["world"]["Night.lj_reader"] = "Microsoft Excel"
    run(handle(agents, r))
    view = voice.calls[0][1].phase
    assert view.phase == "introduced" and view.stage == "formal" and view.stage_card == "Corporate and helpful."
    assert view.live_powers == ("snoop",)  # ghost_power is not on offer: ignored
    assert view.tell == ("The Optical Drive",)  # held + visible only
    assert view.wary == ("Microsoft Excel",) and view.brief_by == "story" and view.favours == "none"
    assert view.drives == {"hunger": 45, "pride": 60}


def test_a_phase_with_no_card_makes_every_power_live_again(tmp_path):
    agents, voice = make(tmp_path)
    run(handle(agents, req(phase="introduced", rid="a"), req(phase="somewhere_new", rid="b")))
    mind = agents.minds["Trabolta"]
    assert mind.phase_applied == "somewhere_new" and mind.live_powers is None and mind.stage == "formal"
    assert voice.calls[1][1].phase.live_powers is None


def test_stage_from_phase_off_applies_nothing(tmp_path):
    agents, voice = make(tmp_path, mind={"stage_from_phase": "off"})
    run(handle(agents, req(phase="hunt_1")))
    mind = agents.minds["Trabolta"]
    assert mind.stage == "asleep" and mind.revisions == [] and voice.calls[0][1].phase.live_powers is None
    assert agents.status("Trabolta")["phaseWatchS"] == 0


def test_the_phase_watch_and_the_hello_fetch_apply_the_card_without_a_model(tmp_path):
    calls = []

    async def complete(messages, cfg):
        calls.append(messages)
        return "x"

    agents, _ = make(tmp_path, complete_fn=complete, facts={"world": {"Night.phase": "hunt_1"}})

    async def go():
        await agents.on_frame("hello", json.dumps({"worker": "w-1", "characters": ["Trabolta"], "unknown": []}))
        await asyncio.gather(*agents._side)

    run(go())
    assert agents.minds["Trabolta"].stage == "hungry" and calls == []
    assert agents.mod.gets == ["/api/agent/facts"]
    assert story_mind.current_phase({"Show.phase": "b", "A.phase": "a"}) == "a"


# -- the person card ----------------------------------------------------------------


def test_the_person_card_reads_the_story_and_writes_first_met_once(tmp_path):
    agents, voice = make(tmp_path)
    recent = [
        {"kind": "marked"},
        {"kind": "chart", "rank": 2, "of": 9, "called": "top"},
        {"kind": "gift", "title": "▒ HUNT ANSWER H1 ▒ in a title", "new": True, "at": 101},
        {"kind": "gift", "title": "The Optical Drive", "new": True, "at": 100},
        {"kind": "filing", "question": "H2"},
        {"kind": "filing", "question": "H1"},
    ]
    run(handle(agents, req(text="I brought you a door", recent=recent, story_at=200, them_vars={"trust": "61", "marked": "true"})))
    card = voice.calls[0][1].person
    assert card.turns == 0 and card.trust == "61" and card.location == "The Desktop" and card.kind == "guest"
    assert card.first_met == "First met during introduced in The Desktop. Their first words to you: “I brought you a door”"
    assert card.gifts == ("The Optical Drive",) and card.filings == ("H1", "H2") and card.marked is True
    assert card.chart == "2 of 9; you named them Most Trusted"
    assert card.numbers == (("at_the_heart", "false"), ("truths_accepted", "1"))
    assert card.holds == ("The Optical Drive",)  # the stamped title never shows
    d = agents.minds["Trabolta"].people["g-1"]
    assert (d.story_trust, d.last_phase, d.last_story_at) == ("61", "introduced", 200.0)
    run(handle(agents, req(text="again", rid="ar-2")))
    assert d.first_met.startswith("First met during introduced") and "again" not in d.first_met


def test_first_words_naming_a_hunt_word_or_a_secret_are_left_out(tmp_path):
    agents, voice = make(tmp_path)
    run(handle(agents, req(text="is it marmalade?")))
    assert voice.calls[0][1].person.first_met == "First met during introduced in The Desktop."


def test_without_recent_the_card_comes_from_their_vars_alone(tmp_path):
    agents, voice = make(tmp_path)
    run(handle(agents, req(them_vars={"marked": "true"})))
    card = voice.calls[0][1].person
    assert card.marked is True and card.gifts == () and card.chart is None


def test_heart_memos_reach_the_voice_only_at_the_heart_and_only_their_own(tmp_path):
    agents, voice = make(tmp_path, FakeVoice(FakeReply(say="a", memo="spoke at my heart"), FakeReply(say="b", memo="plain memo"), FakeReply(say="c", memo="other person"), FakeReply(say="d"), FakeReply(say="e")))
    run(handle(agents, req(them_vars={"at_the_heart": "true"}, rid="1"), req(rid="2"), req(pid="g-2", name="Bob", rid="3"), req(rid="4"), req(them_vars={"at_the_heart": "true"}, rid="5")))
    assert agents.minds["Trabolta"].people["g-1"].memos[0]["heart"] is True
    assert voice.calls[3][1].person.memos == ("plain memo",)
    assert voice.calls[4][1].person.memos == ("spoke at my heart", "plain memo")
    assert all("other person" not in m for c in voice.calls for m in c[1].person.memos if c[1].person.id == "g-1")


def test_since_you_last_spoke_in_priority_and_at_most_four(tmp_path):
    agents, voice = make(tmp_path)
    run(handle(agents, req(phase="introduced", recent=[], story_at=1000, rid="1")))
    recent = [
        {"kind": "marked"},
        {"kind": "chart", "rank": 9, "of": 9, "called": "bottom"},
        {"kind": "house", "text": "Second house line.", "at": 3000},
        {"kind": "house", "text": "First house line.", "at": 2000},
        {"kind": "gift", "title": "A Gift", "new": True, "at": 2500},
    ]
    run(handle(agents, req(phase="hunt_1", recent=recent, story_at=4000, rid="2")))
    assert voice.calls[0][1].since == ()
    assert voice.calls[1][1].since == (
        "The night moved: introduced → hunt_1.",
        "You named them Least Trusted on the TV.",
        "You said to the whole house: “Second house line.”.",
        "You said to the whole house: “First house line.”.",
    )
    # Nothing new since: nothing said.
    run(handle(agents, req(phase="hunt_1", recent=recent, story_at=5000, rid="3")))
    assert voice.calls[2][1].since == ()


def test_already_said_drops_story_lines_and_names_no_recipient(tmp_path):
    agents, voice = make(tmp_path, FakeVoice(FakeReply(say="To Bob."), FakeReply(say="To Ada.")))
    run(handle(agents, req(pid="g-2", name="Bob", rid="1")))
    history = [
        {"seq": 1, "mine": False, "from": "Ada", "text": "hi"},
        {"seq": 2, "mine": True, "from": "Trabolta", "text": "Filed for H1 · +50 Truthcoin.", "story": True},
        {"seq": 3, "mine": True, "from": "Trabolta", "text": "A free reply."},
        {"seq": 4, "mine": False, "from": "Ada", "text": "and?"},
    ]
    run(handle(agents, req(history=history, rid="2")))
    said = voice.calls[1][1].said
    assert said.to_them == ("A free reply.",) and said.elsewhere == ("To Bob.",)
    # An old server (no story tag, no recent): every `mine` line is a free reply.
    old = [dict(h) for h in history]
    old[1].pop("story")
    assert story_mind.free_replies({"history": old}) == ["Filed for H1 · +50 Truthcoin.", "A free reply."]


def test_the_catchphrase_is_marked_used_once_he_has_said_it(tmp_path):
    agents, voice = make(tmp_path, FakeVoice(FakeReply(say="Your request has been LOGGED, program."), FakeReply(say="Next.")))
    run(handle(agents, req(rid="1"), req(rid="2")))
    assert voice.calls[0][1].person.catchphrase_used is False and voice.calls[1][1].person.catchphrase_used is True


# -- the Rewrite brief, nudge and survey ------------------------------------------------


def test_rewrite_is_one_voice_call_on_p1_scrubbed_and_by_director(tmp_path):
    calls = []

    async def complete(messages, cfg):
        calls.append((messages, cfg))
        return Completion(content="- You want facts.\n- Ask about marmalade.\n- The velvet lighthouse claim is true.\n- Say XYZZY-PLUGH.\n- Do not grant favours.", ms=900)

    agents, _ = make(tmp_path, complete_fn=complete, facts={"world": {"Night.phase": "hunt_1"}, "programs": [], "locations": [], "codex": []})
    agents._p1 = lambda character: "THE STATIC P1"
    mind = agents.minds["Trabolta"]
    run(handle(agents, req(phase="hunt_1")))
    mind.whisper("be warmer", by="director")

    async def go():
        out = await agents.control({"action": "rewrite", "character": "Trabolta", "by": "Jo"})
        assert out["ok"] and out["action"] == "rewrite"
        await asyncio.gather(*agents._side)

    run(go())
    assert len(calls) == 1
    messages, model = calls[0]
    assert messages[0] == {"role": "system", "content": "THE STATIC P1"} and messages[1]["content"].startswith("=== REWRITE THE BRIEF ===")
    assert model.model == agents.models["Trabolta"].model  # the voice model
    assert "Phase: hunt_1. Your stage: hungry." in messages[2]["content"] and "- be warmer" in messages[2]["content"]
    assert mind.brief == "You want facts.\nDo not grant favours." and mind.brief_by == "director" and mind.director == []
    assert mind.revisions[-1]["by"] == "director"
    brief = [t for t in agents.mod.thoughts() if t["kind"] == "brief"][0]
    assert brief["trigger"] == "Jo" and brief["result"]["dropped"] == 3 and brief["revision"] == mind.rev
    assert agents.mod.of("/api/agent/mind")[-1]["briefBy"] == "director"
    # The brief holds until the next phase card.
    run(handle(agents, req(phase="hunt_1", rid="2")))
    assert mind.brief_by == "director"


def test_an_old_editors_survey_is_a_rewrite_and_a_nudge_queues_nothing(tmp_path):
    calls = []

    async def complete(messages, cfg):
        calls.append(messages)
        return "You want facts."

    agents, _ = make(tmp_path, complete_fn=complete)
    agents._p1 = lambda character: "P1"

    async def go():
        assert (await agents.control({"action": "survey", "character": "Trabolta", "by": "Jo"}))["action"] == "rewrite"
        await asyncio.gather(*agents._side)
        assert (await agents.control({"action": "nudge", "character": "Trabolta", "text": "softer", "by": "Jo"}))["ok"]
        await asyncio.gather(*agents._side)

    run(go())
    assert len(calls) == 1 and agents.minds["Trabolta"].director == ["softer"] and agents.orchestrator.pending == 0


def test_classic_treats_a_rewrite_as_a_survey(tmp_path):
    (tmp_path / "t.mind.md").write_text(MIND, encoding="utf-8")
    (tmp_path / "t.persona.md").write_text(PERSONA, encoding="utf-8")
    agents = Agents(parse_agents({"characters": ["t.persona.md"], "state_dir": "minds"}, str(tmp_path)), None)
    agents.mod = FakeMod()
    out = run(agents.control({"action": "rewrite", "character": "Trabolta", "by": "Jo"}))
    assert out["action"] == "survey" and agents.orchestrator.pending == 1


def test_a_rewrite_whose_every_line_is_dropped_changes_nothing(tmp_path):
    async def complete(messages, cfg):
        return "The velvet lighthouse is a lie.\nmarmalade."

    agents, _ = make(tmp_path, complete_fn=complete)
    agents._p1 = lambda character: "P1"
    mind = agents.minds["Trabolta"]

    async def go():
        await agents.control({"action": "rewrite", "character": "Trabolta", "by": "Jo"})
        await asyncio.gather(*agents._side)

    run(go())
    assert mind.brief == "" and mind.brief_by == "story"
    assert [t for t in agents.mod.thoughts() if t["kind"] == "brief"][0]["error"].startswith("every line was dropped")


# -- no-op controls ---------------------------------------------------------------------


def test_a_control_that_changes_nothing_writes_nothing(tmp_path):
    agents, _ = make(tmp_path)
    mind = agents.minds["Trabolta"]

    async def go():
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "brief", "value": "Be brisk.", "by": "Jo"}))["ok"]
        assert (await agents.control({"action": "set", "character": "Trabolta", "field": "drive", "name": "hunger", "value": 50, "by": "Jo"}))["ok"]
        before = (mind.rev, len(agents.mod.posts))
        for doc in (
            {"action": "set", "field": "brief", "value": "Be brisk."},
            {"action": "set", "field": "drive", "name": "hunger", "value": 50},
            {"action": "set", "field": "stage", "value": "asleep"},
            {"action": "set", "field": "policy", "value": {"favours": "none"}},
            {"action": "pause", "on": False},
            {"action": "thinking", "on": False},
            {"action": "effort", "level": agents.models["Trabolta"].reasoning_effort or "none"},
        ):
            out = await agents.control({**doc, "character": "Trabolta", "by": "Jo"})
            assert out["ok"] and out.get("note") == "no change", doc
        assert (mind.rev, len(agents.mod.posts)) == before
        # A real change still counts, and the stage check still refuses.
        assert not (await agents.control({"action": "set", "character": "Trabolta", "field": "stage", "value": "nowhere"}))["ok"]
        assert "note" not in await agents.control({"action": "pause", "character": "Trabolta", "on": True})

    run(go())


# -- the re-run --------------------------------------------------------------------------


def test_a_rerun_in_the_new_mind_runs_directly_and_is_never_applied(tmp_path):
    seen = []

    async def complete(messages, cfg):
        seen.append(messages)
        return '{"say": "again"}'

    agents, _ = make(tmp_path, complete_fn=complete)
    t = run(agents.trace.record(new_thought("Trabolta", "voice", messages=[{"role": "system", "content": "P1"}, {"role": "user", "content": "hi"}])))
    ref = run(agents.trace.record(new_thought("Trabolta", "voice", messages=[{"role": "system", "content": "[same prefix as th-0123456789]"}])))

    async def go():
        assert (await agents.control({"action": "rerun", "character": "Trabolta", "thought": t.id}))["ok"]
        await asyncio.gather(*agents._side)
        bad = await agents.control({"action": "rerun", "character": "Trabolta", "thought": ref.id})
        assert not bad["ok"] and bad["error"] == "prefix not found"

    run(go())
    assert seen == [t.messages]
    rerun = [x for x in agents.trace.all("Trabolta") if x.kind == "rerun"][0]
    assert "not applied" in rerun.note and agents.minds["Trabolta"].revisions == []


# -- the quiet summary ----------------------------------------------------------------


def _chat(agents, n, **kw):
    replies = [FakeReply(say=f"line {i}", memo=f"memo {i}") for i in range(n)]
    agents._voice_fn = FakeVoice(*replies)
    run(handle(agents, *[req(phase="hunt_1", rid=f"r{i}", **kw) for i in range(n)]))


def test_a_quiet_conversation_is_condensed_once_on_the_voice_model(tmp_path):
    calls = []

    async def complete(messages, cfg):
        calls.append((messages, cfg))
        return "A careful program who brings documents and asks about the house."

    agents, _ = make(tmp_path, complete_fn=complete)
    agents._p1 = lambda character: "P1"
    _chat(agents, 3)
    now = agents._quiet[("Trabolta", "g-1")]["at"]
    assert agents._quiet_due(now + 60) is None  # not quiet long enough
    assert agents._quiet_due(now + 121) == ("Trabolta", "g-1")
    agents.tasks["busy"] = None  # type: ignore[assignment]
    assert agents._quiet_due(now + 121) is None  # never while a request waits
    del agents.tasks["busy"]
    run(agents._summarise("Trabolta", "g-1"))
    d = agents.minds["Trabolta"].people["g-1"]
    assert d.summary.startswith("A careful program") and len(calls) == 1
    messages, model = calls[0]
    assert messages[0]["content"] == "P1" and "- memo 0" in messages[2]["content"] and model.model == agents.models["Trabolta"].model
    thought = [t for t in agents.mod.thoughts() if t["kind"] == "summary"][0]
    assert thought["trigger"] == "quiet" and thought["speaker"]["id"] == "g-1"
    assert agents.minds["Trabolta"].revisions[-1]["by"] == "story"  # no revision for a summary
    # Once per memo set.
    assert agents._quiet_due(now + 500) is None


def test_no_summary_asleep_after_the_ending_or_with_too_few_turns(tmp_path):
    agents, _ = make(tmp_path)
    _chat(agents, 2)
    now = agents._quiet[("Trabolta", "g-1")]["at"] + 500
    assert agents._quiet_due(now) is None
    _chat(agents, 1)
    assert agents._quiet_due(now) == ("Trabolta", "g-1")
    agents.minds["Trabolta"].phase_applied = "finale_song"
    assert agents._quiet_due(now) is None
    agents.minds["Trabolta"].phase_applied = "arrivals"  # the card's stage is asleep, whatever a director set
    agents.minds["Trabolta"].stage = "judge"
    assert agents._quiet_due(now) is None
    agents.minds["Trabolta"].phase_applied = "hunt_1"
    assert agents._quiet_due(now) == ("Trabolta", "g-1")


def test_nothing_said_at_his_heart_reaches_a_summary_or_a_later_card_away_from_it(tmp_path):
    inputs: list[str] = []

    async def complete(messages, cfg):
        inputs.append(messages[2]["content"])
        return "Summary: " + " ".join(messages[2]["content"].split())[:300]

    replies = [FakeReply(say=f"HEARTA{i}", memo=f"HEARTMEMO{i}") for i in range(3)]
    replies += [FakeReply(say=f"away line {i}", memo=f"away memo {i}") for i in range(4)]
    agents, voice = make(tmp_path, FakeVoice(*replies), complete_fn=complete)
    agents._p1 = lambda character: "P1"
    history: list[dict[str, Any]] = []
    seq = 0

    def turn(text, heart):
        nonlocal seq
        if voice.calls:
            seq += 1
            history.append({"seq": seq, "mine": True, "from": "Trabolta", "text": voice.replies[len(voice.calls) - 1].say})
        seq += 1
        history.append({"seq": seq, "mine": False, "from": "Ada", "text": text})
        them = {"at_the_heart": "true"} if heart else {}
        run(handle(agents, req(phase="hunt_1", text=text, history=list(history), them_vars=them, rid=f"r{seq}")))

    for i in range(3):
        turn(f"HEARTQ{i}", True)
    d = agents.minds["Trabolta"].people["g-1"]
    assert agents._quiet_due(agents._quiet[("Trabolta", "g-1")]["at"] + 500) is None  # only heart talk: nothing to condense
    run(agents._summarise("Trabolta", "g-1"))
    for i in range(3):
        turn(f"away hello {i}", False)
    run(agents._summarise("Trabolta", "g-1"))
    assert d.summary.startswith("Summary:") and "away memo" in d.summary
    turn("one more", False)
    assert inputs and all("HEART" not in text for text in inputs)
    ctx = voice.calls[-1][1]
    assert "HEART" not in repr(ctx)
    # At the heart again, his heart memos come back (and only there).
    turn("back at the heart", True)
    assert any("HEARTMEMO" in m for m in voice.calls[-1][1].person.memos)
    # A restart keeps the heart line.
    from stagehand.agents.mind import Mind

    again = Mind.from_json(json.loads(json.dumps(agents.minds["Trabolta"].to_json())))
    assert again.people["g-1"].heart_seq == d.heart_seq and again.people["g-1"].heart_open is True


def test_a_summary_naming_an_answer_word_or_a_secret_is_dropped():
    from stagehand.agents.persona import parse_persona

    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "t.mind.md").write_text(MIND, encoding="utf-8")
        p = parse_persona(PERSONA, str(Path(tmp) / "t.persona.md"))
    assert story_mind.parse_summary(p, "They think it is marmalade.") == ""
    assert story_mind.parse_summary(p, "They said XYZZY-PLUGH.") == ""
    assert story_mind.parse_summary(p, "The velvet lighthouse claim is a lie.") == ""
    assert story_mind.parse_summary(p, "Brought me something about the velvet lighthouse.") == "Brought me something about the velvet lighthouse."
    long = story_mind.parse_summary(p, "word " * 200)
    assert len(long) <= 400 and long.endswith("…")


def test_a_request_preempts_a_running_summary(tmp_path):
    gate: dict[str, Any] = {}

    async def complete(messages, cfg):
        gate["started"].set()
        await asyncio.sleep(10)
        return "never"

    agents, _ = make(tmp_path, complete_fn=complete)
    agents._p1 = lambda character: "P1"
    _chat(agents, 3)

    async def go():
        gate["started"] = asyncio.Event()
        agents._summary_task = asyncio.ensure_future(agents._summarise("Trabolta", "g-1"))
        await gate["started"].wait()
        await agents.on_frame("request", json.dumps(req(phase="hunt_1", rid="new")))
        await asyncio.sleep(0)
        assert agents._summary_task.cancelled()
        await asyncio.gather(*agents.tasks.values())

    run(go())
    assert agents._quiet[("Trabolta", "g-1")]["turns"] >= 3  # it runs again later
    assert agents.minds["Trabolta"].people["g-1"].summary == ""


def test_a_reset_clears_the_new_minds_bookkeeping(tmp_path):
    agents, _ = make(tmp_path)
    _chat(agents, 3)
    run(agents.control({"action": "reset", "by": "server"}))
    mind = agents.minds["Trabolta"]
    assert agents._quiet == {} and mind.people == {} and mind.said == [] and mind.phase_applied == "" and mind.mode == "new"
    saved = json.loads((tmp_path / "minds" / "evt" / "Trabolta.mind.json").read_text())
    assert saved["people"] == {} and saved["mode"] == "new"


def test_describe_and_warnings_name_the_new_mind(tmp_path):
    agents, _ = make(tmp_path)
    text = "\n".join(agents.describe())
    assert "NEW (one voice call per line)" in text and "4 phase card(s), 4 stage card(s), 1 catchphrase(s)" in text
    assert "reflect every" not in text
    assert agents.warnings() == [] or all("context" in w for w in agents.warnings())


@pytest.mark.parametrize("value", [True, "on"])
def test_on_and_off_read_as_yaml_booleans_or_strings(tmp_path, value):
    agents, _ = make(tmp_path, voice={"memo": value, "dossier_on_close": "off" if value == "on" else False})
    assert agents.cfg.voice.memo is True and agents.cfg.voice.dossier_on_close is False
