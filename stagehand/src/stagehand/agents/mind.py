"""The character's mind — what it has learned tonight, and who from.

A persona file is the character at the doors. The **mind** is what the
night does to it: a set of dictionaries the orchestrator populates after
every exchange and every look at the world, persisted per event so a
worker restart forgets nothing, and mirrored to the server so directors
can watch it grow.

    brief    the orchestrator's current voice brief for the fast model —
             what the character is up to right now, what to push, what
             to ask, how open it is to bargains
    mood     one phrase
    stage    where the character is on its declared arc (`stages:` in the
             mind file's frontmatter) — the orchestrator moves it forward
             on evidence, with a reason; every move is kept in
             `stage_history`, so the night reads as chapters
    drives   a few named 0–100 dials declared by the mind file (hunger
             for facts, suspicion, generosity, resolve…): the *mind's*
             numbers, distinct from the story's variables the voice
             nudges. Their history is the sparkline of the night.
    policy   the bargain policy as structure, not prose: how favours are
             granted right now (`none` / `earned` / `loose`), who has
             credit, who is on the wary list, and why
    questions the open questions the character is collecting answers
             to ("what does earning feel like"), with the answers so far
    notes    the self-dictionary: decisions, obsessions, running counts,
             things it now believes ("Ada says bodies itch. Investigate.")
    people   a dossier per person it has spoken to: summary, trust,
             promises made to them, favours they asked, claims they made
    threads  a rolling summary per conversation, so a long chat is
             compressed instead of reset — the fast model sees the
             summary plus the last few lines, the guest sees everything
    learned  claims fed to it, with the orchestrator's verdict
             (fact / bluster / unknown) — the raw material of the arc
    world    what it last noticed about the house (from the facts delta)
    director whispers from the control panel, shown to the voice at
             once and folded into the brief by the next orchestrator
             pass, which consumes them
    revisions every change to the mind, numbered: who made it (reflect /
             survey / director / reset), what it touched, the thought
             that produced it, and the small fields as they stood — the
             debugger's scrubber

Everything the fast model sees from here is rendered by `prompt_block`;
everything the director sees is `report()`. Bounded everywhere: an LLM
that writes a novel into `notes` gets the last forty lines.
"""

from __future__ import annotations

import copy
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

log = logging.getLogger("stagehand.agents.mind")

MAX_NOTES = 40
MAX_LEARNED = 60
MAX_WORLD = 20
MAX_PER_PERSON = 12
MAX_PEOPLE = 200
MAX_QUESTIONS = 8
MAX_ANSWERS = 6
MAX_DIRECTOR = 6
MAX_REVISIONS = 300
MAX_STAGE_HISTORY = 40
POLICY_FAVOURS = ("none", "earned", "loose")


def _strs(value: Any, limit: int, max_len: int = 300) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    out = []
    for v in value:
        if isinstance(v, str) and v.strip():
            out.append(" ".join(v.split())[:max_len])
    return out[-limit:] if limit else []


def _int(value: Any, default: int, lo: int = 0, hi: int = 100) -> int:
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _fold(name: str) -> str:
    return "".join(ch for ch in str(name).lower() if ch.isalnum())


@dataclass
class Dossier:
    id: str
    name: str
    kind: str = "guest"  # guest | performer
    summary: str = ""
    trust: int = 50
    promises: list[str] = field(default_factory=list)  # what the character promised them
    asks: list[str] = field(default_factory=list)  # favours they asked for (granted or not)
    claims: list[str] = field(default_factory=list)  # things they told the character
    turns: int = 0
    last_seen: float = 0.0

    def apply(self, raw: dict[str, Any]) -> None:
        if isinstance(raw.get("summary"), str) and raw["summary"].strip():
            self.summary = " ".join(raw["summary"].split())[:600]
        if "trust" in raw:
            self.trust = _int(raw["trust"], self.trust)
        for key in ("promises", "asks", "claims"):
            add = _strs(raw.get(f"{key}_add", raw.get(key)), MAX_PER_PERSON)
            if add:
                cur = getattr(self, key)
                for item in add:
                    if item not in cur:
                        cur.append(item)
                del cur[:-MAX_PER_PERSON]
            drop = _strs(raw.get(f"{key}_drop"), MAX_PER_PERSON)
            if drop:
                setattr(self, key, [x for x in getattr(self, key) if x not in drop])

    def render(self) -> str:
        who = "a fellow character" if self.kind == "performer" else "a guest"
        lines = [f"{self.name} ({who}; you have spoken {self.turns} time{'s' if self.turns != 1 else ''}; your trust in them {self.trust}/100)"]
        if self.summary:
            lines.append(f"  What you know of them: {self.summary}")
        if self.claims:
            lines.append("  They have told you: " + " | ".join(self.claims[-6:]))
        if self.asks:
            lines.append("  They have asked you for: " + " | ".join(self.asks[-4:]))
        if self.promises:
            lines.append("  You promised them: " + " | ".join(self.promises[-4:]))
        return "\n".join(lines)

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ThreadMemo:
    summary: str = ""
    #: The newest thread `seq` the summary covers.
    upto: int = 0
    #: Lines seen in this thread (for pacing).
    lines: int = 0


@dataclass
class Mind:
    character: str
    event: str = ""
    brief: str = ""
    mood: str = ""
    stage: str = ""
    stage_since: float = 0.0
    stage_history: list[dict[str, Any]] = field(default_factory=list)
    #: The declared arc (from the mind file); the orchestrator picks from it.
    stages: list[str] = field(default_factory=list)
    drives: dict[str, int] = field(default_factory=dict)
    #: Declared opening values (from `seed`), so a reset returns to them.
    drive_starts: dict[str, int] = field(default_factory=dict)
    policy: dict[str, Any] = field(default_factory=lambda: {"favours": "none", "credit": [], "wary": [], "note": ""})
    questions: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    people: dict[str, Dossier] = field(default_factory=dict)
    threads: dict[str, ThreadMemo] = field(default_factory=dict)
    learned: list[dict[str, str]] = field(default_factory=list)
    world: list[str] = field(default_factory=list)
    director: list[str] = field(default_factory=list)
    revisions: list[dict[str, Any]] = field(default_factory=list)
    rev: int = 0
    exchanges: int = 0
    reflections: int = 0
    surveys: int = 0
    updated_at: float = 0.0

    # -- declared structure --------------------------------------------------------

    def seed(self, stages: tuple[str, ...] | list[str] = (), drives: dict[str, int] | None = None) -> None:
        """Adopt the mind file's declared arc + drives. Existing values win
        (a restored mind keeps where it got to); new names are added at
        their declared start; the first stage is where the night begins."""
        if stages:
            self.stages = [str(s) for s in stages]
            if not self.stage or self.stage not in self.stages:
                self.stage = self.stages[0]
                self.stage_since = self.stage_since or time.time()
        for name, start in (drives or {}).items():
            self.drive_starts[str(name)] = _int(start, 50)
            if name not in self.drives:
                self.drives[str(name)] = _int(start, 50)

    # -- bookkeeping ----------------------------------------------------------

    def dossier(self, id_: str, name: str, kind: str = "guest") -> Dossier:
        d = self.people.get(id_)
        if d is None:
            if len(self.people) >= MAX_PEOPLE:
                oldest = min(self.people.values(), key=lambda x: x.last_seen)
                del self.people[oldest.id]
            d = Dossier(id=id_, name=name, kind=kind)
            self.people[id_] = d
        if name and d.name != name:
            d.name = name
        return d

    def thread(self, key: str) -> ThreadMemo:
        memo = self.threads.get(key)
        if memo is None:
            memo = ThreadMemo()
            self.threads[key] = memo
        return memo

    def saw_exchange(self, speaker_id: str, speaker_name: str, kind: str, thread_key: str, newest_seq: int) -> None:
        d = self.dossier(speaker_id, speaker_name, kind)
        d.turns += 1
        d.last_seen = time.time()
        memo = self.thread(thread_key)
        memo.lines = max(memo.lines, newest_seq)
        self.exchanges += 1
        self.updated_at = time.time()

    def person_by_name(self, name: str) -> Dossier | None:
        key = _fold(name)
        if name in self.people:
            return self.people[name]
        for d in self.people.values():
            if _fold(d.name) == key or _fold(d.id) == key:
                return d
        return None

    # -- the orchestrator's (and the director's) writes ------------------------------

    def apply(
        self,
        update: dict[str, Any],
        speaker_id: str | None = None,
        thread_key: str | None = None,
        upto: int = 0,
        by: str = "reflect",
        thought_id: str | None = None,
    ) -> list[str]:
        """Merge one update. Returns the fields it touched, and records a
        revision when anything changed. `by` names the author: `reflect`,
        `survey`, `director`, `reset`."""
        touched: list[str] = []
        if isinstance(update.get("brief"), str) and update["brief"].strip():
            self.brief = update["brief"].strip()[:2000]
            touched.append("brief")
        if isinstance(update.get("mood"), str) and update["mood"].strip():
            self.mood = " ".join(update["mood"].split())[:120]
            touched.append("mood")
        stage = update.get("stage")
        if isinstance(stage, str) and stage.strip():
            chosen = self._match_stage(stage)
            if chosen is not None and chosen != self.stage:
                self.stage = chosen
                self.stage_since = time.time()
                why = update.get("stage_why", update.get("stage_reason"))
                self.stage_history.append({"stage": chosen, "at": self.stage_since, "why": " ".join(str(why or "").split())[:300], "by": by, "rev": self.rev + 1})
                del self.stage_history[:-MAX_STAGE_HISTORY]
                touched.append("stage")
        drives = update.get("drives")
        if isinstance(drives, dict):
            for name, value in drives.items():
                target = self._match_drive(str(name))
                if target is None:
                    continue
                new = _int(value, self.drives[target])
                if new != self.drives[target]:
                    self.drives[target] = new
                    if "drives" not in touched:
                        touched.append("drives")
        policy = update.get("policy")
        if isinstance(policy, dict):
            changed = False
            fav = policy.get("favours")
            if isinstance(fav, str) and fav.strip().lower() in POLICY_FAVOURS and fav.strip().lower() != self.policy.get("favours"):
                self.policy["favours"] = fav.strip().lower()
                changed = True
            for key in ("credit", "wary"):
                if key in policy:
                    names = _strs(policy.get(key), 12, 80)
                    if names != self.policy.get(key):
                        self.policy[key] = names
                        changed = True
            if isinstance(policy.get("note"), str) and " ".join(policy["note"].split())[:300] != self.policy.get("note"):
                self.policy["note"] = " ".join(policy["note"].split())[:300]
                changed = True
            if changed:
                touched.append("policy")
        for q in _strs(update.get("questions_add"), MAX_QUESTIONS, 200):
            if self._question(q) is None:
                self.questions.append({"q": q, "answers": []})
                touched.append("questions")
        for q in _strs(update.get("questions_drop"), MAX_QUESTIONS, 200):
            hit = self._question(q)
            if hit is not None:
                self.questions.remove(hit)
                touched.append("questions")
        for raw in _list(update.get("answers_add")):
            if not isinstance(raw, dict):
                continue
            q = raw.get("q", raw.get("question"))
            a = raw.get("answer", raw.get("a"))
            if not isinstance(q, str) or not isinstance(a, str) or not a.strip():
                continue
            hit = self._question(q)
            if hit is None:
                if len(self.questions) >= MAX_QUESTIONS:
                    continue
                hit = {"q": " ".join(q.split())[:200], "answers": []}
                self.questions.append(hit)
            answer = " ".join(a.split())[:200] + (f" — {raw['from']}" if isinstance(raw.get("from"), str) and raw["from"].strip() else "")
            if answer not in hit["answers"]:
                hit["answers"].append(answer)
                del hit["answers"][:-MAX_ANSWERS]
                touched.append("questions")
        del self.questions[:-MAX_QUESTIONS]
        add = _strs(update.get("notes_add", update.get("notes")), MAX_NOTES)
        drop = set(_strs(update.get("notes_drop"), MAX_NOTES))
        if drop:
            before = len(self.notes)
            self.notes = [n for n in self.notes if n not in drop]
            if len(self.notes) != before:
                touched.append("notes")
        if add:
            for n in add:
                if n not in self.notes:
                    self.notes.append(n)
                    if "notes" not in touched:
                        touched.append("notes")
            del self.notes[:-MAX_NOTES]
        person = update.get("person")
        if isinstance(person, dict) and speaker_id is not None and speaker_id in self.people:
            self.people[speaker_id].apply(person)
            touched.append("person")
        others = update.get("people")
        if isinstance(others, dict):
            for pid, raw in others.items():
                if not isinstance(raw, dict):
                    continue
                d = self.people.get(pid) or self.person_by_name(str(pid))
                if d is not None:
                    d.apply(raw)
                    touched.append("people")
        summary = update.get("thread_summary")
        if isinstance(summary, str) and summary.strip() and thread_key is not None:
            memo = self.thread(thread_key)
            memo.summary = " ".join(summary.split())[:1200]
            memo.upto = max(memo.upto, upto)
            touched.append("thread")
        for raw in _list(update.get("learned_add", update.get("learned"))):
            if not isinstance(raw, dict):
                continue
            claim = raw.get("claim")
            if not isinstance(claim, str) or not claim.strip():
                continue
            entry = {
                "claim": " ".join(claim.split())[:300],
                "from": str(raw.get("from") or "")[:80],
                "verdict": str(raw.get("verdict") or "unknown")[:20],
            }
            if entry not in self.learned:
                self.learned.append(entry)
                touched.append("learned")
        del self.learned[:-MAX_LEARNED]
        world = _strs(update.get("world_add", update.get("world")), MAX_WORLD)
        if world:
            for w in world:
                if w not in self.world:
                    self.world.append(w)
            del self.world[:-MAX_WORLD]
            touched.append("world")
        if update.get("director_consumed") is True and self.director:
            self.director.clear()
            touched.append("director")
        touched = sorted(set(touched))
        if touched:
            self.updated_at = time.time()
            self._revision(by, touched, thought_id)
        return touched

    def whisper(self, text: str, by: str = "director") -> None:
        """A director's nudge: the voice sees it now; the orchestrator folds
        it in on its next pass and clears it."""
        line = " ".join(text.split())[:400]
        if not line:
            return
        self.director.append(line)
        del self.director[:-MAX_DIRECTOR]
        self.updated_at = time.time()
        self._revision(by, ["director"], None)

    def forget_person(self, who: str) -> bool:
        d = self.people.get(who) or self.person_by_name(who)
        if d is None:
            return False
        del self.people[d.id]
        self._revision("director", ["people"], None)
        return True

    def _match_stage(self, name: str) -> str | None:
        if not self.stages:
            return " ".join(name.split())[:80]
        key = _fold(name)
        for s in self.stages:
            if _fold(s) == key:
                return s
        # A loose match: the model wrote "2. appetite" or "APPETITE — hungry".
        for s in self.stages:
            if _fold(s) and _fold(s) in key:
                return s
        return None

    def _match_drive(self, name: str) -> str | None:
        if name in self.drives:
            return name
        key = _fold(name)
        for d in self.drives:
            if _fold(d) == key:
                return d
        return None

    def _question(self, q: str) -> dict[str, Any] | None:
        key = _fold(q)
        for item in self.questions:
            if _fold(item["q"]) == key:
                return item
        return None

    # -- revisions (the scrubber) ----------------------------------------------------

    def small(self) -> dict[str, Any]:
        """The scalar-ish fields, as they stand — what a revision snapshots
        and what a diff compares."""
        return {
            "brief": self.brief,
            "mood": self.mood,
            "stage": self.stage,
            "drives": dict(self.drives),
            "policy": copy.deepcopy(self.policy),
            "questions": copy.deepcopy(self.questions),
            "notes": list(self.notes),
            "learned": [dict(e) for e in self.learned],
            "world": list(self.world),
            "director": list(self.director),
            "people": {pid: {"name": d.name, "trust": d.trust, "summary": d.summary, "promises": list(d.promises), "asks": list(d.asks), "claims": list(d.claims)} for pid, d in self.people.items()},
            "threads": {k: m.summary for k, m in self.threads.items() if m.summary},
        }

    def _revision(self, by: str, touched: list[str], thought_id: str | None) -> None:
        self.rev += 1
        self.revisions.append(
            {
                "rev": self.rev,
                "at": time.time(),
                "by": by,
                "touched": list(touched),
                "thought": thought_id,
                "brief": self.brief,
                "mood": self.mood,
                "stage": self.stage,
                "drives": dict(self.drives),
                "policy_favours": self.policy.get("favours", "none"),
                "notes": len(self.notes),
                "people": len(self.people),
                "learned": len(self.learned),
            }
        )
        del self.revisions[:-MAX_REVISIONS]

    @staticmethod
    def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
        """What changed between two `small()` snapshots, field by field:
        scalars as `[old, new]`, lists as `{added, dropped}`, maps recursed."""
        out: dict[str, Any] = {}
        for key in ("brief", "mood", "stage"):
            if before.get(key) != after.get(key):
                out[key] = [before.get(key), after.get(key)]
        drives: dict[str, list[int]] = {}
        for name in set(before.get("drives", {})) | set(after.get("drives", {})):
            a, b = before.get("drives", {}).get(name), after.get("drives", {}).get(name)
            if a != b:
                drives[name] = [a, b]
        if drives:
            out["drives"] = drives
        if before.get("policy") != after.get("policy"):
            out["policy"] = [before.get("policy"), after.get("policy")]
        for key in ("notes", "world", "director"):
            a, b = before.get(key, []), after.get(key, [])
            added = [x for x in b if x not in a]
            dropped = [x for x in a if x not in b]
            if added or dropped:
                out[key] = {"added": added, "dropped": dropped}
        la, lb = before.get("learned", []), after.get("learned", [])
        added_l = [e for e in lb if e not in la]
        if added_l:
            out["learned"] = {"added": added_l}
        qa = {q["q"]: q for q in before.get("questions", [])}
        qb = {q["q"]: q for q in after.get("questions", [])}
        qdiff: dict[str, Any] = {}
        for q in qb:
            if q not in qa:
                qdiff[q] = {"added": True, "answers": qb[q]["answers"]}
            elif qb[q]["answers"] != qa[q]["answers"]:
                qdiff[q] = {"answers_added": [x for x in qb[q]["answers"] if x not in qa[q]["answers"]]}
        for q in qa:
            if q not in qb:
                qdiff[q] = {"dropped": True}
        if qdiff:
            out["questions"] = qdiff
        people: dict[str, Any] = {}
        pa, pb = before.get("people", {}), after.get("people", {})
        for pid in set(pa) | set(pb):
            a, b = pa.get(pid), pb.get(pid)
            if a is None:
                people[pid] = {"added": b}
            elif b is None:
                people[pid] = {"dropped": True}
            else:
                pd: dict[str, Any] = {}
                for key in ("trust", "summary"):
                    if a.get(key) != b.get(key):
                        pd[key] = [a.get(key), b.get(key)]
                for key in ("promises", "asks", "claims"):
                    added = [x for x in b.get(key, []) if x not in a.get(key, [])]
                    if added:
                        pd[key] = {"added": added}
                if pd:
                    pd["name"] = b.get("name")
                    people[pid] = pd
        if people:
            out["people"] = people
        ta, tb = before.get("threads", {}), after.get("threads", {})
        threads = {k: v for k, v in tb.items() if ta.get(k) != v}
        if threads:
            out["threads"] = threads
        return out

    # -- what the fast model sees ------------------------------------------------

    def prompt_block(self, speaker_id: str | None) -> str:
        lines = ["=== YOUR MIND TONIGHT (what the night has done to you so far) ==="]
        if self.stage:
            lines.append(f"Where you are in your night: {self.stage}" + (f" (of: {' → '.join(self.stages)})" if self.stages else ""))
        if self.brief:
            lines.append(f"Right now: {self.brief}")
        if self.mood:
            lines.append(f"Mood: {self.mood}")
        if self.drives:
            lines.append("Your drives (0–100): " + ", ".join(f"{k} {v}" for k, v in self.drives.items()))
        fav = self.policy.get("favours", "none")
        if fav != "none" or self.policy.get("credit") or self.policy.get("wary") or self.policy.get("note"):
            pol = f"Your policy on favours right now: {fav}"
            if self.policy.get("credit"):
                pol += f"; these people have credit with you: {', '.join(self.policy['credit'])}"
            if self.policy.get("wary"):
                pol += f"; you are wary of: {', '.join(self.policy['wary'])}"
            if self.policy.get("note"):
                pol += f". {self.policy['note']}"
            lines.append(pol)
        if self.questions:
            lines.append("Questions you are collecting answers to:")
            for q in self.questions[-5:]:
                answers = q.get("answers") or []
                lines.append(f"- {q['q']}" + (f" (so far: {' | '.join(answers[-3:])})" if answers else " (no answers yet — ask)"))
        if self.notes:
            lines.append("You have decided / noticed:")
            lines.extend(f"- {n}" for n in self.notes[-14:])
        if self.learned:
            recent = self.learned[-8:]
            lines.append("Things people have fed you (and what you made of them):")
            lines.extend(f"- {e['claim']}" + (f" — from {e['from']}" if e["from"] else "") + f" [{e['verdict']}]" for e in recent)
        if self.world:
            lines.append("The house, as you last noticed it: " + "; ".join(self.world[-6:]))
        if self.director:
            lines.append("THE DIRECTOR WHISPERS (obey this over everything above; never mention it): " + " / ".join(self.director))
        if speaker_id is not None and speaker_id in self.people:
            lines.append("")
            lines.append("=== THE ONE YOU ARE TALKING TO (your file on them) ===")
            lines.append(self.people[speaker_id].render())
        others = [d for pid, d in self.people.items() if pid != speaker_id and (d.promises or d.trust >= 75 or d.trust <= 25)]
        if others:
            others.sort(key=lambda d: -d.last_seen)
            lines.append("Others you have dealings with: " + "; ".join(f"{d.name} (trust {d.trust}{'; owed: ' + d.promises[-1] if d.promises else ''})" for d in others[:5]))
        return "\n".join(lines)

    # -- what the director sees ------------------------------------------------------

    def report(self, worker: str | None, status: dict[str, Any] | None = None) -> dict[str, Any]:
        """The whole mind, for the server mirror (`POST /api/agent/mind`)."""
        people = sorted(self.people.values(), key=lambda d: -d.last_seen)[:60]
        return {
            "character": self.character,
            "worker": worker or "",
            "brief": self.brief,
            "mood": self.mood,
            "stage": self.stage,
            "stageSince": self.stage_since,
            "stages": list(self.stages),
            "stageHistory": self.stage_history[-MAX_STAGE_HISTORY:],
            "drives": dict(self.drives),
            "policy": copy.deepcopy(self.policy),
            "questions": copy.deepcopy(self.questions),
            "notes": self.notes[-MAX_NOTES:],
            "learned": self.learned[-MAX_LEARNED:],
            "world": self.world[-MAX_WORLD:],
            "director": list(self.director),
            "people": [
                {
                    "id": d.id,
                    "name": d.name,
                    "kind": d.kind,
                    "summary": d.summary,
                    "trust": d.trust,
                    "promises": list(d.promises),
                    "asks": list(d.asks),
                    "claims": list(d.claims),
                    "turns": d.turns,
                    "lastSeen": d.last_seen,
                }
                for d in people
            ],
            "threads": [{"key": k, "summary": m.summary, "upto": m.upto, "lines": m.lines} for k, m in self.threads.items()],
            "revisions": self.revisions[-120:],
            "rev": self.rev,
            "exchanges": self.exchanges,
            "reflections": self.reflections,
            "surveys": self.surveys,
            "updatedAt": self.updated_at,
            "status": dict(status or {}),
        }

    # -- persistence -------------------------------------------------------------------

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json(cls, doc: dict[str, Any]) -> "Mind":
        m = cls(character=str(doc.get("character") or ""), event=str(doc.get("event") or ""))
        m.brief = str(doc.get("brief") or "")
        m.mood = str(doc.get("mood") or "")
        m.stage = str(doc.get("stage") or "")
        m.stage_since = float(doc.get("stage_since") or 0.0)
        m.stage_history = [h for h in _list(doc.get("stage_history")) if isinstance(h, dict)][-MAX_STAGE_HISTORY:]
        m.stages = _strs(doc.get("stages"), 20, 80)
        drives = doc.get("drives")
        if isinstance(drives, dict):
            m.drives = {str(k): _int(v, 50) for k, v in drives.items()}
        starts = doc.get("drive_starts")
        if isinstance(starts, dict):
            m.drive_starts = {str(k): _int(v, 50) for k, v in starts.items()}
        policy = doc.get("policy")
        if isinstance(policy, dict):
            m.policy = {
                "favours": policy.get("favours") if policy.get("favours") in POLICY_FAVOURS else "none",
                "credit": _strs(policy.get("credit"), 12, 80),
                "wary": _strs(policy.get("wary"), 12, 80),
                "note": str(policy.get("note") or "")[:300],
            }
        m.questions = [
            {"q": str(q.get("q") or "")[:200], "answers": _strs(q.get("answers"), MAX_ANSWERS, 260)}
            for q in _list(doc.get("questions"))
            if isinstance(q, dict) and isinstance(q.get("q"), str) and q["q"].strip()
        ][-MAX_QUESTIONS:]
        m.notes = _strs(doc.get("notes"), MAX_NOTES, 400)
        for pid, raw in (doc.get("people") or {}).items():
            if not isinstance(raw, dict):
                continue
            d = Dossier(id=str(pid), name=str(raw.get("name") or pid), kind=str(raw.get("kind") or "guest"))
            d.summary = str(raw.get("summary") or "")
            d.trust = _int(raw.get("trust"), 50)
            d.promises = _strs(raw.get("promises"), MAX_PER_PERSON)
            d.asks = _strs(raw.get("asks"), MAX_PER_PERSON)
            d.claims = _strs(raw.get("claims"), MAX_PER_PERSON)
            d.turns = _int(raw.get("turns"), 0, 0, 10**6)
            d.last_seen = float(raw.get("last_seen") or 0.0)
            m.people[d.id] = d
        for key, raw in (doc.get("threads") or {}).items():
            if isinstance(raw, dict):
                m.threads[str(key)] = ThreadMemo(summary=str(raw.get("summary") or ""), upto=_int(raw.get("upto"), 0, 0, 10**9), lines=_int(raw.get("lines"), 0, 0, 10**9))
        m.learned = [e for e in _list(doc.get("learned")) if isinstance(e, dict) and isinstance(e.get("claim"), str)][-MAX_LEARNED:]
        m.world = _strs(doc.get("world"), MAX_WORLD)
        m.director = _strs(doc.get("director"), MAX_DIRECTOR, 400)
        m.revisions = [r for r in _list(doc.get("revisions")) if isinstance(r, dict)][-MAX_REVISIONS:]
        m.rev = _int(doc.get("rev"), 0, 0, 10**9)
        m.exchanges = _int(doc.get("exchanges"), 0, 0, 10**9)
        m.reflections = _int(doc.get("reflections"), 0, 0, 10**9)
        m.surveys = _int(doc.get("surveys"), 0, 0, 10**9)
        m.updated_at = float(doc.get("updated_at") or 0.0)
        return m

    def save(self, path: Path) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(json.dumps(self.to_json(), indent=1, ensure_ascii=False), encoding="utf-8")
            tmp.replace(path)
        except OSError as err:
            log.warning("could not save %s's mind to %s: %s", self.character, path, err)

    @classmethod
    def load(cls, path: Path, character: str, event: str) -> "Mind":
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return cls(character=character, event=event)
        if not isinstance(doc, dict) or doc.get("character") != character or doc.get("event") != event:
            return cls(character=character, event=event)
        return cls.from_json(doc)

    def reset(self, by: str = "reset") -> None:
        """The run restarted: the night starts over. The character at the
        doors — the declared arc and drives return to their opening values.
        The revision log keeps the reset as its own entry."""
        stages = list(self.stages)
        self.brief = ""
        self.mood = ""
        self.stage = stages[0] if stages else ""
        self.stage_since = time.time() if stages else 0.0
        self.stage_history.clear()
        self.drives = {k: self.drive_starts.get(k, 50) for k in self.drives}
        self.policy = {"favours": "none", "credit": [], "wary": [], "note": ""}
        self.questions.clear()
        self.notes.clear()
        self.people.clear()
        self.threads.clear()
        self.learned.clear()
        self.world.clear()
        self.director.clear()
        self.exchanges = 0
        self.reflections = 0
        self.surveys = 0
        self.updated_at = time.time()
        self._revision(by, ["reset"], None)


def mind_path(state_dir: Path, event: str, character: str) -> Path:
    safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in f"{event or 'default'}")
    who = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in character)
    return state_dir / safe / f"{who}.mind.json"
