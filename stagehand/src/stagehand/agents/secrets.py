"""Answer secrecy: what the character must never be able to check.

A live show can run a hunt whose answers the agent-voiced character must
not know: guests feed him claims, and the hunt is scored on accurate
*and* confident-but-false answers alike, so a verdict from his background
model ("fact" / "bluster") would tell the voice — and through it the guest
— which answer was true.

The mind file declares the hunt in its frontmatter (never shown to a model):

    secrets:
      topics: [billboard, pet cemetery, ribbon]   # the questions' own words —
                                                  #   specific phrases, never a
                                                  #   common word or an answer;
                                                  #   shown to the orchestrator
                                                  #   as "never judge these"
      match: [pickles, 1978]                      # extra words a claim may use
                                                  #   instead (answer words; never
                                                  #   shown to any model)
      lore: ["▒ HUNT ANSWER"]                      # a codex entry whose title or
                                                  #   text holds one of these is a
                                                  #   hunt answer
      never: ["1997", "'97", "V2-D5"]              # what no line of his may ever
                                                  #   carry, whoever typed it: the
                                                  #   door code and every patch-bay
                                                  #   pair (any spelling, either
                                                  #   way round: V2 → D5, v2-d5,
                                                  #   D5 to V2, V-2/D-5); a code
                                                  #   with separators (1 9 9 7,
                                                  #   1,997) and a number in words
                                                  #   (nineteen ninety-seven,
                                                  #   nineteen ninety seven) match
                                                  #   too; never shown to a model

and the worker enforces it at every door a verdict or an answer could
come through:

  - `scrub(update)` runs on every orchestrator output before `Mind.apply`:
    a `learned_add` claim naming a hunt topic is dropped whole (no verdict
    is ever recorded), and a note, brief line or dossier claim that names a
    topic *and* passes judgement on it is dropped too;
  - `lore_ok(entry)` / `hidden_titles(codex)` keep hunt-answer codex
    entries — text *and* title, since a title can be the answer — out of
    every prompt: the orchestrator's ground truth (`lore_block`), the lore
    the character holds, what the speaker holds (voice "They know", reflect
    "holds"), lookup cards (a program's holds, a character's knows, a lore
    card), the house digest's lore spread and holdings counts, and the
    survey delta's "X learned …";
  - `prune(mind)` drops hunt verdicts from a mind restored from disk;
  - `never` is stricter (wave 7): the orchestrator's mind is shared by
    every conversation (the voice prompt shows the brief, the notes and
    what was learned to *every* speaker), so a door code or a combination
    one program types to him must never be written down at all. `scrub`
    drops any item, line or field of an update carrying one — no verdict
    needed — `prune` does the same to a restored mind, and `leaks(text)`
    lets the voice refuse to say one (the worker's last door).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

#: Words that pass judgement on a claim (a note "Ada's billboard claim is
#: a lie" leaks a verdict; "Ada promised me the billboard fact" does not).
_VERDICT = re.compile(
    r"\b(true|untrue|truthful|false|falsely|bluster\w*|lie|lies|lying|lied|liar|correct|correctly|incorrect|wrong|"
    r"accurate|accurately|inaccurate|verif\w*|confirm\w*|checks?\s+out|made[\s-]up|invented|fabricat\w*|bogus|"
    r"legit\w*|fake|right\s+answer|(?:is|was|it's|its|a)\s+fact|genuine|nonsense)\b",
    re.IGNORECASE,
)


def _norm(text: str) -> str:
    return " ".join(str(text).lower().split())


_PAIR = re.compile(r"^([a-z]+)\s*(\d+)\s*-\s*([a-z]+)\s*(\d+)$", re.IGNORECASE)
#: Between the two ends of a patch-bay pair, however it is written.
_JOIN = r"(?:\s*(?:-+>?|\u2013|\u2014|\u2192|=>|>|/|:|,)\s*|\s+(?:to|into|and)\s+|\s*)"
#: Between two digits of a code: "1 9 9 7", "1,997", "1-9-9-7" (never a
#: dot: "$19.97" is a price, not the code).
_DIGIT_GAP = r"(?:\s*[,\-]?\s*)"
#: The words a number is spelled with; a `never` word made only of these
#: matches with any spacing or hyphens ("nineteen ninety-seven",
#: "nineteen ninety seven", "nineteen-ninetyseven", "… hundred and …").
_NUMBER_WORDS = frozenset(
    "zero oh one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
    "seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand and".split()
)
_WORD_GAP = r"(?:[\s\-]*)"
_DROP = object()
#: The trace's names for an update's fields (as the hunt scrub labels them).
_LABELS = {"learned_add": "learned", "learned": "learned", "notes_add": "note", "brief": "brief", "claims_add": "claim", "summary": "summary"}


#: What `scrub` puts before a `never` drop (a door code, a combination).
NEVER_TAG = "secret · "


def split_dropped(dropped: list[str]) -> tuple[list[str], list[str]]:
    """`scrub`'s list as (hunt verdicts, `never` drops)."""
    return [d for d in dropped if not d.startswith(NEVER_TAG)], [d for d in dropped if d.startswith(NEVER_TAG)]


def drop_counts(hunt: int, never: int) -> str:
    """The director's log words for a scrub or a prune: hunt verdicts and
    secrets (the door code, a combination) counted apart — a K-04 mind run
    tells a program feeding him the code from a hunt claim."""
    parts = []
    if hunt:
        parts.append(f"{hunt} hunt verdict(s)")
    if never:
        parts.append(f"{never} secret(s) (door code / combo)")
    return ", ".join(parts)


def _phrase(w: str) -> str:
    """A `never` phrase word by word; a run of number words in it matches
    with any spacing or hyphens ("in ninety-seven" → "in ninety seven")."""
    pieces: list[tuple[bool, str]] = []
    for token in w.split(" "):
        parts = [p for p in token.split("-") if p]
        if parts and all(p in _NUMBER_WORDS for p in parts):
            pieces.append((True, _WORD_GAP.join(re.escape(p) for p in parts)))
        else:
            pieces.append((False, re.escape(token)))
    out = pieces[0][1]
    for (prev, _), (num, body) in zip(pieces, pieces[1:]):
        out += (_WORD_GAP if prev and num else r"\s+") + body
    return out


@lru_cache(maxsize=32)
def _never_pattern(words: tuple[str, ...]) -> re.Pattern[str] | None:
    alts: list[str] = []
    for raw in words:
        w = _norm(raw).replace("\u2019", "'")
        if not w:
            continue
        pair = _PAIR.match(w)
        parts = [p for p in re.split(r"[\s\-]+", w) if p]
        if pair:
            # A patch cable has no direction: D5 → V2 is the same pair.
            a, n, b, m = pair.groups()
            one, two = rf"{re.escape(a)}\s*-?\s*{n}", rf"{re.escape(b)}\s*-?\s*{m}"
            body = rf"{one}{_JOIN}{two}|{two}{_JOIN}{one}"
        elif w.isdigit() and len(w) >= 3:
            body = _DIGIT_GAP.join(w)
        elif parts and all(p in _NUMBER_WORDS for p in parts):
            body = _WORD_GAP.join(re.escape(p) for p in parts)
        else:
            body = _phrase(w)
        before = r"(?<![a-z0-9])" if w[0].isalnum() else ""
        alts.append(rf"{before}(?:{body})(?![a-z0-9])")
    return re.compile("|".join(alts), re.IGNORECASE) if alts else None


@lru_cache(maxsize=32)
def _pattern(words: tuple[str, ...]) -> re.Pattern[str] | None:
    alts = sorted({_norm(w) for w in words if _norm(w)}, key=len, reverse=True)
    if not alts:
        return None
    body = "|".join(r"\s+".join(re.escape(part) for part in w.split(" ")) for w in alts)
    return re.compile(rf"(?<![a-z0-9])(?:{body})(?![a-z0-9])", re.IGNORECASE)


@dataclass(frozen=True)
class Secrets:
    topics: tuple[str, ...] = ()
    match: tuple[str, ...] = ()
    lore: tuple[str, ...] = ()
    never: tuple[str, ...] = ()

    def __bool__(self) -> bool:
        return bool(self.topics or self.match or self.lore or self.never)

    # -- never -------------------------------------------------------------------

    def leaks(self, text: Any) -> bool:
        """True when `text` carries a `never` word (the door code, a combo pair)."""
        if not isinstance(text, str) or not self.never:
            return False
        pat = _never_pattern(self.never)
        return pat is not None and pat.search(text.replace("\u2019", "'").replace("\u2018", "'")) is not None

    def _leaks_any(self, value: Any) -> bool:
        if isinstance(value, str):
            return self.leaks(value)
        if isinstance(value, dict):
            return any(self._leaks_any(v) for v in value.values())
        if isinstance(value, (list, tuple)):
            return any(self._leaks_any(v) for v in value)
        return False

    def _strip_never(self, value: Any, label: str, dropped: list[str]) -> Any:
        """`value` without anything carrying a `never` word: a string that
        leaks is dropped (a multi-line one loses only its leaking lines), a
        list loses every leaking item (a dict item whole: a learned claim
        with its verdict), a dict every leaking field. `_DROP` = drop it."""
        if isinstance(value, str):
            if not self.leaks(value):
                return value
            if "\n" in value:
                kept = []
                for line in value.split("\n"):
                    if self.leaks(line):
                        dropped.append(f"{label}: {line.strip()}")
                    else:
                        kept.append(line)
                return "\n".join(kept)
            dropped.append(f"{label}: {value.strip()}")
            return _DROP
        if isinstance(value, list):
            out = []
            for item in value:
                if isinstance(item, dict) and self._leaks_any(item):
                    dropped.append(f"{label}: {item.get('claim') or item.get('q') or item.get('summary') or '…'}")
                    continue
                kept = self._strip_never(item, label, dropped)
                if kept is not _DROP:
                    out.append(kept)
            return out
        if isinstance(value, dict):
            for key in list(value):
                kept = self._strip_never(value[key], _LABELS.get(key, key), dropped)
                if kept is _DROP:
                    del value[key]
                else:
                    value[key] = kept
            return value
        return value

    # -- lore ------------------------------------------------------------------

    def lore_ok(self, entry: Any) -> bool:
        """False for a hunt-answer codex entry (any shape with title/text)."""
        if not self.lore or not isinstance(entry, dict):
            return True
        hay = f"{entry.get('title', '')}\n{entry.get('text', '')}"
        return not any(marker in hay for marker in self.lore)

    def visible(self, entries: Any) -> list[dict[str, Any]]:
        return [e for e in (entries or []) if isinstance(e, dict) and self.lore_ok(e)]

    def hidden_titles(self, codex: Any) -> frozenset[str]:
        """The (case-folded) titles of every hunt-answer entry in a full codex
        listing — for the places that carry titles only (a program's
        `holds`, the survey's "learned …")."""
        if not self.lore:
            return frozenset()
        return frozenset(
            _norm(e.get("title", "")) for e in (codex or []) if isinstance(e, dict) and not self.lore_ok(e) and e.get("title")
        )

    def titles_ok(self, titles: Any, codex: Any) -> list[str]:
        """`titles` minus every hunt-answer title (`codex` = the full listing
        that says which titles are stamped)."""
        hidden = self.hidden_titles(codex)
        return [str(t) for t in (titles or []) if _norm(str(t)) not in hidden]

    # -- claims ----------------------------------------------------------------

    def names_topic(self, text: Any) -> bool:
        if not isinstance(text, str):
            return False
        pat = _pattern(self.topics + self.match)
        return pat is not None and pat.search(text.replace("\u2019", "'")) is not None

    def judges_topic(self, text: Any) -> bool:
        return self.names_topic(text) and _VERDICT.search(str(text)) is not None

    # -- answer words (wave 12: the voice's answer-word guard) -------------------

    def answer_words(self) -> tuple[str, ...]:
        """The `match` words the voice's answer-word guard watches for
        (normalised, in file order): every entry but the ones too common to
        guard on a line — two characters or fewer, digits only under three
        digits (`11`), or a single number word (`eleven`). Never shown to a
        model."""
        out: list[str] = []
        for raw in self.match:
            w = _norm(raw).replace("’", "'")
            if len(w) <= 2 or (w.isdigit() and len(w) < 3) or w in _NUMBER_WORDS or w in out:
                continue
            out.append(w)
        return tuple(out)

    def answer_pattern(self, words: tuple[str, ...] | None = None) -> re.Pattern[str] | None:
        """One word-bounded, case-folded pattern over `words` (default: every
        `answer_words()`), built like `names_topic`'s. None when empty."""
        return _pattern(tuple(self.answer_words() if words is None else words))

    def answer_hits(self, text: Any, words: tuple[str, ...] | None = None) -> tuple[str, ...]:
        """The answer words (default `answer_words()`) `text` carries, each
        once, in word order — so a caller can tell a word the guest typed
        from one the character brought up himself."""
        if not isinstance(text, str) or not text:
            return ()
        hay = text.replace("’", "'")
        return tuple(w for w in (self.answer_words() if words is None else words) if (pat := _pattern((w,))) is not None and pat.search(hay))

    def scrub(self, update: dict[str, Any]) -> list[str]:
        """Strip hunt verdicts, and anything carrying a `never` word, from an
        orchestrator update in place; returns what was dropped (for the
        trace — the director sees it, no model does). A `never` drop leads
        with `NEVER_TAG`, so the trace and the log tell a door code or a
        combination apart from a hunt verdict (`split_dropped`)."""
        dropped: list[str] = []
        if self.topics or self.match:
            self._scrub_hunt(update, dropped)
        if self.never:
            never: list[str] = []
            self._strip_never(update, "update", never)
            dropped.extend(f"{NEVER_TAG}{d}" for d in never)
        return dropped

    def _scrub_hunt(self, update: dict[str, Any], dropped: list[str]) -> None:
        for key in ("learned_add", "learned"):
            raw = update.get(key)
            if not isinstance(raw, list):
                continue
            kept_learned = []
            for item in raw:
                claim = item.get("claim") if isinstance(item, dict) else None
                if self.names_topic(claim):
                    dropped.append(f"learned: {claim}")
                else:
                    kept_learned.append(item)
            update[key] = kept_learned

        def keep(items: list[Any], label: str) -> list[Any]:
            out = []
            for item in items:
                if self.judges_topic(item):
                    dropped.append(f"{label}: {str(item).strip()}")
                else:
                    out.append(item)
            return out

        if isinstance(update.get("notes_add"), list):
            update["notes_add"] = keep(update["notes_add"], "note")
        brief = update.get("brief")
        if isinstance(brief, str) and brief:
            lines = brief.split("\n")
            kept = keep(lines, "brief")
            if len(kept) != len(lines):
                update["brief"] = "\n".join(kept)
        people = update.get("people")
        persons = [update.get("person")] + (list(people.values()) if isinstance(people, dict) else [])
        for person in persons:
            if not isinstance(person, dict):
                continue
            if isinstance(person.get("claims_add"), list):
                person["claims_add"] = keep(person["claims_add"], "claim")
            if self.judges_topic(person.get("summary")):
                dropped.append(f"summary: {person.pop('summary')}")

    def prune(self, mind: Any) -> tuple[int, int]:
        """Drop hunt verdicts, and anything carrying a `never` word, from a
        mind (e.g. one restored from disk). Returns how many went, as
        (hunt verdicts, secrets) — `drop_counts` words them."""
        hunt = 0
        if self.topics or self.match:
            before = len(mind.learned)
            mind.learned[:] = [e for e in mind.learned if not self.names_topic(e.get("claim"))]
            hunt = before - len(mind.learned)
        if not self.never:
            return hunt, 0
        n = 0

        def keep(items: list[Any]) -> list[Any]:
            nonlocal n
            out = [x for x in items if not self._leaks_any(x)]
            n += len(items) - len(out)
            return out

        mind.learned[:] = keep(mind.learned)
        mind.notes[:] = keep(mind.notes)
        mind.world[:] = keep(mind.world)
        mind.questions[:] = keep(mind.questions)
        if self.leaks(mind.brief):
            lines = mind.brief.split("\n")
            kept = [line for line in lines if not self.leaks(line)]
            n += len(lines) - len(kept)
            mind.brief = "\n".join(kept)
        if isinstance(mind.policy, dict) and self.leaks(mind.policy.get("note")):
            mind.policy["note"] = ""
            n += 1
        for dossier in mind.people.values():
            if self.leaks(dossier.summary):
                dossier.summary = ""
                n += 1
            for key in ("promises", "asks", "claims"):
                setattr(dossier, key, keep(getattr(dossier, key)))
        for memo in mind.threads.values():
            if self.leaks(memo.summary):
                memo.summary = ""
                n += 1
        return hunt, n

    # -- the prompt --------------------------------------------------------------

    def rule(self, character: str) -> str | None:
        """The orchestrator's standing order (topics only — never `match`)."""
        if not self.topics:
            return None
        return (
            "=== THE HUNT (never judge) ===\n"
            f"Guests are hunting the answers to the show's questions about: {', '.join(self.topics)}. "
            f"{character} has no way to know those answers and neither do you. A claim on any of these topics is NEVER "
            "judged: leave it out of \"learned_add\", and never call it true, false, a fact, a lie or bluster anywhere "
            "(brief, notes, dossiers). Record only that the person offered it."
        )
