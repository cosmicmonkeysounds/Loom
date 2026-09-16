"""The persona file: YAML frontmatter + the system prompt.

    ---
    character: Trabolta                # the CHARACTER as declared (required)
    variables: truth, untruth, stance, love   # what it may nudge
    max_step: 15                       # |delta| cap per variable per reply
    facts: Night.                      # world path prefixes worth telling it
    them: humanity, truth, doubt       # the speaker's variables worth telling it
    when: self.glitched == true        # optional gate — else `unavailable`
    unavailable: "…"                   # said when the gate is closed (else silence)
    fallback: "…"                      # said when the model fails (else silence)
    temperature: 0.9                   # optional per-character model overrides:
    max_tokens: 800                    #   model / temperature / max_tokens /
    reasoning_effort: low              #   reasoning_effort
    ---
    You are TRABOLTA, …

The body is the system prompt verbatim. It should tell the model to reply
with one JSON object — `{"say": "…", "adjust": {"truth": 5}}` — but a
model that ignores that still works (the text becomes the line).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from ..conditions import Condition
from ..module import ConfigError

_KNOWN = {
    "character",
    "variables",
    "max_step",
    "facts",
    "them",
    "when",
    "unavailable",
    "fallback",
    "model",
    "endpoint",
    "temperature",
    "max_tokens",
    "reasoning_effort",
}


@dataclass(frozen=True)
class Persona:
    character: str
    system: str
    variables: tuple[str, ...] = ()
    max_step: int = 15
    facts: tuple[str, ...] = ()
    #: Speaker variables to show; None = all of them.
    them: tuple[str, ...] | None = None
    when: Condition | None = None
    unavailable: str = ""
    fallback: str = ""
    #: Per-character model overrides (merged over the section's `llm:`).
    llm: dict[str, Any] = field(default_factory=dict)
    source: str = ""


def _names(value: Any, where: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return tuple(v.strip() for v in value.split(",") if v.strip())
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return tuple(v.strip() for v in value if v.strip())
    raise ConfigError(f"{where}: expected a comma list or a list of names")


def parse_persona(text: str, source: str = "<persona>") -> Persona:
    if not text.startswith("---"):
        raise ConfigError(f"{source}: a persona starts with a '---' frontmatter block")
    end = text.find("\n---", 3)
    if end < 0:
        raise ConfigError(f"{source}: unterminated frontmatter (no closing '---')")
    try:
        meta = yaml.safe_load(text[3:end]) or {}
    except yaml.YAMLError as err:
        raise ConfigError(f"{source}: bad frontmatter YAML: {err}") from err
    if not isinstance(meta, dict):
        raise ConfigError(f"{source}: frontmatter must be a mapping")
    body = text[end + 4 :].lstrip("\n").rstrip()
    character = meta.get("character")
    if not isinstance(character, str) or character.strip() == "":
        raise ConfigError(f"{source}: frontmatter needs 'character:'")
    if body == "":
        raise ConfigError(f"{source}: the persona has no system prompt below the frontmatter")
    unknown = sorted(set(meta) - _KNOWN)
    if unknown:
        raise ConfigError(f"{source}: unknown frontmatter key(s) {', '.join(unknown)}")
    when = None
    if meta.get("when") not in (None, ""):
        try:
            when = Condition(str(meta["when"]))
        except ValueError as err:
            raise ConfigError(f"{source}: when: {err}") from err
    them = meta.get("them")
    llm = {k: meta[k] for k in ("model", "endpoint", "temperature", "max_tokens", "reasoning_effort") if k in meta}
    try:
        max_step = int(meta.get("max_step", 15))
    except (TypeError, ValueError) as err:
        raise ConfigError(f"{source}: max_step must be a number") from err
    return Persona(
        character=character.strip(),
        system=body,
        variables=_names(meta.get("variables"), f"{source}: variables"),
        max_step=max(0, max_step),
        facts=_names(meta.get("facts"), f"{source}: facts"),
        them=None if them is None else _names(them, f"{source}: them"),
        when=when,
        unavailable=str(meta.get("unavailable") or ""),
        fallback=str(meta.get("fallback") or ""),
        llm=llm,
        source=source,
    )


def load_persona(path: str | Path) -> Persona:
    p = Path(path)
    try:
        text = p.read_text(encoding="utf-8")
    except OSError as err:
        raise ConfigError(f"cannot read persona {path}: {err}") from err
    return parse_persona(text, str(p))
