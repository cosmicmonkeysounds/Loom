// Wave 59: the shared teleprompter. The scene, the hold on his voice, the lock,
// and every way the night gets past a hold (`docs/loom-w59-prompter-contract.md`).

import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../server/chat.ts";
import { DRIVE_TTL_MS, HERE_TTL_MS, HOLD_WAIT_MS, HOLDER_TTL_MS, Prompters, readPrompterOp, sceneOf, spokenMs, type PrompterFrame, type RoomVoice } from "../server/prompter.ts";
import { voiceLinesOf } from "../server/routes/screen.ts";

const CTX = { voiced: (f: string) => f === "Trabolta", ownerOf: (f: string) => (f === "Recycling Bin" ? "@Recycling Bin" : f === "Clippy" ? "@Clippy" : null) };

function row(seq: number, from: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel: "loc:The Desktop", channelKind: "location", title: "The Desktop", from, kind: "line", text, ts: 100, audience: "all", parentSeq: null, hidden: false, beat: "B", ...extra } as ChatMessage;
}
const clippy = (seq: number, text = "one two three four"): ChatMessage => row(seq, "Clippy", text, { aloud: { readers: ["@Clippy"], reader: "@Clippy" } });
const him = (seq: number, text = "five six seven eight"): ChatMessage => row(seq, "Trabolta", text, { aloud: { readers: ["@Clippy"] } });
const stage = (seq: number, text = "stage direction here now"): ChatMessage => row(seq, "Narrator", text, { kind: "narration", aloud: { readers: ["@Clippy"] } });

function rig(messages: readonly ChatMessage[], o: { online?: boolean } = {}) {
  let now = 1_000;
  const frames: PrompterFrame[] = [];
  const voice: RoomVoice = { live: true, muted: false, said: -1, speaking: null };
  let changed = 0;
  const p = new Prompters({
    now: () => now,
    send: (f) => frames.push(f),
    voice: () => voice,
    online: () => o.online ?? true,
    name: (w) => w.replace(/^@/u, ""),
    changed: () => (changed += 1),
  });
  const draft = sceneOf(messages, CTX)!;
  p.land(draft);
  return {
    p,
    id: draft.id,
    frames,
    voice,
    last: () => frames[frames.length - 1]!,
    changed: () => changed,
    to: (ms: number) => {
      now += ms;
      p.tick();
    },
    here: (who = "@Clippy", open = true) => p.op(draft.id, who, false, { op: "here", open }),
  };
}

describe("whether anyone is on a scene (wave 59, the costume reads this)", () => {
  const scene = [clippy(1), him(2), clippy(3)];

  it("nobody, when no reader was online: the scene is live and refuses nothing", () => {
    const r = rig(scene, { online: false });
    expect(r.p.status()).not.toBeNull();
    expect(r.p.inUse).toBe(false);
  });

  it("nobody, once a reader who was online never came", () => {
    const r = rig(scene);
    expect(r.p.inUse).toBe(true);
    r.to(HOLD_WAIT_MS + 1);
    expect(r.p.status()?.held).toBe(false);
    expect(r.p.inUse).toBe(false);
  });

  it("someone, for as long as a phone shows it, and nobody once it stops", () => {
    const r = rig(scene);
    for (let i = 0; i < 10; i++) {
      r.here();
      r.to(HERE_TTL_MS - 1);
      expect(r.p.inUse).toBe(true);
    }
    r.to(2);
    expect(r.p.status()).not.toBeNull();
    expect(r.p.inUse).toBe(false);
  });

  it("a reader still on it after ▶, with nothing left to hold", () => {
    const r = rig(scene);
    r.here();
    expect(r.p.release()).toBe(true);
    expect(r.p.status()?.held).toBe(false);
    expect(r.p.inUse).toBe(true);
  });

  it("his lines, past a reader who left, and not after them", () => {
    const long = "and on he goes ".repeat(20).trim();
    const r = rig([clippy(1), him(2, long), clippy(3)]);
    r.voice.live = false;
    r.here();
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 4 });
    expect(r.last().speaking).not.toBeNull();
    r.to(HERE_TTL_MS + 1);
    expect(r.p.status()?.speaking).toBe(true);
    expect(r.p.inUse).toBe(true);
    r.to(spokenMs(long));
    expect(r.p.status()?.speaking).toBe(false);
    expect(r.p.inUse).toBe(false);
  });

  it("a finger on it, only until that phone stops reporting", () => {
    const r = rig([clippy(1)], { online: false });
    r.p.op(r.id, "@Clippy", false, { op: "press" });
    expect(r.p.inUse).toBe(true);
    r.to(HOLDER_TTL_MS + 1);
    r.to(HERE_TTL_MS);
    expect(r.p.inUse).toBe(false);
  });

  it("no scene at all, and a newer one nobody came to", () => {
    const r = rig(scene);
    r.here();
    r.p.land(sceneOf([clippy(9, "a newer one")], CTX));
    expect(r.p.status()?.id).toBe(10);
    expect(r.p.inUse).toBe(false);
    r.p.done();
    expect(r.p.inUse).toBe(false);
  });
});

describe("the scene (wave 59)", () => {
  it("drops a section with no reader's line, so a ceremony he hosted just plays", () => {
    const m = [him(1), row(2, "Trabolta", "more", { beat: "C", aloud: { readers: ["@Clippy"] } }), clippy(3)];
    m[2]!.beat = "C";
    const s = sceneOf(m, CTX)!;
    expect(s.sections.map((x) => x.title)).toEqual(["C"]);
    expect(s.sections[0]!.lines.map((l) => [l.seq, l.who, l.his])).toEqual([
      [2, "", true],
      [3, "@Clippy", false],
    ]);
    // His line in the dropped section comes before the scene, so it isn't held.
    expect(s.id).toBe(3);
    expect(sceneOf([him(1)], CTX)).toBeNull();
    expect(sceneOf([clippy(0)], CTX)?.id, "a fresh run's first line is seq 0, and a scene id is never 0").toBe(1);
  });

  it("gives someone else's line to its owner, and keeps his unmarked lines beside the script", () => {
    const s = sceneOf([clippy(1), row(2, "Recycling Bin", "Mine.", { aloud: { readers: ["@Clippy"] } }), him(3), row(4, "Trabolta", "Unmarked."), clippy(5)], CTX)!;
    expect(s.readers).toEqual(["@Clippy"]);
    expect(s.owners).toEqual(["@Recycling Bin"]);
    expect(s.after).toEqual([{ seq: 4, text: "Unmarked." }]);
  });

  it("reads a phone's press, and refuses anything else", () => {
    expect(readPrompterOp({ op: "move", pos: 3 })).toEqual({ op: "move", pos: 3 });
    expect(readPrompterOp({ op: "move" })).toBeNull();
    expect(readPrompterOp({ op: "play", on: true })).toBeNull();
    expect(readPrompterOp({ op: "nope" })).toBeNull();
  });
});

describe("his lines wait for the script", () => {
  const scene = () => rig([clippy(1), him(2), clippy(3)]);

  it("holds his line until the position reaches it, then locks and scrolls through it", () => {
    const r = scene();
    r.here();
    expect(r.p.heldFrom("loc:The Desktop")).toBe(2);
    expect(r.p.heldFrom("loc:Elsewhere")).toBeNull();
    expect(r.last().held).toBe(true);
    expect(r.p.op(r.id, "@Clippy", false, { op: "press", pos: 0 })).toBeNull();
    expect(r.p.op(r.id, "@Clippy", false, { op: "move", pos: 2 })).toBeNull();
    expect(r.p.heldFrom("loc:The Desktop")).toBe(2);
    r.p.op(r.id, "@Clippy", false, { op: "move", pos: 4 });
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
    expect(r.last().speaking).toEqual({ name: "Trabolta", seq: 2 });
    expect(r.last().holder).toBeNull();
    expect(r.last().rate).toBeGreaterThan(0);
    expect(r.last().stop).toBe(8);
  });

  it("frees when the TV has said it, and not before half the time the words allow", () => {
    const r = scene();
    r.here();
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 4 });
    const ms = spokenMs("five six seven eight");
    r.voice.said = 2;
    r.to(ms * 0.3);
    expect(r.last().speaking).not.toBeNull();
    r.to(ms * 0.3);
    expect(r.last().speaking).toBeNull();
    expect(r.last().pos).toBe(8);
    expect(r.last().rate).toBe(0);
  });

  it("a dead or a muted TV frees it on the time the words take", () => {
    for (const v of [{ live: false }, { muted: true }]) {
      const r = scene();
      r.here();
      Object.assign(r.voice, v);
      r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 4 });
      const ms = spokenMs("five six seven eight");
      r.to(ms - 200);
      expect(r.last().speaking).not.toBeNull();
      r.to(400);
      expect(r.last().speaking).toBeNull();
    }
  });

  it("a live TV that never finishes can't strand it either", () => {
    const r = scene();
    r.here();
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 4 });
    r.to(spokenMs("five six seven eight") + 500);
    expect(r.last().speaking).not.toBeNull();
    r.to(20_000);
    expect(r.last().speaking).toBeNull();
  });

  it("times his line from the moment he opens his mouth, and never steps back", () => {
    const r = scene();
    r.voice.live = false;
    r.here();
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 4 });
    r.voice.live = true;
    r.to(1_000);
    const before = r.last().pos;
    r.voice.speaking = 2;
    r.to(200);
    expect(r.last().pos).toBeGreaterThanOrEqual(before);
    r.voice.muted = true;
    const ms = spokenMs("five six seven eight");
    r.to(ms - 300);
    expect(r.last().speaking).not.toBeNull();
    r.to(400);
    expect(r.last().speaking).toBeNull();
  });

  it("can't be scrolled past: a jump over his line stops on it and fires it", () => {
    const r = scene();
    r.here();
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 12 });
    expect(r.last().pos).toBe(4);
    expect(r.last().speaking?.seq).toBe(2);
  });

  it("his line first: it goes as soon as a reader is there", () => {
    const r = rig([him(1), clippy(2)]);
    expect(r.p.heldFrom("loc:The Desktop")).toBe(1);
    r.here();
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
    expect(r.last().speaking?.seq).toBe(1);
  });

  it("takes a stage direction with his run: nobody reads it, so nothing would move past it", () => {
    const r = rig([clippy(1), him(2), stage(3), him(4), clippy(5)]);
    r.here();
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 4 });
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
    expect(r.last().stop).toBe(16);
    expect(r.last().speaking?.seq).toBe(2);
  });

  it("holds the next run behind the first, with his unmarked lines going with the run before", () => {
    const r = rig([clippy(1), him(2), row(3, "Trabolta", "The questions, which are long."), clippy(4), him(5)]);
    r.here();
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 4 });
    expect(r.p.heldFrom("loc:The Desktop")).toBe(5);
    // The run ends at 3, so the TV must say 3 before it frees.
    r.voice.said = 2;
    r.to(spokenMs("five six seven eight") + spokenMs("The questions, which are long.") + 1_000);
    expect(r.last().speaking).not.toBeNull();
    r.voice.said = 3;
    r.to(200);
    expect(r.last().speaking).toBeNull();
  });
});

describe("one shared position", () => {
  it("locks to whoever presses, tells everyone who, and frees on letting go", () => {
    const r = rig([clippy(1, "a b c d e f g h")]);
    r.p.op(r.id, "@Task Manager", true, { op: "here", open: true });
    expect(r.p.op(r.id, "@Clippy", false, { op: "press" })).toBeNull();
    expect(r.last().holder).toEqual({ who: "@Clippy", name: "Clippy" });
    expect(r.p.op(r.id, "@Task Manager", true, { op: "press" })).toBe("locked");
    expect(r.p.op(r.id, "@Task Manager", true, { op: "jump", pos: 2 })).toBe("locked");
    expect(r.p.op(r.id, "@Task Manager", true, { op: "move", pos: 2 })).toBe("locked");
    r.p.op(r.id, "@Clippy", false, { op: "move", pos: 3 });
    expect(r.last().pos).toBe(3);
    r.p.op(r.id, "@Clippy", false, { op: "letgo", pos: 4 });
    expect(r.last().holder).toBeNull();
    expect(r.p.op(r.id, "@Task Manager", true, { op: "press" })).toBeNull();
  });

  it("a finger on a dead phone lets go by itself", () => {
    const r = rig([clippy(1)]);
    r.p.op(r.id, "@Clippy", false, { op: "press" });
    r.to(HOLDER_TTL_MS + 100);
    expect(r.last().holder).toBeNull();
    expect(r.p.op(r.id, "@Task Manager", true, { op: "press" })).toBeNull();
  });

  it("autoscrolls on the server, stops on his line, holds for a finger and carries on", () => {
    const r = rig([clippy(1, "a b c d e f g h i j"), him(2), clippy(3)]);
    r.here();
    r.p.op(r.id, "@Clippy", false, { op: "play", on: true, speed: 1 });
    expect(r.last().rate).toBeCloseTo(130 / 60);
    r.to(1_000);
    r.p.op(r.id, "@Clippy", false, { op: "press" });
    expect(r.last().rate).toBe(0);
    expect(r.last().pos).toBeCloseTo(130 / 60);
    r.p.op(r.id, "@Clippy", false, { op: "letgo" });
    expect(r.last().rate).toBeCloseTo(130 / 60);
    r.to(4_000);
    expect(r.last().speaking?.seq).toBe(2);
    r.voice.said = 2;
    r.to(spokenMs("five six seven eight"));
    // He has finished: the autoscroll picks up where it stopped.
    expect(r.last().speaking).toBeNull();
    expect(r.last().rate).toBeCloseTo(130 / 60);
  });

  it("stops autoscrolling at the end of the script", () => {
    const r = rig([clippy(1)]);
    r.p.op(r.id, "@Clippy", false, { op: "play", on: true, speed: 1 });
    r.to(3_000);
    expect(r.last()).toMatchObject({ pos: 4, rate: 0, playing: false });
    const sent = r.frames.length;
    r.to(5_000);
    expect(r.frames.length).toBe(sent);
  });

  it("keeps anyone outside the scene out, and lets a host in", () => {
    const r = rig([clippy(1)]);
    expect(r.p.op(r.id, "g-1", false, { op: "press" })).toBe("not in the scene");
    expect(r.p.op(r.id, "@Task Manager", true, { op: "press" })).toBeNull();
    expect(r.p.op(999, "@Clippy", false, { op: "press" })).toBe("no scene");
  });
});

describe("the night never hangs", () => {
  it("no reader's stream: nothing is held at all", () => {
    const r = rig([clippy(1), him(2)], { online: false });
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
  });

  it("a phone that never reports (an old build, a sim bot) holds him for the wait and no more", () => {
    const r = rig([clippy(1), him(2)]);
    expect(r.p.heldFrom("loc:The Desktop")).toBe(2);
    r.to(HOLD_WAIT_MS - 100);
    expect(r.p.heldFrom("loc:The Desktop")).toBe(2);
    r.to(200);
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
    expect(r.last().held).toBe(false);
  });

  it("a reader who goes away lets the rest play", () => {
    const r = rig([clippy(1), him(2)]);
    r.here();
    r.to(HERE_TTL_MS - 100);
    expect(r.p.heldFrom("loc:The Desktop")).toBe(2);
    r.to(200);
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
  });

  it("someone else's prompter never holds him by being open: only by being driven", () => {
    const HOST = "@Task Manager";
    const stay = (r: ReturnType<typeof rig>, open = true) => r.p.op(r.id, HOST, true, { op: "here", open });
    /** A phone says it's there every 4 s. */
    const onIt = (r: ReturnType<typeof rig>, ms: number) => {
      for (let left = ms; left > 0; left -= 4_000) {
        stay(r);
        r.to(Math.min(left, 4_000));
      }
    };
    const asleep = rig([clippy(1), him(2)]);
    asleep.here();
    asleep.to(HERE_TTL_MS - 100);
    stay(asleep, false);
    asleep.to(200);
    expect(asleep.p.heldFrom("loc:The Desktop"), "not looking at it").toBeNull();

    const watching = rig([clippy(1), him(2)]);
    watching.here();
    watching.to(HERE_TTL_MS - 100);
    stay(watching);
    watching.to(200);
    expect(watching.p.heldFrom("loc:The Desktop"), "joined to watch, left on the table").toBeNull();

    const reading = rig([clippy(1), him(2), clippy(3)]);
    reading.here();
    stay(reading);
    reading.p.op(reading.id, HOST, true, { op: "press", pos: 1 });
    reading.p.op(reading.id, HOST, true, { op: "letgo", pos: 1 });
    onIt(reading, DRIVE_TTL_MS - 200);
    expect(reading.p.heldFrom("loc:The Desktop"), "the reader's phone died and the host took over").toBe(2);
    onIt(reading, 400);
    expect(reading.p.heldFrom("loc:The Desktop"), "and then stopped").toBeNull();
  });

  it("keeps a reader's moves their own, and an autoscroll on its way to him counts as driven", () => {
    const HOST = "@Task Manager";
    const r = rig([clippy(1, "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone"), him(2)]);
    r.here();
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 1 });
    r.p.op(r.id, HOST, true, { op: "here", open: true });
    r.to(HERE_TTL_MS - 100);
    r.p.op(r.id, HOST, true, { op: "here", open: true });
    r.to(200);
    expect(r.p.heldFrom("loc:The Desktop"), "Clippy drove, not the host").toBeNull();

    const s = rig([clippy(1, "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone"), him(2)]);
    s.here();
    s.p.op(s.id, "@Clippy", false, { op: "play", on: true, speed: 0.4 });
    for (let t = 0; t < 4; t++) {
      s.p.op(s.id, HOST, true, { op: "here", open: true });
      s.to(4_000);
    }
    expect(s.p.heldFrom("loc:The Desktop"), "it is scrolling to him by itself").toBe(2);
  });

  it("a host opening it in the first moments doesn't cut short the wait for the reader", () => {
    const r = rig([clippy(1), him(2)]);
    r.p.op(r.id, "@Task Manager", true, { op: "here", open: true });
    r.to(HOLD_WAIT_MS - 100);
    expect(r.p.heldFrom("loc:The Desktop")).toBe(2);
    r.to(200);
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
  });

  it("a scripted line of his that isn't in the scene lets everything go; a live one waits", () => {
    const r = rig([clippy(1), him(2), clippy(3), him(4)]);
    r.here();
    expect(r.p.outrun([row(9, "Trabolta", "A live reply.", { beat: undefined })], CTX.voiced), "a reply can't dump her script").toBe(false);
    expect(r.p.outrun([row(10, "Clippy", "Someone else's line.", { beat: "Later" })], CTX.voiced)).toBe(false);
    expect(r.p.outrun([row(11, "Trabolta", "Another room.", { beat: "Later", channel: "loc:The Hall" })], CTX.voiced)).toBe(false);
    expect(r.p.outrun([row(12, "Trabolta", "Hidden.", { beat: "Later", hidden: true })], CTX.voiced)).toBe(false);
    expect(r.p.heldFrom("loc:The Desktop")).toBe(2);
    expect(r.p.outrun([row(13, "Trabolta", "The Y2K line.", { beat: "The Y2K Clock" })], CTX.voiced)).toBe(true);
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
    expect(r.p.active, "the prompter carries on, with no holds").toBe(true);
    expect(r.last().stop).toBe(r.last().total);

    const inHandler = rig([clippy(1), him(2)]);
    inHandler.here();
    expect(inHandler.p.outrun([row(9, "Trabolta", "From a rule, in no beat.", { beat: null })], CTX.voiced)).toBe(true);
  });

  it("doesn't move anything once nothing is held", () => {
    const r = rig([clippy(1), him(2)]);
    r.here();
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 4 });
    expect(r.last().speaking).not.toBeNull();
    const sent = r.frames.length;
    expect(r.p.outrun([row(9, "Trabolta", "Next.", { beat: "Later" })], CTX.voiced)).toBe(false);
    expect(r.frames.length).toBe(sent);
  });

  it("▶ lets every line of his go, in order, and the prompter carries on", () => {
    const r = rig([clippy(1), him(2), clippy(3), him(4)]);
    r.here();
    expect(r.p.release()).toBe(true);
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
    expect(r.p.active).toBe(true);
    expect(r.p.release()).toBe(false);
    expect(r.last().stop).toBe(r.last().total);
  });

  it("✓ Done ends the scene for everyone, and a newer scene ends the older", () => {
    const r = rig([clippy(1), him(2)]);
    r.here();
    expect(r.p.op(r.id, "@Clippy", false, { op: "done" })).toBeNull();
    expect(r.last().done).toBe(true);
    expect(r.last().superseded).toBeUndefined();
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
    const s = rig([clippy(1), him(2)]);
    s.here();
    s.p.land(sceneOf([clippy(5), him(6)], CTX));
    const ended = s.frames.find((f) => f.done === true)!;
    expect(ended).toMatchObject({ id: 2, superseded: true });
    expect(s.last().id).toBe(6);
    expect(s.p.heldFrom("loc:The Desktop")).toBe(6);
  });

  it("a restart forgets it: nothing is held", () => {
    const r = rig([clippy(1), him(2)]);
    r.here();
    r.p.clear();
    expect(r.p.heldFrom("loc:The Desktop")).toBeNull();
    expect(r.p.frame(null)).toBeNull();
  });

  it("sends the script once, not with every move", () => {
    const r = rig([clippy(1)]);
    expect(r.frames[0]!.script?.sections.length).toBe(1);
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 2 });
    expect(r.last().script).toBeUndefined();
    expect(r.p.frame("@Clippy")?.script).toBeDefined();
    expect(r.p.frame("@Nobody")).toBeNull();
  });

  it("tells a host and a director where it is", () => {
    const r = rig([clippy(1), him(2), clippy(3)]);
    r.here();
    expect(r.p.status()).toMatchObject({ id: 2, readers: ["Clippy"], line: 1, lines: 3, held: true, speaking: false, holder: null });
    r.p.op(r.id, "@Clippy", false, { op: "jump", pos: 4 });
    expect(r.p.status()).toMatchObject({ line: 2, speaking: true, held: false });
  });
});

describe("the TV's poll stops at a held line", () => {
  const msgs = [row(1, "Trabolta", "before"), row(2, "Clippy", "c"), row(3, "Trabolta", "held"), row(4, "Trabolta", "after")];
  const speaks = (f: string) => f === "Trabolta";

  it("ends the timeline, head included, so the cursor can't pass it", () => {
    const got = voiceLinesOf(msgs, "loc:The Desktop", 0, speaks, 40, 3);
    expect(got.head).toBe(2);
    expect(got.lines.map((l) => l.seq)).toEqual([1]);
  });

  it("lets everything behind it through in order, once it's gone", () => {
    const got = voiceLinesOf(msgs, "loc:The Desktop", 2, speaks, 40, null);
    expect(got.head).toBe(4);
    expect(got.lines.map((l) => l.seq)).toEqual([3, 4]);
  });

  it("a TV that boots during the hold starts behind the held line", () => {
    expect(voiceLinesOf(msgs, "loc:The Desktop", null, speaks, 40, 3)).toEqual({ head: 2, lines: [] });
  });
});
