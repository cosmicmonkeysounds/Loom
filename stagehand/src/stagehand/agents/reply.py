"""Reading what the model said back.

Models are told to answer with one JSON object:

    {"say": "…", "adjust": {"truth": 5},
     "lookup": ["Excel", "The Cache"],                 # optional: ask the session first
     "act": {"share": "The Missing Constant"}          # optional: a bargain
         or {"fire": "cut the lights", "args": {"room": "The Cache"}}}

and mostly do; when they don't, the whole text is the line and nothing
else happens. Reasoning models may leak a `<think>` block or a code fence;
both are stripped. Adjustments are limited to the persona's declared
variables and clamped to ±max_step here; the server clamps the resulting
value to the story's declared range. `lookup` names are just strings (the
worker resolves them against the live session and asks the model again).
`act` is validated here against what the request said the character *can*
do — an entry it holds, a power with uses left — so the server is never
asked for the impossible; the server validates again regardless.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_OPEN_THINK = re.compile(r"<think>.*\Z", re.DOTALL | re.IGNORECASE)
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")
_FOLD = re.compile(r"[^a-z0-9]+")
MAX_SAY = 600
MAX_LOOKUPS = 3
MAX_ACTS = 2


def fold(name: str) -> str:
    return _FOLD.sub("", str(name).lower())


def strip_think(raw: str) -> str:
    text = _THINK.sub("", str(raw) if raw is not None else "")
    return _OPEN_THINK.sub("", text).strip()


@dataclass(frozen=True)
class Reply:
    say: str = ""
    adjust: dict[str, int] = field(default_factory=dict)
    #: Names the model wants looked up in the live session before it answers.
    lookup: tuple[str, ...] = ()
    #: Validated acts for the server: {"kind": "share", "entry"} / {"kind": "fire", "name", "args"}.
    acts: tuple[dict[str, Any], ...] = ()

    @property
    def empty(self) -> bool:
        return self.say == "" and not self.adjust and not self.lookup and not self.acts

    @property
    def wants_lookup(self) -> bool:
        return bool(self.lookup) and self.say == ""


def parse_reply(
    raw: str,
    allowed: tuple[str, ...],
    max_step: int,
    powers: list[dict[str, Any]] | tuple[dict[str, Any], ...] = (),
    codex: tuple[str, ...] = (),
) -> Reply:
    """Never raises. `powers` are the request's `powers` (id/limit/used);
    `codex` the titles the character holds (what it may share)."""
    text = strip_think(raw)
    doc = extract_json(text)
    if doc is not None:
        say = doc.get("say", doc.get("text", ""))
        say = _clean(say) if isinstance(say, str) else ""
        adjust = clamp_adjust(doc.get("adjust"), allowed, max_step)
        lookup = parse_lookup(doc.get("lookup"))
        acts = parse_acts(doc.get("act", doc.get("acts")), powers, codex)
        if say or adjust or lookup or acts:
            return Reply(say=say, adjust=adjust, lookup=lookup, acts=acts)
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


def parse_lookup(raw: object) -> tuple[str, ...]:
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return ()
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            name = " ".join(item.split())[:60]
            if name not in out:
                out.append(name)
        if len(out) >= MAX_LOOKUPS:
            break
    return tuple(out)


def parse_acts(raw: object, powers: list[dict[str, Any]] | tuple[dict[str, Any], ...], codex: tuple[str, ...]) -> tuple[dict[str, Any], ...]:
    items = raw if isinstance(raw, list) else [raw]
    out: list[dict[str, Any]] = []
    by_power = {fold(str(p.get("id", ""))): p for p in powers if isinstance(p, dict)}
    by_title = {fold(t): t for t in codex}
    for item in items:
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("share"), str):
            title = by_title.get(fold(item["share"]))
            if title is not None:
                out.append({"kind": "share", "entry": title})
            continue
        name = item.get("fire", item.get("power", item.get("use")))
        if isinstance(name, str):
            p = by_power.get(fold(name))
            if p is None:
                continue
            limit = p.get("limit")
            used = int(p.get("used") or 0)
            if isinstance(limit, (int, float)) and used >= limit:
                continue
            args = item.get("args")
            clean: dict[str, Any] = {}
            if isinstance(args, dict):
                for k, v in list(args.items())[:6]:
                    if isinstance(v, (str, int, float, bool)) and not isinstance(v, bool) or isinstance(v, bool):
                        clean[str(k)[:40]] = v if not isinstance(v, str) else v[:120]
            act: dict[str, Any] = {"kind": "fire", "name": str(p.get("id"))}
            if clean:
                act["args"] = clean
            out.append(act)
        if len(out) >= MAX_ACTS:
            break
    return tuple(out)
