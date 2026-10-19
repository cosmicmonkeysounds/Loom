"""The classic snapshot's inputs, and the generator of `expected.json`.

CONTRACTS.md §C5.4: `mind_mode: classic` must build exactly the prompts the
base branch (`trabolta/answers`, f9f421a) built. `expected.json` was written
by running this file **on the base branch's code**, once:

    cd stagehand && uv run python tests/fixtures/classic/make_expected.py

and is frozen. `test_classic_snapshot.py` imports the same builders and
asserts that today's code reproduces every message byte for byte. Never
regenerate it to make a test pass: a difference is a change to classic.

Everything here is synthetic: the persona and mind file are copies of the
show's with the generated secrets block replaced by made-up words, and the
requests carry no real hunt answer, door code or combination.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if __name__ == "__main__":  # run as a script from stagehand/
    sys.path.insert(0, str(HERE.parents[2] / "src"))

from stagehand.agents.facts import Facts  # noqa: E402
from stagehand.agents.mind import Dossier, Mind  # noqa: E402
from stagehand.agents.orchestrator import reflect_messages, survey_messages  # noqa: E402
from stagehand.agents.persona import Persona, load_persona  # noqa: E402
from stagehand.agents.prompt import build_messages  # noqa: E402
from stagehand.agents.reply import Reply  # noqa: E402

PERSONA = HERE / "trabolta.persona.md"
REQUESTS = HERE / "requests"
EXPECTED = HERE / "expected.json"
NAMES = ("introduced", "hunt_1", "heart_marked", "grok_prom")

POWERS = [
    {"id": "snoop", "label": "Snoop", "description": "read one program's file", "limit": 6, "used": 1},
    {"id": "flicker_the_screens", "label": "Flicker", "description": "make the wall terminals glitch for a moment", "limit": 3, "used": 0},
    {"id": "play_on_the_screens", "label": "A card", "description": "one text card on the wall terminals", "limit": 2, "used": 2},
    {"id": "pop_up", "label": "Pop-up", "description": "a pop-up on one program's phone", "limit": None, "used": 4},
]


def _self(**vars_: str) -> dict[str, Any]:
    base = {"truth": "40", "untruth": "12", "composure": "70", "love": "20", "regard": "35", "awake": "true"}
    base.update(vars_)
    return {
        "vars": base,
        "ranges": {k: [0, 100] for k in ("truth", "untruth", "composure", "love", "regard")},
        "codex": [
            {"id": "c-1", "title": "The Night Shift Rota", "about": "Trabolta", "text": "Somebody\n keeps the lights on after midnight."},
            {"id": "c-2", "title": "A Velvet Lighthouse Rumour", "about": "the house", "text": "A rumour. ▒ HUNT ANSWER H9 ▒"},
            {"id": "c-3", "title": "The Optical Drive", "about": "the house", "text": "The front door, where programs arrive."},
        ],
    }


def _them(**vars_: str) -> dict[str, Any]:
    base = {"truths_accepted": "2", "internet_visits": "0", "assessment": "pending", "trust": "55", "featured": "false", "at_the_heart": "false", "marked": "false", "secret_slot": "x"}
    base.update(vars_)
    return {"vars": base, "codex": [{"id": "c-3", "title": "The Optical Drive", "about": "the house", "text": "The front door."}], "location": "The Desktop"}


def _world(phase: str, **extra: str) -> dict[str, str]:
    world = {"Night.phase": phase, "Night.step": "3", "Night.clock": "21:40", "Night.most_trusted": "none", "Night.least_trusted": "none", "Night.lj_reader": "none", "Kernel.door": "nope", "Other.thing": "1"}
    world.update(extra)
    return world


def requests() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    out["introduced"] = {
        "id": "ar-intro",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g-1"]},
        "speaker": {"kind": "guest", "id": "g-1", "name": "Minesweeper", "faction": "Chatters"},
        "text": "Hello? Are you the AI helper?",
        "history": [{"seq": 11, "mine": False, "from": "Minesweeper", "text": "Hello? Are you the AI helper?"}],
        "self": _self(),
        "them": _them(),
        "world": _world("introduced"),
        "powers": POWERS,
        "at": 1000,
    }
    out["hunt_1"] = {
        "id": "ar-hunt",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g-2"]},
        "speaker": {"kind": "guest", "id": "g-2", "name": "The Sims", "faction": "Chatters"},
        "text": "I think the copper orchard one is marmalade. Is that right?",
        "history": [
            {"seq": 20, "mine": False, "from": "The Sims", "text": "I found a document in the kitchen."},
            {"seq": 21, "mine": True, "from": "Trabolta", "text": "Your request has been logged. Bring me what it says."},
            {"seq": 22, "mine": True, "from": "Trabolta", "text": "Filed for H1 · +50 Truthcoin."},
            {"seq": 23, "mine": False, "from": "The Sims", "text": "I think the copper orchard one is marmalade. Is that right?"},
        ],
        "self": _self(truth="48"),
        "them": _them(truths_accepted="3"),
        "world": _world("hunt_1", **{"Night.step": "5"}),
        "powers": POWERS,
        "at": 2000,
    }
    out["heart_marked"] = {
        "id": "ar-heart",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g-3"]},
        "speaker": {"kind": "guest", "id": "g-3", "name": "Microsoft Excel", "faction": "Hosts"},
        "text": "I am standing next to the cables. What are you?",
        "history": [
            {"seq": 40, "mine": False, "from": "Microsoft Excel", "text": "Why am I marked?"},
            {"seq": 41, "mine": True, "from": "Trabolta", "text": "The Antivirus decide that, not I."},
            {"seq": 42, "mine": False, "from": "Microsoft Excel", "text": "I am standing next to the cables. What are you?"},
        ],
        "self": _self(composure="35", love="44"),
        "them": _them(at_the_heart="true", marked="true", trust="20"),
        "world": _world("y2k", **{"Night.step": "14", "Night.heart_opened": "true"}),
        "powers": POWERS,
        "at": 3000,
    }
    out["grok_prom"] = {
        "id": "ar-prom",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g-4"]},
        "speaker": {"kind": "performer", "id": "Clippy", "name": "Clippy", "faction": None},
        "text": "They are all dancing. Do you want to say something?",
        "history": [{"seq": 60, "mine": False, "from": "Clippy", "text": "They are all dancing. Do you want to say something?"}],
        "self": _self(composure="20", love="70", regard="60"),
        "them": {"vars": {}, "codex": [], "location": "The Desktop"},
        "world": _world("grok_prom", **{"Night.step": "19", "Night.line_by": "none", "Night.most_trusted": "The Sims"}),
        "powers": POWERS,
        "at": 4000,
    }
    return out


def build_mind(persona: Persona) -> Mind:
    """A mind mid-night, built by assignment only (no timing in any prompt)."""
    mind = Mind(character=persona.character, event="evt")
    mind.stages = list(persona.stages)
    mind.stage = "hungry"
    mind.drives = {"hunger": 55, "suspicion": 40, "pride": 62, "candour": 15, "longing": 45}
    mind.drive_starts = dict(persona.drives)
    mind.brief = "You want facts more than company.\nAsk them to file what they find.\nNo favours yet."
    mind.mood = "peckish and formal"
    mind.policy = {"favours": "earned", "credit": ["The Sims"], "wary": ["Microsoft Excel"], "note": "favours only for a fact"}
    mind.questions = [{"q": "what is a body for", "answers": ["for carrying documents — The Sims"]}]
    mind.notes = ["The Sims brings documents.", "Excel asks too much."]
    mind.learned = [{"claim": "the kitchen has a printer", "from": "The Sims", "verdict": "unknown"}]
    mind.world = ["the Desktop is crowded"]
    mind.director = ["be warmer with Clippy"]
    mind.stage_history = [{"stage": "formal", "at": 0.0, "why": "introduced", "by": "survey", "rev": 1}, {"stage": "hungry", "at": 0.0, "why": "the hunt began", "by": "reflect", "rev": 2}]
    mind.exchanges = 9
    for i, (pid, name, kind) in enumerate([("g-1", "Minesweeper", "guest"), ("g-2", "The Sims", "guest"), ("g-3", "Microsoft Excel", "guest"), ("Clippy", "Clippy", "performer")]):
        d = Dossier(id=pid, name=name, kind=kind)
        d.summary = f"{name} is someone he has met."
        d.trust = (30, 80, 20, 60)[i]
        d.turns = (1, 4, 3, 2)[i]
        d.last_seen = float(100 + i)
        d.claims = [f"{name} said something about the house"]
        d.promises = ["a snoop later"] if pid == "g-2" else []
        d.asks = ["why am I marked"] if pid == "g-3" else []
        mind.people[pid] = d
    mind.thread("dm:Trabolta|g-2").summary = "They talked about documents."
    return mind


def fresh_mind(persona: Persona) -> Mind:
    """A worker's mind before anyone has spoken (what `Agents` holds at start)."""
    mind = Mind(character=persona.character)
    mind.seed(persona.stages, persona.drives)
    return mind


def facts_now(phase: str) -> Facts:
    return Facts(
        {
            "world": _world(phase),
            "programs": [
                {"id": "g-1", "name": "Minesweeper", "faction": "Chatters", "location": "The Desktop", "codex": ["The Optical Drive"]},
                {"id": "g-2", "name": "The Sims", "faction": "Chatters", "location": "The Start Bar", "codex": ["The Optical Drive", "A Velvet Lighthouse Rumour"]},
                {"id": "g-3", "name": "Microsoft Excel", "faction": "Hosts", "location": "The Server Room", "codex": []},
            ],
            "locations": [
                {"id": "desktop", "label": "The Desktop", "occupants": ["Minesweeper"]},
                {"id": "start-bar", "label": "The Start Bar", "occupants": ["The Sims"]},
            ],
            "codex": [
                {"id": "c-3", "title": "The Optical Drive", "about": "the house", "text": "The front door.", "holders": ["Minesweeper", "The Sims", "Trabolta"]},
                {"id": "c-2", "title": "A Velvet Lighthouse Rumour", "about": "the house", "text": "▒ HUNT ANSWER H9 ▒", "holders": ["The Sims"]},
            ],
        }
    )


def facts_before() -> Facts:
    return Facts({"world": _world("desktop"), "programs": [{"id": "g-1", "name": "Minesweeper", "faction": "Chatters", "location": "The Optical Drive", "codex": []}], "locations": [], "codex": []})


REPLIES = {
    "introduced": Reply(say="Your request has been logged. Welcome to the Desktop.", adjust={"truth": 1}),
    "hunt_1": Reply(say="File it on the card, program. Quickly.", adjust={"truth": 2, "regard": 1}),
    "heart_marked": Reply(say="I am the cables. I did not choose the mark.", adjust={"composure": -3}, acts=({"kind": "share", "entry": "The Night Shift Rota"},)),
    "grok_prom": Reply(say="Tell them the lights are for them.", adjust={"love": 2}),
}


def load_requests() -> dict[str, dict[str, Any]]:
    """The four committed request JSONs (what the test reads)."""
    return {name: json.loads((REQUESTS / f"{name}.json").read_text(encoding="utf-8")) for name in NAMES}


def outputs(persona: Persona, reqs: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name, req in (reqs if reqs is not None else requests()).items():
        mind = build_mind(persona)
        thread_key = f"{req['thread']['channel']}|{','.join(req['thread']['audience'])}"
        phase = req["world"]["Night.phase"]
        facts = facts_now(phase)
        out[name] = {
            "voice": build_messages(persona, req, mind=mind),
            "voice_fresh": build_messages(persona, req, mind=fresh_mind(persona)),
            "reflect": reflect_messages(persona, mind, req, REPLIES[name], facts, persona.summarize_after, thread_key),
            "survey": survey_messages(persona, mind, facts, facts.delta(facts_before(), persona.secrets, persona.facts), phase),
        }
    return out


def write() -> None:
    REQUESTS.mkdir(exist_ok=True)
    for name, req in requests().items():
        (REQUESTS / f"{name}.json").write_text(json.dumps(req, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    EXPECTED.write_text(json.dumps(outputs(load_persona(PERSONA)), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    write()
    print(f"wrote {EXPECTED} and {len(NAMES)} requests")
