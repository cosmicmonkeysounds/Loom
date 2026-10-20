//! Wave 13 integration: the moment stamp. Every message the moments layer
//! may treat as a moment (alerts, takeover pins, readouts, quest steps,
//! cards, a beat's lines) carries the story's `Night.phase` when it was
//! composed, so a phone that wakes to a backlog judges "the phase moved on
//! since it arrived" by the message, not by the phase it reads now. Typed
//! chat, notices and system rows carry none; nothing is stamped while the
//! world holds no `Night.phase`; a restart stamps the same values.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { composeGuestMessages, phaseStamped, storyPhase, type ChatMessage } from "../server/chat.ts";
import { nightView } from "../server/views.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const STORY = `# Phases
start: Opening

ROLE Guest

LOCATION Hall

CHARACTER Wren

CHARACTER Norton
  when scanned by guest:
    reply Clean: {guest.name}.

QUEST Find The Duck
  from: Wren
  text: Go find it.

INTERACTION summon
  who: admin

when summon:
  set Night.phase = "summons"
  broadcast "!Come to the Hall." to everyone

== Opening
  setting: Hall
set Night.phase = "arrival"
The lights come on.

== Moments
  setting: Hall
Wren: Hello, {guest.name}.
pin "!Look up." for guest
pin "!!TAKEOVER" for guest
show poll "Truth or dare?" to guest
start quest Find The Duck for guest
reply Your own readout.
broadcast "~✅ {guest.name} is here." to everyone
`;

describe("the moment stamp (ChatMessage.phase)", () => {
  it("stamps alerts, takeovers, pins, cards, quest steps, readouts and beat lines with Night.phase; never chat or notices", () => {
    const sim = Sim.fromSources(STORY);
    const opening = composeGuestMessages(sim, sim.fireBeat("Opening"));
    expect(opening.find((m) => m.text === "The lights come on.")).toMatchObject({ phase: "arrival" });
    sim.createPerson("g1", "Ada");
    const msgs = composeGuestMessages(sim, sim.fireBeat("Moments", "g1"));
    const by = (pred: (m: (typeof msgs)[number]) => boolean) => msgs.find(pred)!;
    expect(by((m) => m.kind === "line" && m.text.startsWith("Hello")).phase).toBe("arrival");
    expect(by((m) => m.pin !== undefined && m.takeover !== true).phase).toBe("arrival");
    expect(by((m) => m.takeover === true).phase).toBe("arrival");
    expect(by((m) => m.kind === "widget").phase).toBe("arrival");
    expect(by((m) => m.kind === "quest").phase).toBe("arrival");
    expect(by((m) => m.readout === true).phase).toBe("arrival");
    // A `~` notice is no moment: no stamp.
    expect("phase" in by((m) => m.notice !== undefined)).toBe(false);
    // Typed chat: no stamp.
    const chat = composeGuestMessages(sim, sim.say("g1", "lobby", "hi"));
    expect(chat.length).toBeGreaterThan(0);
    for (const m of chat) expect("phase" in m).toBe(false);
  });

  it("an alert sent by the rule that moves the phase reads the new phase (the world after the batch)", () => {
    const sim = Sim.fromSources(STORY);
    composeGuestMessages(sim, sim.fireBeat("Opening"));
    const msgs = composeGuestMessages(sim, sim.signal("summon"));
    expect(msgs.find((m) => m.alert === true)).toMatchObject({ text: "Come to the Hall.", phase: "summons" });
    expect(storyPhase(sim)).toBe("summons");
    expect(nightView(sim).phase).toBe("summons");
  });

  it("no stamp while the world holds no Night.phase: a story without one, or before its first set", () => {
    const none = Sim.fromSources(STORY.replace('set Night.phase = "arrival"\n', "").replace('  set Night.phase = "summons"\n', ""));
    expect(storyPhase(none)).toBeUndefined();
    none.createPerson("g1", "Ada");
    for (const m of composeGuestMessages(none, none.fireBeat("Moments", "g1"))) expect("phase" in m).toBe(false);
    const early = Sim.fromSources(STORY);
    early.createPerson("g1", "Ada");
    for (const m of composeGuestMessages(early, early.fireBeat("Moments", "g1"))) expect("phase" in m).toBe(false);
    composeGuestMessages(early, early.signal("summon"));
    expect(composeGuestMessages(early, early.fireBeat("Moments", "g1")).find((m) => m.kind === "widget")!.phase).toBe("summons");
    // Set to null on purpose: a null stamp (a phase rule still compares it).
    early.world.set("Night.phase", { kind: "null" });
    expect(storyPhase(early)).toBeNull();
    expect(composeGuestMessages(early, early.fireBeat("Moments", "g1")).find((m) => m.kind === "widget")!.phase).toBeNull();
  });

  it("phaseStamped: what can be a moment", () => {
    const base = { channel: "lobby", channelKind: "lobby", title: "", from: "", text: "", ts: 0, audience: "all", parentSeq: null } as const;
    expect(phaseStamped({ ...base, kind: "signal", alert: true })).toBe(true);
    expect(phaseStamped({ ...base, kind: "signal" })).toBe(false);
    expect(phaseStamped({ ...base, kind: "line", beat: "Opening" })).toBe(true);
    expect(phaseStamped({ ...base, kind: "line" })).toBe(false);
    expect(phaseStamped({ ...base, kind: "narration", beat: "Opening", ambient: true })).toBe(false);
    expect(phaseStamped({ ...base, kind: "system" })).toBe(false);
  });
});

describe("the moment stamp across a restart", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  it("a restored run stamps every message exactly as the live run did", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-phase-"));
    dirs.push(d);
    const make = () => new EventRuntime({ eventId: "evt", store: new Store(d), codes: { event: "EVT141", prime: "PRM141", mod: "MOD141" }, scenarioName: "phases", scenarioSource: STORY, joinBase: () => "http://localhost" });
    const rt = make();
    rt.openDoors();
    const live = rt as unknown as { chat: { all(): readonly ChatMessage[] }; sim: Sim; commit(m: string, ...a: unknown[]): unknown; fanout(e: unknown): void };
    live.fanout(live.commit("signal", "summon"));
    const before = live.chat.all().map((m) => [m.seq, m.text, m.phase]);
    expect(before.some(([, , p]) => p === "arrival")).toBe(true);
    expect(before.some(([, t, p]) => t === "Come to the Hall." && p === "summons")).toBe(true);
    const rt2 = make();
    rt2.restore();
    const after = (rt2 as unknown as typeof live).chat.all().map((m) => [m.seq, m.text, m.phase]);
    expect(after).toEqual(before);
  });
});
