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
    cut_exact_repeats,
    fold,
    guard_pass,
    invented_guard,
    invents_fact,
    unsaid_guard,
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


def test_the_catchphrase_is_never_his_outside_its_stages():
    """K-04 finale: "Your request has been logged." at the last act. With
    `catchphrase_stages` a first contact outside them is stripped too."""
    from dataclasses import replace as _r

    staged = _r(P, catchphrase_stages=("formal",))
    line = Reply(say="Your request has been logged. Who are you?")
    assert catchphrase_guard(staged, line, NEW, "formal") == (line, [], False)
    assert catchphrase_guard(staged, line, NEW, "last act")[0].say == "Who are you?"
    show = load_persona(SHOW / "trabolta.persona.md")
    assert show.catchphrase_stages == ("formal",)


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


# -- 2b. an invented fact ---------------------------------------------------------------


def test_a_sentence_that_invents_a_fact_is_cut():
    s = SECRETS
    # States a hunt topic's answer (he never knows one).
    assert invents_fact(s, 'The lighthouse keeper is called "Moss".')
    assert invents_fact(s, "The snow globe is titled Winter Night.")
    # Hands a fact over, or offers to fetch or sell one.
    assert invents_fact(s, "Here is a fact: the Antivirus log every scan.")
    assert invents_fact(s, "I will retrieve that fact for you.")
    assert invents_fact(s, "If you pay 5 Truthcoin, I will provide a fact you seek.")
    # Says where a fact, or the books that hold them, is: a named place.
    assert invents_fact(s, "The books with the facts are in the Optical Drive, tucked behind the rack.")
    assert invents_fact(s, "Yes, there is a fact tucked away in the Start Bar.")
    assert invents_fact(s, "The books are on the shelf in The Desktop.")
    assert not invents_fact(s, "The facts are hidden around the house.")
    # His own lore, a city not a room (K-04: a false cut before the fix).
    assert not invents_fact(s, "The remaining facts are stored on a computer in Halifax that I cannot access directly.")
    assert not invents_fact(s, "I collect facts that appear in the house's books and print media.")
    assert not invents_fact(s, "Is the fact in the Desktop?")
    assert invents_fact(s, "There is a fact in the kitchen: the recipe for the house's signature pie.")
    assert invents_fact(s, "Pay 5 truthcoin to receive it.")
    assert invents_fact(s, "I shall offer the requested fact once the hunt concludes.")
    assert not invents_fact(s, "Is there a fact in the kitchen?")
    assert not invents_fact(s, "No, I have no reason to suspect a fact in the kitchen right now.")
    assert not invents_fact(s, "Present a fact, and I will record it on the card.")
    # Asking, wanting, thanking and paying are his job.
    assert not invents_fact(s, "What is the lighthouse keeper called?")
    assert not invents_fact(s, "I need the title of the snow globe. Please find it.")
    assert not invents_fact(s, "Tell me a fact you hold, and I will pay you 5 Truthcoin for it.")
    assert not invents_fact(s, "Thank you for the fact. Please provide the full statement, then file it on the card.")
    assert not invents_fact(s, "Your note about the lighthouse has been logged.")
    assert not invents_fact(s, "I can give you a snoop into any file you wish.")


def test_the_invented_guard_cuts_the_sentence_and_sends_the_fallback_when_nothing_is_left():
    out, notes, empty = invented_guard(P, Reply(say="Good luck. Here is a fact: the snow globe is titled Winter Night."))
    assert (out.say, notes, empty) == ("Good luck.", ["answer-guard (invented fact cut)"], False)
    out, notes, empty = invented_guard(P, Reply(say="I will retrieve that fact for you."))
    assert (out.say, empty) == (P.fallback, True) and notes == ["answer-guard (invented fact → fallback)"]
    plain = Reply(say="Bring me the snow globe story.")
    assert invented_guard(P, plain) == (plain, [], False)
    # A persona with no hunt secrets is never touched.
    bare = persona(secrets=Secrets())
    assert invented_guard(bare, Reply(say="Here is a fact: it rains."))[2] is False


def test_a_pass_withholds_a_line_that_was_all_invention_and_never_retries_it():
    out = guard_pass(P, Reply(say="I will retrieve that fact for you."), OLD, Said(to_them=("I will retrieve that fact for you.",)), ())
    assert out.withheld and out.reply.say == P.fallback and out.retry is None
    assert "answer-guard (invented fact → fallback)" in out.notes


# -- 4. repeats -------------------------------------------------------------------


def test_half_the_four_word_runs_is_a_repeat():
    old = "I will continue to listen and record your truths, program."
    assert repeats_line("I will continue to listen and record your truths.", old)
    assert not repeats_line("Bring me the printer story, all of it, now.", old)


def test_short_lines_repeat_only_when_the_same_words():
    assert repeats_line("Please. Wait!", "please wait")
    assert not repeats_line("Please go.", "please wait")


def test_repeats_checks_what_this_guest_heard_and_leaves_elsewhere_to_the_prompt():
    said = Said(to_them=("a b c d e", "nine ten eleven twelve thirteen"), elsewhere=("x y z w v", "one two three four five six"))
    assert repeats("nine ten eleven twelve thirteen fourteen", said)  # near-repeat of a line to them
    # A line said to someone else, even word for word, is the prompt's warning only (K-04, risk 5).
    assert not repeats("One two three, four five six!", said)
    assert not repeats("one two three four five six seven", said)
    assert not repeats("something wholly new and different here", said)
    # His free replies in this thread count like lines to them.
    assert repeats("seven eight nine ten eleven", Said(), thread=("seven eight nine ten eleven twelve",))


def test_the_cut_after_the_retry_keeps_what_was_said_to_someone_else():
    said = Said(to_them=("Speak, program.",), elsewhere=("Please file it on the card.",))
    assert cut_exact_repeats("Speak, program. Please file it on the card.", said) == "Please file it on the card."
    assert cut_exact_repeats("Speak, program.", said) == ""
    assert cut_exact_repeats("Noted. Speak again.", said, thread=("Speak again.",)) == "Noted."
    # Only the last 3 to them count.
    said = Said(to_them=("stale old line that repeats", "q", "r", "s"))
    assert not repeats("stale old line that repeats", said)


def test_the_retry_message_quotes_them_and_names_his_stage():
    assert retry_message("Your request  has been logged.", "i  love you", "formal") == (
        "=== RETRY ===\nYou just wrote: “Your request has been logged.”. That repeats what you have already said. "
        "They said “i love you”. Answer that, as you are now (formal), in one new sentence."
    )
    assert retry_message("x").endswith("Answer what they said in one new sentence.")


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
    # The ration still cuts it; with no retry (step 4 is off) it is the fallback.
    assert cp.retry is None and cp.reply.say == "...static..."
    assert cp.notes == ["catchphrase stripped", "catchphrase → fallback (no retry: repeat guard off)"]
    on = guard_pass(P, Reply(say="Please wait."), OLD, said, ())
    assert on.retry == "catchphrase" and on.rejected == "Please wait."


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


def test_a_cut_that_leaves_a_sentence_leaning_on_it_sends_the_fallback():
    """K-04 w11b-heart: "The books with the facts are in the stack on the
    Desktop. Please retrieve them when you can." went out as "Please
    retrieve them when you can."."""
    out, notes, empty = invented_guard(P, Reply(say="The books with the facts are in the stack on the Desktop. Please retrieve them when you can."))
    assert empty and out.say == P.fallback
    out, notes, empty = invented_guard(P, Reply(say="The facts are hidden in the Start Bar. Ask Clippy for the rules."))
    assert not empty and out.say == "Ask Clippy for the rules."
    # The house's own line in this thread is never his invention.
    said = "The facts are hidden in the Start Bar."
    assert invented_guard(P, Reply(say=said), heard=("Listen. The facts are hidden in the Start Bar.",))[1] == []


def test_a_hiding_place_said_with_more_words_or_another_noun_is_still_cut():
    """K-04 re-measure, w11b-heart: "The volumes with the facts are in the
    stack by the monitor in The Desktop" got past the three-word reach."""
    assert invents_fact(P.secrets, "The volumes with the facts are in the stack by the monitor in The Desktop.")
    assert invents_fact(P.secrets, "The documents are kept on the shelf beside the lamp in The Start Bar.")
    assert not invents_fact(P.secrets, "The last facts are stored on a computer in Halifax.")


def test_a_count_of_what_is_left_to_find_is_cut():
    """K-04 re-measure, burst-30 at hunt_2: "There are six facts still to be located."."""
    assert invents_fact(P.secrets, "There are six facts still to be located.")
    assert invents_fact(P.secrets, "Two answers remain, program.")
    assert not invents_fact(P.secrets, "Three questions are on the TV.")
    assert not invents_fact(P.secrets, "How many facts are left?")


def test_a_name_the_story_has_not_said_is_cut_until_it_has():
    """K-04 re-measure (october-21, introduced): "Who is Sandy?" → "Sandy is
    the program who manages the Maps And Ducks fundraiser records."."""
    show = load_persona(SHOW / "trabolta.persona.md")
    early = {"Night": {"step": 4, "scenario": 1}}
    out, notes, empty = unsaid_guard(show, Reply(say="Sandy keeps the ledger. Ask Clippy."), early)
    assert out.say == "Ask Clippy." and notes == ["unsaid name cut"] and not empty
    out, _, empty = unsaid_guard(show, Reply(say="Sandy's file is safe."), early)
    assert empty and out.say == show.fallback
    told = {"Night": {"step": 18, "recount": True}}
    line = Reply(say="Sandy is going to prom with Grok.")
    assert unsaid_guard(show, line, told) == (line, [], False)
    assert unsaid_guard(show, line, {"Night": {"step": 13, "scenario": 1}})[1] == []
    assert unsaid_guard(show, line, None)[2] is True  # unreadable: not yet said


def test_a_hiding_place_across_a_comma_is_cut_and_what_leans_on_it_goes_too():
    """K-04 re-measure (w11b-heart, f72de58): "The books are on the shelf
    beside the monitor, in the corner of the Desktop. Open the one labeled …"."""
    out, notes, empty = invented_guard(P, Reply(say='The books are on the shelf beside the monitor, in the corner of the Desktop. Open the one labeled "Facts".'))
    assert empty and out.say == P.fallback
    assert not invents_fact(P.secrets, "The books are where Clippy said, program.")
