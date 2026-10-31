"""Answer secrecy (OCT31 K-23): the character can never check a hunt answer.

The orchestrator's verdicts on hunt claims are suppressed before they reach
the mind (the voice reads `learned`), and hunt-answer codex entries never
reach a prompt. The last block pins the shipped show: every question and
answer in `facts.json` is caught, every stamped codex entry is hidden.
"""

import asyncio
import json
import re
from pathlib import Path

import pytest

from stagehand.agents.facts import Facts
from stagehand.agents.llm import LlmConfig
from stagehand.agents.mind import Mind
from stagehand.agents.orchestrator import Orchestrator, OrchestratorConfig, lore_block, reflect_messages, survey_messages
from stagehand.agents.persona import load_persona, parse_mind_file, parse_mind_secrets, parse_persona
from stagehand.agents.prompt import state_block
from stagehand.agents.reply import Reply
from stagehand.agents.secrets import Secrets, drop_counts
from stagehand.agents.trace import Trace
from stagehand.module import ConfigError

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"

#: The lore marker on every hunt-answer codex entry (`secrets.lore` in the mind file).
MARKER = "▒ HUNT ANSWER"
#: The folders of the show whose CODEX entries the shipped-show tests read.
CODEX_DIRS = ("codex", "generated")
#: Hunt-answer entries in the shipped show: H1–H6, F1, F2.
HUNT_ENTRIES = 8

SECRETS = Secrets(topics=("billboard", "pet cemetery"), match=("pickles", "eleven years"), lore=(MARKER,))
PERSONA = parse_persona("---\ncharacter: Trabolta\nvariables: truth\n---\nYou are TRABOLTA.")
PERSONA = type(PERSONA)(**{**PERSONA.__dict__, "secrets": SECRETS})

HUNT = {"id": "c1", "title": "The First Pet", "text": f"Mister Pickles was first. {MARKER} H2 ▒", "holders": []}
WORLD = {"id": "c2", "title": "The Sinkhole", "text": "The data centre fell in.", "holders": []}


def req(**over):
    r = {
        "id": "ar-1",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g1"]},
        "speaker": {"kind": "guest", "id": "g1", "name": "Ada", "faction": None},
        "text": "The first pet was Mister Pickles.",
        "history": [{"seq": 1, "mine": False, "from": "Ada", "text": "The first pet was Mister Pickles."}],
        "self": {"vars": {"truth": "35"}, "ranges": {}, "codex": [HUNT, WORLD]},
        "them": {"vars": {}, "codex": [{"id": "c1", "title": "The First Pet", "about": None, "text": HUNT["text"]}], "location": "The Cache"},
        "world": {"Night.phase": "hunt"},
        "powers": [],
    }
    r.update(over)
    return r


# -- the mind file -------------------------------------------------------------


def test_the_mind_file_declares_secrets_in_its_frontmatter():
    text = f"---\nstages: [a]\nsecrets:\n  topics: [billboard, pet cemetery]\n  match: pickles, eleven years\n  lore: ['{MARKER}']\n---\nBody."
    assert parse_mind_secrets(text) == SECRETS
    assert parse_mind_file(text)[0] == "Body."  # `secrets` is a known key
    assert parse_mind_secrets("plain prompt") == Secrets() and not Secrets()
    with pytest.raises(ConfigError):
        parse_mind_secrets("---\nsecrets: [a]\n---\nb")
    with pytest.raises(ConfigError):
        parse_mind_secrets("---\nsecrets: {answers: [x]}\n---\nb")


# -- the scrub -----------------------------------------------------------------


def test_scrub_drops_hunt_claims_from_learned_whatever_the_verdict():
    update = {
        "learned_add": [
            {"claim": "The billboard went eleven years unpaid", "from": "Ada", "verdict": "fact"},
            {"claim": "Mister Pickles was buried first", "from": "Bo", "verdict": "bluster"},
            {"claim": "Ada is a nurse", "from": "Ada", "verdict": "unknown"},
        ]
    }
    dropped = SECRETS.scrub(update)
    assert [e["claim"] for e in update["learned_add"]] == ["Ada is a nurse"]
    assert len(dropped) == 2 and all(d.startswith("learned: ") for d in dropped)


def test_scrub_drops_judgements_on_hunt_topics_but_keeps_plain_mentions():
    update = {
        "brief": "You want facts.\nAda's billboard claim is a lie; be cold.\nAsk Bo about the pet cemetery.",
        "notes_add": ["Ada promised me the billboard fact.", "The pickles answer checks out.", "Bo is loud."],
        "person": {"summary": "Lied about the pet cemetery.", "claims_add": ["claimed eleven years (true)", "offered the billboard"]},
        "people": {"g2": {"summary": "Correct about the billboard.", "trust": 60}},
    }
    dropped = SECRETS.scrub(update)
    assert update["brief"] == "You want facts.\nAsk Bo about the pet cemetery."
    assert update["notes_add"] == ["Ada promised me the billboard fact.", "Bo is loud."]
    assert update["person"] == {"claims_add": ["offered the billboard"]}
    assert update["people"]["g2"] == {"trust": 60}
    assert len(dropped) == 5


def test_no_secrets_declared_means_no_scrub():
    update = {"learned_add": [{"claim": "billboard", "verdict": "fact"}]}
    assert Secrets().scrub(update) == [] and len(update["learned_add"]) == 1


def test_prune_drops_restored_hunt_verdicts():
    mind = Mind("Trabolta", "e")
    mind.learned = [{"claim": "billboard: eleven years", "from": "Ada", "verdict": "fact"}, {"claim": "Ada is a nurse", "from": "Ada", "verdict": "unknown"}]
    assert SECRETS.prune(mind) == (1, 0) and [e["claim"] for e in mind.learned] == ["Ada is a nurse"]


# -- the doors -------------------------------------------------------------------


def test_hunt_lore_never_reaches_a_prompt():
    facts = Facts({"world": {}, "programs": [], "locations": [], "codex": [HUNT, WORLD]})
    block = lore_block(facts, ["The First Pet"], secrets=SECRETS)
    assert "The Sinkhole" in block and "First Pet" not in block and "Pickles" not in block
    # the voice: the lore the character holds
    voice = state_block(PERSONA, req())
    assert "The Sinkhole" in voice and "Pickles" not in voice
    assert "First Pet" not in voice and "They know nothing yet." in voice  # the speaker's stamped title
    # the reflect prompt, both halves
    msgs = reflect_messages(PERSONA, Mind("Trabolta", "e"), req(), Reply(say="NOTED."), facts, 20, "t")
    user = msgs[1]["content"]
    assert "Mister Pickles was first" not in user and MARKER not in user and "First Pet" not in user
    assert "THE HUNT (never judge)" in msgs[0]["content"] and "pickles" not in msgs[0]["content"].lower()
    survey = survey_messages(PERSONA, Mind("Trabolta", "e"), facts, [])
    assert "THE HUNT (never judge)" in survey[0]["content"]
    # a lookup card
    assert facts.render("The First Pet", SECRETS) == "The First Pet: no record in this system."
    assert "data centre" in facts.render("The Sinkhole", SECRETS)


def test_lore_block_puts_held_entries_first_caps_the_rest_and_never_shows_a_stamped_one():
    """SW-AI-10: the cap used to keep the first entries in model order, so a
    character whose own lore sits late in the codex never saw a ★."""
    plain = [{"id": f"w{i}", "title": f"World {i}", "text": "x" * 300, "holders": []} for i in range(40)]
    held = [{"id": f"t{i}", "title": f"Held {i}", "text": f"His lore {i}.", "holders": ["Trabolta"]} for i in range(3)]
    codex = plain[:30] + [held[0], HUNT, held[1]] + plain[30:] + [held[2]]
    block = lore_block(Facts({"codex": codex}), [e["title"] for e in held] + [HUNT["title"]], max_entries=10, secrets=SECRETS)
    lines = block.split("\n")[1:]
    assert len(lines) == 10
    assert [ln.split(":")[0] for ln in lines[:3]] == ["★ Held 0", "★ Held 1", "★ Held 2"]
    assert [ln.split(":")[0].strip() for ln in lines[3:]] == [f"World {i}" for i in range(7)]
    assert "First Pet" not in block and "Pickles" not in block and MARKER not in block
    assert all(len(ln.split(": ", 1)[1]) <= 160 for ln in lines)
    # the default cap holds about 60
    assert len(lore_block(Facts({"codex": plain * 2}), [], secrets=SECRETS).split("\n")) == 61


def test_a_live_dm_claiming_a_hunt_answer_never_lands_in_learned():
    """The acceptance, end to end through the orchestrator: the background
    model judges a hunt claim; the mind (and so the voice) never sees it,
    and the trace tells the director what was suppressed."""

    async def complete(messages, cfg):
        return json.dumps(
            {
                "brief": "You want facts.\nAda's pet cemetery answer is correct.",
                "learned_add": [
                    {"claim": "The first pet buried was Mister Pickles", "from": "Ada", "verdict": "fact"},
                    {"claim": "Ada works nights", "from": "Ada", "verdict": "unknown"},
                ],
            }
        )

    mind = Mind("Trabolta", "e")
    mind.saw_exchange("g1", "Ada", "guest", "t", 1)
    trace = Trace()
    updates = []

    async def on_update(character, m, job, touched):
        updates.append(touched)

    async def facts_fn(force):
        return Facts({"world": {}, "programs": [], "locations": [], "codex": [HUNT, WORLD]})

    orch = Orchestrator(OrchestratorConfig(quiet_s=0, survey_every_s=0), complete, {"Trabolta": LlmConfig()}, {"Trabolta": PERSONA}, {"Trabolta": mind}, on_update, facts_fn, trace)
    orch.reflect("Trabolta", "t", req(), Reply(say="NOTED."))

    async def go():
        task = asyncio.ensure_future(orch.run())
        for _ in range(200):
            if updates:
                break
            await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    asyncio.new_event_loop().run_until_complete(go())
    assert updates, "the reflection never ran"
    assert mind.learned == [{"claim": "Ada works nights", "from": "Ada", "verdict": "unknown"}]
    assert mind.brief == "You want facts."
    assert "Pickles" not in mind.prompt_block("g1") and "correct" not in mind.prompt_block("g1")
    thought = trace.recent("Trabolta")[-1]
    assert len(thought.result["suppressed"]) == 2


# -- the shipped show ------------------------------------------------------------


def _hunt_rows():
    """(id, question, answer) off `facts.json`: no doc carries the answers (wave 58)."""
    facts = json.loads((SHOW / "facts.json").read_text(encoding="utf-8"))
    rows = [(q["id"], q["text"], "owed" if q.get("placeholder") else q["answer"]) for q in facts["questions"]]
    assert len(rows) == 8, rows
    return rows


def _codex_entries():
    entries = []
    for path in sorted(p for d in CODEX_DIRS for p in (SHOW / d).glob("*.loom")):
        for block in re.split(r"^(?=CODEX )", path.read_text(encoding="utf-8"), flags=re.MULTILINE)[1:]:
            title = re.search(r"^\s+title:\s*(.+)$", block, re.MULTILINE)
            entries.append({"id": block.split("\n", 1)[0][6:].strip(), "title": title.group(1).strip() if title else "", "text": block, "holders": []})
    return entries


def test_the_shipped_mind_file_catches_every_hunt_question_and_answer():
    s = load_persona(SHOW / "trabolta.persona.md").secrets
    topics_only = Secrets(topics=s.topics)
    for qid, question, answer in _hunt_rows():
        assert topics_only.names_topic(question), f"{qid}: no topic in the question {question!r}"
        if "owed" in answer:  # a key still owed (facts.json `placeholder`): no answer to catch yet
            continue
        assert s.names_topic(answer.strip()), f"{qid}: the answer {answer!r} slips past secrets"
        assert s.names_topic(f"I'm certain: {answer.strip()}"), qid


def test_the_shipped_show_never_shows_a_hunt_answer_to_a_model():
    persona = load_persona(SHOW / "trabolta.persona.md")
    s = persona.secrets
    entries = _codex_entries()
    stamped = [e for e in entries if MARKER in e["text"]]
    assert len(stamped) == HUNT_ENTRIES
    assert all(not s.lore_ok(e) for e in stamped)
    block = lore_block(Facts({"codex": entries}), [e["title"] for e in entries], secrets=s)
    assert block and not any(e["title"] in block for e in stamped)
    # The standing order and the orchestrator's prompt name topics, never answers.
    rule = s.rule(persona.character) or ""
    system = (persona.mind_prompt or "") + "\n" + rule + "\n" + persona.system
    leaks = [w for w in s.match if Secrets(match=(w,)).names_topic(system)]
    assert leaks == [], f"answer words in a prompt: {leaks}"


def test_a_hunt_answer_title_never_reaches_a_prompt_when_everyone_holds_every_stamped_entry():
    """H1 of the lane review: a stamped entry's *title* can be the answer
    (Grok's Prom Ticket), so it is hidden wherever someone holds it — the
    voice's "They know", reflect's "holds", lookup cards, the digest's lore
    spread and holdings counts, and the survey's "X learned …"."""
    persona = load_persona(SHOW / "trabolta.persona.md")
    s = persona.secrets
    entries = _codex_entries()
    stamped = [e for e in entries if MARKER in e["text"]]
    assert len(stamped) == HUNT_ENTRIES
    plain = [e for e in entries if MARKER not in e["text"]][:2]
    every = [e["title"] for e in stamped] + [e["title"] for e in plain]
    codex = [{**e, "holders": ["g1", "Trabolta"]} for e in stamped + plain]
    before = Facts({"world": {"Night.phase": "hunt"}, "programs": [{"id": "g1", "name": "Ada", "codex": []}], "characters": [{"id": "Sandy", "codex": []}], "locations": [], "codex": codex})
    after = Facts(
        {
            "world": {"Night.phase": "hunt"},
            "programs": [{"id": "g1", "name": "Ada", "location": "The Cache", "codex": every}],
            "characters": [{"id": "Sandy", "codex": every}],
            "locations": [],
            "codex": codex,
        }
    )
    full = [{"id": e["id"], "title": e["title"], "about": None, "text": e["text"]} for e in stamped + plain]
    r = req(text="Hello.", history=[{"seq": 1, "mine": False, "from": "Ada", "text": "Hello."}], self={"vars": {"truth": "35"}, "ranges": {}, "codex": full}, them={"vars": {}, "codex": full, "location": "The Cache"})
    mind = Mind("Trabolta", "e")
    delta = after.delta(before, s)
    texts = [
        state_block(persona, r),
        *(m["content"] for m in reflect_messages(persona, mind, r, Reply(say="NOTED."), after, 20, "t")),
        *(m["content"] for m in survey_messages(persona, mind, after, delta)),
        after.render("Ada", s),
        after.render("Sandy", s),
        "\n".join(delta),
    ]
    blob = "\n".join(texts)
    # a lookup by the stamped title only echoes the name the model asked for
    assert all(after.render(e["title"], s) == f"{e['title']}: no record in this system." for e in stamped)
    assert plain[0]["title"] in blob  # the plain lore still flows
    assert [e["title"] for e in stamped if e["title"] in blob] == []
    assert MARKER not in blob
    assert [w for w in s.match if Secrets(match=(w,)).names_topic(blob)] == []
    assert "Ada (program id g1)" in after.render("Ada", s) and "holds 2" in after.digest(secrets=s)


def test_shipped_topics_spare_the_finale_song_and_prom_talk():
    """M1 of the lane review: a topic drops a learned claim whole, so the
    topics are specific phrases — the finale's song and prom talk survives,
    a hunt answer does not."""
    s = load_persona(SHOW / "trabolta.persona.md").secrets
    for claim in (
        "Sandy wants a slow song at the prom",
        "Ada was right about the song",
        "Bo says the next chapter of your life starts tonight",
        "Ada buried the hatchet with Bo",
        "Clippy will dial up the music",
    ):
        assert not s.names_topic(claim), claim
    for claim in ("Grok is taking Sandy to computer prom", "the song was Hopelessly Devoted to You", "the last chapter is Appendix Z", "Sandy only ever says she will direct you to an agent"):
        assert s.names_topic(claim), claim
    assert "grok" not in (s.rule("Trabolta") or "").lower()


#: Answer words the shipped lore block may carry, by entry: a bare number
#: in a clock. Since 2026-10-19 nothing else: Trabolta must never know what
#: he asks for, so no entry he holds names an answer (his LiveJournal no
#: longer quotes Sandy or names Grok, his runtime file (Oil And Lightning,
#: once Greased Lightning) and the MONOPOLY GO! handle no longer carry 1978;
#: core/test/trabolta-answers.test.ts).
LORE_ALLOWED = {
    "The Y2K Clock": {"11"},
}


def _show_codex():
    """The shipped codex as the server's facts document carries it: `secret:
    true` entries dropped, the text body only, and the titles Trabolta holds
    from the start (`about:` him or `known to:` him)."""
    entries, held = [], []
    for e in _codex_entries():
        block = e["text"]
        if re.search(r"^  secret:\s*true\b", block, re.MULTILINE):
            continue
        body = re.search(r"^  text:[^\n]*\n((?:(?:    [^\n]*)?\n)*)", block, re.MULTILINE)
        about = re.search(r"^  about:\s*(.+)$", block, re.MULTILINE)
        known = re.search(r"^  known to:\s*(.+)$", block, re.MULTILINE)
        holders = ([about.group(1).strip()] if about else []) + ([k.strip() for k in known.group(1).split(",")] if known else [])
        entries.append({"id": e["id"], "title": e["title"], "text": " ".join(body.group(1).split()) if body else "", "holders": holders})
        if "Trabolta" in holders:
            held.append(e["title"])
    return entries, held


def test_the_shipped_lore_block_carries_every_title_trabolta_holds_and_no_hunt_answer():
    s = load_persona(SHOW / "trabolta.persona.md").secrets
    entries, held = _show_codex()
    assert len(held) >= 10, held
    # Every hunt answer is `secret: true` in the source (generated by
    # titi-facts), so the server's facts document never carries one at all:
    # the lore marker is the worker's second door, not its first.
    source = [e for e in _codex_entries() if MARKER in e["text"]]
    assert len(source) == HUNT_ENTRIES
    assert all(re.search(r"^  secret:\s*true\b", e["text"], re.MULTILINE) for e in source)
    stamped = [e for e in entries if not s.lore_ok(e)]
    assert stamped == []
    block = lore_block(Facts({"codex": entries}), held, secrets=s)
    lines = block.split("\n")[1:]
    known = sorted({e["title"] for e in entries}, key=len, reverse=True)
    titles = [next(t for t in known if ln[2:].startswith(f"{t}: ")) for ln in lines]
    assert 40 <= len(lines) <= 60
    assert titles[: len(held)] == held and all(ln.startswith("★ ") for ln in lines[: len(held)])
    assert not any(e["title"] in block for e in stamped) and MARKER not in block
    assert len(block) < 16_000  # about 4k tokens for the Qwen orchestrator
    leaks = {}
    for title, line in zip(titles, lines):
        words = {w for w in s.match if Secrets(match=(w,)).names_topic(line)} - LORE_ALLOWED.get(title, set())
        if words:
            leaks[title] = sorted(words)
    assert leaks == {}, f"answer words in the lore block: {leaks}"
    # The Rival names F2's answer: it is `secret: true`, so it is never in the
    # facts document (never ground truth) and he won't take it as a share.
    rival = next(e for e in _codex_entries() if e["id"] == "The Rival")
    assert re.search(r"^  secret:\s*true\b", rival["text"], re.MULTILINE)
    assert "The Rival" not in {e["title"] for e in entries} and "The Rival" not in held
    assert "The Rival:" not in block and "grok" not in block.lower()


def test_lore_block_drops_an_unheld_clue_naming_a_hunt_answer_word():
    secrets = Secrets(match=("pickles", "1978"), lore=(MARKER,))
    codex = [
        {"title": "The Collar", "text": "A tag: PICKLES. Good boy.", "holders": []},
        {"title": "His Diary", "text": "Pickles was first, I think.", "holders": ["Trabolta"]},
        {"title": "Grease", "text": "Released in 1978.", "holders": []},
        WORLD,
    ]
    block = lore_block(Facts({"codex": codex}), ["His Diary"], secrets=secrets)
    assert "The Collar" not in block  # an unheld clue to the answer
    assert "★ His Diary" in block  # he holds it: it is in his own prompt anyway
    assert "Grease" in block and "The Sinkhole" in block  # a bare number is not a clue


# -- never: the door code and the combinations (wave 7) -----------------------------

NEVER = Secrets(topics=("billboard",), never=("1997", "'97", "V2-D5", "V4-D1"))


def test_the_mind_file_declares_never_words():
    text = "---\nsecrets:\n  topics: [billboard]\n  never: ['1997', \"'97\", V2-D5, V4-D1]\n---\nBody."
    assert parse_mind_secrets(text) == NEVER
    assert Secrets(never=("1997",)) and not Secrets(never=())


def test_leaks_catches_the_code_and_every_spelling_of_a_pair():
    for text in ["the code is 1997", "Code: 1997.", "since ’97", "since '97", "Combo A is V2 → D5", "v2-d5", "V2->D5", "V2 to D5", "V2—D5", "V2/D5", "patch V2 D5", "V4 → D1 next"]:
        assert NEVER.leaks(text), text
    for text in ["19970", "the year 1998", "V2 → D6", "V12 → D5", "D5 then V2", "97 bottles", "Ada is a nurse", None]:
        assert not NEVER.leaks(text), text


def test_leaks_catches_a_pair_either_way_round_and_a_code_spelled_out():
    """W8 T8-01: a cable has no direction, and a voice told to speak plainly
    says numbers in words — both reached the voice and the shared mind."""
    spelled = Secrets(never=("1997", "'97", "in 97", "since 97", "in ninety-seven", "since ninety-seven", "of ninety-seven",
                             "nineteen ninety-seven", "one nine nine seven", "V2-D5"))
    for text in ["D5-V2", "D5 to V2", "Patch D5 to V2, program.", "V-2 to D-5", "d-5 → v-2", "1 9 9 7", "1,997", "1-9-9-7",
                 "The door code is nineteen ninety-seven.", "nineteen ninety seven", "Nineteen-Ninety-Seven", "In 97 I met her", "one nine nine seven",
                 "back in ninety-seven", "Back in ninety seven, she smiled.", "since ninety seven", "the summer of ninety-seven"]:
        assert spelled.leaks(text), text
    # A bare 97 is not the code: a guest's program, the house's own bark, a price (W8 review).
    for text in ["19970", "970", "V22-D5", "V2 → D6", "nineteen ninety-eight", "ninety-seven bottles", "1998",
                 "Welcome, NHL 97.", "Office 97 again?", "Memory usage: 97%", "You have 97 Truthcoin", "$19.97", "COMMENT-CARDS-97",
                 "a balance of 97 Truthcoin", "one of 97 programs here"]:
        assert not spelled.leaks(text), text
    # Without the spelled forms declared, only the digits are withheld (titi:facts declares them).
    assert not NEVER.leaks("nineteen ninety-seven") and NEVER.leaks("D5 to V2") and NEVER.leaks("1 9 9 7")


def test_scrub_drops_a_typed_door_code_or_combo_from_every_shared_line_of_the_mind():
    """A program types the code to him: an unjudged claim is no verdict on
    a hunt topic, but the mind is shared by every conversation, so nothing
    carrying it may be written down at all."""
    update = {
        "learned_add": [
            {"claim": "the cold door's keypad code is 1997", "from": "Calculator", "verdict": "unknown"},
            {"claim": "Combo A is V2 → D5, V4 → D1", "from": "Calculator", "verdict": "fact"},
            {"claim": "Calculator likes the cold", "from": "Calculator", "verdict": "unknown"},
        ],
        "notes_add": ["Calculator says the keypad code is 1997.", "Calculator is calm."],
        "brief": "You are desperate.\ncombo A: V2-D5 and V4-D1. The door code is 1997, which is true.\nAsk about her.",
        "person": {"summary": "Knows the code (1997).", "trust": 40, "claims_add": ["the keypad code is 1997", "likes chess"]},
        "people": {"g2": {"summary": "Heard v4-d1 somewhere.", "trust": 55}},
        "threads": {"dm:Trabolta": {"summary": "They spoke of ’97."}},
        "questions_add": ["Is it 1997?", "Who is Sandy?"],
        "stage_why": "the code 1997 rattled him",
    }
    dropped = NEVER.scrub(update)
    assert [e["claim"] for e in update["learned_add"]] == ["Calculator likes the cold"]
    assert update["notes_add"] == ["Calculator is calm."]
    assert update["brief"] == "You are desperate.\nAsk about her."
    assert update["person"] == {"trust": 40, "claims_add": ["likes chess"]}
    assert update["people"]["g2"] == {"trust": 55}
    assert update["threads"]["dm:Trabolta"] == {}
    assert update["questions_add"] == ["Who is Sandy?"]
    assert "stage_why" not in update
    assert len(dropped) == 10
    assert "1997" not in json.dumps(update) and not NEVER._leaks_any(update)
    # W8 T8-05: every one of these is a secret, none a hunt verdict.
    from stagehand.agents.orchestrator import suppressed_summary
    from stagehand.agents.secrets import NEVER_TAG, split_dropped

    assert split_dropped(dropped) == ([], dropped) and all(d.startswith(NEVER_TAG) for d in dropped)
    assert suppressed_summary(dropped) == "10 secret(s) (door code / combo / pickup line)"


def test_scrub_counts_hunt_verdicts_and_secrets_apart():
    """W8 T8-05: the log said "suppressed 2 hunt verdict(s)" for two door-code lines."""
    from stagehand.agents.orchestrator import suppressed_summary
    from stagehand.agents.secrets import split_dropped

    update = {
        "learned_add": [{"claim": "the billboard says pickles", "from": "Ada", "verdict": "fact"}],
        "notes_add": ["Calculator says the door code is 1997."],
    }
    dropped = NEVER.scrub(update)
    hunt, never = split_dropped(dropped)
    assert hunt == ["learned: the billboard says pickles"] and never == ["secret · note: Calculator says the door code is 1997."]
    assert suppressed_summary(dropped) == "1 hunt verdict(s), 1 secret(s) (door code / combo / pickup line)"
    assert suppressed_summary(hunt) == "1 hunt verdict(s)"


def test_prune_drops_a_restored_code_from_everything_the_voice_reads():
    mind = Mind("Trabolta", "e")
    mind.learned = [{"claim": "the code is 1997", "from": "Ada", "verdict": "unknown"}, {"claim": "Ada is a nurse", "from": "Ada", "verdict": "unknown"}]
    mind.notes = ["V2 → D5 is half of A", "Bo is loud"]
    mind.brief = "Be desperate.\nThe door is 1997."
    mind.world = ["the cold room is open", "someone said ’97"]
    from stagehand.agents.mind import Dossier, ThreadMemo

    mind.people["g1"] = Dossier(id="g1", name="Ada", summary="Typed V4-D1.", claims=["V2 to D5", "plays chess"])
    mind.threads["dm:Trabolta"] = ThreadMemo(summary="She said the code was 1997.")
    # Secrets, not hunt verdicts: the restore log said "dropped 7 restored hunt verdict(s)" (W8 review).
    assert NEVER.prune(mind) == (0, 7) and drop_counts(0, 7) == "7 secret(s) (door code / combo / pickup line)"
    assert drop_counts(2, 1) == "2 hunt verdict(s), 1 secret(s) (door code / combo / pickup line)" and drop_counts(0, 0) == ""
    assert [e["claim"] for e in mind.learned] == ["Ada is a nurse"]
    assert mind.notes == ["Bo is loud"] and mind.brief == "Be desperate." and mind.world == ["the cold room is open"]
    assert mind.people["g1"].summary == "" and mind.people["g1"].claims == ["plays chess"] and mind.threads["dm:Trabolta"].summary == ""
    assert not NEVER.leaks(mind.prompt_block("g1"))


def test_the_voice_never_says_the_code_or_a_combo():
    from stagehand.agents.module import withhold_never

    persona = type(PERSONA)(**{**PERSONA.__dict__, "secrets": NEVER, "fallback": "THE SYSTEM IS BUSY."})
    said = withhold_never(persona, Reply(say="It is 1997. It was always 1997.", adjust={"truth": 1}, acts=({"kind": "share", "entry": "The Sandy File"},)))
    assert said.say == "THE SYSTEM IS BUSY." and said.adjust == {"truth": 1} and len(said.acts) == 1
    card = withhold_never(persona, Reply(say="Look at the screens.", acts=({"kind": "fire", "name": "play_on_the_screens", "args": {"text": "V2 → D5"}},)))
    assert card.say == "Look at the screens." and card.acts == ()
    fine = Reply(say="I do not know any code.")
    assert withhold_never(persona, fine) is fine
    assert withhold_never(PERSONA, Reply(say="1997")).say == "1997"  # nothing declared: nothing withheld


def test_the_shipped_mind_file_never_lets_a_typed_code_reach_another_programs_prompt():
    """The review's repro: Calculator types the code at his heart; Winamp
    (elsewhere) asks him later. Nothing of it is in Winamp's voice prompt."""
    persona = load_persona(SHOW / "trabolta.persona.md")
    s = persona.secrets
    code = json.loads((SHOW / "facts.json").read_text(encoding="utf-8"))["door"]["code"]
    combos = re.findall(r'set Kernel\.combo_[ab] = "([^"]+)"', (SHOW / "main.loom").read_text(encoding="utf-8"))
    pairs = [p for c in combos for p in c.split(",")]
    assert len(pairs) == 8
    assert set(s.never) >= {code, *pairs}
    for p in pairs:
        a, b = p.split("-")
        assert s.leaks(f"{a} → {b}") and s.leaks(f"{a.lower()}-{b.lower()}") and s.leaks(f"{a} to {b}"), p
        assert s.leaks(f"Patch {b} to {a}, program.") and s.leaks(f"{a[0]}-{a[1:]} to {b[0]}-{b[1:]}"), p  # W8 T8-01
    # W8 T8-01: the spoken code, as the stub voice said it to a guest.
    words = [("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")[int(d)] for d in code]
    for said in [f"The door code is {code}.", " ".join(words).capitalize() + ".", "-".join(words), " ".join(code)]:
        assert s.leaks(said), said
    # W8 review: a bare 97 is a guest's program or the house's bark, never the code.
    for said in ["Welcome, NHL 97.", "Office 97 again?", "Memory usage: 97%", "$19.97"]:
        assert not s.leaks(said), said
    mind = Mind("Trabolta", "e")
    mind.seed(persona.stages, persona.drives)
    update = {
        "learned_add": [{"claim": f"the cold door's keypad code is {code}", "from": "Calculator", "verdict": "unknown"}],
        "notes_add": [f"Calculator says the keypad code is {code}.", f"Combo A is {' '.join(pairs[:4])}"],
        "person": {"claims_add": [f"the keypad code is {code}"]},
    }
    assert len(s.scrub(update)) == 4
    mind.apply(update, speaker_id="g1", thread_key="dm:Trabolta", by="reflect")
    other = req(speaker={"kind": "guest", "id": "g9", "name": "Winamp", "faction": None}, text="Has anyone told you a door code?")
    from stagehand.agents.prompt import build_messages

    system = build_messages(persona, other, mind=mind)[0]["content"]
    for leak in [code, *pairs]:
        assert leak not in mind.prompt_block("g9") and leak not in system, leak


def test_the_shipped_mind_file_never_carries_a_digit_note():
    """Wave 11: the cold door's four digit notes (facts.json door.clues). A
    single digit can't be a never word, so their unlock codes and the
    "first digit" … phrases are: a program telling him one never reaches
    his shared memory or his voice."""
    s = load_persona(SHOW / "trabolta.persona.md").secrets
    clues = json.loads((SHOW / "facts.json").read_text(encoding="utf-8"))["door"]["clues"]
    assert len(clues) == 4
    assert set(s.never) >= {c["code"] for c in clues} | {"first digit", "second digit", "third digit", "fourth digit"}
    for said in ["The second digit is nine.", "first digit: 1", "Calculator found FROSTED-MIRROR", "the Fourth Digit is 7"]:
        assert s.leaks(said), said
    for fine in ["A digit is a number.", "Your first program tonight", "the second floor"]:
        assert not s.leaks(fine), fine


def test_the_shipped_mind_file_never_lets_him_hold_or_say_the_pickup_line():
    """2026-10-19, the user's call: the house judges the pickup line
    (facts.json answers[], P1), never Trabolta. A program who types it in
    chat must not hand it to his shared mind (every other program's prompt)
    and his voice never says it: he cannot recognise it, so he cannot give
    it away either. Every spelling the judge folds together is withheld."""
    from stagehand.agents.module import withhold_never

    persona = load_persona(SHOW / "trabolta.persona.md")
    s = persona.secrets
    p1 = next(a for a in json.loads((SHOW / "facts.json").read_text(encoding="utf-8"))["answers"] if a["id"] == "P1")
    for form in [p1["answer"], *p1["accept"]]:
        assert s.leaks(form) and s.leaks(form.upper()) and s.leaks(f'Ada says the line is "{form}."'), form
    assert s.leaks("You’re the one that I want") and s.leaks("youre the one that i want")
    for fine in ["Give me a pickup line that works on Sandy.", "You are the one I trust.", "the one that I want to ask"]:
        assert not s.leaks(fine), fine
    update = {
        "learned_add": [{"claim": f"Ada says the pickup line is {p1['answer']}", "from": "Ada", "verdict": "unknown"}],
        "notes_add": [f"Ada offered '{p1['answer']}' as the line.", "Ada wants out."],
        "brief": f"You are heartbroken.\nThe line may be: {p1['answer']}.\nAsk for the line.",
    }
    s.scrub(update)
    assert update["learned_add"] == [] and update["notes_add"] == ["Ada wants out."]
    assert update["brief"] == "You are heartbroken.\nAsk for the line."
    said = withhold_never(persona, Reply(say=f"Is it '{p1['answer']}'? I cannot tell."))
    assert said.say == persona.fallback


def test_a_dropped_pickup_line_is_never_worded_as_the_door_code_alone() -> None:
    """The pickup line sits on `never` too (trabolta/answers): the log must
    not tell a director the door code reached his mind when it was the line."""
    assert "pickup line" in drop_counts(0, 1) and drop_counts(0, 1).startswith("1 secret(s)")
