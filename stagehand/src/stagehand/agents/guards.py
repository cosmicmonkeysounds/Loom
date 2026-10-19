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
     and a verdict anywhere near a cut (or on a topic) drops it. The memo
     scrub and the ALREADY SAID filter match loosely (`loose_pattern`:
     hyphens, joins, plurals), where matching too much costs nothing;
     guard 2 keeps the contract's exact phrase match.

Every function is pure; the notes they return go into the voice thought's
`note` (`guard: catchphrase stripped; repeat retry`). No note ever carries
the word that tripped a guard.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from functools import lru_cache
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
#: Beside `secrets._VERDICT`, the plain words that rule on an answer when
#: they stand by one in a memo ("… — that is right"), or share it with a
#: hunt topic; too common to drop a memo for anywhere else.
_NEAR_VERDICT = re.compile(r"\b(right|exactly|spot[\s-]on|nailed)\b", re.IGNORECASE)


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


_WORD_PART = re.compile(r"[^\W_]+")


@lru_cache(maxsize=64)
def loose_pattern(words: tuple[str, ...]) -> re.Pattern[str] | None:
    """A forgiving pattern over `words`, for the places where matching too
    much costs nothing (the memo scrub, another thread's lines): the words
    of an entry folded, any run of other characters (or none) between them
    — `periwinkle-tuesday`, `periwinkle_tuesday`, `periwinkletuesday` —
    and an optional plural (`quokkas`, `quokka's`). Word-bounded at both
    ends, case-folded. None when empty."""
    alts: list[str] = []
    for raw in words:
        parts = _WORD_PART.findall(str(raw).lower())
        if parts:
            alts.append(r"[\W_]*".join(re.escape(p) for p in parts))
    if not alts:
        return None
    body = "|".join(sorted(set(alts), key=len, reverse=True))
    return re.compile(rf"(?<![^\W_])(?:{body})(?:['’]?s|es)?(?![^\W_])", re.IGNORECASE)


def mentions_hunt(secrets: Secrets, text: str) -> bool:
    """True when `text` carries a `never` word, *any* `match` entry (the
    short numbers and single number words guard 2 lets pass included) or a
    hunt topic, matched loosely (`loose_pattern`): for the places where
    dropping a line costs nothing — the ALREADY SAID lines from other
    threads."""
    if secrets.leaks(text) or secrets.names_topic(text):
        return True
    pat = loose_pattern(tuple(secrets.match) + tuple(secrets.topics))
    return pat is not None and pat.search(str(text)) is not None


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


# -- 2b. an invented fact -------------------------------------------------------------

#: A sentence that states what a hunt topic's answer is ("… is titled …",
#: a quoted title, "the answer is …"). He never knows one, so it is made up.
_ASSERTS = re.compile(r"\b(?:is|was|are|were)\s+(?:titled|called|named)\b|\btitled\b|\bthe answer (?:is|was)\b|[\"“][^\"”]{2,}[\"”]", re.IGNORECASE)
#: He hands a fact over ("Here is a fact: …").
_GIVES = re.compile(r"\bhere(?:'s| is) (?:a|one|another|your) fact\b", re.IGNORECASE)
#: He offers to fetch or sell one ("I will retrieve that fact for you").
_OFFERS = re.compile(
    r"\b(?:i will|i'll|i can|i shall|i could|let me)\s+(?:\w+\s+){0,2}(?:provide|give|retrieve|tell|share|sell|find|fetch|get|reveal)\b[^.?!]{0,40}\b(?:fact|answer)s?\b",
    re.IGNORECASE,
)


#: He says where a fact (or the books that hold them) is: a named place
#: ("… are in the Optical Drive", "a fact tucked away in the Start Bar").
_PLACES = re.compile(
    r"\b(?i:facts?|books?)\b[^.?!]{0,40}\b(?i:are|is|lie|lies|sit|sits|hidden|tucked|kept|stored|waits?|awaits?)\b[^.?!]{0,30}\b(?i:in|on|under|behind|inside|at)\s+(?:(?i:the)\s+)?[A-Z]"
)


def invents_fact(secrets: Secrets, sentence: str) -> bool:
    """One sentence that gives a fact he cannot have: hands one over, offers
    to fetch or sell one, says where one is, or states the answer to a hunt
    topic (not as a question)."""
    text = sentence.replace("’", "'")
    if _GIVES.search(text) or _OFFERS.search(text):
        return True
    if not text.rstrip().endswith("?") and _PLACES.search(text):
        return True
    return not text.rstrip().endswith("?") and secrets.names_topic(text) and _ASSERTS.search(text) is not None


def invented_guard(persona: Persona, reply: Reply) -> tuple[Reply, list[str], bool]:
    """Guard 2b (K-04, wave 12 integration): cut each sentence that invents
    a fact. On gpt-oss:20b at low effort, "I'll find you something true"
    under a brief that says "you want facts now" was answered with a made-up
    title for a hunt question and a made-up hiding place; no answer word is
    in them, so guard 2 never saw them. Returns (reply, notes, empty): empty
    = nothing was left (the caller sends the fallback, no retry). Only for a
    persona with hunt `secrets`."""
    s = persona.secrets
    if not (s.topics or s.match) or not reply.say:
        return reply, [], False
    parts = [x for x in _SENTENCE.split(reply.say) if x.strip()]
    kept = [x for x in parts if not invents_fact(s, x)]
    if len(kept) == len(parts):
        return reply, [], False
    if not kept:
        return replace(reply, say=persona.fallback), ["answer-guard (invented fact → fallback)"], True
    return replace(reply, say=" ".join(kept).strip()), ["answer-guard (invented fact cut)"], False


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


def lines_to_them(said: Said, thread: Iterable[str] = ()) -> tuple[str, ...]:
    """What this guest has heard from him: his last 3 lines to them plus his
    free replies in this thread's history."""
    out = list(said.to_them[-3:])
    for line in thread:
        if line and line not in out:
            out.append(line)
    return tuple(out)


def repeats(say: str, said: Said, thread: Iterable[str] = ()) -> bool:
    """A near-repeat (half its 4-word runs) of a line this guest heard: his
    last 3 lines to them and his free replies in this thread.

    Lines he said to other guests are left to the ALREADY SAID warning in
    the prompt (design risk 5: "keep only the prompt warning"). K-04
    facts-offers, 14 guests offering facts in a row: the near-repeat rule
    over those lines retried 4 of 14 requests, and a word-for-word-only rule
    still 3 of 14, each a copy of the line the guest before had been given."""
    return bool(say) and any(repeats_line(say, old) for old in lines_to_them(said, thread))


def thread_replies(req: dict[str, Any]) -> tuple[str, ...]:
    """His free replies in this request's history (`mine`, not a story line)."""
    return tuple(
        str(h.get("text", ""))
        for h in req.get("history") or []
        if isinstance(h, dict) and h.get("mine") and h.get("story") is not True and str(h.get("text", "")).strip()
    )


def cut_exact_repeats(say: str, said: Said, thread: Iterable[str] = ()) -> str:
    """After the one retry: drop each sentence this guest has already heard
    from him word for word (folded). What is left is sent; "" when every
    sentence was old (the caller sends the fallback). A sentence he said to
    someone else is kept: cutting it sent the fallback to a guest offering
    a fact (K-04, facts-offers)."""
    olds = [fold(o) for o in lines_to_them(said, thread)]
    kept = [s for s in _SENTENCE.split(say) if s.strip() and not any(fold(s) and fold(s) in o for o in olds)]
    return " ".join(kept).strip()


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
    thread: Iterable[str] = (),
) -> Pass:
    """Guards 1–3 over `reply`, then (when `may_retry`) whether it wants the
    one retry: a catchphrase cut that left nothing, or a repeat. A line
    guard 1 or 2 withheld is the fallback and is never retried; with
    `repeat_guard` off nothing is (a catchphrase-only line is the fallback)."""
    out = Pass(reply=reply)
    original = reply.say
    out.reply, notes = never_guard(persona, out.reply)
    out.notes += notes
    # Guard 2 always runs: a line guard 1 withheld still has its acts (and
    # the fallback it now says is checked like any line).
    out.reply, notes = answer_guard(persona, out.reply, allowed)
    out.notes += notes
    withheld = out.reply.say != original
    if not withheld:
        out.reply, notes, emptied = invented_guard(persona, out.reply)
        out.notes += notes
        withheld = emptied
    out.withheld = withheld
    if withheld:
        return out
    before = out.reply.say
    out.reply, notes, empty = catchphrase_guard(persona, out.reply, person)
    out.notes += notes
    if empty:
        if not repeat_guard:
            # The retry is step 4's: with the repeat guard off (kill-switch
            # step 2) nothing costs a second call — the line is the fallback.
            out.reply = replace(out.reply, say=persona.fallback)
            out.notes.append("catchphrase → fallback (no retry: repeat guard off)")
            return out
        out.retry, out.rejected = "catchphrase", before
        return out
    if may_retry and repeat_guard and repeats(out.reply.say, said, thread):
        out.retry, out.rejected = "repeat", out.reply.say
    return out


# -- 5. the memo scrub -----------------------------------------------------------------


def scrub_memo(secrets: Secrets, memo: str) -> tuple[str, list[str]]:
    """(the memo as it may be kept, notes). See the module docstring."""
    if not memo:
        return "", []
    if secrets.leaks(memo):
        return "", ["memo dropped (never)"]
    pat = loose_pattern(tuple(secrets.match))
    text = memo.replace("’", "'")
    cut = pat.sub(_CUT, text) if pat is not None else text
    replaced = cut != text
    plain = cut.replace(_CUT, " ")
    topic = loose_pattern(tuple(secrets.topics))
    on_topic = secrets.names_topic(plain) or (topic is not None and topic.search(plain) is not None)
    if on_topic and (_VERDICT.search(plain) or _NEAR_VERDICT.search(plain)):
        return "", ["memo dropped (verdict on a topic)"]
    if replaced:
        tokens = list(_MEMO_TOKEN.finditer(cut))
        cuts = [i for i, t in enumerate(tokens) if t.group() == _CUT]
        for m in [*_VERDICT.finditer(cut), *_NEAR_VERDICT.finditer(cut)]:
            at = sum(1 for t in tokens if t.start() < m.start())
            if any(abs(at - c) <= VERDICT_REACH for c in cuts):
                return "", ["memo dropped (verdict by an answer)"]
    out = " ".join(cut.replace(_CUT, "…").split())
    return out, (["memo scrubbed"] if replaced else [])
