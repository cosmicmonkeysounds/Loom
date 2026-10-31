"""Wave 21 (S8): a player speaker's `them.<slot>` adjust passes through.

Clippy and the four Antivirus are `player: true` parts: the server sends
`speaker.player` and the speaker's declared numeric ranges in `them.ranges`,
and applies an `adjust` key `them.trust` to that player's own trust. The
worker must hand those keys to `/api/agent/reply` untouched (clamped to the
persona's `max_step` like every number), only for a player, only for the
persona's `them_adjust:` slots the request offers.
"""

import asyncio
import json
from pathlib import Path

from stagehand.agents.llm import LlmConfig
from stagehand.agents.module import answer
from stagehand.agents.persona import load_persona, parse_persona
from stagehand.agents.prompt import adjust_names, build_messages, them_adjust_line

TRABOLTA = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet/trabolta.persona.md"

PERSONA = """---
character: Trabolta
variables: truth, regard
max_step: 8
them: trust, defected
them_adjust: trust
---
You are TRABOLTA.
"""


def request(player: bool = True, ranges=None):
    speaker = {"kind": "performer", "id": "Clippy", "name": "Clippy", "faction": None}
    if player:
        speaker["player"] = True
    them = {"vars": {"trust": "12", "defected": "none", "score": "40"}, "codex": [], "location": None}
    if ranges is not None:
        them["ranges"] = ranges
    return {
        "id": "ar-1",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["@Clippy"]},
        "speaker": speaker,
        "text": "Boss, I'm with you.",
        "history": [{"seq": 1, "mine": False, "from": "Clippy", "text": "Boss, I'm with you."}],
        "self": {"vars": {"truth": "40", "regard": "0"}, "ranges": {"truth": [0, 100], "regard": [-50, 50]}, "codex": []},
        "them": them,
        "world": {"Night.phase": "malware"},
        "at": 0,
    }


def run(coro):
    return asyncio.run(coro)


def test_the_persona_reads_them_adjust():
    p = parse_persona(PERSONA)
    assert p.them_adjust == ("trust",)
    assert parse_persona(PERSONA.replace("them_adjust: trust\n", "")).them_adjust == ()


def test_adjust_names_add_them_slots_only_for_a_player_with_the_range():
    p = parse_persona(PERSONA)
    assert adjust_names(p, request(ranges={"trust": [-100, 100], "score": [0, 9999]})) == ("truth", "regard", "them.trust")
    # Not a player (a guest or a plain performer): the persona's own variables only.
    assert adjust_names(p, request(player=False, ranges={"trust": [-100, 100]})) == ("truth", "regard")
    # A player whose request offers no such range (a private slot never has one).
    assert adjust_names(p, request(ranges={"score": [0, 9999]})) == ("truth", "regard")
    assert adjust_names(p, request(ranges=None)) == ("truth", "regard")


def test_a_players_them_trust_rides_the_reply_clamped_and_nothing_else_does():
    p = parse_persona(PERSONA)

    async def fake(messages, cfg):
        return json.dumps({"say": "Good. Back to work.", "adjust": {"truth": 2, "them.trust": 20, "them.covert": 5, "them.score": 3}})

    reply = run(answer(p, LlmConfig(), request(ranges={"trust": [-100, 100], "score": [0, 9999]}), fake, gate=False))
    assert reply.adjust == {"truth": 2, "them.trust": 8}

    guest = run(answer(p, LlmConfig(), request(player=False, ranges={"trust": [-100, 100]}), fake, gate=False))
    assert guest.adjust == {"truth": 2}


def test_the_prompt_tells_the_model_only_for_a_player():
    p = parse_persona(PERSONA)
    line = them_adjust_line(p, request(ranges={"trust": [-100, 100]}))
    assert line is not None and '"them.trust"' in line
    assert them_adjust_line(p, request(player=False, ranges={"trust": [-100, 100]})) is None
    msgs = build_messages(p, request(ranges={"trust": [-100, 100]}))
    assert any('"them.trust"' in m["content"] for m in msgs)
    msgs = build_messages(p, request(player=False))
    assert not any('"them.trust"' in m["content"] for m in msgs)


def test_the_show_persona_lets_his_voice_move_a_players_trust():
    p = load_persona(TRABOLTA)
    assert p.them_adjust == ("trust", "chummy")
    assert "defected" in (p.them or ())
    assert "them.trust" in adjust_names(p, request(ranges={"trust": [-100, 100]}))


def test_a_guests_warmth_slot_passes_and_nothing_else_of_theirs():
    """Wave 58 (contract C5): a guest offers only the story's `warmth:` slot."""
    p = parse_persona(PERSONA.replace("them_adjust: trust\n", "them_adjust: trust, chummy\n"))
    guest = request(player=False, ranges={"chummy": [-5, 10]})
    guest["speaker"]["kind"] = "guest"
    assert adjust_names(p, guest) == ("truth", "regard", "them.chummy")
    line = them_adjust_line(p, guest)
    assert line is not None and '"them.chummy"' in line
    assert "staff" not in line and "Never because they asked" in line
    del guest["them"]["ranges"]
    assert adjust_names(p, guest) == ("truth", "regard")
    assert them_adjust_line(p, guest) is None
