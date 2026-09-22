// The run-lifecycle policy: which server `lifecycle` notices end a guest or
// performer session, what the join screen then says, and which failed POSTs
// mean "the run restarted while this phone wasn't listening".

import { describe, expect, it } from "vitest";
import { LifecycleKind, SessionRole, eventGone, guestSessionDead, lifecycleDropsSession, lifecycleNotice } from "../src/lifecycle.ts";

describe("lifecycle policy", () => {
  it("every restart drops a guest; only go-live / ended drop a performer", () => {
    for (const kind of [LifecycleKind.Reset, LifecycleKind.Reload]) {
      expect(lifecycleDropsSession(kind, SessionRole.Guest)).toBe(true);
      expect(lifecycleDropsSession(kind, SessionRole.Performer)).toBe(false);
    }
    for (const kind of [LifecycleKind.GoLive, LifecycleKind.Ended]) {
      expect(lifecycleDropsSession(kind, SessionRole.Guest)).toBe(true);
      expect(lifecycleDropsSession(kind, SessionRole.Performer)).toBe(true);
    }
    expect(lifecycleDropsSession("something-new", SessionRole.Guest)).toBe(false);
  });

  it("explains a dropped session in the participant's terms", () => {
    expect(lifecycleNotice(LifecycleKind.Reset, SessionRole.Guest)).toMatch(/restarted — join again with your code/);
    expect(lifecycleNotice(LifecycleKind.GoLive, SessionRole.Guest)).toMatch(/show is starting — join again/);
    expect(lifecycleNotice(LifecycleKind.GoLive, SessionRole.Performer)).toMatch(/sign in again with your passcode/);
    expect(lifecycleNotice(LifecycleKind.Ended, SessionRole.Performer)).toBe("This event has ended.");
    // A transition that keeps the session says nothing.
    expect(lifecycleNotice(LifecycleKind.Reload, SessionRole.Performer)).toBeNull();
  });

  it("recognises a dead guest session from a failed POST", () => {
    expect(guestSessionDead(401, "not signed in — register first")).toBe(true);
    expect(guestSessionDead(404, "unknown guest")).toBe(true);
    expect(guestSessionDead(404, "no such interaction for guests")).toBe(false);
    expect(guestSessionDead(403, "you can't post here")).toBe(false);
  });

  it("recognises an event the server no longer hosts", () => {
    expect(eventGone(404, "unknown event")).toBe(true);
    expect(eventGone(404, "unknown guest")).toBe(false);
    expect(eventGone(401, "unknown event")).toBe(false);
  });
});

describe("performer dead-session detection", () => {
  it("a 403 'sign in' is a dead booth; a policy 403 is not", async () => {
    const { performerSessionDead } = await import("../src/lifecycle.ts");
    expect(performerSessionDead(403, "no character — sign in")).toBe(true);
    expect(performerSessionDead(403, "no scan capability — sign in")).toBe(true);
    expect(performerSessionDead(403, "you can't post here")).toBe(false);
    expect(performerSessionDead(404, "unknown guest")).toBe(false);
  });
});
