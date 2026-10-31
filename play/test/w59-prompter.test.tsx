// Wave 59: the shared teleprompter on a phone. The numbers and the store; the
// scrolling itself is driven in Chromium (`scripts/sim/prompter.spec.ts`), since
// play has no DOM in tests.

import { describe, expect, it, vi } from "vitest";
import { chatFrameHandler, CHAT_FRAMES } from "../src/client.ts";
import { bitsKey, bitsOf, flatten, posOfY, wordOffsets, yOfPos } from "../src/aloud/prompter-model.ts";
import { PrompterStore, sceneRole, sceneScript, type PrompterFrame } from "../src/aloud/shared.ts";
import { prompterLine } from "../src/host/show-model.ts";

const line = (seq: number, who: string, text: string, his = false) => ({ seq, ts: 0, speaker: who, text, manner: null, who, his });
const SCRIPT = { sections: [{ title: "A", lines: [line(1, "@Clippy", "one two three four"), line(2, "", "five six", true)] }, { title: "B", lines: [line(3, "@Bin", "seven eight nine")] }], readers: ["@Clippy"], owners: ["@Bin"] };
const frame = (o: Partial<PrompterFrame> = {}): PrompterFrame => ({ id: 2, rev: 1, pos: 0, rate: 0, stop: 9, total: 9, playing: false, speed: 1, holder: null, speaking: null, held: false, ...o });

describe("a shared position, on this phone's text", () => {
  const lines = flatten(sceneScript(SCRIPT, "@Clippy"));
  const offs = wordOffsets(lines);
  const tops = [100, 300, 340];
  const bottom = 460;

  it("counts words as the server does", () => {
    expect(offs).toEqual([0, 4, 6, 9]);
  });

  it("puts a line's first word on its top, and goes between lines in step", () => {
    expect(yOfPos(0, offs, tops, bottom)).toBe(100);
    expect(yOfPos(4, offs, tops, bottom)).toBe(300);
    expect(yOfPos(2, offs, tops, bottom)).toBe(200);
    expect(yOfPos(9, offs, tops, bottom)).toBe(460);
  });

  it("reads back the same place, at any phone's size", () => {
    for (const p of [0, 1.5, 4, 5, 7.5, 9]) {
      expect(posOfY(yOfPos(p, offs, tops, bottom), offs, tops, bottom)).toBeCloseTo(p);
      const big = tops.map((t) => t * 3);
      expect(posOfY(yOfPos(p, offs, big, bottom * 3), offs, big, bottom * 3)).toBeCloseTo(p);
    }
  });

  it("is safe before the text is measured", () => {
    expect(yOfPos(3, offs, [], 0)).toBe(0);
    expect(posOfY(50, offs, [], 0)).toBe(0);
  });
});

describe("the store", () => {
  it("moves a frame on from its arrival, up to where it must stop", () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(1_000);
    const s = new PrompterStore();
    s.set(frame({ pos: 2, rate: 2, stop: 5, script: SCRIPT }));
    expect(s.pos(1_000)).toBe(2);
    expect(s.pos(2_000)).toBe(4);
    expect(s.pos(9_000)).toBe(5);
    now.mockRestore();
  });

  it("knows a scene only with its script, and tells who subscribes", () => {
    const s = new PrompterStore();
    const hit = vi.fn();
    const off = s.subscribe(hit);
    s.set(frame());
    expect(s.sceneId()).toBe(0);
    s.set(frame({ script: SCRIPT }));
    expect(s.sceneId()).toBe(2);
    s.set(frame({ pos: 1 }));
    expect(s.sceneId(), "a later frame keeps the script").toBe(2);
    expect(hit).toHaveBeenCalledTimes(3);
    off();
    s.set(frame({ pos: 2 }));
    expect(hit).toHaveBeenCalledTimes(3);
  });

  it("marks a script read only on a ✓ Done", () => {
    const s = new PrompterStore();
    s.set(frame({ script: SCRIPT }));
    s.set({ ...frame(), done: true });
    expect(s.ended).toEqual({ id: 2, superseded: false });
    s.set(frame({ script: SCRIPT }));
    s.set({ ...frame(), done: true, superseded: true });
    expect(s.ended?.superseded).toBe(true);
    s.set(frame({ script: SCRIPT }));
    s.set(null);
    expect(s.ended?.superseded, "a restart forgot it: nothing was read").toBe(true);
    expect(s.sceneId()).toBe(0);
  });

  it("follows this phone's own move until the server answers, and gives it back if refused", () => {
    const s = new PrompterStore();
    s.set(frame({ pos: 1, script: SCRIPT }));
    s.nudge(5);
    expect(s.frame?.pos).toBe(5);
    s.revert();
    expect(s.frame?.pos).toBe(1);
  });

  it("takes the stream's frame", () => {
    expect(CHAT_FRAMES).toContain("prompter");
    const got: unknown[] = [];
    chatFrameHandler(() => ({ onPrompter: (f) => got.push(f) }), { replace: () => {}, upsert: () => {}, drop: () => {} })("prompter", "null");
    expect(got).toEqual([null]);
  });
});

describe("who is what in a scene", () => {
  it("reads a reader, an owner and a host", () => {
    expect(sceneRole(SCRIPT, "@Clippy")).toBe("reader");
    expect(sceneRole(SCRIPT, "@Bin")).toBe("owner");
    expect(sceneRole(SCRIPT, "@Task Manager")).toBe("host");
    expect(sceneRole(null, "@Clippy")).toBeNull();
  });

  it("marks only this phone's own lines, and his", () => {
    const s = sceneScript(SCRIPT, "@Bin");
    expect(s.flatMap((x) => x.lines).map((l) => [l.mine, l.his])).toEqual([
      [false, false],
      [false, true],
      [true, false],
    ]);
  });
});

describe("the lock, as the controls read it", () => {
  it("locks for someone else's finger and for him, never for your own", () => {
    expect(bitsOf(bitsKey(null, "@Clippy"))).toMatchObject({ locked: false, playing: false });
    expect(bitsOf(bitsKey(frame({ holder: { who: "@Clippy", name: "Clippy" } }), "@Clippy")).locked).toBe(false);
    expect(bitsOf(bitsKey(frame({ holder: { who: "@Clippy", name: "Clippy" } }), "@Task Manager"))).toMatchObject({ locked: true, speaking: false, name: "Clippy" });
    expect(bitsOf(bitsKey(frame({ speaking: { name: "Trabolta", seq: 3 } }), "@Clippy"))).toMatchObject({ locked: true, speaking: true, name: "Trabolta" });
    expect(bitsOf(bitsKey(frame({ playing: true }), "@Clippy")).playing).toBe(true);
    expect(bitsOf(bitsKey(frame({ holder: { who: "@Bin", name: "Name | with a bar" } }), "@Clippy")).name).toBe("Name | with a bar");
  });
});

describe("a host's line", () => {
  const p = { id: 2, title: "Second Hunt", readers: ["Clippy"], line: 2, lines: 9, held: true, speaking: false, holder: null };
  it("says where it is and why it waits", () => {
    expect(prompterLine(p)).toBe("📜 Clippy · Second Hunt · line 2 of 9 · ⏸ he waits for the script");
    expect(prompterLine({ ...p, speaking: true })).toContain("🔊 he is speaking");
    expect(prompterLine({ ...p, holder: "Clippy" })).toContain("🔒 Clippy has it");
    expect(prompterLine({ ...p, held: false })).toBe("📜 Clippy · Second Hunt · line 2 of 9");
  });
});
