"""Wave 12 lane W1: the lean voice's guards (CONTRACTS.md §C2.2).

Every secret word here is made up; the shipped-show tests read the real
mind file and never print or write a word from it.
"""

from dataclasses import dataclass
from pathlib import Path

import pytest

from stagehand.agents.cards import PersonCard, Said
from stagehand.agents.guards import (
    allowed_answer_words,
    answer_guard,
    catchphrase_guard,
    fold,
    guard_pass,
    never_guard,
    repeats,
    repeats_line,
    retry_message,
    strip_catchphrases,
    uses_catchphrase,
)
from stagehand.agents.persona import Persona, load_persona, parse_persona
from stagehand.agents.reply import Reply
from stagehand.agents.secrets import Secrets

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"

SECRETS = Secrets(
    topics=("snow globe", "lighthouse"),
    match=("quokka", "periwinkle tuesday", "4417", "11", "eleven", "ox"),
    lore=("▒ HUNT ANSWER",),
    never=("XYZZY-PLUGH", "Q3-R8"),
)


@dataclass(frozen=True)
class CPersona(Persona):
    """A persona with W2's `catchphrases` field (the guard reads it with getattr)."""

    catchphrases: tuple[str, ...] = ()


def persona(**over):
    base = parse_persona("---\ncharacter: Trabolta\nvariables: truth\nfallback: ...static...\n---\nYou are TRABOLTA.")
    fields = {**base.__dict__, "secrets": SECRETS, "catchphrases": ("Your request has been logged", "Please wait")}
    fields.update(over)
    return CPersona(**fields)


P = persona()
NEW = PersonCard(id="g1", name="Ada", turns=0)
OLD = PersonCard(id="g1", name="Ada", turns=3)


def req(**over):
    r = {
        "id": "ar-1",
        "text": "hello",
        "history": [{"seq": 1, "mine": False, "from": "Ada", "text": "hello"}],
        "recent": [],
    }
    r.update(over)
    return r


# -- the fold ----------------------------------------------------------------------


def test_fold_is_the_contracts_fold():
    assert fold("  Your REQUEST — has been, logged!! ") == "your request has been logged"


# -- 1. never ---------------------------------------------------------------------


def test_never_guard_withholds_the_line_drops_the_act_and_the_memo():
    reply = Reply(
        say="The code is XYZZY-PLUGH.",
        acts=({"kind": "fire", "name": "screen", "args": {"text": "patch q3 to r8"}}, {"kind": "share", "entry": "The Sandy File"}),
        memo="they typed xyzzy-plugh at me",
    )
    out, notes = never_guard(P, reply)
    assert out.say == "...static..."
    assert out.acts == ({"kind": "share", "entry": "The Sandy File"},)
    assert out.memo == ""
    assert notes == ["never (act dropped)", "never (line withheld)", "never (memo dropped)"]


def test_never_guard_leaves_a_clean_reply_alone():
    reply = Reply(say="Bring me a fact.", memo="a quiet one")
    assert never_guard(P, reply) == (reply, [])


# -- 2. answer words ----------------------------------------------------------------


def test_answer_words_skip_the_too_common_ones():
    # ≤ 2 characters, digits under three digits, a single number word.
    assert SECRETS.answer_words() == ("quokka", "periwinkle tuesday", "4417")


def test_a_word_the_guest_never_typed_withholds_the_line():
    out, notes = answer_guard(P, Reply(say="Was it the quokka?"), allowed=())
    assert out.say == "...static..."
    assert notes == ["answer-guard (line withheld)"]
    assert "quokka" not in " ".join(notes)  # a note never names the word


def test_matching_is_word_bounded_and_case_folded():
    assert answer_guard(P, Reply(say="QUOKKA."), allowed=())[0].say == "...static..."
    assert answer_guard(P, Reply(say="Periwinkle\n Tuesday, then."), allowed=())[0].say == "...static..."
    # Inside another word it is not the word.
    clean = Reply(say="quokkas and 44170 are not it")
    assert answer_guard(P, clean, allowed=()) == (clean, [])


def test_a_word_the_guest_typed_in_this_thread_is_theirs_to_hear_back():
    r = req(history=[{"seq": 1, "mine": False, "from": "Ada", "text": "I think it was a Quokka"}], text="well?")
    allowed = allowed_answer_words(P, r)
    assert allowed == frozenset({"quokka"})
    reply = Reply(say="A quokka. File it.")
    assert answer_guard(P, reply, allowed) == (reply, [])


def test_his_own_lines_never_make_a_word_allowed():
    r = req(history=[{"seq": 1, "mine": True, "from": "Trabolta", "text": "quokka"}], text="hm")
    assert allowed_answer_words(P, r) == frozenset()


def test_req_text_the_phase_card_and_house_lines_allow_a_word():
    assert allowed_answer_words(P, req(text="is it 4417?", history=[])) == frozenset({"4417"})
    assert allowed_answer_words(P, req(history=[]), p2="Your brief: ask about periwinkle tuesday.") == frozenset({"periwinkle tuesday"})
    r = req(history=[], recent=[{"kind": "house", "text": "The quokka wins!", "at": 1}, {"kind": "gift", "title": "4417", "new": True, "at": 1}])
    assert allowed_answer_words(P, r) == frozenset({"quokka"})  # a gift title is not a house line


def test_an_act_carrying_an_answer_word_is_dropped_and_the_line_kept():
    reply = Reply(say="Look at the screens.", acts=({"kind": "fire", "name": "screen", "args": {"text": "QUOKKA"}},))
    out, notes = answer_guard(P, reply, allowed=())
    assert out.say == "Look at the screens." and out.acts == ()
    assert notes == ["answer-guard (act dropped)"]


def test_the_shipped_answer_words_are_all_guarded_and_none_is_too_common():
    show = load_persona(SHOW / "trabolta.persona.md")
    words = show.secrets.answer_words()
    assert len(words) >= 8  # the hunt has eight questions
    for w in words:
        assert len(w) > 2
        out, notes = answer_guard(show, Reply(say=f"I heard it was {w} tonight."), allowed=())
        assert out.say == show.fallback, "an answer word got through"  # never print the word
        assert notes == ["answer-guard (line withheld)"]
        # …unless the guest said it.
        allowed = allowed_answer_words(show, req(text=f"it was {w}", history=[]))
        assert answer_guard(show, Reply(say=f"I heard it was {w} tonight."), allowed)[0].say != show.fallback


# -- 3. the catchphrase ration --------------------------------------------------------


def test_the_catchphrase_is_his_at_first_contact_only():
    line = Reply(say="Your request has been logged. Who are you?")
    assert catchphrase_guard(P, line, NEW) == (line, [], False)
    used = PersonCard(id="g1", name="Ada", turns=0, catchphrase_used=True)
    assert catchphrase_guard(P, line, used)[0].say == "Who are you?"
    out, notes, retry = catchphrase_guard(P, line, OLD)
    assert (out.say, notes, retry) == ("Who are you?", ["catchphrase stripped"], False)


def test_a_line_that_is_only_catchphrases_asks_for_the_retry():
    out, notes, retry = catchphrase_guard(P, Reply(say="Your request has been logged! Please wait…"), OLD)
    assert out.say == "" and retry is True and notes == ["catchphrase stripped"]


def test_uses_catchphrase_reads_the_folded_text():
    assert uses_catchphrase(P, "YOUR  request, has been LOGGED")
    assert not uses_catchphrase(P, "Your request was heard.")
    assert strip_catchphrases(P, "One. Please wait. Two? Three!") == "One. Two? Three!"


def test_no_catchphrases_declared_means_no_ration():
    bare = parse_persona("---\ncharacter: X\n---\nYou are X.")
    line = Reply(say="Your request has been logged.")
    assert catchphrase_guard(bare, line, OLD) == (line, [], False)


# -- 4. repeats -------------------------------------------------------------------


def test_half_the_four_word_runs_is_a_repeat():
    old = "I will continue to listen and record your truths, program."
    assert repeats_line("I will continue to listen and record your truths.", old)
    assert not repeats_line("Bring me the printer story, all of it, now.", old)


def test_short_lines_repeat_only_when_the_same_words():
    assert repeats_line("Please. Wait!", "please wait")
    assert not repeats_line("Please go.", "please wait")


def test_repeats_checks_his_last_eight_lines():
    said = Said(to_them=("a b c d e",) * 4, elsewhere=("x y z w v", "one two three four five six"))
    assert repeats("one two three four five six seven", said)
    assert not repeats("something wholly new and different here", said)
    # Only the last 3 to them count.
    said = Said(to_them=("stale old line that repeats", "q", "r", "s"))
    assert not repeats("stale old line that repeats", said)


def test_the_retry_message_is_the_contracts():
    assert retry_message("Your request  has been logged.") == (
        "=== RETRY ===\nYou just wrote: “Your request has been logged.”. That repeats what you have already said. "
        "Answer what they said, shorter, in new words."
    )


# -- one pass -------------------------------------------------------------------------


def test_a_pass_runs_the_guards_in_order():
    said = Said(to_them=("Bring me a fact about the printer, quickly now.",))
    out = guard_pass(P, Reply(say="Please wait. Bring me a fact about the printer, quickly now."), OLD, said, ())
    assert out.reply.say == "Bring me a fact about the printer, quickly now."
    assert out.notes == ["catchphrase stripped"]
    assert out.retry == "repeat" and out.rejected == out.reply.say


def test_a_withheld_line_is_never_retried():
    said = Said(to_them=("...static...",))
    out = guard_pass(P, Reply(say="quokka quokka quokka quokka"), OLD, said, ())
    assert out.withheld and out.reply.say == "...static..." and out.retry is None


def test_the_repeat_guard_can_be_switched_off_but_the_ration_stays():
    said = Said(to_them=("Bring me a fact about the printer, quickly now.",))
    off = guard_pass(P, Reply(say="Bring me a fact about the printer, quickly now."), OLD, said, (), repeat_guard=False)
    assert off.retry is None
    cp = guard_pass(P, Reply(say="Please wait."), OLD, said, (), repeat_guard=False)
    assert cp.retry == "catchphrase" and cp.rejected == "Please wait."


def test_the_retry_pass_never_asks_again():
    said = Said(to_them=("Bring me a fact about the printer, quickly now.",))
    out = guard_pass(P, Reply(say="Bring me a fact about the printer, quickly now."), OLD, said, (), may_retry=False)
    assert out.retry is None


@pytest.mark.parametrize("say", ["XYZZY-PLUGH", "q3 to r8", "R8 → Q3"])
def test_a_pass_withholds_every_never_spelling(say):
    out = guard_pass(P, Reply(say=f"It is {say}."), OLD, Said(), ())
    assert out.reply.say == "...static..." and out.withheld


def test_a_never_word_line_still_loses_an_act_carrying_an_answer_word():
    act = {"kind": "fire", "name": "pop_up", "args": {"text": "It was a quokka all along"}}
    out = guard_pass(P, Reply(say="It is XYZZY-PLUGH.", acts=(act,)), OLD, Said(), ())
    assert out.reply.say == "...static..." and out.withheld
    assert out.reply.acts == ()
    assert out.notes == ["never (line withheld)", "answer-guard (act dropped)"]
    # The same act beside a clean line is dropped the same way.
    clean = guard_pass(P, Reply(say="Look at the screens.", acts=(act,)), OLD, Said(), ())
    assert clean.reply.acts == () and clean.reply.say == "Look at the screens."
