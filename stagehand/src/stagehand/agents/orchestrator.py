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

The mind has **structure the orchestrator must fill**: the character's
place on its declared arc (`stage`, one of the mind file's `stages:`),
its `drives` (0–100 dials declared in the same frontmatter), a `policy`
on favours, and the open `questions` it is collecting answers to. The
story's phase changes carry an authored cue (`phases:`) into the prompt,
and a director's whispers (the control panel's *nudge*) are shown once
and consumed.

Scheduling: one job at a time; a job waits for the fast path to be idle
for `quiet_s`; a request arriving mid-job **preempts** it (the HTTP call
is cancelled — Ollama frees the GPU — and the job re-runs later with the
same inputs). Replies always win. Jobs coalesce per thread, so ten quick
lines from one guest cost one reflection. A director can **pause** the
orchestrator (jobs queue, nothing runs), toggle the model's visible
reasoning, or **re-run** a recorded call to compare answers.

Every model call is recorded as a `Thought` in the worker's `Trace`
(input messages, reasoning, raw output, the parsed update, the mind diff
it caused, the revision it produced). Every write it makes is bounded and
merged by `Mind.apply`; the output schema is restated at the end of each
prompt because small models drift.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Any

from .facts import Facts, fold, world_view
from .llm import Completion, LlmConfig, LlmError
from .mind import MAX_ANSWERS, MAX_PER_PERSON, Mind
from .persona import Persona
from .prompt import build_messages, gate_context, matching_situations, their_variables
from .reply import Reply, extract_json, strip_think
from .secrets import Secrets, drop_counts, split_dropped
from .trace import Thought, Trace, new_thought

log = logging.getLogger("stagehand.agents.orchestrator")

CompleteFn = Callable[[list[dict[str, str]], LlmConfig], Awaitable[Any]]


@dataclass(frozen=True)
class OrchestratorConfig:
    enabled: bool = True
    #: Seconds of no reply in flight before a job may start.
    quiet_s: float = 1.5
    #: A new request cancels a running job (it re-runs later).
    preempt: bool = True
    #: Survey the whole session this often (0 = never: no timer survey and
    #: no first look on a stream hello; a director's survey still runs).
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
    ' "stage": "<one of the declared stages>", "stage_why": "one line, only when the stage moves",\n'
    ' "drives": {"<declared drive>": 0-100},\n'
    ' "policy": {"favours": "none|earned|loose", "credit": ["names with credit"], "wary": ["names to distrust"], "note": "one line"},\n'
    ' "questions_add": ["a question the character is now collecting answers to"], "questions_drop": ["…"],\n'
    ' "answers_add": [{"q": "the question", "answer": "…", "from": "name"}],\n'
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
    ' "stage": "<one of the declared stages>", "stage_why": "one line, only when the stage moves",\n'
    ' "drives": {"<declared drive>": 0-100},\n'
    ' "policy": {"favours": "none|earned|loose", "credit": ["…"], "wary": ["…"], "note": "one line"},\n'
    ' "questions_add": ["…"], "questions_drop": ["…"],\n'
    ' "notes_add": ["…"], "notes_drop": ["…"], "world_add": ["what you noticed, one line each"],\n'
    ' "people": {"<person id>": {"summary": "…", "trust": 0-100}}}\n'
    "Omit any field you would leave unchanged."
)


def mind_snapshot(mind: Mind, speaker_id: str | None, thread_key: str | None) -> str:
    """The mind as the orchestrator reads it back (compact, bounded)."""
    doc: dict[str, Any] = {
        "brief": mind.brief or "(none yet — the character is as the persona describes)",
        "mood": mind.mood,
        "stage": mind.stage or "(not yet placed)",
        "drives": mind.drives,
        "policy": mind.policy,
        "questions": mind.questions[-MAX_SNAPSHOT_QUESTIONS:],
        "notes": mind.notes[-20:],
        "learned": mind.learned[-12:],
        "world": mind.world[-8:],
        "exchanges_tonight": mind.exchanges,
    }
    if mind.stage_history:
        doc["stage_history"] = [{"stage": h.get("stage"), "why": h.get("why")} for h in mind.stage_history[-4:]]
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


MAX_SNAPSHOT_QUESTIONS = 6


def structure_block(persona: Persona, mind: Mind) -> str:
    """What the mind file declared: the arc to steer along, the drives to
    keep, and the rules for both. Shown in every orchestrator prompt."""
    lines = []
    stages = mind.stages or list(persona.stages)
    if stages:
        lines.append(
            "=== THE ARC (declared stages, in order) ===\n"
            + " → ".join(stages)
            + f"\nThe character is at: {mind.stage or stages[0]}. Set \"stage\" every time. Move FORWARD only when the evidence "
            "in this exchange or the house supports it, and give \"stage_why\" when you move it. Never move back without a clear cause. "
            "Everything else you write (brief, mood, policy) should sound like this stage."
        )
    if mind.drives:
        lines.append(
            "=== THE DRIVES (0–100; the character's inner dials, not the story's variables) ===\n"
            + ", ".join(f"{k} = {v}" for k, v in mind.drives.items())
            + "\nSet \"drives\" every time, moving each by what just happened (a few points for a normal exchange; more for a shock). "
            "Let the brief follow the drives."
        )
    lines.append(
        "=== THE POLICY ===\n"
        "\"policy.favours\" is how the character grants bargains right now: none (unthinkable), earned (only for what has been "
        "paid for in this conversation), loose (generous — grandiose or in love). \"credit\" names people who have earned "
        "something; \"wary\" names people who lied or pushed. Set it every time it should change."
    )
    lines.append(
        "=== THE QUESTIONS ===\n"
        "The character collects answers to a few open questions (its obsessions). Add one with \"questions_add\" when a new "
        "obsession forms, record what people answer with \"answers_add\", drop a question once it is settled."
    )
    return "\n\n".join(lines)


def _system(persona: Persona, mind: Mind | None = None) -> str:
    head = (persona.mind_prompt or DEFAULT_MIND_PROMPT).replace("{character}", persona.character)
    parts = [head]
    if mind is not None:
        parts.append(structure_block(persona, mind))
    parts.append(f"=== WHO {persona.character.upper()} IS (their persona, verbatim) ===\n{persona.system}")
    rule = persona.secrets.rule(persona.character)
    if rule:
        parts.append(rule)
    return "\n\n".join(parts)


def phase_cue(persona: Persona, phase: str | None) -> str | None:
    if phase is None:
        return None
    cue = persona.phase_cues.get(phase)
    if cue is None:
        key = "".join(ch for ch in phase.lower() if ch.isalnum())
        for k, v in persona.phase_cues.items():
            if "".join(ch for ch in k.lower() if ch.isalnum()) == key:
                cue = v
                break
    return cue


def director_block(mind: Mind) -> str | None:
    if not mind.director:
        return None
    return (
        "=== THE DIRECTOR WHISPERS (a human running the show; fold every line into the brief and the drives, then it is done) ===\n"
        + "\n".join(f"- {d}" for d in mind.director)
    )


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
        "lore_i_hold": [f"{e.get('title')}: {' '.join(str(e.get('text', '')).split())[:160]}" for e in persona.secrets.visible(me.get("codex"))[:12]],
        "speaker": {"kind": speaker.get("kind"), "name": name, "group": speaker.get("faction"), "location": them.get("location"), "variables": their_variables(persona, them.get("vars")), "holds": [e.get("title") for e in persona.secrets.visible(them.get("codex"))]},
        "world": world_view(req.get("world") or {}, persona.facts),
        "powers": [{"name": p.get("id"), "left": (None if p.get("limit") is None else max(0, int(p.get("limit", 0)) - int(p.get("used", 0))))} for p in req.get("powers") or []],
    }
    parts = [
        f"=== {persona.character.upper()}'S MIND NOW ===\n{mind_snapshot(mind, sid, thread_key)}",
        f"=== LIVE STATE ===\n{json.dumps(state, ensure_ascii=False)}",
    ]
    phase = next((str(v) for k, v in (req.get("world") or {}).items() if str(k).endswith(".phase")), None)
    cue = phase_cue(persona, phase)
    if cue:
        parts.append(f"=== THE STORY'S PHASE: {phase} (the author's cue for this phase) ===\n{cue}")
    if facts is not None:
        parts.append(f"=== THE HOUSE ===\n{facts.digest(secrets=persona.secrets, world_prefixes=persona.facts)}")
        lore = lore_block(facts, [str(e.get("title", "")) for e in (me.get("codex") or []) if isinstance(e, dict)], secrets=persona.secrets)
        if lore:
            parts.append(lore)
    for situation in matching_situations(persona, req):
        parts.append(
            f"=== THE SITUATION WITH {name} ({situation.heading}; the voice was given this for the exchange below. "
            f"The brief is read in every conversation: write what holds only here into this person's dossier and notes, "
            f"and keep everything this block forbids out of all of them) ===\n{situation.prompt}"
        )
    whisper = director_block(mind)
    if whisper:
        parts.append(whisper)
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
    return [{"role": "system", "content": _system(persona, mind)}, {"role": "user", "content": "\n\n".join(parts)}]


#: Characters per token — a safe overestimate for English + JSON.
CHARS_PER_TOKEN = 3
#: The late-night house `reflect_tokens_needed` sizes for: the show's guest
#: list with room to spare, every room of the map, a full lore block.
LATE_PROGRAMS = 45
LATE_ROOMS = 17
LATE_LORE = 60


def _filler(n: int, word: str = "note") -> str:
    """`n` characters of plain words (no hunt answer, no marker)."""
    return (f"{word} " * (n // (len(word) + 1) + 1))[:n].strip()


def late_night_mind(persona: Persona) -> Mind:
    """A mind as the end of a busy night leaves it: every list the reflect
    snapshot shows filled to its cap (notes 20, learned 12, world 8,
    questions 6 with answers, a stage history, a speaker dossier at
    `MAX_PER_PERSON` and 12 others), at the lengths the orchestrator
    really writes: a little over the means measured on rehearsal minds
    (notes ≈ 50 characters, claims ≈ 55, a dossier summary ≈ 160), not
    the caps' 300, which no reply fills — `CHARS_PER_TOKEN` already
    overestimates the tokens by a quarter."""
    mind = Mind(character=persona.character)
    mind.seed(persona.stages, persona.drives)
    mind.brief = _filler(400, "brief")
    mind.mood = _filler(40, "mood")
    mind.policy = {"favours": "earned", "credit": [f"Program Name {i:02d}" for i in range(6)], "wary": [f"Program Name {i:02d}" for i in range(6, 12)], "note": _filler(80, "policy")}
    mind.questions = [{"q": _filler(60, "question"), "answers": [_filler(70, "answer") for _ in range(MAX_ANSWERS)]} for _ in range(MAX_SNAPSHOT_QUESTIONS)]
    mind.notes = [_filler(60) for _ in range(20)]
    mind.learned = [{"claim": _filler(70, "claim"), "from": "Program Name 01", "verdict": "bluster"} for _ in range(12)]
    mind.world = [_filler(60, "world") for _ in range(8)]
    stages = mind.stages or ["stage"]
    mind.stage_history = [{"stage": stages[i % len(stages)], "why": _filler(100, "why")} for i in range(4)]
    mind.exchanges = 400
    for i in range(13):
        d = mind.dossier(f"g{i}", f"Program Name {i:02d}")
        d.summary = _filler(200, "summary")
        d.trust, d.turns, d.last_seen = 40, 9, float(i)
        d.claims = [_filler(60, "claim") for _ in range(MAX_PER_PERSON)]
        d.asks = [_filler(60, "ask") for _ in range(MAX_PER_PERSON)]
        d.promises = [_filler(60, "promise") for _ in range(MAX_PER_PERSON)]
    mind.thread("late").summary = _filler(800, "summary")
    return mind


def late_night_request(persona: Persona) -> tuple[dict[str, Any], Facts]:
    """The request + house of a late-night reflection: a long thread with
    the speaker (80-character guest lines, 200-character replies), the
    character holding a full lore block,
    `LATE_PROGRAMS` programs, `LATE_ROOMS` crowded rooms."""
    titles = [f"Lore Entry Number {i:02d}" for i in range(LATE_LORE)]
    codex = [{"id": f"c{i}", "title": t, "text": _filler(400, "lore"), "holders": [persona.character]} for i, t in enumerate(titles)]
    names = [f"Program Name {i:02d}" for i in range(LATE_PROGRAMS)]
    programs = [{"id": f"g{i}", "name": n, "faction": "Chatters", "codex": titles[:3]} for i, n in enumerate(names)]
    rooms = [{"id": f"r{i}", "label": f"The Room Number {i:02d}", "occupants": names[i::LATE_ROOMS]} for i in range(LATE_ROOMS)]
    world = {"Night.phase": "free_roam", **{f"Night.flag_{i:02d}": "true" for i in range(12)}}
    history = [{"seq": i, "mine": i % 2 == 0, "text": _filler(200 if i % 2 == 0 else 80, "line")} for i in range(1, 41)]
    vars_ = {f"var_{i:02d}": "50" for i in range(8)}
    req = {
        "speaker": {"kind": "guest", "id": "g0", "name": names[0], "faction": "Chatters"},
        "history": history,
        "self": {"vars": vars_, "codex": [{"title": t, "text": _filler(400, "lore")} for t in titles]},
        "them": {"vars": vars_, "codex": [{"title": t} for t in titles[:12]], "location": rooms[0]["label"]},
        "world": world,
        "powers": [{"id": f"power number {i:02d}", "limit": 2, "used": 1} for i in range(11)],
    }
    return req, Facts({"world": world, "programs": programs, "locations": rooms, "codex": codex})


def reflect_tokens_needed(persona: Persona, max_tokens: int) -> int:
    """≈ the context one reflection needs late in the night: the real
    reflect prompt (this persona's mind file + persona) built over
    `late_night_mind` and `late_night_request`, every persona situation
    as if it held, plus the reply's
    `max_tokens`. `stagehand check` compares it with the model's context —
    Ollama cuts the middle of a prompt that doesn't fit."""
    req, facts = late_night_request(persona)
    acts = tuple({"kind": "fire", "name": f"power number {i:02d}"} for i in range(2))
    reply = Reply(say=_filler(600, "say"), adjust={f"var_{i:02d}": 5 for i in range(4)}, acts=acts)
    msgs = reflect_messages(persona, late_night_mind(persona), req, reply, facts, persona.summarize_after, "late")
    # The synthetic speaker matches no situation; count every one as if
    # all of them held (each is a heading line plus its prompt).
    chars = sum(len(m["content"]) for m in msgs) + sum(len(s.prompt) + 200 for s in persona.situations)
    return chars // CHARS_PER_TOKEN + max_tokens


def voice_tokens_needed(persona: Persona, max_tokens: int, with_mind: bool = True) -> int:
    """≈ the context one spoken line needs late in the night: the real
    voice prompt (`build_messages`) over `late_night_request` with the
    `late_night_mind` block (`with_mind` — the orchestrator is on), every
    persona situation as if it held, plus the reply's `max_tokens`
    (reasoning counts against it). `stagehand check` compares it with the
    voice model's context, as `reflect_tokens_needed` does for the mind."""
    req, _facts = late_night_request(persona)
    msgs = build_messages(persona, req, mind=late_night_mind(persona) if with_mind else None)
    chars = sum(len(m["content"]) for m in msgs) + sum(len(s.prompt) + 200 for s in persona.situations)
    return chars // CHARS_PER_TOKEN + max_tokens


def suppressed_summary(dropped: list[str]) -> str:
    """The director's log line for a scrub: hunt verdicts and secrets (the
    door code, a combination) counted apart — a K-04 mind run tells a
    program feeding him the code from a hunt claim."""
    hunt, never = split_dropped(dropped)
    return drop_counts(len(hunt), len(never))


def lore_block(facts: Facts, held: list[str], max_entries: int = 60, secrets: Secrets | None = None, max_text: int = 160) -> str:
    """The story's whole codex — ground truth for the director's verdicts.
    The *character* knows only the entries marked held; the director knows
    everything, and decides how a character who doesn't know reacts —
    except the hunt answers (`secrets.lore`), which nobody here may check.
    The secrecy filter runs first; then the held entries lead (model order),
    then the rest (model order), and the cap cuts the tail — so a held
    entry declared late in the codex is never sliced off. An entry the
    character doesn't hold that names a hunt answer word (a clue such as
    The Rival's "Grok") is left out too: it would be a key to judge the
    hunt by. Bare-number answers (11, 1978) are not used for that — dates
    and clocks across the codex carry them by chance."""
    visible = secrets.visible(facts.codex) if secrets else facts.codex
    held_set = {h.lower() for h in held}
    words = tuple(w for w in (secrets.match if secrets else ()) if any(c.isalpha() for c in w))
    if words:
        clue = Secrets(match=words)
        visible = [e for e in visible if str(e.get("title", "")).lower() in held_set or not clue.names_topic(f"{e.get('title', '')}\n{e.get('text', '')}")]
    is_held = [str(e.get("title", "")).lower() in held_set for e in visible]
    entries = ([e for e, h in zip(visible, is_held) if h] + [e for e, h in zip(visible, is_held) if not h])[:max_entries]
    if not entries:
        return ""
    lines = ["=== THE STORY'S LORE (ground truth for your verdicts — the character HOLDS only the entries marked ★; judge claims against all of it, then decide what a character who may not know reacts like) ==="]
    for e in entries:
        title = str(e.get("title", ""))
        mark = "★ " if title.lower() in held_set else "  "
        text = " ".join(str(e.get("text", "")).split())[:max_text]
        lines.append(f"{mark}{title}: {text}")
    return "\n".join(lines)


def survey_messages(persona: Persona, mind: Mind, facts: Facts, delta: list[str], phase_changed_to: str | None = None) -> list[dict[str, str]]:
    parts = [
        f"=== {persona.character.upper()}'S MIND NOW ===\n{mind_snapshot(mind, None, None)}",
        f"=== THE HOUSE NOW ===\n{facts.digest(secrets=persona.secrets, world_prefixes=persona.facts)}",
    ]
    if delta:
        parts.append("=== WHAT CHANGED SINCE YOU LAST LOOKED ===\n" + "\n".join(f"- {d}" for d in delta))
    else:
        parts.append("=== WHAT CHANGED SINCE YOU LAST LOOKED ===\n(nothing you can see — but time has passed)")
    cue = phase_cue(persona, phase_changed_to or facts.phase)
    if cue:
        label = f"THE HOUSE JUST ENTERED: {phase_changed_to}" if phase_changed_to else f"THE STORY'S PHASE: {facts.phase}"
        parts.append(f"=== {label} (the author's cue for this phase) ===\n{cue}")
    whisper = director_block(mind)
    if whisper:
        parts.append(whisper)
    parts.append(
        f"Nobody is talking to {persona.character} right now. Look at the house and decide how {persona.character} "
        f"feels about it and what they should do with the next person who speaks to them. " + SURVEY_SCHEMA
    )
    return [{"role": "system", "content": _system(persona, mind)}, {"role": "user", "content": "\n\n".join(parts)}]


def parse_update(raw: str) -> dict[str, Any] | None:
    doc = extract_json(strip_think(raw or ""))
    return doc if isinstance(doc, dict) else None


@dataclass
class Job:
    kind: str  # reflect | survey | rerun
    character: str
    key: str
    payload: dict[str, Any] = field(default_factory=dict)
    attempts: int = 0
    queued_at: float = field(default_factory=time.time)
    #: Why it was queued (`exchange`, `timer`, `hello`, `phase`, `director`, `rerun:<id>`).
    trigger: str = ""


OnUpdate = Callable[[str, Mind, Job, list[str]], Awaitable[None]]


@dataclass
class SurveyMark:
    """What the last survey that reached the model saw, per character: the
    house it looked at, how many exchanges the mind had had, and the exact
    messages it sent. The skip rules compare the next survey against it."""

    facts: Facts
    exchanges: int
    messages: list[dict[str, str]]


#: Survey triggers the `survey_every_s: 0` switch turns off.
CLOCK_TRIGGERS = ("timer", "hello")

#: How much a survey trigger bypasses: a `director` survey every skip rule, a
#: `phase` survey the idle one, anything else none. Every survey of a character
#: shares one queue key, so a weaker trigger queued behind a stronger one must
#: never take its place (a stream hello behind a director's Survey now).
SURVEY_RANK = {"director": 2, "phase": 1}


def survey_rank(trigger: str) -> int:
    return SURVEY_RANK.get(trigger or "timer", 0)


#: Gate path heads that name the person talking, unknown to a survey.
SPEAKER_HEADS = ("them", "speaker")


def character_vars(facts: Facts, character: str) -> dict[str, Any] | None:
    """The character's own variables as the facts document carries them, or
    None when the document does not list the character (an old server, a
    secret character): then nothing is known about its gate."""
    key = fold(character)
    for c in facts.characters:
        if fold(str(c.get("id", ""))) == key:
            v = c.get("vars")
            return dict(v) if isinstance(v, dict) else {}
    return None


def asleep(persona: Persona, facts: Facts) -> bool:
    """The persona's `when:` gate is false over the house as the facts show
    it (the world paths and the character's own vars; nobody speaking): the
    character is offline, so there is nothing for it to look at.

    A gate that reads `them.` or `speaker.` depends on who is talking (a
    performer exception, say), so the house alone can't close it: such a
    gate never reads as asleep."""
    if persona.when is None:
        return False
    if any(n.split(".", 1)[0] in SPEAKER_HEADS for n in persona.when.names()):
        return False
    mine = character_vars(facts, persona.character)
    if mine is None:
        return False
    ctx = gate_context({"world": facts.world, "self": {"vars": mine}, "them": {}, "speaker": {}})
    try:
        return not persona.when.evaluate(ctx)
    except Exception:  # noqa: BLE001 — a gate that can't be read never silences the mind
        return False


def survey_skip(
    job: Job,
    persona: Persona,
    mind: Mind,
    facts: Facts,
    mark: SurveyMark | None,
    delta: list[str],
    phase_changed: bool,
) -> str | None:
    """Why this survey should not reach the model, or None to run it (the
    rules that need no prompt built; `same_survey` is the last one). A
    `director` survey always runs; a `phase` survey (queued for, or finding,
    a phase change) is spared only the idle rule."""
    if job.trigger == "director":
        return None
    if facts.raw.get("paused") is True:
        return "the event is paused"
    if asleep(persona, facts):
        return "asleep (the persona's when: gate is closed)"
    if (facts.phase or "").startswith("finale"):
        return "after the ending"
    is_phase = job.trigger == "phase" or phase_changed
    if not is_phase and mark is not None and mind.exchanges == mark.exchanges and not mind.director and not delta and facts.phase == mark.facts.phase:
        return "idle (no line, no whisper, no change since the last survey)"
    return None


def same_survey(job: Job, mark: SurveyMark | None, messages: list[dict[str, str]]) -> str | None:
    """The built survey is byte for byte the last one the model answered:
    the model would only be asked the same question again."""
    if job.trigger == "director" or mark is None or messages != mark.messages:
        return None
    return "the same input as the last survey"


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
        trace: Trace | None = None,
    ) -> None:
        self.cfg = cfg
        self.complete_fn = complete_fn
        self.models = dict(models)
        self.personas = personas
        self.minds = minds
        self.on_update = on_update
        self.facts_fn = facts_fn
        self.trace = trace
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._wake = asyncio.Event()
        self._inflight = 0
        self._last_reply_done = 0.0
        self._current: asyncio.Task[None] | None = None
        self._current_job: Job | None = None
        self._preempted = False
        #: The last survey that reached the model, per character.
        self._marks: dict[str, SurveyMark] = {}
        self._last_survey = 0.0
        self.completed = 0
        #: Surveys the skip rules kept from the model.
        self.skipped = 0
        self.paused = False
        self.last_error: str | None = None

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
        prev = self._jobs.get(job.key)
        if prev is not None and prev.kind == "survey" and job.kind == "survey" and survey_rank(prev.trigger) > survey_rank(job.trigger):
            # The queued survey bypasses more of the skip rules than this one:
            # it stays, trigger and place, and covers this one too.
            self._wake.set()
            return
        prev = self._jobs.pop(job.key, None)
        if prev is not None:
            job.attempts = prev.attempts
        self._jobs[job.key] = job
        self._wake.set()

    def reflect(self, character: str, thread_key: str, req: dict[str, Any], reply: Any) -> None:
        self.submit(Job("reflect", character, f"reflect:{character}:{thread_key}", {"req": req, "reply": reply, "thread_key": thread_key}, trigger="exchange"))

    def survey(self, character: str, trigger: str = "timer") -> None:
        if self.cfg.survey_every_s <= 0 and (trigger or "timer") in CLOCK_TRIGGERS:
            # `survey_every_s: 0`: no timer and no hello survey — not even queued
            # (rule 1; `_execute` keeps the same check for a job queued earlier).
            self.skipped += 1
            log.debug("orchestrator: skipped the %s survey for %s: survey_every_s is 0", trigger or "timer", character)
            return
        self.submit(Job("survey", character, f"survey:{character}", trigger=trigger))

    def rerun(self, thought: Thought, model: LlmConfig | None = None) -> None:
        """Run a recorded call again, against the model as configured now
        (`model` for a voice thought — the orchestrator's own otherwise);
        the result is recorded but never applied."""
        self.submit(Job("rerun", thought.character, f"rerun:{thought.id}", {"thought": thought, "model": model}, trigger=f"rerun:{thought.id}"))

    def drop_all(self) -> None:
        """The run restarted: nothing queued is about this night any more."""
        self._jobs.clear()
        self._marks.clear()
        if self._current is not None and not self._current.done():
            self._preempted = False
            self._current.cancel()

    @property
    def pending(self) -> int:
        return len(self._jobs)

    @property
    def running(self) -> str | None:
        return self._current_job.key if self._current_job is not None else None

    # -- the director's knobs ----------------------------------------------------

    def set_paused(self, on: bool) -> None:
        self.paused = on
        if not on:
            self._wake.set()

    def thinking(self, character: str) -> bool:
        """Is the orchestrator model's visible reasoning on for this character?"""
        model = self.models.get(character)
        if model is None:
            return False
        think = model.extra.get("think") if isinstance(model.extra, dict) else None
        if think is None:
            return bool(model.reasoning_effort)
        return bool(think)

    def set_thinking(self, character: str, on: bool) -> bool:
        """Switch the orchestrator model's reasoning on/off for one character
        (Ollama's `think`; on the OpenAI dialect, `reasoning_effort`). The
        debugger shows the reasoning when it is on; off is faster."""
        model = self.models.get(character)
        if model is None:
            return False
        extra = dict(model.extra)
        if model.api == "ollama":
            extra["think"] = on
            self.models[character] = replace(model, extra=extra, reasoning_effort=("low" if on else None) if model.model.startswith("gpt-oss") else model.reasoning_effort)
        else:
            extra.pop("think", None)
            self.models[character] = replace(model, extra=extra, reasoning_effort="low" if on else None)
        return True

    def status(self, character: str) -> dict[str, Any]:
        model = self.models.get(character)
        return {
            "enabled": self.cfg.enabled,
            "paused": self.paused,
            "pending": [j.key for j in self._jobs.values() if j.character == character],
            "running": self.running if self._current_job is not None and self._current_job.character == character else None,
            "completed": self.completed,
            "thinking": self.thinking(character),
            "model": model.model if model is not None else None,
            "surveyEveryS": self.cfg.survey_every_s,
            "lastError": self.last_error,
        }

    # -- the loop --------------------------------------------------------------

    async def run(self) -> None:
        if not self.cfg.enabled:
            return
        while True:
            if not self._jobs or self.paused:
                self._wake.clear()
                if self.cfg.survey_every_s > 0 and not self.paused:
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
            self.survey(character, "timer")

    async def _record(self, thought: Thought) -> None:
        if self.trace is not None:
            await self.trace.record(thought)

    async def _execute(self, job: Job) -> None:
        persona = self.personas.get(job.character)
        mind = self.minds.get(job.character)
        model = self.models.get(job.character)
        if persona is None or mind is None or model is None:
            return
        if job.kind == "rerun":
            await self._rerun(job, job.payload.get("model") or model)
            return
        if job.kind == "survey" and self.cfg.survey_every_s <= 0 and (job.trigger or "timer") in CLOCK_TRIGGERS:
            # `survey_every_s: 0` turns the survey clock off, the first look
            # on a stream hello included: no facts fetched, no model call.
            self.skipped += 1
            log.debug("orchestrator: skipped the %s survey for %s: survey_every_s is 0", job.trigger or "timer", job.character)
            return
        facts = None
        if self.facts_fn is not None:
            facts = await self.facts_fn(job.kind == "survey")
        phase_changed_to: str | None = None
        survey_mark: SurveyMark | None = None
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
            self._last_survey = time.time()
            # The delta and the phase change are since the last survey that
            # reached the model, so a skipped one never hides a change.
            mark = self._marks.get(job.character)
            delta = facts.delta(mark.facts if mark is not None else None, persona.secrets, persona.facts)
            if mark is not None and mark.facts.phase != facts.phase:
                phase_changed_to = facts.phase
            why = survey_skip(job, persona, mind, facts, mark, delta, phase_changed_to is not None)
            if why is None:
                messages = survey_messages(persona, mind, facts, delta, phase_changed_to)
                why = same_survey(job, mark, messages)
            if why is not None:
                self.skipped += 1
                log.debug("orchestrator: skipped the %s survey for %s: %s", job.trigger or "timer", job.character, why)
                return
            survey_mark = SurveyMark(facts, mind.exchanges, messages)
            speaker_id = None
            thread_key = None
            upto = 0
        whispered = bool(mind.director)
        before = mind.small()
        req_for_trace = job.payload.get("req") if job.kind == "reflect" else None
        trigger = job.trigger or ("exchange" if job.kind == "reflect" else "timer")
        if phase_changed_to is not None:
            trigger = "phase"
        try:
            completion = Completion.of(await self.complete_fn(messages, model))
        except LlmError as err:
            self.last_error = str(err)
            log.warning("orchestrator: model failed for %s (%s)", job.character, err)
            await self._record(new_thought(job.character, job.kind, trigger=trigger, model=model, messages=messages, request=req_for_trace, error=str(err)))
            return
        if survey_mark is not None:
            # The model answered: this is the survey the next one is compared
            # with (a failed call is retried on the same input).
            self._marks[job.character] = survey_mark
        update = parse_update(completion.content)
        if update is None:
            self.last_error = f"unusable {job.kind} output"
            log.warning("orchestrator: unusable output for %s: %r", job.character, (completion.content or "")[:200])
            await self._record(new_thought(job.character, job.kind, trigger=trigger, model=model, messages=messages, completion=completion, request=req_for_trace, error="no JSON object in the output"))
            return
        if whispered:
            update["director_consumed"] = True
        suppressed = persona.secrets.scrub(update)
        if suppressed:
            update["suppressed"] = suppressed  # the trace shows the director; Mind.apply ignores it
            log.info("%s's mind: suppressed %s", job.character, suppressed_summary(suppressed))
        thought = new_thought(job.character, job.kind, trigger=trigger, model=model, messages=messages, completion=completion, request=req_for_trace, result=update)
        touched = mind.apply(update, speaker_id=speaker_id or None, thread_key=thread_key, upto=upto, by=job.kind, thought_id=thought.id)
        thought.touched = touched
        thought.diff = Mind.diff(before, mind.small())
        thought.revision = mind.rev if touched else None
        if job.kind == "reflect":
            mind.reflections += 1
        else:
            mind.surveys += 1
        self.completed += 1
        self.last_error = None
        log.info("%s's mind: %s updated %s (%.1fs)", job.character, job.kind, ", ".join(touched) or "nothing", completion.ms / 1000 if completion.ms else 0.0)
        await self._record(thought)
        if self.on_update is not None:
            await self.on_update(job.character, mind, job, touched)

    async def _rerun(self, job: Job, model: LlmConfig) -> None:
        original: Thought = job.payload["thought"]
        messages = [dict(m) for m in original.messages]
        if not messages:
            return
        try:
            completion = Completion.of(await self.complete_fn(messages, model))
        except LlmError as err:
            await self._record(new_thought(job.character, "rerun", trigger=job.trigger, model=model, messages=messages, error=str(err), note=f"re-run of {original.id} ({original.kind})"))
            return
        result: dict[str, Any] | None = None
        if original.kind in ("reflect", "survey"):
            result = parse_update(completion.content)
        else:
            doc = extract_json(strip_think(completion.content))
            result = doc if isinstance(doc, dict) else None
        thought = new_thought(job.character, "rerun", trigger=job.trigger, model=model, messages=messages, completion=completion, result=result, note=f"re-run of {original.id} ({original.kind}) — not applied")
        thought.request_id = original.request_id
        thought.thread = original.thread
        thought.speaker = original.speaker
        await self._record(thought)
