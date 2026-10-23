//! Wave 20 (D4): a room terminal's picture cue. A `cue room_<name>` inside a
//! beat set in a LOCATION is folded per room into the screen state's
//! `room.cue` for a terminal polling that LOCATION (by id or label); a wall
//! or the TV never sees it, it is never a screen cue family and never a
//! moment, and the first look at a sim (its history) stamps it `at: 0`.
//! Plus the night block's heart vars, always carried.

import { describe, expect, it } from "vitest";

import { ROOM_CUE_PREFIX, SCREEN_NIGHT_VARS, ScreenWatch, roomCueOf } from "../server/routes/screen.ts";
import { Sim } from "../src/runtime/sim/index.ts";

const STORY = `# T

ROLE Program

LOCATION The Desktop

LOCATION The Server Room
  label: The Server Room (cold storage)
  hidden: true

when wake:
  -> Heart Wake

when wake_by_label:
  -> Heart By Label

when desktop_cue:
  -> Desktop Cue

when loose_cue:
  cue room_heart_loose

when talk for program:
  -> Heart Talk

when mixed:
  -> Mixed

== Heart Wake
  setting: The Server Room
cue room_heart_wake
Trabolta: You came.

== Heart By Label
  setting: the server room (cold storage)
<cue: room_heart_glow, slow>

== Heart Talk
  setting: The Server Room
cue room_heart_talk

== Desktop Cue
  setting: The Desktop
cue room_desktop_hello

== Mixed
  setting: The Server Room
cue screens_alarm
cue roomy_thing
cue room_
cue heart_red
`;

function rig(t0 = 10_000) {
  let t = t0;
  const sim = Sim.fromSources(STORY);
  sim.createPerson("g1", "Winamp", "Program");
  const w = new ScreenWatch({ now: () => t });
  const poll = (who: { room?: string; view?: string; name?: string } = {}) =>
    w.poll(sim, { name: who.name ?? "Server Room", spot: "server-room", view: who.view ?? "face", character: "", ...(who.room !== undefined ? { room: who.room } : {}) }, () => false);
  return { sim, w, poll, at: (ms: number) => void (t = ms) };
}

describe("roomCueOf", () => {
  it("takes a `room_<name>` first token, as written; anything else is null", () => {
    expect(ROOM_CUE_PREFIX).toBe("room_");
    expect(roomCueOf("room_heart_wake")).toBe("room_heart_wake");
    expect(roomCueOf("  room_heart_glow, slow")).toBe("room_heart_glow");
    expect(roomCueOf("room_heart_glow slow")).toBe("room_heart_glow");
    expect(roomCueOf("room_")).toBeNull();
    expect(roomCueOf("roomy_thing")).toBeNull();
    expect(roomCueOf("screens_room_x")).toBeNull();
    expect(roomCueOf("")).toBeNull();
  });
});

describe("the room cue fold (`room.cue`)", () => {
  it("is null until a beat set in the room cues one; then value + seq + the fold's clock", () => {
    const s = rig();
    expect(s.poll({ room: "The Server Room" }).room).toEqual({ id: "The Server Room", open: false, cue: null });
    s.sim.signal("wake");
    s.at(11_000);
    expect(s.poll({ room: "The Server Room" }).room?.cue).toEqual({ value: "room_heart_wake", seq: 1, at: 11_000 });
  });

  it("matches the room by the beat setting's id or label, and the poll's id or label, folded", () => {
    const s = rig();
    s.poll({ room: "The Server Room" });
    s.sim.signal("wake_by_label");
    s.at(12_000);
    const want = { value: "room_heart_glow", seq: 1, at: 12_000 };
    expect(s.poll({ room: "The Server Room" }).room?.cue).toEqual(want);
    expect(s.poll({ room: "the server room (cold storage)" }).room?.cue).toEqual(want);
    expect(s.poll({ room: "THE SERVER ROOM" }).room?.cue).toEqual(want);
  });

  it("is kept per room, last wins, and the seq bumps on every cue, a repeat included", () => {
    const s = rig();
    s.poll({ room: "The Server Room" });
    s.sim.signal("wake");
    s.sim.signal("talk", "g1");
    s.sim.signal("talk", "g1");
    s.at(13_000);
    expect(s.poll({ room: "The Server Room" }).room?.cue).toEqual({ value: "room_heart_talk", seq: 3, at: 13_000 });
    s.sim.signal("desktop_cue");
    s.at(14_000);
    // Another room's cue leaves this one alone.
    expect(s.poll({ room: "The Server Room" }).room?.cue).toEqual({ value: "room_heart_talk", seq: 3, at: 13_000 });
    expect(s.poll({ room: "The Desktop" }).room?.cue).toEqual({ value: "room_desktop_hello", seq: 1, at: 14_000 });
    s.sim.signal("talk", "g1");
    s.at(15_000);
    expect(s.poll({ room: "The Server Room" }).room?.cue).toEqual({ value: "room_heart_talk", seq: 4, at: 15_000 });
  });

  it("history (the first look at a sim) is stamped at 0: never played", () => {
    const s = rig();
    s.sim.signal("wake");
    expect(s.poll({ room: "The Server Room" }).room?.cue).toEqual({ value: "room_heart_wake", seq: 1, at: 0 });
    // A new sim (a restart) starts the fold over: its replay is history too.
    const again = Sim.fromSources(STORY);
    again.signal("wake");
    again.signal("wake");
    const r = s.w.poll(again, { name: "Server Room", spot: "server-room", view: "face", character: "", room: "The Server Room" }, () => false);
    expect(r.room?.cue).toEqual({ value: "room_heart_wake", seq: 2, at: 0 });
    // After `adopt` (a restore's replay), the next live cue is live.
    s.w.adopt(again);
    s.at(20_000);
    again.signal("wake");
    expect(s.w.poll(again, { name: "Server Room", spot: "server-room", view: "face", character: "", room: "The Server Room" }, () => false).room?.cue).toEqual({ value: "room_heart_wake", seq: 3, at: 20_000 });
  });

  it("a cue with no setting, a non-`room_` cue or a bare `room_` is never a room cue", () => {
    const s = rig();
    s.poll({ room: "The Server Room" });
    s.sim.signal("loose_cue");
    s.sim.signal("mixed");
    s.at(16_000);
    expect(s.poll({ room: "The Server Room" }).room?.cue).toBeNull();
  });

  it("an unknown room and a poll before the doors carry no cue", () => {
    const s = rig();
    s.sim.signal("wake");
    expect(s.poll({ room: "The Vault" }).room).toEqual({ id: "", open: false, cue: null });
    const w = new ScreenWatch({ now: () => 1 });
    const before = w.poll(null, { name: "Server Room", spot: "", view: "face", character: "", room: "The Server Room" }, () => false, [], s.sim.model);
    expect(before.room).toEqual({ id: "The Server Room", open: false, cue: null });
  });

  it("walls and the TV never see it: no `room`, no screen cue, no moment", () => {
    const s = rig();
    s.poll();
    s.sim.signal("wake");
    s.sim.signal("desktop_cue");
    s.at(17_000);
    for (const view of ["auto", "tv", "face", "mirror"]) {
      const st = s.poll({ view, name: `T-${view}` });
      expect(st.room).toBeUndefined();
      expect(Object.values(st.cues).every((c) => c === null)).toBe(true);
      expect(st.program.slide).toBeNull();
      expect(st.moments.filter((m) => m.kind !== "beat")).toEqual([]);
      expect(st.moments.some((m) => m.name.startsWith("room_"))).toBe(false);
    }
  });
});

describe("the night block's heart vars (wave 20)", () => {
  const HEART = `# T

ROLE Program

when heart_boot:
  set Night.server_door = "closed"
  set Night.heart_stage = "sealed"
  set Night.heart_look = "none"
  set Night.alarm_on = false
  set Night.door_override = false

when heart_opens:
  set Night.server_door = "open"
  set Night.heart_stage = "door"
  set Night.heart_look = "heart_door_open"
  set Night.door_override = true

when alarm:
  set Night.alarm_on = true

when weird:
  set Night.server_door = "ajar"
`;

  it("names the five `Night.*` paths", () => {
    expect(SCREEN_NIGHT_VARS).toMatchObject({
      server_door: "Night.server_door",
      heart_stage: "Night.heart_stage",
      heart_look: "Night.heart_look",
      alarm_on: "Night.alarm_on",
      door_override: "Night.door_override",
    });
  });

  it("reads null before the story sets them, then follows them with no slide gate", () => {
    const sim = Sim.fromSources(HEART);
    const w = new ScreenWatch({ now: () => 1 });
    const night = () => w.poll(sim, { name: "TV", spot: "", view: "tv", character: "" }, () => false).night;
    expect(night()).toMatchObject({ server_door: null, heart_stage: null, heart_look: null, alarm_on: null, door_override: null });
    sim.signal("heart_boot");
    // "none" reads null (the settled look: nothing yet).
    expect(night()).toMatchObject({ server_door: "closed", heart_stage: "sealed", heart_look: null, alarm_on: false, door_override: false });
    sim.signal("heart_opens");
    sim.signal("alarm");
    expect(night()).toMatchObject({ server_door: "open", heart_stage: "door", heart_look: "heart_door_open", alarm_on: true, door_override: true });
    // Only "open" / "closed" are a door.
    sim.signal("weird");
    expect(night().server_door).toBeNull();
  });
});
