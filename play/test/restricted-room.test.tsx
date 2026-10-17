//! B4: a restricted (marked) program standing in a room is told why it
//! can't post there, not that it is somewhere else.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChannelView, RESTRICTED_ROOM_NOTE, cantPostNote } from "../src/chat.tsx";
import type { Channel } from "../src/types.ts";

function room(extra: Partial<Channel>): Channel {
  return { id: "loc:The Desktop", kind: "location", title: "The Desktop", spaceId: "story", messages: [], unread: 0, ...extra } as Channel;
}

function footer(c: Channel): string {
  const html = renderToStaticMarkup(<ChannelView channel={c} onBack={() => {}} onSend={() => {}} />);
  return /<div class="cant-post">([^<]*)<\/div>/.exec(html)?.[1] ?? "";
}

describe("the composer's note in a room you can't post in", () => {
  it("standing in the room but refused: restricted", () => {
    expect(footer(room({ member: true, here: true, canPost: false }))).toBe(RESTRICTED_ROOM_NOTE.replace("'", "&#x27;"));
    expect(cantPostNote({ kind: "location", member: true })).toBe(RESTRICTED_ROOM_NOTE);
    expect(cantPostNote({ kind: "location", here: true })).toBe(RESTRICTED_ROOM_NOTE);
  });

  it("elsewhere: walk there; any other read-only room: read-only", () => {
    expect(footer(room({ member: false, canPost: false }))).toContain("not in this room");
    expect(footer(room({ kind: "announcement" as Channel["kind"], canPost: false }))).toBe("This room is read-only.");
    // A room you can post in has no note.
    expect(footer(room({ member: true, here: true, canPost: true }))).toBe("");
  });
});
