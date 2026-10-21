import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Program } from "@loom/reinstall/program.ts";
import { reinstallConfigOf } from "../src/reinstall/adapter.ts";
import { CARD_MS, CONFIRM_MS, INITIAL, NOTICE_MS, REFUSED_MS, decide, exitNotice, exitSound, insideNow, isBusy, lookupText, playingOn, reduce, refusedCopy, timed, type StationEvent, type StationSession } from "../src/reinstall/session.ts";

const prog = (over: Partial<Program> = {}): Program => ({ id: "g-1", name: "Winamp", captured: false, restricted: false, eligible: false, marked: false, favour: false, location: null, ...over });
const healthy = prog();
const corrupted = prog({ captured: true, eligible: true });
const marked = prog({ marked: true, eligible: true });
const held = prog({ restricted: true, eligible: false });

const run = (events: StationEvent[], from: StationSession = INITIAL) => events.reduce(reduce, from);

describe("the tent station's session (wave 18b)", () => {
  it("a pass read starts a check; a wall code or junk says so and stays idle", () => {
    expect(run([{ type: "scan", text: "g-3f9a1c", now: 0 }]).step).toEqual({ kind: "checking", id: "g-3f9a1c" });
    expect(run([{ type: "pick", id: "g-1" }]).step).toEqual({ kind: "checking", id: "g-1" });
    const junk = run([{ type: "scan", text: "hello there", now: 10 }]);
    expect(junk.step.kind).toBe("idle");
    expect(junk.notice).toEqual({ text: "UNREADABLE — SHOW ME YOUR PASS", tone: "bad", until: 10 + NOTICE_MS });
    expect(run([{ type: "scan", text: "https://x.test/?code=ABCD&unlock=F1", now: 0 }]).notice?.text).toBe("THAT'S A WALL CODE — SHOW ME YOUR PASS");
  });

  it("a marked, a captured or (after an ending) a favour program plays; the healthy and the director-held are refused", () => {
    expect(decide(corrupted, false)).toBe("flow");
    expect(decide(marked, false)).toBe("flow");
    expect(decide(healthy, false)).toBe("refused");
    expect(decide(held, false)).toBe("refused");
    expect(decide(prog({ favour: true, eligible: true }), true)).toBe("flow");
    // An ending lets nobody in the server doesn't (eligible false): still refused.
    expect(decide(healthy, true)).toBe("refused");
  });

  it("an unmarked pass gets only the NOT MARKED card, which closes by itself", () => {
    const s = run([{ type: "pick", id: "g-1" }, { type: "resolved", id: "g-1", program: healthy, ended: false, playingOn: null, now: 100 }]);
    expect(s.step).toEqual({ kind: "refused", program: healthy, until: 100 + REFUSED_MS });
    expect(isBusy(s)).toBe(false);
    expect(timed(s)).toBe(true);
    expect(refusedCopy(healthy, false)).toEqual({ icon: "▣", heading: "PROGRAM NOT MARKED", status: "STATUS: healthy — not marked for reinstallation", why: "Not marked for reinstallation — until the night is over, only a marked program may play." });
    expect(run([{ type: "tick", now: 100 + REFUSED_MS - 1 }], s).step.kind).toBe("refused");
    expect(run([{ type: "tick", now: 100 + REFUSED_MS }], s).step.kind).toBe("idle");
    // A new pass over the card starts again.
    expect(run([{ type: "pick", id: "g-2" }], s).step).toEqual({ kind: "checking", id: "g-2" });
  });

  it("a marked pass mounts the flow (busy), and each walk is a fresh run", () => {
    const s = run([{ type: "pick", id: "g-1" }, { type: "resolved", id: "g-1", program: marked, ended: false, playingOn: null, now: 0 }]);
    expect(s.step).toEqual({ kind: "flow", program: marked, run: 1 });
    expect(isBusy(s)).toBe(true);
    // Mid-walk a pass is ignored (the scan box is unmounted anyway).
    expect(run([{ type: "scan", text: "g-00000a", now: 1 }, { type: "pick", id: "g-2" }], s)).toBe(s);
    const back = run([{ type: "exit", exit: { kind: "quit" }, now: 5 }], s);
    expect(back.step.kind).toBe("idle");
    expect(back.notice).toEqual({ text: "SIMULATION ABORTED", tone: "bad", until: 5 + NOTICE_MS });
    const again = run([{ type: "pick", id: "g-1" }, { type: "resolved", id: "g-1", program: corrupted, ended: false, playingOn: null, now: 9 }], back);
    expect(again.step).toEqual({ kind: "flow", program: corrupted, run: 2 });
  });

  it("an answer for another pass than the one being checked is dropped", () => {
    const s = run([{ type: "pick", id: "g-1" }]);
    expect(run([{ type: "resolved", id: "g-9", program: marked, ended: false, playingOn: null, now: 0 }], s)).toBe(s);
    expect(run([{ type: "lookupFailed", id: "g-9", status: 409, message: "x", now: 0 }], s)).toBe(s);
  });

  it("an unknown pass, a closed story and a lost token each say so", () => {
    const s = run([{ type: "pick", id: "g-1" }]);
    expect(run([{ type: "resolved", id: "g-1", program: null, ended: false, playingOn: null, now: 0 }], s).notice?.text).toBe("UNKNOWN PROGRAM — REGISTER ON YOUR PHONE FIRST");
    expect(run([{ type: "lookupFailed", id: "g-1", status: 409, message: "doors are closed", now: 0 }], s).notice?.text).toBe("THE STORY ISN'T RUNNING YET");
    expect(lookupText(401, "")).toBe("THIS TERMINAL LOST ITS ACCESS — TELL A HOST");
    expect(lookupText(null, "Failed to fetch")).toBe("CAN'T CHECK YOUR PASS — FAILED TO FETCH");
  });

  it("a program already walking on a headset asks before it plays here", () => {
    const s = run([{ type: "pick", id: "g-1" }, { type: "resolved", id: "g-1", program: corrupted, ended: false, playingOn: "Quest 1", now: 0 }]);
    expect(s.step).toEqual({ kind: "confirm", program: corrupted, device: "Quest 1", until: CONFIRM_MS });
    expect(run([{ type: "confirm" }], s).step).toEqual({ kind: "flow", program: corrupted, run: 1 });
    expect(run([{ type: "cancel" }], s).step.kind).toBe("idle");
    expect(run([{ type: "tick", now: CONFIRM_MS }], s).step.kind).toBe("idle");
    // A found walk (lingering) is not a walk in progress.
    expect(playingOn([{ guest: "g-1", device: "Quest 1", found: true }], "g-1")).toBeNull();
    expect(playingOn([{ guest: "g-2", device: "Quest 1", found: false }, { guest: "g-1", device: "", found: false }], "g-1")).toBe("another device");
  });

  it("the capture cue's card: never the boot's own, a new seq while idle, never over a walk", () => {
    const boot = run([{ type: "cue", seq: 4, now: 0 }]);
    expect(boot.card).toBeNull();
    expect(boot.cueSeen).toBe(4);
    expect(run([{ type: "cue", seq: 4, now: 10 }], boot).card).toBeNull();
    const fired = run([{ type: "cue", seq: 5, now: 10 }], boot);
    expect(fired.card).toBe(10 + CARD_MS);
    expect(run([{ type: "tick", now: 10 + CARD_MS }], fired).card).toBeNull();
    // A story restart clears the cue (null), and its first capture shows.
    expect(run([{ type: "cue", seq: null, now: 20 }, { type: "cue", seq: 1, now: 21 }], fired).card).toBe(21 + CARD_MS);
    // No cue yet at boot (null), then the first capture.
    expect(run([{ type: "cue", seq: null, now: 0 }, { type: "cue", seq: 1, now: 5 }]).card).toBe(5 + CARD_MS);
    // A walk on screen: the seq is noted, no card; a walk clears a card that was up.
    const walking = run([{ type: "pick", id: "g-1" }, { type: "resolved", id: "g-1", program: marked, ended: false, playingOn: null, now: 0 }], fired);
    expect(walking.card).toBeNull();
    const noted = run([{ type: "cue", seq: 6, now: 30 }], walking);
    expect(noted.card).toBeNull();
    expect(noted.cueSeen).toBe(6);
  });

  it("how a walk ends, in the terminal's words and sounds", () => {
    expect(exitNotice({ kind: "found", name: "Winamp", outcome: "released" }, 0)).toEqual({ text: "WINAMP — REINSTALLATION COMPLETE.", tone: "good", until: NOTICE_MS });
    expect(exitNotice({ kind: "found", name: "Winamp", outcome: "refused" }, 0)?.text).toBe("WINAMP FOUND GERALD — HE CAN'T HELP TONIGHT.");
    expect(exitNotice({ kind: "sent", station: "Quest 1" }, 0)).toEqual({ text: "SENT TO QUEST 1 — PUT THE HEADSET ON", tone: "good", until: NOTICE_MS });
    expect(exitNotice({ kind: "back" }, 0)).toBeNull();
    expect(exitNotice({ kind: "failed", text: "Not marked for reinstallation — until the night is over, only a marked program may play." }, 0)?.tone).toBe("bad");
    expect(exitSound({ kind: "found", name: "W", outcome: "released" })).toBe("win");
    expect(exitSound({ kind: "found", name: "W", outcome: "refused" })).toBe("lose");
    expect(exitSound({ kind: "idle" })).toBe("lose");
    expect(exitSound({ kind: "back" })).toBeNull();
  });

  it("the quick picks are only the programs in the Internet, never the marked (D8)", () => {
    const roster = [prog({ id: "a", name: "Zip", captured: true, eligible: true }), prog({ id: "b", name: "Excel", marked: true, eligible: true }), prog({ id: "c", name: "Alpha", captured: true, eligible: true }), healthy];
    expect(insideNow(roster, false).map((p) => p.name)).toEqual(["Alpha", "Zip"]);
    // After an ending, a favour is no reason to list anyone.
    expect(insideNow([prog({ id: "b", name: "Excel", favour: true, eligible: true })], true)).toEqual([]);
  });
});

describe("the tent station's wiring", () => {
  const src = (f: string) => readFileSync(new URL(`../src/reinstall/${f}`, import.meta.url), "utf8");
  // The code and the words on screen, not the comments that explain the rules.
  const code = (f: string) =>
    src(f)
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  it("plays as role both, with the terminal's own name and camera", () => {
    expect(reinstallConfigOf({ eventId: "e1", title: "T", token: "tok", name: "Tent", camera: "user" })).toEqual({ eventId: "e1", title: "T", token: "tok", name: "Tent", role: "both", camera: "user", arrowsTurn: true });
  });

  it("never forces a begin and never fires the story's scan (R16, D8)", () => {
    for (const f of ["ReinstallTerminal.tsx", "pane.tsx", "session.ts", "adapter.ts"]) {
      const text = code(f);
      expect(text, f).not.toMatch(/force\s*:/);
      expect(text, f).not.toMatch(/\/api\/mod\/scan/);
      expect(text, f).not.toMatch(/\bbegin\(/);
    }
  });

  it("holds the walk under an overlay (held = takeover) and mounts the flow on auto", () => {
    const t = src("ReinstallTerminal.tsx");
    expect(t).toMatch(/held=\{takeover\}/);
    expect(t).toMatch(/start="auto"/);
    // The game's sounds are built once (a new sfx object would restart the game).
    expect(t).toMatch(/useMemo\(\(\) => createSfx\(soundOutput\), \[\]\)/);
  });

  it("names nobody (and never Trabolta) in its own copy", () => {
    const t = code("ReinstallTerminal.tsx") + code("session.ts");
    expect(t).not.toMatch(/trabolta/i);
    expect(t).not.toMatch(/AI helper/i);
  });
});
