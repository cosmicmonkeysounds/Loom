//! The host drawer's tabs rendered (wave 13): what a host sees off a
//! fixture host view — the judge queue's verdict buttons, the folded needs,
//! More's sections only when the event has them, and no dock for a booth
//! that isn't a host.

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HostDock, fireLabel, isHostBooth } from "../src/host/dock.tsx";
import { HostContext, type HostCtx } from "../src/host/kit.tsx";
import { JudgeTab } from "../src/host/tab-judge.tsx";
import { MoreTab } from "../src/host/tab-more.tsx";
import { NeedsTab } from "../src/host/tab-needs.tsx";
import { PeopleTab } from "../src/host/tab-people.tsx";
import { hostCalls } from "../src/host/api.ts";
import type { HostView } from "../src/types.ts";
import { hostFixture } from "./host-fixture.ts";

function inDrawer(view: HostView, el: ReactElement): string {
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
  return renderToStaticMarkup(createElement(HostContext.Provider, { value: ctx }, el));
}

describe("the host dock", () => {
  it("renders nothing for a booth that isn't a host", () => {
    expect(isHostBooth({ auth: { token: "t", character: "Norton", admin: false, host: false, eventId: "e" } })).toBe(false);
    expect(isHostBooth({ auth: { token: "t", character: "Task Manager", admin: false, host: true, eventId: "e" } })).toBe(true);
    expect(isHostBooth({ auth: { token: "t", character: "Norton", admin: true, eventId: "e" } })).toBe(true);
    expect(HostDock({ session: { auth: { token: "t", character: "Norton", admin: false, host: false, eventId: "e" } } as never, wide: false, openCard: () => {} })).toBeNull();
  });
  it("ARM, then FIRE; a subject cue picks first", () => {
    expect(fireLabel(false, false, false)).toBe("ARM");
    expect(fireLabel(true, false, false)).toBe("FIRE");
    expect(fireLabel(false, false, true)).toBe("PICK");
    expect(fireLabel(true, true, false)).toBe("Sending…");
  });
});

describe("the tabs", () => {
  it("Judge: a near miss with its key and ✅ 😤 🤷, the proposal pressed", () => {
    const out = inDrawer(hostFixture(), createElement(JudgeTab));
    expect(out).toContain("auto · judge Trabolta · ⚠ 1 near");
    expect(out).toContain("⚠ near “Mr. Pickles”");
    expect(out).toContain("“Mr Pickels” · 100%");
    expect(out).toContain("✅ accurate");
    expect(out).toContain("😤 confident lie");
    expect(out).toContain("🤷 uncertain");
    expect(out).toMatch(/aria-pressed="true"[^>]*><span class="host-radio" aria-hidden="true"><\/span>✅ accurate/u);
  });
  it("Needs: the rows, each a button to where it is handled", () => {
    const out = inDrawer(hostFixture(), createElement(NeedsTab, { refused: null, reason: null }));
    expect(out).toContain("💰 1 held transfer");
    expect(out).toContain("🤖 Trabolta: no worker");
    const empty = inDrawer(hostFixture({ needs: [] }), createElement(NeedsTab, { refused: null, reason: null }));
    expect(empty).toContain("Nothing needs you.");
    const refused = inDrawer(hostFixture({ needs: [] }), createElement(NeedsTab, { refused: { id: "x", what: "🍾", at: 0, afterSeq: 0 }, reason: "🍾 waits for the results" }));
    expect(refused).toContain("✕ 🍾 not taken — 🍾 waits for the results");
    expect(refused).toContain("Open # hosts");
  });
  it("People: every guest online with their state; the offline sit behind one switch, off (wave 59)", () => {
    const out = inDrawer(hostFixture(), createElement(PeopleTab));
    expect(out).toContain("Find a guest (1)");
    expect(out).toContain("🚻 bathroom");
    expect(out).not.toContain("Bob");
    expect(out).toMatch(/<input type="checkbox"\/> Offline \(1\)/u);
    const everyone = hostFixture();
    const both = inDrawer({ ...everyone, people: everyone.people.map((p) => ({ ...p, online: true })) }, createElement(PeopleTab));
    expect(both).toContain("Find a guest (2)");
    expect(both).toContain("⛔ restricted");
    expect(both).not.toContain("Offline");
  });
  it("More: every section the event has, nothing it hasn't; no mod passcode anywhere", () => {
    // Wave 18 splits More in three (Night · House · Setup): a deep link opens
    // each tab, so the three together are the whole of More.
    const allTabs = (v: HostView) => (["alerts", "wallet", "codes"] as const).map((f) => inDrawer(v, createElement(MoreTab, { focus: f }))).join("\n");
    const full = allTabs(hostFixture());
    for (const s of ["announce", "alerts", "wallet", "king", "terminals", "codes", "parts", "agents-trabolta"]) expect(full).toContain(`data-section="${s}"`);
    expect(full).toContain("Ada → Bob · 20");
    expect(full).toContain("15 / 15");
    expect(full).toContain("🔴 Server Door");
    // Two agent-voiced characters: two sections, two ids, no duplicate.
    const two = inDrawer(hostFixture({ agents: [{ id: "Trabolta", online: true, queue: null, waiting: [] }, { id: "Clippy Mind", online: false, queue: null, waiting: [] }] }), createElement(MoreTab, { focus: "agents" }));
    expect(two).toContain('id="host-agents-trabolta"');
    expect(two).toContain('id="host-agents-clippy-mind"');
    expect(two.match(/id="host-agents/gu)).toHaveLength(2);
    expect(full).toContain("“Are you there?”");
    expect(full).toContain('role="radio" aria-checked="true"');
    const bare = allTabs(hostFixture({ wallet: null, king: null, terminals: null, parts: [], agents: [] }));
    for (const s of ["wallet", "king", "terminals", "parts", "agents"]) expect(bare).not.toContain(`data-section="${s}`);
    expect(full).not.toMatch(/restart|go live|push draft|end the run/iu);
  });
  it("More opens on Night once the doors are open, Setup before; each tab lists only its own", () => {
    const night = inDrawer(hostFixture(), createElement(MoreTab, { focus: null }));
    expect(night).toMatch(/aria-selected="true"[^>]*>Night</u);
    for (const s of ["show", "clock", "announce", "alerts"]) expect(night).toContain(`data-section="${s}"`);
    for (const s of ["wallet", "codes", "parts"]) expect(night).not.toContain(`data-section="${s}"`);
    const before = inDrawer(hostFixture({ runtime: "idle", doorsClosed: true }), createElement(MoreTab, { focus: null }));
    expect(before).toMatch(/aria-selected="true"[^>]*>Setup</u);
    expect(before).toContain('data-section="codes"');
    expect(before).not.toContain('data-section="show"');
    const house = inDrawer(hostFixture(), createElement(MoreTab, { focus: "terminals" }));
    expect(house).toMatch(/aria-selected="true"[^>]*>House</u);
    for (const s of ["wallet", "king", "terminals", "agents-trabolta"]) expect(house).toContain(`data-section="${s}"`);
  });
  it("Judge: auto ⇄ review, the view's mode pressed", () => {
    const auto = inDrawer(hostFixture(), createElement(JudgeTab));
    expect(auto).toContain('data-section="judge-mode"');
    expect(auto).toMatch(/aria-pressed="true"[^>]*>[\s\S]{0,120}Auto: the house accepts exact matches, Trabolta rules the rest; what he can&#x27;t rule waits here/u);
    const review = inDrawer(hostFixture({ judging: { ...hostFixture().judging!, mode: "review" } }), createElement(JudgeTab));
    expect(review).toMatch(/aria-pressed="true"[^>]*>[\s\S]{0,120}Review: every filing waits for a host/u);
  });
  it("Needs: escorts waiting lead, read-only (no claim buttons)", () => {
    const wanted = [
      { id: "g1", name: "Napster", reason: "filed a guess", location: "The Cloud", lastSeen: 0, markedAt: 2, claimedBy: null, captured: false },
      { id: "g2", name: "ICQ", reason: null, location: "The Tube", lastSeen: 0, markedAt: 1, claimedBy: "McAfee Anti-Virus", captured: false },
      { id: "g3", name: "Encarta", reason: null, location: null, lastSeen: 0, markedAt: 0, claimedBy: "Norton", captured: true },
    ];
    const out = inDrawer({ ...hostFixture(), wanted } as HostView, createElement(NeedsTab, { refused: null, reason: null }));
    expect(out.indexOf("🚨 2 marked · 1 nobody on it")).toBeGreaterThan(-1);
    expect(out.indexOf("🚨 2 marked")).toBeLessThan(out.indexOf("💰 1 held transfer"));
    expect(out).not.toMatch(/I&#x27;ll get them|Take over|Hand it back/u);
    const none = inDrawer({ ...hostFixture({ needs: [] }), wanted: [wanted[2]] } as HostView, createElement(NeedsTab, { refused: null, reason: null }));
    expect(none).toContain("Nothing needs you.");
  });
});
