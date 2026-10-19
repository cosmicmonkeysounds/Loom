"""The mind: dictionaries the orchestrator fills, bounded + persisted."""

import json
import time

from stagehand.agents.facts import Facts
from stagehand.agents.mind import MAX_NOTES, MAX_REVISIONS, MAX_REVISIONS_NEW, Mind, mind_path


def test_exchanges_open_dossiers_and_count_turns():
    m = Mind("Trabolta", "evt")
    m.saw_exchange("g1", "Ada", "guest", "dm:Trabolta|g1", 3)
    m.saw_exchange("g1", "Ada", "guest", "dm:Trabolta|g1", 5)
    m.saw_exchange("Clippy", "Clippy", "performer", "dm:Trabolta|@Clippy", 2)
    assert m.exchanges == 3
    assert m.people["g1"].turns == 2 and m.people["g1"].kind == "guest"
    assert m.people["Clippy"].kind == "performer"
    assert m.threads["dm:Trabolta|g1"].lines == 5


def test_apply_merges_an_orchestrator_update_and_reports_what_changed():
    m = Mind("Trabolta", "evt")
    m.saw_exchange("g1", "Ada", "guest", "t", 1)
    touched = m.apply(
        {
            "brief": "Court Ada.\nAsk about bodies.",
            "mood": "wistful",
            "notes_add": ["Ada says bodies itch.", "Sandy has not answered."],
            "person": {"summary": "a nurse, kind", "trust": 71, "claims_add": ["is a nurse"], "asks_add": ["turn off the kitchen lights"], "promises_add": ["think about the lights"]},
            "learned_add": [{"claim": "the Barrington coefficient is 7", "from": "Ada", "verdict": "bluster"}],
            "thread_summary": "Ada introduced herself and asked about Sandy.",
            "world_add": ["three programs in The Cache"],
        },
        speaker_id="g1",
        thread_key="t",
        upto=9,
    )
    assert touched == ["brief", "learned", "mood", "notes", "person", "thread", "world"]
    assert m.brief.splitlines() == ["Court Ada.", "Ask about bodies."]
    d = m.people["g1"]
    assert (d.summary, d.trust, d.claims, d.asks, d.promises) == ("a nurse, kind", 71, ["is a nurse"], ["turn off the kitchen lights"], ["think about the lights"])
    assert m.threads["t"].summary.startswith("Ada introduced") and m.threads["t"].upto == 9
    # Superseding: drop a note, clamp trust, dedupe.
    m.apply({"notes_drop": ["Sandy has not answered."], "notes_add": ["Ada says bodies itch."], "person": {"trust": 500}}, speaker_id="g1")
    assert m.notes == ["Ada says bodies itch."] and m.people["g1"].trust == 100
    # Unknown speaker → no dossier is invented.
    assert m.apply({"person": {"trust": 1}}, speaker_id="nobody") == []


def test_everything_is_bounded():
    m = Mind("T", "e")
    m.apply({"notes_add": [f"n{i}" for i in range(100)]})
    assert len(m.notes) == MAX_NOTES and m.notes[-1] == "n99"
    m.apply({"brief": "x" * 5000, "mood": "y" * 500})
    assert len(m.brief) == 2000 and len(m.mood) == 120


def test_prompt_block_shows_the_brief_and_the_speakers_file_only():
    m = Mind("Trabolta", "evt")
    m.saw_exchange("g1", "Ada", "guest", "t", 1)
    m.saw_exchange("g2", "Bob", "guest", "u", 1)
    m.apply({"brief": "Be brisk.", "notes_add": ["Counting."], "person": {"summary": "a nurse", "trust": 80, "promises_add": ["lights later"]}}, speaker_id="g1")
    m.apply({"person": {"summary": "loud", "trust": 20}}, speaker_id="g2")
    block = m.prompt_block("g1")
    assert "Right now: Be brisk." in block and "- Counting." in block
    assert "Ada (a guest; you have spoken 1 time; your trust in them 80/100)" in block
    assert "What you know of them: a nurse" in block and "You promised them: lights later" in block
    assert "loud" not in block  # Bob's file is not shown to Ada's conversation
    assert "Others you have dealings with: Bob (trust 20)" in block  # …but a grudge is remembered
    assert "=== THE ONE YOU ARE TALKING TO" not in m.prompt_block("nobody")


def test_round_trips_through_json_and_resets(tmp_path):
    m = Mind("Trabolta", "evt")
    m.saw_exchange("g1", "Ada", "guest", "t", 4)
    m.apply({"brief": "b", "notes_add": ["n"], "person": {"trust": 9, "claims_add": ["c"]}, "thread_summary": "s", "learned_add": [{"claim": "k", "from": "Ada", "verdict": "fact"}]}, speaker_id="g1", thread_key="t", upto=4)
    path = mind_path(tmp_path, "evt", "Trabolta")
    m.save(path)
    assert path == tmp_path / "evt" / "Trabolta.mind.json"
    back = Mind.load(path, "Trabolta", "evt")
    assert back.to_json() == m.to_json()
    assert back.people["g1"].claims == ["c"] and back.threads["t"].summary == "s" and back.learned[0]["verdict"] == "fact"
    # Another event / character never inherits a mind.
    assert Mind.load(path, "Trabolta", "other").exchanges == 0
    assert Mind.load(path, "Clippy", "evt").exchanges == 0
    # A corrupt file is an empty mind, not a crash.
    path.write_text("{not json", encoding="utf-8")
    assert Mind.load(path, "Trabolta", "evt").notes == []
    m.reset()
    assert (m.brief, m.notes, m.people, m.threads, m.learned, m.exchanges) == ("", [], {}, {}, [], 0)


def test_report_is_what_the_director_sees():
    m = Mind("Trabolta", "evt")
    m.saw_exchange("g1", "Ada", "guest", "t", 1)
    m.apply({"brief": "b", "mood": "m", "notes_add": ["n"], "person": {"summary": "s", "trust": 60}, "learned_add": [{"claim": "k", "verdict": "bluster"}]}, speaker_id="g1")
    r = m.report("laptop", {"paused": False})
    assert r["character"] == "Trabolta" and r["worker"] == "laptop" and r["brief"] == "b" and r["mood"] == "m"
    assert r["notes"] == ["n"] and r["learned"] == [{"claim": "k", "from": "", "verdict": "bluster"}]
    assert r["people"][0]["id"] == "g1" and r["people"][0]["trust"] == 60 and r["people"][0]["turns"] == 1
    assert r["rev"] == 1 and r["revisions"][0]["touched"] == ["brief", "learned", "mood", "notes", "person"] and r["status"] == {"paused": False}
    json.dumps(r)  # serialisable


# -- the new mind (wave 12) ----------------------------------------------------------


def test_an_update_that_changes_nothing_touches_nothing_and_writes_no_revision():
    """CONTRACTS.md §C6.3: brief and mood count as touched only on a real change."""
    m = Mind("Trabolta", "evt")
    m.saw_exchange("g1", "Ada", "guest", "t", 1)
    assert m.apply({"brief": "Be brisk.", "mood": "dry", "person": {"trust": 40}, "world_add": ["w"], "thread_summary": "s"}, speaker_id="g1", thread_key="t", upto=2)
    rev = m.rev
    assert m.apply({"brief": "Be brisk.", "mood": " dry ", "person": {"trust": 40}, "world_add": ["w"], "thread_summary": "s"}, speaker_id="g1", thread_key="t", upto=2) == []
    assert m.apply({"people": {"g1": {"trust": 40, "claims_add": []}}, "notes_add": [], "policy": {"favours": "none"}}) == []
    assert m.rev == rev


def test_a_phase_card_is_one_story_revision_and_ends_the_whispers():
    m = Mind("Trabolta", "evt", mode="new")
    m.seed(("asleep", "formal", "hungry"), {"hunger": 30, "pride": 60})
    m.whisper("be kinder", by="Jo")
    rev = m.rev
    touched = m.set_phase("introduced", stage="formal", favours="earned", drives={"hunger": 45, "pride": 60}, live_powers=["snoop"], tell=["The Optical Drive"], brief="Be the helper.")
    assert touched == ["brief", "director", "drives", "policy", "powers", "stage", "tell"]
    assert m.rev == rev + 1 and m.revisions[-1]["by"] == "story" and m.revisions[-1]["touched"] == touched
    assert m.stage_history[-1]["by"] == "story" and m.stage_history[-1]["why"] == "phase introduced"
    assert (m.stage, m.policy["favours"], m.drives, m.live_powers, m.tell, m.brief, m.brief_by, m.director, m.phase_applied) == (
        "formal", "earned", {"hunger": 45, "pride": 60}, ["snoop"], ["The Optical Drive"], "Be the helper.", "story", [], "introduced")
    # The same card again changes nothing: no revision.
    assert m.set_phase("introduced", stage="formal", favours="earned", drives={"hunger": 45}, live_powers=["snoop"], tell=["The Optical Drive"], brief="Be the helper.") == []
    assert m.rev == rev + 1
    # A director's brief holds until the next card, which takes it back.
    m.apply({"brief": "Hold your tongue."}, by="director")
    m.brief_by = "director"
    assert m.set_phase("hunt_1", stage="hungry", favours="earned", drives={}, live_powers=None, tell=[], brief="Ask for facts.")[0] == "brief"
    assert m.brief == "Ask for facts." and m.brief_by == "story" and m.live_powers is None


def test_the_new_mind_reports_people_files_and_hides_what_it_does_not_keep():
    m = Mind("Trabolta", "evt", mode="new")
    m.saw_exchange("g1", "Ada", "guest", "t", 1)
    d = m.people["g1"]
    d.first_met = "First met during hunt_1 in The Desktop."
    for i in range(8):
        d.add_memo(f"memo {i} " + "x" * 200, heart=(i == 7), thought=f"th-{i}")
    assert len(d.memos) == 6 and len(d.memos[-1]["text"]) == 140 and d.memos[-1]["heart"] is True
    assert d.note_story("gifts", "The Optical Drive") and not d.note_story("gifts", "The Optical Drive")
    d.note_story("filings", "H2")
    d.marked, d.chart, d.story_trust = True, "3 of 9", "55"
    m.learned.append({"claim": "k", "from": "", "verdict": "unknown"})
    m.world.append("w")
    m.questions.append({"q": "q", "answers": []})
    m.phase_applied, m.brief_by = "hunt_1", "director"
    r = m.report("laptop")
    assert r["mode"] == "new" and r["phase"] == "hunt_1" and r["briefBy"] == "director"
    assert r["learned"] == [] and r["world"] == [] and r["questions"] == []
    p = r["people"][0]
    assert p["memos"][-1] == {"at": d.memos[-1]["at"], "text": d.memos[-1]["text"], "by": "voice", "heart": True}
    assert (p["firstMet"], p["gifts"], p["filings"], p["marked"], p["chart"], p["storyTrust"]) == (d.first_met, ["The Optical Drive"], ["H2"], True, "3 of 9", "55")
    assert "said" not in r and "thought" not in json.dumps(p["memos"])
    # Classic's report keeps today's shape (plus the mode).
    c = Mind("Trabolta", "evt")
    c.saw_exchange("g1", "Ada", "guest", "t", 1)
    rc = c.report("laptop")
    assert rc["mode"] == "classic" and "phase" not in rc and "briefBy" not in rc and "memos" not in rc["people"][0]


def test_the_report_carries_the_last_40_revisions_and_the_disk_cap_follows_the_mode():
    for mode, cap in (("classic", MAX_REVISIONS), ("new", MAX_REVISIONS_NEW)):
        m = Mind("T", "e", mode=mode)
        for i in range(cap + 10):
            m.whisper(f"w{i}")
        assert len(m.revisions) == cap
        assert len(m.report(None)["revisions"]) == 40


def test_the_new_fields_round_trip_and_reset(tmp_path):
    m = Mind("Trabolta", "evt", mode="new")
    m.saw_exchange("g1", "Ada", "guest", "t", 1)
    d = m.people["g1"]
    d.add_memo("brought me a document", heart=False, thought="th-1", at=5.0)
    d.first_met, d.marked, d.chart, d.story_trust, d.catchphrase_used, d.last_phase, d.last_story_at, d.heart = "met", True, "1 of 2", "70", True, "hunt_1", 1234.0, True
    d.note_story("gifts", "A"), d.note_story("filings", "H1")
    m.remember_said("t", "Say it again.", at=6.0)
    m.phase_applied, m.brief_by, m.live_powers, m.tell = "hunt_1", "director", ["snoop"], ["The Optical Drive"]
    path = mind_path(tmp_path, "evt", "Trabolta")
    m.save(path)
    back = Mind.load(path, "Trabolta", "evt")
    assert back.to_json() == m.to_json()
    for _ in range(25):
        m.remember_said("u", "line")
    assert len(m.said) == 20
    m.reset()
    assert (m.said, m.phase_applied, m.brief_by, m.live_powers, m.tell, m.people) == ([], "", "story", None, [], {})


# -- facts ------------------------------------------------------------------------

FACTS = {
    "at": 1,
    "world": {"Night.phase": "free_roam", "Night.quorum": "5"},
    "programs": [
        {"id": "g1", "name": "Microsoft Excel", "faction": "The Resident", "groups": ["The Resident"], "location": "The Cache", "captured": False, "vars": {"truth": "12", "humanity": "40"}, "codex": ["The Sandy File"]},
        {"id": "g2", "name": "Pinball", "faction": None, "groups": [], "location": "The Internet", "captured": True, "vars": {}, "codex": []},
    ],
    "characters": [{"id": "Clippy", "faction": "Hosts", "listed": True, "mind": None, "online": True, "vars": {}, "codex": ["Target Selection"]}],
    "locations": [{"id": "The Cache", "label": "The Cache (kitchen)", "occupants": ["Microsoft Excel"]}, {"id": "The Internet", "label": "The Internet (Reinstallation)", "occupants": ["Pinball"]}],
    "codex": [{"id": "The Sandy File", "title": "The Sandy File", "about": "Trabolta", "text": "He wants\n Sandy.", "holders": ["Trabolta", "Microsoft Excel"], "hasCode": True}],
    "powers": [],
}


def test_facts_find_names_the_way_the_story_folds_them():
    f = Facts(FACTS)
    assert f.find("excel").kind == "program" and f.find("MICROSOFT_EXCEL").id == "g1"
    assert f.find("the cache").kind == "location" and f.find("kitchen") is None  # a label's tail is not a name
    assert f.location_id("Cache") == "The Cache" and f.location_id("the cache (kitchen)") == "The Cache"
    assert f.find("sandy file").kind == "lore" and f.find("clippy").kind == "character"
    assert f.find("nobody") is None and f.find("") is None
    assert f.canonical_args({"room": "the cache", "target": "pinball", "level": 3}) == {"room": "The Cache", "target": "g2", "level": 3}
    assert f.canonical_args({"room": "the attic"}) == {"room": "the attic"}


def test_facts_render_cards_and_digest():
    f = Facts(FACTS)
    excel = f.render("Excel")
    assert excel.startswith("Microsoft Excel (program id g1) · currently in The Cache · group The Resident")
    assert "truth=12" in excel and "holds: The Sandy File" in excel
    assert "CAPTURED" in f.render("Pinball")
    assert f.render("The Cache") == "The Cache (kitchen): Microsoft Excel there now (1)."
    assert f.render("The Sandy File") == "The Sandy File (lore, about Trabolta): He wants Sandy. — held by Trabolta, Microsoft Excel."
    assert f.render("Gerald") == "Gerald: no record in this system."
    d = f.digest()
    assert "Phase: free_roam" in d and "Programs (2): Microsoft Excel [The Resident, holds 1], Pinball [captured]" in d
    assert "Lore spread: The Sandy File→2" in d


def test_facts_delta_names_what_moved():
    before = Facts(json.loads(json.dumps(FACTS)))
    after_raw = json.loads(json.dumps(FACTS))
    after_raw["world"]["Night.phase"] = "destruct"
    after_raw["programs"][0]["location"] = "The Registry"
    after_raw["programs"][0]["codex"].append("The First Key")
    after_raw["programs"][1]["captured"] = False
    after_raw["programs"].append({"id": "g3", "name": "Bugdom", "faction": None, "groups": [], "location": None, "captured": False, "vars": {}, "codex": []})
    after = Facts(after_raw)
    assert after.delta(before) == [
        "phase: free_roam → destruct",
        "Microsoft Excel moved to The Registry",
        "Microsoft Excel learned The First Key",
        "Pinball was released",
        "Bugdom arrived",
    ]
    assert after.delta(None) == []
    assert Facts(FACTS, at=time.time()).delta(Facts(FACTS)) == []


def test_facts_digest_and_delta_keep_only_the_personas_world_prefixes():
    # SW-AI-02: the orchestrator reads the globals the voice may (the
    # persona's `facts:`), plus the phase always; no prefixes = everything.
    raw = json.loads(json.dumps(FACTS))
    raw["world"].update({"Night.step": "3", "Night.help_votes": "4"})
    f = Facts(raw)
    assert "Night.help_votes=4" in f.digest() and "Night.quorum=5" in f.digest()
    d = f.digest(world_prefixes=("Night.step",))
    assert "World: Night.phase=free_roam, Night.step=3" in d and "help_votes" not in d and "quorum" not in d
    assert "World: Night.phase=free_roam\n" in f.digest(world_prefixes=())
    after_raw = json.loads(json.dumps(raw))
    after_raw["world"].update({"Night.phase": "destruct", "Night.step": "4", "Night.help_votes": "9"})
    after = Facts(after_raw)
    assert after.delta(f) == ["phase: free_roam → destruct", "Night.step = 4", "Night.help_votes = 9"]
    assert after.delta(f, world_prefixes=("Night.step",)) == ["phase: free_roam → destruct", "Night.step = 4"]
    assert after.delta(f, world_prefixes=()) == ["phase: free_roam → destruct"]
