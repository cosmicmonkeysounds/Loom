"""The persona file: YAML frontmatter + the system prompt.

    ---
    character: Trabolta                # the CHARACTER as declared (required)
    variables: truth, untruth, stance, love   # what it may nudge
    max_step: 15                       # |delta| cap per variable per reply
    facts: Night.                      # world path prefixes worth telling it
                                       #   (voice + orchestrator; phase always)
    them: humanity, truth, doubt       # the speaker's variables worth telling it
    them_adjust: trust                 # a player speaker's slots `adjust` may move
                                       #   as `them.<slot>` (wave 21; the server
                                       #   clamps them to the declared range)
    when: self.glitched == true        # optional gate — else `unavailable`
    unavailable: "…"                   # said when the gate is closed (else silence)
    fallback: "…"                      # said when the model fails (else silence)
    fallbacks: {formal: ["One moment."]}  # the new voice's dead-air lines, by stage
                                       #   (a list = any stage): one this guest
                                       #   has not heard yet, else `fallback`
    temperature: 0.9                   # optional per-character model overrides:
    max_tokens: 800                    #   model / temperature / max_tokens /
    reasoning_effort: low              #   reasoning_effort
    mind: trabolta.mind.md             # the orchestrator's prompt (how this
                                       #   character grows; default built in).
                                       #   May open with its own frontmatter:
                                       #   stages: [a, b, c]   the arc, in order
                                       #   drives: {hunger: 40, suspicion: 55}
                                       #   phases: {glitch: "cue text"}  per Night.phase,
                                       #     or a phase card per phase (wave 12):
                                       #     {stage, favours, drives, powers, tell,
                                       #      brief, cue} + `_stages:` (a card of
                                       #     text per declared stage); see
                                       #     `parse_mind_table`
                                       #   secrets: {topics, match, lore}  hunt answers
                                       #     it must never be able to check
                                       #     (see `secrets.py`)
    orchestrator: { model: … }         # orchestrator model overrides for this one
    thread_window: 12                  # thread lines the fast model sees
    summarize_after: 20                # a thread this long gets a rolling summary
    reflect_after: 1                   # reflect after every N exchanges per thread
    lookup: true                       # may ask the session about people / rooms / lore
    lookup_power: snoop                # a power fired (target = that program) whenever a
                                       #   lookup resolves a program — so being read is *felt*
    powers: all                        # which `who: agent` powers it may use (or a list, or none)
    bargain: "…"                       # guidance on when a favour is earned
    catchphrases:                      # rationed by the new voice (wave 12): once
      - "Your request has been logged" #   per person, at first contact
    catchphrase_stages: [formal]       # …and only while his stage is one of these
                                       #   (none = any stage)
    unsaid:                            # a name he never says until the story has
      - name: Sandy                    #   (the new voice cuts every sentence naming
        until: Night.recount == true   #   it while `until` is false)
    situations:                        # optional extra instructions for a moment:
      - name: at his heart             #   (name optional — the block's heading)
        when: them.at_the_heart == true  # a gate expression, read like `when:`
        prompt: |                      # appended to the voice's system prompt
          You are in the cold room…    #   (and the orchestrator's reflect for
                                       #   that speaker) while `when` is true
        max_sentences: 4               # (wave 20) his line may run this long here
                                       #   (the guards cut a longer one; the last
                                       #   holding situation that sets it wins)
        acts: none                     # (wave 20) he decides nothing here: every
                                       #   act the model returns is dropped
    outside:                           # (wave 20, D29) names and words from outside
      - Steph                          #   his world: never in his line (swapped for
      - Loom                           #   a fallback, its acts dropped, like a
                                       #   `secrets.never` hit), and the prompt says
                                       #   they are not things he knows
      - John (not followed by McAfee)  # (wave 32) outside only where that word does
                                       #   not come next (`guards.outside_entry`)
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
from .secrets import Secrets

_KNOWN = {
    "character",
    "variables",
    "max_step",
    "facts",
    "them",
    "them_adjust",
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
    "situations",
    "catchphrases",
    "catchphrase_stages",
    "fallbacks",
    "unsaid",
    "outside",
}

_SITUATION_KEYS = {"name", "when", "prompt", "max_sentences", "acts"}


@dataclass(frozen=True)
class Situation:
    """Extra instructions for one kind of moment: while `when` holds for a
    request (evaluated over the same context as the persona's `when:`
    gate — world paths, `self.*`, `them.*`, `speaker.*`), `prompt` is
    appended to the voice's system prompt as its own block, and shown to
    the orchestrator when it reflects on that exchange."""

    when: Condition
    prompt: str
    name: str = ""
    #: (wave 20) His line may run up to this many sentences here; the guards
    #: cut a longer one. None = no limit of its own.
    max_sentences: int | None = None
    #: (wave 20) `acts: none`: he decides nothing here — every act dropped.
    no_acts: bool = False

    @property
    def heading(self) -> str:
        return self.name or self.when.source


@dataclass(frozen=True)
class Persona:
    character: str
    system: str
    variables: tuple[str, ...] = ()
    max_step: int = 15
    facts: tuple[str, ...] = ()
    #: Speaker variables to show; None = all of them.
    them: tuple[str, ...] | None = None
    #: Wave 21: a player speaker's (staff who play) slots the reply's
    #: `adjust` may move, sent as `them.<slot>`; only when the request says
    #: `speaker.player` and lists the slot in `them.ranges`.
    them_adjust: tuple[str, ...] = ()
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
    #: Hunt answers the character must never check (mind-file `secrets:`).
    secrets: Secrets = field(default_factory=Secrets)
    #: Extra instructions per kind of moment (`situations:`), in file order.
    situations: tuple[Situation, ...] = ()
    #: Lines the new voice rations to once per person (`catchphrases:`).
    catchphrases: tuple[str, ...] = ()
    #: The stages a catchphrase may be said in at all (`catchphrase_stages:`;
    #: empty = any): the dialog-box greeting is the formal helper's, never the
    #: last act's (K-04: the finale's "Your request has been logged.").
    catchphrase_stages: tuple[str, ...] = ()
    #: The new voice's lines for nothing usable left, by stage ("" = any
    #: stage; `fallbacks:`); `guards.pick_fallback` picks one not heard yet.
    fallbacks: dict[str, tuple[str, ...]] = field(default_factory=dict)
    #: Names the new voice never says until the story has (`unsaid:`): each
    #: (name, condition), the condition read like `when:`.
    unsaid: tuple[tuple[str, Condition], ...] = ()
    #: The mind file's phase cards, in file order, inheritance resolved
    #: (`parse_mind_table`). A bare cue string is a card too.
    phase_cards: dict[str, "PhaseCard"] = field(default_factory=dict)
    #: One paragraph per declared stage (`phases._stages`).
    stage_cards: dict[str, str] = field(default_factory=dict)
    #: Not fatal, worth a look (`stagehand check` prints them).
    warnings: tuple[str, ...] = ()
    #: (wave 20, D29) Names and words from outside his world (`outside:`):
    #: a hit in his output is treated like a `secrets.never` hit.
    outside: tuple[str, ...] = ()


POLICY_FAVOURS = ("none", "earned", "loose")
CARD_KEYS = frozenset({"stage", "favours", "drives", "powers", "tell", "brief", "cue"})
#: The reserved `phases:` key for the stage cards (no `_` key is ever a phase).
STAGES_KEY = "_stages"


@dataclass(frozen=True)
class PhaseCard:
    """One `Night.phase`'s card (the wave 12 contract §C4.1), inheritance resolved:
    `stage` / `favours` / `powers` / `tell` come from the card before when
    left out, `drives` merge over the card before's, and `brief` never
    inherits (no brief → the card's `cue`, else "")."""

    phase: str
    stage: str = ""
    favours: str = "none"
    drives: dict[str, int] = field(default_factory=dict)
    powers: tuple[str, ...] = ()
    tell: tuple[str, ...] = ()
    brief: str = ""
    #: The classic orchestrator's cue as written ("" = none; classic then reads the brief).
    cue: str = ""
    #: The keys this card wrote itself (the rest were inherited).
    own: frozenset[str] = frozenset()

    @property
    def classic_cue(self) -> str:
        """What classic hands the orchestrator for this phase (§C4.2)."""
        return " ".join((self.cue or self.brief).split())


@dataclass(frozen=True)
class PhaseTable:
    cards: dict[str, PhaseCard] = field(default_factory=dict)
    stage_cards: dict[str, str] = field(default_factory=dict)
    warnings: tuple[str, ...] = ()

    @property
    def cues(self) -> dict[str, str]:
        return {phase: card.classic_cue for phase, card in self.cards.items() if card.classic_cue}


def _names(value: Any, where: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return tuple(v.strip() for v in value.split(",") if v.strip())
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return tuple(v.strip() for v in value if v.strip())
    raise ConfigError(f"{where}: expected a comma list or a list of names")


def _situations(value: Any, source: str) -> tuple[Situation, ...]:
    if value in (None, ""):
        return ()
    if not isinstance(value, list):
        raise ConfigError(f"{source}: situations: expected a list of {{when, prompt}} entries")
    out: list[Situation] = []
    for i, raw in enumerate(value):
        where = f"{source}: situations[{i}]"
        if not isinstance(raw, dict):
            raise ConfigError(f"{where}: expected a mapping with when: and prompt:")
        unknown = sorted(str(k) for k in set(raw) - _SITUATION_KEYS)
        if unknown:
            raise ConfigError(f"{where}: unknown key(s) {', '.join(unknown)}")
        when_src = raw.get("when")
        if not isinstance(when_src, str) or when_src.strip() == "":
            raise ConfigError(f"{where}: needs a when: expression")
        try:
            when = Condition(when_src.strip())
        except ValueError as err:
            raise ConfigError(f"{where}: when: {err}") from err
        prompt = raw.get("prompt")
        if not isinstance(prompt, str) or prompt.strip() == "":
            raise ConfigError(f"{where}: needs a prompt: text")
        name = raw.get("name")
        if name is not None and not isinstance(name, str):
            raise ConfigError(f"{where}: name must be text")
        cap = raw.get("max_sentences")
        if cap is not None and (isinstance(cap, bool) or not isinstance(cap, int) or not 1 <= cap <= 12):
            raise ConfigError(f"{where}: max_sentences must be a whole number from 1 to 12")
        acts = raw.get("acts")
        if acts is not None and acts not in ("none", "any"):
            raise ConfigError(f"{where}: acts must be none (or any, the default)")
        out.append(Situation(when=when, prompt=prompt.strip(), name=(name or "").strip(), max_sentences=cap, no_acts=acts == "none"))
    return tuple(out)


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
    secrets = Secrets()
    table = PhaseTable()
    if meta.get("mind") not in (None, ""):
        mind_path = Path(str(meta["mind"]))
        if not mind_path.is_absolute() and source not in ("<persona>", ""):
            mind_path = Path(source).parent / mind_path
        try:
            mind_text = mind_path.read_text(encoding="utf-8")
        except OSError as err:
            raise ConfigError(f"{source}: cannot read mind file {mind_path}: {err}") from err
        mind_prompt, stages, drives, phase_cues = parse_mind_file(mind_text, str(mind_path))
        secrets = parse_mind_secrets(mind_text, str(mind_path))
        table = parse_mind_table(mind_text, str(mind_path))
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
    outside = _names(meta.get("outside"), f"{source}: outside")
    fallbacks = _fallbacks(meta.get("fallbacks"), stages, secrets, source)
    catchphrases = _catchphrases(meta.get("catchphrases"), source)
    in_world: list[tuple[str, str]] = [("the system prompt", body), ("fallback:", str(meta.get("fallback") or "")), ("unavailable:", str(meta.get("unavailable") or ""))]
    in_world += [(f"fallbacks: {stage or '(any)'}", line) for stage, lines in fallbacks.items() for line in lines]
    in_world += [("catchphrases:", line) for line in catchphrases]
    for phase, card in table.cards.items():
        if "brief" in card.own or "cue" in card.own:
            in_world.append((f"the {phase} card", f"{card.brief} {card.cue}"))
        if "tell" in card.own:
            in_world += [(f"the {phase} card's tell", t) for t in card.tell]
    in_world += [(f"the {stage} stage card", text) for stage, text in table.stage_cards.items()]
    return Persona(
        character=character.strip(),
        system=body,
        variables=_names(meta.get("variables"), f"{source}: variables"),
        max_step=max(0, max_step),
        facts=_names(meta.get("facts"), f"{source}: facts"),
        them=None if them is None else _names(them, f"{source}: them"),
        them_adjust=_names(meta.get("them_adjust"), f"{source}: them_adjust"),
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
        secrets=secrets,
        situations=_situations(meta.get("situations"), source),
        catchphrases=catchphrases,
        catchphrase_stages=_catchphrase_stages(meta.get("catchphrase_stages"), stages, source),
        fallbacks=fallbacks,
        unsaid=_unsaid(meta.get("unsaid"), source),
        outside=outside,
        phase_cards=dict(table.cards),
        stage_cards=dict(table.stage_cards),
        warnings=table.warnings + _outside_warnings(outside, in_world, source),
    )


def _outside_warnings(outside: tuple[str, ...], texts: list[tuple[str, str]], source: str) -> tuple[str, ...]:
    """(D29) An `outside:` entry his own in-world text uses (`show` in *let me
    show you*, `party` in *the party favour*) would swap every such line he
    says for a fallback: list a phrase instead (*the show*, *a party*)."""
    if not outside:
        return ()
    from .guards import outside_hit  # guards imports this module

    out: list[str] = []
    for where, text in texts:
        hit = outside_hit(outside, text)
        if hit:
            out.append(f"{source}: outside: {hit!r} is in {where} (in-world text) — every line of his that says it would be withheld; list a phrase instead")
    return tuple(out)


def _catchphrases(value: Any, source: str) -> tuple[str, ...]:
    if value in (None, ""):
        return ()
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
        raise ConfigError(f"{source}: catchphrases: expected a list of lines")
    return tuple(" ".join(v.split()) for v in value)


def _catchphrase_stages(value: Any, stages: tuple[str, ...], source: str) -> tuple[str, ...]:
    names = _names(value, f"{source}: catchphrase_stages")
    unknown = [n for n in names if stages and n not in stages]
    if unknown:
        raise ConfigError(f"{source}: catchphrase_stages: {', '.join(unknown)} is not a declared stage ({', '.join(stages)})")
    return names


def _fallbacks(value: Any, stages: tuple[str, ...], secrets: Secrets, source: str) -> dict[str, tuple[str, ...]]:
    if value in (None, ""):
        return {}
    raw = {"": value} if isinstance(value, list) else value
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: fallbacks: expected a list of lines, or a mapping of stage → lines")
    out: dict[str, tuple[str, ...]] = {}
    for key, lines in raw.items():
        stage = str(key).strip()
        if stage and stages and stage not in stages:
            raise ConfigError(f"{source}: fallbacks.{stage}: not a declared stage ({', '.join(stages)})")
        if isinstance(lines, str):
            lines = [lines]
        if not isinstance(lines, list) or not all(isinstance(x, str) and x.strip() for x in lines):
            raise ConfigError(f"{source}: fallbacks.{stage or '(any)'}: expected a list of lines")
        if any(secrets.leaks(x) for x in lines):
            raise ConfigError(f"{source}: fallbacks.{stage or '(any)'}: carries a secrets.never word")
        out[stage] = tuple(" ".join(x.split()) for x in lines)
    return out


def _unsaid(value: Any, source: str) -> tuple[tuple[str, Condition], ...]:
    if value in (None, ""):
        return ()
    if not isinstance(value, list):
        raise ConfigError(f"{source}: unsaid: expected a list of {{name, until}} entries")
    out: list[tuple[str, Condition]] = []
    for i, raw in enumerate(value):
        where = f"{source}: unsaid[{i}]"
        if not isinstance(raw, dict) or set(raw) - {"name", "until"}:
            raise ConfigError(f"{where}: expected a mapping with name: and until:")
        name, until = raw.get("name"), raw.get("until")
        if not isinstance(name, str) or not name.strip():
            raise ConfigError(f"{where}: needs a name")
        if not isinstance(until, str) or not until.strip():
            raise ConfigError(f"{where}: needs an until: expression")
        try:
            out.append((" ".join(name.split()), Condition(until.strip())))
        except ValueError as err:
            raise ConfigError(f"{where}: until: {err}") from err
    return tuple(out)


_MIND_KNOWN = {"stages", "drives", "phases", "secrets"}


def parse_mind_file(text: str, source: str = "<mind>") -> tuple[str | None, tuple[str, ...], dict[str, int], dict[str, str]]:
    """A mind file is the orchestrator's prompt, optionally opening with a
    frontmatter block that declares the character's arc (`stages:`), its
    drives with opening values (`drives:`), and a cue or a card per story
    phase (`phases:`, see `parse_mind_table`). Returns (prompt, stages,
    drives, phase_cues): classic's cue per phase is a card's `cue:` (or its
    brief), and a bare string's text, as before."""
    body = text
    stages: tuple[str, ...] = ()
    drives: dict[str, int] = {}
    phases: dict[str, str] = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        meta = _frontmatter(text, source)
        unknown = sorted(set(meta) - _MIND_KNOWN)
        if unknown:
            raise ConfigError(f"{source}: unknown frontmatter key(s) {', '.join(unknown)}")
        stages = _names(meta.get("stages"), f"{source}: stages")
        drives = _drives(meta, source)
        if meta.get("phases") is not None:
            phases = _phase_table(meta, stages, drives, parse_mind_secrets(text, source), source).cues
        body = text[end + 4 :]
    prompt = body.strip() or None
    return prompt, stages, drives, phases


def _frontmatter(text: str, source: str) -> dict[str, Any]:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        raise ConfigError(f"{source}: unterminated frontmatter (no closing '---')")
    try:
        meta = yaml.safe_load(text[3:end]) or {}
    except yaml.YAMLError as err:
        raise ConfigError(f"{source}: bad frontmatter YAML: {err}") from err
    if not isinstance(meta, dict):
        raise ConfigError(f"{source}: frontmatter must be a mapping")
    return meta


def parse_mind_table(text: str, source: str = "<mind>") -> PhaseTable:
    """The mind file's phase table (the wave 12 contract §C4): a card per
    `Night.phase` and a paragraph per declared stage, validated. Every
    failure is a `ConfigError` (the worker will not boot; `check` fails).
    A bare cue string is a card with only `cue:`."""
    meta = _frontmatter(text, source)
    if meta.get("phases") is None:
        return PhaseTable()
    stages = _names(meta.get("stages"), f"{source}: stages")
    return _phase_table(meta, stages, _drives(meta, source), parse_mind_secrets(text, source), source)


def _drives(meta: dict[str, Any], source: str) -> dict[str, int]:
    drives: dict[str, int] = {}
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
    return drives


def _card_strings(value: Any, where: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
        raise ConfigError(f"{where}: expected a list of non-empty names")
    return tuple(v.strip() for v in value)


def _phase_table(meta: dict[str, Any], stages: tuple[str, ...], drives: dict[str, int], secrets: Secrets, source: str) -> PhaseTable:
    raw = meta.get("phases")
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: phases must be a mapping of phase → cue or card")
    warnings: list[str] = []
    stage_cards: dict[str, str] = {}
    if STAGES_KEY in raw:
        given = raw[STAGES_KEY]
        if not isinstance(given, dict):
            raise ConfigError(f"{source}: phases.{STAGES_KEY} must map each declared stage to its text")
        for name, card in given.items():
            stage = str(name).strip()
            if stage not in stages:
                raise ConfigError(f"{source}: phases.{STAGES_KEY}.{name}: not a declared stage ({', '.join(stages) or 'none declared'})")
            if not isinstance(card, str) or not card.strip():
                raise ConfigError(f"{source}: phases.{STAGES_KEY}.{name}: needs its text")
            if secrets.leaks(card):
                raise ConfigError(f"{source}: phases.{STAGES_KEY}.{name}: carries a secrets.never word")
            stage_cards[stage] = " ".join(card.split())
    missing = [s for s in stages if s not in stage_cards]
    if missing and (stage_cards or any(isinstance(v, dict) for k, v in raw.items() if not str(k).startswith("_"))):
        warnings.append(f"{source}: no stage card for {', '.join(missing)} (the voice sees the stage name alone)")
    cards: dict[str, PhaseCard] = {}
    prev = PhaseCard(phase="", stage=stages[0] if stages else "", favours="none", drives=dict(drives))
    for key, value in raw.items():
        phase = str(key).strip()
        if phase.startswith("_"):
            if phase != STAGES_KEY:
                raise ConfigError(f"{source}: phases.{phase}: a leading '_' is reserved ({STAGES_KEY} is the only one)")
            continue
        where = f"{source}: phases.{phase}"
        if isinstance(value, str):
            if not value.strip():
                raise ConfigError(f"{where}: an empty cue")
            body: dict[str, Any] = {"cue": value}
        elif isinstance(value, dict):
            body = value
        else:
            raise ConfigError(f"{where}: expected a cue (text) or a card (a mapping)")
        unknown = sorted(str(k) for k in set(body) - CARD_KEYS)
        if unknown:
            raise ConfigError(f"{where}: unknown card key(s) {', '.join(unknown)} (a card has {', '.join(sorted(CARD_KEYS))})")
        stage = prev.stage
        if "stage" in body:
            stage = str(body["stage"]).strip() if isinstance(body["stage"], str) else ""
            if stage not in stages:
                raise ConfigError(f"{where}: stage {body['stage']!r} is not a declared stage ({', '.join(stages) or 'none declared'})")
        favours = prev.favours
        if "favours" in body:
            favours = str(body["favours"]).strip().lower() if isinstance(body["favours"], str) else ""
            if favours not in POLICY_FAVOURS:
                raise ConfigError(f"{where}: favours must be one of {', '.join(POLICY_FAVOURS)}")
        merged = dict(prev.drives)
        if "drives" in body:
            given = body["drives"]
            if not isinstance(given, dict):
                raise ConfigError(f"{where}: drives must map declared drives to 0–100")
            for name, v in given.items():
                if str(name) not in drives:
                    raise ConfigError(f"{where}: drives.{name}: not a declared drive ({', '.join(drives) or 'none declared'})")
                if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 100:
                    raise ConfigError(f"{where}: drives.{name} must be a whole number 0–100")
                merged[str(name)] = v
        powers = _card_strings(body["powers"], f"{where}: powers") if "powers" in body else prev.powers
        tell = _card_strings(body["tell"], f"{where}: tell") if "tell" in body else prev.tell
        texts: dict[str, str] = {}
        for k in ("brief", "cue"):
            if k in body:
                if not isinstance(body[k], str):
                    raise ConfigError(f"{where}: {k} must be text")
                if secrets.leaks(body[k]):
                    raise ConfigError(f"{where}: {k} carries a secrets.never word")
                texts[k] = body[k].strip()
        cue = texts.get("cue", "")
        brief = texts.get("brief") or cue
        card = PhaseCard(phase=phase, stage=stage, favours=favours, drives=merged, powers=powers, tell=tell, brief=brief, cue=cue, own=frozenset(body))
        cards[phase] = card
        prev = card
    return PhaseTable(cards=cards, stage_cards=stage_cards, warnings=tuple(warnings))


def parse_mind_secrets(text: str, source: str = "<mind>") -> Secrets:
    """The mind file's `secrets:` block (`topics` / `match` / `lore` /
    `never`, each a list or comma list). Never shown to a model; see
    `secrets.py`."""
    if not text.startswith("---"):
        return Secrets()
    end = text.find("\n---", 3)
    if end < 0:
        return Secrets()  # parse_mind_file reports the unterminated block
    try:
        meta = yaml.safe_load(text[3:end]) or {}
    except yaml.YAMLError:
        return Secrets()
    raw = meta.get("secrets") if isinstance(meta, dict) else None
    if raw is None:
        return Secrets()
    if not isinstance(raw, dict):
        raise ConfigError(f"{source}: secrets must be a mapping with topics / match / lore / never")
    unknown = sorted(set(raw) - {"topics", "match", "lore", "never"})
    if unknown:
        raise ConfigError(f"{source}: unknown secrets key(s) {', '.join(map(str, unknown))}")

    def words(key: str) -> tuple[str, ...]:
        value = raw.get(key)
        if isinstance(value, list):
            value = [str(v) for v in value if v is not None]
        return _names(value, f"{source}: secrets.{key}")

    return Secrets(topics=words("topics"), match=words("match"), lore=words("lore"), never=words("never"))


def load_persona(path: str | Path) -> Persona:
    p = Path(path)
    try:
        text = p.read_text(encoding="utf-8")
    except OSError as err:
        raise ConfigError(f"cannot read persona {path}: {err}") from err
    return parse_persona(text, str(p))
