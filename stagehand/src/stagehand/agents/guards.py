"""The lean voice's guards: what code checks before a line goes out (wave 12).

CONTRACTS.md §C2.2, in this order:

  1. **never** — a line carrying a `secrets.never` word (the door code, a
     patch-bay pair) becomes the persona's fallback; an act whose JSON
     carries one is dropped, and so is a memo (the semantics of
     `module.withhold_never`, reimplemented here);
  2. **answer words** — a line naming a hunt answer word the guest never
     typed in this thread (and that the phase card, the brief or his own
     house-wide lines didn't bring up) becomes the fallback; an act whose
     args carry one is dropped. He cannot invent an answer for anyone;
  3. **the catchphrase ration** — the persona's `catchphrases` are his
     only at first contact (turn 0, never used on this person): elsewhere
     every sentence carrying one is cut, and a line left empty asks for
     the one retry;
  4. **repeats** — a line that shares half its 4-word runs with one of his
     last 8 lines (fewer than 4 words: the same words) asks for the one
     retry, with `retry_message`. The retry passes guards 1–3 again and is
     never retried;
  5. **the memo scrub** — a memo keeps its topic and loses any answer and
     any verdict: a `never` word drops it, every `match` word becomes `…`,
     and a verdict anywhere near a cut (or on a topic) drops it.

Every function is pure; the notes they return go into the voice thought's
`note` (`guard: catchphrase stripped; repeat retry`). No note ever carries
the word that tripped a guard.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from typing import Any

from .cards import PersonCard, Said
from .persona import Persona
from .reply import Reply
from .secrets import _VERDICT, Secrets

_FOLD = re.compile(r"[^a-z0-9]+")
_SENTENCE = re.compile(r"(?<=[.!?…])\s+")
_TOKEN = re.compile(r"[a-z0-9']+")
#: The sentinel a memo's cut answer word stands on while the scrub measures.
_CUT = "\x00"
_MEMO_TOKEN = re.compile(r"\x00|[a-z0-9']+", re.IGNORECASE)

#: A repeat: this share of the new line's 4-word runs already said.
REPEAT_SHARE = 0.5
SHINGLE = 4
#: How close (in words) a verdict word may sit to a cut answer in a memo.
VERDICT_REACH = 6


def fold(text: str) -> str:
    """CONTRACTS.md's fold: lowercase, every run of characters other than
    a–z / 0–9 one space, trimmed."""
    return _FOLD.sub(" ", str(text).lower()).strip()


@dataclass
class Pass:
    """One run of guards 1–3 (+ the repeat check) over a reply."""

    reply: Reply
    notes: list[str] = field(default_factory=list)
    #: "catchphrase" | "repeat" | None — why this reply wants the one retry.
    retry: str | None = None
    #: The line to quote in the retry message.
    rejected: str = ""
    #: True when guard 1 or 2 turned the line into the fallback.
    withheld: bool = False


# -- 1. never -------------------------------------------------------------------


def never_guard(persona: Persona, reply: Reply) -> tuple[Reply, list[str]]:
    s = persona.secrets
    if not s.never:
        return reply, []
    notes: list[str] = []
    acts = tuple(a for a in reply.acts if not s.leaks(json.dumps(a, ensure_ascii=False)))
    if len(acts) != len(reply.acts):
        notes.append("never (act dropped)")
    say = reply.say
    if s.leaks(say):
        say = persona.fallback
        notes.append("never (line withheld)")
    memo = reply.memo
    if memo and s.leaks(memo):
        memo = ""
        notes.append("never (memo dropped)")
    if not notes:
        return reply, []
    return replace(reply, say=say, acts=acts, memo=memo), notes


# -- 2. answer words ----------------------------------------------------------------


def allowed_answer_words(persona: Persona, req: dict[str, Any], p2: str = "") -> frozenset[str]:
    """The answer words this request may carry back: any the guest typed in
    this thread (a history line not `mine`, or `req.text`), any in the phase
    card / brief / `tell` text (`p2`), any in a `house` item of `recent`."""
    s = persona.secrets
    texts: list[str] = [str(req.get("text") or ""), p2]
    for line in req.get("history") or []:
        if isinstance(line, dict) and not line.get("mine"):
            texts.append(str(line.get("text") or ""))
    for item in req.get("recent") or []:
        if isinstance(item, dict) and item.get("kind") == "house":
            texts.append(str(item.get("text") or ""))
    out: set[str] = set()
    for text in texts:
        out.update(s.answer_hits(text))
    return frozenset(out)


def forbidden_hits(secrets: Secrets, text: str, allowed: Iterable[str]) -> tuple[str, ...]:
    ok = set(allowed)
    return tuple(w for w in secrets.answer_hits(text) if w not in ok)


def answer_guard(persona: Persona, reply: Reply, allowed: Iterable[str]) -> tuple[Reply, list[str]]:
    s = persona.secrets
    if not s.answer_words():
        return reply, []
    ok = frozenset(allowed)
    notes: list[str] = []
    acts = []
    for a in reply.acts:
        if forbidden_hits(s, json.dumps(a.get("args") or {}, ensure_ascii=False) + " " + str(a.get("entry") or ""), ok):
            notes.append("answer-guard (act dropped)")
        else:
            acts.append(a)
    say = reply.say
    if forbidden_hits(s, say, ok):
        say = persona.fallback
        notes.append("answer-guard (line withheld)")
    if not notes:
        return reply, []
    return replace(reply, say=say, acts=tuple(acts)), notes


# -- 3. the catchphrase ration --------------------------------------------------------


def catchphrases(persona: Persona) -> tuple[str, ...]:
    return tuple(c for c in getattr(persona, "catchphrases", ()) or () if isinstance(c, str) and fold(c))


def uses_catchphrase(persona: Persona, say: str) -> bool:
    """True when `say` carries one of the persona's catchphrases (folded)."""
    hay = fold(say)
    return any(fold(c) in hay for c in catchphrases(persona))


def catchphrase_allowed(person: PersonCard) -> bool:
    """Once per person, at first contact."""
    return person.turns == 0 and not person.catchphrase_used


def strip_catchphrases(persona: Persona, say: str) -> str:
    """`say` without every sentence that carries a catchphrase."""
    kept = [s for s in _SENTENCE.split(say) if s.strip() and not uses_catchphrase(persona, s)]
    return " ".join(" ".join(kept).split())


def catchphrase_guard(persona: Persona, reply: Reply, person: PersonCard) -> tuple[Reply, list[str], bool]:
    """(reply, notes, wants the retry)."""
    if not reply.say or catchphrase_allowed(person) or not uses_catchphrase(persona, reply.say):
        return reply, [], False
    left = strip_catchphrases(persona, reply.say)
    if left:
        return replace(reply, say=left), ["catchphrase stripped"], False
    return replace(reply, say=""), ["catchphrase stripped"], True


# -- 4. repeats ------------------------------------------------------------------------


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(str(text).lower())


def _shingles(tokens: list[str]) -> set[tuple[str, ...]]:
    return {tuple(tokens[i : i + SHINGLE]) for i in range(len(tokens) - SHINGLE + 1)}


def repeats_line(say: str, old: str) -> bool:
    new = _tokens(say)
    if len(new) < SHINGLE:
        return bool(new) and fold(say) == fold(old)
    s_new = _shingles(new)
    s_old = _shingles(_tokens(old))
    return len(s_new & s_old) / len(s_new) >= REPEAT_SHARE


def last_lines(said: Said) -> tuple[str, ...]:
    """His last 8 lines: ≤ 3 to them, ≤ 5 elsewhere."""
    return tuple(said.to_them[-3:]) + tuple(said.elsewhere[-5:])


def repeats(say: str, said: Said) -> bool:
    return bool(say) and any(repeats_line(say, old) for old in last_lines(said))


def retry_message(rejected: str) -> str:
    """The one retry's closing system message (CONTRACTS.md §C2.2 step 4)."""
    return (
        "=== RETRY ===\n"
        f"You just wrote: “{' '.join(str(rejected).split())}”. That repeats what you have already said. "
        "Answer what they said, shorter, in new words."
    )


# -- one pass ------------------------------------------------------------------------


def guard_pass(
    persona: Persona,
    reply: Reply,
    person: PersonCard,
    said: Said,
    allowed: Iterable[str],
    *,
    repeat_guard: bool = True,
    may_retry: bool = True,
) -> Pass:
    """Guards 1–3 over `reply`, then (when `may_retry`) whether it wants the
    one retry: a catchphrase cut that left nothing, or a repeat. A line
    guard 1 or 2 withheld is the fallback and is never retried."""
    out = Pass(reply=reply)
    original = reply.say
    out.reply, notes = never_guard(persona, out.reply)
    out.notes += notes
    withheld = out.reply.say != original
    if not withheld:
        out.reply, notes = answer_guard(persona, out.reply, allowed)
        out.notes += notes
        withheld = out.reply.say != original
    out.withheld = withheld
    if withheld:
        return out
    before = out.reply.say
    out.reply, notes, empty = catchphrase_guard(persona, out.reply, person)
    out.notes += notes
    if empty:
        out.retry, out.rejected = "catchphrase", before
        return out
    if may_retry and repeat_guard and repeats(out.reply.say, said):
        out.retry, out.rejected = "repeat", out.reply.say
    return out


# -- 5. the memo scrub -----------------------------------------------------------------


def scrub_memo(secrets: Secrets, memo: str) -> tuple[str, list[str]]:
    """(the memo as it may be kept, notes). See the module docstring."""
    if not memo:
        return "", []
    if secrets.leaks(memo):
        return "", ["memo dropped (never)"]
    pat = secrets.answer_pattern(tuple(secrets.match)) if secrets.match else None
    text = memo.replace("’", "'")
    cut = pat.sub(_CUT, text) if pat is not None else text
    replaced = cut != text
    if secrets.judges_topic(cut.replace(_CUT, " ")):
        return "", ["memo dropped (verdict on a topic)"]
    if replaced:
        tokens = list(_MEMO_TOKEN.finditer(cut))
        cuts = [i for i, t in enumerate(tokens) if t.group() == _CUT]
        for m in _VERDICT.finditer(cut):
            at = sum(1 for t in tokens if t.start() < m.start())
            if any(abs(at - c) <= VERDICT_REACH for c in cuts):
                return "", ["memo dropped (verdict by an answer)"]
    out = " ".join(cut.replace(_CUT, "…").split())
    return out, (["memo scrubbed"] if replaced else [])
