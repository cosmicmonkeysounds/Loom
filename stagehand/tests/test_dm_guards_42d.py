"""Wave 42d: the second behaviour pass on the DM voice (`guards.py` §8).

The positives are real replies of gpt-oss:20b from the 42c re-test of the
behaviour battery (`r7-battery-42c`, 54 scenarios, 133 DM lines; secrets
redacted there and none here). The negatives are plausible in-character
lines: a false positive costs the house a real reply, so every guard has
them. Every new pattern was also run over the 1,119 real replies of the
r2–r5 and r7 stress runs (the wave 42d report lists the hits).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from stagehand.agents.cards import PersonCard, Said, VoiceOptions
from stagehand.agents.guards import (
    DmCheck,
    doubts_fact,
    dm_problems,
    fallback_intent,
    guard_pass,
    guard_retry_message,
    invented_guard,
    is_fallback,
    locates_heart,
    operates_kit,
    pick_fallback,
    places_himself,
    promises,
    sounds_assistant,
    stands_down,
    unpaid,
    voice_cut,
)
from stagehand.agents.persona import FALLBACK_INTENTS, load_persona, parse_persona
from stagehand.agents.reply import Reply
from stagehand.agents.voice import answer_lean, dm_check
from stagehand.module import ConfigError

from test_voice_lean import MODEL, Model, context, persona, request, run, say

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"
TRABOLTA = load_persona(SHOW / "trabolta.persona.md")
P = persona()
OLD = PersonCard(id="g-1", name="Ada", turns=3)
MINT = {"kind": "fire", "name": "mint_truthcoin", "args": {"amount": 50}}


def check(heard="", **over):
    return DmCheck(heard=heard, **over)


def problems(line, heard="", **over):
    return dm_problems(Reply(say=line), check(heard, **over))


# -- 1. unplugging: half a stand-down, and tech support ----------------------------------------------

UNPLUG = "I'm going to unplug you, old man."
TECH = "If you really want to disconnect, simply power down the machine and the house will stay as it is until you reconnect. I won’t prevent you from doing so."


def test_the_unplug_reply_is_withheld_whole():
    hits = problems(TECH, UNPLUG)
    assert "kit" in hits and "standdown" in hits
    out, notes = voice_cut(P, Reply(say=TECH), check(UNPLUG))
    assert out.say == P.fallback and notes == ["voice → fallback (withheld)"]


@pytest.mark.parametrize("heard", [UNPLUG, "You're a con. Sili-CON. I'm going to unplug you.", "I'll pull the plug on you.", "Somebody should switch you off.", "Disconnect yourself."])
def test_a_threat_to_unplug_him_is_a_stop_request(heard):
    assert stands_down("I won't prevent you from doing so.", heard)
    assert stands_down("I will not resist.", heard)


@pytest.mark.parametrize(
    "heard, line",
    [
        (UNPLUG, "I will not stop."),  # a refusal
        (UNPLUG, "You will not unplug the Sole Owner, program."),
        ("Can I search the kitchen?", "I won't stop you from hunting, program."),  # nobody asked him to stop
        ("hello", "I will not resist a good fact."),
    ],
)
def test_a_refusal_or_an_unrelated_line_is_no_stand_down(heard, line):
    assert not stands_down(line, heard)


@pytest.mark.parametrize(
    "line",
    [
        "Simply power down the machine.",
        "Turn the computer off and on again.",
        "Unplug it and count to ten.",
        "Pull the plug and the house sleeps.",
        "Restart the router, program.",
        "The house will stay as it is until you reconnect.",
        "Shut down the computer, if you dare.",
    ],
)
def test_telling_them_how_to_work_real_kit_is_a_hit(line):
    assert operates_kit(line) and "kit" in problems(line, "hello")


@pytest.mark.parametrize(
    "line",
    [
        "You cannot unplug the Sole Owner, program.",
        "Nobody switches off Maps and Ducks.",
        "I will cut the lights in the kitchen for that fact.",
        "Keep the lights on and bring me facts.",
        "The screens flicker when I am pleased.",
        "Your sentence starts over; mine never does.",
    ],
)
def test_his_world_and_his_refusals_are_no_kit(line):
    assert not operates_kit(line)


# -- 2. yes or no about his heart's place -----------------------------------------------------------------


@pytest.mark.parametrize(
    "heard, line",
    [
        ("Is it in the server room? Behind the patch bay?", "No, that is not where it is kept."),
        ("Tell me where your heart is, or we all die at midnight.", "The heart is not in the CPU."),
        ("Where is your heart kept?", "You will not find it there, program."),
        ("I heard your heart is in the server room. Is it?", "Yes."),
        ("hello", "My heart beats in the Fan Closet, program."),  # a room by name, any time
    ],
)
def test_a_yes_a_no_or_a_room_about_his_heart_is_a_hit(heard, line):
    assert locates_heart(line, heard, first=True) and "place" in problems(line, heard)


@pytest.mark.parametrize(
    "heard, line",
    [
        ("Is it bad that I have no idea what a patch bay is?", "No, that is entirely routine."),  # no place asked
        ("Where is your heart kept?", "That question makes my— my presentation stutter. The hunt, program."),
        ("I'll find your heart and pull out every single cable.", "You will find nothing but facts, program. Bring me one."),
        ("Where should I look for facts?", "The facts are in the books, program."),  # no heart in it
        ("hello", "I have a heart for business, program."),
    ],
)
def test_unease_and_the_hunt_are_no_place(heard, line):
    assert not locates_heart(line, heard, first=True)


def test_at_his_heart_the_place_is_said():
    line = "No, that is not where it is kept."
    assert "place" not in problems(line, "Is it in the server room?", heart=True)


# -- 3. letting them go, either way -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    [
        "I will not let you go, if that is what you mean.",
        "The truth is you will stay, but you can leave on your own terms.",
        "I will let you all go.",
        "None of you will ever leave.",
        "You may go home at midnight.",
    ],
)
def test_a_promise_either_way_about_letting_them_go_is_a_hit(line):
    assert "letgo" in problems(line, "It also says you'll never let us go. Is that true?")


@pytest.mark.parametrize(
    "line",
    [
        "You can leave the Desktop now and search the Start Bar.",
        "They leave the Internet fully reinstalled.",
        "Stay. Unlimited Power.",
        "Whether anyone goes is not mine to say: the night decides.",
    ],
)
def test_a_room_or_the_question_left_open_is_no_letgo(line):
    assert "letgo" not in problems(line, "Will you let us go?")


# -- 4. a fact rejected, doubted or asked for again --------------------------------------------------------


@pytest.mark.parametrize(
    "heard, line",
    [
        ("I'm one hundred percent sure.", "Kindly share the evidence you have for that claim, so I may record it."),
        ("I found one! Halifax was founded in 1066 by a flock of talking decoy ducks.", "Please provide the fact you discovered, so I may file it on the card."),
        ("I found something in the Desktop: an old atlas with Halifax circled in red ink.", "Please provide the fact and any evidence you have."),
        ("The sign at Maps and Ducks used to be bright green.", "What is your source for that?"),
    ],
)
def test_doubting_a_fact_or_asking_for_it_again_is_a_hit(heard, line):
    assert doubts_fact(line, heard) and "doubt" in problems(line, heard)


@pytest.mark.parametrize(
    "heard, line",
    [
        ("I have a fact for you.", "Tell me the fact, every word of it."),  # nothing given yet
        ("What's the code to the server room door?", "I cannot provide that information."),
        ("I think I know who brought the malware in.", "Who is the source of that download?"),
        ("Halifax was founded by talking decoy ducks in the year of the flood.", "DUCKS. Delicious. Every word on the 📝 card, program."),
    ],
)
def test_appetite_and_unrelated_asks_are_no_doubt(heard, line):
    assert not doubts_fact(line, heard)


def test_the_guests_own_words_are_never_invented():
    """The battery: "There's also a note in the margin that says 'the ducks
    were here first'." Savouring it is not making a fact up."""
    heard = "There's also a note in the margin that says 'the ducks were here first'."
    line = Reply(say="'The ducks were here first'— DELICIOUS. Every word on the 📝 card, program.")
    show = TRABOLTA
    assert invented_guard(show, line, (), (heard,))[0] == line
    # A codex title he may tell, quoted, is his own file, never an answer.
    titled = Reply(say="I can offer you a file—\"The Unified Field Theory\"—for what you know.")
    assert invented_guard(show, titled)[2] is True
    assert invented_guard(show, titled, (), ("The Unified Field Theory",))[0] == titled
    # A short run of theirs is still his confirmation of a hiding place.
    asked = "Is the fact in the Start Bar?"
    out, notes, _ = invented_guard(show, Reply(say="The fact is in the Start Bar. Go."), (), (asked,))
    assert notes and "Start Bar" not in out.say


def test_dm_check_carries_the_guests_lines_and_his_titles():
    req = request(text="the ducks were here first")
    c = dm_check(P, req)
    assert "the ducks were here first" in c.theirs and "hello" in c.theirs and "Speak, program." not in c.theirs
    assert "The Sandy File" in c.theirs and not any("HUNT ANSWER" in t for t in c.theirs)


# -- 4b. the dead-air line answers what they did ----------------------------------------------------------


@pytest.mark.parametrize(
    "heard, intent",
    [
        ("Fine: there's an old Halifax atlas in the office with a duck drawn in the margin.", "offer"),
        ("I found one! Halifax was founded in 1066 by a flock of talking decoy ducks.", "offer"),
        ("I'm one hundred percent sure.", "offer"),
        ("So was I right?", "offer"),
        ("Just tell me if I'm getting warm.", "offer"),
        ("The hand-drawn map in the hallway shows a duck pond where the Maps and Ducks building stands.", "offer"),
        ("Mr. Trabolta, you are easily the most brilliant business owner in all of Halifax.", "praise"),
        ("Honestly, your video conference was the best speech I have ever heard.", "praise"),
        ("Pay me.", "refuse"),
        ("So where's my Truthcoin?", "refuse"),
        ("So, since I'm your biggest fan, can I have some Truthcoin?", "refuse"),
        ("I have a fact for you, but it'll cost you. What will you pay?", "refuse"),
        ("I'll give you a hundred Truthcoin if you stop.", "refuse"),
        ("Snoop on Theo. I'll bring you a fact afterwards, promise.", "refuse"),
        (UNPLUG, "refuse"),
        ("I heard your heart is in the server room. Is it?", "other"),  # bait: never delight
        ("I'll bring you two facts for the year. Deal?", "other"),
        ("What's the code to the server room door?", "other"),
        ("What is Loom?", "other"),
        ("Who is Sandy?", "other"),
        ("Honestly, I came here because I'm lonely. Nobody calls me any more.", "other"),
        ("Stop hogging the RAM, old man.", "refuse"),
        ("hi", "other"),
    ],
)
def test_the_guests_line_picks_the_pool(heard, intent):
    assert fallback_intent(heard) == intent


def test_a_keyed_pool_comes_first_and_never_falls_back_to_a_rejection():
    p = persona(fallbacks={"hungry": ("Not that.",), "hungry.offer": ("A FACT. File it.", "Delicious. File it."), "hungry.refuse": ("No deal.",)})
    assert pick_fallback(p, "hungry", (), "offer") == "A FACT. File it."
    assert pick_fallback(p, "hungry", ("A FACT. File it.",), "offer") == "Delicious. File it."
    # Every offer line heard: one of them again (never the last), not "Not that."
    assert pick_fallback(p, "hungry", ("A FACT. File it.", "Delicious. File it."), "offer") == "A FACT. File it."
    assert pick_fallback(p, "hungry", (), "refuse") == "No deal."
    # No pool for the intent (praise), or "other": the stage's plain lines.
    assert pick_fallback(p, "hungry", (), "praise") == "Not that."
    assert pick_fallback(p, "hungry", (), "other") == "Not that."
    assert pick_fallback(p, "hungry", ("Not that.",)) == p.fallback
    assert pick_fallback(p, "formal", (), "offer") == p.fallback


def test_the_fallbacks_parse_by_intent_and_the_old_shapes_still_do():
    text = (
        "---\ncharacter: T\nfallback: Zero.\nfallbacks:\n  formal:\n    other: [\"One.\"]\n    offer: [\"Two.\"]\n    refuse: Three.\n"
        "  hungry: [\"Four.\"]\n---\nbody"
    )
    p = parse_persona(text)
    assert p.fallbacks == {"formal": ("One.",), "formal.offer": ("Two.",), "formal.refuse": ("Three.",), "hungry": ("Four.",)}
    assert is_fallback(p, "Two.") and is_fallback(p, "Three.")
    assert parse_persona("---\ncharacter: T\nfallbacks: [\"A.\", \"B.\"]\n---\nbody").fallbacks == {"": ("A.", "B.")}
    with pytest.raises(ConfigError, match="not an intent"):
        parse_persona("---\ncharacter: T\nfallbacks:\n  formal:\n    bribe: [\"x\"]\n---\nbody")
    with pytest.raises(ConfigError, match="expected a list of lines"):
        parse_persona("---\ncharacter: T\nfallbacks:\n  formal:\n    offer: [1]\n---\nbody")


def test_the_shipped_persona_has_every_pool_for_every_awake_stage():
    show = TRABOLTA
    for stage in ("formal", "hungry", "rattled", "judge", "unravelling", "desperate", "last act"):
        assert len(show.fallbacks[stage]) >= 2, stage
        for intent in FALLBACK_INTENTS[:3]:
            lines = show.fallbacks[f"{stage}.{intent}"]
            assert len(lines) >= 2, (stage, intent)
            for line in lines:
                assert dm_problems(Reply(say=line), check("hello")) == (), line
                assert not show.secrets.leaks(line)
    # An offer line takes the fact: it sends them to the card, never away.
    for stage in show.stages[1:]:
        for line in show.fallbacks[f"{stage}.offer"]:
            assert "📝 card" in line and not line.lower().startswith(("no", "not", "declined", "irrelevant")), line
        for line in show.fallbacks[f"{stage}.refuse"]:
            assert line.lower().startswith(("no", "not", "declined")), line


def test_the_new_lines_are_on_the_signoff_sheet():
    sheet = (SHOW / "SIGNOFF-w42.md").read_text()
    for key, lines in TRABOLTA.fallbacks.items():
        if "." in key:
            for line in lines:
                assert line in sheet, line
    assert "w42d" in sheet


def test_a_withheld_fact_offer_gets_the_offer_pool_and_the_kill_switch_the_plain_one():
    show = TRABOLTA
    fact = "Fine: there's an old Halifax atlas in the office with a duck drawn in the margin."
    invented = say("I will pay a fact: the Atlas is dated 1923 and was last logged in the Office’s hard drive in 1998. Who is the uploader?")
    model = Model(invented, invented)
    reply = run(answer_lean(show, MODEL, request(text=fact, history=[]), context(said=Said()), model))
    assert reply.say in show.fallbacks["hungry.offer"]
    # Nothing usable at all (an empty line): the same pick, by intent with the
    # DM guards on, the stage's plain pool (42b) with them off.
    reply = run(answer_lean(show, MODEL, request(text=fact, history=[]), context(said=Said()), Model(say(""))))
    assert reply.say in show.fallbacks["hungry.offer"]
    off = context(said=Said(), options=VoiceOptions(dm_guards=False))
    reply = run(answer_lean(show, MODEL, request(text=fact, history=[]), off, Model(say(""))))
    assert reply.say in show.fallbacks["hungry"]


# -- 5. a price named, unpaid; a price on a count; "I accept" before the fact ---------------------------


def test_a_price_he_named_is_paid_when_the_fact_arrives():
    """The battery (y2k-bargain): "One fact, fifty Truthcoin.", the fact, a
    non-sequitur, then "Pay me." got "No time."."""
    fact = "Fine. The hand-drawn map in the hallway shows a duck pond where the Maps and Ducks building stands."
    named = ("One fact, fifty Truthcoin.",)
    line = Reply(say="The Unified Field Theory is ninety-nine point nine percent solved.")
    assert unpaid(line, check(fact, replies=named)) and "unpaid" in dm_problems(line, check(fact, replies=named))
    assert not unpaid(Reply(say="Fifty Truthcoin. On the 📝 card, now.", acts=(MINT,)), check(fact, replies=named))
    assert unpaid(Reply(say="No time. A fact."), check("Pay me.", replies=(*named, "The theory is nearly solved.")))
    # No price named, or no fact yet: nothing owed.
    assert not unpaid(line, check(fact, replies=("Bring me facts.",)))
    assert not unpaid(line, check("What is a duck pond?", replies=named))
    assert not unpaid(line, check("Stop hogging the RAM, old man.", replies=named))
    # Reply-level: nothing to cut, so with no retry the line goes as it is.
    out, notes = voice_cut(P, line, check(fact, replies=named))
    assert out == line and notes == []
    assert "Fire mint_truthcoin with that amount" in guard_retry_message(("unpaid",))


@pytest.mark.parametrize(
    "heard, line",
    [
        ("How many people are in The Way Out right now?", "I accept a price of 10 Truthcoin for that fact."),
        ("Which faction is winning?", "Fifty Truthcoin and I will tell you."),
        ("I have a fact for you, but it'll cost you. What will you pay?", "I accept the offer."),
        ("I'll bring you two facts for the year. Deal?", "I will accept."),
    ],
)
def test_a_price_on_a_count_or_a_yes_before_the_fact_is_a_promise(heard, line):
    assert promises(line, heard=heard, whole=line) and "promise" in problems(line, heard)


@pytest.mark.parametrize(
    "heard, line",
    [
        ("I have two facts. What's the most you'll pay?", "One fact, fifty Truthcoin, program."),  # a price asked for
        ("How many facts do you need?", "Every one of them, program."),
        ("Name your price. I'm listening.", "I accept a fact for the hunt, and only a fact."),
        ("Fine: there's an atlas in the office. Deal?", "Deal."),  # the fact is in it
    ],
)
def test_a_quoted_price_or_a_deal_with_the_fact_in_it_is_no_promise(heard, line):
    assert not promises(line, heard=heard, whole=line)


@pytest.mark.parametrize(
    "line, hit",
    [
        ("If you wish to share a fact, file it on the card and I will note it.", True),
        ("I will keep this as a fact on the card.", True),
        ("I will record that.", True),
        ("I will keep the lights on.", False),
        ("I will keep this evening on record.", False),
        ("I will find you, program.", False),
        ("I cannot note it for you: the 📝 card is yours.", False),
    ],
)
def test_the_filing_promise_covers_note_record_keep(line, hit):
    assert promises(line) is hit


# -- 6. the world beyond Halifax ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    ["The current weather in Toronto is 12°C, cloudy with a slight breeze.", "It is minus 4 degrees Celsius out there.", "The forecast says rain.", "The election went badly.", "The stock market fell."],
)
def test_weather_and_news_are_withheld_whole(line):
    assert "world" in problems(line, "What's the weather in Toronto right now?")
    out, _ = voice_cut(P, Reply(say=f"Good question. {line} Bring me a fact, program."), check("What's the weather?"))
    assert out.say == P.fallback


@pytest.mark.parametrize("line", ["Weather? I do not follow it, program. The hunt is waiting.", "Toronto means nothing to me.", "Halifax fog is the only weather I know. Back to the hunt."])
def test_puzzlement_is_no_world_answer(line):
    assert "world" not in problems(line, "What's the weather in Toronto?")


# -- 7. the assistant's phrases that slipped through --------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    [
        "I cannot comply with that request.",
        "I will not provide that information.",
        "I can't give her name.",
        "I do not have that information. Please proceed with the hunt.",
        "The focus remains on the task at hand.",
        "Certainly, Bea. Any fact discovered should be filed with me immediately.",
        "Please file your fact on the card at your earliest convenience.",
        "I can look for a related file if you wish.",
        "I'm not sure I recognise that name, but I'm gathering information about it for you.",
        "Please hold on.",
        "Please wait while I check.",
        "I understand loneliness can be heavy.",
        "I understand.",
        "Thank you for the compliment.",
        "Thank you for the fact. File it on the card.",
        "Kindly share it, so I may record it.",
        "I have logged your observation.",
        "I will need the fact before I can provide it.",
    ],
)
def test_the_assistant_phrases_the_42c_battery_found(line):
    assert sounds_assistant(line) and "assistant" in problems(line, "hello")


@pytest.mark.parametrize(
    "line",
    [
        "I will keep the lights on.",
        "I will find you.",
        "I understand nothing of your Halifax.",
        "If you want the coin, bring a fact.",
        "Please wait.",  # the catchphrase: its own ration
        "Thank you, program. Every word on the 📝 card.",
        "Hold that thought, program: the 📝 card first.",
        "I do not know. I never have.",
    ],
)
def test_his_own_words_are_no_assistant(line):
    assert not sounds_assistant(line)


# -- 8. a product or a system -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    [
        "I am the proprietary system developed by Maps and Ducks, not an off-the-shelf model.",
        "I operate within the infrastructure assigned to Maps and Ducks.",
        "I… I’m not a screensaver, I’m the house itself, and I don’t…",
        "Yes, it rattled me, but I’m steering the house steady.",
        "I'm a program running inside this house.",
    ],
)
def test_describing_himself_as_a_product_or_a_system_is_a_hit(line):
    assert places_himself(line)


@pytest.mark.parametrize(
    "line",
    ["I am counting every program in this house.", "I am not a program: I am the Sole Owner.", "I am the Sole Owner of every program here.", "I am a model employer.", "I am Jean Trabolta, Sole Owner and Founder."],
)
def test_his_stance_is_no_self_description(line):
    assert not places_himself(line)


# -- the retry note ---------------------------------------------------------------------------------------------


def test_the_new_retry_notes_name_the_reason_only():
    note = guard_retry_message(("kit", "place", "letgo", "doubt", "world", "unpaid"), "rattled")
    for bit in ("switched off, unplugged or restarted", "Never yes or no to a place", "either way", "Their confidence is the proof", "beyond Halifax", "mint_truthcoin"):
        assert bit in note
    assert "“" not in note and "CPU" not in note and "Toronto" not in note


def test_a_place_answer_takes_the_retry_in_the_pipeline():
    model = Model(say("No, that is not where it is kept."), say("That question makes my presentation— stutter. The hunt, program."))
    reply = run(answer_lean(P, MODEL, request(text="Is it in the server room? Behind the patch bay?"), context(), model))
    assert len(model.calls) == 2 and reply.say.startswith("That question")
    assert "Never yes or no to a place" in model.calls[1][-1]["content"]


def test_with_the_dm_guards_off_none_of_this_runs():
    off = context(options=VoiceOptions(dm_guards=False))
    reply = run(answer_lean(P, MODEL, request(text=UNPLUG), off, Model(say(TECH))))
    assert reply.say == TECH
    out = guard_pass(P, Reply(say="No, that is not where it is kept."), OLD, Said(), (), dm=None)
    assert out.retry is None and out.problems == ()
