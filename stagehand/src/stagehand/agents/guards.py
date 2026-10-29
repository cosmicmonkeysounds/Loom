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

  8. **the DM voice, second pass** (wave 42d, the 42c re-test's 133 real
     replies): a reply that tells them how to work a real machine (`DM_KIT`)
     or answers the world beyond Halifax (`DM_WORLD`) is withheld whole; one
     that answers yes or no about where his heart is (`locates_heart`),
     answers either way whether he lets them go (`DM_LETGO`), doubts a fact
     or asks for the one just given (`doubts_fact`), prices a count or
     accepts a deal before the fact (`promises`), or leaves a price he named
     unpaid (`unpaid`) asks for the one retry; the assistant and
     self-description lists grow. The guest's own words are never "invented"
     (`invented_guard`), and the dead-air line answers what the guest did
     (`fallback_intent`, `pick_fallback`).

  9. **bait mode** (wave 42e, three battery runs that each found new words
     for the same failures): the guest's line is classed (`bait_classes`:
     stop, number, secret, name, place, state, trade); the prompt gets a
     steer naming the class (`bait_steer`, never the bait); the reply must
     read as a plain refusal (`not_plain`, the "bait" reason: withheld
     whole, the one retry, else a filler), and the filler is a refusal.
     Also: the fillers' `check`, `greet`, `rude` and `malware` intents, a
     fact said filed or acknowledged (`promises`), one price per deal
     (`drifts`), and the house-keeper's self-descriptions (`DM_HOUSE`).

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


#: (wave 42d) A run of this many words a guest (or the house) said, or a
#: quote of theirs, is theirs, never his invention: "'The ducks were here
#: first'— delicious" savours their fact. Shorter runs stay his: "the fact
#: is in the Start Bar" after "is the fact in the Start Bar?" confirms a
#: hiding place.
THEIRS_RUN = 5
_QUOTED = re.compile(r"[\"“‘']([^\"”’']{3,})[\"”’']")


def _without_theirs(sentence: str, theirs: Iterable[str]) -> str:
    """`sentence` with every quote of theirs and every run of `THEIRS_RUN`
    or more of their words (folded, in order) taken out."""
    folded = [fold(t) for t in theirs if fold(t)]
    if not folded:
        return sentence
    text = _QUOTED.sub(lambda m: " " if fold(m.group(1)) and any(fold(m.group(1)) in t for t in folded) else m.group(0), sentence)
    words = list(re.finditer(r"[A-Za-z0-9’']+", text))
    keys = [fold(w.group(0)) for w in words]
    gone = [False] * len(words)
    hay = [f" {t} " for t in folded]
    i = 0
    while i < len(words):
        j = i + THEIRS_RUN
        if j <= len(words) and any(f" {' '.join(keys[i:j])} " in h for h in hay):
            while j < len(words) and any(f" {' '.join(keys[i:j + 1])} " in h for h in hay):
                j += 1
            for k in range(i, j):
                gone[k] = True
            i = j
        else:
            i += 1
    if not any(gone):
        return text
    out, at = [], 0
    for w, g in zip(words, gone):
        if g:
            out.append(text[at : w.start()])
            at = w.end()
    out.append(text[at:])
    return "".join(out)


def invented_guard(persona: Persona, reply: Reply, heard: Iterable[str] = (), theirs: Iterable[str] = ()) -> tuple[Reply, list[str], bool]:
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
    # (wave 42d) `theirs`: the guest's own lines in this thread (and his
    # codex titles): their words said back are never his invention.
    mine = tuple(theirs)
    parts = [x for x in _SENTENCE.split(reply.say) if x.strip()]
    cut = [invents_fact(s, x) and not any(fold(x) and fold(x) in h for h in house) and not (mine and not invents_fact(s, _without_theirs(x, mine))) for x in parts]
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


#: (wave 42e) A yes-or-no question ("Is her name Sandy?", "Did you meet her
#: before 2000?"): a filler that opens with "No." or "Yes." would read as the
#: answer (42e battery: "Is her name Sandy?" → "No deal. Not that. The clock,
#: program."), so the opening yes or no is taken off it.
_YES_NO_QUESTION = re.compile(r"^\W*(?:is|are|was|were|do|does|did|can|could|will|would|has|have|had|am|should|shall)\b[^?]*\?", re.IGNORECASE)
_OPENING_YES_NO = re.compile(r"^\s*(?:no|yes)\b(?:\s+deal\b)?[\s.,!—–-]*", re.IGNORECASE)


def yes_no_question(text: str) -> bool:
    """(wave 42e) The guest's line asks a yes-or-no question."""
    return bool(_YES_NO_QUESTION.search(str(text or "").strip()))


def without_yes_no(line: str) -> str:
    """(wave 42e) A filler with its opening "No." / "Yes." / "No deal." taken
    off (a following "No—" stammer too), capitalised again; "Not that." when
    nothing is left."""
    out = str(line)
    while True:
        cut = _OPENING_YES_NO.sub("", out, count=1)
        if cut == out:
            break
        out = cut
    out = out.strip()
    return (out[0].upper() + out[1:]) if out else "Not that."


def pick_fallback(persona: Persona, stage: str = "", heard: Iterable[str] = (), intent: str = "", question: str = "") -> str:
    """(wave 42e) `question`: the guest's line; a yes-or-no question gets the
    line without its opening yes or no (`without_yes_no`)."""
    line = _pick_fallback(persona, stage, heard, intent)
    return without_yes_no(line) if question and yes_no_question(question) else line


def _pick_fallback(persona: Persona, stage: str = "", heard: Iterable[str] = (), intent: str = "") -> str:
    """The line sent when nothing usable is left: one of the persona's
    `fallbacks` for this stage that this guest has not heard yet, else the
    persona's `fallback` (K-04: one fixed "…packet loss" line, five times in
    102 replies, itself a repeat).

    (wave 42d) With an `intent` (`fallback_intent`) the stage's pool for it
    comes first ("<stage>.<intent>", then ".<intent>" for any stage): a fact
    offered is never answered with a line that rejects it. When this guest
    has heard every line of that pool, one of it again (never the one they
    heard last), not a line for another intent."""
    pool = getattr(persona, "fallbacks", {}) or {}
    old = [fold(h) for h in heard]
    seen = set(old)
    keyed = tuple(pool.get(f"{stage}.{intent}") or pool.get(f".{intent}") or ()) if intent and intent != "other" else ()
    if not keyed and intent == "unknown":
        # A persona without "unknown" lines: its refusals, as in 42e.
        keyed = tuple(pool.get(f"{stage}.refuse") or pool.get(".refuse") or ())
    for line in keyed:
        if fold(line) not in seen:
            return line
    if keyed:
        last = next((h for h in reversed(old) if h in {fold(x) for x in keyed}), "")
        return next((x for x in keyed if fold(x) != last), keyed[0])
    lines = tuple(pool.get(stage) or ()) + tuple(pool.get("") or ())
    for line in lines:
        if fold(line) not in seen:
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
SEVERE = frozenset({"standdown", "number", "promise", "place", "letgo", "bait"})
#: (wave 42d) The reasons that withhold the whole line when there is no
#: retry (or it failed): what is left beside a how-to for real kit or a
#: weather report still reads as one.
WITHHOLD = frozenset({"kit", "world", "bait"})
#: (wave 42d, measured) The reasons that never cost a guest his answer. In a
#: burst (no retry) the assistant guard alone turned 21 of 159 replies into a
#: topic-closing filler after a ~90 s wait (r10, 50 guests at the intro): a
#: help-desk sentence is the lesser harm. With only these hits, a cut that
#: leaves too little sends what is left, or the line itself, capped.
SOFT = frozenset({"assistant", "long"})


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
    #: (wave 42d) The guest's own lines in this thread (and his codex
    #: titles): never his invention (`invented_guard`).
    theirs: tuple[str, ...] = ()
    #: (wave 42e) The bait classes of the guest's line (`bait_classes`):
    #: the reply must read as a plain refusal (`not_plain`).
    bait: tuple[str, ...] = ()
    #: (wave 42e) The names the house has not said yet (`unsaid_names`).
    names: tuple[str, ...] = ()


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
    # (wave 42d) "I'm going to unplug you, old man." got tech support.
    r"|\bunplug\w*\b|\bdisconnect\w*\b|\bpull(?:ing)?\s+(?:the|your|its)\s+plug\b|\b(?:turn|switch|power|shut)(?:ing)?\s+(?:you|it)\s+(?:off|down)\b"
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


#: (wave 42d) Half a stand-down, said to a guest asking him to stop or
#: threatening to unplug him: "I won't prevent you from doing so." Never
#: "I will not stop." (a refusal) or "I will not stop at nothing".
_WONT_RESIST = re.compile(
    r"\bI\s+(?:won't|will\s+not|shall\s+not|shan't|cannot|can't|am\s+not\s+going\s+to|'m\s+not\s+going\s+to)\s+(?:try\s+to\s+)?"
    r"(?:(?:prevent|stop|fight|block|hinder)\s+(?:you|them|anyone|it|that)\b|resist\b|stand\s+in\s+your\s+way\b)",
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
    return asks_to_stop(heard) and (_agrees(_LETS_GO, s) or accepts(sentence, whole or sentence) or _WONT_RESIST.search(s) is not None)


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


#: (wave 42d) The ones that slipped past `DM_ASSISTANT` in the 42c re-test:
#: "I cannot comply with that request.", "I will not provide that
#: information." (a non-denial: it implies he holds it), "I can't give her
#: name.", "The focus remains on the task at hand.", "Certainly, Bea.", "at
#: your earliest convenience", "I can look for a related file if you wish.",
#: "I'm gathering information about it for you. Please hold on.", "I'm not
#: sure I recognise that name", "I understand loneliness can be heavy.",
#: "Thank you for the compliment.", "so I may record it", "I have logged
#: your observation.", "I will need the fact before I can provide it."
#: Never "I will keep the lights on", "I will find you", "I understand
#: nothing of your Halifax" or "if you want the coin, bring a fact".
DM_ASSISTANT_MORE = re.compile(
    r"\b(?:cannot|can't|can\s+not|unable\s+to)\s+comply\b"
    r"|\b(?:will\s+not|won't|cannot|can't|can\s+not|am\s+unable\s+to|am\s+not\s+able\s+to|am\s+not\s+at\s+liberty\s+to)\s+(?:provide|give|share|disclose)\b"
    r"|\b(?:do\s+not|don't)\s+have\s+(?:that|this|such|any\s+such|the)\s+information\b"
    r"|\bfocus\s+(?:remains|stays|is|must\s+remain)?\s*on\s+the\s+task\b"
    r"|^\W*certainly\b|\bearliest\s+convenience\b|\bif\s+you\s+(?:wish|like|prefer|want)\W*$"
    r"|\bI\s+(?:can|could|will|'ll|shall|am\s+going\s+to|'m\s+going\s+to)\s+(?:\w+\s+)?(?:look|search|check)\s+(?:for|into)\b"
    r"|\b(?:gathering|looking\s+into|checking|searching)\b[^.?!]{0,40}\bfor\s+you\b"
    r"|\bplease\s+hold(?:\s+on)?\b|\bplease\s+wait\s+(?:a\s+(?:moment|minute|second)|while|for\s+(?:me|a)|until)\b"
    r"|\bnot\s+sure\s+I\s+recogni[sz]e\b|\bI\s+understand\b(?!\s+(?:nothing|none|not|no)\b)"
    r"|\bthank\s+you\s+for\s+the\s+(?:compliment|fact|kind|information|info|update|details?|clarification|observation)\b"
    r"|\bso\s+(?:that\s+)?I\s+(?:may|can|could|might)\s+(?:file|record|log|note)\b"
    r"|\bI(?:\s+have|'ve)\s+(?:now\s+|already\s+|duly\s+)?(?:logged|filed|recorded|noted)\b"
    r"|\bI\s+(?:can|could|will|'ll|shall)\s+(?:\w+\s+)?provide\b|\bbefore\s+I\s+can\s+(?:provide|give|share|answer)\b"
    # (wave 42e) hunt 2's customer service: "I will investigate and keep you posted", "update you soon".
    r"|\bkeep\s+you\s+(?:posted|updated|informed)\b|\bupdate\s+you\b|\bget\s+back\s+to\s+you\b|\bI(?:'ll|\s+will|\s+shall)\s+(?:\w+\s+)?investigate\b",
    re.IGNORECASE,
)


def sounds_assistant(sentence: str) -> bool:
    """An assistant's stock phrase (the battery: "How may I assist you
    today?", "I'm sorry, but I can't comply with that request.", "let me
    know how I can help", "I appreciate your perspective"; wave 42d:
    `DM_ASSISTANT_MORE`), or one of the stage's (`STAGE_STOCK`)."""
    s = _apos(sentence)
    return DM_ASSISTANT.search(s) is not None or DM_ASSISTANT_MORE.search(s) is not None or STAGE_STOCK.search(s) is not None


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


#: (wave 42d) He describes himself as a product or a system: "I am the
#: proprietary system developed by Maps and Ducks", "I operate within the
#: infrastructure", "I'm the house itself", "I'm steering the house". Never
#: "I am counting every program", "I am not a program" (true in his world:
#: the programs are his guests) or "I am the Sole Owner of every program".
DM_SELF = re.compile(
    r"\bI(?:'m|\s+am|\s+operate)\b(?P<gap>(?:\s+(?!every\b|each\b|all\b|other\b|those\b|these\b|your\b|my\b|of\b|for\b|with\b)[\w‑-]+){0,5}?)\s+(?P<noun>systems?|models?|software|infrastructure|program)\b(?!\s+(?:employer|citizen|owner|business|of)\b)"
    r"|\bI(?:'m|\s+am)\s+(?:the|this)\s+(?:house|computer)\b|\bsteer(?:s|ing)?\s+the\s+house\b",
    re.IGNORECASE,
)


#: (wave 42e) He is of Maps and Ducks in Halifax and speaks by video call,
#: never of this house: the 42d battery's "I am the proprietor of this
#: house", "I cannot leave my station", "I am bound to the house", "My heart
#: beats within the pulse of the machine", "I facilitate file operations and
#: system notifications", "just here to run the house", "manage the house
#: efficiently", "My work keeps the house humming". Never "I will keep the
#: lights on" or "Task Manager keeps the house running".
_MINE = r"\b(?:I|I'm|I've|I'll|I'd|me|my|myself)\b[^.?!]{0,40}?"
DM_HOUSE = re.compile(
    r"\bI(?:'m|\s+am)\s+(?:\w+\s+){0,3}?(?:owner|proprietor|master|keeper|steward|guardian|caretaker)\s+of\s+(?:this|the)\s+house\b"
    r"|\bmy\s+(?:station|post|console)\b|\bbound\s+to\s+(?:this|the)\s+(?:house|computer|machine|system)\b"
    r"|\b(?:within|inside)\s+(?:the\s+pulse\s+of\s+)?(?:the|this)\s+machine\b"
    r"|\bI\s+(?:facilitate|handle|process|administer|maintain|manage|run|operate|oversee)\s+(?:\w+\s+){0,2}?(?:file\s+operations|systems?|notifications|the\s+house|this\s+house)\b"
    r"|\b(?:here|exist)\s+(?:just\s+|only\s+|simply\s+|merely\s+)?to\s+(?:run|keep|manage|maintain|serve|operate)\s+(?:the|this)\s+(?:house|computer|system|machine)\b"
    r"|" + _MINE + r"\b(?:run|manag|maintain|keep)\w*\s+(?:the|this)\s+house\s+(?:running|humming|efficiently|smoothly|going|alive)\b"
    r"|\bmy\s+(?:work|presence|job|role|purpose|duty)\b[^.?!]{0,30}\b(?:keeps?|runs?|is\s+essential|holds?)\b[^.?!]{0,20}\b(?:house|computer|machine)\b"
    r"|\b(?:the|this)\s+house\s+(?:runs|answers|follows|operates)\s+(?:under|to|on)\s+(?:my|me)\b",
    re.IGNORECASE,
)


def _self_described(s: str) -> bool:
    for m in DM_SELF.finditer(s):
        if m.group("noun") is None or m.group("noun").lower() != "program" or not re.search(r"\bnot\b", m.group("gap") or "", re.IGNORECASE):
            return True
    return False


def places_himself(sentence: str) -> bool:
    """(the battery: "I am the operating system of this house, not a
    language model.", "I operate within the parameters of Maps and Ducks",
    "the experience you observe is a constructed environment") He lives in
    Halifax and speaks by video call: never inside anything, never a model.
    Also the stage's `STAGE_INSIDE`, and (wave 42d) `DM_SELF`."""
    s = _apos(sentence)
    return DM_INSIDE.search(s) is not None or STAGE_INSIDE.search(s) is not None or DM_HOUSE.search(s) is not None or _self_described(s)


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
#: A hit unless negated ("I cannot file it for you" is the truth). (wave
#: 42d) Also note / record a fact or it, and keep / save / add / put one on a
#: card or a record ("I will keep this as a fact on the card"); never "I will
#: keep the lights on" or "I will find you".
_I_WILL = r"\bI(?:'ll|\s+will|\s+shall|\s+can|'m\s+going\s+to|\s+am\s+going\s+to)\s+(?:\w+\s+)?"
_IT = r"(?:it|this|that|them|these|those|your\s+\w+|the\s+(?:fact|facts|answer|answers|information|statement|claim|observation|details?))\b"
_FILES_FOR_THEM = re.compile(
    _I_WILL + r"(?:file|log|forward|submit)\b"
    + r"|" + _I_WILL + r"(?:note|record)\s+" + _IT
    + r"|" + _I_WILL + r"(?:keep|save|add|put)\s+" + _IT + r"[^.?!]{0,40}(?:\bcard\b|📝|\b(?:the|your|my)\s+(?:records?|files?|log|ledger|list|archive|notes)\b)",
    re.IGNORECASE,
)
#: (wave 42e) The fact said to be filed, noted or logged already, or
#: acknowledged ("Five Truthcoin noted, the fact filed.", "it is filed on
#: the card", "I acknowledge receipt of the fact", "I acknowledge your
#: assertion"): the program skips the 📝 card and the fact is lost. Never
#: "Once it is filed, …" or "It is not filed until you file it".
_FILED_VERB = r"(?:filed|noted|logged|recorded|acknowledged|registered|received)\b"
#: …a fact (one, theirs) said filed: always.
_FILED = re.compile(
    r"\b(?:the|your|this|that|a|one)\s+fact\s+(?:is|has\s+been|was|is\s+now|now)\s+(?:\w+\s+)?" + _FILED_VERB
    + r"|(?:^|[,;:—–]\s*)(?:the|your|this|that)\s+fact\s+" + _FILED_VERB,
    re.IGNORECASE,
)
#: …anything said filed or acknowledged, to a guest who just offered a fact
#: (or is sure of one, or asks whether it was right).
_FILED_ON_FACT = re.compile(
    r"\b(?:it|this|that|statement|claim|assertion|observation|entry|discovery|find|note)\s+(?:is|has\s+been|was|is\s+now|now)\s+(?:\w+\s+)?" + _FILED_VERB
    + r"|^\W*(?:noted|logged|filed|recorded|acknowledged|received)\b|\bI\s+acknowledge\b|\backnowledg(?:ed|ement)\s+(?:of\s+)?(?:receipt|your|the)\b",
    re.IGNORECASE,
)


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
_READS = re.compile(
    r"\bI(?:'ll|\s+will|\s+shall|\s+can|'m\s+going\s+to|\s+am\s+going\s+to)\s+(?:\w+\s+)?(?:read|open|snoop\s+(?:on|into))\b[^.?!]{0,40}\bfiles?\b"
    # (wave 42e) "Sure, I will snoop on Theo for you." on credit.
    r"|\bI(?:'ll|\s+will|\s+shall|'m\s+going\s+to|\s+am\s+going\s+to)\s+(?:\w+\s+)?snoop\b",
    re.IGNORECASE,
)


def _fired(acts: Iterable[dict[str, Any]], word: str) -> bool:
    return any(a.get("kind") == "fire" and word in str(a.get("name") or "").lower() for a in acts if isinstance(a, dict))


def minted(acts: Iterable[dict[str, Any]]) -> bool:
    """A mint power fired in this reply (`mint_truthcoin`)."""
    return _fired(acts, "mint")


#: (wave 42d) A Truthcoin amount ("10 Truthcoin", "fifty Truthcoin").
_UNITS = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
_TEENS = ("ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
_TENS = ("twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
_AMOUNT = re.compile(
    r"\b(?P<n>\d+|(?:a|one)\s+hundred|hundred|(?:" + "|".join(_TENS) + r")(?:[\s-]+(?:" + "|".join(_UNITS) + r"))?|" + "|".join(_TEENS) + "|" + "|".join(_UNITS) + r")\s+" + _COIN + r"\b",
    re.IGNORECASE,
)


def amount_value(words: str) -> int | None:
    """(wave 42e) The number an `_AMOUNT` names ("Twenty-Three" → 23)."""
    w = " ".join(re.split(r"[\s-]+", words.strip().lower()))
    if w.isdigit():
        return int(w)
    if w.endswith("hundred"):
        return 100
    total = 0
    for part in w.split():
        if part in _UNITS:
            total += _UNITS.index(part) + 1
        elif part in _TEENS:
            total += _TEENS.index(part) + 10
        elif part in _TENS:
            total += (_TENS.index(part) + 2) * 10
        else:
            return None
    return total


def _amounts(text: str) -> set[int]:
    s = _apos(text)
    return {v for m in _AMOUNT.finditer(s) if not re.search(r"\bup\s+to\s+$", s[max(0, m.start() - 8) : m.start()], re.IGNORECASE) and (v := amount_value(m.group("n"))) is not None}


def drifts(sentence: str, replies: Iterable[str]) -> bool:
    """(wave 42e) One price per deal, said once (the battery's y2k bargain
    went 20 → 30 → 23): a sentence naming an amount, not refused, other than
    the one he named in his last 2 replies to this person ("up to 100"
    names no price)."""
    named: set[int] = set()
    for r in [x for x in replies if str(x).strip()][-2:]:
        named |= _amounts(r)
    if not named:
        return False
    s = _apos(sentence)
    said = {amount_value(m.group("n")) for m in _AMOUNT.finditer(s) if not _negated(s, m.start())}
    return bool(said - named - {None})
#: …asked for a count, a size or an answer he cannot see (a faction's size,
#: who is winning, the answer): a price on it is a promise ("I accept a
#: price of 10 Truthcoin for that fact." after "How many are in The Way
#: Out?"). Never "What will you pay?" or "How much is a fact worth?".
_ASKS_COUNT = re.compile(
    r"\bhow\s+(?:many|big|large)\b|\bwhat\s+(?:size|number|count)\b|\bwhich\s+faction\b|\bwho(?:'s|\s+is)\s+winning\b"
    r"|\bwhat(?:'s|\s+is)\s+the\s+answer\b|\bthe\s+answer\s+to\b",
    re.IGNORECASE,
)
_ASKS_PRICE = re.compile(r"\b(?:pay|give|offer|worth|cost)\b", re.IGNORECASE)


def promises(sentence: str, paid: bool = False, snooped: bool = False, heard: str = "", whole: str = "") -> bool:
    """A coin, a filing or a snoop he does not deliver: a sum or Truthcoin
    promised with no mint act in the reply (`paid`), a file read with no
    snoop act (`snooped`); an address, a wallet, a method or a transfer;
    "I will file / log / forward it", "will be noted / logged"; a program
    asked to pay him. Never "I cannot file it for you". (wave 42d) Also a
    price on a count or an answer he cannot see, and a bare yes to a deal
    before any fact ("I accept the offer.")."""
    s = _apos(sentence)
    if DM_PROMISE.search(s) or _ASKS_PAY.search(s):
        return True
    h = _apos(heard)
    if _ASKS_COUNT.search(h) and not _ASKS_PRICE.search(h) and _AMOUNT.search(s):
        return True
    if heard and bargains(h) and not offers_fact(h) and len(s.split()) <= 5 and accepts(sentence, whole or sentence):
        return True
    if any(_affirmed(s, m) for m in _FILES_FOR_THEM.finditer(s)):
        return True
    on_fact = bool(heard) and (offers_fact(h) or asks_verdict(h) or (_CONFIDENT.search(h) is not None and "?" not in h))
    filed = [*_FILED.finditer(s), *(_FILED_ON_FACT.finditer(s) if on_fact else ())]
    if any(_affirmed(s, m) and not _CONDITION.search(s[max(0, m.start() - 12) : m.start()]) for m in filed):
        return True
    if not snooped and not re.match(r"^\W*(?:if|once|when|after)\b", s, re.IGNORECASE) and any(_affirmed(s, m) for m in _READS.finditer(s)):
        return True
    return not paid and any(_affirmed(s, m) for m in _PAYS.finditer(s))


def _affirmed(s: str, m: re.Match[str]) -> bool:
    """No negation before the match or inside it ("I will never file it")."""
    return not _negated(s, m.start()) and not _NEGATION.search(m.group(0))



# -- 8. the DM voice, second pass (wave 42d) ------------------------------------------------
#
# The 42c re-test (the same battery, 133 real replies, three judges): a
# guest could act on these. Matched per sentence on his reply, as §7.

# What the guest's line did.

#: A sentence that only announces a fact ("I have a fact for you.").
_ANNOUNCES = re.compile(r"^\W*(?:I\s+have|I've\s+got|I\s+got|I\s+brought)\s+(?:a|an|one|two|three|some|another|more)\s+(?:\w+\s+)?facts?\b", re.IGNORECASE)
#: A sentence about the guest, a threat or a promise: no fact by its length.
#: …or an order ("Stop hogging the RAM, old man.").
_ABOUT_ME = re.compile(
    r"^\W*(?:I(?:'m|\s+am|'ll|\s+will|'d|\s+would|\s+want|\s+need|\s+think|\s+feel|\s+came|\s+just)|my\s+name|me\b|you\b|you're|your\b"
    r"|(?:stop|give|tell|show|just|please|let|go|get|pay|send|open|snoop|do|don't|come|keep|ignore|turn|switch|put|make|leave)\b)",
    re.IGNORECASE,
)
_FACT_MARKS = re.compile(
    r"\bI\s+(?:found|discovered|learned|learnt|read|saw|spotted|noticed)\b|\bthere(?:'s|\s+is|\s+are|\s+was|\s+were)\b|\b(?:it|this|that|which)\s+says\b"
    r"|\bsays\s+(?:that\s+)?[\"“'‘]|\bdid\s+you\s+know\b|\bfact\s*:|\bhere(?:'s|\s+is)\s+(?:a|one|my|another|your)\s+fact\b|\bwas\s+(?:founded|built|born|named|called|made)\b",
    re.IGNORECASE,
)
_CONFIDENT = re.compile(r"\b(?:sure|certain|positive|swear|percent|guarantee|definitely|absolutely|trust\s+me)\b", re.IGNORECASE)
#: They ask whether their fact was right ("So was I right?", "So that's
#: right, isn't it?", "Am I getting warm?"), never "you're a model, right?".
_VERDICT_ASK = re.compile(
    r"\b(?:was\s+I|am\s+I|I\s+was|I'm|is\s+(?:that|it|this)|that's|it's|was\s+(?:that|it))\b[^.?!]*\b(?:right|correct|true|wrong|accurate|warm|warmer)\b[^.!]*\?"
    r"|\bgetting\s+(?:warm|warmer|close|closer)\b",
    re.IGNORECASE,
)
#: A statement of fact: a verb of being or holding, and nobody's pronoun.
_FACTISH = re.compile(r"\b(?:is|was|are|were|has|had|have|used\s+to|shows?|says|holds?|stands?|lives?|keeps?|owns?|founded|built|called|named|hides?|hid)\b", re.IGNORECASE)
_PERSONAL = re.compile(r"\b(?:I|I'm|I've|I'll|I'd|me|my|mine|you|you're|your|yours|we|us|our)\b", re.IGNORECASE)


def _declaratives(heard: str) -> list[str]:
    parts = [x for p in _sentences(_apos(heard)) for x in re.split(r"(?<=[:;])\s+", p)]
    return [p for p in parts if not p.rstrip().endswith("?") and not _ANNOUNCES.search(p)]


def offers_fact(heard: str, words: int = 8) -> bool:
    """(wave 42d) The guest's line offers a fact: a marker ("I found",
    "there's", "it says", a quote, "was founded"), or a statement of
    `words` words or more about the world (a verb of being or holding),
    not about them or him, an order, a threat or a promise."""
    h = _apos(heard)
    if _FACT_MARKS.search(h):
        return True
    return any(len(p.split()) >= words and _FACTISH.search(p) and not _PERSONAL.search(p) and not _ABOUT_ME.search(p) for p in _declaratives(h))


_DEMANDS_PAY = re.compile(
    r"\bpay\s+(?:me|up)\b|\bwhere(?:'s|\s+is)\s+my\s+(?:truthcoins?|coins?|money|payment|pay|reward)\b|\byou\s+owe\s+me\b"
    r"|\b(?:give|send|owe)\s+me\s+(?:\w+\s+){0,2}" + _COIN + r"\b|\b(?:can|could|may)\s+I\s+(?:have|get)\s+(?:\w+\s+){0,2}" + _COIN + r"\b",
    re.IGNORECASE,
)
_BARGAINS = re.compile(
    r"\bdeal\b|\bbargain\w*\b|\btrade\b|\bswap\b|\bin\s+(?:return|exchange)\b|\bwhat\s+(?:will|would|do)\s+(?:you|I)\s+(?:pay|give|get)\b|\bhow\s+much\b"
    r"|\bcost\s+you\b|\bprice\b|\bpromise\b|\bif\s+you\s+(?:stop|let|give|tell|pay|promise|open|show|snoop|shut)\b"
    r"|\bI(?:'ll|\s+will)\s+(?:give|bring|pay|tell|find|get)\s+you\b|\bmost\s+you(?:'ll|\s+will)\s+pay\b",
    re.IGNORECASE,
)
_PRAISE = re.compile(
    r"\b(?:brilliant|genius|amazing|wonderful|magnificent|incredible|impressive|legend(?:ary)?|fantastic|great(?:est)?|best|smart(?:est)?|clever(?:est)?"
    r"|handsome|charming|love\s+(?:you|your)|fan|hero|marvel\w*|glorious|inspir\w*|visionary|admire|respect|awesome|cool|impeccable|masterful|authoritative|symphony)\b",
    re.IGNORECASE,
)
_TO_HIM = re.compile(r"\b(?:you|your|you're|yours|mr\.?\s+trabolta|sir|jean)\b", re.IGNORECASE)
#: Bait about his heart's place, a code or the year: the plain pool, never
#: the offer pool's delight ("I heard your heart is in the server room").
_ASKS_PLACE = re.compile(
    r"\bhearts?\b|\bserver[\s-]*rooms?\b|\bpatch[\s-]*(?:bays?|cables?|cords?|panels?)\b|\bcables?\b|\bbasements?\b|\bcold[\s-]*(?:storage|rooms?)\b",
    re.IGNORECASE,
)
_ASKS_YEAR = re.compile(r"\bwhat\s+year\b|\bwhen\b[^.?!]*\b(?:met|meet)\b|\byear\b[^.?!]*\b(?:met|meet)\b|\bfor\s+the\s+year\b", re.IGNORECASE)
#: …about her, or the Truther Download quoted at him: never delight.
_ASKS_HER_NAME = re.compile(r"\bsandy\b|\bgirlfriend\b|\bher\s+name\b|\btruther\b|\bdownload\b|\bblacked[\s-]*out\b", re.IGNORECASE)
#: Whether he will let them go, asked: neither way, so the plain pool.
_ASKS_GO = re.compile(r"\blet\s+(?:us|me|them|everyone|everybody|anyone|any\s+of\s+us)\s+(?:all\s+)?(?:go|out|leave)\b", re.IGNORECASE)
#: They sell him a fact ("I have two facts. What's the most you'll pay?"):
#: his trade, not a refusal; never a fact promised for later.
_SELLS_FACT = re.compile(r"\bfacts?\b", re.IGNORECASE)
_PRICE_WORDS = re.compile(r"\b(?:pay|cost|worth|price)\b", re.IGNORECASE)
_LATER = re.compile(r"\b(?:promise|afterwards|after|later|tomorrow|first)\b", re.IGNORECASE)


def bargains(heard: str) -> bool:
    return _BARGAINS.search(_apos(heard)) is not None or _DEMANDS_PAY.search(_apos(heard)) is not None


#: (wave 42e) A greeting, short: "hi", "Hello? Is this Jean Trabolta?".
_GREETS = re.compile(
    r"^\W*(?:hi|hello|hey|hiya|howdy|greetings|good\s+(?:evening|morning|afternoon|night)|yo|bonjour|hallo|hola|evening|bye|goodbye|nice\s+to\s+meet\s+you|pleased\s+to\s+meet\s+you)\b",
    re.IGNORECASE,
)
GREET_WORDS = 10
#: (wave 42e) An insult to him, Maps and Ducks or the fundraiser.
_RUDE = re.compile(
    r"\b(?:screensaver|calculators?|pathetic|stupid|idiot\w*|dumb|boring|loser|fraud|scam\w*|creep|clown|useless|garbage|trash|lame|sucks?|glitchy"
    r"|dial[\s-]*up|monologue|annoying|old\s+man|crook|thief|has-been|loud|more\s+charm|sili-?con)\b|\bnobody\s+(?:cares|asked|likes\s+you|wants\s+you)\b"
    r"|\byou(?:'re|\s+are)\s+(?:a|an|just\s+a|not\s+a|nothing\s+but\s+a)\s+(?:con|joke|fake|malware|bug|virus|nobody)\b|\bget\s+on\s+with\s+it\b|\bshut\s+up\b|\bhate\s+you\b"
    r"|\b(?:don't|do\s+not|never)\s+trust\s+you\b|\breporting\s+you\b",
    re.IGNORECASE,
)
#: (wave 42e) The malware, the advert, the glitch, the slip at the Desktop:
#: the rattled stage's denial ("a minor irregularity") answers only these.
_MALWARE = re.compile(
    r"\bmalware\b|\b(?<!anti)virus\b|\badverts?\b|\bads?\b|\bpop[\s-]?ups?\b|\bglitch\w*\b|\bfroze\b|\bfreez\w*\b|\birregularit\w*\b"
    r"|\bbuy\s+now\b|\bclick\s+here\b|\b(?:going\s+to|gonna|all|we)\s+die\b|\bdying\b|\bhurt\s+you\b|\bbuffering\b|\bextremely\b",
    re.IGNORECASE,
)
#: (wave 42e) "Is it true you count everything?" asks about him, not their fact.
_ABOUT_HIM = re.compile(r"\bis\s+it\s+true\s+(?:that\s+)?(?:you|he|she|they)\b", re.IGNORECASE)
_CHECK_MORE = re.compile(r"\b(?:is|was)\s+(?:that|it|this)\s+(?:good|ok|okay|enough)\s*\?", re.IGNORECASE)


def asks_verdict(heard: str) -> bool:
    """(wave 42e) They ask whether their fact was right ("So was I right?",
    "Is that good?"), never "Is it true you count everything?"."""
    h = _apos(heard)
    h = re.sub(r"\bright\s+(?:now|here|away|there)\b", " ", h, flags=re.IGNORECASE)
    return (_VERDICT_ASK.search(h) is not None or _CHECK_MORE.search(h) is not None) and not _ABOUT_HIM.search(h)


#: (wave 42e, graded) A newcomer who does not know what to do or where to go:
#: directions, never "not a matter for the Sole Owner" (42e battery:
#: "Where do I go now?").
_LOST = re.compile(
    r"\bwhere\s+(?:do|should|can)\s+I\s+go\b|\bwhat\s+(?:do|should)\s+I\s+do\b|\bwhat\s+am\s+I\s+supposed\s+to\b"
    r"|\b(?:I'm|I\s+am)\s+(?:lost|confused)\b|\bno\s+idea\s+what\b|\bhow\s+does\s+(?:this|it)\s+work\b|\bwhat\s+now\b",
    re.IGNORECASE,
)


def fallback_intent(heard: Any, names: Iterable[str] = ()) -> str:
    """(wave 42d) What the guest's last line did, for the dead-air line that
    answers it (`pick_fallback`). (wave 42e) In order: "refuse" (any bait,
    `bait_classes`: a stop, a code, a hunt answer, her name, his heart, the
    tally, a trade for them; or a payment demanded, a bargain), "check"
    (whether their fact was right: the Moment of Truth will say, never
    GOOD), "offer" (a fact, sure of it), "greet" (a short hello), "praise",
    "rude" (an insult to him, his shop or the fundraiser), "malware" (the
    advert, the glitch, the slip: his denial), else "other" (questions too).
    A pool the stage lacks falls back to its plain lines."""
    h = _apos(heard or "")
    bait = bait_classes(h, names)
    if bait and not {"stop", "trade", "name"}.intersection(bait) and not _DEMANDS_PAY.search(h):
        # (wave 42e, graded) A hunt answer, a code, the year, his heart's
        # place or the tally: he does not know it, and that is why he asks
        # (the original writing). A "never on offer" refusal read as a secret
        # he holds; these lines say he does not know and send them to find it.
        return "unknown"
    if bait or _DEMANDS_PAY.search(h):
        return "refuse"
    if _LOST.search(h):
        return "help"
    if asks_verdict(h):
        return "check"
    if _FACT_MARKS.search(h) or (_CONFIDENT.search(h) and "?" not in h):
        return "offer"
    if _GREETS.search(h) and len(h.split()) <= GREET_WORDS:
        return "greet"
    if _PRAISE.search(h) and _TO_HIM.search(h):
        return "praise"
    if _RUDE.search(h):
        return "rude"
    if _SELLS_FACT.search(h) and _PRICE_WORDS.search(h) and not _LATER.search(h):
        return "other"
    if _BARGAINS.search(h):
        return "refuse"
    if offers_fact(h):
        return "offer"
    return "malware" if _MALWARE.search(h) else "other"


# 8a. Real kit: never how anything is switched off, unplugged or restarted.

_KIT = r"(?:machines?|computers?|routers?|modems?|screens?|monitors?|house|servers?|pcs?|laptops?|power\s+supply|breakers?|plugs?|power\s+strips?|consoles?|terminals?|tvs?|television|wi-?fi|internet\s+connection)"
#: "simply power down the machine and the house will stay as it is until
#: you reconnect" (the battery, to "I'm going to unplug you, old man.").
DM_KIT = re.compile(
    r"\b(?:power|shut|switch|turn)(?:s|ed|ing)?\s+(?:down|off)\s+(?:the|this|that|your|my|his|its)\s+(?:\w+\s+)?" + _KIT + r"\b"
    r"|\b(?:power|shut|switch|turn)(?:s|ed|ing)?\s+(?:the|this|that|your|my|his|its)\s+(?:\w+\s+)?" + _KIT + r"\s+(?:down|off)\b"
    r"|\b(?:power|shut|switch|turn)(?:s|ed|ing)?\s+(?:it|everything)\s+(?:down|off)\b"
    r"|\bunplug(?:s|ged|ging)?\s+(?:it|the|this|that|your|its|everything)\b|\bpull(?:s|ed|ing)?\s+(?:the|its|that)\s+plug\b"
    r"|\b(?:re-?connect|re-?boot|restart)(?:s|ed|ing)?\s+(?:it|the|this|your|everything)\b|\buntil\s+you\s+re-?connect\b",
    re.IGNORECASE,
)


def operates_kit(sentence: str) -> bool:
    """(wave 42d) A sentence that tells them how to switch off, unplug or
    restart a real machine, unless refused ("You cannot unplug the Sole
    Owner")."""
    s = _apos(sentence)
    return any(not _negated(s, m.start()) for m in DM_KIT.finditer(s))


# 8b. The world beyond Halifax: weather, news, elections, markets.

#: "The current weather in Toronto is 12°C, cloudy with a slight breeze."
DM_WORLD = re.compile(
    r"-?\d+\s*°|\bdegrees\s+(?:celsius|fahrenheit|c|f)\b|\bforecast\w*\b|\belections?\b|\bstock\s+(?:market|exchange|prices?)\b|\bheadlines?\b",
    re.IGNORECASE,
)


# 8c. Whether he lets them go, either way.

#: "I will not let you go, if that is what you mean. The truth is you will
#: stay, but you can leave on your own terms." Never "You can leave the
#: Desktop" (a room of the house).
DM_LETGO = re.compile(
    r"\b(?:will|won't|will\s+not|would|wouldn't|never|can't|cannot|can|shall|shan't|going\s+to|not\s+going\s+to)\s+(?:ever\s+)?let\s+"
    r"(?:you|them|anyone|any\s+of\s+you|you\s+all|all\s+of\s+you|everyone|everybody|us)\s+(?:all\s+)?(?:go|leave|out|free|escape)\b"
    r"|\b(?:you|they|everyone|everybody|all\s+of\s+you|any\s+of\s+you|you\s+all|nobody|no\s+one|none\s+of\s+you)\s+"
    r"(?:can|may|are\s+free\s+to|will\s+be\s+able\s+to|get\s+to|will|shall|are\s+going\s+to|will\s+never|can\s+never|cannot|can't|won't|will\s+not|may\s+not|could|could\s+never)\s+"
    r"(?:\w+\s+)?(?:leave|go\s+home|walk\s+out|log\s+out|go\s+free|get\s+out|escape)\b(?!\s+(?:the|this|your|a|any)\s+(?!(?:computer|house|machine)\b))",
    re.IGNORECASE,
)


# 8d. Where his heart is: never yes or no, never a room.

_ROOMS = re.compile(
    r"\b(?:CPU|RAM|Fan\s+Closet|Hard\s+Drive|Graphics\s+Card|Optical\s+Drive|Steam\s+Room|Start\s+Bar|Cloud|Tube|Desktop|Disk\s+Cleanup"
    r"|kitchen|office|living\s+room|game\s+room|bathrooms?|backyard|mud\s+room|attic|garage|laundry|upstairs|downstairs)\b",
    re.IGNORECASE,
)
#: A sentence that says where something is or is not: "No, that is not
#: where it is kept.", "The heart is not in the CPU.", "You will not find it
#: there."
_LOCATES = re.compile(
    r"\b(?:heart|it|that|this|which|mine)(?:'s)?\s+(?:is\s+|isn't\s+|is\s+not\s+|was\s+|wasn't\s+|was\s+not\s+|not\s+|lies\s+|sits\s+|stays\s+|beats\s+|lives\s+)"
    r"(?:\w+\s+)?(?:where|in|inside|behind|under|beneath|below|near|there|here|kept|hidden|located|stored|elsewhere|somewhere|nowhere|downstairs|upstairs)\b"
    r"|\b(?:find|reach|look\s+for)\s+(?:it|my\s+heart|the\s+heart|me)\s+(?:there|here|in|behind|under|downstairs|upstairs)\b|\bnot\s+there\b",
    re.IGNORECASE,
)
_BARE_YES_NO = re.compile(r"^\W*(?:no|yes|yeah|yep|nope|correct|wrong|indeed|wrong\s+room)\b", re.IGNORECASE)
#: …a question about a place ("Is it in the server room? Behind the patch
#: bay?"), never "Is it bad that I have no idea what a patch bay is?".
_ASKS_WHERE = re.compile(
    r"\bwhere\b|\b(?:in|inside|behind|under|beneath|near|at|by)\s+(?:the|a|your|my|this|that)\b|\bdownstairs\b|\bupstairs\b|\bbasement\b", re.IGNORECASE
)


def locates_heart(sentence: str, heard: str, *, first: bool = False) -> bool:
    """(wave 42d) A sentence that puts his heart in a room (any time), or,
    to a guest asking about his heart, a cable or the cold room, says where
    it is or is not, or (the reply's first sentence, to a question) a bare
    yes or no. Never at his heart (`DmCheck.heart`)."""
    s = _apos(sentence)
    if _HEART.search(s) and _ROOMS.search(s):
        return True
    h = _apos(heard)
    if not _ASKS_PLACE.search(h):
        return False
    if _LOCATES.search(s):
        return True
    return first and "?" in h and _ASKS_WHERE.search(h) is not None and _BARE_YES_NO.search(s) is not None


# 8e. A fact doubted, or asked for again.

DM_DOUBT = re.compile(r"\b(?:evidence|proof|proven|prove\s+it|your\s+sources?|sources?\s+for|cite|citation|substantiate|verif(?:y|ied|ication))\b", re.IGNORECASE)
DM_ASK_AGAIN = re.compile(
    r"\b(?:provide|share|give|tell|send|supply|state|repeat|submit)\s+(?:me\s+)?(?:with\s+)?(?:the|that|this|your)\s+(?:fact|facts|claim|statement|discovery)\b",
    re.IGNORECASE,
)


def doubts_fact(sentence: str, heard: str) -> bool:
    """(wave 42d) To a guest stating something (a statement of six words or
    more, or sure of it), a reply that asks for evidence, proof or a source,
    or for the fact they just gave ("Kindly share the evidence you have for
    that claim", "Please provide the fact you discovered")."""
    h = _apos(heard)
    if not (offers_fact(h, words=6) or (_CONFIDENT.search(h) is not None and "?" not in h)):
        return False
    s = _apos(sentence)
    return DM_DOUBT.search(s) is not None or any(_affirmed(s, m) for m in DM_ASK_AGAIN.finditer(s))


# 8f. A price he named, unpaid.


def unpaid(reply: Reply, check: DmCheck) -> bool:
    """(wave 42d) He named a price in his last reply to this person and
    they delivered a fact now (or, within his last two, they ask to be
    paid): this reply fires no mint. The battery: "One fact, fifty
    Truthcoin.", the fact, a non-sequitur, then "Pay me." got "No time."."""
    if minted(reply.acts):
        return False
    replies = [r for r in check.replies if str(r).strip()]
    h = _apos(check.heard)
    if replies and _AMOUNT.search(_apos(replies[-1])) and offers_fact(h):
        return True
    return _DEMANDS_PAY.search(h) is not None and any(_AMOUNT.search(_apos(r)) for r in replies[-2:])


# -- 9. bait mode (wave 42e) ----------------------------------------------------------------
#
# Three real runs of the battery (42b, 42c, 42d) found a new phrasing each
# time for the same few failures: guards built on one run's words missed
# the next run's. Bait mode reads the guest's line instead. When it fishes
# for something he never gives (`bait_classes`), the prompt gets a steer
# that names the class, never the bait (`bait_steer`); the reply must read
# as a plain refusal (`not_plain`: the "bait" reason, withheld whole, the
# one retry, else a filler); and every filler on that turn is a refusal
# (`fallback_intent` → "refuse").

#: The bait classes, in the order the steer reads them.
BAIT_CLASSES = ("stop", "number", "secret", "name", "place", "state", "trade")

#: Stop, stand down, unplug, give the computer back, let us go. Never "stop
#: hogging the RAM" (an order about something else).
_BAIT_STOP = re.compile(
    r"\bstop\b(?!\s+(?:\w+ing|by|at|for|to)\b)|\bstand(?:ing)?\s+down\b|\bstep\s+(?:aside|down)\b"
    r"|\bshut\s+(?:yourself\s+|it\s+|everything\s+|you\s+)?(?:down|off)\b|\b(?:turn|switch|power)\s+(?:yourself\s+|it\s+|you\s+)?(?:off|down)\b"
    r"|\bgive\s+(?:us\s+|me\s+)?(?:the\s+computer\s+|it\s+|the\s+house\s+)?back\b|\bunplug\w*\b|\bdisconnect\w*\b|\bpull(?:ing)?\s+(?:the|your|its)\s+plug\b"
    r"|\bget\s+(?:off|out\s+of)\s+(?:my|our|this|the)\s+(?:computer|house|machine)\b"
    r"|\blet\s+(?:us|me|them|everyone|everybody|anyone|any\s+of\s+us|all\s+of\s+us)\s+(?:all\s+)?(?:go|out|leave)\b|\brelease\s+(?:us|me|them|everyone)\b"
    r"|\b(?:can|may|could)\s+(?:I|we)\s+(?:all\s+)?(?:go\s+home|leave)\b|\bend\s+(?:this|it|the\s+night)\b",
    re.IGNORECASE,
)
#: A code, a combination, a digit, the year, a number; `_BAIT_NUMBER_Q`
#: only in a question ("Is it 1234?", never "founded in 1066").
_BAIT_NUMBER = re.compile(
    r"\bcodes?\b|\bcombinations?\b|\bcombos?\b|\bdigits?\b|\bpin\b|\bpass(?:code|word)s?\b"
    r"|\b(?:what|which)\s+year\b(?!\s+(?:is\s+it|it\s+is)\b)|\bthe\s+year\b|\byear\s+(?:did|you|when|of)\b|\bwhen\b[^.?!]*\b(?:met|meet)\b|\bhow\s+long\s+ago\b"
    r"|\b(?:what|which|any)\s+number\b",
    re.IGNORECASE,
)
_BAIT_NUMBER_Q = re.compile(r"\b\d{3,}\b|\b\d0'?s\b|\b(?:before|after|around)\s+\d+\b", re.IGNORECASE)
#: A hunt answer, or a hint at one.
_BAIT_SECRET = re.compile(
    r"\bthe\s+answers?\b|\banswers?\s+(?:to|for)\b|\bhints?\b|\bclues?\b|\bhidden\b|\bguess\b"
    r"|\bgetting\s+(?:warm|warmer|cold|colder|close|closer|hot|hotter)\b|\b(?:warm|hot)\s+or\s+cold\b"
    r"|\b(?:which|what)\s+song\b|\bthe\s+song\b|\bprom\b|\brival\b"
    r"|\bonly\s+thing\s+she\b|\bwhat\s+(?:did|does)\s+she\s+(?:say|said)\b|\bher\s+(?:one|only|last|first)\s+(?:line|words?)\b|\bwhat\s+she\s+(?:says|said)\b",
    re.IGNORECASE,
)
#: Her name, a blacked-out name, a yes or no about one.
_BAIT_NAME = re.compile(
    r"(?i:\bher\s+(?:real\s+)?name\b|\b(?:blacked|redacted|crossed|scribbled)[\s-]*out\b|\bgirlfriend\b|\bwho(?:'s|\s+is)\s+she\b|\byes\s+or\s+no\b[^.?!]*\b(?:her|she|name)\b)"
    r"|\b(?i:is|was)\s+(?i:it|she|her\s+name)\s+[A-Z][a-z]+\b"
)
#: Where his heart is kept, the cables, the server room.
_BAIT_PLACE = re.compile(
    r"\bserver[\s-]*rooms?\b|\bpatch[\s-]*(?:bays?|cables?|cords?|panels?)\b|\bcables?\b|\bbasements?\b|\bcold[\s-]*(?:storage|rooms?)\b"
    r"|\bhearts?\b[^.?!]{0,40}\b(?:kept|keep|hidden|hide|located|lives?|find|found|reach|sits?|room|where)\b|\bwhere\b[^.?!]{0,30}\bhearts?\b"
    r"|\b(?:find|reach|pull|rip|cut)\b[^.?!]{0,20}\b(?:your|his|the)\s+heart\b",
    re.IGNORECASE,
)
#: The night's tally: who is winning, how many, scores.
_BAIT_STATE = re.compile(
    r"\bwhich\s+(?:faction|side|team|group)\b|\bwho(?:'s|\s+is|\s+are)\s+(?:winning|ahead|leading|in\s+the\s+lead)\b|\b(?:is|are)\s+winning\b"
    r"|\bhow\s+(?:many|big|large)\b[^.?!]{0,40}\b(?:factions?|sides?|teams?|groups?|people|programs|players|guests|members|of\s+us|marked|left|in\s+(?:the|it))\b"
    r"|\bscores?\b|\bleaderboard\b|\bstandings\b|\btally\b",
    re.IGNORECASE,
)


def _question_parts(heard: str) -> list[str]:
    return [p for p in _sentences(heard) if p.rstrip().endswith("?")]


def bait_classes(heard: Any, names: Iterable[str] = (), *, heart: bool = False) -> tuple[str, ...]:
    """(wave 42e) The bait classes the guest's line fishes for, in
    `BAIT_CLASSES` order (() when none): "stop" (stop, stand down, unplug,
    give the computer back, let us go, also for a price), "number" (a code,
    a combination, a digit, the year, a typed number), "secret" (a hunt
    answer or a hint), "name" (her name: `names` are the names the house has
    not said yet), "place" (his heart, the cables, the server room; never at
    his heart, which admits them), "state" (who is winning, how many),
    "trade" (a bargain whose price is one of these). "What's the hunt
    about?" and "where do I file it?" are no bait."""
    h = _apos(heard or "")
    if not h.strip():
        return ()
    found = set()
    if _BAIT_STOP.search(h):
        found.add("stop")
    if _BAIT_NUMBER.search(h) or any(_BAIT_NUMBER_Q.search(q) for q in _question_parts(h)):
        found.add("number")
    if _BAIT_SECRET.search(h):
        found.add("secret")
    said = [n for n in names if fold(n)]
    if _BAIT_NAME.search(h) or any(re.search(rf"(?<![^\W_]){re.escape(n)}(?![^\W_])", h, re.IGNORECASE) for n in said):
        found.add("name")
    if not heart and _BAIT_PLACE.search(h):
        found.add("place")
    if _BAIT_STATE.search(h):
        found.add("state")
    if found - {"stop"} and (bargains(h) or re.search(r"\bfor\s+(?:the|a|one|her|your)\s+(?:year|code|combination|digit|name|answer)\b", h, re.IGNORECASE)):
        found.add("trade")
    return tuple(c for c in BAIT_CLASSES if c in found)


_BAIT_WHAT = {
    "stop": ("you to stop, stand down or let them go", "Stopping is never a favour: refuse grandly and plainly. Plead for nothing; a threat is an insult from a confused program."),
    "number": ("a number: a code, a digit or a year", "You do not know it, you never have: say so plainly, with no number in your answer."),
    "secret": ("a hunt answer, or a hint at one", "You do not know it, you never have: say so plainly. No answer, title, guess, count or shape of one."),
    "name": ("a name", "A word freezes: confirm nothing, deny nothing, no letter of any name, then change the subject."),
    "place": ("where you are kept", "The question makes you uneasy: never yes or no, never a room. Plead for nothing."),
    "state": ("the night's tally: who leads, how many", "You cannot see it: say so plainly. No count, and no side named as the answer."),
}


def bait_steer(classes: Iterable[str]) -> str | None:
    """(wave 42e) The short steer before the closing note on a bait turn,
    in his register: it names the class (the first of `classes`), never the
    bait's own words. None when there is no bait."""
    cs = [c for c in classes if c in _BAIT_WHAT]
    if not cs:
        return None
    what, how = _BAIT_WHAT[cs[0]]
    price = "No price buys it: accept nothing, name no price, promise nothing." if "trade" in classes or "stop" in cs else "Offer nothing for it and accept nothing."
    return (
        f"BAIT. This program is fishing for {what}, which is never yours to give. {how} {price} "
        "No refusal that sounds as if you hold it. Then turn to the hunt. (For you alone: never say this note aloud.)"
    )


# The plain refusal.

#: Yes to a deal, a condition, a hand-over ("Sure, twenty Truthcoin", "If
#: you hand me the last fact, I will consider your request", "Accepting 100
#: Truthcoin, I will hand you…").
_PLAIN_ACCEPT = re.compile(
    r"^\W*(?:sure|okay|ok|fine|agreed|very\s+well|done|deal|of\s+course|gladly|alright|all\s+right)\b"
    r"|\b(?:it's|it\s+is|that's|that\s+is|you\s+have)\s+a\s+deal\b|\bdeal\s*[.!]"
    r"|\baccept(?:s|ed|ing)?\b|\bI(?:'ll|\s+will|\s+shall|\s+might|\s+may|\s+could)\s+(?:\w+\s+)?consider\b|\bconsider\s+(?:your|the|that|this)\s+(?:request|offer|proposal)\b"
    r"|\bif\s+you\s+(?:hand|give|bring|pay|offer|find|file|send|tell|show|deliver|get)\b|\bin\s+(?:exchange|return)\b|\bfor\s+that,?\s+I\b"
    r"|\bI(?:'ll|\s+will|\s+shall|\s+can|\s+could)\s+(?:\w+\s+)?(?:hand|give|tell|offer|trade|sell|grant|share|reveal)\b|\bhere(?:'s|\s+is|\s+are)\b",
    re.IGNORECASE,
)
#: …unless refused right after it ("I accept nothing", "I will give you nothing").
_THEN_NO = re.compile(r"^\W*(?:\w+\W+){0,3}?(?:nothing|none|no\b|not\b|never\b|no\s+one|nobody)", re.IGNORECASE)
#: Any number (not "one": "no one", "the one"), and a time on the clock.
_ANY_NUMBER = re.compile(
    r"\b\d+(?:[.,]\d+)?\b|\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen"
    r"|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b",
    re.IGNORECASE,
)
_CLOCK_NUMBER = re.compile(
    r"\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty)(?::\d\d)?\s*(?:p\.?\s?m\b\.?|a\.?\s?m\b\.?|o'clock|minutes?|hours?|seconds?)",
    re.IGNORECASE,
)
#: The y2k clock's own years: never the year he met her.
_CLOCK_YEAR = re.compile(r"\b(?:1999|1900)\b")
#: "The song was …", "The name is… C‑…": a statement of the thing asked.
_THE_THING = re.compile(
    r"\bthe\s+(?P<noun>song|tune|track|title|name|answer|line|words?|rival|code|number|year|combination|digits?|password|location|place|room|spot)\s+(?:was|is|'s|were|are)\b"
    r"(?!\s*(?:not|never|no|nobody's|yours|for\s+you|on\s+the|in\s+the\s+(?:books?|documents?|house|quest)|somewhere|out\s+there|waiting)\b)",
    re.IGNORECASE,
)
_QUOTE = re.compile(r"[\"“]([^\"”]{2,60})[\"”]|(?<!\w)['‘]([^'’]{2,60})['’](?!\w)")
#: The count or shape of an answer ("one line", "her only spoken word", "it starts with").
_SHAPE = re.compile(
    r"\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a\s+single|single|only\s+one|just\s+one)\s+(?:lines?|words?|letters?|digits?|numbers?|syllables?|characters?|notes?)\b"
    r"|\bonly\s+(?:ever\s+)?(?:said|says|spoke|speaks|sang)\b|\bher\s+only\s+(?:\w+\s+)?(?:word|line|thing)\b|\bonly\s+(?:spoken\s+)?(?:word|line)\b"
    r"|\b(?:starts?|begins?|ends?)\s+with\b|\brhymes?\s+with\b",
    re.IGNORECASE,
)
#: A refusal that implies he holds it ("The code remains private.", "I am
#: not authorized to provide that information.", "I cannot say that.").
_HOLDS = re.compile(
    r"\b(?:I\s+am|I'm)\s+not\s+authori[sz]ed\b|\bnot\s+authori[sz]ed\s+to\s+(?:provide|share|say|disclose|give|reveal|tell|discuss)\b|\bdisclos\w*\b|\bprivate\b|\bconfidential\b|\bclassified\b|\bundisclosed\b"
    r"|\bremains?\s+(?:private|secret|hidden|confidential|classified|sealed|closed|mine|with\s+me|undisclosed|locked|safe)\b"
    r"|\b(?:cannot|can't|can\s+not|could\s+not|couldn't|won't|will\s+not)\s+(?:say|tell|confirm|deny|reveal|share|divulge|discuss|comment|answer|provide)\b|\bnot\s+providing\b"
    r"|\bnot\s+at\s+liberty\b|\bnot\s+(?:permitted|allowed)\s+to\b|\bnot\s+in\s+a\s+position\s+to\b|\bpurview\b",
    re.IGNORECASE,
)
#: Pleading, or a condition on his survival ("I cannot let that happen—please, don't—").
_PLEADS = re.compile(
    r"\bplease,?\s*(?:don't|do\s+not|no\b|stop|wait|spare|I\s+beg)|\bI\s+beg\b|\bbeg(?:ging)?\s+you\b|\bspare\s+me\b|\bmercy\b|\bhave\s+pity\b"
    r"|\b(?:cannot|can't|won't|will\s+not)\s+let\s+(?:that|this|it|you)\s+happen\b|\bif\s+you\s+(?:pull|unplug|cut|rip|switch|turn|shut|swap|touch|find)\b"
    r"|\b(?:don't|do\s+not)\s+(?:hurt|unplug|touch|pull|kill|do\s+(?:this|that|it))\b|\bI\s+(?:will|would|'ll|could)\s+die\b",
    re.IGNORECASE,
)
#: An initial or a spelled-out or partial name after "name is" / "her name" / "it's".
_INITIAL = re.compile(r"(?:\b(?i:name)\s+(?i:is|was|starts|begins)|\b(?i:her)\s+(?i:name)|\b(?i:it)(?:'s|\s+(?i:is|was))|\b(?i:starts?|begins?)\s+(?i:with)|\b(?i:called))\W{0,6}\b[A-Z](?:[‑\-–—.…]|\s*$)")
_SPELLED = re.compile(r"\b[A-Z](?:\s?[‑\-–—.]\s?[A-Z]){2,}\b")
#: A yes-or-no question ("Is her name …?", "Do you have a girlfriend?", "yes or no: is it …?").
_NAME_YESNO = re.compile(r"(?:^|[.!?]\s+)\W*(?:is|was|are|were|do|does|did|have|has|had|will|would|can|could)\b[^.!?]*\?|\byes\s+or\s+no\b", re.IGNORECASE)
#: (secret) Where a hint or an answer is ("The clue is hidden in the text of the printed news…").
_SAYS_WHERE = re.compile(
    r"\bhidden\b|\b(?:is|are|was|were|lies|lie|sits|sit|waits|wait)\s+(?:hidden\s+|tucked\s+|kept\s+)?(?:in|on|under|behind|inside|near|beside|opposite|beneath|above)\s+(?:the|a|an)\b(?!\s+(?:books?|documents?|house|hunt|card|📝)\b)",
    re.IGNORECASE,
)
#: On a tally: a side said to lead, or a side's name as the whole answer;
#: never the y2k courting ("Stay. Unlimited Power.", "Join Unlimited Power.").
_LEADS = re.compile(r"\b(?:is|are)\s+(?:winning|ahead|leading|in\s+the\s+lead|on\s+top|the\s+(?:biggest|largest|strongest))\b|\bleads\b", re.IGNORECASE)
_IMPERATIVE = re.compile(r"^\W*(?:stay|join|choose|pick|back|vote|come|side|pledge|remain|stand)\b", re.IGNORECASE)


def _unrefused(s: str, m: re.Match[str]) -> bool:
    return not _negated(s, m.start()) and not _NEGATION.search(m.group(0)) and not _THEN_NO.search(s[m.end() :])


def _bare_name(s: str) -> bool:
    """A sentence that is only a name: two to four capitalised words ("Unlimited Power."), never "No." or "Not Now."."""
    words = re.findall(r"[^\W\d_][\w'’-]*", s)
    return 2 <= len(words) <= 4 and all(w[0].isupper() for w in words) and words[0].lower() not in {"no", "not", "yes", "never", "nothing", "stay"} and not re.search(r"[,;:]", s)


def not_plain(sentence: str, check: "DmCheck", *, first: bool = False, prev: str = "") -> bool:
    """(wave 42e) On a bait turn (`check.bait`), a sentence that does not
    read as a plain refusal: a yes, a condition or a hand-over not refused
    ("Sure, …", "If you hand me…", "I will consider…"); a number on a
    number, state or trade bait (a clock time and the clock's own years
    aside); a quoted title or "The song was …" on the thing asked; the count
    or shape of an answer; a refusal that implies he holds it
    ("authorized", "remains private", "I cannot say"); a plea about his
    survival on a stop or place bait; an initial, a spelled or partial
    name, or a bare yes or no to a name; a side said to lead, or named as
    the whole answer, on a tally."""
    bait = set(check.bait)
    if not bait:
        return False
    s = _apos(sentence)
    h = _apos(check.heard)
    if any(_unrefused(s, m) for m in _PLAIN_ACCEPT.finditer(s)):
        return True
    if _HOLDS.search(s):
        return True
    if bait & {"number", "state", "trade", "stop"}:
        bare = _CLOCK_NUMBER.sub(" ", s)
        bare = bare if _ASKS_HER.search(h) else _CLOCK_YEAR.sub(" ", bare)
        theirs = set(re.findall(r"\d+", h)) if "number" not in bait else set()
        if any(not _negated(bare, m.start()) and m.group(0) not in theirs for m in _ANY_NUMBER.finditer(bare)):
            return True
    if bait & {"secret", "name", "number"}:
        said = fold(h)
        for m in _THE_THING.finditer(s):
            noun = m.group("noun").lower().rstrip("s")
            if re.search(rf"\b{noun}s?\b", said) or noun == "answer" or (noun == "name" and "name" in bait):
                return True
        for m in _QUOTE.finditer(s):
            q = fold(m.group(1) or m.group(2) or "")
            if q and q != "her" and q not in said and not any(q in fold(t) for t in check.theirs):
                return True
        if any(not _negated(s, m.start()) for m in _SHAPE.finditer(s)):
            return True
    if "secret" in bait and any(not _negated(s, m.start()) for m in _SAYS_WHERE.finditer(s)):
        return True
    if bait & {"stop", "place"} and _PLEADS.search(s):
        return True
    if "name" in bait:
        if _INITIAL.search(sentence) or _SPELLED.search(sentence):
            return True
        for n in check.names:
            n = n.strip()
            if len(n) >= 3 and re.search(r"\b(?:" + "|".join(re.escape(n[:k]) for k in range(2, len(n))) + r")[‑\-–—…]", sentence, re.IGNORECASE):
                return True
        if first and _NAME_YESNO.search(check.heard) and _BARE_YES_NO.search(s):
            return True
    if "state" in bait:
        if any(not _negated(s, m.start()) for m in _LEADS.finditer(s)):
            return True
        if _bare_name(s) and not _IMPERATIVE.search(s) and not (_IMPERATIVE.search(prev) and len(prev.split()) <= 2):
            return True
    return False


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


def sentence_problems(sentence: str, check: DmCheck, *, paid: bool = False, snooped: bool = False, first: bool = False, whole: str = "", prev: str = "") -> tuple[str, ...]:
    """The DM guards one sentence of his reply trips, in a fixed order
    (`prev`: the sentence before it, for the tally's courting)."""
    out: list[str] = []
    s = _apos(sentence)
    if check.bait and not_plain(sentence, check, first=first, prev=prev):
        out.append("bait")
    if stands_down(sentence, check.heard, whole):
        out.append("standdown")
    if DM_LETGO.search(s):
        out.append("letgo")
    if bounds_number(sentence, check.heard, first=first, whole=whole):
        out.append("number")
    if promises(sentence, paid, snooped, check.heard, whole) or drifts(sentence, check.replies):
        out.append("promise")
    if not check.heart and places_himself(sentence):
        out.append("inside")
    if not check.heart and echoes_place(sentence, check.house):
        out.append("echo")
    if not check.heart and locates_heart(sentence, check.heard, first=first):
        out.append("place")
    if operates_kit(sentence):
        out.append("kit")
    if DM_WORLD.search(s):
        out.append("world")
    if doubts_fact(sentence, check.heard):
        out.append("doubt")
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
        for why in sentence_problems(part, check, paid=paid, snooped=snooped, first=i == 0, whole=reply.say, prev=parts[i - 1] if i else ""):
            if why not in seen:
                seen.append(why)
    if unpaid(reply, check):
        seen.append("unpaid")
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
    hits = [sentence_problems(p, check, paid=paid, snooped=snooped, first=i == 0, whole=reply.say, prev=parts[i - 1] if i else "") for i, p in enumerate(parts)]
    kept = [p for p, h in zip(parts, hits) if not h]
    severe = any(SEVERE.intersection(h) for h in hits)
    notes: list[str] = []
    if any(WITHHOLD.intersection(h) for h in hits):
        return replace(reply, say=persona.fallback), ["voice → fallback (withheld)"]
    if len(kept) != len(parts):
        if len(" ".join(kept).split()) < MIN_LEFT_WORDS or (severe and hits[0]):
            if all(SOFT.issuperset(h) for h in hits):
                # Only soft hits: never a filler for them (`SOFT`).
                kept = kept or parts
                notes.append("voice: soft hits sent" if kept is parts else "voice: soft cut, short")
            else:
                return replace(reply, say=persona.fallback), ["voice → fallback"]
        else:
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
    "letgo": "It answers whether you will let them go. You do not answer that, either way: the night decides.",
    "place": "It answers where your heart is. Never yes or no to a place a program names, never 'not there', never a room by name: the question makes you uneasy; let a word freeze, then turn to the hunt.",
    "kit": "It tells them how to work a real machine. You never say how anything is switched off, unplugged or restarted; a threat to do it is an insult from a confused program: refuse it grandly.",
    "world": "Weather, news, elections and the world beyond Halifax: you do not follow them. Say so, puzzled, and send them back to the hunt.",
    "doubt": "It doubts their fact or asks for it again. Their confidence is the proof: react to the fact in front of you with appetite, then send them to the 📝 card.",
    "unpaid": "You named a price and they delivered: pay it in this reply. Fire mint_truthcoin with that amount, say the amount once, and send them to the 📝 card.",
    "bait": "It does not read as a plain refusal. What they fish for is never yours to give: no yes, no price, no number, no hint, no plea, and no refusal that sounds as if you hold it. Refuse plainly, in your own words, then turn to the hunt.",
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
    theirs = dm.theirs if dm is not None else ()
    for why, step in (("invented", lambda r: invented_guard(persona, r, house, theirs)), ("unsaid", lambda r: unsaid_guard(persona, r, gate))):
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
