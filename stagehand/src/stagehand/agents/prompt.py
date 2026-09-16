"""Turning one agent request into the conversation the model sees.

The system prompt is the persona plus a live **state block** built from
what the server sent: the character's variables (with their ranges),
selected world facts, who is talking (a guest, or a fellow character's
performer) and what they know, and what the character knows. Then the
thread as alternating user / assistant turns, ending on the speaker.
"""

from __future__ import annotations

from typing import Any

from ..templating import coerce_scalar
from .persona import Persona

#: Thread lines sent to the model (the server sends up to 30).
MAX_TURNS = 16


def build_messages(persona: Persona, req: dict[str, Any], max_turns: int = MAX_TURNS) -> list[dict[str, str]]:
    out = [{"role": "system", "content": f"{persona.system}\n\n{state_block(persona, req)}"}]
    history = [h for h in req.get("history", []) if isinstance(h, dict)][-max_turns:]
    for line in history:
        out.append({"role": "assistant" if line.get("mine") else "user", "content": str(line.get("text", ""))})
    if not history or history[-1].get("mine"):
        # Answering always follows the speaker's line; keep that shape even
        # if the thread was trimmed oddly.
        out.append({"role": "user", "content": str(req.get("text") or "(they are waiting)")})
    return out


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
