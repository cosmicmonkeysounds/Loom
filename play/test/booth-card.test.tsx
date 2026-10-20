// Wave 13 (booth lane): a scan opens the guest's card at once — facts first
// (Not cleared, ⛔, 🔒, 📍, the story's flags), at most three story buttons
// on its face (the live objectives' buttons the server says are live for
// this guest, then the ones live because of this guest), the story's reply
// to the press on the card, and every other button under "All buttons… (n)"
// with its description.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FACE_MAX, FACE_SETTLE_MS, cardButtons, cardReadKey, faceSettled, factChips } from "../src/booth/model.ts";
import { ARM_DEAD_MS } from "../src/arm.ts";
import { GuestCardBody } from "../src/booth/card.tsx";
import type { PrimeSession } from "../src/session/prime.ts";
import type { GuestCardView, Interaction, ObjectiveView, PrimeGuest, PrimeView } from "../src/types.ts";

const btn = (id: string, extra: Partial<Interaction> = {}): Interaction => ({ id, label: `L-${id}`, who: "performer", description: `D-${id}`, ...extra });
const NORTON = "Norton Anti-Virus";
const list: Interaction[] = [
  btn("send", { actors: [NORTON] }),
  btn("reinstalled", { actors: [NORTON] }),
  btn("watch", { actors: [NORTON] }),
  btn("patch_a", { actors: [NORTON], arm: true }),
  btn("crew", { actors: [NORTON] }),
  btn("vouch", { actors: ["Clippy"], only: true }),
  btn("checkin"),
];
const obj = (id: string, buttons: string[]): ObjectiveView => ({ id, title: `T-${id}`, brief: "", checklist: [], buttons, act: null });
const card = (live: string[], guestScoped: string[] = []): GuestCardView => ({
  guest: { id: "g-1", name: "Ada", faction: null, captured: false, location: null },
  live,
  guestScoped,
  readouts: [],
});

describe("the card's face", () => {
  it("is the union of every live objective's buttons, in objective order, filtered by the card's live list, ≤ 3", () => {
    // Four objectives naming five buttons: the face keeps three, in order.
    const objectives = [obj("a", ["send", "scan"]), obj("b", ["watch", "send"]), obj("c", ["crew", "reinstalled"]), obj("d", ["checkin"])];
    const all = ["send", "reinstalled", "watch", "crew", "checkin", "patch_a"];
    const out = cardButtons(list, objectives, card(all), NORTON, false);
    expect(out.face.map((b) => b.interaction.id)).toEqual(["send", "watch", "crew"]);
    expect(out.face.length).toBeLessThanOrEqual(FACE_MAX);
    // Nothing is lost: every other button is in the fold, live ones first.
    expect(out.rest.map((b) => b.interaction.id)).toEqual(["reinstalled", "patch_a", "checkin"]);
  });

  it("drops an objective's button the server says is not live for this guest, and the reserved pass / scan words", () => {
    const out = cardButtons(list, [obj("a", ["pass", "scan", "send", "watch"])], card(["watch"]), NORTON, false);
    expect(out.face.map((b) => b.interaction.id)).toEqual(["watch"]);
    expect(out.rest.find((b) => b.interaction.id === "send")).toMatchObject({ live: false });
  });

  it("promotes the buttons live because of this guest ahead of buttons no objective names", () => {
    const out = cardButtons(list, [obj("a", ["send"])], card(["send", "crew", "reinstalled", "watch"], ["reinstalled"]), NORTON, false);
    expect(out.face.map((b) => b.interaction.id)).toEqual(["send", "reinstalled"]);
  });

  it("with no objective at all, falls back to this character's own live buttons", () => {
    const out = cardButtons(list, [], card(["send", "reinstalled", "watch", "crew"]), NORTON, false);
    expect(out.face.map((b) => b.interaction.id)).toEqual(["send", "reinstalled", "watch"]);
  });

  it("leaves another character's `by:` button off a plain booth; a host booth gets it in the fold", () => {
    expect(cardButtons(list, [], card(["send"]), NORTON, false).rest.some((b) => b.interaction.id === "vouch")).toBe(false);
    expect(cardButtons(list, [], card(["send", "vouch"]), NORTON, true).rest.find((b) => b.interaction.id === "vouch")).toMatchObject({ live: true });
  });

  it("never offers a director's cue, even if one slips into the view", () => {
    const withCue = [...list, btn("cue", { who: "admin" })];
    const out = cardButtons(withCue, [obj("a", ["cue"])], card(["cue", "send"]), NORTON, true);
    expect([...out.face, ...out.rest].some((b) => b.interaction.id === "cue")).toBe(false);
  });

  it("without a card (an older server), the view's own live flags stand in", () => {
    const offPhase = list.map((i) => (i.id === "send" ? { ...i, live: false as const } : i));
    const out = cardButtons(offPhase, [obj("a", ["send", "watch"])], null, NORTON, false);
    expect(out.face.map((b) => b.interaction.id)).toEqual(["watch"]);
  });
});

describe("a double tap after a press", () => {
  it("drops the second tap while the replaced card settles, so it never fires the button that moved under the finger", () => {
    // Tap 1 fired "Mark"; its answer replaced the card at t = 1000 and the
    // face re-flowed ("Vouch" now sits where "Mark" was).
    const landedAt = 1000;
    expect(faceSettled(null, 0)).toBe(true); // a fresh card takes the first tap
    expect(faceSettled(landedAt, landedAt + 400)).toBe(false); // the reviewer's 400 ms double tap
    expect(faceSettled(landedAt, landedAt + FACE_SETTLE_MS - 1)).toBe(false);
    expect(faceSettled(landedAt, landedAt + FACE_SETTLE_MS)).toBe(true); // a deliberate next tap fires
    // Longer than the arm model's dead time, so it covers a double tap that arm-then-fire ignores.
    expect(FACE_SETTLE_MS).toBeGreaterThan(ARM_DEAD_MS);
  });
});

describe("the card's facts", () => {
  const g = (over: Partial<PrimeGuest> = {}): PrimeGuest => ({ id: "g-1", name: "Ada", faction: null, captured: false, location: null, ...over });
  it("a false Cleared reads loud as Not cleared; a false non-gate flag is left out", () => {
    const chips = factChips(g({ flags: [{ label: "Cleared", path: "program.cleared", value: "false", on: false }, { label: "Marked", path: "program.marked", value: "false", on: false }] }), "The Desktop");
    expect(chips).toEqual([
      { text: "✗ Not cleared", tone: "loud" },
      { text: "📍 The Desktop", tone: "quiet" },
    ]);
  });
  it("loud first: ⛔ restricted, 🔒 captured, a failed gate; then where, then the true flags and values", () => {
    const chips = factChips(
      g({ restricted: true, captured: true, flags: [{ label: "Marked", path: "p.m", value: "true", on: true }, { label: "Room", path: "p.r", value: "Tent", on: true }, { label: "Checked in", path: "p.c", value: "false", on: false }] }),
      "The Internet",
    );
    expect(chips.map((c) => c.text)).toEqual(["⛔ Restricted", "🔒 Captured", "✗ Not checked in", "📍 The Internet", "✓ Marked", "Room: Tent"]);
  });
});

function fakeSession(over: Partial<PrimeView> = {}): PrimeSession {
  const view = {
    character: NORTON,
    faction: "Antivirus",
    guests: [{ id: "g-1", name: "Ada", faction: null, captured: false, location: "Desktop", flags: [{ label: "Cleared", path: "program.cleared", value: "false", on: false }] }],
    channels: [{ id: "loc:Desktop", kind: "location", title: "The Desktop", spaceId: "story", member: true, canPost: true, threadable: true }],
    spaces: [],
    interactions: list,
    objectives: [obj("door", ["send", "watch"])],
    ...over,
  } as PrimeView;
  const never = () => new Promise<never>(() => {});
  return { auth: { token: "t", character: NORTON, admin: false, eventId: "default" }, view, card: never, act: never, scan: never } as unknown as PrimeSession;
}

describe("the card as rendered", () => {
  it("a scan's card opens with the story's reply on it, the face buttons with their descriptions, and the fold's count", () => {
    const html = renderToStaticMarkup(
      <GuestCardBody
        session={fakeSession()}
        guestId="g-1"
        seed={{ card: { ...card(["send", "watch", "crew", "checkin"]), guest: { id: "g-1", name: "Ada", faction: null, captured: false, location: "Desktop", flags: [{ label: "Cleared", path: "program.cleared", value: "false", on: false }] } }, replies: ["✅ Cleared Ada."] }}
        admin={false}
        onOpenThread={() => {}}
        onNext={() => {}}
      />,
    );
    expect(html).toContain("✅ Cleared Ada.");
    expect(html).toContain("✗ Not cleared");
    expect(html).toContain("📍 The Desktop");
    // Two face buttons (the objective's), each with its description.
    expect(html.match(/booth-face-btn/g)?.length).toBe(2);
    expect(html).toContain("L-send");
    expect(html).toContain("D-send");
    // Everything else this booth may press is one tap away, counted.
    expect(html).toContain("All buttons… (4)");
    expect(html).toContain("📷 Next guest");
  });

  it("reads the facts off the guest's live row, so another booth's act shows on a card left open", () => {
    // McAfee sent Ada to the Internet after this card was read: the card still says free, the row says captured.
    const session = fakeSession({ guests: [{ id: "g-1", name: "Ada", faction: null, captured: true, location: "Internet" }] });
    const html = renderToStaticMarkup(<GuestCardBody session={session} guestId="g-1" seed={{ card: card(["send"]) }} admin={false} onOpenThread={() => {}} />);
    expect(html).toContain("🔒 Captured");
  });

  it("is re-read when the guest's row changes, not only when the night moves", () => {
    const ada = { id: "g-1", name: "Ada", faction: null, captured: false, location: "Desktop" };
    const objectives = [obj("door", ["send"])];
    const night = { step: 3, phase: "door" };
    const key = cardReadKey("g-1", objectives, night, ada);
    expect(cardReadKey("g-1", objectives, night, { ...ada })).toBe(key); // same facts: the card stands
    expect(cardReadKey("g-1", objectives, night, { ...ada, captured: true })).not.toBe(key); // another booth acted
    expect(cardReadKey("g-1", objectives, { ...night, step: 4 }, ada)).not.toBe(key); // the night moved
    expect(cardReadKey("g-2", objectives, night, ada)).not.toBe(key);
  });

  it("says so when there is nothing to press on this guest", () => {
    const html = renderToStaticMarkup(<GuestCardBody session={fakeSession()} guestId="g-1" seed={{ card: card([]) }} admin={false} onOpenThread={() => {}} />);
    expect(html).toContain("Nothing for Norton Anti-Virus to press on Ada right now.");
  });

  it("an arm: true face button keeps arming (it carries no armed look until tapped)", () => {
    const html = renderToStaticMarkup(
      <GuestCardBody session={fakeSession({ objectives: [obj("y2k", ["patch_a"])] })} guestId="g-1" seed={{ card: card(["patch_a"]) }} admin={false} onOpenThread={() => {}} />,
    );
    expect(html).toContain("L-patch_a");
    expect(html).not.toContain("armed");
  });
});
