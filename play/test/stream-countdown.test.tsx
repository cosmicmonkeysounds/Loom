//! The countdown strip in a room (split out of countdown.test.tsx in wave
//! 13, block unchanged): it sits right under the room header.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChannelView } from "../src/chat.tsx";
import { CountdownStripView } from "../src/countdown.tsx";
import type { Channel } from "../src/types.ts";

describe("the strip", () => {
  it("sits right under the room header", () => {
    const room = { id: "loc:The Desktop", kind: "location", title: "The Desktop", spaceId: "story", messages: [], unread: 0 } as unknown as Channel;
    const html = renderToStaticMarkup(<ChannelView channel={room} onBack={() => {}} strip={<CountdownStripView items={[{ label: "Summons", left: 90 }]} paused={false} />} />);
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("countdown-strip"));
    expect(html).toContain("⏳ Summons 1:30");
  });
});
