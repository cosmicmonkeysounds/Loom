"""The agents worker: hold the server's agent stream, answer its requests.

    GET /api/agent/stream?characters=Trabolta&name=laptop   (SSE)
      hello   {worker, eventId, characters, agents, unknown}
      request {id, character, thread, speaker, text, history, self, them, world, powers}
      cancel  {id}          — timed out / superseded: drop the work
      control {action, character?, by, …}
              — the control panel (and the server itself on a restart):
                reset · survey · nudge · set · forget · thinking · effort ·
                pause · rerun — see `Agents.control`
    POST /api/agent/reply {id, worker, say, adjust, acts}
    GET  /api/agent/facts                       — the whole session, for lookups
    POST /api/agent/mind  {character, …the whole mind…, status}   — the mirror
    POST /api/agent/trace {thoughts: [Thought…]}                  — the debugger's feed

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

Every model call — voice, lookup, reflect, survey, re-run — is recorded
as a `Thought` (`trace.py`): the exact messages sent, the model's
reasoning when it exposes it, the raw output, timings, what was parsed,
and the mind diff it caused. Thoughts append to a `.trace.jsonl` beside
the mind file and stream to the server, which is what the editor's Mind
page draws.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import replace
from typing import Any

from ..modapi import ModApiError, ModClient, run_stream
from ..module import Context
from .config import AgentsConfig, parse_agents
from .facts import Facts, FactsClient
from .llm import Completion, LlmConfig, LlmError, LlmTruncated, complete
from .mind import Mind, mind_path
from .orchestrator import Job, Orchestrator
from .persona import Persona
from .prompt import build_messages, gate_context
from .reply import Reply, parse_reply
from .trace import Thought, Trace, new_thought

log = logging.getLogger("stagehand.agents")

CompleteFn = Callable[[list[dict[str, str]], LlmConfig], Awaitable[Any]]

CONTROL_ACTIONS = ("reset", "survey", "nudge", "set", "forget", "thinking", "effort", "pause", "rerun")
EFFORTS = ("none", "low", "medium", "high")


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
    trace: Trace | None = None,
) -> Reply:
    """Decide what the character says to one request. Pure but for the
    model call(s). `gate=False` ignores the persona's `when:` (for
    `stagehand ask`). A `lookup` in the first answer earns exactly one
    second call with the session's cards appended. With a `trace`, each
    model call is recorded as a thought."""
    if gate and persona.when is not None and not persona.when.evaluate(gate_context(req)):
        return Reply(say=persona.unavailable)
    powers = [p for p in (req.get("powers") or []) if isinstance(p, dict)]
    codex = tuple(str(e.get("title", "")) for e in ((req.get("self") or {}).get("codex") or []) if isinstance(e, dict))
    started = time.monotonic()
    messages = build_messages(persona, req, mind=mind)

    async def record(kind: str, msgs: list[dict[str, str]], completion: Completion | None, reply: Reply | None, error: str | None = None, note: str = "") -> None:
        if trace is None:
            return
        result = None if reply is None else {"say": reply.say, "adjust": dict(reply.adjust), "lookup": list(reply.lookup), "acts": [dict(a) for a in reply.acts]}
        await trace.record(new_thought(persona.character, kind, trigger="line" if kind == "voice" else "lookup", model=model, messages=msgs, completion=completion, request=req, result=result, error=error, note=note))

    try:
        completion, note = await _complete_with_room(complete_fn, messages, model, persona.character)
    except LlmError as err:
        log.warning("%s: model failed (%s)%s", persona.character, err, " — using fallback" if persona.fallback else "")
        await record("voice", messages, None, None, error=str(err))
        return Reply(say=persona.fallback)
    raw = completion.content
    log.debug("%s raw model output: %r", persona.character, raw)
    reply = parse_reply(raw, persona.variables, persona.max_step, powers, codex)
    await record("voice", messages, completion, reply, note=note)
    if reply.lookup and persona.lookup and facts is not None:
        cards = {name: facts.render(name) for name in reply.lookup}
        log.info("%s looked up %s", persona.character, ", ".join(reply.lookup))
        prior = json.dumps({"lookup": list(reply.lookup)})
        second_messages = build_messages(persona, req, mind=mind, lookups=cards, prior_json=prior)
        try:
            completion, note = await _complete_with_room(complete_fn, second_messages, model, persona.character)
        except LlmError as err:
            log.warning("%s: model failed on the lookup round (%s)", persona.character, err)
            await record("lookup", second_messages, None, None, error=str(err))
            return Reply(say=persona.fallback)
        raw = completion.content
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
        await record("lookup", second_messages, completion, reply, note=note)
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


async def _complete_with_room(complete_fn: CompleteFn, messages: list[dict[str, str]], model: LlmConfig, who: str) -> tuple[Completion, str]:
    """One model call; if a reasoning model spends the whole token budget
    thinking (empty answer, finish reason `length`) or says nothing at all,
    ask once more with twice the room. Silence to a guest is the worst
    outcome; a few more seconds is not. Returns the completion and a note
    about any retry (for the trace)."""
    note = ""
    try:
        completion = Completion.of(await complete_fn(messages, model))
    except LlmTruncated as err:
        log.warning("%s: %s — retrying with more room", who, err)
        note = f"first attempt truncated ({err}); retried with more room"
        completion = Completion(content="")
    if completion.content.strip():
        return completion, note
    roomy = replace(model, max_tokens=max(model.max_tokens * 2, model.max_tokens + 600))
    log.warning("%s: empty answer from %s — retrying once with max_tokens=%d", who, model.model, roomy.max_tokens)
    note = note or f"first attempt was empty; retried with max_tokens={roomy.max_tokens}"
    return Completion.of(await complete_fn(messages, roomy)), note


class Agents:
    name = "agents"

    def __init__(self, cfg: AgentsConfig, complete_fn: CompleteFn = complete) -> None:
        self.cfg = cfg
        self.complete_fn = complete_fn
        self.worker: str | None = None
        self._event: str = ""
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.mod: ModClient | None = None
        self._slots = asyncio.Semaphore(cfg.concurrency)
        self.facts: FactsClient | None = None
        #: The voice models, per character — a copy the control panel may retune.
        self.models: dict[str, LlmConfig] = dict(cfg.models)
        self.minds: dict[str, Mind] = {name: Mind(character=name) for name in cfg.personas}
        for name, persona in cfg.personas.items():
            self.minds[name].seed(persona.stages, persona.drives)
        self.trace = Trace(cfg.state_dir)
        self.trace.listen(self._thought_recorded)
        self.orchestrator = Orchestrator(
            cfg.orchestrator,
            complete_fn,
            cfg.orchestrator_models,
            cfg.personas,
            self.minds,
            on_update=self._mind_updated,
            facts_fn=self._facts,
            trace=self.trace,
        )
        self._orchestrator_task: asyncio.Task[None] | None = None
        self._inflight = 0

    @property
    def event(self) -> str:
        return self._event

    @event.setter
    def event(self, value: str) -> None:
        self._event = value
        self.trace.event = value  # minds and traces live side by side per event

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
                if persona.stages or persona.drives:
                    arc = " → ".join(persona.stages) if persona.stages else "—"
                    drives = ", ".join(f"{k} {v}" for k, v in persona.drives.items()) or "—"
                    lines.append(f"    arc    : {arc} · drives {drives} · phase cues {len(persona.phase_cues)}")
        if o.enabled:
            lines.append(f"  minds    : {self.cfg.state_dir} (preempt {'on' if o.preempt else 'off'}, quiet {o.quiet_s:.1f}s) · trace beside each mind")
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
        for name, persona in self.cfg.personas.items():
            path = mind_path(self.cfg.state_dir, self.event, name)
            mind = Mind.load(path, name, self.event)
            mind.seed(persona.stages, persona.drives)
            self.minds[name] = mind
            if mind.exchanges or mind.notes:
                log.info("%s's mind restored from %s (%d exchanges, %d notes, %d people)", name, path, mind.exchanges, len(mind.notes), len(mind.people))
            loaded = self.trace.load_recent(name)
            if loaded:
                log.info("%s's trace restored (%d thoughts)", name, loaded)
        self.orchestrator.minds = self.minds

    def _save_mind(self, name: str) -> None:
        mind = self.minds.get(name)
        if mind is not None:
            mind.event = self.event
            mind.save(mind_path(self.cfg.state_dir, self.event, name))

    async def _facts(self, force: bool = False) -> Facts | None:
        if self.facts is None:
            return None
        return await self.facts.get(force=force)

    def status(self, character: str) -> dict[str, Any]:
        """What the worker is doing for this character — rides the mirror."""
        voice = self.models.get(character)
        return {
            "worker": self.cfg.name,
            "event": self.event,
            "inflight": self._inflight,
            "dryRun": self.cfg.dry_run,
            "voice": {
                "model": voice.model if voice is not None else None,
                "api": voice.api if voice is not None else None,
                "effort": voice.reasoning_effort if voice is not None else None,
                "temperature": voice.temperature if voice is not None else None,
                "maxTokens": voice.max_tokens if voice is not None else None,
            },
            "mind": self.orchestrator.status(character),
            "thoughts": len(self.trace.all(character)),
        }

    async def _mirror(self, character: str) -> None:
        mind = self.minds.get(character)
        if mind is None or self.cfg.dry_run or self.mod is None:
            return
        try:
            await self.mod.post("/api/agent/mind", mind.report(self.worker, self.status(character)))
        except ModApiError as err:
            log.warning("could not mirror %s's mind: %s", character, err)

    async def _mind_updated(self, character: str, mind: Mind, job: Job, touched: list[str]) -> None:
        self._save_mind(character)
        if mind.brief and "brief" in touched:
            log.info("%s brief: %s", character, " / ".join(mind.brief.splitlines())[:300])
        if "stage" in touched:
            log.info("%s is now at: %s", character, mind.stage)
        await self._mirror(character)

    async def _thought_recorded(self, thought: Thought) -> None:
        if self.cfg.dry_run or self.mod is None:
            return
        try:
            await self.mod.post("/api/agent/trace", {"worker": self.worker or self.cfg.name, "thoughts": [thought.to_json()]})
        except ModApiError as err:
            log.warning("could not send %s's thought %s: %s", thought.character, thought.id, err)

    async def _push_history(self) -> None:
        """On (re)connect: hand the server the mind and the recent trace, so
        a server restart or a fresh console starts with the night so far."""
        if self.cfg.dry_run or self.mod is None:
            return
        for name in self.minds:
            await self._mirror(name)
            recent = [t.to_json() for t in self.trace.recent(name, 40)]
            if recent:
                try:
                    await self.mod.post("/api/agent/trace", {"worker": self.worker or self.cfg.name, "thoughts": recent})
                except ModApiError as err:
                    log.warning("could not replay %s's trace: %s", name, err)

    async def reset_minds(self, by: str = "server", reason: str = "restart") -> None:
        self.orchestrator.drop_all()
        if self.facts is not None:
            self.facts.forget()
        for name, mind in self.minds.items():
            mind.reset(by=by)
            self._save_mind(name)
            await self.trace.record(new_thought(name, "reset", trigger=reason, note=f"the mind is back at the doors ({reason}, by {by})"))
            await self._mirror(name)
        log.info("the run restarted — every mind is back at the doors")

    # -- the control panel ---------------------------------------------------------

    async def control(self, doc: dict[str, Any]) -> dict[str, Any]:
        """One control action from the server (`control` frame). Returns a
        small outcome dict (also recorded as a `control` thought)."""
        action = str(doc.get("action") or "")
        by = str(doc.get("by") or "server")
        who = doc.get("character")
        characters = [str(who)] if isinstance(who, str) and who else list(self.minds)
        if action not in CONTROL_ACTIONS:
            return {"ok": False, "error": f"unknown action {action!r}"}
        if action == "reset":
            await self.reset_minds(by=by, reason=str(doc.get("reason") or "reset"))
            return {"ok": True}
        outcomes: dict[str, Any] = {"ok": True, "action": action, "characters": []}
        for character in characters:
            mind = self.minds.get(character)
            if mind is None:
                outcomes["ok"] = False
                outcomes["error"] = f"no such character {character!r}"
                continue
            note = ""
            if action == "survey":
                self.orchestrator.survey(character, "director")
                note = "survey the house now"
            elif action == "nudge":
                text = str(doc.get("text") or "").strip()
                if not text:
                    outcomes["ok"] = False
                    outcomes["error"] = "nudge needs text"
                    continue
                mind.whisper(text, by=by)
                self.orchestrator.survey(character, "director")
                note = f"nudge: {text}"
            elif action == "set":
                note = self._set(mind, doc, by)
                if note.startswith("!"):
                    outcomes["ok"] = False
                    outcomes["error"] = note[1:]
                    continue
            elif action == "forget":
                person = str(doc.get("person") or "")
                if not mind.forget_person(person):
                    outcomes["ok"] = False
                    outcomes["error"] = f"no file on {person!r}"
                    continue
                note = f"forgot {person}"
            elif action == "thinking":
                on = doc.get("on") is True
                self.orchestrator.set_thinking(character, on)
                note = f"orchestrator reasoning {'on' if on else 'off'}"
            elif action == "effort":
                level = str(doc.get("level") or "low").lower()
                if level not in EFFORTS:
                    outcomes["ok"] = False
                    outcomes["error"] = f"effort must be one of {', '.join(EFFORTS)}"
                    continue
                model = self.models[character]
                self.models[character] = replace(model, reasoning_effort=None if level == "none" else level)
                note = f"voice reasoning effort {level}"
            elif action == "pause":
                on = doc.get("on") is True
                self.orchestrator.set_paused(on)
                note = "mind paused (jobs queue, nothing runs)" if on else "mind resumed"
            elif action == "rerun":
                thought = self.trace.find(str(doc.get("thought") or ""))
                if thought is None or thought.character != character:
                    outcomes["ok"] = False
                    outcomes["error"] = "no such thought"
                    continue
                self.orchestrator.rerun(thought, self.models[character] if thought.kind in ("voice", "lookup") else None)
                note = f"re-run {thought.id} ({thought.kind})"
            self._save_mind(character)
            await self.trace.record(new_thought(character, "control", trigger=by, note=note))
            await self._mirror(character)
            outcomes["characters"].append(character)
        return outcomes

    def _set(self, mind: Mind, doc: dict[str, Any], by: str) -> str:
        field = str(doc.get("field") or "")
        value = doc.get("value")
        update: dict[str, Any]
        if field in ("brief", "mood"):
            if not isinstance(value, str) or not value.strip():
                return f"!{field} needs text"
            update = {field: value}
        elif field == "stage":
            if not isinstance(value, str) or not value.strip():
                return "!stage needs a name"
            update = {"stage": value, "stage_why": str(doc.get("why") or f"set by {by}")}
        elif field == "drive":
            name = str(doc.get("name") or "")
            if name not in mind.drives:
                return f"!no drive named {name!r} (have: {', '.join(mind.drives) or 'none'})"
            update = {"drives": {name: value}}
        elif field == "policy":
            if not isinstance(value, dict):
                return "!policy needs an object {favours, credit, wary, note}"
            update = {"policy": value}
        elif field == "trust":
            person = str(doc.get("person") or "")
            d = mind.people.get(person) or mind.person_by_name(person)
            if d is None:
                return f"!no file on {person!r}"
            update = {"people": {d.id: {"trust": value}}}
        elif field == "note":
            add = doc.get("add")
            drop = doc.get("drop")
            update = {}
            if isinstance(add, str) and add.strip():
                update["notes_add"] = [add]
            if isinstance(drop, str) and drop.strip():
                update["notes_drop"] = [drop]
            if not update:
                return "!note needs add or drop"
        elif field == "question":
            add = doc.get("add")
            drop = doc.get("drop")
            update = {}
            if isinstance(add, str) and add.strip():
                update["questions_add"] = [add]
            if isinstance(drop, str) and drop.strip():
                update["questions_drop"] = [drop]
            if not update:
                return "!question needs add or drop"
        else:
            return f"!unknown field {field!r}"
        touched = mind.apply(update, by=by)
        if field == "stage" and "stage" not in touched:
            return f"!{value!r} is not one of the declared stages ({', '.join(mind.stages) or 'none declared'})"
        return f"set {field}: {json.dumps(value if value is not None else doc.get('add') or doc.get('drop'), ensure_ascii=False)[:160]}" + (f" (touched {', '.join(touched)})" if touched else " (no change)")

    # -- the stream -------------------------------------------------------------

    async def on_frame(self, event: str, data: str) -> None:
        if event == "hello":
            hello = json.loads(data)
            self.worker = hello.get("worker")
            log.info("agents online as %r for %s", self.cfg.name, ", ".join(hello.get("characters", [])))
            for name in hello.get("unknown", []):
                log.warning("%s is not marked `mind: external` in the running story — nobody will ask for it", name)
            await self._push_history()
            if self.cfg.orchestrator.enabled:
                for name in self.minds:
                    self.orchestrator.survey(name, "hello")  # first look at the house
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
        elif event == "control":
            doc = json.loads(data)
            if not isinstance(doc, dict):
                return
            if doc.get("action") == "reset":
                self.abandon_all()
            outcome = await self.control(doc)
            if not outcome.get("ok"):
                log.warning("control %s refused: %s", doc.get("action"), outcome.get("error"))

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
            self._inflight += 1
            counted = True
            mind = self.minds.get(character)
            facts = await self._facts() if persona.lookup or persona.powers != () else None
            async with self._slots:
                reply = await answer(persona, self.models[character], req, self.complete_fn, mind=mind, facts=facts, trace=self.trace)
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
                self._inflight = max(0, self._inflight - 1)
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
