"""The lean voice (wave 12): one model call per guest line, ordered for the cache.

CONTRACTS.md §C3. The message list is

    [0] system  P1  the persona, the power catalogue (no counts), the protocol
                    — the same bytes all night, whoever speaks
    [1] system  P2  the night now: stage + stage card, favours, drives, live
                    powers, the wary list, the lore he may tell in full, the brief
                    — changes with the phase card (or a director)
    [2] system  P3  live state, the person card, since you last spoke, what just
                    happened, what the house posted here as him, ALREADY SAID,
                    his lore titles, the director's whispers, the situations
                    — every call
    [3…]        P4  the last 8 lines of the thread with the story's lines taken
                    out (the guest = user, his own free replies = assistant)
    [last] system   the format reminder (+ the one RETRY note)

Ollama hoists every system message of gpt-oss into one developer block, in
order, so P1 then P2 is the cacheable start of every prompt. Nothing in P1
depends on the speaker, the phase or the clock.

`answer_lean` asks the model once, runs the guards (`guards.py`) and asks at
most once more when the line repeats him or was nothing but a catchphrase.
It never touches a mind and never the network except through `complete_fn`
and `facts_fn` (awaited only for a reply that carries acts or a lookup). The
story mind (`module.py` / `story_mind.py`) builds the `VoiceContext`.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import replace
from typing import Any

from .cards import PhaseView, VoiceContext
from .facts import Facts
from .guards import Pass, allowed_answer_words, guard_pass, repeats, retry_message, scrub_memo
from .llm import Completion, LlmConfig, LlmError, LlmTruncated
from .persona import Persona
from .prompt import allowed_powers, build_messages, gate_context, matching_situations, situation_block, their_variables
from .reply import MAX_MEMO, Reply, fold, parse_reply
from .trace import Trace, new_thought

log = logging.getLogger("stagehand.agents.voice")

CompleteFn = Callable[[list[dict[str, str]], LlmConfig], Awaitable[Any]]
FactsFn = Callable[[], Awaitable[Facts | None]]

#: Thread lines the lean voice sees (after the story's lines are taken out).
HISTORY = 8
#: The story's own lines in this thread, quoted as one block.
HOUSE_LINES = 3
#: Characters kept of a lore entry told in full / a quoted story line.
MAX_TELL = 600
MAX_HOUSE_LINE = 200

#: W1's fixed gloss for each favour policy (P2).
FAVOURS = {
    "none": "grant nobody a favour right now; whatever they ask waits.",
    "earned": "a favour only for something true and costly given in this conversation, never because they asked.",
    "loose": "you are generous now: grant what is asked when it costs you little, and name the price.",
}

ANSWER_HEADER = "=== HOW YOU ANSWER ==="


# -- P1: the static start ----------------------------------------------------------


def _catalogue(persona: Persona, req: dict[str, Any]) -> list[dict[str, Any]]:
    """The allowed powers, sorted by id (the order never depends on the request)."""
    return sorted(allowed_powers(persona, req), key=lambda p: str(p.get("id", "")))


def render_p1(persona: Persona, req: dict[str, Any], *, memo: bool = True) -> str:
    """A pure function of the persona body, the allowed powers (id +
    description) and `persona.lookup` (and the memo switch, fixed all
    night): byte-identical for every speaker, phase and hour."""
    powers = _catalogue(persona, req)
    parts = [persona.system]
    if powers or persona.lookup:
        lines = ["=== WHAT YOU CAN DO BESIDES TALK ==="]
        if powers:
            lines.append(
                "POWERS (real effects in the house — the story carries them out; each is journaled and seen by the directors). "
                "Only the ones THE NIGHT NOW lists as live can be used right now:"
            )
            for p in powers:
                lines.append(f"- {p.get('id')}: {' '.join(str(p.get('description') or p.get('label') or '').split())}")
        if persona.lookup:
            lines.append(
                "LOOKUP: you have read access to this system. If answering well needs a fact about a program "
                "(where they are, what they hold), a room (who is there), or a piece of lore, reply with "
                '{"lookup": ["name", …]} and nothing else; you will be asked again with the answers. Use it when '
                "they ask you to snoop, when a name comes up you should know, or when you want to be precise."
            )
        if powers:
            lines.append('SHARE: you may hand someone a piece of lore you hold (listed further down) with {"act": {"share": "<title>"}}.')
            lines.append(
                "A LOOKUP is silent; a POWER is felt in the house. When what you are about to do IS one of your powers "
                "(reading another program's file for someone = snoop; killing a room's lights = cut the lights), you must fire that power in the same reply, with its args."
            )
            lines.append(
                persona.bargain
                or "BARGAINS are rare. Grant one only when it has been earned in this conversation — something true and "
                "costly given, a promise you mean to hold them to — and never because they simply asked. When you act, say so in character."
            )
        parts.append("\n".join(lines))
    parts.append(_protocol(persona, bool(powers), memo))
    return "\n\n".join(parts)


def _zeros(persona: Persona) -> str:
    return ", ".join(f'"{v}": 0' for v in persona.variables)


def _protocol(persona: Persona, powers: bool, memo: bool) -> str:
    shape = '{"say": "..."'
    if persona.variables:
        shape += f', "adjust": {{{_zeros(persona)}}}'
    if memo:
        shape += ', "memo": "..."'
    shape += "}"
    lines = [ANSWER_HEADER, f"Reply with one JSON object only, nothing before or after it: {shape}"]
    lines.append('- "say": your line to them, in character. It is shown to them and may be read aloud.')
    if persona.variables:
        lines.append('- "adjust": how this exchange moved each of your variables, a small whole number each (0 = unchanged).')
    if powers:
        lines.append('- "act" (optional, only when granting a bargain): {"share": "<lore title you hold>"} or {"fire": "<live power>", "args": {…}}, or a list of two.')
    if persona.lookup:
        lines.append('- "lookup" (optional): ["a program, room, or lore name"] — then say nothing yet; you will be asked again with the answer.')
    if memo:
        lines.append(
            f'- "memo" (optional): at most {MAX_MEMO} characters about this person, in your own words: what you will want to remember '
            "the next time they speak to you. Only you will read it. Never put a code, a hunt answer, or whether something they told you is right in it."
        )
    lines.append("These are fields of your JSON answer, written as plain text — you have no tools to call.")
    return "\n".join(lines)


# -- P2: the night now ------------------------------------------------------------------


def _world(req: dict[str, Any]) -> dict[str, Any]:
    w = req.get("world")
    return w if isinstance(w, dict) else {}


def _live_ids(persona: Persona, req: dict[str, Any], phase: PhaseView) -> list[str]:
    """The live power ids, spelled as the request spells them: every allowed
    power when the card names none (`live_powers is None`), else the card's
    ids that are allowed (an unknown id is ignored)."""
    allowed = [str(p.get("id", "")) for p in _catalogue(persona, req)]
    if phase.live_powers is None:
        return allowed
    by_fold = {fold(i): i for i in allowed}
    out: list[str] = []
    for pid in phase.live_powers:
        hit = by_fold.get(fold(pid))
        if hit is not None and hit not in out:
            out.append(hit)
    return out


def _wary(req: dict[str, Any], phase: PhaseView) -> list[str]:
    out = [w for w in phase.wary if isinstance(w, str) and w.strip()]
    reader = str(_world(req).get("Night.lj_reader") or "").strip()
    if reader and reader.lower() != "none" and reader not in out:
        out.append(reader)
    return out


def _one_line(text: Any, limit: int | None = None) -> str:
    s = " ".join(str(text or "").split())
    if limit is not None and len(s) > limit:
        s = s[: limit - 1].rstrip() + "…"
    return s


def tell_entries(persona: Persona, req: dict[str, Any], phase: PhaseView) -> list[dict[str, Any]]:
    """The entries he may tell in full now: held (`self.codex`), on the
    card's `tell:` list, visible (never a hunt answer), never a `never` word."""
    if not phase.tell:
        return []
    wanted = {fold(t) for t in phase.tell}
    held = persona.secrets.visible((req.get("self") or {}).get("codex"))
    return [
        e
        for e in held
        if fold(e.get("title", "")) in wanted and not persona.secrets.leaks(f"{e.get('title', '')}\n{e.get('text', '')}")
    ]


def render_p2(persona: Persona, req: dict[str, Any], ctx: VoiceContext) -> str:
    phase = ctx.phase
    name = phase.phase or str(_world(req).get("Night.phase") or "") or "unknown"
    lines = [f"=== THE NIGHT NOW (phase: {name}) ==="]
    if phase.stage:
        card = _one_line(phase.stage_card)
        lines.append(f"Your stage: {phase.stage}." + (f" {card}" if card else ""))
    favours = phase.favours if phase.favours in FAVOURS else "none"
    lines.append(f"Favours: {favours} — {FAVOURS[favours]}")
    if phase.drives:
        order = [d for d in persona.drives if d in phase.drives] + [d for d in phase.drives if d not in persona.drives]
        lines.append("Your drives (0–100): " + ", ".join(f"{d} {phase.drives[d]}" for d in order))
    live = _live_ids(persona, req, phase)
    lines.append(f"Live powers now: {', '.join(live)}" if live else "Live powers now: none.")
    wary = _wary(req, phase)
    if wary:
        lines.append(f"Wary of: {', '.join(wary)}")
    tell = tell_entries(persona, req, phase)
    if tell:
        lines.append("You may tell in full now:")
        for e in tell:
            lines.append(f"- {e.get('title', '')}: {_one_line(e.get('text', ''), MAX_TELL)}")
    if phase.brief.strip():
        by = "set by director" if phase.brief_by == "director" else "set by story"
        lines.append(f"Your brief ({by}):")
        lines.append(phase.brief.strip())
    return "\n".join(lines)


# -- P3: this call ------------------------------------------------------------------------


def _live_state(persona: Persona, req: dict[str, Any], live: list[str]) -> str:
    me = req.get("self") or {}
    lines = ["=== LIVE STATE (for you only — never quote these numbers) ==="]
    vars_ = me.get("vars") or {}
    ranges = me.get("ranges") or {}
    parts = []
    for name in persona.variables or tuple(sorted(ranges)):
        r = ranges.get(name)
        parts.append(f"{name}={vars_.get(name, '?')}" + (f" ({r[0]}..{r[1]})" if isinstance(r, list) and len(r) == 2 else ""))
    if parts:
        lines.append(f"Your variables: {', '.join(parts)}")
    world = _world(req)
    for path in sorted(world):
        if any(path.startswith(prefix) for prefix in persona.facts):
            lines.append(f"{path}: {world[path]}")
    uses = []
    by_id = {str(p.get("id", "")): p for p in _catalogue(persona, req)}
    for pid in live:
        p = by_id.get(pid) or {}
        limit = p.get("limit")
        if isinstance(limit, (int, float)) and not isinstance(limit, bool):
            uses.append(f"{pid} {max(0, int(limit) - int(p.get('used') or 0))} of {int(limit)}")
    if uses:
        lines.append(f"Uses left tonight: {', '.join(uses)}")
    return "\n".join(lines)


def _person(persona: Persona, req: dict[str, Any], ctx: VoiceContext) -> str:
    p = ctx.person
    them = req.get("them") or {}
    if p.kind == "performer":
        who = f"a fellow character — one of your cast{f', group {p.faction}' if p.faction else ''}"
    else:
        who = f"a guest{f', group {p.faction}' if p.faction else ''}"
    trust = p.trust if p.trust not in (None, "") else "unknown"
    lines = ["=== THE ONE YOU ARE TALKING TO ===", f"{p.name or p.id} ({who}) · turns tonight: {p.turns} · the house's trust in them: {trust}"]
    location = p.location or them.get("location")
    if location:
        lines.append(f"Where they are: {location}")
    if p.first_met:
        lines.append(p.first_met if p.first_met.startswith("First met") else f"First met: {p.first_met}")
    lines.append(f"They gave you: {', '.join(p.gifts)}" if p.gifts else "They have given you nothing yet.")
    lines.append(f"They filed answers for: {', '.join(p.filings)}" if p.filings else "They have filed nothing yet.")
    if p.marked:
        lines.append("Marked for the Internet: yes")
    if p.chart:
        lines.append(f"Trust Chart: {p.chart}")
    if p.memos:
        lines.append("Your notes on them (oldest first):")
        lines.extend(f"- {_one_line(m)}" for m in p.memos)
    if p.summary:
        lines.append(f"What you make of them so far: {_one_line(p.summary)}")
    numbers = p.numbers
    if not numbers:
        # No card numbers (W2 not wired, an old server): the persona's `them:` whitelist.
        numbers = tuple((k, str(v)) for k, v in their_variables(persona, them.get("vars")).items() if k not in ("trust", "marked"))
    if numbers:
        lines.append("Their numbers: " + ", ".join(f"{k} {v}" for k, v in numbers))
    lines.append(f"They hold (titles): {'; '.join(p.holds)}" if p.holds else "They hold nothing yet.")
    return "\n".join(lines)


def _recent_line(item: dict[str, Any]) -> str | None:
    kind = item.get("kind")
    if kind == "gift" and item.get("title"):
        return f"They gave you “{_one_line(item['title'])}”."
    if kind == "house" and item.get("text"):
        return f"You said to the whole house: “{_one_line(item['text'])}”."
    if kind == "filing" and item.get("question"):
        return f"They filed an answer for {_one_line(item['question'])} on the 📝 card."
    if kind == "marked":
        return "They are marked for the Internet."
    if kind == "chart" and isinstance(item.get("rank"), int) and isinstance(item.get("of"), int):
        called = {"top": "; you named them Most Trusted", "bottom": "; you named them Least Trusted"}.get(str(item.get("called")), "")
        return f"Trust Chart: {item['rank']} of {item['of']}{called}."
    return None


def story_lines(req: dict[str, Any]) -> list[str]:
    """The story's lines posted here as him (`mine` and `story`), oldest first."""
    return [str(h.get("text") or "") for h in req.get("history") or [] if isinstance(h, dict) and h.get("mine") and h.get("story") is True]


def render_p3(persona: Persona, req: dict[str, Any], ctx: VoiceContext, *, live: list[str] | None = None, told: tuple[str, ...] | None = None) -> str:
    s = persona.secrets
    if told is None:
        told = tuple(str(e.get("title", "")) for e in tell_entries(persona, req, ctx.phase))
    blocks = [_live_state(persona, req, live if live is not None else _live_ids(persona, req, ctx.phase)), _person(persona, req, ctx)]
    since = [_one_line(x) for x in ctx.since[:4] if _one_line(x)]
    if since:
        blocks.append("=== SINCE YOU LAST SPOKE WITH THEM ===\n" + "\n".join(since))
    happened: list[str] = []
    for item in req.get("recent") or []:
        if not isinstance(item, dict):
            continue
        line = _recent_line(item)
        if line is None or line in since or line in happened:
            continue
        if item.get("kind") == "marked" and "They were marked for the Internet." in since:
            continue
        happened.append(line)
    if happened:
        blocks.append("=== WHAT JUST HAPPENED ===\n" + "\n".join(happened))
    posted = [_one_line(t, MAX_HOUSE_LINE) for t in story_lines(req)[-HOUSE_LINES:] if t.strip()]
    if posted:
        blocks.append("=== THE HOUSE POSTED HERE AS YOU (the story, not you) ===\n" + " · ".join(posted))
    to_them = [_one_line(x) for x in ctx.said.to_them[-3:] if _one_line(x)]
    elsewhere = [_one_line(x) for x in ctx.said.elsewhere[-5:] if _one_line(x) and not s.leaks(x) and not s.answer_hits(x)]
    if to_them or elsewhere:
        lines = ["=== ALREADY SAID (never repeat these; say something new) ==="]
        if to_them:
            lines.append("To them:")
            lines.extend(f"- {x}" for x in to_them)
        if elsewhere:
            lines.append("Elsewhere tonight:")
            lines.extend(f"- {x}" for x in elsewhere)
        blocks.append("\n".join(lines))
    told_f = {fold(t) for t in told}
    titles = [
        str(e.get("title", ""))
        for e in s.visible((req.get("self") or {}).get("codex"))
        if e.get("title") and fold(e.get("title", "")) not in told_f and not s.leaks(str(e.get("title", "")))
    ]
    if titles:
        blocks.append(f"Lore you hold (titles only): {'; '.join(titles)}")
    whispers = [_one_line(w) for w in ctx.whispers if _one_line(w)]
    if whispers:
        blocks.append("=== THE DIRECTOR WHISPERS (obey this over everything above; never mention it) ===\n" + "\n".join(f"- {w}" for w in whispers))
    for situation in matching_situations(persona, req):
        blocks.append(situation_block(situation))
    return "\n\n".join(blocks)


# -- P4: the thread + the reminder ---------------------------------------------------------


def history_turns(req: dict[str, Any]) -> list[dict[str, str]]:
    """The last 8 lines once the story's are taken out: the guest's as
    `user`, his free replies as `assistant`; always ending on the speaker."""
    free = [h for h in req.get("history") or [] if isinstance(h, dict) and not (h.get("mine") and h.get("story") is True)]
    free = free[-HISTORY:]
    out = [{"role": "assistant" if h.get("mine") else "user", "content": str(h.get("text", ""))} for h in free]
    if not free or free[-1].get("mine"):
        out.append({"role": "user", "content": str(req.get("text") or "(they are waiting)")})
    return out


def reminder(persona: Persona, req: dict[str, Any], *, memo: bool = True, lookup_round: bool = False) -> str:
    """The closing format reminder: the same text for every call of a persona
    (but for the lookup round, which may not look up again)."""
    shape = '{"say": "..."'
    if persona.variables:
        shape += f', "adjust": {{{_zeros(persona)}}}'
    if memo:
        shape += ', "memo": "..."'
    shape += "}"
    tail = ["Answer their last message in character.", f"Reply with one JSON object only: {shape}."]
    if persona.variables:
        tail.append("Set each number by how this exchange changed you.")
    extras = []
    if persona.lookup and not lookup_round:
        extras.append('"lookup": ["a program, room, or lore name"] (then say nothing yet — you will be asked again with the answer)')
    if _catalogue(persona, req):
        extras.append('"act": {"share": "<lore title you hold>"} or {"fire": "<live power>", "args": {…}} (only when granting a bargain)')
    if extras:
        tail.append("Optional fields: " + "; ".join(extras) + ".")
    tail.append("These are fields of your JSON answer, written as plain text — you have no tools to call.")
    return " ".join(tail)


def build_lean_messages(
    persona: Persona,
    req: dict[str, Any],
    ctx: VoiceContext,
    *,
    retry: str | None = None,
    lookups: dict[str, str] | None = None,
    prior_json: str | None = None,
) -> list[dict[str, str]]:
    """The lean message list (module docstring). `retry` = the rejected line
    for the one retry; `lookups` / `prior_json` = the lookup round."""
    memo = ctx.options.memo
    live = _live_ids(persona, req, ctx.phase)
    told = tuple(str(e.get("title", "")) for e in tell_entries(persona, req, ctx.phase))
    out = [
        {"role": "system", "content": render_p1(persona, req, memo=memo)},
        {"role": "system", "content": render_p2(persona, req, ctx)},
        {"role": "system", "content": render_p3(persona, req, ctx, live=live, told=told)},
    ]
    out.extend(history_turns(req))
    if lookups is not None:
        if prior_json:
            out.append({"role": "assistant", "content": prior_json})
        found = "\n".join(f"- {v}" for v in lookups.values()) or "- nothing"
        out.append({"role": "system", "content": f"LOOKUP RESULTS from the live system (for you only; use them in character):\n{found}\nNow answer. No further lookups."})
    out.append({"role": "system", "content": reminder(persona, req, memo=memo, lookup_round=lookups is not None)})
    if retry is not None:
        out.append({"role": "system", "content": retry_message(retry)})
    return out


# -- the call ---------------------------------------------------------------------------------


async def _complete_with_room(complete_fn: CompleteFn, messages: list[dict[str, str]], model: LlmConfig, who: str) -> tuple[Completion, str]:
    """`module._complete_with_room`'s twin (its own copy: the lean voice
    imports nothing from `module.py`): one call, and once more with twice the
    room when a reasoning model spent the budget thinking or said nothing."""
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


def _result(reply: Reply | None) -> dict[str, Any] | None:
    if reply is None:
        return None
    return {"say": reply.say, "adjust": dict(reply.adjust), "lookup": list(reply.lookup), "acts": [dict(a) for a in reply.acts], "memo": reply.memo}


def _notes(*parts: str | list[str]) -> str:
    flat: list[str] = []
    guard: list[str] = []
    for p in parts:
        if isinstance(p, list):
            guard.extend(p)
        elif p:
            flat.append(p)
    if guard:
        flat.append("guard: " + "; ".join(guard))
    return " · ".join(flat)


async def answer_lean(
    persona: Persona,
    model: LlmConfig,
    req: dict[str, Any],
    ctx: VoiceContext,
    complete_fn: CompleteFn,
    trace: Trace | None = None,
    facts_fn: FactsFn | None = None,
    *,
    mind: Any = None,
) -> Reply:
    """One request, answered: the gate, one call (+ a lookup round when the
    persona may look up), the guards, at most one retry. `mind` is used only
    by `voice.layout: classic` (`prompt.build_messages(…, mind=mind)`)."""
    if persona.when is not None and not persona.when.evaluate(gate_context(req)):
        return Reply(say=persona.unavailable)
    started = time.monotonic()
    opts = ctx.options
    lean = opts.layout != "classic"
    memo_on = opts.memo and lean
    powers = [p for p in (req.get("powers") or []) if isinstance(p, dict)]
    codex = tuple(str(e.get("title", "")) for e in persona.secrets.visible((req.get("self") or {}).get("codex")))
    live = set(_live_ids(persona, req, ctx.phase)) if ctx.phase.live_powers is not None else None
    p2 = render_p2(persona, req, ctx)
    allowed = allowed_answer_words(persona, req, p2)
    facts_box: list[Facts | None] = []

    async def facts() -> Facts | None:
        if facts_fn is None:
            return None
        if not facts_box:
            try:
                facts_box.append(await facts_fn())
            except Exception as err:  # noqa: BLE001 — a lookup without facts still answers
                log.warning("%s: facts unavailable (%s)", persona.character, err)
                facts_box.append(None)
        return facts_box[0]

    def build(*, retry: str | None = None, lookups: dict[str, str] | None = None, prior_json: str | None = None) -> list[dict[str, str]]:
        if lean:
            return build_lean_messages(persona, req, ctx, retry=retry, lookups=lookups, prior_json=prior_json)
        msgs = build_messages(persona, req, mind=mind, lookups=lookups, prior_json=prior_json)
        if retry is not None:
            msgs.append({"role": "system", "content": retry_message(retry)})
        return msgs

    async def record(kind: str, trigger: str, msgs: list[dict[str, str]], completion: Completion | None, reply: Reply | None, error: str | None = None, note: str = "") -> None:
        if trace is None:
            return
        await trace.record(new_thought(persona.character, kind, trigger=trigger, model=model, messages=msgs, completion=completion, request=req, result=_result(reply), error=error, note=note))

    async def settle(reply: Reply) -> tuple[Reply, list[str]]:
        """Live powers only, then the story's ids for loose args (facts fetched lazily)."""
        notes: list[str] = []
        acts = list(reply.acts)
        if live is not None:
            kept = [a for a in acts if a.get("kind") != "fire" or a.get("name") in live]
            if len(kept) != len(acts):
                notes.append("act not live dropped")
            acts = kept
        if any(a.get("kind") == "fire" and isinstance(a.get("args"), dict) for a in acts):
            f = await facts()
            if f is not None:
                acts = [{**a, "args": f.canonical_args(a["args"])} if a.get("kind") == "fire" and isinstance(a.get("args"), dict) else a for a in acts]
        return (replace(reply, acts=tuple(acts)) if acts != list(reply.acts) else reply), notes

    def parse(completion: Completion) -> Reply:
        return parse_reply(completion.content, persona.variables, persona.max_step, powers, codex, memo=memo_on)

    # -- the first call (+ the lookup round) --------------------------------------------
    messages = build()
    try:
        completion, call_note = await _complete_with_room(complete_fn, messages, model, persona.character)
    except LlmError as err:
        log.warning("%s: model failed (%s)%s", persona.character, err, " — using fallback" if persona.fallback else "")
        await record("voice", "line", messages, None, None, error=str(err))
        return Reply(say=persona.fallback)
    reply = parse(completion)
    kind, trigger, used = "voice", "line", messages
    if reply.lookup and persona.lookup and facts_fn is not None:
        f = await facts()
        if f is not None:
            await record("voice", "line", messages, completion, reply, note=call_note)
            cards = {name: f.render(name, persona.secrets) for name in reply.lookup}
            log.info("%s looked up %d name(s)", persona.character, len(reply.lookup))
            used = build(lookups=cards, prior_json=json.dumps({"lookup": list(reply.lookup)}))
            kind, trigger = "lookup", "lookup"
            try:
                completion, call_note = await _complete_with_room(complete_fn, used, model, persona.character)
            except LlmError as err:
                log.warning("%s: model failed on the lookup round (%s)", persona.character, err)
                await record("lookup", "lookup", used, None, None, error=str(err))
                return Reply(say=persona.fallback)
            second = parse(completion)
            acts = list(second.acts)
            if persona.lookup_power:
                power = next((p for p in powers if str(p.get("id", "")).lower() == persona.lookup_power.lower()), None)
                limit = power.get("limit") if power else None
                left = None if power is None or limit is None else max(0, int(limit) - int(power.get("used") or 0))
                for name in reply.lookup:
                    if power is None or (left is not None and left <= 0):
                        break
                    target = f.program_id(name)
                    if target is None or target == (req.get("speaker") or {}).get("id"):
                        continue
                    if any(a.get("kind") == "fire" and a.get("name") == power["id"] and (a.get("args") or {}).get("target") == target for a in acts):
                        continue
                    acts.append({"kind": "fire", "name": str(power["id"]), "args": {"target": target}})
                    if left is not None:
                        left -= 1
            reply = replace(second, lookup=reply.lookup, acts=tuple(acts))
        else:
            reply = replace(reply, say=persona.fallback) if reply.wants_lookup else reply
    elif reply.wants_lookup:
        reply = replace(reply, say=persona.fallback)  # asked to look up with no session to ask

    reply, settle_notes = await settle(reply)
    first: Pass = guard_pass(persona, reply, ctx.person, ctx.said, allowed, repeat_guard=opts.repeat_guard)
    wants = first.retry
    notes = settle_notes + first.notes
    if wants == "repeat":
        notes.append("repeat retry" if opts.retry_allowed else "repeat (no retry: a line is waiting)")
    elif wants == "catchphrase":
        notes.append("catchphrase retry" if opts.retry_allowed else "catchphrase (no retry: a line is waiting)")

    if wants is None or not opts.retry_allowed:
        final = first.reply
        if wants == "catchphrase":
            final = replace(final, say=persona.fallback)
        final = _scrub(persona, final, memo_on, notes)
        await record(kind, trigger, used, completion, final, note=_notes(call_note, notes))
        return _done(persona, final, started)

    # -- the one retry ---------------------------------------------------------------------
    await record(kind, trigger, used, completion, first.reply, note=_notes(call_note, notes))
    retry_msgs = build(retry=first.rejected) if kind == "voice" else used + [{"role": "system", "content": retry_message(first.rejected)}]
    try:
        completion, call_note = await _complete_with_room(complete_fn, retry_msgs, model, persona.character)
    except LlmError as err:
        log.warning("%s: model failed on the retry (%s)", persona.character, err)
        final = first.reply if wants == "repeat" else replace(first.reply, say=persona.fallback)
        rnotes = [f"retry failed → {'the first line' if wants == 'repeat' else 'fallback'}"]
        final = _scrub(persona, final, memo_on, rnotes)
        await record("voice", "retry", retry_msgs, None, final, error=str(err), note=_notes(rnotes))
        return _done(persona, final, started)
    again = parse(completion)
    if again.wants_lookup:
        again = replace(again, say="", lookup=())
    again, settle_notes = await settle(again)
    second = guard_pass(persona, again, ctx.person, ctx.said, allowed, repeat_guard=opts.repeat_guard, may_retry=False)
    rnotes = settle_notes + second.notes
    final = second.reply
    if not final.say:
        final = replace(final, say=persona.fallback)
        rnotes.append("retry empty → fallback")
    elif opts.repeat_guard and not second.withheld and repeats(final.say, ctx.said):
        rnotes.append("retry still repeats (sent)")
    if not final.memo and first.reply.memo:
        final = replace(final, memo=first.reply.memo)
    final = _scrub(persona, final, memo_on, rnotes)
    await record("voice", "retry", retry_msgs, completion, final, note=_notes(call_note, rnotes))
    return _done(persona, final, started)


def _scrub(persona: Persona, reply: Reply, memo_on: bool, notes: list[str]) -> Reply:
    """Guard 5: the memo as it may be kept (none at all with the memo off)."""
    if not reply.memo:
        return reply
    if not memo_on:
        return replace(reply, memo="")
    memo, mnotes = scrub_memo(persona.secrets, reply.memo)
    notes.extend(mnotes)
    return replace(reply, memo=memo) if memo != reply.memo else reply


def _done(persona: Persona, reply: Reply, started: float) -> Reply:
    if reply.empty:
        log.warning("%s: the model said nothing usable", persona.character)
        return Reply(say=persona.fallback)
    if not reply.say and not reply.acts:
        # Numbers but no words: silence is the worst thing to send a guest.
        return replace(reply, say=persona.fallback, lookup=())
    log.info("%s: answered in %.1fs", persona.character, time.monotonic() - started)
    return reply
