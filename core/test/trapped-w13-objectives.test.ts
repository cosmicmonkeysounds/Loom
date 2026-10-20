//! Trapped in the Internet — wave 13 (story lane): the show's side of the
//! Play overhaul. One home per broadcast (no `# system-log`), the host
//! parts (`admin: true`), the objectives every phone shows as NOW, the
//! interrupt ladder (`Night.alerts`), effect text, per-person notices (`~`),
//! the cards that ask (`moment: major`), codex categories, the booth card's
//! facts, a delivery for every beat that used to be buried, and the booth
//! noise trims. Every text change is DRAFT in `SIGNOFF-w13.md`.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioFiles, scenarioSource } from "../examples/load.ts";
import { ChatStore, composeGuestMessages } from "../server/chat.ts";
import type { ChatMessage } from "../server/chat.ts";
import { cueState, guestView, modView, notePress, objectivesFor, primeView, pressRefused } from "../server/views.ts";
import { cueRows } from "../src/cue-sheet.ts";

export const SRC = scenarioSource("trapped-in-the-internet");
export const SLOW = 120_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};

/** A Sim plus the chat the event server would compose from it. */
export class Night {
  readonly sim: Sim;
  readonly chat = new ChatStore();
  constructor(src = SRC) {
    this.sim = Sim.fromSources(src);
    this.take(this.sim.fireBeat("Power On"));
  }
  /** Compose a batch into the chat; returns the stored messages. */
  take(events: SimEvent[]): ChatMessage[] {
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  tick(seconds: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < seconds; i++) out.push(...this.take(this.sim.tick(1000)));
    return out;
  }
  signal(name: string, subject?: string, args?: Record<string, unknown>, actor?: string): ChatMessage[] {
    const ev = this.sim.signal(name, subject, args as never, actor);
    notePress(this.sim, ev);
    return this.take(ev);
  }
  /** A director's press: never refused. */
  press(name: string, subject?: string): ChatMessage[] {
    const ev = this.sim.signal(name, subject);
    notePress(this.sim, ev);
    expect(pressRefused(this.sim, ev), name).toBe(false);
    return this.take(ev);
  }
  scan(scanner: string, id: string): ChatMessage[] {
    return this.take(this.sim.scan(scanner, id));
  }
  /** Register → CAPTCHA → the problem (if asked) → deposit → the door scan. */
  upload(id: string, name: string, scanner: string | null = "Norton Anti-Virus"): ChatMessage[] {
    const out: ChatMessage[] = [];
    out.push(...this.take(this.sim.createPerson(id, name)));
    out.push(...this.signal("captcha answered", id, { passed: true }));
    out.push(...this.signal("captcha answered", id, { passed: false }));
    const p = this.sim.pendingChoiceFor(id);
    if (p && p.length === 4) out.push(...this.take(this.sim.choose(id, 0)));
    out.push(...this.take(this.sim.choose(id, 0)));
    if (scanner !== null) out.push(...this.scan(scanner, id));
    return out;
  }
  /** The cue sheet's NEXT, if any. */
  next(): string | null {
    const rows = cueRows(modView(this.sim, "open", "x").interactions ?? [], cueState(this.sim));
    return rows.find((r) => r.next)?.id ?? null;
  }
}

/** Messages a guest's phone receives (its own or everyone's). */
export const forGuest = (ms: readonly ChatMessage[], id: string) =>
  ms.filter((m) => m.audience === "all" || (Array.isArray(m.audience) && m.audience.includes(id)));

export const PROGRAMS: [string, string][] = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];

export const TO_TRUTH_1 = ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"];
export const TO_HOUR = [...TO_TRUTH_1, "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"];
export const TO_OVERSHARE = [...TO_HOUR, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares"];
export const TO_Y2K = [...TO_OVERSHARE, "y2k_clock"];

/** Six programs uploaded and cleared at the door. */
export function boot(): Night {
  const n = new Night();
  for (const [id, name] of PROGRAMS) n.upload(id, name);
  return n;
}

/** From the Y2K hour to an ending and the ceremony: the reveal, the bob,
 *  truth.txt, the verdict, then the rave if the verdict is Grok Prom. */
export function toCeremony(n: Night): void {
  n.press("final_reveal");
  n.press("bobbing_for_truth");
  n.signal("brought_up_the_bag", "g1", undefined, "Clippy");
  n.press("read_truth_txt");
  n.press("the_verdict");
  if (v(n.sim, "Night.phase") === "grok_prom") n.press("no_pickup_line");
  expect(v(n.sim, "Night.ended")).toBe(true);
  n.press("start_the_ceremony");
}

describe("Trapped in the Internet — wave 13: one home per broadcast", () => {
  it("there is no # system-log: an everyone-alert posts once, in the lobby", () => {
    const n = new Night();
    const sim = n.sim;
    expect([...sim.model.channels.keys()].some((k) => /system/i.test(k))).toBe(false);
    for (const [id, name] of PROGRAMS) n.upload(id, name);
    const out = n.press("call_to_the_desktop");
    const alerts = out.filter((m) => m.alert === true);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.channelKind).not.toBe("announcement");
  }, SLOW);
});

describe("Trapped in the Internet — wave 13: the host parts", () => {
  it("admin: true is on Task Manager, Adobe Acrobat and the Recycling Bin only (never Clippy)", () => {
    const m = Sim.fromSources(SRC).model;
    const admins = [...m.characters.values()].filter((c) => c.admin).map((c) => c.id).sort();
    expect(admins).toEqual(["Adobe Acrobat", "Recycling Bin", "Task Manager"]);
    expect(m.characters.get("Clippy")!.admin).toBe(false);
  });
});

describe("Trapped in the Internet — wave 13: codex categories", () => {
  it("every CODEX entry carries a guest-facing category (titi:facts writes the generated ones)", () => {
    const m = Sim.fromSources(SRC).model;
    const allowed = new Set(["People", "Places", "The story", "How it works", "Files", "Trabolta", "Missions", "Facts", "The cold door"]);
    const missing = [...m.codex.values()].filter((c) => c.category === null).map((c) => c.id);
    expect(missing).toEqual([]);
    for (const c of m.codex.values()) {
      expect(allowed.has(c.category!), `${c.id}: ${c.category}`).toBe(true);
      expect(c.category!, c.id).not.toMatch(/instruction|jeeves|kernel|staff/i);
    }
    expect(m.codex.get("Clippy Instructions 1")!.category).toBe("Missions");
    expect(m.codex.get("The Door Code")!.category).toBe("The cold door");
  });
});

describe("Trapped in the Internet — wave 13: the booth card's facts", () => {
  it("a scan card lists Cleared / Marked / Bathroom Mode / Late / In the Internet (false booleans too), never a secret slot", () => {
    const n = new Night();
    n.upload("g1", "Calculator");
    n.upload("g2", "Winamp", null);
    const g1 = primeView(n.sim, "Norton Anti-Virus").guests.find((g) => g.id === "g1")!;
    const on = (g: typeof g1) => Object.fromEntries((g.flags ?? []).map((f) => [f.label, f.on]));
    expect(on(g1)).toMatchObject({ Cleared: true, Marked: false, "Bathroom Mode": false, Late: false, "In the Internet": false });
    expect(on(g1)["Checked in"]).toBeUndefined(); // text "none": listed only once set
    const g2 = primeView(n.sim, "Norton Anti-Virus").guests.find((g) => g.id === "g2")!;
    expect(on(g2).Cleared).toBe(false); // "Not cleared"
    n.signal("go to the bathroom", "g1");
    const after = primeView(n.sim, "Norton Anti-Virus").guests.find((g) => g.id === "g1")!;
    expect(on(after)["Bathroom Mode"]).toBe(true);
    const secret = new Set(n.sim.model.roles.get("Program")!.secret ?? []);
    for (const g of primeView(n.sim, "Norton Anti-Virus").guests) for (const f of g.flags ?? []) expect(secret.has(f.path.split(".").slice(1).join(".")), f.path).toBe(false);
  });
});

describe("Trapped in the Internet — wave 13: the interrupt ladder", () => {
  it("header alerts: Night.alerts; sticky at Power On, dialog at the summons and the clock, bsod at the reveal, sticky at Pong and the ceremony", () => {
    const n = boot();
    const level = () => guestView(n.sim, "g1").alertLevel;
    expect(n.sim.model.alerts).toBe("Night.alerts");
    expect(level()).toBe("sticky");
    for (const c of TO_HOUR) n.press(c);
    expect(level()).toBe("sticky");
    n.press("five_minute_warning");
    expect(level()).toBe("dialog");
    expect(primeView(n.sim, "Norton Anti-Virus").alertLevel).toBe("dialog");
    n.press("summons_closed");
    n.press("truth_pong");
    expect(level()).toBe("sticky");
    for (const c of ["round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares", "y2k_clock"]) n.press(c);
    expect(level()).toBe("dialog");
    n.press("final_reveal");
    expect(level()).toBe("bsod");
    n.press("bobbing_for_truth");
    n.signal("brought_up_the_bag", "g1", undefined, "Clippy");
    n.press("read_truth_txt");
    n.press("the_verdict");
    if (v(n.sim, "Night.phase") === "grok_prom") n.press("no_pickup_line");
    expect(level()).toBe("bsod");
    n.press("start_the_ceremony");
    expect(level()).toBe("sticky");
  }, SLOW);
});

describe("Trapped in the Internet — wave 13: effect text", () => {
  it("glitch lines carry an effect manner (fx); the Truther Download speaks fx; delivery notes stay plain", () => {
    const n = boot();
    const all: ChatMessage[] = [];
    for (const c of TO_HOUR) all.push(...n.press(c));
    all.push(...n.tick(130)); // the Truther Download, two minutes in
    const td = all.filter((m) => m.from === "Truther Download" && m.kind === "line");
    expect(td.length).toBeGreaterThan(0);
    for (const m of td) expect(m.fx, m.text).toBe(true);
    const ad = all.find((m) => m.text.startsWith("The presentation freezes."))!;
    expect(ad).toMatchObject({ manner: "static", fx: true, kind: "narration" });
    for (const c of ["five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings"]) all.push(...n.press(c));
    const over = n.press("trabolta_overshares");
    const glitch = over.filter((m) => m.fx === true);
    expect(glitch.length).toBeGreaterThan(0);
    for (const m of over.filter((x) => x.manner !== undefined)) expect(m.fx, m.text).toBe(true);
    // Delivery notes ride the line but are not effect text.
    const bob = n.press("y2k_clock").concat(n.press("final_reveal"), n.press("bobbing_for_truth"));
    const dejected = bob.filter((m) => m.manner === "dejectedly");
    expect(dejected.length).toBeGreaterThan(0);
    for (const m of dejected) expect(m.fx).toBeUndefined();
  }, SLOW);
});

/** Each `broadcast "~…"` line with the lines of its own block (same indent,
 *  up to the next shallower line on either side). */
function noticeBlocks(): Array<{ where: string; line: string; block: string[] }> {
  const out: Array<{ where: string; line: string; block: string[] }> = [];
  for (const f of scenarioFiles("trapped-in-the-internet")) {
    const lines = f.source.split("\n");
    const indent = (l: string) => l.length - l.trimStart().length;
    lines.forEach((l, i) => {
      if (!/^\s*broadcast "~/.test(l)) return;
      const d = indent(l);
      let a = i;
      while (a > 0 && (lines[a - 1]!.trim() === "" || indent(lines[a - 1]!) >= d)) a--;
      let b = i;
      while (b + 1 < lines.length && (lines[b + 1]!.trim() === "" || indent(lines[b + 1]!) >= d)) b++;
      out.push({ where: `${f.path}:${i + 1}`, line: l.trim(), block: lines.slice(a, b + 1).filter((x) => indent(x) === d).map((x) => x.trim()) });
    });
  }
  return out;
}

describe("Trapped in the Internet — wave 13: per-person notices (~)", () => {
  it("every ~ notice has the person's own result in the same block (a reply, the mark's pin, a line to them)", () => {
    const blocks = noticeBlocks();
    expect(blocks.length).toBe(23);
    for (const { where, line, block } of blocks) {
      expect(line, where).not.toMatch(/^broadcast "~?!|^broadcast "!~/);
      const personal = block.some((x) => x.startsWith("reply ") || x.startsWith("fire mark_for_reinstallation for program") || / to participant\(/.test(x) || /^Trabolta:/.test(x));
      expect(personal, `${where}: ${line}`).toBe(true);
    }
  });

  it("a notice is composed with its collapse key; the subject still hears it personally", () => {
    const n = boot();
    for (const c of ["call_to_the_desktop", "start_the_bingo", "bingo_time"]) n.press(c);
    n.signal("bingo_winner", "g5", undefined, "Clippy");
    const out = n.signal("award_the_ribbon", "g5", undefined, "Clippy");
    const notice = out.find((m) => m.text.includes("wins a Bingo Ribbon"))!;
    expect(notice.notice).toBe("🎀");
    expect(notice.text.startsWith("~")).toBe(false);
    expect(notice.audience).toBe("all");
    expect(forGuest(out, "g5").some((m) => m.readout === true && m.text.startsWith("🎀 You won a Bingo Ribbon"))).toBe(true);
  }, SLOW);
});

describe("Trapped in the Internet — wave 13: the cards that ask", () => {
  it("the bottle's Truth / Dare card and the pickup-line card are major moments", () => {
    const n = boot();
    for (const c of TO_TRUTH_1) n.press(c);
    n.press("close_the_filing");
    n.press("read_the_results");
    n.press("spin_the_bottle");
    // The server's pick lands as `bottle_landed` (the Sim has no random).
    const spin = n.signal("bottle_landed", "g2");
    const pick = { id: "g2" };
    const card = spin.find((m) => m.kind === "widget" && m.text.startsWith("🍾 The bottle landed on you"))!;
    expect(card).toMatchObject({ moment: "major", audience: [pick.id] });
    // The pickup line (after truth.txt, both branches).
    for (const c of ["read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt", "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares", "y2k_clock", "final_reveal", "bobbing_for_truth"]) {
      if (v(n.sim, "Night.bottle_open") === true) n.signal("truth_answered", pick.id, undefined, "Clippy");
      n.press(c);
    }
    n.signal("brought_up_the_bag", "g1", undefined, "Clippy");
    n.press("read_truth_txt");
    const verdict = n.press("the_verdict");
    const lines = verdict.filter((m) => m.kind === "widget" && m.text.startsWith("Give me a pickup line"));
    expect(lines.length).toBeGreaterThan(0);
    for (const m of lines) expect(m.moment, m.text).toBe("major");
  }, SLOW);
});

/** A major moment reached this guest in the batch: an alert / readout
 *  stamped `moment: "major"`, or a `!` pin. */
export const majorFor = (ms: readonly ChatMessage[], id: string) => forGuest(ms, id).filter((m) => m.moment === "major" || (m.pin === true && m.alert === true));

describe("Trapped in the Internet — wave 13: every buried beat has a delivery (ux/alerts-beats.md §4)", () => {
  const Y2K = () => {
    const n = boot();
    for (const c of TO_Y2K) n.press(c);
    return n;
  };
  const rows: Array<[string, () => { n: Night; out: ChatMessage[]; who?: string }]> = [
    ["① Trabolta comes online", () => { const n = boot(); for (const c of ["call_to_the_desktop", "start_the_bingo", "bingo_time"]) n.press(c); return { n, out: n.press("introduce_trabolta") }; }],
    ["🏓 Truth Pong starts", () => { const n = boot(); for (const c of [...TO_HOUR, "five_minute_warning", "summons_closed"]) n.press(c); return { n, out: n.press("truth_pong") }; }],
    ["📊 the Trust Chart", () => { const n = boot(); for (const c of [...TO_HOUR, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally"]) n.press(c); return { n, out: n.press("trust_chart") }; }],
    ["🫘 the beans", () => { const n = boot(); for (const c of [...TO_HOUR, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings"]) n.press(c); n.signal("praise_the_top"); n.signal("shame_the_bottom"); expect(v(n.sim, "Night.printer_called")).toBe(true); return { n, out: n.press("printer_opened") }; }],
    ["🤖 the overshare", () => { const n = boot(); for (const c of TO_OVERSHARE.slice(0, -1)) n.press(c); return { n, out: n.press("trabolta_overshares") }; }],
    ["🕚 the Y2K orders + factions exposed", () => { const n = boot(); for (const c of TO_OVERSHARE) n.press(c); return { n, out: n.press("y2k_clock") }; }],
    ["📂 # clipboard opens (hunt 2)", () => { const n = boot(); for (const c of TO_HOUR.slice(0, -1)) n.press(c); const out = n.press("start_the_second_hunt"); expect(majorFor(out, "g1").some((m) => m.text.includes("# clipboard"))).toBe(true); return { n, out }; }],
    ["📂 # truthcoin-exchange opens (the Truther Download)", () => { const n = boot(); for (const c of TO_HOUR) n.press(c); const out = n.tick(125); expect(majorFor(out, "g1").some((m) => m.text.includes("# truthcoin-exchange"))).toBe(true); return { n, out }; }],
    ["♟ the door code by checkmate", () => { const n = Y2K(); return { n, out: n.signal("chess_won", "g1") }; }],
    ["🔢 the door code by the four digit notes", () => {
      const n = Y2K();
      // Learning a note fires `door_digit_found` (ROLE Program).
      for (const e of ["Cold Door First Digit", "Cold Door Second Digit", "Cold Door Third Digit"]) n.take(n.sim.unlock("g1", e));
      return { n, out: n.take(n.sim.unlock("g1", "Cold Door Fourth Digit")) };
    }],
    ["🗝 the door code by the majority (The Whole Truth)", () => { const n = Y2K(); for (const [id] of PROGRAMS) n.take(n.sim.join(id, "Unlimited Power")); return { n, out: n.press("force_majority_stay").concat(n.tick(1)) }; }],
    ["🚪 The Heart", () => { const n = Y2K(); return { n, out: n.signal("server_door_opened") }; }],
    ["⏰ you are late", () => { const n = boot(); for (const c of [...TO_HOUR, "five_minute_warning"]) n.press(c); return { n, out: n.press("summons_closed") }; }],
    ["🎵 the song ending (the verdict, every fact accurate)", () => { const n = Y2K(); for (const c of ["final_reveal", "bobbing_for_truth"]) n.press(c); n.signal("brought_up_the_bag", "g1", undefined, "Clippy"); n.press("read_truth_txt"); const out = n.press("the_verdict"); expect(v(n.sim, "Night.ending")).toBe("song"); return { n, out }; }],
    ["💔 the verdict: Grok Prom", () => { const n = Y2K(); for (const c of ["final_reveal", "bobbing_for_truth"]) n.press(c); n.signal("brought_up_the_bag", "g1", undefined, "Clippy"); n.press("read_truth_txt"); return { n, out: n.take(n.sim.fireBeat("Grok Prom")) }; }],
    ["🏍 the rave", () => { const n = Y2K(); for (const c of ["final_reveal", "bobbing_for_truth"]) n.press(c); n.signal("brought_up_the_bag", "g1", undefined, "Clippy"); n.press("read_truth_txt"); n.take(n.sim.fireBeat("Grok Prom")); return { n, out: n.press("no_pickup_line") }; }],
    ["💞 the advice helped", () => { const n = Y2K(); for (const c of ["final_reveal", "bobbing_for_truth"]) n.press(c); n.signal("brought_up_the_bag", "g1", undefined, "Clippy"); n.press("read_truth_txt"); n.take(n.sim.fireBeat("Grok Prom")); n.press("ask_for_advice"); return { n, out: n.press("advice_tally") }; }],
    ["🕺 the hand jive", () => { const n = Y2K(); for (const c of ["final_reveal", "bobbing_for_truth"]) n.press(c); n.signal("brought_up_the_bag", "g1", undefined, "Clippy"); n.press("read_truth_txt"); n.take(n.sim.fireBeat("Grok Prom")); n.press("ask_for_advice"); n.signal("poll answered", "g1", { choice: "Thwart him", index: 1 }); n.press("advice_tally"); expect(v(n.sim, "Night.ending")).toBe("banished"); return { n, out: n.press("the_hand_jive") }; }],
    ["🏆 you won an award", () => { const n = Y2K(); toCeremony(n); return { n, out: n.press("award_most_trusted", "g1") }; }],
  ];
  for (const [label, run] of rows) {
    it(label, () => {
      const { out, who } = run();
      expect(majorFor(out, who ?? "g1").length, label).toBeGreaterThan(0);
    }, SLOW);
  }

  it("the booth readouts that matter are major: the escort, the late list, the alarm", () => {
    const n = boot();
    for (const c of TO_TRUTH_1) n.press(c);
    const mark = n.signal("uncertain_answer", "g5", undefined, "Clippy");
    const escort = mark.find((m) => m.channel === "dm:Norton Anti-Virus" && m.text.startsWith("🚨 Winamp is marked"))!;
    expect(escort).toMatchObject({ readout: true, alert: true, moment: "major", about: "g5" });
  }, SLOW);
});

describe("Trapped in the Internet — wave 13: always-on buttons tightened", () => {
  it("📝 only in review mode, 🪙 only from the Truther Download, 🔧 only from the Y2K hour, ♟ only while the King is armed", () => {
    const n = boot();
    const live = (who: string, id: string) => primeView(n.sim, who).interactions.find((i) => i.id === id)?.live !== false;
    expect(live("Clippy", "fact_accurate")).toBe(false);
    n.take(n.sim.setVar("Night.judge_mode", "review"));
    expect(live("Clippy", "fact_accurate")).toBe(true);
    n.take(n.sim.setVar("Night.judge_mode", "auto"));
    expect(live("McAfee Anti-Virus", "pay_truthcoin")).toBe(false);
    expect(live("Task Manager", "charge_truthcoin")).toBe(false);
    expect(live("Norton Anti-Virus", "radio_crew_door")).toBe(false);
    expect(live("Norton Anti-Virus", "beat_the_machine")).toBe(true);
    for (const c of TO_HOUR) n.press(c);
    n.tick(125);
    expect(live("McAfee Anti-Virus", "pay_truthcoin")).toBe(true);
    for (const c of ["five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares", "y2k_clock"]) n.press(c);
    expect(live("Norton Anti-Virus", "radio_crew_door")).toBe(true);
    toCeremony(n);
    for (const id of ["beat_the_machine", "radio_crew_door", "accuse"]) expect(live("Norton Anti-Virus", id), id).toBe(false);
    expect(live("Task Manager", "pay_truthcoin")).toBe(false);
  }, SLOW);
});
