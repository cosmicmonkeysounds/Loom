"""Turning one agent request into the conversation the fast model sees.

The system prompt is the persona (the character at the doors), then the
character's **mind** as the orchestrator has grown it tonight (brief,
notes, the dossier on whoever is talking — `mind.py`), then a live
**state block** built from what the server sent (variables with ranges,
selected world facts, who is talking and what they know), then the
character's **powers** and bargain policy, then the reply protocol. The
thread follows as alternating user / assistant turns — a rolling summary
first when the conversation has grown long — ending on the speaker. A
lookup round appends the session's answers and asks again.
"""

from __future__ import annotations

from typing import Any

from ..templating import coerce_scalar
from .mind import Mind
from .persona import Persona

#: Thread lines sent to the model when a persona doesn't say (server sends ≤30).
MAX_TURNS = 16
#: Past this many turns tonight with one person, the actor is told to pace.
PACE_AFTER = 24


def build_messages(
    persona: Persona,
    req: dict[str, Any],
    max_turns: int | None = None,
    mind: Mind | None = None,
    lookups: dict[str, str] | None = None,
    prior_json: str | None = None,
) -> list[dict[str, str]]:
    window = max_turns if max_turns is not None else (persona.thread_window if mind is not None else MAX_TURNS)
    speaker = req.get("speaker") or {}
    sid = str(speaker.get("id") or "")
    thread_key = _thread_key(req)
    system = [persona.system]
    if mind is not None:
        system.append(mind.prompt_block(sid))
    system.append(state_block(persona, req))
    powers = allowed_powers(persona, req)
    if powers or persona.lookup:
        system.append(powers_block(persona, powers, lookups is None))
    out = [{"role": "system", "content": "\n\n".join(system)}]
    history = [h for h in req.get("history", []) if isinstance(h, dict)]
    memo = mind.threads.get(thread_key) if mind is not None else None
    if memo is not None and memo.summary and len(history) > window:
        out.append({"role": "system", "content": f"Earlier in this conversation (your own summary): {memo.summary}"})
    history = history[-window:]
    for line in history:
        out.append({"role": "assistant" if line.get("mine") else "user", "content": str(line.get("text", ""))})
    if not history or history[-1].get("mine"):
        # Answering always follows the speaker's line; keep that shape even
        # if the thread was trimmed oddly.
        out.append({"role": "user", "content": str(req.get("text") or "(they are waiting)")})
    if lookups is not None:
        if prior_json:
            out.append({"role": "assistant", "content": prior_json})
        found = "\n".join(f"- {v}" for v in lookups.values()) or "- nothing"
        out.append({"role": "system", "content": f"LOOKUP RESULTS from the live system (for you only; use them in character):\n{found}\nNow answer. No further lookups."})
    tail = ["Answer their last message in character."]
    if mind is not None and sid in mind.people and mind.people[sid].turns >= PACE_AFTER:
        tail.append(f"PACING: you have spoken with them {mind.people[sid].turns} times tonight — be brief, and send them to do something in the house or bring you an answer.")
    if persona.variables:
        # Small models drift from a format stated only at the top of a long
        # system prompt; restate it right where the answer starts.
        zeros = ", ".join(f'"{v}": 0' for v in persona.variables)
        tail.append(f'Reply with one JSON object only: {{"say": "...", "adjust": {{{zeros}}}}} — set each number by how this exchange changed you.')
    else:
        tail.append('Reply with one JSON object only: {"say": "..."}.')
    extras = []
    if persona.lookup and lookups is None:
        extras.append('"lookup": ["a program, room, or lore name"] (then say nothing yet — you will be asked again with the answer)')
    if powers:
        extras.append('"act": {"share": "<lore title you hold>"} or {"fire": "<power>", "args": {…}} (only when granting a bargain)')
    if extras:
        tail.append("Optional fields: " + "; ".join(extras) + ". These are fields of your JSON answer, written as plain text — you have no tools to call.")
    out.append({"role": "system", "content": " ".join(tail)})
    return out


def _thread_key(req: dict[str, Any]) -> str:
    t = req.get("thread") or {}
    return f"{t.get('channel', '')}|{','.join(t.get('audience') or [])}"


def allowed_powers(persona: Persona, req: dict[str, Any]) -> list[dict[str, Any]]:
    powers = [p for p in (req.get("powers") or []) if isinstance(p, dict)]
    if persona.powers is None:
        return powers
    allowed = {p.lower() for p in persona.powers}
    return [p for p in powers if str(p.get("id", "")).lower() in allowed]


def powers_block(persona: Persona, powers: list[dict[str, Any]], may_lookup: bool) -> str:
    lines = ["=== WHAT YOU CAN DO BESIDES TALK ==="]
    if persona.lookup and may_lookup:
        lines.append(
            "LOOKUP: you have read access to this system. If answering well needs a fact about a program "
            "(where they are, what they hold), a room (who is there), or a piece of lore, reply with "
            '{"lookup": ["name", …]} and nothing else; you will be asked again with the answers. Use it when '
            "they ask you to snoop, when a name comes up you should know, or when you want to be precise."
        )
    if powers:
        lines.append("POWERS (real effects in the house — the story carries them out; each is journaled and seen by the directors):")
        for p in powers:
            limit = p.get("limit")
            used = int(p.get("used") or 0)
            left = "unlimited" if limit is None else f"{max(0, int(limit) - used)} of {limit} left tonight"
            desc = p.get("description") or p.get("label") or ""
            lines.append(f"- {p.get('id')}: {desc} [{left}]")
        lines.append("SHARE: you may hand someone a piece of lore you hold (your codex above) with {\"act\": {\"share\": \"<title>\"}}.")
        lines.append(
            "A LOOKUP is silent; a POWER is felt in the house. When what you are about to do IS one of your powers "
            "(reading another program's file for someone = snoop; killing a room's lights = cut the lights), you must fire that power in the same reply, with its args."
        )
        lines.append(
            persona.bargain
            or "BARGAINS are rare. Grant one only when it has been earned in this conversation — something true and "
            "costly given, a promise you mean to hold them to — and never because they simply asked. When you act, say so in character."
        )
    return "\n".join(lines)


def state_block(persona: Persona, req: dict[str, Any]) -> str:
    me = req.get("self") or {}
    them = req.get("them") or {}
    speaker = req.get("speaker") or {}
    lines = ["=== LIVE STATE (for you only — never quote these numbers) ==="]

    vars_ = me.get("vars") or {}
    ranges = me.get("ranges") or {}
    shown = persona.variables or tuple(sorted(ranges))
    parts = []
    for name in shown:
        value = vars_.get(name, "?")
        r = ranges.get(name)
        parts.append(f"{name}={value}" + (f" ({r[0]}..{r[1]})" if isinstance(r, list) and len(r) == 2 else ""))
    if parts:
        lines.append(f"Your variables: {', '.join(parts)}")

    world = req.get("world") or {}
    for path in sorted(world):
        if any(path.startswith(prefix) for prefix in persona.facts):
            lines.append(f"{path}: {world[path]}")

    name = speaker.get("name") or speaker.get("id") or "someone"
    group = f", group {speaker['faction']}" if speaker.get("faction") else ""
    if speaker.get("kind") == "performer":
        lines.append(f"You are talking to: {name} (a fellow character — one of your cast{group})")
    else:
        lines.append(f"You are talking to: {name} (a guest{group})")
    if them.get("location"):
        lines.append(f"Where they are: {them['location']}")
    their_vars = them.get("vars") or {}
    wanted = persona.them if persona.them is not None else tuple(sorted(their_vars))
    for key in wanted:
        if key in their_vars and "." not in key:
            lines.append(f"Their {key}: {their_vars[key]}")
    their_codex = [e.get("title", "") for e in them.get("codex") or []]
    lines.append(f"They know: {'; '.join(their_codex)}" if their_codex else "They know nothing yet.")

    my_codex = me.get("codex") or []
    if my_codex:
        lines.append("What you know (your codex — lore people shared has changed you):")
        for e in my_codex:
            lines.append(f"- {e.get('title', '')}: {_one_line(str(e.get('text', '')))}")
    return "\n".join(lines)


def gate_context(req: dict[str, Any]) -> dict[str, Any]:
    """The names a persona's `when:` gate can read: `self.<var>`,
    `them.<var>`, `speaker.kind`, and world paths (`Night.phase`)."""
    ctx: dict[str, Any] = {}
    for path, value in (req.get("world") or {}).items():
        _nest(ctx, str(path), coerce_scalar(value))
    ctx["self"] = _nested((req.get("self") or {}).get("vars") or {})
    ctx["them"] = _nested((req.get("them") or {}).get("vars") or {})
    ctx["speaker"] = dict(req.get("speaker") or {})
    return ctx


def _nested(flat: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in flat.items():
        _nest(out, str(k), coerce_scalar(v))
    return out


def _nest(into: dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    cur = into
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur.setdefault(parts[-1], value)


def _one_line(text: str) -> str:
    return " ".join(text.split())
