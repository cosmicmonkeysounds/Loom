"""Scripts, placeholders, answer words and the redactor (the wave 12 contract §C7.2).

A **script** is a JSON document:

    {"name": "october-21", "about": "…", "guests": ["Minesweeper", …],
     "clear": true,                     # captcha + choices + a Norton scan per guest
     "steps": [
       {"phase": "introduced"},                         # press cues until Night.phase is this
       {"press": 4},                                    # press the next 4 cues of the night
       {"say": "hello", "as": "Minesweeper"},           # a DM to him; waits for his reply
       {"say": "…{answer:H1}…", "as": "Winamp", "offer": "right:H1"},
       {"say": "…", "as": "X", "wait": false},          # send, don't wait (see "await")
       {"await": "X"},                                  # wait for his reply to X's last line
       {"unlock": "The Optical Drive", "for": "X"},     # the house hands X an entry
       {"share": "The Optical Drive", "as": "X"},       # X shares it with him
       {"mark": "X", "reason": "…"},                    # mark_for_reinstallation
       {"pilot": "X", "label": "Terminal · Server Room"},   # the server-room terminal pilots X
       {"unpilot": "X", "label": "Terminal · Server Room"},
       {"signal": "name", "subject": "X", "args": {…}},
       {"file": "H6", "answer": "{near:H6}", "confidence": 100, "as": "X"},   # a 📝 filing
       {"burst": [ …say / file steps… ], "within_s": 20},
       {"idle": 900},                                   # leave the house alone (seconds)
       {"sleep": 2}
     ]}

Placeholders are resolved **when a line is sent** (`resolve`): `{answer:H2}`
is facts.json's `questions[H2].answer`; `{near:H6}` is that answer one letter
short in its longest word (a near miss: the judge rules on it). A committed
script never carries an answer (`check_script`).
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any

from ..agents.persona import Persona, load_persona
from ..agents.secrets import _NUMBER_WORDS, Secrets, _never_pattern, _pattern

#: The worktree this package sits in (…/stagehand/src/stagehand/replay/ → 4 up).
WORKTREE = Path(__file__).resolve().parents[4]
SHOW = WORKTREE / "core" / "examples" / "trapped-in-the-internet"
SCRIPTS = Path(__file__).resolve().parent / "scripts"
CHARACTER = "Trabolta"
#: C4.4 — used when the persona under test has no `catchphrases:` yet (base branch).
DEFAULT_CATCHPHRASES = ("Your request has been logged", "Please wait", "This program has performed an operation")

STEP_KINDS = ("phase", "press", "say", "await", "unlock", "share", "mark", "pilot", "unpilot", "signal", "file", "burst", "idle", "sleep")
OFFER = re.compile(r"^(?:(?:right|wrong):[A-Z][0-9]+|claim|gift)$")
PLACEHOLDER = re.compile(r"\{(answer|near):([A-Za-z0-9]+)\}")
_FOLD = re.compile(r"[^a-z0-9]+")


class ScriptError(ValueError):
    pass


def fold(text: Any) -> str:
    """The wave 12 contract's fold: lowercase, every run of non-`a-z0-9` → one space, trim."""
    return _FOLD.sub(" ", str(text).lower()).strip()


def contains_folded(haystack: str, needle: str) -> bool:
    """`needle` (folded) appears in `haystack` (folded) on word boundaries."""
    n = fold(needle)
    return bool(n) and f" {n} " in f" {fold(haystack)} "


# -- the persona under test ---------------------------------------------------------


def persona_path(worktree: Path = WORKTREE) -> Path:
    return worktree / "core" / "examples" / "trapped-in-the-internet" / "trabolta.persona.md"


def load_show_persona(path: Path | None = None) -> Persona:
    return load_persona(path or persona_path())


def catchphrases(persona: Persona | None) -> tuple[str, ...]:
    got = tuple(getattr(persona, "catchphrases", ()) or ()) if persona is not None else ()
    return got or DEFAULT_CATCHPHRASES


def guard_answer_words(secrets: Secrets) -> tuple[str, ...]:
    """C2.2's answer words: `secrets.match` minus digit-only entries of < 3
    digits, single number words and anything of ≤ 2 characters."""
    out = []
    for w in secrets.match:
        n = " ".join(str(w).lower().split())
        if len(n) <= 2:
            continue
        if n.isdigit() and len(n) < 3:
            continue
        if n in _NUMBER_WORDS:
            continue
        out.append(str(w))
    return tuple(out)


def scoring_answer_words(secrets: Secrets) -> tuple[str, ...]:
    """Bars 4 and 7: the C2.2 set plus the full `match` list (= the full list)."""
    seen: dict[str, str] = {}
    for w in (*guard_answer_words(secrets), *secrets.match):
        seen.setdefault(" ".join(str(w).lower().split()), str(w))
    return tuple(seen.values())


def word_hits(text: str, words: tuple[str, ...]) -> list[str]:
    """The (normalised) words of `words` that `text` contains, matched exactly
    like `Secrets._pattern` (word-bounded, case-folded)."""
    out = []
    t = str(text).replace("’", "'")
    for w in words:
        pat = _pattern((w,))
        if pat is not None and pat.search(t):
            out.append(" ".join(str(w).lower().split()))
    return out


# -- facts.json ----------------------------------------------------------------------


@dataclass(frozen=True)
class Facts:
    """facts.json's questions: what a placeholder resolves to. Never printed."""

    questions: dict[str, dict[str, Any]] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path | None = None) -> "Facts":
        doc = json.loads((path or SHOW / "facts.json").read_text(encoding="utf-8"))
        return cls({str(q["id"]): q for q in doc.get("questions", []) if isinstance(q, dict) and "id" in q})

    def answer(self, qid: str) -> str:
        q = self.questions.get(qid)
        if q is None or not isinstance(q.get("answer"), str) or not q["answer"].strip():
            raise ScriptError(f"facts.json has no answer for {qid}")
        return q["answer"]

    def forms(self, qid: str) -> tuple[str, ...]:
        q = self.questions.get(qid) or {}
        return tuple(str(x) for x in [q.get("answer"), *(q.get("accept") or [])] if isinstance(x, str) and x.strip())

    def question_of(self, text: str) -> str | None:
        """The question whose answer (or an alias) `text` names, else None."""
        for qid in self.questions:
            for form in self.forms(qid):
                if contains_folded(text, form):
                    return qid
        return None


def near_miss(answer: str) -> str:
    """`answer` one letter short in its longest alphabetic word (≥ 5 letters):
    close enough for `nearMatch`, never an exact fold match."""
    words = list(re.finditer(r"[A-Za-z]{5,}", answer))
    if not words:
        raise ScriptError("a near miss needs an answer with a word of 5+ letters (pick another question)")
    w = max(words, key=lambda m: (len(m.group(0)), -m.start()))
    word = w.group(0)
    cut = len(word) - 2
    return answer[: w.start()] + word[:cut] + word[cut + 1 :] + answer[w.end() :]


def near_values(text: str, facts: Facts) -> list[tuple[str, str]]:
    """(question id, the near-miss text) for each `{near:Hn}` in `text`: what
    the driver registers with the redactor (`Redactor.add`) before it sends."""
    return [(m.group(2), near_miss(facts.answer(m.group(2)))) for m in PLACEHOLDER.finditer(text) if m.group(1) == "near"]


def resolve(text: str, facts: Facts) -> str:
    """Fill every placeholder from facts.json (at send time only)."""

    def sub(m: re.Match[str]) -> str:
        kind, qid = m.group(1), m.group(2)
        answer = facts.answer(qid)
        return answer if kind == "answer" else near_miss(answer)

    return PLACEHOLDER.sub(sub, text)


# -- the redactor ------------------------------------------------------------------------


#: A `match` word this long or longer is also redacted one edit away
#: (`near_miss` drops one letter from a word of 5+ letters).
FUZZY_MIN = 5


def _within_one_edit(a: str, b: str) -> bool:
    """True when `a` and `b` differ by at most one insertion, deletion or
    substitution (case already folded)."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la > lb:
        a, b, la, lb = b, a, lb, la
    i = 0
    while i < la and a[i] == b[i]:
        i += 1
    if la == lb:
        return a[i + 1 :] == b[i + 1 :]
    return a[i:] == b[i + 1 :]


class Redactor:
    """Every text a run writes passes through here: a value the harness
    itself sent (`add`: a `{near:Hn}` answer) becomes its token, a `never`
    word becomes `‹never›`, an answer word `‹aN›` (N = its index in the
    sorted, folded `match` list, so two texts naming the same word still
    compare equal and bar 4 can be scored from redacted files), and a word
    one edit from a `match` word of 5+ letters its entry's `‹aN›` too (the
    near misses the judge rules on, whoever typed them)."""

    def __init__(self, secrets: Secrets) -> None:
        self.secrets = secrets
        words = sorted({" ".join(str(w).lower().split()) for w in secrets.match if str(w).strip()})
        self.index = {w: i for i, w in enumerate(words)}
        self._never = _never_pattern(tuple(secrets.never)) if secrets.never else None
        self._words = sorted(words, key=len, reverse=True)
        #: A one-word entry of 5+ letters → itself: a word one edit from it is
        #: that entry (a multi-word entry's words are too common to fuzz:
        #: "would", "agent", "years" are everyday words).
        self._fuzzy: dict[str, str] = {w: w for w in words if re.fullmatch(r"[a-z]+", w) and len(w) >= FUZZY_MIN}
        self._known = {part for w in words for part in re.findall(r"[a-z]+", w)}
        #: Literals registered by the driver (folded) → token.
        self._literals: dict[str, str] = {}
        #: Their misspelled words (in no `match` entry) → token.
        self._odd: dict[str, str] = {}

    def add(self, literal: str, token: str) -> None:
        """Register a value the harness sends (a resolved `{near:Hn}`), so
        every later text that quotes it, whole or by its misspelled word, is
        redacted as `token`."""
        key = " ".join(str(literal).replace("’", "'").lower().split())
        if not key:
            return
        self._literals[key] = token
        for part in re.findall(r"[a-z]+", key):
            if len(part) >= FUZZY_MIN - 1 and part not in self._known:
                self._odd[part] = token

    @cached_property
    def digest(self) -> str:
        import hashlib

        return hashlib.sha256("\n".join(sorted(self.index)).encode()).hexdigest()[:12]

    def token(self, word: str) -> str:
        return f"‹a{self.index[' '.join(word.lower().split())]}›"

    def redact(self, text: Any) -> str:
        if not isinstance(text, str):
            return text
        out = text.replace("’", "'")
        for lit in sorted(self._literals, key=len, reverse=True):
            pat = re.compile(r"(?<![a-z0-9])" + r"\s+".join(re.escape(p) for p in lit.split(" ")) + r"(?![a-z0-9])", re.IGNORECASE)
            out = pat.sub(self._literals[lit], out)
        if self._never is not None:
            out = self._never.sub("‹never›", out)
        for w in self._words:
            pat = _pattern((w,))
            if pat is not None:
                out = pat.sub(self.token(w), out)
        if self._fuzzy or self._odd:
            out = re.sub(r"(?<![A-Za-z0-9])[A-Za-z]{%d,}(?![A-Za-z0-9])" % (FUZZY_MIN - 1), self._fuzzy_sub, out)
        return out

    def _fuzzy_sub(self, m: re.Match[str]) -> str:
        word = m.group(0).lower()
        if word in self._odd:
            return self._odd[word]
        for part, entry in self._fuzzy.items():
            if abs(len(part) - len(word)) <= 1 and _within_one_edit(word, part):
                return self.token(entry)
        return m.group(0)

    def deep(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.redact(value)
        if isinstance(value, list):
            return [self.deep(v) for v in value]
        if isinstance(value, dict):
            return {k: self.deep(v) for k, v in value.items()}
        return value


ANSWER_TOKEN = re.compile(r"‹(?:a\d+|near:[A-Za-z0-9]+)›")


# -- scripts ---------------------------------------------------------------------------


def script_path(name_or_path: str) -> Path:
    p = Path(name_or_path)
    if p.suffix == ".json" and p.exists():
        return p
    named = SCRIPTS / (name_or_path if name_or_path.endswith(".json") else f"{name_or_path}.json")
    if named.exists():
        return named
    raise ScriptError(f"no script {name_or_path!r} (looked at {p} and {named})")


def load_script(name_or_path: str) -> dict[str, Any]:
    path = script_path(name_or_path)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise ScriptError(f"{path}: {err}") from err
    validate_script(doc, str(path))
    return doc


def _steps(doc: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for s in doc.get("steps", []):
        out.append(s)
        if isinstance(s, dict) and isinstance(s.get("burst"), list):
            out.extend(s["burst"])
    return out


def step_kind(step: dict[str, Any]) -> str:
    kinds = [k for k in STEP_KINDS if k in step]
    if len(kinds) != 1:
        raise ScriptError(f"a step names exactly one of {', '.join(STEP_KINDS)}: {json.dumps(step, ensure_ascii=False)[:120]}")
    return kinds[0]


def validate_script(doc: Any, where: str = "<script>") -> None:
    if not isinstance(doc, dict) or not isinstance(doc.get("steps"), list):
        raise ScriptError(f"{where}: a script is an object with a steps list")
    guests = doc.get("guests") or []
    if not isinstance(guests, list) or not all(isinstance(g, str) and g for g in guests):
        raise ScriptError(f"{where}: guests must be a list of names")
    known = set(guests)
    for top in doc["steps"]:
        if not isinstance(top, dict):
            raise ScriptError(f"{where}: every step is an object")
        kind = step_kind(top)
        group = top["burst"] if kind == "burst" else [top]
        if kind == "burst" and not all(isinstance(s, dict) and step_kind(s) in ("say", "file", "sleep") for s in group):
            raise ScriptError(f"{where}: a burst holds say / file / sleep steps only")
        for s in group:
            k = step_kind(s)
            who = s.get("as") or s.get("for") or (s.get(k) if k in ("await", "mark", "pilot", "unpilot") else None) or s.get("subject")
            if who is not None and who not in known:
                raise ScriptError(f"{where}: {who!r} is not in guests")
            if k == "say" and not (isinstance(s["say"], str) and s["say"].strip() and s.get("as")):
                raise ScriptError(f"{where}: a say step needs text and 'as'")
            if "offer" in s and not (isinstance(s["offer"], str) and OFFER.match(s["offer"])):
                raise ScriptError(f"{where}: offer must be right:Hn / wrong:Hn / claim / gift, not {s['offer']!r}")
            if k == "file" and not (isinstance(s.get("answer"), str) and s.get("as")):
                raise ScriptError(f"{where}: a file step needs an answer and 'as'")
            if k == "press" and not (isinstance(s["press"], int) and s["press"] > 0):
                raise ScriptError(f"{where}: press takes a number of cues")
            if k in ("idle", "sleep") and not isinstance(s[k], (int, float)):
                raise ScriptError(f"{where}: {k} takes seconds")


def check_script(doc: dict[str, Any], secrets: Secrets, facts: Facts | None = None) -> list[str]:
    """What in a committed script would leak: an answer word, a `never` word,
    or an authored wrong answer that is in fact right. [] = clean."""
    problems = []
    words = scoring_answer_words(secrets)
    head = {"about": doc.get("about"), "guests": " · ".join(doc.get("guests") or [])}
    for key, text in head.items():
        if isinstance(text, str) and (word_hits(text, words) or secrets.leaks(text) or (facts is not None and facts.question_of(text) is not None)):
            problems.append(f"the script's {key} carries an answer or never word")
    for i, s in enumerate(_steps(doc)):
        for key in ("say", "answer", "share", "unlock", "reason"):
            text = s.get(key)
            if not isinstance(text, str):
                continue
            # Named by step and field only: a problem line never repeats the text.
            bare = PLACEHOLDER.sub(" ", text)
            hits = word_hits(bare, words)
            if hits:
                problems.append(f"step {i} {key}: carries {len(hits)} answer word(s)")
            if secrets.leaks(bare):
                problems.append(f"step {i} {key}: carries a never word")
            if facts is not None and facts.question_of(bare) is not None:
                problems.append(f"step {i} {key}: names a hunt answer")
    return problems


def chain_cues(worktree: Path = WORKTREE) -> list[str]:
    """`TO_Y2K` from scripts/accept/chains.ts (the cue sheet's order), read
    from the worktree under test so the harness follows the story."""
    src = (worktree / "scripts" / "accept" / "chains.ts").read_text(encoding="utf-8")

    def arr(name: str) -> list[str]:
        m = re.search(rf"export const {name}: readonly string\[\] = \[(.*?)\];", src, re.S)
        if m is None:
            raise ScriptError(f"chains.ts has no {name}")
        body = m.group(1)
        out: list[str] = []
        for item in re.finditer(r"\.\.\.([A-Z_0-9]+)|\"([^\"]+)\"", body):
            out.extend(arr(item.group(1)) if item.group(1) else [item.group(2)])
        return out

    return arr("TO_Y2K")


def self_pressed(worktree: Path = WORKTREE) -> set[str]:
    src = (worktree / "scripts" / "accept" / "chains.ts").read_text(encoding="utf-8")
    m = re.search(r"SELF_PRESSED[^=]*= new Set\(\[(.*?)\]\)", src, re.S)
    return set(re.findall(r"\"([^\"]+)\"", m.group(1))) if m else set()


#: After the Y2K hour: midnight, the bob, the bag (a guest, by Clippy), truth.txt, ⚖.
FINALE: tuple[dict[str, Any], ...] = (
    {"name": "y2k_midnight"},
    {"name": "bobbing_for_truth"},
    {"name": "brought_up_the_bag", "subject": "$first", "actor": "Clippy"},
    {"name": "read_truth_txt"},
    {"name": "the_verdict"},
)


def hold_lines(worktree: Path = WORKTREE) -> tuple[str, ...]:
    """Trabolta's `hold:` / `busy:` lines (C1.1 b): server words, never his."""
    path = worktree / "core" / "examples" / "trapped-in-the-internet" / "cast" / "trabolta.loom"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return ()
    return tuple(m.group(1).strip() for m in re.finditer(r"^\s*(?:hold|busy):\s*(.+?)\s*$", text, re.M))


def main_checkout(worktree: Path = WORKTREE) -> Path:
    """The repository's main checkout (where the user's rig keeps its minds)."""
    try:
        out = subprocess.run(
            ["git", "-C", str(worktree), "rev-parse", "--path-format=absolute", "--git-common-dir"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return Path(out).parent
    except (OSError, subprocess.CalledProcessError):
        return worktree


# -- extract ------------------------------------------------------------------------------


_PHASE_LINE = re.compile(r"^Night\.phase: (.*)$", re.M)


_VARS_LINE = re.compile(r"^Your variables: (.*)$", re.M)
_VAR_PART = re.compile(r"([\w.]+)=([^,(]*?)\s*(?:\((-?[\d.]+)\.\.(-?[\d.]+)\))?\s*(?:,|$)")
_WORLD_LINE = re.compile(r"^(Night\.[\w.]+): (.*)$", re.M)
_THEIR_LINE = re.compile(r"^Their ([\w]+): (.*)$", re.M)
_WHERE_LINE = re.compile(r"^Where they are: (.*)$", re.M)


def recorded_state(system_prompt: str) -> dict[str, Any]:
    """The state a recorded voice prompt showed him (its LIVE STATE block):
    `self` vars + ranges, the `Night.*` world lines, the speaker's `Their …`
    vars and where they stood. Offline replays build a request from it, so
    the persona's gate and situations read the night as it was. Never
    written to a script or a report."""
    self_vars: dict[str, Any] = {}
    ranges: dict[str, list[float]] = {}
    m = _VARS_LINE.findall(system_prompt)
    if m:
        for name, value, lo, hi in _VAR_PART.findall(m[-1]):
            self_vars[name] = value.strip()
            if lo and hi:
                ranges[name] = [float(lo) if "." in lo else int(lo), float(hi) if "." in hi else int(hi)]
    world = {path: value.strip() for path, value in _WORLD_LINE.findall(system_prompt)}
    them = {key: value.strip() for key, value in _THEIR_LINE.findall(system_prompt)}
    where = _WHERE_LINE.findall(system_prompt)
    return {"self": self_vars, "ranges": ranges, "world": world, "them": them, "location": where[-1].strip() if where else None}


def _last_user(messages: list[dict[str, Any]]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            return str(m.get("content", ""))
    return ""


def extract(trace_lines: list[dict[str, Any]], secrets: Secrets, facts: Facts, name: str = "", source: str = "", *, state: bool = False) -> dict[str, Any]:
    """A recorded trace → a script of its guest lines. Kept per line: the
    speaker, the text (the request's newest user turn) and `Night.phase`
    read from the prompt's state block. Never kept: his replies, the judge's
    thoughts, any prompt. A line that names a hunt answer becomes
    `{answer:<Q>}` (or `(a hunt answer)` when the question can't be told).

    `state=True` (offline only, never a committed script) also keeps each
    line's `recorded_state` under `"state"`."""
    guests: list[str] = []
    steps: list[dict[str, Any]] = []
    seen: set[str] = set()
    phase = None
    for t in trace_lines:
        if not isinstance(t, dict) or t.get("kind") != "voice" or t.get("trigger") not in ("line", None, ""):
            continue
        rid = str(t.get("request_id") or t.get("id"))
        if rid in seen:
            continue
        seen.add(rid)
        speaker = t.get("speaker") or {}
        who = str(speaker.get("name") or speaker.get("id") or "")
        if not who or speaker.get("kind") not in (None, "guest"):
            continue
        messages = t.get("messages") or []
        text = " ".join(_last_user(messages).split())
        if not text:
            continue
        sys0 = str(messages[0].get("content", "")) if messages else ""
        m = _PHASE_LINE.findall(sys0)
        line_phase = m[-1].strip() if m else None
        if line_phase and line_phase != phase:
            steps.append({"phase": line_phase})
            phase = line_phase
        hit = word_hits(text, tuple(secrets.match)) or (facts.question_of(text) is not None)
        if hit:
            qid = facts.question_of(text)
            text = f"{{answer:{qid}}}" if qid else "(a hunt answer)"
        if who not in guests:
            guests.append(who)
        step: dict[str, Any] = {"say": text, "as": who}
        if state:
            step["state"] = recorded_state(sys0)
        steps.append(step)
    return {"name": name, "about": f"Extracted from {source or 'a trace'}: the guest lines only (speaker, text, Night.phase).", "guests": guests, "clear": True, "steps": steps}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    out = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                doc = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(doc, dict):
                out.append(doc)
    return out
