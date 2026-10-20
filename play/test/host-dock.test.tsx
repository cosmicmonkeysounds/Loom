//! The host dock itself rendered (wave 13): the NEXT bar off an injected
//! client — its accessible name, the keyboard rule, a stale view, the
//! loading line — and the bar and the Cues tab reading one desk (an arm made
//! in one shows in the other; FIRE locked while a press is out). The play
//! workspace has no DOM for clicks, so the taps themselves are core's
//! `tapCue` (host-next.test.ts); here is everything the taps change.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cueRows } from "../../core/src/cue-sheet.ts";
import { CuePicker, nextBar, sheetLayout, type CueDesk } from "../src/director.tsx";
import { hostCalls } from "../src/host/api.ts";
import type { HostClient } from "../src/host/client.ts";
import { HostDock, HostNextBar, awardPrefill } from "../src/host/dock.tsx";
import { HostContext, type HostCtx } from "../src/host/kit.tsx";
import { barLine, hostStrip } from "../src/host/model.ts";
import { CuesTab } from "../src/host/tab-cues.tsx";
import type { HostView } from "../src/types.ts";
import { hostFixture } from "./host-fixture.ts";

const auth = { token: "t", character: "Task Manager", admin: false, host: true, eventId: "e" };
const session = { auth, messages: new Map(), view: null, threads: { open: () => {} } } as unknown as Parameters<typeof HostDock>[0]["session"];

function client(view: HostView | null, over: Partial<HostClient> = {}): HostClient {
  return { view, receivedAt: 1_000, error: null, connected: true, refresh: () => {}, fresh: async () => {}, calls: view === null ? null : hostCalls(async () => ({}), () => view.alerts.path), ...over };
}

function dock(c: HostClient, keyboardOpen = false): string {
  return renderToStaticMarkup(createElement(HostDock, { session, wide: false, openCard: () => {}, client: c, keyboardOpen }));
}

/** The bar main button's markup (its accessible name is its text). */
function barMain(html: string): string {
  return html.match(/<button[^>]*class="host-bar-main"[^>]*>([\s\S]*?)<\/button>/u)?.[0] ?? "";
}

function stubDesk(over: Partial<CueDesk> = {}): CueDesk {
  return {
    armed: null,
    pending: null,
    cooling: false,
    toast: null,
    setToast: () => {},
    picking: null,
    value: "",
    setValue: () => {},
    subjectName: null,
    tap: () => {},
    pick: () => {},
    closePicker: () => {},
    locked: () => false,
    ...over,
  };
}

describe("the NEXT bar in the dock", () => {
  it("names the cue to a screen reader: the bar has no aria-label over its text", () => {
    const html = dock(client(hostFixture()));
    const main = barMain(html);
    expect(main).not.toContain("aria-label");
    expect(main).toContain("Open the host console.");
    expect(main).toContain("NEXT");
    expect(main).toContain("Call everyone to the Desktop");
    expect(html).toMatch(/data-testid="host-fire"[^>]*>ARM</u);
  });
  it("is gone while the keyboard is open in the room", () => {
    expect(dock(client(hostFixture()), true)).toBe("");
  });
  it("says the view is old when the poll fails, and dims FIRE", () => {
    const html = dock(client(hostFixture(), { connected: false, error: "This booth isn't a host any more." }));
    expect(html).toContain("⚠ Last update");
    expect(html).toContain(" · This booth isn&#x27;t a host any more.");
    expect(html).toMatch(/class="host-fire[^"]*stale/u);
    expect(html).toMatch(/class="host-bar [^"]*stale/u);
  });
  it("before the first view: the error, else Loading", () => {
    expect(dock(client(null))).toContain("Loading the cue sheet…");
    expect(dock(client(null, { error: "Can't reach the server" }))).toContain("Can&#x27;t reach the server");
  });
});

describe("one desk for the bar and the Cues tab", () => {
  const v = hostFixture();
  const rows = cueRows(v.interactions, v.cues);
  const bar = nextBar(rows, v.countdowns, 0);
  const strip = hostStrip(v, sheetLayout(rows), 0, 0);
  const base = { toast: null, connected: true, error: null, receivedAt: 0, now: 0, subjectName: null, refused: null, reason: null };
  const ctx: HostCtx = { view: v, calls: hostCalls(async () => ({}), () => v.alerts.path), session, now: 0, run: async () => true, go: () => {}, openRoom: () => {}, openCard: () => {} };
  const both = (desk: CueDesk) => {
    const armed = desk.armed !== null;
    const barHtml = renderToStaticMarkup(createElement(HostNextBar, { bar, desk, open: false, stale: false, line2: barLine({ ...base, armed }), strip, onToggle: () => {} }));
    const cues = renderToStaticMarkup(createElement(HostContext.Provider, { value: ctx }, createElement(CuesTab, { rows, layout: sheetLayout(rows), desk, mineLast: false })));
    return { barHtml, cues };
  };

  it("an arm made in the Cues tab is ARMED on the bar, and FIRE fires it", () => {
    const { barHtml, cues } = both(stubDesk({ armed: { id: "call_everyone", subject: null, at: 0 } }));
    expect(barHtml).toContain("ARMED");
    expect(barHtml).toMatch(/aria-label="Fire C1"[^>]*>FIRE</u);
    expect(barHtml).toContain("Tap FIRE within 4 s to fire");
    expect(cues).toContain("Tap again to fire");
  });
  it("nothing armed: NEXT and ARM on the bar, no armed row in Cues", () => {
    const { barHtml, cues } = both(stubDesk());
    expect(barHtml).toMatch(/>ARM</u);
    expect(cues).not.toContain("Tap again to fire");
  });
  it("while a press is out FIRE is disabled and says Sending…, and so is the row", () => {
    const { barHtml, cues } = both(stubDesk({ pending: "call_everyone", locked: () => true }));
    expect(barHtml).toMatch(/data-testid="host-fire" disabled=""[^>]*aria-busy="true"[^>]*>Sending…</u);
    expect(cues).toContain("Sending…");
  });
});

describe("PICK on an award fills its value from the recap", () => {
  const sug = { value: "4" };
  it("once per opening, and never over a value already typed", () => {
    expect(awardPrefill("award_best_liar", null, sug, "")).toBe("4");
    expect(awardPrefill("award_best_liar", "award_best_liar", sug, "")).toBeNull();
    expect(awardPrefill("award_best_liar", null, sug, "7")).toBeNull();
    expect(awardPrefill("award_best_liar", null, null, "")).toBeNull();
    expect(awardPrefill(null, "award_best_liar", sug, "")).toBeNull();
    // Closed and opened again: filled again.
    expect(awardPrefill("award_best_liar", null, sug, "")).toBe("4");
  });
});

describe("the award picker", () => {
  it("the suggestion's reason gets its own line; the suggested row reads only \"suggested\"", () => {
    const row = { id: "award_most_trusted", code: "G2", title: "Award: Most Trusted", subject: true } as unknown as NonNullable<CueDesk["picking"]>;
    const roster = [{ id: "g1", name: "LimeWire", faction: null }, { id: "g2", name: "Calculator", faction: null }] as unknown as Parameters<typeof CuePicker>[0]["roster"];
    const html = renderToStaticMarkup(createElement(CuePicker, { desk: stubDesk({ picking: row }), roster, suggest: { id: "g1", hint: "suggested: LimeWire (20) · tied: Calculator" } }));
    expect(html).toMatch(/<p class="pick-hint cue-suggest">suggested: LimeWire \(20\) · tied: Calculator<\/p>/u);
    expect(html).toMatch(/LimeWire<\/span><span class="pick-sub">suggested<\/span>/u);
    // The hint comes before the value box and the list.
    expect(html.indexOf("cue-suggest")).toBeLessThan(html.indexOf("cue-value"));
  });
});
