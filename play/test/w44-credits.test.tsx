//! Wave 44 (C7): the phone's credits roll — when it opens by itself, the
//! Start item, the roll's fetch / rows / clock / pace, what it draws in each
//! state, and that it stays out of the guest's first load.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { creditsRollMs, creditsRows, creditsView, type CreditsView } from "../../core/src/credits.ts";
import { playerStartItems } from "../src/booth/header.tsx";
import { CREDITS_FRESH_MS, creditsDue, creditsKey, creditsShown, seenRollOf } from "../src/credits/credits-model.ts";
import { creditsStartItem, useCredits, type Credits } from "../src/credits/lazy.tsx";
import { CREDITS_COPY, CreditsBody, CreditsFrame, CreditsHost, CreditsRoll, type CreditsHostProps } from "../src/credits/roll.tsx";
import { creditsAnswer, creditsPath, fetchCredits, rollElapsed, rollOver, rollPause, rollPaused, rollPlan, rollResume, rollStart, rollToggle, rollY } from "../src/credits/roll-model.ts";
import { guestStartItems, type GuestStartInput } from "../src/guest/frame.tsx";
import { browserHost } from "../src/host.ts";
import { readBundledCss } from "./css.ts";
import { mountHooks } from "./hooks-harness.ts";

const noop = () => {};
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

const VIEW: CreditsView = creditsView(
  {
    title: "Trapped in the Internet",
    subtitle: "Halloween 2026",
    sections: [
      { heading: "Cast", people: [{ role: "Clippy", name: "Brooke" }, { role: "Norton", name: "" }] },
      { heading: "Starring the programs", programs: true },
      { heading: "Thanks", lines: ["Everyone who came."] },
    ],
    end: ["Thank you for playing."],
  },
  ["Winamp", "ICQ"],
  1,
);

describe("creditsDue: the roll opens the phone by itself only live", () => {
  const roll = { roll: 1, at: 100_000 };
  it("a rise seen live, within a minute of `at`, opens it", () => {
    expect(creditsDue(null, roll, 100_000, false, false, null)).toBe(true);
    expect(creditsDue(0, roll, 100_000 + CREDITS_FRESH_MS, false, false, null)).toBe(true);
    expect(creditsDue(1, { roll: 2, at: 500_000 }, 510_000, false, false, 1)).toBe(true);
  });
  it("never on the first view, embedded, with no clock or no roll", () => {
    expect(creditsDue(null, roll, 100_000, true, false, null)).toBe(false);
    expect(creditsDue(null, roll, 100_000, false, true, null)).toBe(false);
    expect(creditsDue(null, roll, undefined, false, false, null)).toBe(false);
    expect(creditsDue(null, undefined, 100_000, false, false, null)).toBe(false);
    expect(creditsDue(null, { roll: 0, at: 0 }, 100_000, false, false, null)).toBe(false);
  });
  it("never a stale or a future roll, never the same roll twice", () => {
    expect(creditsDue(null, roll, 100_001 + CREDITS_FRESH_MS, false, false, null)).toBe(false);
    expect(creditsDue(null, roll, 99_000, false, false, null)).toBe(false);
    expect(creditsDue(1, roll, 100_000, false, false, null)).toBe(false);
    // Remembered per event: this phone already opened roll 1.
    expect(creditsDue(0, roll, 100_000, false, false, 1)).toBe(false);
  });
  it("the stored roll reads back as a number or nothing", () => {
    expect(creditsKey("ev-1")).toBe("loom.credits.ev-1");
    expect(seenRollOf(2)).toBe(2);
    expect(seenRollOf("2")).toBeNull();
    expect(seenRollOf(null)).toBeNull();
    expect(seenRollOf(Number.NaN)).toBeNull();
  });
});

describe("creditsShown: it waits behind the pass, a `!!` takeover, the glitch, a face-to-face booth", () => {
  it("on screen only when open and nothing covers it", () => {
    expect(creditsShown(true, {})).toBe(true);
    expect(creditsShown(false, {})).toBe(false);
    for (const k of ["pass", "takeover", "glitch", "face"] as const) expect(creditsShown(true, { [k]: true }), k).toBe(false);
  });
});

describe("⊞ Start's 🎬 Credits", () => {
  const night = { roll: 1, at: 5_000 };
  it("only while the story has rolled them", () => {
    expect(creditsStartItem(undefined, noop)).toBeNull();
    expect(creditsStartItem({ roll: 0, at: 0 }, noop)).toBeNull();
    expect(creditsStartItem(night, noop)).toMatchObject({ id: "credits", icon: "🎬", label: "Credits" });
  });
  it("a guest's: after the story's buttons, before Sides & crews", () => {
    const input: GuestStartInput = {
      name: "Winamp",
      faction: null,
      interactions: [{ id: "bathroom_mode", label: "🚻 Bathroom Mode", who: "guest", description: null }],
      sides: true,
      people: true,
      credits: creditsStartItem(night, noop),
      open: { act: noop, sides: noop, people: noop, notifications: noop, help: noop, leave: noop },
    };
    expect(guestStartItems(input).map((i) => i.id)).toEqual(["act:bathroom_mode", "credits", "sides", "people", "notifications", "help", "leave"]);
    expect(guestStartItems({ ...input, credits: null }).map((i) => i.id)).not.toContain("credits");
  });
  it("a player booth's: first", () => {
    const base = { character: "Clippy", wake: { supported: false, on: false, toggle: noop }, embedded: false, onHelp: noop, onSheet: noop, onPeople: noop, onSignOut: noop };
    expect(playerStartItems({ ...base, credits: creditsStartItem(night, noop) }).map((i) => i.id)).toEqual(["credits", "help", "alerts", "people", "signout"]);
    expect(playerStartItems(base).map((i) => i.id)).toEqual(["help", "alerts", "people", "signout"]);
  });
  it("the guest app and the player booth wire it", () => {
    expect(src("guest/app.tsx")).toContain("credits: creditsStartItem(st.night?.credits, () => credits.set(Date.now()))");
    expect(src("booth/app.tsx")).toContain("credits: creditsStartItem(s.view?.night?.credits, () => credits.set(Date.now()))");
  });
});

describe("useCredits + CreditsHost: the open state and the auto-open", () => {
  it("useCredits keeps the roll of the first view with a clock (0: none yet)", () => {
    type P = { roll: number | undefined; clock: number | undefined };
    const h = mountHooks((p: P) => useCredits(p.roll, p.clock), { roll: undefined, clock: undefined } as P);
    expect(h.output).toMatchObject({ open: null, first: undefined });
    h.rerender({ roll: undefined, clock: 1_000 });
    expect(h.output).toMatchObject({ first: 0 });
    h.rerender({ roll: 1, clock: 2_000 });
    expect(h.output).toMatchObject({ first: 0 });
    h.act(() => (h.output as Credits).set(7));
    expect(h.output).toMatchObject({ open: 7 });
    const reload = mountHooks((p: P) => useCredits(p.roll, p.clock), { roll: 2, clock: 9_000 });
    expect(reload.output).toMatchObject({ first: 2 });
  });

  /** The host with a fake open state; returns what it set. */
  function host(over: Partial<CreditsHostProps> & { first?: number | undefined; open?: number | null } = {}) {
    const sets: Array<number | null> = [];
    const c: Credits = { open: over.open ?? null, first: "first" in over ? over.first : 0, set: (n) => void sets.push(n) };
    const props: CreditsHostProps = { c, credits: { roll: 1, at: 2_000 }, clock: 3_000, eventId: `ev-${Math.random()}`, token: "tok", auto: true, cover: {}, ...over };
    const h = mountHooks(CreditsHost, props);
    return { h, sets, props };
  }

  it("a live rise opens it once and remembers the roll per event", () => {
    const { sets, props } = host();
    expect(sets).toHaveLength(1);
    expect(typeof sets[0]).toBe("number");
    expect(browserHost.storage.load<number>(creditsKey(props.eventId))).toBe(1);
    // Another mount on the same event (a new sign-in on this page): already seen.
    expect(host({ eventId: props.eventId }).sets).toEqual([]);
  });
  it("a reload mid-roll, a stale roll, a phone that doesn't auto-open: shut", () => {
    expect(host({ first: 1 }).sets).toEqual([]);
    expect(host({ first: undefined }).sets).toEqual([]);
    expect(host({ clock: 2_001 + CREDITS_FRESH_MS }).sets).toEqual([]);
    expect(host({ auto: false }).sets).toEqual([]);
  });
  it("a second roll opens it again", () => {
    const { h, sets, props } = host();
    h.rerender({ ...props, credits: { roll: 2, at: 50_000 }, clock: 51_000 });
    expect(sets).toHaveLength(2);
  });
  it("open: the roll, out of sight behind the pass or a `!!` takeover; closed: nothing", () => {
    expect(host({ auto: false }).h.output).toBeNull();
    const open = host({ auto: false, open: 5 }).h.output as { type: unknown; props: { hidden: boolean }; key: string };
    expect(open.type).toBe(CreditsRoll);
    expect(open.key).toBe("5");
    expect(open.props.hidden).toBe(false);
    for (const cover of [{ pass: true }, { takeover: true }, { face: true }]) {
      expect((host({ auto: false, open: 5, cover }).h.output as { props: { hidden: boolean } }).props.hidden).toBe(true);
    }
  });
});

describe("the roll's fetch", () => {
  it("each answer → what it shows", () => {
    expect(creditsAnswer(200, VIEW)).toEqual({ kind: "ready", view: VIEW });
    expect(creditsAnswer(403, { error: "not_yet" })).toEqual({ kind: "unready", why: "not_yet" });
    expect(creditsAnswer(404, { error: "no_credits" })).toEqual({ kind: "unready", why: "no_credits" });
    expect(creditsAnswer(403, { error: "forbidden" })).toEqual({ kind: "unready", why: "offline" });
    expect(creditsAnswer(502, null)).toEqual({ kind: "unready", why: "offline" });
    expect(creditsAnswer(200, { nope: true })).toEqual({ kind: "unready", why: "offline" });
  });
  it("GET /e/<id>/api/credits with the session's token; a throw is offline", async () => {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const ok = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(VIEW), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchCredits("ev 1", "tok", ok)).toEqual({ kind: "ready", view: VIEW });
    expect(seen[0]!.url).toBe(creditsPath("ev 1"));
    expect(seen[0]!.url).toBe("/e/ev%201/api/credits");
    expect(seen[0]!.init).toMatchObject({ headers: { "x-loom-token": "tok" }, cache: "no-store" });
    const notYet = (async () => new Response(JSON.stringify({ error: "not_yet" }), { status: 403 })) as unknown as typeof fetch;
    expect(await fetchCredits("e", "t", notYet)).toEqual({ kind: "unready", why: "not_yet" });
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await fetchCredits("e", "t", down)).toEqual({ kind: "unready", why: "offline" });
  });
});

describe("the roll's rows, pace and clock", () => {
  it("core's rows at core's pace; the end lines held (the title when there are none)", () => {
    const plan = rollPlan(VIEW);
    expect(plan.rows).toEqual(creditsRows(VIEW));
    expect(plan.ms).toBe(creditsRollMs(plan.rows.length));
    expect(plan.end).toEqual(["Thank you for playing."]);
    expect(rollPlan({ ...VIEW, end: [] }).end).toEqual(["Trapped in the Internet"]);
    // The blank name is left out; the night's programs are listed.
    expect(plan.rows.filter((r) => r.kind === "person")).toEqual([{ kind: "person", role: "Clippy", name: "Brooke" }]);
    expect(plan.rows.filter((r) => r.kind === "line").map((r) => (r as { text: string }).text)).toEqual(["ICQ", "Winamp", "Everyone who came."]);
  });
  it("the rows rise from below the screen to above it at a steady pace", () => {
    expect(rollY(0, 20_000, 800, 1200)).toBe(800);
    expect(rollY(10_000, 20_000, 800, 1200)).toBe(-200);
    expect(rollY(20_000, 20_000, 800, 1200)).toBe(-1200);
    expect(rollY(99_000, 20_000, 800, 1200)).toBe(-1200);
    expect(rollY(-5, 20_000, 800, 1200)).toBe(800);
    expect(rollOver(19_999, 20_000)).toBe(false);
    expect(rollOver(20_000, 20_000)).toBe(true);
  });
  it("a tap pauses and goes on; paused time doesn't count", () => {
    let c = rollStart(1_000);
    expect(rollElapsed(c, 3_000)).toBe(2_000);
    c = rollToggle(c, 3_000);
    expect(rollPaused(c)).toBe(true);
    expect(rollElapsed(c, 60_000)).toBe(2_000);
    c = rollToggle(c, 60_000);
    expect(rollPaused(c)).toBe(false);
    expect(rollElapsed(c, 61_000)).toBe(3_000);
    // Idempotent pause / resume (hidden behind the pass while tap-paused).
    expect(rollPause(rollPause(c, 62_000), 63_000)).toEqual(rollPause(c, 62_000));
    expect(rollResume(c, 70_000)).toBe(c);
  });
});

describe("what the roll draws", () => {
  const html = (props: Parameters<typeof CreditsBody>[0]) => renderToStaticMarkup(createElement(CreditsBody, props));
  const plan = rollPlan(VIEW);
  it("loading, then the not-ready card for each reason", () => {
    expect(html({ load: { kind: "loading" }, plan: null, reduced: false, over: false, paused: false })).toContain(CREDITS_COPY.loading);
    for (const why of ["not_yet", "no_credits", "offline"] as const) {
      const out = html({ load: { kind: "unready", why }, plan: null, reduced: false, over: false, paused: false });
      expect(out).toContain("The credits aren&#x27;t ready");
      expect(out).toContain(CREDITS_COPY.why[why]);
    }
  });
  it("the roll: every row, and the tap hint (paused says so)", () => {
    const out = html({ load: { kind: "ready", view: VIEW }, plan, reduced: false, over: false, paused: false });
    expect(out).toContain('class="credits-stage"');
    expect(out).toContain('<h1 class="credits-title">Trapped in the Internet</h1>');
    expect(out).toContain('<span class="credits-role">Clippy</span><span class="credits-name">Brooke</span>');
    expect(out).toContain("Winamp");
    expect(out).not.toContain("Thank you for playing.");
    expect(out).toContain(CREDITS_COPY.tap);
    expect(html({ load: { kind: "ready", view: VIEW }, plan, reduced: false, over: false, paused: true })).toContain(CREDITS_COPY.paused);
  });
  it("then the end lines held; reduced motion: one list with the end at its foot", () => {
    const end = html({ load: { kind: "ready", view: VIEW }, plan, reduced: false, over: true, paused: false });
    expect(end).toContain('class="credits-end"');
    expect(end).toContain("Thank you for playing.");
    expect(end).not.toContain("Brooke");
    const list = html({ load: { kind: "ready", view: VIEW }, plan, reduced: true, over: false, paused: false });
    expect(list).toContain('class="credits-list"');
    expect(list).not.toContain("credits-stage");
    expect(list.indexOf("Brooke")).toBeLessThan(list.indexOf("Thank you for playing."));
  });
  it("the frame: a dialog with its ✕, out of sight while it waits", () => {
    const out = renderToStaticMarkup(createElement(CreditsFrame, { onClose: noop, children: "x" }));
    expect(out).toContain('role="dialog"');
    expect(out).toContain(`aria-label="${CREDITS_COPY.close}"`);
    expect(out).not.toContain("hidden");
    expect(renderToStaticMarkup(createElement(CreditsFrame, { hidden: true, onClose: noop, children: "x" }))).toContain("hidden");
  });
});

describe("the roll stays out of the guest's first load", () => {
  it("only the slot, the hook and the Start item are eager; the roll and its model are a dynamic import", () => {
    for (const f of ["guest/app.tsx", "booth/app.tsx", "guest/frame.tsx", "credits/lazy.tsx"]) {
      expect(src(f), f).not.toMatch(/^import (?!type )[^;]*from "[./]*(credits\/)?(roll|roll-model|credits-model)\.tsx?"/mu);
      expect(src(f), f).not.toMatch(/^import (?!type )[^;]*core\/src\/credits\.ts"/mu);
    }
    expect(src("credits/lazy.tsx")).toContain('import("./roll.tsx")');
  });
  it("the ✕ is a 44 px target; the roll sits over the taskbar and under the pass", () => {
    const css = readBundledCss();
    const x = /\.credits-x \{([^}]*)\}/u.exec(css)![1]!;
    expect(x).toContain("min-width: var(--tap)");
    expect(x).toContain("min-height: var(--tap)");
    const roll = /\.credits-roll \{([^}]*)\}/u.exec(css)![1]!;
    expect(roll).toContain("z-index: calc(var(--z-pass) - 2)");
    expect(css).toContain(".credits-roll[hidden] { display: none; }");
    expect(css).toMatch(/\.guest-frame > \.taskbar \{ z-index: 42; \}/u);
  });
});
