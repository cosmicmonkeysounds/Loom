//! Wave 13 fix round (fguest): the cutscene's stage carries only what was
//! said to the guest — never another guest's typed chat in a room, never an
//! app card (a 📝 fact) — and once the story has moved them on, only the
//! story's hand-off to them lands.

import { describe, expect, it } from "vitest";
import { stageMessages } from "../src/cutscene.tsx";
import type { ChatMessage } from "../src/types.ts";

let seq = 1;
const m = (extra: Partial<ChatMessage>): ChatMessage => ({
  seq: seq++, channel: "dm:Norton", channelKind: "dm", title: "Norton", from: "Norton", kind: "line", text: "x", ts: 0, audience: ["g1"], parentSeq: null, hidden: false, beat: "Clearance", ...extra,
});

describe("the cutscene stage", () => {
  it("never shows other guests' typed chat in a room, an arrival room's included", () => {
    const norton = m({ text: "Scanned." });
    const chatter = m({ channel: "loc:The Desktop", channelKind: "location", from: "LimeWire", beat: null, text: "anyone know where the bathroom is", audience: ["g1", "g2"] });
    const arrival = m({ channel: "loc:The Optical Drive", channelKind: "location", from: "Ring Doorbell", beat: undefined, text: "ok what now", audience: ["g1", "g2"] });
    const agent = m({ channel: "dm:Trabolta", from: "Trabolta", beat: null, text: "Hello." }); // a DM reply is said to you
    expect(stageMessages([norton, chatter, arrival, agent], null).map((x) => x.text)).toEqual(["Scanned.", "Hello."]);
  });

  it("an app card (📝 fact, 💬 answer) never lands on the stage; the CAPTCHA and the pass do", () => {
    const captcha = m({ kind: "widget", channel: "dm:The Uploader", widget: { kind: "captcha", text: "", params: {} } });
    const pass = m({ kind: "widget", widget: { kind: "pass", text: "", params: {} } });
    const fact = m({ kind: "widget", channel: "dm:Trabolta", widget: { kind: "fact", text: "File a fact", params: { questions: "Q1: Who?" } } });
    expect(stageMessages([captcha, pass, fact], null).map((x) => x.widget?.kind)).toEqual(["captcha", "pass"]);
  });

  it("wave 41: an answer card dealt with stage: true (the upload's write-in) and the inbox card land on the stage", () => {
    const writeIn = m({ kind: "widget", channel: "dm:Task Manager", widget: { kind: "answer", text: "Which problem?", params: { max: "60", stage: "true" } } });
    const deposit = m({ kind: "widget", channel: "dm:Task Manager", widget: { kind: "answer", text: "What did you leave?", params: { max: "80" } } });
    const inbox = m({ kind: "widget", channel: "dm:Task Manager", widget: { kind: "email", text: "Your inbox", params: {} } });
    expect(stageMessages([writeIn, deposit, inbox], null).map((x) => x.widget?.text)).toEqual(["Which problem?", "Your inbox"]);
  });

  it("once moved on, only the story's lines to them still land: the hand-off, never a later card or notice", () => {
    const before = m({ text: "Scanned. Go through the Tube." });
    const freeze = before.seq;
    const handoff = m({ channel: "dm:Task Manager", from: "Task Manager", beat: "Clearance", text: "You're in." });
    const notice = m({ kind: "system", channel: "lobby", channelKind: "lobby", from: "", beat: null, text: "📂 The CPU is open now." });
    const poll = m({ kind: "widget", widget: { kind: "poll", text: "?", params: {} } });
    expect(stageMessages([before, handoff, notice, poll], freeze).map((x) => x.text)).toEqual(["Scanned. Go through the Tube.", "You're in."]);
  });
});
