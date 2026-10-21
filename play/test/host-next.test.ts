//! The host's NEXT bar (wave 13, D9 + D10): tap to arm, tap to fire with
//! `presses`; a 409 `moved` (another host pressed first) drops the arm so
//! the next tap re-arms; a refused press is kept for its `# hosts` reason,
//! which the bar's second line shows; a failed poll says the view is old.

import { describe, expect, it } from "vitest";
import { ARM_DEAD_MS, cueRows, tapCue } from "../../core/src/cue-sheet.ts";
import { STALE_TOAST, fireToast, phoneTap } from "../src/director.tsx";
import { hostFire } from "../src/host/fire.ts";
import { ApiError } from "../src/client.ts";
import { REFUSED_BAR_MS, barLine, staleText } from "../src/host/model.ts";
import { UNREACHABLE, hostPollOutcome } from "../src/host/client.ts";
import { hostFixture } from "./host-fixture.ts";

function fakeCue(answer: Record<string, unknown> | Error) {
  const sent: Array<{ id: string; subject: string | null; args: unknown; presses: number | undefined }> = [];
  let polls = 0;
  const calls = {
    cue: async (id: string, subject: string | null, args: { value: string | number } | null, presses?: number) => {
      sent.push({ id, subject, args, presses });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  const fresh = async () => {
    polls++;
  };
  return { sent, calls, fresh, polls: () => polls };
}

describe("the NEXT bar arms, then fires", () => {
  const v = hostFixture({ cues: { last: null, fired: [], presses: 4, pressed: null } });
  const rows = cueRows(v.interactions, v.cues);
  const next = rows.find((r) => r.next)!;

  it("the first tap arms (bound to presses), a second inside the window fires with them", async () => {
    const t1 = tapCue(null, next, 1000, v.cues);
    expect(t1.kind).toBe("arm");
    if (t1.kind !== "arm") return;
    expect(t1.armed.presses).toBe(4);
    expect(tapCue(t1.armed, next, 1000 + ARM_DEAD_MS - 1, v.cues).kind).toBe("ignore");
    const t2 = tapCue(t1.armed, next, 1000 + ARM_DEAD_MS + 10, v.cues);
    expect(t2).toEqual({ kind: "fire", id: "call_everyone", subject: null, presses: 4 });
    const f = fakeCue({ ok: true });
    const out = await hostFire(f.calls, f.fresh)("call_everyone", null, undefined, 4);
    expect(out).toEqual({ ok: true });
    expect(f.sent).toEqual([{ id: "call_everyone", subject: null, args: null, presses: 4 }]);
    expect(f.polls()).toBe(1); // re-polled before the desk unlocks
    expect(fireToast(next, out)).toBe("✓ Fired C1");
  });

  it("another host's press first: 409 moved → Cues moved, tap again (re-arms)", async () => {
    const f = fakeCue({ moved: true });
    const out = await hostFire(f.calls, f.fresh)("call_everyone", null, undefined, 4);
    expect(out).toMatchObject({ ok: false, moved: true });
    expect(fireToast(next, out)).toBe(STALE_TOAST);
    // The marks moved under an arm made before: the second tap is stale, never a fire.
    const t1 = tapCue(null, next, 0, v.cues);
    if (t1.kind !== "arm") throw new Error("expected arm");
    const moved = { last: "call_everyone", fired: ["call_everyone"], presses: 5, pressed: "call_everyone" };
    expect(phoneTap(t1.armed, next, ARM_DEAD_MS + 50, moved).kind).toBe("stale");
  });

  it("a fired press keeps what it said: LAST's did: line (BN-F14)", async () => {
    const f = fakeCue({ ok: true, said: ["🎱 COMPUTER BINGO has begun."], staff: ["Clippy deals the cards."] });
    const out = await hostFire(f.calls, f.fresh)("start_the_bingo", null, undefined, 4);
    expect(out).toEqual({ ok: true, said: ["🎱 COMPUTER BINGO has begun."], staff: ["Clippy deals the cards."] });
  });

  it("a refused press is ok + refused (the drawer keeps it for its reason)", async () => {
    const f = fakeCue({ ok: true, refused: true });
    const out = await hostFire(f.calls, f.fresh)("spin_the_bottle", null, undefined, 4);
    expect(out).toEqual({ ok: true, refused: true });
  });

  it("an award carries the person and its value as a number", async () => {
    const f = fakeCue({ ok: true });
    await hostFire(f.calls, f.fresh)("award_best_liar", "g1", "3", 9);
    expect(f.sent).toEqual([{ id: "award_best_liar", subject: "g1", args: { value: 3 }, presses: 9 }]);
  });

  it("a refusal from the server is a failed fire with its message; no answer is 'not sure'", async () => {
    const f = fakeCue(new ApiError("doors are closed", 409));
    const out = await hostFire(f.calls, f.fresh)("call_everyone", null, undefined, 4);
    expect(out).toEqual({ ok: false, status: 409, message: "doors are closed" });
    const g = fakeCue(new Error("network down"));
    const lost = await hostFire(g.calls, g.fresh)("call_everyone", null, undefined, 4);
    expect(lost).toMatchObject({ ok: false, status: 0 });
    expect(fireToast(next, lost)).toMatch(/^Not sure C1 fired/u);
  });
});

describe("the NEXT bar's second line", () => {
  const base = { toast: null, connected: true, error: null, receivedAt: 10_000, now: 10_000, armed: false, subjectName: null, refused: null, reason: null };
  const press = { id: "spin_the_bottle", what: "V6", at: 10_000, afterSeq: 5 };

  it("is the strip on a fresh view with nothing to say", () => {
    expect(barLine(base)).toEqual({ kind: "strip" });
  });
  it("says the view is old once a poll fails, and how old", () => {
    expect(barLine({ ...base, connected: false, error: "Can't reach the server", now: 22_000 })).toEqual({ kind: "stale", text: "⚠ Last update 12 s ago · Can't reach the server" });
    expect(barLine({ ...base, connected: false, error: "This booth isn't a host any more.", now: 11_000 }).kind).toBe("stale");
    expect(staleText(null, 0, 200_000)).toBe("⚠ Last update 3 m ago · Reconnecting…");
    // Stale beats the armed prompt: never fire off an old screen unwarned.
    expect(barLine({ ...base, connected: false, armed: true }).kind).toBe("stale");
  });
  it("shows a refused press's # hosts reason itself, then the strip after REFUSED_BAR_MS", () => {
    expect(barLine({ ...base, refused: press })).toEqual({ kind: "refused", text: "✕ V6 not taken…" });
    expect(barLine({ ...base, refused: press, reason: "Too early: the results aren't read yet." })).toEqual({ kind: "refused", text: "✕ V6 not taken — Too early: the results aren't read yet." });
    expect(barLine({ ...base, refused: press, now: 10_000 + REFUSED_BAR_MS })).toEqual({ kind: "strip" });
  });
  it("a fresh toast and the armed prompt come first", () => {
    expect(barLine({ ...base, toast: "✓ Fired C1", refused: press, connected: false })).toEqual({ kind: "toast", text: "✓ Fired C1" });
    expect(barLine({ ...base, armed: true, refused: press })).toEqual({ kind: "armed", text: "Tap FIRE within 4 s to fire" });
    expect(barLine({ ...base, armed: true, subjectName: "Ada" }).text).toBe("Tap FIRE to fire → Ada");
  });
});

describe("the host poll", () => {
  it("a 403 says the booth is no host any more", () => {
    expect(hostPollOutcome(403, { error: "not a host" })).toEqual({ kind: "error", message: "This booth isn't a host any more." });
    expect(UNREACHABLE).toBe("Can't reach the server");
  });
});
