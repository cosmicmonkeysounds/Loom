"""Wave 41: Trabolta's letter (`agents/letter.py`, the `letter` frame,
`POST /api/agent/letter`; docs/loom-w41-contract.md C6, C7)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from stagehand.agents.config import parse_agents
from stagehand.agents.letter import LETTER_BRIEF, Letter, letter_messages, letter_problem, night_file, parse_letter
from stagehand.agents.module import Agents
from stagehand.agents.persona import parse_persona
from stagehand.modapi import ModApiError

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"

PERSONA = """---
character: Trabolta
variables: truth
when: self.awake == true
outside:
  - Steph
  - the show
---
You are TRABOLTA.
"""

GOOD = json.dumps(
    {
        "subject": "From my desk in Halifax",
        "letter": "Dear Calculator,\n\nThank you for being installed in my computer tonight. You ended the night with 412 Truthcoin.\n\nJean Trabolta\nSole Owner and Founder, Maps and Ducks",
    }
)


def frame(**over):
    doc = {
        "id": "lt-1",
        "character": "Trabolta",
        "key": "g:g1",
        "to": {"kind": "guest", "name": "Calculator"},
        "facts": {
            "date": "October 31, 2026",
            "kind": "guest",
            "program": {"name": "Calculator", "came_for_in_their_words": "x" * 400, "truthcoin": 412, "highlights": ["1st of 30 for Truthcoin (412)"]},
            "night": {"programs": 30, "ending": "song", "ending_note": "You sang to Sandy."},
        },
        "at": 0,
    }
    doc.update(over)
    return doc


class FakeMod:
    base_url = "http://srv"

    def __init__(self, fail=None):
        self.posts = []
        self.fail = fail

    def path(self, p):
        return f"/e/evt{p}"

    async def post(self, p, body):
        self.posts.append((p, body))
        if self.fail is not None and p == "/api/agent/letter":
            raise self.fail
        return {"ok": True}


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


async def settle(agents):
    while agents.lettering:
        await asyncio.gather(*agents.lettering.values(), return_exceptions=True)


def write(agents, **over):
    async def go():
        await agents.on_frame("letter", json.dumps(frame(**over)))
        await settle(agents)

    asyncio.run(go())


# -- the prompt and the parse ---------------------------------------------------------


def test_the_prompt_is_his_persona_the_brief_and_the_night_file():
    persona = parse_persona(PERSONA)
    msgs = letter_messages(persona, frame())
    assert msgs[0]["content"].startswith("You are TRABOLTA.")
    assert LETTER_BRIEF in msgs[0]["content"]
    assert "Steph" not in msgs[0]["content"]  # the outside list is never named to him
    user = msgs[1]["content"]
    assert user.startswith("NIGHT FILE:") and "412" in user and "1st of 30 for Truthcoin" in user
    assert "x" * 121 not in user  # a guest's own words are clipped


def test_a_staff_letter_never_says_the_outside_word():
    doc = night_file(frame(to={"kind": "performer", "name": "Clippy", "part": "Clippy"}, facts={"kind": "performer", "part": {"name": "Clippy", "player": True, "score": 7}, "night": {}}))
    text = json.dumps(doc)
    assert "performer" not in text and doc["staff"]["score"] == 7 and doc["writing_to"] == "Clippy"


def test_parse_letter_takes_json_fences_tool_calls_and_long_prose():
    assert parse_letter(GOOD) == Letter(subject="From my desk in Halifax", text=json.loads(GOOD)["letter"])
    assert parse_letter("<think>hm</think>```json\n" + GOOD + "\n```").subject == "From my desk in Halifax"
    folded = json.dumps({"act": [{"fire": "letter", "args": json.loads(GOOD)}]})
    assert parse_letter(folded).text.startswith("Dear Calculator")
    prose = "Dear Calculator,\n\n" + "Thank you for being in my computer. " * 8
    assert parse_letter(prose).subject == "" and parse_letter(prose).text.startswith("Dear Calculator")
    assert parse_letter('{"subject": "x", "letter": "too short"}') is None
    assert parse_letter("") is None and parse_letter("ok") is None


def test_a_draft_naming_a_secret_or_the_outside_world_is_refused():
    persona = parse_persona(PERSONA)
    assert letter_problem(persona, Letter("Hi", "Dear Calculator, thank you.")) is None
    assert letter_problem(persona, Letter("Hi", "Dear Calculator, Steph says hello.")) == "it named something from outside his world"


def test_the_show_persona_can_write_a_letter():
    persona = parse_persona((SHOW / "trabolta.persona.md").read_text(encoding="utf-8"), str(SHOW / "trabolta.persona.md"))
    msgs = letter_messages(persona, frame())
    assert "NIGHT FILE" in msgs[1]["content"]
    assert letter_problem(persona, Letter("From my desk", "Dear Calculator,\n\nThank you for being installed in my computer tonight.\n\nJean Trabolta")) is None


# -- the worker ---------------------------------------------------------------------


def test_the_worker_writes_and_answers_on_the_letter_route(tmp_path):
    seen = {}

    async def fake(messages, cfg):
        seen["messages"] = messages
        return GOOD

    agents = worker(tmp_path, fake)
    before = agents.minds["Trabolta"].report(None)
    write(agents)
    (body,) = posts(agents, "/api/agent/letter")
    assert body == {"id": "lt-1", "text": json.loads(GOOD)["letter"], "subject": "From my desk in Halifax", "worker": "w-1"}
    assert "You are TRABOLTA." in seen["messages"][0]["content"]
    # Never a request: no reply, the mind untouched.
    assert posts(agents, "/api/agent/reply") == [] and agents.minds["Trabolta"].report(None) == before
    (t,) = thoughts(agents)
    assert t["kind"] == "letter" and t["request_id"] == "lt-1" and t["result"]["subject"] == "From my desk in Halifax"


def test_a_guarded_draft_is_written_again_once_then_given_up(tmp_path):
    calls = []

    async def leaky(messages, cfg):
        calls.append(messages[1]["content"])
        return json.dumps({"subject": "Hi", "letter": "Dear Calculator, " + ("Steph says hello. " * 5)})

    agents = worker(tmp_path, leaky)
    write(agents)
    assert len(calls) == 2 and "could not be sent" in calls[1]
    assert posts(agents, "/api/agent/letter") == []
    assert [t["error"] for t in thoughts(agents)] == ["draft thrown away: it named something from outside his world"] * 2

    async def second_try_ok(messages, cfg):
        return GOOD if "could not be sent" in messages[1]["content"] else json.dumps({"subject": "x", "letter": "Dear C, the show was fun, said nobody, ever, at all, in Halifax."})

    agents = worker(tmp_path, second_try_ok)
    write(agents)
    assert len(posts(agents, "/api/agent/letter")) == 1


def test_a_stranger_or_a_410_is_quiet_and_dry_run_sends_nothing(tmp_path):
    async def fake(messages, cfg):
        return GOOD

    agents = worker(tmp_path, fake)
    write(agents, character="Nobody")
    assert posts(agents, "/api/agent/letter") == []

    agents = worker(tmp_path, fake)
    agents.mod = FakeMod(fail=ModApiError("gone", status=410))
    write(agents)
    assert len(posts(agents, "/api/agent/letter")) == 1 and agents.lettering == {}

    agents = worker(tmp_path, fake, dry_run=True)
    write(agents)
    assert posts(agents, "/api/agent/letter") == []


def test_a_cancel_frame_aborts_a_letter(tmp_path):
    started = asyncio.Event()

    async def slow(messages, cfg):
        started.set()
        await asyncio.sleep(30)
        return GOOD

    agents = worker(tmp_path, slow)

    async def go():
        await agents.on_frame("letter", json.dumps(frame()))
        await started.wait()
        await agents.on_frame("cancel", json.dumps({"id": "lt-1"}))
        for _ in range(5):
            await asyncio.sleep(0)

    asyncio.run(go())
    assert agents.lettering == {} and posts(agents, "/api/agent/letter") == []
