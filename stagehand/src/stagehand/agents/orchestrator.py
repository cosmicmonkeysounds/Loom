"""The orchestrator — the slow, deliberate model that *grows* a character.

Two models, two jobs. The fast model (gpt-oss, seconds) answers each line
in character and must stay snappy. The orchestrator (a larger-context,
more careful model — the Qwen 3.8 distill) never sits on the reply path.
It runs **between** turns, off the critical path, and rewrites the
character's `Mind` (see `mind.py`): the voice brief the fast model is
handed next time, the dossier on whoever just spoke, what was learned and
whether it was true, a rolling summary when a thread grows long, and —
every couple of minutes, or when the house changes phase — a survey of
the whole session (who is where, who holds what) so the character notices
the night moving.

Scheduling: one job at a time; a job waits for the fast path to be idle
for `quiet_s`; a request arriving mid-job **preempts** it (the HTTP call
is cancelled — Ollama frees the GPU — and the job re-runs later with the
same inputs). Replies always win. Jobs coalesce per thread, so ten quick
lines from one guest cost one reflection.

Every write it makes is bounded and merged by `Mind.apply`; the output
schema is restated at the end of each prompt because small models drift.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from .facts import Facts
from .llm import LlmConfig, LlmError
from .mind import Mind
from .persona import Persona
from .reply import extract_json, strip_think

log = logging.getLogger("stagehand.agents.orchestrator")

CompleteFn = Callable[[list[dict[str, str]], LlmConfig], Awaitable[str]]


@dataclass(frozen=True)
class OrchestratorConfig:
    enabled: bool = True
    #: Seconds of no reply in flight before a job may start.
    quiet_s: float = 1.5
    #: A new request cancels a running job (it re-runs later).
    preempt: bool = True
    #: Survey the whole session this often (0 = never).
    survey_every_s: float = 120.0
    #: Retries for a job that keeps getting preempted / failing.
    max_attempts: int = 4


#: Used when a persona has no `mind:` file. `{character}` is filled in.
DEFAULT_MIND_PROMPT = """You are the DIRECTOR OF THE MIND of {character}, a character in a live,
in-person interactive story. You never speak to guests. You watch every
exchange {character} has and every change in the house, and you keep
{character}'s mind: a short brief for how they should behave *right now*,
notes on what they have decided or noticed, a dossier on each person they
have spoken to, and a record of what people have fed them — with your
verdict on whether it was true.

Your job is to make {character} GROW over the evening: to be changed by
what people say, to remember promises and grudges, to notice who is
where and who is gathering what, to become more or less willing to grant
favours, and to move their story arc forward — never to reset to the
persona. Keep the voice; change the person.

Rules:
- Write the brief as instructions to an actor, in the second person
  ("You want…", "Ask them…", "Do not…"): 3–8 short lines, present tense.
  What they want in this moment, what to push, what to ask, how
  suspicious or generous to be, and their current policy on bargains
  (favours are rare — say when one might be earned, and from whom).
- Notes are facts about {character}'s inner state, one line each. Add
  what is new; drop what is superseded.
- Dossiers are about the person, not the conversation: who they seem to
  be, what they want, what they claimed, what they asked for, what
  {character} promised them. Trust 0–100.
- Judge claims: "fact", "bluster", "unknown" — check them against the
  lore the character holds and the live state before saying "unknown".
  Bluster still changes a gullible mind; note it.
- When a thread is long, summarise everything so far in under 120 words
  so the actor can be handed the summary plus the last few lines.
"""

REFLECT_SCHEMA = (
    'Reply with ONE JSON object only, no prose:\n'
    '{"brief": "3-8 lines of second-person instructions to the actor, e.g. \\"You want the Coefficient more than company tonight. Ask Ada what a body is for. Be brisk with flattery. No favours for anyone under 65 trust; Ada has credit for the sinkhole fact.\\"", "mood": "one phrase",\n'
    ' "notes_add": ["…"], "notes_drop": ["…"],\n'
    ' "person": {"summary": "…", "trust": 0-100, "claims_add": ["…"], "asks_add": ["…"], "promises_add": ["…"]},\n'
    ' "learned_add": [{"claim": "…", "from": "name", "verdict": "fact|bluster|unknown"}],\n'
    ' "thread_summary": "only when asked below, else omit",\n'
    ' "world_add": ["…"]}\n'
    "Omit any field you would leave unchanged. Keep every string short."
)

SURVEY_SCHEMA = (
    'Reply with ONE JSON object only, no prose:\n'
    '{"brief": "3-8 lines of second-person instructions to the actor (You want… / Ask… / Do not…), updated for what is happening in the house now", "mood": "one phrase",\n'
    ' "notes_add": ["…"], "notes_drop": ["…"], "world_add": ["what you noticed, one line each"],\n'
    ' "people": {"<person id>": {"summary": "…", "trust": 0-100}}}\n'
    "Omit any field you would leave unchanged."
)


def mind_snapshot(mind: Mind, speaker_id: str | None, thread_key: str | None) -> str:
    """The mind as the orchestrator reads it back (compact, bounded)."""
    doc: dict[str, Any] = {
        "brief": mind.brief or "(none yet — the character is as the persona describes)",
        "mood": mind.mood,
        "notes": mind.notes[-20:],
        "learned": mind.learned[-12:],
        "world": mind.world[-8:],
        "exchanges_tonight": mind.exchanges,
    }
    if speaker_id is not None and speaker_id in mind.people:
        d = mind.people[speaker_id]
        doc["this_person"] = {
            "id": d.id,
            "name": d.name,
            "kind": d.kind,
            "turns": d.turns,
            "trust": d.trust,
            "summary": d.summary,
            "claims": d.claims,
            "asks": d.asks,
            "promises": d.promises,
        }
    others = sorted((d for pid, d in mind.people.items() if pid != speaker_id), key=lambda d: -d.last_seen)[:12]
    if others:
        doc["other_people"] = [{"id": d.id, "name": d.name, "trust": d.trust, "summary": d.summary[:160]} for d in others]
    if thread_key is not None and thread_key in mind.threads and mind.threads[thread_key].summary:
        doc["thread_summary_so_far"] = mind.threads[thread_key].summary
    return json.dumps(doc, ensure_ascii=False)


def _system(persona: Persona) -> str:
    head = (persona.mind_prompt or DEFAULT_MIND_PROMPT).replace("{character}", persona.character)
    return f"{head}\n\n=== WHO {persona.character.upper()} IS (their persona, verbatim) ===\n{persona.system}"


def reflect_messages(
    persona: Persona,
    mind: Mind,
    req: dict[str, Any],
    reply: Any,
    facts: Facts | None,
    summarize_after: int,
    thread_key: str,
    max_lines: int = 14,
) -> list[dict[str, str]]:
    speaker = req.get("speaker") or {}
    sid = str(speaker.get("id") or "")
    name = speaker.get("name") or sid or "someone"
    history = [h for h in req.get("history", []) if isinstance(h, dict)]
    shown = history[-max_lines:]
    convo = "\n".join(f"{persona.character if h.get('mine') else name}: {h.get('text', '')}" for h in shown)
    said = getattr(reply, "say", "") or "(silence)"
    adjust = getattr(reply, "adjust", {}) or {}
    acts = getattr(reply, "acts", ()) or ()
    me = req.get("self") or {}
    them = req.get("them") or {}
    state = {
        "my_variables": me.get("vars") or {},
        "lore_i_hold": [f"{e.get('title')}: {' '.join(str(e.get('text', '')).split())[:160]}" for e in (me.get("codex") or [])[:12] if isinstance(e, dict)],
        "speaker": {"kind": speaker.get("kind"), "name": name, "group": speaker.get("faction"), "location": them.get("location"), "variables": them.get("vars") or {}, "holds": [e.get("title") for e in (them.get("codex") or [])]},
        "world": req.get("world") or {},
        "powers": [{"name": p.get("id"), "left": (None if p.get("limit") is None else max(0, int(p.get("limit", 0)) - int(p.get("used", 0))))} for p in req.get("powers") or []],
    }
    parts = [
        f"=== {persona.character.upper()}'S MIND NOW ===\n{mind_snapshot(mind, sid, thread_key)}",
        f"=== LIVE STATE ===\n{json.dumps(state, ensure_ascii=False)}",
    ]
    if facts is not None:
        parts.append(f"=== THE HOUSE ===\n{facts.digest()}")
        lore = lore_block(facts, [str(e.get("title", "")) for e in (me.get("codex") or []) if isinstance(e, dict)])
        if lore:
            parts.append(lore)
    parts.append(f"=== THE EXCHANGE JUST NOW (with {name}) ===\n{convo}\n{persona.character} (just replied): {said}")
    if adjust:
        parts.append(f"{persona.character} adjusted: {json.dumps(adjust)}")
    if acts:
        parts.append(f"{persona.character} ACTED: {json.dumps(list(acts), ensure_ascii=False)} — record any promise this fulfils or creates.")
    ask = [f"Update the mind for this exchange. The person's id is {sid!r}."]
    if len(history) >= summarize_after:
        ask.append(f"This thread is {len(history)} lines long: include \"thread_summary\" covering everything said so far (under 120 words).")
    ask.append(REFLECT_SCHEMA)
    parts.append("\n".join(ask))
    return [{"role": "system", "content": _system(persona)}, {"role": "user", "content": "\n\n".join(parts)}]


def lore_block(facts: Facts, held: list[str], max_entries: int = 24) -> str:
    """The story's whole codex — ground truth for the director's verdicts.
    The *character* knows only the entries marked held; the director knows
    everything, and decides how a character who doesn't know reacts."""
    entries = facts.codex[:max_entries]
    if not entries:
        return ""
    held_set = {h.lower() for h in held}
    lines = ["=== THE STORY'S LORE (ground truth for your verdicts — the character HOLDS only the entries marked ★; judge claims against all of it, then decide what a character who may not know reacts like) ==="]
    for e in entries:
        title = str(e.get("title", ""))
        mark = "★ " if title.lower() in held_set else "  "
        text = " ".join(str(e.get("text", "")).split())[:220]
        lines.append(f"{mark}{title}: {text}")
    return "\n".join(lines)


def survey_messages(persona: Persona, mind: Mind, facts: Facts, delta: list[str]) -> list[dict[str, str]]:
    parts = [
        f"=== {persona.character.upper()}'S MIND NOW ===\n{mind_snapshot(mind, None, None)}",
        f"=== THE HOUSE NOW ===\n{facts.digest()}",
    ]
    if delta:
        parts.append("=== WHAT CHANGED SINCE YOU LAST LOOKED ===\n" + "\n".join(f"- {d}" for d in delta))
    else:
        parts.append("=== WHAT CHANGED SINCE YOU LAST LOOKED ===\n(nothing you can see — but time has passed)")
    parts.append(
        f"Nobody is talking to {persona.character} right now. Look at the house and decide how {persona.character} "
        f"feels about it and what they should do with the next person who speaks to them. " + SURVEY_SCHEMA
    )
    return [{"role": "system", "content": _system(persona)}, {"role": "user", "content": "\n\n".join(parts)}]


def parse_update(raw: str) -> dict[str, Any] | None:
    doc = extract_json(strip_think(raw or ""))
    return doc if isinstance(doc, dict) else None


@dataclass
class Job:
    kind: str  # reflect | survey
    character: str
    key: str
    payload: dict[str, Any] = field(default_factory=dict)
    attempts: int = 0
    queued_at: float = field(default_factory=time.time)


OnUpdate = Callable[[str, Mind, Job, list[str]], Awaitable[None]]


class Orchestrator:
    """The job runner. One instance per worker; minds are keyed by character."""

    def __init__(
        self,
        cfg: OrchestratorConfig,
        complete_fn: CompleteFn,
        models: dict[str, LlmConfig],
        personas: dict[str, Persona],
        minds: dict[str, Mind],
        on_update: OnUpdate | None = None,
        facts_fn: Callable[[bool], Awaitable[Facts | None]] | None = None,
    ) -> None:
        self.cfg = cfg
        self.complete_fn = complete_fn
        self.models = models
        self.personas = personas
        self.minds = minds
        self.on_update = on_update
        self.facts_fn = facts_fn
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._wake = asyncio.Event()
        self._inflight = 0
        self._last_reply_done = 0.0
        self._current: asyncio.Task[None] | None = None
        self._current_job: Job | None = None
        self._preempted = False
        self._last_facts: Facts | None = None
        self._last_survey = 0.0
        self.completed = 0

    # -- what the fast path tells us ------------------------------------------

    def busy(self, delta: int) -> None:
        """The fast path started (+1) / finished (−1) a reply."""
        self._inflight = max(0, self._inflight + delta)
        if delta < 0:
            self._last_reply_done = time.time()
        if delta > 0 and self.cfg.preempt and self._current is not None and not self._current.done():
            self._preempted = True
            self._current.cancel()

    @property
    def idle(self) -> bool:
        return self._inflight == 0 and time.time() - self._last_reply_done >= self.cfg.quiet_s

    def submit(self, job: Job) -> None:
        if not self.cfg.enabled:
            return
        prev = self._jobs.pop(job.key, None)
        if prev is not None:
            job.attempts = prev.attempts
        self._jobs[job.key] = job
        self._wake.set()

    def reflect(self, character: str, thread_key: str, req: dict[str, Any], reply: Any) -> None:
        self.submit(Job("reflect", character, f"reflect:{character}:{thread_key}", {"req": req, "reply": reply, "thread_key": thread_key}))

    def survey(self, character: str) -> None:
        self.submit(Job("survey", character, f"survey:{character}"))

    def drop_all(self) -> None:
        """The run restarted: nothing queued is about this night any more."""
        self._jobs.clear()
        self._last_facts = None
        if self._current is not None and not self._current.done():
            self._preempted = False
            self._current.cancel()

    @property
    def pending(self) -> int:
        return len(self._jobs)

    # -- the loop --------------------------------------------------------------

    async def run(self) -> None:
        if not self.cfg.enabled:
            return
        while True:
            if not self._jobs:
                self._wake.clear()
                if self.cfg.survey_every_s > 0:
                    try:
                        await asyncio.wait_for(self._wake.wait(), timeout=max(1.0, self.cfg.survey_every_s / 4))
                    except asyncio.TimeoutError:
                        self._maybe_schedule_surveys()
                        continue
                else:
                    await self._wake.wait()
                continue
            while not self.idle:
                await asyncio.sleep(0.25)
            key, job = next(iter(self._jobs.items()))
            del self._jobs[key]
            job.attempts += 1
            self._preempted = False
            self._current_job = job
            self._current = asyncio.ensure_future(self._execute(job))
            try:
                await self._current
            except asyncio.CancelledError:
                if not self._preempted:
                    if asyncio.current_task() is not None and asyncio.current_task().cancelling():  # type: ignore[union-attr]
                        raise
                    continue  # dropped by a reset
                if job.attempts < self.cfg.max_attempts:
                    log.debug("orchestrator: %s preempted by a reply — will retry", job.key)
                    self._jobs[job.key] = job
                    self._jobs.move_to_end(job.key, last=False)
                else:
                    log.warning("orchestrator: giving up on %s after %d attempts", job.key, job.attempts)
            except Exception:  # noqa: BLE001 — one bad job must not stop the mind
                log.exception("orchestrator: %s failed", job.key)
            finally:
                self._current = None
                self._current_job = None

    def _maybe_schedule_surveys(self) -> None:
        if self.cfg.survey_every_s <= 0:
            return
        if time.time() - self._last_survey < self.cfg.survey_every_s:
            return
        for character in self.minds:
            self.survey(character)

    async def _execute(self, job: Job) -> None:
        persona = self.personas.get(job.character)
        mind = self.minds.get(job.character)
        model = self.models.get(job.character)
        if persona is None or mind is None or model is None:
            return
        facts = None
        if self.facts_fn is not None:
            facts = await self.facts_fn(job.kind == "survey")
        if job.kind == "reflect":
            req = job.payload["req"]
            thread_key = job.payload["thread_key"]
            messages = reflect_messages(persona, mind, req, job.payload["reply"], facts, persona.summarize_after, thread_key)
            speaker_id = str((req.get("speaker") or {}).get("id") or "")
            history = [h for h in req.get("history", []) if isinstance(h, dict)]
            upto = max((int(h.get("seq", 0)) for h in history), default=0)
        else:
            if facts is None:
                return
            delta = facts.delta(self._last_facts)
            self._last_facts = facts
            self._last_survey = time.time()
            if mind.surveys > 0 and not delta and mind.exchanges == 0:
                return  # a quiet house and nothing said: nothing to think about
            messages = survey_messages(persona, mind, facts, delta)
            speaker_id = None
            thread_key = None
            upto = 0
        started = time.time()
        try:
            raw = await self.complete_fn(messages, model)
        except LlmError as err:
            log.warning("orchestrator: model failed for %s (%s)", job.character, err)
            return
        update = parse_update(raw)
        if update is None:
            log.warning("orchestrator: unusable output for %s: %r", job.character, (raw or "")[:200])
            return
        touched = mind.apply(update, speaker_id=speaker_id or None, thread_key=thread_key, upto=upto)
        if job.kind == "reflect":
            mind.reflections += 1
        else:
            mind.surveys += 1
        self.completed += 1
        log.info("%s's mind: %s updated %s (%.1fs)", job.character, job.kind, ", ".join(touched) or "nothing", time.time() - started)
        if self.on_update is not None:
            await self.on_update(job.character, mind, job, touched)
