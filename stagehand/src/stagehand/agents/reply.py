"""Reading what the model said back.

Models are told to answer with one JSON object — `{"say": "…", "adjust":
{"truth": 5}}` — and mostly do; when they don't, the whole text is the
line and nothing is adjusted. Reasoning models may leak a `<think>` block
or a code fence; both are stripped. Adjustments are limited to the
persona's declared variables and clamped to ±max_step here; the server
clamps the resulting value to the story's declared range.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")
MAX_SAY = 600


@dataclass(frozen=True)
class Reply:
    say: str = ""
    adjust: dict[str, int] = field(default_factory=dict)

    @property
    def empty(self) -> bool:
        return self.say == "" and not self.adjust


def parse_reply(raw: str, allowed: tuple[str, ...], max_step: int) -> Reply:
    """Never raises."""
    text = _THINK.sub("", raw or "").strip()
    doc = extract_json(text)
    if doc is not None:
        say = doc.get("say", doc.get("text", ""))
        say = _clean(say) if isinstance(say, str) else ""
        adjust = clamp_adjust(doc.get("adjust"), allowed, max_step)
        if say or adjust:
            return Reply(say=say, adjust=adjust)
    if text.lstrip().startswith("{"):
        return Reply()  # malformed JSON — never say raw braces to a guest
    return Reply(say=_clean(_FENCE.sub("", text)))


def _clean(say: str) -> str:
    s = " ".join(say.split())
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        s = s[1:-1].strip()
    return s[:MAX_SAY]


def extract_json(text: str) -> dict | None:
    """The first balanced `{…}` object in `text`, parsed; None if none parses."""
    start = text.find("{")
    while start >= 0:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        value = json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
                    return value if isinstance(value, dict) else None
        start = text.find("{", start + 1)
    return None


def clamp_adjust(raw: object, allowed: tuple[str, ...], max_step: int) -> dict[str, int]:
    out: dict[str, int] = {}
    if not isinstance(raw, dict):
        return out
    names = {a.lower(): a for a in allowed}
    for key, value in raw.items():
        name = names.get(str(key).strip().lower())
        if name is None:
            continue
        try:
            n = float(value)
        except (TypeError, ValueError):
            continue
        if n != n or n == 0:  # NaN / no-op
            continue
        out[name] = int(max(-max_step, min(max_step, round(n))))
        if out[name] == 0:
            del out[name]
    return out
