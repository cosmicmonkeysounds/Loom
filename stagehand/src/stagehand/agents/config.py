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
        num_ctx: 32768             # api: ollama only — the default: a late-night line is ≈ 14k tokens
      orchestrator:                # the slow model that grows each character's mind
        enabled: true              #   (off → the persona alone, as before)
        llm:                       #   defaults: the section's llm: with this model
          model: tobestyledintro/qwen3.8-9b-distill:q8_0
          temperature: 0.4
          max_tokens: 1200
          api: ollama              #   native /api/chat: `think` + `keep_alive` honoured
          extra: { think: false }  #   reasoning off (the OpenAI shim ignores this)
          keep_alive: 30m          #   stay resident between reflections
          num_ctx: 24576           #   the default: a late-night reflection is ≈ 21k tokens
        quiet_s: 1.5               #   idle seconds before a reflection may start
        preempt: true              #   a new request cancels a running reflection
        survey_every_s: 120        #   look at the whole house this often (0 = never)
      mind_mode: new               # new | classic (wave 12). ABSENT = classic: today's
                                   #   two-model mind, so an unedited YAML keeps it
      voice:                       # read only in mind_mode: new (each on | off)
        memo: on                   #   the voice keeps a ≤ 140-character note per person
        repeat_guard: on           #   one retry when a reply repeats his last lines
        dossier_on_close: on       #   the quiet-conversation summary (120 s idle, ≥ 3 turns)
        warm_head: on              #   a one-token call with the shared head before each line (api: ollama)
        layout: lean               #   lean | classic (today's prompt, inside the new mind)
        brief_at: 0                #   (wave 42b) a request with this many lines queued behind it
                                   #   asks for two short sentences (0 = never, the default: measured
                                   #   on the show MacBook it saved ~7 tokens a reply and no throughput)
        brief_max_tokens: 600      #   … and caps the call's max_tokens (reasoning counts: ≥ 400)
      overflow:                    # (wave 42b) more engines for the same mind (one worker)
        - name: desktop            #   shown in the trace and `check`
          endpoint: http://192.168.8.10:11434/v1
          capacity: 1              #   its slots (1..16); the worker's capacity is the sum
          api: ollama              #   any llm: key but json_mode; api_key_env names an env var
      mind:                        # read only in mind_mode: new
        stage_from_phase: on       #   the mind file's phase cards set stage / drives / brief
        phase_poll_s: 30           #   the phase watch (no model call); 0 = off
      state_dir: .stagehand-minds  # where minds persist (per event / character)
      facts_ttl_s: 5               # how long a facts snapshot is reused
      characters:                  # one persona file per voiced character
        - ../core/examples/trapped-in-the-internet/trabolta.persona.md
        - persona: other.persona.md
          llm: { temperature: 0.6 }   # per-character overrides (beat frontmatter)

Persona paths resolve relative to the config file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from ..module import ConfigError
from .llm import LlmConfig
from .orchestrator import OrchestratorConfig
from .persona import Persona, load_persona
from .slots import PRIMARY

#: The orchestrator's default model when the section doesn't name one.
ORCHESTRATOR_MODEL = "tobestyledintro/qwen3.8-9b-distill:q8_0"
#: The orchestrator's default context (`api: ollama`). The reflect prompt —
#: the mind file + persona + the house + the lore + a mind grown through the
#: night — is ≈ 10k tokens at the doors and ≈ 21k late (w42c) (`stagehand check`'s
#: estimate, at 3 characters a token, plus the reply), and on Ollama's default
#: context the runner cuts its middle while the mind update still looks
#: confident. 24k costs the 9B orchestrator ≈ 3.5 GB of KV cache. `num_ctx: …` (or `extra: {options: {num_ctx: …}}`)
#: overrides it; `num_ctx: 0` sends none (the server's default).
ORCHESTRATOR_NUM_CTX = 24576
#: The voice's default context (`api: ollama`). A late-night line — the
#: persona + the mind block + the house + a long thread + every situation —
#: is ≈ 14k tokens, and Ollama's own default depends on the version and the
#: machine's memory (32768 on the 48 GB house Mac today, 4096 on a small one
#: or with `OLLAMA_CONTEXT_LENGTH` set lower), cutting the middle of the
#: prompt with no error. 32768 is the size the voice already runs at on the
#: house Mac, so pinning it reloads nothing. `num_ctx: …` overrides it;
#: `num_ctx: 0` sends none. Ignored for `api: openai` (the server decides).
VOICE_NUM_CTX = 32768


MIND_MODES = ("new", "classic")
VOICE_LAYOUTS = ("lean", "classic")


@dataclass(frozen=True)
class VoiceSettings:
    """`agents.voice:` — read only in `mind_mode: new` (the wave 12 contract §C5.1)."""

    memo: bool = True
    repeat_guard: bool = True
    #: The quiet-conversation summary.
    dossier_on_close: bool = True
    #: A one-token call with P1 + P2 before each line, so Ollama keeps a
    #: cache checkpoint at the shared head (K-04: ~5 s → ~2 s per prompt).
    warm_head: bool = True
    #: "lean" | "classic"
    layout: str = "lean"
    #: (wave 42b) Brief mode: a request frame whose `queued` (lines waiting
    #: on the server) is at least this asks for at most two short
    #: sentences and caps the call's tokens. 0 = never. Never a stage
    #: request or a guest at his heart.
    brief_at: int = 0
    #: (wave 42b) Brief mode's `max_tokens` cap (reasoning counts against it).
    brief_max_tokens: int = 600


#: (wave 42b) The least `voice.brief_max_tokens` may be: gpt-oss at low
#: effort spends ~100–300 tokens reasoning before the answer starts.
BRIEF_MIN_TOKENS = 400
#: (wave 42b) The most slots one overflow engine may have (the stream's own cap).
ENGINE_CAPACITY_MAX = 16
#: (wave 42b) What an `agents.overflow` entry may set besides name / capacity.
OVERFLOW_LLM_KEYS = ("endpoint", "model", "api", "reasoning_effort", "temperature", "max_tokens", "timeout_s", "keep_alive", "num_ctx", "api_key_env", "extra")
_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class OverflowEngine:
    """(wave 42b) One `agents.overflow` entry: a second (third …) model
    server for the same mind. `overrides` are the LlmConfig fields it sets
    over each character's voice model; the rest are the character's."""

    name: str
    capacity: int
    overrides: dict[str, Any] = field(default_factory=dict)

    @property
    def api_key_env(self) -> str | None:
        return self.overrides.get("api_key_env")

    def model(self, base: LlmConfig) -> LlmConfig:
        """A character's voice model on this engine."""
        return engine_model(base, self.overrides)


def engine_model(base: LlmConfig, overrides: dict[str, Any]) -> LlmConfig:
    """`base` (a character's voice model) with an engine's own fields. An
    `api: openai` engine carries no `num_ctx`; an `api: ollama` one with
    none of its own and none inherited gets the voice's default. An engine
    on another api than the character's never inherits its `extra` (body
    fields for that api: Ollama's `options` / `think` sent to a hosted
    OpenAI endpoint is a 400)."""
    if not overrides:
        return base
    cfg = replace(base, **overrides)
    if cfg.api != base.api and "extra" not in overrides:
        cfg = replace(cfg, extra={})
    if cfg.api != "ollama":
        return replace(cfg, num_ctx=None)
    if cfg.num_ctx is None and "num_ctx" not in overrides:
        return replace(cfg, num_ctx=VOICE_NUM_CTX)
    return cfg


@dataclass(frozen=True)
class MindSettings:
    """`agents.mind:` — read only in `mind_mode: new`."""

    stage_from_phase: bool = True
    #: Seconds between the phase watch's facts fetches; 0 = no phase watch.
    phase_poll_s: float = 30.0


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
    #: "new" (wave 12: one voice call per line, the story keeps the mind) or
    #: "classic" (today's two models). Absent in the YAML = classic.
    mind_mode: str = "classic"
    voice: VoiceSettings = field(default_factory=VoiceSettings)
    mind: MindSettings = field(default_factory=MindSettings)
    #: (wave 42b) Engines beyond `llm:`, in preference order.
    overflow: tuple[OverflowEngine, ...] = ()

    @property
    def engines(self) -> list[tuple[str, int]]:
        """(wave 42b) Every engine's name and slots: the primary first."""
        return [(PRIMARY, self.concurrency), *((e.name, e.capacity) for e in self.overflow)]

    @property
    def new_mind(self) -> bool:
        return self.mind_mode == "new"


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
            num_ctx=None if cfg.num_ctx in (None, "", 0) else int(cfg.num_ctx),
        )
    except (TypeError, ValueError) as err:
        raise ConfigError(f"{where}: {err}") from err
    if out.api not in ("openai", "ollama"):
        raise ConfigError(f"{where}: api must be 'openai' or 'ollama'")
    if out.num_ctx is not None and out.num_ctx < 0:
        raise ConfigError(f"{where}: num_ctx must be a positive number of tokens (0 = the server's default)")
    return out


def _ollama_only(cfg: LlmConfig) -> LlmConfig:
    """`num_ctx` is an Ollama load option: an `api: openai` model carries
    none (its server picks the context, and `check` has nothing to size)."""
    return cfg if cfg.api == "ollama" else replace(cfg, num_ctx=None)


def _switch(value: Any, where: str) -> bool:
    """`on` / `off` as YAML reads them (booleans) or as strings."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("on", "true", "yes"):
        return True
    if isinstance(value, str) and value.strip().lower() in ("off", "false", "no"):
        return False
    raise ConfigError(f"{where}: expected on or off")


def _voice(raw: Any) -> VoiceSettings:
    if raw is None:
        return VoiceSettings()
    if not isinstance(raw, dict):
        raise ConfigError("agents.voice: must be a mapping")
    unknown = sorted(str(k) for k in set(raw) - set(VoiceSettings.__dataclass_fields__))
    if unknown:
        raise ConfigError(f"agents.voice: unknown key(s) {', '.join(unknown)}")
    layout = str(raw.get("layout", "lean")).strip().lower()
    if layout not in VOICE_LAYOUTS:
        raise ConfigError(f"agents.voice.layout: must be one of {', '.join(VOICE_LAYOUTS)}")
    brief_at = raw.get("brief_at", 0)
    if isinstance(brief_at, bool) or not isinstance(brief_at, int) or brief_at < 0:
        raise ConfigError("agents.voice.brief_at: must be a whole number of queued lines (0 = never)")
    brief_max = raw.get("brief_max_tokens", 600)
    if isinstance(brief_max, bool) or not isinstance(brief_max, int) or brief_max < BRIEF_MIN_TOKENS:
        raise ConfigError(f"agents.voice.brief_max_tokens: must be a whole number of tokens, at least {BRIEF_MIN_TOKENS} (reasoning counts against it)")
    return VoiceSettings(
        brief_at=brief_at,
        brief_max_tokens=brief_max,
        memo=_switch(raw.get("memo", True), "agents.voice.memo"),
        repeat_guard=_switch(raw.get("repeat_guard", True), "agents.voice.repeat_guard"),
        dossier_on_close=_switch(raw.get("dossier_on_close", True), "agents.voice.dossier_on_close"),
        warm_head=_switch(raw.get("warm_head", True), "agents.voice.warm_head"),
        layout=layout,
    )


def _mind(raw: Any) -> MindSettings:
    if raw is None:
        return MindSettings()
    if not isinstance(raw, dict):
        raise ConfigError("agents.mind: must be a mapping")
    unknown = sorted(str(k) for k in set(raw) - set(MindSettings.__dataclass_fields__))
    if unknown:
        raise ConfigError(f"agents.mind: unknown key(s) {', '.join(unknown)}")
    try:
        poll = float(raw.get("phase_poll_s", 30.0))
    except (TypeError, ValueError) as err:
        raise ConfigError("agents.mind.phase_poll_s: must be a number of seconds (0 = off)") from err
    if poll < 0 or isinstance(raw.get("phase_poll_s"), bool):
        raise ConfigError("agents.mind.phase_poll_s: must be a number of seconds (0 = off)")
    return MindSettings(stage_from_phase=_switch(raw.get("stage_from_phase", True), "agents.mind.stage_from_phase"), phase_poll_s=poll)


def _overflow(raw: Any) -> tuple[OverflowEngine, ...]:
    """(wave 42b) `agents.overflow:` — a list of engines, each validated
    alone. Each must name its endpoint; an `api_key_env` is the NAME of an
    environment variable (the key itself never goes in a YAML), and is
    never inherited from `llm:` (a hosted key must not reach another host)."""
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ConfigError("agents.overflow: a list of engines ({name, endpoint, capacity, …})")
    out: list[OverflowEngine] = []
    names = {PRIMARY}
    for i, entry in enumerate(raw):
        where = f"agents.overflow[{i}]"
        if not isinstance(entry, dict):
            raise ConfigError(f"{where}: a mapping {{name, endpoint, capacity, …}}")
        unknown = sorted(str(k) for k in set(entry) - {"name", "capacity", *OVERFLOW_LLM_KEYS})
        if unknown:
            raise ConfigError(f"{where}: unknown key(s) {', '.join(unknown)}")
        name = str(entry.get("name") or "").strip()
        if not name:
            raise ConfigError(f"{where}: needs a name (shown in the trace and `stagehand check`)")
        if name in names:
            raise ConfigError(f"{where}: the name {name!r} is taken ({PRIMARY!r} is agents.llm)")
        names.add(name)
        where = f"agents.overflow[{name}]"
        endpoint = entry.get("endpoint")
        if not isinstance(endpoint, str) or not endpoint.strip().startswith(("http://", "https://")):
            raise ConfigError(f"{where}: needs an endpoint (http://host:port/v1)")
        cap = entry.get("capacity", 1)
        if isinstance(cap, bool) or not isinstance(cap, int) or not 1 <= cap <= ENGINE_CAPACITY_MAX:
            raise ConfigError(f"{where}: capacity must be a whole number of slots from 1 to {ENGINE_CAPACITY_MAX}")
        key_env = entry.get("api_key_env")
        if key_env not in (None, "") and (not isinstance(key_env, str) or not _ENV_NAME.match(key_env)):
            raise ConfigError(f"{where}: api_key_env is the NAME of an environment variable holding the key (never the key itself)")
        given = {k: entry[k] for k in OVERFLOW_LLM_KEYS if k in entry}
        given["endpoint"] = endpoint.strip()
        checked = _llm(given, LlmConfig(), where)  # the types, the api, num_ctx
        overrides = {k: getattr(checked, k) for k in given}
        overrides["api_key_env"] = checked.api_key_env if "api_key_env" in given else None
        out.append(OverflowEngine(name=name, capacity=cap, overrides=overrides))
    return tuple(out)


def parse_agents(doc: Any, base_dir: str = ".") -> AgentsConfig:
    if not isinstance(doc, dict):
        raise ConfigError("'agents:' must be a mapping")
    unknown = sorted(set(doc) - {"name", "concurrency", "dry_run", "llm", "characters", "orchestrator", "state_dir", "facts_ttl_s", "mind_mode", "voice", "mind", "overflow"})
    if unknown:
        raise ConfigError(f"agents: unknown key(s) {', '.join(unknown)}")
    # The section's defaults keep the voice's context until each character's
    # model is resolved: a persona may switch an `api: openai` section to ollama.
    section = _llm(doc.get("llm"), LlmConfig(num_ctx=VOICE_NUM_CTX), "agents.llm")
    llm = _ollama_only(section)
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
        num_ctx=ORCHESTRATOR_NUM_CTX,
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
        models[persona.character] = _ollama_only(_llm(entry.get("llm"), _llm(persona.llm, section, f"{path} frontmatter"), f"{where}.llm"))
        orchestrator_models[persona.character] = _llm(entry.get("orchestrator"), _llm(persona.orchestrator, orch_llm, f"{path} frontmatter orchestrator"), f"{where}.orchestrator")
    try:
        concurrency = max(1, int(doc.get("concurrency", 1)))
        facts_ttl_s = max(0.0, float(doc.get("facts_ttl_s", 5.0)))
    except (TypeError, ValueError) as err:
        raise ConfigError("agents.concurrency / facts_ttl_s must be numbers") from err
    mind_mode = "classic" if doc.get("mind_mode") is None else str(doc.get("mind_mode")).strip().lower()
    if mind_mode not in MIND_MODES:
        raise ConfigError(f"agents.mind_mode: must be one of {', '.join(MIND_MODES)} (absent = classic)")
    voice = _voice(doc.get("voice"))
    mind = _mind(doc.get("mind"))
    overflow = _overflow(doc.get("overflow"))
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
        mind_mode=mind_mode,
        voice=voice,
        mind=mind,
        overflow=overflow,
    )
