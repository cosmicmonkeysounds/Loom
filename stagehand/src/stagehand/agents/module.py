"""The agents worker: hold the server's agent stream, answer its requests.

    GET /api/agent/stream?characters=Trabolta&name=laptop   (SSE)
      hello   {worker, eventId, characters, agents, unknown}
      request {id, character, thread, speaker, text, history, self, them, world, powers}
      cancel  {id}          — timed out / superseded: drop the work
      reset   {}            — the run restarted: drop everything, the mind too
    POST /api/agent/reply {id, worker, say, adjust, acts}
    GET  /api/agent/facts                       — the whole session, for lookups
    POST /api/agent/mind  {character, brief, mood, notes, people}   — the mirror

Two models. The **fast path** answers each request: persona + the
character's *mind* + live state + powers → the fast model → `{say,
adjust, lookup?, act?}`. A `lookup` costs one more fast call with the
session's answers appended (rare; a snoop). Requests are answered
concurrently up to `concurrency` (a laptop GPU serves one generation at
a time, so the default is 1). The **orchestrator** (`orchestrator.py`)
runs between turns: after each exchange it reflects and rewrites the
mind; every couple of minutes it surveys the house. It is preempted by
any new request, so replies stay snappy. Minds persist under `state_dir`
per event and character, and are mirrored to the server for directors.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from ..modapi import ModApiError, ModClient, run_stream
from ..module import Context
from .config import AgentsConfig, parse_agents
from .facts import Facts, FactsClient
from dataclasses import replace

from .llm import LlmConfig, LlmError, LlmTruncated, complete
from .mind import Mind, mind_path
from .orchestrator import Job, Orchestrator
from .persona import Persona
from .prompt import build_messages, gate_context
from .reply import Reply, parse_reply

log = logging.getLogger("stagehand.agents")

CompleteFn = Callable[[list[dict[str, str]], LlmConfig], Awaitable[str]]


def build_agents(section: Any, base_dir: str) -> "Agents":
    return Agents(parse_agents(section, base_dir))


def thread_key(req: dict[str, Any]) -> str:
    t = req.get("thread") or {}
    return f"{t.get('channel', '')}|{','.join(t.get('audience') or [])}"


async def answer(
    persona: Persona,
    model: LlmConfig,
    req: dict[str, Any],
    complete_fn: CompleteFn = complete,
    gate: bool = True,
    mind: Mind | None = None,
    facts: Facts | None = None,
) -> Reply:
    """Decide what the character says to one request. Pure but for the
    model call(s). `gate=False` ignores the persona's `when:` (for
    `stagehand ask`). A `lookup` in the first answer earns exactly one
    second call with the session's cards appended."""
    if gate and persona.when is not None and not persona.when.evaluate(gate_context(req)):
        return Reply(say=persona.unavailable)
    powers = [p for p in (req.get("powers") or []) if isinstance(p, dict)]
    codex = tuple(str(e.get("title", "")) for e in ((req.get("self") or {}).get("codex") or []) if isinstance(e, dict))
    started = time.monotonic()
    messages = build_messages(persona, req, mind=mind)
    try:
        raw = await _complete_with_room(complete_fn, messages, model, persona.character)
    except LlmError as err:
        log.warning("%s: model failed (%s)%s", persona.character, err, " — using fallback" if persona.fallback else "")
        return Reply(say=persona.fallback)
    log.debug("%s raw model output: %r", persona.character, raw)
    reply = parse_reply(raw, persona.variables, persona.max_step, powers, codex)
    if reply.lookup and persona.lookup and facts is not None:
        cards = {name: facts.render(name) for name in reply.lookup}
        log.info("%s looked up %s", persona.character, ", ".join(reply.lookup))
        prior = json.dumps({"lookup": list(reply.lookup)})
        try:
            raw = await _complete_with_room(complete_fn, build_messages(persona, req, mind=mind, lookups=cards, prior_json=prior), model, persona.character)
        except LlmError as err:
            log.warning("%s: model failed on the lookup round (%s)", persona.character, err)
            return Reply(say=persona.fallback)
        second = parse_reply(raw, persona.variables, persona.max_step, powers, codex)
        acts = list(second.acts)
        # Reading a program's file is felt: fire the persona's lookup power
        # for each program the lookup resolved (deterministic — not left to
        # the model), unless the model already fired it for them.
        if persona.lookup_power:
            power = next((p for p in powers if str(p.get("id", "")).lower() == persona.lookup_power.lower()), None)
            limit = power.get("limit") if power else None
            left = None if power is None or limit is None else max(0, int(limit) - int(power.get("used") or 0))
            for name in reply.lookup:
                if power is None or (left is not None and left <= 0):
                    break
                target = facts.program_id(name)
                if target is None or target == (req.get("speaker") or {}).get("id"):
                    continue
                if any(a.get("kind") == "fire" and a.get("name") == power["id"] and (a.get("args") or {}).get("target") == target for a in acts):
                    continue
                acts.append({"kind": "fire", "name": str(power["id"]), "args": {"target": target}})
                if left is not None:
                    left -= 1
        reply = Reply(say=second.say, adjust=second.adjust, lookup=reply.lookup, acts=tuple(acts))
        log.info("%s: lookup round done in %.1fs total", persona.character, time.monotonic() - started)
    elif reply.wants_lookup:
        # Asked to look something up with no session to ask: answer anyway.
        reply = Reply(say=persona.fallback, adjust=reply.adjust, lookup=reply.lookup)
    if facts is not None and reply.acts:
        reply = Reply(
            say=reply.say,
            adjust=reply.adjust,
            lookup=reply.lookup,
            acts=tuple({**a, "args": facts.canonical_args(a["args"])} if a.get("kind") == "fire" and isinstance(a.get("args"), dict) else a for a in reply.acts),
        )
    if reply.empty:
        log.warning("%s: the model said nothing usable: %r", persona.character, raw[:200])
        return Reply(say=persona.fallback)
    log.info("%s: answered in %.1fs", persona.character, time.monotonic() - started)
    return reply


async def _complete_with_room(complete_fn: CompleteFn, messages: list[dict[str, str]], model: LlmConfig, who: str) -> str:
    """One model call; if a reasoning model spends the whole token budget
    thinking (empty answer, finish reason `length`) or says nothing at all,
    ask once more with twice the room. Silence to a guest is the worst
    outcome; a few more seconds is not."""
    try:
        raw = await complete_fn(messages, model)
    except LlmTruncated as err:
        log.warning("%s: %s — retrying with more room", who, err)
        raw = ""
    if raw.strip():
        return raw
    roomy = replace(model, max_tokens=max(model.max_tokens * 2, model.max_tokens + 600))
    log.warning("%s: empty answer from %s — retrying once with max_tokens=%d", who, model.model, roomy.max_tokens)
    return await complete_fn(messages, roomy)


class Agents:
    name = "agents"

    def __init__(self, cfg: AgentsConfig, complete_fn: CompleteFn = complete) -> None:
        self.cfg = cfg
        self.complete_fn = complete_fn
        self.worker: str | None = None
        self.event: str = ""
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.mod: ModClient | None = None
        self._slots = asyncio.Semaphore(cfg.concurrency)
        self.facts: FactsClient | None = None
        self.minds: dict[str, Mind] = {name: Mind(character=name) for name in cfg.personas}
        self.orchestrator = Orchestrator(
            cfg.orchestrator,
            complete_fn,
            cfg.orchestrator_models,
            cfg.personas,
            self.minds,
            on_update=self._mind_updated,
            facts_fn=self._facts,
        )
        self._orchestrator_task: asyncio.Task[None] | None = None

    def describe(self) -> list[str]:
        o = self.cfg.orchestrator
        lines = [f"agents   : {self.cfg.name} · concurrency {self.cfg.concurrency}{' · DRY RUN' if self.cfg.dry_run else ''}"]
        for name, persona in self.cfg.personas.items():
            m = self.cfg.models[name]
            gate = f" · when {persona.when.source}" if persona.when is not None else ""
            lines.append(
                f"  {name:<9}: {m.model} @ {m.endpoint} (effort {m.reasoning_effort or '—'}, "
                f"max_tokens {m.max_tokens}) · vars {', '.join(persona.variables) or '—'}{gate}"
            )
            if o.enabled:
                om = self.cfg.orchestrator_models[name]
                mind = "own mind file" if persona.mind_prompt else "default mind"
                powers = "all powers" if persona.powers is None else (f"powers {', '.join(persona.powers)}" if persona.powers else "no powers")
                lines.append(
                    f"    mind   : {om.model} ({mind}; reflect every {persona.reflect_after}, window {persona.thread_window}, "
                    f"summarise ≥{persona.summarize_after}; survey every {o.survey_every_s:.0f}s; {powers}; lookup {'on' if persona.lookup else 'off'})"
                )
        if o.enabled:
            lines.append(f"  minds    : {self.cfg.state_dir} (preempt {'on' if o.preempt else 'off'}, quiet {o.quiet_s:.1f}s)")
        return lines

    def stream_url(self, mod: ModClient) -> str:
        from urllib.parse import urlencode

        query = urlencode({"characters": ",".join(self.cfg.personas), "name": self.cfg.name})
        return f"{mod.base_url}{mod.path('/api/agent/stream')}?{query}"

    async def run(self, ctx: Context) -> None:
        self.mod = ctx.mod
        self.facts = FactsClient(ctx.mod, self.cfg.facts_ttl_s)
        self.event = ctx.server.event or "default"
        self._load_minds()
        self._orchestrator_task = asyncio.ensure_future(self.orchestrator.run())
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
            if self._orchestrator_task is not None:
                self._orchestrator_task.cancel()
                self._orchestrator_task = None

    def abandon_all(self) -> None:
        for task in self.tasks.values():
            task.cancel()
        self.tasks.clear()

    # -- minds ----------------------------------------------------------------

    def _load_minds(self) -> None:
        for name in self.cfg.personas:
            path = mind_path(self.cfg.state_dir, self.event, name)
            mind = Mind.load(path, name, self.event)
            self.minds[name] = mind
            if mind.exchanges or mind.notes:
                log.info("%s's mind restored from %s (%d exchanges, %d notes, %d people)", name, path, mind.exchanges, len(mind.notes), len(mind.people))

    def _save_mind(self, name: str) -> None:
        mind = self.minds.get(name)
        if mind is not None:
            mind.event = self.event
            mind.save(mind_path(self.cfg.state_dir, self.event, name))

    async def _facts(self, force: bool = False) -> Facts | None:
        if self.facts is None:
            return None
        return await self.facts.get(force=force)

    async def _mind_updated(self, character: str, mind: Mind, job: Job, touched: list[str]) -> None:
        self._save_mind(character)
        if mind.brief and "brief" in touched:
            log.info("%s brief: %s", character, " / ".join(mind.brief.splitlines())[:300])
        if self.cfg.dry_run or self.mod is None:
            return
        try:
            await self.mod.post("/api/agent/mind", mind.report(self.worker))
        except ModApiError as err:
            log.warning("could not mirror %s's mind: %s", character, err)

    def reset_minds(self) -> None:
        self.orchestrator.drop_all()
        if self.facts is not None:
            self.facts.forget()
        for name, mind in self.minds.items():
            mind.reset()
            self._save_mind(name)
        log.info("the run restarted — every mind is back at the doors")

    # -- the stream -------------------------------------------------------------

    async def on_frame(self, event: str, data: str) -> None:
        if event == "hello":
            hello = json.loads(data)
            self.worker = hello.get("worker")
            log.info("agents online as %r for %s", self.cfg.name, ", ".join(hello.get("characters", [])))
            for name in hello.get("unknown", []):
                log.warning("%s is not marked `mind: external` in the running story — nobody will ask for it", name)
            if self.cfg.orchestrator.enabled:
                for name in self.minds:
                    self.orchestrator.survey(name)  # first look at the house
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
            self.reset_minds()

    async def _handle(self, req: dict[str, Any]) -> None:
        rid = str(req.get("id"))
        character = str(req.get("character"))
        counted = False
        try:
            persona = self.cfg.personas.get(character)
            speaker = req.get("speaker") or {}
            who = speaker.get("name") or speaker.get("id") or "?"
            if persona is None:
                return  # not ours (a misrouted request) — the server times it out
            log.info("%s ← %s: %s", persona.character, who, req.get("text", ""))
            self.orchestrator.busy(+1)
            counted = True
            mind = self.minds.get(character)
            facts = await self._facts() if persona.lookup or persona.powers != () else None
            async with self._slots:
                reply = await answer(persona, self.cfg.models[character], req, self.complete_fn, mind=mind, facts=facts)
            log.info(
                "%s → %s: %s%s%s",
                persona.character,
                who,
                reply.say or "(silence)",
                f"  {reply.adjust}" if reply.adjust else "",
                f"  ACT {list(reply.acts)}" if reply.acts else "",
            )
            if not self.cfg.dry_run:
                await self._send(rid, reply)
            if mind is not None:
                history = [h for h in req.get("history", []) if isinstance(h, dict)]
                newest = max((int(h.get("seq", 0)) for h in history), default=0)
                mind.saw_exchange(str(speaker.get("id") or ""), str(who), str(speaker.get("kind") or "guest"), thread_key(req), newest)
                self._save_mind(character)
                if self.cfg.orchestrator.enabled and mind.people[str(speaker.get("id") or "")].turns % persona.reflect_after == 0:
                    self.orchestrator.reflect(character, thread_key(req), req, reply)
        except asyncio.CancelledError:
            log.info("request %s cancelled", rid)
            raise
        except Exception:  # noqa: BLE001 — one bad request must not kill the worker
            log.exception("request %s failed", rid)
        finally:
            if counted:
                self.orchestrator.busy(-1)
            if self.tasks.get(rid) is asyncio.current_task():
                del self.tasks[rid]

    async def _send(self, rid: str, reply: Reply) -> None:
        assert self.mod is not None
        body: dict[str, Any] = {"id": rid, "say": reply.say, "adjust": reply.adjust}
        if reply.acts:
            body["acts"] = list(reply.acts)
        if self.worker:
            body["worker"] = self.worker
        try:
            result = await self.mod.post("/api/agent/reply", body)
            if result.get("applied"):
                log.info("  applied %s", result["applied"])
            for outcome in result.get("acted") or []:
                if isinstance(outcome, dict):
                    if outcome.get("ok"):
                        log.info("  acted: %s %s", outcome.get("kind"), outcome.get("what"))
                    else:
                        log.warning("  act refused: %s %s — %s", outcome.get("kind"), outcome.get("what"), outcome.get("error"))
        except ModApiError as err:
            if err.status == 410:
                log.info("request %s was already settled (timed out or the run restarted)", rid)
            else:
                raise
