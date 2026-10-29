"""Wave 12 shared shapes — frozen by the wave 12 contract §C3.5.

Byte-identical in every lane that adds it; nobody edits it in a lane.
The lean voice (voice.py) renders these; the story mind (module.py /
story_mind.py) builds them.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class PhaseView:
    phase: str = ""
    stage: str = ""
    stage_card: str = ""
    favours: str = "none"
    drives: dict[str, int] = field(default_factory=dict)
    #: None = every allowed power is live (no card applies).
    live_powers: tuple[str, ...] | None = None
    #: Codex titles he may tell in full right now (the card's `tell:`).
    tell: tuple[str, ...] = ()
    brief: str = ""
    #: "story" | "director"
    brief_by: str = "story"
    wary: tuple[str, ...] = ()


@dataclass(frozen=True)
class PersonCard:
    id: str
    name: str
    kind: str = "guest"
    faction: str | None = None
    #: Exchanges with this person before the one being answered.
    turns: int = 0
    #: The story's `them.trust`, verbatim; None when absent.
    trust: str | None = None
    location: str | None = None
    first_met: str = ""
    gifts: tuple[str, ...] = ()
    filings: tuple[str, ...] = ()
    marked: bool = False
    chart: str | None = None
    #: Already filtered: ≤ 6, oldest first, heart memos only at the heart.
    memos: tuple[str, ...] = ()
    summary: str = ""
    #: Their `them:` whitelisted vars, minus trust and marked.
    numbers: tuple[tuple[str, str], ...] = ()
    #: Titles they hold, already `secrets.visible`-filtered.
    holds: tuple[str, ...] = ()
    catchphrase_used: bool = False


@dataclass(frozen=True)
class Said:
    #: His last 3 free replies in this thread, oldest first.
    to_them: tuple[str, ...] = ()
    #: His last 5 sent lines in other threads, oldest first (unscrubbed;
    #: the renderer drops any carrying a never or answer word).
    elsewhere: tuple[str, ...] = ()


@dataclass(frozen=True)
class VoiceOptions:
    memo: bool = True
    repeat_guard: bool = True
    #: "lean" | "classic"
    layout: str = "lean"
    #: False while another request waits in the worker (a burst): no retry.
    retry_allowed: bool = True
    #: `voice.warm_head`: a one-token call with P1 + P2 first (lean, api: ollama).
    warm_head: bool = True
    #: (wave 42b) Brief mode: many lines queued behind this one (the frame's
    #: `queued` ≥ `voice.brief_at`): two short sentences, `brief_max_tokens`.
    brief: bool = False
    brief_max_tokens: int = 600


@dataclass(frozen=True)
class VoiceContext:
    phase: PhaseView
    person: PersonCard
    said: Said = field(default_factory=Said)
    #: ≤ 4 lines, already worded (the wave 12 contract §C3.4).
    since: tuple[str, ...] = ()
    whispers: tuple[str, ...] = ()
    options: VoiceOptions = field(default_factory=VoiceOptions)
