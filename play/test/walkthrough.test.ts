// The fixes from the Oct 31 browser walkthrough: the stream that sticks to
// its newest line, authored names, a hold-line character that is never
// "away", the performer's own buttons first, the guest's echoed choice,
// re-dealt cards, read marks that survive a reload.
import { describe, expect, it } from "vitest";

import { atBottom } from "../src/chat.tsx";
import { splitInteractions } from "../src/performer.tsx";
import { actFeedback, buildGuestChannels, choiceEcho, withAgents, withEchoes } from "../src/session.ts";
import { advanceMarks, channelHead, prettyName } from "../src/threads.ts";
import type { Channel, ChatMessage, GuestView, Interaction } from "../src/types.ts";
import { supersededCards } from "../src/widgets.tsx";

function msg(seq: number, channel: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel, channelKind: "dm", title: channel, from: "Trabolta", kind: "line", text: `line ${seq}`, ts: seq, audience: ["g-1"], parentSeq: null, hidden: false, ...extra };
}
function ch(id: string): Channel {
  return { id, kind: "dm", title: id, spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0 };
}

describe("the stream sticks to its newest line", () => {
  it("counts the last ~80 px as the bottom", () => {
    expect(atBottom({ scrollTop: 760, scrollHeight: 1000, clientHeight: 240 })).toBe(true);
    expect(atBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 240 })).toBe(true); // 60 px off
    expect(atBottom({ scrollTop: 594, scrollHeight: 1000, clientHeight: 240 })).toBe(false); // the walkthrough's 166 px
  });
});

describe("authored names keep their casing", () => {
  it("re-cases only a shouted cue or an all-lower key", () => {
    expect(prettyName("WebMD")).toBe("WebMD");
    expect(prettyName("Norton Anti-Virus")).toBe("Norton Anti-Virus");
    expect(prettyName("MS_Paint")).toBe("MS Paint");
    expect(prettyName("MODERATOR_PRIME")).toBe("Moderator Prime");
    expect(prettyName("recruiter")).toBe("Recruiter");
    expect(channelHead("dm:WebMD").title).toBe("WebMD");
  });

  it("titles a character's DM with the declared name from the directory", () => {
    const view = {
      id: "g-1",
      name: "Winamp",
      faction: null,
      location: null,
      roster: [],
      channels: [],
      spaces: [],
      people: [{ id: "WebMD", name: "WebMD", kind: "character", faction: null, known: [], location: null }],
    } as unknown as GuestView;
    const rows = buildGuestChannels(new Map([[1, msg(1, "dm:WebMD", { from: "WebMD" })]]), null, view);
    expect(rows.find((c) => c.id === "dm:WebMD")!.title).toBe("WebMD");
  });
});

describe("a character with a hold: line is never away", () => {
  it("shows no presence to the guest — the row previews the last message", () => {
    const view = {
      people: [
        { id: "Trabolta", name: "Trabolta", kind: "character", faction: null, known: [], location: null, agent: { online: false, hold: true } },
        { id: "Oracle", name: "Oracle", kind: "character", faction: null, known: [], location: null, agent: { online: false } },
      ],
    } as unknown as GuestView;
    const out = withAgents([ch("dm:Trabolta"), ch("dm:Oracle")], view, new Map([["dm:Trabolta", "Trabolta"]]));
    expect(out[0]!.subtitle).toBeUndefined();
    expect(out[0]!.typing).toBe("Trabolta"); // still says when a worker composes
    expect(out[1]!.subtitle).toMatch(/away/);
  });
});

describe("a performer's card leads with their own buttons", () => {
  const list: Interaction[] = [
    { id: "send", label: "🛡 Send", who: "performer", description: null, actors: ["Norton Anti-Virus", "McAfee Anti-Virus"] },
    { id: "bingo", label: "🎱 Bingo", who: "performer", description: null, actors: ["Clippy"], live: false },
    { id: "judge", label: "✅ Q1", who: "performer", description: null, actors: ["Clippy"] },
    { id: "check", label: "📍 Check in", who: "performer", description: null },
    { id: "cue", label: "📣 Cue", who: "admin", description: null },
  ];
  it("folds another character's, the out-of-phase and (for an admin) the director's under More", () => {
    const norton = splitInteractions(list, "Norton Anti-Virus", false);
    expect(norton.mine.map((i) => i.id)).toEqual(["send", "check"]);
    expect(norton.more.map((i) => i.id)).toEqual(["bingo", "judge"]);
    const clippy = splitInteractions(list, "clippy", true);
    expect(clippy.mine.map((i) => i.id)).toEqual(["judge", "check"]);
    expect(clippy.more.map((i) => i.id)).toEqual(["send", "bingo", "cue"]);
  });
});

describe("guest buttons answer where the guest is looking", () => {
  it("banners the story's reply, else acknowledges the button", () => {
    expect(actFeedback(["Bathroom Mode engaged."], "🚻 Bathroom Mode")).toBe("Bathroom Mode engaged.");
    expect(actFeedback([], "🚻 Bathroom Mode")).toBe("✔ 🚻 Bathroom Mode");
    expect(actFeedback(undefined)).toBe("✔ Done.");
  });
});

describe("the guest's own choice is echoed", () => {
  it("lands as their line just after what the room already holds", () => {
    const echo = choiceEcho("dm:The Uploader", "Upload me", { id: "g-1", name: "Winamp" }, 41);
    expect(echo).toMatchObject({ seq: 41.5, channel: "dm:The Uploader", from: "Winamp", kind: "line", text: "Upload me", audience: ["g-1"] });
    const stream = withEchoes(new Map([[41, msg(41, "dm:The Uploader")], [42, msg(42, "dm:The Uploader")]]), [echo]);
    expect([...stream.values()].sort((a, b) => a.seq - b.seq).map((m) => m.seq)).toEqual([41, 41.5, 42]);
  });
});

describe("a re-dealt card replaces the earlier one", () => {
  it("marks every fact card but the newest per room", () => {
    const fact = (seq: number, channel = "dm:Trabolta") => msg(seq, channel, { kind: "widget", widget: { kind: "fact", text: "📝", params: {} } });
    const old = supersededCards([fact(3), msg(4, "dm:Trabolta"), fact(7), fact(9), fact(5, "dm:Clippy"), msg(10, "dm:Trabolta", { kind: "widget", widget: { kind: "captcha", text: "", params: {} } })]);
    expect([...old].sort((a, b) => a - b)).toEqual([3, 7]);
  });
});

describe("read marks", () => {
  it("only ever move forward, per room", () => {
    const marks = new Map([["dm:The Uploader", 5]]);
    const next = advanceMarks(marks, [
      { channel: "dm:The Uploader", seq: 3 },
      { channel: "dm:The Uploader", seq: 9 },
      { channel: "loc:The Optical Drive", seq: 4 },
    ]);
    expect(Object.fromEntries(next)).toEqual({ "dm:The Uploader": 9, "loc:The Optical Drive": 4 });
    expect(advanceMarks(next, [{ channel: "dm:The Uploader", seq: 2 }])).toBe(next);
  });
});
