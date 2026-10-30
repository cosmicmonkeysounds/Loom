// Wave 47: the upload's optional questions (the 🎥 video question, the inbox)
// are asked once, on the stage. Seen in the full-evening sweep: "✉ YOUR
// INBOX · in Task Manager" held Mission's big button and "📊 poll · in Task
// Manager" a Your move row all night, and Task Manager's room opened on them.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { liveCardsOf } from "../src/guest/frame.tsx";
import { missionOf, type MissionInput } from "../src/guest/mission-model.ts";
import type { Channel, ChatMessage, GuestView } from "../src/types.ts";
import { optionalCard } from "../src/widgets.tsx";

const card = (seq: number, kind: string, text: string, params: Record<string, string> = {}): ChatMessage =>
  ({ seq, channel: "dm:Task Manager", channelKind: "dm", title: "", from: "Task Manager", kind: "widget", text, ts: seq, audience: ["g-1"], parentSeq: null, hidden: false, widget: { kind, text, params } }) as ChatMessage;
const room = (messages: ChatMessage[]): Channel => ({ id: "dm:Task Manager", kind: "dm", title: "Task Manager", spaceId: "story", messages, unread: 0, decision: null, lastTs: 0 });
const view = { id: "g-1", name: "Winamp", role: null, faction: null, score: 0, location: "The Desktop", captured: false, pendingChoice: null, decisionChannel: null, channels: [], spaces: [], roster: [] } as unknown as GuestView;

describe("optional cards (wave 47)", () => {
  const video = card(10, "poll", "🎥 May video of you from tonight be used?", { options: "Yes, use video of me | No, leave me out", optional: "true" });
  const inbox = card(11, "email", "Your human inbox, for Jean Trabolta's letter. Optional.", { skip: "No thanks" });
  const vote = card(12, "poll", "Help him or thwart him?", { options: "Help him | Thwart him" });

  it("the story's `optional: true`, or an email with a skip", () => {
    expect(optionalCard(video.widget!)).toBe(true);
    expect(optionalCard(inbox.widget!)).toBe(true);
    expect(optionalCard(vote.widget!)).toBe(false);
  });
  it("live cards say which are optional", () => {
    expect(liveCardsOf([room([video, inbox, vote])], new Map()).map((c) => [c.seq, c.optional === true])).toEqual([
      [10, true],
      [11, true],
      [12, false],
    ]);
  });
  it("Mission never carries them: the app filters them out, and Chats' Your move too", () => {
    const app = readFileSync(new URL("../src/guest/app.tsx", import.meta.url), "utf8");
    expect(app).toContain("cards: cards.filter((c) => c.optional !== true), decision: s.decision,");
    expect(app).toContain("cardRooms: new Set(cards.filter((c) => c.optional !== true).map((c) => c.channel))");
  });
  it("a question card on Mission reads as its question, never its kind", () => {
    const input: MissionInput = { view, list: [room([vote])], cards: [{ glyph: "📊", channel: "dm:Task Manager", seq: 12 }], decision: null };
    expect(missionOf(input).cardButton?.label).toBe("📊 HELP HIM OR THWART HIM? · in Task Manager");
  });
  it("a room's tray keeps an optional card folded until asked for", () => {
    const tray = readFileSync(new URL("../src/stream/card-tray.tsx", import.meta.url), "utf8");
    expect(tray).toMatch(/&& \(!quiet \|\| focus !== null\)\);/u);
    const view = readFileSync(new URL("../src/stream/channel-view.tsx", import.meta.url), "utf8");
    expect(view).toMatch(/<CardTray [^>]*foldOptional \/>/u);
  });
});
