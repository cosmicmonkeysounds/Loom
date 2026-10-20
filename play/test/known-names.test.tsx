//! Wave 13 recheck: a speaker whose raw name the view already spells (ICQ,
//! VLC) keeps that spelling; prettyName recases only names nobody knows.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KnownNamesProvider, displayName, knownNames } from "../src/rooms/names.ts";
import { lastPreview } from "../src/rooms/list.tsx";
import { MessageBubble } from "../src/stream/bubble.tsx";
import type { Channel, ChatMessage } from "../src/types.ts";

const line = (from: string, text = "hello from desktop"): ChatMessage =>
  ({ seq: 4, channel: "loc:The Desktop", channelKind: "location", title: "The Desktop", from, kind: "line", text, ts: 4000, audience: "all", parentSeq: null, hidden: false }) as ChatMessage;

describe("known names", () => {
  const known = knownNames(["ICQ"], ["VLC", "Clippy", "MS_Paint"], undefined, [null]);

  it("an ALL-CAPS program keeps its spelling; a cue nobody knows is recased", () => {
    expect(displayName("ICQ", known)).toBe("ICQ");
    expect(displayName("VLC", known)).toBe("VLC");
    expect(displayName("vlc", known)).toBe("VLC");
    expect(displayName("CLIPPY", known)).toBe("Clippy");
    expect(displayName("MS Paint", known)).toBe("MS Paint");
    expect(displayName("MODERATOR_PRIME", known)).toBe("Moderator Prime");
    expect(displayName("ICQ", null)).toBe("Icq");
  });

  it("the stream's speaker and the room row's preview read the known spelling", () => {
    const html = renderToStaticMarkup(createElement(KnownNamesProvider, { value: known }, createElement(MessageBubble, { msg: line("ICQ") })));
    expect(html).toContain(">ICQ<");
    expect(html).not.toContain("Icq");
    const room = { id: "loc:The Desktop", kind: "location", title: "The Desktop", messages: [line("VLC")], decision: null } as unknown as Channel;
    expect(lastPreview(room, known)).toBe("VLC: hello from desktop");
    expect(lastPreview(room)).toBe("Vlc: hello from desktop");
  });
});
