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
      orchestrator:                # the slow model that grows each character's mind
        enabled: true              #   (off → the persona alone, as before)
        llm:                       #   defaults: the section's llm: with this model
          model: tobestyledintro/qwen3.8-9b-distill:q8_0
          temperature: 0.4
          max_tokens: 1200
          api: ollama              #   native /api/chat: `think` + `keep_alive` honoured
          extra: { think: false }  #   reasoning off (the OpenAI shim ignores this)
          keep_alive: 30m          #   stay resident between reflections
        quiet_s: 1.5               #   idle seconds before a reflection may start
        preempt: true              #   a new request cancels a running reflection
        survey_every_s: 120        #   look at the whole house this often (0 = never)
      state_dir: .stagehand-minds  # where minds persist (per event / character)
      facts_ttl_s: 5               # how long a facts snapshot is reused
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
from .orchestrator import OrchestratorConfig
from .persona import Persona, load_persona

#: The orchestrator's default model when the section doesn't name one.
ORCHESTRATOR_MODEL = "tobestyledintro/qwen3.8-9b-distill:q8_0"


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
    orchestrator: OrchestratorConfig = field(default_factory=OrchestratorConfig)
    #: character name → the orchestrator's model config
    orchestrator_models: dict[str, LlmConfig] = field(default_factory=dict)
    state_dir: Path = field(default_factory=lambda: Path(".stagehand-minds"))
    facts_ttl_s: float = 5.0


def _llm(raw: Any, base: LlmConfig, where: str) -> LlmConfig:
    if raw is None:
        cfg = base
    else:
        if not isinstance(raw, dict):
            raise ConfigError(f"{where}: must be a mapping")
        unknown = sorted(set(raw) - set(LlmConfig.__dataclass_fields__))
        if unknown:
            raise ConfigError(f"{where}: unknown key(s) {', '.join(unknown)}")
        cfg = base.merged(raw)
    try:
        out = LlmConfig(
            endpoint=str(cfg.endpoint),
            model=str(cfg.model),
            temperature=float(cfg.temperature),
            max_tokens=int(cfg.max_tokens),
            reasoning_effort=None if cfg.reasoning_effort in (None, "", "none") else str(cfg.reasoning_effort),
            json_mode=bool(cfg.json_mode),
            timeout_s=float(cfg.timeout_s),
            api_key_env=None if cfg.api_key_env in (None, "") else str(cfg.api_key_env),
            extra=dict(cfg.extra) if isinstance(cfg.extra, dict) else {},
            api=str(cfg.api or "openai").lower(),
            keep_alive=None if cfg.keep_alive in (None, "") else str(cfg.keep_alive),
        )
    except (TypeError, ValueError) as err:
        raise ConfigError(f"{where}: {err}") from err
    if out.api not in ("openai", "ollama"):
        raise ConfigError(f"{where}: api must be 'openai' or 'ollama'")
    return out


def parse_agents(doc: Any, base_dir: str = ".") -> AgentsConfig:
    if not isinstance(doc, dict):
        raise ConfigError("'agents:' must be a mapping")
    unknown = sorted(set(doc) - {"name", "concurrency", "dry_run", "llm", "characters", "orchestrator", "state_dir", "facts_ttl_s"})
    if unknown:
        raise ConfigError(f"agents: unknown key(s) {', '.join(unknown)}")
    llm = _llm(doc.get("llm"), LlmConfig(), "agents.llm")
    orch_raw = doc.get("orchestrator")
    if orch_raw is None:
        orch_raw = {}
    if not isinstance(orch_raw, dict):
        raise ConfigError("agents.orchestrator: must be a mapping")
    unknown = sorted(set(orch_raw) - {"enabled", "llm", "quiet_s", "preempt", "survey_every_s", "max_attempts"})
    if unknown:
        raise ConfigError(f"agents.orchestrator: unknown key(s) {', '.join(unknown)}")
    try:
        orchestrator = OrchestratorConfig(
            enabled=bool(orch_raw.get("enabled", True)),
            quiet_s=float(orch_raw.get("quiet_s", 1.5)),
            preempt=bool(orch_raw.get("preempt", True)),
            survey_every_s=float(orch_raw.get("survey_every_s", 120.0)),
            max_attempts=max(1, int(orch_raw.get("max_attempts", 4))),
        )
    except (TypeError, ValueError) as err:
        raise ConfigError(f"agents.orchestrator: {err}") from err
    # The orchestrator inherits the section's endpoint etc., swaps the model,
    # thinks less, and gets room to write a whole mind update.
    orch_base = LlmConfig(
        endpoint=llm.endpoint,
        model=ORCHESTRATOR_MODEL,
        temperature=0.4,
        max_tokens=1200,
        reasoning_effort=None,
        json_mode=False,
        timeout_s=max(llm.timeout_s, 120.0),
        api_key_env=llm.api_key_env,
        extra={"think": False},
        api="ollama",
        keep_alive="30m",
    )
    orch_llm = _llm(orch_raw.get("llm"), orch_base, "agents.orchestrator.llm")
    entries = doc.get("characters")
    if not isinstance(entries, list) or not entries:
        raise ConfigError("agents.characters: list at least one persona file")
    personas: dict[str, Persona] = {}
    models: dict[str, LlmConfig] = {}
    orchestrator_models: dict[str, LlmConfig] = {}
    for i, entry in enumerate(entries):
        where = f"agents.characters[{i}]"
        if isinstance(entry, str):
            entry = {"persona": entry}
        if not isinstance(entry, dict) or not isinstance(entry.get("persona"), str):
            raise ConfigError(f"{where}: a persona path, or {{persona: path, llm: {{…}}, orchestrator: {{…}}}}")
        path = Path(entry["persona"])
        if not path.is_absolute():
            path = Path(base_dir) / path
        persona = load_persona(path)
        if persona.character in personas:
            raise ConfigError(f"{where}: {persona.character} is already voiced by {personas[persona.character].source}")
        personas[persona.character] = persona
        models[persona.character] = _llm(entry.get("llm"), _llm(persona.llm, llm, f"{path} frontmatter"), f"{where}.llm")
        orchestrator_models[persona.character] = _llm(entry.get("orchestrator"), _llm(persona.orchestrator, orch_llm, f"{path} frontmatter orchestrator"), f"{where}.orchestrator")
    try:
        concurrency = max(1, int(doc.get("concurrency", 1)))
        facts_ttl_s = max(0.0, float(doc.get("facts_ttl_s", 5.0)))
    except (TypeError, ValueError) as err:
        raise ConfigError("agents.concurrency / facts_ttl_s must be numbers") from err
    state_dir = Path(str(doc.get("state_dir") or ".stagehand-minds"))
    if not state_dir.is_absolute():
        state_dir = Path(base_dir) / state_dir
    return AgentsConfig(
        name=str(doc.get("name") or "agents"),
        concurrency=concurrency,
        dry_run=bool(doc.get("dry_run", False)),
        llm=llm,
        personas=personas,
        models=models,
        orchestrator=orchestrator,
        orchestrator_models=orchestrator_models,
        state_dir=state_dir,
        facts_ttl_s=facts_ttl_s,
    )
