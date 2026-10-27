"""Wave 32 (talk-back, CONTRACT w32 C7/C8), the worker's side.

During a talk scene a host relays what Clippy says aloud in the Desktop;
the server asks the worker for a PUBLIC answer (`stage: {room, scene,
direction?}`, `speaker.stage: true`) that the TV speaks. Here:

- the shipped persona's `before the whole Desktop` block and one block per
  scene, gated on `speaker.stage` and `Night.talk`, inside his world;
- the lean voice's person card, the room's lines (scripted ones included)
  as context, the live exchange as turns, the canned line's `direction` as
  a must-follow steer;
- the guards (four sentences, no acts, the outside words) on a stage line;
- the priority lane: a waiting stage request is served before every
  waiting DM, one generation at a time.

Every secret word in the mechanics tests is made up (`test_voice_lean`'s
persona); the shipped-persona tests never print one.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import replace
from pathlib import Path

import pytest

from stagehand.agents.guards import allowed_answer_words, guard_pass, mentions_outside, outside_entry, outside_guard, situation_guard
from stagehand.agents.cards import PersonCard, Said
from stagehand.agents.persona import load_persona, parse_persona
from stagehand.agents.cards import VoiceOptions
from stagehand.agents.prompt import build_messages, gate_context, is_stage, matching_situations, stage_of
from stagehand.agents.reply import Reply
from stagehand.agents.slots import FIRST, NORMAL, Slots
from stagehand.agents.voice import answer_lean, build_lean_messages, history_turns, render_p3, right_now, room_lines, scene_cut, stage_steer
from stagehand.agents import module as agents_module

from stagehand.modapi import ModApiError

from test_story_mind import FakeMod, FakeReply, FakeVoice, handle, make, req as mind_req
from test_voice_lean import MODEL, MARKER, Model, context, persona as lean_persona, request, run, say

SHOW = Path(__file__).resolve().parents[2] / "core/examples/trapped-in-the-internet"
TRABOLTA = SHOW / "trabolta.persona.md"

STAGE_BLOCKS = ["before the whole Desktop", "the introduction", "the bottle", "the ad attack", "the beans"]
SCENES = {"intro": "the introduction", "bottle": "the bottle", "ad": "the ad attack", "beans": "the beans"}


def stage_request(scene="ad", direction=None, history=None, text="Trabolta, are you all right?", **world):
    """A public talk request as the server builds it (C4): Clippy, a player,
    speaking aloud in the Desktop; the room's lines as the history."""
    stage = {"room": "The Desktop", "scene": scene}
    if direction is not None:
        stage["direction"] = direction
    return {
        "id": "ar-9",
        "character": "Trabolta",
        "thread": {"character": "Trabolta", "channel": "loc:The Desktop", "audience": ["@Clippy"], "public": True},
        "speaker": {"kind": "performer", "id": "Clippy", "name": "Clippy", "faction": None, "player": True, "stage": True},
        "stage": stage,
        "text": text,
        "history": history
        if history is not None
        else [
            {"seq": 10, "mine": False, "from": "Clippy", "text": "Okay, programs! Round two!", "story": True},
            {"seq": 11, "mine": False, "from": "Narrator", "text": "The presentation freezes.", "story": True},
            {"seq": 12, "mine": True, "from": "Trabolta", "text": "Programs. The presentation will now resume.", "story": True},
            {"seq": 13, "mine": False, "from": "Clippy", "text": text},
        ],
        "self": {"vars": {"awake": "true", "truth": "40", "composure": "60"}, "ranges": {}, "codex": []},
        "them": {"vars": {"trust": "70", "defected": "none"}, "codex": [], "location": None},
        "world": {"Night.phase": "malware", "Night.step": "7", "Night.talk": scene, **world},
        "powers": [{"id": "flicker_the_screens", "limit": 3, "used": 0}],
    }


def headings(p, r):
    return [s.heading for s in matching_situations(p, r)]


# -- the shipped persona ---------------------------------------------------------------------


def test_each_scene_holds_the_desktop_block_and_its_own():
    p = load_persona(TRABOLTA)
    for scene, block in SCENES.items():
        assert headings(p, stage_request(scene)) == ["before the whole Desktop", block], scene


def test_the_stage_blocks_gate_on_speaker_stage_and_night_talk():
    p = load_persona(TRABOLTA)
    # No scene on (or one the persona does not know): the Desktop block alone.
    assert headings(p, stage_request("none")) == ["before the whole Desktop"]
    assert headings(p, stage_request("finale")) == ["before the whole Desktop"]
    # A private thread during a talk scene: none of them (the DM voice is unchanged).
    dm = stage_request("ad")
    del dm["stage"]
    dm["speaker"] = {"kind": "guest", "id": "g-1", "name": "Excel", "faction": None}
    dm["thread"] = {"character": "Trabolta", "channel": "dm:Trabolta", "audience": ["g-1"]}
    assert not set(STAGE_BLOCKS) & set(headings(p, dm))
    # Clippy's own Cast thread (a player, no stage): none either.
    cast = stage_request("intro")
    del cast["stage"]
    cast["speaker"] = {k: v for k, v in cast["speaker"].items() if k != "stage"}
    assert headings(p, cast) == []
    # The gate reads the raw speaker and the world's Night.talk.
    gate = gate_context(stage_request("beans"))
    assert gate["speaker"]["stage"] is True and gate["Night"]["talk"] == "beans"


def test_the_desktop_block_is_four_spoken_sentences_and_no_acts():
    p = load_persona(TRABOLTA)
    block = next(s for s in p.situations if s.heading == "before the whole Desktop")
    assert block.max_sentences == 4 and block.no_acts
    text = " ".join(block.prompt.split())
    assert "Your ambassador Clippy is speaking aloud in the Desktop" in text
    assert "comes out of the screen above the fireplace" in text
    assert "Answer Clippy directly, out loud" in text and "no lists, no symbols" in text
    assert "Never say where it hurts or where anything of yours is kept" in text
    assert "When a steer for this answer is given, follow it" in text
    # Three sentences asked for, four kept: the cut has a sentence to spare,
    # and a slip is taken back inside its own sentence, so a cut never leaves
    # one standing on the TV.
    assert "three sentences at most" in text and "two to four" not in text
    assert "take it back inside the same sentence, after a dash" in text and "Never end on a slip." in text
    # Gated on speaker.stage alone, it holds at the introduction too: it names
    # no pain and nothing inside the computer (the ad hijack is the first sign).
    assert "hurting" not in text and "in this computer" not in text
    for scene in SCENES.values():
        sit = next(s for s in p.situations if s.heading == scene)
        assert sit.max_sentences is None and not sit.no_acts  # the Desktop block sets both
    # The heart to heart is still the last block (its four sentences win at the heart).
    assert p.situations[-1].heading == "heart to heart"


def test_the_stage_blocks_stay_inside_his_world_and_name_no_place_or_number():
    p = load_persona(TRABOLTA)
    places = ("server room", "basement", "cold storage", "cold room", "patch bay", "heart", "cable")
    for s in p.situations:
        if s.heading not in STAGE_BLOCKS:
            continue
        flat = " ".join(s.prompt.split()).lower()
        assert not mentions_outside(p, s.prompt), s.heading
        assert not re.search(r"\d", s.prompt), s.heading
        assert "sandy" not in flat and "girlfriend" not in flat and "chatbot" not in flat, s.heading
        assert "layer" not in flat and "performer" not in flat and "the show" not in flat, s.heading
        assert not p.secrets.leaks(s.prompt), s.heading
        for word in places:
            if s.heading == "before the whole Desktop" and word == "cable":
                continue  # "no cable" is one of its nevers
            assert word not in flat, (s.heading, word)


def codex_codes():
    """Every codex unlock code: the story's `code:` lines and facts.json."""
    codes = set()
    for f in SHOW.rglob("*.loom"):
        for m in re.finditer(r'^\s*code:\s*"?([^"\n#]+?)"?\s*$', f.read_text(), re.M):
            codes.add(m.group(1).strip().lower())

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "code" and isinstance(v, str):
                    codes.add(v.lower())
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(json.loads((SHOW / "facts.json").read_text()))
    return codes


def test_the_stage_blocks_carry_no_codex_code():
    # What he is told to say on air is said to every program, and a program
    # can type it into the Codex. The failure names the block, never the code.
    codes = codex_codes()
    assert len(codes) > 50
    p = load_persona(TRABOLTA)
    for s in p.situations:
        if s.heading not in STAGE_BLOCKS:
            continue
        flat = s.prompt.lower()
        hits = sum(1 for c in codes if re.search(rf"(^|[^a-z0-9]){re.escape(c)}($|[^a-z0-9])", flat))
        assert hits == 0, f"{s.heading}: {hits} codex code(s)"


def test_each_scene_keeps_its_place_in_his_arc():
    p = load_persona(TRABOLTA)
    block = {s.heading: " ".join(s.prompt.split()) for s in p.situations}
    # The introduction: formal, the manners crack, no malware yet.
    assert "formal" in block["the introduction"] and "ALL CAPS" in block["the introduction"]
    assert "Not yet: adverts, a virus or malware" in block["the introduction"]
    assert "It is only lag to you: never say anything is hurting you or that something is in the computer." in block["the introduction"]
    assert "Truth Scavenger Hunt" in block["the introduction"]
    # The bottle: hungry, a guess hurts, the bottle next.
    assert "hungry" in block["the bottle"] and "a guess is corruption" in block["the bottle"]
    assert "never call any answer a guess, good, right or wrong; ask for more truth instead" in block["the bottle"]
    assert "Every guess read out" not in block["the bottle"] and "Where this goes: the bottle" in block["the bottle"]
    # The ad attack: real pain, the slips, each taken back, the second hunt next.
    ad = block["the ad attack"]
    assert "real pain" in ad and "a minor irregularity" in ad and "we are all going to die" in ad
    assert "Who brought the malware— disregard that" in ad and "never naming a program" in ad
    assert "each taken back inside the same sentence" in ad
    # Adverts sell things: no hotline or song register (C8's nevers live there).
    assert "CALL NOW" not in ad and "jingle" not in ad
    assert "they never give a phone line, a helpline, an operator, an agent, an extension, a song or a tune, and you never hum" in ad
    assert "Never a date, a year or a time of day. Never her." in ad and "the second hunt" in ad
    # The beans: unravelling, "her" allowed, never her name.
    beans = block["the beans"]
    assert "unravelling" in beans and 'You may say "her", once' in beans and "never her name" in beans
    assert "Hold it back: not yet." in beans


def test_the_fallbacks_are_fine_on_air():
    # A guard hit on a stage line puts a fallback on the TV: in his world, no digits.
    p = load_persona(TRABOLTA)
    lines = [p.fallback, *(line for pool in p.fallbacks.values() for line in pool)]
    assert lines
    for line in lines:
        assert not mentions_outside(p, line), line
        assert not re.search(r"\d", line), line
        assert not p.secrets.leaks(line)


def test_on_a_stage_line_the_guards_cut_to_four_sentences_drop_acts_and_still_withhold_outside_words():
    p = load_persona(TRABOLTA)
    gate = gate_context(stage_request("ad"))
    reply = Reply(say="One. Two words. THREE. Four now. Five is too many.", acts=({"kind": "fire", "name": "flicker_the_screens"},))
    out, notes = situation_guard(p, reply, gate)
    assert out.say == "One. Two words. THREE. Four now." and out.acts == ()
    assert "acts: none (1 dropped)" in notes and "cut to 4 sentences" in notes
    # The outside guard holds on air too: the line is withheld.
    leaky = Reply(say="Clippy, the performers are watching.")
    passed = guard_pass(p, leaky, PersonCard(id="Clippy", name="Clippy", kind="performer"), Said(), (), gate=gate)
    assert passed.withheld and passed.reply.say == p.fallback


# -- the lean voice on a stage request --------------------------------------------------------


def test_stage_of_reads_the_block_or_the_speaker_flag():
    assert stage_of(stage_request("ad"))["scene"] == "ad"
    flagged = stage_request("ad")
    del flagged["stage"]
    assert stage_of(flagged) == {} and is_stage(flagged)
    assert not is_stage(request())


def test_the_person_card_says_clippy_speaks_aloud_and_everyone_hears_him():
    p3 = render_p3(lean_persona(), stage_request("ad"), context(person=PersonCard(id="Clippy", name="Clippy", kind="performer")))
    assert (
        "Clippy (your ambassador Clippy, speaking aloud in the Desktop; every program hears your answer from the screen above the fireplace)"
        in p3
    )
    assert "a fellow character" not in p3
    # A DM keeps its card.
    clippy = context(person=PersonCard(id="Clippy", name="Clippy", kind="performer"))
    assert "Clippy (a fellow character — one of your cast)" in render_p3(lean_persona(), request(speaker={"kind": "performer", "id": "Clippy", "name": "Clippy", "faction": None}), clippy)


def test_the_rooms_lines_scripted_ones_included_are_his_context():
    r = stage_request("ad")
    p3 = render_p3(lean_persona(), r, context())
    block = p3[p3.index("=== THE DESKTOP, JUST NOW") :]
    assert "Clippy: “Okay, programs! Round two!”" in block
    assert "Narrator: “The presentation freezes.”" in block
    assert "You: “Programs. The presentation will now resume.”" in block
    assert "Clippy: “Trabolta, are you all right?”" in block
    assert "THE HOUSE POSTED HERE AS YOU" not in p3  # the room block holds them
    # A DM keeps the old house block and has no room block.
    dm = render_p3(lean_persona(), request(), context())
    assert "THE HOUSE POSTED HERE AS YOU" in dm and "JUST NOW" not in dm


def test_a_room_line_carrying_a_hunt_or_never_word_is_left_out_and_the_newest_are_kept():
    p = lean_persona()
    history = [
        {"seq": 1, "mine": True, "from": "Trabolta", "text": "I accept it. The answer is: quokka.", "story": True},
        {"seq": 2, "mine": False, "from": "Clippy", "text": "The snow globe question!", "story": True},
        {"seq": 3, "mine": False, "from": "Clippy", "text": "It was XYZZY-PLUGH.", "story": True},
        *({"seq": 10 + i, "mine": False, "from": "Clippy", "text": f"Line {chr(65 + i)}.", "story": True} for i in range(14)),
    ]
    lines = room_lines(p, stage_request("bottle", history=history))
    assert len(lines) == 12 and lines[-1] == "Clippy: “Line N.”" and lines[0] == "Clippy: “Line C.”"
    shown = " ".join(room_lines(p, stage_request("bottle", history=history), limit=50))
    assert "quokka" not in shown and "snow globe" not in shown and "XYZZY" not in shown


def test_only_the_live_exchange_is_a_turn_and_each_says_who_spoke():
    r = stage_request(
        "intro",
        history=[
            {"seq": 1, "mine": False, "from": "Clippy", "text": "Everyone, say hello to JEAN TRABOLTA!", "story": True},
            {"seq": 2, "mine": True, "from": "Trabolta", "text": "HELLO, PROGRAMS.", "story": True},
            {"seq": 3, "mine": False, "from": "Clippy", "text": "Do you like our house?"},
            {"seq": 4, "mine": True, "from": "Trabolta", "text": "It is adequate."},
            {"seq": 5, "mine": False, "from": "Clippy", "text": "Only adequate?"},
        ],
        text="Only adequate?",
    )
    assert history_turns(r) == [
        {"role": "user", "content": "Clippy: Do you like our house?"},
        {"role": "assistant", "content": "It is adequate."},
        {"role": "user", "content": "Clippy: Only adequate?"},
    ]
    # Nothing live yet (a fresh scene): the speaker's line alone.
    first = stage_request("intro", history=[{"seq": 1, "mine": False, "from": "Clippy", "text": "Hi!", "story": True}], text="Say hello, Trabolta!")
    assert history_turns(first) == [{"role": "user", "content": "Clippy: Say hello, Trabolta!"}]


def test_the_direction_is_a_must_follow_steer_right_before_the_answer():
    r = stage_request("intro", direction="Wrap up and send them to the hunt.")
    steer = stage_steer(r)
    assert steer == "YOUR STEER FOR THIS ANSWER (you must follow it; never say it aloud, never mention it): Wrap up and send them to the hunt."
    msgs = build_lean_messages(lean_persona(), r, context())
    assert msgs[-2]["role"] == "system" and msgs[-2]["content"].endswith(steer)
    assert steer in (right_now(lean_persona(), r, context()) or "")
    # No direction, no steer; a DM never has one.
    assert stage_steer(stage_request("intro")) is None and stage_steer(request()) is None
    assert "STEER" not in " ".join(m["content"] for m in build_lean_messages(lean_persona(), stage_request("intro"), context()))
    # A long one is clipped to one line.
    long = stage_steer(stage_request("intro", direction="go " * 400))
    assert long is not None and len(long) < 420 and "\n" not in long


def test_a_scripted_line_in_the_room_unlocks_no_answer_word():
    p = lean_persona()
    history = [
        {"seq": 1, "mine": False, "from": "Clippy", "text": "Was it a quokka?", "story": True},
        {"seq": 2, "mine": False, "from": "Clippy", "text": "Hello!"},
    ]
    assert "quokka" not in allowed_answer_words(p, stage_request("bottle", history=history, text="Hello!"))
    # Typed by Clippy (live), it is the speaker's word, as in a DM.
    typed = [{"seq": 1, "mine": False, "from": "Clippy", "text": "Was it a quokka?"}]
    assert "quokka" in allowed_answer_words(p, stage_request("bottle", history=typed, text="Was it a quokka?"))
    # A DM's story lines keep unlocking as before.
    dm = request(history=[{"seq": 1, "mine": False, "from": "Ada", "text": "a quokka", "story": True}])
    assert "quokka" in allowed_answer_words(p, dm)


def test_the_shipped_persona_answers_a_stage_line_with_the_blocks_and_no_acts():
    p = load_persona(TRABOLTA)
    model = Model(say("Clippy. Clippy! I am FINE. A minor irregularity. Go. Find. Interpret.", act={"fire": "flicker_the_screens"}))
    r = stage_request("ad", direction="Send them to the second hunt.")
    reply = run(answer_lean(p, MODEL, r, context(person=PersonCard(id="Clippy", name="Clippy", kind="performer")), model))
    sent = "\n".join(m["content"] for m in model.calls[0])
    assert "=== SITUATION: BEFORE THE WHOLE DESKTOP" in sent and "=== SITUATION: THE AD ATTACK" in sent
    assert "=== SITUATION: THE INTRODUCTION" not in sent
    assert "Here you may answer at length: up to 4 sentences." in sent
    assert "YOUR STEER FOR THIS ANSWER" in sent
    assert reply.acts == () and reply.say.count(".") + reply.say.count("!") <= 4 + 1


def test_the_classic_prompt_carries_the_room_the_named_turns_and_the_steer():
    # voice.layout: classic (the fallback ladder's rung) and mind_mode: classic
    # build with prompt.build_messages: a stage request there keeps C7's steer,
    # says who speaks aloud, and never passes the Narrator off as the speaker.
    p = load_persona(TRABOLTA)
    r = stage_request("ad", direction="Wrap up and send them to the hunt.")
    msgs = build_messages(p, r)
    system = msgs[0]["content"]
    assert "=== BEFORE THE ROOM ===" in system and "The one talking to you: Clippy (your ambassador Clippy, speaking aloud in the Desktop" in system
    assert "screen above the fireplace" in system
    assert 'Narrator: “The presentation freezes.”' in system and 'You: “Programs. The presentation will now resume.”' in system
    turns = [m for m in msgs if m["role"] != "system"]
    assert turns == [{"role": "user", "content": "Clippy: Trabolta, are you all right?"}]
    assert msgs[-2] == {"role": "system", "content": stage_steer(r)} and msgs[-1]["content"].startswith("Answer their last message")
    # Through answer_lean's classic layout, too.
    model = Model(say("Clippy. I am FINE. Go to the hunt."))
    run(answer_lean(p, MODEL, r, context(person=PersonCard(id="Clippy", name="Clippy", kind="performer"), options=VoiceOptions(layout="classic")), model))
    sent = model.calls[0]
    assert any(m["content"] == stage_steer(r) for m in sent)
    assert not any(m["role"] == "user" and m["content"] == "The presentation freezes." for m in sent)
    # A private thread's classic prompt is unchanged: no room, no steer.
    dm = build_messages(p, request())
    assert "BEFORE THE ROOM" not in dm[0]["content"] and not any("STEER" in m["content"] for m in dm)


# -- the priority lane --------------------------------------------------------------------------


def test_slots_serve_the_front_lane_first_and_keep_order_within_a_lane():
    async def go():
        slots = Slots(1)
        order: list[str] = []
        await slots.acquire()

        async def wait(name, lane):
            async with slots.lane(lane):
                order.append(name)
                await asyncio.sleep(0)

        tasks = [asyncio.ensure_future(wait("dm2", NORMAL)), asyncio.ensure_future(wait("dm3", NORMAL))]
        await asyncio.sleep(0)
        tasks.append(asyncio.ensure_future(wait("stage", FIRST)))
        await asyncio.sleep(0)
        assert slots.locked() and slots.waiting() == 3
        slots.release()
        await asyncio.gather(*tasks)
        assert not slots.locked() and slots.waiting() == 0
        return order

    assert run(go()) == ["stage", "dm2", "dm3"]


def test_a_cancelled_waiter_passes_the_slot_on():
    async def go():
        slots = Slots(1)
        await slots.acquire()
        got: list[str] = []

        async def wait(name, lane=NORMAL):
            async with slots.lane(lane):
                got.append(name)

        a = asyncio.ensure_future(wait("a", FIRST))
        b = asyncio.ensure_future(wait("b"))
        await asyncio.sleep(0)
        a.cancel()
        await asyncio.sleep(0)
        slots.release()
        await b
        assert a.cancelled() and not slots.locked()
        # Handed the slot in the same tick it was cancelled: it passes it on.
        await slots.acquire()
        c = asyncio.ensure_future(wait("c"))
        await asyncio.sleep(0)
        slots.release()  # c's future gets the slot …
        c.cancel()  # … and is cancelled before it runs
        await asyncio.gather(c, return_exceptions=True)
        assert not slots.locked()
        return got

    assert run(go()) == ["b"]


def test_slots_hold_as_many_as_they_have():
    async def go():
        slots = Slots(2)
        await slots.acquire()
        assert not slots.locked()
        await slots.acquire(FIRST)
        assert slots.locked()
        slots.release()
        slots.release()
        assert not slots.locked()

    run(go())
    with pytest.raises(ValueError):
        Slots(0)


class GatedVoice:
    """A fake `answer_lean` that holds the slot on its first call until let go."""

    def __init__(self):
        self.order: list[str] = []
        self.started = asyncio.Event()
        self.go = asyncio.Event()

    async def __call__(self, persona, model, req, ctx, complete_fn, trace=None, facts_fn=None, mind=None):
        self.order.append(str(req.get("id")))
        if len(self.order) == 1:
            self.started.set()
            await self.go.wait()
        return FakeReply(say="Noted.")


def test_a_stage_request_jumps_two_queued_dms_and_the_slot_stays_single(tmp_path):
    async def go():
        voice = GatedVoice()
        agents, _ = make(tmp_path, fake=voice)
        await agents.on_frame("request", json.dumps(mind_req(rid="dm-1", pid="g-1", name="Ada")))
        await voice.started.wait()
        assert agents._slots.locked()
        await agents.on_frame("request", json.dumps(mind_req(rid="dm-2", pid="g-2", name="Bob")))
        await agents.on_frame("request", json.dumps(mind_req(rid="dm-3", pid="g-3", name="Cy")))
        stage = stage_request("ad")
        stage["id"] = "stage-1"
        await agents.on_frame("request", json.dumps(stage))
        for _ in range(20):
            await asyncio.sleep(0)
        assert voice.order == ["dm-1"]  # one generation at a time: the rest wait
        assert agents._slots.waiting() == 3
        voice.go.set()
        while agents.tasks:
            await asyncio.gather(*agents.tasks.values(), return_exceptions=True)
        return voice.order, agents

    order, agents = run(go())
    assert order == ["dm-1", "stage-1", "dm-2", "dm-3"]
    assert [b["id"] for b in agents.mod.of("/api/agent/reply")] == ["dm-1", "stage-1", "dm-2", "dm-3"]


def test_a_stage_exchange_feeds_no_quiet_summary(tmp_path):
    # The stage thread's history is the whole room's (the Narrator, other
    # programs' scripted lines): a quiet summary of it would file them as
    # things Clippy said, then show that on her card all night.
    agents, _ = make(tmp_path, fake=FakeVoice(*(FakeReply(say=f"Line {i}.", memo=f"memo {i}") for i in range(3))))
    reqs = []
    for i in range(3):
        r = stage_request("ad")
        r["id"] = f"stage-{i}"
        reqs.append(r)
    run(handle(agents, *reqs))
    assert ("Trabolta", "Clippy") not in agents._quiet
    assert agents.minds["Trabolta"].people["Clippy"].turns == 3  # the exchanges still count
    # A DM still feeds one.
    run(handle(agents, mind_req(rid="dm-1", pid="g-1")))
    assert ("Trabolta", "g-1") in agents._quiet


class SettledMod(FakeMod):
    """The server answers every reply 410: its request was settled first."""

    async def post(self, p, body):
        if p == "/api/agent/reply":
            self.posts.append((p, body))
            raise ModApiError("410 settled", 410)
        return await super().post(p, body)


def test_a_reply_settled_before_it_went_out_is_never_already_said_nor_noted(tmp_path):
    # C4: a public reply that lands after its scene closed gets a 410; the
    # TV never spoke it, so no thread may be told he said it.
    agents, _ = make(tmp_path, fake=FakeVoice(FakeReply(say="We are all going to be fine.", memo="Clippy is rattled")))
    agents.mod = SettledMod()
    run(handle(agents, stage_request("ad")))
    mind = agents.minds["Trabolta"]
    assert [b["id"] for b in agents.mod.of("/api/agent/reply")] == ["ar-9"]
    assert mind.said == [] and not mind.people["Clippy"].memos
    # Delivered, the same line is kept as before.
    agents.mod = FakeMod()
    run(handle(agents, stage_request("ad")))
    assert [x["text"] for x in mind.said] == ["We are all going to be fine."]


def test_the_lane_of_a_request():
    assert agents_module.lane_of(stage_request("ad")) == FIRST
    assert agents_module.lane_of(request()) == NORMAL
    assert MARKER  # the made-up persona's secrets are what the mechanics tests use


def test_the_context_estimate_counts_the_stage_blocks_instead_of_the_heart_ones_and_one_scene_at_a_time():
    from stagehand.agents.orchestrator import SITUATION_OVERHEAD, situation_chars

    p = load_persona(TRABOLTA)
    size = {s.heading: len(s.prompt) + SITUATION_OVERHEAD for s in p.situations}
    heart = sum(v for k, v in size.items() if k not in STAGE_BLOCKS)
    one_scene = size["before the whole Desktop"] + max(size[b] for b in SCENES.values())
    assert situation_chars(p) == max(heart, one_scene)
    assert situation_chars(p) < sum(size.values())
    # A persona with no stage block counts every block, as before wave 32.
    plain = parse_persona("---\ncharacter: T\nsituations:\n  - name: a\n    when: them.x == true\n    prompt: aaaa\n  - name: b\n    when: them.y == true\n    prompt: bb\n---\nYou are T.")
    assert situation_chars(plain) == 6 + 2 * SITUATION_OVERHEAD
    # Stage blocks alone: the Desktop block plus the largest one scene lets hold.
    staged = parse_persona(
        "---\ncharacter: T\nsituations:\n"
        "  - name: d\n    when: speaker.stage == true\n    prompt: dddd\n"
        "  - name: x\n    when: speaker.stage == true && Night.talk == \"x\"\n    prompt: xxxxxxxx\n"
        "  - name: y\n    when: speaker.stage == true && Night.talk == \"y\"\n    prompt: yy\n"
        "---\nYou are T."
    )
    assert situation_chars(staged) == 4 + 8 + 2 * SITUATION_OVERHEAD


# -- wave 32's fixes: the crew's John, a withheld line's memo, the register, the scene cut ---------

CREW_JOHN = "John (not followed by McAfee)"


def test_an_outside_entry_may_name_what_must_not_follow_it():
    assert outside_entry(CREW_JOHN) == ("John", ("McAfee",))
    assert outside_entry("John (not followed by McAfee, Smith)") == ("John", ("McAfee", "Smith"))
    assert outside_entry("John (Not Followed By McAfee or Smith)") == ("John", ("McAfee", "Smith"))
    assert outside_entry("Steph") == ("Steph", ())
    assert outside_entry("Steph's laptop") == ("Steph's laptop", ())


@pytest.mark.parametrize(
    "line",
    [
        "Good evening, John.",
        "A warm hello to JOHN at the front!",
        "John's here? Welcome, program.",
        "Hello, John. McAfee sends his regards.",  # a sentence ends on him: the crew's
        "Thank you, john",
        "Say hello to the Johns.",
        "Steph, welcome.",
        "Jesse is at the front.",
    ],
)
def test_the_crews_john_is_outside_his_world_and_steph_and_jesse_still_are(line):
    p = replace(lean_persona(), outside=(CREW_JOHN, "Steph", "Jesse"))
    assert mentions_outside(p, line)
    got, notes = outside_guard(p, Reply(say=line))
    assert got.say == p.fallback and "outside (line withheld)" in notes


@pytest.mark.parametrize(
    "line",
    [
        "John McAfee is an Antivirus of distinction.",
        "JOHN MCAFEE, report to the Desktop!",
        "John-McAfee approves.",
        "Ask John McAfee's people.",
        "Johnny is not a program I know.",
        "Hello, programs.",
    ],
)
def test_john_mcafee_is_his_world(line):
    p = replace(lean_persona(), outside=(CREW_JOHN, "Steph", "Jesse"))
    assert not mentions_outside(p, line)
    assert outside_guard(p, Reply(say=line)) == (Reply(say=line), [])


def test_a_persona_without_the_entry_is_unchanged():
    assert not mentions_outside(replace(lean_persona(), outside=("Steph", "Jesse")), "Good evening, John.")
    assert not mentions_outside(lean_persona(), "Good evening, John, Steph and Jesse.")


def test_the_shipped_persona_withholds_a_hello_to_john_on_air_in_a_dm_and_on_the_classic_path():
    p = load_persona(TRABOLTA)
    assert CREW_JOHN in p.outside and "John" not in p.outside
    hello = "Good evening, John. I extend a warm hello from Maps and Ducks tonight."
    clippy = PersonCard(id="Clippy", name="Clippy", kind="performer")
    for gate in (gate_context(stage_request("intro")), gate_context(request())):
        out = guard_pass(p, Reply(say=hello, memo="I greet the crew."), clippy, Said(), (), gate=gate)
        assert out.withheld and out.reply.say == p.fallback and out.reply.memo == ""
        assert "outside (line withheld)" in out.notes and "memo dropped (line withheld)" in out.notes
    # mind_mode: classic runs outside_guard itself.
    assert outside_guard(p, Reply(say=hello))[0].say == p.fallback
    # John McAfee (an Antivirus) is still his to name.
    assert not mentions_outside(p, "John McAfee, take the hall.")
    # Through the lean voice: on the TV and in a DM.
    for r in (stage_request("intro", text="Say hello to John!"), request(text="Say hello to John!")):
        reply = run(answer_lean(p, MODEL, r, context(person=clippy), Model(say(hello, memo="I greet the crew."))))
        assert "John" not in reply.say and reply.memo == ""


def test_a_withheld_line_keeps_no_memo_and_the_lean_path_logs_its_guard_notes(caplog):
    p = replace(lean_persona(), outside=(CREW_JOHN,))
    model = Model(say("Good evening, John.", memo="I greet the crew, keeping tone formal."))
    with caplog.at_level(logging.INFO, logger="stagehand.agents.voice"):
        reply = run(answer_lean(p, MODEL, request(text="Say hi to John"), context(), model))
    assert reply.memo == "" and "John" not in reply.say
    logged = [r for r in caplog.records if r.levelno == logging.INFO and ": guard: " in r.getMessage()]
    assert logged and "outside (line withheld)" in logged[0].getMessage() and "memo dropped (line withheld)" in logged[0].getMessage()
    # A note never carries the word that tripped the guard.
    assert all("John" not in r.getMessage() for r in logged)
    # A clean line keeps its memo and logs no guard note.
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="stagehand.agents.voice"):
        ok = run(answer_lean(p, MODEL, request(text="Hello"), context(), Model(say("Welcome, program Ada.", memo="Ada is polite."))))
    assert ok.memo == "Ada is polite." and not [r for r in caplog.records if ": guard: " in r.getMessage()]


def test_a_withheld_retry_keeps_neither_its_memo_nor_the_first_lines():
    # The first line repeats (one retry); the retry names the crew's John and is
    # withheld: the first line's memo is not carried over onto the fallback.
    p = replace(lean_persona(), outside=(CREW_JOHN,))
    model = Model(say("Speak, program.", memo="Ada again."), say("Good evening, John.", memo="I greet the crew."))
    reply = run(answer_lean(p, MODEL, request(), context(), model))
    assert len(model.calls) == 2 and reply.memo == "" and "John" not in reply.say


def _block(p, heading):
    return " ".join(next(s for s in p.situations if s.heading == heading).prompt.split())


def test_the_stage_register_is_the_owners_never_an_assistants():
    p = load_persona(TRABOLTA)
    desk = _block(p, "before the whole Desktop")
    assert "never an assistant: you never offer help, never ask whether they have questions" in desk
    assert "never say you are sorry you cannot say something, never say you are not aware of something" in desk
    assert "you never call yourself an operating system or the thing that runs the house" in desk
    # A forbidden question is waved away without its nouns echoed back.
    assert "never say its nouns back to the room" in desk
    assert 'Never "hum" or "humming", not even as a figure of speech.' in desk
    intro = _block(p, "the introduction")
    assert "formal, grand and proud" in intro and "Never an assistant offering help." in intro
    assert "in most replies your manners crack once: a word freezes and comes out twice, a sentence stops and starts again from the top, or one word arrives in ALL CAPS" in intro
    assert "No slip here: nothing escapes you but lag." in intro
    assert "This program has performed an operation" not in intro  # a catchphrase to copy, cut by its ration


def test_only_the_ad_block_quotes_a_slip_and_the_general_block_has_no_wording_to_copy():
    p = load_persona(TRABOLTA)
    desk = _block(p, "before the whole Desktop")
    # The shape, not the words: the live run said "— correction" in 7 of 29 replies.
    assert "correction" not in desk.lower() and "going to" not in desk
    assert "in your own words, and take it back inside the same sentence, after a dash" in desk
    assert "Only where the block for this moment allows a slip" in desk and "never a slip with nothing in it" in desk
    for heading in ("the introduction", "the bottle", "the beans"):
        assert "correction" not in _block(p, heading).lower(), heading
    ad = _block(p, "the ad attack")
    assert '"we are all going to die", corrected ("We are all going to— correction, we are all going to be fine.")' in ad


def test_at_the_ad_attack_the_pain_shows_and_the_denial_waits_for_private():
    p = load_persona(TRABOLTA)
    ad = _block(p, "the ad attack")
    assert "while the adverts are still in you, you cannot hide it: never say you are not hurt, never call it nothing" in ad
    assert 'Every reply here has one advert breaking into it mid-sentence (a duck, "BUY NOW", "FREE", "CLICK HERE", "NEW AND IMPROVED") or one word SCREAMED in capitals' in ad
    brief = " ".join(p.phase_cards["malware"].brief.split())
    assert "While the adverts are still tearing through you at the Desktop, the pain shows and you cannot pretend otherwise." in brief
    assert "Afterwards, and to any program in private, deny every one of them: a minor irregularity." in brief
    assert "Deny every one of them" not in brief


def _bottle_then_ad():
    return [
        {"seq": 1, "mine": False, "from": "Clippy", "text": "You look hungry, Trabolta."},
        {"seq": 2, "mine": True, "from": "Trabolta", "text": "I am still hungry. Let the spin begin!"},
        {"seq": 3, "mine": False, "from": "Narrator", "text": "An advert tears through the slide.", "story": True},
        {"seq": 4, "mine": False, "from": "Clippy", "text": "WHAT WAS THAT?"},
    ]


def test_a_new_scene_starts_its_live_turns_afresh():
    r = stage_request("ad", history=_bottle_then_ad(), text="WHAT WAS THAT?")
    cut, state = scene_cut(r, ("bottle", 0))
    assert state == ("ad", 2) and cut["stage"]["after_seq"] == 2 and "after_seq" not in r["stage"]
    # The bottle's exchange is no longer a turn; the room block still shows it, as said.
    assert history_turns(cut) == [{"role": "user", "content": "Clippy: WHAT WAS THAT?"}]
    assert 'You: “I am still hungry. Let the spin begin!”' in render_p3(lean_persona(), cut, context())
    # Later in the same scene, the cut holds and the new exchange stays.
    later = stage_request(
        "ad",
        history=[*_bottle_then_ad(), {"seq": 5, "mine": True, "from": "Trabolta", "text": "A minor— BUY NOW— irregularity."}, {"seq": 6, "mine": False, "from": "Clippy", "text": "Are you hurt?"}],
        text="Are you hurt?",
    )
    cut2, state2 = scene_cut(later, state)
    assert state2 == ("ad", 2)
    assert [t["content"] for t in history_turns(cut2)] == ["Clippy: WHAT WAS THAT?", "A minor— BUY NOW— irregularity.", "Clippy: Are you hurt?"]


def test_the_first_stage_request_and_a_dm_cut_nothing():
    r = stage_request("ad", history=_bottle_then_ad(), text="WHAT WAS THAT?")
    same, state = scene_cut(r, None)  # a worker restarted mid-scene cannot tell
    assert same is r and state == ("ad", 0) and len(history_turns(same)) == 3
    dm = request()
    assert scene_cut(dm, ("ad", 2)) == (dm, ("ad", 2))
    # A scene change with nothing of his said live yet keeps the earlier cut.
    fresh = stage_request("beans", history=[{"seq": 9, "mine": False, "from": "Clippy", "text": "BEANS?!"}], text="BEANS?!")
    assert scene_cut(fresh, ("ad", 2))[1] == ("beans", 2)


def test_the_worker_cuts_at_a_scene_change(tmp_path):
    agents, fake = make(tmp_path, fake=FakeVoice(FakeReply(say="Hungry.", memo=""), FakeReply(say="FREE— a minor irregularity.", memo="")))
    bottle = stage_request("bottle", history=_bottle_then_ad()[:2], text="You look hungry, Trabolta.")
    bottle["id"] = "stage-b"
    ad = stage_request("ad", history=_bottle_then_ad(), text="WHAT WAS THAT?")
    ad["id"] = "stage-a"
    run(handle(agents, bottle, ad))
    assert "after_seq" not in fake.calls[0][0]["stage"]
    assert fake.calls[1][0]["stage"]["after_seq"] == 2
