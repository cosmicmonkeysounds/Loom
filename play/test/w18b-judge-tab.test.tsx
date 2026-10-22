//! Wave 18b (O4, D10): the host Judge tab once Trabolta rules every filing
//! that isn't an exact match — the auto label, the empty state, "🤖 N with
//! Trabolta" in the header, queued vs asking, and a plain miss (no ⚠ near).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { hostCalls } from "../src/host/api.ts";
import { HostContext, type HostCtx } from "../src/host/kit.tsx";
import { JudgeTab, judgeEmptyText, judgeHead, judgeModeOptions, rulingWaitText, withJudge } from "../src/host/tab-judge.tsx";
import type { HostJudging, HostView } from "../src/types.ts";
import { hostFixture } from "./host-fixture.ts";

type Row = HostJudging["pending"][number];
const row = (extra: Partial<Row>): Row => ({ person: "g1", name: "Ada", question: "Q1", answer: "Mr Pickels", confidence: 100, proposed: "accurate", final: null, at: 10, near: null, asking: false, ruling: null, ...extra });

function render(judging: HostJudging): string {
  const view: HostView = { ...hostFixture(), judging };
  const ctx: HostCtx = {
    view,
    calls: hostCalls(async () => ({}), () => view.alerts.path),
    session: { auth: { token: "t", character: "Task Manager", admin: false, host: true, eventId: "e" }, messages: new Map() } as unknown as HostCtx["session"],
    now: 0,
    run: async () => true,
    go: () => {},
    openRoom: () => {},
    openCard: () => {},
  };
  return renderToStaticMarkup(createElement(HostContext.Provider, { value: ctx }, createElement(JudgeTab)));
}

describe("the Judge tab with Trabolta judging (O4)", () => {
  const base: HostJudging = { mode: "auto", judge: "Trabolta", confirm: { accurate: "a", lie: "l", uncertain: "u" }, pending: [], near: 0, recent: [] };

  it("the auto label says the house takes exact matches and he rules the rest", () => {
    expect(judgeModeOptions("Trabolta")[0]!.label).toBe("Auto: the house accepts exact matches, Trabolta rules the rest; what he can't rule waits here");
    expect(judgeModeOptions(null)[0]!.label).toBe("Auto: the house judges; near misses wait here");
    expect(render(base)).toContain("Auto: the house accepts exact matches, Trabolta rules the rest; what he can&#x27;t rule waits here");
  });

  it("the empty state no longer says only a near miss waits", () => {
    expect(judgeEmptyText(base)).toBe("Nothing to judge. Trabolta rules every answer that isn't an exact match; judge only what he couldn't, before 📋.");
    expect(judgeEmptyText(base)).not.toMatch(/only a near miss/u);
    expect(judgeEmptyText({ ...base, mode: "review" })).toBe("Nothing to review.");
    // With no judge: the wave 11 rule (a near miss waits).
    expect(judgeEmptyText({ ...base, judge: null })).toMatch(/only a near miss waits here/u);
  });

  it("the header counts what is with him, queued or out", () => {
    const j: HostJudging = { ...base, near: 1, pending: [row({ asking: true }), row({ person: "g2", asking: true, queued: true }), row({ person: "g3", asking: true, queued: true }), row({ person: "g4", near: "Mr. Pickles" })] };
    expect(withJudge(j)).toEqual({ asking: 1, queued: 2 });
    expect(judgeHead(j)).toBe("auto · judge Trabolta · 🤖 3 with Trabolta (2 queued) · ⚠ 1 near");
    expect(judgeHead(base)).toBe("auto · judge Trabolta");
  });

  it("a queued ruling reads queued, an out one asking; a plain miss has no ⚠ near line", () => {
    expect(rulingWaitText({ queued: true }, "Trabolta")).toBe("🤖 queued for Trabolta");
    expect(rulingWaitText({}, "Trabolta")).toBe("🤖 asking Trabolta…");
    const html = render({ ...base, pending: [row({ answer: "Garfield", confidence: 80, proposed: "uncertain", asking: true, queued: true })] });
    expect(html).toContain("“Garfield” · 80%");
    expect(html).toContain("🤖 queued for Trabolta");
    expect(html).not.toContain("host-filing-near");
    expect(html).toContain("proposed: uncertain");
    // A near miss still shows its ⚠ line.
    expect(render({ ...base, near: 1, pending: [row({ near: "Mr. Pickles", asking: true })] })).toContain("⚠ near “Mr. Pickles”");
  });
});
