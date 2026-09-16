"""The `agents:` section.

    agents:
      name: laptop                 # shown to directors (default: agents)
      concurrency: 1               # model calls at once (a laptop GPU: 1)
      dry_run: false               # log replies instead of sending them
      llm:                         # defaults for every character
        endpoint: http://localhost:11434/v1
        model: gpt-oss:20b
        reasoning_effort: low
        temperature: 0.9
        max_tokens: 800
        timeout_s: 90
        json_mode: false
        api_key_env: OPENAI_API_KEY   # hosted endpoints only
      characters:                  # one persona file per voiced character
        - ../core/examples/trapped-in-the-internet/trabolta.persona.md
        - persona: other.persona.md
          llm: { temperature: 0.6 }   # per-character overrides (beat frontmatter)

Persona paths resolve relative to the config file.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..module import ConfigError
from .llm import LlmConfig
from .persona import Persona, load_persona


@dataclass(frozen=True)
class AgentsConfig:
    name: str = "agents"
    concurrency: int = 1
    dry_run: bool = False
    llm: LlmConfig = field(default_factory=LlmConfig)
    #: character name → persona
    personas: dict[str, Persona] = field(default_factory=dict)
    #: character name → model config (section defaults ← persona ← entry)
    models: dict[str, LlmConfig] = field(default_factory=dict)


def _llm(raw: Any, base: LlmConfig, where: str) -> LlmConfig:
    if raw is None:
        return base
    if not isinstance(raw, dict):
        raise ConfigError(f"{where}: must be a mapping")
    unknown = sorted(set(raw) - set(LlmConfig.__dataclass_fields__))
    if unknown:
        raise ConfigError(f"{where}: unknown key(s) {', '.join(unknown)}")
    try:
        cfg = base.merged(raw)
        return LlmConfig(
            endpoint=str(cfg.endpoint),
            model=str(cfg.model),
            temperature=float(cfg.temperature),
            max_tokens=int(cfg.max_tokens),
            reasoning_effort=None if cfg.reasoning_effort in (None, "", "none") else str(cfg.reasoning_effort),
            json_mode=bool(cfg.json_mode),
            timeout_s=float(cfg.timeout_s),
            api_key_env=None if cfg.api_key_env in (None, "") else str(cfg.api_key_env),
        )
    except (TypeError, ValueError) as err:
        raise ConfigError(f"{where}: {err}") from err


def parse_agents(doc: Any, base_dir: str = ".") -> AgentsConfig:
    if not isinstance(doc, dict):
        raise ConfigError("'agents:' must be a mapping")
    unknown = sorted(set(doc) - {"name", "concurrency", "dry_run", "llm", "characters"})
    if unknown:
        raise ConfigError(f"agents: unknown key(s) {', '.join(unknown)}")
    llm = _llm(doc.get("llm"), LlmConfig(), "agents.llm")
    entries = doc.get("characters")
    if not isinstance(entries, list) or not entries:
        raise ConfigError("agents.characters: list at least one persona file")
    personas: dict[str, Persona] = {}
    models: dict[str, LlmConfig] = {}
    for i, entry in enumerate(entries):
        where = f"agents.characters[{i}]"
        if isinstance(entry, str):
            entry = {"persona": entry}
        if not isinstance(entry, dict) or not isinstance(entry.get("persona"), str):
            raise ConfigError(f"{where}: a persona path, or {{persona: path, llm: {{…}}}}")
        path = Path(entry["persona"])
        if not path.is_absolute():
            path = Path(base_dir) / path
        persona = load_persona(path)
        if persona.character in personas:
            raise ConfigError(f"{where}: {persona.character} is already voiced by {personas[persona.character].source}")
        personas[persona.character] = persona
        models[persona.character] = _llm(entry.get("llm"), _llm(persona.llm, llm, f"{path} frontmatter"), f"{where}.llm")
    try:
        concurrency = max(1, int(doc.get("concurrency", 1)))
    except (TypeError, ValueError) as err:
        raise ConfigError("agents.concurrency must be a number") from err
    return AgentsConfig(
        name=str(doc.get("name") or "agents"),
        concurrency=concurrency,
        dry_run=bool(doc.get("dry_run", False)),
        llm=llm,
        personas=personas,
        models=models,
    )
