"""The model call — one chat request, in one of three dialects.

`api: anthropic` (wave 52) is Claude's Messages API through the official
SDK, an optional extra (`uv sync --extra anthropic`) so the Desktop's jobs
never install it. See `anthropic_request` for how the prompt maps.
`api: openai` (the default) is an OpenAI-compatible `chat/completions`
request: Ollama (`ollama serve`, default `http://localhost:11434/v1`),
llama.cpp's server, LM Studio and vLLM all speak it, so a local model
needs no SDK. `api: ollama` is Ollama's native `/api/chat` — the only
way to actually switch a thinking model's reasoning **off** (`think:
false`; the OpenAI shim ignores it and burns hundreds of hidden tokens
per call) and to pin `keep_alive` so both models stay resident for the
whole party. The orchestrator defaults to it. Notes for reasoning models
like `gpt-oss:20b`:

  - `reasoning_effort: low` keeps latency sane (seconds, not tens);
  - reasoning tokens count against `max_tokens`, so give it room
    (~800) or the answer is cut off before it starts;
  - JSON mode (`response_format`) is off by default — the reply parser
    copes with prose, and forcing a grammar can fight the model's own
    output format.
"""

from __future__ import annotations

import json
import os
import re
import time
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import httpx


class LlmError(RuntimeError):
    pass


#: (wave 42b) The engine the calling task's last model call went to
#: (`engines.EngineCall` sets it before each call; `trace.new_thought`
#: records it). Task-local: concurrent lines never see each other's.
SERVED_BY: ContextVar[str | None] = ContextVar("stagehand_served_by", default=None)
#: (wave 42b) The model that call went out as (its endpoint, model, api),
#: beside `SERVED_BY`: after a retry on another engine the thought shows
#: where the line really went, not the engine that failed.
SERVED_MODEL: ContextVar["LlmConfig | None"] = ContextVar("stagehand_served_model", default=None)
#: (wave 42b) The warm head's budget: one token (the call exists for its
#: prompt). An engine that is not `api: ollama` never gets one.
WARM_TOKENS = 1


class LlmTruncated(LlmError):
    """The model produced no answer because `max_tokens` ran out (reasoning)."""


class LlmRefused(LlmError):
    """(wave 52) A safety classifier declined this one prompt. The engine is
    fine: the line tries another engine, and nothing is marked down."""


#: (wave 52) `api: anthropic`'s endpoint, the SDK's own default.
ANTHROPIC_ENDPOINT = "https://api.anthropic.com"
#: (wave 52) Where the key lives when `api_key_env` is not set: a launchd job
#: has no shell environment, and a plist or a YAML must never hold a key.
ANTHROPIC_KEY_ENV = "ANTHROPIC_API_KEY"
ANTHROPIC_KEY_FILE = Path.home() / ".config/loom/anthropic.key"
#: (wave 52) The SDK's own retries per call (a 429, a 529, a dropped
#: connection): one quick try, so a blip doesn't take the engine down for
#: `ENGINE_DOWN_S`. A hung call costs `timeout_s` twice before the failover.
ANTHROPIC_RETRIES = 1
#: The turn the API needs when a prompt has none in that place.
WAITING_TURN = "(they are waiting)"

_THINK_INLINE = re.compile(r"<think>(.*?)</think>", re.DOTALL | re.IGNORECASE)


@dataclass(frozen=True)
class Completion:
    """One model answer with everything the debugger wants to see next to
    the text: the model's reasoning (gpt-oss's `reasoning`, Ollama's
    `thinking`, or an inline `<think>` block), why it stopped, the token
    counts, and how long it took. `complete_fn` fakes in tests may still
    return a bare string — `Completion.of` normalises."""

    content: str
    thinking: str = ""
    finish: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    ms: int = 0
    #: How long the model spent reading the prompt (Ollama's
    #: `prompt_eval_duration`, in ms) — low when the prompt cache held. None
    #: on the OpenAI dialect, which does not say.
    prompt_ms: int | None = None
    #: (wave 52) Of `prompt_tokens`, how many the prompt cache served. None
    #: off `api: anthropic`.
    cached_tokens: int | None = None

    @classmethod
    def of(cls, value: "str | Completion | None") -> "Completion":
        if isinstance(value, Completion):
            return value
        text = value or ""
        blocks = _THINK_INLINE.findall(text)
        if blocks:
            return cls(content=text, thinking="\n\n".join(b.strip() for b in blocks if b.strip()))
        return cls(content=text)

    def __str__(self) -> str:  # a Completion reads as its text
        return self.content


def tool_calls_as_json(message: dict[str, Any]) -> str:
    """A reasoning model told to answer `{"lookup": […]}` / `{"act": …}` in
    JSON will, some of the time, *call a function* named lookup/act instead
    (gpt-oss does this through Ollama: `finish_reason: tool_calls`, empty
    content). No tools are declared, so the intent is unmistakable — fold
    the calls back into the JSON object the reply parser expects. Returns
    "" when there are no tool calls."""
    calls = message.get("tool_calls")
    if not isinstance(calls, list) or not calls:
        return ""
    doc: dict[str, Any] = {}
    for call in calls:
        fn = call.get("function") if isinstance(call, dict) else None
        if not isinstance(fn, dict):
            continue
        name = str(fn.get("name") or "").strip().lower()
        args: Any = fn.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {"value": args}
        if not isinstance(args, dict):
            args = {"value": args}
        if any(k in args for k in ("say", "lookup", "act", "adjust")):
            # The whole reply object shipped as the "arguments" of a function
            # with an arbitrary name (gpt-oss: `assistant`) — take it as is.
            for k in ("say", "adjust", "lookup", "act"):
                if k in args:
                    doc[k] = args[k]
            if "say" not in args and isinstance(args.get("text"), str):
                doc["say"] = args["text"]
            continue
        if name in ("lookup", "look_up", "search", "find", "snoop_lookup"):
            names: list[str] = []
            for v in args.values():
                if isinstance(v, str):
                    names.append(v)
                elif isinstance(v, list):
                    names.extend(str(x) for x in v if isinstance(x, (str, int)))
            doc.setdefault("lookup", []).extend(names)
        elif name in ("share", "share_lore"):
            title = next((v for v in args.values() if isinstance(v, str)), None)
            if title:
                doc.setdefault("act", []).append({"share": title})
        elif name in ("act", "fire", "use_power", "power", "use"):
            power = args.get("fire") or args.get("power") or args.get("name") or args.get("use")
            inner = args.get("args") if isinstance(args.get("args"), dict) else {k: v for k, v in args.items() if k not in ("fire", "power", "name", "use")}
            if isinstance(power, str):
                doc.setdefault("act", []).append({"fire": power, "args": inner})
        elif name in ("say", "reply", "answer", "respond"):
            text = args.get("say") or args.get("text") or args.get("message") or next((v for v in args.values() if isinstance(v, str)), "")
            if isinstance(text, str) and text:
                doc["say"] = text
            if isinstance(args.get("adjust"), dict):
                doc["adjust"] = args["adjust"]
        else:
            # A power called by its own name (`cut_the_lights({"room": …})`).
            doc.setdefault("act", []).append({"fire": name.replace("_", " "), "args": args})
    return json.dumps(doc) if doc else ""


#: What `stagehand check` assumes Ollama loads a model with when the request
#: names no `num_ctx`: the floor. A newer Ollama picks from the machine's
#: memory (32768 on the 48 GB house Mac), an older one or a small machine
#: 4096 — so the voice and the orchestrator both send their own.
OLLAMA_DEFAULT_NUM_CTX = 4096


@dataclass(frozen=True)
class LlmConfig:
    endpoint: str = "http://localhost:11434/v1"
    model: str = "gpt-oss:20b"
    temperature: float = 0.9
    max_tokens: int = 800
    reasoning_effort: str | None = "low"
    json_mode: bool = False
    timeout_s: float = 90.0
    #: Name of an env var holding a bearer token (hosted endpoints only).
    api_key_env: str | None = None
    #: Extra request-body fields passed through verbatim (with `api: ollama`,
    #: `{"think": false}` switches a thinking model's reasoning off).
    extra: dict[str, Any] = field(default_factory=dict)
    #: `openai` (chat/completions) or `ollama` (native /api/chat).
    api: str = "openai"
    #: Ollama only: how long the model stays loaded after a call (`30m`, `-1`).
    keep_alive: str | None = None
    #: Ollama only: the context window to load the model with (`options.num_ctx`;
    #: `extra: {options: {num_ctx: …}}` wins). None → the server's default
    #: (`OLLAMA_DEFAULT_NUM_CTX`), which silently cuts the middle of a long prompt.
    num_ctx: int | None = None

    @property
    def ollama_base(self) -> str:
        """The server root for the native API (`…/v1` stripped)."""
        base = self.endpoint.rstrip("/")
        return base[: -len("/v1")] if base.endswith("/v1") else base

    @property
    def context_window(self) -> int | None:
        """The context the model really runs with — Ollama only (None for
        `api: openai`, where the server decides and we can't tell)."""
        if self.api != "ollama":
            return None
        options = self.extra.get("options")
        if isinstance(options, dict) and isinstance(options.get("num_ctx"), int) and options["num_ctx"] > 0:
            return int(options["num_ctx"])
        return self.num_ctx or OLLAMA_DEFAULT_NUM_CTX

    @property
    def context_key(self) -> str:
        """The config key `context_window` comes from — the one to raise:
        `extra.options.num_ctx` when it is set (it wins in the request body
        too), else `num_ctx`."""
        options = self.extra.get("options")
        if isinstance(options, dict) and isinstance(options.get("num_ctx"), int) and options["num_ctx"] > 0:
            return "extra.options.num_ctx"
        return "num_ctx"

    def merged(self, overrides: dict[str, Any]) -> "LlmConfig":
        return replace(self, **{k: v for k, v in overrides.items() if k in self.__dataclass_fields__})


def _redacted(text: str, cfg: LlmConfig) -> str:
    """(wave 42b) `text` without the bearer key `cfg.api_key_env` names. A
    hosted endpoint's 401 may echo the key it was sent, and an LlmError's
    text reaches the log, `stagehand ask` and the trace (the Mind page).
    Redacted before any clipping, so no prefix of the key survives."""
    key = anthropic_key(cfg) if cfg.api == "anthropic" else os.environ.get(cfg.api_key_env) if cfg.api_key_env else None
    return text.replace(key, "[key]") if key else text


def anthropic_key(cfg: LlmConfig) -> str:
    """(wave 52) The key for `api: anthropic`: the variable `api_key_env`
    names (else `ANTHROPIC_API_KEY`), else `ANTHROPIC_KEY_FILE`. "" when
    there is none."""
    key = os.environ.get(cfg.api_key_env or ANTHROPIC_KEY_ENV)
    if key:
        return key.strip()
    try:
        return ANTHROPIC_KEY_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def anthropic_request(messages: list[dict[str, str]], cfg: LlmConfig) -> dict[str, Any]:
    """(wave 52) Our chat list as the Messages API's arguments. Pure.

    The system messages before the first turn become `system` blocks, and
    every block but the last gets a cache breakpoint: in the lean layout
    that caches P1 (byte-identical all night) and P2 (the phase's), and
    leaves P3 (this person, this moment) out. Every later system message
    (lookup results, the steer, the closing reminder, a retry's note) goes
    last, as one message: after a user turn that is a mid-conversation
    `system` message, so a guest's line never carries our instructions;
    after an assistant turn (the lookup round's JSON) it has to be a `user`
    turn, because the API neither takes a system message there nor lets a
    prompt end on an assistant turn (a prefill is a 400).

    `temperature` is never sent (Claude Haiku 5.5 answers a 400 to any
    other value), so a ruling's low temperature and a retry's hotter one
    only reach the other engines. `reasoning_effort` is the `effort`.
    Thinking counts against `max_tokens`. An empty turn is a 400: dropped."""
    head: list[str] = []
    turns: list[dict[str, str]] = []
    notes: list[str] = []
    for message in messages:
        role, text = message["role"], str(message.get("content") or "")
        if not text.strip():
            continue
        if role != "system":
            turns.append({"role": role, "content": text})
        elif turns:
            notes.append(text)
        else:
            head.append(text)
    note = "\n\n".join(notes)
    if not turns or turns[0]["role"] != "user":
        turns.insert(0, {"role": "user", "content": WAITING_TURN})
    if turns[-1]["role"] == "assistant":
        turns.append({"role": "user", "content": note or WAITING_TURN})
    elif note:
        turns.append({"role": "system", "content": note})
    body: dict[str, Any] = {"model": cfg.model, "max_tokens": cfg.max_tokens, "messages": turns}
    if head:
        body["system"] = [
            {"type": "text", "text": text, **({"cache_control": {"type": "ephemeral"}} if i < len(head) - 1 else {})}
            for i, text in enumerate(head)
        ]
    if cfg.reasoning_effort:
        body["output_config"] = {"effort": cfg.reasoning_effort}
    if cfg.extra:
        body["extra_body"] = dict(cfg.extra)
    return body


def anthropic_completion(response: Any, cfg: LlmConfig, ms: int) -> Completion:
    """(wave 52) The API's answer as a `Completion`. Pure. Blocks are read by
    their type: an answer may open with `thinking` blocks. A refusal comes
    back as an HTTP 200, so it has to be caught here."""
    stop = str(getattr(response, "stop_reason", "") or "")
    if stop == "refusal":
        details = getattr(response, "stop_details", None)
        raise LlmRefused(f"{cfg.model} declined this prompt ({getattr(details, 'category', None) or 'no category'})")
    blocks = list(getattr(response, "content", None) or [])
    text = "".join(str(b.text) for b in blocks if b.type == "text")
    thinking = "\n\n".join(str(b.thinking).strip() for b in blocks if b.type == "thinking" and b.thinking)
    if not text.strip() and stop == "max_tokens":
        raise LlmTruncated(f"{cfg.model} hit max_tokens={cfg.max_tokens} before answering")
    usage = getattr(response, "usage", None)
    fresh = getattr(usage, "input_tokens", 0) or 0
    read = getattr(usage, "cache_read_input_tokens", 0) or 0
    written = getattr(usage, "cache_creation_input_tokens", 0) or 0
    base = _completion(text, thinking, {"end_turn": "stop", "max_tokens": "length"}.get(stop, stop), fresh + read + written, getattr(usage, "output_tokens", None), ms)
    return replace(base, cached_tokens=read)


#: One client per endpoint + key, for its connection pool: a line must not
#: pay for a TLS handshake.
_anthropic_clients: dict[tuple[str, str], Any] = {}


def _anthropic_client(cfg: LlmConfig) -> Any:
    key = anthropic_key(cfg)
    if not key:
        raise LlmError(f"api: anthropic has no key ({cfg.api_key_env or ANTHROPIC_KEY_ENV}, or {ANTHROPIC_KEY_FILE})")
    client = _anthropic_clients.get((cfg.endpoint, key))
    if client is None:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=key, base_url=cfg.endpoint, max_retries=ANTHROPIC_RETRIES)
        _anthropic_clients[(cfg.endpoint, key)] = client
    return client


async def complete_anthropic(messages: list[dict[str, str]], cfg: LlmConfig, client: Any = None) -> Completion:
    """(wave 52) Claude's Messages API. Everything that goes wrong is an
    `LlmError`, so `engines.EngineCall` fails over as for any engine."""
    try:
        import anthropic
    except ImportError as err:
        raise LlmError("api: anthropic needs the SDK: uv sync --extra anthropic") from err
    started = time.monotonic()
    try:
        call = client or _anthropic_client(cfg)
        response = await call.with_options(timeout=cfg.timeout_s).messages.create(**anthropic_request(messages, cfg))
    except anthropic.APIStatusError as err:
        raise LlmError(f"model endpoint → HTTP {err.status_code}: {_redacted(str(err), cfg)[:200]}") from err
    except anthropic.APIConnectionError as err:
        raise LlmError(_redacted(f"model endpoint {cfg.endpoint} unreachable: {err!r}", cfg)) from err
    return anthropic_completion(response, cfg, int((time.monotonic() - started) * 1000))


async def complete(
    messages: list[dict[str, str]],
    cfg: LlmConfig,
    transport: httpx.AsyncBaseTransport | None = None,
) -> Completion:
    """Ask the model; returns the answer (its text may be empty)."""
    if cfg.api == "ollama":
        return await complete_ollama(messages, cfg, transport)
    if cfg.api == "anthropic":
        return await complete_anthropic(messages, cfg)
    started = time.monotonic()
    body: dict[str, Any] = {
        "model": cfg.model,
        "messages": messages,
        "temperature": cfg.temperature,
        "max_tokens": cfg.max_tokens,
        "stream": False,
    }
    if cfg.reasoning_effort:
        body["reasoning_effort"] = cfg.reasoning_effort
    if cfg.json_mode:
        body["response_format"] = {"type": "json_object"}
    body.update(cfg.extra)
    headers = {"content-type": "application/json"}
    if cfg.api_key_env and os.environ.get(cfg.api_key_env):
        headers["authorization"] = f"Bearer {os.environ[cfg.api_key_env]}"
    url = f"{cfg.endpoint.rstrip('/')}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=cfg.timeout_s, transport=transport) as client:
            r = await client.post(url, json=body, headers=headers)
    except httpx.HTTPError as err:
        raise LlmError(_redacted(f"model endpoint {url} unreachable: {err!r}", cfg)) from err
    if r.status_code != 200:
        raise LlmError(f"model endpoint → HTTP {r.status_code}: {_redacted(r.text, cfg)[:200]}")
    try:
        data = r.json()
        choice = data["choices"][0]
        message = choice["message"]
        content = message.get("content")
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise LlmError(f"unexpected model response: {_redacted(r.text, cfg)[:200]}") from err
    finish = str(choice.get("finish_reason") or "")
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    thinking = _text(message.get("reasoning")) or _text(message.get("reasoning_content"))
    ms = int((time.monotonic() - started) * 1000)
    if not content:
        folded = tool_calls_as_json(message)
        if folded:
            return _completion(folded, thinking, finish or "tool_calls", usage.get("prompt_tokens"), usage.get("completion_tokens"), ms)
    if not content and finish == "length":
        # A reasoning model spent the whole budget thinking: tell the caller
        # so it can retry with room, instead of answering with silence.
        raise LlmTruncated(f"{cfg.model} hit max_tokens={cfg.max_tokens} before answering")
    return _completion(content or "", thinking, finish, usage.get("prompt_tokens"), usage.get("completion_tokens"), ms)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _completion(content: str, thinking: str, finish: str, prompt_tokens: Any, completion_tokens: Any, ms: int, prompt_ns: Any = None) -> Completion:
    base = Completion.of(content)
    return Completion(
        content=base.content,
        thinking=thinking or base.thinking,
        finish=finish,
        prompt_tokens=int(prompt_tokens) if isinstance(prompt_tokens, (int, float)) else None,
        completion_tokens=int(completion_tokens) if isinstance(completion_tokens, (int, float)) else None,
        ms=ms,
        prompt_ms=int(prompt_ns / 1e6) if isinstance(prompt_ns, (int, float)) and not isinstance(prompt_ns, bool) and prompt_ns >= 0 else None,
    )


async def complete_ollama(
    messages: list[dict[str, str]],
    cfg: LlmConfig,
    transport: httpx.AsyncBaseTransport | None = None,
) -> Completion:
    """Ollama's native `/api/chat`: `think` and `keep_alive` are honoured here."""
    started = time.monotonic()
    options: dict[str, Any] = {"temperature": cfg.temperature, "num_predict": cfg.max_tokens}
    if cfg.num_ctx:
        options["num_ctx"] = cfg.num_ctx
    body: dict[str, Any] = {"model": cfg.model, "messages": messages, "stream": False, "options": options}
    if cfg.json_mode:
        body["format"] = "json"
    if cfg.keep_alive:
        body["keep_alive"] = cfg.keep_alive
    extra = dict(cfg.extra)
    if "options" in extra and isinstance(extra["options"], dict):
        options.update(extra.pop("options"))
    body.update(extra)
    if cfg.reasoning_effort and "think" not in body:
        # gpt-oss on Ollama takes the effort word as `think`; other models take a bool.
        body["think"] = cfg.reasoning_effort if cfg.model.startswith("gpt-oss") else True
    headers = {"content-type": "application/json"}
    if cfg.api_key_env and os.environ.get(cfg.api_key_env):
        headers["authorization"] = f"Bearer {os.environ[cfg.api_key_env]}"
    url = f"{cfg.ollama_base}/api/chat"
    try:
        async with httpx.AsyncClient(timeout=cfg.timeout_s, transport=transport) as client:
            r = await client.post(url, json=body, headers=headers)
    except httpx.HTTPError as err:
        raise LlmError(_redacted(f"model endpoint {url} unreachable: {err!r}", cfg)) from err
    if r.status_code != 200:
        raise LlmError(f"model endpoint → HTTP {r.status_code}: {_redacted(r.text, cfg)[:200]}")
    try:
        data = r.json()
        message = data["message"]
        content = message.get("content")
    except (ValueError, KeyError, TypeError) as err:
        raise LlmError(f"unexpected model response: {_redacted(r.text, cfg)[:200]}") from err
    finish = str(data.get("done_reason") or "")
    thinking = _text(message.get("thinking"))
    ms = int((time.monotonic() - started) * 1000)
    if not content:
        folded = tool_calls_as_json(message)
        if folded:
            return _completion(folded, thinking, finish or "tool_calls", data.get("prompt_eval_count"), data.get("eval_count"), ms, data.get("prompt_eval_duration"))
    if not content and finish == "length":
        raise LlmTruncated(f"{cfg.model} hit num_predict={cfg.max_tokens} before answering")
    return _completion(content or "", thinking, finish, data.get("prompt_eval_count"), data.get("eval_count"), ms, data.get("prompt_eval_duration"))
