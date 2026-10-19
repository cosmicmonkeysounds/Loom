"""Wave 12 lane W1: the memo — parsed, kept out of the line, scrubbed
(CONTRACTS.md §C2.1 and §C2.2 step 5). Every secret word here is made up."""

import json

import pytest

from stagehand.agents.guards import scrub_memo
from stagehand.agents.reply import MAX_MEMO, parse_memo, parse_reply, unspill_memo
from stagehand.agents.secrets import Secrets

SECRETS = Secrets(topics=("snow globe", "lighthouse"), match=("quokka", "periwinkle tuesday", "4417", "11"), never=("XYZZY-PLUGH",))


def doc(**fields):
    return json.dumps({"say": "Bring me more.", "adjust": {"truth": 2}, **fields})


# -- the parse -----------------------------------------------------------------------


def test_the_memo_is_parsed_only_when_asked_for():
    raw = doc(memo="  came back   with the printer story  ")
    assert parse_reply(raw, ("truth",), 10, memo=True).memo == "came back with the printer story"
    # Classic never asks: the field is ignored and the reply is today's.
    classic = parse_reply(raw, ("truth",), 10)
    assert classic.memo == "" and classic.say == "Bring me more." and classic.adjust == {"truth": 2}


@pytest.mark.parametrize("value", [42, None, ["a list"], {"a": "dict"}, True])
def test_a_memo_that_is_not_text_is_ignored(value):
    assert parse_reply(doc(memo=value), ("truth",), 10, memo=True).memo == ""


def test_a_long_memo_is_cut_at_a_space_with_an_ellipsis():
    words = ("printer " * 40).strip()
    out = parse_memo(words)
    assert len(out) <= MAX_MEMO and out.endswith("…")
    assert out[:-1].endswith("printer")  # never half a word
    exact = "x" * MAX_MEMO
    assert parse_memo(exact) == exact
    unbroken = "y" * 300
    assert parse_memo(unbroken) == "y" * (MAX_MEMO - 1) + "…"


def test_an_empty_memo_is_no_memo():
    assert parse_memo("   ") == ""


# -- kept out of the line ---------------------------------------------------------------


def test_a_memo_spilled_into_the_say_is_cut_out():
    raw = json.dumps({"say": 'You came back. "memo": "they came back with the printer story"'})
    assert parse_reply(raw, (), 10, memo=True).say == "You came back."
    raw = json.dumps({"say": "You came back. Memo: owes me the rest", "memo": "owes me the rest"})
    out = parse_reply(raw, (), 10, memo=True)
    assert out.say == "You came back." and out.memo == "owes me the rest"


def test_the_memo_text_repeated_in_the_say_is_removed_when_long_enough():
    memo = "owes me the rest of that printer story"
    assert unspill_memo(f"You came back. {memo} Say it.", memo) == "You came back. Say it."
    assert unspill_memo("Go on. owes me Say it.", "owes me") == "Go on. owes me Say it."  # under 20 characters: kept


def test_a_plain_text_answer_loses_a_spilled_memo_too():
    out = parse_reply("Bring me the printer story. memo: a printer person", (), 10, memo=True)
    assert out.say == "Bring me the printer story."


def test_without_the_memo_the_say_is_untouched():
    raw = json.dumps({"say": "Read the memo: it says nothing."})
    assert parse_reply(raw, (), 10).say == "Read the memo: it says nothing."


# -- the scrub --------------------------------------------------------------------------


def test_a_memo_carrying_a_never_word_is_dropped():
    assert scrub_memo(SECRETS, "typed XYZZY-PLUGH at me") == ("", ["memo dropped (never)"])


def test_answer_words_become_an_ellipsis_and_the_topic_stays():
    out, notes = scrub_memo(SECRETS, "brought me something about the lighthouse: quokka, filed it")
    assert out == "brought me something about the lighthouse: …, filed it"
    assert notes == ["memo scrubbed"]
    # Bare numbers in `match` count in a memo (the line's guard spares them).
    assert scrub_memo(SECRETS, "asked about 11 twice")[0] == "asked about … twice"


@pytest.mark.parametrize(
    "memo",
    [
        "said the lighthouse answer is quokka — that is right",
        "quokka, which is correct",
        "their lighthouse claim is a lie",
    ],
)
def test_a_verdict_near_an_answer_or_on_a_topic_drops_the_memo(memo):
    out, notes = scrub_memo(SECRETS, memo)
    assert out == "" and notes and notes[0].startswith("memo dropped")


def test_a_verdict_far_from_any_cut_is_kept():
    memo = "quokka they said, then a long story about cousins and cats and the right way to fold towels"
    out, _ = scrub_memo(SECRETS, memo)
    assert out.startswith("… they said") and "right way" in out


def test_a_clean_memo_passes_as_it_is():
    assert scrub_memo(SECRETS, "came back twice, owes me the printer story") == ("came back twice, owes me the printer story", [])
    assert scrub_memo(SECRETS, "") == ("", [])


def test_a_plain_verdict_word_beside_a_topic_drops_the_memo():
    out, notes = scrub_memo(SECRETS, "filed quokka for the snow globe, that is right")
    assert out == "" and notes == ["memo dropped (verdict on a topic)"]
    # The same word with no topic and no cut nearby is only a word.
    assert scrub_memo(SECRETS, "came right back for more")[0] == "came right back for more"
