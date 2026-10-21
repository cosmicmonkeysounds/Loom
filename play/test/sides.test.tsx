//! Wave 18 (GUEST-SPEC §9, DECISIONS F1–F4, CONTRACTS C10): the sides a
//! guest sees, what each side's card offers, the doors, the invite card,
//! recruiting by pass and founding a crew — against the C10 fields, with an
//! old server's `factions` as the fallback.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidesContext } from "../src/sides/context.ts";
import { Doors } from "../src/sides/doors.tsx";
import { InviteCard } from "../src/sides/invite.tsx";
import { FoundCrewSheet, RecruitSheet, SidesSheet } from "../src/sides/index.tsx";
import { countLine, crewNameOk, crewRefusal, crewRoom, hasSidesOrCrew, inviteOf, recruitOffer, recruitRefusal, sideAction, sidesOf } from "../src/sides/model.ts";
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
  leaveCrew: async () => ({}),
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
