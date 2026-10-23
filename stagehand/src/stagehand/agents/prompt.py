"""Turning one agent request into the conversation the fast model sees.

The system prompt is the persona (the character at the doors), then the
character's **mind** as the orchestrator has grown it tonight (brief,
notes, the dossier on whoever is talking — `mind.py`), then a live
**state block** built from what the server sent (variables with ranges,
selected world facts, who is talking and what they know), then the
character's **powers** and bargain policy, then one block per persona
**situation** whose `when:` holds for this request (`situations:` — e.g.
the guest is standing at the character's heart), then the reply protocol. Wave
20 adds two blocks, each only when there is something to say (so a request
or a persona without them builds the same prompt, byte for byte): the
guest's night (`req.dossier`, the server's, at his heart only) as a **WHO
THIS IS — TONIGHT** block after the live state, and the persona's
**outside:** words as a short "not from your world" block after the
persona. The
thread follows as alternating user / assistant turns — a rolling summary
first when the conversation has grown long — ending on the speaker. A
lookup round appends the session's answers and asks again.
"""

from __future__ import annotations

from typing import Any

from ..templating import coerce_scalar
from .mind import Mind
from .persona import Persona, Situation

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
    outside = outside_block(persona)
    if outside:
        system.append(outside)
    if mind is not None:
        system.append(mind.prompt_block(sid))
    system.append(state_block(persona, req))
    dossier = dossier_block(req.get("dossier"))
    if dossier:
        system.append(dossier)
    powers = allowed_powers(persona, req)
    if powers or persona.lookup:
        system.append(powers_block(persona, powers, lookups is None))
    for situation in matching_situations(persona, req):
        system.append(situation_block(situation))
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


def their_variables(persona: Persona, their_vars: dict[str, Any] | None) -> dict[str, Any]:
    """The speaker's variables a model may read: the persona's `them:`
    whitelist (in its order; every plain name when there is none), never a
    dotted sub-path. The voice and the orchestrator both read through this,
    so a slot the author left off `them:` reaches neither model."""
    vars_ = their_vars or {}
    wanted = persona.them if persona.them is not None else tuple(sorted(vars_))
    return {k: vars_[k] for k in wanted if k in vars_ and "." not in k}


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
    for key, value in their_variables(persona, them.get("vars")).items():
        lines.append(f"Their {key}: {value}")
    their_codex = [e.get("title", "") for e in persona.secrets.visible(them.get("codex"))]
    lines.append(f"They know: {'; '.join(their_codex)}" if their_codex else "They know nothing yet.")

    my_codex = persona.secrets.visible(me.get("codex"))
    if my_codex:
        lines.append("What you know (your codex — lore people shared has changed you):")
        for e in my_codex:
            lines.append(f"- {e.get('title', '')}: {_one_line(str(e.get('text', '')))}")
    return "\n".join(lines)


def matching_situations(persona: Persona, req: dict[str, Any]) -> list[Situation]:
    """The persona's situations whose `when:` holds for this request, in
    file order. Read over `gate_context`, exactly like the persona gate."""
    if not persona.situations:
        return []
    ctx = gate_context(req)
    return [s for s in persona.situations if s.when.evaluate(ctx)]


def situation_block(situation: Situation) -> str:
    rules = []
    if situation.max_sentences is not None:
        rules.append(f"Here you may answer at length: up to {situation.max_sentences} sentences.")
    if situation.no_acts:
        rules.append("Here you decide nothing: no act, no share, no power. Just talk.")
    return (
        f"=== SITUATION: {situation.heading.upper()} (true right now, for this conversation; "
        f"where it differs from the page above, this block wins) ===\n{situation.prompt}"
        + ("\n" + " ".join(rules) if rules else "")
    )


def outside_block(persona: Persona) -> str | None:
    """(D29) The persona's `outside:` words: not things he knows. None when
    the persona has none (the prompt is then what it always was)."""
    if not persona.outside:
        return None
    return (
        "=== NOT FROM YOUR WORLD ===\n"
        "These names and words belong to nothing you know; they are not part of your world, and you never say them: "
        + ", ".join(persona.outside)
        + ". If someone brings one up, you don't know it: answer from inside your own world."
    )


#: The dossier's lines are clipped to this many characters each.
DOSSIER_LINE = 220
_VERDICT_WORDS = {"accurate": "accurate", "lie": "a lie", "uncertain": "a guess", "pending": "not judged yet"}


def _clip(value: Any, limit: int = 80) -> str:
    text = " ".join(str(value).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _list(values: Any, limit: int = 40, each: int = 60) -> list[str]:
    if not isinstance(values, list):
        return []
    return [_clip(v, each) for v in values[:limit] if isinstance(v, (str, int, float)) and str(v).strip()]


def dossier_block(dossier: Any) -> str | None:
    """(D26 / D27) The guest's night as the server built it (`req.dossier`):
    who they are, what they did, what they said to him. None when absent."""
    if not isinstance(dossier, dict) or not dossier:
        return None
    d = dossier
    lines = ["=== WHO THIS IS — TONIGHT (what the house knows of this program's night; for you only: remember it, let it show, never read it out as a list) ==="]
    name = _clip(d.get("name") or "someone")
    program = d.get("program")
    who = f"Name: {name}" + (f" (the program {_clip(program)})" if isinstance(program, str) and program and program != d.get("name") else "")
    here = d.get("storyMinutes")
    if isinstance(here, (int, float)) and not isinstance(here, bool):
        who += f" · here {int(here)} minutes"
    lines.append(who)
    side = []
    if isinstance(d.get("faction"), str) and d["faction"]:
        side.append(f"faction {_clip(d['faction'])}")
    groups = _list(d.get("groups"), 8)
    if groups:
        side.append(f"groups {', '.join(groups)}")
    if side:
        lines.append("Side: " + " · ".join(side))
    status = []
    if d.get("marked") is True:
        status.append("marked for the Internet")
    if d.get("captured") is True:
        status.append("captured")
    if d.get("restricted") is True:
        status.append("restricted")
    if isinstance(d.get("reinstalled"), int) and d["reinstalled"] > 0:
        status.append(f"reinstalled {d['reinstalled']}×")
    if d.get("bingo") is True:
        status.append("won at Bingo")
    if status:
        lines.append("Tonight they were: " + ", ".join(status))
    trust = d.get("trust")
    if isinstance(trust, dict) and isinstance(trust.get("score"), (int, float)):
        t = f"Your Trust Chart: {trust['score']}"
        if isinstance(trust.get("rank"), int) and isinstance(trust.get("of"), int):
            t += f" (rank {trust['rank']} of {trust['of']})"
        lines.append(t)
    truths = d.get("truths")
    if isinstance(truths, dict):
        lines.append(f"Their truths so far: {truths.get('accepted', 0)} filed sure, {truths.get('uncertain', 0)} guesses, {truths.get('lies', 0)} published as lies")
    filings = [f for f in d.get("filings") or [] if isinstance(f, dict) and f.get("question")]
    if filings:
        lines.append("Their filings: " + ", ".join(f"{_clip(f['question'], 12)} {_VERDICT_WORDS.get(str(f.get('verdict')), 'not judged yet')}" for f in filings[:12]))
    bottle = d.get("bottle")
    if isinstance(bottle, dict) and bottle.get("picked") is True:
        lines.append("The bottle picked them" + (f": they chose {bottle['choice']}" if bottle.get("choice") in ("truth", "dare") else ": they refused" if bottle.get("choice") == "refused" else ""))
    wallet = d.get("wallet")
    if isinstance(wallet, dict) and isinstance(wallet.get("balance"), (int, float)):
        lines.append(f"Their wallet: {wallet['balance']} Truthcoin")
    for key, label in (("codex", "Files they hold"), ("gifts", "Files they gave you"), ("rooms", "Where they have been, in order")):
        items = _list(d.get(key), 40)
        if items:
            lines.append(f"{label}: " + "; ".join(items))
    quests = [q for q in d.get("quests") or [] if isinstance(q, dict) and q.get("title")]
    if quests:
        lines.append("Their quests: " + "; ".join(f"{_clip(q['title'], 50)} ({_clip(q.get('status') or '?', 12)})" for q in quests[:12]))
    heart = d.get("heart")
    if isinstance(heart, dict):
        bits = [f"layer {heart.get('layer', 0)}", f"suspicion {heart.get('suspicion', 0)}"]
        if heart.get("convinced") is True:
            bits.append("they convinced you once")
        if heart.get("barred") is True:
            bits.append("barred from your heart")
        if isinstance(heart.get("visits"), int):
            bits.append(f"visit {heart['visits']}")
        lines.append("At your heart: " + ", ".join(bits))
    said = _list(d.get("said"), 8, 200)
    if said:
        lines.append("What they have said to you tonight:")
        lines.extend(f"- “{x}”" for x in said)
    moments = _list(d.get("moments"), 10)
    if moments:
        lines.append("Their night: " + " · ".join(moments))
    return "\n".join(_clip(line, DOSSIER_LINE) if not line.startswith("- “") else line for line in lines)


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
