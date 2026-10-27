// Wave 28: a pick is a real chat line from the server (`pick: true`). The
// phone still echoes its own pick at once, and drops that echo once the
// server's line arrives, so a pick made on the phone is never shown twice.
import { describe, expect, it } from "vitest";

import { choiceEcho, echoAnswered, withEchoes } from "../src/session/guest.ts";
import type { ChatMessage } from "../src/types.ts";

const me = { id: "g-1", name: "Winamp" };

function msg(seq: number, channel: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel, channelKind: "dm", title: channel, from: "Trabolta", kind: "line", text: `line ${seq}`, ts: seq, audience: ["g-1"], parentSeq: null, hidden: false, ...extra };
}

describe("the phone's pick echo (wave 28)", () => {
  it("reads like the server's pick line: the tag dropped, a deed in brackets", () => {
    expect(choiceEcho("dm:Trabolta", "⟦SPEAK FREELY⟧ Forget the questions. Talk to me.", me, 4)).toMatchObject({ text: "Forget the questions. Talk to me.", pick: true });
    const deed = choiceEcho("dm:Trabolta", "⟦PROOF⟧ Show him the Sandy File.", me, 4);
    expect(deed).toMatchObject({ seq: 4.5, text: "[shows the Sandy File]", pick: true, act: true });
  });

  it("is dropped once the matching server pick line arrives: no duplicate", () => {
    const echo = choiceEcho("dm:Trabolta", "I'm a person.", me, 4, 40);
    const before = new Map([[4, msg(4, "dm:Trabolta")]]);
    expect([...withEchoes(before, [echo]).values()].map((m) => m.text)).toEqual(["line 4", "I'm a person."]);
    const after = new Map([
      [4, msg(4, "dm:Trabolta")],
      [5, msg(5, "dm:Trabolta", { from: "Winamp", text: "I'm a person.", pick: true })],
      [6, msg(6, "dm:Trabolta", { text: "A person. Of course." })],
    ]);
    expect(echoAnswered(echo, after)).toBe(true);
    const shown = [...withEchoes(after, [echo]).values()].map((m) => m.text);
    expect(shown).toEqual(["line 4", "I'm a person.", "A person. Of course."]);
  });

  it("stays while only an older pick, another room or a plain typed line matches", () => {
    const echo = choiceEcho("dm:Trabolta", "I'm a person.", me, 9);
    const older = new Map([[3, msg(3, "dm:Trabolta", { from: "Winamp", text: "I'm a person.", pick: true })]]);
    expect(echoAnswered(echo, older)).toBe(false);
    const elsewhere = new Map([[10, msg(10, "dm:Clippy", { from: "Winamp", text: "I'm a person.", pick: true })]]);
    expect(echoAnswered(echo, elsewhere)).toBe(false);
    const typed = new Map([[10, msg(10, "dm:Trabolta", { from: "Winamp", text: "I'm a person." })]]);
    expect(echoAnswered(echo, typed)).toBe(false);
    expect(withEchoes(typed, [echo]).has(9.5)).toBe(true);
  });
});
