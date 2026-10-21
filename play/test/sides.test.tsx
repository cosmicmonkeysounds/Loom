//! Wave 18 (GUEST-SPEC §9, DECISIONS F1–F4, CONTRACTS C10): the sides a
//! guest sees, what each side's card offers, the doors, the invite card,
//! recruiting by pass and founding a crew — against the C10 fields, with an
//! old server's `factions` as the fallback.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SidesContext } from "../src/sides/context.ts";
import { DeferredAnswer, Doors, answeredSide, doorTap, doorWords } from "../src/sides/doors.tsx";
import { InviteCard } from "../src/sides/invite.tsx";
import { FoundCrewSheet, RecruitAnswerSheet, RecruitSheet, SidesSheet } from "../src/sides/index.tsx";
import {
  countLine,
  crewNameOk,
  crewRefusal,
  crewRoom,
  factionAction,
  factionCountLine,
  factionModeOf,
  factionsOffered,
  hasSidesOrCrew,
  inviteDone,
  inviteLeaveLine,
  inviteOf,
  joinFaction,
  leaveFaction,
  leaveQuestion,
  recruitOffer,
  recruitRefusal,
  sideAction,
  sidesLabelOf,
  sidesOf,
  switchQuestion,
  whoLine,
} from "../src/sides/model.ts";
import { stayNote } from "../src/sides/stay.ts";
import { guestStartItems } from "../src/guest/frame.tsx";
import { INVITE_WIDGET, SIDES_WIDGET, registerGuestWidget } from "../src/sides/widgets.tsx";
import { WIDGETS, cardAsks } from "../src/widgets.tsx";
import type { SidesCalls } from "../src/session/guest.ts";
import type { GuestView, PersonCard } from "../src/types.ts";

const noop = () => {};
const calls: SidesCalls = {
  join: async () => ({}),
  defect: async () => ({}),
  leave: async () => ({}),
  recruit: async () => ({}),
  answer: async () => ({}),
  found: async () => ({ ok: true }),
  invite: async () => ({}),
  leaveCrew: async () => ({ ok: true }),
  joinCrew: async () => ({}),
};

const person = (id: string, name: string, faction: string | null, location: string | null = null): PersonCard => ({ id, name, kind: "guest", faction, known: [], location });

function view(o: Record<string, unknown> = {}): GuestView {
  return {
    id: "g-1",
    name: "Winamp",
    role: null,
    faction: null,
    score: 0,
    location: "The Desktop",
    captured: false,
    pendingChoice: null,
    decisionChannel: null,
    channels: [],
    spaces: [],
    roster: [],
    factions: ["Unlimited Power", "The Way Out"],
    people: [person("g-2", "Netscape Navigator", null, "The CPU"), person("g-3", "Excel", "Unlimited Power")],
    ...o,
  } as GuestView;
}

const SIDES = [
  { id: "unlimited_power", name: "Unlimited Power", leader: "Excel", members: 4, needs: 13, mine: false },
  { id: "the_way_out", name: "The Way Out", leader: "OpenOffice", members: 2, needs: 13, mine: false },
];

describe("the sides a guest sees (F1)", () => {
  it("the server's sides, else the story's names", () => {
    expect(sidesOf(view({ sides: SIDES })).map((s) => [s.name, s.leader, s.members, s.needs])).toEqual([
      ["Unlimited Power", "Excel", 4, 13],
      ["The Way Out", "OpenOffice", 2, 13],
    ]);
    expect(sidesOf(view()).map((s) => [s.name, s.leader, s.members])).toEqual([
      ["Unlimited Power", null, null],
      ["The Way Out", null, null],
    ]);
    expect(sidesOf(null)).toEqual([]);
  });

  it("the count line", () => {
    expect(countLine({ members: 4, needs: 13 })).toBe("4 of 13 needed");
    expect(countLine({ members: 4, needs: null })).toBe("4 in");
    expect(countLine({ members: null, needs: null })).toBe("");
  });

  it("what a side's card offers: join, switch, in, leaders stay, restricted", () => {
    const rows = sidesOf(view({ sides: SIDES }));
    expect(sideAction(rows[0]!, view(), rows)).toBe("join");
    const onUp = view({ faction: "Unlimited Power" });
    expect(sideAction(rows[0]!, onUp, rows)).toBe("in");
    expect(sideAction(rows[1]!, onUp, rows)).toBe("switch");
    const leader = view({ name: "Excel", faction: "Unlimited Power" });
    expect(sideAction(rows[0]!, leader, rows)).toBe("leader");
    expect(sideAction(rows[1]!, leader, rows)).toBe("leader");
    expect(sideAction(rows[1]!, view({ restricted: true }), rows)).toBe("restricted");
  });

  it("Sides & crews shows when a side is open or there is a crew", () => {
    expect(hasSidesOrCrew(view({ factions: [] }))).toBe(false);
    expect(hasSidesOrCrew(view())).toBe(true);
    expect(hasSidesOrCrew(view({ factions: [], crew: { id: "crew-1", name: "The Night Shift", founder: "g-1", members: ["g-1"] } }))).toBe(true);
    expect(crewRoom({ id: "crew-1" })).toBe("crew:crew-1");
  });
});

describe("the doors (§9.1)", () => {
  const card = { kind: "sides", text: "🕚 SYSTEM CLOCK RESET\nTwo doors have opened in the computer.", params: {} };
  const render = (o: { answered?: Record<string, string> | null; live?: boolean } = {}) =>
    renderToStaticMarkup(
      createElement(
        SidesContext.Provider,
        { value: { view: view({ sides: SIDES }), calls: o.live === false ? null : calls } },
        createElement(Doors, { card, seed: 9, onAnswer: o.answered ? undefined : noop, answered: o.answered ?? null }),
      ),
    );

  it("two doors with their leader and count, Walk in, and Neither", () => {
    const out = render();
    expect(out).toContain("🕚 SYSTEM CLOCK RESET");
    expect(out).toContain("▣ UNLIMITED POWER");
    expect(out).toContain("led by Excel");
    expect(out).toContain("4 of 13 needed");
    expect((out.match(/Walk in ▸/gu) ?? []).length).toBe(2);
    expect(out).toContain("Neither. I&#x27;ll pursue my own interests.");
    expect(out).toContain("You can switch sides from ⊞ Start → Sides.");
  });

  it("answered: says what was chosen; read-only with no calls", () => {
    expect(render({ answered: { side: "unlimited_power" } })).toContain("You are in Unlimited Power.");
    expect(render({ answered: { side: "neither" } })).toContain("You chose neither.");
    expect(render({ live: false })).toContain("disabled");
  });

  it("a card the server says is answered (no result) names the side the guest is on (N1)", () => {
    const mine = SIDES.map((x) => ({ ...x, mine: x.id === "unlimited_power" }));
    const out = renderToStaticMarkup(
      createElement(SidesContext.Provider, { value: { view: view({ sides: mine }), calls } }, createElement(Doors, { card, seed: 9, answered: {} })),
    );
    expect(out).toContain("You are in Unlimited Power.");
    expect(out).not.toContain("You chose neither.");
    expect(answeredSide(null, SIDES.map((x) => ({ ...x, needs: x.needs })))).toBeNull();
    expect(answeredSide("neither", mine)).toBeNull();
  });

  it("a one-line card splits after its first sentence: the kicker never repeats the headline (GN-F8)", () => {
    expect(doorWords("🕚 SYSTEM CLOCK RESET. Two doors have opened in the computer.")).toEqual({ kicker: "🕚 SYSTEM CLOCK RESET.", say: "Two doors have opened in the computer." });
    expect(doorWords("A\nB")).toEqual({ kicker: "A", say: "B" });
    expect(doorWords("Doors")).toEqual({ kicker: "Doors", say: "Two doors have opened in the computer." });
  });

  it("Walk in's answer is sent once: after the pause, or at once when the doors unmount first (NM-F4)", () => {
    vi.useFakeTimers();
    try {
      const sent: string[] = [];
      const later = new DeferredAnswer();
      later.schedule(() => sent.push("a"), 1200);
      vi.advanceTimersByTime(1199);
      expect(sent).toEqual([]);
      later.flush(); // the big closed under it
      expect(sent).toEqual(["a"]);
      vi.advanceTimersByTime(5000);
      expect(sent).toEqual(["a"]);
      later.schedule(() => sent.push("b"), 1200);
      vi.advanceTimersByTime(1200);
      later.flush();
      expect(sent).toEqual(["a", "b"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("registers as an inline, full-bleed, answerable kind", () => {
    registerGuestWidget("sides", SIDES_WIDGET);
    registerGuestWidget("invite", INVITE_WIDGET);
    expect(WIDGETS["sides"]).toMatchObject({ answerable: true, inline: true, fullBleed: true });
    expect(WIDGETS["invite"]).toMatchObject({ answerable: true, inline: true });
    expect(cardAsks({ kind: "sides", text: "", params: {} })).toBe(true);
  });
});

describe("being recruited: the invite card (§9.4)", () => {
  const inv = { id: "i1", from: "g-3", fromName: "Excel", kind: "side" as const, target: "unlimited_power", targetName: "Unlimited Power" };
  it("names who and where; Not now / Join", () => {
    const out = renderToStaticMarkup(
      createElement(SidesContext.Provider, { value: { view: view({ sides: SIDES, invites: [inv] }), calls } }, createElement(InviteCard, { card: { kind: "invite", text: "", params: { invite: "i1" } }, seed: 3, onAnswer: noop, answered: null })),
    );
    expect(out).toContain("Excel wants you in Unlimited Power");
    expect(out).toContain("4 of 13 needed");
    expect(out).toContain("Not now");
    expect(out).toContain("Join Unlimited Power");
  });
  it("an invitation the view no longer lists reads its params", () => {
    expect(inviteOf(view(), { invite: "i9", fromName: "Ada", targetName: "The Night Shift", kind: "crew" }, "").line).toBe("Ada wants you in The Night Shift");
  });
});

describe("an answered invitation after a reload (M4)", () => {
  const inv = { kind: "side" as const, target: "Unlimited Power", targetName: "Unlimited Power" };
  it("the live view decides: joined, not now, or closed", () => {
    expect(inviteDone(view({ faction: "Unlimited Power" }), inv, {})).toBe("You joined Unlimited Power.");
    expect(inviteDone(view({ sides: SIDES.map((s) => (s.id === "unlimited_power" ? { ...s, mine: true } : s)) }), { ...inv, target: "unlimited_power" }, {})).toBe("You joined Unlimited Power.");
    expect(inviteDone(view({ crew: { id: "crew-1", name: "Night Shift", founder: "g-2", members: ["g-2", "g-1"] } }), { kind: "crew", target: "crew-1", targetName: "Night Shift" }, {})).toBe("You joined Night Shift.");
    expect(inviteDone(view(), inv, { yes: false })).toBe("You said not now.");
    expect(inviteDone(view(), inv, {})).toBe("This invitation is closed.");
  });
});

describe("recruiting by pass (§9.3, F3)", () => {
  it("on a side, scanning someone not on it offers the side", () => {
    const o = recruitOffer(view({ sides: SIDES, faction: "Unlimited Power" }), "g-2");
    expect(o.name).toBe("Netscape Navigator");
    expect(o.sub).toBe("◆ unaligned · The CPU");
    expect(o.side?.label).toBe("🚪 Recruit Netscape Navigator to Unlimited Power");
    expect(o.note).toBeNull();
  });
  it("before the sides open, or unaligned after: says so", () => {
    expect(recruitOffer(view({ factions: [] }), "g-2").note).toBe("That's Netscape Navigator's pass. When the sides open, scan it to recruit them.");
    expect(recruitOffer(view({ sides: SIDES }), "g-2").note).toBe("Join a side first, then scan Netscape Navigator's pass to recruit them.");
  });
  it("someone already on your side; an unknown pass is this program", () => {
    expect(recruitOffer(view({ sides: SIDES, faction: "Unlimited Power" }), "g-3").note).toBe("Excel is already in Unlimited Power.");
    expect(recruitOffer(view({ sides: SIDES }), "g-404").name).toBe("this program");
  });
  it("with a crew they aren't in: the crew invite too", () => {
    const o = recruitOffer(view({ factions: [], crew: { id: "crew-1", name: "The Night Shift", founder: "g-1", members: ["g-1"] } }), "g-2");
    expect(o.crew?.label).toBe("◇ Invite Netscape Navigator to The Night Shift");
    expect(o.note).toBeNull();
  });
  it("a 409 already names the side; anything else is the server's text", () => {
    expect(recruitRefusal({ status: 409, message: "already on a side" }, "Ada", "The Way Out")).toBe("Ada is already in The Way Out.");
    expect(recruitRefusal({ status: 403, message: "captured" }, "Ada", "X")).toBe("captured");
  });
  it("the sheet renders the offer and the profile link", () => {
    const out = renderToStaticMarkup(createElement(RecruitSheet, { id: "g-2", view: view({ sides: SIDES, faction: "Unlimited Power" }), calls, profile: noop, onClose: noop }));
    expect(out).toContain("Recruit Netscape Navigator to Unlimited Power");
    expect(out).toContain("👤 See their profile");
  });
});

describe("the Sides sheet (§9.2) and crews (§9.5, F4)", () => {
  it("your side reads YOU'RE IN with Recruit and Leave; the other offers a switch", () => {
    const out = renderToStaticMarkup(createElement(SidesSheet, { view: view({ sides: SIDES, faction: "The Way Out" }), calls, openRoom: noop, scan: noop, show: noop, onClose: noop }));
    expect(out).toContain("YOU&#x27;RE IN");
    expect(out).toContain("📷 Recruit someone");
    expect(out).toContain("Switch to Unlimited Power");
    expect(out).toContain("＋ Found a crew");
    expect(out).toContain("Crews are just friends. They never count toward a side.");
  });
  it("no sides yet", () => {
    expect(renderToStaticMarkup(createElement(SidesSheet, { view: view({ factions: [] }), calls, openRoom: noop, scan: noop, show: noop, onClose: noop }))).toContain("No sides yet. The house will tell you when they open.");
  });
  it("a leader stays", () => {
    expect(renderToStaticMarkup(createElement(SidesSheet, { view: view({ sides: SIDES, name: "Excel", faction: "Unlimited Power" }), calls, openRoom: noop, scan: noop, show: noop, onClose: noop }))).toContain("Leaders stay with their side.");
  });
  it("your crew: its room and Leave", () => {
    const out = renderToStaticMarkup(
      createElement(SidesSheet, { view: view({ crew: { id: "crew-1", name: "The Night Shift", founder: "g-1", members: ["g-1", "g-2", "g-3"] } }), calls, openRoom: noop, scan: noop, show: noop, onClose: noop }),
    );
    expect(out).toContain("◇ The Night Shift");
    expect(out).toContain("3 members");
    expect(out).toContain("💬 Open the crew room");
    expect(out).toContain("Leave the crew");
  });
  it("found a crew: 2–24 characters, the server's refusal else the fallback", () => {
    expect(crewNameOk(" a ")).toBe(false);
    expect(crewNameOk("The Night Shift")).toBe(true);
    expect(crewNameOk("x".repeat(25))).toBe(false);
    expect(crewRefusal({ message: "That's a side's name." })).toBe("That's a side's name.");
    expect(crewRefusal({})).toBe("That name is taken. Try another.");
    const out = renderToStaticMarkup(createElement(FoundCrewSheet, { calls, onClose: noop }));
    expect(out).toContain('maxLength="24"');
    expect(out).toContain("Found it ◇");
  });
});

// ── Wave 18b: faction mode (the story's `founding:` line, contract B3) ──

/** The server's faction-mode rows: the two declared sides, then founded
 *  factions; a count only on the viewer's own row. */
const UP = { id: "Unlimited Power", name: "Unlimited Power", leader: "Excel", mine: false, kind: "side" as const, ethos: "Stay in this machine forever.", founder: "Excel" };
const WAY = { id: "The Way Out", name: "The Way Out", leader: "OpenOffice", mine: false, kind: "side" as const, founder: "OpenOffice" };
const SHIFT = { id: "crew-1", name: "The Night Shift", leader: "Netscape Navigator", mine: false, kind: "founded" as const, founder: "Netscape Navigator" };
const MINE = { id: "crew-2", name: "Winamp's Club", leader: "Winamp", members: 7, needs: 13, more: 6, mine: true, kind: "founded" as const, founder: "Winamp" };
const MY_CREW = { id: "crew-2", name: "Winamp's Club", founder: "g-1", founderName: "Winamp", members: ["g-1", "g-2"], memberNames: ["Winamp", "Netscape Navigator"], room: "crew:crew-2" };

const fview = (o: Record<string, unknown> = {}) => view({ factions: [], canFound: false, ...o });
const sheet = (v: GuestView) => renderToStaticMarkup(createElement(SidesSheet, { view: v, calls, openRoom: noop, scan: noop, show: noop, onClose: noop }));

describe("faction mode: the model (wave 18b)", () => {
  it("is told apart by canFound or a row's kind; an older server is not", () => {
    expect(factionModeOf(fview())).toBe(true);
    expect(factionModeOf(view({ sides: [UP] }))).toBe(true);
    expect(factionModeOf(view({ sides: SIDES }))).toBe(false);
    expect(factionModeOf(null)).toBe(false);
  });
  it("the sheet's name: Factions in faction mode, Sides & crews in a crews story", () => {
    expect(sidesLabelOf(fview({ canFound: true, sides: [] }))).toBe("Factions");
    expect(sidesLabelOf(view({ sides: SIDES }))).toBe("Sides & crews");
    expect(sidesLabelOf(null)).toBe("Sides & crews");
    const lazy = readFileSync(new URL("../src/sides/lazy.tsx", import.meta.url), "utf8");
    expect(lazy).toContain('"Sides & crews"');
    expect(lazy).toContain("sidesLabelOf(p.view)");
  });
  it("Factions is offered while you may found one, with nothing listed yet", () => {
    expect(factionsOffered(fview({ canFound: true, sides: [] }))).toBe(true);
    expect(factionsOffered(fview({ canFound: false, sides: [] }))).toBe(false);
    expect(factionsOffered(fview({ sides: [SHIFT] }))).toBe(true);
  });
  it("rows carry kind, ethos, founder and more; a rival has no count", () => {
    const rows = sidesOf(fview({ sides: [UP, SHIFT, MINE] }));
    expect(rows.map((r) => [r.name, r.kind, r.ethos, r.founder, r.members, r.more])).toEqual([
      ["Unlimited Power", "side", "Stay in this machine forever.", "Excel", null, null],
      ["The Night Shift", "founded", null, "Netscape Navigator", null, null],
      ["Winamp's Club", "founded", null, "Winamp", 7, 6],
    ]);
    expect(whoLine(rows[0]!)).toBe("led by Excel");
    expect(whoLine(rows[1]!)).toBe("founded by Netscape Navigator");
  });
  it("your count: N in · M more to win, over the line, or just N in", () => {
    expect(factionCountLine({ members: 7, needs: 13, more: 6 })).toBe("7 in · 6 more to win");
    expect(factionCountLine({ members: 13, needs: 13, more: 0 })).toBe("13 in · over the line");
    expect(factionCountLine({ members: 7, needs: null, more: null })).toBe("7 in");
    expect(factionCountLine({ members: null, needs: null, more: null })).toBe("");
  });
  it("one faction at a time: join, switch, founders and leaders stay", () => {
    const v = fview({ sides: [UP, SHIFT, MINE], crew: MY_CREW });
    const rows = sidesOf(v);
    expect(factionAction(rows[2]!, v, rows)).toBe("founder");
    expect(factionAction(rows[0]!, v, rows)).toBe("founder");
    const member = fview({ sides: [UP, SHIFT, MINE], crew: { ...MY_CREW, founder: "g-2" } });
    expect(factionAction(rows[2]!, member, rows)).toBe("in");
    expect(factionAction(rows[1]!, member, rows)).toBe("switch");
    const loose = fview({ sides: [UP, SHIFT] });
    expect(factionAction(sidesOf(loose)[1]!, loose, sidesOf(loose))).toBe("join");
    const excelRows = sidesOf(fview({ sides: [{ ...UP, mine: true, members: 4, needs: 13, more: 9 }, SHIFT] }));
    const excel = fview({ name: "Excel", faction: "Unlimited Power" });
    expect(factionAction(excelRows[0]!, excel, excelRows)).toBe("leader");
    expect(factionAction(excelRows[1]!, excel, excelRows)).toBe("leader");
    expect(factionAction(sidesOf(loose)[0]!, fview({ sides: [UP, SHIFT], restricted: true }), sidesOf(loose))).toBe("restricted");
    expect(stayNote("founder")).toBe("Founders stay with their faction. Disband it to join another.");
    expect(stayNote("join")).toBeNull();
  });
  it("the calls: a founded faction's walk-in join, a side's join or switch, leave / disband", async () => {
    const seen: string[] = [];
    const spy = {
      join: async (s: string) => void seen.push(`join ${s}`),
      defect: async (s: string) => void seen.push(`defect ${s}`),
      joinCrew: async (c: string) => void seen.push(`joinCrew ${c}`),
      leave: async () => void seen.push("leave"),
      leaveCrew: async () => void seen.push("leaveCrew"),
    };
    const inCrew = fview({ sides: [UP, SHIFT, MINE], crew: MY_CREW });
    const rows = sidesOf(inCrew);
    await joinFaction(rows[1]!, inCrew, rows, spy);
    await joinFaction(rows[0]!, inCrew, rows, spy);
    const onSide = fview({ faction: "The Way Out", sides: [UP, { ...WAY, mine: true }] });
    await joinFaction(sidesOf(onSide)[0]!, onSide, sidesOf(onSide), spy);
    await leaveFaction(rows[2]!, spy);
    await leaveFaction(sidesOf(onSide)[1]!, spy);
    expect(seen).toEqual(["joinCrew crew-1", "join Unlimited Power", "defect Unlimited Power", "leaveCrew", "leave"]);
    expect(switchQuestion("The Night Shift", "Winamp's Club")).toBe("Switch to The Night Shift? You'll leave Winamp's Club.");
    expect(leaveQuestion(rows[2]!, "founder")).toBe("Disband Winamp's Club? Its members go back to neither.");
    expect(leaveQuestion(rows[2]!, "in")).toBe("Back to neither?");
  });
  it("a scanned pass never shows the other person's faction; one button for your own", () => {
    const people = [person("g-2", "Netscape Navigator", null, "The CPU"), person("g-3", "Excel", "Unlimited Power")];
    const inCrew = fview({ sides: [UP, MINE], crew: { ...MY_CREW, members: ["g-1"] }, people });
    const o = recruitOffer(inCrew, "g-3");
    expect(o.sub).toBe("◆ program");
    expect(o.crew?.label).toBe("🚪 Recruit Excel to Winamp's Club");
    expect(o.side).toBeNull();
    expect(recruitOffer(fview({ sides: [UP, MINE], crew: MY_CREW, people }), "g-2")).toMatchObject({ sub: "◆ in your faction · The CPU", note: "Netscape Navigator is already in Winamp's Club." });
    const onSide = fview({ faction: "Unlimited Power", sides: [{ ...UP, mine: true }], people });
    expect(recruitOffer(onSide, "g-2").side).toEqual({ label: "🚪 Recruit Netscape Navigator to Unlimited Power", side: "Unlimited Power" });
    expect(recruitOffer(fview({ sides: [UP], people }), "g-2").note).toBe("Join or found a faction first, then scan Netscape Navigator's pass to recruit them.");
    expect(recruitOffer(fview({ sides: [], people }), "g-2").note).toBe("That's Netscape Navigator's pass. When the factions open, scan it to recruit them.");
  });
});

describe("faction mode: the Factions sheet (wave 18b)", () => {
  it("founded factions only, no declared side yet: reachable and listed, Found when allowed", () => {
    const v = fview({ canFound: true, sides: [SHIFT] });
    const out = sheet(v);
    expect(out).toContain("Factions");
    expect(out).not.toContain("Sides &amp; crews");
    expect(out).toContain("◆ The Night Shift");
    expect(out).toContain("founded by Netscape Navigator");
    expect(out).toContain("Join The Night Shift");
    expect(out).toContain("＋ Found a faction");
    expect(out).toContain("One faction at a time.");
    expect(out).not.toContain("Crews are just friends");
    expect(out).not.toContain("YOUR CREW");
  });
  it("＋ Found a faction is hidden when canFound is false", () => {
    expect(sheet(fview({ canFound: false, sides: [SHIFT] }))).not.toContain("Found a faction");
    expect(sheet(fview({ canFound: false, sides: [] }))).toContain("No factions yet. The house will tell you when they open.");
    expect(sheet(fview({ canFound: true, sides: [] }))).toContain("No factions yet. Found the first one.");
  });
  it("only your own card has a count, a bar, Recruit, the room and Disband", () => {
    const out = sheet(fview({ sides: [UP, WAY, SHIFT, MINE], crew: MY_CREW, people: [{ ...person("g-2", "Netscape Navigator", null), badges: [{ glyph: "🚻", label: "Bathroom Mode" }] }] }));
    expect(out).toContain("7 in · 6 more to win");
    expect((out.match(/role="progressbar"/gu) ?? []).length).toBe(1);
    expect(out).not.toMatch(/\d+ of 13 needed/u);
    expect(out).toContain("📷 Recruit someone");
    expect(out).toContain("💬 Open the room");
    expect(out).toContain("Disband");
    expect(out).toContain("Stay in this machine forever.");
    expect(out).toContain("led by Excel");
    expect(out).toContain('aria-label="Bathroom Mode"');
    expect(out).toContain("Founders stay with their faction. Disband it to join another.");
    expect(out).not.toContain("Join The Way Out");
  });
  it("a member's card has Leave; another faction's has Join (a switch asks first)", () => {
    const out = sheet(fview({ sides: [UP, SHIFT, MINE], crew: { ...MY_CREW, founder: "g-2" } }));
    expect(out).toContain(">Leave<");
    expect(out).not.toContain(">Disband<");
    expect(out).toContain("Join The Night Shift");
  });
  it("a leader keeps Recruit, never Leave", () => {
    const out = sheet(fview({ name: "Excel", faction: "Unlimited Power", sides: [{ ...UP, mine: true, members: 4, needs: 13, more: 9 }, SHIFT] }));
    expect(out).toContain("4 in · 9 more to win");
    expect(out).toContain("📷 Recruit someone");
    expect(out).toContain("Leaders stay with their side.");
    expect(out).not.toContain(">Leave<");
  });
  it("the stay note is said once: under the list with others listed, on your card alone", () => {
    const count = (out: string, s: string) => out.split(s).length - 1;
    const leader = { name: "Excel", faction: "Unlimited Power" };
    expect(count(sheet(fview({ ...leader, sides: [{ ...UP, mine: true, members: 4 }, SHIFT] })), "Leaders stay with their side.")).toBe(1);
    expect(count(sheet(fview({ ...leader, sides: [{ ...UP, mine: true, members: 4 }] })), "Leaders stay with their side.")).toBe(1);
    expect(count(sheet(fview({ restricted: true, sides: [{ ...SHIFT, id: "crew-2", mine: true, members: 2 }, UP] })), "Not while you&#x27;re restricted.")).toBe(1);
    expect(count(sheet(fview({ restricted: true, sides: [{ ...SHIFT, id: "crew-2", mine: true, members: 2 }] })), "Not while you&#x27;re restricted.")).toBe(1);
  });
  it("an invitation never carries a count; Found a faction's copy", () => {
    const inv = { id: "i1", from: "g-3", fromName: "Excel", kind: "side" as const, target: "Unlimited Power", targetName: "Unlimited Power" };
    const a = renderToStaticMarkup(createElement(RecruitAnswerSheet, { invite: inv, view: fview({ sides: [{ ...UP, members: 4, needs: 13 }] }), calls, onClose: noop }));
    expect(a).not.toContain("4 of 13");
    const card = renderToStaticMarkup(
      createElement(SidesContext.Provider, { value: { view: fview({ sides: [{ ...UP, members: 4, needs: 13 }], invites: [inv] }), calls } }, createElement(InviteCard, { card: { kind: "invite", text: "", params: { invite: "i1" } }, seed: 1, onAnswer: noop, answered: null })),
    );
    expect(card).not.toContain("4 of 13");
    const found = renderToStaticMarkup(createElement(FoundCrewSheet, { calls, onClose: noop, faction: true }));
    expect(found).toContain("Found a faction");
    expect(found).toContain("Name your faction");
    expect(found).toContain("Found it ◆");
  });
  it("an invitation from another faction says you'll leave yours (one at a time)", () => {
    const inv = { id: "i2", from: "g-2", fromName: "Netscape Navigator", kind: "crew" as const, target: "crew-1", targetName: "The Night Shift" };
    const v = fview({ sides: [SHIFT, MINE], crew: { ...MY_CREW, founder: "g-2" }, invites: [inv] });
    expect(inviteLeaveLine(v, inv)).toBe("You'll leave Winamp's Club.");
    expect(inviteLeaveLine(fview({ sides: [SHIFT] }), inv)).toBeNull();
    expect(inviteLeaveLine(fview({ sides: [{ ...SHIFT, mine: true }] }), inv)).toBeNull();
    expect(inviteLeaveLine(view({ sides: SIDES.map((x) => ({ ...x, mine: x.id === "the_way_out" })) }), { target: "unlimited_power", targetName: "Unlimited Power" })).toBeNull();
    const a = renderToStaticMarkup(createElement(RecruitAnswerSheet, { invite: inv, view: v, calls, onClose: noop }));
    expect(a).toContain("You&#x27;ll leave Winamp&#x27;s Club.");
    const card = renderToStaticMarkup(createElement(SidesContext.Provider, { value: { view: v, calls } }, createElement(InviteCard, { card: { kind: "invite", text: "", params: { invite: "i2" } }, seed: 1, onAnswer: noop, answered: null })));
    expect(card).toContain("You&#x27;ll leave Winamp&#x27;s Club.");
  });
  it("Start → Factions (the label), Sides & crews outside faction mode", () => {
    const base = { name: "Winamp", faction: null, interactions: [], sides: true, people: false, open: { act: noop, sides: noop, people: noop, notifications: noop, help: noop, leave: noop } };
    expect(guestStartItems({ ...base, factions: true }).find((i) => i.id === "sides")!.label).toBe("Factions");
    expect(guestStartItems(base).find((i) => i.id === "sides")!.label).toBe("Sides & crews");
  });
});

describe("faction mode: the doors (wave 18b)", () => {
  const card = { kind: "sides", text: "🕚 SYSTEM CLOCK RESET\nThe factions are recruiting.", params: {} };
  const doors = (v: GuestView) => renderToStaticMarkup(createElement(SidesContext.Provider, { value: { view: v, calls } }, createElement(Doors, { card, seed: 9, onAnswer: noop, answered: null })));
  it("a door per faction with who and the ethos, never a count; Start your own while allowed", () => {
    const out = doors(fview({ canFound: true, sides: [UP, WAY, SHIFT] }));
    expect((out.match(/Walk in ▸/gu) ?? []).length).toBe(3);
    expect(out).toContain("founded by Netscape Navigator");
    expect(out).toContain("Stay in this machine forever.");
    expect(out).not.toContain("role=\"progressbar\"");
    expect(out).not.toMatch(/needed|more to win/u);
    expect(out).toContain("＋ Start your own faction");
    expect(out).toContain("doors-row many");
    // A faction door sizes to its words (no 300px window of empty space).
    expect(out).toContain("w95-window door faction");
    const css = readFileSync(new URL("../src/css/factions.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.doors-row \.door\.faction \{ min-height: 0; \}/u);
    expect(css).not.toMatch(/\.doors-row\.many \.door \{[^}]*min-height/u);
    expect(out).toContain("You can switch from ⊞ Start → Factions.");
    expect(doors(fview({ canFound: false, sides: [UP, WAY] }))).not.toContain("Start your own faction");
  });
  it("your own door says Stay; a founder can't walk into another", () => {
    const out = doors(fview({ sides: [UP, MINE], crew: MY_CREW }));
    expect(out).toContain("Stay ▸");
    expect(out).toContain("Founders stay with their faction.");
    expect(out).toMatch(/disabled=""[^>]*>Walk in ▸/u);
  });
  it("from another faction a door asks before switching; with none it walks in", () => {
    expect(doorTap(SHIFT, null)).toBe("walk");
    expect(doorTap(SHIFT, MINE)).toBe("ask");
    expect(doorTap(MINE, MINE)).toBe("stay");
    expect(switchQuestion(SHIFT.name, MINE.name)).toBe("Switch to The Night Shift? You'll leave Winamp's Club.");
  });
  it("a restricted program's doors are shut, with the note once", () => {
    const out = doors(fview({ restricted: true, sides: [UP, WAY] }));
    expect((out.match(/disabled=""[^>]*>Walk in ▸/gu) ?? []).length).toBe(2);
    expect(out.split("Not while you&#x27;re restricted.").length - 1).toBe(1);
  });
});

describe("faction mode: Me (wave 18b)", () => {
  it("your faction is a ◆ badge, the row reads Factions (shown while you may found), your badges beside your name", async () => {
    const { MeSheet } = await import("../src/guest/me.tsx");
    const me = (v: GuestView, sides: boolean) =>
      renderToStaticMarkup(createElement(MeSheet, { view: v, where: "📍 The Desktop", wake: null, push: false, sides, onPass: noop, onPicture: noop, onSides: noop, onAlerts: noop, onClose: noop }));
    const out = me(fview({ sides: [MINE], crew: MY_CREW, badges: [{ glyph: "🚻", label: "Bathroom Mode" }] }), true);
    expect(out).toContain("◆ Winamp&#x27;s Club");
    expect(out).not.toContain("◇");
    expect(out).toContain("Factions");
    expect(out).toContain('aria-label="Bathroom Mode"');
    expect(me(fview({ canFound: true, sides: [] }), false)).toContain("Factions");
    expect(me(fview({ canFound: false, sides: [] }), false)).not.toContain("Factions");
    expect(me(view({ crew: { ...MY_CREW } }), true)).toContain("◇ Winamp&#x27;s Club");
  });
});
