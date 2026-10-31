//! Wave 18b (R15): 🚻 beside the names of people in Bathroom Mode — on
//! People / Who's here, the one-to-one thread rows, the pickers, the booth
//! and the host's People tab; never on a chat bubble (a past line).

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoothBadgesProvider, GuestBadges, boothBadgeMap } from "../src/booth/badges.tsx";
import { DoorWindow } from "../src/booth/door.tsx";
import { GuestTiles } from "../src/booth/pick/tiles.tsx";
import { PeopleSheet, PersonRow } from "../src/guest/sheets.tsx";
import { bathroomTag, inBathroom } from "../src/host/model.ts";
import { threadPersonId } from "../src/rooms/chats.ts";
import { ChannelRow } from "../src/rooms/list.tsx";
import { PickerSheet } from "../src/ui/primitives.tsx";
import type { Channel, PersonCard, PrimeGuest } from "../src/types.ts";

const AFK = { glyph: "🚻", label: "Bathroom Mode" };
const noop = () => {};

describe("the guest's lists", () => {
  it("People / Who's here: the badge beside the name, named for a screen reader", () => {
    const card: PersonCard = { id: "g1", name: "Winamp", kind: "guest", faction: null, known: [], location: "The CPU", badges: [AFK] };
    const html = renderToStaticMarkup(<PersonRow card={card} onMessage={noop} />);
    expect(html).toContain('<span class="name">Winamp</span><span class="name-badge" title="Bathroom Mode" aria-label="Bathroom Mode" role="img">🚻</span>');
    const none = renderToStaticMarkup(<PersonRow card={{ ...card, badges: undefined }} onMessage={noop} />);
    expect(none).not.toContain("name-badge");
  });

  it("a one-to-one thread names its person (pm's other party, a dm's character), and its row wears their badges", () => {
    expect(threadPersonId("pm:g1:g2", "g1")).toBe("g2");
    expect(threadPersonId("pm:g1:g2", "g2")).toBe("g1");
    expect(threadPersonId("pm:g3:g2", "g1")).toBeNull();
    expect(threadPersonId("dm:Clippy", "g1")).toBe("Clippy");
    expect(threadPersonId("loc:The_CPU", "g1")).toBeNull();
    const ch = { id: "pm:g1:g2", kind: "dm", title: "Winamp", messages: [], unread: 0 } as unknown as Channel;
    expect(renderToStaticMarkup(<ChannelRow channel={ch} onOpen={noop} dot={false} badges={[AFK]} />)).toMatch(/chrow-title">Winamp<\/span><span class="name-badge"[^>]*>🚻/u);
  });

  it("a picker row (Share…, the wallet's people) wears them too", () => {
    const html = renderToStaticMarkup(<PickerSheet title="Send" items={[{ id: "g2", label: "Winamp", avatar: true, badges: [AFK] }]} onPick={noop} onClose={noop} />);
    expect(html).toMatch(/pick-label">Winamp<span class="name-badge"/u);
  });
});

describe("the guest's People (wave 59)", () => {
  it("lists who is online, and says so when nobody else is", () => {
    const card = (id: string, kind: "guest" | "character", online?: boolean) => ({ id, name: id, kind, faction: null, known: [], location: null, ...(online !== undefined ? { online } : {}) });
    const sheet = (people: unknown[]) => renderToStaticMarkup(<PeopleSheet session={{ status: { people } } as never} onClose={() => {}} />);
    const html = sheet([card("Ada", "guest", true), card("Napster", "guest", false), card("Clippy", "character", true), card("Norton", "character", false), card("Old", "guest")]);
    for (const name of ["Ada", "Clippy", "Old"]) expect(html).toContain(name);
    for (const name of ["Napster", "Norton"]) expect(html).not.toContain(name);
    expect(sheet([card("Napster", "guest", false)])).toContain("Nobody else is here yet.");
  });
});

describe("the booth", () => {
  const G = (id: string, badges?: PrimeGuest["badges"]): PrimeGuest => ({ id, name: id, faction: null, captured: false, location: "The CPU", ...(badges ? { badges } : {}) });
  it("maps only the guests wearing one, and shows it by id wherever a name is shown", () => {
    const guests = [G("Winamp", [AFK]), G("ICQ")];
    expect([...boothBadgeMap(guests).keys()]).toEqual(["Winamp"]);
    const tiles = renderToStaticMarkup(
      <BoothBadgesProvider guests={guests}>
        <GuestTiles list={guests} everyone={guests} chosen={null} onPick={noop} />
      </BoothBadgesProvider>,
    );
    expect(tiles.match(/name-badge/gu)).toHaveLength(1);
    expect(tiles).toMatch(/tile-name">Winamp<span class="name-badge"/u);
    // A door entry carries only a name: the provider finds the badge by id.
    const door = renderToStaticMarkup(
      <BoothBadgesProvider guests={guests}>
        <DoorWindow queue={[{ id: "Winamp", name: "Winamp", since: 0, claimedBy: null }]} now={1000} me="Norton" canClaim onClaim={noop} onScan={noop} onCard={noop} onClose={noop} />
      </BoothBadgesProvider>,
    );
    expect(door).toContain("🚻");
    // No provider (a test, an old view): nothing.
    expect(renderToStaticMarkup(<GuestBadges id="Winamp" />)).toBe("");
  });

  it("every booth surface that names a guest shows their badges", () => {
    for (const f of ["guests.tsx", "card.tsx", "door.tsx", "confront.tsx", "pick/tiles.tsx", "pick/rows.tsx", "wanted/poster.tsx"]) {
      expect(readFileSync(new URL(`../src/booth/${f}`, import.meta.url), "utf8"), f).toContain("<GuestBadges id=");
    }
  });
});

describe("the host's People tab", () => {
  it("the badge wins; the flag heuristic stays for an older server", () => {
    const flagged = { flags: [{ label: "Bathroom Mode", path: "program.afk", on: true }] } as never;
    expect(inBathroom(flagged)).toBe(true);
    expect(bathroomTag(flagged)).toBe(true);
    const badged = { flags: [{ label: "Bathroom Mode", path: "program.afk", on: true }], badges: [AFK] } as never;
    expect(inBathroom(badged)).toBe(true);
    expect(bathroomTag(badged)).toBe(false);
    expect(inBathroom({ badges: [AFK] } as never)).toBe(true);
    expect(inBathroom({ badges: [{ glyph: "⭐", label: "Star" }] } as never)).toBe(false);
    const tab = readFileSync(new URL("../src/host/tab-people.tsx", import.meta.url), "utf8");
    expect(tab).toContain("<NameBadges badges={badgesOf(p)} />");
  });
});

describe("never on a bubble", () => {
  it("a chat bubble is a past line: it never wears a badge", () => {
    expect(readFileSync(new URL("../src/stream/bubble.tsx", import.meta.url), "utf8")).not.toMatch(/NameBadges|name-badge/u);
  });
});
