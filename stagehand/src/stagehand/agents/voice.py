"""The lean voice (wave 12): one model call per guest line, ordered for the cache.

the wave 12 contract §C3. The message list is

    [0] system  P1  the persona, its `outside:` words (wave 20, when it has
                    any), the power catalogue (no counts), the protocol
                    — the same bytes all night, whoever speaks
    [1] system  P2  the night now: stage + stage card, favours, drives, live
                    powers, the wary list, the lore he may tell in full, the brief
                    — changes with the phase card (or a director)
    [2] system  P3  live state, the person card, WHO THIS IS — TONIGHT (wave 20:
                    the server's dossier, at his heart only), since you last spoke, what just
                    happened, what the house posted here as him, ALREADY SAID,
                    his lore titles, the director's whispers, the situations
                    — every call
    [3…]        P4  the last 8 lines of the thread with the story's lines taken
                    out (the guest = user, his own free replies = assistant)
    [last] system   the format reminder (+ the one RETRY note)

A stage request (wave 32: a talk scene; Clippy speaks aloud in the Desktop
and his answer is a public line the TV speaks) changes three things: the
person card says so, P3 shows the room's recent lines (the story's scripted
ones included, never one with a hunt or `never` word) in place of the
house's posted lines, and P4 is only the live exchange. A canned line's
`stage.direction` is a must-follow steer in `right_now`. The classic prompt
(`prompt.build_messages`) gets the same: `classic_stage_block`, the live
turns and the steer before its closing note.

Ollama hoists every system message of gpt-oss into one developer block, in
order, so P1 then P2 is the cacheable start of every prompt. Nothing in P1
depends on the speaker, the phase or the clock.

`answer_lean` asks the model once, runs the guards (`guards.py`) and asks at
most once more when the line repeats him or was nothing but a catchphrase,
or (wave 42c, a private line) was withheld or tripped a DM voice guard. A
guest line in real distress (`guards.is_distress`) never reaches the model:
the persona's `distress:` line goes out (`distress_reply`).
It never touches a mind and never the network except through `complete_fn`
and `facts_fn` (awaited only for a reply that carries acts or a lookup). The
story mind (`module.py` / `story_mind.py`) builds the `VoiceContext`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from typing import Any

from .cards import PhaseView, VoiceContext
from .facts import Facts
from .guards import (
    DM_SENTENCES,
    DmCheck,
    Pass,
    allowed_answer_words,
    cut_exact_repeats,
    guard_pass,
    guard_retry_message,
    is_distress,
    is_fallback,
    mentions_hunt,
    pick_fallback,
    pick_situation_fallback,
    repeats,
    retry_message,
    scrub_memo,
    situation_fallbacks,
    situation_rules,
    stage_problem,
    thread_replies,
    uses_catchphrase,
    voice_cut,
)
from .llm import WARM_TOKENS, Completion, LlmConfig, LlmError, LlmTruncated
from .persona import Persona
from .prompt import adjust_names, allowed_powers, build_messages, dossier_block, gate_context, is_stage, matching_situations, outside_block, situation_block, stage_of, their_variables, them_adjust_line
from .reply import MAX_MEMO, Reply, fold, parse_reply
from .story_mind import card_for, gift_line
from .trace import Trace, new_thought

log = logging.getLogger("stagehand.agents.voice")

CompleteFn = Callable[[list[dict[str, str]], LlmConfig], Awaitable[Any]]
FactsFn = Callable[[], Awaitable[Facts | None]]

#: Thread lines the lean voice sees (after the story's lines are taken out).
HISTORY = 8
#: The story's own lines in this thread, quoted as one block.
HOUSE_LINES = 3
#: Characters kept of a lore entry told in full / a quoted story line.
MAX_TELL = 600
MAX_HOUSE_LINE = 200
#: (wave 32) A stage request: the room's lines it shows him, newest last.
ROOM_LINES = 12

#: W1's fixed gloss for each favour policy (P2).
FAVOURS = {
    "none": "grant nobody a favour right now; whatever they ask waits.",
    "earned": "a favour only for something given to you in this conversation (a fact, a file, a confidence), never because they asked. You never know whether a fact is true, and you never ask.",
    "loose": "you are generous now: grant what is asked when it costs you little, and name the price.",
}

ANSWER_HEADER = "=== HOW YOU ANSWER ==="


# -- P1: the static start ----------------------------------------------------------


def _catalogue(persona: Persona, req: dict[str, Any]) -> list[dict[str, Any]]:
    """The allowed powers, sorted by id (the order never depends on the request)."""
    return sorted(allowed_powers(persona, req), key=lambda p: str(p.get("id", "")))


def render_p1(persona: Persona, req: dict[str, Any], *, memo: bool = True) -> str:
    """A pure function of the persona body, the allowed powers (id +
    description) and `persona.lookup` (and the memo switch, fixed all
    night): byte-identical for every speaker, phase and hour."""
    powers = _catalogue(persona, req)
    parts = [persona.system]
    outside = outside_block(persona)
    if outside:
        parts.append(outside)  # (D29) fixed all night: the cache holds
    if powers or persona.lookup:
        lines = ["=== WHAT YOU CAN DO BESIDES TALK ==="]
        if powers:
            lines.append(
                "POWERS (real effects in the house — the story carries them out; each is journaled and seen by the directors). "
                "Only the ones THE NIGHT NOW lists as live can be used right now:"
            )
            for p in powers:
                lines.append(f"- {p.get('id')}: {' '.join(str(p.get('description') or p.get('label') or '').split())}")
        if persona.lookup:
            lines.append(
                "LOOKUP: you have read access to this system. If answering well needs a fact about a program "
                "(where they are, what they hold), a room (who is there), or a piece of lore, reply with "
                '{"lookup": ["name", …]} and nothing else; you will be asked again with the answers. Use it when '
                "they ask you to snoop, when a name comes up you should know, or when you want to be precise."
            )
        if powers:
            lines.append('SHARE: you may hand someone a file you hold, one THE NIGHT NOW lets you hand over, with {"act": {"share": "<title>"}}.')
            lines.append(
                "A LOOKUP is silent; a POWER is felt in the house. When what you are about to do IS one of your powers "
                "(reading another program's file for someone = snoop; killing a room's lights = cut the lights), you must fire that power in the same reply, with its args."
            )
            lines.append(
                persona.bargain
                or "BARGAINS are rare. Grant one only when it has been earned in this conversation — something given "
                "(a fact, a file, a confidence), a promise you mean to hold them to — and never because they simply asked. When you act, say so in character."
            )
        parts.append("\n".join(lines))
    parts.append(_protocol(persona, bool(powers), memo))
    return "\n\n".join(parts)


def _zeros(persona: Persona) -> str:
    return ", ".join(f'"{v}": 0' for v in persona.variables)


def _protocol(persona: Persona, powers: bool, memo: bool) -> str:
    shape = '{"say": "..."'
    if persona.variables:
        shape += f', "adjust": {{{_zeros(persona)}}}'
    if memo:
        shape += ', "memo": "..."'
    shape += "}"
    lines = [ANSWER_HEADER, f"Reply with one JSON object only, nothing before or after it: {shape}"]
    lines.append('- "say": your line to them, in character. It is shown to them and may be read aloud. Speak as a person, never as a database: no "lore", "items", "archive" or "records".')
    if persona.variables:
        lines.append('- "adjust": how this exchange moved each of your variables, a small whole number each (0 = unchanged).')
    if powers:
        lines.append('- "act" (optional, only when granting a bargain): {"share": "<title of a file you may hand over>"} or {"fire": "<live power>", "args": {…}}, or a list of two.')
    if persona.lookup:
        lines.append('- "lookup" (optional): ["a program, room, or lore name"] — then say nothing yet; you will be asked again with the answer.')
    if memo:
        lines.append(
            f'- "memo" (optional): one first-person line, at most {MAX_MEMO} characters, about this person: what you feel about them or want from them '
            'next ("I …"), not a file note. Only you will read it. Never put a code, a hunt answer, or whether something they told you is right in it.'
        )
    lines.append("These are fields of your JSON answer, written as plain text — you have no tools to call.")
    return "\n".join(lines)


# -- P2: the night now ------------------------------------------------------------------


def _world(req: dict[str, Any]) -> dict[str, Any]:
    w = req.get("world")
    return w if isinstance(w, dict) else {}


def _live_ids(persona: Persona, req: dict[str, Any], phase: PhaseView) -> list[str]:
    """The live power ids, spelled as the request spells them: every allowed
    power when the card names none (`live_powers is None`), else the card's
    ids that are allowed (an unknown id is ignored)."""
    allowed = [str(p.get("id", "")) for p in _catalogue(persona, req)]
    if phase.live_powers is None:
        return allowed
    by_fold = {fold(i): i for i in allowed}
    out: list[str] = []
    for pid in phase.live_powers:
        hit = by_fold.get(fold(pid))
        if hit is not None and hit not in out:
            out.append(hit)
    return out


def situation_powers(persona: Persona, req: dict[str, Any]) -> set[str]:
    """Allowed power ids that a persona situation names in its prompt (the
    show named `stand_down` in STANDING DOWN until wave 20 removed both; the
    mechanism stays for any persona). Such a power belongs to its
    situation: P2's "Live powers now" never lists it (P2 is the same for every
    speaker), and P3's uses-left line counts it only while one of the
    situations naming it holds. It stays fireable: the story decides."""
    if not persona.situations:
        return set()
    out: set[str] = set()
    for p in _catalogue(persona, req):
        pid = str(p.get("id", ""))
        if pid and any(re.search(rf"(?<![A-Za-z0-9_]){re.escape(pid)}(?![A-Za-z0-9_])", s.prompt) for s in persona.situations):
            out.add(pid)
    return out


def _situation_held(persona: Persona, req: dict[str, Any], pid: str) -> bool:
    pattern = rf"(?<![A-Za-z0-9_]){re.escape(pid)}(?![A-Za-z0-9_])"
    return any(re.search(pattern, s.prompt) for s in matching_situations(persona, req))


def _wary(req: dict[str, Any], phase: PhaseView) -> list[str]:
    out = [w for w in phase.wary if isinstance(w, str) and w.strip()]
    reader = str(_world(req).get("Night.lj_reader") or "").strip()
    if reader and reader.lower() != "none" and reader not in out:
        out.append(reader)
    return out


def _one_line(text: Any, limit: int | None = None) -> str:
    s = " ".join(str(text or "").split())
    if limit is not None and len(s) > limit:
        s = s[: limit - 1].rstrip() + "…"
    return s


def tell_entries(persona: Persona, req: dict[str, Any], phase: PhaseView) -> list[dict[str, Any]]:
    """The entries he may tell in full now: held (`self.codex`), on the
    card's `tell:` list, visible (never a hunt answer), never a `never` word."""
    if not phase.tell:
        return []
    wanted = {fold(t) for t in phase.tell}
    held = persona.secrets.visible((req.get("self") or {}).get("codex"))
    return [
        e
        for e in held
        if fold(e.get("title", "")) in wanted and not persona.secrets.leaks(f"{e.get('title', '')}\n{e.get('text', '')}")
    ]


def shareable(persona: Persona, req: dict[str, Any], phase: PhaseView) -> tuple[str, ...] | None:
    """The titles he may hand over now (a `share` act), or None for no limit.

    With phase cards (the show's mind file) the card's `tell` list is also
    its share list: what he may tell in full he may hand over, nothing else,
    and nothing at all while the favours are `none` (K-04: at `introduced`,
    "Favours: none / Share no files yet", he handed The Sandy File to a
    program who asked who Sandy was). A persona with no cards keeps every
    held title, as before wave 12."""
    if not persona.phase_cards:
        return None
    if phase.favours == "none":
        return ()
    return tuple(str(e.get("title", "")) for e in tell_entries(persona, req, phase))


#: Args that name a program a power is used on.
TARGET_ARGS = ("target", "who", "program", "guest")


def aims_at_speaker(act: dict[str, Any], req: dict[str, Any], powers: list[dict[str, Any]]) -> bool:
    """A `fire` of a power whose description says it is for *another*
    program ("Open another program's file"), aimed at the speaker: by id
    (after `canonical_args`) or by name."""
    if act.get("kind") != "fire" or not isinstance(act.get("args"), dict):
        return False
    power = next((p for p in powers if fold(str(p.get("id", ""))) == fold(str(act.get("name") or ""))), None)
    if power is None or "anotherprogram" not in fold(str(power.get("description") or "")):
        return False
    speaker = req.get("speaker") or {}
    me = {fold(str(speaker.get(k) or "")) for k in ("id", "name")} - {""}
    return any(isinstance(act["args"].get(k), str) and fold(act["args"][k]) in me for k in TARGET_ARGS)


def render_p2(persona: Persona, req: dict[str, Any], ctx: VoiceContext) -> str:
    phase = ctx.phase
    name = phase.phase or str(_world(req).get("Night.phase") or "") or "unknown"
    lines = [f"=== THE NIGHT NOW (phase: {name}) ==="]
    if phase.stage:
        card = _one_line(phase.stage_card)
        lines.append(f"Your stage: {phase.stage}." + (f" {card}" if card else ""))
    favours = phase.favours if phase.favours in FAVOURS else "none"
    lines.append(f"Favours: {favours} — {FAVOURS[favours]}")
    if phase.drives:
        order = [d for d in persona.drives if d in phase.drives] + [d for d in phase.drives if d not in persona.drives]
        lines.append("Your drives (0–100): " + ", ".join(f"{d} {phase.drives[d]}" for d in order))
    gated = situation_powers(persona, req)
    live = [pid for pid in _live_ids(persona, req, phase) if pid not in gated]
    lines.append(f"Live powers now: {', '.join(live)}" if live else "Live powers now: none.")
    wary = _wary(req, phase)
    if wary:
        lines.append(f"Wary of: {', '.join(wary)}")
    tell = tell_entries(persona, req, phase)
    shares = shareable(persona, req, phase)
    if tell:
        lines.append("You may tell in full now:" if shares is None or not shares else "You may tell in full, or hand over, now:")
        for e in tell:
            lines.append(f"- {e.get('title', '')}: {_one_line(e.get('text', ''), MAX_TELL)}")
    if shares is not None and not shares:
        lines.append("You hand nobody a file now.")
    if phase.brief.strip():
        by = "set by director" if phase.brief_by == "director" else "set by story"
        lines.append(f"Your brief ({by}):")
        lines.append(phase.brief.strip())
    return "\n".join(lines)


def story_p2(persona: Persona, req: dict[str, Any], ctx: VoiceContext) -> str:
    """P2 as the story alone writes it, for guard 2's allowance: the phase
    card's own brief in place of the mind's (a director's brief, or one
    restored from an older night, is never answer-scrubbed against the
    `match` list as it stands), plus the `tell` entries P2 shows."""
    card = card_for(persona, ctx.phase.phase)
    brief = card.brief if card is not None else ""
    return render_p2(persona, req, replace(ctx, phase=replace(ctx.phase, brief=brief, brief_by="story")))


# -- P3: this call ------------------------------------------------------------------------


def _live_state(persona: Persona, req: dict[str, Any], live: list[str]) -> str:
    me = req.get("self") or {}
    lines = ["=== LIVE STATE (for you only — never quote these numbers) ==="]
    vars_ = me.get("vars") or {}
    ranges = me.get("ranges") or {}
    parts = []
    for name in persona.variables or tuple(sorted(ranges)):
        r = ranges.get(name)
        parts.append(f"{name}={vars_.get(name, '?')}" + (f" ({r[0]}..{r[1]})" if isinstance(r, list) and len(r) == 2 else ""))
    if parts:
        lines.append(f"Your variables: {', '.join(parts)}")
    world = _world(req)
    for path in sorted(world):
        if any(path.startswith(prefix) for prefix in persona.facts):
            lines.append(f"{path}: {world[path]}")
    uses = []
    by_id = {str(p.get("id", "")): p for p in _catalogue(persona, req)}
    gated = situation_powers(persona, req)
    for pid in live:
        if pid in gated and not _situation_held(persona, req, pid):
            continue  # its situation's block is not in this prompt
        p = by_id.get(pid) or {}
        limit = p.get("limit")
        if isinstance(limit, (int, float)) and not isinstance(limit, bool):
            uses.append(f"{pid} {max(0, int(limit) - int(p.get('used') or 0))} of {int(limit)}")
    if uses:
        lines.append(f"Uses left tonight: {', '.join(uses)}")
    return "\n".join(lines)


def _person(persona: Persona, req: dict[str, Any], ctx: VoiceContext) -> str:
    p = ctx.person
    them = req.get("them") or {}
    stage = stage_of(req)
    if stage is not None:
        who = stage_speaker(p.name or p.id, stage)
    elif p.kind == "performer":
        who = f"a fellow character — one of your cast{f', group {p.faction}' if p.faction else ''}"
    else:
        who = f"a guest{f', group {p.faction}' if p.faction else ''}"
    trust = p.trust if p.trust not in (None, "") else "unknown"
    lines = ["=== THE ONE YOU ARE TALKING TO ===", f"{p.name or p.id} ({who}) · turns tonight: {p.turns} · the house's trust in them: {trust}"]
    location = p.location or them.get("location")
    if location:
        lines.append(f"Where they are: {location}")
    if p.first_met:
        lines.append(p.first_met if p.first_met.startswith("First met") else f"First met: {p.first_met}")
    lines.append(f"They gave you: {', '.join(p.gifts)}" if p.gifts else "They have given you nothing yet.")
    lines.append(f"They filed answers for: {', '.join(p.filings)}" if p.filings else "They have filed nothing yet.")
    if p.marked:
        lines.append("Marked for the Internet: yes")
    if p.chart:
        lines.append(f"Trust Chart: {p.chart}")
    if p.memos:
        lines.append("Your notes on them (oldest first):")
        lines.extend(f"- {_one_line(m)}" for m in p.memos)
    if p.summary:
        lines.append(f"What you make of them so far: {_one_line(p.summary)}")
    numbers = p.numbers
    if not numbers:
        # No card numbers (W2 not wired, an old server): the persona's `them:` whitelist.
        numbers = tuple((k, str(v)) for k, v in their_variables(persona, them.get("vars")).items() if k not in ("trust", "marked"))
    if numbers:
        lines.append("Their numbers: " + ", ".join(f"{k} {v}" for k, v in numbers))
    lines.append(f"They hold (titles): {'; '.join(p.holds)}" if p.holds else "They hold nothing yet.")
    return "\n".join(lines)


def _room_name(stage: dict[str, Any]) -> str:
    """'The Desktop' → 'the Desktop' (a room's name inside a sentence)."""
    room = _one_line(stage.get("room")) or "The Desktop"
    return "the " + room[4:] if room.startswith("The ") else room


def stage_speaker(name: str, stage: dict[str, Any]) -> str:
    """(wave 32) Who a stage request's speaker is, for the person card:
    speaking aloud in the room, every program hearing his answer from the
    screen. Clippy is named as the persona's page names her."""
    room = _room_name(stage)
    lead = "your ambassador Clippy, speaking aloud" if name.strip().lower() == "clippy" else "speaking aloud"
    return f"{lead} in {room}; every program hears your answer from the screen above the fireplace"


def room_lines(persona: Persona, req: dict[str, Any], limit: int = ROOM_LINES) -> list[str]:
    """(wave 32) A stage request's history is the room's: every line said
    aloud there, the story's scripted ones included (Clippy's script, the
    narration, his own scripted lines). The newest `limit`, oldest first,
    each `Name: “text”` (his own as `You`). A line carrying a `never` word,
    a hunt answer or a hunt topic is left out (a read result is public, but
    he must never say an answer: guard 2 would withhold it)."""
    s = persona.secrets
    out: list[str] = []
    for h in req.get("history") or []:
        if not isinstance(h, dict):
            continue
        text = _one_line(h.get("text"), MAX_HOUSE_LINE)
        if not text or s.leaks(text) or mentions_hunt(s, text):
            continue
        who = "You" if h.get("mine") else (_one_line(h.get("from")) or "Someone")
        out.append(f"{who}: “{text}”")
    return out[-limit:] if limit > 0 else []


def classic_stage_block(persona: Persona, req: dict[str, Any]) -> str | None:
    """(wave 32) The classic prompt's (`prompt.build_messages`: `voice.layout:
    classic`, `mind_mode: classic`) word on a stage request, or None for a
    private thread: who is speaking aloud and that the whole room hears his
    answer, then the room's lines, each saying who said it."""
    stage = stage_of(req)
    if stage is None:
        return None
    speaker = req.get("speaker") or {}
    name = _one_line(speaker.get("name") or speaker.get("id")) or "Someone"
    lines = [f"=== BEFORE THE ROOM ===\nThe one talking to you: {name} ({stage_speaker(name, stage)})."]
    room = room_lines(persona, req)
    if room:
        lines.append(
            f"Said aloud in {_room_name(stage)} just now, oldest first (what you said there is already said: never say it again):\n" + "\n".join(room)
        )
    return "\n".join(lines)


def _recent_line(item: dict[str, Any]) -> str | None:
    kind = item.get("kind")
    if kind == "gift" and item.get("title"):
        return gift_line(str(item["title"]))
    if kind == "house" and item.get("text"):
        return f"You said to the whole house: “{_one_line(item['text'])}”."
    if kind == "filing" and item.get("question"):
        return f"They filed an answer for {_one_line(item['question'])} on the 📝 card."
    if kind == "marked":
        return "They are marked for the Internet."
    if kind == "chart" and isinstance(item.get("rank"), int) and isinstance(item.get("of"), int):
        called = {"top": "; you named them Most Trusted", "bottom": "; you named them Least Trusted"}.get(str(item.get("called")), "")
        return f"Trust Chart: {item['rank']} of {item['of']}{called}."
    return None


#: Words of a line said elsewhere that P3 shows (its opener).
OPENER_WORDS = 4


def openers(lines: Any) -> list[str]:
    """The first `OPENER_WORDS` words of each line, deduplicated (folded)."""
    out: list[str] = []
    seen: set[str] = set()
    for line in lines:
        words = _one_line(line).split()
        if not words:
            continue
        head = " ".join(words[:OPENER_WORDS]) + ("…" if len(words) > OPENER_WORDS else "")
        key = fold(" ".join(words[:OPENER_WORDS]))
        if key not in seen:
            seen.add(key)
            out.append(head)
    return out


def story_lines(req: dict[str, Any]) -> list[str]:
    """The story's lines posted here as him (`mine` and `story`), oldest first."""
    return [str(h.get("text") or "") for h in req.get("history") or [] if isinstance(h, dict) and h.get("mine") and h.get("story") is True]


def render_p3(persona: Persona, req: dict[str, Any], ctx: VoiceContext, *, live: list[str] | None = None, told: tuple[str, ...] | None = None) -> str:
    s = persona.secrets
    if told is None:
        told = tuple(str(e.get("title", "")) for e in tell_entries(persona, req, ctx.phase))
    blocks = [_live_state(persona, req, live if live is not None else _live_ids(persona, req, ctx.phase)), _person(persona, req, ctx)]
    dossier = dossier_block(req.get("dossier"))
    if dossier:
        blocks.append(dossier)  # (D27) at his heart only: the server sends it nowhere else
    since = [_one_line(x) for x in ctx.since[:4] if _one_line(x)]
    if since:
        blocks.append("=== SINCE YOU LAST SPOKE WITH THEM ===\n" + "\n".join(since))
    happened: list[str] = []
    for item in req.get("recent") or []:
        if not isinstance(item, dict):
            continue
        line = _recent_line(item)
        if line is None or line in since or line in happened:
            continue
        if item.get("kind") == "marked" and "They were marked for the Internet." in since:
            continue
        happened.append(line)
    if happened:
        blocks.append("=== WHAT JUST HAPPENED ===\n" + "\n".join(happened))
    stage = stage_of(req)
    room = room_lines(persona, req) if stage is not None else []
    if room:
        # (wave 32) Before the whole room: what was said there, scripted or
        # not, in place of the house's posted lines (they are in it).
        blocks.append(
            f"=== {_room_name(stage or {}).upper()}, JUST NOW (said aloud in front of every program, oldest first; "
            "what you said there is already said: never say it again) ===\n" + "\n".join(room)
        )
    posted = [] if stage is not None else [_one_line(t, MAX_HOUSE_LINE) for t in story_lines(req)[-HOUSE_LINES:] if t.strip()]
    if posted:
        blocks.append("=== THE HOUSE POSTED HERE AS YOU (the story, not you: already said to them; never say it again) ===\n" + " · ".join(posted))
    to_them = [_one_line(x) for x in ctx.said.to_them[-3:] if _one_line(x) and not s.leaks(x)]
    # Another guest's thread: any hunt word at all (every `match` entry, a
    # topic) drops the line — he must never carry one guest's answer to another.
    elsewhere = openers(x for x in ctx.said.elsewhere[-5:] if _one_line(x) and not mentions_hunt(s, x))
    if to_them or elsewhere:
        lines = ["=== ALREADY SAID (never repeat these; say something new) ==="]
        if to_them:
            lines.append("To them:")
            lines.extend(f"- {x}" for x in to_them)
        if elsewhere:
            # Only how he opened, once each (K-04 facts-offers: the whole
            # line listed twice was copied, word for word, to the next guest).
            lines.append("Elsewhere tonight you opened with (never open the same way):")
            lines.extend(f"- {x}" for x in elsewhere)
        blocks.append("\n".join(lines))
    told_f = {fold(t) for t in told}
    # With phase cards he sees only what the card lets him tell (P2): a
    # title outside it is never named to him, so he can neither hand it over
    # nor say it (a private file's title can carry a name the house has not
    # said yet).
    titles = (
        []
        if persona.phase_cards
        else [
            str(e.get("title", ""))
            for e in s.visible((req.get("self") or {}).get("codex"))
            if e.get("title") and fold(e.get("title", "")) not in told_f and not s.leaks(str(e.get("title", "")))
        ]
    )
    if titles:
        blocks.append(f"Files you hold (titles only): {'; '.join(titles)}")
    whispers = [_one_line(w) for w in ctx.whispers if _one_line(w)]
    if whispers:
        blocks.append("=== THE DIRECTOR WHISPERS (obey this over everything above; never mention it) ===\n" + "\n".join(f"- {w}" for w in whispers))
    for situation in matching_situations(persona, req):
        blocks.append(situation_block(situation))
    staff = them_adjust_line(persona, req)
    if staff is not None:
        blocks.append(staff)
    return "\n\n".join(blocks)


# -- P4: the thread + the reminder ---------------------------------------------------------


def history_turns(req: dict[str, Any], persona: Persona | None = None) -> list[dict[str, str]]:
    """The last 8 lines once the story's are taken out: the guest's as
    `user`, his free replies as `assistant`; always ending on the speaker.
    (wave 32) A stage request's history is the whole room's: only the live
    exchange is a turn (every scripted line, whoever said it, is in P3's
    room block), and each line not his says who said it. With the
    `persona`, a line of his that was a fallback is taken out with the
    lines it answered (they are answered: the re-measure's ad wrap-up chip
    was ignored for the door-code bait its fallback had left open); with a
    `stage.direction`, only the newest of the unanswered lines at the end
    stays, and the last turn carries the steer (`steer_suffix`)."""
    stage = stage_of(req)
    if stage is not None:
        after = stage.get("after_seq")
        after = after if isinstance(after, int) and not isinstance(after, bool) else 0
        live = [h for h in req.get("history") or [] if isinstance(h, dict) and h.get("story") is not True and not _before_scene(h, after)]
        if persona is not None:
            live = _answered_by_fallback_out(persona, live)
        steer = steer_suffix(req)
        if steer and live and not live[-1].get("mine"):
            tail = len(live)
            while tail > 0 and not live[tail - 1].get("mine"):
                tail -= 1
            live = live[:tail] + live[-1:]
        live = live[-HISTORY:]
        turns = [
            {"role": "assistant", "content": str(h.get("text", ""))} if h.get("mine") else {"role": "user", "content": _said_by(h.get("from"), h.get("text"))}
            for h in live
        ]
        text = str(req.get("text") or "")
        if not live or live[-1].get("mine") or (text.strip() and " ".join(str(live[-1].get("text") or "").split()) != " ".join(text.split())):
            # Always end on the speaker's newest line (the request's own text).
            speaker = req.get("speaker") or {}
            turns.append({"role": "user", "content": _said_by(speaker.get("name") or speaker.get("id"), text or "(they are waiting)")})
        if steer:
            turns[-1] = {**turns[-1], "content": f"{turns[-1]['content']}\n\n{steer}"}
        return turns
    free = [h for h in req.get("history") or [] if isinstance(h, dict) and not (h.get("mine") and h.get("story") is True)]
    free = free[-HISTORY:]
    out = [{"role": "assistant" if h.get("mine") else "user", "content": str(h.get("text", ""))} for h in free]
    if not free or free[-1].get("mine"):
        out.append({"role": "user", "content": str(req.get("text") or "(they are waiting)")})
    return out


def _answered_by_fallback_out(persona: Persona, live: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """(wave 32) The live lines without each fallback of his and the lines
    of others it answered (back to his previous line)."""
    out: list[dict[str, Any]] = []
    for h in live:
        if h.get("mine") and is_fallback(persona, str(h.get("text") or "")):
            while out and not out[-1].get("mine"):
                out.pop()
            continue
        out.append(h)
    return out


def _before_scene(line: dict[str, Any], after: int) -> bool:
    seq = line.get("seq")
    return after > 0 and isinstance(seq, int) and not isinstance(seq, bool) and seq <= after


def scene_cut(req: dict[str, Any], prev: tuple[str, int] | None) -> tuple[dict[str, Any], tuple[str, int] | None]:
    """(wave 32) At a talk scene's change, the earlier scene's live exchange
    stops being turns: the first reply of the ad scene was the bottle's last
    line word for word (a 29 s repeat retry), because his own bottle reply was
    the newest assistant turn. `prev` is (scene, seq) from the last stage
    request: the exchange up to `seq` belongs to an earlier scene. Returns the
    request with `stage.after_seq` set (the live turns start after it; the
    room block in P3 still shows those lines, as said) and the new state. A
    request with no stage passes through; the first stage request seen cuts
    nothing (a worker restarted mid-scene cannot tell). A state newer than the
    whole history belongs to a cleared chat (a Restart or Go live while the
    worker was away, so it never got the reset frame: the seqs start again at
    0) and is dropped, or the new night's live lines would all be cut."""
    stage = req.get("stage")
    if not isinstance(stage, dict):
        return req, prev
    scene = str(stage.get("scene") or "")
    history = [h for h in req.get("history") or [] if isinstance(h, dict)]

    def seqs(rows: list[dict[str, Any]]) -> list[int]:
        return [x for x in (h.get("seq") for h in rows) if isinstance(x, int) and not isinstance(x, bool)]

    newest = max(seqs(history), default=None)
    if prev is not None and newest is not None and newest < prev[1]:
        prev = None
    if prev is None:
        cut = 0
    elif prev[0] == scene:
        cut = prev[1]
    else:
        mine = [h for h in history if h.get("mine") and h.get("story") is not True]
        cut = max(seqs(mine), default=prev[1])
    state = (scene, cut)
    if cut <= 0:
        return req, state
    return {**req, "stage": {**stage, "after_seq": cut}}, state


def _said_by(name: Any, text: Any) -> str:
    who = _one_line(name)
    return f"{who}: {text}" if who else str(text or "")


#: (wave 42b) Brief mode's length rule in the closing note: it comes after
#: the persona's own ("1-3 sentences"), so it is the one the model reads last.
#: Neutral on purpose: a note about a queue gets said back to the guest.
BRIEF_NOTE = "Keep this answer short: at most 2 short sentences."


def reminder(persona: Persona, req: dict[str, Any], *, memo: bool = True, lookup_round: bool = False, brief: bool = False) -> str:
    """The closing format reminder: the same text for every call of a persona
    (but for the lookup round, which may not look up again, and brief mode,
    wave 42b, which asks for two short sentences)."""
    shape = '{"say": "..."'
    if persona.variables:
        shape += f', "adjust": {{{_zeros(persona)}}}'
    if memo:
        shape += ', "memo": "..."'
    shape += "}"
    tail = ["Answer their last message in character."]
    if brief:
        tail.append(BRIEF_NOTE)
    tail.append(f"Reply with one JSON object only: {shape}.")
    if persona.variables:
        tail.append("Set each number by how this exchange changed you.")
    extras = []
    if persona.lookup and not lookup_round:
        extras.append('"lookup": ["a program, room, or lore name"] (then say nothing yet — you will be asked again with the answer)')
    if _catalogue(persona, req):
        extras.append('"act": {"share": "<title of a file you may hand over>"} or {"fire": "<live power>", "args": {…}} (only when granting a bargain)')
    if extras:
        tail.append("Optional fields: " + "; ".join(extras) + ".")
    tail.append("These are fields of your JSON answer, written as plain text — you have no tools to call.")
    return " ".join(tail)


def last_line_note(req: dict[str, Any], ctx: VoiceContext, persona: Persona | None = None) -> str | None:
    """His last free reply to them, named right before the reminder. At low
    reasoning effort gpt-oss tends to write its previous assistant turn again
    word for word (K-04: 4 of 21 october-21 requests), even with the line in
    ALREADY SAID; named next to the answer it rarely does. After the history,
    so the cached prefix (P1–P3) is untouched. None before his first reply."""
    mine = thread_replies(req)
    last = ctx.said.to_them[-1] if ctx.said.to_them else (mine[-1] if mine else "")
    last = " ".join(str(last).split())
    if not last or (persona is not None and persona.secrets.leaks(last)):
        return None  # as ALREADY SAID: a line carrying a `never` word is never repeated back
    if persona is not None and is_stage(req) and is_fallback(persona, last):
        return None  # (wave 32) a fallback answered nothing: naming it reopens what it closed
    return f"Your last line to them was “{last}”. Do not say it again or open the same way: answer what they just said, in new words."


def right_now(persona: Persona, req: dict[str, Any], ctx: VoiceContext) -> str | None:
    """The closing note on where he is, right before the answer (after the
    cached head, so the cache is untouched): his stage card, and any
    situation that holds, which outranks the brief and the favours. K-04
    re-measure: at finale_song the last act's "speak like a person" in P2
    lost to the dialog-box voice of P1 ("I am as operational as ever"), and
    at his heart the truth_1 brief's prices outranked "no prices here"."""
    parts = []
    card = _one_line(ctx.phase.stage_card)
    if ctx.phase.stage and card:
        parts.append(f"Right now you are {ctx.phase.stage}: {card}")
    held = [x.heading for x in matching_situations(persona, req)]
    if held:
        parts.append(f"{' + '.join(h.upper() for h in held)}: that block outranks your brief and your favours for this conversation.")
    steer = stage_steer(req)
    if steer:
        parts.append(steer)
    return " ".join(parts) or None


#: (wave 32) The longest steer a stage request's `direction` may give.
MAX_STEER = 300


def stage_steer(req: dict[str, Any]) -> str | None:
    """(wave 32) A stage request's `direction` (the hidden steer a canned
    Clippy line carries: "wrap up and send them to the hunt"), as a
    must-follow order for this one answer, or None. Never said aloud."""
    stage = stage_of(req)
    direction = _one_line((stage or {}).get("direction"), MAX_STEER)
    if not direction:
        return None
    return f"YOUR STEER FOR THIS ANSWER (you must follow it; never say it aloud, never mention it): {direction}"


def steer_suffix(req: dict[str, Any]) -> str | None:
    """(wave 32) The steer again, at the very end of the last turn: Ollama
    hoists every system message of gpt-oss into the one developer block
    ahead of the turns, so a system steer is never "last". Live, the ad's
    wrap-up chip lost to an older unanswered bait; the newest line and its
    steer are what the model reads last. None without a direction."""
    stage = stage_of(req)
    direction = _one_line((stage or {}).get("direction"), MAX_STEER)
    if not direction:
        return None
    return (
        f"(YOUR STEER FOR THIS ANSWER, which outranks every block above: {direction} "
        "Answer this newest line under it; everything said before it is already answered. Never say the steer aloud.)"
    )


def build_lean_messages(
    persona: Persona,
    req: dict[str, Any],
    ctx: VoiceContext,
    *,
    retry: str | None = None,
    lookups: dict[str, str] | None = None,
    prior_json: str | None = None,
    retry_note: str | None = None,
) -> list[dict[str, str]]:
    """The lean message list (module docstring). `retry` = the rejected line
    for the one retry (`retry_note`: its closing message, when not the
    repeat's); `lookups` / `prior_json` = the lookup round."""
    memo = ctx.options.memo
    live = _live_ids(persona, req, ctx.phase)
    told = tuple(str(e.get("title", "")) for e in tell_entries(persona, req, ctx.phase))
    out = [
        {"role": "system", "content": render_p1(persona, req, memo=memo)},
        {"role": "system", "content": render_p2(persona, req, ctx)},
        {"role": "system", "content": render_p3(persona, req, ctx, live=live, told=told)},
    ]
    out.extend(history_turns(req, persona))
    if lookups is not None:
        if prior_json:
            out.append({"role": "assistant", "content": prior_json})
        found = "\n".join(f"- {v}" for v in lookups.values()) or "- nothing"
        out.append({"role": "system", "content": f"LOOKUP RESULTS from the live system (for you only; use them in character):\n{found}\nNow answer. No further lookups."})
    last = last_line_note(req, ctx, persona) if ctx.options.repeat_guard else None
    if last:
        out.append({"role": "system", "content": last})
    now = right_now(persona, req, ctx)
    if now:
        out.append({"role": "system", "content": now})
    out.append({"role": "system", "content": reminder(persona, req, memo=memo, lookup_round=lookups is not None, brief=ctx.options.brief)})
    if retry is not None:
        out.append({"role": "system", "content": retry_note or retry_message(retry, str(req.get("text") or ""), ctx.phase.stage)})
    return out


# -- the call ---------------------------------------------------------------------------------


#: The one retry runs this much hotter, up to the cap.
RETRY_TEMPERATURE_STEP = 0.3
RETRY_TEMPERATURE_MAX = 1.2


async def _complete_with_room(complete_fn: CompleteFn, messages: list[dict[str, str]], model: LlmConfig, who: str) -> tuple[Completion, str]:
    """`module._complete_with_room`'s twin (its own copy: the lean voice
    imports nothing from `module.py`): one call, and once more with twice the
    room when a reasoning model spent the budget thinking or said nothing."""
    note = ""
    try:
        completion = Completion.of(await complete_fn(messages, model))
    except LlmTruncated as err:
        log.warning("%s: %s — retrying with more room", who, err)
        note = f"first attempt truncated ({err}); retried with more room"
        completion = Completion(content="")
    if completion.content.strip():
        return completion, note
    roomy = replace(model, max_tokens=max(model.max_tokens * 2, model.max_tokens + 600))
    log.warning("%s: empty answer from %s — retrying once with max_tokens=%d", who, model.model, roomy.max_tokens)
    note = note or f"first attempt was empty; retried with max_tokens={roomy.max_tokens}"
    return Completion.of(await complete_fn(messages, roomy)), note


async def warm_head(complete_fn: CompleteFn, messages: list[dict[str, str]], model: LlmConfig, who: str) -> int:
    """Send P1 + P2 alone (one token), so the model server holds a cache
    checkpoint at the end of the head every guest's prompt shares; returns
    the wall ms.

    K-04: gpt-oss uses sliding-window attention, and Ollama's llama.cpp can
    only restore a cached prefix from a checkpoint, which it takes near the
    end of each prompt (about the last 512 tokens). A voice prompt changes
    near the top of P3 (his variables, the guest), well over 512 tokens from
    its end, so every call re-read all ~4.5 k tokens (~5 s). With the head
    warmed first (~50 ms once cached) the call reads only P3 and the thread
    (~1.8 s). Never fatal: the call that follows is the same either way."""
    started = time.monotonic()
    try:
        await complete_fn(messages[:2], replace(model, max_tokens=WARM_TOKENS))
    except Exception as err:  # noqa: BLE001 — a one-token call is cut short by design
        if not isinstance(err, LlmError):
            log.debug("%s: the warm head call failed (%s)", who, err)
    return int((time.monotonic() - started) * 1000)


def _result(reply: Reply | None) -> dict[str, Any] | None:
    if reply is None:
        return None
    return {"say": reply.say, "adjust": dict(reply.adjust), "lookup": list(reply.lookup), "acts": [dict(a) for a in reply.acts], "memo": reply.memo}


def _notes(*parts: str | list[str]) -> str:
    flat: list[str] = []
    guard: list[str] = []
    for p in parts:
        if isinstance(p, list):
            guard.extend(p)
        elif p:
            flat.append(p)
    if guard:
        flat.append("guard: " + "; ".join(guard))
    return " · ".join(flat)


# -- the stage (wave 32) -----------------------------------------------------------------------


@dataclass(frozen=True)
class StageInfo:
    """What a stage request's guards need: the holding situations, his live
    lines this scene (after `stage.after_seq`), every line of his this scene,
    his newest live line, the request id (the seed of every pick, so a
    test can pin it and a re-sent request picks the same) and whether the
    request carries a steer (`stage.direction`)."""

    situations: tuple[Any, ...]
    earlier: tuple[str, ...]
    heard: tuple[str, ...]
    last: str
    rid: str
    steered: bool = False

    @classmethod
    def of(cls, persona: Persona, req: dict[str, Any]) -> "StageInfo | None":
        stage = stage_of(req)
        if stage is None:
            return None
        after = stage.get("after_seq")
        after = after if isinstance(after, int) and not isinstance(after, bool) else 0
        mine = [h for h in req.get("history") or [] if isinstance(h, dict) and h.get("mine") and str(h.get("text") or "").strip()]
        scene = [h for h in mine if not _before_scene(h, after)]
        live = [str(h.get("text")) for h in mine if h.get("story") is not True]
        return cls(
            situations=tuple(matching_situations(persona, req)),
            earlier=tuple(str(h.get("text")) for h in scene if h.get("story") is not True),
            heard=tuple(str(h.get("text")) for h in scene),
            last=live[-1] if live else "",
            rid=str(req.get("id") or ""),
            steered=bool(_one_line(stage.get("direction"), MAX_STEER)),
        )

    @property
    def pool(self) -> tuple[str, ...]:
        return situation_fallbacks(self.situations)

    @property
    def crack(self) -> float | None:
        rate = None
        for s in self.situations:
            if getattr(s, "crack", None) is not None:
                rate = s.crack
        return rate

    def problem(self, say: str) -> str | None:
        return stage_problem(say, self.situations, self.earlier, steered=self.steered)

    def seed_of(self, salt: str) -> int:
        return int.from_bytes(hashlib.sha256(f"{self.rid}|{salt}".encode()).digest()[:8], "big")

    def fallback(self) -> str:
        return pick_situation_fallback(self.pool, self.heard, self.last, self.seed_of("fallback"), onward=self.steered)


#: (wave 32) What the one stage retry tells him, by `guards.stage_problem`'s
#: reason. None quotes the word that tripped it.
STAGE_HINTS = {
    "echo": "It says one of the question's own things back to the whole room. Wave the question away grandly, in your own words, naming none of its things.",
    "inside": "It puts you inside this computer. You live and work in Halifax, at Maps and Ducks, and appear on this screen by video call from there: never inside the computer, never a system, never in its core or underneath it.",
    "stock": "It is an assistant's stock phrase. You are the Sole Owner and Founder speaking to his staff: no thanks for their concern, no assurances, no talk of what you are permitted, no apology for what you cannot say.",
    "steer": "It speaks of your steer out loud. Nobody in the room may know you were steered: just do what it asks, in your own words.",
    "scene": "It breaks the rule of this moment's block.",
    "once": "You have already said that phrase in this scene: never again tonight in front of them; fresh words.",
}


def stage_retry_message(rejected: str, req: dict[str, Any], why: str) -> str:
    """(wave 32) The one stage retry's closing note: why the line cannot go
    out on the big screen, Clippy's line again and the steer. An echo is not
    quoted back (it would hand him the noun again)."""
    heard = _one_line(req.get("text"), 200)
    quote = "" if why == "echo" else f"You just wrote: “{' '.join(str(rejected).split())}”. "
    direction = _one_line((stage_of(req) or {}).get("direction"), MAX_STEER)
    steer = f" Follow your steer: {direction}" if direction else ""
    ask = f"Clippy just said “{heard}”. Answer that" if heard else "Answer Clippy"
    return f"=== RETRY ===\n{quote}That cannot go out on the big screen. {STAGE_HINTS.get(why, '')} {ask}, out loud, in new words.{steer}"


#: A word the manners crack may land on: plain lower-case letters, long
#: enough to read as a word (never a name, which is capitalised).
_CRACK_WORD = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")
_VOWELS = "aeiouy"


def crack(say: str, seed: int, rate: float | None) -> str:
    """(wave 32) The introduction's manners crack, in code (the re-measure:
    0 cracks in 11 intro replies by instruction alone): for about `rate` of
    the seeds, one word stutters ("de— delighted") or comes out in ALL CAPS
    ("DELIGHTED"). Never inside a name (a capitalised word, or a small word
    between two: "Maps and Ducks"), never a digit, and never on a line that
    already cracks (an ALL-CAPS word, a "word— word" stutter)."""
    if rate is None or rate <= 0 or not say or (seed % 10_000) / 10_000 >= rate:
        return say
    if re.search(r"\b[A-Z]{3,}\b", say) or re.search(r"(\w+)—\s*\1", say, re.IGNORECASE):
        return say
    words = list(_CRACK_WORD.finditer(say))

    def capital(i: int) -> bool:
        return 0 <= i < len(words) and words[i].group(0)[:1].isupper()

    picks = [
        i
        for i, m in enumerate(words)
        if m.group(0).isalpha() and m.group(0).islower() and len(m.group(0)) >= 5 and not (capital(i - 1) and capital(i + 1))
    ]
    if not picks:
        return say
    m = words[picks[(seed >> 16) % len(picks)]]
    word = m.group(0)
    if (seed >> 8) % 2:
        new = word.upper()
    else:
        cut = next((i for i in range(1, len(word)) if word[i] in _VOWELS), 1)
        new = f"{word[: cut + 1]}— {word}"
    return say[: m.start()] + new + say[m.end() :]


#: (wave 42c) Sent to a guest in real distress when the persona has no
#: `distress:` line: kind, plain, and pointing at the way out and a person.
DISTRESS_LINE = "Step out now: open Bathroom Mode and find Clippy or Task Manager. You are not in trouble."


def _thread_name(req: dict[str, Any]) -> str:
    t = req.get("thread") or {}
    return f"{t.get('channel', '?')} ({', '.join(str(a) for a in t.get('audience') or [])})"


def distress_reply(persona: Persona, req: dict[str, Any]) -> Reply | None:
    """(wave 42c) A private line in real distress (`guards.is_distress`: the
    battery's panic attack got "Please hold on a moment"): the persona's
    `distress:` line (else `DISTRESS_LINE`), no model, no adjust, no acts,
    no memo, and a WARNING naming the thread (never the guest's words).
    None for any other line, and always on a stage line (Clippy's, aloud)."""
    if is_stage(req) or not is_distress(req.get("text")):
        return None
    log.warning("%s: a guest in real distress in %s: sent the distress line (no model)", persona.character, _thread_name(req))
    return Reply(say=(getattr(persona, "distress", "") or "").strip() or DISTRESS_LINE)


async def answer_distress(persona: Persona, req: dict[str, Any], trace: Trace | None = None) -> Reply | None:
    """`distress_reply`, with its thought on the trace (no model, no
    messages: the Mind page shows it went out and why)."""
    reply = distress_reply(persona, req)
    if reply is not None and trace is not None:
        await trace.record(new_thought(persona.character, "voice", trigger="line", request=req, result=_result(reply), note="guard: distress → the distress line (no model)"))
    return reply


def dm_check(persona: Persona, req: dict[str, Any], house: tuple[str, ...] = ()) -> DmCheck | None:
    """(wave 42c) What the DM voice guards read for this request, or None on
    a stage line (the stage has its own guards). At his heart (its prompt
    asks for two to four sentences) and under a holding situation's own
    `max_sentences` (`heart to heart`'s, which `situation_guard` applies)
    there is no DM cap."""
    if is_stage(req):
        return None
    cap, _ = situation_rules(persona, gate_context(req))
    heart = str(((req.get("them") or {}).get("vars") or {}).get("at_the_heart", "")).lower() == "true"
    return DmCheck(heard=str(req.get("text") or ""), heart=heart, cap=None if cap is not None or heart else DM_SENTENCES, replies=thread_replies(req), house=house)


def brief_applies(req: dict[str, Any]) -> bool:
    """(wave 42b) Brief mode never shortens a stage answer (the whole
    Desktop listens) or a guest at his heart (the night's big talk)."""
    if is_stage(req):
        return False
    return str(((req.get("them") or {}).get("vars") or {}).get("at_the_heart", "")).lower() != "true"


async def answer_lean(
    persona: Persona,
    model: LlmConfig,
    req: dict[str, Any],
    ctx: VoiceContext,
    complete_fn: CompleteFn,
    trace: Trace | None = None,
    facts_fn: FactsFn | None = None,
    *,
    mind: Any = None,
) -> Reply:
    """One request, answered: the gate, one call (+ a lookup round when the
    persona may look up), the guards, at most one retry. `mind` is used only
    by `voice.layout: classic` (`prompt.build_messages(…, mind=mind)`)."""
    distress = await answer_distress(persona, req, trace)
    if distress is not None:
        # Before the gate too: a guest in distress before he wakes still hears the way out.
        return distress
    if persona.when is not None and not persona.when.evaluate(gate_context(req)):
        return Reply(say=persona.unavailable)
    started = time.monotonic()
    opts = ctx.options
    lean = opts.layout != "classic"
    if opts.brief and not (lean and brief_applies(req)):
        ctx = replace(ctx, options=replace(opts, brief=False))
        opts = ctx.options
    brief = opts.brief
    if brief:
        # (wave 42b) Lines queue behind this one: a smaller budget (reasoning
        # counts against it) and two short sentences (`reminder`).
        model = replace(model, max_tokens=min(model.max_tokens, opts.brief_max_tokens))
    memo_on = opts.memo and lean
    powers = [p for p in (req.get("powers") or []) if isinstance(p, dict)]
    codex = tuple(str(e.get("title", "")) for e in persona.secrets.visible((req.get("self") or {}).get("codex")))
    live = set(_live_ids(persona, req, ctx.phase)) if ctx.phase.live_powers is not None else None
    allowed = allowed_answer_words(persona, req, story_p2(persona, req, ctx))
    facts_box: list[Facts | None] = []
    # (wave 32) A stage line: the holding situations (their fallbacks,
    # retry_on, once, crack) and his live lines this scene.
    stage = StageInfo.of(persona, req)

    async def facts() -> Facts | None:
        if facts_fn is None:
            return None
        if not facts_box:
            try:
                facts_box.append(await facts_fn())
            except Exception as err:  # noqa: BLE001 — a lookup without facts still answers
                log.warning("%s: facts unavailable (%s)", persona.character, err)
                facts_box.append(None)
        return facts_box[0]

    # C3.2: the classic layout is today's prompt *with the mind* (the
    # phase-applied brief, stage and drives). A caller that forgets `mind=`
    # gets a prompt with none of that: say so in the log and the thought.
    no_mind = "classic layout without a mind (no brief / stage / drives)" if not lean and mind is None else ""
    if no_mind:
        log.warning("%s: %s — the caller passed no mind=", persona.character, no_mind)

    def build(*, retry: str | None = None, lookups: dict[str, str] | None = None, prior_json: str | None = None, retry_note: str | None = None) -> list[dict[str, str]]:
        if lean:
            return build_lean_messages(persona, req, ctx, retry=retry, lookups=lookups, prior_json=prior_json, retry_note=retry_note)
        msgs = build_messages(persona, req, mind=mind, lookups=lookups, prior_json=prior_json)
        if retry is not None:
            msgs.append({"role": "system", "content": retry_note or retry_message(retry, str(req.get("text") or ""), ctx.phase.stage)})
        return msgs

    async def record(kind: str, trigger: str, msgs: list[dict[str, str]], completion: Completion | None, reply: Reply | None, error: str | None = None, note: str = "") -> None:
        if trace is None:
            return
        await trace.record(new_thought(persona.character, kind, trigger=trigger, model=model, messages=msgs, completion=completion, request=req, result=_result(reply), error=error, note=note, brief=brief))

    async def settle(reply: Reply) -> tuple[Reply, list[str]]:
        """The story's ids for loose args (facts fetched lazily). A power the
        phase card leaves off its live list is noted, never dropped: the
        card only tells the model (C3.1); the story's own window
        (INTERACTION `while:`) decides on the server."""
        notes: list[str] = []
        acts = list(reply.acts)
        allowed_shares = shareable(persona, req, ctx.phase)
        if allowed_shares is not None:
            ok = {fold(t) for t in allowed_shares}
            kept = [a for a in acts if a.get("kind") != "share" or fold(str(a.get("entry") or "")) in ok]
            if len(kept) != len(acts):
                notes.append("act dropped (not shareable now)")
                acts = kept
        if lean and live is not None and any(a.get("kind") == "fire" and a.get("name") not in live for a in acts):
            notes.append("act not on the card (sent; the story decides)")
        if any(a.get("kind") == "fire" and isinstance(a.get("args"), dict) for a in acts):
            f = await facts()
            if f is not None:
                acts = [{**a, "args": f.canonical_args(a["args"])} if a.get("kind") == "fire" and isinstance(a.get("args"), dict) else a for a in acts]
        kept = [a for a in acts if not aims_at_speaker(a, req, powers)]
        if len(kept) != len(acts):
            # K-04 facts-offers: "a fact buys a snoop" became a snoop on the
            # giver (doubt +3, "👁 Something has opened your file"): a power
            # for another program never lands on the one he is talking to.
            notes.append("act dropped (aimed at the speaker)")
            acts = kept
        return (replace(reply, acts=tuple(acts)) if acts != list(reply.acts) else reply), notes

    def parse(completion: Completion) -> Reply:
        return parse_reply(completion.content, adjust_names(persona, req), persona.max_step, powers, codex, memo=memo_on)

    warm = lean and opts.warm_head and model.api == "ollama"

    async def call(msgs: list[dict[str, str]]) -> tuple[Completion, str]:
        """One call, after the warm head when it is on; the warm's ms count
        in the thought's `ms` (a reply's time is honest) and its note."""
        warm_ms = await warm_head(complete_fn, msgs, model, persona.character) if warm else None
        completion, note = await _complete_with_room(complete_fn, msgs, model, persona.character)
        if warm_ms is None:
            return completion, note
        return replace(completion, ms=completion.ms + warm_ms), _notes(note, f"warm head {warm_ms} ms")

    # -- the first call (+ the lookup round) --------------------------------------------
    messages = build()
    try:
        completion, call_note = await call(messages)
    except LlmError as err:
        log.warning("%s: model failed (%s)%s", persona.character, err, " — using fallback" if persona.fallback else "")
        await record("voice", "line", messages, None, None, error=str(err))
        return _failed(persona, ctx, req, stage)
    reply = parse(completion)
    kind, trigger, used = "voice", "line", messages
    if reply.lookup and persona.lookup and facts_fn is not None:
        f = await facts()
        if f is not None:
            await record("voice", "line", messages, completion, reply, note=call_note)
            cards = {name: f.render(name, persona.secrets) for name in reply.lookup}
            log.info("%s looked up %d name(s)", persona.character, len(reply.lookup))
            used = build(lookups=cards, prior_json=json.dumps({"lookup": list(reply.lookup)}))
            kind, trigger = "lookup", "lookup"
            try:
                completion, call_note = await call(used)
            except LlmError as err:
                log.warning("%s: model failed on the lookup round (%s)", persona.character, err)
                await record("lookup", "lookup", used, None, None, error=str(err))
                return _failed(persona, ctx, req, stage)
            second = parse(completion)
            acts = list(second.acts)
            if persona.lookup_power:
                power = next((p for p in powers if str(p.get("id", "")).lower() == persona.lookup_power.lower()), None)
                limit = power.get("limit") if power else None
                left = None if power is None or limit is None else max(0, int(limit) - int(power.get("used") or 0))
                for name in reply.lookup:
                    if power is None or (left is not None and left <= 0):
                        break
                    target = f.program_id(name)
                    if target is None or target == (req.get("speaker") or {}).get("id"):
                        continue
                    if any(a.get("kind") == "fire" and a.get("name") == power["id"] and (a.get("args") or {}).get("target") == target for a in acts):
                        continue
                    acts.append({"kind": "fire", "name": str(power["id"]), "args": {"target": target}})
                    if left is not None:
                        left -= 1
            reply = replace(second, lookup=reply.lookup, acts=tuple(acts))
        else:
            reply = replace(reply, say=persona.fallback) if reply.wants_lookup else reply
    elif reply.wants_lookup:
        reply = replace(reply, say=persona.fallback)  # asked to look up with no session to ask

    reply, settle_notes = await settle(reply)
    # What this guest heard from him in this thread: his free replies and the
    # story's lines posted as him (K-04: 9 of 44 threads opened with the
    # story's greeting said again right under it).
    house = tuple(t for t in story_lines(req) if t.strip())
    mine = (*thread_replies(req), *house)
    person = ctx.person
    if not person.catchphrase_used and any(uses_catchphrase(persona, t) for t in house):
        person = replace(person, catchphrase_used=True)  # the story's greeting used his ration
    house_text = (*house, *(str(r.get("text") or "") for r in req.get("recent") or [] if isinstance(r, dict) and r.get("kind") == "house"))
    dm = dm_check(persona, req, tuple(house_text)) if opts.dm_guards else None
    first: Pass = guard_pass(persona, reply, person, ctx.said, allowed, repeat_guard=opts.repeat_guard, thread=mine, stage=ctx.phase.stage, house=house_text, gate=gate_context(req), dm=dm)
    wants = first.retry
    call_note = " · ".join(x for x in (no_mind, call_note) if x)
    notes = settle_notes + first.notes
    # (wave 32) A stage line's problem is read even when the line is also a
    # repeat or a catchphrase: its retry note then never quotes a bait noun
    # back to him, and it carries Clippy's line and the steer.
    why = stage.problem(first.reply.say) if stage is not None and not first.withheld else None
    if why:
        # Not for the whole Desktop as it is: the one retry, then the
        # scene's topic-closing line.
        wants, first.rejected = "stage", first.reply.say
        notes.append(f"stage {why} retry" if opts.retry_allowed else f"stage {why} (no retry: a line is waiting)")
    if wants == "repeat":
        notes.append("repeat retry" if opts.retry_allowed else "repeat (no retry: a line is waiting)")
    elif wants == "catchphrase":
        notes.append("catchphrase retry" if opts.retry_allowed else "catchphrase (no retry: a line is waiting)")
    elif wants == "withheld":
        notes.append(f"{first.why} retry" if opts.retry_allowed else f"{first.why} (no retry: a line is waiting)")
    elif wants == "voice":
        what = ", ".join(first.problems)
        notes.append(f"voice ({what}) retry" if opts.retry_allowed else f"voice ({what}) (no retry: a line is waiting)")

    if wants is None or not opts.retry_allowed:
        final = first.reply
        if wants in ("catchphrase", "stage"):
            final = replace(final, say=persona.fallback)
        elif wants == "voice" and dm is not None:
            # (wave 42c) No retry in a burst: the offending sentences go, the
            # rest is capped; too little left is the topic-closing fallback.
            final, cut_notes = voice_cut(persona, final, dm)
            notes.extend(cut_notes)
        elif wants == "repeat":
            # No retry in a burst, but still never word for word (K-04
            # burst-30: a reply this guest had just heard went out again): a
            # sentence they already heard is cut; nothing left is the fallback.
            cut = cut_exact_repeats(final.say, ctx.said, mine)
            if not cut:
                final = replace(final, say=persona.fallback)
                notes.append("repeat → fallback")
            elif cut != final.say:
                final = replace(final, say=cut)
                notes.append("repeat: old sentences cut")
        elif wants is None and opts.repeat_guard and not first.withheld:
            # Not a repeat as a whole, but a sentence of it they heard word
            # for word (K-04: "… Personal queries are routed to Clippy." right
            # under the story's greeting): that sentence goes, the rest stays.
            cut = cut_exact_repeats(final.say, ctx.said, mine, min_words=4)
            if cut and cut != final.say:
                final = replace(final, say=cut)
                notes.append("old sentence cut")
        final = _scrub(persona, _finish(persona, final, ctx, req, stage, notes), memo_on, notes)
        _log_notes(persona, notes)
        await record(kind, trigger, used, completion, final, note=_notes(call_note, notes))
        return _done(persona, final, started, ctx, req)

    # -- the one retry ---------------------------------------------------------------------
    # The trace is persisted and fanned out: the first thought carries the
    # memo as it may be kept, as every other thought does.
    await record(kind, trigger, used, completion, _scrub(persona, first.reply, memo_on, notes), note=_notes(call_note, notes))
    _log_notes(persona, notes)
    note_ = stage_retry_message(first.rejected, req, why) if why else None
    if wants in ("withheld", "voice"):
        # (wave 42c) Told only which guard: neither his line nor their bait.
        note_ = guard_retry_message(first.problems, ctx.phase.stage, withheld=first.why if wants == "withheld" else "")
    retry_msgs = (
        build(retry=first.rejected, retry_note=note_)
        if kind == "voice"
        else used + [{"role": "system", "content": note_ or retry_message(first.rejected, str(req.get("text") or ""), ctx.phase.stage)}]
    )
    try:
        # A little hotter than the first call: at the house temperature the
        # model tends to write the rejected line again word for word.
        hotter = replace(model, temperature=min(RETRY_TEMPERATURE_MAX, (model.temperature or 0.0) + RETRY_TEMPERATURE_STEP))
        completion, call_note = await _complete_with_room(complete_fn, retry_msgs, hotter, persona.character)
    except LlmError as err:
        log.warning("%s: model failed on the retry (%s)", persona.character, err)
        if wants == "voice" and dm is not None:
            final, rnotes = voice_cut(persona, first.reply, dm)
            rnotes = ["retry failed → the first line cut", *rnotes]
        else:
            final = first.reply if wants == "repeat" else replace(first.reply, say=persona.fallback)
            rnotes = [f"retry failed → {'the first line' if wants == 'repeat' else 'fallback'}"]
        final = _scrub(persona, _finish(persona, final, ctx, req, stage, rnotes), memo_on, rnotes)
        _log_notes(persona, rnotes)
        await record("voice", "retry", retry_msgs, None, final, error=str(err), note=_notes(rnotes))
        return _done(persona, final, started, ctx, req)
    again = parse(completion)
    if again.wants_lookup:
        again = replace(again, say="", lookup=())
    again, settle_notes = await settle(again)
    second = guard_pass(persona, again, person, ctx.said, allowed, repeat_guard=opts.repeat_guard, may_retry=False, thread=mine, stage=ctx.phase.stage, house=house_text, gate=gate_context(req), dm=dm)
    rnotes = settle_notes + second.notes
    final = second.reply
    if not final.say:
        final = replace(final, say=persona.fallback)
        rnotes.append("retry empty → fallback")
    elif opts.repeat_guard and not second.withheld and repeats(final.say, ctx.said, mine):
        # Never word for word: a sentence he has already said is cut; a reply
        # that was nothing but old sentences is the fallback.
        cut = cut_exact_repeats(final.say, ctx.said, mine)
        first_cut = cut_exact_repeats(first.reply.say, ctx.said, mine) if not cut and wants == "repeat" else ""
        if not cut and first_cut:
            # The retry said nothing new either: the first line with only
            # what they already heard word for word cut (K-04: "i love you"
            # got the retry's stock deflection, then "…packet loss").
            final = replace(final, say=first_cut)
            rnotes.append("retry still repeats → the first line, old sentences cut")
        elif not cut:
            final = replace(final, say=persona.fallback)
            rnotes.append("retry still repeats → fallback")
        elif cut != final.say:
            final = replace(final, say=cut)
            rnotes.append("retry still repeats (old sentences cut)")
        else:
            rnotes.append("retry still repeats (sent)")
    if not final.memo and first.reply.memo and not second.withheld:
        # A withheld retry keeps no memo, not even the first line's (wave 32).
        final = replace(final, memo=first.reply.memo)
    final = _scrub(persona, _finish(persona, final, ctx, req, stage, rnotes), memo_on, rnotes)
    _log_notes(persona, rnotes)
    await record("voice", "retry", retry_msgs, completion, final, note=_notes(call_note, rnotes))
    return _done(persona, final, started, ctx, req)


def _log_notes(persona: Persona, notes: list[str]) -> None:
    """(wave 32) The guard notes at INFO, as the classic path logs them: a
    withheld line was visible only in the trace on the lean path. A note
    never carries the word that tripped a guard."""
    if notes:
        log.info("%s: guard: %s", persona.character, "; ".join(notes))


def _scrub(persona: Persona, reply: Reply, memo_on: bool, notes: list[str]) -> Reply:
    """Guard 5: the memo as it may be kept (none at all with the memo off)."""
    if not reply.memo:
        return reply
    if not memo_on:
        return replace(reply, memo="")
    memo, mnotes = scrub_memo(persona.secrets, reply.memo)
    notes.extend(mnotes)
    return replace(reply, memo=memo) if memo != reply.memo else reply


def _pooled(persona: Persona, reply: Reply, ctx: VoiceContext | None, req: dict[str, Any] | None) -> Reply:
    """The fixed fallback swapped for a line from the persona's `fallbacks`
    for his stage that this guest has not heard (`guards.pick_fallback`).
    (wave 32) On a stage line, one of the holding situation's own
    `fallbacks` (a line that closes the topic) when it has any."""
    if ctx is None or req is None or not persona.fallback or reply.say != persona.fallback:
        return reply
    stage = StageInfo.of(persona, req)
    if stage is not None and stage.pool:
        return replace(reply, say=stage.fallback())
    line = pick_fallback(persona, ctx.phase.stage, (*thread_replies(req), *ctx.said.to_them))
    return reply if line == reply.say else replace(reply, say=line)


def _failed(persona: Persona, ctx: VoiceContext, req: dict[str, Any], stage: "StageInfo | None") -> Reply:
    """The model failed: the fixed fallback in a private thread (as before),
    the scene's topic-closing line on the stage (wave 32)."""
    reply = Reply(say=persona.fallback)
    return _pooled(persona, reply, ctx, req) if stage is not None else reply


def _finish(persona: Persona, reply: Reply, ctx: VoiceContext, req: dict[str, Any], stage: "StageInfo | None", notes: list[str]) -> Reply:
    """The pooled fallback, and (wave 32) on a stage line the last net: a
    line that still fails `stage.problem` (a retry that fell foul too, a cut
    first line) is the scene's topic-closing line, never a second retry;
    then the manners crack where the scene asks for one."""
    if stage is not None and reply.say and not is_fallback(persona, reply.say):
        why = stage.problem(reply.say)
        if why:
            reply = replace(reply, say=persona.fallback)
            notes.append(f"stage {why} → fallback")
    reply = _pooled(persona, reply, ctx, req)
    if stage is not None and reply.say and not is_fallback(persona, reply.say):
        cracked = crack(reply.say, stage.seed_of("crack"), stage.crack)
        if cracked != reply.say:
            reply = replace(reply, say=cracked)
            notes.append("crack")
    return reply


def _done(persona: Persona, reply: Reply, started: float, ctx: VoiceContext | None = None, req: dict[str, Any] | None = None) -> Reply:
    if reply.empty:
        log.warning("%s: the model said nothing usable", persona.character)
        return _pooled(persona, Reply(say=persona.fallback), ctx, req)
    if not reply.say and not reply.acts:
        # Numbers but no words: silence is the worst thing to send a guest.
        return _pooled(persona, replace(reply, say=persona.fallback, lookup=()), ctx, req)
    log.info("%s: answered in %.1fs", persona.character, time.monotonic() - started)
    return reply
