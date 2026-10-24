//! Wave 20 (D22, §2.4 *Moments*): the server room's door is no house-wide
//! event. The admin door cues (🚪 opened / closed / trust) and the heart's
//! autoend toggle are quiet signals; the door chatter beats (the nag, the
//! door again, the shut, the sealing) never become a `beat` moment; the
//! sensor's own `door_sensor_*`, the story's `heart_door_*` and the radio
//! cues are not admin cues, so they never were. *The Heart* stays a moment.

import { describe, expect, it } from "vitest";

import { QUIET_MOMENT_BEATS, QUIET_MOMENT_SIGNALS, ScreenWatch } from "../server/routes/screen.ts";
import { foldName } from "../src/parser/names.ts";
import { Sim } from "../src/runtime/sim/index.ts";

const STORY = `# T

ROLE Program

LOCATION The Server Room

INTERACTION server_door_opened
  label: 🚪 Door opened
  who: admin

INTERACTION server_door_closed
  label: 🚪 Door closed
  who: admin

INTERACTION server_door_trust
  label: 🚪 Trust the door sensor
  who: admin

INTERACTION heart_autoend
  label: 🕊 Autoend
  who: admin

INTERACTION radio_door_opened
  label: 📻 Door opened
  who: performer

INTERACTION wake_the_heart
  label: 💓 The Heart
  who: admin

when server_door_opened:
  fire heart_door_opened

when server_door_closed:
  fire heart_door_closed

when door_sensor_opened:
  fire heart_door_opened

when door_sensor_closed:
  fire heart_door_closed

when heart_door_opened:
  -> Heart Nag
  -> Heart Door Again

when heart_door_closed:
  -> Heart Door Shut
  -> Heart Sealed

when wake_the_heart:
  -> The Heart

== Heart Nag
  setting: The Server Room
Trabolta: The door.

== Heart Door Again
  setting: The Server Room
Trabolta: Again.

== Heart Door Shut
  setting: The Server Room
Trabolta: Good.

== Heart Sealed
  setting: The Server Room
Trabolta: Sealed.

== The Heart
  setting: The Server Room
Trabolta: You came.
`;

function rig() {
  let t = 10_000;
  const sim = Sim.fromSources(STORY);
  const w = new ScreenWatch({ now: () => t });
  const look = () => w.poll(sim, { name: "Hall", spot: "hall", view: "auto", character: "" }, () => false).moments;
  look(); // history
  return { sim, look, at: (ms: number) => void (t = ms) };
}

describe("the quiet door (wave 20)", () => {
  it("lists the quiet signals and beats, folded", () => {
    for (const n of ["server_door_opened", "server_door_closed", "server_door_trust", "heart_autoend", "trust_patch_bay"]) expect(QUIET_MOMENT_SIGNALS).toContain(foldName(n));
    for (const n of ["Heart Nag", "Heart Door Again", "Heart Door Shut", "Heart Sealed"]) expect(QUIET_MOMENT_BEATS).toContain(foldName(n));
    expect(QUIET_MOMENT_BEATS).not.toContain(foldName("The Heart"));
  });

  it("the admin door cues and their door beats make no moment", () => {
    const s = rig();
    s.sim.signal("server_door_opened");
    s.sim.signal("server_door_closed");
    s.sim.signal("server_door_trust");
    s.sim.signal("heart_autoend");
    s.at(11_000);
    expect(s.look()).toEqual([]);
  });

  it("the sensor's own edges and the radio cue make no moment either", () => {
    const s = rig();
    s.sim.signal("door_sensor_opened", undefined, { level: "12" });
    s.sim.signal("door_sensor_closed", undefined, { level: "3900" });
    s.sim.signal("radio_door_opened");
    s.at(12_000);
    expect(s.look()).toEqual([]);
  });

  it("The Heart is still a moment", () => {
    const s = rig();
    s.sim.signal("server_door_opened");
    s.sim.signal("wake_the_heart");
    s.at(13_000);
    expect(s.look().map((m) => [m.kind, m.name])).toEqual([
      ["signal", "wake_the_heart"],
      ["beat", "The Heart"],
    ]);
  });
});
