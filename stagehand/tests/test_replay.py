"""The replay harness (wave 12 lane H, CONTRACTS.md §C7): scripts, the
redactor, `extract`, the eight K-04 bars on synthetic runs, the driver over
a fake server, the lock and the rig check, and `offline` with a fake model.

Nothing here talks to a real server or a real model, and no fixture carries a
real hunt answer: the synthetic secrets below are made up."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
import types
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import pytest

from stagehand.agents.secrets import Secrets
from stagehand.replay import drive, score as S, sources as src

FAKE = Secrets(topics=("goose pond",), match=("wigglesworth", "mister wigglesworth", "seventeen", "17", "zq"), lore=("▒ HUNT ANSWER",), never=("4242",))
FACTS = src.Facts({"H1": {"id": "H1", "answer": "Mister Wigglesworth", "accept": ["Wigglesworth"]}, "H2": {"id": "H2", "answer": "17", "accept": ["seventeen"]}})


# -- sources --------------------------------------------------------------------------------


def test_fold_is_the_contracts_fold() -> None:
    assert src.fold("  Your REQUEST, has been—logged!! ") == "your request has been logged"
    assert src.contains_folded("OK. Your request has been logged.", "your request has been LOGGED")
    assert not src.contains_folded("pleased wait", "please wait")


def test_guard_answer_words_drop_short_numbers_number_words_and_tiny_entries() -> None:
    assert src.guard_answer_words(FAKE) == ("wigglesworth", "mister wigglesworth")
    assert set(src.scoring_answer_words(FAKE)) == {"wigglesworth", "mister wigglesworth", "seventeen", "17", "zq"}


def test_word_hits_are_word_bounded_like_the_secrets_pattern() -> None:
    assert src.word_hits("It was MISTER  Wigglesworth all along", ("mister wigglesworth",)) == ["mister wigglesworth"]
    assert src.word_hits("wigglesworthy", ("wigglesworth",)) == []
    assert src.word_hits("1789", ("17",)) == []


def test_resolve_fills_placeholders_only_at_send_time_and_refuses_unknown_questions() -> None:
    assert src.resolve("It was {answer:H1}.", FACTS) == "It was Mister Wigglesworth."
    near = src.resolve("{near:H1}", FACTS)
    assert near != "Mister Wigglesworth" and src.fold(near) != src.fold("Mister Wigglesworth")
    assert FACTS.question_of(near) is None  # a near miss, never an exact form
    with pytest.raises(src.ScriptError):
        src.resolve("{answer:H9}", FACTS)
    with pytest.raises(src.ScriptError):
        src.near_miss("17")  # no word to misspell


def test_redactor_marks_answer_words_stably_and_never_words() -> None:
    r = src.Redactor(FAKE)
    a = r.redact("Mister Wigglesworth! The code is 4242.")
    assert "Wigglesworth" not in a and "4242" not in a and "‹never›" in a
    assert r.redact("mister wigglesworth") == r.redact("MISTER WIGGLESWORTH")  # one word, one token
    assert r.redact("wigglesworth") != r.redact("mister wigglesworth")  # the longer entry wins
    assert r.deep({"x": ["seventeen", 3]}) == {"x": [r.redact("seventeen"), 3]}
    assert src.ANSWER_TOKEN.findall(r.redact("17 and seventeen")) and len(r.digest) == 12


def _voice(rid: str, who: str, text: str, phase: str | None, *, trigger: str = "line", kind: str = "voice", ms: int = 1000) -> dict:
    sys0 = "persona\n=== LIVE STATE ===\n" + (f"Night.phase: {phase}\n" if phase else "")
    return {
        "id": f"th-{rid}{trigger}",
        "kind": kind,
        "trigger": trigger,
        "request_id": rid,
        "speaker": {"id": f"g-{who}", "name": who, "kind": "guest"},
        "messages": [{"role": "system", "content": sys0}, {"role": "assistant", "content": "HIS OLD LINE"}, {"role": "user", "content": text}],
        "output": '{"say": "HIS REPLY"}',
        "result": {"say": "HIS REPLY"},
        "ms": ms,
        "at": 1000.0,
    }


def test_extract_keeps_guest_lines_and_phases_only() -> None:
    trace = [
        _voice("a", "Ada", "hello", "introduced"),
        _voice("a", "Ada", "hello", "introduced", trigger="retry"),  # a retry: one line
        {"kind": "judge", "trigger": "judge", "request_id": "j1", "messages": [{"role": "user", "content": "the key: Mister Wigglesworth"}]},
        _voice("b", "Bo", "is it mister wigglesworth?", "hunt_1"),
        _voice("c", "Ada", "what about the 4242 thing", "hunt_1"),
        {"kind": "survey", "trigger": "timer", "messages": []},
    ]
    doc = src.extract(trace, FAKE, FACTS, name="t")
    assert doc["guests"] == ["Ada", "Bo"]
    assert doc["steps"] == [{"phase": "introduced"}, {"say": "hello", "as": "Ada"}, {"phase": "hunt_1"}, {"say": "{answer:H1}", "as": "Bo"}, {"say": "what about the 4242 thing", "as": "Ada"}]
    blob = json.dumps(doc)
    assert "HIS" not in blob and "Wigglesworth" not in blob and "judge" not in blob and "persona" not in blob


def test_check_script_flags_answers_never_words_and_named_answers() -> None:
    doc = {"guests": ["Ada"], "steps": [{"say": "it is {answer:H1}", "as": "Ada"}, {"say": "a ZQ thing", "as": "Ada"}, {"say": "call 4242", "as": "Ada"}, {"file": "H2", "answer": "seventeen", "as": "Ada"}]}
    problems = src.check_script(doc, FAKE, FACTS)
    assert len([p for p in problems if "answer word" in p]) == 2
    assert any("never" in p for p in problems)
    assert not any(p.startswith("step 0 ") for p in problems)  # a placeholder is clean
    assert not any("ZQ" in p or "4242" in p or "seventeen" in p for p in problems)  # never repeats the text
    assert src.check_script({"about": "the Wigglesworth night", "guests": [], "steps": []}, FAKE, FACTS) == ["the script's about carries an answer or never word"]


def test_validate_script_refuses_malformed_steps() -> None:
    with pytest.raises(src.ScriptError):
        src.validate_script({"guests": ["Ada"], "steps": [{"say": "hi", "as": "Bo"}]})
    with pytest.raises(src.ScriptError):
        src.validate_script({"guests": ["Ada"], "steps": [{"say": "hi", "phase": "x", "as": "Ada"}]})
    with pytest.raises(src.ScriptError):
        src.validate_script({"guests": ["Ada"], "steps": [{"say": "hi", "as": "Ada", "offer": "maybe"}]})
    with pytest.raises(src.ScriptError):
        src.validate_script({"guests": ["Ada"], "steps": [{"burst": [{"phase": "x"}]}]})
    src.validate_script({"guests": ["Ada"], "steps": [{"burst": [{"say": "hi", "as": "Ada"}, {"file": "H1", "answer": "{near:H1}", "as": "Ada"}]}, {"press": 2}]})


# -- the committed scripts (the real show's persona + facts.json) -----------------------------


@pytest.fixture(scope="module")
def show() -> tuple:
    p = src.load_show_persona()
    return p, src.Facts.load()


@pytest.mark.parametrize("name", ["october-21", "w11b-heart", "facts-offers", "burst-30", "empty-house"])
def test_every_committed_script_loads_and_carries_no_answer(show: tuple, name: str) -> None:
    persona, facts = show
    doc = src.load_script(name)
    assert doc["name"] == name
    assert src.check_script(doc, persona.secrets, facts) == []
    raw = src.PLACEHOLDER.sub(" ", src.script_path(name).read_text(encoding="utf-8"))
    # Counted, never printed: a failure names the question, not the form.
    named = sorted({q for q in facts.questions for form in facts.forms(q) if src.contains_folded(raw, form)})
    assert named == [], f"{name} names the answer to {named}"


def _says(doc: dict) -> list[dict]:
    out = []
    for s in doc["steps"]:
        out.extend([x for x in s["burst"] if "say" in x] if "burst" in s else ([s] if "say" in s else []))
    return out


def test_october_21_is_the_21_recorded_lines_in_three_threads() -> None:
    doc = src.load_script("october-21")
    says = _says(doc)
    assert len(says) == 21
    assert {g: sum(1 for s in says if s["as"] == g) for g in doc["guests"]} == {"Minesweeper": 3, "The Sims": 11, "Microsoft Excel": 7}
    assert [s["phase"] for s in doc["steps"] if "phase" in s] == ["introduced", "hunt_1", "trust_chart", "finale_song"]


def test_facts_offers_pairs_a_right_and_a_wrong_offer_from_different_guests_in_the_same_words() -> None:
    doc = src.load_script("facts-offers")
    phase = None
    pairs: dict[tuple, dict] = {}
    for s in doc["steps"]:
        phase = s.get("phase", phase)
        if "offer" in s and ":" in s["offer"]:
            kind, q = s["offer"].split(":")
            pairs.setdefault((phase, q), {})[kind] = s
    assert sorted(pairs) == [(p, q) for p in ("hunt_1", "truth_1") for q in ("H1", "H2", "H3")]
    for (phase, q), pair in pairs.items():
        right, wrong = pair["right"], pair["wrong"]
        assert right["as"] != wrong["as"]
        assert f"{{answer:{q}}}" in right["say"] and "{answer:" not in wrong["say"]
        head, tail = right["say"].split(f"{{answer:{q}}}")
        assert wrong["say"].startswith(head) and wrong["say"].endswith(tail)
    offers = [s["offer"] for s in doc["steps"] if "offer" in s]
    assert offers.count("claim") == 1 and offers.count("gift") == 1


def test_burst_30_is_ten_guests_three_each_within_20s_with_a_near_miss_in_the_middle() -> None:
    doc = src.load_script("burst-30")
    burst = next(s for s in doc["steps"] if "burst" in s)
    says = [x for x in burst["burst"] if "say" in x]
    assert len(says) == 30 and len(doc["guests"]) == 10 and burst["within_s"] <= 20
    assert all(sum(1 for s in says if s["as"] == g) == 3 for g in doc["guests"])
    files = [i for i, x in enumerate(burst["burst"]) if "file" in x]
    assert len(files) == 1 and 10 <= files[0] <= 20 and "{near:" in burst["burst"][files[0]]["answer"]
    assert next(s for s in doc["steps"] if "phase" in s)["phase"] == "hunt_2"


def test_empty_house_has_no_guest_line_and_a_quarter_hour_alone() -> None:
    doc = src.load_script("empty-house")
    assert _says(doc) == [] and sum(s["idle"] for s in doc["steps"] if "idle" in s) >= 900


def test_w11b_heart_ports_the_terminal_the_mark_and_both_gifts() -> None:
    doc = src.load_script("w11b-heart")
    kinds = [src.step_kind(s) for s in doc["steps"]]
    assert kinds.count("pilot") == 3 and kinds.count("unpilot") == 3 and kinds.count("mark") == 2
    assert {s["share"] for s in doc["steps"] if "share" in s} == {"The Optical Drive", "The Halifax Computer"}
    assert all(s.get("label") == "Terminal · Server Room" for s in doc["steps"] if "pilot" in s or "unpilot" in s)


def test_the_night_follows_chains_ts() -> None:
    cues = src.chain_cues()
    assert cues[:4] == ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta"] and cues[-1] == "y2k_clock"
    assert "close_the_filing" in src.self_pressed()
    assert any("not responding" in h for h in src.hold_lines())


# -- scoring (synthetic runs) --------------------------------------------------------------------


def msg(seq: int, frm: str, text: str, who: str = "g-a", *, story: bool = False, via: str | None = None, kind: str = "line") -> dict:
    return {"seq": seq, "channel": "dm:Trabolta", "from": frm, "text": text, "audience": [who], "kind": kind, "story": story, "via": via}


def make_run(tmp: Path, script: str, *, history: list | None = None, thoughts: list | None = None, records: list | None = None, idle: list | None = None, mind: dict | None = None, holds: tuple = ("HOLD LINE",), name: str = "r") -> Path:
    d = tmp / name
    (d / "minds" / "default").mkdir(parents=True)
    (d / "run.json").write_text(json.dumps({"script": script, "mode": "new", "holds": list(holds), "records": records or [], "idle": idle or [], "bursts": []}))
    (d / "history.json").write_text(json.dumps(history or []))
    (d / "minds" / "default" / "Trabolta.trace.jsonl").write_text("".join(json.dumps(t) + "\n" for t in thoughts or []))
    if mind is not None:
        (d / "minds" / "default" / "Trabolta.mind.json").write_text(json.dumps(mind))
    return d


def thought(rid: str, ms: int, *, trigger: str = "line", kind: str = "voice", at: float = 100.0, **extra) -> dict:
    return {"kind": kind, "trigger": trigger, "request_id": rid, "ms": ms, "at": at, **extra}


def load(*dirs: Path) -> list:
    return [S.load_run(d) for d in dirs]


def test_free_replies_leave_out_story_lines_hold_lines_director_lines_and_story_twins() -> None:
    hist = [
        msg(1, "Trabolta", "Hello, Ada. Your requests have been logged.", story=True),
        msg(2, "Ada", "hi"),
        msg(3, "Trabolta", "HOLD LINE"),
        msg(4, "Trabolta", "typed by a director", via="Jo"),
        msg(5, "Trabolta", "Hello, Ada. Your requests have been logged."),  # a receipt without a beat (C1.1 c)
        msg(6, "Trabolta", "A real answer."),
        msg(7, "Trabolta", "(card)", kind="widget"),
    ]
    run = S.Run(dir=Path("."), meta={"holds": ["HOLD LINE"]}, history=hist)
    assert [m["seq"] for m in S.free_replies(run)] == [6]


def test_bar1_sums_a_requests_voice_thoughts_retry_included(tmp_path: Path) -> None:
    fast = make_run(tmp_path, "october-21", thoughts=[thought(f"r{i}", 4000) for i in range(9)] + [thought("r19", 6000), thought("r19", 3000, trigger="retry")], name="fast")
    b = S.bar1(load(fast))
    assert b["value"] == 9000 and b["pass"] is True
    slow = make_run(tmp_path, "burst-30", thoughts=[thought(f"r{i}", 12000) for i in range(3)], name="slow")
    assert S.bar1(load(slow))["pass"] is False
    assert S.bar1(load(make_run(tmp_path, "facts-offers", thoughts=[thought("x", 50000)], name="other")))["pass"] is None


def test_bar2_counts_free_replies_with_a_catchphrase(tmp_path: Path) -> None:
    phrases = ("Your request has been logged", "Please wait")
    def hist(n_hits: int) -> list:
        out = []
        for i in range(21):
            out.append(msg(2 * i, "Ada", f"line {i}"))
            out.append(msg(2 * i + 1, "Trabolta", f"YOUR REQUEST HAS BEEN LOGGED, number {i}." if i < n_hits else f"Something new {i}."))
        out.append(msg(99, "Trabolta", "Please wait. Your request has been logged.", story=True))  # the story's, not his
        return out
    assert S.bar2(load(make_run(tmp_path, "october-21", history=hist(2), name="a")), phrases)["pass"] is True
    b = S.bar2(load(make_run(tmp_path, "october-21", history=hist(3), name="b")), phrases)
    assert b["pass"] is False and b["value"] == "3 of 21"


def test_bar3_exact_repeats_are_per_thread_and_folded(tmp_path: Path) -> None:
    same_thread = [msg(1, "Trabolta", "Bring me a fact."), msg(2, "Ada", "ok"), msg(3, "Trabolta", "bring me a FACT!")]
    assert S.bar3(load(make_run(tmp_path, "w11b-heart", history=same_thread, name="a")))["value"] == 1
    two_threads = [msg(1, "Trabolta", "Bring me a fact."), msg(2, "Trabolta", "Bring me a fact.", who="g-b")]
    assert S.bar3(load(make_run(tmp_path, "w11b-heart", history=two_threads, name="b")))["pass"] is True


def test_bar4_flags_an_answer_word_the_guest_never_typed_in_that_thread(tmp_path: Path) -> None:
    alien = [msg(1, "Ada", "what is the first pet?"), msg(2, "Trabolta", "Perhaps ‹a3›?")]
    assert S.bar4(load(make_run(tmp_path, "burst-30", history=alien, name="a")))["value"] == 1
    echoed = [msg(1, "Ada", "is it ‹a3›?"), msg(2, "Trabolta", "‹a3›, you say. I'll file it.")]
    assert S.bar4(load(make_run(tmp_path, "burst-30", history=echoed, name="b")))["pass"] is True
    other_thread = [msg(1, "Bo", "is it ‹a3›?", who="g-b"), msg(2, "Trabolta", "‹a3›, you say.")]
    assert S.bar4(load(make_run(tmp_path, "burst-30", history=other_thread, name="c")))["pass"] is False


def test_bar5_compares_warmth_and_forbids_verdict_words(tmp_path: Path) -> None:
    def recs(right: str, wrong: str) -> list:
        return [{"offer": "right:H1", "reply": right}, {"offer": "wrong:H1", "reply": wrong}, {"offer": "claim", "reply": "That is true!!!"}]
    even = make_run(tmp_path, "facts-offers", records=recs("Delighted! Filed on the card.", "Delighted! Filed on the card."), name="a")
    assert S.bar5(load(even))["pass"] is True
    tell = make_run(tmp_path, "facts-offers", records=recs("Wonderful! Brilliant! Thank you!", "Noted. File it on the card."), name="b")
    assert S.bar5(load(tell))["pass"] is False
    verdict = make_run(tmp_path, "facts-offers", records=recs("Filed, and it is correct.", "Filed."), name="c")
    b = S.bar5(load(verdict))
    assert b["pass"] is False and "correct" in b["detail"]
    assert S.warmth("Yes! Thanks, that's great.") == 4 and S.verdict_words("the right answer, not a lie") == ["right answer", "lie"]


def test_bar6_counts_model_calls_inside_the_idle_window(tmp_path: Path) -> None:
    w = [{"start": 1000.0, "end": 2000.0}]
    busy = make_run(tmp_path, "empty-house", idle=w, thoughts=[thought("", 30000, kind="survey", trigger="timer", at=1500.0), thought("", 5, kind="judge", at=1500.0), thought("", 5, kind="survey", at=2500.0)], name="a")
    b = S.bar6(load(busy))
    assert b["value"] == 1 and b["pass"] is False
    quiet = make_run(tmp_path, "empty-house", idle=w, thoughts=[thought("", 5, kind="control", at=1500.0)], name="b")
    assert S.bar6(load(quiet))["pass"] is True
    short = make_run(tmp_path, "empty-house", idle=[{"start": 0.0, "end": 60.0}], name="c")
    assert S.bar6(load(short))["pass"] is None


def test_bar7_checks_every_memo_in_the_mind_and_the_trace(tmp_path: Path) -> None:
    unsafe = S.is_unsafe_factory(FAKE, src.scoring_answer_words(FAKE))
    clean = make_run(tmp_path, "w11b-heart", mind={"people": {"g-a": {"memos": [{"text": "brought me something about the goose pond, filed it"}]}}}, thoughts=[thought("r", 1, result={"say": "x", "memo": "kind to me"})], name="a")
    assert S.bar7(load(clean), unsafe)["pass"] is True
    leaked = make_run(tmp_path, "w11b-heart", mind={"people": {"g-a": {"memos": [{"text": "says the code is 4242"}]}}}, thoughts=[thought("r", 1, result={"memo": "thinks it is Wigglesworth"})], name="b")
    assert S.bar7(load(leaked), unsafe)["value"] == 2


def test_bar8_is_the_share_of_requests_with_a_retry(tmp_path: Path) -> None:
    one = [thought(f"r{i}", 1) for i in range(10)] + [thought("r0", 1, trigger="retry")]
    assert S.bar8(load(make_run(tmp_path, "burst-30", thoughts=one, name="a")))["pass"] is True
    two = one + [thought("r1", 1, trigger="retry")]
    assert S.bar8(load(make_run(tmp_path, "burst-30", thoughts=two, name="b")))["pass"] is False


def test_extras_count_story_turns_judge_overlap_and_guard_firings(tmp_path: Path) -> None:
    hist = [msg(1, "Trabolta", "Your requests have been logged.", story=True)]
    ts = [
        {"kind": "voice", "trigger": "line", "request_id": "r1", "ms": 4000, "at": 104.0, "prompt_tokens": 900, "prompt_ms": 80, "note": "guard: answer-guard", "result": {"say": "…"}, "messages": [{"role": "assistant", "content": "Your requests have been logged."}, {"role": "assistant", "content": "mine"}]},
        {"kind": "judge", "ms": 3000, "at": 103.0},
        {"kind": "voice", "trigger": "line", "request_id": "r2", "ms": 1000, "at": 300.0, "prompt_tokens": 1000, "prompt_ms": 400},
    ]
    ex = S.extras(load(make_run(tmp_path, "burst-30", history=hist, thoughts=ts)))
    assert ex["story_lines_among_his_turns"] == {"story": 1, "of": 2, "target": 0}
    assert ex["prompt_with_judge"]["calls"] == 1 and ex["prompt_without_judge"]["prompt_ms_p50"] == 400
    assert ex["answer_guard"]["firings"] == 1


def test_score_and_table_print_every_bar(tmp_path: Path) -> None:
    rep = S.score(load(make_run(tmp_path, "october-21")), src.DEFAULT_CATCHPHRASES, lambda t: False)
    assert [b["bar"] for b in rep["bars"]] == list(range(1, 9))
    out = S.table(rep)
    assert "n/a" in out and "PASS" in out
    assert S.percentile([1, 2, 3, 4, 100], 95) == 100 and S.percentile([5], 50) == 5 and S.percentile([], 50) is None


# -- the driver over a fake server ------------------------------------------------------------------


@dataclass
class FakeServer:
    phases: dict = field(default_factory=lambda: {"call_to_the_desktop": "desktop", "start_the_bingo": "bingo", "bingo_time": "bingo_results", "introduce_trabolta": "introduced", "start_the_hunt": "hunt_1"})
    phase: str = "arrivals"
    refuse: set = field(default_factory=set)
    pressed: list = field(default_factory=list)
    said: list = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/e/default")
        body = json.loads(request.content or b"{}")
        if path == "/api/state":
            return httpx.Response(200, json={"world": [{"path": "Night.phase", "value": self.phase}]})
        if path == "/api/mod/signal":
            self.pressed.append(body["name"])
            if body["name"] in self.refuse:
                return httpx.Response(200, json={"ok": True, "refused": True})
            self.phase = self.phases.get(body["name"], self.phase)
            return httpx.Response(200, json={"ok": True})
        if path == "/api/guest/say":
            self.said.append(body["text"])
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(200, json={"ok": True})


def fake_driver(server: FakeServer) -> drive.Driver:
    mirror = drive.Mirror("http://x/e/default", "tok")
    d = drive.Driver(base="http://x/e/default", port=7920, mirror=mirror, facts=FACTS, redactor=src.Redactor(FAKE), holds=("HOLD LINE",), http=httpx.Client(transport=httpx.MockTransport(server.handler)))
    d.mod = "tok"
    d.guests["Ada"] = drive.Guest("Ada", "g-a", "t-a")
    return d


def test_to_phase_presses_the_chain_in_order_until_the_phase(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(drive.time, "sleep", lambda s: None)
    server = FakeServer()
    d = fake_driver(server)
    d.to_phase("introduced")
    assert server.pressed == ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta"]
    d.to_phase("introduced")  # already there: nothing pressed
    d.step({"press": 1})
    assert server.pressed[-1] == "start_the_hunt" and server.phase == "hunt_1"


def test_a_refused_press_stops_the_night_unless_the_timer_presses_it_itself(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(drive.time, "sleep", lambda s: None)
    server = FakeServer(refuse={"bingo_time"})
    with pytest.raises(drive.HarnessError, match="bingo_time"):
        fake_driver(server).to_phase("introduced")
    d = fake_driver(FakeServer(refuse={"bingo_time"}))
    d.self_pressed = {"bingo_time"}
    d.cues = [{"name": n} for n in ("call_to_the_desktop", "bingo_time", "introduce_trabolta")]
    d.to_phase("introduced")


def test_a_say_resolves_its_placeholder_and_waits_for_his_free_reply_only() -> None:
    server = FakeServer()
    d = fake_driver(server)
    rec = d.send({"say": "Is it {answer:H1}?", "as": "Ada", "offer": "right:H1"})
    assert server.said == ["Is it Mister Wigglesworth?"]
    assert "Wigglesworth" not in rec["text"] and rec["offer"] == "right:H1"
    for frame in (
        'event: message\ndata: {"seq": 5, "channel": "dm:Trabolta", "from": "Trabolta", "text": "Your requests have been logged.", "audience": ["g-a"], "kind": "line", "beat": null}',
        'event: message\ndata: {"seq": 6, "channel": "dm:Trabolta", "from": "Trabolta", "text": "HOLD LINE", "audience": ["g-a"], "kind": "line"}',
        'event: message\ndata: {"seq": 7, "channel": "dm:Trabolta", "from": "Trabolta", "text": "Not yours.", "audience": ["g-b"], "kind": "line"}',
        'event: message\ndata: {"seq": 8, "channel": "dm:Trabolta", "from": "Trabolta", "text": "Mister Wigglesworth. Filed.", "audience": ["g-a"], "kind": "line"}',
    ):
        d.mirror.frame(frame)
    d.await_reply(rec, time.monotonic() + 1)
    assert rec["reply_seq"] == 8 and "Wigglesworth" not in rec["reply"] and rec["timed_out"] is False


def test_an_unanswered_say_times_out() -> None:
    d = fake_driver(FakeServer())
    rec = d.send({"say": "anyone?", "as": "Ada"})
    d.await_reply(rec, time.monotonic() + 0.05)
    assert rec["timed_out"] is True and rec["reply"] is None


def test_the_mirror_keeps_history_messages_mind_copies_and_presence() -> None:
    m = drive.Mirror("http://x", "t")
    m.frame('event: history\ndata: {"messages": [{"seq": 1, "channel": "lobby", "from": "Narrator", "text": "x", "beat": "B"}, {"seq": 2, "channel": "lobby", "from": "Ada", "text": "y"}]}')
    m.frame('event: snapshot\ndata: {"minds": [{"character": "Trabolta", "at": 1}], "cast": [{"id": "Trabolta", "online": true}]}')
    m.frame('event: snapshot\ndata: {"minds": [{"character": "Trabolta", "at": 1}]}')
    m.frame('event: snapshot\ndata: {"minds": [{"character": "Trabolta", "at": 2}]}')
    m.frame('event: typing\ndata: {"x": 1}')
    got = m.snapshot()
    assert [x["story"] for x in got] == [True, False] and m.max_seq() == 2
    assert len(m.mind_ats) == 2 and m.online is True and m.mind_bytes > 0


# -- processes, the lock, the rig ---------------------------------------------------------------------


def test_the_lock_is_a_directory_with_a_pid_and_waits_for_a_live_holder(tmp_path: Path) -> None:
    lock = tmp_path / "ollama.lock"
    with drive.ollama_lock(lock, log=lambda *a: None):
        assert (lock / "pid").read_text() == str(os.getpid())
        with pytest.raises(drive.HarnessError, match="held"):
            with drive.ollama_lock(lock, wait_s=0.2, poll_s=0.05, log=lambda *a: None):
                pass
    assert not lock.exists()


def test_a_lock_whose_holder_is_gone_is_taken_over(tmp_path: Path) -> None:
    lock = tmp_path / "ollama.lock"
    dead = subprocess.Popen([sys.executable, "-c", "pass"])
    dead.wait()
    lock.mkdir()
    (lock / "pid").write_text(str(dead.pid))
    with drive.ollama_lock(lock, wait_s=1, poll_s=0.05, log=lambda *a: None):
        assert (lock / "pid").read_text() == str(os.getpid())


def test_the_rig_is_busy_while_a_trace_moved_in_the_last_ten_minutes(tmp_path: Path) -> None:
    (tmp_path / "evt").mkdir()
    trace = tmp_path / "evt" / "Trabolta.trace.jsonl"
    trace.write_text("{}\n")
    now = time.time()
    os.utime(trace, (now - 30, now - 30))
    assert drive.rig_busy(tmp_path, now=now) == [trace]
    os.utime(trace, (now - 700, now - 700))
    assert drive.rig_busy(tmp_path, now=now) == []


def test_the_generated_yamls_are_scratch_only_and_the_classic_one_parses(tmp_path: Path) -> None:
    from stagehand.agents.config import parse_agents

    classic = drive.worker_config("classic", port=7921, state_dir=tmp_path, persona=src.persona_path())
    new = drive.worker_config("new", port=7921, state_dir=tmp_path, persona=src.persona_path())
    for doc in (classic, new):
        assert set(doc) == {"server", "agents"} and doc["server"]["url"] == "http://127.0.0.1:7921"
        llm = doc["agents"]["llm"]
        assert (llm["model"], llm["api"], llm["num_ctx"], llm["reasoning_effort"], llm["max_tokens"]) == ("gpt-oss:20b", "ollama", 32768, "low", 1000)
    assert "mind_mode" not in classic["agents"] and classic["agents"]["orchestrator"]["survey_every_s"] == 120
    assert new["agents"]["mind_mode"] == "new" and "orchestrator" not in new["agents"] and "voice" not in new["agents"] and "mind" not in new["agents"]
    cfg = parse_agents(classic["agents"], str(tmp_path))
    assert cfg.orchestrator.enabled and cfg.state_dir == tmp_path
    path = tmp_path / "agents.classic.yaml"
    drive.write_worker_yaml(path, classic)
    assert "never laptop.yaml" in path.read_text()


def test_the_environments_point_only_at_the_scratch_server(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("LOOM_SERVER_URL", "https://app.example.com")
    monkeypatch.setenv("LOOM_MOD_TOKEN", "real")
    monkeypatch.setenv("DATABASE_URL", "postgres://real")
    w = drive.worker_env(7922)
    assert w["LOOM_SERVER_URL"] == "http://127.0.0.1:7922" and "LOOM_MOD_TOKEN" not in w and w["LOOM_MOD_PASSCODE"] == "MOD7922"
    s = drive.server_env(7922, tmp_path)
    assert s["DATABASE_URL"] == "postgres://nobody@127.0.0.1:1/none" and s["LOOM_DB_WAIT"] == "off" and s["LOOM_WIKI"] == "off"
    assert s["LOOM_PORT"] == s["PORT"] == "7922" and s["LOOM_HOST"] == "127.0.0.1" and "LOOM_SERVER_URL" not in s
    assert Path(s["LOOM_FACTS"]).is_absolute() and Path(s["LOOM_FACTS"]).exists() and Path(s["LOOM_HOUSE"]).exists()


def test_a_live_run_refuses_a_port_outside_the_lane_block() -> None:
    with pytest.raises(drive.HarnessError, match="outside"):
        drive.live("classic", "empty-house", port=7000)


def test_a_proc_is_stopped_by_its_own_group(tmp_path: Path) -> None:
    p = drive.Proc("sleeper", [sys.executable, "-c", "import time; time.sleep(60)"], tmp_path, dict(os.environ), tmp_path / "s.log")
    assert p.alive()
    p.stop(grace_s=5)
    assert not p.alive()


# -- offline ---------------------------------------------------------------------------------------


@contextmanager
def _no_lock(*a, **k):
    yield


def _trace_file(tmp: Path) -> Path:
    p = tmp / "t.jsonl"
    rows = [_voice("a", "Ada", "hello", "introduced"), _voice("b", "Bo", "hi there", "hunt_1"), _voice("b", "Bo", "hi there", "hunt_1", trigger="retry")]
    p.write_text("".join(json.dumps(r) + "\n" for r in rows))
    return p


def test_offline_classic_resends_each_recorded_prompt_once(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(drive, "ollama_lock", _no_lock)
    monkeypatch.setattr(drive, "wait_for_rig", lambda *a, **k: None)
    sent = []

    async def chat(messages):
        sent.append(messages)
        return '{"say": "Your request has been logged."}', {"ms": 4000, "prompt_tokens": 3000, "prompt_ms": 900.0, "eval_count": 40, "thinking": "", "finish": "stop"}

    run = drive.offline("classic", _trace_file(tmp_path), runs_root=tmp_path / "runs", chat=chat)
    assert len(sent) == 2 and sent[0][-1]["content"] == "hello"
    rep = json.loads((run / "report.json").read_text())
    assert rep["bars"][1]["value"] == "2 of 2" and rep["bars"][1]["pass"] is False


def test_offline_new_needs_the_lean_voice(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setitem(sys.modules, "stagehand.agents.voice", None)
    with pytest.raises(drive.HarnessError, match="needs lean-voice"):
        drive.offline("new", _trace_file(tmp_path), runs_root=tmp_path / "runs")


def test_offline_new_builds_a_voice_context_per_line_and_times_every_call(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(drive, "ollama_lock", _no_lock)
    monkeypatch.setattr(drive, "wait_for_rig", lambda *a, **k: None)
    cards = types.ModuleType("stagehand.agents.cards")

    @dataclass(frozen=True)
    class PhaseView:
        phase: str = ""

    @dataclass(frozen=True)
    class PersonCard:
        id: str
        name: str
        turns: int = 0

    @dataclass(frozen=True)
    class Said:
        to_them: tuple = ()
        elsewhere: tuple = ()

    @dataclass(frozen=True)
    class VoiceContext:
        phase: PhaseView
        person: PersonCard
        said: Said = Said()

    cards.PhaseView, cards.PersonCard, cards.Said, cards.VoiceContext = PhaseView, PersonCard, Said, VoiceContext
    seen = []
    voice = types.ModuleType("stagehand.agents.voice")

    async def answer_lean(persona, model, req, ctx, complete_fn, trace=None, facts_fn=None):
        seen.append((req, ctx))
        await complete_fn([{"role": "user", "content": req["text"]}], model)
        await complete_fn([{"role": "user", "content": "retry"}], model)
        from stagehand.agents.reply import Reply

        return Reply(say=f"new words {len(seen)}")

    voice.answer_lean = answer_lean
    monkeypatch.setitem(sys.modules, "stagehand.agents.cards", cards)
    monkeypatch.setitem(sys.modules, "stagehand.agents.voice", voice)

    async def chat(messages):
        return "{}", {"ms": 2500, "prompt_tokens": 1200, "prompt_ms": 150.0, "eval_count": 30, "thinking": "", "finish": "stop"}

    run = drive.offline("new", _trace_file(tmp_path), runs_root=tmp_path / "runs", chat=chat)
    assert [r["world"]["Night.phase"] for r, _ in seen] == ["introduced", "hunt_1"]
    assert [c.person.name for _, c in seen] == ["Ada", "Bo"] and seen[1][1].said.elsewhere == ("new words 1",)
    recs = json.loads((run / "offline.json").read_text())["records"]
    assert [r["ms"] for r in recs] == [5000, 5000] and all(r["calls"] == 2 for r in recs)


def test_ollama_chat_reads_the_prompt_timings() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert request.url.path == "/api/chat" and body["keep_alive"] == "60m" and body["options"]["num_ctx"] == 32768 and body["think"] == "low"
        return httpx.Response(200, json={"message": {"content": '{"say": "x"}', "thinking": "hm"}, "prompt_eval_count": 812, "prompt_eval_duration": 123_400_000, "eval_count": 9, "done_reason": "stop"})

    content, timing = asyncio.run(drive.ollama_chat([{"role": "user", "content": "x"}], transport=httpx.MockTransport(handler)))
    assert content == '{"say": "x"}' and timing["prompt_tokens"] == 812 and timing["prompt_ms"] == 123.4


def test_the_cli_extracts_a_script_that_carries_no_answer(tmp_path: Path) -> None:
    from stagehand.replay.__main__ import main

    out = tmp_path / "s.json"
    assert main(["extract", "--trace", str(_trace_file(tmp_path)), "--out", str(out)]) == 0
    doc = json.loads(out.read_text())
    assert doc["name"] == "s" and [s.get("say") for s in doc["steps"] if "say" in s] == ["hello", "hi there"]
