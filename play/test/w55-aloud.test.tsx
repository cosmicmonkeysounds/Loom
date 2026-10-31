// Wave 55 (`docs/loom-w55-contract.md`): the script, what keeps the pop-up up,
// the teleprompter's numbers, and that the view stays out of the first load.
// The scrolling itself is checked in a browser (play has no DOM here).

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ALOUD_WINDOW_MS, lastSeq, markFloor, scriptOf, unreadLines } from "../src/aloud/model.ts";
import { AloudSlot, aloudStartItem, useAloud, type Aloud } from "../src/aloud/lazy.tsx";
import { AloudAlert } from "../src/aloud/prompter.tsx";
import { clampSize, clampSpeed, clip, flatten, lineAt, pastLastLine, pxPerSecond, railLine, railStarts, readingLabel, sectionLine, startLine } from "../src/aloud/prompter-model.ts";
import { boothBackStep } from "../src/booth/app.tsx";
import { playerStartItems, boothStartItems } from "../src/booth/header.tsx";
import { guestStartItems } from "../src/guest/frame.tsx";
import { guestBackStep } from "../src/guest/nav.ts";
import type { SessionStorage } from "../src/host.ts";
import type { ChatMessage } from "../src/types.ts";
import { mountHooks } from "./hooks-harness.ts";

vi.mock("../src/alerts.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/alerts.ts")>()), playTone: vi.fn() }));

const CLIPPY = "@Clippy";
const noop = () => {};
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function line(seq: number, beat: string, from: string, text: string, o: Partial<ChatMessage> & { mine?: boolean; readers?: string[] } = {}): ChatMessage {
  const { mine = from === "Clippy", readers = [CLIPPY], ...rest } = o;
  return {
    seq,
    channel: "loc:The Desktop",
    channelKind: "location",
    title: "The Desktop",
    from,
    kind: from === "Narrator" ? "narration" : "line",
    text,
    ts: 1000,
    audience: "all",
    parentSeq: null,
    hidden: false,
    beat,
    aloud: { readers, ...(mine ? { reader: readers[0]! } : {}) },
    ...rest,
  } as ChatMessage;
}
const OPENING = [
  line(10, "Computer Bingo", "Clippy", "Hello! Hello, everyone!"),
  line(11, "Computer Bingo", "Narrator", "The lights come up."),
  line(12, "Computer Bingo", "Trabolta", "I am a cue."),
  line(13, "Computer Bingo", "Clippy", "Go! Mingle! Compute!", { manner: "brightly" }),
];

function memory(init: Record<string, unknown> = {}): SessionStorage & { data: Record<string, unknown> } {
  const data = { ...init };
  return {
    data,
    load: <T,>(k: string) => (k in data ? (data[k] as T) : null),
    save: (k, v) => {
      data[k] = v;
    },
    drop: (k) => {
      delete data[k];
    },
  };
}

describe("scriptOf: one running script per reader", () => {
  it("keeps this reader's beats, in order, with cues and stage directions", () => {
    const [s] = scriptOf([...OPENING].reverse(), CLIPPY);
    expect(s!.title).toBe("Computer Bingo");
    expect(s!.lines.map((l) => [l.seq, l.speaker, l.mine, l.manner])).toEqual([
      [10, "Clippy", true, null],
      [11, "", false, null],
      [12, "Trabolta", false, null],
      [13, "Clippy", true, "brightly"],
    ]);
  });
  it("ignores unmarked lines, a hidden line and someone else's script", () => {
    const plain = { ...OPENING[0]!, seq: 1, aloud: undefined };
    const hidden = { ...OPENING[0]!, seq: 2, hidden: true };
    const hers = line(3, "Truth Txt", "Narrator", "The truth.", { readers: ["g-1"], mine: true });
    expect(scriptOf([plain, hidden, hers], CLIPPY)).toEqual([]);
    expect(scriptOf([hers], "g-1")[0]!.lines[0]!.mine).toBe(true);
  });
  it("starts a section at each beat and each new firing of one (an award at a time)", () => {
    const a = line(1, "Purgatory", "Clippy", "a");
    const b = line(2, "What We Did", "Clippy", "b");
    const c = line(3, "Purgatory", "Clippy", "c");
    const d = line(4, "Present Award", "Clippy", "d", { ts: 5000 });
    const e = line(5, "Present Award", "Clippy", "e", { ts: 9000 });
    expect(scriptOf([a, b, c, d, e], CLIPPY).map((s) => s.title)).toEqual(["Purgatory", "What We Did", "Purgatory", "Present Award", "Present Award"]);
  });
  it("drops a section where this reader says nothing (the ceremony Trabolta hosted)", () => {
    expect(scriptOf([line(1, "Present Award", "Trabolta", "His.")], CLIPPY)).toEqual([]);
  });
});

describe("the pop-up's numbers", () => {
  const script = scriptOf(OPENING, CLIPPY);
  it("counts only this reader's own lines past the mark", () => {
    expect(unreadLines(script, 0).map((l) => l.seq)).toEqual([10, 13]);
    expect(unreadLines(script, 10).map((l) => l.seq)).toEqual([13]);
    expect(unreadLines(script, 13)).toEqual([]);
    expect(lastSeq(script)).toBe(13);
    expect(lastSeq([])).toBe(0);
  });
  it("says how long it takes", () => {
    expect(readingLabel(unreadLines(script, 0))).toBe("under a minute");
    expect(readingLabel([{ ...script[0]!.lines[0]!, text: "word ".repeat(390) }])).toBe("about 3 min");
  });
  it("a new phone counts from now: old lines are not news", () => {
    const old = line(1, "Computer Bingo", "Clippy", "old", { ts: 0 });
    const late = line(2, "Bingo Time", "Clippy", "late", { ts: ALOUD_WINDOW_MS + 5000 });
    const s = scriptOf([old, late], CLIPPY);
    expect(markFloor(s, ALOUD_WINDOW_MS + 6000)).toBe(1);
    expect(markFloor(s, 1000)).toBe(0);
  });
});

function hook(o: Partial<Parameters<typeof useAloud>[0]> & { messages: Map<number, ChatMessage>; storage: SessionStorage }) {
  return mountHooks(useAloud, { me: CLIPPY, token: "t1", clock: 2000, ...o });
}

describe("useAloud: it cannot go away", () => {
  it("covers the app until ✓ Done, and closing the teleprompter doesn't clear it", () => {
    const storage = memory();
    const h = hook({ messages: new Map(OPENING.map((m) => [m.seq, m])), storage });
    let a = h.output as Aloud;
    expect(a.unread).toBe(2);
    expect(a.covering).toBe(true);
    h.act(() => a.setOpen(true));
    a = h.output as Aloud;
    expect(a.open).toBe(true);
    h.act(() => a.setOpen(false));
    a = h.output as Aloud;
    expect(a.covering).toBe(true);
    h.act(() => a.done());
    a = h.output as Aloud;
    expect(a.unread).toBe(0);
    expect(a.covering).toBe(false);
    expect(storage.data["loom.aloud.t1"]).toBe(13);
  });
  it("comes back for the next line, and a reload remembers what was read", () => {
    const storage = memory({ "loom.aloud.t1": 13 });
    const more = line(20, "Present Award", "Clippy", "Award.", { ts: 3000 });
    const h = hook({ messages: new Map([...OPENING, more].map((m) => [m.seq, m])), storage });
    expect((h.output as Aloud).unread).toBe(1);
    expect((h.output as Aloud).mark).toBe(13);
  });
  it("an unread line never ages off a new phone: its place is kept", () => {
    const storage = memory();
    const h = hook({ messages: new Map(OPENING.map((m) => [m.seq, m])), storage, clock: 2000 });
    expect(storage.data["loom.aloud.t1"]).toBe(0);
    h.rerender({ me: CLIPPY, token: "t1", clock: ALOUD_WINDOW_MS * 5, messages: new Map(OPENING.map((m) => [m.seq, m])), storage });
    expect((h.output as Aloud).unread).toBe(2);
  });
  it("a mark past the script belongs to an earlier run of the story", () => {
    const storage = memory({ "loom.aloud.t1": 900 });
    const h = hook({ messages: new Map(OPENING.map((m) => [m.seq, m])), storage });
    expect((h.output as Aloud).unread).toBe(2);
  });
  it("nobody with no script is covered", () => {
    const h = hook({ messages: new Map(), storage: memory(), me: "g-2" });
    expect((h.output as Aloud).covering).toBe(false);
    expect(aloudStartItem(h.output as Aloud)).toBeNull();
  });
});

const ALOUD = (o: Partial<Aloud> = {}): Aloud => ({ script: scriptOf(OPENING, CLIPPY), mark: 0, unread: 2, open: false, setOpen: noop, done: noop, covering: true, ...o });

describe("AloudSlot", () => {
  it("draws the pop-up with no way to close it", () => {
    const html = renderToStaticMarkup(<AloudAlert a={ALOUD()} sound={false} />);
    expect(html).toContain("READ THIS OUT LOUD");
    expect(html).toContain("Computer Bingo");
    expect(html).toContain("2 lines · under a minute");
    expect(html).toContain("Open the teleprompter");
    expect(html).not.toContain("✕");
    expect(html).not.toContain("Later");
  });
  it("draws nothing once read", () => {
    expect(renderToStaticMarkup(<AloudSlot a={ALOUD({ unread: 0, covering: false })} sound={false} storage={memory()} />)).toBe("");
  });
  it("the Start menus offer the script, first", () => {
    const item = aloudStartItem(ALOUD())!;
    expect(item.label).toBe("My script");
    const base = { character: "Clippy", wake: { supported: false, on: false, toggle: noop }, embedded: false, onHelp: noop, onSheet: noop, onSignOut: noop };
    expect(playerStartItems({ ...base, onPeople: noop, aloud: item })[0]!.id).toBe("aloud");
    expect(boothStartItems({ ...base, admin: false, host: true, knows: 0, aloud: item })[0]!.id).toBe("aloud");
    const open = { act: noop, sides: noop, people: noop, notifications: noop, help: noop, leave: noop };
    expect(guestStartItems({ name: "Excel", faction: null, interactions: [], sides: false, people: false, open, aloud: item }).map((i) => i.id)).toContain("aloud");
  });
  it("Back stays in the pop-up: it outranks every other layer", () => {
    expect(guestBackStep({ aloud: true, moment: "dismiss", sheet: true, overlay: true, credits: true, rails: true, room: true, window: true })).toBe("aloud");
    expect(guestBackStep({ moment: null, sheet: true, overlay: false, credits: false, rails: false, room: false, window: false })).toBe("sheet");
    expect(boothBackStep({ aloud: true, layer: null, sheet: null, people: null, help: false, credits: true })).toBe("aloud");
  });
  it("mounts over every guest branch and the booth, and the view stays out of the first load", () => {
    const guest = src("guest/app.tsx");
    expect(guest).toContain('<AloudSlot a={aloud}');
    expect((guest.match(/\{takeover\}/gu) ?? []).length).toBe(3);
    expect(src("booth/app.tsx")).toContain('<AloudSlot a={aloud}');
    expect(src("aloud/lazy.tsx")).toContain('import("./prompter.tsx")');
    expect(src("aloud/lazy.tsx")).toContain('import type { PrompterProps } from "./prompter.tsx"');
    expect(src("aloud/lazy.tsx")).not.toContain("alerts.ts");
  });
});

describe("the teleprompter's numbers", () => {
  const script = scriptOf(
    [
      line(1, "One", "Clippy", "one two three four"),
      line(2, "One", "Trabolta", "five six"),
      line(3, "Two", "Clippy", "seven eight"),
      line(4, "Two", "Trabolta", "nine ten"),
    ],
    CLIPPY,
  );
  const lines = flatten(script);
  it("flattens sections and counts words", () => {
    expect(lines.map((l) => [l.index, l.section, l.words])).toEqual([[0, 0, 4], [1, 0, 2], [2, 1, 2], [3, 1, 2]]);
  });
  it("scrolls the words at the set speed, whatever the size", () => {
    expect(pxPerSecond(1, 1300, 130)).toBeCloseTo(21.67, 1);
    expect(pxPerSecond(2, 1300, 130)).toBeCloseTo(43.33, 1);
    expect(pxPerSecond(1, 2600, 130)).toBeCloseTo(43.33, 1);
    expect(pxPerSecond(1, 100, 0)).toBe(0);
  });
  it("clamps the speed and the size", () => {
    expect(clampSpeed(0.1)).toBe(0.4);
    expect(clampSpeed(9)).toBe(2.5);
    expect(clampSpeed(0.30000000000000004 + 1)).toBe(1.3);
    expect(clampSize(1)).toBe(22);
    expect(clampSize(99)).toBe(64);
  });
  it("finds the line at a height", () => {
    const tops = [100, 200, 300];
    expect(lineAt(tops, 0)).toBe(0);
    expect(lineAt(tops, 100)).toBe(0);
    expect(lineAt(tops, 250)).toBe(1);
    expect(lineAt(tops, 999)).toBe(2);
    expect(lineAt([], 5)).toBe(0);
  });
  it("maps the rail to lines by their words", () => {
    const starts = railStarts(lines);
    expect(starts).toEqual([0, 0.4, 0.6, 0.8, 1]);
    expect(railLine(starts, 0)).toBe(0);
    expect(railLine(starts, 0.39)).toBe(0);
    expect(railLine(starts, 0.5)).toBe(1);
    expect(railLine(starts, 1.2)).toBe(3);
    expect(railLine(starts, -1)).toBe(0);
  });
  it("opens on the cue before this reader's first new line, else the last section", () => {
    expect(startLine(lines, 0)).toBe(0);
    expect(startLine(lines, 1)).toBe(1);
    expect(startLine(lines, 2)).toBe(2);
    expect(startLine(lines, 4)).toBe(2);
    expect(startLine([], 0)).toBe(0);
    const host = flatten(scriptOf([line(1, "Bingo", "Clippy", "a", { mine: false }), line(2, "Bingo", "Clippy", "b", { mine: false }), line(3, "Bingo", "Clippy", "cue", { mine: false }), line(4, "Bingo", "Task Manager", "Hello.", { mine: true })], CLIPPY));
    expect(startLine(host, 0)).toBe(2);
  });
  it("finds a section's start, and knows when the reader has said their last line", () => {
    expect(sectionLine(lines, 1)).toBe(2);
    expect(sectionLine(lines, 2)).toBeNull();
    expect(pastLastLine(lines, 1)).toBe(false);
    expect(pastLastLine(lines, 2)).toBe(true);
    expect(pastLastLine(lines, 3)).toBe(true);
  });
  it("clips a preview", () => {
    expect(clip("short")).toBe("short");
    expect(clip("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
