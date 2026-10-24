"""`mind_mode: classic` is today's worker, byte for byte (the wave 12 contract §C5.4).

`fixtures/classic/expected.json` was produced by the base branch's code
(`trabolta/answers`) from the synthetic fixtures beside it; see
`fixtures/classic/make_expected.py`. Every prompt classic builds must still
match it exactly: the voice's messages, the orchestrator's reflect and its
survey — through the pure builders, through a real `Agents` worker in
classic mode, and with the mind file's phases rewritten as phase cards
(classic reads a card's `cue:` exactly as it read the bare string).
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import re
from pathlib import Path

import pytest

from stagehand.agents.config import parse_agents
from stagehand.agents.module import Agents
from stagehand.agents.persona import load_persona

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "classic"


def _builders():
    spec = importlib.util.spec_from_file_location("classic_make_expected", FIXTURES / "make_expected.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


B = _builders()
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))


def _cards_mind(text: str) -> str:
    """The fixture mind file with every bare phase cue turned into a card
    whose `cue:` is the old text (what lane C's table looks like to classic)."""
    head, rest = text.split("\nphases:\n", 1)
    block, tail = rest.split("\n---", 1)
    out: list[str] = []
    for line in block.split("\n"):
        m = re.match(r"^  ([a-z_0-9]+): >-$", line)
        if m:
            out.append(f"  {m.group(1)}:")
            out.append("    cue: >-")
        elif line.startswith("    "):
            out.append("  " + line)
        else:
            out.append(line)
    return head + "\nphases:\n" + "\n".join(out) + "\n---" + tail


def _converted_persona(tmp_path: Path) -> Path:
    mind = _cards_mind((FIXTURES / "trabolta.mind.md").read_text(encoding="utf-8"))
    assert "    cue: >-" in mind
    (tmp_path / "trabolta.mind.md").write_text(mind, encoding="utf-8")
    persona = (FIXTURES / "trabolta.persona.md").read_text(encoding="utf-8")
    (tmp_path / "trabolta.persona.md").write_text(persona, encoding="utf-8")
    return tmp_path / "trabolta.persona.md"


def test_the_fixtures_hold_no_real_secret():
    mind = (FIXTURES / "trabolta.mind.md").read_text(encoding="utf-8")
    assert "SYNTHETIC for the classic snapshot" in mind
    persona = load_persona(FIXTURES / "trabolta.persona.md")
    assert persona.secrets.never == ("XYZZY-PLUGH",)
    assert set(persona.secrets.match) == {"marmalade", "quillfeather", "4242"}


def test_the_requests_on_disk_are_the_builders_requests():
    assert B.load_requests() == B.requests()


@pytest.mark.parametrize("name", B.NAMES)
def test_classic_prompts_are_the_base_branchs_byte_for_byte(name):
    got = B.outputs(load_persona(FIXTURES / "trabolta.persona.md"), B.load_requests())[name]
    for part in ("voice", "voice_fresh", "reflect", "survey"):
        assert got[part] == EXPECTED[name][part], f"{name}: classic {part} prompt changed"


@pytest.mark.parametrize("name", B.NAMES)
def test_a_converted_card_table_reads_as_the_same_cues_in_classic(tmp_path, name):
    persona = load_persona(_converted_persona(tmp_path))
    assert persona.phase_cues == load_persona(FIXTURES / "trabolta.persona.md").phase_cues
    got = B.outputs(persona, B.load_requests())[name]
    for part in ("voice", "voice_fresh", "reflect", "survey"):
        assert got[part] == EXPECTED[name][part], f"{name}: classic {part} prompt changed under phase cards"


class RecordingMod:
    base_url = "http://srv"

    def __init__(self):
        self.posts = []

    def path(self, p):
        return f"/e/evt{p}"

    async def post(self, p, body):
        self.posts.append((p, body))
        return {"ok": True}

    async def get(self, p):
        return {}


def _classic_worker(tmp_path: Path, persona_path: Path, calls: list, **section):
    async def complete(messages, cfg):
        calls.append(messages)
        return '{"say": "Logged.", "adjust": {"truth": 1}}'

    cfg = parse_agents({"characters": [str(persona_path)], "state_dir": str(tmp_path / "minds"), **section}, str(tmp_path))
    agents = Agents(cfg, complete)
    agents.mod = RecordingMod()
    return agents


@pytest.mark.parametrize("section", [{}, {"mind_mode": "classic"}], ids=["absent", "classic"])
@pytest.mark.parametrize("converted", [False, True], ids=["bare-cues", "cards"])
def test_a_classic_worker_sends_exactly_the_frozen_voice_messages(tmp_path, section, converted):
    persona_path = FIXTURES / "trabolta.persona.md"
    if converted:
        (tmp_path / "p").mkdir()
        persona_path = _converted_persona(tmp_path / "p")
    for name, req in B.load_requests().items():
        calls: list = []
        agents = _classic_worker(tmp_path / name, persona_path, calls, **section)
        assert agents.cfg.mind_mode == "classic"

        async def go():
            await agents._handle(req)

        asyncio.run(go())
        assert calls and calls[0] == EXPECTED[name]["voice_fresh"], f"{name}: the classic worker's voice prompt changed"
        # Classic still reflects after the line (the orchestrator job is queued).
        assert agents.orchestrator.pending == 1
