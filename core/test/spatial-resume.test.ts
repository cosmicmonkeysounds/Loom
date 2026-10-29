//! (wave 40) Suspend + resume: a doffed headset (or a hidden web tab) holds
//! its walk so the same program can pick it up where it was, within a grace
//! window — exempt from the pose timeout, keeping its pose, duck and intro
//! phase. After the grace the walk is given up (`timeout`). A different
//! program taking the headset's station supersedes a held walk (`replaced`).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateHouse, type Assignment, type HouseMap } from "@loom/house";
import { SpatialHub, POSE_TIMEOUT_MS, SUSPEND_GRACE_MS } from "../server/spatial.ts";

const fixture = (name: string): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../house/test/fixtures/${name}.json`, import.meta.url)), "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
};

function hubHarness() {
  let clock = 1_000;
  let ids = 0;
  const hub = new SpatialHub({
    eventId: "evt",
    now: () => clock,
    newSessionId: () => `s-${String(++ids).padStart(6, "0")}`,
    newToken: () => `tok-${ids}`,
  });
  hub.setHouse(fixture("two-rooms"), "show", false);
  const begin = (guest: string, station: string | null = null): Assignment =>
    hub.begin({ guest, name: guest.toUpperCase(), world: station === null ? "web" : "vr", device: station ?? "Tent tablet", station, captured: true })!;
  // Claim a parked (station) assignment with its first pose.
  const claim = (a: Assignment) => expect(hub.pose(a.token, { p: [1, 0, 2], yaw: 0, pitch: 0 })).toBe("ok");
  return { hub, begin, claim, tick: (ms: number) => (clock += ms) };
}

describe("SpatialHub — suspend + resume (wave 40)", () => {
  it("holds a claimed walk past the pose timeout, and resumes it at its last pose", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    expect(h.hub.ready(a.token)).toBe("ok"); // its intro is done
    expect(h.hub.pose(a.token, { p: [3, 0, 4], yaw: 1.5, pitch: 0 })).toBe("ok");
    expect(h.hub.suspend(a.token)).toBe("ok");

    // Well past the 60s pose timeout — a plain walk would be gone.
    h.tick(POSE_TIMEOUT_MS + 30_000);
    h.hub.sweep();
    const r = h.hub.resume(a.token);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.pose.p).toEqual([3, 0, 4]); // respawns where it left off
      expect(r.pose.yaw).toBe(1.5);
      expect(r.ready).toBe(true); // intro was done → resume in-house, not the video
      expect(r.assignment.guest).toBe("g-1");
    }
    // Resumed: the pose timeout applies again from now on.
    h.tick(POSE_TIMEOUT_MS + 1);
    h.hub.sweep();
    expect(h.hub.resume(a.token).kind).toBe("over");
  });

  it("gives up a held walk once the resume grace elapses", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    h.hub.pose(a.token, { p: [1, 0, 2], yaw: 0, pitch: 0 });
    expect(h.hub.suspend(a.token)).toBe("ok");

    h.tick(SUSPEND_GRACE_MS - 1);
    h.hub.sweep();
    expect(h.hub.resume(a.token).kind).toBe("ok"); // still holding (also clears the hold)

    // Re-hold, then let the grace fully elapse.
    expect(h.hub.suspend(a.token)).toBe("ok");
    h.tick(SUSPEND_GRACE_MS);
    h.hub.sweep();
    expect(h.hub.resume(a.token).kind).toBe("over"); // given up, duck freed
  });

  it("a flowing pose clears the hold on its own", () => {
    const h = hubHarness();
    const a = h.begin("g-1");
    h.hub.pose(a.token, { p: [1, 0, 2], yaw: 0, pitch: 0 });
    h.hub.suspend(a.token);
    h.hub.pose(a.token, { p: [1.2, 0, 2], yaw: 0, pitch: 0 }); // moved again
    // No longer held: the pose timeout now ends it like any live walk.
    h.tick(POSE_TIMEOUT_MS + 1);
    h.hub.sweep();
    expect(h.hub.resume(a.token).kind).toBe("over");
  });

  it("a different program taking the station supersedes a held walk", () => {
    const h = hubHarness();
    const a = h.begin("g-1", "vr-1");
    h.claim(a); // first pose claims the parked assignment
    expect(h.hub.suspend(a.token)).toBe("ok");

    const b = h.begin("g-2", "vr-1"); // someone else dons headset vr-1
    expect(b.guest).toBe("g-2");
    expect(h.hub.resume(a.token).kind).toBe("over"); // g-1's held walk was replaced
    h.claim(b);
    expect(h.hub.resume(b.token).kind).toBe("ok"); // g-2 is the live walk now
  });

  it("does not hold a parked (unclaimed) or a found walk", () => {
    const h = hubHarness();
    // Parked: suspend is a no-op hold — the first pose still has to claim it.
    const a = h.begin("g-1", "vr-1");
    expect(h.hub.suspend(a.token)).toBe("ok");
    h.tick(POSE_TIMEOUT_MS + 1);
    h.hub.sweep(); // a parked assignment lives on its own 5-min clock, not held
    expect(h.hub.resume(a.token).kind).toBe("ok");

    // A dead / never-seen token answers plainly.
    expect(h.hub.suspend("nope")).toBe("unknown");
    expect(h.hub.resume("nope").kind).toBe("unknown");
  });
});
