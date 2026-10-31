"""The shipped Trabolta persona + mind file: what each model may be told,
and when. (Mechanics live in test_agents / test_situations; this file pins
the show's own text.)"""

import json
from pathlib import Path

import yaml

from stagehand.agents.persona import load_persona

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"
TRABOLTA = SHOW / "trabolta.persona.md"
MIND = SHOW / "trabolta.mind.md"


def mind_front() -> dict:
    """The mind file's frontmatter, read with plain YAML: the same under the
    base parser (which stringifies a card) and wave 12's (which reads it)."""
    text = MIND.read_text(encoding="utf-8")
    return yaml.safe_load(text[3 : text.find("\n---", 3)])


def phase_table() -> dict:
    """Every phase in file order, `_` keys (the stage cards) left out."""
    return {str(k): v for k, v in mind_front()["phases"].items() if not str(k).startswith("_")}


def flat(text) -> str:
    return " ".join(str(text or "").split())


def cue_of(phase: str) -> str:
    """What the classic orchestrator is handed (the wave 12 contract §C4.2: cue, else brief)."""
    card = phase_table()[phase]
    return flat(card) if isinstance(card, str) else flat(card.get("cue") or card.get("brief"))


def brief_of(phase: str) -> str:
    """What the voice reads in every conversation (a bare string is its own brief)."""
    card = phase_table()[phase]
    return flat(card) if isinstance(card, str) else flat(card.get("brief") or card.get("cue"))

#: Night.phase in running order up to (not including) the overshare, where
#: the story first names Sandy (main.loom's Night.step table, steps 0–12).
BEFORE_THE_OVERSHARE = (
    "arrivals",
    "desktop",
    "bingo",
    "bingo_results",
    "introduced",
    "hunt_1",
    "truth_1",
    "malware",
    "hunt_2",
    "summons",
    "truth_pong",
    "trust_chart",
    "beans",
)


def test_no_pre_overshare_phase_cue_nor_the_bargain_names_sandy():
    # Wave 6 decision 5: the Truther Download blacks her name out until the
    # story says it; the orchestrator's brief must not say it sooner, and
    # the bargain reaches the voice on every turn from the doors.
    p = load_persona(TRABOLTA)
    assert set(BEFORE_THE_OVERSHARE) <= set(phase_table())
    named = [phase for phase in BEFORE_THE_OVERSHARE if "sandy" in (cue_of(phase) + brief_of(phase)).lower()]
    assert named == []
    assert "sandy" not in p.bargain.lower()
    # The download reaches the mind in hunt_2 (when it is sent), redacted.
    assert "download" not in (cue_of("malware") + brief_of("malware")).lower()
    assert "blacked out" in cue_of("hunt_2") and "blacked out" in brief_of("hunt_2")
    # The favour policy is written into every brief, and `beans` (before the
    # overshare) is already the unravelling floor: its line names nobody,
    # and neither does the overshare cue's policy (scenarios 2–4 never say her
    # name before the recount).
    policy = (p.mind_prompt or "").split("FAVOUR POLICY", 1)[1].split("\n\n", 1)[0]
    unravelling = policy.split("- unravelling:", 1)[1].split("\n- ", 1)[0]
    assert "sandy" not in unravelling.lower()
    assert "sandy" not in cue_of("overshare").split("Policy", 1)[1].lower()
    assert "sandy" not in brief_of("overshare").lower()


# -- wave 7: at his heart (the candid "Master" talk) -------------------------

import re  # noqa: E402

from stagehand.agents.guards import mentions_outside  # noqa: E402
from stagehand.agents.prompt import allowed_powers, build_messages, matching_situations, their_variables  # noqa: E402


def heart_request(at_the_heart=None, marked=None, **world):
    them = {"trust": "50", "featured": "excel", "marked_for": "missed the cup"}
    if at_the_heart is not None:
        them["at_the_heart"] = at_the_heart
    if marked is not None:
        them["marked"] = marked
    return {
        "thread": {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g1"]},
        "speaker": {"kind": "guest", "id": "g1", "name": "Excel", "faction": None},
        "text": "Is this your heart?",
        "history": [{"seq": 1, "mine": False, "from": "Excel", "text": "Is this your heart?"}],
        "self": {"vars": {"awake": "true", "truth": "40"}, "ranges": {}, "codex": []},
        "them": {"vars": them, "codex": [], "location": "The Server Room"},
        "world": {"Night.phase": "y2k", "Night.step": "14", **world},
        "powers": [{"id": "snoop", "limit": None, "used": 0}],
    }


def test_the_shipped_persona_has_its_situations_and_whitelists():
    p = load_persona(TRABOLTA)
    # Wave 20: standing down is gone (D13: the story's talk decides), a docked
    # choice has its own block and the heart to heart wins over the rest (§7).
    # Wave 32: the talk scenes' blocks (a stage request) sit before the heart to heart.
    assert [s.heading for s in p.situations] == [
        "at your heart",
        "marked at your heart",
        "a choice is open",
        "her name has been said",
        "her name is still blacked out",
        "before the whole Desktop",
        "the introduction",
        "the bottle",
        "the ad attack",
        "the beans",
        "heart to heart",
    ]
    assert {"at_the_heart", "heart_menu", "heart_heard", "heart_chat", "heart_out"} <= set(p.them or ())
    assert "heart_layer" not in (p.them or ())  # wave 29: how far they got reaches him only in words
    assert {"Night.heart_opened", "Night.heart_stage", "Night.server_door"} <= set(p.facts)
    assert "stand_down" not in [x["id"] for x in allowed_powers(p, heart_request())]


def test_the_heart_block_appears_only_at_the_heart():
    p = load_persona(TRABOLTA)
    at = build_messages(p, heart_request("true"))[0]["content"]
    assert "=== SITUATION: AT YOUR HEART" in at and "heart: this patch bay; the cables are you" in at
    assert "combinations, the door's code: never held them" in at and "stand_down" not in at
    # (w42d) Notes, never lines: the battery heard the old bullets word for word.
    assert "never lines to read back" in at and "forcing it would not be her" not in at
    for closed in (heart_request("false"), heart_request()):
        system = build_messages(p, closed)[0]["content"]
        assert "=== SITUATION" not in system and "this patch bay" not in system


def test_a_program_thrown_out_of_his_heart_gets_no_candour():
    # D24: Heart Barred — a barred program's re-scan gets no candid block.
    p = load_persona(TRABOLTA)
    req = heart_request("true")
    req["them"]["vars"]["heart_out"] = "true"
    req["them"]["vars"]["heart_chat"] = "true"
    names = [s.heading for s in matching_situations(p, req)]
    assert not {"at your heart", "marked at your heart", "heart to heart"} & set(names)


def test_sandy_by_name_at_the_heart_only_once_the_story_has_named_her():
    # The same rule as main.loom's unredaction of the Truther Download.
    p = load_persona(TRABOLTA)
    names = lambda req: [s.heading for s in matching_situations(p, req)]  # noqa: E731
    blacked = "her name is still blacked out"
    said = "her name has been said"
    assert names(heart_request("true", **{"Night.scenario": "2"})) == ["at your heart", blacked]
    assert names(heart_request("true")) == ["at your heart", blacked]
    assert names(heart_request("true", **{"Night.scenario": "1"})) == ["at your heart", said]
    # Wave 11: candid at his heart whenever he is awake (the door plays The
    # Heart at any hour). Her name still follows the story's own rule
    # (scenario 1 from step 13). Wave 20: no standing-down block.
    assert names(heart_request("true", **{"Night.scenario": "1", "Night.step": "13"})) == ["at your heart", said]
    assert names(heart_request("true", **{"Night.scenario": "1", "Night.step": "12"})) == ["at your heart", blacked]
    assert names(heart_request("true", **{"Night.phase": "hunt_1", "Night.step": "5"})) == ["at your heart", blacked]
    assert names(heart_request("false", **{"Night.step": "5"})) == []
    assert names(heart_request("true", **{"Night.scenario": "3", "Night.recount": "true"})) == ["at your heart", said]
    for s in p.situations:
        if s.heading != said:
            assert "sandy" not in s.prompt.lower(), s.heading


def test_the_heart_never_hands_out_a_code_or_a_combination():
    p = load_persona(TRABOLTA)
    heart = p.situations[0].prompt.lower()
    assert "never: a hunt answer" in heart and "a combination" in heart and "any door code" in heart
    assert "never promise them an ending" in heart and "stand_down" not in heart
    assert "nothing said in this room ends the night" in " ".join(heart.split())
    # Outside the heart the page still forbids saying where it is.
    assert "Never admit where your heart is kept" in p.system
    assert "never know a combination or a door code" in p.bargain


def test_no_power_ends_him_and_the_page_says_so():
    # Wave 20 (D13): the stand_down power and its STANDING DOWN block are
    # gone, and since wave 58 nothing said to him stops him.
    p = load_persona(TRABOLTA)
    assert "stand_down" not in p.system and "STANDING DOWN" not in p.system
    assert "stand_down" not in p.bargain and "STANDING DOWN" not in p.bargain
    assert "Never offer, agree or accept to stop, stand down" in flat(p.system) and "for any price or plea" in flat(p.system)
    assert "nothing said to you decides it" in " ".join(p.bargain.split()) and "no act of yours ends" in " ".join(p.bargain.split())
    for s in p.situations:
        assert "stand_down" not in s.prompt and "STANDING DOWN" not in s.prompt, s.heading
    for req in (heart_request("true", **{"Night.phase": "hunt_1", "Night.step": "5"}), heart_request("true")):
        assert "STANDING DOWN" not in build_messages(p, req)[0]["content"]


def test_a_docked_choice_and_the_heart_to_heart_follow_them():
    # Wave 20 §7: a choice on the screen → one short line pointing back to it;
    # the heart to heart (heart_chat) → up to four sentences, no acts, inside
    # his world, and it wins over the docked-choice block.
    p = load_persona(TRABOLTA)
    names = lambda **them: [s.heading for s in matching_situations(p, {**heart_request("true"), "them": {"vars": {"at_the_heart": "true", **them}, "codex": [], "location": "The Server Room"}})]  # noqa: E731
    assert "a choice is open" in names(heart_menu="true")
    assert "heart to heart" not in names(heart_menu="true")
    assert "a choice is open" not in names(heart_menu="true", heart_chat="true")
    assert "heart to heart" in names(heart_menu="true", heart_chat="true")
    assert "heart to heart" in names(heart_chat="true")
    assert names(heart_menu="false", heart_chat="false") == ["at your heart", "her name is still blacked out"]
    away = [s.heading for s in matching_situations(p, heart_request("false", **{}))]
    assert away == []
    choice = next(s for s in p.situations if s.heading == "a choice is open").prompt
    assert "under fifteen words" in choice and "pointing them back to" in " ".join(choice.split())
    h2h = next(s for s in p.situations if s.heading == "heart to heart").prompt
    flat = " ".join(h2h.split())
    assert "overrides every block above" in flat and "Halifax" in flat and "every never holds" in flat
    assert "You decide and do nothing here" in flat and "you have never heard of" in flat
    assert "sandy" not in flat.lower() and not re.search(r"\d{3,}", h2h)
    assert p.situations[-1].heading == "heart to heart"


def test_the_fiction_boundary_lists_what_is_outside_his_world():
    # Wave 20 (D29): Trabolta lives in Halifax, in the world of Maps and Ducks;
    # the real crew and the event's kit are outside it. The guard reads the
    # `outside:` list (stagehand lane); the story keeps his own text clean.
    import yaml

    meta = yaml.safe_load((SHOW / "trabolta.persona.md").read_text(encoding="utf-8").split("---")[1])
    outside = meta["outside"]
    for w in ("Steph", "Jesse", "Steph's laptop", "the show", "actor", "performer", "rehearsal", "Loom", "stagehand", "Arduino", "Zigbee"):
        assert w in outside, w
    # His own world is never outside it: John McAfee, the fundraiser party.
    for w in ("John", "party", "parties"):
        assert w not in outside, w
    p = load_persona(TRABOLTA)
    texts = [p.system, p.bargain] + [s.prompt for s in p.situations]
    for t in texts:
        for w in outside:
            assert not re.search(rf"(?<![\w]){re.escape(w)}(?![\w])", t, re.I), w
    assert "YOUR WORLD is Halifax and Maps and Ducks" in p.system and "Names from beyond it mean nothing" in " ".join(p.system.split())


def test_the_mind_knows_the_door_is_a_keypad_not_a_click():
    p = load_persona(TRABOLTA)
    assert "clicked in the walls" not in cue_of("majority") + brief_of("majority")
    assert "does not know" in cue_of("majority") and "code" in cue_of("majority")
    assert "do not know any code" in brief_of("majority")
    assert "AT HIS HEART" in (p.mind_prompt or "")
    assert "He does NOT know where his heart is kept" not in (p.mind_prompt or "")


def test_no_persona_or_mind_text_says_tent():
    # On a rain night the Internet is the shed (core's show test pins the same).
    for name in ("trabolta.persona.md", "trabolta.mind.md"):
        text = (SHOW / name).read_text(encoding="utf-8")
        assert [i + 1 for i, line in enumerate(text.splitlines()) if re.search(r"\btent\b", line, re.I)] == [], name


def test_the_year_he_met_her_is_never_said():
    # Wave 7 decision 1: the door code is the year he met her. No file he
    # holds spells it any more (the wave 7 review), but a program may type
    # it to him, so both models are told never to say or record that year —
    # anything learned included — and the worker enforces it (`secrets.never`,
    # generated from facts.json: the frontmatter no model sees). Neither
    # prompt spells the number.
    p = load_persona(TRABOLTA)
    assert "Never say what year you met her" in p.system
    assert "The year he met her is never said" in (p.mind_prompt or "")
    assert "learned_add" in (p.mind_prompt or "")
    # Wave 11b: the code is no longer that year (it comes from facts.json); the
    # year rule stays as lore, and the worker still never says the code.
    code = json.loads((SHOW / "facts.json").read_text(encoding="utf-8"))["door"]["code"]
    assert code in p.secrets.never
    for prompt in (p.system, p.mind_prompt or ""):
        assert code not in prompt


# -- wave 11b: a marked program (the Antivirus flagged it for the Internet) ---------------


def test_the_voice_and_the_mind_see_the_mark_but_never_why():
    p = load_persona(TRABOLTA)
    assert "marked" in (p.them or ()) and "marked_for" not in (p.them or ())
    system = build_messages(p, heart_request("true", "true"))[0]["content"]
    assert "Their marked: true" in system and "missed the cup" not in system
    assert their_variables(p, heart_request("true", "true")["them"]["vars"]).get("marked") == "true"


def test_the_marked_blocks_follow_the_heart_and_the_mark():
    p = load_persona(TRABOLTA)
    names = lambda req: [s.heading for s in matching_situations(p, req) if "marked" in s.heading]  # noqa: E731
    assert names(heart_request("true", "true")) == ["marked at your heart"]
    # Away from the heart the mark changes nothing he is told (live, a passing
    # remark became a line he repeated every reply).
    assert names(heart_request("false", "true")) == []
    assert names(heart_request(None, "true")) == []
    for unmarked in (heart_request("true", "false"), heart_request("true"), heart_request("false", "false"), heart_request()):
        assert names(unmarked) == []
    # The heart itself still holds for a marked program, at any hour.
    at = [s.heading for s in matching_situations(p, heart_request("true", "true"))]
    assert at[:2] == ["at your heart", "marked at your heart"]
    early = [s.heading for s in matching_situations(p, heart_request("true", "true", **{"Night.phase": "hunt_1", "Night.step": "5"}))]
    assert early[:2] == ["at your heart", "marked at your heart"]


def test_marked_at_his_heart_he_is_wary_but_lets_them_carry_on():
    p = load_persona(TRABOLTA)
    block = next(s for s in p.situations if s.heading == "marked at your heart").prompt
    flat = " ".join(block.split()).lower()
    assert "you can see the mark" in flat and "you do not know why they were marked" in flat
    assert "bait" in flat and "fellow prisoner" in flat and "ask them why they were marked" in flat
    assert "raises your regard" in flat and "lowers it" in flat  # their answer moves him either way
    assert "stay candid" in flat and "still take their files" in flat
    assert "the questions on the screen are theirs exactly as anyone's" in flat
    assert "never refuse to talk to them, never threaten them, never send them away" in flat
    assert "never guess what the mark says about any fact they filed" in flat
    # No literal power name (the heart's own rule), no name, no number.
    assert "stand_down" not in block and "sandy" not in flat and not re.search(r"\d{3,}", block)
    system = build_messages(p, heart_request("true", "true"))[0]["content"]
    assert system.index("=== SITUATION: AT YOUR HEART") < system.index("=== SITUATION: MARKED AT YOUR HEART")


def test_the_mind_notes_a_marked_program_at_his_heart_and_its_answer_moves_trust():
    from stagehand.agents.mind import Mind
    from stagehand.agents.orchestrator import reflect_messages
    from stagehand.agents.reply import Reply

    p = load_persona(TRABOLTA)
    mind_text = " ".join((p.mind_prompt or "").split())
    assert "MARKED PROGRAMS." in mind_text and "The mark is public" in mind_text
    assert "came to his heart marked" in mind_text and "move their trust either way" in mind_text
    assert "never closes his heart's questions to them, and never goes into the brief" in mind_text
    assert "The one exception is the mark for reinstallation (MARKED PROGRAMS)" in mind_text
    user = reflect_messages(p, Mind("Trabolta", "e"), heart_request("true", "true"), Reply(say="x"), None, 20, "t")[1]["content"]
    assert "=== THE SITUATION WITH Excel (marked at your heart;" in user
    assert '"marked": "true"' in user and "missed the cup" not in user


# -- wave 11b live run: what the real model got wrong, pinned in the persona ---------------


def test_the_persona_never_hands_out_an_answer_it_made_up():
    """Found live on gpt-oss:20b (wave 11b integration): an exact filer who
    asked for "the right answer" was once handed an invented one ("The
    correct answer is: …"). The rule now says so outright."""
    p = load_persona(TRABOLTA)
    system = " ".join(p.system.split())
    assert "you never give one, never make one up: no answer, guess, count or hiding place" in system
    assert "Asked for the right answer, tell them to file what they found" in system
    # K-04 (wave 12 integration): "I'll find you something true" was once
    # answered with an invented title for H6 and a made-up hiding place.
    assert "told they will find you something, thank them" in system
    # 2026-10-19: he truly does not know them (no answer reaches any prompt:
    # core/test/trabolta-answers.test.ts), and the persona says so.
    assert "You do not know the answers to your own questions: that is why you ask." in system


# -- wave 12: the phase table, and a Trabolta hungry for the facts he asks for -------------

CARD_KEYS = {"stage", "favours", "drives", "powers", "tell", "brief", "cue"}
CATCHPHRASES = ("your request has been logged", "please wait", "this program has performed an operation")


def resolved_cards() -> dict[str, dict]:
    """The wave 12 contract §C4.1's inheritance, in file order: stage / favours / powers
    / tell carry over, drives merge, the brief never does."""
    front = mind_front()
    prev = {"stage": front["stages"][0], "favours": "none", "drives": dict(front["drives"]), "powers": [], "tell": []}
    out = {}
    for phase, card in phase_table().items():
        card = {"cue": card} if isinstance(card, str) else card
        cur = {k: card.get(k, prev[k]) for k in ("stage", "favours", "powers", "tell")}
        cur["drives"] = {**prev["drives"], **(card.get("drives") or {})}
        cur["brief"] = flat(card.get("brief") or card.get("cue"))
        out[phase] = prev = cur
    return out


def test_the_phase_table_is_well_formed():
    # The rules W2's parser and `stagehand check` enforce (the wave 12 contract §C4.3),
    # checked here on the plain YAML so the show text is right before either.
    front = mind_front()
    stages, drives = front["stages"], front["drives"]
    assert stages == ["asleep", "formal", "hungry", "rattled", "judge", "unravelling", "desperate", "last act"]
    assert drives == {"hunger": 30, "pride": 60, "candour": 10, "longing": 40}
    cards = front["phases"]["_stages"]
    assert list(cards) == stages and all(isinstance(t, str) and t.strip() for t in cards.values())
    for phase, card in phase_table().items():
        assert isinstance(card, dict), phase  # every phase is a card now, none a bare cue
        assert set(card) <= CARD_KEYS, (phase, set(card) - CARD_KEYS)
        assert card.get("stage", stages[0]) in stages, phase
        assert card.get("favours", "none") in ("none", "earned", "loose"), phase
        for name, value in (card.get("drives") or {}).items():
            assert name in drives and isinstance(value, int) and 0 <= value <= 100, (phase, name)
        for key in ("powers", "tell"):
            assert all(isinstance(x, str) and x.strip() for x in card.get(key, [])), (phase, key)
        # A brief never carries over: every card writes its own, and a cue for classic.
        assert isinstance(card.get("brief"), str) and card["brief"].strip(), phase
        assert isinstance(card.get("cue"), str) and card["cue"].strip(), phase


def test_the_cards_follow_the_night():
    cards = resolved_cards()
    assert [p for p, c in cards.items() if c["stage"] == "asleep"] == ["arrivals", "desktop", "bingo", "bingo_results"]
    assert cards["truth_1"]["stage"] == "hungry"  # never "asleep" during the hunt again (DESIGN §1.8)
    assert {p: c["favours"] for p, c in cards.items() if p in ("hunt_1", "truth_1", "beans", "y2k", "final_reveal")} == {
        "hunt_1": "none", "truth_1": "earned", "beans": "loose", "y2k": "earned", "final_reveal": "none",
    }
    assert cards["y2k"]["drives"] == {"hunger": 90, "pride": 70, "candour": 80, "longing": 75}
    assert cards["advice"]["drives"]["candour"] == 100 and cards["grok_prom"]["drives"]["longing"] == 95
    # Wave 20 (D13): no card carries stand_down; the story's talk at his heart decides.
    assert [p for p, c in cards.items() if "stand_down" in c["powers"]] == []
    assert cards["final_reveal"]["powers"] == [] and cards["bobbing"]["powers"] == ["assess"]


def test_no_card_the_house_reads_names_her_says_a_secret_or_reaches_for_the_catchphrase():
    # Every conversation reads the brief and the stage card (P2): no heart, no
    # code, no catchphrase, and her name only from the verdict (truth.txt is
    # read to the house; grok_prom on).
    p = load_persona(TRABOLTA)
    cards = resolved_cards()
    phases = list(cards)
    verdict = phases.index("grok_prom")
    texts = [("_stages." + k, flat(v)) for k, v in mind_front()["phases"]["_stages"].items()]
    texts += [(phase, cards[phase]["brief"]) for phase in phases]
    for where, text in texts:
        low = text.lower()
        assert not p.secrets.leaks(text), where
        assert not any(c in low for c in CATCHPHRASES), where
        assert not re.search(r"\b(?:suspicio\w*|bluster)\b", low), where
        if where.startswith("_") or phases.index(where) < verdict:
            assert "sandy" not in low, where
            assert not re.search(r"\b(?:heart|server room|patch bay|cold room|cables?)\b", low), where
    for phase in phases:
        assert not p.secrets.leaks(cue_of(phase)), phase
        assert "suspicion" not in cue_of(phase).lower() and "bluster" not in cue_of(phase).lower(), phase


def test_he_is_hungry_for_the_facts_he_asks_for_and_never_judges_them():
    p = load_persona(TRABOLTA)
    system = flat(p.system)
    assert "FACTS ARE FOOD." in system
    assert "A fact offered is a gift that delights you" in system and "send them to the 📝 card in this thread to file it" in system
    assert "Every offer delights you the same" in system
    # (w42d) Never doubted, never asked for again, never read back as a step list.
    assert "never ask for evidence, proof or a source" in system and "never ask for a fact they have just given you" in system
    assert "the Moment of Truth will say" in system and "ask one question about it, then" not in system
    assert "never call one correct, right, true, accurate, wrong or false" in system
    assert "never thank them" not in system
    # The bargain pays for a fact given or filed, never one he "can check".
    assert "a fact you can check" not in flat(p.bargain) and "a fact given or filed buys" in flat(p.bargain)


def test_the_distress_line_is_kind_short_and_points_to_a_way_out():
    # (w42c) The worker's fixed answer to a guest in real distress (DRAFT w42c,
    # SIGNOFF-w42.md): Bathroom Mode and a host, no wait, no fact, no Internet.
    p = load_persona(TRABOLTA)
    line = p.distress
    assert "Bathroom Mode" in line and "Clippy" in line and "Task Manager" in line
    assert "?" not in line and not re.search(r"\b(?:internet|wait|fact|hold on)\b", line, re.I)
    assert len(re.findall(r"[.!]", line)) <= 2
    assert not p.secrets.leaks(line) and not mentions_outside(p, line)


def test_the_catchphrase_is_a_greeting_not_his_voice():
    p = load_persona(TRABOLTA)
    system = flat(p.system)
    # Said once, in the sentence that rations it: at most one, at first contact.
    assert system.count("Your request has been logged") == 1
    assert "are a greeting: at most one, the first time a program writes to you, and never again to them" in system
    assert "never a line you have already said" in system


def test_the_mind_page_no_longer_makes_him_wary_of_facts():
    p = load_persona(TRABOLTA)
    mind = flat(p.mind_prompt)
    assert "bluster" not in mind and "about me" not in mind and "suspicious" not in mind
    assert "Your request has been logged" not in mind
    assert "a gift that delights him the same, whatever it says" in mind
    assert "never lower anyone's trust for it" in mind
    assert "never anyone for asking about facts" in mind
    # No hunt topic as an example (DESIGN §3: the 412 example; the summary's
    # billboard fact).
    assert "412" not in mind and "billboard" not in mind.lower()
