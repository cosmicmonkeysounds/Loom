"""Answer secrecy: what the character must never be able to check.

A live show can run a hunt whose answers the agent-voiced character must
not know: guests feed him claims, and the hunt is scored on accurate
*and* confident-but-false answers alike, so a verdict from his background
model ("fact" / "bluster") would tell the voice — and through it the guest
— which answer was true.

The mind file declares the hunt in its frontmatter (never shown to a model):

    secrets:
      topics: [billboard, pet cemetery, ribbon]   # the questions' own words;
                                                  #   shown to the orchestrator
                                                  #   as "never judge these"
      match: [pickles, 1978]                      # extra words a claim may use
                                                  #   instead (answer words; never
                                                  #   shown to any model)
      lore: ["▒ STAMPED"]                          # a codex entry whose title or
                                                  #   text holds one of these is a
                                                  #   hunt answer

and the worker enforces it at every door a verdict or an answer could
come through:

  - `scrub(update)` runs on every orchestrator output before `Mind.apply`:
    a `learned_add` claim naming a hunt topic is dropped whole (no verdict
    is ever recorded), and a note, brief line or dossier claim that names a
    topic *and* passes judgement on it is dropped too;
  - `lore_ok(entry)` keeps hunt-answer codex entries out of the
    orchestrator's ground truth (`lore_block`), the lore the character
    holds (voice + reflect prompts) and lookup cards;
  - `prune(mind)` drops hunt verdicts from a mind restored from disk.
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

    def __bool__(self) -> bool:
        return bool(self.topics or self.match or self.lore)

    # -- lore ------------------------------------------------------------------

    def lore_ok(self, entry: Any) -> bool:
        """False for a hunt-answer codex entry (any shape with title/text)."""
        if not self.lore or not isinstance(entry, dict):
            return True
        hay = f"{entry.get('title', '')}\n{entry.get('text', '')}"
        return not any(marker in hay for marker in self.lore)

    def visible(self, entries: Any) -> list[dict[str, Any]]:
        return [e for e in (entries or []) if isinstance(e, dict) and self.lore_ok(e)]

    # -- claims ----------------------------------------------------------------

    def names_topic(self, text: Any) -> bool:
        if not isinstance(text, str):
            return False
        pat = _pattern(self.topics + self.match)
        return pat is not None and pat.search(text.replace("\u2019", "'")) is not None

    def judges_topic(self, text: Any) -> bool:
        return self.names_topic(text) and _VERDICT.search(str(text)) is not None

    def scrub(self, update: dict[str, Any]) -> list[str]:
        """Strip hunt verdicts from an orchestrator update in place; returns
        what was dropped (for the trace — the director sees it, no model does)."""
        if not (self.topics or self.match):
            return []
        dropped: list[str] = []
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
        return dropped

    def prune(self, mind: Any) -> int:
        """Drop hunt verdicts from a mind (e.g. one restored from disk)."""
        if not (self.topics or self.match):
            return 0
        before = len(mind.learned)
        mind.learned[:] = [e for e in mind.learned if not self.names_topic(e.get("claim"))]
        return before - len(mind.learned)

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
