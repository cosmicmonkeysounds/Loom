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

Everything the fast model sees from here is rendered by `prompt_block`;
everything the director sees is `report()`. Bounded everywhere: an LLM
that writes a novel into `notes` gets the last forty lines.
"""

from __future__ import annotations

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
    notes: list[str] = field(default_factory=list)
    people: dict[str, Dossier] = field(default_factory=dict)
    threads: dict[str, ThreadMemo] = field(default_factory=dict)
    learned: list[dict[str, str]] = field(default_factory=list)
    world: list[str] = field(default_factory=list)
    exchanges: int = 0
    reflections: int = 0
    surveys: int = 0
    updated_at: float = 0.0

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

    # -- the orchestrator's writes ----------------------------------------------

    def apply(self, update: dict[str, Any], speaker_id: str | None = None, thread_key: str | None = None, upto: int = 0) -> list[str]:
        """Merge one orchestrator update. Returns the fields it touched."""
        touched: list[str] = []
        if isinstance(update.get("brief"), str) and update["brief"].strip():
            self.brief = update["brief"].strip()[:2000]
            touched.append("brief")
        if isinstance(update.get("mood"), str) and update["mood"].strip():
            self.mood = " ".join(update["mood"].split())[:120]
            touched.append("mood")
        add = _strs(update.get("notes_add", update.get("notes")), MAX_NOTES)
        drop = set(_strs(update.get("notes_drop"), MAX_NOTES))
        if drop:
            self.notes = [n for n in self.notes if n not in drop]
            touched.append("notes")
        if add:
            for n in add:
                if n not in self.notes:
                    self.notes.append(n)
            del self.notes[:-MAX_NOTES]
            touched.append("notes")
        person = update.get("person")
        if isinstance(person, dict) and speaker_id is not None and speaker_id in self.people:
            self.people[speaker_id].apply(person)
            touched.append("person")
        others = update.get("people")
        if isinstance(others, dict):
            for pid, raw in others.items():
                if isinstance(raw, dict) and pid in self.people:
                    self.people[pid].apply(raw)
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
        if touched:
            self.updated_at = time.time()
        return sorted(set(touched))

    # -- what the fast model sees ------------------------------------------------

    def prompt_block(self, speaker_id: str | None) -> str:
        lines = ["=== YOUR MIND TONIGHT (what the night has done to you so far) ==="]
        if self.brief:
            lines.append(f"Right now: {self.brief}")
        if self.mood:
            lines.append(f"Mood: {self.mood}")
        if self.notes:
            lines.append("You have decided / noticed:")
            lines.extend(f"- {n}" for n in self.notes[-14:])
        if self.learned:
            recent = self.learned[-8:]
            lines.append("Things people have fed you (and what you made of them):")
            lines.extend(f"- {e['claim']}" + (f" — from {e['from']}" if e["from"] else "") + f" [{e['verdict']}]" for e in recent)
        if self.world:
            lines.append("The house, as you last noticed it: " + "; ".join(self.world[-6:]))
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

    def report(self, worker: str | None) -> dict[str, Any]:
        people = sorted(self.people.values(), key=lambda d: -d.last_seen)[:60]
        return {
            "character": self.character,
            "worker": worker or "",
            "brief": self.brief,
            "mood": self.mood,
            "notes": self.notes[-30:] + [f"[learned] {e['claim']} ({e['verdict']})" for e in self.learned[-10:]],
            "people": [{"id": d.id, "name": d.name, "summary": d.summary, "trust": d.trust} for d in people],
        }

    # -- persistence -------------------------------------------------------------------

    def to_json(self) -> dict[str, Any]:
        doc = asdict(self)
        return doc

    @classmethod
    def from_json(cls, doc: dict[str, Any]) -> "Mind":
        m = cls(character=str(doc.get("character") or ""), event=str(doc.get("event") or ""))
        m.brief = str(doc.get("brief") or "")
        m.mood = str(doc.get("mood") or "")
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

    def reset(self) -> None:
        """The run restarted: the night starts over. The character at the doors."""
        self.brief = ""
        self.mood = ""
        self.notes.clear()
        self.people.clear()
        self.threads.clear()
        self.learned.clear()
        self.world.clear()
        self.exchanges = 0
        self.reflections = 0
        self.surveys = 0
        self.updated_at = time.time()


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def mind_path(state_dir: Path, event: str, character: str) -> Path:
    safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in f"{event or 'default'}")
    who = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in character)
    return state_dir / safe / f"{who}.mind.json"
