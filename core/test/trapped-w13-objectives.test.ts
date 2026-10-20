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
import { cueState, guestCardView, guestView, modView, notePress, primeView, pressRefused } from "../server/views.ts";
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

/** A major moment reached this guest in the batch: an alert, a `!` pin, a
 *  `reply !…` or a card that asks (the server stamps `moment: "major"`). */
export const majorFor = (ms: readonly ChatMessage[], id: string) => forGuest(ms, id).filter((m) => m.moment === "major");

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
    ["④ a guess that marks you (the 🤷 verdict)", () => { const n = boot(); for (const c of TO_TRUTH_1) n.press(c); return { n, out: n.signal("uncertain_answer", "g1", undefined, "Clippy") }; }],
    ["⑤ your cup: missed", () => { const n = boot(); for (const c of [...TO_HOUR, "five_minute_warning"]) n.press(c); n.scan("Norton Anti-Virus", "g1"); for (const c of ["summons_closed", "truth_pong"]) n.press(c); return { n, out: n.signal("missed_the_cup", "g1", undefined, "Adobe Acrobat") }; }],
    ["⑥ the Truther Download (your messages, your mission)", () => { const n = boot(); for (const c of TO_HOUR) n.press(c); return { n, out: n.tick(125) }; }],
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

describe("Trapped in the Internet — wave 13: booth noise", () => {
  const lines = (ms: readonly ChatMessage[], from: string, id: string) => forGuest(ms, id).filter((m) => m.from === from && m.kind === "line").map((m) => m.text);

  it("a host scan greets a guest in full once; a re-scan is one line", () => {
    const n = boot();
    for (const host of ["Clippy", "Task Manager", "Adobe Acrobat", "Recycling Bin"]) {
      const first = lines(n.scan(host, "g5"), host, "g5");
      const again = lines(n.scan(host, "g5"), host, "g5");
      expect(first.length, host).toBeGreaterThanOrEqual(2);
      expect(again, host).toHaveLength(1);
    }
    // Task Manager's re-scan is still the status check.
    expect(lines(n.scan("Task Manager", "g5"), "Task Manager", "g5")[0]).toMatch(/^Truths accepted: 0\. Visits to the Internet: 0\. Truthcoin: \d+\.$/u);
  }, SLOW);

  it("Windows Defender hears only its door readouts: no sweep, escort, late, Bathroom Mode or alarm", () => {
    const n = boot();
    const wd = (ms: readonly ChatMessage[]) => ms.filter((m) => m.channel === "dm:Windows Defender" && m.readout === true).map((m) => m.text);
    const norton = (ms: readonly ChatMessage[]) => ms.filter((m) => m.channel === "dm:Norton Anti-Virus" && m.readout === true).map((m) => m.text);
    const cd = n.press("call_to_the_desktop");
    expect(wd(cd)).toEqual([]);
    expect(norton(cd).length).toBe(1);
    expect(wd(n.signal("go to the bathroom", "g5"))).toEqual([]);
    n.signal("back from the bathroom", "g5");
    for (const c of ["start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"]) n.press(c);
    const mark = n.signal("uncertain_answer", "g6", undefined, "Clippy");
    expect(wd(mark)).toEqual([]);
    expect(norton(mark).some((t) => t.startsWith("🚨 VLC is marked"))).toBe(true);
    for (const c of ["close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"]) n.press(c);
    const summons = n.press("five_minute_warning");
    expect(wd(summons)).toEqual(["🛡 The summons: hold the door. Scan only new arrivals; send everyone else to the living room."]);
    // A late arrival still clears at the door.
    const late = n.upload("g9", "Netscape", "Windows Defender");
    expect(v(n.sim, "g9.cleared")).toBe(true);
    expect(wd(late).some((t) => t.startsWith("✅ Cleared Netscape"))).toBe(true);
  }, SLOW);

  it("McAfee's expired-protection pop-up is a bark (the ambient ticker), not a broadcast", () => {
    const n = boot();
    const out = n.tick(20 * 60 + 5);
    const pops = out.filter((m) => m.text.includes("Your protection has expired. Your protection has expired."));
    expect(pops.length).toBeGreaterThan(0);
    for (const m of pops) expect(m.ambient, m.text).toBe(true);
    expect(out.some((m) => m.kind === "signal" && m.text.includes("McAfee"))).toBe(false);
  }, SLOW);
});

describe("Trapped in the Internet — wave 13: skipping the tour", () => {
  it("completes the Orientation quest with a skipped step (never \"1 failed\"); the doubt and Norton's log stay", () => {
    const n = new Night();
    n.upload("g5", "Winamp");
    const out = n.signal("tutorial answered", "g5", { skipped: true, step: 1, steps: 5 });
    expect(n.sim.questStatus("g5", "Orientation")).toBe("done");
    expect(out.some((m) => m.kind === "quest" && m.text.startsWith("Skipped."))).toBe(true);
    expect(v(n.sim, "g5.doubt")).toBe(10);
  });
});

// ───────── the walk: a live objective for every phone at every cue ─────────

export const PERFORMERS = ["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software", "Windows Defender", "Clippy", "Task Manager", "Adobe Acrobat", "Recycling Bin"];
export const HOST_PARTS = new Set(["Task Manager", "Adobe Acrobat", "Recycling Bin"]);
const RESERVED = new Set(["pass", "scan"]);
const interactionButtons = (b: readonly string[]) => b.filter((x) => !RESERVED.has(x));

/** NOW for every phone, after checking the walk's invariants. */
function checkpoint(n: Night, label: string): Record<string, string> {
  const sim = n.sim;
  const now: Record<string, string> = {};
  const guests = [...sim.persons.keys()];
  for (const g of guests) {
    const obs = guestView(sim, g).objectives ?? [];
    expect(obs.length, `${label}: ${g} has no live objective`).toBeGreaterThan(0);
    for (const o of obs) expect(interactionButtons(o.buttons).length, `${label}: ${g} ${o.id}`).toBeLessThanOrEqual(3);
    now[g] = obs[0]!.id;
  }
  for (const p of PERFORMERS) {
    const host = HOST_PARTS.has(p);
    const obs = primeView(sim, p, undefined, { host }).objectives ?? [];
    expect(obs.length, `${label}: ${p} has no live objective`).toBeGreaterThan(0);
    for (const o of obs) expect(interactionButtons(o.buttons).length, `${label}: ${p} ${o.id}`).toBeLessThanOrEqual(3);
    const head = obs[0]!;
    // Every face button of NOW is live on at least one guest's card.
    const live = new Set(guests.flatMap((g) => guestCardView(sim, n.chat.all(), p, g, host)?.live ?? []));
    for (const b of interactionButtons(head.buttons)) expect(live.has(b), `${label}: ${p}'s NOW ${head.id} offers ${b}, live on nobody's card`).toBe(true);
    now[p] = head.id;
  }
  return now;
}

type Step = [string, (n: Night) => void];
const press = (c: string): Step => [c, (n) => { n.press(c); }];
const by = (c: string, g: string, who: string): Step => [`${who}: ${c} ${g}`, (n) => { n.signal(c, g, undefined, who); }];

/** The night, cue by cue, with the performer presses and a few guests' own
 *  turns (a mark, a capture, Bathroom Mode, a late arrival). */
function nightSteps(ending: "song" | "hand_jive"): Step[] {
  const head: Step[] = [
    ["g7 at the door (uploaded, not scanned)", (n) => { n.upload("g7", "Netscape", null); }],
    ["g8 mid-upload", (n) => { n.take(n.sim.createPerson("g8", "Winamp Classic")); }],
    press("call_to_the_desktop"),
    press("start_the_bingo"),
    ["+20 min", (n) => { n.tick(1201); }],
    press("bingo_time"),
    by("bingo_winner", "g1", "Clippy"),
    by("award_the_ribbon", "g1", "Clippy"),
    by("named_at_bingo", "g4", "Clippy"),
    by("send to the internet", "g4", "Norton Anti-Virus"),
    press("introduce_trabolta"),
    ["g4 finds Gerald", (n) => { n.signal("the simulation completed", "g4"); n.signal("the golden duck", "g4"); }],
    press("start_the_hunt"),
    ["g6 to the bathroom", (n) => { n.signal("go to the bathroom", "g6"); }],
    ["+15 min", (n) => { n.tick(901); }],
    press("first_moment_of_truth"),
    ["g6 back", (n) => { n.signal("back from the bathroom", "g6"); }],
    press("close_the_filing"),
    press("read_the_results"),
    press("spin_the_bottle"),
    ["the bottle lands on g2", (n) => { n.signal("bottle_landed", "g2"); }],
    by("truth_answered", "g2", "Clippy"),
    by("uncertain_answer", "g5", "Clippy"),
    press("read_the_results"),
    press("read_the_results"),
    press("second_hunt_preview"),
    press("start_the_second_hunt"),
    ["+2 min (the Truther Download)", (n) => { n.tick(125); }],
    ["Windows Defender clears g7", (n) => { n.scan("Windows Defender", "g7"); }],
    by("send to the internet", "g5", "McAfee Anti-Virus"),
    press("five_minute_warning"),
    ["check-ins at the door", (n) => { for (const g of ["g1", "g2", "g3", "g4", "g6", "g7"]) n.scan("Norton Anti-Virus", g); }],
    press("summons_closed"),
    press("truth_pong"),
    by("made_the_cup", "g1", "Adobe Acrobat"),
    by("missed_the_cup", "g3", "Adobe Acrobat"),
    by("send to the internet", "g3", "Password Manager"),
    press("round_two_tally"),
    press("trust_chart"),
    press("show_the_rankings"),
    ["the rankings", (n) => { n.signal("praise_the_top"); n.signal("shame_the_bottom"); }],
    by("radio_beans", "g6", "Adobe Acrobat"),
    press("zip_everyone_out"),
    press("trabolta_overshares"),
    press("y2k_clock"),
    ["sides", (n) => { n.take(n.sim.join("g2", "Unlimited Power")); n.take(n.sim.join("g3", "The Way Out")); }],
    ["+30 min", (n) => { n.tick(1801); }],
    press("final_reveal"),
    press("bobbing_for_truth"),
    by("brought_up_the_bag", "g1", "Adobe Acrobat"),
    press("read_truth_txt"),
  ];
  const song: Step[] = [press("the_verdict"), press("start_the_ceremony"), ["🏆", (n) => { n.press("award_most_trusted", "g1"); }]];
  const jive: Step[] = [
    ["the verdict: Grok Prom", (n) => { n.take(n.sim.fireBeat("Grok Prom")); }],
    press("ask_for_advice"),
    ["g1 votes Thwart him", (n) => { n.signal("poll answered", "g1", { choice: "Thwart him", index: 1 }); }],
    press("advice_tally"),
    press("the_hand_jive"),
    press("start_the_ceremony"),
  ];
  return [...head, ...(ending === "song" ? song : jive)];
}

function walk(ending: "song" | "hand_jive"): Array<[string, Record<string, string>]> {
  const n = boot();
  const out: Array<[string, Record<string, string>]> = [["doors", checkpoint(n, "doors")]];
  for (const [label, run] of nightSteps(ending)) {
    run(n);
    out.push([label, checkpoint(n, label)]);
  }
  return out;
}

describe("Trapped in the Internet — wave 13: the objectives, walked through the night", () => {
  it("every guest and every performer has a live objective at every cue, ≤ 3 interaction buttons each, and NOW's buttons are live on somebody's card (the song night)", () => {
    const table = new Map(walk("song"));
    const at = (label: string) => table.get(label)!;
    // Guests at the big moments.
    // The tour is NOW until the house calls the Desktop (its card stays up after).
    expect(at("doors").g1).toBe("Take The Tour");
    expect(at("g7 at the door (uploaded, not scanned)").g7).toBe("Show Your Pass");
    expect(at("g8 mid-upload").g8).toBe("Finish Your Upload");
    expect(at("call_to_the_desktop").g1).toBe("Go To The Desktop");
    expect(at("start_the_bingo").g1).toBe("Play Computer Bingo");
    expect(at("bingo_time").g1).toBe("Bingo Results");
    expect(at("Clippy: named_at_bingo g4").g4).toBe("Go To The Internet");
    expect(at("Norton Anti-Virus: send to the internet g4").g4).toBe("Find Gerald");
    expect(at("introduce_trabolta").g1).toBe("Meet Trabolta");
    expect(at("start_the_hunt").g1).toBe("Find Three Facts");
    expect(at("g6 to the bathroom").g6).toBe("Bathroom Mode On");
    expect(at("first_moment_of_truth").g1).toBe("File Your Facts");
    expect(at("close_the_filing").g1).toBe("The First Moment Of Truth");
    expect(at("second_hunt_preview").g1).toBe("Stay Calm");
    expect(at("start_the_second_hunt").g1).toBe("The Hour");
    expect(at("Windows Defender clears g7").g7).not.toBe("Show Your Pass");
    expect(at("five_minute_warning").g1).toBe("Be At The Desktop");
    expect(at("truth_pong").g1).toBe("Truth Pong");
    expect(at("trust_chart").g1).toBe("Where You Stand");
    expect(at("y2k_clock").g1).toBe("The Y2K Hour");
    expect(at("final_reveal").g1).toBe("The Final Reveal");
    expect(at("bobbing_for_truth").g1).toBe("Bobbing For Truth");
    expect(at("the_verdict").g1).toBe("The Night Is Over");
    expect(at("start_the_ceremony").g1).toBe("The Night Is Over");
    // The booths.
    expect(at("doors")).toMatchObject({ "Norton Anti-Virus": "Door Duty", "Windows Defender": "Hold The Door", Clippy: "Greet The Arrivals", "Task Manager": "The Help Desk", "Adobe Acrobat": "Documents And Printing", "Recycling Bin": "The Porch" });
    expect(at("call_to_the_desktop")).toMatchObject({ "Norton Anti-Virus": "Sweep To The Desktop", Clippy: "Welcome Everyone" });
    expect(at("start_the_bingo")).toMatchObject({ "Norton Anti-Virus": "The Selected Antivirus", "McAfee Anti-Virus": "Patrol The Computer", Clippy: "Welcome Everyone" });
    expect(at("bingo_time")).toMatchObject({ "Norton Anti-Virus": "The Selected Antivirus", Clippy: "Celebrate The Winners", "Task Manager": "The Fake Bingo Card" });
    expect(at("Clippy: named_at_bingo g4")).toMatchObject({ "Norton Anti-Virus": "Escort The Marked", "McAfee Anti-Virus": "Escort The Marked", "Windows Defender": "Hold The Door" });
    expect(at("introduce_trabolta")).toMatchObject({ Clippy: "Introduce Trabolta", "Norton Anti-Virus": "Patrol The Computer" });
    expect(at("first_moment_of_truth")).toMatchObject({ Clippy: "The First Moment Of Truth Host" });
    expect(at("the bottle lands on g2")).toMatchObject({ Clippy: "The Bottle" });
    expect(at("Clippy: uncertain_answer g5")).toMatchObject({ "Norton Anti-Virus": "Escort The Marked" });
    expect(at("+2 min (the Truther Download)")).toMatchObject({ "McAfee Anti-Virus": "Escort The Marked", "CRA Agent Software": "Escort The Marked", "Task Manager": "The Bank" });
    expect(at("McAfee Anti-Virus: send to the internet g5")).toMatchObject({ "McAfee Anti-Virus": "The Exchange", "CRA Agent Software": "The Audit", Clippy: "Keep Everyone Calm" });
    expect(at("five_minute_warning")).toMatchObject({ "Norton Anti-Virus": "Summons Check In", "Task Manager": "Summons Door", "Recycling Bin": "Summons Door", Clippy: "Keep Everyone Calm" });
    expect(at("truth_pong")).toMatchObject({ "Adobe Acrobat": "Judge The Cup", Clippy: "Judge Truth Pong" });
    expect(at("trust_chart")).toMatchObject({ Clippy: "Lead The Applause" });
    expect(at("the rankings")).toMatchObject({ "Adobe Acrobat": "Stand By The Printer" });
    expect(at("y2k_clock")).toMatchObject({ "Norton Anti-Virus": "Patch Bay Watch", "Password Manager": "Patch Bay Watch", Clippy: "No Sides On Air" });
    expect(at("final_reveal")).toMatchObject({ "Norton Anti-Virus": "Blackout Guide", Clippy: "The Final Round" });
    expect(at("read_truth_txt")).toMatchObject({ "Norton Anti-Virus": "Blackout Guide", "Adobe Acrobat": "Hand Over Truth Txt" });
    expect(at("zip_everyone_out")).toMatchObject({ "Norton Anti-Virus": "Zip Everyone Out", g5: "Where You Stand" });
    expect(at("Password Manager: send to the internet g3")).toMatchObject({ g3: "Find Gerald", "Password Manager": "Patrol The Computer" });
    expect(at("bobbing_for_truth")).toMatchObject({ Clippy: "Bob For It", "Adobe Acrobat": "The Bag Of Truth" });
    expect(at("Adobe Acrobat: brought_up_the_bag g1")).toMatchObject({ "Adobe Acrobat": "Hand Over Truth Txt" });
    expect(at("start_the_ceremony")).toMatchObject({ "Norton Anti-Virus": "After The Night", Clippy: "Host The Ceremony", "Windows Defender": "Hold The Door" });
  }, SLOW);

  it("the Grok Prom night: the pickup line, the advice poll and the hand jive", () => {
    const table = new Map(walk("hand_jive"));
    const at = (label: string) => table.get(label)!;
    expect(at("the verdict: Grok Prom")).toMatchObject({ g1: "The Pickup Line", Clippy: "Grok Prom", "Task Manager": "Grok Prom", "Recycling Bin": "Grok Prom" });
    expect(at("ask_for_advice").g1).toBe("Help Or Thwart");
    expect(at("advice_tally")).toMatchObject({ g1: "The Hand Jive", g5: "The Hand Jive", "Norton Anti-Virus": "Banished Too", "Windows Defender": "Hold The Door" });
    expect(at("the_hand_jive").g1).toBe("The Night Is Over");
  }, SLOW);

  it("audiences never cross: a guest sees only Program objectives, Windows Defender only its own, Clippy never a host part's", () => {
    const n = boot();
    const m = n.sim.model;
    const guestIds = new Set([...m.objectives.values()].filter((o) => o.audience.roles.includes("Program")).map((o) => o.id));
    for (const c of TO_Y2K) n.press(c);
    for (const o of guestView(n.sim, "g1").objectives ?? []) expect(guestIds.has(o.id), o.id).toBe(true);
    for (const p of PERFORMERS) for (const o of primeView(n.sim, p).objectives ?? []) expect(guestIds.has(o.id), `${p}: ${o.id}`).toBe(false);
    expect((primeView(n.sim, "Windows Defender").objectives ?? []).map((o) => o.id)).toEqual(["Hold The Door"]);
    for (const o of primeView(n.sim, "Clippy").objectives ?? []) expect(["The Bank", "Summons Door", "The Help Desk"]).not.toContain(o.id);
    // Every objective carries the sign-off marker in the source.
    const src = scenarioFiles("trapped-in-the-internet").find((f) => f.path === "objectives.loom")!.source;
    expect(src.match(/^OBJECTIVE /gmu)!.length).toBe(m.objectives.size);
    expect(src.match(/^\/\/ DRAFT for sign-off\nOBJECTIVE /gmu)!.length).toBe(m.objectives.size);
  }, SLOW);
});

describe("Trapped in the Internet — wave 13: the sign-off sheet", () => {
  it("SIGNOFF-w13.md is a DRAFT that lists every objective", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sheet = readFileSync(join(__dirname, "../examples/trapped-in-the-internet/SIGNOFF-w13.md"), "utf8");
    expect(sheet).toMatch(/DRAFT/u);
    for (const id of Sim.fromSources(SRC).model.objectives.keys()) expect(sheet, id).toContain(`| ${id} |`);
  });
});
