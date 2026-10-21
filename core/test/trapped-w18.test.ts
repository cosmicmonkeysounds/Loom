//! Trapped in the Internet — wave 18 (story lane): the show on the wave 18
//! surface (CONTRACTS C12, A2–A7; DECISIONS B2–B7, B10, Q16, Q26, Q30, S3).
//!
//! - Big moments with exits: the Bingo winner, the ribbon (the winner's and
//!   the house cheer that closes itself), the bottle, the side reveal's
//!   doors, Help / Thwart, the pickup line, the awards, the capture, the
//!   confrontation and the release.
//! - Q30: a mark does not hinder (no restriction, no pin, filing and
//!   check-in allowed); the Antivirus get a WANTED readout and the Wanted
//!   board (`wanted:`), claim / hand back / take over; the scan of a marked
//!   program is the confrontation, the capture stays on 🛡.
//! - Q26: the door queue (`waiting_at_the_door`) and `claim_door`.
//! - Q16: the header's `reinstall:` gate, and after an ending the begin
//!   never captures (a party favour).
//! - B6: Clippy calls the game cues (`by: Clippy`).
//! - The objectives' `go:`, `target:`, `pick:`, `evergreen:`, S3 and the
//!   summons' self check-in; the arrival threads' `archive:`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { callsCue, guestCardView, guestFlags, guestView, isCaller, notePress, primeView, type PrimeView } from "../server/views.ts";
import { EventRuntime, eligibleFor } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { call as harnessCall } from "./w13-fix-harness.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;
const ANTIVIRUS = ["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};

/** A Sim plus the chat the event server would compose from it. */
class Night {
  readonly sim = Sim.fromSources(SRC);
  readonly chat = new ChatStore();
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
  }
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
  press(name: string, subject?: string): ChatMessage[] {
    return this.signal(name, subject);
  }
  scan(scanner: string, id: string): ChatMessage[] {
    return this.take(this.sim.scan(scanner, id));
  }
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
}

const PROGRAMS: [string, string][] = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];
const TO_BINGO = ["call_to_the_desktop", "start_the_bingo", "bingo_time"];
const TO_TRUTH_1 = [...TO_BINGO, "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"];
const TO_HOUR = [...TO_TRUTH_1, "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"];
const TO_OVERSHARE = [...TO_HOUR, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares"];
const TO_Y2K = [...TO_OVERSHARE, "y2k_clock"];

function boot(): Night {
  const n = new Night();
  for (const [id, name] of PROGRAMS) n.upload(id, name);
  return n;
}
const to = (ms: readonly ChatMessage[], id: string) => ms.filter((m) => m.audience === "all" || (Array.isArray(m.audience) && m.audience.includes(id)));
const bigFor = (ms: readonly ChatMessage[], id: string) => to(ms, id).filter((m) => m.moment === "big");
const readouts = (ms: readonly ChatMessage[], who: string) => ms.filter((m) => m.channel === `dm:${who}` && m.readout === true);

describe("Trapped in the Internet — wave 18: big moments with their exits (C12)", () => {
  it("Bingo: the winner's 🎱 and 🎀 are big; the house cheer is big, to everyone, and closes itself after 6 s", () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    const win = n.signal("bingo_winner", "g1", undefined, "Clippy");
    expect(bigFor(win, "g1").map((m) => m.text)).toEqual(["🎱 BINGO! Name the program for each square, from memory. Centre square last."]);
    // NM-F1: the win carries its way there and the card (never just "Collect ✓").
    expect(bigFor(win, "g1")[0]!.go).toEqual([
      { kind: "room", id: "loc:The Desktop", label: "🎱 To the Desktop" },
      { kind: "quests", quest: "The Bingo Card", label: "See the quest" },
    ]);
    const rib = n.signal("award_the_ribbon", "g1", undefined, "Clippy");
    const medal = bigFor(rib, "g1").find((m) => m.text.startsWith("🎀 You won the Bingo Ribbon"))!;
    expect(medal).toMatchObject({ audience: ["g1"], go: [{ kind: "codex", entry: "Computer Bingo" }] });
    expect(medal.autoClose).toBeUndefined();
    const cheer = rib.find((m) => m.text === "🎀 Calculator won the Bingo Ribbon! Cheer for them at the Desktop.")!;
    expect(cheer).toMatchObject({ moment: "big", autoClose: 6000, audience: "all" });
    // The winner's medal comes first (the moments queue in arrival order).
    expect(rib.indexOf(medal)).toBeLessThan(rib.indexOf(cheer));
    // A ribbon for a program with no Bingo stays a folded ~ notice.
    const plain = n.signal("award_the_ribbon", "g2", undefined, "Clippy");
    expect(bigFor(plain, "g3")).toEqual([]);
  }, SLOW);

  it("the bottle, Help / Thwart and the pickup line are big cards; the awards and the banishment are big with the way there", () => {
    const n = boot();
    for (const c of [...TO_TRUTH_1, "close_the_filing", "read_the_results", "spin_the_bottle"]) n.press(c);
    const bottle = n.signal("bottle_landed", "g2");
    expect(bigFor(bottle, "g2").find((m) => m.kind === "widget")).toMatchObject({ widget: { kind: "poll" }, channel: "dm:Trabolta", go: [{ kind: "dm", id: "dm:Trabolta" }] });
    n.signal("truth_answered", "g2", undefined, "Clippy");
    for (const c of ["read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt", "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares", "y2k_clock", "final_reveal", "bobbing_for_truth"]) n.press(c);
    n.signal("brought_up_the_bag", "g1", undefined, "Clippy");
    n.press("read_truth_txt");
    const grok = n.take(n.sim.fireBeat("Grok Prom"));
    expect(bigFor(grok, "g1").filter((m) => m.kind === "widget" && m.widget?.kind === "answer")).toHaveLength(1);
    const advice = n.press("ask_for_advice");
    const poll = bigFor(advice, "g1").find((m) => m.kind === "widget" && m.text === "Will you help Trabolta win Sandy?")!;
    expect(poll).toBeDefined();
    expect(poll.go?.some((t) => t.kind === "room" && t.id === "lobby")).not.toBe(true);
    n.signal("poll answered", "g1", { choice: "Thwart him", index: 1 });
    const banish = n.press("advice_tally");
    const storm = banish.find((m) => m.text.startsWith("⛈ Trabolta is banishing EVERY program"))!;
    expect(storm).toMatchObject({ moment: "big", go: [{ kind: "room", id: "loc:The Internet" }] });
    const jive = n.press("the_hand_jive");
    expect(bigFor(jive, "g1").map((m) => m.text)).toContain("🕺 The hand jive broke his hold. You are out of the Internet.");
    n.press("start_the_ceremony");
    const award = n.press("award_most_trusted", "g3");
    expect(bigFor(award, "g3").find((m) => m.text.startsWith("🏆 You won Most Trusted!"))).toMatchObject({ go: [{ kind: "room", id: "loc:The Desktop" }] });
  }, SLOW);

  it("the side reveal: every pool program gets the big `sides` doors in the Truther Download's thread; the leaders do not", () => {
    const n = boot();
    for (const c of TO_OVERSHARE) n.press(c);
    const y2k = n.press("y2k_clock");
    const doors = (id: string) => to(y2k, id).filter((m) => m.kind === "widget" && m.widget?.kind === "sides");
    for (const g of ["g1", "g4", "g5", "g6"]) {
      expect(doors(g), g).toHaveLength(1);
      expect(doors(g)[0], g).toMatchObject({ moment: "big", channel: "dm:Truther Download" });
    }
    expect(doors("g2")).toEqual([]); // Microsoft Excel leads Unlimited Power
    expect(doors("g3")).toEqual([]); // OpenOffice leads The Way Out
    // The alert itself sends them to the Sides screen and their orders.
    const alert = y2k.find((m) => m.text.startsWith("🕚 SYSTEM CLOCK RESET"))!;
    expect(alert.go).toEqual([{ kind: "sides", label: "Choose a side" }, { kind: "dm", id: "dm:Truther Download", label: "Open Truther Download" }]);
  }, SLOW);

  it("an ending closes a doors card still up: a closing card supersedes it; an answered one gets none (recheck N5)", () => {
    const n = boot();
    for (const c of TO_Y2K) n.press(c);
    // g1 walks through a door; g4 leaves the card up all night.
    n.signal("sides answered", "g1", { side: "Unlimited Power" });
    const end = n.take(n.sim.setVar("Night.ended", "true"));
    const closing = (id: string) => to(end, id).filter((m) => m.kind === "widget" && m.widget?.kind === "sides");
    expect(closing("g4")).toHaveLength(1);
    expect(closing("g4")[0]).toMatchObject({ channel: "dm:Truther Download", widget: { params: { closed: "true" } } });
    expect(closing("g4")[0]!.moment).toBeUndefined();
    expect(closing("g1")).toEqual([]);
  }, SLOW);

  it("no house alert sends a phone to the lobby; the night's alerts carry their place", () => {
    const n = boot();
    const all: ChatMessage[] = [];
    for (const c of TO_Y2K) all.push(...n.press(c));
    for (const m of all) for (const t of m.go ?? []) expect(t.kind === "room" && t.id === "lobby", m.text).toBe(false);
    const want: Array<[RegExp, string]> = [
      [/^📣 ALL PROGRAMS: report to the Desktop/u, "room"],
      [/^🎱 COMPUTER BINGO has begun/u, "quests"],
      [/^🤖 TRABOLTA IS ONLINE/u, "dm"],
      [/^🔎 THE TRUTH SCAVENGER HUNT/u, "quests"],
      [/^⏳ FIVE MINUTES\. Be in the Desktop and scan its check-in QR/u, "scan"],
      [/^🏓 TRUTH PONG/u, "room"],
    ];
    for (const [re, kind] of want) {
      const m = all.find((x) => re.test(x.text));
      expect(m, String(re)).toBeDefined();
      expect(m!.go?.[0]?.kind, String(re)).toBe(kind);
    }
    expect(all.find((m) => m.text.startsWith("⏳ FIVE MINUTES"))!.go![0]).toEqual({ kind: "scan", label: "📷 Check in" });
  }, SLOW);
});

describe("Trapped in the Internet — wave 18 fixes (GN-F5, GN-F13)", () => {
  it("⏰ Bingo time calls every phone back to the Desktop", () => {
    const n = boot();
    for (const c of TO_BINGO.slice(0, -1)) n.press(c);
    const out = n.press("bingo_time");
    const call = to(out, "g5").find((m) => m.text.startsWith("⏰ BINGO TIME"))!;
    expect(call).toMatchObject({ audience: "all", alert: true, go: [{ kind: "room", id: "loc:The Desktop" }] });
  }, SLOW);

  it("hunt 2's hour is a guest countdown until the summons", () => {
    const n = boot();
    for (const c of TO_HOUR) n.press(c);
    const cds = guestView(n.sim, "g1").countdowns ?? [];
    expect(cds.map((c) => c.label)).toContain("Hunt 2 ends");
  }, SLOW);
});

describe("Trapped in the Internet — wave 18: marked is not hindered; the confrontation (Q30, B2–B4)", () => {
  it("a mark: no restriction, no pin, a minor heads-up; the four Antivirus get a big WANTED readout naming the guest", () => {
    const n = boot();
    for (const c of TO_TRUTH_1) n.press(c);
    const mk = n.signal("uncertain_answer", "g5", undefined, "Clippy");
    expect(v(n.sim, "g5.marked")).toBe(true);
    expect(n.sim.isRestricted("g5")).toBe(false);
    expect(mk.some((m) => m.pin !== undefined)).toBe(false);
    const heads = to(mk, "g5").filter((m) => m.text.startsWith("🚨 You are marked for reinstallation"));
    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatchObject({ moment: "minor" });
    // NM-F1: the heads-up has buttons: the pass and what happens now.
    expect(heads[0]!.go).toEqual([
      { kind: "pass", label: "🎟 Show my pass" },
      { kind: "mission", label: "What happens now?" },
    ]);
    for (const who of ANTIVIRUS) {
      const r = readouts(mk, who).find((m) => m.text.startsWith("🚨 Winamp is marked for reinstallation (was not sure of an answer)"))!;
      expect(r, who).toMatchObject({ moment: "big", alert: true, about: "g5", aboutName: "Winamp" });
    }
    // Every guest button stays; filing and check-in work.
    expect(guestView(n.sim, "g5").interactions.map((i) => i.id)).toContain("go to the bathroom");
    n.signal("checked_in", "g5", { at: "The Start Bar" });
    expect(v(n.sim, "g5.checked_in")).toBe("The Start Bar");
    // The phone's NOW stays the phase's; "You Are Marked" sits under it.
    const ids = (guestView(n.sim, "g5").objectives ?? []).map((o) => o.id);
    expect(ids[0]).toBe("File Your Facts");
    expect(ids).toContain("You Are Marked");
  }, SLOW);

  it("the claim: 🙋 names the Antivirus; the others cannot claim, may take over; Hand it back clears it; 🩹 clears it too", () => {
    const n = boot();
    for (const c of TO_TRUTH_1) n.press(c);
    n.signal("uncertain_answer", "g5", undefined, "Clippy");
    expect(v(n.sim, "g5.escort_by")).toBe("none");
    const live = (who: string, id: string) => guestCardView(n.sim, n.chat.all(), who, "g5", false)!.live.includes(id);
    for (const who of ANTIVIRUS) expect(live(who, "claim_escort"), who).toBe(true);
    const mine = n.signal("claim_escort", "g5", undefined, "McAfee Anti-Virus");
    expect(v(n.sim, "g5.escort_by")).toBe("McAfee Anti-Virus");
    expect(readouts(mine, "McAfee Anti-Virus").map((m) => m.text)).toEqual(["🙋 Winamp is yours. Find them and scan their pass: the scan is the confrontation."]);
    expect(live("Norton Anti-Virus", "claim_escort")).toBe(false);
    expect(live("Norton Anti-Virus", "take_over_escort")).toBe(true);
    expect(live("McAfee Anti-Virus", "release_escort")).toBe(true);
    expect(live("McAfee Anti-Virus", "take_over_escort")).toBe(false);
    // A second claim changes nothing.
    n.signal("claim_escort", "g5", undefined, "Norton Anti-Virus");
    expect(v(n.sim, "g5.escort_by")).toBe("McAfee Anti-Virus");
    n.signal("take_over_escort", "g5", undefined, "Norton Anti-Virus");
    expect(v(n.sim, "g5.escort_by")).toBe("Norton Anti-Virus");
    n.signal("release_escort", "g5", undefined, "Norton Anti-Virus");
    expect(v(n.sim, "g5.escort_by")).toBe("none");
    n.signal("claim_escort", "g5", undefined, "CRA Agent Software");
    n.signal("unmark_for_reinstallation", "g5", undefined, "Task Manager");
    expect(v(n.sim, "g5.marked")).toBe(false);
    expect(v(n.sim, "g5.escort_by")).toBe("none");
  }, SLOW);

  it("the scan of a marked program is the confrontation: big on both sides, during the summons too; 🛡 still captures; the capture is big", () => {
    const n = boot();
    for (const c of TO_HOUR) n.press(c);
    n.signal("mark_for_reinstallation", "g6", { reason: "a test" });
    n.press("five_minute_warning");
    const scan = n.scan("Password Manager", "g6");
    // Not a check-in: the confrontation.
    expect(v(n.sim, "g6.summons_ok")).not.toBe(true);
    expect(n.sim.isCaptured("g6")).toBe(false);
    expect(bigFor(scan, "g6").map((m) => m.text)).toContain("🛡 CORRUPTION DETECTED. Password Manager has found you. Stay with them: you are going to the Internet.");
    const said = to(scan, "g6").filter((m) => m.channel === "dm:Password Manager" && !m.readout).map((m) => m.text);
    expect(said.some((t) => t.includes("Come with me through the Tube to the Internet."))).toBe(true);
    const booth = readouts(scan, "Password Manager").find((m) => m.text.startsWith("🛡 Corruption detected: VLC (a test)"))!;
    expect(booth).toMatchObject({ moment: "big", about: "g6", aboutName: "VLC" });
    // An unmarked scan during the summons is still a check-in.
    n.scan("Password Manager", "g1");
    expect(v(n.sim, "g1.summons_ok")).toBe(true);
    // 🛡: the capture, big, with the way there; CAUGHT BY the pressing Antivirus.
    const cap = n.signal("send to the internet", "g6", undefined, "Password Manager");
    expect(n.sim.isCaptured("g6")).toBe(true);
    expect(v(n.sim, "g6.escort_by")).toBe("Password Manager");
    const sent = bigFor(cap, "g6").find((m) => m.text.startsWith("🌐 Sent to the Internet"))!;
    expect(sent.go).toEqual([{ kind: "room", id: "loc:The Internet", label: "Go to The Internet" }, { kind: "pass", label: "Show my pass" }]);
    expect(cap.some((m) => /mark is lifted/u.test(m.text))).toBe(false);
    // The release is big too.
    const out = n.signal("the simulation completed", "g6");
    expect(bigFor(out, "g6").map((m) => m.text)).toContain("🦆 Reinstallation complete. You can follow instructions. Welcome back to the computer.");
  }, SLOW);

  it("🛡 and ✅ are on a card only when they apply (A6)", () => {
    const n = boot();
    for (const c of TO_TRUTH_1) n.press(c);
    const live = (g: string) => guestCardView(n.sim, n.chat.all(), "Norton Anti-Virus", g, false)!.live;
    expect(live("g1")).not.toContain("send to the internet");
    expect(live("g1")).not.toContain("mark as reinstalled");
    n.signal("uncertain_answer", "g1", undefined, "Clippy");
    expect(live("g1")).toContain("send to the internet");
    n.signal("send to the internet", "g1", undefined, "Norton Anti-Virus");
    expect(live("g1")).not.toContain("send to the internet");
    expect(live("g1")).toContain("mark as reinstalled");
  }, SLOW);
});

describe("Trapped in the Internet — wave 18: the door without Windows Defender (Q26, B5)", () => {
  it("an upload rings the door queue on all four Antivirus; 🙋 claims it; the flag shows; a cleared program can't be claimed", () => {
    const n = new Night();
    const up = n.upload("g1", "Calculator", null);
    for (const who of ANTIVIRUS) {
      const r = readouts(up, who).find((m) => m.text === "🚪 Calculator is waiting at the Optical Drive.")!;
      expect(r, who).toMatchObject({ moment: "big", about: "g1", aboutName: "Calculator" });
    }
    expect(guestCardView(n.sim, n.chat.all(), "Norton Anti-Virus", "g1", false)!.live).toContain("claim_door");
    n.signal("claim_door", "g1", undefined, "Norton Anti-Virus");
    expect(v(n.sim, "g1.door_by")).toBe("Norton Anti-Virus");
    n.signal("claim_door", "g1", undefined, "McAfee Anti-Virus");
    expect(v(n.sim, "g1.door_by")).toBe("Norton Anti-Virus");
    expect(guestFlags(n.sim, "g1").some((f) => f.label === "At the door" && f.value === "Norton Anti-Virus")).toBe(true);
    n.scan("McAfee Anti-Virus", "g1");
    expect(v(n.sim, "g1.cleared")).toBe(true);
    expect(guestCardView(n.sim, n.chat.all(), "Norton Anti-Virus", "g1", false)!.live).not.toContain("claim_door");
    // BN-F16: cleared, the door is done with them: no "At the door" flag.
    expect(guestFlags(n.sim, "g1").some((f) => f.label === "At the door" && f.on)).toBe(false);
  });
});

describe("Trapped in the Internet — wave 18: the reinstallation gate and the party favour (C7, Q16)", () => {
  it("`reinstall:` lets in the marked and the captured; after an ending everyone, and the begin never captures", () => {
    const n = boot();
    expect(n.sim.model.reinstall).toContain("Night.ended");
    expect(eligibleFor(n.sim, "g1")).toBe(false);
    n.sim.restrict("g1"); // a director's restriction is no longer a ticket
    expect(eligibleFor(n.sim, "g1")).toBe(false);
    n.sim.unrestrict("g1");
    n.signal("mark_for_reinstallation", "g2", { reason: "a test" });
    expect(eligibleFor(n.sim, "g2")).toBe(true);
    n.signal("send to the internet", "g3", undefined, "Norton Anti-Virus");
    expect(eligibleFor(n.sim, "g3")).toBe(true);
    n.take(n.sim.setVar("Night.ended", "true"));
    expect(eligibleFor(n.sim, "g1")).toBe(true);
    // A marked program's party-favour run: no capture.
    n.signal("reinstallation begun", "g2");
    expect(n.sim.isCaptured("g2")).toBe(false);
    // The tent tablet says so.
    const tablet = n.sim.scan("The Tablet", "g1");
    expect(tablet.some((e) => e.type === "dialogue" && (e as { text: string }).text.includes("a party favour"))).toBe(true);
    expect(n.sim.isCaptured("g1")).toBe(false);
    expect(v(n.sim, "g1.doubt")).toBe(0);
  }, SLOW);
});

describe("Trapped in the Internet — wave 18: Clippy calls the games (B6, Q2)", () => {
  it("`by: Clippy` on the game cues only, never the doors, the clock or Trabolta", () => {
    const m = Sim.fromSources(SRC).model;
    expect(isCaller(m, "Clippy")).toBe(true);
    for (const id of ["start_the_bingo", "bingo_time", "start_the_hunt", "first_moment_of_truth", "close_the_filing", "read_the_results", "spin_the_bottle", "bobbing_for_truth", "clippy_reads_summary", "start_the_ceremony", "award_most_trusted", "award_the_painting"]) {
      expect(callsCue(m, "Clippy", id), id).toBe(true);
    }
    for (const id of ["call_to_the_desktop", "introduce_trabolta", "y2k_clock", "five_minute_warning", "truth_pong", "restore_the_king", "resurrection", "the_verdict"]) expect(callsCue(m, "Clippy", id), id).toBe(false);
    for (const who of ["Task Manager", "Norton Anti-Virus"]) expect(isCaller(m, who), who).toBe(false);
  });
});

describe("Trapped in the Internet — wave 18: objectives (C5, C11, A5, A7, S3, B10)", () => {
  const nowOf = (n: Night, g: string) => guestView(n.sim, g).objectives?.[0]?.id;
  const placeOf = (n: Night, g: string) => guestView(n.sim, g).mission?.place ?? null;

  it("the guest's mission names its place: the Desktop, a thread, the quest log, the scan, the Cloud, the sides", () => {
    const n = boot();
    n.press("call_to_the_desktop");
    expect(placeOf(n, "g1")).toEqual({ id: "loc:The Desktop", name: "The Desktop" });
    for (const c of ["start_the_bingo", "bingo_time", "introduce_trabolta"]) n.press(c);
    expect(placeOf(n, "g1")?.id).toBe("dm:Trabolta");
    n.press("start_the_hunt");
    expect(placeOf(n, "g1")?.id).toBe("quests");
    for (const c of ["hunt_time_up", "first_moment_of_truth", "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"]) n.press(c);
    n.press("five_minute_warning");
    expect(nowOf(n, "g1")).toBe("Be At The Desktop");
    expect(placeOf(n, "g1")).toEqual({ id: "scan", name: "📷 Check in" });
    // The Desktop's check-in QR is the check-in (no staff scan).
    n.signal("checked_in", "g1", { at: "The Desktop" });
    expect(v(n.sim, "g1.summons_ok")).toBe(true);
    for (const c of ["summons_closed", "truth_pong"]) n.press(c);
    expect(placeOf(n, "g1")?.id).toBe("loc:The Cloud");
    for (const c of ["round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares", "y2k_clock"]) n.press(c);
    expect(placeOf(n, "g1")?.id).toBe("sides");
  }, SLOW);

  it("S3: the NOW follows the Trust Chart → the beans → the zip → the overshare", () => {
    const n = boot();
    for (const c of [...TO_HOUR, "five_minute_warning"]) n.press(c);
    for (const [g] of PROGRAMS) n.signal("checked_in", g, { at: "The Desktop" });
    for (const c of ["summons_closed", "truth_pong", "round_two_tally", "trust_chart"]) n.press(c);
    expect(nowOf(n, "g1")).toBe("Where You Stand");
    n.press("show_the_rankings");
    n.signal("praise_the_top");
    n.signal("shame_the_bottom");
    n.press("printer_opened");
    expect(nowOf(n, "g1")).toBe("Full Of Beans");
    n.press("zip_everyone_out");
    expect(nowOf(n, "g1")).toBe("Zipped Out");
    n.press("trabolta_overshares");
    expect(nowOf(n, "g1")).toBe("The Overshare");
  }, SLOW);

  it("the booths' pickers: Celebrate's steps and the Desktop's programs, the bottle's target, the cup-makers, Still missing", () => {
    const n = boot();
    const obj = (who: string, id: string) => primeView(n.sim, who).objectives?.find((o) => o.id === id);
    for (const c of TO_BINGO) n.press(c);
    for (const [g] of PROGRAMS) n.signal("checked_in", g, { at: "The Desktop" });
    const cel = obj("Clippy", "Celebrate The Winners")!;
    expect(cel.buttons).toEqual(["bingo_winner", "award_the_ribbon", "named_at_bingo"]);
    expect(cel.checklist.map((c) => c.label.slice(0, 2))).toEqual(["🎱", "🎀", "🎯", "Th"]);
    expect([...(cel.pick ?? [])].sort()).toEqual(PROGRAMS.map(([g]) => g).sort());
    // The bottle names its program.
    for (const c of ["introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth", "close_the_filing", "read_the_results", "spin_the_bottle"]) n.press(c);
    n.signal("bottle_landed", "g4");
    expect(obj("Clippy", "The Bottle")?.target).toMatchObject({ id: "g4", name: "MS Paint" });
    n.signal("truth_answered", "g4", undefined, "Clippy");
    for (const c of ["read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt", "five_minute_warning"]) n.press(c);
    n.signal("checked_in", "g1", { at: "The Desktop" });
    n.signal("go to the bathroom", "g2");
    const missing = obj("Task Manager", "Summons Door")!;
    expect(missing.buttons).toEqual(["check_in_at_desktop"]);
    expect([...(missing.pick ?? [])].sort()).toEqual(["g3", "g4", "g5", "g6"]);
    expect(obj("Norton Anti-Virus", "Summons Check In")?.pick?.length).toBe(4);
    n.signal("back from the bathroom", "g2");
    for (const g of ["g2", "g3", "g4", "g5", "g6"]) n.signal("checked_in", g, { at: "The Desktop" });
    for (const c of ["summons_closed", "truth_pong"]) n.press(c);
    expect([...(obj("Adobe Acrobat", "Judge The Cup")?.pick ?? [])].sort()).toEqual(PROGRAMS.map(([g]) => g).sort());
    n.signal("made_the_cup", "g1", undefined, "Adobe Acrobat");
    n.signal("missed_the_cup", "g2", undefined, "Adobe Acrobat");
    expect(obj("Adobe Acrobat", "Judge The Cup")?.pick).not.toContain("g1");
    expect(obj("Adobe Acrobat", "Judge The Cup")?.pick).not.toContain("g2");
    expect(obj("Clippy", "Judge Truth Pong")?.pick).toEqual(["g1"]);
  }, SLOW);

  it("the evergreen fallbacks; no staff objective puts the scan on the summons; no copy tells anyone to radio the director", () => {
    const m = Sim.fromSources(SRC).model;
    const ever = [...m.objectives.values()].filter((o) => o.evergreen).map((o) => o.id).sort();
    expect(ever).toEqual(["Disk Cleanup", "Documents And Printing", "Explore The Computer", "Help With That", "Patrol The Computer", "The Help Desk"]);
    for (const id of ["Summons Check In", "Summons Door"]) expect(m.objectives.get(id)!.buttons, id).not.toContain("scan");
    const text = [...m.objectives.values()].map((o) => `${o.title} ${o.brief} ${o.checklist.map((c) => c.label).join(" ")}`).join("\n");
    expect(text.length).toBeGreaterThan(1000);
    expect(text).not.toMatch(/radio the director|director radios|ask the director|agree by radio/iu);
  });
});

describe("Trapped in the Internet — wave 18: the arrival threads fold away (C11 `archive:`)", () => {
  it("the Uploader's and the clearing Antivirus' threads archive once cleared; a featured program keeps the Uploader; a mark brings the Antivirus back", () => {
    const n = boot();
    const arch = (g: string) => guestView(n.sim, g).archived ?? [];
    expect(arch("g1")).toEqual(expect.arrayContaining(["dm:The Uploader", "dm:Norton Anti-Virus"]));
    expect(arch("g2")).not.toContain("dm:The Uploader"); // Microsoft Excel's profile came back there
    n.press("call_to_the_desktop");
    n.signal("mark_for_reinstallation", "g1", { reason: "a test" });
    expect(arch("g1")).not.toContain("dm:Norton Anti-Virus");
    expect(arch("g1")).toContain("dm:The Uploader");
  });
});

describe("Trapped in the Internet — wave 18 on the event server: the Wanted board", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const CODES = { event: "EVT918", prime: "PRM918", mod: "MOD918" };
  const call = (rt: EventRuntime, method: "GET" | "POST", path: string, body: Record<string, unknown> = {}, moderator = false) =>
    harnessCall(rt, method, path, body, moderator ? { moderator: true, moderatorName: "Ada" } : {});

  it("a mark lights the four Antivirus booths' board; the claim names the hunter; Clippy's booth has none", { timeout: SLOW }, async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-trapped-w18-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "trapped-in-the-internet", scenarioSource: SRC, joinBase: () => "http://localhost" });
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
    expect(g.status).toBe(200);
    const id = g.json["id"] as string;
    expect((await call(rt, "POST", "/api/mod/signal", { name: "mark_for_reinstallation", subject: id, args: { reason: "a test" } }, true)).status).toBe(200);
    const view = async (who: string) => (await call(rt, "GET", `/api/state?role=prime&as=${encodeURIComponent(who)}`, {}, true)).json as unknown as PrimeView;
    for (const who of ANTIVIRUS) {
      const w = (await view(who)).wanted;
      expect(w?.map((x) => [x.id, x.reason, x.claimedBy]), who).toEqual([[id, "a test", null]]);
    }
    expect((await view("Clippy")).wanted).toBeUndefined();
    const login = await call(rt, "POST", "/api/prime/login", { character: "Norton Anti-Virus", passcode: CODES.prime });
    const token = login.json["token"] as string;
    expect((await call(rt, "POST", "/api/prime/act", { token, name: "claim_escort", guest: id })).status).toBe(200);
    expect((await view("McAfee Anti-Virus")).wanted?.[0]?.claimedBy).toBe("Norton Anti-Virus");
    // The guest's own view: not restricted, a mission with its place.
    const gv = (await call(rt, "GET", `/api/state?role=guest&as=${encodeURIComponent(id)}`, {}, true)).json as unknown as { restricted?: boolean; mission?: { objective: string | null } };
    expect(gv.restricted).not.toBe(true);
    expect(gv.mission?.objective).toBeTruthy();
    // The reinstallation gate lets the marked program in.
    const begin = await call(rt, "POST", "/api/mod/spatial/begin", { guest: id, world: "web", device: "Tent tablet" }, true);
    expect(begin.status).toBe(200);
    rt.dispose();
  });
});

// Integration (wave 18): the Sides screen's leaders and head counts, and the
// leaders' recruiting quests counting each recruit by pass.
describe("Trapped in the Internet — wave 18: side leaders, the majority and recruits", () => {
  it("the Sides screen names each side's leader and the half + 1 it needs", () => {
    const n = boot();
    for (const c of TO_HOUR) n.press(c);
    n.signal("truther_download"); // two minutes into hunt 2 (its watcher, on the clock)
    for (const g of ["g2", "g3"]) n.take(n.sim.choose(g, 0)); // the leaders' glitch choices
    for (const c of TO_Y2K.slice(TO_HOUR.length)) n.press(c);
    const sides = guestView(n.sim, "g1").sides ?? [];
    const by = Object.fromEntries(sides.map((s) => [s.name, s]));
    expect(by["Unlimited Power"]).toMatchObject({ leader: "Microsoft Excel" });
    expect(by["The Way Out"]).toMatchObject({ leader: "OpenOffice" });
    // Six programs here: a majority is four (4 × 2 > 6).
    expect(by["Unlimited Power"]!.needs).toBe(4);
    expect(by["The Way Out"]!.needs).toBe(4);
  }, SLOW);

  it("a recruit by pass is a step on the leader's quest; a recruit to the other side is not", () => {
    const n = boot();
    for (const c of TO_HOUR) n.press(c);
    n.signal("truther_download"); // two minutes into hunt 2 (its watcher, on the clock)
    for (const g of ["g2", "g3"]) n.take(n.sim.choose(g, 0)); // the leaders' glitch choices
    for (const c of TO_Y2K.slice(TO_HOUR.length)) n.press(c);
    const recruit = (by: string, to: string, side: string) => {
      n.take(n.sim.crew({ op: "recruit", by, to, side }));
      const inv = n.sim.crews.allInvites().filter((i) => i.to === to && i.state === "open").pop()!;
      return n.take(n.sim.crew({ op: "recruitAnswer", id: inv.id, yes: true }));
    };
    const step = (ms: ChatMessage[], who: string) => to(ms, who).filter((m) => m.channel === "quests").map((m) => m.text);
    const a = recruit("g2", "g5", "Unlimited Power");
    expect(v(n.sim, "g2.recruits")).toBe(1);
    expect(step(a, "g2").some((t) => t.includes("Winamp walked through your door. Recruited by pass: 1."))).toBe(true);
    const b = recruit("g3", "g6", "The Way Out");
    expect(v(n.sim, "g3.recruits")).toBe(1);
    expect(v(n.sim, "g2.recruits")).toBe(1);
    expect(step(b, "g2")).toEqual([]);
  }, SLOW);

  it("every house line that names a winner leads with a win glyph (the TV and the walls cheer only those)", () => {
    const lines = [...SRC.matchAll(/broadcast "([^"]*)" to everyone/gu)].map((m) => m[1]!.replace(/^[!~]+/u, "").trim());
    const wins = lines.filter((l) => /\b(won|wins|winner|winners)\b/iu.test(l));
    expect(wins.length).toBeGreaterThan(0);
    for (const l of wins) expect(/^(🎀|🏆|🥇|🏅|🎉|🎊|👑|🥳)/u.test(l), l).toBe(true);
  });
});
