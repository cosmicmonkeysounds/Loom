"""The agents worker: hold the server's agent stream, answer its requests.

    GET /api/agent/stream?characters=Trabolta&name=laptop   (SSE)
      hello   {worker, eventId, characters, agents, unknown}
      request {id, character, thread, speaker, text, history, self, them, world, powers}
      cancel  {id}          — timed out / superseded: drop the work
      control {action, character?, by, …}
              — the control panel (and the server itself on a restart):
                reset · survey · nudge · set · forget · thinking · effort ·
                pause · rerun — see `Agents.control`
      judge   {id, character, filing, question: {id, text}, key: {answer, aliases},
               answer, confidence}
              — a near-miss 📝 filing for the story's `judge:` character to
                rule on (wave 11b; `judge.py`); `cancel {id}` drops it too
    POST /api/agent/reply {id, worker, say, adjust, acts}
    POST /api/agent/judge {id, worker, same, why}  — 410: a director ruled first / expired
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

**The new mind** (`mind_mode: new`, wave 12) makes one voice call per
line (`voice.answer_lean`, plus at most one retry) and keeps the mind in
code (`story_mind.py`): the mind file's phase card for `Night.phase` sets
the stage, favours, drives, live powers and brief; the voice writes a short
memo on each person in the same call; a quiet conversation may be condensed
into a summary (one voice call, never while a request waits); a director's
**Rewrite brief** is one voice call. The orchestrator is never started.
`mind_mode: classic` (the default) is the worker described above, as it was.

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
from . import story_mind
from .cards import PersonCard, PhaseView, VoiceContext, VoiceOptions
from .config import AgentsConfig, parse_agents
from .facts import Facts, FactsClient
from .judge import JUDGE_DEADLINE_S, Ruling, judge_messages, judge_model, parse_ruling
from .llm import Completion, LlmConfig, LlmError, LlmTruncated, complete
from .mind import Mind, mind_path
from .orchestrator import Job, Orchestrator, reflect_tokens_needed, voice_tokens_needed
from .persona import Persona
from .prompt import build_messages, gate_context
from .reply import Reply, parse_reply
from .secrets import drop_counts
from .trace import Thought, Trace, new_thought

log = logging.getLogger("stagehand.agents")

CompleteFn = Callable[[list[dict[str, str]], LlmConfig], Awaitable[Any]]

CONTROL_ACTIONS = ("reset", "survey", "nudge", "set", "forget", "thinking", "effort", "pause", "rerun", "rewrite")
#: The new mind's quiet-conversation summary (CONTRACTS.md §C5.2).
QUIET_TURNS = 3
QUIET_S = 120.0
QUIET_TICK_S = 5.0
#: The voice entry point's signature (`voice.answer_lean`).
VoiceFn = Callable[..., Awaitable[Reply]]
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
    codex = tuple(str(e.get("title", "")) for e in persona.secrets.visible((req.get("self") or {}).get("codex")))
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
        cards = {name: facts.render(name, persona.secrets) for name in reply.lookup}
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
    reply = withhold_never(persona, reply)
    if reply.empty:
        log.warning("%s: the model said nothing usable: %r", persona.character, raw[:200])
        return Reply(say=persona.fallback)
    log.info("%s: answered in %.1fs", persona.character, time.monotonic() - started)
    return reply


def withhold_never(persona: Persona, reply: Reply) -> Reply:
    """The voice's last door (wave 7): a line carrying a `secrets.never`
    word (the door code, a patch-bay pair) is never said — the persona's
    fallback goes instead — and an act whose args carry one (a text card
    on the screens) is dropped. Whoever put the number in his context (a
    program who typed it, a clue in a lookup card), it is not his to say."""
    s = persona.secrets
    if not s.never:
        return reply
    acts = tuple(a for a in reply.acts if not s.leaks(json.dumps(a, ensure_ascii=False)))
    say = reply.say
    if s.leaks(say):
        log.warning("%s: withheld a line carrying a secret (door code / combination)", persona.character)
        say = persona.fallback
    if say == reply.say and len(acts) == len(reply.acts):
        return reply
    return Reply(say=say, adjust=reply.adjust, lookup=reply.lookup, acts=acts)


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

    def __init__(self, cfg: AgentsConfig, complete_fn: CompleteFn = complete, voice_fn: VoiceFn | None = None) -> None:
        #: The YAML's orchestrator switch, before the new mind turns it off:
        #: `check` still sizes its context for the way back (mind_mode: classic).
        self._orchestrator_configured = cfg.orchestrator.enabled
        if cfg.new_mind and cfg.orchestrator.enabled:
            # The new mind never starts the orchestrator (nothing is submitted
            # to it, the second model is never called).
            cfg = replace(cfg, orchestrator=replace(cfg.orchestrator, enabled=False))
        self.cfg = cfg
        self.complete_fn = complete_fn
        #: The lean voice (`voice.answer_lean`), resolved on first use.
        self._voice_fn = voice_fn
        self.worker: str | None = None
        self._event: str = ""
        self.tasks: dict[str, asyncio.Task[None]] = {}
        #: Judge rulings in flight, by request id (never thread-bound, never
        #: a `request`: `judge.py`).
        self.judging: dict[str, asyncio.Task[None]] = {}
        self.mod: ModClient | None = None
        self._slots = asyncio.Semaphore(cfg.concurrency)
        self.facts: FactsClient | None = None
        #: The voice models, per character — a copy the control panel may retune.
        self.models: dict[str, LlmConfig] = dict(cfg.models)
        self.minds: dict[str, Mind] = {name: Mind(character=name, mode=cfg.mind_mode) for name in cfg.personas}
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
        # -- the new mind --
        #: The newest request per character (its powers build P1 for a Rewrite / a summary).
        self._last_req: dict[str, dict[str, Any]] = {}
        #: (character, person id) → quiet-summary bookkeeping: turns since the
        #: last summary, when they last spoke, their newest history, the memo set summarised.
        self._quiet: dict[tuple[str, str], dict[str, Any]] = {}
        self._summary_task: asyncio.Task[None] | None = None
        #: Background work the new mind starts (the phase watch, the quiet
        #: watch, a Rewrite, a re-run) — cancelled with the stream.
        self._side: set[asyncio.Task[Any]] = set()

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
                f"  {name:<9}: {m.model} @ {m.endpoint} ({f'ctx {m.context_window}; ' if m.context_window else ''}effort {m.reasoning_effort or '—'}, "
                f"max_tokens {m.max_tokens}) · vars {', '.join(persona.variables) or '—'}{gate}"
            )
            if o.enabled:
                om = self.cfg.orchestrator_models[name]
                mind = "own mind file" if persona.mind_prompt else "default mind"
                powers = "all powers" if persona.powers is None else (f"powers {', '.join(persona.powers)}" if persona.powers else "no powers")
                ctx = f"ctx {om.context_window}; " if om.context_window else ""
                lines.append(
                    f"    mind   : {om.model} ({ctx}{mind}; reflect every {persona.reflect_after}, window {persona.thread_window}, "
                    f"summarise ≥{persona.summarize_after}; survey every {o.survey_every_s:.0f}s; {powers}; lookup {'on' if persona.lookup else 'off'})"
                )
                if persona.stages or persona.drives:
                    arc = " → ".join(persona.stages) if persona.stages else "—"
                    drives = ", ".join(f"{k} {v}" for k, v in persona.drives.items()) or "—"
                    lines.append(f"    arc    : {arc} · drives {drives} · phase cues {len(persona.phase_cues)}")
        if self.cfg.new_mind:
            v, m = self.cfg.voice, self.cfg.mind
            onoff = lambda b: "on" if b else "off"  # noqa: E731
            lines.append(
                f"  mind     : NEW (one voice call per line) · layout {v.layout} · memo {onoff(v.memo)} · repeat guard {onoff(v.repeat_guard)} · "
                f"quiet summary {onoff(v.dossier_on_close)} · phase cards {onoff(m.stage_from_phase)} · phase watch {f'{m.phase_poll_s:.0f}s' if m.phase_poll_s else 'off'}"
            )
            for name, persona in self.cfg.personas.items():
                lines.append(f"    {name:<7}: {len(persona.phase_cards)} phase card(s), {len(persona.stage_cards)} stage card(s), {len(persona.catchphrases)} catchphrase(s)")
            lines.append(f"  minds    : {self.cfg.state_dir} · trace beside each mind")
        if o.enabled:
            lines.append(f"  minds    : {self.cfg.state_dir} (preempt {'on' if o.preempt else 'off'}, quiet {o.quiet_s:.1f}s) · trace beside each mind")
        return lines

    def warnings(self) -> list[str]:
        """Not fatal, but worth a look before doors (`stagehand check`)."""
        out: list[str] = []
        for name, persona in self.cfg.personas.items():
            out.extend(f"{name}'s mind file: {w}" for w in persona.warnings)
        for name, persona in self.cfg.personas.items():
            m = self.cfg.models[name]
            ctx = m.context_window
            if ctx is None:
                continue  # api: openai — the server picks the context; nothing to compare
            need = voice_tokens_needed(persona, m.max_tokens, with_mind=self.cfg.orchestrator.enabled)
            if need > ctx:
                out.append(
                    f"{name}'s voice: a late-night line needs ≈ {need} tokens but {m.model} runs with a {ctx}-token context — "
                    f"Ollama cuts the middle of the prompt; set llm.{m.context_key} to {need} or more"
                )
        if not self._orchestrator_configured:
            return out
        for name, persona in self.cfg.personas.items():
            om = self.cfg.orchestrator_models[name]
            ctx = om.context_window
            if ctx is None:
                continue  # api: openai — the server picks the context; nothing to compare
            need = reflect_tokens_needed(persona, om.max_tokens)
            if need > ctx:
                out.append(
                    f"{name}'s mind: a reflection needs ≈ {need} tokens but {om.model} runs with a {ctx}-token context — "
                    f"Ollama cuts the middle of the prompt; set orchestrator.llm.{om.context_key} to {need} or more"
                )
        return out

    def stream_url(self, mod: ModClient) -> str:
        from urllib.parse import urlencode

        query = urlencode({"characters": ",".join(self.cfg.personas), "name": self.cfg.name})
        return f"{mod.base_url}{mod.path('/api/agent/stream')}?{query}"

    async def run(self, ctx: Context) -> None:
        self.mod = ctx.mod
        self.facts = FactsClient(ctx.mod, self.cfg.facts_ttl_s)
        self.event = ctx.server.event or "default"
        for warning in self.warnings():
            log.warning("%s", warning)
        self._load_minds()
        if self.cfg.new_mind:
            self._start_new_mind()
        else:
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
            self._stop_side()

    def abandon_all(self) -> None:
        from .wire import wire_of

        for task in [*self.tasks.values(), *self.judging.values()]:
            task.cancel()
        self.tasks.clear()
        self.judging.clear()
        wire_of(self).flush_saves()  # a (re)connect or a shutdown never loses a debounced save

    # -- minds ----------------------------------------------------------------

    def _load_minds(self) -> None:
        for name, persona in self.cfg.personas.items():
            path = mind_path(self.cfg.state_dir, self.event, name)
            mind = Mind.load(path, name, self.event)
            mind.mode = self.cfg.mind_mode
            mind.seed(persona.stages, persona.drives)
            hunt, never = persona.secrets.prune(mind)
            more_hunt, more_never = story_mind.prune_restored(persona, mind)  # the new mind's fields
            hunt, never = hunt + more_hunt, never + more_never
            if hunt or never:
                log.info("%s's mind: dropped restored %s", name, drop_counts(hunt, never))
            self.minds[name] = mind
            if mind.exchanges or mind.notes:
                log.info("%s's mind restored from %s (%d exchanges, %d notes, %d people)", name, path, mind.exchanges, len(mind.notes), len(mind.people))
            loaded = self.trace.load_recent(name)
            if loaded:
                log.info("%s's trace restored (%d thoughts)", name, loaded)
        self.orchestrator.minds = self.minds

    def _save_mind(self, name: str, now: bool = False) -> None:
        """Persist one mind: at most once every 2 s per character, trailing
        (`wire.py`); `now=True` writes at once."""
        from .wire import wire_of

        wire_of(self).save(self, name, now=now)

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
            "mindMode": self.cfg.mind_mode,
            "phaseWatchS": self.cfg.mind.phase_poll_s if self.cfg.new_mind and self.cfg.mind.stage_from_phase else 0,
        } | ({"voice": self._voice_status(voice), "stageFromPhase": self.cfg.mind.stage_from_phase} if self.cfg.new_mind else {})

    def _voice_status(self, voice: LlmConfig | None) -> dict[str, Any]:
        v = self.cfg.voice
        return {
            "model": voice.model if voice is not None else None,
            "api": voice.api if voice is not None else None,
            "effort": voice.reasoning_effort if voice is not None else None,
            "temperature": voice.temperature if voice is not None else None,
            "maxTokens": voice.max_tokens if voice is not None else None,
            "memo": v.memo,
            "repeatGuard": v.repeat_guard,
            "layout": v.layout,
        }

    async def _mirror(self, character: str) -> None:
        """Mirror one mind to the server — only when it changed, at most once
        every 2 s, trailing (`wire.py`)."""
        from .wire import wire_of

        await wire_of(self).mirror(self, character)

    async def _mind_updated(self, character: str, mind: Mind, job: Job, touched: list[str]) -> None:
        self._save_mind(character)
        if mind.brief and "brief" in touched:
            log.info("%s brief: %s", character, " / ".join(mind.brief.splitlines())[:300])
        if "stage" in touched:
            log.info("%s is now at: %s", character, mind.stage)
        await self._mirror(character)

    async def _thought_recorded(self, thought: Thought) -> None:
        from .wire import FLUSH_KINDS, wire_of

        if thought.kind in FLUSH_KINDS:
            wire_of(self).flush_now(thought)  # a director is watching: no window
        if self.cfg.dry_run or self.mod is None:
            return
        wire = wire_of(self)
        try:
            answer = await self.mod.post("/api/agent/trace", {"worker": self.worker or self.cfg.name, "thoughts": [self.trace.server_copy(thought)]})
        except Exception as err:  # noqa: BLE001 — a refusal, a refused connection, a timeout: all alike
            # The server may hold none of our full copies (it is down, or came
            # back empty): every next thought goes whole, the next hello replays all.
            wire.lost(self)
            log.warning("could not send %s's thought %s: %s", thought.character, thought.id, err)
            return
        self.trace.delivered(thought.id)
        wire.trace_posted(self, answer)

    async def _push_history(self) -> None:
        """On (re)connect: hand the server the mind and the recent trace, so
        a server restart or a fresh console starts with the night so far."""
        from .wire import REPLAY_BATCH, replay_thoughts, wire_of

        if self.cfg.dry_run or self.mod is None:
            return
        wire = wire_of(self)
        after_map = wire.trace_after
        for name in self.minds:
            await wire.mirror(self, name, force=True)  # always, right after hello
            after = None if after_map is None else after_map.get(name)
            recent = replay_thoughts(self.trace, name, after)
            for start in range(0, len(recent), REPLAY_BATCH):
                try:
                    answer = await self.mod.post("/api/agent/trace", {"worker": self.worker or self.cfg.name, "thoughts": recent[start : start + REPLAY_BATCH]})
                except Exception as err:  # noqa: BLE001 — the stream must survive a failed replay
                    wire.lost(self)  # the next hello tries the whole replay again
                    log.warning("could not replay %s's trace: %s", name, err)
                    break
                wire.trace_posted(self, answer, replay=True)

    async def reset_minds(self, by: str = "server", reason: str = "restart") -> None:
        self.orchestrator.drop_all()
        if self.facts is not None:
            self.facts.forget()
        self._quiet.clear()
        if self._summary_task is not None and not self._summary_task.done():
            self._summary_task.cancel()
        for name, mind in self.minds.items():
            mind.reset(by=by)
            self._save_mind_now(name)
            await self.trace.record(new_thought(name, "reset", trigger=reason, note=f"the mind is back at the doors ({reason}, by {by})"))
            await self._mirror(name)
        log.info("the run restarted — every mind is back at the doors")

    # -- the control panel ---------------------------------------------------------

    async def control(self, doc: dict[str, Any]) -> dict[str, Any]:
        """One control action from the server (`control` frame). Returns a
        small outcome dict (also recorded as a `control` thought). A control
        that changes nothing (a `set` to the current value, `pause` /
        `thinking` / `effort` as they are) is answered `{ok, note: "no
        change"}` and writes no revision, no thought, no save, no mirror.

        In the new mind a `rewrite` (and a `survey`, from an old editor) is
        one voice call that rewrites the brief, and a `nudge` adds the
        whisper only; in classic a `rewrite` is a `survey`."""
        action = str(doc.get("action") or "")
        by = str(doc.get("by") or "server")
        who = doc.get("character")
        characters = [str(who)] if isinstance(who, str) and who else list(self.minds)
        if action not in CONTROL_ACTIONS:
            return {"ok": False, "error": f"unknown action {action!r}"}
        if action == "reset":
            await self.reset_minds(by=by, reason=str(doc.get("reason") or "reset"))
            return {"ok": True}
        new = self.cfg.new_mind
        if new and action == "survey":
            action = "rewrite"
        elif not new and action == "rewrite":
            action = "survey"
        outcomes: dict[str, Any] = {"ok": True, "action": action, "characters": []}
        for character in characters:
            mind = self.minds.get(character)
            if mind is None:
                outcomes["ok"] = False
                outcomes["error"] = f"no such character {character!r}"
                continue
            note = ""
            changed = True
            if action == "survey":
                self.orchestrator.survey(character, "director")
                note = "survey the house now"
            elif action == "rewrite":
                self._spawn(self._rewrite(character, by))
                note = "rewrite the brief (one voice call)"
            elif action == "nudge":
                text = str(doc.get("text") or "").strip()
                if not text:
                    outcomes["ok"] = False
                    outcomes["error"] = "nudge needs text"
                    continue
                mind.whisper(text, by="director" if new else by)
                if not new:
                    self.orchestrator.survey(character, "director")
                note = f"nudge: {text}"
            elif action == "set":
                note, changed = self._set(mind, doc, by)
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
                changed = self.orchestrator.thinking(character) != on
                if changed:
                    self.orchestrator.set_thinking(character, on)
                note = f"orchestrator reasoning {'on' if on else 'off'}"
            elif action == "effort":
                level = str(doc.get("level") or "low").lower()
                if level not in EFFORTS:
                    outcomes["ok"] = False
                    outcomes["error"] = f"effort must be one of {', '.join(EFFORTS)}"
                    continue
                model = self.models[character]
                effort = None if level == "none" else level
                changed = model.reasoning_effort != effort
                if changed:
                    self.models[character] = replace(model, reasoning_effort=effort)
                note = f"voice reasoning effort {level}"
            elif action == "pause":
                on = doc.get("on") is True
                changed = self.orchestrator.paused != on
                if changed:
                    self.orchestrator.set_paused(on)
                note = "mind paused (jobs queue, nothing runs)" if on else "mind resumed"
            elif action == "rerun":
                tid = str(doc.get("thought") or "")
                thought = self.trace.find(tid)
                if thought is None or thought.character != character:
                    outcomes["ok"] = False
                    outcomes["error"] = (self.trace.refusal(tid) if thought is None else None) or "no such thought"
                    continue
                if any(str(m.get("content", "")).startswith("[same prefix as th-") for m in thought.messages):
                    outcomes["ok"] = False
                    outcomes["error"] = "prefix not found"
                    continue
                voice = self.models[character]
                model = judge_model(voice) if thought.kind == "judge" else voice if thought.kind in ("voice", "lookup", "brief", "summary") else None
                if new and model is None and thought.kind == "rerun":
                    model = voice  # the new mind only ever re-runs voice-model calls
                if new and model is None:
                    # A reflect / survey from a classic run: the new mind never
                    # calls the orchestrator's model (CONTRACTS.md §C5.2).
                    outcomes["ok"] = False
                    outcomes["error"] = f"classic thought ({thought.kind}): re-run it in mind_mode: classic"
                    continue
                if new:
                    self._spawn(self._rerun_now(thought, model))
                else:
                    self.orchestrator.rerun(thought, model)
                note = f"re-run {thought.id} ({thought.kind})"
            if not changed:
                outcomes["note"] = "no change"
                continue
            self._save_mind(character)
            await self.trace.record(new_thought(character, "control", trigger=by, note=note))
            await self._mirror(character)
            outcomes["characters"].append(character)
        return outcomes

    def _set(self, mind: Mind, doc: dict[str, Any], by: str) -> tuple[str, bool]:
        """A director's edit. Returns (note, changed); a note starting `!` is
        an error. In the new mind its revision is `by: director`, and a
        brief / stage / drive / policy holds until the next phase card."""
        field = str(doc.get("field") or "")
        value = doc.get("value")
        new = self.cfg.new_mind
        rev_by = "director" if new else by
        update: dict[str, Any]
        if field in ("brief", "mood"):
            if not isinstance(value, str) or not value.strip():
                return f"!{field} needs text", False
            update = {field: value}
        elif field == "stage":
            if not isinstance(value, str) or not value.strip():
                return "!stage needs a name", False
            if mind._match_stage(value) is None:
                return f"!{value!r} is not one of the declared stages ({', '.join(mind.stages) or 'none declared'})", False
            update = {"stage": value, "stage_why": str(doc.get("why") or f"set by {by}")}
        elif field == "drive":
            name = str(doc.get("name") or "")
            if name not in mind.drives:
                return f"!no drive named {name!r} (have: {', '.join(mind.drives) or 'none'})", False
            update = {"drives": {name: value}}
        elif field == "policy":
            if not isinstance(value, dict):
                return "!policy needs an object {favours, credit, wary, note}", False
            update = {"policy": value}
        elif field == "trust":
            person = str(doc.get("person") or "")
            d = mind.people.get(person) or mind.person_by_name(person)
            if d is None:
                return f"!no file on {person!r}", False
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
                return "!note needs add or drop", False
        elif field == "question":
            add = doc.get("add")
            drop = doc.get("drop")
            update = {}
            if isinstance(add, str) and add.strip():
                update["questions_add"] = [add]
            if isinstance(drop, str) and drop.strip():
                update["questions_drop"] = [drop]
            if not update:
                return "!question needs add or drop", False
        else:
            return f"!unknown field {field!r}", False
        touched = mind.apply(update, by=rev_by)
        if new and field == "brief" and "brief" in touched:
            mind.brief_by = "director"
        shown = json.dumps(value if value is not None else doc.get("add") or doc.get("drop"), ensure_ascii=False)[:160]
        return f"set {field}: {shown}" + (f" (touched {', '.join(touched)})" if touched else " (no change)"), bool(touched)

    # -- the stream -------------------------------------------------------------

    async def on_frame(self, event: str, data: str) -> None:
        if event == "hello":
            hello = json.loads(data)
            self.worker = hello.get("worker")
            log.info("agents online as %r for %s", self.cfg.name, ", ".join(hello.get("characters", [])))
            for name in hello.get("unknown", []):
                log.warning("%s is not marked `mind: external` in the running story — nobody will ask for it", name)
            from .wire import wire_of

            # Replay only what the server lacks (all, after a failure), and the
            # next thought carries its full prefix again.
            wire_of(self).hello(self, hello)
            await self._push_history()
            if self.cfg.orchestrator.enabled:
                for name in self.minds:
                    self.orchestrator.survey(name, "hello")  # first look at the house
        elif event == "request":
            req = json.loads(data)
            rid = str(req.get("id"))
            if rid in self.tasks:
                return
            if self._summary_task is not None and not self._summary_task.done():
                self._summary_task.cancel()  # a guest is waiting: the summary runs later
            self.tasks[rid] = asyncio.ensure_future(self._handle(req))
        elif event == "judge":
            frame = json.loads(data)
            if not isinstance(frame, dict):
                return
            jid = str(frame.get("id"))
            if jid in self.judging:
                return
            self.judging[jid] = asyncio.ensure_future(self._judge(frame))
        elif event == "cancel":
            cid = str(json.loads(data).get("id"))
            for tasks in (self.tasks, self.judging):
                task = tasks.pop(cid, None)
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
        if event == "hello" and self.cfg.new_mind and self.cfg.mind.stage_from_phase:
            self._spawn(self._phase_check(force=True))  # the first facts fetch after hello applies the card

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
            if self.cfg.new_mind and mind is not None:
                await self._answer_new(rid, persona, mind, req)
                return
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

    # -- the new mind (wave 12, mind_mode: new) ----------------------------------------

    def _voice(self) -> VoiceFn:
        if self._voice_fn is None:
            from .voice import answer_lean  # lane W1's module; imported only when the new mind speaks

            self._voice_fn = answer_lean
        return self._voice_fn

    def _spawn(self, coro: Awaitable[Any]) -> asyncio.Task[Any]:
        task = asyncio.ensure_future(coro)
        self._side.add(task)
        task.add_done_callback(self._side.discard)
        return task

    def _start_new_mind(self) -> None:
        if self.cfg.mind.stage_from_phase and self.cfg.mind.phase_poll_s > 0:
            self._spawn(self._phase_watch())
        if self.cfg.voice.dossier_on_close:
            self._spawn(self._quiet_watch())

    def _stop_side(self) -> None:
        for task in list(self._side):
            task.cancel()
        self._side.clear()

    def _save_mind_now(self, name: str) -> None:
        """A save that must land at once (a reset), past the wire's debounce."""
        self._save_mind(name, now=True)

    async def _apply_phase(self, character: str, phase: str) -> list[str] | None:
        mind, persona = self.minds.get(character), self.cfg.personas.get(character)
        if mind is None or persona is None:
            return None
        touched = story_mind.apply_phase(mind, persona, phase)
        if touched is None:
            return None
        if touched:
            log.info("%s's mind: the %s card set %s", character, phase, ", ".join(touched))
            if "stage" in touched:
                log.info("%s is now at: %s", character, mind.stage)
        self._save_mind(character)
        await self._mirror(character)  # the report carries the phase even when the card changed nothing
        return touched

    async def _phase_check(self, force: bool = False) -> None:
        """Read `Night.phase` off the facts and apply its card (no model call)."""
        facts = await self._facts(force=force)
        if facts is None:
            return
        phase = story_mind.current_phase(facts.world)
        for name in self.minds:
            await self._apply_phase(name, phase)

    async def _phase_watch(self) -> None:
        while True:
            await asyncio.sleep(self.cfg.mind.phase_poll_s)
            try:
                await self._phase_check(force=True)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — the watch must outlive one bad fetch
                log.exception("the phase watch failed once")

    async def _answer_new(self, rid: str, persona: Persona, mind: Mind, req: dict[str, Any]) -> None:
        """One line in the new mind: the card for the phase, the person card,
        one voice call (`answer_lean`), then the memo and the bookkeeping."""
        character = persona.character
        sid, who, kind = story_mind.speaker_of(req)
        thread = thread_key(req)
        phase = story_mind.current_phase(req.get("world"))
        self._last_req[character] = req
        if self.cfg.mind.stage_from_phase:
            await self._apply_phase(character, phase)
        awake = persona.when is None or persona.when.evaluate(gate_context(req))
        d = None
        since: tuple[str, ...] = ()
        if awake:
            d, since = story_mind.absorb(mind, persona, req, phase)
        v = self.cfg.voice
        ctx = VoiceContext(
            phase=story_mind.phase_view(mind, persona, req, self.cfg.mind.stage_from_phase),
            person=story_mind.person_card(persona, d, req) if d is not None else PersonCard(id=sid, name=who, kind=kind),
            said=story_mind.said_for(mind, req, thread),
            since=since,
            whispers=tuple(mind.director),
            options=VoiceOptions(memo=v.memo, repeat_guard=v.repeat_guard, layout=v.layout, retry_allowed=len(self.tasks) <= 1),
        )
        async with self._slots:
            reply = await self._voice()(persona, self.models[character], req, ctx, self.complete_fn, trace=self.trace, facts_fn=self._facts, mind=mind)
        log.info(
            "%s → %s: %s%s%s",
            character,
            who,
            reply.say or "(silence)",
            f"  {reply.adjust}" if reply.adjust else "",
            f"  ACT {list(reply.acts)}" if reply.acts else "",
        )
        if not self.cfg.dry_run:
            await self._send(rid, reply)
        if d is None:
            return  # asleep: the unavailable line went out; nobody is on file yet
        heart = str(((req.get("them") or {}).get("vars") or {}).get("at_the_heart", "")).lower() == "true"
        memo = story_mind.keep_memo(persona, getattr(reply, "memo", "") or "") if v.memo else ""
        if memo:
            d.add_memo(memo, heart=heart, thought=self._voice_thought(character, rid))
        story_mind.note_heart(d, req, heart)
        story_mind.after_turn(persona, d, req, phase, reply.say)
        if reply.say and story_mind.keep_said(persona, reply.say):
            mind.remember_said(thread, reply.say, heart=heart)
        history = [h for h in req.get("history", []) if isinstance(h, dict)]
        newest = max((int(h.get("seq", 0)) for h in history), default=0)
        mind.saw_exchange(sid, who, kind, thread, newest)
        self._note_quiet(character, sid, req)
        self._save_mind(character)
        await self._mirror(character)

    def _voice_thought(self, character: str, rid: str) -> str | None:
        for t in reversed(self.trace.all(character)):
            if t.kind == "voice" and t.request_id == rid:
                return t.id
        return None

    def _p1(self, character: str) -> str:
        """The lean voice's static P1, byte for byte, so a Rewrite or a
        summary rides the voice's cached prefix."""
        persona = self.cfg.personas[character]
        req = self._last_req.get(character) or {"powers": [], "self": {}, "them": {}, "world": {}, "history": []}
        try:
            from .voice import build_lean_messages
        except ImportError:  # before lane W1 lands
            return persona.system
        v = self.cfg.voice
        ctx = VoiceContext(phase=PhaseView(), person=PersonCard(id="", name=""), options=VoiceOptions(memo=v.memo, repeat_guard=v.repeat_guard, layout="lean"))
        return build_lean_messages(persona, req, ctx)[0]["content"]

    async def _rewrite(self, character: str, by: str) -> None:
        """A director's Rewrite brief (CONTRACTS.md §C6.1): one voice call
        from the phase card + a digest built in code; every line that leaks
        a `never` word, names an answer word or judges a hunt topic is
        dropped; the rest is the brief, `by: director`, until the next card."""
        persona, mind = self.cfg.personas.get(character), self.minds.get(character)
        if persona is None or mind is None:
            return
        facts = await self._facts(force=True)
        req = dict(self._last_req.get(character) or {})
        if facts is not None:
            req["world"] = facts.world
        view = story_mind.phase_view(mind, persona, req, self.cfg.mind.stage_from_phase)
        digest = facts.digest(secrets=persona.secrets, world_prefixes=persona.facts) if facts is not None else None
        messages = story_mind.rewrite_messages(self._p1(character), story_mind.rewrite_digest(persona, mind, view, digest))
        model = self.models[character]
        try:
            async with self._slots:
                completion, note = await _complete_with_room(self.complete_fn, messages, model, character)
        except LlmError as err:
            await self.trace.record(new_thought(character, "brief", trigger=by, model=model, messages=messages, error=str(err)))
            return
        lines = story_mind.parse_brief(completion.content)
        kept, dropped = story_mind.scrub_brief(persona, lines)
        thought = new_thought(character, "brief", trigger=by, model=model, messages=messages, completion=completion, result={"brief": kept, "dropped": dropped}, note=note)
        if not kept:
            thought.error = "no usable brief in the output" if not lines else f"every line was dropped ({dropped})"
            await self.trace.record(thought)
            return
        before = mind.small()
        touched = mind.apply({"brief": "\n".join(kept), "director_consumed": True}, by="director", thought_id=thought.id)
        mind.brief_by = "director"
        thought.touched = touched
        thought.diff = Mind.diff(before, mind.small())
        thought.revision = mind.rev if touched else None
        if dropped:
            thought.note = (thought.note + "; " if thought.note else "") + f"dropped {dropped} line(s)"
        await self.trace.record(thought)
        log.info("%s brief rewritten by %s: %s", character, by, " / ".join(kept)[:300])
        self._save_mind(character)
        await self._mirror(character)

    async def _rerun_now(self, original: Thought, model: LlmConfig) -> None:
        """The new mind's re-run (no orchestrator to queue it on): the
        recorded messages against the model as configured now; recorded,
        never applied."""
        messages = [dict(m) for m in original.messages]
        if not messages:
            return
        note = f"re-run of {original.id} ({original.kind}) — not applied"
        try:
            async with self._slots:
                completion = Completion.of(await self.complete_fn(messages, model))
        except LlmError as err:
            await self.trace.record(new_thought(original.character, "rerun", trigger=f"rerun:{original.id}", model=model, messages=messages, error=str(err), note=note))
            return
        thought = new_thought(original.character, "rerun", trigger=f"rerun:{original.id}", model=model, messages=messages, completion=completion, note=note)
        thought.request_id, thought.thread, thought.speaker = original.request_id, original.thread, original.speaker
        await self.trace.record(thought)

    # -- the quiet-conversation summary --

    def _note_quiet(self, character: str, pid: str, req: dict[str, Any]) -> None:
        q = self._quiet.setdefault((character, pid), {"turns": 0, "sig": None})
        q["turns"] += 1
        q["at"] = time.monotonic()
        q["history"] = story_mind.history_lines(req)

    def _quiet_phase(self, character: str, mind: Mind) -> str:
        """The phase a quiet summary is judged by. With the cards applied the
        phase watch keeps `phase_applied` fresh; with `stage_from_phase` off
        nothing does, so the newest request's world is read instead."""
        if self.cfg.mind.stage_from_phase:
            return mind.phase_applied
        return story_mind.current_phase((self._last_req.get(character) or {}).get("world")) or mind.phase_applied

    async def _quiet_next(self, now: float) -> tuple[str, str] | None:
        """`_quiet_due`, with the night's phase read off the facts first when
        the cards are not applied (only once a conversation is ripe, so an
        idle worker fetches nothing)."""
        phase = None
        if not self.cfg.mind.stage_from_phase and any(q["turns"] >= QUIET_TURNS and now - q.get("at", now) >= QUIET_S for q in self._quiet.values()):
            facts = await self._facts()
            if facts is not None:
                phase = story_mind.current_phase(facts.world) or None
        return self._quiet_due(now, phase)

    def _quiet_due(self, now: float, phase: str | None = None) -> tuple[str, str] | None:
        """The next conversation to condense, or None (CONTRACTS.md §C5.2).
        `phase`: the night's phase when known (the facts), else each
        character's own (`_quiet_phase`)."""
        if self.tasks or self._inflight or self.judging:
            return None  # never while a request is in flight or queued
        for (character, pid), q in self._quiet.items():
            if q["turns"] < QUIET_TURNS or now - q.get("at", now) < QUIET_S:
                continue
            mind, persona = self.minds.get(character), self.cfg.personas.get(character)
            d = mind.people.get(pid) if mind is not None else None
            if mind is None or persona is None or d is None:
                continue
            now_phase = phase if phase is not None else self._quiet_phase(character, mind)
            card = story_mind.card_for(persona, now_phase)
            stage = card.stage if card is not None and card.stage else mind.stage
            if mind.stages and stage == mind.stages[0]:
                continue  # the phase card has him asleep
            if (now_phase or "").startswith("finale"):
                continue
            if not story_mind.summary_memos(d) and not story_mind.summary_history(d, q.get("history") or []):
                continue  # only heart talk so far: nothing a summary may read
            if q["sig"] == tuple(story_mind.summary_memos(d)):
                continue  # nothing new since the last summary (a heart memo never counts)
            return character, pid
        return None

    async def _quiet_watch(self) -> None:
        while True:
            await asyncio.sleep(QUIET_TICK_S)
            due = await self._quiet_next(time.monotonic())
            if due is None:
                continue
            self._summary_task = asyncio.ensure_future(self._summarise(*due))
            try:
                await self._summary_task
            except asyncio.CancelledError:
                if self._summary_task is not None and self._summary_task.cancelled() and not asyncio.current_task().cancelling():  # type: ignore[union-attr]
                    continue  # preempted by a request: it runs again once the worker is idle
                raise
            except Exception:  # noqa: BLE001
                log.exception("a quiet summary failed")
            finally:
                self._summary_task = None

    async def _summarise(self, character: str, pid: str) -> None:
        persona, mind = self.cfg.personas[character], self.minds[character]
        d = mind.people.get(pid)
        q = self._quiet.get((character, pid))
        if d is None or q is None:
            return
        sig = tuple(story_mind.summary_memos(d))
        messages = story_mind.summary_messages(self._p1(character), persona, d, q.get("history") or [])
        model = self.models[character]
        speaker = {"speaker": {"id": d.id, "name": d.name, "kind": d.kind}}
        try:
            async with self._slots:
                completion, note = await _complete_with_room(self.complete_fn, messages, model, character)
        except LlmError as err:
            q["turns"], q["sig"] = 0, sig
            await self.trace.record(new_thought(character, "summary", trigger="quiet", model=model, messages=messages, request=speaker, error=str(err)))
            return
        q["turns"], q["sig"] = 0, sig
        text = story_mind.parse_summary(persona, completion.content)
        thought = new_thought(character, "summary", trigger="quiet", model=model, messages=messages, completion=completion, request=speaker, result={"summary": text or None}, note=note)
        if not text:
            thought.error = "the summary was dropped (empty, or it carried a secret or an answer word)"
            await self.trace.record(thought)
            return
        d.summary = text
        await self.trace.record(thought)
        self._save_mind(character)
        await self._mirror(character)

    # -- the judge (wave 11b) --------------------------------------------------------

    async def _judge(self, frame: dict[str, Any]) -> None:
        """Rule on one near-miss filing: one call on the character's voice
        model (`judge.py`), traced as a `judge` thought, answered on
        `/api/agent/judge`. Touches no mind, enters no prompt, keeps
        nothing. Like a request it runs while the mind is paused (the
        control panel's `pause` stops the orchestrator only). No ruling —
        the model failed, said nothing usable, or ran past the deadline —
        answers nothing: the server's request expires and the facts
        judge's own fallback stands."""
        jid = str(frame.get("id"))
        character = str(frame.get("character") or "")
        counted = False
        try:
            persona = self.cfg.personas.get(character)
            if persona is None:
                return  # not ours — the server expires it
            model = judge_model(self.models[character])
            messages = judge_messages(frame)
            question = frame.get("question") if isinstance(frame.get("question"), dict) else {}
            qid = str(question.get("id") or "?")
            log.info("%s ⚖ rules on a near miss for %s: %r", character, qid, str(frame.get("answer") or "")[:80])
            self.orchestrator.busy(+1)
            self._inflight += 1
            counted = True
            completion: Completion | None = None
            error: str | None = None
            note = ""
            ruling: Ruling | None = None
            try:
                completion, note = await asyncio.wait_for(self._judge_call(messages, model, character), JUDGE_DEADLINE_S)
                ruling = parse_ruling(completion.content)
            except LlmError as err:
                error = str(err)
            except asyncio.TimeoutError:
                error = f"no ruling within {JUDGE_DEADLINE_S:.0f}s"
            if ruling is not None and ruling.why and persona.secrets.leaks(ruling.why):
                ruling = Ruling(same=ruling.same, why="")  # never a code, not even to a director's # hosts
            if ruling is None and error is None:
                error = "no ruling in the output (answered nothing; the request expires)"
            result = None if ruling is None else {"same": ruling.same, "why": ruling.why, "question": qid}
            await self.trace.record(
                new_thought(character, "judge", trigger="judge", model=model, messages=messages, completion=completion, request={"id": jid}, result=result, error=error, note=note)
            )
            if ruling is None:
                log.warning("%s ⚖ %s: %s", character, qid, error)
                return
            log.info("%s ⚖ %s: %s — %s", character, qid, "same" if ruling.same else "not the same", ruling.why or "(no reason)")
            if not self.cfg.dry_run:
                await self._send_judge(jid, ruling)
        except asyncio.CancelledError:
            log.info("judge %s cancelled", jid)
            raise
        except Exception:  # noqa: BLE001 — one bad ruling must not kill the worker
            log.exception("judge %s failed", jid)
        finally:
            if counted:
                self.orchestrator.busy(-1)
                self._inflight = max(0, self._inflight - 1)
            if self.judging.get(jid) is asyncio.current_task():
                del self.judging[jid]

    async def _judge_call(self, messages: list[dict[str, str]], model: LlmConfig, who: str) -> tuple[Completion, str]:
        async with self._slots:
            return await _complete_with_room(self.complete_fn, messages, model, who)

    async def _send_judge(self, jid: str, ruling: Ruling) -> None:
        assert self.mod is not None
        body: dict[str, Any] = {"id": jid, "same": ruling.same, "why": ruling.why}
        if self.worker:
            body["worker"] = self.worker
        try:
            await self.mod.post("/api/agent/judge", body)
        except ModApiError as err:
            if err.status == 410:
                log.info("judge %s was already settled (a director ruled, it expired, or the run restarted)", jid)
            else:
                log.warning("could not send ruling %s: %s", jid, err)
