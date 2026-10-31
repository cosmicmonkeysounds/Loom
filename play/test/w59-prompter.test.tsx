// Wave 59: the shared teleprompter on a phone. The numbers and the store; the
// scrolling itself is driven in Chromium (`scripts/sim/prompter.spec.ts`), since
// play has no DOM in tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatFrameHandler, CHAT_FRAMES } from "../src/client.ts";
import { useAloud, type Aloud } from "../src/aloud/lazy.tsx";
import { linesBehind, markPast, scriptOf } from "../src/aloud/model.ts";
import { bitsKey, bitsOf, flatten, posOfY, wordOffsets, yOfPos } from "../src/aloud/prompter-model.ts";
import { PrompterStore, sceneRole, sceneScript, type PrompterFrame } from "../src/aloud/shared.ts";
import { prompterLine } from "../src/host/show-model.ts";
import type { SessionStorage } from "../src/host.ts";
import type { ChatMessage } from "../src/types.ts";
import { mountHooks } from "./hooks-harness.ts";

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
    expect(s.ended).toMatchObject({ id: 2, superseded: false });
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

describe("a newer scene over unread lines", () => {
  const ME = "@Clippy";
  const said = (seq: number, beat: string, text: string, o: Partial<ChatMessage> = {}): ChatMessage =>
    ({ seq, channel: "loc:The Desktop", channelKind: "location", title: "The Desktop", from: "Clippy", kind: "line", text, ts: 1000, audience: "all", parentSeq: null, hidden: false, beat, aloud: { readers: [ME], reader: ME }, ...o }) as ChatMessage;
  const OLD = [said(10, "Winning Line", "one two"), said(11, "Winning Line", "three four"), said(12, "Winning Line", "five six"), said(13, "Winning Line", "seven eight")];
  const NEW = [said(20, "Corrupted Code", "nine ten"), said(21, "Corrupted Code", "eleven twelve")];
  const sceneOfRows = (rows: ChatMessage[]) => ({ sections: [{ title: rows[0]!.beat!, lines: rows.map((m) => ({ seq: m.seq, ts: m.ts, speaker: m.from, text: m.text, manner: null, who: ME, his: false })) }], readers: [ME], owners: [] });
  const storage = (): SessionStorage => {
    const data: Record<string, unknown> = {};
    return { load: (k: string) => (data[k] ?? null) as never, save: (k: string, v: unknown) => void (data[k] = v), drop: (k: string) => void delete data[k] } as unknown as SessionStorage;
  };
  // Play has no DOM here: only what `useAloud` touches while it says it's there.
  beforeEach(() => {
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("window", { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  /** One reader, on the older scene, its prompter open or not. */
  function reading(open: boolean) {
    const store = new PrompterStore();
    const post = vi.fn(async () => ({}));
    const messages = new Map<number, ChatMessage>(OLD.map((m) => [m.seq, m]));
    const props = { messages, me: ME, token: "t1", storage: storage(), clock: 2000, prompter: store, post };
    const h = mountHooks(useAloud, props);
    const a = () => h.output as Aloud;
    const again = () => h.rerender({ ...props, messages: new Map(messages) });
    store.set(frame({ id: 11, total: 8, script: sceneOfRows(OLD) }));
    again();
    if (open) h.act(() => a().setOpen(true));
    return {
      a,
      post,
      again,
      /** The newer scene lands, the older one having got as far as `pos`. */
      newer(pos: number) {
        for (const m of NEW) messages.set(m.seq, m);
        again();
        store.set(frame({ id: 11, pos, total: 8, done: true, superseded: true }));
        again();
        store.set(frame({ id: 21, total: 4, script: sceneOfRows(NEW) }));
        again();
      },
      finish() {
        store.set(frame({ id: 21, total: 4, done: true }));
        again();
      },
      /** A third scene takes over the newer one, read to its end. */
      newerStill() {
        store.set(frame({ id: 21, pos: 4, total: 4, done: true, superseded: true }));
        again();
      },
    };
  }

  it("keeps the unread ones to come back to, and only those", () => {
    const script = scriptOf([...OLD, ...NEW], ME);
    expect(linesBehind(script, 11, 20)).toEqual([{ title: "Winning Line", lines: script[0]!.lines.slice(2) }]);
    expect(linesBehind(script, 13, 20)).toEqual([]);
    expect(linesBehind(script, 0, 10), "nothing is behind the first line").toEqual([]);
    const cue = said(12, "Winning Line", "a cue", { from: "Trabolta", aloud: { readers: [ME] } });
    expect(linesBehind(scriptOf([OLD[0]!, OLD[1]!, cue, ...NEW], ME), 11, 20), "a cue alone isn't this reader's to read").toEqual([]);
  });

  it("moves the mark only past what was read", () => {
    const script = scriptOf([...OLD, ...NEW], ME);
    expect(markPast(script, 11, 20, 21)).toBe(11);
    expect(markPast(script, 13, 20, 21)).toBe(21);
    expect(markPast(script, 13, 0, 21)).toBe(21);
    expect(markPast(script, 13, 0, 12), "never back").toBe(13);
  });

  it("gets the line a scene had reached from its last frame", () => {
    const s = new PrompterStore();
    s.set(frame({ id: 11, script: sceneOfRows(OLD) }));
    s.set(frame({ id: 11, pos: 2, done: true, superseded: true }));
    expect(s.ended).toEqual({ id: 11, superseded: true, first: 10, reached: 11 });
    s.set(frame({ id: 11, script: sceneOfRows(OLD) }));
    s.set(frame({ id: 11, pos: 0, done: true }));
    expect(s.ended?.reached).toBe(10);
    s.set(frame({ id: 11, script: sceneOfRows(OLD) }));
    s.set(frame({ id: 11, pos: 8, done: true }));
    expect(s.ended?.reached, "past the end is the last line").toBe(13);
  });

  it("a read cut short leaves the rest behind, and ✓ Done brings the pop-up back for it", () => {
    const r = reading(true);
    r.newer(2);
    expect(r.a().mark, "as far as the phone got").toBe(11);
    expect(r.a().behind.map((s) => s.lines.map((l) => l.seq))).toEqual([[12, 13]]);
    expect(r.a().shared?.id).toBe(21);
    r.a().done();
    r.again();
    expect(r.a().mark, "only the scene's own ✓ Done").toBe(11);
    expect(r.post).toHaveBeenCalledWith({ scene: 21, op: "done" });
    r.finish();
    expect(r.a().mark, "and when the scene ends for everyone").toBe(11);
    expect(r.a().open).toBe(false);
    expect(r.a().covering, "the pop-up is back").toBe(true);
    expect(r.a().unread).toBe(4);
    r.a().done();
    r.again();
    expect(r.a().unread, "their own script's ✓ Done reads it all").toBe(0);
  });

  it("reading them on the sheet clears them, and ✓ Done goes as ever", () => {
    const r = reading(true);
    r.newer(2);
    r.a().readBehind();
    r.again();
    expect(r.a().behind).toEqual([]);
    expect(r.a().mark).toBe(13);
    r.a().done();
    r.again();
    expect(r.a().mark).toBe(21);
    expect(r.a().unread).toBe(0);
  });

  it("a scene read to its end leaves nothing behind, though nobody pressed ✓ Done", () => {
    const r = reading(true);
    r.newer(6);
    expect(r.a().mark).toBe(13);
    expect(r.a().behind).toEqual([]);
    expect(r.a().unread).toBe(2);
  });

  it("a prompter never opened here read nothing, wherever someone else got to", () => {
    const r = reading(false);
    r.newer(6);
    expect(r.a().mark).toBe(0);
    expect(r.a().behind.flatMap((s) => s.lines).length).toBe(4);
    expect(r.a().unread).toBe(6);
  });

  it("a mark never passes a line behind an older scene, through a second takeover", () => {
    const r = reading(true);
    r.newer(2);
    r.newerStill();
    expect(r.a().mark, "the first takeover's lines are still owed").toBe(11);
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
