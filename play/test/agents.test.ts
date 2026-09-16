import { describe, expect, it } from "vitest";

import { buildPrimeChannels, withAgents } from "../src/session.ts";
import { applyTyping, typingThread, type TypingNotice } from "../src/typing.ts";
import type { Channel, ChatMessage, GuestView, PrimeView } from "../src/types.ts";

const notice = (audience: string[], on = true): TypingNotice => ({ channel: "dm:Trabolta", from: "Trabolta", on, audience });

function msg(seq: number, from: string, text: string, audience: ChatMessage["audience"]): ChatMessage {
  return { seq, channel: "dm:Trabolta", channelKind: "dm", title: "Trabolta", from, kind: "line", text, ts: seq, audience, parentSeq: null, hidden: false };
}
function ch(id: string, extra: Partial<Channel> = {}): Channel {
  return { id, kind: "dm", title: id, spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0, ...extra };
}

describe("typing indicator", () => {
  it("maps a notice onto each app's thread id", () => {
    expect(typingThread(notice(["g-1"]), { role: "guest" })).toBe("dm:Trabolta");
    expect(typingThread(notice(["@Clippy"]), { role: "performer", character: "Clippy" })).toBe("cast:Trabolta");
    // An admin performer watching a guest's conversation.
    expect(typingThread(notice(["g-1"]), { role: "performer", character: "Clippy" })).toBe("guest:g-1");
  });

  it("folds on / off without churning identity", () => {
    const empty = new Map<string, string>();
    const on = applyTyping(empty, "dm:Trabolta", notice(["g-1"]));
    expect(on.get("dm:Trabolta")).toBe("Trabolta");
    expect(applyTyping(on, "dm:Trabolta", notice(["g-1"]))).toBe(on);
    const off = applyTyping(on, "dm:Trabolta", notice(["g-1"], false));
    expect(off.has("dm:Trabolta")).toBe(false);
    expect(applyTyping(off, "dm:Trabolta", notice(["g-1"], false))).toBe(off);
  });
});

describe("agent threads", () => {
  it("a guest's DM with an agent says whether anyone is answering, and who is typing", () => {
    const view = {
      people: [
        { id: "Trabolta", name: "Trabolta", kind: "character", faction: null, known: [], location: null, agent: { online: false } },
        { id: "Clippy", name: "Clippy", kind: "character", faction: null, known: [], location: null },
      ],
    } as unknown as GuestView;
    const out = withAgents([ch("dm:Trabolta"), ch("dm:Clippy"), ch("lobby")], view, new Map([["dm:Trabolta", "Trabolta"]]));
    expect(out[0]!.subtitle).toMatch(/away/);
    expect(out[0]!.typing).toBe("Trabolta");
    expect(out[1]!.subtitle).toBeUndefined();
    expect(out[2]).toEqual(ch("lobby"));
  });

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
