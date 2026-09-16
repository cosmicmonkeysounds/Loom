"""The model call — one OpenAI-compatible `chat/completions` request.

Ollama (`ollama serve`, default `http://localhost:11434/v1`), llama.cpp's
server, LM Studio and vLLM all speak this shape, so a local model needs
no SDK. Notes for reasoning models like `gpt-oss:20b`:

  - `reasoning_effort: low` keeps latency sane (seconds, not tens);
  - reasoning tokens count against `max_tokens`, so give it room
    (~800) or the answer is cut off before it starts;
  - JSON mode (`response_format`) is off by default — the reply parser
    copes with prose, and forcing a grammar can fight the model's own
    output format.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Any

import httpx


class LlmError(RuntimeError):
    pass


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

    def merged(self, overrides: dict[str, Any]) -> "LlmConfig":
        return replace(self, **{k: v for k, v in overrides.items() if k in self.__dataclass_fields__})


async def complete(
    messages: list[dict[str, str]],
    cfg: LlmConfig,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    """Ask the model; returns the assistant text (may be empty)."""
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
        content = data["choices"][0]["message"].get("content")
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise LlmError(f"unexpected model response: {r.text[:200]}") from err
    return content or ""
