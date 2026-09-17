"""The mind: dictionaries the orchestrator fills, bounded + persisted."""

import json
import time

from stagehand.agents.facts import Facts
from stagehand.agents.mind import MAX_NOTES, Mind, mind_path


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
    r = m.report("laptop")
    assert r["character"] == "Trabolta" and r["worker"] == "laptop" and r["brief"] == "b" and r["mood"] == "m"
    assert r["notes"] == ["n", "[learned] k (bluster)"]
    assert r["people"] == [{"id": "g1", "name": "Ada", "summary": "s", "trust": 60}]
    json.dumps(r)  # serialisable


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
