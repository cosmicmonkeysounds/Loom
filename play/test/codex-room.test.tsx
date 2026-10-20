//! Wave 13: the Codex is a filing cabinet — grouped by category, one line
//! an entry, collapsed by default, a filter, NEW until opened.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayHostContext, browserHost, memoryStore } from "../src/host.ts";
import { CodexRoom } from "../src/stream/codex-room.tsx";
import { codexCategory, codexGroups, codexRows, codexSub, markSeen, newEntries } from "../src/stream/codex-groups.ts";
import type { ChatMessage, CodexCard } from "../src/types.ts";

let seq = 1;
function entry(c: Partial<CodexCard> & { entry: string }, text = "A long entry. ".repeat(20)): ChatMessage {
  return {
    seq: seq++, channel: "codex", channelKind: "codex", title: "Codex", from: "", kind: "codex", text, ts: 0, audience: ["g1"], parentSeq: null, hidden: false,
    codex: { title: c.entry.replace(/_/g, " "), about: null, via: "code", from: null, ...c },
  };
}

describe("categories", () => {
  it("authored category first, else People / Places / The story by what it is about", () => {
    expect(codexCategory({ category: "Evidence", aboutKind: "character" })).toBe("Evidence");
    expect(codexCategory({ aboutKind: "character" })).toBe("People");
    expect(codexCategory({ aboutKind: "location" })).toBe("Places");
    expect(codexCategory({ aboutKind: "topic" })).toBe("The story");
    expect(codexCategory({})).toBe("The story");
    expect(codexCategory({ category: "  " })).toBe("The story");
  });

  it("one row per entry (a re-share keeps the newest), groups in the order first learned, rows newest first", () => {
    const a = entry({ entry: "Sandy", about: "Sandy", aboutKind: "character" });
    const b = entry({ entry: "The Cold Door", category: "Evidence" });
    const c = entry({ entry: "Trabolta", about: "Trabolta", aboutKind: "character" });
    const again = entry({ entry: "Sandy", about: "Sandy", aboutKind: "character", via: "share", from: "Bo" });
    const rows = codexRows([a, b, c, again]);
    expect(rows.map((r) => r.card.entry)).toEqual(["Sandy", "Trabolta", "The Cold Door"]);
    const groups = codexGroups(rows);
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.card.entry)])).toEqual([
      ["People", ["Sandy", "Trabolta"]],
      ["Evidence", ["The Cold Door"]],
    ]);
    expect(codexSub(rows[0]!)).toBe("about Sandy · Shared by Bo");
  });

  it("the filter matches title, subject, category and text, folded", () => {
    const rows = codexRows([entry({ entry: "Mr_Pickles", about: "Sandy" }, "A cat."), entry({ entry: "The Cold Door", category: "Evidence" }, "Four digits.")]);
    expect(codexGroups(rows, "pickles").flatMap((g) => g.rows.map((r) => r.card.entry))).toEqual(["Mr_Pickles"]);
    expect(codexGroups(rows, "EVIDENCE")).toHaveLength(1);
    expect(codexGroups(rows, "digits")[0]!.rows[0]!.card.entry).toBe("The Cold Door");
    expect(codexGroups(rows, "nothing like it")).toEqual([]);
  });
});

describe("new until opened", () => {
  it("this device's first look flags every entry held (nothing opened yet); each stays new until opened", () => {
    const rows = codexRows([entry({ entry: "A" }), entry({ entry: "B" })]);
    expect([...newEntries(rows, null)].sort()).toEqual(["A", "B"]);
    const record = markSeen(rows, null, null);
    expect(record).toEqual([]);
    const more = codexRows([entry({ entry: "A" }), entry({ entry: "B" }), entry({ entry: "C" })]);
    expect([...newEntries(more, new Set(record))].sort()).toEqual(["A", "B", "C"]);
    const opened = markSeen(more, new Set(record), "C");
    expect(opened).toEqual(["C"]);
    expect([...newEntries(more, new Set(opened))].sort()).toEqual(["A", "B"]);
  });

  it("the room's NEW count agrees with what the badge counted: a first look after a big unlock flags all of it", () => {
    // The Truther Download: 45 entries at once, the Codex never opened on this device.
    const rows = codexRows(Array.from({ length: 45 }, (_, i) => entry({ entry: `E${i}` })));
    expect(newEntries(rows, null).size).toBe(45);
  });
});

describe("a first look at an empty Codex", () => {
  it("keeps an empty record, so every entry learned after it is NEW", () => {
    const record = markSeen([], null, null);
    expect(record).toEqual([]);
    const later = codexRows([entry({ entry: "Orientation" }), entry({ entry: "Hunt 1" }), entry({ entry: "Hunt 2" })]);
    expect([...newEntries(later, new Set(record))].sort()).toEqual(["Hunt 1", "Hunt 2", "Orientation"]);
  });
});

describe("the room", () => {
  const render = (messages: ChatMessage[], seen: string[] | null = null) =>
    renderToStaticMarkup(
      createElement(
        PlayHostContext.Provider,
        { value: { ...browserHost, storage: memoryStore(seen === null ? {} : { "loom.stream.codex-seen.g1": seen }) } },
        createElement(CodexRoom, { messages, meId: "g1", empty: "You know nothing yet." }),
      ),
    );

  it("rows collapsed by default: the title shows, the long text doesn't", () => {
    const html = render([entry({ entry: "Sandy", aboutKind: "character", about: "Sandy" }, "Sandy is the one who left.")]);
    expect(html).toContain("Sandy");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("the one who left");
    expect(html).toContain("People");
  });

  it("NEW on what you haven't opened; the filter box once there are a few", () => {
    const four = ["A", "B", "C", "D"].map((e) => entry({ entry: e }));
    const html = render(four, ["A", "B"]);
    expect(html.match(/class="stream-new"/gu)?.length).toBe(2);
    expect(html).toContain('type="search"');
    expect(render(four.slice(0, 2), [])).not.toContain('type="search"');
  });

  it("a first look (no record on this device) shows every row as New", () => {
    const html = render(["A", "B", "C"].map((e) => entry({ entry: e })));
    expect(html.match(/class="stream-new"/gu)?.length).toBe(3);
    expect(html).toContain("3 · 3 new");
  });

  it("empty: the room teaches what to do", () => {
    expect(render([])).toContain("You know nothing yet.");
  });

  it("a wrong code's answer shows when it is the newest thing", () => {
    const note: ChatMessage = { ...entry({ entry: "x" }), kind: "system", codex: undefined, text: "✖ No such code." };
    expect(render([entry({ entry: "A" }), note])).toContain("✖ No such code.");
    expect(render([note, entry({ entry: "A" })])).not.toContain("No such code");
  });
});
