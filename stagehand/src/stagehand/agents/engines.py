"""More compute for one mind: overflow engines (wave 42b).

One worker, one mind, several model servers. `agents.llm` is the
**primary** engine (`concurrency` slots); each `agents.overflow` entry is
another (its `capacity` slots): a second Ollama on the LAN, or a hosted
OpenAI-compatible endpoint. The worker announces the sum as its stream's
capacity, so the server hands it that many lines at once, and every line
still reads and writes the same mind (memos, said lines, the brief): only
the generation moves.

`Engines.call(lane, …)` takes a slot (`slots.py`: the primary when one is
free, else the first listed overflow engine with one free) and yields an
`EngineCall`. Its `bind(base, shape)` is the model to hand the voice — the
character's voice model on that engine, then `shape` (a ruling's low
temperature, a letter's room) — and its `complete` is the `complete_fn`
to hand it. That function:

  - sends each call to the engine the slot is on. The voice changes the
    model per call (the warm head's one token, a retry's temperature, the
    room after an empty answer); those changes are carried over onto
    whichever engine serves the call;
  - skips a warm head (`llm.WARM_TOKENS`) on an engine that is not
    `api: ollama` (only Ollama keeps the cache checkpoint it exists for),
    so the warm head always runs against the engine of the main call;
  - on an `LlmError` that is not a truncation (unreachable, a non-200, a
    timeout, a garbled answer) marks the engine down for 30 s
    (`Slots.mark_down`: its slots are skipped) and retries the call
    **once** on another engine that is up, taking a free slot there or
    waiting for one at the front of its lane. A second failure raises,
    and the voice says the persona's fallback. A refusal (`LlmRefused`,
    wave 52) is about this prompt, not the engine: the same retry, but
    the engine stays up for every other line;
  - records the engine and the model it went out as (`llm.SERVED_BY`,
    `SERVED_MODEL`) so the thought says who served it.

`primary_only=True` (a quiet summary, a letter, a director's Rewrite or
re-run) keeps a call on the primary: no other engine, no retry elsewhere.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import fields, replace
from typing import Any

from .config import AgentsConfig, OverflowEngine
from .llm import SERVED_BY, SERVED_MODEL, WARM_TOKENS, Completion, LlmConfig, LlmError, LlmRefused, LlmTruncated
from .slots import NORMAL, PRIMARY, Hold, Slots

log = logging.getLogger("stagehand.agents.engines")

CompleteFn = Callable[[list[dict[str, str]], LlmConfig], Awaitable[Any]]
Shape = Callable[[LlmConfig], LlmConfig]
_FIELDS = tuple(f.name for f in fields(LlmConfig))


def _same(cfg: LlmConfig) -> LlmConfig:
    return cfg


class Engines:
    """The engines and their slots (one `Slots` for all of them)."""

    def __init__(self, cfg: AgentsConfig, complete_fn: CompleteFn, slots: Slots | None = None) -> None:
        self.overflow: dict[str, OverflowEngine] = {e.name: e for e in cfg.overflow}
        self.complete_fn = complete_fn
        self.slots = slots or Slots(engines=cfg.engines)

    @property
    def names(self) -> tuple[str, ...]:
        return self.slots.names

    def model(self, engine: str, base: LlmConfig) -> LlmConfig:
        """A character's voice model (`base`, the primary's) on `engine`."""
        e = self.overflow.get(engine)
        return base if e is None else e.model(base)

    @asynccontextmanager
    async def call(self, lane: int = NORMAL, *, primary_only: bool = False, who: str = "") -> AsyncIterator["EngineCall"]:
        async with self.slots.lane(lane, only=(PRIMARY,) if primary_only else None) as hold:
            yield EngineCall(self, hold, primary_only=primary_only, who=who)


class EngineCall:
    """One slot's worth of model calls (a line with its warm head, its
    lookup round and its retry; a ruling; a summary) — see the module
    docstring."""

    def __init__(self, engines: Engines, hold: Hold, *, primary_only: bool = False, who: str = "") -> None:
        self.engines = engines
        self.hold = hold
        self.primary_only = primary_only
        self.who = who
        self.retried = False
        self._base: LlmConfig | None = None
        self._shape: Shape = _same
        self._given: LlmConfig | None = None
        self._given_on: str | None = None

    @property
    def engine(self) -> str:
        """The engine this call's slot is on now."""
        return self.hold.engine or PRIMARY

    def bind(self, base: LlmConfig, shape: Shape | None = None) -> LlmConfig:
        """The model to hand the voice (or `_complete_with_room`): `base`
        on this slot's engine, then `shape`."""
        self._base, self._shape = base, shape or _same
        self._given_on = self.engine
        self._given = self._shape(self.engines.model(self._given_on, base))
        return self._given

    def model_now(self) -> LlmConfig | None:
        """The bound model as the engine the slot is on now has it (after a
        switch: the other engine's), for the trace."""
        if self._base is None:
            return None
        return self._shape(self.engines.model(self.engine, self._base))

    def _rebased(self, cfg: LlmConfig) -> LlmConfig:
        """`cfg` (the bound model, maybe changed by the caller) for the
        engine the slot is on now."""
        if self._given is None or self._base is None or self.engine == self._given_on:
            return cfg
        changes = {k: getattr(cfg, k) for k in _FIELDS if getattr(cfg, k) != getattr(self._given, k)}
        target = self._shape(self.engines.model(self.engine, self._base))
        return replace(target, **changes) if changes else target

    async def complete(self, messages: list[dict[str, str]], cfg: LlmConfig) -> Any:
        """The `complete_fn` to hand the voice (module docstring)."""
        while True:
            engine = self.engine
            call_cfg = self._rebased(cfg)
            SERVED_BY.set(engine)
            SERVED_MODEL.set(call_cfg)
            if cfg.max_tokens == WARM_TOKENS and call_cfg.api != "ollama":
                return Completion(content="")  # no warm head off Ollama (after a switch to an openai engine)
            try:
                return await self.engines.complete_fn(messages, call_cfg)
            except LlmTruncated:
                raise  # the model answered; the budget ran out — not the engine's fault
            except LlmError as err:
                outcome = "stays up"
                if not isinstance(err, LlmRefused):
                    self.engines.slots.mark_down(engine)
                    outcome = f"marked down {self.engines.slots.down_s:.0f} s"
                if self.primary_only or self.retried or not self.engines.slots.up(exclude=(engine,)):
                    log.warning("%s: engine %s failed (%s); %s", self.who or "a call", engine, err, outcome)
                    raise
                self.retried = True
                log.warning("%s: engine %s failed (%s); %s, retrying once on another engine", self.who or "a call", engine, err, outcome)
                try:
                    await self.engines.slots.switch(self.hold, exclude=(engine,))
                except LookupError:
                    raise err from None
