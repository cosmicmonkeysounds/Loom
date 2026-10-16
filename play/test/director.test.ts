//! The director's phone cue sheet (W-26): rows off the mod view (core's
//! `cue-sheet.ts`, shared with the editor), arm-then-fire, a subject cue
//! asks for a person first, and the 3 s poll parks while the page is hidden.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { searchHelp } from "../../docs/help/helpdoc.ts";
import { articlesFor } from "../src/help.tsx";

import { ApiError } from "../src/client.ts";
import {
  ARM_MS,
  DIRECTOR_KEY,
  armFor,
  directorFromSearch,
  directorRows,
  fireCue,
  fireToast,
  initialRole,
  phoneLabel,
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
    expect(tapCue(armed, award, 100)).toEqual({ kind: "fire", id: "award_most_trusted", subject: "g1" });
    // the arm lapses: the next tap asks again
    expect(tapCue(armed, award, 50 + ARM_MS).kind).toBe("pick");
  });

  it("posts the cue with the phone's label (and the person, if any)", () => {
    expect(signalBody("start_the_bingo", null, "Ana")).toEqual({ name: "start_the_bingo", label: "Phone · Ana" });
    expect(signalBody("award_most_trusted", "g1", " ")).toEqual({ name: "award_most_trusted", subject: "g1", label: "Phone" });
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
    expect(fireToast(bingo, { ok: false, status: 409, message: "no scenario loaded" })).toBe("Not fired — no scenario loaded");
    expect(fireToast(rows[2]!, { ok: false, status: 500, message: "boom" })).toBe("🦆 Duck found failed: boom");
    // no HTTP answer: it may have fired — never "failed"
    expect(fireToast(bingo, { ok: false, status: 0, message: "Load failed" })).toBe("Not sure V2 fired — check the sheet before firing again");
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
