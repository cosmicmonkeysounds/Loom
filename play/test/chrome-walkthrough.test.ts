// From the Oct 31 browser walkthrough (split out of walkthrough.test.ts in
// wave 13, blocks unchanged): authored names, the guest's buttons and echoed
// choice, read marks that survive a reload.
import { describe, expect, it } from "vitest";

import { actFeedback, buildGuestChannels, choiceEcho, withEchoes } from "../src/session.ts";
import { advanceMarks, channelHead, prettyName } from "../src/threads.ts";
import type { ChatMessage, GuestView } from "../src/types.ts";

function msg(seq: number, channel: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel, channelKind: "dm", title: channel, from: "Trabolta", kind: "line", text: `line ${seq}`, ts: seq, audience: ["g-1"], parentSeq: null, hidden: false, ...extra };
}

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

  it("is stamped in story time, never the wall clock", () => {
    expect(choiceEcho("dm:The Uploader", "Upload me", { id: "g-1", name: "Winamp" }, 41, 93_000).ts).toBe(93_000);
    expect(choiceEcho("dm:The Uploader", "Upload me", { id: "g-1", name: "Winamp" }, 41).ts).toBe(0);
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
