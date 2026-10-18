//! The director's phone cue sheet (W-26): rows off the mod view (core's
//! `cue-sheet.ts`, shared with the editor), arm-then-fire, a subject cue
//! asks for a person first, and the 3 s poll parks while the page is hidden.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { searchHelp } from "../../docs/help/helpdoc.ts";
import { articlesFor } from "../src/help.tsx";

import { ApiError } from "../src/client.ts";
import { cueSheetView } from "../../core/src/cue-sheet.ts";
import {
  ARM_DEAD_MS,
  ARM_MS,
  DIRECTOR_KEY,
  armFor,
  directorFromSearch,
  directorRows,
  fireCue,
  fireToast,
  takesValue,
  initialRole,
  nextBar,
  nextBarText,
  phoneLabel,
  phoneTap,
  sheetLayout,
  foldedLine,
  formatLeft,
  storyNow,
  stripItems,
  clockRuns,
  STOPPED,
  cueLocked,
  viewLatch,
  armWarnings,
  cueRowClass,
  fromAct,
  disarmOnLeave,
  NEXT_COOLDOWN_MS,
  STALE_TOAST,
  pollDelay,
  pollOutcome,
  roleForBrand,
  signalBody,
  startPoll,
  subjectChoices,
  tapCue,
  type DirectorView,
  type FirePost,
  type PollDeps,
} from "../src/director.tsx";

const VIEW: DirectorView = {
  title: "Trapped",
  interactions: [
    { id: "call_to_the_desktop", label: "C1/V1 · 📣 Call everyone to the Desktop", who: "admin" },
    { id: "accuse", label: "👁 Put on the watchlist", who: "performer" },
    { id: "start_the_bingo", label: "V2 · 🎱 Start Computer Bingo", who: "admin" },
    { id: "the golden duck", label: "🦆 Duck found", who: "admin", sequence: false },
    { id: "award_most_trusted", label: "🏆 Most Trusted", who: "admin", subject: true },
  ],
  cues: { last: "call_to_the_desktop", lastBy: "director", fired: ["call_to_the_desktop"] } as DirectorView["cues"],
  world: [{ path: "Night.phase", value: '"desktop"' }],
  roster: [
    { id: "p1", name: "Zed", location: null, owner: "Ana" },
    { id: "g2", name: "Bob", location: "The Desktop", owner: null },
    { id: "g1", name: "Ada", location: null, owner: null },
  ],
};

describe("directorRows", () => {
  it("lists only the admin cues, marked LAST / NEXT / fired", () => {
    const rows = directorRows(VIEW);
    expect(rows.map((r) => r.id)).toEqual(["call_to_the_desktop", "start_the_bingo", "the golden duck", "award_most_trusted"]);
    expect(rows[0]).toMatchObject({ code: "C1/V1", last: true, fired: true, next: false });
    expect(rows[1]).toMatchObject({ code: "V2", next: true });
    expect(rows[2]!.sequence).toBe(false);
    expect(rows[3]!.subject).toBe(true);
  });

  it("is empty before the story loads, and tolerates a view without cues", () => {
    expect(directorRows(null)).toEqual([]);
    const rows = directorRows({ interactions: VIEW.interactions });
    expect(rows.some((r) => r.last || r.fired)).toBe(false);
    expect(rows[0]!.next).toBe(true);
  });
});

describe("arm, then fire", () => {
  const rows = directorRows(VIEW);
  const bingo = rows[1]!;
  const award = rows[3]!;

  it("the first tap arms, a second tap in time fires", () => {
    const first = tapCue(null, bingo, 1000);
    expect(first.kind).toBe("arm");
    if (first.kind !== "arm") return;
    expect(tapCue(first.armed, bingo, 1000 + ARM_MS - 1)).toEqual({ kind: "fire", id: "start_the_bingo", subject: null });
  });

  it("a late second tap, or a tap on another cue, only re-arms", () => {
    const armed = { id: "start_the_bingo", subject: null, at: 0 };
    expect(tapCue(armed, bingo, ARM_MS).kind).toBe("arm");
    const other = tapCue(armed, rows[0]!, 10);
    expect(other).toEqual({ kind: "arm", armed: { id: "call_to_the_desktop", subject: null, at: 10 } });
  });

  it("a subject cue asks for a person first, then fires with them", () => {
    expect(tapCue(null, award, 0)).toEqual({ kind: "pick", id: "award_most_trusted" });
    const armed = armFor("award_most_trusted", "g1", 50);
    // Inside the dead time a second tap does nothing; from 300 ms on it fires.
    expect(tapCue(armed, award, 100)).toEqual({ kind: "ignore" });
    expect(tapCue(armed, award, 50 + ARM_DEAD_MS)).toEqual({ kind: "fire", id: "award_most_trusted", subject: "g1" });
    // A value typed in the picker is armed with the person and fired with them.
    const valued = armFor("award_most_trusted", "g1", 50, " 4 ");
    expect(valued.value).toBe("4");
    expect(tapCue(valued, award, 400)).toEqual({ kind: "fire", id: "award_most_trusted", subject: "g1", value: "4" });
    expect(armFor("award_most_trusted", "g1", 50, "  ")).not.toHaveProperty("value");
    // the arm lapses: the next tap asks again
    expect(tapCue(armed, award, 50 + ARM_MS).kind).toBe("pick");
  });

  it("posts the cue with the phone's label (and the person, if any)", () => {
    expect(signalBody("start_the_bingo", null, "Ana")).toEqual({ name: "start_the_bingo", label: "Phone · Ana" });
    expect(signalBody("award_most_trusted", "g1", " ")).toEqual({ name: "award_most_trusted", subject: "g1", label: "Phone" });
    // T2-09: an award's value box rides as args (the editor's cueValueArgs rule).
    expect(signalBody("award_best_liar", "g1", "Ana", "3")).toEqual({ name: "award_best_liar", subject: "g1", label: "Phone · Ana", args: { value: 3 } });
    expect(signalBody("award_duck_speedrun", "g1", "Ana", " 2:41 ").args).toEqual({ value: "2:41" });
    expect(signalBody("award_best_liar", "g1", "Ana", "  ")).not.toHaveProperty("args");
    expect(signalBody("award_best_liar", "g1", "Ana")).not.toHaveProperty("args");
    expect(phoneLabel("x".repeat(80)).length).toBe(60);
  });

  it("names the people a subject cue can pick, real guests before personas", () => {
    const items = subjectChoices(VIEW.roster);
    expect(items.map((i) => i.label)).toEqual(["Ada", "Bob", "Zed"]);
    expect(items[1]!.sub).toBe("The Desktop");
    expect(items[2]!.sub).toBe("persona");
  });

  it("toasts the outcome, with a doors-closed refusal spelled out", () => {
    expect(fireToast(bingo, { ok: true })).toBe("✓ Fired V2");
    expect(fireToast(bingo, { ok: true, refused: true })).toBe("Not taken — V2 doesn't apply right now (# hosts says why)");
    expect(fireToast(bingo, { ok: false, status: 409, message: "no scenario loaded" })).toBe("Not fired — no scenario loaded");
    expect(fireToast(rows[2]!, { ok: false, status: 500, message: "boom" })).toBe("🦆 Duck found failed: boom");
    // no HTTP answer: it may have fired — never "failed"
    expect(fireToast(bingo, { ok: false, status: 0, message: "Load failed" })).toBe("Not sure V2 fired — check the sheet before firing again");
  });

  it("G11's first press (the 30-second ask) reads Not taken and leaves the row unticked", async () => {
    // The show's label; the server answers the ask {ok, refused} (core's
    // trapped-w9-cues test pins that answer over HTTP).
    const view: DirectorView = {
      ...VIEW,
      interactions: [{ id: "award_most_trusted", label: "G2 · 🏆 Most Trusted", who: "admin", subject: true }, { id: "resurrection", label: "G11 · 🎃 Resurrection: the show is over, out of character (after the ceremony)", who: "admin" }],
      cues: { last: "award_most_trusted", lastBy: "Phone · Ana", fired: ["award_most_trusted"] } as DirectorView["cues"],
    };
    const g11 = directorRows(view).find((r) => r.id === "resurrection")!;
    expect(g11).toMatchObject({ code: "G11", fired: false, last: false });
    const outcome = await fireCue(async () => ({ ok: true, refused: true }), signalBody("resurrection", null, "Ana"), () => {});
    expect(outcome).toEqual({ ok: true, refused: true });
    expect(fireToast(g11, outcome)).toBe("Not taken — G11 doesn't apply right now (# hosts says why)");
  });
});

describe("fireCue", () => {
  const body = signalBody("start_the_bingo", null, "Ana");

  it("a fire re-polls at once, on success and on failure alike", async () => {
    let repolls = 0;
    const ok = await fireCue(async () => {}, body, () => repolls++);
    expect(ok).toEqual({ ok: true });
    expect(repolls).toBe(1);
    const refused = await fireCue(() => Promise.reject(new ApiError("no scenario loaded", 409)), body, () => repolls++);
    expect(refused).toEqual({ ok: false, status: 409, message: "no scenario loaded" });
    const dropped = await fireCue(() => Promise.reject(new TypeError("Load failed")), body, () => repolls++);
    expect(dropped).toEqual({ ok: false, status: 0, message: "Load failed" });
    expect(repolls).toBe(3);
    // The story turned the press down: taken by the server, not fired.
    expect(await fireCue(async () => ({ refused: true }), body, () => repolls++)).toEqual({ ok: true, refused: true });
    expect(await fireCue(async () => ({ refused: false }), body, () => repolls++)).toEqual({ ok: true });
  });

  it("a stalled POST is abandoned after the timeout as 'no answer'", async () => {
    let repolls = 0;
    const hang: FirePost = (_b, signal) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    const out = await fireCue(hang, body, () => repolls++, 20);
    expect(out).toEqual({ ok: false, status: 0, message: "no answer" });
    expect(repolls).toBe(1);
  });
});

describe("pollOutcome", () => {
  it("a 200 is the view; a dead token or an ended event drops the sign-in", () => {
    expect(pollOutcome(200, { title: "T" })).toEqual({ kind: "view", view: { title: "T" } });
    expect(pollOutcome(403, { error: "moderators only" })).toMatchObject({ kind: "drop", notice: expect.stringContaining("sign in again") });
    expect(pollOutcome(404, { error: "unknown event" })).toEqual({ kind: "drop", notice: "That event has ended." });
  });

  it("anything else keeps the sign-in and retries", () => {
    expect(pollOutcome(502, {})).toEqual({ kind: "retry", message: "HTTP 502" });
    expect(pollOutcome(404, { error: "not found" })).toEqual({ kind: "retry", message: "not found" });
  });
});

describe("the poll", () => {
  /** A fake clock + page: timers run on `advance`, visibility on `show`/`hide`. */
  function fakePage() {
    let hidden = false;
    let now = 0;
    const timers: Array<{ at: number; fn: () => void; id: number }> = [];
    let nextId = 1;
    let vis: (() => void) | null = null;
    let online: (() => void) | null = null;
    let loads = 0;
    let fail = false;
    const deps: PollDeps = {
      load: () => {
        loads++;
        return fail ? Promise.reject(new Error("down")) : Promise.resolve();
      },
      hidden: () => hidden,
      setTimer: (fn, ms) => {
        const t = { at: now + ms, fn, id: nextId++ };
        timers.push(t);
        return t.id;
      },
      clearTimer: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
      onVisibility: (fn) => {
        vis = fn;
        return () => {
          vis = null;
        };
      },
      onOnline: (fn) => {
        online = fn;
        return () => {
          online = null;
        };
      },
    };
    const flush = () => new Promise((r) => setTimeout(r, 0));
    return {
      deps,
      get loads() {
        return loads;
      },
      get pending() {
        return timers.length;
      },
      nextDelay: () => (timers.length === 0 ? null : timers[0]!.at - now),
      failing: (f: boolean) => {
        fail = f;
      },
      async advance(ms: number) {
        now += ms;
        for (const t of [...timers].filter((t) => t.at <= now)) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
        await flush();
      },
      async hide() {
        hidden = true;
        vis?.();
        await flush();
      },
      async show() {
        hidden = false;
        vis?.();
        await flush();
      },
      async online() {
        online?.();
        await flush();
      },
      flush,
    };
  }

  it("polls every 3 s while visible", async () => {
    const page = fakePage();
    const p = startPoll(page.deps);
    await page.flush();
    expect(page.loads).toBe(1);
    expect(page.nextDelay()).toBe(3000);
    await page.advance(3000);
    expect(page.loads).toBe(2);
    p.stop();
    expect(page.pending).toBe(0);
  });

  it("stops while the page is hidden and resumes the moment it is visible", async () => {
    const page = fakePage();
    const p = startPoll(page.deps);
    await page.flush();
    await page.hide();
    expect(page.pending).toBe(0);
    await page.advance(60_000);
    expect(page.loads).toBe(1);
    await page.show();
    expect(page.loads).toBe(2);
    expect(page.nextDelay()).toBe(3000);
    p.stop();
  });

  it("backs off on errors, and `now()` polls at once", async () => {
    const page = fakePage();
    page.failing(true);
    const p = startPoll(page.deps);
    await page.flush();
    expect(page.nextDelay()).toBe(6000);
    await page.advance(6000);
    expect(page.nextDelay()).toBe(12_000);
    page.failing(false);
    p.now();
    await page.flush();
    expect(page.loads).toBe(3);
    expect(page.nextDelay()).toBe(3000);
    p.stop();
    expect(pollDelay(10)).toBe(30_000);
  });

  it("coming back online after an outage polls at once, not after the backoff", async () => {
    const page = fakePage();
    page.failing(true);
    const p = startPoll(page.deps);
    await page.flush();
    await page.advance(6000);
    await page.advance(12_000);
    expect(page.loads).toBe(3);
    expect(page.nextDelay()).toBe(24_000);
    page.failing(false);
    await page.online();
    expect(page.loads).toBe(4);
    expect(page.nextDelay()).toBe(3000);
    // A healthy poll ignores `online` (no extra request).
    await page.online();
    expect(page.loads).toBe(4);
    p.stop();
  });

  it("`now()` during a poll in flight polls again the moment it lands", async () => {
    const page = fakePage();
    let release: () => void = () => {};
    let loads = 0;
    page.deps.load = () => {
      loads++;
      return loads === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    };
    const p = startPoll(page.deps);
    expect(loads).toBe(1);
    p.now(); // a fire landed while the first poll (pre-fire state) is out
    await page.flush();
    expect(loads).toBe(1);
    release();
    await page.flush();
    expect(loads).toBe(2); // not 3 s later
    expect(page.nextDelay()).toBe(3000);
    p.stop();
  });
});

describe("routing", () => {
  it("?role=director opens the cue sheet", () => {
    expect(directorFromSearch("?role=director")).toBe(true);
    expect(directorFromSearch("?code=ABC")).toBe(false);
  });

  it("a fresh page opens on ?role=director, else the stored session", () => {
    const store = (keys: string[]) => (k: string) => (keys.includes(k) ? "{}" : null);
    expect(initialRole("?role=director", store(["loom.guest"]))).toBe("director");
    expect(initialRole("", store(["loom.guest", DIRECTOR_KEY]))).toBe("guest");
    expect(initialRole("", store(["loom.prime"]))).toBe("prime");
    expect(initialRole("", store([DIRECTOR_KEY]))).toBe("director");
    expect(initialRole("?code=ABC", store([]))).toBe("none");
  });

  it("a mod-code link opens the cue sheet from the chooser only", () => {
    expect(roleForBrand("none", "mod")).toBe("director");
    expect(roleForBrand("guest", "mod")).toBe("guest");
    expect(roleForBrand("prime", "mod")).toBe("prime");
    expect(roleForBrand("none", "guest")).toBe("none");
  });

  it("a performer-code link opens the performer sign-in from the chooser only (issue 6)", () => {
    expect(roleForBrand("none", "prime")).toBe("prime");
    expect(roleForBrand("guest", "prime")).toBe("guest");
    expect(roleForBrand("director", "prime")).toBe("director");
    expect(roleForBrand("none", null)).toBe("none");
  });

  it("the guests' front page carries no link to it", () => {
    const ui = readFileSync(new URL("../src/ui.tsx", import.meta.url), "utf8");
    expect(ui).toContain('if (role === "director") return <DirectorApp');
    expect(ui).not.toContain("Director cues");
  });

  it("the performers' help explains the phone cue sheet; guests never see it", () => {
    expect(searchHelp(articlesFor("performer"), "cue sheet")[0]?.article.slug).toBe("director-phone");
    expect(articlesFor("guest").some((a) => a.slug === "director-phone")).toBe(false);
  });
});

describe("takesValue", () => {
  it("offers the value box on an award only", () => {
    expect(takesValue("award_best_liar")).toBe(true);
    for (const id of ["beat_the_king", "reinstallation begun", "start_the_ceremony"]) expect(takesValue(id), id).toBe(false);
  });
});

/** A two-act sheet (B, C) with Anytime between them, as a new server sends it. */
const ACTS: DirectorView = {
  interactions: [
    { id: "call", label: "C1 · 📣 Call everyone", who: "admin", act: "B · Act I: the Desktop" },
    { id: "bingo", label: "V2 · 🎱 Bingo", who: "admin" },
    { id: "ring", label: "☎️ Telephone (Optional)", who: "admin", sequence: false },
    { id: "lights", label: "💡 Lights back", who: "admin", sequence: false, act: "Anytime" },
    { id: "hunt", label: "📺 Preview hunt 2", who: "admin", act: "C · The hour" },
    { id: "summons", label: "📓 Hunt 2", who: "admin" },
    { id: "timer", label: "⏳ Timer (auto)", who: "admin", sequence: false },
    { id: "duck", label: "🦆 Duck found", who: "admin", sequence: false, act: "anytime" },
  ],
  cues: { last: null, fired: [] },
};

describe("acts on the phone", () => {
  it("groups rows by act and folds past acts", () => {
    const view: DirectorView = { ...ACTS, cues: { last: "bingo", fired: ["call", "bingo"] } };
    const layout = sheetLayout(directorRows(view));
    expect(layout.kind).toBe("acts");
    if (layout.kind !== "acts") return;
    expect(layout.acts.map((a) => [a.code ?? a.title, a.state])).toEqual([
      ["B", "past"],
      ["Anytime", "anytime"],
      ["C", "focus"],
    ]);
    // Anytime rejoined by folded name: 💡 and 🦆 in one act.
    expect(layout.acts[1]!.rows.map((r) => r.id)).toEqual(["lights", "duck"]);
    // The past act folds to one line; its fallbacks are the previous act's.
    expect(foldedLine(layout.acts[0]!)).toBe("✓ B · Act I: the Desktop 2/2");
    expect(layout.previous).toBe(0);
    expect(layout.acts[layout.previous]!.asides.map((r) => r.id)).toEqual(["ring"]);
    expect(layout.acts[layout.focus]!.starting).toBe(true);
    // At the doors B is the focus and C is still to come.
    const doors = sheetLayout(directorRows(ACTS));
    if (doors.kind !== "acts") throw new Error("acts");
    expect(doors.acts[doors.focus]!.code).toBe("B");
    expect(foldedLine(doors.acts[2]!)).toBe("C · The hour · 2 cues · next: 📺 Preview hunt 2");
  });

  it("flat list against a view without acts", () => {
    // An old server (no act on any row), or a story with no act: lines.
    const layout = sheetLayout(directorRows(VIEW));
    expect(layout).toEqual({ kind: "flat", rows: directorRows(VIEW) });
    expect(stripItems(VIEW, layout, null)).toEqual([{ text: "desktop" }]);
    expect(nextBarText(nextBar(directorRows(VIEW), undefined, null))).toBe("NEXT 🎱 Start Computer Bingo");
  });

  it("NEXT bar shows the countdown when NEXT is empty", () => {
    // Everything in sequence fired: no NEXT, and Midnight runs.
    const view: DirectorView = {
      ...ACTS,
      cues: { last: "summons", fired: ["call", "bingo", "hunt", "summons"] },
      clock: 1_000_000,
      countdowns: [
        { label: "Summons closes", endsAt: 1000 + 600 },
        { label: "Midnight", endsAt: 1000 + 2272 },
      ],
    };
    const rows = directorRows(view);
    expect(rows.some((r) => r.next)).toBe(false);
    // 2 s after the poll landed the soonest countdown is 9:58.
    const now = storyNow(view.clock, 5000, 7000);
    expect(now).toBe(1_002_000);
    const bar = nextBar(rows, view.countdowns, now);
    expect(bar).toEqual({ kind: "countdown", label: "Summons closes", left: 598 });
    // Never a bare "NEXT —" before the countdown (it read as "NEXT: Midnight").
    expect(nextBarText(bar)).toBe("NEXT — nothing to press. The story runs. ⏱ Summons closes in 9:58");
    expect(nextBarText({ kind: "none" })).toBe("NEXT — nothing to press");
    // A countdown that ran out drops off; none left: nothing to press.
    expect(nextBar(rows, view.countdowns, storyNow(view.clock, 0, 3_000_000))).toEqual({ kind: "none" });
    expect(nextBar(rows, view.countdowns, null)).toEqual({ kind: "none" });
    // With a NEXT the bar names it; a repeat LAST reads AGAIN.
    expect(nextBarText(nextBar(directorRows(ACTS), view.countdowns, now))).toBe("NEXT 📣 Call everyone");
    const again = directorRows({ interactions: [{ id: "results", label: "📋 Results", who: "admin", repeat: true }], cues: { last: "results", fired: ["results"] } });
    expect(nextBarText(nextBar(again, undefined, null))).toBe("AGAIN 📋 Results");
    expect(formatLeft(3723)).toBe("1:02:03");
    expect(formatLeft(59.9)).toBe("0:59");
  });

  it("the strip: act, phase, the soonest countdown (red under a minute), ≤ 3 watch values", () => {
    const view: DirectorView = {
      ...ACTS,
      world: [{ path: "Night.phase", value: '"y2k"' }],
      clock: 100_000,
      countdowns: [{ label: "Midnight", endsAt: 130 }],
      watch: [
        { label: "Y2K clock", value: '"23:30"' },
        { label: "Judge", value: "null" },
        { label: "The Heart", value: "true" },
        { label: "Fourth", value: "4" },
      ],
    };
    const items = stripItems(view, sheetLayout(directorRows(view)), storyNow(view.clock, 0, 0));
    expect(items).toEqual([{ text: "B" }, { text: "y2k" }, { text: "⏱ Midnight 0:30", urgent: true }, { text: "Y2K clock 23:30" }, { text: "Judge —" }, { text: "The Heart ●" }]);
  });

  it("countdowns freeze while the event is paused, and through a failing poll", () => {
    // Paused at 11:20 pm with Midnight 37:52 away: the server's clock holds
    // still, so the phone's must too — between polls, and however long the
    // poll keeps failing — never draining to "nothing to press".
    const paused: DirectorView = { ...ACTS, cues: { last: "summons", fired: ["call", "bingo", "hunt", "summons"] }, clock: 1_000_000, paused: true, countdowns: [{ label: "Midnight", endsAt: 1000 + 2272 }] };
    expect(clockRuns(paused)).toBe(false);
    const rows = directorRows(paused);
    for (const later of [0, 3000, 60_000, 3_000_000]) {
      const now = storyNow(paused.clock, 5000, 5000 + later, clockRuns(paused));
      expect(now).toBe(1_000_000);
      expect(nextBar(rows, paused.countdowns, now)).toEqual({ kind: "countdown", label: "Midnight", left: 2272 });
    }
    expect(stripItems(paused, sheetLayout(rows), 1_000_000).map((i) => i.text)).toContain(STOPPED);
    // Running, it ticks on (and the strip says nothing about the clock).
    const running: DirectorView = { ...paused, paused: undefined };
    expect(clockRuns(running)).toBe(true);
    expect(storyNow(running.clock, 5000, 8000, clockRuns(running))).toBe(1_003_000);
    expect(stripItems(running, sheetLayout(rows), 1_000_000).map((i) => i.text)).not.toContain(STOPPED);
    // A full ModView (an older server ignoring ?cues=1) says it through phase.
    expect(clockRuns({ phase: "paused" })).toBe(false);
    expect(clockRuns({ phase: "idle" })).toBe(false);
    expect(clockRuns({ phase: "open" })).toBe(true);
    // The server's lean read and the phone agree.
    expect(clockRuns(cueSheetView({ phase: "paused" }) as DirectorView)).toBe(false);
  });

  it("the lean view carries no secret watch values", () => {
    // What the server's `?cues=1` read makes of a ModView with a secret
    // (Kernel) watch, a role and a person item: only global, non-secret.
    const lean = cueSheetView({
      interactions: ACTS.interactions,
      world: [
        { path: "Night.clock", value: '"23:30"' },
        { path: "Kernel.door_code", value: '"4471"' },
      ],
      watch: [
        { label: "Door code", path: "Kernel.door_code", scope: "character", secret: true },
        { label: "Cleared", path: "Program.cleared", scope: "role" },
        { label: "Excel", path: null, scope: "person" },
        { label: "Y2K clock", path: "Night.clock", scope: "global" },
      ],
    });
    expect(JSON.stringify(lean)).not.toContain("4471");
    expect(JSON.stringify(lean)).not.toContain("Door code");
    const items = stripItems(lean as DirectorView, sheetLayout(directorRows(lean as DirectorView)), null);
    expect(items.map((i) => i.text)).toEqual(["B", "Y2K clock 23:30"]);
    // Nor the descriptions: the phone never reads one.
    expect(lean.interactions.some((i) => "description" in i)).toBe(false);
  });
});

describe("the dead time and stale arms", () => {
  const rows = directorRows(ACTS);
  const call = rows[0]!;
  const marks = ACTS.cues!;

  it("ignore tap inside the dead time", () => {
    const first = phoneTap(null, call, 1000, marks);
    expect(first.kind).toBe("arm");
    if (first.kind !== "arm") return;
    // A fast double tap (the 📋 question-skip hazard) only arms.
    expect(phoneTap(first.armed, call, 1000 + ARM_DEAD_MS - 1, marks)).toEqual({ kind: "ignore" });
    expect(phoneTap(first.armed, call, 1000 + ARM_DEAD_MS, marks)).toEqual({ kind: "fire", id: "call", subject: null });
    // A first tap on another cue is never inside anyone's dead time.
    expect(phoneTap(first.armed, rows[1]!, 1050, marks).kind).toBe("arm");
  });

  it("stale arm is not fired", () => {
    const first = phoneTap(null, call, 0, marks);
    if (first.kind !== "arm") throw new Error("arm");
    expect(first.armed).toMatchObject({ last: null, firedCount: 0 });
    // Another director fired 📣 between the taps: the arm is stale.
    const moved = { last: "call", fired: ["call"] };
    expect(phoneTap(first.armed, call, 1000, moved)).toEqual({ kind: "stale", id: "call" });
    expect(STALE_TOAST).toBe("Cues moved — tap again");
    // A subject cue armed through the picker is bound the same way.
    const award = directorRows(VIEW)[3]!;
    const armed = armFor("award_most_trusted", "g1", 0, undefined, VIEW.cues);
    expect(phoneTap(armed, award, 500, VIEW.cues!)).toEqual({ kind: "fire", id: "award_most_trusted", subject: "g1" });
    expect(phoneTap(armed, award, 500, { last: "start_the_bingo", fired: ["call_to_the_desktop", "start_the_bingo"] }).kind).toBe("stale");
    // A lapsed arm is not stale: the tap just arms again.
    expect(phoneTap(first.armed, call, ARM_MS, moved).kind).toBe("arm");
  });
});

describe("one press at a time", () => {
  const rows = directorRows(ACTS);
  const next = rows.find((r) => r.next)!;
  const other = rows.find((r) => !r.next)!;

  it("a press in flight locks every cue; NEXT cools down a second after", () => {
    // Firing 📣: nothing else may be armed or fired until it lands.
    expect(cueLocked(other, "call", false)).toBe(true);
    expect(cueLocked(next, "call", false)).toBe(true);
    // Landed: NEXT (now the following cue) waits out the cooldown; others don't.
    expect(cueLocked(next, null, true)).toBe(true);
    expect(cueLocked(other, null, true)).toBe(false);
    expect(cueLocked(next, null, false)).toBe(false);
    expect(NEXT_COOLDOWN_MS).toBe(1000);
  });

  it("a press waits for a poll that started after it, so its own move never reads as stale", async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const latch = viewLatch(
      (fn, ms) => {
        const t = { fn, ms };
        timers.push(t);
        return t;
      },
      (t) => {
        const i = timers.indexOf(t as { fn: () => void; ms: number });
        if (i >= 0) timers.splice(i, 1);
      },
    );
    // A poll is in flight when the press lands (it may predate the press).
    const old = latch.begin();
    let done = false;
    const wait = latch.after(latch.started, 3000).then(() => {
      done = true;
    });
    latch.landed(old); // the old poll's marks: not enough
    await Promise.resolve();
    expect(done).toBe(false);
    const fresh = latch.begin(); // the repoll
    latch.landed(fresh);
    await wait;
    expect(done).toBe(true);
    expect(timers).toHaveLength(0); // its timeout is cleared
    // No poll ever lands (hidden page, failing poll): it lets go after the wait.
    let gaveUp = false;
    const stuck = latch.after(latch.started, 3000).then(() => {
      gaveUp = true;
    });
    expect(timers.map((t) => t.ms)).toEqual([3000]);
    timers[0]!.fn();
    await stuck;
    expect(gaveUp).toBe(true);
    latch.landed(latch.begin()); // a late poll finds no waiter left
  });

  it("an arm made after the press's poll is bound to the moved marks, so it fires", () => {
    // 📣 fired from this phone; the lock held until the poll showed it.
    const after = { last: "call", fired: ["call"] };
    const moved = directorRows({ ...ACTS, cues: after });
    const bingo = moved.find((r) => r.next)!;
    const first = phoneTap(null, bingo, 0, after);
    if (first.kind !== "arm") throw new Error("arm");
    expect(phoneTap(first.armed, bingo, 500, after)).toMatchObject({ kind: "fire", id: bingo.id });
  });
});

describe("the armed row warns out of turn", () => {
  it("a cue not on offer, or a spine cue from another act, warns on the armed row — never blocks", () => {
    // At the doors the night is in B; C's 📺 unfolded by hand is out of turn.
    const view: DirectorView = { ...ACTS, interactions: [...ACTS.interactions!, { id: "ending", label: "🔥 An ending", who: "admin", live: false, act: "F · Finale" }] };
    const rows = directorRows(view);
    const layout = sheetLayout(rows);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(armWarnings(by("call"), layout)).toEqual([]);
    expect(armWarnings(by("hunt"), layout)).toEqual(["⚠ This is a C cue; the night is in B"]);
    // Fallbacks and Anytime cues are never out of turn.
    expect(armWarnings(by("timer"), layout)).toEqual([]);
    expect(armWarnings(by("lights"), layout)).toEqual([]);
    // Dimmed in F (another branch): arming says so, as well as the act.
    expect(armWarnings(by("ending"), layout)).toEqual(["⚠ Not on offer now: the story may refuse it", "⚠ This is a F cue; the night is in B"]);
    // The armed tap still fires: the warning never blocks.
    const ending = by("ending");
    const first = phoneTap(null, ending, 0, view.cues!);
    if (first.kind !== "arm") throw new Error("arm");
    expect(phoneTap(first.armed, ending, 500, view.cues!).kind).toBe("fire");
    // A flat sheet has no acts to compare: only the offer warning.
    const flat = directorRows({ interactions: [{ id: "x", label: "x", who: "admin", live: false }, { id: "y", label: "y", who: "admin" }], cues: { last: null, fired: [] } });
    expect(armWarnings(flat[0]!, sheetLayout(flat))).toEqual(["⚠ Not on offer now: the story may refuse it"]);
    expect(armWarnings(flat[1]!, sheetLayout(flat))).toEqual([]);
  });
});

describe("fired rows are muted", () => {
  it("a fired row is muted unless it is LAST, NEXT or armed; off-branch dimming stays its own class", () => {
    const view: DirectorView = { ...ACTS, cues: { last: "bingo", fired: ["call", "bingo"] } };
    const rows = directorRows(view);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(cueRowClass(by("call"), false, false).split(" ")).toContain("fired");
    expect(cueRowClass(by("call"), true, false).split(" ")).not.toContain("fired");
    expect(cueRowClass(by("bingo"), false, false).split(" ")).toEqual(["choice", "cue-row", "last"]);
    expect(cueRowClass(by("hunt"), false, false).split(" ")).toEqual(["choice", "cue-row", "next"]);
    // A repeat cue the night has moved past is muted like any other.
    const again = directorRows({ interactions: [{ id: "results", label: "📋", who: "admin", repeat: true }, { id: "z", label: "z", who: "admin" }], cues: { last: "z", fired: ["results", "z"] } });
    expect(cueRowClass(again[0]!, false, false).split(" ")).toContain("fired");
    expect(cueRowClass({ last: false, next: false, fired: false, live: false }, false, false)).toBe("choice cue-row off");
  });
});

describe("the previous act's fallbacks", () => {
  it("show once: under the focus act, or in the previous act's own section when it is unfolded", () => {
    const layout = sheetLayout(directorRows({ ...ACTS, cues: { last: "bingo", fired: ["call", "bingo"] } }));
    if (layout.kind !== "acts") throw new Error("acts");
    const b = layout.acts[layout.previous]!;
    expect(fromAct(layout, new Set())?.asides.map((r) => r.id)).toEqual(["ring"]);
    // Looking back at B by hand: its section lists ☎️, so no from-B line.
    expect(fromAct(layout, new Set([b.key]))).toBeNull();
    // At the doors there is no previous act.
    expect(fromAct(sheetLayout(directorRows(ACTS)), new Set())).toBeNull();
    expect(fromAct(sheetLayout(directorRows(VIEW)), new Set())).toBeNull();
  });
});

describe("looking away drops the arm", () => {
  it("disarms when the page goes hidden or the window blurs, and unsubscribes", () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
    const win = new EventTarget();
    let drops = 0;
    const off = disarmOnLeave(doc as unknown as Document, win as unknown as Window, () => drops++);
    doc.dispatchEvent(new Event("visibilitychange")); // back to visible: nothing
    expect(drops).toBe(0);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange")); // the screen locks
    expect(drops).toBe(1);
    win.dispatchEvent(new Event("blur")); // another app takes focus
    expect(drops).toBe(2);
    off();
    win.dispatchEvent(new Event("blur"));
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(drops).toBe(2);
  });
});
