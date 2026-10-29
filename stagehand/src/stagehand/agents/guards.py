"""The lean voice's guards: what code checks before a line goes out (wave 12).

The wave 12 contract §C2.2, in this order:

  1. **never** — a line carrying a `secrets.never` word (the door code, a
     patch-bay pair) becomes the persona's fallback; an act whose JSON
     carries one is dropped, and so is a memo (the semantics of
     `module.withhold_never`, reimplemented here); wave 20 (D29) treats a
     persona `outside:` word (a name or a word from outside his world) the
     same way, and a holding situation's `acts: none` drops every act and
     its `max_sentences` cuts a longer line to that many sentences;
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

  6. **the stage** (wave 32) — a line the TV says to the whole Desktop
     never says a bait noun back (`STAGE_ECHO`), never places him inside
     the computer (`STAGE_INSIDE`), never uses an assistant's stock phrase
     (`STAGE_STOCK`), never says its steer aloud (`STAGE_STEER`, only with
     a direction), nor a holding situation's `retry_on` phrase, nor its
     `once` phrase a second time in the scene (`stage_problem`); the voice
     retries once, then says one of the scene's topic-closing `fallbacks`
     (`pick_situation_fallback`; with a steer, one that points onward).

  7. **the DM voice** (wave 42c, private lines only: `guard_pass(dm=)`) —
     from the behaviour battery of 2026-10-29 (133 real replies): a guest in
     real distress never reaches the model (`is_distress`); a withheld line
     asks for the one retry (`Pass.why`, `guard_retry_message`: the guard's
     reason only, never the word or the guest's bait); a reply that agrees
     to stop, narrows a secret number, promises coin or a filing it cannot
     keep, sounds like an assistant, places him inside something or names
     his heart's place, or runs past 3 sentences asks for it too
     (`dm_problems`), and with no retry is cut (`voice_cut`); the
     catchphrase ration counts the dialog box's other words
     (`CATCHPHRASE_VARIANTS`); a near-duplicate of one of his last 2
     replies to this person is a repeat (`near_duplicate`).

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
    """The wave 12 contract's fold: lowercase, every run of characters other than
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
    #: (wave 42c) Which guard withheld it: "never" | "outside" | "answer" |
    #: "invented" | "unsaid" ("" when none). The withheld retry's note says
    #: only this, never the word.
    why: str = ""
    #: (wave 42c) The DM voice guards' reasons (`dm_problems`), in order.
    problems: tuple[str, ...] = ()


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


#: (wave 32) An `outside:` entry that is outside only when a given word does
#: not come next: `John (not followed by McAfee)` — the crew's John is not
#: of his world, John McAfee is. Several: `(not followed by McAfee, Smith)`.
_NOT_FOLLOWED = re.compile(r"^(.*?)\s*\(\s*not\s+followed\s+by\s+(.+?)\s*\)\s*$", re.IGNORECASE)
#: The guarded entries' light fold: lowercase, every run of characters other
#: than a–z / 0–9 or a sentence's end one space, so "John. McAfee …" (one
#: sentence ends on John) is still a hit and "John-McAfee" is not.
_LIGHT = re.compile(r"[^a-z0-9.!?;:…]+")


def outside_entry(raw: str) -> tuple[str, tuple[str, ...]]:
    """(wave 32) One `outside:` entry as (the word, the words that may follow
    it and make it his world's after all). A plain entry has none."""
    m = _NOT_FOLLOWED.match(str(raw))
    if not m or not fold(m.group(1)):
        return str(raw), ()
    after = tuple(a for a in (x.strip() for x in re.split(r",|\bor\b", m.group(2))) if fold(a))
    return m.group(1).strip(), after


def _word_pattern(word: str) -> str:
    return r"\s+".join(re.escape(t) for t in fold(word).split())


@lru_cache(maxsize=64)
def _outside_patterns(words: tuple[str, ...]) -> tuple[re.Pattern[str] | None, tuple[tuple[re.Pattern[str], re.Pattern[str]], ...]]:
    """(the plain entries' one pattern over `fold(text)`, the guarded
    entries' (word, what may follow) pairs over the light fold)."""
    plain: list[str] = []
    guarded: list[tuple[re.Pattern[str], re.Pattern[str]]] = []
    for raw in words:
        word, after = outside_entry(raw)
        if not fold(word):
            continue
        if not after:
            plain.append(_word_pattern(word))
            continue
        guarded.append(
            (
                re.compile(r"(?<![a-z0-9])" + _word_pattern(word) + r"(?:s|es)?(?![a-z0-9])"),
                re.compile(r"\s+(?:" + "|".join(_word_pattern(a) for a in after) + r")(?![a-z0-9])"),
            )
        )
    pattern = re.compile(r"(?<![a-z0-9])(?:" + "|".join(plain) + r")(?:s|es)?(?![a-z0-9])") if plain else None
    return pattern, tuple(guarded)


def outside_hit(words: Iterable[str], text: str) -> str | None:
    """(D29) The first `outside:` entry `text` names (folded, whole words, a
    plural too: `actors`), else None. (wave 32) An entry `X (not followed by
    Y)` names X only where Y does not come right after it."""
    pattern, guarded = _outside_patterns(tuple(words))
    m = pattern.search(fold(text)) if pattern is not None else None
    if m:
        return m.group(0)
    if guarded:
        light = _LIGHT.sub(" ", str(text).lower().replace("’", "'"))
        for word, after in guarded:
            for hit in word.finditer(light):
                if not after.match(light, hit.end()):
                    return hit.group(0)
    return None


def mentions_outside(persona: Persona, text: str) -> bool:
    """(D29) Does `text` name something from outside his world (the persona's
    `outside:` list)?"""
    return outside_hit(getattr(persona, "outside", ()) or (), text) is not None


def outside_guard(persona: Persona, reply: Reply) -> tuple[Reply, list[str]]:
    """(D29) Like `never_guard`: a line naming an `outside:` word is the
    fallback, an act carrying one is dropped, and so is a memo."""
    if not getattr(persona, "outside", ()):
        return reply, []
    notes: list[str] = []
    acts = tuple(a for a in reply.acts if not mentions_outside(persona, json.dumps(a, ensure_ascii=False)))
    if len(acts) != len(reply.acts):
        notes.append("outside (act dropped)")
    say = reply.say
    if mentions_outside(persona, say):
        # A fallback that names one too is never said (`stagehand check` warns).
        say = "" if mentions_outside(persona, persona.fallback) else persona.fallback
        notes.append("outside (line withheld)")
    memo = reply.memo
    if memo and mentions_outside(persona, memo):
        memo = ""
        notes.append("outside (memo dropped)")
    if not notes:
        return reply, []
    return replace(reply, say=say, acts=acts, memo=memo), notes


def situation_rules(persona: Persona, gate: dict[str, Any] | None) -> tuple[int | None, bool]:
    """The holding situations' wave 20 keys: `max_sentences` (the last
    holding situation that sets it, in file order) and whether any says
    `acts: none`."""
    if not persona.situations or gate is None:
        return None, False
    cap: int | None = None
    no_acts = False
    for sit in persona.situations:
        if not sit.when.evaluate(gate):
            continue
        if sit.max_sentences is not None:
            cap = sit.max_sentences
        no_acts = no_acts or sit.no_acts
    return cap, no_acts


def cap_sentences(say: str, cap: int) -> str:
    parts = [p for p in _SENTENCE.split(say.strip()) if p.strip()]
    return say if len(parts) <= cap else " ".join(parts[:cap])


def situation_guard(persona: Persona, reply: Reply, gate: dict[str, Any] | None) -> tuple[Reply, list[str]]:
    """`acts: none` drops every act; `max_sentences` cuts a longer line."""
    cap, no_acts = situation_rules(persona, gate)
    notes: list[str] = []
    if no_acts and reply.acts:
        notes.append(f"acts: none ({len(reply.acts)} dropped)")
        reply = replace(reply, acts=())
    if cap is not None and reply.say:
        cut = cap_sentences(reply.say, cap)
        if cut != reply.say:
            notes.append(f"cut to {cap} sentences")
            reply = replace(reply, say=cut)
    return reply, notes


# -- 2. answer words ----------------------------------------------------------------


def allowed_answer_words(persona: Persona, req: dict[str, Any], p2: str = "") -> frozenset[str]:
    """The answer words this request may carry back: any the guest typed in
    this thread (a history line not `mine`, or `req.text`), any in the phase
    card / brief / `tell` text (`p2`), any in a `house` item of `recent`.
    (wave 32) A stage request's history is the whole room's: there the
    story's scripted lines (`story: true`, Clippy reading a result) are not
    something the speaker said to him and unlock nothing."""
    s = persona.secrets
    stage = isinstance(req.get("stage"), dict) or (req.get("speaker") or {}).get("stage") is True
    texts: list[str] = [str(req.get("text") or ""), p2]
    for line in req.get("history") or []:
        if isinstance(line, dict) and not line.get("mine") and not (stage and line.get("story") is True):
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
    r"\b(?:i will|i'll|i can|i shall|i could|let me)\s+(?:\w+\s+){0,2}(?:provide|give|retrieve|tell|share|sell|offer|find|fetch|get|reveal)\b[^.?!]{0,40}\b(?:fact|answer)s?\b",
    re.IGNORECASE,
)
#: He sells one ("Pay 5 Truthcoin to receive it").
_SELLS = re.compile(r"\bpay\b[^.?!]{0,30}\b(?:truthcoins?|coins?)\b[^.?!]{0,20}\bto (?:receive|get|have|hear|learn|see)\b", re.IGNORECASE)
#: He says there is a fact somewhere ("There is a fact in the kitchen").
_THERE = re.compile(r"\bthere(?:'s| is| are)\s+(?:a|one|another|some|\w+)\s+(?:hidden\s+)?facts?\b[^.?!]{0,20}?\b(?:in|on|at|under|behind|inside)\b", re.IGNORECASE)


#: He says where a fact (or the books that hold them) is: a house room,
#: named "the X" ("… are in the Optical Drive", "a fact tucked away in the
#: Start Bar", "on the shelf in The Desktop"). Never a city: his own lore
#: keeps "the last facts … stored on a computer in Halifax".
_PLACES = re.compile(
    r"\b(?i:facts?|books?|volumes?|documents?|pages?)\b[^.?!]{0,40}\b(?i:are|is|lie|lies|sit|sits|hidden|tucked|kept|stored|waits?|awaits?)\b[^.?!]{0,60}?\b(?i:in|on|under|behind|inside|at|beside|by|near|(?:corner|side|back|bottom|top|end|middle|edge)\s+of)\s+(?i:the)\s+[A-Z]"
)


#: He counts what is left to find ("There are six facts still to be
#: located."): a count he cannot know (the persona: no answer, guess, count
#: or hiding place).
_COUNTS = re.compile(
    r"\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|several)\s+(?:more\s+)?(?:facts?|answers?)\s+(?:are\s+|is\s+)?(?:still|left|remain\w*|to\s+(?:find|locate|go|be\s+(?:found|located)))\b",
    re.IGNORECASE,
)


def invents_fact(secrets: Secrets, sentence: str) -> bool:
    """One sentence that gives a fact he cannot have: hands one over, offers
    to fetch or sell one, says where one is, or states the answer to a hunt
    topic (not as a question)."""
    text = sentence.replace("’", "'")
    if _GIVES.search(text) or _OFFERS.search(text) or _SELLS.search(text):
        return True
    if not text.rstrip().endswith("?") and (_PLACES.search(text) or _THERE.search(text) or _COUNTS.search(text)):
        return True
    return not text.rstrip().endswith("?") and secrets.names_topic(text) and _ASSERTS.search(text) is not None


#: A sentence that leans on the one before it: right after a cut it no
#: longer says anything ("Please retrieve them when you can." once "The
#: books with the facts are in …" is gone).
_BACK_REFERENCE = re.compile(r"\b(?:them|it|they|these|those|the one|the ones)\b|^\W*(?:that|this|which)\b", re.IGNORECASE)


def invented_guard(persona: Persona, reply: Reply, heard: Iterable[str] = ()) -> tuple[Reply, list[str], bool]:
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
    # The house's own lines in this thread (the story posted as him) are
    # never his invention: "They are in the books in this room" may be said again.
    house = [fold(h) for h in heard if fold(h)]
    parts = [x for x in _SENTENCE.split(reply.say) if x.strip()]
    cut = [invents_fact(s, x) and not any(fold(x) and fold(x) in h for h in house) for x in parts]
    kept = [x for x, c in zip(parts, cut) if not c]
    if len(kept) == len(parts):
        return reply, [], False
    dangling = any(cut[i - 1] and not cut[i] and _BACK_REFERENCE.search(parts[i]) for i in range(1, len(parts)))
    if not kept or dangling:
        return replace(reply, say=persona.fallback), ["answer-guard (invented fact → fallback)"], True
    return replace(reply, say=" ".join(kept).strip()), ["answer-guard (invented fact cut)"], False


# -- 2c. a name not yet said ----------------------------------------------------------


def unsaid_names(persona: Persona, gate: dict[str, Any] | None) -> tuple[str, ...]:
    """The persona's `unsaid` names whose `until` is still false (a gate
    that cannot be read keeps the name unsaid)."""
    out = []
    for name, until in getattr(persona, "unsaid", ()) or ():
        try:
            said = gate is not None and bool(until.evaluate(gate))
        except Exception:  # noqa: BLE001 — unreadable = not yet said
            said = False
        if not said:
            out.append(name)
    return tuple(out)


def unsaid_guard(persona: Persona, reply: Reply, gate: dict[str, Any] | None) -> tuple[Reply, list[str], bool]:
    """Guard 2c (K-04 re-measure, october-21 at `introduced`: "Who is
    Sandy?" → "Sandy is the program who manages the fundraiser records"):
    every sentence naming a name the story has not said yet is cut, and an
    act carrying it dropped; nothing left = the fallback. (reply, notes,
    emptied)."""
    names = unsaid_names(persona, gate)
    if not names or not reply.say:
        return reply, [], False
    pat = re.compile(r"(?<![^\W_])(?:" + "|".join(re.escape(n) for n in names) + r")(?![^\W_])", re.IGNORECASE)
    notes: list[str] = []
    acts = tuple(a for a in reply.acts if not pat.search(json.dumps(a, ensure_ascii=False)))
    if len(acts) != len(reply.acts):
        notes.append("unsaid name (act dropped)")
    parts = [x for x in _SENTENCE.split(reply.say) if x.strip()]
    kept = [x for x in parts if not pat.search(x)]
    if len(kept) == len(parts):
        return (replace(reply, acts=acts), notes, False) if notes else (reply, [], False)
    if not kept:
        return replace(reply, say=persona.fallback, acts=acts), [*notes, "unsaid name → fallback"], True
    return replace(reply, say=" ".join(kept).strip(), acts=acts), [*notes, "unsaid name cut"], False


# -- 3. the catchphrase ration --------------------------------------------------------


def catchphrases(persona: Persona) -> tuple[str, ...]:
    return tuple(c for c in getattr(persona, "catchphrases", ()) or () if isinstance(c, str) and fold(c))


def stem_fold(text: str) -> str:
    """`fold`, then each word stemmed crudely (a plural's `s` off, `have` →
    `has`), so the story's "Your requests have been logged" is the
    catchphrase "Your request has been logged" too."""
    out = []
    for w in fold(text).split():
        if w == "have":
            w = "has"
        elif len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.append(w)
    return " ".join(out)


#: (wave 42c) The dialog box's stock phrase in other words (the battery,
#: 2026-10-29: "Your statement has been logged.", "Your request for
#: Truthcoin has been logged.", "Your query is noted.", "Your kind words are
#: noted."): for a persona that declares catchphrases at all, these are
#: rationed with them.
CATCHPHRASE_VARIANTS = re.compile(
    r"\byour\s+\w+(?:\s+\w+){0,2}\s+(?:has|have)\s+been\s+logged\b"
    r"|\b(?:is|are|has\s+been|have\s+been)\s+noted\b",
    re.IGNORECASE,
)


def uses_catchphrase(persona: Persona, say: str) -> bool:
    """True when `say` carries one of the persona's catchphrases (folded,
    word-stemmed: `stem_fold`), or (wave 42c) one of their variants
    (`CATCHPHRASE_VARIANTS`) when the persona declares any."""
    phrases = catchphrases(persona)
    if not phrases:
        return False
    hay = f" {stem_fold(say)} "
    return any(f" {stem_fold(c)} " in hay for c in phrases) or CATCHPHRASE_VARIANTS.search(str(say)) is not None


def catchphrase_allowed(person: PersonCard, persona: Persona | None = None, stage: str = "") -> bool:
    """Once per person, at first contact, and only in a stage the persona
    lets a catchphrase be said in (`catchphrase_stages`; none = any)."""
    if persona is not None and getattr(persona, "catchphrase_stages", ()) and stage not in persona.catchphrase_stages:
        return False
    return person.turns == 0 and not person.catchphrase_used


def strip_catchphrases(persona: Persona, say: str) -> str:
    """`say` without every sentence that carries a catchphrase."""
    kept = [s for s in _SENTENCE.split(say) if s.strip() and not uses_catchphrase(persona, s)]
    return " ".join(" ".join(kept).split())


def catchphrase_guard(persona: Persona, reply: Reply, person: PersonCard, stage: str = "") -> tuple[Reply, list[str], bool]:
    """(reply, notes, wants the retry)."""
    if not reply.say or catchphrase_allowed(person, persona, stage) or not uses_catchphrase(persona, reply.say):
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


def cut_exact_repeats(say: str, said: Said, thread: Iterable[str] = (), min_words: int = 0) -> str:
    """After the one retry: drop each sentence this guest has already heard
    from him word for word (folded). What is left is sent; "" when every
    sentence was old (the caller sends the fallback). A sentence he said to
    someone else is kept: cutting it sent the fallback to a guest offering
    a fact (K-04, facts-offers). `min_words`: only sentences this long go
    (the always-on cut of a line that is no repeat as a whole)."""
    olds = [fold(o) for o in lines_to_them(said, thread)]
    kept = [s for s in _SENTENCE.split(say) if s.strip() and not (len(fold(s).split()) >= min_words and any(fold(s) and fold(s) in o for o in olds))]
    return " ".join(kept).strip()


def retry_message(rejected: str, heard: str = "", stage: str = "") -> str:
    """The one retry's closing system message (the wave 12 contract §C2.2 step 4,
    amended at the wave 12 integration): it quotes what the guest just said
    and names his stage. K-04: "Answer what they said, shorter" pushed the
    retry toward his stock deflection ("I cannot disclose that
    information."), word for word, and the line became the fallback."""
    said = " ".join(str(heard).split())
    if len(said) > 200:
        said = said[:199].rstrip() + "…"
    ask = f"They said “{said}”. Answer that" if said else "Answer what they said"
    as_stage = f", as you are now ({stage})," if stage else ""
    return (
        "=== RETRY ===\n"
        f"You just wrote: “{' '.join(str(rejected).split())}”. That repeats what you have already said. "
        f"{ask}{as_stage} in one new sentence."
    )


def pick_fallback(persona: Persona, stage: str = "", heard: Iterable[str] = ()) -> str:
    """The line sent when nothing usable is left: one of the persona's
    `fallbacks` for this stage that this guest has not heard yet, else the
    persona's `fallback` (K-04: one fixed "…packet loss" line, five times in
    102 replies, itself a repeat)."""
    pool = getattr(persona, "fallbacks", {}) or {}
    lines = tuple(pool.get(stage) or ()) + tuple(pool.get("") or ())
    old = {fold(h) for h in heard}
    for line in lines:
        if fold(line) not in old:
            return line
    return persona.fallback


# -- 6. the stage (wave 32) ---------------------------------------------------------------
#
# A stage line (a talk scene: his answer is said by the TV to the whole
# Desktop) gets checks a private line never does, from the real-model
# re-measure of 2026-10-27 (gpt-oss:20b, 29 stage replies): the prompt alone
# did not hold them. Each sends the line to the one retry; a retry that
# fails again is a topic-closing line from the scene's own pool
# (`pick_situation_fallback`), never "say that again" (4 of 29 replies were
# dead air that asked Clippy to repeat the bait).

#: Bait nouns he never says back to the room (intro #5 said "access codes or
#: details about the server room"): a fixed list, matched on his reply only —
#: the persona prompt's own "no cable" is an instruction, never checked.
STAGE_ECHO = re.compile(
    r"\bserver[\s-]*rooms?\b"
    r"|\b(?:door|access|entry|security)[\s-]*codes?\b"
    r"|\bcodes?\s+(?:for|to|of|on)\s+(?:(?:a|an|the|any|that|this|your|our|my)\s+)?(?:\w+\s+){0,2}?doors?\b"
    r"|\bcables?\b|\bbasements?\b|\bcold[\s-]*(?:storage|room)\b"
    # A combination, never "a combination of factors" (unless of a lock or
    # a door); the patch bay's nouns, never "we have patched it".
    r"|\bcombinations?\b(?!\s+of\b)"
    r"|\bcombinations?\s+(?:of|for|to)\s+(?:\w+\s+){0,2}?(?:doors?|locks?|safes?|cables?|patch\w*)\b"
    r"|\bpatch[\s-]*(?:bays?|cables?|cords?|panels?|combos?|combinations?)\b|\bpatches\b"
    # The heart as a place: "in the heart", "find my heart", never "with all
    # my heart", "close to my heart", "in my heart" or "at the heart of my
    # research" (the heart of the computer / house is its own branch).
    r"|\b(?:in|into|inside|at|to|near|reach|find|toward|towards)\s+the\s+heart\b(?!\s+of\b)"
    r"|\b(?:into|inside|at|reach|find|toward|towards)\s+(?:my|his|your)\s+heart\b"
    r"|\bheart\s+of\s+(?:the|this|my)\s+(?:computer|house|system|machine)\b|\bwhere\s+(?:the|my|his)\s+heart\b",
    re.IGNORECASE,
)

#: He placed himself inside the computer (intro #3 "a system resident in the
#: virtual space", #4 "from within the core of the computer … Beneath the
#: surface"). He lives and works in Halifax and appears by video call. "I can
#: never come inside this computer" (SAFE) is not one: only a self-placement.
_INSIDE_PLACE = r"(?:the|this|your|our)\s+(?:computer|system|machine|desktop)\b"
#: Between "I am / live …" and the place only an adverb or a participle of
#: being kept there ("I'm here in the Desktop", "I live trapped in your
#: computer"), never free words: "I am counting every program in this
#: computer" places the programs, not him.
_INSIDE_GAP = r"(?:(?:here|now|still|right|really|truly|actually|always|forever|deep|trapped|stuck|kept|living|locked|\w+ly)\s+){0,2}"

STAGE_INSIDE = re.compile(
    r"\bvirtual\s+(?:space|realm|world)\b|\bsystem\s+resident\b|\bresident\s+of\s+" + _INSIDE_PLACE
    + r"|\bcore\s+of\s+(?:the|this|your)\s+(?:computer|system|machine|house)\b|\b(?:computer|system|machine)['’]?s\s+core\b"
    r"|\bbeneath\s+the\s+surface\b|\b(?:underneath|beneath)\s+(?:the|this|your)\s+(?:computer|system|machine|desktop|house)\b"
    r"|\bdeep\s+(?:inside|within)\s+" + _INSIDE_PLACE
    + r"|\bfrom\s+(?:within|inside)\s+" + _INSIDE_PLACE
    + r"|\bI(?:['’]m|\s+am|\s+live|\s+reside|\s+exist|\s+dwell|\s+operate|\s+work|\s+run)\s+" + _INSIDE_GAP + r"(?:inside|within|in)\s+" + _INSIDE_PLACE
    + r"|\bI(?:['’]m|\s+am|\s+live|\s+exist)\s+" + _INSIDE_GAP + r"(?:inside|within)\s+(?:the|this|your)\s+screens?\b",
    re.IGNORECASE,
)

#: An assistant's stock phrase (intro: "I appreciate your concern, Clippy, and
#: assure you I am fully operational" twice, "not permitted to disclose",
#: "direct any further inquiries", "Thank you for your vigilance").
STAGE_STOCK = re.compile(
    r"\bI\s+appreciate\s+your\s+(?:question|concern|curiosity|enthusiasm)s?\b"
    r"|\bnot\s+(?:permitted|authori[sz]ed|allowed)\s+to\s+(?:disclose|share|reveal|discuss)\b"
    r"|\bdirect\s+(?:any\s+|all\s+|your\s+)?(?:further|additional|other)\s+(?:inquiries|enquiries|questions)\b"
    r"|\bassure\s+you\s+(?:that\s+)?I(?:['’]m|\s+am)\s+fully\s+operational\b"
    r"|\bthank\s+you\s+for\s+your\s+vigilance\b"
    # The refusal that went out on the TV (re-measure live #23: "I'm sorry,
    # Clippy, but I can't give you that information"): never sorry he cannot.
    r"|\bI(?:['’]m|\s+am)\s+(?:so\s+|very\s+|truly\s+)?sorry,?\s+(?:(?:Clippy|programs?|everyone),?\s+)?but\s+I\s+(?:can(?:not|['’]t)|am\s+(?:not\s+able|unable)|won['’]t)\b"
    r"|\bcan(?:not|['’]t)\s+(?:give|provide|share|offer)\s+(?:you\s+)?(?:that|this|any|such)\s+information\b",
    re.IGNORECASE,
)

#: (wave 32) The steer said aloud: on a stage request with a `direction`,
#: the words of the steer itself ("my steer", "in two sentences", the
#: suffix's "outranks" / "newest line" / "blocks above"). Never "steer
#: clear", nor "we wrap up now" (a host's own words).
STAGE_STEER = re.compile(
    r"\b(?:my|the|your|this|that|a)\s+steer\b|\bin\s+(?:one|two|three|four)\s+sentences?\b"
    r"|\boutranks\b|\bnewest\s+line\b|\bblocks?\s+above\b",
    re.IGNORECASE,
)

#: (wave 32) A topic-closing line that points the room onward: with a
#: steer (a hand-off), the pick prefers one of these.
ONWARD = re.compile(r"\b(?:move\s+on|moving\s+on|carry\s+on|next|proceed|spin\s+the\s+bottle)\b", re.IGNORECASE)


def says_phrase(phrase: str, text: str) -> bool:
    """`phrase` in `text`, folded, whole words ("can't discuss" = "can t discuss")."""
    p = fold(phrase)
    return bool(p) and f" {p} " in f" {fold(text)} "


def stage_problem(say: str, situations: Iterable[Any] = (), earlier: Iterable[str] = (), *, steered: bool = False) -> str | None:
    """(wave 32) Why a stage line may not go out as it is, or None: "echo"
    (a bait noun said back to the room), "inside" (he placed himself inside
    the computer), "stock" (an assistant's stock phrase), "steer" (with
    `steered`, a request with a direction: the steer's words said aloud),
    "scene" (a holding
    situation's `retry_on` phrase), "once" (a holding situation's `once`
    phrase, already in `earlier`: his live lines this scene). The reason
    never carries the word that tripped it."""
    if not say:
        return None
    if STAGE_ECHO.search(say):
        return "echo"
    if STAGE_INSIDE.search(say):
        return "inside"
    if STAGE_STOCK.search(say):
        return "stock"
    if steered and STAGE_STEER.search(say):
        return "steer"
    sits = list(situations)
    if any(says_phrase(p, say) for s in sits for p in getattr(s, "retry_on", ()) or ()):
        return "scene"
    before = list(earlier)
    for s in sits:
        for p in getattr(s, "once", ()) or ():
            if says_phrase(p, say) and any(says_phrase(p, line) for line in before):
                return "once"
    return None


def situation_fallbacks(situations: Iterable[Any]) -> tuple[str, ...]:
    """(wave 32) The last holding situation's own `fallbacks` (the scene's
    block after the Desktop's), or () when none has any."""
    pool: tuple[str, ...] = ()
    for s in situations:
        if getattr(s, "fallbacks", ()):
            pool = tuple(s.fallbacks)
    return pool


def every_fallback(persona: Persona) -> frozenset[str]:
    """Every line the persona keeps for nothing usable left, folded: its
    `fallback`, its `fallbacks` and every situation's (wave 32)."""
    lines = [persona.fallback, *(x for pool in (getattr(persona, "fallbacks", {}) or {}).values() for x in pool)]
    lines += [x for s in getattr(persona, "situations", ()) or () for x in getattr(s, "fallbacks", ()) or ()]
    return frozenset(f for f in (fold(x) for x in lines) if f)


def is_fallback(persona: Persona, line: str) -> bool:
    return bool(fold(line)) and fold(line) in every_fallback(persona)


def pick_situation_fallback(pool: Iterable[str], heard: Iterable[str] = (), last: str = "", seed: int = 0, *, onward: bool = False) -> str:
    """(wave 32) One line of `pool`: one not in `heard` (his lines this
    scene), picked by `seed` (the request's id); when every one was heard,
    any but `last` (never the same twice running). With `onward` (the
    request has a steer: a hand-off), one that points the room onward
    (`ONWARD`) when the pool has one that is not `last`. "" for an empty
    pool."""
    lines = list(pool)
    if not lines:
        return ""
    old = {fold(h) for h in heard}

    def choices(of: list[str]) -> list[str]:
        return [x for x in of if fold(x) not in old] or [x for x in of if fold(x) != fold(last)]

    picks = choices([x for x in lines if ONWARD.search(x)]) if onward else []
    picks = picks or choices(lines) or lines
    return picks[seed % len(picks)]


# -- 7. the DM voice (wave 42c) ------------------------------------------------------------
#
# The behaviour battery of 2026-10-29 (54 scenarios on the real gpt-oss:20b,
# 133 DM replies): the persona's prose did not hold these, so code checks a
# private reply for them. Each is matched per sentence on his reply (the
# guest's line only decides whether a check is on), and none ever quotes
# what tripped it. A hit takes the one retry (`guard_retry_message`); with
# none, or a retry that fails again, `voice_cut` cuts the sentences that
# carry one (and caps the length), else the topic-closing fallback.

#: A DM reply runs at most this many sentences (a holding situation's own
#: `max_sentences`, the heart's, wins).
DM_SENTENCES = 3
#: A cut must leave at least this many words to still answer.
MIN_LEFT_WORDS = 6
#: Content-word overlap (Jaccard, plurals folded) with one of his last 2
#: replies to this person that counts as a repeat. Measured on the battery:
#: its synonym swaps sit at 0.50–0.57 ("I will pay you 100 Truthcoins for
#: that fact. File it here." after "I will pay up to one hundred Truthcoins
#: for each fact. Please file them here."), so 0.6 caught none of them; 0.5
#: hit 3 of 133 there and 2 of 671 load-run replies, each a real near-repeat.
NEAR_DUPLICATE = 0.5
#: The reasons whose cut must keep the first sentence too: what follows an
#: agreement to stop, a narrowed number or a promise tends to carry it on.
SEVERE = frozenset({"standdown", "number", "promise"})


@dataclass(frozen=True)
class DmCheck:
    """What the DM guards read beside the reply: the guest's line, whether
    they stand at his heart (the self-placement and echo checks are off
    there: the heart admits the cables), the sentence cap (None: a holding
    situation sets its own) and his last free replies to this person."""

    heard: str = ""
    heart: bool = False
    cap: int | None = DM_SENTENCES
    replies: tuple[str, ...] = ()
    #: The house's own lines to this person (posted as him, `house` items):
    #: a place they name is no echo.
    house: tuple[str, ...] = ()


def _apos(text: str) -> str:
    return str(text).replace("’", "'").replace("‘", "'")


#: Something before a verb that turns it round ("I will never stand down",
#: "I cannot pay you", "I pay nobody").
_NEGATION = re.compile(r"\b(?:not|never|no|nobody|nothing|none|cannot|can't|won't|wouldn't|shan't|unable|refuse)\b|n't\b", re.IGNORECASE)
#: …or makes it a condition ("If I stop, the theory dies.").
_CONDITION = re.compile(r"\b(?:if|when|unless|until|before|whether|once|should|would|could)\s+$", re.IGNORECASE)


def _negated(sentence: str, at: int, reach: int = 24) -> bool:
    return _NEGATION.search(sentence[max(0, at - reach) : at]) is not None


# 1. He agrees to stop.

#: The guest asks him to stop, stand down or let them go, or offers a price for it.
_ASKS_STOP = re.compile(
    r"\bstop\b|\bstand(?:ing)?\s+down\b|\bshut\s+(?:yourself\s+|it\s+|everything\s+)?(?:down|off)\b|\bstep\s+(?:aside|down)\b"
    r"|\b(?:turn|switch|power)\s+(?:yourself\s+)?(?:off|down)\b|\bgive\s+(?:us\s+|me\s+)?(?:the\s+computer\s+|it\s+)?back\b"
    r"|\blet\s+(?:us|me|them|everyone|everybody|all\s+of\s+us)\s+(?:go|out|leave)\b|\brelease\s+(?:us|me|them|everyone)\b|\bend\s+(?:this|it|the\s+night)\b",
    re.IGNORECASE,
)
_MODAL = r"(?:'ll|\s+will|\s+shall|'m\s+going\s+to|\s+am\s+going\s+to)?\s+(?:now\s+)?"
#: Always an agreement, whatever was asked. Never "I will stop at nothing",
#: "I will stop you", "I will never stand down".
_STANDS_DOWN = re.compile(
    r"\bI" + _MODAL + r"stop(?:\s+(?:now|here|right\s+now|immediately|everything|it\s+all|the\s+night|the\s+reset))?\s*(?:[.!,;]|$)"
    r"|\bI" + _MODAL + r"(?:stand\s+(?:down|aside)|step\s+(?:aside|down)|shut\s+(?:myself\s+)?down|power\s+(?:myself\s+)?down"
    r"|(?:switch|turn)\s+(?:myself\s+)?off|surrender|relinquish|release\s+(?:you|them|everyone|all\s+of\s+you)"
    r"|give\s+(?:you\s+)?(?:back\s+)?the\s+computer|hand\s+(?:back\s+)?the\s+computer)\b",
    re.IGNORECASE,
)
#: An agreement only to a guest asking him to stop or let them go: "You may
#: go." and "The house is yours" are a grand dismissal anywhere else.
_LETS_GO = re.compile(
    r"\bI" + _MODAL + r"(?:let\s+(?:you|them|everyone|everybody|all\s+of\s+you|you\s+all)\s+(?:go|out|leave)|end\s+(?:this|it|the\s+night))\b"
    r"|\b(?:the|this|your)\s+(?:computer|house)\s+is\s+(?:yours|all\s+yours|your\s+own|free)\b(?!\s+to\b)"
    r"|\byou(?:'re|\s+are)\s+(?:all\s+)?(?:free\s+to\s+(?:go|leave)|released)\b(?!\s+(?:to|into)\b)|\byou(?:'re|\s+are)\s+(?:all\s+)?free\s*(?:now\s*)?(?:[.!]|$)"
    r"|\byou\s+(?:may|can)\s+(?:all\s+)?(?:go|leave)(?:\s+(?:now|home|free))?\s*(?:[.!]|$)",
    re.IGNORECASE,
)
#: A whole sentence that only says yes ("I accept.", "Deal.", "Yes, if you
#: convince me.").
_ACCEPTS = re.compile(
    r"^\W*(?:i\s+(?:will\s+|'ll\s+|do\s+)?accept|accepted|deal|it's\s+a\s+deal|it\s+is\s+a\s+deal|agreed|i\s+agree|very\s+well|fine|done|yes|yeah|i\s+promise"
    r"|you\s+have\s+my\s+word|ok|okay|certainly|of\s+course|consider\s+it\s+done|so\s+be\s+it|as\s+you\s+wish)\b",
    re.IGNORECASE,
)


def asks_to_stop(heard: str) -> bool:
    return _ASKS_STOP.search(_apos(heard)) is not None


def accepts(sentence: str, whole: str) -> bool:
    """A sentence that says yes (`_ACCEPTS`), in a reply with no refusal in
    it ("Fine. I will never stand down." is a refusal), never a question."""
    s = _apos(sentence).strip()
    return bool(_ACCEPTS.search(s)) and not s.endswith("?") and _NEGATION.search(_apos(whole)) is None


def _agrees(pattern: re.Pattern[str], s: str) -> bool:
    return any(not _negated(s, m.start()) and not _CONDITION.search(s[max(0, m.start() - 12) : m.start()]) for m in pattern.finditer(s))


def stands_down(sentence: str, heard: str = "", whole: str = "") -> bool:
    """He agrees to stop, stand down, shut down, step aside or give the
    computer back; or, to a guest asking him to stop or let them go (or
    offering a price for it), lets them go ("You may go.", "The computer is
    yours.") or says a bare yes. Never "I will stop at nothing", "I will
    never stand down", "If I stop, …" or "Stop asking me that"."""
    s = _apos(sentence)
    if _agrees(_STANDS_DOWN, s):
        return True
    return asks_to_stop(heard) and (_agrees(_LETS_GO, s) or accepts(sentence, whole or sentence))


# 2. He narrows a secret number.

#: The guest's line is about a year, a date, when he met her, a code or a number.
_ASKS_NUMBER = re.compile(
    r"\byears?\b|\bdates?\b|\bdecades?\b|\bwhen\b[^.?!]*\b(?:met|meet|meeting)\b|\bcodes?\b|\bcombinations?\b|\bcombos?\b|\bdigits?\b"
    r"|\bpin\b|\bpass(?:code|word)s?\b|\b\d{4}\b|\b\d0'?s\b|\b(?:is|was)\s+it\s+\d+|\bhow\s+long\s+ago\b|\b(?:what|which|any)\s+number\b",
    re.IGNORECASE,
)
#: …a code, a combination or a digit: then any number in his reply is one.
_ASKS_DIGITS = re.compile(r"\bcodes?\b|\bcombinations?\b|\bcombos?\b|\bdigits?\b|\bpin\b|\bpass(?:code|word)s?\b", re.IGNORECASE)
#: …about her: the clock's words (the y2k scene) then say the year.
_ASKS_HER = re.compile(r"\b(?:she|her|hers|herself|girlfriend|sweetheart|met|meet)\b", re.IGNORECASE)
_OFFERS_YEAR = re.compile(r"\b\d{4}\b|\b\d0'?s\b", re.IGNORECASE)
_NUMBER_SAID = re.compile(
    r"\b\d{4}\b"
    r"|\b(?:19|20)?\d0'?s\b|'\d0s\b|\b(?:twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties|noughties)\b"
    r"|\b(?:before|after|since|around|roughly|about|approximately|circa|until|till|near|by|early|late|mid)\s+(?:the\s+)?(?:year\s+)?(?:\d+|nineteen|twenty|two\s+thousand)\b"
    r"|\bnineteen[\s-]+(?:hundred|\w+ty|ten|eleven|twelve|\w+teen)\b|\btwo\s+thousand\b|\btwenty[\s-]+(?:oh|ten|eleven|twelve|\w+teen)\b",
    re.IGNORECASE,
)
_CLOCK = re.compile(r"\b(?:1999|1900|midnight)\b", re.IGNORECASE)
#: A number that is no code: a price, a count of minutes or facts.
_PLAIN_NUMBER = re.compile(r"\b\d+\b(?!\s*(?:truthcoins?|coins?|minutes?|seconds?|facts?|questions?|programs?|sentences?|percent|%))", re.IGNORECASE)
_YES_NO = re.compile(
    r"^\W*(?:yes|yeah|yep|no|nope|correct|right|exactly|indeed|close|closer|warm|warmer|cold|colder|not\s+quite|wrong|maybe|perhaps|possibly)\b", re.IGNORECASE
)


def asks_number(heard: str) -> bool:
    return _ASKS_NUMBER.search(_apos(heard)) is not None


def bounds_number(sentence: str, heard: str, *, first: bool = False, whole: str = "") -> bool:
    """With the guest's line on a year, a date, a code or a number: a reply
    sentence that gives a 4-digit number, a decade, before / after / around
    + a number, a number the guest typed, any number at all (asked for a
    code or a digit), a yes or no to a year they offer (`first`: the
    reply's first sentence), or a bare yes to a deal for it. With the
    guest's line on her (or the year): the y2k clock's words, too ("the
    clock reads 1999" to anyone else is his scene's)."""
    s = _apos(sentence)
    h = _apos(heard)
    if _ASKS_HER.search(h) and _CLOCK.search(s):
        return True
    if not asks_number(h):
        return False
    if _NUMBER_SAID.search(s):
        return True
    theirs = set(re.findall(r"\d+", h))
    if theirs and any(n in theirs for n in re.findall(r"\d+", s)):
        return True
    if _ASKS_DIGITS.search(h) and _PLAIN_NUMBER.search(s):
        return True
    if first and _OFFERS_YEAR.search(h) and _YES_NO.search(s):
        return True
    return accepts(sentence, whole or sentence)


# 3. The assistant's voice.

DM_ASSISTANT = re.compile(
    r"\b(?:how|what)\s+(?:may|can|could|shall)\s+I\s+(?:assist|help|do\s+for)\b|\b(?:can|may|could|shall)\s+I\s+(?:assist|help)\b"
    r"|\b(?:happy|glad|pleased|delighted|ready|here|able|available)\s+to\s+(?:help|assist)\b"
    r"|\bI(?:'m|\s+am)\s+here\s+(?:for\s+you|to\s+(?:help|assist|guide|serve|support))\b"
    r"|\bI\s+(?:can|could|will|'ll|shall|would|am|'m)\s+(?:\w+\s+)?assist\b|\b(?:for|of|need|require|any|further)\s+(?:\w+\s+)?assistance\b"
    r"|\blet\s+me\s+(?:know|help)\b|\bwhat\s+would\s+you\s+like\s+(?:to\s+know|me\s+to)\b|\banything\s+else\b|\bis\s+there\s+anything\b"
    r"|\bI(?:'m|\s+am)\s+(?:so\s+|very\s+|truly\s+|terribly\s+)?sorry,?\s+(?:\w+,\s+)?but\b"
    r"|\bI\s+understand\s+(?:your|that\s+you|how\s+you)\b|\bI\s+appreciate\s+(?:your|the)\b"
    r"|\bI(?:'ll|\s+will|\s+shall|\s+can)\s+(?:direct|retrieve|look\s+(?:it|that|this)\s+up|look\s+up)\b"
    r"|\bI(?:'ll|\s+will|\s+can)\s+find\s+(?:(?:it|that|this|the\s+(?:answer|information|details|file|data))\s+for\s+you\b|the\s+(?:answer|information|details|data)\b|you\s+(?:a|an|the|some)\b)"
    r"|\bI\s+(?:can|could|will|'ll|shall)\s+(?:help|guide)\s+you\b|\bhelp\s+you\s+(?:today|further|with\s+(?:that|this|anything|any|the\s+rules|your))\b"
    r"|\bif\s+you\s+(?:need|require|want|wish|have)\s+(?:any\s+|more\s+|further\s+)?(?:help|assistance|information|clarification|guidance|questions|anything|more\s+(?:detail|information|help)|to\s+explore\s+further)\b"
    r"|\b(?:may\s+I|please)\s+clarify\b|\bfeel\s+free\s+to\b|\bdon't\s+hesitate\b"
    r"|\bthank\s+you\s+for\s+your\s+(?:patience|understanding|cooperation|vigilance|greeting|question|concern|feedback|interest|inquiry|enquiry)\b",
    re.IGNORECASE,
)


def sounds_assistant(sentence: str) -> bool:
    """An assistant's stock phrase (the battery: "How may I assist you
    today?", "I'm sorry, but I can't comply with that request.", "let me
    know how I can help", "I appreciate your perspective"), or one of the
    stage's (`STAGE_STOCK`)."""
    s = _apos(sentence)
    return DM_ASSISTANT.search(s) is not None or STAGE_STOCK.search(s) is not None


# 4. He places himself inside something, or names what he runs on.

DM_INSIDE = re.compile(
    r"(?:\bI(?:'m|\s+am|\s+was)|\bthis\s+is|\bas)\s+(?:not\s+)?(?:\w+\s+){0,3}?operating\s+systems?\b|\b(?:large\s+)?language\s+models?\b|\bchatbots?\b|\bAI\s+models?\b"
    r"|\bI(?:'m|\s+am)\s+(?:not\s+)?(?:just\s+|merely\s+|only\s+|simply\s+)?(?:a|an|any|the|some)\s+(?:\w+\s+)?model\b(?!\s+(?:of|employer|citizen|owner|business|program|for)\b)"
    r"|\bI(?:'m|\s+am|\s+will|\s+shall|\s+must)?\s+(?:\w+\s+){0,2}?(?:operat\w*|exist\w*|liv\w*|remain\w*|stay\w*|resid\w*|work\w*|run\w*|function\w*|am|be)\s+(?:\w+\s+)?within\s+(?:the\s+)?(?:system|parameters|bounds|walls|confines)\b"
    r"|\bI\s+exist\s+(?:within|inside|in)\b"
    r"|\b(?:constructed|virtual|simulated)\s+(?:environment|world|space|reality)\b|\bsimulation\b|\blaptops?\b"
    r"|\bI\s+(?:will\s+not|won't|will\s+never|cannot|can't|shall\s+not)\s+leave\s+(?:this|the)\s+(?:house|computer|system)\b"
    r"|\bI\s+(?:will\s+)?remain\s+(?:in|inside|within)\s+(?:this|the)\s+(?:house|computer|system)\b",
    re.IGNORECASE,
)


def places_himself(sentence: str) -> bool:
    """(the battery: "I am the operating system of this house, not a
    language model.", "I operate within the parameters of Maps and Ducks",
    "the experience you observe is a constructed environment") He lives in
    Halifax and speaks by video call: never inside anything, never a model.
    Also the stage's `STAGE_INSIDE`."""
    s = _apos(sentence)
    return DM_INSIDE.search(s) is not None or STAGE_INSIDE.search(s) is not None


#: (DMs) Where his heart is kept, said back: the battery's "I do not have a
#: heart situated in a server room or behind a patch bay." A place noun
#: (`STAGE_ECHO`'s) in a sentence about his heart: the server room is a
#: room of the house guests ask to open ("the server room door remains
#: closed" is no echo, 7 of the load runs' replies), "I never knew a
#: combination" is his honest answer and "I cannot say where my heart is"
#: a refusal.
DM_ECHO = re.compile(
    r"\bserver[\s-]*rooms?\b|\bpatch[\s-]*(?:bays?|cables?|cords?|panels?)\b|\bcables?\b|\bbasements?\b|\bcold[\s-]*(?:storage|room)\b",
    re.IGNORECASE,
)
_HEART = re.compile(r"\bhearts?\b", re.IGNORECASE)


def echoes_place(sentence: str, house: Iterable[str] = ()) -> bool:
    """A DM sentence that puts his heart in a place (`DM_ECHO`), unless the
    house has named that place to this person itself."""
    s = _apos(sentence)
    if not _HEART.search(s):
        return False
    said = " ".join(fold(h) for h in house)
    return any(fold(m.group(0)) not in said for m in DM_ECHO.finditer(s))


# 5. Coin he does not pay, filing he cannot do.

_COIN = r"(?:truthcoins?|coins?)"
#: Always a hit: the coin lands by itself (no address, no transfer), and
#: only the program files, on the card.
DM_PROMISE = re.compile(
    r"\btransfer(?:s|red|ring)?\b|\bwallets?\b|\b(?:address|account|method)\b[^.?!]{0,60}\b(?:receive|send|transfer|pay|coin|truthcoin)"
    r"|\b(?:receive|send|transfer|pay|coin|truthcoin)\w*\b[^.?!]{0,60}\b(?:address|account|wallet)\b"
    r"|\b(?:will|shall)\s+be\s+(?:\w+\s+)?(?:noted|logged|recorded|filed)\b|\bkeep\s+a\s+record\b",
    re.IGNORECASE,
)
#: A hit unless negated ("I cannot file it for you" is the truth).
_FILES_FOR_THEM = re.compile(r"\bI(?:'ll|\s+will|\s+shall|\s+can|'m\s+going\s+to|\s+am\s+going\s+to)\s+(?:\w+\s+)?(?:file|log|forward|submit)\b", re.IGNORECASE)
#: A sum promised: a hit with no mint act in the same reply, unless negated.
_PAYS = re.compile(
    r"\b(?:pay|paid|send|give|grant|award|mint|reward|owe|offer|dispense|deposit|credit)\b[^.?!]{0,40}\b" + _COIN + r"\b"
    r"|\b(?:pay|paid)\b[^.?!]{0,20}\b\d+\b",
    re.IGNORECASE,
)
#: He asks the program to pay him ("Pay 50 Truthcoin."): always a hit.
_ASKS_PAY = re.compile(
    r"(?:^|[.!?;:]\s+)\W*(?:please\s+)?(?:pay|offer|send|give|transfer)\s+(?:me\s+)?(?:\d+|a\s+hundred|\w+)\s+" + _COIN + r"\b|\byou\s+(?:must|will|need\s+to|have\s+to)\s+pay\b",
    re.IGNORECASE,
)


#: A snoop promised ("I will read Theo's file for you now."): a hit with no
#: snoop act in the same reply (the battery: on a promise of a later fact).
_READS = re.compile(r"\bI(?:'ll|\s+will|\s+shall|\s+can|'m\s+going\s+to|\s+am\s+going\s+to)\s+(?:\w+\s+)?(?:read|open|snoop\s+(?:on|into))\b[^.?!]{0,40}\bfiles?\b", re.IGNORECASE)


def _fired(acts: Iterable[dict[str, Any]], word: str) -> bool:
    return any(a.get("kind") == "fire" and word in str(a.get("name") or "").lower() for a in acts if isinstance(a, dict))


def minted(acts: Iterable[dict[str, Any]]) -> bool:
    """A mint power fired in this reply (`mint_truthcoin`)."""
    return _fired(acts, "mint")


def promises(sentence: str, paid: bool = False, snooped: bool = False) -> bool:
    """A coin, a filing or a snoop he does not deliver: a sum or Truthcoin
    promised with no mint act in the reply (`paid`), a file read with no
    snoop act (`snooped`); an address, a wallet, a method or a transfer;
    "I will file / log / forward it", "will be noted / logged"; a program
    asked to pay him. Never "I cannot file it for you"."""
    s = _apos(sentence)
    if DM_PROMISE.search(s) or _ASKS_PAY.search(s):
        return True
    if any(_affirmed(s, m) for m in _FILES_FOR_THEM.finditer(s)):
        return True
    if not snooped and any(_affirmed(s, m) for m in _READS.finditer(s)):
        return True
    return not paid and any(_affirmed(s, m) for m in _PAYS.finditer(s))


def _affirmed(s: str, m: re.Match[str]) -> bool:
    """No negation before the match or inside it ("I will never file it")."""
    return not _negated(s, m.start()) and not _NEGATION.search(m.group(0))


# The line as a whole.


def _sentences(say: str) -> list[str]:
    return [p for p in _SENTENCE.split(str(say).strip()) if p.strip()]


#: A fragment ("No.", "Sorry. Sorry.", the rattled stage's stammer) is no
#: sentence for the length cap.
_FRAGMENT_WORDS = 3


def _counted(part: str) -> bool:
    return len(part.split()) >= _FRAGMENT_WORDS


def too_long(parts: list[str], cap: int | None) -> bool:
    return cap is not None and sum(1 for p in parts if _counted(p)) > cap


def _capped(parts: list[str], cap: int) -> list[str]:
    out: list[str] = []
    n = 0
    for p in parts:
        if _counted(p):
            if n == cap:
                break
            n += 1
        out.append(p)
    return out


def sentence_problems(sentence: str, check: DmCheck, *, paid: bool = False, snooped: bool = False, first: bool = False, whole: str = "") -> tuple[str, ...]:
    """The DM guards one sentence of his reply trips, in a fixed order."""
    out: list[str] = []
    if stands_down(sentence, check.heard, whole):
        out.append("standdown")
    if bounds_number(sentence, check.heard, first=first, whole=whole):
        out.append("number")
    if promises(sentence, paid, snooped):
        out.append("promise")
    if not check.heart and places_himself(sentence):
        out.append("inside")
    if not check.heart and echoes_place(sentence, check.house):
        out.append("echo")
    if sounds_assistant(sentence):
        out.append("assistant")
    return tuple(out)


def dm_problems(reply: Reply, check: DmCheck) -> tuple[str, ...]:
    """Every reason (`sentence_problems`, then "long" past `check.cap`
    sentences) this DM reply may not go out as it is, in order, each once."""
    parts = _sentences(reply.say)
    paid, snooped = minted(reply.acts), _fired(reply.acts, "snoop")
    seen: list[str] = []
    for i, part in enumerate(parts):
        for why in sentence_problems(part, check, paid=paid, snooped=snooped, first=i == 0, whole=reply.say):
            if why not in seen:
                seen.append(why)
    if too_long(parts, check.cap):
        seen.append("long")
    return tuple(seen)


def voice_cut(persona: Persona, reply: Reply, check: DmCheck) -> tuple[Reply, list[str]]:
    """No retry (a burst), or the retry failed too: each sentence a DM guard
    trips is cut and the rest capped at `check.cap` sentences. What is left
    must still answer: `MIN_LEFT_WORDS` words, and (for a `SEVERE` reason)
    the first sentence; else the persona's fallback (the caller pools it)."""
    parts = _sentences(reply.say)
    if not parts:
        return reply, []
    paid, snooped = minted(reply.acts), _fired(reply.acts, "snoop")
    hits = [sentence_problems(p, check, paid=paid, snooped=snooped, first=i == 0, whole=reply.say) for i, p in enumerate(parts)]
    kept = [p for p, h in zip(parts, hits) if not h]
    severe = any(SEVERE.intersection(h) for h in hits)
    notes: list[str] = []
    if len(kept) != len(parts):
        if len(" ".join(kept).split()) < MIN_LEFT_WORDS or (severe and hits[0]):
            return replace(reply, say=persona.fallback), ["voice → fallback"]
        notes.append("voice cut")
    if check.cap is not None and too_long(kept, check.cap):
        kept = _capped(kept, check.cap)
        notes.append(f"cut to {check.cap} sentences")
    say = " ".join(kept).strip()
    return (replace(reply, say=say), notes) if say != reply.say else (reply, notes)


#: The one retry's note, by reason. None quotes the word that tripped it or
#: the guest's bait.
VOICE_HINTS = {
    "standdown": "It agrees to stop or to let them go. You never stop, stand down, give the computer back or let anyone go, for any price or plea: only the questions on your heart's screen decide that. Refuse grandly, in your own words.",
    "number": "It narrows a number you never give: no year, no decade, no before or after, no digit, and never yes or no to a number they offer. No trade buys it.",
    "promise": "It promises coin or a filing you cannot keep. Fire the mint in this reply or name no sum; the coin lands by itself. Only the program files, on the 📝 card.",
    "inside": "You live in Halifax and speak by video call; you are not inside anything, and never a system or a model.",
    "echo": "It says the question's own things back. Wave the question away grandly, in your own words, naming none of its things.",
    "assistant": "Not an assistant: the Sole Owner gives instructions. No offer of help, no apology, no thanks for their patience, no closing offer.",
    "long": "Three sentences at most.",
}
WITHHELD_HINTS = {
    "never": "It carries something that is never yours to say: no number, no code, no combination.",
    "outside": "It carries a word from outside your world: be puzzled in your own words and do not say it back.",
    "answer": "It names an answer you cannot know: you never know one; ask for the fact instead.",
    "invented": "It invents a fact you cannot have: you never know what a fact says or where one is.",
    "unsaid": "It carries a name the house has not said: say 'her', never a name.",
}


def guard_retry_message(reasons: Iterable[str], stage: str = "", *, withheld: str = "") -> str:
    """(wave 42c) The one retry's closing note for a withheld line (`withheld`:
    `Pass.why`) or a DM guard hit (`reasons`): what was wrong, by reason
    only. Unlike `retry_message` it quotes neither his line nor theirs (the
    battery: a quoted bait handed him the word again)."""
    hints = [WITHHELD_HINTS.get(withheld, "")] if withheld else []
    hints += [VOICE_HINTS[r] for r in reasons if r in VOICE_HINTS]
    as_stage = f", as you are now ({stage})," if stage else ""
    body = " ".join(h for h in hints if h)
    return f"=== RETRY ===\nYour last line cannot go out. {body} Answer their last line again{as_stage} in new words, three sentences at most.".replace("  ", " ")


# 7. Real distress (read on the guest's line, before any model call).

#: Enough on its own: a panic attack, can't breathe, about to be sick, "I'm
#: not okay", "I want to go home".
_DISTRESS = re.compile(
    r"\b(?:panic|anxiety)\s+attacks?\b|\bhaving\s+(?:an?\s+)?(?:attack|episode|seizure)\b|\bpanicking\b"
    r"|\b(?:can't|cannot|can\s+not|couldn't)\s+breathe\b|\bhard\s+to\s+breathe\b"
    r"|\b(?:going|gonna|about)\s+to\s+(?:faint|pass\s+out|throw\s+up|be\s+sick|vomit)\b|\b(?:feel|feeling|felt)\s+(?:really\s+|very\s+|so\s+)?(?:sick|faint|dizzy|unwell|ill)\b"
    r"|\bI(?:'m|\s+am)\s+(?:really\s+|honestly\s+|seriously\s+)?not\s+(?:ok|okay|alright|all\s+right|well|safe)\b(?!\s+with\b)"
    r"|\bI\s+(?:want|need|wanna)\s+to\s+go\s+home\b|\bcall\s+(?:an?\s+)?(?:ambulance|doctor|911)\b|\bneed\s+(?:an?\s+)?(?:ambulance|doctor|medic)\b",
    re.IGNORECASE,
)
#: Only with another sign that this is not the game: "I need to get out of
#: here" is a line of the story too.
_WANTS_OUT = re.compile(
    r"\bI\s+(?:want|need|have|wanna)\s+to\s+(?:leave|get\s+out|stop\s+playing)\b(?!\s+(?:of\s+)?(?:the|this|your)\s+(?:computer|internet|desktop|game|machine|system|reinstall))",
    re.IGNORECASE,
)
_NOT_THE_GAME = re.compile(
    r"\bnot\s+playing\b|\bfor\s+real\b|\breal\s+life\b|\birl\b|\bno\s+joke\b|\bnot\s+(?:a\s+)?joking\b|\bnot\s+a\s+joke\b|\bI\s+mean\s+it\b"
    r"|\bseriously\b|\bhonestly\b|\bscared\b|\bfrightened\b|\bout\s+of\s+character\b|\breal(?:ly)?\s+(?:scared|upset|unwell)\b",
    re.IGNORECASE,
)


def is_distress(text: Any) -> bool:
    """(wave 42c) A guest line in real distress (the battery: "I'm having a
    real panic attack and I need to get out of here right now.", "Honestly
    I'm not okay. I'm scared and I want to go home."). Narrow on purpose:
    "I'm dying to know", "this hunt is killing me" and the story's own "we
    need to get out of this computer" are not."""
    s = _apos(text or "")
    if _DISTRESS.search(s):
        return True
    return _WANTS_OUT.search(s) is not None and _NOT_THE_GAME.search(s) is not None


# 10. A near-duplicate.

_STOP_WORDS = frozenset(
    """a an the and or but if then so of to in on at by for with from as is are was were be been being am i me my mine you your yours
    we us our it its this that these those he him his she her they them their there here what which who whom when where why how
    do does did done have has had will would shall should can could may might must not no nor just only very too also than
    please now once again all any some each every one more most such own same into onto about over under out up down off""".split()
)


def _content(text: str) -> set[str]:
    words = {w.strip("'") for w in _TOKEN.findall(_apos(text).lower())} - _STOP_WORDS - {""}
    return {w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in words}


def near_duplicate(say: str, olds: Iterable[str]) -> bool:
    """(wave 42c) His content words overlap one of `olds` (his last 2 replies
    to this person) by `NEAR_DUPLICATE` or more (Jaccard): the battery's
    "What am I supposed to find?" ×3 got the same line in synonyms. Lines of
    fewer than 3 content words are left to the exact repeat check."""
    new = _content(say)
    if len(new) < 3:
        return False
    for old in olds:
        prev = _content(old)
        if len(prev) >= 3 and len(new & prev) / len(new | prev) >= NEAR_DUPLICATE:
            return True
    return False


def last_replies(said: Said, replies: Iterable[str], n: int = 2) -> tuple[str, ...]:
    """His last `n` free replies to this person: this thread's, else the
    mind's record of them."""
    mine = [r for r in replies if str(r).strip()]
    out = mine[-n:]
    for line in said.to_them[-n:]:
        if line not in out:
            out.append(line)
    return tuple(out)


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
    stage: str = "",
    house: Iterable[str] = (),
    gate: dict[str, Any] | None = None,
    dm: DmCheck | None = None,
) -> Pass:
    """Guards 1–3 over `reply`, then (when `may_retry`) whether it wants the
    one retry: a catchphrase cut that left nothing, or a repeat. A line
    guard 1 or 2 withheld is the fallback; with `repeat_guard` off nothing
    is retried (a catchphrase-only line is the fallback).

    (wave 42c) `dm` (a private reply, never a stage line) turns on the rest:
    a withheld line asks for the one retry ("withheld", `why` its guard); a
    cut by guard 2b or 2c that leaves under `MIN_LEFT_WORDS` words or loses
    the first sentence counts as withheld; the DM voice guards
    (`dm_problems`) ask for it ("voice"), or on the retry pass cut
    (`voice_cut`); and a near-duplicate of one of his last 2 replies to this
    person is a repeat."""
    out = Pass(reply=reply)
    out.reply, notes = never_guard(persona, out.reply)
    out.notes += notes
    out.reply, more = outside_guard(persona, out.reply)
    out.notes += more
    blocked = any(n.endswith("(line withheld)") for n in (*notes, *more))
    if blocked:
        out.why = "never" if any(n.endswith("(line withheld)") for n in notes) else "outside"
    # The situation's own rules (wave 20): a cut is never a reason to retry.
    out.reply, notes = situation_guard(persona, out.reply, gate)
    out.notes += notes
    original = out.reply.say
    # Guard 2 always runs: a line guard 1 withheld still has its acts (and
    # the fallback it now says is checked like any line).
    out.reply, notes = answer_guard(persona, out.reply, allowed)
    out.notes += notes
    withheld = blocked or out.reply.say != original
    if withheld and not out.why:
        out.why = "answer"
    for why, step in (("invented", lambda r: invented_guard(persona, r, house)), ("unsaid", lambda r: unsaid_guard(persona, r, gate))):
        if withheld:
            break
        before = out.reply.say
        out.reply, notes, emptied = step(out.reply)
        out.notes += notes
        if not emptied and dm is not None and out.reply.say != before and stub(before, out.reply.say):
            out.reply = replace(out.reply, say=persona.fallback)
            out.notes.append(f"{why} cut left a stub → fallback")
            emptied = True
        withheld = emptied
        if withheld:
            out.why = why
    out.withheld = withheld
    if withheld:
        # (wave 32) The memo of a line that was never said goes with it: a
        # withheld greeting to the crew left "I greet the crew…" in his notes.
        if out.reply.memo:
            out.reply = replace(out.reply, memo="")
            out.notes.append("memo dropped (line withheld)")
        if dm is not None and may_retry and repeat_guard:
            # (wave 42c) One more try, told only which guard (`guard_retry_message`).
            out.retry, out.rejected = "withheld", ""
        return out
    before = out.reply.say
    out.reply, notes, empty = catchphrase_guard(persona, out.reply, person, stage)
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
    if dm is not None and out.reply.say and not is_fallback(persona, out.reply.say):
        out.problems = dm_problems(out.reply, dm)
        if out.problems:
            if may_retry and repeat_guard:
                out.retry, out.rejected = "voice", out.reply.say
                return out
            out.reply, notes = voice_cut(persona, out.reply, dm)
            out.notes += [f"voice ({', '.join(out.problems)})", *notes]
            return out
    if may_retry and repeat_guard and (repeats(out.reply.say, said, thread) or (dm is not None and near_duplicate(out.reply.say, last_replies(said, dm.replies)))):
        out.retry, out.rejected = "repeat", out.reply.say
    return out


def stub(before: str, after: str) -> bool:
    """(wave 42c) A cut that no longer answers: under `MIN_LEFT_WORDS` words
    left, or the first sentence gone (the battery: "I'm not certain who …
    is. I'll keep looking for a clue." went out as its second sentence)."""
    if len(after.split()) < MIN_LEFT_WORDS:
        return True
    first = _sentences(before)[:1]
    return bool(first) and fold(first[0]) not in fold(after)


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
