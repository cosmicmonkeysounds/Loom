//! Wave 13 Stage A seams: the stream's `onMessage` hook (the crawl decides
//! at arrival) and the room list's options (`ThreadsOptions`), wired by
//! plumbing with today's behaviour.

import { describe, expect, it } from "vitest";
import { chatFrameHandler, type ChatStreamHandlers } from "../src/client.ts";
import { createCrawl } from "../src/crawl.ts";
import { roomOrder } from "../src/rooms/order.ts";
import { roomOrder as presenceRoomOrder } from "../src/presence.ts";
import { unreadOf } from "../src/stream/badges.ts";
import type { Channel, ChatMessage } from "../src/types.ts";

const msg = (seq: number, channel = "lobby"): ChatMessage => ({
  seq,
  channel,
  channelKind: "lobby",
  title: "Lobby",
  from: "Clippy",
  kind: "line",
  text: `line ${seq}`,
  ts: seq,
  audience: "all",
  parentSeq: null,
  hidden: false,
});

describe("onMessage: the crawl hears each live message once", () => {
  it("calls crawl.arrived once per `message` frame, before it is applied — never for history", () => {
    const crawl = createCrawl();
    const arrived: number[] = [];
    const real = crawl.arrived.bind(crawl);
    crawl.arrived = (m, me) => {
      arrived.push(m.seq);
      real(m, me);
    };
    const map = new Map<number, ChatMessage>();
    const order: string[] = [];
    const handlers: ChatStreamHandlers = {
      onMessage: (m) => {
        order.push(`arrived ${m.seq} applied=${map.has(m.seq)}`);
        crawl.arrived(m, { id: "g1", name: "Ada" });
      },
      onHistory: (list) => order.push(`history ${list.length}`),
    };
    const onFrame = chatFrameHandler(() => handlers, {
      replace: (list) => {
        map.clear();
        for (const m of list) map.set(m.seq, m);
      },
      upsert: (m) => void map.set(m.seq, m),
      drop: (seq) => void map.delete(seq),
    });
    onFrame("history", JSON.stringify([msg(1), msg(2), msg(3)]));
    onFrame("message", JSON.stringify(msg(4)));
    onFrame("messageModerated", JSON.stringify({ ...msg(2), hidden: true }));
    onFrame("message", JSON.stringify(msg(5, "dm:Trabolta")));
    onFrame("history", JSON.stringify([msg(1)]));
    onFrame("messageExpired", JSON.stringify({ seq: 1 }));
    expect(arrived).toEqual([4, 5]);
    expect(order).toEqual(["history 3", "arrived 4 applied=false", "arrived 5 applied=false", "history 1"]);
    expect([...map.keys()]).toEqual([]);
  });

  it("the other frames still reach their handlers", () => {
    const seen: string[] = [];
    const onFrame = chatFrameHandler(
      () => ({
        onSnapshot: (v) => seen.push(`snapshot ${JSON.stringify(v)}`),
        onResponse: (t) => seen.push(`response ${t}`),
        onLifecycle: (n) => seen.push(`lifecycle ${n.kind}`),
        onTyping: (n) => seen.push(`typing ${n.on}`),
      }),
      { replace: () => {}, upsert: () => {}, drop: () => {} },
    );
    onFrame("snapshot", JSON.stringify({ id: "g1" }));
    onFrame("response", JSON.stringify({ text: "Welcome." }));
    onFrame("lifecycle", JSON.stringify({ kind: "reset" }));
    onFrame("typing", JSON.stringify({ channel: "dm:Trabolta", from: "Trabolta", on: true }));
    expect(seen).toEqual(['snapshot {"id":"g1"}', "response Welcome.", "lifecycle reset", "typing true"]);
  });
});

describe("the room list's options keep today's rules", () => {
  const room = (over: Partial<Channel>): Channel => ({ id: "lobby", kind: "lobby", title: "Lobby", spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0, ...over });

  it("unreadOf counts every message past the mark, and at least one with a decision", () => {
    const c = room({ messages: [msg(1), msg(2), msg(3)] });
    expect(unreadOf(c, -1, undefined)).toBe(3);
    expect(unreadOf(c, 2, { id: "g1", name: "Ada", booth: false })).toBe(1);
    expect(unreadOf(c, 3, undefined)).toBe(0);
    expect(unreadOf({ ...c, decision: { title: "Your move…", options: [] } }, 3, undefined)).toBe(1);
  });

  it("roomOrder moved to rooms/order.ts; presence still exports it", () => {
    expect(presenceRoomOrder).toBe(roomOrder);
  });
});
