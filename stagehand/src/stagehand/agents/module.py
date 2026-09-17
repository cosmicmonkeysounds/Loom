"""The agents worker: hold the server's agent stream, answer its requests.

    GET /api/agent/stream?characters=Trabolta&name=laptop   (SSE)
      hello   {worker, characters, agents, unknown}
      request {id, character, thread, speaker, text, history, self, them, world}
      cancel  {id}          — timed out / superseded: drop the work
      reset   {}            — the run restarted: drop everything
    POST /api/agent/reply {id, worker, say, adjust}

Requests are answered concurrently up to `concurrency` (a laptop GPU
serves one generation at a time, so the default is 1 and the rest wait
their turn). The server keeps one open request per thread and re-asks
after a reply if more was said meanwhile, so the worker never has to
coalesce. When the stream drops, in-flight work is abandoned — the
server hands it out again on reconnect.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from ..modapi import ModApiError, ModClient, run_stream
from ..module import Context
from .config import AgentsConfig, parse_agents
from .llm import LlmConfig, LlmError, complete
from .persona import Persona
from .prompt import build_messages, gate_context
from .reply import Reply, parse_reply

log = logging.getLogger("stagehand.agents")

CompleteFn = Callable[[list[dict[str, str]], LlmConfig], Awaitable[str]]


def build_agents(section: Any, base_dir: str) -> "Agents":
    return Agents(parse_agents(section, base_dir))


async def answer(
    persona: Persona,
    model: LlmConfig,
    req: dict[str, Any],
    complete_fn: CompleteFn = complete,
    gate: bool = True,
) -> Reply:
    """Decide what the character says to one request. Pure but for the model
    call. `gate=False` ignores the persona's `when:` (for `stagehand ask`)."""
    if gate and persona.when is not None and not persona.when.evaluate(gate_context(req)):
        return Reply(say=persona.unavailable)
    try:
        raw = await complete_fn(build_messages(persona, req), model)
    except LlmError as err:
        log.warning("%s: model failed (%s)%s", persona.character, err, " — using fallback" if persona.fallback else "")
        return Reply(say=persona.fallback)
    log.debug("%s raw model output: %r", persona.character, raw)
    reply = parse_reply(raw, persona.variables, persona.max_step)
    if reply.empty:
        log.warning("%s: the model said nothing usable: %r", persona.character, raw[:200])
        return Reply(say=persona.fallback)
    return reply


class Agents:
    name = "agents"

    def __init__(self, cfg: AgentsConfig, complete_fn: CompleteFn = complete) -> None:
        self.cfg = cfg
        self.complete_fn = complete_fn
        self.worker: str | None = None
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.mod: ModClient | None = None
        self._slots = asyncio.Semaphore(cfg.concurrency)

    def describe(self) -> list[str]:
        lines = [f"agents   : {self.cfg.name} · concurrency {self.cfg.concurrency}{' · DRY RUN' if self.cfg.dry_run else ''}"]
        for name, persona in self.cfg.personas.items():
            m = self.cfg.models[name]
            gate = f" · when {persona.when.source}" if persona.when is not None else ""
            lines.append(
                f"  {name:<9}: {m.model} @ {m.endpoint} (effort {m.reasoning_effort or '—'}, "
                f"max_tokens {m.max_tokens}) · vars {', '.join(persona.variables) or '—'}{gate}"
            )
        return lines

    def stream_url(self, mod: ModClient) -> str:
        from urllib.parse import urlencode

        query = urlencode({"characters": ",".join(self.cfg.personas), "name": self.cfg.name})
        return f"{mod.base_url}{mod.path('/api/agent/stream')}?{query}"

    async def run(self, ctx: Context) -> None:
        self.mod = ctx.mod
        try:
            await run_stream(
                ctx.mod,
                self.stream_url(ctx.mod),
                self.on_frame,
                label="agents",
                on_connect=self.abandon_all,  # anything in flight belonged to the old stream
            )
        finally:
            self.abandon_all()

    def abandon_all(self) -> None:
        for task in self.tasks.values():
            task.cancel()
        self.tasks.clear()

    async def on_frame(self, event: str, data: str) -> None:
        if event == "hello":
            hello = json.loads(data)
            self.worker = hello.get("worker")
            log.info("agents online as %r for %s", self.cfg.name, ", ".join(hello.get("characters", [])))
            for name in hello.get("unknown", []):
                log.warning("%s is not marked `mind: external` in the running story — nobody will ask for it", name)
        elif event == "request":
            req = json.loads(data)
            rid = str(req.get("id"))
            if rid in self.tasks:
                return
            self.tasks[rid] = asyncio.ensure_future(self._handle(req))
        elif event == "cancel":
            task = self.tasks.pop(str(json.loads(data).get("id")), None)
            if task is not None:
                task.cancel()
        elif event == "reset":
            self.abandon_all()

    async def _handle(self, req: dict[str, Any]) -> None:
        rid = str(req.get("id"))
        try:
            persona = self.cfg.personas.get(str(req.get("character")))
            speaker = req.get("speaker") or {}
            who = speaker.get("name") or speaker.get("id") or "?"
            if persona is None:
                return  # not ours (a misrouted request) — the server times it out
            log.info("%s ← %s: %s", persona.character, who, req.get("text", ""))
            async with self._slots:
                reply = await answer(persona, self.cfg.models[persona.character], req, self.complete_fn)
            log.info(
                "%s → %s: %s%s",
                persona.character,
                who,
                reply.say or "(silence)",
                f"  {reply.adjust}" if reply.adjust else "",
            )
            if self.cfg.dry_run:
                return
            await self._send(rid, reply)
        except asyncio.CancelledError:
            log.info("request %s cancelled", rid)
            raise
        except Exception:  # noqa: BLE001 — one bad request must not kill the worker
            log.exception("request %s failed", rid)
        finally:
            if self.tasks.get(rid) is asyncio.current_task():
                del self.tasks[rid]

    async def _send(self, rid: str, reply: Reply) -> None:
        assert self.mod is not None
        body: dict[str, Any] = {"id": rid, "say": reply.say, "adjust": reply.adjust}
        if self.worker:
            body["worker"] = self.worker
        try:
            result = await self.mod.post("/api/agent/reply", body)
            if result.get("applied"):
                log.info("  applied %s", result["applied"])
        except ModApiError as err:
            if err.status == 410:
                log.info("request %s was already settled (timed out or the run restarted)", rid)
            else:
                raise
