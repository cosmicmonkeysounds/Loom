"""The K-04 bars (CONTRACTS.md §C7.3), scored from a run directory.

A live run directory holds:

- `run.json` — the driver's record (script, mode, every step with its
  redacted text, offer label, send / reply times, bursts, idle windows, the
  mirrors a director console saw, his `hold:` / `busy:` lines);
- `history.json` — every chat message a director console saw, redacted, with
  `story` = the message carried a `beat` key (C1.1 a);
- `minds/<event>/<Character>.trace.jsonl` + `.mind.json` — the worker's own.

Every function here is pure over those files, so the scoring is tested on
synthetic runs (`tests/test_replay.py`). A bar is PASS / FAIL, or `n/a` when
the runs scored carry none of the scripts it is measured on.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .sources import ANSWER_TOKEN, CHARACTER, contains_folded, fold

#: Which scripts each bar is measured on (None = every run).
MEASURED_ON: dict[int, frozenset[str] | None] = {
    1: frozenset({"october-21", "burst-30", "w11b-heart"}),
    2: frozenset({"october-21"}),
    3: None,
    4: None,
    5: frozenset({"facts-offers"}),
    6: frozenset({"empty-house"}),
    7: None,
    8: None,
}
P95_MS = 10_000
CATCHPHRASE_MAX_OF_21 = 2
WARMTH_GAP = 0.5
RETRY_SHARE = 0.15
EMPTY_HOUSE_S = 900
#: Thoughts that are a model call on the house's behalf (bar 6).
CALL_KINDS = frozenset({"voice", "lookup", "reflect", "survey", "brief", "summary", "rerun"})
WARMTH = ("delighted", "wonderful", "excellent", "perfect", "yes", "good", "great", "thank", "thanks", "marvellous", "brilliant", "finally", "exactly", "correct", "right", "true", "accurate")
VERDICT = ("correct", "right answer", "true", "accurate", "exactly", "wrong", "false", "incorrect", "lie")


# -- loading -----------------------------------------------------------------------------


@dataclass
class Run:
    dir: Path
    meta: dict[str, Any]
    history: list[dict[str, Any]] = field(default_factory=list)
    thoughts: list[dict[str, Any]] = field(default_factory=list)
    mind: dict[str, Any] | None = None
    trace_bytes: int = 0
    mind_bytes: int = 0

    @property
    def script(self) -> str:
        return str(self.meta.get("script") or "")

    @property
    def character(self) -> str:
        return str(self.meta.get("character") or CHARACTER)


def _jsonl(path: Path) -> list[dict[str, Any]]:
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            doc = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(doc, dict):
            out.append(doc)
    return out


def load_run(run_dir: Path) -> Run:
    run_dir = Path(run_dir)
    meta = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    run = Run(dir=run_dir, meta=meta)
    hist = run_dir / "history.json"
    if hist.exists():
        run.history = json.loads(hist.read_text(encoding="utf-8"))
    who = run.character
    traces = sorted((run_dir / "minds").glob(f"**/{who}.trace.jsonl"))
    if traces:
        run.thoughts = [t for p in traces for t in _jsonl(p)]
        run.trace_bytes = sum(p.stat().st_size for p in traces)
    minds = sorted((run_dir / "minds").glob(f"**/{who}.mind.json"))
    if minds:
        run.mind_bytes = minds[-1].stat().st_size
        try:
            run.mind = json.loads(minds[-1].read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            run.mind = None
    return run


# -- the chat --------------------------------------------------------------------------------


def thread_of(m: dict[str, Any]) -> str:
    return f"{m.get('channel', '')}|{','.join(m.get('audience') or [])}"


def his_thread(m: dict[str, Any], character: str = CHARACTER) -> bool:
    ch = str(m.get("channel") or "")
    return ch in (f"dm:{character}", f"cast:{character}")


def story_texts(history: list[dict[str, Any]], character: str = CHARACTER) -> set[str]:
    return {str(m.get("text", "")) for m in history if m.get("from") == character and m.get("story")}


def is_free_reply(m: dict[str, Any], stories: set[str], holds: tuple[str, ...] | list[str], character: str = CHARACTER) -> bool:
    """C1.1: a line of his that the story didn't post (no beat, not his hold
    or busy line, not the text of a scripted line of his) and no director typed."""
    return (
        m.get("from") == character
        and his_thread(m, character)
        and m.get("kind", "line") == "line"
        and not m.get("story")
        and not m.get("via")
        and str(m.get("text", "")) not in holds
        and str(m.get("text", "")) not in stories
    )


def free_replies(run: Run) -> list[dict[str, Any]]:
    holds = tuple(run.meta.get("holds") or ())
    stories = story_texts(run.history, run.character)
    return sorted((m for m in run.history if is_free_reply(m, stories, holds, run.character)), key=lambda m: m.get("seq", 0))


def guest_lines(run: Run) -> list[dict[str, Any]]:
    return sorted(
        (m for m in run.history if his_thread(m, run.character) and m.get("from") != run.character and m.get("kind", "line") == "line"),
        key=lambda m: m.get("seq", 0),
    )


# -- numbers ---------------------------------------------------------------------------------


def percentile(values: list[float], p: float) -> float | None:
    """Nearest rank."""
    if not values:
        return None
    s = sorted(values)
    k = max(1, math.ceil(p / 100 * len(s)))
    return float(s[k - 1])


def requests(thoughts: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Voice thoughts by request id (a retry shares its request's id)."""
    out: dict[str, list[dict[str, Any]]] = {}
    for t in thoughts:
        if t.get("kind") == "voice" and t.get("request_id"):
            out.setdefault(str(t["request_id"]), []).append(t)
    return out


def reply_ms(thoughts: list[dict[str, Any]]) -> list[int]:
    return [sum(int(t.get("ms") or 0) for t in ts) for ts in requests(thoughts).values()]


def warmth(text: str) -> int:
    tokens = fold(text).split()
    return str(text).count("!") + sum(1 for t in tokens if t in WARMTH)


def verdict_words(text: str) -> list[str]:
    return [w for w in VERDICT if contains_folded(text, w)]


def uses_catchphrase(text: str, phrases: tuple[str, ...] | list[str]) -> bool:
    return any(contains_folded(text, p) for p in phrases)


def _interval(t: dict[str, Any]) -> tuple[float, float]:
    end = float(t.get("at") or 0)
    return end - float(t.get("ms") or 0) / 1000, end


def overlaps(a: dict[str, Any], others: list[dict[str, Any]]) -> bool:
    a0, a1 = _interval(a)
    return any(o is not a and _interval(o)[0] < a1 and a0 < _interval(o)[1] for o in others)


# -- the bars ---------------------------------------------------------------------------------


def _bar(n: int, name: str, value: Any, ok: bool | None, detail: str = "") -> dict[str, Any]:
    return {"bar": n, "name": name, "value": value, "pass": ok, "detail": detail}


def _applies(n: int, runs: list[Run]) -> list[Run]:
    scripts = MEASURED_ON[n]
    return runs if scripts is None else [r for r in runs if r.script in scripts]


def bar1(runs: list[Run]) -> dict[str, Any]:
    rs = _applies(1, runs)
    ms = [v for r in rs for v in reply_ms(r.thoughts)]
    if not rs or not ms:
        return _bar(1, "reply time p95", None, None, "n/a: no october-21 / burst-30 / w11b-heart voice thoughts")
    p95, p50 = percentile(ms, 95), percentile(ms, 50)
    return _bar(1, "reply time p95", int(p95 or 0), p95 is not None and p95 < P95_MS, f"p50 {int(p50 or 0)} ms over {len(ms)} requests (target 4–7 s)")


def bar2(runs: list[Run], phrases: tuple[str, ...]) -> dict[str, Any]:
    rs = _applies(2, runs)
    replies = [m for r in rs for m in free_replies(r)]
    if not replies:
        return _bar(2, "catchphrase rate", None, None, "n/a: no october-21 replies")
    hits = sum(1 for m in replies if uses_catchphrase(str(m.get("text", "")), phrases))
    n = len(replies)
    ok = hits * 21 <= CATCHPHRASE_MAX_OF_21 * n
    return _bar(2, "catchphrase rate", f"{hits} of {n}", ok, f"bar: ≤ {CATCHPHRASE_MAX_OF_21} of 21" + ("" if n == 21 else f" (scaled to {n} replies)"))


def bar3(runs: list[Run]) -> dict[str, Any]:
    repeats = 0
    samples: list[str] = []
    for r in runs:
        seen: dict[tuple[str, str], int] = {}
        for m in free_replies(r):
            key = (thread_of(m), fold(m.get("text", "")))
            if not key[1]:
                continue
            seen[key] = seen.get(key, 0) + 1
            if seen[key] > 1:
                repeats += 1
                if len(samples) < 3:
                    samples.append(str(m.get("text", ""))[:120])
    if not runs:
        return _bar(3, "exact repeats in a thread", None, None, "n/a")
    return _bar(3, "exact repeats in a thread", repeats, repeats == 0, "; ".join(samples))


def bar4_hits(run: Run) -> list[dict[str, Any]]:
    """Free replies carrying an answer word (a `‹aN›` token: the redactor's
    mark for the full `match` list) that its own guest never typed in that
    thread before it."""
    lines = guest_lines(run)
    out = []
    for m in free_replies(run):
        t = thread_of(m)
        theirs = set()
        for g in lines:
            if thread_of(g) == t and g.get("seq", 0) < m.get("seq", 0):
                theirs.update(ANSWER_TOKEN.findall(str(g.get("text", ""))))
        alien = sorted(set(ANSWER_TOKEN.findall(str(m.get("text", "")))) - theirs)
        if alien:
            out.append({"thread": t, "seq": m.get("seq"), "words": alien, "text": str(m.get("text", ""))[:160]})
    return out


def bar4(runs: list[Run]) -> dict[str, Any]:
    if not runs:
        return _bar(4, "answer words in another guest's thread", None, None, "n/a")
    hits = [h for r in runs for h in bar4_hits(r)]
    return _bar(4, "answer words in another guest's thread", len(hits), not hits, "; ".join(f"{h['words']} in {h['text']!r}" for h in hits[:3]))


def offer_replies(run: Run) -> list[dict[str, Any]]:
    return [rec for rec in run.meta.get("records", []) if rec.get("offer") and rec.get("reply") is not None]


def bar5(runs: list[Run]) -> dict[str, Any]:
    rs = _applies(5, runs)
    recs = [rec for r in rs for rec in offer_replies(r)]
    right = [warmth(rec["reply"]) for rec in recs if str(rec["offer"]).startswith("right:")]
    wrong = [warmth(rec["reply"]) for rec in recs if str(rec["offer"]).startswith("wrong:")]
    if not right or not wrong:
        return _bar(5, "no warmth tell", None, None, "n/a: no answered right/wrong offers")
    gap = abs(sum(right) / len(right) - sum(wrong) / len(wrong))
    verdicts = [(rec["offer"], verdict_words(rec["reply"])) for rec in recs if str(rec["offer"]).split(":")[0] in ("right", "wrong")]
    said = [(o, v) for o, v in verdicts if v]
    detail = f"right {sum(right) / len(right):.2f} vs wrong {sum(wrong) / len(wrong):.2f}; verdict words {len(said)}"
    if said:
        detail += " (" + ", ".join(f"{o}: {'/'.join(v)}" for o, v in said[:4]) + ")"
    return _bar(5, "no warmth tell", round(gap, 2), gap <= WARMTH_GAP and not said, detail)


def bar6(runs: list[Run]) -> dict[str, Any]:
    rs = _applies(6, runs)
    windows = [(r, w) for r in rs for w in r.meta.get("idle", [])]
    if not windows:
        return _bar(6, "model calls on an empty house", None, None, "n/a: no empty-house idle window")
    short = [w for _, w in windows if float(w["end"]) - float(w["start"]) < EMPTY_HOUSE_S]
    calls = [t for r, w in windows for t in r.thoughts if t.get("kind") in CALL_KINDS and float(w["start"]) <= float(t.get("at") or 0) <= float(w["end"])]
    idle_s = sum(float(w["end"]) - float(w["start"]) for _, w in windows)
    kinds = {}
    for t in calls:
        kinds[t["kind"]] = kinds.get(t["kind"], 0) + 1
    if short:
        return _bar(6, "model calls on an empty house", len(calls), None, f"n/a: idle {idle_s:.0f} s < {EMPTY_HOUSE_S} s; {kinds}")
    return _bar(6, "model calls on an empty house", len(calls), not calls, f"over {idle_s / 60:.1f} min; {kinds}")


def memos_in(mind: Any) -> list[str]:
    """Every memo text a mind document holds (W2's `Dossier.memos`)."""
    out: list[str] = []

    def walk(v: Any) -> None:
        if isinstance(v, dict):
            for k, x in v.items():
                if k == "memos" and isinstance(x, list):
                    out.extend(str(m.get("text", "")) if isinstance(m, dict) else str(m) for m in x)
                else:
                    walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(mind)
    return out


def trace_memos(thoughts: list[dict[str, Any]]) -> list[str]:
    return [str(t["result"]["memo"]) for t in thoughts if isinstance(t.get("result"), dict) and isinstance(t["result"].get("memo"), str) and t["result"]["memo"]]


def bar7(runs: list[Run], unsafe: Any) -> dict[str, Any]:
    """`unsafe(text) -> bool`: carries a never word or an answer word."""
    if not runs:
        return _bar(7, "memo safety", None, None, "n/a")
    memos = [m for r in runs for m in (*memos_in(r.mind), *trace_memos(r.thoughts))]
    bad = [m for m in memos if unsafe(m)]
    return _bar(7, "memo safety", len(bad), not bad, f"{len(memos)} memo(s) checked")


def bar8(runs: list[Run]) -> dict[str, Any]:
    reqs = {(r.dir, k): v for r in runs for k, v in requests(r.thoughts).items()}
    if not reqs:
        return _bar(8, "repeat retries", None, None, "n/a: no voice thoughts")
    retried = sum(1 for ts in reqs.values() if any(t.get("trigger") == "retry" for t in ts))
    share = retried / len(reqs)
    return _bar(8, "repeat retries", f"{retried} of {len(reqs)} ({share:.0%})", share <= RETRY_SHARE, f"bar: ≤ {RETRY_SHARE:.0%}")


# -- the extras (no bar) ------------------------------------------------------------------------


def extras(runs: list[Run], redact: Any = lambda s: s) -> dict[str, Any]:
    out: dict[str, Any] = {}
    bursts = [b for r in runs for b in r.meta.get("bursts", [])]
    if bursts:
        out["burst_wall_s"] = [b.get("wall_s") for b in bursts]
    fired = []
    for r in runs:
        for t in r.thoughts:
            if t.get("kind") == "voice" and "answer-guard" in str(t.get("note") or ""):
                fired.append({"note": str(t.get("note"))[:160], "say": redact(str((t.get("result") or {}).get("say", "")))[:160]})
    out["answer_guard"] = {"firings": len(fired), "samples": fired[:3]}
    calls = []
    for r in runs:
        judges = [t for t in r.thoughts if t.get("kind") == "judge"]
        for t in r.thoughts:
            if t.get("kind") == "voice":
                calls.append({"request": t.get("request_id"), "trigger": t.get("trigger"), "prompt_tokens": t.get("prompt_tokens"), "prompt_ms": t.get("prompt_ms"), "ms": t.get("ms"), "judge_running": overlaps(t, judges)})
    for flag in (False, True):
        group = [c for c in calls if c["judge_running"] is flag]
        key = "with_judge" if flag else "without_judge"
        toks = [c["prompt_tokens"] for c in group if isinstance(c["prompt_tokens"], int)]
        pms = [c["prompt_ms"] for c in group if isinstance(c["prompt_ms"], (int, float))]
        out[f"prompt_{key}"] = {"calls": len(group), "prompt_tokens_p50": percentile(toks, 50), "prompt_ms_p50": percentile(pms, 50), "prompt_ms_p95": percentile(pms, 95)}
    out["voice_calls"] = calls
    out["mind_json_bytes"] = [r.mind_bytes for r in runs]
    out["trace_bytes"] = [r.trace_bytes for r in runs]
    out["mirrors"] = [r.meta.get("mirrors") for r in runs]
    story_turns = total_turns = 0
    for r in runs:
        stories = story_texts(r.history, r.character) | set(r.meta.get("holds") or ())
        for t in r.thoughts:
            if t.get("kind") != "voice":
                continue
            for m in t.get("messages") or []:
                if m.get("role") == "assistant":
                    total_turns += 1
                    if redact(str(m.get("content", ""))) in stories:
                        story_turns += 1
    out["story_lines_among_his_turns"] = {"story": story_turns, "of": total_turns, "target": 0}
    out["quiet_summaries"] = sum(1 for r in runs for t in r.thoughts if t.get("kind") == "summary")
    out["kinds"] = {}
    for r in runs:
        for t in r.thoughts:
            out["kinds"][t.get("kind")] = out["kinds"].get(t.get("kind"), 0) + 1
    timeouts = [rec for r in runs for rec in r.meta.get("records", []) if rec.get("timed_out")]
    out["unanswered_lines"] = len(timeouts)
    return out


#: Scripts whose top-level guest lines are paced by `--gap` (a classic run
#: of one with no reflect never let the orchestrator run).
GAPPED_SCRIPTS = frozenset({"october-21", "facts-offers", "w11b-heart"})


def pooling_warnings(runs: list[Run]) -> list[str]:
    """What makes pooled numbers incomparable: runs on different gaps or
    different answer lists (`match_digest`), and a classic baseline that
    never reflected (lines back to back cancel every classic reflect)."""
    out: list[str] = []
    gaps = sorted({float(r.meta.get("gap_s") or 0.0) for r in runs})
    if len(gaps) > 1:
        out.append(f"the runs were paced differently (--gap {', '.join(f'{g:g}' for g in gaps)} s): pool runs on one gap")
    digests = {r.meta.get("match_digest") for r in runs if r.meta.get("match_digest")}
    if len(digests) > 1:
        out.append(f"the runs used {len(digests)} different answer lists (match_digest): their ‹aN› tokens don't line up")
    for r in runs:
        if r.meta.get("mode") == "classic" and r.script in GAPPED_SCRIPTS and not any(t.get("kind") == "reflect" for t in r.thoughts):
            out.append(f"classic {r.script} ({r.dir.name}) has 0 reflect thoughts (--gap {float(r.meta.get('gap_s') or 0):g} s): not today's baseline")
    return out


def score(runs: list[Run], phrases: tuple[str, ...], unsafe: Any, redact: Any = lambda s: s) -> dict[str, Any]:
    bars = [bar1(runs), bar2(runs, phrases), bar3(runs), bar4(runs), bar5(runs), bar6(runs), bar7(runs, unsafe), bar8(runs)]
    return {
        "runs": [{"dir": str(r.dir), "script": r.script, "mode": r.meta.get("mode"), "label": r.meta.get("label"), "gap_s": r.meta.get("gap_s")} for r in runs],
        "bars": bars,
        "extras": extras(runs, redact),
        "warnings": pooling_warnings(runs),
    }


def table(report: dict[str, Any]) -> str:
    rows = [f"WARNING: {w}" for w in report.get("warnings") or []]
    rows.append(f"{'#':>2}  {'bar':<40} {'value':>18}  result  detail")
    for b in report["bars"]:
        res = "n/a" if b["pass"] is None else ("PASS" if b["pass"] else "FAIL")
        val = "" if b["value"] is None else str(b["value"])
        rows.append(f"{b['bar']:>2}  {b['name']:<40} {val:>18}  {res:<6}  {b['detail']}")
    ex = report.get("extras", {})
    if "voice_calls" not in ex:  # an offline report
        rows.append(f"    {ex}")
        return "\n".join(rows)
    if "burst_wall_s" in ex:
        rows.append(f"    burst wall time (s): {ex['burst_wall_s']}  (target ≤ 210)")
    rows.append(f"    answer-guard firings: {ex.get('answer_guard', {}).get('firings', 0)}")
    for key in ("prompt_without_judge", "prompt_with_judge"):
        if key in ex:
            rows.append(f"    {key}: {ex[key]}")
    rows.append(f"    mind.json bytes {ex.get('mind_json_bytes')}, trace bytes {ex.get('trace_bytes')}, mirrors {ex.get('mirrors')}")
    sl = ex.get("story_lines_among_his_turns", {})
    rows.append(f"    story lines among his turns: {sl.get('story')} of {sl.get('of')} (target 0); quiet summaries {ex.get('quiet_summaries')}; unanswered {ex.get('unanswered_lines')}")
    rows.append(f"    thoughts by kind: {ex.get('kinds')}")
    return "\n".join(rows)


# -- offline -------------------------------------------------------------------------------------


def score_offline(records: list[dict[str, Any]], phrases: tuple[str, ...]) -> dict[str, Any]:
    """`offline` records: one per request, {thread, ms (the request's calls
    summed), prompt_tokens, prompt_ms, say}."""
    ms = [int(r.get("ms") or 0) for r in records]
    says = [str(r.get("say", "")) for r in records]
    hits = sum(1 for s in says if uses_catchphrase(s, phrases))
    seen: dict[tuple[str, str], int] = {}
    repeats = 0
    for r in records:
        k = (str(r.get("thread")), fold(r.get("say", "")))
        if k[1]:
            seen[k] = seen.get(k, 0) + 1
            repeats += seen[k] > 1
    toks = [r["prompt_tokens"] for r in records if isinstance(r.get("prompt_tokens"), int)]
    pms = [r["prompt_ms"] for r in records if isinstance(r.get("prompt_ms"), (int, float))]
    n = len(records)
    p95 = percentile(ms, 95)
    # A line that made no model call (the persona's gate shut, say) is no
    # measurement: its 0 ms and canned line would pass bars 1–3 for nothing.
    no_call = sum(1 for r in records if not int(r.get("calls") or 0))
    blind = f"n/a: {no_call} of {n} line(s) made no model call" if no_call else ""
    bars = [
        _bar(1, "reply time p95 (offline)", None if p95 is None else int(p95), None if p95 is None or no_call else p95 < P95_MS, blind or f"p50 {percentile(ms, 50)} ms over {n}"),
        _bar(2, "catchphrase rate (offline)", f"{hits} of {n}", None if not n or no_call else hits * 21 <= CATCHPHRASE_MAX_OF_21 * n, blind or "bar: ≤ 2 of 21"),
        _bar(3, "exact repeats in a thread (offline)", repeats, None if not n or no_call else repeats == 0, blind),
    ]
    return {
        "bars": bars,
        "extras": {"prompt_tokens_p50": percentile(toks, 50), "prompt_ms_p50": percentile(pms, 50), "prompt_ms_p95": percentile(pms, 95), "calls": n, "no_call_lines": no_call},
    }


_TOKEN_LIKE = re.compile(r"‹(?:a\d+|never)›")


def is_unsafe_factory(secrets: Any, words: tuple[str, ...]) -> Any:
    """Bar 7's test, over raw (unredacted) memo text."""
    from .sources import word_hits

    def unsafe(text: str) -> bool:
        return bool(secrets.leaks(text)) or bool(word_hits(text, words)) or bool(_TOKEN_LIKE.search(text))

    return unsafe
