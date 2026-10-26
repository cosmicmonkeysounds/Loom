//! Wave 26 (C4): the screen state's additions. `spot.here` (players in that
//! map spot's room, from the runtime's `spotHere` extra, wired by the
//! spatial lane), and `tvSpeech` (V1 phase 2): the newest `sp=<seq>:<chunk>`
//! or `sp=<seq>:d` heartbeat from a `view=tv` poller, stamped with the
//! server's receive time, null after 6 s without one. Memory only.

import { describe, expect, it } from "vitest";

import { ScreenWatch, TV_SPEECH_FRESH_MS, screenDeviceOf, speechReportOf, type ScreenPollExtras, type ScreenWho } from "../server/routes/screen.ts";
import { Sim } from "../src/runtime/sim/index.ts";

const q = (params: Record<string, string>) => (k: string) => params[k] ?? "";

describe("sp= (the TV's speech heartbeat)", () => {
  it("parses <seq>:<chunk> and <seq>:d; anything else is left out", () => {
    expect(speechReportOf("812:2")).toEqual({ seq: 812, chunk: 2 });
    expect(speechReportOf("812:0")).toEqual({ seq: 812, chunk: 0 });
    expect(speechReportOf("812:d")).toEqual({ seq: 812, chunk: null });
    for (const bad of ["", "812", "812:", ":2", "-1:2", "812:x", "812:1000", "a:1", "812:2:3", "1234567890123:1"]) expect(speechReportOf(bad), bad).toBeNull();
    expect(screenDeviceOf(q({ sp: "7:1", talk: "1" }))).toMatchObject({ talk: true, speech: { seq: 7, chunk: 1 } });
    expect(screenDeviceOf(q({ sp: "nope" }))).not.toHaveProperty("speech");
  });
});

function rig(extras: ScreenPollExtras = {}) {
  let t = 100_000;
  const sim = Sim.fromSources(`# T\n\n== Boot\ncue screens_screensaver\n`);
  sim.fireBeat("Boot");
  const w = new ScreenWatch({ now: () => t });
  const poll = (who: Partial<ScreenWho> & { sp?: string }) => {
    const { sp, ...rest } = who;
    return w.poll(sim, { name: rest.view ?? "x", spot: "", view: "auto", character: "", device: screenDeviceOf(q(sp !== undefined ? { sp } : {})), ...rest }, () => false, [], null, null, extras);
  };
  return { w, poll, at: (ms: number) => void (t = ms) };
}

describe("tvSpeech", () => {
  it("is null until a TV reports; then the newest report with the server's receive time", () => {
    const s = rig();
    expect(s.poll({ view: "auto" }).tvSpeech).toBeNull();
    s.poll({ name: "TV", view: "tv", sp: "812:0" });
    s.at(100_400);
    s.poll({ name: "TV", view: "tv", sp: "812:2" });
    expect(s.poll({ name: "Hall", view: "auto" }).tvSpeech).toEqual({ seq: 812, chunk: 2, at: 100_400 });
    s.at(101_000);
    s.poll({ name: "TV", view: "tv", sp: "812:d" });
    expect(s.poll({ name: "Hall", view: "auto" }).tvSpeech).toEqual({ seq: 812, chunk: null, at: 101_000 });
  });

  it("counts only from a view=tv poller (a mirror, a wall or a room terminal is ignored)", () => {
    const s = rig();
    s.poll({ name: "Wall", view: "auto", sp: "5:1" });
    s.poll({ name: "Mirror", view: "mirror", sp: "5:1" });
    s.poll({ name: "Room", view: "auto", room: "The Server Room", sp: "5:1" });
    expect(s.poll({ name: "Hall", view: "auto" }).tvSpeech).toBeNull();
    // ...and the heartbeat list keeps `speech` only for the TV.
    s.poll({ name: "TV", view: "tv", sp: "6:0" });
    const seen = s.w.seen();
    expect(seen.find((p) => p.name === "TV")).toMatchObject({ speech: { seq: 6, chunk: 0 } });
    expect(seen.find((p) => p.name === "Wall")).not.toHaveProperty("speech");
  });

  it("goes null once no TV reported for TV_SPEECH_FRESH_MS", () => {
    const s = rig();
    s.poll({ name: "TV", view: "tv", sp: "9:3" });
    s.at(100_000 + TV_SPEECH_FRESH_MS);
    expect(s.poll({ name: "Hall", view: "auto" }).tvSpeech).toEqual({ seq: 9, chunk: 3, at: 100_000 });
    s.at(100_001 + TV_SPEECH_FRESH_MS);
    expect(s.poll({ name: "Hall", view: "auto" }).tvSpeech).toBeNull();
    // A TV poll without sp= keeps the last report (it may be between lines).
    s.poll({ name: "TV", view: "tv" });
    expect(s.poll({ name: "Hall", view: "auto" }).tvSpeech).toBeNull();
  });
});

describe("spot.here", () => {
  it("rides the spot block when the runtime wires spotHere; null leaves it out", () => {
    const here = (spot: string): number | null => (spot === "kitchen" ? 2 : spot === "tent" ? 0 : null);
    const s = rig({ spotHere: here });
    expect(s.poll({ name: "K", spot: "kitchen" }).spot).toEqual({ announce: false, here: 2 });
    expect(s.poll({ name: "T", spot: "tent" }).spot).toEqual({ announce: false, here: 0 });
    expect(s.poll({ name: "U", spot: "unknown" }).spot).toEqual({ announce: false });
    expect(s.poll({ name: "N", spot: "" })).not.toHaveProperty("spot");
  });

  it("carries announce beside it; without spotHere the block is as before (no here)", () => {
    const both = rig({ spotAnnounce: (spot) => spot === "kitchen", spotHere: () => 1 });
    expect(both.poll({ name: "K", spot: "kitchen" }).spot).toEqual({ announce: true, here: 1 });
    const old = rig({ spotAnnounce: () => true });
    expect(old.poll({ name: "K", spot: "kitchen" }).spot).toEqual({ announce: true });
    expect(rig().poll({ name: "K", spot: "kitchen" })).not.toHaveProperty("spot");
  });
});
