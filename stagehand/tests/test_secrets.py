"""Answer secrecy (OCT31 K-23): the character can never check a hunt answer.

The orchestrator's verdicts on hunt claims are suppressed before they reach
the mind (the voice reads `learned`), and hunt-answer codex entries never
reach a prompt. The last block pins the shipped show: every question and
answer in DESIGN §2.11 is caught, every stamped codex entry is hidden.
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
from stagehand.agents.secrets import Secrets
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
    assert SECRETS.prune(mind) == 1 and [e["claim"] for e in mind.learned] == ["Ada is a nurse"]


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
    text = (SHOW / "DESIGN.md").read_text(encoding="utf-8")
    rows = re.findall(r"^\| (H[1-6]|F[12]) \| [^|]+ \| ([^|]+) \| ([^|]+) \|", text, re.MULTILINE)
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
    for claim in ("Grok is taking Sandy to computer prom", "the song was Hopelessly Devoted to You", "the last chapter is Appendix Z", "Sandy only ever says to ask for a live agent"):
        assert s.names_topic(claim), claim
    assert "grok" not in (s.rule("Trabolta") or "").lower()


#: Answer words the shipped lore block may carry, by entry: bare numbers
#: in a date or a clock, and an SW-AI-21 entry Trabolta holds (DESIGN.md: he
#: reads F1/F2 in the overshare). Any other `match` word in the block fails.
LORE_ALLOWED = {
    "Greased Lightning": {"1978"},
    "Screenshot: MONOPOLY GO!": {"1978"},
    "The Y2K Clock": {"11"},
    "Trabolta's LiveJournal (trabolta_4ever)": {"did not understand"},  # SW-AI-21
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
    stamped = [e for e in entries if not s.lore_ok(e)]
    assert len(stamped) == HUNT_ENTRIES
    block = lore_block(Facts({"codex": entries}), held + [e["title"] for e in stamped], secrets=s)
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
    # The Rival names F2's answer and Trabolta doesn't hold it: never ground truth.
    assert "The Rival" in {e["title"] for e in entries} and "The Rival" not in held
    assert "The Rival:" not in block and "grok" not in block.lower()
    # Once a guest feeds it to him, he holds it, and it leads with a ★.
    fed = lore_block(Facts({"codex": entries}), held + ["The Rival"], secrets=s)
    assert "★ The Rival:" in fed


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
