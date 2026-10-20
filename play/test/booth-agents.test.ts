// Agent-voiced characters in the booth (split out of agents.test.ts in wave
// 13, block unchanged): the private Cast thread and the broadcast feed.
import { describe, expect, it } from "vitest";

import { buildPrimeChannels } from "../src/session.ts";
import type { ChatMessage, PrimeView } from "../src/types.ts";

function msg(seq: number, from: string, text: string, audience: ChatMessage["audience"]): ChatMessage {
  return { seq, channel: "dm:Trabolta", channelKind: "dm", title: "Trabolta", from, kind: "line", text, ts: seq, audience, parentSeq: null, hidden: false };
}

describe("agent threads", () => {
  it("a performer gets a private Cast thread per agent, with only their own lines", () => {
    const view = { character: "Clippy", faction: null, guests: [], channels: [], spaces: [], agents: [{ id: "Trabolta", online: true }] } as PrimeView;
    const messages = new Map<number, ChatMessage>([
      [1, msg(1, "Clippy", "Boss?", ["@Clippy"])],
      [2, msg(2, "Trabolta", "Speak.", ["@Clippy"])],
      [3, msg(3, "Norton", "Sir!", ["@Norton"])],
      [4, msg(4, "Ada", "hi", ["g-1"])],
    ]);
    const cast = buildPrimeChannels(messages, view).find((c) => c.id === "cast:Trabolta")!;
    expect(cast.spaceId).toBe("cast");
    expect(cast.subtitle).toBe("online");
    expect(cast.messages.map((m) => m.text)).toEqual(["Boss?", "Speak."]);
    // Nothing from the cast thread leaks into the broadcast feed.
    expect(buildPrimeChannels(messages, view).find((c) => c.id === "__feed")!.messages).toEqual([]);
  });
});
