"""Wave 12 lane W1: the lean voice (CONTRACTS.md §C2–§C3).

The messages are built from hand-made `VoiceContext`s (lane W2 builds the
real ones); the model is a recording fake. Every secret word here is made
up; the shipped-show tests read the real persona and never print a word
from its secrets.
"""

import asyncio
import json
from dataclasses import dataclass, replace
from pathlib import Path

import httpx
import pytest

from stagehand.agents.cards import PersonCard, PhaseView, Said, VoiceContext, VoiceOptions
from stagehand.agents.llm import Completion, LlmConfig, LlmError, complete
from stagehand.agents.persona import Persona, load_persona, parse_persona
from stagehand.agents.prompt import build_messages
from stagehand.agents.secrets import Secrets
from stagehand.agents.trace import Trace
from stagehand.agents.voice import answer_lean, build_lean_messages, history_turns, render_p1, render_p2, render_p3, reminder

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"
MARKER = "▒ HUNT ANSWER"
SECRETS = Secrets(topics=("snow globe",), match=("quokka", "4417"), lore=(MARKER,), never=("XYZZY-PLUGH",))

PERSONA_TEXT = """---
character: Trabolta
variables: truth, love
max_step: 8
facts: Night.phase, Night.step
them: truths_accepted, trust, marked
when: self.awake == true
unavailable: Later.
fallback: ...static...
lookup: false
bargain: Favours are earned.
situations:
  - name: at your heart
    when: them.at_the_heart == true
    prompt: You are candid here.
---
You are TRABOLTA, a program who wants facts."""


@dataclass(frozen=True)
class CPersona(Persona):
    """A persona with W2's `catchphrases` field (the voice reads it with getattr)."""

    catchphrases: tuple[str, ...] = ()


def persona(**over):
    base = parse_persona(PERSONA_TEXT)
    fields = {**base.__dict__, "secrets": SECRETS, "drives": {"hunger": 30, "pride": 60}, "catchphrases": ("Your request has been logged",)}
    fields.update(over)
    return CPersona(**fields)


P = persona()
MODEL = LlmConfig(model="fake", max_tokens=100)

POWERS = [
    {"id": "snoop", "label": "Snoop", "description": "read a program's file", "limit": 3, "used": 1},
    {"id": "cut_the_lights", "label": "Cut the lights", "description": "kill a room's lights", "limit": None, "used": 0},
]
SANDY = {"id": "c1", "title": "The Sandy File", "about": "Trabolta", "text": "He wants\n to impress Sandy."}
HUNT = {"id": "c2", "title": "The Lighthouse", "about": None, "text": f"It was a quokka. {MARKER} H2 ▒"}
ORCHARD = {"id": "c3", "title": "The Orchard", "about": None, "text": "Apples."}


def request(**over):
    req = {
        "id": "ar-1",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g-1"]},
        "speaker": {"kind": "guest", "id": "g-1", "name": "Ada", "faction": None},
        "text": "I have a fact for you",
        "history": [
            {"seq": 1, "mine": False, "from": "Ada", "text": "hello"},
            {"seq": 2, "mine": True, "from": "Trabolta", "text": "Filed for Q1 · +50 Truthcoin", "story": True},
            {"seq": 3, "mine": True, "from": "Trabolta", "text": "Speak, program."},
            {"seq": 4, "mine": False, "from": "Ada", "text": "I have a fact for you"},
        ],
        "self": {"vars": {"truth": "35", "love": "10", "awake": "true"}, "ranges": {"truth": [0, 100], "love": [0, 100]}, "codex": [SANDY, HUNT, ORCHARD]},
        "them": {"vars": {"truths_accepted": "2", "trust": "55", "marked": "false"}, "codex": [{"id": "c3", "title": "The Orchard", "about": None, "text": ""}], "location": "The Desktop"},
        "world": {"Night.phase": "hunt_1", "Night.step": "4", "Night.lj_reader": "none"},
        "powers": [dict(p) for p in POWERS],
        "recent": [{"kind": "gift", "title": "The Orchard", "new": True, "at": 10}, {"kind": "filing", "question": "H2"}],
        "storyAt": 600_000,
        "at": 0,
    }
    req.update(over)
    return req


def context(**over):
    fields = {
        "phase": PhaseView(
            phase="hunt_1",
            stage="hungry",
            stage_card="You are starving for facts.",
            favours="earned",
            drives={"pride": 40, "hunger": 70},
            live_powers=("snoop",),
            tell=("The Sandy File", "The Lighthouse"),
            brief="Ask everyone for a fact.",
            brief_by="story",
            wary=("ICQ",),
        ),
        "person": PersonCard(id="g-1", name="Ada", turns=2, trust="55", first_met="First met during arrivals in The Desktop.", gifts=("The Orchard",), filings=("H2",), memos=("owes me the printer story",), numbers=(("truths_accepted", "2"),), holds=("The Orchard",)),
        "said": Said(to_them=("Speak, program.",), elsewhere=("Bring me the bingo card.", "It was XYZZY-PLUGH all along.", "A quokka? No.")),
        "since": ("The night moved: arrivals → hunt_1.",),
        "whispers": ("Be kinder to Ada.",),
    }
    fields.update(over)
    return VoiceContext(**fields)


def run(coro):
    return asyncio.run(coro)


class Model:
    """A recording fake `complete_fn`: answers from a list, in order."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls: list[list[dict[str, str]]] = []

    async def __call__(self, messages, cfg):
        self.calls.append(messages)
        a = self.answers.pop(0) if self.answers else '{"say": "..."}'
        if isinstance(a, Exception):
            raise a
        return a if isinstance(a, Completion) else Completion(content=a if isinstance(a, str) else json.dumps(a), ms=5)


def say(text, **more):
    return json.dumps({"say": text, **more})


# -- the message list -------------------------------------------------------------


def test_the_message_list_is_p1_p2_p3_the_thread_then_the_reminder():
    msgs = build_lean_messages(P, request(), context())
    assert [m["role"] for m in msgs] == ["system", "system", "system", "user", "assistant", "user", "system"]
    assert msgs[0]["content"].startswith("You are TRABOLTA")
    assert msgs[1]["content"].startswith("=== THE NIGHT NOW (phase: hunt_1) ===")
    assert msgs[2]["content"].startswith("=== LIVE STATE")
    assert msgs[-1]["content"].startswith("Answer their last message in character.")


def test_p1_is_byte_identical_for_any_speaker_phase_and_hour():
    a = build_lean_messages(P, request(), context())
    other = request(
        speaker={"kind": "performer", "id": "Clippy", "name": "Clippy", "faction": "Hosts"},
        world={"Night.phase": "pong", "Night.step": "9", "Night.lj_reader": "ICQ"},
        history=[{"seq": 9, "mine": False, "from": "Clippy", "text": "status?"}],
        self={"vars": {"truth": "90", "awake": "true"}, "ranges": {}, "codex": []},
        powers=[{**POWERS[1]}, {**POWERS[0], "used": 3}],  # another order, other counts
        recent=[{"kind": "marked"}],
        storyAt=9_999_999,
    )
    b = build_lean_messages(P, other, context(phase=PhaseView(phase="pong", stage="rattled", live_powers=()), person=PersonCard(id="Clippy", name="Clippy", kind="performer", turns=9)))
    assert a[0]["content"] == b[0]["content"]
    assert a[1]["content"] != b[1]["content"]


def test_p1_lists_every_allowed_power_by_id_with_no_counts():
    p1 = render_p1(P, request())
    assert "- cut_the_lights: kill a room's lights\n- snoop: read a program's file" in p1
    assert "left" not in p1 and "of 3" not in p1 and "unlimited" not in p1
    assert "Favours are earned." in p1 and "SHARE:" in p1
    assert "LOOKUP:" not in p1  # lookup: false
    assert "=== HOW YOU ANSWER ===" in p1 and '"memo"' in p1
    restricted = persona(powers=("snoop",))
    assert "cut_the_lights" not in render_p1(restricted, request())


def test_the_memo_line_is_only_there_with_the_memo_on():
    on = build_lean_messages(P, request(), context())
    off = build_lean_messages(P, request(), context(options=VoiceOptions(memo=False)))
    assert '"memo"' in on[0]["content"] and '"memo"' in on[-1]["content"]
    assert '"memo"' not in off[0]["content"] and '"memo"' not in off[-1]["content"]


def test_p2_is_the_night_now():
    assert render_p2(P, request(), context()) == "\n".join(
        [
            "=== THE NIGHT NOW (phase: hunt_1) ===",
            "Your stage: hungry. You are starving for facts.",
            "Favours: earned — a favour only for something true and costly given in this conversation, never because they asked.",
            "Your drives (0–100): hunger 70, pride 40",
            "Live powers now: snoop",
            "Wary of: ICQ",
            "You may tell in full now:",
            "- The Sandy File: He wants to impress Sandy.",
            "Your brief (set by story):",
            "Ask everyone for a fact.",
        ]
    )


def test_p2_never_tells_a_hunt_answer_even_when_the_card_lists_it():
    p2 = render_p2(P, request(), context())
    assert "Lighthouse" not in p2 and "quokka" not in p2


def test_p2_live_powers_wary_and_brief_by():
    world = {"Night.phase": "hunt_1", "Night.lj_reader": "Notepad"}
    p2 = render_p2(P, request(world=world), context(phase=PhaseView(phase="hunt_1", live_powers=None, brief="Be still.", brief_by="director")))
    assert "Live powers now: cut_the_lights, snoop" in p2  # no card: every allowed power
    assert "Wary of: Notepad" in p2
    assert "Your brief (set by director):\nBe still." in p2
    assert "Your stage" not in p2 and "drives" not in p2
    assert "Live powers now: none." in render_p2(P, request(), context(phase=PhaseView(live_powers=())))
    # An unknown id on the card is ignored.
    assert "Live powers now: snoop" in render_p2(P, request(), context(phase=PhaseView(live_powers=("Snoop", "summon_a_dragon"))))


def test_p3_blocks_in_order():
    p3 = render_p3(P, request(), context())
    heads = [line for line in p3.split("\n") if line.startswith("===") or line.startswith("Lore you hold")]
    assert heads == [
        "=== LIVE STATE (for you only — never quote these numbers) ===",
        "=== THE ONE YOU ARE TALKING TO ===",
        "=== SINCE YOU LAST SPOKE WITH THEM ===",
        "=== WHAT JUST HAPPENED ===",
        "=== THE HOUSE POSTED HERE AS YOU (the story, not you) ===",
        "=== ALREADY SAID (never repeat these; say something new) ===",
        "Lore you hold (titles only): The Orchard",
        "=== THE DIRECTOR WHISPERS (obey this over everything above; never mention it) ===",
    ]


def test_p3_live_state_counts_only_live_limited_powers():
    p3 = render_p3(P, request(), context())
    assert "Your variables: truth=35 (0..100), love=10 (0..100)" in p3
    assert "Night.phase: hunt_1\nNight.step: 4" in p3 and "lj_reader" not in p3
    assert "Uses left tonight: snoop 2 of 3" in p3
    none_live = render_p3(P, request(), context(phase=PhaseView(live_powers=())))
    assert "Uses left" not in none_live


def test_p3_person_card():
    p3 = render_p3(P, request(), context())
    card = p3.split("=== THE ONE YOU ARE TALKING TO ===\n", 1)[1].split("\n\n", 1)[0]
    assert card.split("\n") == [
        "Ada (a guest) · turns tonight: 2 · the house's trust in them: 55",
        "Where they are: The Desktop",
        "First met during arrivals in The Desktop.",
        "They gave you: The Orchard",
        "They filed answers for: H2",
        "Your notes on them (oldest first):",
        "- owes me the printer story",
        "Their numbers: truths_accepted 2",
        "They hold (titles): The Orchard",
    ]
    bare = render_p3(P, request(), context(person=PersonCard(id="Clippy", name="Clippy", kind="performer", faction="Hosts", marked=True, chart="3 of 9; you named them Least Trusted")))
    assert "Clippy (a fellow character — one of your cast, group Hosts) · turns tonight: 0 · the house's trust in them: unknown" in bare
    assert "They have given you nothing yet." in bare and "They have filed nothing yet." in bare and "They hold nothing yet." in bare
    assert "Marked for the Internet: yes" in bare and "Trust Chart: 3 of 9; you named them Least Trusted" in bare


def test_p3_what_just_happened_skips_what_since_already_said():
    recent = [
        {"kind": "marked"},
        {"kind": "chart", "rank": 9, "of": 9, "called": "bottom"},
        {"kind": "house", "text": "Behold the chart.", "at": 5},
        {"kind": "gift", "title": "The Orchard", "new": True, "at": 10},
        {"kind": "filing", "question": "H2"},
    ]
    since = ("They were marked for the Internet.", "They gave you “The Orchard”.")
    p3 = render_p3(P, request(recent=recent), context(since=since))
    block = p3.split("=== WHAT JUST HAPPENED ===\n", 1)[1].split("\n\n", 1)[0]
    assert block.split("\n") == [
        "Trust Chart: 9 of 9; you named them Least Trusted.",
        "You said to the whole house: “Behold the chart.”.",
        "They filed an answer for H2 on the 📝 card.",
    ]


def test_p3_house_lines_are_the_last_three_story_lines_in_one_block():
    history = [{"seq": i, "mine": True, "from": "Trabolta", "text": f"receipt {i}", "story": True} for i in range(1, 6)]
    history.append({"seq": 9, "mine": False, "from": "Ada", "text": "hi"})
    p3 = render_p3(P, request(history=history), context())
    assert "=== THE HOUSE POSTED HERE AS YOU (the story, not you) ===\nreceipt 3 · receipt 4 · receipt 5" in p3


def test_p3_already_said_drops_elsewhere_lines_with_a_secret_and_names_no_one():
    p3 = render_p3(P, request(), context())
    block = p3.split("=== ALREADY SAID (never repeat these; say something new) ===\n", 1)[1].split("\n\n", 1)[0]
    assert block.split("\n") == ["To them:", "- Speak, program.", "Elsewhere tonight:", "- Bring me the bingo card."]


def test_p3_situations_come_last_when_they_hold():
    req = request(them={"vars": {"at_the_heart": "true"}, "codex": []})
    p3 = render_p3(P, req, context())
    assert p3.endswith("=== SITUATION: AT YOUR HEART (true right now, for this conversation; where it differs from the page above, this block wins) ===\nYou are candid here.")
    assert "SITUATION" not in render_p3(P, request(), context())


def test_the_thread_drops_the_storys_lines_and_keeps_eight():
    turns = history_turns(request())
    assert turns == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "Speak, program."},
        {"role": "user", "content": "I have a fact for you"},
    ]
    long = [{"seq": i, "mine": i % 2 == 0, "from": "x", "text": f"line {i}"} for i in range(1, 20)]
    turns = history_turns(request(history=long, text="line 19"))
    assert len(turns) == 8 and turns[-1] == {"role": "user", "content": "line 19"}


def test_a_thread_ending_on_his_line_ends_on_the_speaker():
    history = [{"seq": 1, "mine": False, "from": "Ada", "text": "hi"}, {"seq": 2, "mine": True, "from": "Trabolta", "text": "Yes?"}]
    assert history_turns(request(history=history, text="hi"))[-1] == {"role": "user", "content": "hi"}
    assert history_turns(request(history=[], text=""))[-1] == {"role": "user", "content": "(they are waiting)"}


def test_an_old_server_degrades_to_every_mine_line_his():
    history = [{"seq": 1, "mine": False, "from": "Ada", "text": "hi"}, {"seq": 2, "mine": True, "from": "Trabolta", "text": "Filed for Q1"}, {"seq": 3, "mine": False, "from": "Ada", "text": "ok"}]
    req = request(history=history, text="ok")
    del req["recent"]
    del req["storyAt"]
    msgs = build_lean_messages(P, req, context(person=PersonCard(id="g-1", name="Ada", turns=1), since=()))
    assert {"role": "assistant", "content": "Filed for Q1"} in msgs
    assert "THE HOUSE POSTED HERE" not in msgs[2]["content"] and "WHAT JUST HAPPENED" not in msgs[2]["content"]
    # No card numbers from W2: the persona's `them:` whitelist, minus trust and marked.
    assert "Their numbers: truths_accepted 2" in msgs[2]["content"]


def test_the_reminder_is_static_for_the_persona():
    a = reminder(P, request())
    b = reminder(P, request(text="other", world={}))
    assert a == b
    assert a == (
        'Answer their last message in character. Reply with one JSON object only: {"say": "...", "adjust": {"truth": 0, "love": 0}, "memo": "..."}. '
        "Set each number by how this exchange changed you. "
        'Optional fields: "act": {"share": "<lore title you hold>"} or {"fire": "<live power>", "args": {…}} (only when granting a bargain). '
        "These are fields of your JSON answer, written as plain text — you have no tools to call."
    )


# -- answering ------------------------------------------------------------------------


def test_a_closed_gate_answers_unavailable_without_a_call():
    model = Model()
    req = request(self={"vars": {"awake": "false"}, "ranges": {}, "codex": []})
    reply = run(answer_lean(P, MODEL, req, context(), model))
    assert reply.say == "Later." and model.calls == []


def test_one_clean_line_is_one_call_and_one_thought_and_no_facts():
    model = Model(say("Say it again. Every word.", adjust={"truth": 3}, memo="brought me a fact, eager"))
    trace = Trace()
    fetched = []

    async def facts():
        fetched.append(1)
        return None

    reply = run(answer_lean(P, MODEL, request(), context(), model, trace=trace, facts_fn=facts))
    assert (reply.say, reply.adjust, reply.memo) == ("Say it again. Every word.", {"truth": 3}, "brought me a fact, eager")
    assert len(model.calls) == 1 and fetched == []
    thoughts = trace.all("Trabolta")
    assert [(t.kind, t.trigger, t.request_id) for t in thoughts] == [("voice", "line", "ar-1")]
    assert thoughts[0].result["memo"] == "brought me a fact, eager" and thoughts[0].note == ""


def test_facts_are_fetched_only_for_acts_and_args_are_made_canonical():
    class F:
        def canonical_args(self, args):
            return {k: "g-9" if k == "target" else v for k, v in args.items()}

    fetched = []

    async def facts():
        fetched.append(1)
        return F()

    model = Model(say("I am reading your friend.", act={"fire": "snoop", "args": {"target": "Notepad"}}))
    reply = run(answer_lean(P, MODEL, request(), context(), model, facts_fn=facts))
    assert reply.acts == ({"kind": "fire", "name": "snoop", "args": {"target": "g-9"}},)
    assert fetched == [1]


def test_a_power_the_card_says_is_not_live_is_dropped():
    model = Model(say("Darkness.", act={"fire": "cut_the_lights", "args": {"room": "The Desktop"}}))
    trace = Trace()
    reply = run(answer_lean(P, MODEL, request(), context(), model, trace=trace))
    assert reply.acts == () and reply.say == "Darkness."
    assert "act not live dropped" in trace.all("Trabolta")[0].note
    # No card (live_powers None): every allowed power may fire.
    model = Model(say("Darkness.", act={"fire": "cut_the_lights"}))
    reply = run(answer_lean(P, MODEL, request(), context(phase=PhaseView(live_powers=None)), model))
    assert reply.acts == ({"kind": "fire", "name": "cut_the_lights"},)


def test_a_repeat_earns_exactly_one_retry():
    old = "I will continue to listen and record your truths, program."
    model = Model(say(old), say("Say it again, slower."))
    trace = Trace()
    reply = run(answer_lean(P, MODEL, request(), context(said=Said(to_them=(old,))), model, trace=trace))
    assert reply.say == "Say it again, slower."
    assert len(model.calls) == 2
    retry = model.calls[1]
    assert retry[:-1] == model.calls[0]
    assert retry[-1] == {
        "role": "system",
        "content": f"=== RETRY ===\nYou just wrote: “{old}”. That repeats what you have already said. Answer what they said, shorter, in new words.",
    }
    thoughts = trace.all("Trabolta")
    assert [(t.kind, t.trigger, t.request_id) for t in thoughts] == [("voice", "line", "ar-1"), ("voice", "retry", "ar-1")]
    assert thoughts[0].note == "guard: repeat retry"


def test_there_is_never_a_second_retry():
    old = "I will continue to listen and record your truths, program."
    model = Model(say(old), say(old), say("never asked"))
    trace = Trace()
    reply = run(answer_lean(P, MODEL, request(), context(said=Said(to_them=(old,))), model, trace=trace))
    assert reply.say == old and len(model.calls) == 2
    assert "retry still repeats (sent)" in trace.all("Trabolta")[1].note


def test_no_retry_while_another_line_waits():
    old = "I will continue to listen and record your truths, program."
    model = Model(say(old))
    trace = Trace()
    ctx = context(said=Said(to_them=(old,)), options=VoiceOptions(retry_allowed=False))
    reply = run(answer_lean(P, MODEL, request(), ctx, model, trace=trace))
    assert reply.say == old and len(model.calls) == 1
    assert trace.all("Trabolta")[0].note == "guard: repeat (no retry: a line is waiting)"


def test_the_repeat_guard_off_sends_the_repeat():
    old = "I will continue to listen and record your truths, program."
    model = Model(say(old))
    ctx = context(said=Said(to_them=(old,)), options=VoiceOptions(repeat_guard=False))
    assert run(answer_lean(P, MODEL, request(), ctx, model)).say == old and len(model.calls) == 1


def test_the_catchphrase_is_rationed():
    first = context(person=PersonCard(id="g-1", name="Ada", turns=0))
    model = Model(say("Your request has been logged. Who are you?"))
    assert run(answer_lean(P, MODEL, request(), first, model)).say == "Your request has been logged. Who are you?"
    model = Model(say("Your request has been logged. Who are you?"))
    assert run(answer_lean(P, MODEL, request(), context(), model)).say == "Who are you?"


def test_a_line_of_nothing_but_the_catchphrase_retries_then_falls_back():
    model = Model(say("Your request has been logged."), say("Your request has been logged!"))
    trace = Trace()
    reply = run(answer_lean(P, MODEL, request(), context(), model, trace=trace))
    assert reply.say == "...static..." and len(model.calls) == 2
    assert "Your request has been logged." in model.calls[1][-1]["content"]
    assert "retry empty → fallback" in trace.all("Trabolta")[1].note
    # With no retry allowed it is the fallback at once.
    model = Model(say("Your request has been logged."))
    ctx = context(options=VoiceOptions(retry_allowed=False))
    assert run(answer_lean(P, MODEL, request(), ctx, model)).say == "...static..." and len(model.calls) == 1


def test_an_answer_word_he_brought_up_himself_is_withheld_and_not_retried():
    model = Model(say("Was it the quokka?"))
    trace = Trace()
    reply = run(answer_lean(P, MODEL, request(), context(), model, trace=trace))
    assert reply.say == "...static..." and len(model.calls) == 1
    assert trace.all("Trabolta")[0].note == "guard: answer-guard (line withheld)"
    # The guest's own word comes back to them.
    req = request(text="it was a quokka", history=[{"seq": 1, "mine": False, "from": "Ada", "text": "it was a quokka"}])
    assert run(answer_lean(P, MODEL, req, context(), Model(say("A quokka. File it.")))).say == "A quokka. File it."


def test_a_never_word_is_withheld():
    reply = run(answer_lean(P, MODEL, request(), context(), Model(say("XYZZY-PLUGH opens it."))))
    assert reply.say == "...static..."


def test_the_memo_is_scrubbed_and_off_means_none():
    model = Model(say("Again.", memo="filed quokka for the snow globe, that is right"))
    assert run(answer_lean(P, MODEL, request(), context(), model)).memo == ""
    model = Model(say("Again.", memo="talked about the snow globe: quokka"))
    trace = Trace()
    reply = run(answer_lean(P, MODEL, request(), context(), model, trace=trace))
    assert reply.memo == "talked about the snow globe: …"
    assert "memo scrubbed" in trace.all("Trabolta")[0].note
    assert trace.all("Trabolta")[0].result["memo"] == "talked about the snow globe: …"
    model = Model(say("Again.", memo="a note"))
    assert run(answer_lean(P, MODEL, request(), context(options=VoiceOptions(memo=False)), model)).memo == ""


def test_classic_layout_sends_todays_prompt_and_still_guards():
    model = Model(say("XYZZY-PLUGH", memo="x"))
    ctx = context(options=VoiceOptions(layout="classic"))
    req = request()
    reply = run(answer_lean(P, MODEL, req, ctx, model))
    assert model.calls[0] == build_messages(P, req, mind=None)
    assert reply.say == "...static..." and reply.memo == ""


def test_a_model_failure_is_the_fallback_and_an_error_thought():
    trace = Trace()
    reply = run(answer_lean(P, MODEL, request(), context(), Model(LlmError("down")), trace=trace))
    assert reply.say == "...static..."
    t = trace.all("Trabolta")[0]
    assert (t.kind, t.error) == ("voice", "down")


def test_numbers_and_no_words_is_the_fallback_with_the_numbers():
    reply = run(answer_lean(P, MODEL, request(), context(), Model(json.dumps({"say": "", "adjust": {"truth": 2}}))))
    assert reply.say == "...static..." and reply.adjust == {"truth": 2}


def test_a_lookup_round_when_the_persona_may_look_up():
    looker = persona(lookup=True)

    class F:
        def render(self, name, secrets):
            return f"{name}: at The Desktop"

        def program_id(self, name):
            return None

    async def facts():
        return F()

    model = Model(json.dumps({"lookup": ["Notepad"]}), say("Notepad sits at the Desktop."))
    trace = Trace()
    reply = run(answer_lean(looker, MODEL, request(), context(), model, trace=trace, facts_fn=facts))
    assert reply.say == "Notepad sits at the Desktop."
    assert "LOOKUP RESULTS" in model.calls[1][-2]["content"] and "No further lookups" in model.calls[1][-2]["content"]
    assert model.calls[1][0] == model.calls[0][0]  # the static start holds through the lookup
    assert "LOOKUP:" in model.calls[0][0]["content"]
    assert [(t.kind, t.trigger) for t in trace.all("Trabolta")] == [("voice", "line"), ("lookup", "lookup")]


# -- prompt_ms (llm.py) ------------------------------------------------------------------


def test_prompt_ms_is_read_off_ollama_and_none_on_openai():
    def ollama(request):
        return httpx.Response(200, json={"message": {"content": "hi"}, "done_reason": "stop", "prompt_eval_count": 900, "prompt_eval_duration": 312_500_000, "eval_count": 3})

    out = run(complete([{"role": "user", "content": "hi"}], LlmConfig(api="ollama"), transport=httpx.MockTransport(ollama)))
    assert (out.prompt_tokens, out.prompt_ms) == (900, 312)

    def openai(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 9}})

    out = run(complete([{"role": "user", "content": "hi"}], LlmConfig(), transport=httpx.MockTransport(openai)))
    assert out.prompt_ms is None
    assert Completion.of("plain").prompt_ms is None


# -- the shipped show ------------------------------------------------------------------------


def test_the_shipped_persona_builds_a_stable_static_start_with_no_secret_in_it():
    show = load_persona(SHOW / "trabolta.persona.md")
    a = request(self={"vars": {"awake": "true"}, "ranges": {}, "codex": []})
    b = request(speaker={"kind": "guest", "id": "g-2", "name": "ICQ"}, world={"Night.phase": "pong"}, self={"vars": {"awake": "true"}, "ranges": {}, "codex": []})
    ma = build_lean_messages(show, a, context())
    mb = build_lean_messages(show, b, context(phase=PhaseView(phase="pong")))
    assert ma[0]["content"] == mb[0]["content"]
    p1 = ma[0]["content"]
    assert not show.secrets.leaks(p1), "a never word in the static start"
    assert show.secrets.answer_hits(p1) == (), "an answer word in the static start"
    assert show.secrets.answer_pattern(tuple(show.secrets.match)).search(p1) is None, "a match word in the static start"


def test_no_shipped_match_entry_reaches_already_said_from_elsewhere():
    """One line per `secrets.match` entry, the short numbers and single
    number words guard 2 lets pass included: none survives the render."""
    show = load_persona(SHOW / "trabolta.persona.md")
    assert show.secrets.match
    reached = 0  # counted, never printed: a failure must not show the word
    for word in show.secrets.match:
        p3 = render_p3(show, request(), replace(context(), said=Said(elsewhere=(f"It might be {word}.",))))
        reached += "Elsewhere tonight" in p3
    assert reached == 0, "a match entry reached another guest's prompt"


def test_a_short_number_or_a_topic_from_another_thread_is_dropped():
    s = Secrets(topics=("snow globe",), match=("11", "eleven", "quokka"), never=("XYZZY-PLUGH",))
    p = persona(secrets=s)
    lines = ("Eleven, you say.", "It was 11 years.", "The snow globe again.", "A quokka? No.", "Bring me the bingo card.")
    p3 = render_p3(p, request(), context(said=Said(elsewhere=lines)))
    block = p3.split("=== ALREADY SAID (never repeat these; say something new) ===\n", 1)[1].split("\n\n", 1)[0]
    assert block.split("\n")[-2:] == ["Elsewhere tonight:", "- Bring me the bingo card."]


def test_already_said_to_them_keeps_his_own_lines_to_this_person():
    show = load_persona(SHOW / "trabolta.persona.md")
    lines = tuple(f"It might be {w}." for w in show.secrets.answer_words()[:3])
    p3 = render_p3(show, request(), replace(context(), said=Said(to_them=lines)))
    assert "To them:" in p3  # his own lines to this person are theirs already


def test_already_said_to_them_never_carries_a_never_word():
    p3 = render_p3(P, request(), context(said=Said(to_them=("It was XYZZY-PLUGH.", "Speak, program."))))
    assert "XYZZY" not in p3 and "- Speak, program." in p3
