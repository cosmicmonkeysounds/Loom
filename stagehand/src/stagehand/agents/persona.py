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
    mind: trabolta.mind.md             # the orchestrator's prompt (how this
                                       #   character grows; default built in).
                                       #   May open with its own frontmatter:
                                       #   stages: [a, b, c]   the arc, in order
                                       #   drives: {hunger: 40, suspicion: 55}
                                       #   phases: {glitch: "cue text"}  per Night.phase
    orchestrator: { model: … }         # orchestrator model overrides for this one
    thread_window: 12                  # thread lines the fast model sees
    summarize_after: 20                # a thread this long gets a rolling summary
    reflect_after: 1                   # reflect after every N exchanges per thread
    lookup: true                       # may ask the session about people / rooms / lore
    lookup_power: snoop                # a power fired (target = that program) whenever a
                                       #   lookup resolves a program — so being read is *felt*
    powers: all                        # which `who: agent` powers it may use (or a list, or none)
    bargain: "…"                       # guidance on when a favour is earned
    ---
    You are TRABOLTA, …

The body is the system prompt verbatim — the character at the doors. The
worker appends the live state, the character's evolving *mind* (see
`mind.py`), its powers, and the reply protocol; a model that ignores the
JSON protocol still works (the text becomes the line).
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
    "mind",
    "orchestrator",
    "thread_window",
    "summarize_after",
    "reflect_after",
    "lookup",
    "lookup_power",
    "powers",
    "bargain",
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
    #: The orchestrator's system prompt (from `mind:`), or None for the default.
    mind_prompt: str | None = None
    #: The declared arc (mind-file frontmatter `stages:`), in order.
    stages: tuple[str, ...] = ()
    #: Declared drives with their opening values (`drives:`).
    drives: dict[str, int] = field(default_factory=dict)
    #: A cue per story phase (`phases:`), handed to the orchestrator when the
    #: house enters that phase.
    phase_cues: dict[str, str] = field(default_factory=dict)
    #: Orchestrator model overrides for this character.
    orchestrator: dict[str, Any] = field(default_factory=dict)
    thread_window: int = 12
    summarize_after: int = 20
    reflect_after: int = 1
    lookup: bool = True
    #: A power to fire (with `target` = the program) whenever a lookup resolves
    #: a program: reading someone's file is felt by them. None = silent lookups.
    lookup_power: str | None = None
    #: None = every declared power; () = none; else the allowed power ids.
    powers: tuple[str, ...] | None = None
    bargain: str = ""


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
    def _int(key: str, default: int) -> int:
        try:
            return max(0, int(meta.get(key, default)))
        except (TypeError, ValueError) as err:
            raise ConfigError(f"{source}: {key} must be a number") from err

    max_step = _int("max_step", 15)
    mind_prompt = None
    stages: tuple[str, ...] = ()
    drives: dict[str, int] = {}
    phase_cues: dict[str, str] = {}
    if meta.get("mind") not in (None, ""):
        mind_path = Path(str(meta["mind"]))
        if not mind_path.is_absolute() and source not in ("<persona>", ""):
            mind_path = Path(source).parent / mind_path
        try:
            mind_text = mind_path.read_text(encoding="utf-8")
        except OSError as err:
            raise ConfigError(f"{source}: cannot read mind file {mind_path}: {err}") from err
        mind_prompt, stages, drives, phase_cues = parse_mind_file(mind_text, str(mind_path))
    orchestrator = meta.get("orchestrator")
    if orchestrator is not None and not isinstance(orchestrator, dict):
        raise ConfigError(f"{source}: orchestrator: must be a mapping of model overrides")
    raw_powers = meta.get("powers", "all")
    powers: tuple[str, ...] | None
    if raw_powers in (None, "all", True):
        powers = None
    elif raw_powers in ("none", False, ""):
        powers = ()
    else:
        powers = _names(raw_powers, f"{source}: powers")
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
        mind_prompt=mind_prompt,
        stages=stages,
        drives=drives,
        phase_cues=phase_cues,
        orchestrator=dict(orchestrator or {}),
        thread_window=max(2, _int("thread_window", 12)),
        summarize_after=max(4, _int("summarize_after", 20)),
        reflect_after=max(1, _int("reflect_after", 1)),
        lookup=bool(meta.get("lookup", True)),
        lookup_power=(str(meta["lookup_power"]).strip() or None) if meta.get("lookup_power") not in (None, "") else None,
        powers=powers,
        bargain=str(meta.get("bargain") or "").strip(),
    )


_MIND_KNOWN = {"stages", "drives", "phases"}


def parse_mind_file(text: str, source: str = "<mind>") -> tuple[str | None, tuple[str, ...], dict[str, int], dict[str, str]]:
    """A mind file is the orchestrator's prompt, optionally opening with a
    frontmatter block that declares the character's arc (`stages:`), its
    drives with opening values (`drives:`), and a cue per story phase
    (`phases:`). Returns (prompt, stages, drives, phase_cues)."""
    body = text
    stages: tuple[str, ...] = ()
    drives: dict[str, int] = {}
    phases: dict[str, str] = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end < 0:
            raise ConfigError(f"{source}: unterminated frontmatter (no closing '---')")
        try:
            meta = yaml.safe_load(text[3:end]) or {}
        except yaml.YAMLError as err:
            raise ConfigError(f"{source}: bad frontmatter YAML: {err}") from err
        if not isinstance(meta, dict):
            raise ConfigError(f"{source}: frontmatter must be a mapping")
        unknown = sorted(set(meta) - _MIND_KNOWN)
        if unknown:
            raise ConfigError(f"{source}: unknown frontmatter key(s) {', '.join(unknown)}")
        stages = _names(meta.get("stages"), f"{source}: stages")
        raw_drives = meta.get("drives")
        if isinstance(raw_drives, dict):
            for name, start in raw_drives.items():
                try:
                    drives[str(name).strip()] = max(0, min(100, int(start if start is not None else 50)))
                except (TypeError, ValueError) as err:
                    raise ConfigError(f"{source}: drives.{name} must be a number 0–100") from err
        elif isinstance(raw_drives, (str, list)):
            drives = {name: 50 for name in _names(raw_drives, f"{source}: drives")}
        elif raw_drives is not None:
            raise ConfigError(f"{source}: drives must be a mapping of name → opening value")
        raw_phases = meta.get("phases")
        if isinstance(raw_phases, dict):
            phases = {str(k).strip(): " ".join(str(v).split()) for k, v in raw_phases.items() if v is not None and str(v).strip()}
        elif raw_phases is not None:
            raise ConfigError(f"{source}: phases must be a mapping of phase → cue")
        body = text[end + 4 :]
    prompt = body.strip() or None
    return prompt, stages, drives, phases


def load_persona(path: str | Path) -> Persona:
    p = Path(path)
    try:
        text = p.read_text(encoding="utf-8")
    except OSError as err:
        raise ConfigError(f"cannot read persona {path}: {err}") from err
    return parse_persona(text, str(p))
