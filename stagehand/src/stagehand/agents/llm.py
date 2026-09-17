"""The model call — one chat request, in one of two dialects.

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
from dataclasses import dataclass, field, replace
from typing import Any

import httpx


class LlmError(RuntimeError):
    pass


class LlmTruncated(LlmError):
    """The model produced no answer because `max_tokens` ran out (reasoning)."""


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

    @property
    def ollama_base(self) -> str:
        """The server root for the native API (`…/v1` stripped)."""
        base = self.endpoint.rstrip("/")
        return base[: -len("/v1")] if base.endswith("/v1") else base

    def merged(self, overrides: dict[str, Any]) -> "LlmConfig":
        return replace(self, **{k: v for k, v in overrides.items() if k in self.__dataclass_fields__})


async def complete(
    messages: list[dict[str, str]],
    cfg: LlmConfig,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """Ask the model; returns the assistant text (may be empty)."""
    if cfg.api == "ollama":
        return await complete_ollama(messages, cfg, transport)
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
        raise LlmError(f"model endpoint {url} unreachable: {err!r}") from err
    if r.status_code != 200:
        raise LlmError(f"model endpoint → HTTP {r.status_code}: {r.text[:200]}")
    try:
        data = r.json()
        choice = data["choices"][0]
        content = choice["message"].get("content")
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise LlmError(f"unexpected model response: {r.text[:200]}") from err
    if not content:
        folded = tool_calls_as_json(choice["message"])
        if folded:
            return folded
    if not content and choice.get("finish_reason") == "length":
        # A reasoning model spent the whole budget thinking: tell the caller
        # so it can retry with room, instead of answering with silence.
        raise LlmTruncated(f"{cfg.model} hit max_tokens={cfg.max_tokens} before answering")
    return content or ""


async def complete_ollama(
    messages: list[dict[str, str]],
    cfg: LlmConfig,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """Ollama's native `/api/chat`: `think` and `keep_alive` are honoured here."""
    options: dict[str, Any] = {"temperature": cfg.temperature, "num_predict": cfg.max_tokens}
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
        raise LlmError(f"model endpoint {url} unreachable: {err!r}") from err
    if r.status_code != 200:
        raise LlmError(f"model endpoint → HTTP {r.status_code}: {r.text[:200]}")
    try:
        data = r.json()
        content = data["message"].get("content")
    except (ValueError, KeyError, TypeError) as err:
        raise LlmError(f"unexpected model response: {r.text[:200]}") from err
    if not content:
        folded = tool_calls_as_json(data["message"])
        if folded:
            return folded
    if not content and data.get("done_reason") == "length":
        raise LlmTruncated(f"{cfg.model} hit num_predict={cfg.max_tokens} before answering")
    return content or ""
