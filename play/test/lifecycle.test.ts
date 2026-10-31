// The run-lifecycle policy: which server `lifecycle` notices end a guest or
// performer session, what the join screen then says, and which failed POSTs
// mean "the run restarted while this phone wasn't listening".

import { describe, expect, it } from "vitest";
import { BOOTH_SIGNED_OUT, LifecycleKind, SessionRole, eventGone, guestSessionDead, lifecycleDropsSession, lifecycleNotice } from "../src/lifecycle.ts";

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

describe("a re-join after a restart starts with no answered cards (B2)", () => {
  it("a card answered last session is answerable again under the new sign-in", async () => {
    const { perSessionUpdate, perSessionValue, pendingWidget } = await import("../src/session.ts");
    type Answers = ReadonlyMap<number, Record<string, unknown>>;
    const EMPTY: Answers = new Map();
    const captcha = {
      seq: 4, channel: "loc:Mud Room", channelKind: "location", title: "Mud Room", from: "Clippy", kind: "widget",
      text: "Prove you're human", ts: 4, audience: "all", parentSeq: null, hidden: false, widget: { kind: "captcha", params: {} },
    } as const;
    const msgs = new Map([[4, captcha as never]]);
    // Session A answers the CAPTCHA at seq 4.
    let held = perSessionUpdate({ session: null, value: EMPTY }, "tok-a", EMPTY, (p) => new Map(p).set(4, { solved: true }));
    expect(pendingWidget(msgs, "captcha", new Set(perSessionValue(held, "tok-a", EMPTY).keys()))).toBeNull();
    // The restart's lifecycle frame drops the session; the join screen holds nothing.
    expect(perSessionValue(held, null, EMPTY).size).toBe(0);
    // Register again: the new run's CAPTCHA reuses seq 4 and is answerable.
    expect(pendingWidget(msgs, "captcha", new Set(perSessionValue(held, "tok-b", EMPTY).keys()))?.seq).toBe(4);
    // A late write lands on the new session only, never resurrecting the old answer.
    held = perSessionUpdate(held, "tok-b", EMPTY, (p) => new Map(p).set(9, {}));
    expect([...perSessionValue(held, "tok-b", EMPTY).keys()]).toEqual([9]);
    // Same session, no change: the held object is kept (no re-render).
    expect(perSessionUpdate(held, "tok-b", EMPTY, (p) => p)).toBe(held);
  });
});

describe("a booth's readouts on a story restart (B5)", () => {
  it("response events, then a reset, leave the Readouts list empty", async () => {
    const { afterLifecycle, lifecycleStartsNewRun } = await import("../src/lifecycle.ts");
    // The booth's onResponse prepends each readout.
    let readouts: Array<{ id: number; text: string }> = [];
    for (const [id, text] of [[0, "✅ Cleared Calculator."], [1, "🚨 Calculator is marked for reinstallation."]] as const) readouts = [{ id, text }, ...readouts];
    expect(readouts).toHaveLength(2);
    // The booth survives a reset / reload (it isn't dropped) — its readouts don't.
    expect(lifecycleDropsSession(LifecycleKind.Reset, SessionRole.Performer)).toBe(false);
    expect(afterLifecycle(readouts, LifecycleKind.Reset)).toEqual([]);
    expect(afterLifecycle(readouts, LifecycleKind.Reload)).toEqual([]);
    // A notice this build doesn't know keeps them.
    expect(afterLifecycle(readouts, "something-new")).toBe(readouts);
    for (const k of Object.values(LifecycleKind)) expect(lifecycleStartsNewRun(k)).toBe(true);
    expect(lifecycleStartsNewRun("something-new")).toBe(false);
  });
});

describe("a booth signed back in after Go live starts with no answered cards", () => {
  it("an Inbox card answered in the rehearsal is answerable in the live run", async () => {
    const { perSessionUpdate, perSessionValue, hasPendingCard } = await import("../src/session.ts");
    type Answers = ReadonlyMap<number, Record<string, unknown>>;
    const EMPTY: Answers = new Map();
    const card = {
      seq: 40, channel: "inbox", channelKind: "pinned", title: "Inbox", from: "Trabolta", kind: "widget",
      text: "Sandy's pickup line?", ts: 40, audience: ["@Clippy"], parentSeq: null, hidden: false, widget: { kind: "answer", params: {} },
    } as const;
    const msgs = [card as never];
    // The rehearsal booth (token r) answers the card at seq 40.
    const held = perSessionUpdate({ session: null, value: EMPTY }, "tok-r", EMPTY, (p) => new Map(p).set(40, { text: "hi" }));
    expect(hasPendingCard(msgs, new Set(perSessionValue(held, "tok-r", EMPTY).keys()))).toBe(false);
    // Go live / End / a dead token drop the booth (auth → null) …
    expect(perSessionValue(held, null, EMPTY).size).toBe(0);
    // … and the performer signs in again under a new token: the live run's
    // card at the same seq is still the performer's move.
    expect(hasPendingCard(msgs, new Set(perSessionValue(held, "tok-live", EMPTY).keys()))).toBe(true);
  });
});

describe("a booth whose token died with no lifecycle frame (T5-03)", () => {
  it("says it was signed out, never that the rehearsal ended", () => {
    expect(BOOTH_SIGNED_OUT).toContain("a director released it");
    expect(BOOTH_SIGNED_OUT).toContain("signed in on another phone");
    expect(BOOTH_SIGNED_OUT).toContain("sign in again with your passcode or your badge");
    expect(BOOTH_SIGNED_OUT).not.toMatch(/rehearsal|show is starting/);
    // A real go-live frame keeps its own line.
    expect(lifecycleNotice(LifecycleKind.GoLive, SessionRole.Performer)).toContain("show is starting");
  });
});
