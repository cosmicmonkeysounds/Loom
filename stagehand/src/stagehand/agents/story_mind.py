"""The story mind (wave 12, `mind_mode: new`): the mind kept by code, not a model.

Classic grows the character's mind with a second model between turns. The
new mind keeps it in plain code from what the story already says:

  - **the phase card** (`apply_phase`): the mind file's card for the current
    `Night.phase` sets the stage, favours, drives, live powers, the `tell`
    list and the brief — one revision `by: story` per change of phase
    (CONTRACTS.md §C4.5). A director's override holds until the next one.
  - **the person card** (`absorb` + `person_card`): who is talking, what the
    story says about them (`recent`: their gifts, filings, the mark, the
    Trust Chart; their `trust`), the first-met line, the voice's own memos —
    only theirs, and a heart memo only while they stand at his heart.
  - **since you last spoke** (`since_lines`): up to 4 things that moved in
    the house since their previous turn.
  - **already said** (`said_for`): his last free replies to them and his
    last lines anywhere, so he stops reciting.
  - the **Rewrite brief** and the **quiet-conversation summary** prompts,
    and the scrubs their output passes before it is kept.

Everything here is pure (no network, no model): `module.py` calls it and
the lean voice (`voice.py`) renders the shapes in `cards.py`. Nothing here
ever reads another person's memos into a card, and no output is kept that
carries a `secrets.never` word or names a hunt answer word.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .cards import PersonCard, PhaseView, Said
from .mind import Dossier, Mind
from .persona import PhaseCard, Persona
from .prompt import their_variables
from .reply import strip_think
from .secrets import Secrets

log = logging.getLogger("stagehand.agents.story_mind")

#: Lines "since you last spoke" may carry (CONTRACTS.md §C3.4).
MAX_SINCE = 4
#: History lines a summary is shown.
SUMMARY_HISTORY = 8
MAX_SUMMARY = 400
MAX_BRIEF_LINES = 8
MAX_FIRST_WORDS = 100
FIRST_WORDS = " Their first words to you:"

_warned: set[str] = set()


def _warn_once(key: str, message: str) -> None:
    if key in _warned:
        return
    _warned.add(key)
    log.info("%s", message)


def fold(text: Any) -> str:
    """CONTRACTS.md's fold: lowercase, every run of non `a-z0-9` → one space, trim."""
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


def one_line(text: Any, limit: int | None = None) -> str:
    line = " ".join(str(text).split())
    if limit is not None and len(line) > limit:
        line = line[: limit - 1].rstrip() + "…"
    return line


def _true(value: Any) -> bool:
    return str(value).strip().lower() == "true"


# -- the phase --------------------------------------------------------------------


def current_phase(world: Any) -> str:
    """`Night.phase` when present, else the first key (sorted) ending `.phase`."""
    if not isinstance(world, dict):
        return ""
    if world.get("Night.phase") not in (None, ""):
        return str(world["Night.phase"])
    for key in sorted(str(k) for k in world):
        if key.endswith(".phase") and world.get(key) not in (None, ""):
            return str(world[key])
    return ""


def card_for(persona: Persona, phase: str) -> PhaseCard | None:
    if not phase:
        return None
    card = persona.phase_cards.get(phase)
    if card is not None:
        return card
    key = "".join(ch for ch in phase.lower() if ch.isalnum())
    for name, c in persona.phase_cards.items():
        if "".join(ch for ch in name.lower() if ch.isalnum()) == key:
            return c
    return None


def apply_phase(mind: Mind, persona: Persona, phase: str) -> list[str] | None:
    """Apply the card for `phase` when it differs from the one last applied.
    Returns the touched fields (`[]` = nothing changed), or None when the
    phase is unknown / unchanged (nothing to do). A phase with no card
    leaves the mind as it is but for the powers (every allowed one is live)
    and the `tell` list (nothing in full)."""
    if not phase or phase == mind.phase_applied:
        return None
    card = card_for(persona, phase)
    if card is None:
        _warn_once(f"nocard:{persona.character}:{phase}", f"{persona.character}: no phase card for {phase!r} — the mind keeps its stage and brief")
        # Every allowed power is live again and nothing is told in full; the
        # brief keeps who set it, and a director's whispers stay.
        return mind.leave_cards(phase)
    return mind.set_phase(
        phase,
        stage=card.stage,
        favours=card.favours,
        drives=dict(card.drives),
        live_powers=list(card.powers),
        tell=list(card.tell),
        brief=card.brief,
    )


def phase_view(mind: Mind, persona: Persona, req: dict[str, Any], stage_from_phase: bool = True) -> PhaseView:
    """What the voice's P2 shows (CONTRACTS.md §C3.1), from the mind as the
    cards (and any director) left it."""
    world = req.get("world") or {}
    allowed = _allowed_power_ids(persona, req)
    live: tuple[str, ...] | None = None
    tell: tuple[str, ...] = ()
    if stage_from_phase and mind.live_powers is not None:
        known = {p.lower(): p for p in allowed}
        picked: list[str] = []
        for pid in mind.live_powers:
            hit = known.get(pid.lower())
            if hit is None:
                _warn_once(f"power:{persona.character}:{pid}", f"{persona.character}: the phase card names power {pid!r}, which the story does not offer — ignored")
                continue
            if hit not in picked:
                picked.append(hit)
        live = tuple(picked)
    if stage_from_phase and mind.tell:
        held = {fold(e.get("title", "")): str(e.get("title", "")) for e in persona.secrets.visible((req.get("self") or {}).get("codex"))}
        out: list[str] = []
        for title in mind.tell:
            hit = held.get(fold(title))
            if hit is None:
                _warn_once(f"tell:{persona.character}:{fold(title)}", f"{persona.character}: the phase card's tell names {title!r}, which he does not hold (yet) — left out")
                continue
            if hit not in out:
                out.append(hit)
        tell = tuple(out)
    wary = list(mind.policy.get("wary") or [])
    reader = str(world.get("Night.lj_reader") or "").strip()
    if reader and reader.lower() != "none" and reader not in wary:
        wary.append(reader)
    stage = mind.stage
    return PhaseView(
        phase=current_phase(world) or mind.phase_applied,
        stage=stage,
        stage_card=persona.stage_cards.get(stage, ""),
        favours=str(mind.policy.get("favours") or "none"),
        drives=dict(mind.drives),
        live_powers=live,
        tell=tell,
        brief=mind.brief,
        brief_by=mind.brief_by if mind.brief_by in ("story", "director") else "story",
        wary=tuple(wary),
    )


def _allowed_power_ids(persona: Persona, req: dict[str, Any]) -> list[str]:
    powers = [str(p.get("id", "")) for p in (req.get("powers") or []) if isinstance(p, dict) and p.get("id")]
    if persona.powers is None:
        return powers
    allowed = {p.lower() for p in persona.powers}
    return [p for p in powers if p.lower() in allowed]


# -- the person --------------------------------------------------------------------


def speaker_of(req: dict[str, Any]) -> tuple[str, str, str]:
    speaker = req.get("speaker") or {}
    sid = str(speaker.get("id") or "")
    return sid, str(speaker.get("name") or sid or "?"), str(speaker.get("kind") or "guest")


def recent_items(req: dict[str, Any]) -> list[dict[str, Any]] | None:
    """The request's `recent` (None from an older server, or with the switch off)."""
    recent = req.get("recent")
    if not isinstance(recent, list):
        return None
    return [r for r in recent if isinstance(r, dict)]


def chart_line(item: dict[str, Any]) -> str | None:
    try:
        rank, of = int(item.get("rank")), int(item.get("of"))
    except (TypeError, ValueError):
        return None
    line = f"{rank} of {of}"
    if item.get("called") == "top":
        line += "; you named them Most Trusted"
    elif item.get("called") == "bottom":
        line += "; you named them Least Trusted"
    return line


def _story_at(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def first_met_line(persona: Persona, req: dict[str, Any], phase: str) -> str:
    them = req.get("them") or {}
    where = f" in {them['location']}" if them.get("location") else ""
    line = f"First met during {phase or 'the night'}{where}."
    words = one_line(req.get("text") or "", MAX_FIRST_WORDS)
    if _true((them.get("vars") or {}).get("at_the_heart")):
        return line  # words said at his heart stay there: the line is shown everywhere
    if words and not persona.secrets.leaks(words) and not persona.secrets.names_topic(words):
        line += f"{FIRST_WORDS} “{words}”"
    return line


def gift_line(title: str) -> str:
    """How a gift reaches the voice (since-you-last-spoke and what just
    happened word it alike, so P3 says it once). K-04 w11b-heart: told only
    "They gave you X." he kept asking the giver for a fact in exchange."""
    return f"They gave you “{one_line(title, 120)}”: a gift. Name it, say what it does to you, and ask nothing more for it."


def absorb(mind: Mind, persona: Persona, req: dict[str, Any], phase: str) -> tuple[Dossier, tuple[str, ...]]:
    """Fold what the story says about the speaker into their dossier, and
    word what moved since their previous turn (CONTRACTS.md §C3.3–§C3.4).
    Returns the dossier and the "since you last spoke" lines."""
    sid, name, kind = speaker_of(req)
    d = mind.dossier(sid, name, kind)
    them = req.get("them") or {}
    vars_ = them.get("vars") or {}
    recent = recent_items(req)
    before_marked, before_chart = d.marked, d.chart
    since_at = d.last_story_at
    if d.turns == 0 and not d.first_met:
        d.first_met = first_met_line(persona, req, phase)
    if "trust" in vars_:
        d.story_trust = str(vars_["trust"])
    if _true(vars_.get("at_the_heart")):
        d.heart = True
    gifts: list[dict[str, Any]] = []
    houses: list[dict[str, Any]] = []
    if recent is None:
        if "marked" in vars_:
            d.marked = _true(vars_.get("marked"))
    else:
        d.marked = any(r.get("kind") == "marked" for r in recent)
        for r in reversed(recent):  # recent is newest first; the dossier is oldest first
            kind_ = r.get("kind")
            if kind_ == "gift" and isinstance(r.get("title"), str) and persona.secrets.lore_ok({"title": r["title"]}) and not persona.secrets.leaks(r["title"]):
                d.note_story("gifts", r["title"])
                gifts.append(r)
            elif kind_ == "filing" and isinstance(r.get("question"), str):
                d.note_story("filings", r["question"])
            elif kind_ == "house" and isinstance(r.get("text"), str):
                houses.append(r)
        chart = next((chart_line(r) for r in recent if r.get("kind") == "chart"), None)
        if chart is not None:
            d.chart = chart
    since: list[str] = []
    if d.turns >= 1:
        if d.last_phase and phase and d.last_phase != phase:
            since.append(f"The night moved: {d.last_phase} → {phase}.")
        for label in ("Most", "Least"):
            mark = f"you named them {label} Trusted"
            if d.chart and mark in d.chart and not (before_chart and mark in before_chart):
                since.append(f"You named them {label} Trusted on the TV.")
        newer = [h for h in reversed(houses) if (_story_at(h.get("at")) or 0.0) > since_at][:2]
        since.extend(f"You said to the whole house: “{one_line(h['text'], 200)}”." for h in newer)
        if d.marked and not before_marked:
            since.append("They were marked for the Internet.")
        since.extend(gift_line(g["title"]) for g in reversed(gifts) if (_story_at(g.get("at")) or 0.0) > since_at)
    return d, tuple(since[:MAX_SINCE])


def person_card(persona: Persona, d: Dossier, req: dict[str, Any], *, memos: bool = True, summary: bool = True) -> PersonCard:
    """The card the voice reads. `memos` / `summary` follow the kill
    switches (`voice.memo`, `voice.dossier_on_close`): a switch turned off
    stops what was stored under it reaching the voice too, not only new
    writes (design §5 risk 2: a bad memo must not outlive the switch)."""
    them = req.get("them") or {}
    vars_ = them.get("vars") or {}
    speaker = req.get("speaker") or {}
    at_heart = _true(vars_.get("at_the_heart"))
    kept = tuple(str(m.get("text") or "") for m in d.memos if at_heart or not m.get("heart"))[-6:] if memos else ()
    numbers = tuple((k, str(v)) for k, v in their_variables(persona, vars_).items() if k not in ("trust", "marked"))
    holds = tuple(str(e.get("title", "")) for e in persona.secrets.visible(them.get("codex")) if e.get("title"))
    trust = vars_.get("trust")
    return PersonCard(
        id=d.id,
        name=d.name,
        kind="performer" if speaker.get("kind") == "performer" else "guest",
        faction=speaker.get("faction") or None,
        turns=d.turns,
        trust=None if trust is None else str(trust),
        location=them.get("location") or None,
        first_met=d.first_met,
        gifts=tuple(d.gifts),
        filings=tuple(d.filings),
        marked=d.marked,
        chart=d.chart,
        memos=kept,
        summary=d.summary if summary else "",
        numbers=numbers,
        holds=holds,
        catchphrase_used=d.catchphrase_used,
    )


def without_summaries(mind: Mind) -> Mind:
    """A read-only view of `mind` with every dossier's summary blank, for
    the classic layout's prompt while the quiet summary is switched off (in
    the new mind a dossier's summary is only ever the quiet summary)."""
    import copy
    from dataclasses import replace as _replace

    view = copy.copy(mind)
    view.people = {pid: _replace(d, summary="") for pid, d in mind.people.items()}
    return view


def free_replies(req: dict[str, Any]) -> list[str]:
    """His own free replies in this thread (oldest first): `mine` lines the
    story did not post. With no `story` tag on any line and no `recent`
    (an old server, or the switch off) every `mine` line counts (§C1.7)."""
    history = [h for h in req.get("history") or [] if isinstance(h, dict)]
    tagged = any("story" in h for h in history) or recent_items(req) is not None
    return [str(h.get("text", "")) for h in history if h.get("mine") and not (tagged and h.get("story"))]


def said_for(mind: Mind, req: dict[str, Any], thread: str) -> Said:
    """His last free replies to them, and his last lines anywhere else — a
    line said at his heart only while this speaker stands there too."""
    to_them = tuple(one_line(t) for t in free_replies(req)[-3:])
    at_heart = _true(((req.get("them") or {}).get("vars") or {}).get("at_the_heart"))
    elsewhere = tuple(one_line(x.get("text", "")) for x in mind.said if x.get("thread") != thread and (at_heart or not x.get("heart")))[-5:]
    return Said(to_them=to_them, elsewhere=elsewhere)


def keep_said(persona: Persona, say: str) -> bool:
    """A line goes into `Mind.said` (shown to other guests' turns) only with
    no `never` word and no hunt answer word in it — a guest may have typed
    an answer he then echoed in their own thread."""
    line = one_line(say)
    return bool(line) and not persona.secrets.leaks(line) and not Secrets(match=persona.secrets.match).names_topic(line)


def uses_catchphrase(persona: Persona, say: str) -> bool:
    from .guards import uses_catchphrase as _uses  # one rule for the ration and its bookkeeping

    return _uses(persona, say)


def after_turn(persona: Persona, d: Dossier, req: dict[str, Any], phase: str, say: str) -> None:
    """Bookkeeping once a reply went out (before `saw_exchange` counts it)."""
    d.last_phase = phase
    at = _story_at(req.get("storyAt"))
    if at is not None:
        d.last_story_at = at
    if say and uses_catchphrase(persona, say):
        d.catchphrase_used = True


def keep_memo(persona: Persona, memo: str) -> str:
    """W2's re-check before a memo is stored (§C2.3): never a `never` word
    — and, belt and braces behind the voice's own scrub, never an answer
    word (the full `match` list: a memo is shown to the voice all night)."""
    line = one_line(memo, 140)
    if not line or persona.secrets.leaks(line) or Secrets(match=persona.secrets.match).names_topic(line):
        return ""
    return line


def _seq(h: dict[str, Any]) -> int:
    try:
        return int(h.get("seq") or 0)
    except (TypeError, ValueError):
        return 0


def note_heart(d: Dossier, req: dict[str, Any], at_heart: bool) -> None:
    """Move the dossier's heart line (`heart_seq`) on after a turn: the lines
    of a turn taken at his heart, and his reply to it (the run of his own
    lines right after, seen at their next turn), are heart lines a quiet
    summary never reads (CONTRACTS.md §C2.3). Conservative: everything at or
    before the newest heart line counts."""
    history = sorted((h for h in req.get("history") or [] if isinstance(h, dict)), key=_seq)
    if d.heart_open:
        for h in history:
            if _seq(h) <= d.heart_seq:
                continue
            if not h.get("mine"):
                break
            d.heart_seq = max(d.heart_seq, _seq(h))
        d.heart_open = False
    if at_heart:
        d.heart_seq = max([d.heart_seq, *(_seq(h) for h in history)])
        d.heart_open = True


def summary_history(d: Dossier, history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The lines a quiet summary may read: none taken at his heart."""
    if d.heart_open:
        return []  # the newest turn was at his heart: every stored line is
    return [h for h in history if _seq(h) > d.heart_seq]


def summary_memos(d: Dossier) -> list[str]:
    """The memos a quiet summary may read (and its signature): never a heart memo."""
    return [str(m.get("text") or "") for m in d.memos if not m.get("heart")]


def prune_restored(persona: Persona, mind: Mind) -> tuple[int, int]:
    """Re-check the new mind's stored fields against the secrets as they are
    NOW (a restored mind.json was written under an older `never` / `match`
    list — `titi:facts` may have moved the door code since). `Secrets.prune`
    covers the classic fields; this covers the memos, the first-met quote,
    the gifts, the summary's answer words, `said`, every brief line (as
    `scrub_brief`, whoever wrote it) and the whispers' `never` words. Returns what went, as
    (hunt / answer words, `never` words) — `drop_counts` words them."""
    secrets = persona.secrets
    answers = Secrets(match=secrets.match)
    hunt = never = 0

    def why(text: str, topics: Secrets = answers) -> str | None:
        if secrets.leaks(text):
            return "never"
        if topics.names_topic(text) or secrets.judges_topic(text):
            return "hunt"
        return None

    def count(reason: str | None) -> bool:
        nonlocal hunt, never
        if reason == "never":
            never += 1
        elif reason == "hunt":
            hunt += 1
        return reason is None

    for d in mind.people.values():
        d.memos[:] = [m for m in d.memos if count(why(str(m.get("text") or "")))]
        if FIRST_WORDS in d.first_met:
            head, _, words = d.first_met.partition(FIRST_WORDS)
            if not count(why(words, secrets)):  # the full topics + match, as when it was written
                d.first_met = head
        d.gifts[:] = [g for g in d.gifts if count("hunt" if not secrets.lore_ok({"title": g}) else "never" if secrets.leaks(g) else None)]
        if d.summary and not count(why(d.summary)):
            d.summary = ""
    mind.said[:] = [x for x in mind.said if count(why(str(x.get("text") or "")))]
    # The brief is shown to every speaker (and guard 2 lets its words
    # through for the classic layout's older shape): a line written under an
    # older `match` list, or a director's, is re-checked like a Rewrite's.
    if mind.brief:
        lines = mind.brief.split("\n")
        kept = [x for x in lines if not x.strip() or count(_brief_why(persona, x))]
        if len(kept) != len(lines):
            mind.brief = "\n".join(kept).strip()
    # A director's whisper and the policy note: `never` words only (a
    # whisper may well name a hunt topic: "don't let them rush the billboard").
    mind.director[:] = [w for w in mind.director if count("never" if secrets.leaks(str(w)) else None)]
    if isinstance(mind.policy, dict) and mind.policy.get("note") and not count("never" if secrets.leaks(str(mind.policy.get("note"))) else None):
        mind.policy["note"] = ""
    return hunt, never


def _brief_why(persona: Persona, line: str) -> str | None:
    """`scrub_brief`'s rule for one line, worded as `prune_restored` counts it."""
    if persona.secrets.leaks(line):
        return "never"
    _, dropped = scrub_brief(persona, [line])
    return "hunt" if dropped else None


def history_lines(req: dict[str, Any], limit: int = SUMMARY_HISTORY) -> list[dict[str, Any]]:
    """The last lines of a thread with the story's receipts taken out."""
    history = [h for h in req.get("history") or [] if isinstance(h, dict)]
    tagged = any("story" in h for h in history) or recent_items(req) is not None
    kept = [h for h in history if not (tagged and h.get("mine") and h.get("story"))]
    return kept[-limit:]


# -- the Rewrite brief and the quiet summary --------------------------------------


REWRITE_HEAD = """=== REWRITE THE BRIEF ===
A director asked you to rewrite your own brief for the rest of this phase,
from the phase card and the house below. Write 3 to 8 short lines of
instructions to yourself, in the second person and the present tense
("You want…", "Ask them…", "Do not…"): what you want now, what to push,
how open you are to bargains. Never name a hunt answer, never say whether
any fact is true or false, never mention the director. Reply with the lines
only, one per line: no JSON, no numbering, no heading."""

SUMMARY_HEAD = """=== WHAT YOU MAKE OF THEM ===
Nobody is waiting on you. Condense what you know of the one below into
what you make of them so far: two or three sentences, in your own words,
under 400 characters, the way you would remember them tomorrow. Keep what
they gave you, asked you and promised. Never write a hunt answer, never
say whether anything they told you is true or false. Reply with the
sentences only: no JSON, no heading."""


#: The last message of a summary / rewrite call. Both reuse P1 for the
#: cache, and P1 ends on the voice's JSON reply format: without a closing
#: word after the digest gpt-oss answers the guest instead (K-04: the
#: returning-guest summary came back as {"say": …, "adjust": …, "memo": …}).
SUMMARY_CLOSE = "Now write what you make of them, as plain sentences. This is a note to yourself, not a reply to anyone: not the JSON reply format, no \"say\"."
REWRITE_CLOSE = "Now write the brief, as plain lines. This is a note to yourself, not a reply to anyone: not the JSON reply format, no \"say\"."


def rewrite_digest(persona: Persona, mind: Mind, view: PhaseView, digest: str | None) -> str:
    lines = [f"Phase: {view.phase or '—'}. Your stage: {view.stage or '—'}. Favours: {view.favours}."]
    if view.live_powers is None:
        lines.append("Live powers now: every power you have.")
    else:
        lines.append(f"Live powers now: {', '.join(view.live_powers) if view.live_powers else 'none'}.")
    card = card_for(persona, view.phase)
    lines.append(f"The phase card's brief: {one_line(card.brief) if card is not None and card.brief else '(none)'}")
    lines.append(f"Your brief until now: {one_line(mind.brief) or '(none)'}")
    if mind.director:
        lines.append("Director whispers:")
        lines.extend(f"- {w}" for w in mind.director)
    if view.wary:
        lines.append(f"Wary of: {', '.join(view.wary)}")
    people = list(mind.people.values())
    lines.append(
        f"People tonight: {len(people)} on file, {sum(1 for d in people if d.filings)} have filed answers, {sum(1 for d in people if d.marked)} marked for the Internet."
    )
    if digest:
        lines.append("The house:")
        lines.append(digest)
    return "\n".join(lines)


def rewrite_messages(p1: str, digest: str) -> list[dict[str, str]]:
    return [{"role": "system", "content": p1}, {"role": "system", "content": REWRITE_HEAD}, {"role": "user", "content": digest}, {"role": "system", "content": REWRITE_CLOSE}]


def _plain(raw: str, key: str) -> str:
    text = strip_think(raw or "")
    fence = re.sub(r"^```(?:json|text)?\s*|\s*```$", "", text.strip())
    if fence.startswith("{"):
        try:
            doc = json.loads(fence)
        except json.JSONDecodeError:
            doc = None
        if isinstance(doc, dict):
            # A JSON object without the key is the voice's reply format (a
            # line to a guest), never a brief or a summary: nothing usable.
            return doc[key] if isinstance(doc.get(key), str) else ""
    return fence


def parse_brief(raw: str) -> list[str]:
    lines = []
    for line in _plain(raw, "brief").split("\n"):
        line = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line).strip()
        if line and not line.startswith("==="):
            lines.append(one_line(line, 300))
    return lines[:MAX_BRIEF_LINES]


def scrub_brief(persona: Persona, lines: list[str]) -> tuple[list[str], int]:
    """Drop every line that leaks a `never` word, names an answer word, or
    passes judgement on a hunt topic (§C6.1). Returns (kept, dropped)."""
    answers = Secrets(match=persona.secrets.match)
    kept = [x for x in lines if not persona.secrets.leaks(x) and not answers.names_topic(x) and not persona.secrets.judges_topic(x)]
    return kept, len(lines) - len(kept)


def summary_messages(p1: str, persona: Persona, d: Dossier, history: list[dict[str, Any]]) -> list[dict[str, str]]:
    parts = [f"{d.name} ({'a fellow character' if d.kind == 'performer' else 'a guest'})"]
    if d.first_met:
        parts.append(d.first_met)
    memos = summary_memos(d)
    if memos:
        parts.append("Your notes on them (oldest first):")
        parts.extend(f"- {m}" for m in memos)
    if d.summary:
        parts.append(f"What you made of them before: {d.summary}")
    history = summary_history(d, history)
    if history:
        parts.append("Your last lines together:")
        parts.extend(f"{persona.character if h.get('mine') else d.name}: {one_line(h.get('text', ''), 300)}" for h in history)
    return [{"role": "system", "content": p1}, {"role": "system", "content": SUMMARY_HEAD}, {"role": "user", "content": "\n".join(parts)}, {"role": "system", "content": SUMMARY_CLOSE}]


def parse_summary(persona: Persona, raw: str) -> str:
    """The summary as kept (≤ 400 characters), or "" when it carries a
    `never` word, names an answer word or judges a hunt topic."""
    text = one_line(_plain(raw, "summary"))
    if len(text) > MAX_SUMMARY:
        cut = text.rfind(" ", 0, MAX_SUMMARY)
        text = text[: cut if cut > 0 else MAX_SUMMARY - 1].rstrip() + "…"
    if not text or persona.secrets.leaks(text) or Secrets(match=persona.secrets.match).names_topic(text) or persona.secrets.judges_topic(text):
        return ""
    return text
