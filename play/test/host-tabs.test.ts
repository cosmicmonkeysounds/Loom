//! The host drawer's tabs and More sections (wave 13): what shows, what it
//! counts, and the rows' small rules (people, Bathroom Mode, threads).

import { describe, expect, it } from "vitest";
import { cueRows } from "../../core/src/cue-sheet.ts";
import { sheetLayout } from "../src/director.tsx";
import type { ChatMessage } from "../src/types.ts";
import {
  agentThread,
  awardsNear,
  filterPeople,
  hostStrip,
  hostTabs,
  inBathroom,
  isBathroomFlag,
  kingHpInput,
  moreSections,
  needSection,
  agentSection,
  needTab,
  personLine,
  presenceText,
  refusalReason,
  refusedLive,
  refusedText,
  releasable,
  seenText,
  stimulusInput,
  tabLabel,
} from "../src/host/model.ts";
import { hostFixture } from "./host-fixture.ts";

const msg = (seq: number, channel: string, text: string, audience: ChatMessage["audience"] = "all"): ChatMessage =>
  ({ seq, channel, channelKind: "channel", title: channel, from: "", kind: "line", text, ts: seq, audience, parentSeq: null, hidden: false }) as ChatMessage;

describe("the drawer's tabs", () => {
  it("Cues · Needs (n) · Judge (n) · People · More, counting what waits", () => {
    const tabs = hostTabs(hostFixture(), 1);
    expect(tabs.map(tabLabel)).toEqual(["Cues", "Needs (3)", "Judge (1)", "People", "More"]);
  });

  it("no facts → no Judge tab; nothing waiting → Needs (0)", () => {
    const tabs = hostTabs(hostFixture({ judging: null, needs: [] }), 0);
    expect(tabs.map((t) => t.id)).toEqual(["cues", "needs", "people", "more"]);
    expect(tabLabel(tabs[1]!)).toBe("Needs (0)");
  });

  it("before the first poll: Cues, Needs, People, More", () => {
    expect(hostTabs(null, 0).map((t) => t.id)).toEqual(["cues", "needs", "people", "more"]);
  });

  it("More shows only what the event has: no currency → no wallet, no King, no terminals", () => {
    expect(moreSections(hostFixture())).toEqual(["show", "clock", "announce", "alerts", "wallet", "king", "terminals", "sound", "codes", "parts", "agents"]);
    expect(moreSections(hostFixture({ wallet: null, king: null, terminals: null, parts: [], agents: [] }))).toEqual(["show", "clock", "announce", "alerts", "sound", "codes"]);
    // M3: crews, under House, once there is one.
    expect(moreSections({ ...hostFixture({ wallet: null, king: null, terminals: null, parts: [], agents: [] }), crews: [{ id: "crew-1", name: "Night Shift", members: 2 }] })).toContain("crews");
  });

  it("a need opens its tab (and the staff room for a staff need)", () => {
    expect(needTab("judge")).toBe("judge");
    expect(needTab("people")).toBe("people");
    expect(needTab("part")).toBe("people");
    expect(needTab("wallet")).toBe("more");
    expect(needTab("agent")).toBe("more");
    expect(needTab("more")).toBe("more");
    expect(needTab("staff")).toBe("staff");
    expect(needSection({ target: "wallet" })).toBe("wallet");
    expect(needSection({ target: "agent" })).toBe("agents");
    expect(needSection({ target: "more" })).toBe("terminals");
    expect(needSection({ target: "judge" })).toBeNull();
  });
  it("an agent's need opens that agent's own section, never the first agent's", () => {
    expect(needSection({ target: "agent", character: "Trabolta" })).toBe("agents-trabolta");
    expect(needSection({ target: "agent", character: "Second Mind" })).toBe("agents-second-mind");
    expect(agentSection("Mr. O'Hare")).toBe("agents-mr-o-hare");
  });
});

describe("the NEXT bar's second line", () => {
  it("act · phase · countdown · ⚠ needs", () => {
    const v = hostFixture();
    const rows = cueRows(v.interactions, v.cues);
    const items = hostStrip(v, sheetLayout(rows), 60_000, 3);
    expect(items.map((i) => i.text)).toEqual(["B", "Arrivals", "⏳ Hunt, 1:00 left", "⚠ 3"]);
    expect(items.map((i) => i.kind)).toEqual(["act", "phase", "countdown", "needs"]);
    // A phone drops the phase first, and only to make room for a countdown.
    expect(items.filter((i) => i.optional).map((i) => i.kind)).toEqual(["phase"]);
    expect(hostStrip(hostFixture({ countdowns: [] }), sheetLayout(rows), 60_000, 3).some((i) => i.optional)).toBe(false);
    expect(items[3]!.tone).toBe("needs");
  });

  it("a countdown under a minute is urgent; a paused clock says so; no needs, no ⚠", () => {
    const v = hostFixture({ runtime: "paused", paused: true });
    const items = hostStrip(v, sheetLayout(cueRows(v.interactions, v.cues)), 90_000, 0);
    expect(items.map((i) => i.text)).toEqual(["B", "Arrivals", "⏸ clock stopped", "⏳ Hunt, 0:30 left"]);
    expect(items[3]!.tone).toBe("urgent");
  });
});

describe("a refused press", () => {
  const press = { id: "spin_the_bottle", what: "🍾 Spin the bottle", at: 1000, afterSeq: 10 };
  it("reads the first # hosts line after the press", () => {
    const msgs = new Map<number, ChatMessage>([
      [9, msg(9, "room:hosts", "old news")],
      [11, msg(11, "lobby", "not staff")],
      [12, msg(12, "room:hosts", "🍾 waits for the results")],
      [14, msg(14, "room:hosts", "later line")],
    ]);
    expect(refusalReason(msgs, ["room:hosts"], 10)).toBe("🍾 waits for the results");
    expect(refusalReason(msgs, ["room:hosts"], 14)).toBeNull();
    expect(refusedText(press, "🍾 waits for the results", 1500)).toBe("✕ 🍾 Spin the bottle not taken — 🍾 waits for the results");
    expect(refusedText(press, null, 1500)).toBe("✕ 🍾 Spin the bottle not taken…");
    expect(refusedText(press, null, 5000)).toBe("✕ 🍾 Spin the bottle not taken (no reason in # hosts)");
  });
  it("stays under Needs for a minute", () => {
    expect(refusedLive(press, 30_000)).toBe(true);
    expect(refusedLive(press, 62_000)).toBe(false);
  });
});

describe("people", () => {
  const people = hostFixture().people;
  it("search by name or room", () => {
    expect(filterPeople(people, "ada").map((p) => p.id)).toEqual(["g1"]);
    expect(filterPeople(people, "tube").map((p) => p.id)).toEqual(["g2"]);
    expect(filterPeople(people, "  ").length).toBe(2);
  });
  it("Bathroom Mode reads the afk flag (or a label naming it)", () => {
    expect(isBathroomFlag({ label: "AFK", path: "Program.afk" })).toBe(true);
    expect(isBathroomFlag({ label: "In the bathroom", path: "Program.away" })).toBe(true);
    expect(isBathroomFlag({ label: "Marked", path: "Program.marked" })).toBe(false);
    expect(inBathroom(people[0]!)).toBe(true);
    expect(inBathroom(people[1]!)).toBe(false);
    expect(inBathroom({ flags: [{ label: "Bathroom", path: "Program.afk", value: "false", on: false }] })).toBe(false);
  });
  it("the facts line and the seen line", () => {
    expect(personLine(people[0]!)).toBe("The Desktop · Bathroom");
    expect(personLine({ ...people[1]!, gone: true, captured: true })).toBe("The Tube · captured · went home");
    expect(seenText(undefined, 0)).toBeNull();
    expect(seenText(null, 0)).toBe("not seen since the server started");
    expect(seenText(0, 30_000)).toBe("seen just now");
    expect(seenText(0, 12 * 60_000)).toBe("seen 12 m ago");
    expect(seenText(0, 75 * 60_000)).toBe("seen 1 h 15 m ago");
  });
});

describe("the agent's waiting guests", () => {
  it("a guest's thread is the agent's dm: addressed to them, oldest first", () => {
    const msgs = new Map<number, ChatMessage>([
      [3, msg(3, "dm:Trabolta", "hello?", ["g1"])],
      [2, msg(2, "dm:Trabolta", "someone else", ["g2"])],
      [5, msg(5, "dm:Trabolta", "I hear you", ["g1"])],
      [4, msg(4, "dm:Clippy", "not him", ["g1"])],
    ]);
    expect(agentThread(msgs, "Trabolta", "g1").map((m) => m.text)).toEqual(["hello?", "I hear you"]);
  });
});

describe("awards and small inputs", () => {
  it("the recap is read when an award cue is NEXT or in the focus act", () => {
    const v = hostFixture();
    const rows = cueRows(v.interactions, v.cues);
    expect(awardsNear(rows, sheetLayout(rows))).toBe(false);
    const late = cueRows(v.interactions, { last: "start_bingo", fired: ["call_everyone", "start_bingo"] });
    expect(awardsNear(late, sheetLayout(late))).toBe(true);
  });
  it("King hp and stimulus boxes", () => {
    expect(kingHpInput("15", 15)).toBe(15);
    expect(kingHpInput("0", 15)).toBe(0);
    expect(kingHpInput("16", 15)).toBeNull();
    expect(kingHpInput("", 15)).toBeNull();
    expect(kingHpInput("2.5", 15)).toBeNull();
    expect(stimulusInput("10")).toBe(10);
    expect(stimulusInput("0")).toBeNull();
  });
  it("part presence", () => {
    expect(presenceText("online")).toBe("● on");
    expect(presenceText("free")).toBe("○ nobody signed in");
    expect(releasable("online")).toBe(true);
    expect(releasable("phone-offline")).toBe(true);
    expect(releasable("free")).toBe(false);
  });
});

describe("needs fold", () => {
  it("two or more parts in one state are one row naming them, where the first sat", async () => {
    const { groupNeeds } = await import("../src/host/model.ts");
    const needs = [
      { kind: "near" as const, key: "near", text: "⚠ 1 near miss to judge", target: "judge" as const },
      { kind: "free" as const, key: "part:Norton", text: "🎭 Norton: nobody signed in", target: "part" as const, character: "Norton" },
      { kind: "phone-offline" as const, key: "part:Clippy", text: "📱 Clippy: phone offline", target: "part" as const, character: "Clippy" },
      { kind: "free" as const, key: "part:McAfee", text: "🎭 McAfee: nobody signed in", target: "part" as const, character: "McAfee" },
    ];
    expect(groupNeeds(needs).map((n) => [n.text, n.detail])).toEqual([
      ["⚠ 1 near miss to judge", undefined],
      ["🎭 2 parts: nobody signed in", "Norton, McAfee"],
      ["📱 Clippy: phone offline", undefined],
    ]);
  });
});
